#!/usr/bin/env bash
# Build the Tessera FEA OpenSees-subset driver to WebAssembly (Phase 3 Option B).
#
# Compiles a minimal subset of OpenSees (this fork's SRC/) plus the embind
# driver to WASM with Emscripten. The subset has NO Fortran/LAPACK/external
# deps (see docs/PHASE3_SPIKE.md). Sources are compiled incrementally to object
# files under a cache dir so iterating on link errors is fast.
#
# Prereq: Emscripten SDK activated (em++ on PATH).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"        # tessera/fea/opensees
TESSERA_DIR="$(cd "$HERE/../.." && pwd)"                     # tessera
REPO_ROOT="$(cd "$TESSERA_DIR/.." && pwd)"                  # OpenSees fork root
SRC="$REPO_ROOT/SRC"
OUT_DIR="${OUT_DIR:-$TESSERA_DIR/public/fea}"
OBJ_DIR="${OBJ_DIR:-$HERE/.objcache}"

if ! command -v em++ >/dev/null 2>&1; then
  echo "ERROR: em++ not on PATH. Activate the Emscripten SDK first." >&2
  exit 1
fi

mkdir -p "$OUT_DIR" "$OBJ_DIR"

# Comprehensive include path: every directory under SRC that holds headers.
# Harmless — only the headers our compiled units actually #include get parsed.
INCLUDES=()
while IFS= read -r d; do INCLUDES+=("-I$d"); done < <(find "$SRC" -type d)

CXXFLAGS=(-O2 -std=c++17 -D_LINUX -DNO_PARALLEL "${INCLUDES[@]}")

# Minimal OpenSees subset for a linear-elastic 2D-frame static analysis.
# Paths are relative to SRC/. Extend as the linker reports missing symbols.
SOURCES=(
  # matrix core
  matrix/Matrix.cpp matrix/Vector.cpp matrix/ID.cpp
  # tagged-object storage
  tagged/TaggedObject.cpp
  tagged/storage/MapOfTaggedObjects.cpp tagged/storage/MapOfTaggedObjectsIter.cpp
  tagged/storage/ArrayOfTaggedObjects.cpp tagged/storage/ArrayOfTaggedObjectsIter.cpp
  # actor / serialization bases
  actor/actor/MovableObject.cpp actor/channel/Channel.cpp
  actor/objectBroker/FEM_ObjectBroker.cpp
  # domain component + domain container (+ single-domain iterators)
  domain/component/DomainComponent.cpp
  domain/domain/Domain.cpp
  domain/domain/single/SingleDomAllSP_Iter.cpp domain/domain/single/SingleDomEQ_Iter.cpp
  domain/domain/single/SingleDomEleIter.cpp
  domain/domain/single/SingleDomMP_Iter.cpp domain/domain/single/SingleDomNodIter.cpp
  domain/domain/single/SingleDomPC_Iter.cpp domain/domain/single/SingleDomParamIter.cpp
  domain/domain/single/SingleDomSP_Iter.cpp
  # node + nodal load
  domain/node/Node.cpp domain/node/NodalLoad.cpp
  # constraints
  domain/constraints/SP_Constraint.cpp domain/constraints/MP_Constraint.cpp
  # patterns / time series / loads
  domain/pattern/LoadPattern.cpp domain/pattern/LoadPatternIter.cpp
  domain/pattern/TimeSeries.cpp domain/pattern/LinearSeries.cpp
  domain/load/Load.cpp element/ElementalLoad.cpp domain/load/Beam2dUniformLoad.cpp
  domain/load/NodalLoadIter.cpp domain/load/ElementalLoadIter.cpp
  # element + transform (2D and 3D)
  element/Element.cpp element/Information.cpp
  element/elasticBeamColumn/ElasticBeam2d.cpp element/elasticBeamColumn/ElasticBeam3d.cpp
  coordTransformation/CrdTransf.cpp
  coordTransformation/LinearCrdTransf2d.cpp coordTransformation/LinearCrdTransf3d.cpp
  domain/load/Beam3dUniformLoad.cpp
  domain/load/Beam2dPointLoad.cpp domain/load/Beam3dPointLoad.cpp
  domain/load/Beam2dPartialUniformLoad.cpp domain/load/Beam3dPartialUniformLoad.cpp
  recorder/response/CrdTransfResponse.cpp
  # subdomain (referenced by FE_Element under dead isSubdomain() guards)
  domain/subdomain/Subdomain.cpp
  # analysis machinery
  analysis/analysis/Analysis.cpp analysis/analysis/StaticAnalysis.cpp
  analysis/model/AnalysisModel.cpp analysis/model/FE_EleIter.cpp analysis/model/DOF_GrpIter.cpp
  analysis/integrator/Integrator.cpp analysis/integrator/IncrementalIntegrator.cpp
  analysis/integrator/StaticIntegrator.cpp analysis/integrator/LoadControl.cpp
  analysis/algorithm/SolutionAlgorithm.cpp
  analysis/algorithm/equiSolnAlgo/EquiSolnAlgo.cpp analysis/algorithm/equiSolnAlgo/Linear.cpp
  analysis/handler/ConstraintHandler.cpp analysis/handler/PlainHandler.cpp
  analysis/numberer/DOF_Numberer.cpp analysis/numberer/PlainNumberer.cpp
  analysis/fe_ele/FE_Element.cpp analysis/dof_grp/DOF_Group.cpp
  convergenceTest/ConvergenceTest.cpp
  # system of equations
  system_of_eqn/SystemOfEqn.cpp
  system_of_eqn/linearSOE/LinearSOE.cpp system_of_eqn/linearSOE/LinearSOESolver.cpp
  system_of_eqn/linearSOE/profileSPD/ProfileSPDLinSOE.cpp
  system_of_eqn/linearSOE/profileSPD/ProfileSPDLinSolver.cpp
  system_of_eqn/linearSOE/profileSPD/ProfileSPDLinDirectSolver.cpp
  # graph (profile sizing)
  graph/graph/Graph.cpp graph/graph/Vertex.cpp graph/graph/ArrayVertexIter.cpp
  graph/graph/VertexIter.cpp graph/numberer/GraphNumberer.cpp
  # output streams
  handler/OPS_Stream.cpp handler/StandardStream.cpp handler/DummyStream.cpp
  # response
  recorder/response/Response.cpp recorder/response/ElementResponse.cpp
  # ---- fiber-section moment–curvature (Phase 3 nonlinear capacity) ----------
  # Material/section base classes, the fiber section + 2D fiber, and the
  # concrete/steel materials the driver builds directly. The OPS_* interpreter
  # factories these files carry are unreachable from solve()/momentCurvature()
  # and get GC-stripped by wasm-ld (same as the elastic element files above).
  material/Material.cpp
  material/uniaxial/UniaxialMaterial.cpp
  material/uniaxial/Concrete02.cpp
  material/uniaxial/ElasticPPMaterial.cpp
  material/uniaxial/InitStrainMaterial.cpp
  material/section/SectionForceDeformation.cpp
  material/section/FiberSection2d.cpp
  material/section/fiber/Fiber.cpp
  material/section/fiber/UniaxialFiber2d.cpp
  material/section/integration/SectionIntegration.cpp
  recorder/response/MaterialResponse.cpp
  domain/component/Parameter.cpp
)

echo "Compiling ${#SOURCES[@]} OpenSees sources + driver (incremental)…"
OBJS=()
compile() {  # compile <abs-src> <obj>
  local src="$1" obj="$2"
  if [ ! -f "$obj" ] || [ "$src" -nt "$obj" ]; then
    em++ -c "${CXXFLAGS[@]}" "$src" -o "$obj"
  fi
}

for rel in "${SOURCES[@]}"; do
  src="$SRC/$rel"
  if [ ! -f "$src" ]; then echo "  MISSING SOURCE: $rel" >&2; exit 1; fi
  obj="$OBJ_DIR/$(echo "$rel" | tr '/' '_').o"
  compile "$src" "$obj"
  OBJS+=("$obj")
done

# Driver
DRIVER_OBJ="$OBJ_DIR/driver.o"
compile "$HERE/driver.cpp" "$DRIVER_OBJ"
OBJS+=("$DRIVER_OBJ")

echo "Linking -> $OUT_DIR/feaEngine.mjs"
em++ "${OBJS[@]}" \
  -O2 \
  -lembind \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createFeaModule \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 \
  -sFILESYSTEM=0 \
  -sDISABLE_EXCEPTION_CATCHING=1 \
  -o "$OUT_DIR/feaEngine.mjs"

echo "Build OK:"
ls -lh "$OUT_DIR"/feaEngine.* | sed 's/^/  /'
