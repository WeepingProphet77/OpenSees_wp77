# Tessera Phase 3 — OpenSees subset → WebAssembly (production engine, B1)

> **Status:** Increment **B1 complete** — a minimal subset of this OpenSees fork
> compiles to WebAssembly and runs a real linear-elastic 2D-frame
> `StaticAnalysis`, validated against closed-form solutions **and** the Eigen
> parity oracle. This is the production path chosen at the Phase-3 go/no-go gate
> (see [`PHASE3_SPIKE.md`](./PHASE3_SPIKE.md), Option B).

## What this is

The spike proved WASM FEA is feasible and Fortran-free using a self-contained
Eigen solver. B1 delivers the **real thing**: actual OpenSees classes
(`Domain`, `Node`, `ElasticBeam2d`, `LinearCrdTransf2d`, `StaticAnalysis`,
`ProfileSPDLinSOE` + `ProfileSPDLinDirectSolver`, …) compiled to WebAssembly and
driven from a thin embind C++ driver.

Crucially, it exposes the **identical `solve(model) → result` embind signature**
as the Eigen oracle, so the entire TypeScript layer — `FeaEngine`, the Web
Worker, the zod model/result schemas — is **reused unchanged**. Swapping engines
is purely a build/asset concern.

| | Production | Oracle |
|---|---|---|
| Module | `public/fea/feaEngine.{mjs,wasm}` | `public/fea/feaEngineEigen.{mjs,wasm}` |
| Engine | OpenSees subset → `StaticAnalysis` + `ProfileSPDLinDirectSolver` | self-contained Eigen direct-stiffness |
| Source | `tessera/fea/opensees/driver.cpp` (+ OpenSees `SRC/`) | `tessera/fea/src/fea_solver.cpp` |
| Build | `tessera/fea/opensees/build-opensees.sh` (`npm run build:wasm`) | `tessera/fea/build.sh` (`npm run build:wasm:oracle`) |
| `.wasm` size | ~388 KB | ~53 KB |

## The subset

~76 OpenSees `.cpp` translation units (listed in `build-opensees.sh`) plus the
driver, across: `matrix` (Matrix/Vector/ID), `tagged` storage, `actor`
(MovableObject/Channel/FEM_ObjectBroker base), `domain` (Domain + single-domain
iterators, Node, SP/MP constraints, LoadPattern/LinearSeries, loads incl.
`Beam2dUniformLoad`), `element` (Element/ElasticBeam2d), `coordTransformation`
(CrdTransf/LinearCrdTransf2d), the `analysis` machinery (AnalysisModel,
StaticAnalysis, LoadControl, Linear, PlainHandler, PlainNumberer, FE_Element,
DOF_Group), `system_of_eqn/linearSOE/profileSPD`, and `graph`.

**No Fortran / LAPACK / ARPACK / MUMPS / external libs** — confirmed by building
with only `-I` paths into `SRC/` (the spike's gate finding, now realized).

## Build

```bash
# Emscripten SDK on PATH (see fea/README.md). Then:
npm run build:wasm          # production: OpenSees subset  -> public/fea/feaEngine.*
npm run build:wasm:oracle   # oracle: Eigen (needs fetch-eigen.sh) -> feaEngineEigen.*
npm run fea:smoke           # node closed-form smoke test (defaults to feaEngine.mjs)
```

`build-opensees.sh` compiles a comprehensive `-I` set (every dir under `SRC/`,
harmless — only headers the compiled units include are parsed) and caches object
files under `fea/opensees/.objcache/` for fast iteration. CI builds both modules
and smoke-tests each.

## Link-resolution notes (hurdles solved)

The compile was clean; the work was resolving the link graph minimally:

- **Iterators**: `Domain`/`LoadPattern`/`AnalysisModel`/`Graph` need their
  companion `*Iter` TUs (`SingleDom*Iter`, `NodalLoadIter`, `ElementalLoadIter`,
  `LoadPatternIter`, `FE_EleIter`, `DOF_GrpIter`, `VertexIter`).
- **`Subdomain`**: referenced by `FE_Element` only under `isSubdomain()==false`
  guards (dead for our elements) but must link; including `Subdomain.cpp`
  resolved it without cascading.
- **Material-print hooks**: `OPS_print{Uniaxial,ND}Material` /
  `OPS_printSectionForceDeformation` are called only by `Domain::Print` (never
  invoked here) — **stubbed in the driver** to avoid linking the material
  subsystem.
- **Globals**: a standalone build must define `StandardStream sserr;` and
  `OPS_Stream *opserrPtr = &sserr;` (per `EXAMPLES/Example1/main.cpp`).
- `LoadCase`/`SingleDomLC_Iter` are not needed (and pull missing headers) — omitted.

## Validation

`npm test` runs (against the real WASM, when built):

- The closed-form suite (cantilever `PL³/3EI`, simply-supported UDL `5wL⁴/384EI`
  & `wL²/8`, portal-frame equilibrium) for **both** engines.
- A **cross-engine parity** test: OpenSees vs Eigen nodal displacements &
  reactions agree to ~1e-6 on a portal frame with combined lateral + gravity
  load.

Plus the Node smoke test (`fea/test/smoke.mjs`) on each module in CI.

## Next increments (post-B1)

- **B2:** 3D frames — `ElasticBeam3d` + `LinearCrdTransf3d`, 6 DOF/node, and the
  RISA-3D local-axis β roll convention (build spec §4.1); extend the model schema
  to 3D.
- **B3:** broaden load/element coverage (point loads, member end releases),
  reactions/among multiple patterns & combos.
- **B4:** fiber-section moment–curvature (`forceBeamColumn`/fiber sections) for
  higher-fidelity capacity (§6) — the reason Option B was chosen over extending
  the Eigen core.
- **Pin** the Emscripten version (CI currently tracks `latest`) once the engine
  is load-bearing.
