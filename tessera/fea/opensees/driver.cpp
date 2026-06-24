// Tessera FEA — OpenSees-subset WebAssembly driver (Phase 3, Option B).
//
// Drives a *real* OpenSees linear-elastic StaticAnalysis from a flat model
// description, compiled to WebAssembly with Emscripten. This is the production
// path chosen at the go/no-go gate; the self-contained Eigen solver
// (../src/fea_solver.cpp) is retained as the parity oracle.
//
// It exposes the SAME embind `solve(model) -> result` signature as the Eigen
// oracle, so the entire TypeScript FeaEngine / Worker / schema layer is reused
// unchanged (build spec §2.1 — the engine is decoupled behind one interface).
//
// Subset used (all pure C++, NO Fortran/LAPACK — see docs/PHASE3_SPIKE.md):
//   ElasticBeam2d + LinearCrdTransf2d, Domain/Node/SP_Constraint,
//   LoadPattern/LinearSeries/NodalLoad/Beam2dUniformLoad,
//   StaticAnalysis + AnalysisModel + Linear + LoadControl + PlainHandler +
//   PlainNumberer + ProfileSPDLinSOE + ProfileSPDLinDirectSolver.
//
// Units (consistent, US customary): in, kip, ksi, in^2, in^4, kip-in, kip/in.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cmath>
#include <map>
#include <string>
#include <vector>

#include <OPS_Globals.h>
#include <StandardStream.h>

#include <Domain.h>
#include <Node.h>
#include <SP_Constraint.h>
#include <NodalLoad.h>
#include <LoadPattern.h>
#include <LinearSeries.h>
#include <Beam2dUniformLoad.h>
#include <Beam2dPointLoad.h>
#include <Beam2dPartialUniformLoad.h>
#include <Vector.h>

#include <ElasticBeam2d.h>
#include <LinearCrdTransf2d.h>
#include <ElasticBeam3d.h>
#include <LinearCrdTransf3d.h>
#include <Beam3dUniformLoad.h>
#include <Beam3dPointLoad.h>
#include <Beam3dPartialUniformLoad.h>
#include <Response.h>
#include <Information.h>

#include <StaticAnalysis.h>
#include <AnalysisModel.h>
#include <Linear.h>
#include <PlainHandler.h>
#include <PlainNumberer.h>
#include <LoadControl.h>
#include <ProfileSPDLinSOE.h>
#include <ProfileSPDLinDirectSolver.h>

// Fiber-section moment–curvature (Phase 3 nonlinear capacity check).
#include <UniaxialMaterial.h>
#include <Concrete02.h>
#include <ElasticPPMaterial.h>
#include <InitStrainMaterial.h>
#include <FiberSection2d.h>
#include <UniaxialFiber2d.h>
#include <Matrix.h>

using emscripten::val;

// Global stream singletons required by OPS_Globals.h (see EXAMPLES/Example1).
StandardStream sserr;
OPS_Stream *opserrPtr = &sserr;

// Material-print hook referenced only by Domain::Print (never invoked by this
// driver). UniaxialMaterial.cpp / SectionForceDeformation.cpp now provide the
// real OPS_printUniaxialMaterial / OPS_printSectionForceDeformation; only the
// NDMaterial hook still needs a stub (no NDMaterial source is linked).
void OPS_printNDMaterial(OPS_Stream &, int) {}

// LAPACK is intentionally NOT linked (spec §2.2 — no Fortran/LAPACK). Matrix::Invert
// is pulled into the link only through SectionForceDeformation's vtable
// (getSectionFlexibility); it is never executed on the moment–curvature path
// (which uses the section tangent directly). These stubs satisfy the linker and
// report failure (INFO != 0) if ever actually reached.
extern "C" int dgetrf_(int *, int *, double *, int *, int *, int *INFO) { *INFO = 1; return 0; }
extern "C" int dgetri_(int *, double *, int *, int *, double *, int *, int *INFO) { *INFO = 1; return 0; }

// Section-representation registry accessor — used only by the Tcl/interpreter
// fiber path (FiberSection2d::getResponse for raw fiber data). The driver builds
// fiber sections directly, so an empty registry (null) is correct here.
class SectionRepres;
SectionRepres *OPS_getSectionRepres(int) { return nullptr; }

namespace {
int len(const val &arr) {
  return (arr.isUndefined() || arr.isNull()) ? 0 : arr["length"].as<int>();
}
// Read an optional numeric field, defaulting when it is absent/null. The TS
// schema (normalizeFeaModel) already fills these defaults; this also keeps the
// engine robust to hand-built models (e.g. the smoke test) that omit them,
// rather than silently turning a missing field into NaN.
double num(const val &v, double def = 0.0) {
  return (v.isUndefined() || v.isNull()) ? def : v.as<double>();
}
// Read an optional boolean field from a (possibly absent) object.
bool flag(const val &obj, const char *key, bool def = false) {
  if (obj.isUndefined() || obj.isNull()) return def;
  val v = obj[key];
  return (v.isUndefined() || v.isNull()) ? def : v.as<bool>();
}
// Map per-end moment-release booleans to the OpenSees release code
// (0 none, 1 end I, 2 end J, 3 both) for one bending axis.
int releaseCode(const val &rel, const char *endI, const char *endJ) {
  return (flag(rel, endI) ? 1 : 0) + (flag(rel, endJ) ? 2 : 0);
}
}  // namespace

// Solve a linear-elastic 2D frame with OpenSees (3 DOF/node).
val solve2D(val model) {
  val result = val::object();

  Domain *domain = new Domain();

  // ---- nodes (3 DOF/node: dx, dy, rz) ---------------------------------------
  val jsNodes = model["nodes"];
  const int nNodes = len(jsNodes);
  std::map<std::string, int> nodeTag;          // string id -> OpenSees int tag
  std::vector<std::string> nodeId(nNodes + 1); // tag -> string id
  std::vector<double> nodeX(nNodes + 1), nodeY(nNodes + 1);
  for (int i = 0; i < nNodes; ++i) {
    val nd = jsNodes[i];
    const std::string id = nd["id"].as<std::string>();
    const double x = nd["x"].as<double>();
    const double y = nd["y"].as<double>();
    const int tag = i + 1;
    nodeTag[id] = tag;
    nodeId[tag] = id;
    nodeX[tag] = x;
    nodeY[tag] = y;
    domain->addNode(new Node(tag, 3, x, y));
  }

  // ---- materials & sections (id -> {E} / {A,I}) -----------------------------
  std::map<std::string, double> matE;
  val jsMats = model["materials"];
  for (int i = 0; i < len(jsMats); ++i) {
    val m = jsMats[i];
    matE[m["id"].as<std::string>()] = m["E"].as<double>();
  }
  std::map<std::string, std::pair<double, double>> secAI;  // id -> {A, I}
  val jsSecs = model["sections"];
  for (int i = 0; i < len(jsSecs); ++i) {
    val s = jsSecs[i];
    secAI[s["id"].as<std::string>()] = {s["A"].as<double>(), s["I"].as<double>()};
  }

  // ---- elements (ElasticBeam2d + a per-element LinearCrdTransf2d) ------------
  val jsElems = model["elements"];
  const int nElems = len(jsElems);
  std::map<std::string, int> elemTag;
  std::vector<std::string> elemId(nElems + 1);
  std::vector<int> elemNi(nElems + 1), elemNj(nElems + 1);
  for (int e = 0; e < nElems; ++e) {
    val el = jsElems[e];
    const std::string id = el["id"].as<std::string>();
    const int ni = nodeTag.at(el["nodeI"].as<std::string>());
    const int nj = nodeTag.at(el["nodeJ"].as<std::string>());
    const double E = matE.at(el["materialId"].as<std::string>());
    const auto AI = secAI.at(el["sectionId"].as<std::string>());
    const int tag = e + 1;
    elemTag[id] = tag;
    elemId[tag] = id;
    elemNi[tag] = ni;
    elemNj[tag] = nj;

    CrdTransf *transf = new LinearCrdTransf2d(tag);
    // ElasticBeam2d(tag, A, E, I, Nd1, Nd2, transf, alpha, d, rho, cMass, release)
    const int relz = releaseCode(el["releases"], "Mzi", "Mzj");
    domain->addElement(new ElasticBeam2d(tag, AI.first, E, AI.second, ni, nj, *transf, 0.0, 0.0,
                                         0.0, 0, relz));
  }

  // ---- supports (homogeneous single-point constraints) ----------------------
  val jsSupports = model["supports"];
  for (int i = 0; i < len(jsSupports); ++i) {
    val sp = jsSupports[i];
    const int tag = nodeTag.at(sp["nodeId"].as<std::string>());
    if (sp["dx"].as<bool>()) domain->addSP_Constraint(new SP_Constraint(tag, 0, 0.0, true));
    if (sp["dy"].as<bool>()) domain->addSP_Constraint(new SP_Constraint(tag, 1, 0.0, true));
    if (sp["rz"].as<bool>()) domain->addSP_Constraint(new SP_Constraint(tag, 2, 0.0, true));
  }

  // ---- loads in a single pattern with a linear time series ------------------
  const int patternTag = 1;
  LoadPattern *pattern = new LoadPattern(patternTag);
  pattern->setTimeSeries(new LinearSeries());
  domain->addLoadPattern(pattern);

  int loadTag = 1;
  val jsNodalLoads = model["nodalLoads"];
  for (int i = 0; i < len(jsNodalLoads); ++i) {
    val ld = jsNodalLoads[i];
    const int tag = nodeTag.at(ld["nodeId"].as<std::string>());
    Vector f(3);
    f(0) = num(ld["fx"]);
    f(1) = num(ld["fy"]);
    f(2) = num(ld["mz"]);
    domain->addNodalLoad(new NodalLoad(loadTag++, tag, f), patternTag);
  }

  val jsElemLoads = model["elementLoads"];
  for (int i = 0; i < len(jsElemLoads); ++i) {
    val ld = jsElemLoads[i];
    const int et = elemTag.at(ld["elementId"].as<std::string>());
    // Beam2dUniformLoad(tag, wTrans, wAxial, eleTag)
    domain->addElementalLoad(
        new Beam2dUniformLoad(loadTag++, num(ld["wy"]), num(ld["wx"]), et),
        patternTag);
  }
  val jsPointLoads = model["elementPointLoads"];
  for (int i = 0; i < len(jsPointLoads); ++i) {
    val ld = jsPointLoads[i];
    const int et = elemTag.at(ld["elementId"].as<std::string>());
    // Beam2dPointLoad(tag, Ptransverse, aOverL, eleTag, Paxial)
    domain->addElementalLoad(
        new Beam2dPointLoad(loadTag++, num(ld["py"]), num(ld["at"]), et,
                            num(ld["px"])),
        patternTag);
  }
  val jsPartialLoads = model["elementPartialLoads"];
  for (int i = 0; i < len(jsPartialLoads); ++i) {
    val ld = jsPartialLoads[i];
    const int et = elemTag.at(ld["elementId"].as<std::string>());
    // Beam2dPartialUniformLoad(tag, wTransA, wTransB, wAxialA, wAxialB, aL, bL, eleTag)
    domain->addElementalLoad(
        new Beam2dPartialUniformLoad(loadTag++, num(ld["wy"]), num(ld["wyEnd"]),
                                     num(ld["wx"]), num(ld["wxEnd"]),
                                     num(ld["a"]), num(ld["b"]), et),
        patternTag);
  }

  // ---- static analysis assembly (no Fortran in this path) -------------------
  AnalysisModel *theModel = new AnalysisModel();
  EquiSolnAlgo *theAlgo = new Linear();
  StaticIntegrator *theIntegrator = new LoadControl(1.0, 1, 1.0, 1.0);
  ConstraintHandler *theHandler = new PlainHandler();
  DOF_Numberer *theNumberer = new PlainNumberer();
  ProfileSPDLinSolver *theSolver = new ProfileSPDLinDirectSolver();
  LinearSOE *theSOE = new ProfileSPDLinSOE(*theSolver);

  StaticAnalysis analysis(*domain, *theHandler, *theNumberer, *theModel, *theAlgo,
                          *theSOE, *theIntegrator);

  const int analyzeResult = analysis.analyze(1);
  bool converged = (analyzeResult == 0);
  std::string message = converged ? "ok" : "StaticAnalysis.analyze() failed";

  // Reactions at restrained DOFs (flag 0 = static, no inertia/rayleigh).
  domain->calculateNodalReactions(0);

  // ---- displacements --------------------------------------------------------
  val disp = val::array();
  for (int tag = 1; tag <= nNodes; ++tag) {
    Node *nd = domain->getNode(tag);
    const Vector &u = nd->getDisp();
    if (!std::isfinite(u(0)) || !std::isfinite(u(1)) || !std::isfinite(u(2))) {
      converged = false;
      message = "solution contains non-finite values (singular / unstable model)";
    }
    val d = val::object();
    d.set("nodeId", nodeId[tag]);
    d.set("dx", u(0));
    d.set("dy", u(1));
    d.set("rz", u(2));
    disp.call<void>("push", d);
  }
  result.set("nodalDisplacements", disp);

  // ---- reactions (only nodes with a support) --------------------------------
  std::map<int, bool> hasSupport;
  for (int i = 0; i < len(jsSupports); ++i) {
    val sp = jsSupports[i];
    const int tag = nodeTag.at(sp["nodeId"].as<std::string>());
    if (sp["dx"].as<bool>() || sp["dy"].as<bool>() || sp["rz"].as<bool>()) hasSupport[tag] = true;
  }
  val reactions = val::array();
  for (const auto &kv : hasSupport) {
    Node *nd = domain->getNode(kv.first);
    const Vector &r = nd->getReaction();
    val rr = val::object();
    rr.set("nodeId", nodeId[kv.first]);
    rr.set("fx", r(0));
    rr.set("fy", r(1));
    rr.set("mz", r(2));
    reactions.call<void>("push", rr);
  }
  result.set("reactions", reactions);

  // ---- element end forces (local) -------------------------------------------
  // ElasticBeam2d::getResistingForce() is the global 6-vector
  // [Fx_i,Fy_i,Mz_i, Fx_j,Fy_j,Mz_j]; rotate to local (N,V,M per end) with the
  // element direction cosines so the convention matches the Eigen oracle.
  val elemForces = val::array();
  for (int tag = 1; tag <= nElems; ++tag) {
    Element *el = domain->getElement(tag);
    const Vector &Pg = el->getResistingForce();
    const double dx = nodeX[elemNj[tag]] - nodeX[elemNi[tag]];
    const double dy = nodeY[elemNj[tag]] - nodeY[elemNi[tag]];
    const double L = std::sqrt(dx * dx + dy * dy);
    const double c = dx / L, s = dy / L;
    auto rotN = [c, s](double fx, double fy) { return c * fx + s * fy; };
    auto rotV = [c, s](double fx, double fy) { return -s * fx + c * fy; };

    val ef = val::object();
    ef.set("elementId", elemId[tag]);
    ef.set("iN", rotN(Pg(0), Pg(1)));
    ef.set("iV", rotV(Pg(0), Pg(1)));
    ef.set("iM", Pg(2));
    ef.set("jN", rotN(Pg(3), Pg(4)));
    ef.set("jV", rotV(Pg(3), Pg(4)));
    ef.set("jM", Pg(5));
    elemForces.call<void>("push", ef);
  }
  result.set("elementForces", elemForces);

  result.set("converged", converged);
  result.set("solver", std::string("OpenSees StaticAnalysis + ProfileSPDLinDirectSolver (pure C++)"));
  result.set("message", message);
  result.set("residual", 0.0);  // direct skyline solve; exact to round-off

  analysis.clearAll();
  domain->clearAll();
  delete domain;
  return result;
}

// Solve a linear-elastic 3D frame with OpenSees (6 DOF/node: dx,dy,dz,rx,ry,rz).
val solve3D(val model) {
  val result = val::object();
  Domain *domain = new Domain();

  // ---- nodes (6 DOF) --------------------------------------------------------
  val jsNodes = model["nodes"];
  const int nNodes = len(jsNodes);
  std::map<std::string, int> nodeTag;
  std::vector<std::string> nodeId(nNodes + 1);
  std::vector<double> nx(nNodes + 1), ny(nNodes + 1), nz(nNodes + 1);
  for (int i = 0; i < nNodes; ++i) {
    val nd = jsNodes[i];
    const std::string id = nd["id"].as<std::string>();
    const int tag = i + 1;
    nodeTag[id] = tag;
    nodeId[tag] = id;
    nx[tag] = nd["x"].as<double>();
    ny[tag] = nd["y"].as<double>();
    nz[tag] = num(nd["z"]);
    domain->addNode(new Node(tag, 6, nx[tag], ny[tag], nz[tag]));
  }

  // ---- materials (E, G) & sections (A, Iz=I, Iy, J) -------------------------
  std::map<std::string, std::pair<double, double>> matEG;  // id -> {E, G}
  val jsMats = model["materials"];
  for (int i = 0; i < len(jsMats); ++i) {
    val m = jsMats[i];
    matEG[m["id"].as<std::string>()] = {m["E"].as<double>(), m["G"].as<double>()};
  }
  struct Sec { double A, Iz, Iy, J; };
  std::map<std::string, Sec> secs;
  val jsSecs = model["sections"];
  for (int i = 0; i < len(jsSecs); ++i) {
    val s = jsSecs[i];
    secs[s["id"].as<std::string>()] =
        Sec{s["A"].as<double>(), s["I"].as<double>(), s["Iy"].as<double>(), s["J"].as<double>()};
  }

  // ---- elements (ElasticBeam3d + a per-element LinearCrdTransf3d) -----------
  val jsElems = model["elements"];
  const int nElems = len(jsElems);
  std::map<std::string, int> elemTag;
  std::vector<std::string> elemId(nElems + 1);
  for (int e = 0; e < nElems; ++e) {
    val el = jsElems[e];
    const std::string id = el["id"].as<std::string>();
    const int ni = nodeTag.at(el["nodeI"].as<std::string>());
    const int nj = nodeTag.at(el["nodeJ"].as<std::string>());
    const auto EG = matEG.at(el["materialId"].as<std::string>());
    const Sec sc = secs.at(el["sectionId"].as<std::string>());
    const int tag = e + 1;
    elemTag[id] = tag;
    elemId[tag] = id;

    // Orientation: explicit vecxz, else a non-degenerate default (a global axis
    // not aligned with the member axis), lying in the local x-z plane.
    Vector vecxz(3);
    val vraw = el["vecxz"];
    if (vraw.isUndefined() || vraw.isNull()) {
      const double Lx = nx[nj] - nx[ni], Ly = ny[nj] - ny[ni], Lz = nz[nj] - nz[ni];
      const double L = std::sqrt(Lx * Lx + Ly * Ly + Lz * Lz);
      const double uz = Lz / L;
      if (std::abs(uz) < 0.9) { vecxz(0) = 0; vecxz(1) = 0; vecxz(2) = 1; }
      else { vecxz(0) = 0; vecxz(1) = 1; vecxz(2) = 0; }
    } else {
      vecxz(0) = vraw[0].as<double>();
      vecxz(1) = vraw[1].as<double>();
      vecxz(2) = vraw[2].as<double>();
    }
    CrdTransf *transf = new LinearCrdTransf3d(tag, vecxz);
    // ElasticBeam3d(tag, A, E, G, Jx, Iy, Iz, Nd1, Nd2, transf, rho, cMass, releasez, releasey)
    const int relz = releaseCode(el["releases"], "Mzi", "Mzj");
    const int rely = releaseCode(el["releases"], "Myi", "Myj");
    domain->addElement(new ElasticBeam3d(tag, sc.A, EG.first, EG.second, sc.J, sc.Iy, sc.Iz, ni, nj,
                                         *transf, 0.0, 0, relz, rely));
  }

  // ---- supports -------------------------------------------------------------
  val jsSupports = model["supports"];
  for (int i = 0; i < len(jsSupports); ++i) {
    val sp = jsSupports[i];
    const int tag = nodeTag.at(sp["nodeId"].as<std::string>());
    if (sp["dx"].as<bool>()) domain->addSP_Constraint(new SP_Constraint(tag, 0, 0.0, true));
    if (sp["dy"].as<bool>()) domain->addSP_Constraint(new SP_Constraint(tag, 1, 0.0, true));
    if (sp["dz"].as<bool>()) domain->addSP_Constraint(new SP_Constraint(tag, 2, 0.0, true));
    if (sp["rx"].as<bool>()) domain->addSP_Constraint(new SP_Constraint(tag, 3, 0.0, true));
    if (sp["ry"].as<bool>()) domain->addSP_Constraint(new SP_Constraint(tag, 4, 0.0, true));
    if (sp["rz"].as<bool>()) domain->addSP_Constraint(new SP_Constraint(tag, 5, 0.0, true));
  }

  // ---- loads ----------------------------------------------------------------
  const int patternTag = 1;
  LoadPattern *pattern = new LoadPattern(patternTag);
  pattern->setTimeSeries(new LinearSeries());
  domain->addLoadPattern(pattern);

  int loadTag = 1;
  val jsNodalLoads = model["nodalLoads"];
  for (int i = 0; i < len(jsNodalLoads); ++i) {
    val ld = jsNodalLoads[i];
    const int tag = nodeTag.at(ld["nodeId"].as<std::string>());
    Vector f(6);
    f(0) = num(ld["fx"]);
    f(1) = num(ld["fy"]);
    f(2) = num(ld["fz"]);
    f(3) = num(ld["mx"]);
    f(4) = num(ld["my"]);
    f(5) = num(ld["mz"]);
    domain->addNodalLoad(new NodalLoad(loadTag++, tag, f), patternTag);
  }
  val jsElemLoads = model["elementLoads"];
  for (int i = 0; i < len(jsElemLoads); ++i) {
    val ld = jsElemLoads[i];
    const int et = elemTag.at(ld["elementId"].as<std::string>());
    // Beam3dUniformLoad(tag, wy, wz, wx, eleTag)
    domain->addElementalLoad(
        new Beam3dUniformLoad(loadTag++, num(ld["wy"]), num(ld["wz"]),
                              num(ld["wx"]), et),
        patternTag);
  }
  val jsPointLoads = model["elementPointLoads"];
  for (int i = 0; i < len(jsPointLoads); ++i) {
    val ld = jsPointLoads[i];
    const int et = elemTag.at(ld["elementId"].as<std::string>());
    // Beam3dPointLoad(tag, Py, Pz, aOverL, eleTag, Px)
    domain->addElementalLoad(
        new Beam3dPointLoad(loadTag++, num(ld["py"]), num(ld["pz"]),
                            num(ld["at"]), et, num(ld["px"])),
        patternTag);
  }
  val jsPartialLoads = model["elementPartialLoads"];
  for (int i = 0; i < len(jsPartialLoads); ++i) {
    val ld = jsPartialLoads[i];
    const int et = elemTag.at(ld["elementId"].as<std::string>());
    // Beam3dPartialUniformLoad(tag, wYa, wZa, wXa, aL, bL, wYb, wZb, wXb, eleTag)
    domain->addElementalLoad(
        new Beam3dPartialUniformLoad(loadTag++, num(ld["wy"]), num(ld["wz"]),
                                     num(ld["wx"]), num(ld["a"]),
                                     num(ld["b"]), num(ld["wyEnd"]),
                                     num(ld["wzEnd"]), num(ld["wxEnd"]), et),
        patternTag);
  }

  // ---- static analysis (same no-Fortran assembly as 2D) ---------------------
  AnalysisModel *theModel = new AnalysisModel();
  EquiSolnAlgo *theAlgo = new Linear();
  StaticIntegrator *theIntegrator = new LoadControl(1.0, 1, 1.0, 1.0);
  ConstraintHandler *theHandler = new PlainHandler();
  DOF_Numberer *theNumberer = new PlainNumberer();
  ProfileSPDLinSolver *theSolver = new ProfileSPDLinDirectSolver();
  LinearSOE *theSOE = new ProfileSPDLinSOE(*theSolver);
  StaticAnalysis analysis(*domain, *theHandler, *theNumberer, *theModel, *theAlgo, *theSOE,
                          *theIntegrator);

  const int analyzeResult = analysis.analyze(1);
  bool converged = (analyzeResult == 0);
  std::string message = converged ? "ok" : "StaticAnalysis.analyze() failed";
  domain->calculateNodalReactions(0);

  // ---- displacements --------------------------------------------------------
  val disp = val::array();
  for (int tag = 1; tag <= nNodes; ++tag) {
    const Vector &u = domain->getNode(tag)->getDisp();
    for (int k = 0; k < 6; ++k)
      if (!std::isfinite(u(k))) { converged = false; message = "non-finite solution (unstable model)"; }
    val d = val::object();
    d.set("nodeId", nodeId[tag]);
    d.set("dx", u(0)); d.set("dy", u(1)); d.set("dz", u(2));
    d.set("rx", u(3)); d.set("ry", u(4)); d.set("rz", u(5));
    disp.call<void>("push", d);
  }
  result.set("nodalDisplacements", disp);

  // ---- reactions ------------------------------------------------------------
  std::map<int, bool> hasSupport;
  for (int i = 0; i < len(jsSupports); ++i) {
    val sp = jsSupports[i];
    const int tag = nodeTag.at(sp["nodeId"].as<std::string>());
    if (sp["dx"].as<bool>() || sp["dy"].as<bool>() || sp["dz"].as<bool>() ||
        sp["rx"].as<bool>() || sp["ry"].as<bool>() || sp["rz"].as<bool>())
      hasSupport[tag] = true;
  }
  val reactions = val::array();
  for (const auto &kv : hasSupport) {
    const Vector &r = domain->getNode(kv.first)->getReaction();
    val rr = val::object();
    rr.set("nodeId", nodeId[kv.first]);
    rr.set("fx", r(0)); rr.set("fy", r(1)); rr.set("fz", r(2));
    rr.set("mx", r(3)); rr.set("my", r(4)); rr.set("mz", r(5));
    reactions.call<void>("push", rr);
  }
  result.set("reactions", reactions);

  // ---- element end forces (local) via OpenSees "localForce" response --------
  // ordering: N1,Vy1,Vz1,T1,My1,Mz1, N2,Vy2,Vz2,T2,My2,Mz2
  val elemForces = val::array();
  for (int tag = 1; tag <= nElems; ++tag) {
    Element *el = domain->getElement(tag);
    val ef = val::object();
    ef.set("elementId", elemId[tag]);
    const char *argv1[1] = {"localForce"};
    Response *resp = el->setResponse(argv1, 1, sserr);
    if (resp) {
      resp->getResponse();
      const Vector &lf = resp->getInformation().getData();
      ef.set("iN", lf(0)); ef.set("iV", lf(1)); ef.set("iVz", lf(2));
      ef.set("iT", lf(3)); ef.set("iMy", lf(4)); ef.set("iM", lf(5));
      ef.set("jN", lf(6)); ef.set("jV", lf(7)); ef.set("jVz", lf(8));
      ef.set("jT", lf(9)); ef.set("jMy", lf(10)); ef.set("jM", lf(11));
      delete resp;
    }
    elemForces.call<void>("push", ef);
  }
  result.set("elementForces", elemForces);

  result.set("converged", converged);
  result.set("solver", std::string("OpenSees StaticAnalysis + ProfileSPDLinDirectSolver (pure C++)"));
  result.set("message", message);
  result.set("residual", 0.0);

  analysis.clearAll();
  domain->clearAll();
  delete domain;
  return result;
}

// ===========================================================================
// Fiber-section moment–curvature
// ===========================================================================

// Devalapura–Tadros / PCI power-formula stress-strain, matching the TS design
// engine (steelPresets). Monotonic nonlinear-elastic backbone:
//   fs(e) = Es·e · [ Q + (1-Q) / (1 + (|Es·e|/(K·fpy))^R)^(1/R) ],  |fs| ≤ cap.
// Path-independent (no hysteresis) — adequate for a monotonic curvature sweep.
// Built directly (never via an OPS_ factory), so it needs no interpreter glue.
class PowerFormulaStrand : public UniaxialMaterial {
 public:
  PowerFormulaStrand(int tag, double Es_, double fpy_, double Q_, double K_, double R_, double cap_)
      : UniaxialMaterial(tag, 0), Es(Es_), fpy(fpy_), Q(Q_), K(K_), R(R_), cap(cap_),
        eT(0.0), eC(0.0) {}
  PowerFormulaStrand() : UniaxialMaterial(0, 0), Es(0), fpy(1), Q(0), K(1), R(1), cap(0), eT(0), eC(0) {}

  int setTrialStrain(double strain, double = 0.0) override { eT = strain; return 0; }
  int setTrial(double strain, double &stress, double &tangent, double = 0.0) override {
    eT = strain;
    stress = stressFor(eT);
    tangent = tangentFor(eT);
    return 0;
  }
  double getStrain(void) override { return eT; }
  double getStress(void) override { return stressFor(eT); }
  double getTangent(void) override { return tangentFor(eT); }
  double getInitialTangent(void) override { return Es; }
  int commitState(void) override { eC = eT; return 0; }
  int revertToLastCommit(void) override { eT = eC; return 0; }
  int revertToStart(void) override { eT = eC = 0.0; return 0; }
  UniaxialMaterial *getCopy(void) override {
    PowerFormulaStrand *c = new PowerFormulaStrand(this->getTag(), Es, fpy, Q, K, R, cap);
    c->eT = eT; c->eC = eC;
    return c;
  }
  int sendSelf(int, Channel &) override { return -1; }
  int recvSelf(int, Channel &, FEM_ObjectBroker &) override { return -1; }
  void Print(OPS_Stream &s, int) override { s << "PowerFormulaStrand " << this->getTag() << "\n"; }

 private:
  double Es, fpy, Q, K, R, cap;
  double eT, eC;  // trial / committed strain

  double stressFor(double e) const {
    const double a = Es * e;
    if (a == 0.0) return 0.0;
    const double t = std::fabs(a) / (K * fpy);
    const double denom = std::pow(1.0 + std::pow(t, R), 1.0 / R);
    double fs = a * (Q + (1.0 - Q) / denom);
    if (fs > cap) fs = cap;
    else if (fs < -cap) fs = -cap;
    return fs;
  }
  double tangentFor(double e) const {
    if (std::fabs(stressFor(e)) >= cap - 1e-12) return 1e-6 * Es;  // capped → ~flat
    const double a = Es * e;
    const double Kfpy = K * fpy;
    const double t = std::fabs(a) / Kfpy;
    const double base = 1.0 + std::pow(t, R);
    const double denom = std::pow(base, 1.0 / R);
    double dfs = Es * (Q + (1.0 - Q) / denom);
    if (t > 0.0) {
      const double dbase = R * std::pow(t, R - 1.0) * (Es / Kfpy) * (a >= 0 ? 1.0 : -1.0);
      const double ddenom = (1.0 / R) * std::pow(base, 1.0 / R - 1.0) * dbase;
      dfs += a * (1.0 - Q) * (-1.0 / (denom * denom)) * ddenom;
    }
    return dfs;
  }
};

// Build a 2D fiber section from a flat spec and trace its moment–curvature curve
// by sweeping curvature and, at each step, Newton-solving the section axial
// strain so the net axial force equals the target (prestress is carried as a
// strand pre-strain). Uses the REAL OpenSees FiberSection2d + materials — only
// the section-level equilibrium loop is hand-rolled (no Domain/analysis stack).
//
// Fiber positions are passed as depth-from-top; with the FiberSection2d
// convention this makes positive curvature = sagging and M > 0 = sagging,
// matching the TS engine.
val momentCurvature(val spec) {
  val result = val::object();
  val pts = val::array();

  // ---- section geometry -----------------------------------------------------
  // Two forms: an explicit concrete-fiber list `concreteFibers` (general section
  // geometry — each {y: depth-from-top, area}), or a rectangular b×h section
  // discretized into `concreteLayers` layers. `h` (total depth) is always given
  // and is the reference for both concrete fibers and reinforcement.
  val sec = spec["section"];
  const double b = num(sec["b"]);
  const double h = num(sec["h"]);
  const int nLayers = static_cast<int>(num(sec["concreteLayers"], 40));
  val jsFibers = spec["concreteFibers"];
  const int nExplicit = len(jsFibers);
  const int nConcrete = nExplicit > 0 ? nExplicit : nLayers;

  // ---- concrete (Concrete02) ------------------------------------------------
  val con = spec["concrete"];
  const double fc = std::fabs(num(con["fc"]));  // +ksi compressive strength
  const double Ec = num(con["Ec"], 57000.0 * std::sqrt(fc * 1000.0) / 1000.0);
  const double epsc0 = num(con["epsc0"], -2.0 * fc / Ec);  // strain at fc (neg)
  const double fcu = num(con["fcu"], -0.2 * fc);           // residual (neg)
  const double epscu = num(con["epscu"], -0.003);          // ultimate (neg)
  const double ratio = num(con["ratio"], 0.1);             // unload/reload slope ratio
  const double ft = num(con["ft"], 7.5 * std::sqrt(fc * 1000.0) / 1000.0);  // +ksi
  const double Ets = num(con["Ets"], ft / 0.002);
  Concrete02 conTmpl(1, -fc, epsc0, fcu, epscu, ratio, ft, Ets);

  const int nSteel = len(spec["steel"]);
  const int nStrand = len(spec["strands"]);
  FiberSection2d *section = new FiberSection2d(1, nConcrete + nSteel + nStrand, true);

  // Fiber positions are passed measured UPWARD from mid-height, yUp = h/2 − depth
  // (depth = distance from the top fiber). With FiberSection2d's internal
  // convention this makes positive curvature = sagging and M > 0 = sagging,
  // matching the TS design engine. All fibers (concrete + reinforcement) share
  // this reference so the geometry is consistent.
  int fiberTag = 1;
  if (nExplicit > 0) {
    for (int i = 0; i < nExplicit; ++i) {
      val f = jsFibers[i];
      UniaxialFiber2d fib(fiberTag++, conTmpl, num(f["area"]), h * 0.5 - num(f["y"]));
      section->addFiber(fib);
    }
  } else {
    const double dy = h / nLayers;
    for (int i = 0; i < nLayers; ++i) {
      const double depth = (i + 0.5) * dy;  // from the top fiber
      UniaxialFiber2d fib(fiberTag++, conTmpl, b * dy, h * 0.5 - depth);
      section->addFiber(fib);
    }
  }

  // ---- mild-steel layers (ElasticPP) ----------------------------------------
  val steels = spec["steel"];
  for (int i = 0; i < nSteel; ++i) {
    val s = steels[i];
    const double Es = num(s["Es"], 29000.0);
    const double fy = num(s["fy"]);
    ElasticPPMaterial steelTmpl(100 + i, Es, fy / Es);
    UniaxialFiber2d fib(fiberTag++, steelTmpl, num(s["As"]), h * 0.5 - num(s["d"]));
    section->addFiber(fib);
  }

  // ---- prestressing strand layers (power formula + InitStrain prestrain) ----
  val strands = spec["strands"];
  for (int i = 0; i < nStrand; ++i) {
    val s = strands[i];
    const double Eps = num(s["Eps"], 28500.0);
    const double fpy = num(s["fpy"], 243.0);
    const double fpu = num(s["fpu"], 270.0);
    const double Q = num(s["Q"], 0.0);
    const double K = num(s["K"], 1.04);
    const double R = num(s["R"], 7.36);
    const double fse = num(s["fse"], 0.0);  // effective prestress (ksi)
    PowerFormulaStrand strandTmpl(200 + i, Eps, fpy, Q, K, R, fpu);
    InitStrainMaterial pretensioned(300 + i, strandTmpl, fse / Eps);
    UniaxialFiber2d fib(fiberTag++, pretensioned, num(s["Aps"]), h * 0.5 - num(s["d"]));
    section->addFiber(fib);
  }

  // ---- curvature sweep with a section-level axial-equilibrium Newton --------
  const double targetN = num(spec["axial"], 0.0);
  const int steps = static_cast<int>(num(spec["steps"], 80));
  const double maxKappa = num(spec["maxKappa"], 3.0e-3);
  const double dKappa = steps > 0 ? maxKappa / steps : 0.0;
  const double tolN = 1e-6 * (b * h * fc + 1.0);

  section->revertToStart();
  Vector e(2);
  double eps = 0.0;
  double peakM = 0.0;
  bool converged = true;
  std::string message = "ok";

  for (int step = 0; step <= steps; ++step) {
    const double kappa = step * dKappa;
    bool ok = false;
    for (int it = 0; it < 50; ++it) {
      e(0) = eps;
      e(1) = kappa;
      section->setTrialSectionDeformation(e);
      const double resN = section->getStressResultant()(0) - targetN;
      if (!std::isfinite(resN)) break;
      if (std::fabs(resN) < tolN) { ok = true; break; }
      const double dNde = section->getSectionTangent()(0, 0);
      if (!std::isfinite(dNde) || std::fabs(dNde) < 1e-12) break;
      eps -= resN / dNde;
    }
    if (!ok) {
      converged = (step > 0);  // failure at step>0 = capacity reached (acceptable)
      message = step == 0 ? "axial equilibrium failed at zero curvature"
                          : "section reached ultimate before maxKappa";
      break;
    }
    e(0) = eps;
    e(1) = kappa;
    section->setTrialSectionDeformation(e);
    const double M = section->getStressResultant()(1);
    if (!std::isfinite(M)) { converged = (step > 0); message = "non-finite moment"; break; }
    section->commitState();
    if (std::fabs(M) > std::fabs(peakM)) peakM = M;
    val p = val::object();
    p.set("kappa", kappa);
    p.set("M", M);
    p.set("eps", eps);
    pts.call<void>("push", p);
  }

  result.set("points", pts);
  result.set("peakMoment", peakM);
  result.set("converged", converged);
  result.set("message", message);
  result.set("solver", std::string("OpenSees FiberSection2d moment–curvature (pure C++)"));

  delete section;
  return result;
}

// Dispatcher: 2D (3 DOF/node) or 3D (6 DOF/node) per model.dimension.
val solve(val model) {
  val dim = model["dimension"];
  const int d = (dim.isUndefined() || dim.isNull()) ? 2 : dim.as<int>();
  return d == 3 ? solve3D(model) : solve2D(model);
}

EMSCRIPTEN_BINDINGS(tessera_fea_opensees) {
  emscripten::function("solve", &solve);
  emscripten::function("momentCurvature", &momentCurvature);
}
