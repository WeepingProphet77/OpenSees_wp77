# Tessera

Internal-use, browser-based **precast / prestressed concrete design** application.
It uses a forked OpenSees (this repository) compiled to WebAssembly as its FEA
engine, and the Devalapura–Tadros / PCI **power formula** for flexural strength.

> Authoritative spec: [`../docs/TESSERA_BUILD_PROMPT.md`](../docs/TESSERA_BUILD_PROMPT.md)

## Status — Phase 0 (scaffold & rails)

Phase 0 establishes the foundations:

- **Stack:** Vite + React 18 + TypeScript, Tailwind CSS v4 + shadcn/ui-style components.
- **State:** a single Zustand store holding one in-memory `Project`.
- **Validation:** zod schemas for the `.tsr` file, with versioned migration.
- **Units:** a tested US-customary units module (kip, in, ksi).
- **Engine:** the power-formula flexural engine + steel presets, **ported to
  TypeScript** from `WeepingProphet77/prestressed_beam_power`, with the original
  Vitest suite preserved.
- **`.tsr` project file:** in-browser Save / Load / Clear with zod validation and
  schema migration.
- **Deploy:** a GitHub Actions workflow builds the app and publishes it to GitHub
  Pages; a "hello Tessera" page proves the deploy and runs the engine live.

Later phases (single-member flexure, member library, the OpenSees→WASM FEA
engine, Vierendeel frames) are described in §12 of the spec and are **not** started.

## Develop

```bash
cd tessera
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest (engine parity, units, schema, store, .tsr)
npm run build      # tsc -b && vite build  → dist/
npm run preview    # serve the production build
```

## Layout

```
src/
  engine/      power-formula flexural engine (ported) + steel presets + tests
  units/       US-customary units module + tests
  schema/      zod .tsr project schema + versioned migrations
  store/       Zustand project store (single source of truth)
  project/     .tsr serialize / parse / save / load
  components/   shadcn/ui-style primitives (Button, Card)
  lib/         cn() class helper
  app/         App (Phase 0 "hello Tessera" page)
```

## Deployment notes

- The Vite production `base` is set to `/OpenSees_wp77/` (the GitHub Pages project
  path). Adjust in `vite.config.ts` if the repository is renamed.
- Deployment runs from [`.github/workflows/web-deploy.yml`](../.github/workflows/web-deploy.yml)
  on pushes to `master` (and via manual dispatch).
- **GitHub Actions must be enabled on this fork** and the Pages source set to
  **"GitHub Actions"** (repo *Settings → Pages*) before the deploy can run.

## Engine provenance

`src/engine/beamCalculations.ts` and `src/engine/steelPresets.ts` are a faithful
TypeScript port of the reference JavaScript implementation, preserving the numeric
algorithm and its regression tests. Only types and null-safe destructuring
defaults (which do not change results for well-formed inputs) were added.
