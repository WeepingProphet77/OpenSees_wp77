#!/usr/bin/env bash
# Build the Tessera FEA spike (C++ + Eigen) to WebAssembly with Emscripten.
#
# Emits a separate `.wasm` + ES6 JS glue so they can be published as CI
# artifacts (build spec §11) and lazy-loaded by the FEA Web Worker. The output
# module runs in `web`, `worker`, and `node` environments (the last so the CI
# smoke test can solve a portal frame under Node).
#
# Prerequisites:
#   - Emscripten SDK activated (`emcc`/`em++` on PATH, e.g. `source emsdk_env.sh`).
#   - Eigen headers present at OTHER/eigenAPI/eigen (header-only; fetched by CI /
#     `fea/fetch-eigen.sh`). Eigen is the ONLY math dependency — no Fortran.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"     # tessera/fea
TESSERA_DIR="$(cd "$HERE/.." && pwd)"                     # tessera
REPO_ROOT="$(cd "$TESSERA_DIR/.." && pwd)"               # OpenSees fork root

EIGEN_DIR="${EIGEN_DIR:-$REPO_ROOT/OTHER/eigenAPI/eigen}"
OUT_DIR="${OUT_DIR:-$TESSERA_DIR/public/fea}"
SRC="$HERE/src/fea_solver.cpp"

if [ ! -f "$EIGEN_DIR/Eigen/Dense" ]; then
  echo "ERROR: Eigen headers not found at $EIGEN_DIR" >&2
  echo "       Run fea/fetch-eigen.sh (or set EIGEN_DIR)." >&2
  exit 1
fi
if ! command -v em++ >/dev/null 2>&1; then
  echo "ERROR: em++ not on PATH. Activate the Emscripten SDK first." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "Building $SRC -> $OUT_DIR/feaEngine.mjs (+ feaEngine.wasm)"
em++ "$SRC" \
  -O3 -std=c++17 \
  -I"$EIGEN_DIR" \
  -lembind \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createFeaModule \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 \
  -sFILESYSTEM=0 \
  -sDYNAMIC_EXECUTION=0 \
  -o "$OUT_DIR/feaEngine.mjs"

echo "Build OK:"
ls -lh "$OUT_DIR"/feaEngine.* | sed 's/^/  /'
