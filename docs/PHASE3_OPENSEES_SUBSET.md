# Tessera Phase 3 — OpenSees subset → WebAssembly (production engine, B1–B3)

> **Status:** **B1 + B2 + B3 complete.** A minimal subset of this OpenSees fork
> compiles to WebAssembly and runs real linear-elastic **2D and 3D** frame
> `StaticAnalysis`, validated against closed-form solutions **and** (in 2D) the
> Eigen parity oracle. This is the production path chosen at the Phase-3 go/no-go
> gate (see [`PHASE3_SPIKE.md`](./PHASE3_SPIKE.md), Option B).
>
> - **B1** — 2D frames: `ElasticBeam2d` + `LinearCrdTransf2d`, 3 DOF/node.
> - **B2** — 3D frames: `ElasticBeam3d` + `LinearCrdTransf3d`, 6 DOF/node
>   (axial, biaxial bending, **torsion**), element orientation via a `vecxz`
>   vector (OpenSees local x-z plane convention; default supplied). Local end
>   forces use OpenSees' own `localForce` element response.
> - **B3** — member-load library: concentrated **point loads** (`Beam2d/3dPointLoad`)
>   and **partial / trapezoidal** distributed loads (`Beam2d/3dPartialUniformLoad`),
>   with axial components, on top of the existing full-span uniform loads.
> - **Member end releases** — per-end moment hinges (`Mzi`/`Mzj`, plus `Myi`/`Myj`
>   in 3D) mapped to the `ElasticBeam2d`/`ElasticBeam3d` release codes.

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

~80 OpenSees `.cpp` translation units (listed in `build-opensees.sh`) plus the
driver, across: `matrix` (Matrix/Vector/ID), `tagged` storage, `actor`
(MovableObject/Channel/FEM_ObjectBroker base), `domain` (Domain + single-domain
iterators, Node, SP/MP constraints, LoadPattern/LinearSeries, loads incl.
`Beam2dUniformLoad`/`Beam3dUniformLoad`), `element`
(Element/ElasticBeam2d/ElasticBeam3d), `coordTransformation`
(CrdTransf/LinearCrdTransf2d/LinearCrdTransf3d), the `analysis` machinery
(AnalysisModel, StaticAnalysis, LoadControl, Linear, PlainHandler, PlainNumberer,
FE_Element, DOF_Group), `system_of_eqn/linearSOE/profileSPD`, and `graph`.

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

- **2D** closed-form suite (cantilever `PL³/3EI`, simply-supported UDL
  `5wL⁴/384EI` & `wL²/8`, portal-frame equilibrium) for **both** engines, plus a
  **cross-engine parity** test (OpenSees vs Eigen displacements & reactions agree
  to ~1e-6 on a portal frame with combined lateral + gravity load).
- **3D** closed-form suite (OpenSees): strong-axis bending `PL³/3EIz`, weak-axis
  bending `PL³/3EIy`, **torsion** `TL/GJ`, axial `PL/EA`, and 3D static
  equilibrium of an L-frame; plus validation that a 3D model missing `G`/`Iy`/`J`
  is rejected.
- **B3 member loads** (2D & 3D): point load at the tip (`PL³/3EI`) and at midspan
  (`5PL³/48EI`), full-span partial load ≡ uniform, **triangular** load
  (`11wL⁴/120EI`, base `wL²/3`), and an axial point load — checking deflections
  **and** base reactions; plus rejection of a partial load with `b ≤ a`.
- **End releases** (2D & 3D): a fixed+roller beam under UDL gives the propped
  cantilever (`R = 5wL/8`, base `M = wL²/8`); releasing the fixed-end moment
  recovers the simply-supported result (`R = wL/2`, base `M = 0`), about both the
  local z and local y axes.

Plus the Node smoke test (`fea/test/smoke.mjs`, 2D) on each module in CI. The
driver tolerates omitted optional fields/arrays (defaults to 0 / empty) so
hand-built models don't silently produce NaN.

## Next increments (post-B3)

- **B3 (done):** member-load library — point loads and partial / trapezoidal
  distributed loads (2D & 3D), with axial components.
- **End releases (done):** per-end moment hinges via the `ElasticBeam2d/3d`
  `release` parameters.
- **Next (engine):** multiple load patterns & combinations, and rigid end offsets
  (`rigJntOffset`) for the Vierendeel equivalent frame (§5.5). A future
  refinement is to expose the RISA-3D β roll angle (§4.1) as a friendlier
  alternative to `vecxz`.
- **Results visualization (C1):** loading, shear, moment (both planes in 3D),
  axial, torsion, and deflected-shape diagrams — reconstructed in the app from
  element end forces + member loads (now that B3 supplies the load types).
- **B4 + section linkage:** tie FEA members to real cross-sections (reusing the
  existing `compositeSection` / `serviceStresses` code) for stress diagrams, then
  fiber-section moment–curvature (`forceBeamColumn`) for higher-fidelity capacity
  (§6) — the reason Option B was chosen over extending the Eigen core.
- **Pin** the Emscripten version (CI currently tracks `latest`) once the engine
  is load-bearing.
