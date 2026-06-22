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
#include <Vector.h>

#include <ElasticBeam2d.h>
#include <LinearCrdTransf2d.h>

#include <StaticAnalysis.h>
#include <AnalysisModel.h>
#include <Linear.h>
#include <PlainHandler.h>
#include <PlainNumberer.h>
#include <LoadControl.h>
#include <ProfileSPDLinSOE.h>
#include <ProfileSPDLinDirectSolver.h>

using emscripten::val;

// Global stream singletons required by OPS_Globals.h (see EXAMPLES/Example1).
StandardStream sserr;
OPS_Stream *opserrPtr = &sserr;

// Material-print hooks referenced only by Domain::Print (never invoked by this
// driver); stubbed so we don't link the whole material subsystem.
void OPS_printUniaxialMaterial(OPS_Stream &, int) {}
void OPS_printNDMaterial(OPS_Stream &, int) {}
void OPS_printSectionForceDeformation(OPS_Stream &, int) {}

namespace {
int len(const val &arr) { return arr["length"].as<int>(); }
}  // namespace

// Solve a linear-elastic 2D frame with OpenSees. `model` is a plain JS object
// (the TypeScript FeaModel); returns a plain JS results object.
val solve(val model) {
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
    domain->addElement(new ElasticBeam2d(tag, AI.first, E, AI.second, ni, nj, *transf));
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
    f(0) = ld["fx"].as<double>();
    f(1) = ld["fy"].as<double>();
    f(2) = ld["mz"].as<double>();
    domain->addNodalLoad(new NodalLoad(loadTag++, tag, f), patternTag);
  }

  val jsElemLoads = model["elementLoads"];
  for (int i = 0; i < len(jsElemLoads); ++i) {
    val ld = jsElemLoads[i];
    const int et = elemTag.at(ld["elementId"].as<std::string>());
    const double wy = ld["wy"].as<double>();  // local transverse uniform load
    // Beam2dUniformLoad(tag, wTrans, wAxial, eleTag)
    domain->addElementalLoad(new Beam2dUniformLoad(loadTag++, wy, 0.0, et), patternTag);
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

EMSCRIPTEN_BINDINGS(tessera_fea_opensees) {
  emscripten::function("solve", &solve);
}
