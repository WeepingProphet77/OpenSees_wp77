# Tessera — Build Status & Phase 3 Handoff

> Companion to the authoritative spec **`TESSERA_BUILD_PROMPT.md`** (read that first).
> This file is the durable handoff: what's built, where it lives, the working
> conventions, and the next task. Update it as phases land.

## Status: Phases 0–2 complete and merged to `master`

The app lives in the **`/tessera`** subdirectory. Baseline check:

```bash
cd tessera && npm ci && npm test && npm run build
```

Expect **~170 Vitest tests passing** and a clean strict build (`tsc -b` + `vite build`).

### Phase 0 — scaffold & rails
- Vite 7 + **React 18** + TypeScript; Tailwind v4 + shadcn-style components
  (`src/components/ui`), `cn()` in `src/lib/utils.ts`.
- Zustand store (single in-memory project) `src/store/projectStore.ts`; zod.
- Tested US-customary **units** module `src/units/units.ts`.
- **Power-formula flexural engine** ported to TS: `src/engine/beamCalculations.ts`
  + `src/engine/steelPresets.ts`, original Vitest suite preserved.
- **`.tsr`** project file: `src/project/tsrFile.ts`, zod schema `src/schema/project.ts`
  with versioned migration `src/schema/migrations.ts`.
- CI → GitHub Pages: `.github/workflows/web-deploy.yml` (Vite `base = /OpenSees_wp77/`).

### Phase 1 — single-member flexure + checks
- Domain model `src/schema/domain.ts` (Member with local axes §4.1, Section,
  reinforcement, loads).
- Design-check modules `src/engine/designChecks/`: `serviceStresses.ts` (§24.5),
  `shear.ts` (§22.5 simplified Vc, §9.6.3, §9.7.6.2.2), `camberDeflection.ts`
  (PCI multipliers, Table 24.2.2), `prestressLosses.ts` (PCI/Zia approximate).
- `src/engine/statics.ts` (simple-span) + `src/engine/analyzeMember.ts` orchestrator.
- UI workspace `src/app/MemberWorkspace.tsx`; diagrams in `src/components/diagrams/`
  (SectionView, SectionDrawer, StrainDiagram, StressStrainChart, InteractionDiagram,
  PMDiagram); results in `src/components/results/`.
- jsPDF calc-package report `src/report/generateReport.ts` (lazy-loaded).
- Flat UI/persistence model `src/design/memberDesign.ts` (`MemberDesignInput`,
  `designToInput`, `buildEngineSection`).

### Phase 2 — member library
- ACI 318-19 **§5.3 load combinations** `src/engine/loadCombinations.ts`
  (wired into `analyzeMember`; the old hard-coded 1.2D+1.6L is gone).
- **Column P-M-M**: `analyzeBiaxial` extended with applied axial **N** (ΣF = N);
  `src/engine/columnPM.ts` builds the φP–φMₙ curve (cap 0.80/0.85·φ·Po, §22.4.2.1).
- **Floor + composite topping** `src/engine/compositeSection.ts` (transformed
  section, staged stresses §24.5, interface shear §16.4); double-tee / hollowcore.
- **Wall panel** P-M + **handling/stripping** `src/engine/handlingStresses.ts`;
  sandwich section type.
- **DXF import (§7)** `src/dxf/dxfParser.ts` + `dxfGeometry.ts` (closed polylines/
  circles → rings, bulge tessellation, POINT → generic reinforcement placeholders,
  ring nesting classification, Y-flip to top-fiber-down, unit scaling). Fixtures +
  ported tests in `src/dxf/__fixtures__` / `*.test.ts`.

## Working conventions (keep these)
- Engine is **pure / UI-free**; all code-design math in TS. Every reported
  capacity cites its **ACI/PCI clause + formula**; solvers report convergence;
  units explicit (kip, in, ksi).
- Tests are co-located `*.test.ts`, **excluded from the `tsc -b` build**, run by
  Vitest (node env). Hand-verify reference values against ACI/PCI.
- Stack pinned & working: Vite 7, React 18, TS ~5.9, Vitest 4, Tailwind v4,
  zustand 5, zod 4, jspdf 3 (Node 22).
- Workflow: new `claude/tessera-phase*-*` feature branch per increment; **draft
  PR** each; engine-first; merge once checks are green. Pause for a decision at
  architecturally significant gates.
- CI: Actions enabled; Pages source = "GitHub Actions". `build_cmake.yml` (native)
  Windows job fixed (working-directory uses `${{ github.workspace }}`).

## Open tech-debt
- The single member is persisted as a flat `design` blob on the project
  (`memberDesign.ts`); reconcile with the `members[]` domain model
  (`schema/domain.ts`) during multi-member management (Phase 4).
- Prestress-loss relaxation **C-table** is flagged in-code "verify against your
  PCI edition" (`designChecks/prestressLosses.ts`).
- Strength load-combo UI inputs are limited to dead/live (wind/seismic factors
  exist in the combo set but aren't surfaced).

## Next: Phase 3 — OpenSees → WebAssembly FEA engine (§2.2, §12)
Highest-risk item; **begin with the throwaway go/no-go spike**, not the full engine:
1. Stand up the **Emscripten SDK**; prove a **minimal elastic 2D portal-frame
   solve** compiled to WASM, run in a **Web Worker** behind one decoupled
   **`FeaEngine`** TS interface (model JSON in → displacements / reactions /
   element end forces out).
2. Prefer C++/**Eigen** solvers (repo vendors Eigen at `OTHER/eigenAPI/eigen`);
   **the Fortran-elimination feasibility is the explicit go/no-go gate.**
3. Add `wasm-build.yml` (Emscripten SDK) producing the `.wasm` + glue as artifacts
   consumed by `web-deploy.yml`. Keep `build_cmake.yml` as-is.

The sectional-design app (Phases 0–2) must remain fully usable without WASM.
The Emscripten spike likely needs network access for `emsdk` — flag it if the
environment's network policy blocks it.
