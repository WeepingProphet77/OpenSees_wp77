# Phase 3 — Fiber-section moment–curvature (WASM)

Closes the last open Phase 3 item from the roadmap (§12) and the spec's higher-
fidelity capacity path (§2.1, §2.2 step 2): a fiber-section **moment–curvature**
analysis in the OpenSees-WASM engine, complementing the closed-form power-formula
flexural capacity computed in TypeScript.

This document covers the **C++ spike** (go/no-go) — proving the fiber-section +
material subset compiles in WASM and produces a validated M–φ curve. The TS
schema/worker wiring and the UI chart are follow-ups.

## Approach (and why)

The canonical OpenSees moment–curvature recipe wires a `ZeroLengthSection` with a
`FiberSection2d` and drives it with `DisplacementControl` + `NewtonRaphson` +
a `ConvergenceTest` through the full `Domain`/`StaticAnalysis` stack. That would
pull a large additional slice of the analysis subsystem into the WASM link —
high risk, given the build is **CI-only** (no local `emcc`) and grows its source
list "as the linker reports missing symbols."

Instead the driver uses the **real OpenSees `FiberSection2d` + materials** but
hand-rolls only the *section-level* equilibrium loop:

- Build the section by `addFiber` — concrete fibers (`Concrete02`), mild steel
  (`ElasticPPMaterial`), and prestressing strand (see below).
- Sweep curvature κ in increments. At each κ, **Newton-solve the section axial
  strain ε** so the net axial force equals the target (0 for a beam) using the
  section's own `getStressResultant()` / `getSectionTangent()`. Record
  M = `getStressResultant()(1)`, then `commitState()`.

### Section geometry

The ABI takes concrete fibers in one of two forms (`section.h` is always the
reference depth):

- **Rectangular** — `section.b` × `section.h`, discretized into `concreteLayers`
  equal layers by the engine.
- **General** — a top-level `concreteFibers` list (`{y: depth-from-top, area}`),
  used when present. The TS `discretizeConcreteFibers(section, nStrips)` slices any
  supported section (`sectionToPolygon`: flanges, multiple stems, voids/holes) into
  horizontal strips, so the curve reflects the real flanged/voided geometry rather
  than a rectangular approximation. `buildMomentCurvatureSpec(section, reinforcement,
  fc)` assembles the full spec from a designed member (mild → `steel`, strand →
  `strands` with grade power-formula params + `fse`).

This is faithful (genuine OpenSees fiber section + constitutive models) while
keeping the link surface to materials + section classes only — no Domain, no
analysis/solver/integrator/convergence machinery.

### Sign convention

Fiber positions are passed **measured upward from mid-height** (`yUp = h/2 −
depth`, depth = distance from the top fiber). With `FiberSection2d`'s internal
convention (`UniaxialFiber2d` location handling; fiber strain `= ε − y·κ`;
`M = −Σσ·A·y`) this makes **positive curvature = sagging** and **M > 0 =
sagging**, matching the TS design engine. (Depth-from-top positions give the
negated sign — verified against the prestressed M(0) holding moment.) A non-prestressed section
gives M(0) = 0; a pretensioned section carries a positive (sagging) holding
moment at κ = 0 from the eccentric strand tension.

### Strand material

OpenSees has no Devalapura–Tadros/PCI power-formula strand material, so the
driver adds a small self-contained `PowerFormulaStrand : UniaxialMaterial`
matching `steelPresets`:

```
fs(e) = Es·e · [ Q + (1−Q) / (1 + (|Es·e|/(K·fpy))^R)^(1/R) ],  |fs| ≤ cap
```

a monotonic nonlinear-elastic backbone (adequate for a monotonic sweep), with an
analytic tangent. It is wrapped in `InitStrainMaterial(εse = fse/Eps)` to apply
the effective prestrain. Built directly (never via an `OPS_*` factory), it needs
no interpreter glue.

## Linking note

The new material/section `.cpp` files carry `OPS_*` interpreter factory functions
that reference `elementAPI` symbols the subset doesn't link — exactly as the
already-linked `ElasticBeam2d.cpp` does. Those factories are unreachable from
`solve()`/`momentCurvature()` (objects are constructed directly), so `wasm-ld`
GC-strips them and their undefined references never bite. The source list may
still need a few more transitive files; extend `build-opensees.sh` as the CI
linker reports them.

## Validation (`fea/test/smoke.mjs`)

- **RC rectangular section** (b=12, h=24, As=3.0 @ d=21.5, fy=60, f′c=5): peak
  moment within ±12% of the Whitney stress-block `Mn = As·fy·(d − a/2)`;
  M(0) ≈ 0; moment rises monotonically with curvature at onset.
- **Prestressed section** (strand @ d=20, fse=175): converges, positive holding
  moment at κ=0, ultimate capacity climbing well above it — exercises
  `PowerFormulaStrand` + `InitStrainMaterial`.

## Next

1. ~~TS schema for the section/material spec + `MomentCurvatureResult`; expose
   `FeaEngine.momentCurvature` and wire the worker.~~ **Done** — `feaModel.ts`
   (`MomentCurvatureSpecSchema` / `MomentCurvatureResultSchema` /
   `normalizeMomentCurvatureSpec`, ABI field names mirroring the C++), both
   `FeaEngine` implementations, and the worker protocol; tested in
   `feaSolve.test.ts` (RC peak ≈ Whitney Mn, prestressed M(0)>0, normalizer).
2. ~~General section geometry — fiber M–φ for flanged/voided precast, not just
   rectangles.~~ **Done** — `discretizeConcreteFibers` (`sectionToPolygon` strips)
   + a `concreteFibers` ABI form + `buildMomentCurvatureSpec`.
3. ~~M–φ chart in the member workspace (equivalent-yield / nominal / ultimate,
   ductility μ = φu/φy), with the closed-form Mₙ and cracking moment overlaid.~~
   **Done** — `useMomentCurvature` hook, `MomentCurvatureChart`, and
   `momentCurvatureMetrics` (peak Mn, secant-equivalent φy, φu, μ). The chart shows
   for flexural members; the Eigen oracle path is untouched. *Note:* yield is the
   reduced-stiffness equivalent (curve-only), not exact first-strand-yield — that
   would need per-fiber strain output from the engine (a small future add).
4. (Optional) feed ductility / nonlinear capacity into the design checks; exact
   first-yield / crushing markers via per-point strain output.
