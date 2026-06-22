# Tessera FEA (WebAssembly) — Phase 3 spike

A minimal **linear-elastic 2D frame** solver (C++ + [Eigen]) compiled to
WebAssembly with Emscripten. It is the throwaway go/no-go spike for the
OpenSees → WASM engine (build spec §2.2). See
[`../../docs/PHASE3_SPIKE.md`](../../docs/PHASE3_SPIKE.md) for the feasibility
report and gate recommendation.

The element formulation (2-node, 3-DOF/node elastic beam-column + linear
transform) mirrors OpenSees `elasticBeamColumn` + `LinearCrdTransf2d`. The only
linear-algebra dependency is **Eigen** (header-only C++ templates) — **no
Fortran / LAPACK / ARPACK / MUMPS**.

## Layout

```
fea/
  src/fea_solver.cpp   C++ solver, embind entry `solve(model) -> result`
  build.sh             Emscripten build → ../public/fea/feaEngine.{mjs,wasm}
  fetch-eigen.sh       Fetch Eigen headers (build-time dep; not committed)
  test/smoke.mjs       Node smoke test (closed-form parity & equilibrium)
```

The TypeScript side (`../src/fea/`) defines the decoupled `FeaEngine` interface,
the zod model/result schemas, model builders, and the Web Worker host.

## Build locally

```bash
# 1. Emscripten SDK on PATH (one-time):
#    git clone https://github.com/emscripten-core/emsdk && cd emsdk
#    ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh
# 2. Eigen headers (one-time):
bash fea/fetch-eigen.sh
# 3. Build + smoke test:
npm run build:wasm
npm run fea:smoke
```

The output lands in `tessera/public/fea/` (git-ignored) and is lazy-loaded by
the app at runtime. The app builds and runs **without** it — FEA is simply
unavailable until the module is present.

## CI

`.github/workflows/wasm-build.yml` builds + smoke-tests the module and uploads it
as the `tessera-fea-wasm` artifact; `web-deploy.yml` downloads that artifact so
the deployed app (and the Vitest numeric parity tests) use the real module.

[Eigen]: https://eigen.tuxfamily.org
