// Tessera FEA spike — minimal linear-elastic 2D frame solver.
//
// Phase 3 go/no-go spike (build spec §2.2). This is a deliberately small,
// self-contained direct-stiffness solver compiled to WebAssembly with
// Emscripten. Its sole job is to prove the toolchain + architecture end to end
// and to answer the Fortran-elimination gate: the only linear-algebra
// dependency here is **Eigen** (vendored at OTHER/eigenAPI/eigen), a
// header-only C++ template library with ZERO Fortran / LAPACK / ARPACK / MUMPS.
//
// The element formulation is the classic 2-node, 3-DOF/node elastic
// beam-column (axial + Euler-Bernoulli flexure) with a linear coordinate
// transform — i.e. the same physics as OpenSees `elasticBeamColumn` +
// `LinearCrdTransf2d`, so the result transfers if the full engine later carves
// an OpenSees subset.
//
// ABI: a flat model description in (per spec §2.2 "builds a model from a flat
// description"), results out, marshalled as plain JS objects via embind /
// emscripten::val. The JSON contract lives at the TypeScript `FeaEngine`
// boundary; this layer speaks structured values for speed and simplicity.
//
// Units (consistent, US customary): length in, force kip, stress/modulus ksi,
// area in^2, moment of inertia in^4, moment kip-in, distributed load kip/in.

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <Eigen/Dense>

#include <cmath>
#include <limits>
#include <map>
#include <string>
#include <vector>

using emscripten::val;

namespace {

// ----- flat model structs (filled from the incoming JS object) ----------------
struct Node {
  std::string id;
  double x = 0.0;
  double y = 0.0;
};
struct Material {
  double E = 0.0;  // Young's modulus (ksi)
};
struct SectionProps {
  double A = 0.0;  // area (in^2)
  double I = 0.0;  // moment of inertia about bending axis (in^4)
};
struct Element {
  std::string id;
  int ni = 0;       // node-index of end I
  int nj = 0;       // node-index of end J
  double E = 0.0;
  double A = 0.0;
  double I = 0.0;
};
struct Support {
  int node = 0;
  bool dx = false;
  bool dy = false;
  bool rz = false;
};
struct NodalLoad {
  int node = 0;
  double fx = 0.0;
  double fy = 0.0;
  double mz = 0.0;
};
struct ElementLoad {
  int elem = 0;
  double wy = 0.0;  // uniform load along the element in the LOCAL y (transverse) direction
};

int len(const val& arr) { return arr["length"].as<int>(); }

// 6x6 local elastic beam-column stiffness (DOF order: u_i, v_i, th_i, u_j, v_j, th_j).
Eigen::Matrix<double, 6, 6> localStiffness(double E, double A, double I, double L) {
  Eigen::Matrix<double, 6, 6> k = Eigen::Matrix<double, 6, 6>::Zero();
  const double ea = E * A / L;
  const double ei = E * I;
  const double L2 = L * L;
  const double L3 = L2 * L;

  k(0, 0) = ea;   k(0, 3) = -ea;
  k(3, 0) = -ea;  k(3, 3) = ea;

  k(1, 1) = 12 * ei / L3;  k(1, 2) = 6 * ei / L2;   k(1, 4) = -12 * ei / L3; k(1, 5) = 6 * ei / L2;
  k(2, 1) = 6 * ei / L2;   k(2, 2) = 4 * ei / L;    k(2, 4) = -6 * ei / L2;  k(2, 5) = 2 * ei / L;
  k(4, 1) = -12 * ei / L3; k(4, 2) = -6 * ei / L2;  k(4, 4) = 12 * ei / L3;  k(4, 5) = -6 * ei / L2;
  k(5, 1) = 6 * ei / L2;   k(5, 2) = 2 * ei / L;    k(5, 4) = -6 * ei / L2;  k(5, 5) = 4 * ei / L;
  return k;
}

// Global<-local transform T (local = T * global) for direction cosines c, s.
Eigen::Matrix<double, 6, 6> transform(double c, double s) {
  Eigen::Matrix<double, 6, 6> T = Eigen::Matrix<double, 6, 6>::Zero();
  T(0, 0) = c;  T(0, 1) = s;
  T(1, 0) = -s; T(1, 1) = c;
  T(2, 2) = 1;
  T(3, 3) = c;  T(3, 4) = s;
  T(4, 3) = -s; T(4, 4) = c;
  T(5, 5) = 1;
  return T;
}

// Consistent (work-equivalent) nodal load vector in LOCAL coords for a uniform
// transverse load wy over the element: integral of N^T * wy dx.
Eigen::Matrix<double, 6, 1> consistentLoad(double wy, double L) {
  Eigen::Matrix<double, 6, 1> f = Eigen::Matrix<double, 6, 1>::Zero();
  f(1) = wy * L / 2.0;
  f(2) = wy * L * L / 12.0;
  f(4) = wy * L / 2.0;
  f(5) = -wy * L * L / 12.0;
  return f;
}

}  // namespace

// Solve a linear-elastic 2D frame. `model` is a plain JS object (see the
// TypeScript FeaModel schema); returns a plain JS results object.
val solve(val model) {
  val result = val::object();

  // ---- parse nodes ----------------------------------------------------------
  val jsNodes = model["nodes"];
  const int nNodes = len(jsNodes);
  std::vector<Node> nodes(nNodes);
  std::map<std::string, int> nodeIndex;
  for (int i = 0; i < nNodes; ++i) {
    val nd = jsNodes[i];
    nodes[i].id = nd["id"].as<std::string>();
    nodes[i].x = nd["x"].as<double>();
    nodes[i].y = nd["y"].as<double>();
    nodeIndex[nodes[i].id] = i;
  }

  // ---- materials & sections (id -> props) -----------------------------------
  std::map<std::string, Material> materials;
  val jsMats = model["materials"];
  for (int i = 0; i < len(jsMats); ++i) {
    val m = jsMats[i];
    materials[m["id"].as<std::string>()] = Material{m["E"].as<double>()};
  }
  std::map<std::string, SectionProps> sections;
  val jsSecs = model["sections"];
  for (int i = 0; i < len(jsSecs); ++i) {
    val s = jsSecs[i];
    sections[s["id"].as<std::string>()] = SectionProps{s["A"].as<double>(), s["I"].as<double>()};
  }

  // ---- elements -------------------------------------------------------------
  val jsElems = model["elements"];
  const int nElems = len(jsElems);
  std::vector<Element> elements(nElems);
  std::map<std::string, int> elemIndex;
  for (int e = 0; e < nElems; ++e) {
    val el = jsElems[e];
    elements[e].id = el["id"].as<std::string>();
    elements[e].ni = nodeIndex.at(el["nodeI"].as<std::string>());
    elements[e].nj = nodeIndex.at(el["nodeJ"].as<std::string>());
    const Material& mat = materials.at(el["materialId"].as<std::string>());
    const SectionProps& sec = sections.at(el["sectionId"].as<std::string>());
    elements[e].E = mat.E;
    elements[e].A = sec.A;
    elements[e].I = sec.I;
    elemIndex[elements[e].id] = e;
  }

  const int nDof = 3 * nNodes;
  Eigen::MatrixXd K = Eigen::MatrixXd::Zero(nDof, nDof);
  Eigen::VectorXd F = Eigen::VectorXd::Zero(nDof);

  // ---- assemble element stiffness & equivalent element loads ----------------
  auto dofMap = [](int nodeIdx, std::array<int, 6>& dofs, int otherNode) {
    dofs[0] = 3 * nodeIdx;     dofs[1] = 3 * nodeIdx + 1;     dofs[2] = 3 * nodeIdx + 2;
    dofs[3] = 3 * otherNode;   dofs[4] = 3 * otherNode + 1;   dofs[5] = 3 * otherNode + 2;
  };

  // Cache per-element geometry/transform so we can recover end forces later.
  struct ElemKinematics {
    double L, c, s;
    Eigen::Matrix<double, 6, 6> kl, T;
    Eigen::Matrix<double, 6, 1> feq;  // consistent local load (accumulated)
    std::array<int, 6> dofs;
  };
  std::vector<ElemKinematics> kin(nElems);

  for (int e = 0; e < nElems; ++e) {
    const Element& el = elements[e];
    const double dx = nodes[el.nj].x - nodes[el.ni].x;
    const double dy = nodes[el.nj].y - nodes[el.ni].y;
    const double L = std::sqrt(dx * dx + dy * dy);
    const double c = dx / L;
    const double s = dy / L;

    Eigen::Matrix<double, 6, 6> kl = localStiffness(el.E, el.A, el.I, L);
    Eigen::Matrix<double, 6, 6> T = transform(c, s);
    Eigen::Matrix<double, 6, 6> kg = T.transpose() * kl * T;

    std::array<int, 6> dofs;
    dofMap(el.ni, dofs, el.nj);

    for (int a = 0; a < 6; ++a)
      for (int b = 0; b < 6; ++b) K(dofs[a], dofs[b]) += kg(a, b);

    kin[e] = ElemKinematics{L, c, s, kl, T, Eigen::Matrix<double, 6, 1>::Zero(), dofs};
  }

  // ---- element (distributed) loads ------------------------------------------
  val jsElemLoads = model["elementLoads"];
  for (int i = 0; i < len(jsElemLoads); ++i) {
    val ld = jsElemLoads[i];
    const int e = elemIndex.at(ld["elementId"].as<std::string>());
    const double wy = ld["wy"].as<double>();
    Eigen::Matrix<double, 6, 1> feqL = consistentLoad(wy, kin[e].L);
    kin[e].feq += feqL;
    // Equivalent nodal loads added to the global force vector (global = T^T * local).
    Eigen::Matrix<double, 6, 1> feqG = kin[e].T.transpose() * feqL;
    for (int a = 0; a < 6; ++a) F(kin[e].dofs[a]) += feqG(a);
  }

  // ---- nodal loads ----------------------------------------------------------
  val jsNodalLoads = model["nodalLoads"];
  for (int i = 0; i < len(jsNodalLoads); ++i) {
    val ld = jsNodalLoads[i];
    const int n = nodeIndex.at(ld["nodeId"].as<std::string>());
    F(3 * n) += ld["fx"].as<double>();
    F(3 * n + 1) += ld["fy"].as<double>();
    F(3 * n + 2) += ld["mz"].as<double>();
  }

  // ---- supports (homogeneous fixities to ground) ----------------------------
  std::vector<bool> fixed(nDof, false);
  val jsSupports = model["supports"];
  for (int i = 0; i < len(jsSupports); ++i) {
    val sp = jsSupports[i];
    const int n = nodeIndex.at(sp["nodeId"].as<std::string>());
    if (sp["dx"].as<bool>()) fixed[3 * n] = true;
    if (sp["dy"].as<bool>()) fixed[3 * n + 1] = true;
    if (sp["rz"].as<bool>()) fixed[3 * n + 2] = true;
  }

  // Partition into free DOFs.
  std::vector<int> freeDofs;
  freeDofs.reserve(nDof);
  for (int d = 0; d < nDof; ++d)
    if (!fixed[d]) freeDofs.push_back(d);
  const int nFree = static_cast<int>(freeDofs.size());

  bool converged = true;
  std::string message = "ok";
  std::string solverName = "Eigen LDLT (dense, symmetric positive-definite)";

  Eigen::VectorXd D = Eigen::VectorXd::Zero(nDof);
  double residual = 0.0;

  if (nFree == 0) {
    message = "no free DOFs (fully restrained)";
  } else {
    Eigen::MatrixXd Kff(nFree, nFree);
    Eigen::VectorXd Ff(nFree);
    for (int a = 0; a < nFree; ++a) {
      Ff(a) = F(freeDofs[a]);
      for (int b = 0; b < nFree; ++b) Kff(a, b) = K(freeDofs[a], freeDofs[b]);
    }

    Eigen::LDLT<Eigen::MatrixXd> ldlt(Kff);
    if (ldlt.info() != Eigen::Success) {
      converged = false;
      message = "LDLT factorization failed (matrix not positive-definite / unstable model)";
    } else {
      // Detect a near-singular system (under-restrained model / mechanism /
      // rigid-body mode): a zero pivot in the D factor. Eigen's LDLT will
      // happily pivot through a singular matrix and report Success, so this
      // explicit check is what surfaces an unstable model as non-convergence
      // (spec §13 — non-convergence is reported, never hidden).
      Eigen::VectorXd d = ldlt.vectorD();
      double maxAbs = 0.0, minAbs = std::numeric_limits<double>::infinity();
      for (int a = 0; a < nFree; ++a) {
        const double v = std::abs(d(a));
        if (v > maxAbs) maxAbs = v;
        if (v < minAbs) minAbs = v;
      }
      const double pivotRatio = maxAbs > 0 ? minAbs / maxAbs : 0.0;

      Eigen::VectorXd df = ldlt.solve(Ff);
      // Relative residual ||K df - Ff|| / ||Ff|| as the convergence metric.
      const double rhsNorm = Ff.norm();
      residual = (Kff * df - Ff).norm() / (rhsNorm > 0 ? rhsNorm : 1.0);

      if (pivotRatio < 1e-12) {
        converged = false;
        message = "singular stiffness (zero pivot) — model is under-restrained or has a mechanism";
      } else if (!df.allFinite()) {
        converged = false;
        message = "solution contains non-finite values (singular / unstable model)";
      } else if (residual > 1e-6) {
        converged = false;
        message = "linear solve did not converge (residual exceeds tolerance)";
      }
      for (int a = 0; a < nFree; ++a) D(freeDofs[a]) = df(a);
    }
  }

  // ---- reactions: R = K*D - F, reported at constrained DOFs -----------------
  Eigen::VectorXd R = K * D - F;

  // ---- assemble result -------------------------------------------------------
  result.set("converged", converged);
  result.set("solver", solverName);
  result.set("message", message);
  result.set("residual", residual);

  val disp = val::array();
  for (int i = 0; i < nNodes; ++i) {
    val d = val::object();
    d.set("nodeId", nodes[i].id);
    d.set("dx", D(3 * i));
    d.set("dy", D(3 * i + 1));
    d.set("rz", D(3 * i + 2));
    disp.call<void>("push", d);
  }
  result.set("nodalDisplacements", disp);

  val reactions = val::array();
  for (int i = 0; i < nNodes; ++i) {
    const bool any = fixed[3 * i] || fixed[3 * i + 1] || fixed[3 * i + 2];
    if (!any) continue;
    val rr = val::object();
    rr.set("nodeId", nodes[i].id);
    rr.set("fx", fixed[3 * i] ? R(3 * i) : 0.0);
    rr.set("fy", fixed[3 * i + 1] ? R(3 * i + 1) : 0.0);
    rr.set("mz", fixed[3 * i + 2] ? R(3 * i + 2) : 0.0);
    reactions.call<void>("push", rr);
  }
  result.set("reactions", reactions);

  // ---- element end forces (local): p = k_l * u_l - f_eq_local ---------------
  val elemForces = val::array();
  for (int e = 0; e < nElems; ++e) {
    Eigen::Matrix<double, 6, 1> ug;
    for (int a = 0; a < 6; ++a) ug(a) = D(kin[e].dofs[a]);
    Eigen::Matrix<double, 6, 1> ul = kin[e].T * ug;
    Eigen::Matrix<double, 6, 1> pl = kin[e].kl * ul - kin[e].feq;

    val ef = val::object();
    ef.set("elementId", elements[e].id);
    // Local end forces. Axial (N), shear (V), moment (M) at each end.
    ef.set("iN", pl(0));
    ef.set("iV", pl(1));
    ef.set("iM", pl(2));
    ef.set("jN", pl(3));
    ef.set("jV", pl(4));
    ef.set("jM", pl(5));
    elemForces.call<void>("push", ef);
  }
  result.set("elementForces", elemForces);

  return result;
}

EMSCRIPTEN_BINDINGS(tessera_fea) {
  emscripten::function("solve", &solve);
}
