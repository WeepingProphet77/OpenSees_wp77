# Tessera Phase 3 — FEA / WebAssembly Go/No-Go Spike

> **Status:** Spike complete. **Gate recommendation: GO.**
> **Scope:** Throwaway spike per build spec §2.2 — prove a minimal linear-elastic
> 2D frame solve compiled to WebAssembly, driven from a Web Worker behind a
> single decoupled `FeaEngine` interface, and answer the explicit
> **Fortran-elimination go/no-go gate** before committing to the full engine.

This document is the feasibility report the spec asks for ("Report feasibility
clearly before committing to the full engine").

---

## 1. The gate question (§2.2)

> *"Avoid the Fortran toolchain where possible … prefer C++/Eigen-based linear
> solvers … Treat eliminating/replacing Fortran dependencies … as an explicit
> Phase-3 spike with a go/no-go gate."*

**Finding: Fortran can be eliminated for linear static FEA. Recommendation: GO.**

Two independent, pure-C++ linear-solve paths exist — neither needs
LAPACK / ARPACK / MUMPS / BLAS or any Fortran:

1. **Eigen** (the library OpenSees already vendors at `OTHER/eigenAPI/eigen`) —
   header-only C++ templates with dense (`LDLT`, `LLT`, `PartialPivLU`) and
   sparse (`SimplicialLDLT`, `SparseLU`) direct solvers. **Zero Fortran.**
   This spike uses Eigen's dense `LDLT` and it compiles cleanly to WASM.
2. **OpenSees `ProfileSPDLinDirectSolver`** — a pure-C++ skyline Cholesky
   solver (the only `FORTRAN` strings in it are comments about 1-based array
   indexing). So even a future OpenSees-subset build has a no-Fortran linear
   path. The Fortran-requiring `LinearSOE` options
   (`bandGEN`/`bandSPD`/`fullGEN` → LAPACK, plus `mumps`/`pardiso`/`petsc`/
   `itpack`) are all **avoidable** for linear static analysis.

The spike proves path (1) end-to-end in the browser/Node.

---

## 2. What was built (throwaway)

Per the ratified decision (owner, this phase), the spike uses a **self-contained
Eigen direct-stiffness solver**, not yet an OpenSees subset — the fastest,
lowest-risk way to de-risk the toolchain + architecture and answer the gate. The
element physics (2-node, 3-DOF/node elastic beam-column + linear transform) is
identical to OpenSees `elasticBeamColumn` + `LinearCrdTransf2d`, so the result
transfers either way.

| Piece | Location |
|---|---|
| C++ Eigen solver (≈300 lines) | `tessera/fea/src/fea_solver.cpp` |
| Emscripten build script | `tessera/fea/build.sh` → `tessera/public/fea/feaEngine.{mjs,wasm}` |
| Eigen fetch (build-time dep) | `tessera/fea/fetch-eigen.sh` |
| Node smoke test | `tessera/fea/test/smoke.mjs` |
| `FeaEngine` interface + Worker engine | `tessera/src/fea/FeaEngine.ts` |
| FEA Web Worker host | `tessera/src/fea/feaWorker.ts` |
| Model/result schema (zod) + integrity checks | `tessera/src/fea/feaModel.ts` |
| Model builders (portal frame, beam) | `tessera/src/fea/feaBuilders.ts` |
| CI: reusable WASM build | `.github/workflows/wasm-build.yml` |
| CI: web-deploy consumes the artifact | `.github/workflows/web-deploy.yml` |

**Architecture proven (§2.1):** TS app → `FeaEngine` (validated **model JSON in →
results JSON out**: nodal displacements, reactions, element end forces,
**convergence flag + residual**) → Web Worker → WASM module. The WASM is a
runtime asset lazy-loaded from `public/fea`, so **the app builds and runs fully
for sectional design even when the module is absent** (the spec's hard
requirement). Native `build_cmake.yml` is untouched.

---

## 3. Toolchain & artifact results

- **Emscripten:** `em++` 6.0.0 (emsdk `latest`); installs in CI via
  `mymindstorm/setup-emsdk` (cached). Network needed once to fetch emsdk + Eigen.
- **Eigen:** fetched as a build-time dependency (the fork's `.gitmodules` lists
  Eigen but the submodule gitlink was never committed, so `git submodule update`
  cannot populate it — `fetch-eigen.sh` shallow-clones the headers instead;
  not committed).
- **Artifact size:** `feaEngine.wasm` ≈ 53 KB, ES6 glue ≈ 29 KB. Single-threaded
  (no pthreads) → **no COOP/COEP headers required**, so it works on GitHub Pages
  as-is.
- **Build flags:** `-O3 -std=c++17 -lembind -sMODULARIZE=1 -sEXPORT_ES6=1
  -sENVIRONMENT=web,worker,node -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1`.

---

## 4. Numerical validation (closed-form parity)

The built module is validated under Node (`smoke.mjs`) and via the Vitest suite
(`src/fea/feaSolve.test.ts`, which runs against the real WASM when built) against
Euler–Bernoulli theory and static equilibrium:

| Case | Quantity | Result |
|---|---|---|
| Cantilever, tip load P | tip δ = `PL³/3EI`; base reactions `P`, `PL` | **exact** |
| Simply-supported beam, UDL w | midspan δ = `5wL⁴/384EI`; reactions `wL/2`; M = `wL²/8` | **exact** |
| Fixed-base portal frame, lateral load | ΣFx, ΣFy, ΣM equilibrium | **exact** (residual ≈ 2e-14) |
| Under-restrained model (mechanism) | reports `converged:false`, never throws | **handled** |

Convergence is reported, never hidden (§13): the solver returns `converged`, a
human-readable `solver` identity ("Eigen LDLT (dense, symmetric
positive-definite)"), a `message`, and the relative residual `‖K·d − f‖/‖f‖`. A
zero-pivot check on the LDLT D-factor surfaces unstable/under-restrained models
as non-convergence.

Full suite: **185 tests pass** (170 pre-existing + 15 new), clean strict build.

---

## 5. Recommendation for the full engine

Both viable; the gate decision is *which*:

- **Option A — extend this Eigen direct-stiffness core.** Lowest risk, smallest
  artifact, full control, no Fortran. Would need us to build up: 3D frames
  (6 DOF/node + 3D transforms with the RISA β roll angle, §4.1), rigid end
  offsets for Vierendeel (§5.5), element/nodal load types, and — for
  higher-fidelity capacity — fiber-section moment–curvature (§6), which is real
  work to re-implement. We'd be re-deriving what OpenSees already has.
- **Option B — carve a minimal OpenSees subset to WASM.** Reuses OpenSees'
  validated elements (`elasticBeamColumn`, `forceBeamColumn`, fiber sections),
  `LinearCrdTransf`, `ProfileSPDLinSOE` (no Fortran), and analysis machinery.
  Higher up-front effort (the Domain/Analysis/Integrator/SOE/Numberer/Handler
  class graph is large and interdependent), but it is the path to the
  fiber-section moment–curvature and nonlinear goals in §2.2/§6 without
  reimplementing them.

**Recommendation:** proceed to **Option B (OpenSees subset)** for the production
engine, now that the gate is GO and the toolchain/architecture are proven — but
keep this Eigen core as the **reference oracle** for parity tests and as a
guaranteed-working fallback path. Rationale: Tessera's later phases need
fiber-section M–φ and nonlinear capability that OpenSees already provides and
that would be costly and error-prone to re-derive; the linear-solver Fortran
risk that motivated the gate is now retired (`ProfileSPDLinDirectSolver` is pure
C++).

If the owner prefers to minimize scope/risk and defer nonlinear fidelity,
**Option A** is fully sufficient for elastic Vierendeel/frame analysis (Phase 4).

---

## 6. Risks & open items (for the full engine, post-gate)

- **OpenSees subset link graph (Option B):** expect significant iteration to get
  a minimal set of `.cpp` files to compile/link under `emcc`. De-risk by
  building incrementally (Matrix/Vector/ID → Domain/Node → element → analysis).
- **3D + β roll angle:** the spike is 2D; the production engine must implement
  the RISA-3D local-axis convention (§4.1) and 3D transforms.
- **emsdk `latest` pin:** CI tracks `latest`; pin to a known-good version before
  the engine is load-bearing for reproducibility.
- **Worker e2e:** the Worker path is unit-tested by contract and the WASM by
  Node parity; add a Playwright e2e (browser Worker + WASM) in Phase 4 polish.

---

## 7. The decision at this gate

**Confirmed by the spike:** WASM FEA in the browser is feasible and Fortran-free
→ **GO** to build the real frame engine.

**Owner decision requested:** full-engine direction — **Option A** (extend this
Eigen core) vs **Option B** (carve an OpenSees subset). Recommendation: **B**,
with this Eigen core retained as the parity oracle/fallback.
