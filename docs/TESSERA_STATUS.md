# Tessera — Build Status

> Companion to the authoritative spec **`TESSERA_BUILD_PROMPT.md`** (read that first).
> This file is the durable handoff: what's built, where it lives, the working
> conventions, and what remains. Update it as work lands.

## Status: Phases 0–3 complete; Phase 4 substantially complete — all on `master`

The app lives in the **`/tessera`** subdirectory. Baseline check:

```bash
cd tessera && npm ci && npm test && npm run build
```

Expect **~284 Vitest tests passing** (4 skipped when the WASM engine isn't built
locally) and a clean strict build (`tsc -b` + `vite build`). All five v1 success
criteria in the spec are met and the app is deployed to GitHub Pages.

### Phase 0 — scaffold & rails ✅
- Vite 7 + React 18 + TS; Tailwind v4 + shadcn-style components; Zustand store;
  zod; tested US-customary units; power-formula flexural engine ported to TS;
  `.tsr` project file with versioned migrations; CI → GitHub Pages.

### Phase 1 — single-member flexure + checks ✅
- Power-formula φMₙ, service/transfer stresses (§24.5), shear (§22.5), camber/
  deflection (PCI), prestress losses (PCI lump-sum), min-strength (§9.6.1.3);
  member local axes (§4.1); jsPDF calc-package report.

### Phase 2 — member library ✅
- ACI §5.3 load combinations; column P-M-M (biaxial + axial N); floor double-tee/
  hollowcore with composite topping (staged/transformed, interface shear §16.4);
  wall panel P-M + handling/stripping; DXF import (§7).

### Phase 3 — FEA engine (WASM) ✅
- `FeaEngine` worker interface; OpenSees subset compiled to WASM via Emscripten
  (StaticAnalysis + ProfileSPDLinDirectSolver, no Fortran) + a self-contained
  **Eigen oracle** for parity; built in CI by `wasm-build.yml`, consumed by
  `web-deploy.yml`, smoke-tested in Node.
- Fiber-section **moment–curvature** with exact cracking/first-yield/crushing
  landmarks and a curvature-ductility (μ = φu/φy) classification.
- Robustness: the engine URL is **cache-busted per deploy** (`?v=<sha>`), the
  glue/.wasm are fetched as a matched pair, load errors are surfaced in the UI,
  and the engine is built with `-sGROWABLE_ARRAYBUFFERS=0` so modern V8
  (Chrome/Edge) doesn't hand `TextDecoder` a resizable ArrayBuffer.

### Phase 4 — frames, Vierendeel & polish 🟡 (mostly complete)
- **Vierendeel wall panel** ✅ — equivalent moment frame (piers + chords) with
  rigid end-zone links where members overlap and joint-overlap self-weight;
  solved by the WASM frame engine; member end forces feed the per-member
  sectional checks (§19.2.3 cracking, §22.5 shear).
- **Multi-member project management** ✅ — array-of-designs model + left-rail
  project navigator (members + Vierendeel panels); persisted in `.tsr` (schema v3).
- **3D viewport** ✅ — dependency-free axonometric SVG: the real section extruded
  along the span, reinforcement runs, RISA local-axis triad, plus a solved
  **deformed-shape + bending-moment overlay**.
- **Torsion (§22.7)** ✅ — threshold/cracking torsion, closed-stirrup + longitudinal
  steel, combined shear-torsion section adequacy (§22.7.7.1).
- Component/UX polish: utilization gauges, accessible controls, wind/seismic
  load-combination inputs feeding the §5.3 governing combination.

## Working conventions (keep these)
- Engine is **pure / UI-free**; every reported capacity cites its ACI/PCI clause +
  formula; solvers report convergence; units explicit (kip, in, ksi).
- Tests co-located `*.test.ts`, excluded from `tsc -b`, run by Vitest (node env).
- Stack pinned: Vite 7, React 18, TS ~5.9, Vitest 4, Tailwind v4, zustand 5,
  zod 4, jspdf 3 (Node 22).
- Workflow: a feature branch + **draft PR** per increment; engine-first; merge once
  the tessera gates (`wasm / build-wasm` + `build`) are green. The native OpenSees
  `build_cmake.yml` (Ubuntu/macOS/Windows) is independent of `/tessera` changes.

## Remaining / deferred
- **Sections catalog** — reconcile the flat per-member `design` blob with a shared
  project `sections[]` catalog + member `sectionRef` (the `MemberSection` seam is
  extracted; the persisted-catalog migration is the remaining step).
- **Playwright e2e** — import → design → save/load flow coverage (spec §3/§13);
  only Vitest unit/parity tests exist today.
- **Refined time-step prestress losses** — deferred by design (v1 uses PCI
  lump-sum); a dedicated, reference-validated effort when wanted.
- Prestress-loss relaxation C-table is flagged in-code "verify against your PCI
  edition" (`designChecks/prestressLosses.ts`).
