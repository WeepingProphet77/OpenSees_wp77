# Tessera FEA (WebAssembly)

Finite-element solvers for Tessera, compiled to WebAssembly with Emscripten and
driven from a Web Worker behind the decoupled `FeaEngine` TypeScript interface
(build spec §2.2). Two engines build to `tessera/public/fea/` (git-ignored,
lazy-loaded at runtime; the app stays fully usable for sectional design without
them):

| Module | Role | Source | Solver |
|---|---|---|---|
| `feaEngine.{mjs,wasm}` | **production** | `opensees/driver.cpp` + OpenSees `SRC/` | OpenSees `StaticAnalysis` + `ProfileSPDLinDirectSolver` |
| `feaEngineEigen.{mjs,wasm}` | **oracle / fallback** | `src/fea_solver.cpp` | self-contained Eigen direct-stiffness |

Both speak the identical embind `solve(model) -> result` API and carry the same
2-node, 3-DOF/node elastic beam-column physics. **No Fortran / LAPACK / ARPACK /
MUMPS** in either. The OpenSees subset is the production engine (chosen at the
Phase-3 gate); the Eigen solver is the independent parity oracle. See
[`../../docs/PHASE3_SPIKE.md`](../../docs/PHASE3_SPIKE.md) (go/no-go) and
[`../../docs/PHASE3_OPENSEES_SUBSET.md`](../../docs/PHASE3_OPENSEES_SUBSET.md) (B1).

## Layout

```
fea/
  opensees/driver.cpp         embind driver over the OpenSees subset (production)
  opensees/build-opensees.sh  Emscripten build → ../../public/fea/feaEngine.*
  src/fea_solver.cpp          self-contained Eigen solver (oracle)
  build.sh                    Emscripten build → ../public/fea/feaEngineEigen.*
  fetch-eigen.sh              Fetch Eigen headers (build-time dep; not committed)
  test/smoke.mjs              Node smoke test (closed-form parity & equilibrium)
```

The TypeScript side (`../src/fea/`) defines the `FeaEngine` interface, the zod
model/result schemas, model builders, and the Web Worker host — shared by both.

## Build locally

```bash
# Emscripten SDK on PATH (one-time):
#   git clone https://github.com/emscripten-core/emsdk && cd emsdk
#   ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh

npm run build:wasm          # production: OpenSees subset -> public/fea/feaEngine.*
bash fea/fetch-eigen.sh     # one-time: Eigen headers for the oracle
npm run build:wasm:oracle   # oracle: Eigen -> public/fea/feaEngineEigen.*
npm run fea:smoke           # node closed-form smoke test (defaults to feaEngine.mjs)
```

## CI

`.github/workflows/wasm-build.yml` builds + smoke-tests **both** modules and
uploads them as the `tessera-fea-wasm` artifact; `web-deploy.yml` downloads that
artifact so the deployed app — and the Vitest numeric/parity tests — use the real
modules.

[Eigen]: https://eigen.tuxfamily.org
