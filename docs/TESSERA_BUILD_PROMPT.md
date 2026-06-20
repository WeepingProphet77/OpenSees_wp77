# Tessera — Precast Concrete Design Application
## Master Build Prompt / Specification

> **Status:** Draft v0.2 — collaborative specification, prepared before implementation.
> **Audience:** The engineer-owner and any AI/human implementer building Tessera.
> **One-line goal:** An attractive, browser-based, internal-use precast concrete design tool
> that uses a forked OpenSees as its FEA engine and the Devalapura–Tadros / PCI **power
> formula** for flexural strength, hosted on GitHub Pages.

---

## 0. How to use this document

This is the authoritative prompt/spec for building **Tessera**. Implement in the phases
defined in §12. Treat every "MUST" as a hard requirement and every "SHOULD" as a strong
default that may be revisited with the owner. Where a decision is still open it is listed in
§14 — do **not** silently pick a different answer than what is recorded there.

Tessera is **structural design software**. Correctness and transparency outrank cleverness:
every reported capacity MUST be traceable to a code clause (ACI 318‑19 / PCI Handbook 8th
Ed.) and a shown formula, every numerical solver MUST report convergence, and units MUST be
explicit and consistent at all times.

### Decisions ratified so far (owner)
- **Repo location:** Tessera lives in a **`/tessera` subdirectory of this OpenSees fork** (§11).
- **Hosting posture:** simplest route — **public repo / public app code; all project data stays
  local in the browser** (no private-Pages plan) (§2.3).
- **DXF reinforcement:** **no layer-name parsing.** DXF `POINT`s create **generic reinforcement
  placeholders**; the user assigns type/size/grade/prestress afterward via in-app dialogs (§7).

Items still open are in §14.

---

## 1. Project identity & goals

- **Name:** Tessera.
- **Purpose:** Internal-use design of precast/prestressed concrete members — beams, floor
  members (double-tee, hollowcore), wall panels, columns, and Vierendeel wall panels.
- **FEA engine:** A trimmed build of the forked OpenSees (this repository) compiled to
  **WebAssembly**, used only for finite-element work (frame analysis, fiber-section
  moment–curvature). All closed-form design math runs in TypeScript.
- **Flexural strength method:** The **power formula** (Devalapura–Tadros / PCI continuous
  steel stress–strain model) with ACI 318‑19 strain-compatibility analysis. The reference
  implementation already exists in the owner's `prestressed_beam_power` repository and is
  adopted wholesale (see §8).
- **Hosting:** 100% static single-page app on **GitHub Pages**, built and deployed by
  **GitHub Actions**. No backend, no runtime network dependency.
- **Persistence:** Project state lives in browser memory; the user can **Save** to a `.tsr`
  JSON file, **Load** from one, and **Clear** to start fresh (see §9).
- **Design basis:** **ACI 318‑19** + **PCI Design Handbook, 8th Edition**, **US customary
  units** (kip, in, ksi, psi, kip‑ft).

### Success criteria (definition of done for v1)
1. A user can model a precast beam (drawn, parametric, or DXF-imported), place rebar/strands,
   define loads, and get flexural strength (φMₙ), shear, transfer/service stresses, camber,
   and pass/fail checks with code references.
2. A user can import a section from a DXF file per §7 and design from it.
3. A user can save the whole project to a `.tsr` file, reload it, and clear it.
4. The Vierendeel wall panel is solvable as a frame via the OpenSees-WASM engine, with member
   end forces feeding the sectional design checks.
5. The app deploys automatically to GitHub Pages on push to the default branch.

---

## 2. Architecture & hosting

### 2.1 Computation split (the core architectural rule)
- **TypeScript (client, main thread / light workers):** all code-design math — power-formula
  flexure, section properties, shear, deflection/camber, prestress losses, transfer/service
  stress checks, load combinations, DXF parsing, units, reporting.
- **OpenSees → WebAssembly (Web Worker):** finite-element analysis only — elastic (and later
  fiber/nonlinear) frame analysis for Vierendeel panels and multi-member frames, and
  fiber-section moment–curvature when a higher-fidelity capacity/ductility check is wanted.

The TS layer is the source of truth for the model and for all code checks. The WASM engine is
a pure solver: **model JSON in → results JSON out.** The two are decoupled behind a single
typed interface (`FeaEngine`) so the app remains fully usable for sectional design even before
the WASM engine is complete.

### 2.2 OpenSees → WASM strategy
- Compile a **minimal subset** of OpenSees with **Emscripten** (`emcc`). Target, in order:
  1. Linear-elastic 2D then 3D frame analysis (`elasticBeamColumn`, nodes, supports, nodal &
     element loads, static analysis, `BandGeneral`/`ProfileSPD`/Eigen-backed solver).
  2. Fiber sections + `forceBeamColumn`/`dispBeamColumn` for moment–curvature / nonlinear.
- **Avoid the Fortran toolchain where possible.** OpenSees already vendors **Eigen**
  (`OTHER/eigenAPI/eigen`); prefer C++/Eigen-based linear solvers and OpenSees `*LinSOE`
  options that do not require LAPACK/ARPACK/MUMPS. Treat eliminating/replacing Fortran
  dependencies (or compiling the few required routines via an Emscripten-compatible path,
  e.g. f2c'd CLAPACK or LFortran) as an explicit Phase‑3 spike with a go/no-go gate.
- Expose a **narrow C/C++ API** (or a thin scripted command layer) compiled to WASM that:
  builds a model from a flat description (nodes, elements, materials, sections, transforms,
  loads, supports), runs the requested analysis, and returns nodal displacements, reactions,
  and element end forces. Drive it from a **Web Worker**; load the `.wasm` asynchronously with
  a progress indicator.
- Build the `.wasm` + JS glue in CI (Emscripten SDK action) and publish as static assets.

> **Risk note:** The WASM build is the highest-risk item. The app MUST deliver full sectional
> design value (Phases 0–2) without it. The frame engine (Phase 3) begins with a throwaway
> spike that proves a single elastic portal-frame solve in the browser before committing.

### 2.3 Hosting & privacy posture (decided)
- GitHub Pages serves static files; Tessera is built to fit that exactly.
- **Decision:** host from a **public** repo and accept that the *application code* is public.
  This is acceptable because **project data never leaves the browser** — Tessera makes no
  server calls and never uploads anything; `.tsr` files are read/written locally on the user's
  machine. (Private/access-controlled Pages, which would need a paid GitHub plan, is explicitly
  not pursued.)

---

## 3. Technology stack (recommended defaults)

- **Framework:** React 18 + **TypeScript**, built with **Vite** (matches the existing app's
  Vite/Vitest setup; existing engine is JS and is **ported to TS** preserving its test suite).
- **State:** Zustand store as the single in-memory project model; selectors for derived data.
- **Validation:** **zod** schemas for the `.tsr` file and the FEA engine I/O, with versioned
  migrations.
- **2D section editor & diagrams:** Canvas/SVG (adopt/extend `SectionDrawer.jsx` and the
  strain/stress-strain/interaction diagram components).
- **3D frame view:** **three.js** via **react-three-fiber** (member rendering, local axes,
  deformed shape, force diagrams).
- **DXF:** adopt the existing `dxfParser.js` / `dxfGeometry.js`; extend per §7.
- **Reporting:** adopt/extend `generatePdfReport.js` (calc package output).
- **Styling/UI:** **Tailwind CSS + shadcn/ui** (or equivalent) for a polished, consistent,
  accessible interface. Use the `artifact-design` design process for the visual system.
- **Testing:** **Vitest** (unit, engine parity) + **Playwright** (e2e flows: import → design →
  save/load). Keep and grow the ported engine tests.
- **FEA worker:** dedicated Web Worker hosting the OpenSees-WASM module behind the `FeaEngine`
  interface.

---

## 4. Domain model

```
Project
 ├─ meta            { name, project#, engineer, date, schemaVersion, appVersion }
 ├─ settings        { units: "US", code: "ACI318-19", … }
 ├─ materials       Concrete[]  (f'c, f'ci, wc, λ, Ec …)
 │                  Steel[]     (presets + custom: Es, fpu, fpy, stressCap, Q, R, K, defaultFse)
 ├─ sections        Section[]   (parametric | custom-polygon | dxf)  — see §5/§7
 ├─ members         Member[]    (type, geometry, localAxis, sectionRef, reinforcement,
 │                               supports, loads, designParams)   — see §5
 ├─ loadCases       LoadCase[]  and loadCombos LoadCombo[] (ACI 318-19 §5.3)
 └─ results         (optional cached analysis/design results, regenerable)
```

### 4.1 Member local axes (RISA-3D convention) — MUST
Every member/element has a **local coordinate system**:
- **Local x:** longitudinal axis, from node **I → node J**.
- **Local y, z:** transverse principal axes; the cross-section is drawn in the local **y–z**
  plane. Local **y** is the strong/major bending axis direction by default.
- **Roll/rotation angle (β):** rotation of the section about local x, exactly like RISA-3D's
  member rotation, to orient the section relative to global axes.
- Document and consistently apply sign conventions for axial, shear (Vy, Vz), torsion, and
  bending (My, Mz). The section depth/extreme-compression-fiber convention used by the power
  formula engine (y measured downward from the top fiber) MUST map cleanly onto the local axes.
- 3D view renders each member's local triad (RISA-style colored axes).

---

## 5. Member types (v1 scope)

Each type defines: geometry parameters, how its section is formed, which design checks apply,
and how (if at all) it maps to an OpenSees frame model.

1. **Precast beam** — rectangular, L-beam, inverted-tee, ledger. Pretensioned and/or mild
   reinforced. Checks: flexure (power formula), shear, transfer & service stresses, camber/
   deflection, min reinforcement (1.2Mcr / 1.33Mu).
2. **Floor member** — **double-tee** and **hollowcore**. Pretensioned. Same checks as beams
   plus topping/composite option (later), and span/depth & service deflection emphasis. (The
   engine already models `doubletee` and `hollowcore` section geometry.)
3. **Wall panel** — solid and sandwich precast/prestressed panels under axial + flexure
   (out-of-plane and handling). Checks: combined P‑M, handling/stripping stresses, service
   stresses. (Engine already models `sandwich` geometry.)
4. **Column / pile** — axial + **biaxial** flexure. Requires **P‑M‑M interaction**. The engine
   already sweeps a φMx–φMy flexural envelope; this MUST be **extended to include applied axial
   load N** to produce a true P‑M interaction surface (the current biaxial path assumes
   ΣF_internal = 0 / no external axial).
5. **Vierendeel wall panel** — a vertical panel with **parametric openings**, idealized as an
   **equivalent moment frame**: vertical **piers/legs** between openings and horizontal
   **spandrels/sills** above/below openings, connected by **rigid end offsets ("rigid links")**
   at the finite joint regions where members overlap. Resists load by **Vierendeel action**
   (moment frame, no diagonals). This member MUST be solved by the **OpenSees-WASM frame
   engine**; resulting member end forces feed the per-member sectional design checks above.
   Parametric inputs: panel width/height/thickness, opening grid (positions/sizes), pier and
   spandrel widths, support conditions, in/out-of-plane loads.

---

## 6. Design engine (ACI 318‑19 + PCI 8th)

- **Flexure (have it):** adopt the power-formula engine (§8) for φMₙ, neutral axis, per-layer
  strains/stresses, εt, φ, c/d ductility, Mcr, and the §9.6.1.3 minimum-strength check, for
  rectangular, T, sandwich, double-tee, hollowcore, custom-polygon, and DXF sections, uniaxial
  and biaxial.
- **Shear (build):** ACI 318‑19 Ch. 22 — Vc (incl. prestress effects / simplified or
  Vci–Vcw), Vs, φVn, stirrup design and spacing limits.
- **Torsion (build, later):** ACI 318‑19 §22.7 where relevant.
- **Prestress losses (build):** PCI/ACI — elastic shortening, creep, shrinkage, relaxation
  (lump-sum option + refined option). Feeds effective prestress `fse` per strand layer.
- **Transfer & service stresses (build):** ACI 318‑19 §24.5 allowable compressive/tensile
  fiber stresses at transfer (with f'ci) and at service; top & bottom fiber checks.
- **Deflection / camber (build):** PCI multipliers, prestress camber, dead/live deflection,
  long-term; span/depth and L/Δ checks.
- **Axial + flexure (build):** P‑M (walls) and P‑M‑M (columns) interaction; extend the biaxial
  engine to apply N.
- **Higher-fidelity capacity (optional, via WASM):** fiber-section moment–curvature to confirm
  ductility/φMₙ and produce M–φ curves.

Every check returns: governing equation, code clause, demand, capacity, utilization, and a
pass/transition/fail status. Non-convergence is surfaced, never hidden.

---

## 7. DXF import specification

Goal: a DXF drawing defines a section's concrete shape and openings, and **marks where**
reinforcement goes. Properties of that reinforcement are assigned **in the app**, not in the DXF.

- **Concrete outline:** the single **outer closed polyline** (`LWPOLYLINE`/`POLYLINE`, closed)
  → outer ring → `section.points`.
- **Openings/voids:** each **inner closed polyline** → a hole → `section.holes[i]`.
- **Reinforcement (kept deliberately simple — no layer parsing):** each **`POINT` entity**
  creates **one generic reinforcement placeholder** at its `{ x, depth }` location (mapped into
  the engine's top-fiber-down convention). **No layer names, attributes, or text are
  interpreted** to infer type/size/grade. Each placeholder imports with neutral defaults
  (e.g. unassigned bar, area 0, `fse` 0).
- **Post-import assignment (in-app dialogs):** after import, the user selects placeholders
  (individually or in bulk) and assigns: **type** (mild bar vs. prestressing strand), **size**
  (standard bar # or strand diameter → area), **grade** (the `steelPresets` catalog), and
  **effective prestress `fse`** / debonding. This is where a point "becomes" a #5 bar, a
  0.6″ Gr 270 strand, etc. Provide sensible defaults and bulk-edit.
- **Mapping target:** `{ sectionType: 'dxf', points, holes }` + `steelLayers:[{area, depth, x,
  fse, grade}]` — i.e. exactly the engine's existing polygon/biaxial input. (The engine's
  `isPolygonSection()` already treats `'dxf'` and `'custom'` identically.) On import, `area`/
  `grade`/`fse` are placeholders until the user assigns them.
- **Geometry handling:** unit scaling, origin selection, Y-axis flip (DXF Y-up → section
  top-down), polyline arc/bulge handling, winding/orientation normalization, and validation
  (exactly one outer ring; holes inside outer; points inside concrete). Reuse and extend
  `dxfParser.js` / `dxfGeometry.js`; keep their tests green and add fixtures.
- Provide an import preview showing the detected outline, openings, and reinforcement points
  before the user accepts and then assigns properties.

---

## 8. Adopting the existing power-formula engine

The owner's `prestressed_beam_power` repo (`skills/power-formula/` + `src/`) is the reference.
**Port these into Tessera's TS engine, preserving behavior and tests:**
- `beamCalculations.js` → all of: `beta1`, `concreteModulus`, `phiFactor`,
  `powerFormulaStress`, `steelStrain`, `decompressionStrains`, `concreteCompression`,
  `compressionCentroid`, `analyzeBeam`, `grossSectionProperties`, `prestressAndCracking`,
  polygon helpers (`polygonAreaAboveDepth`, `polygonCentroidAboveDepth`, `polygonProperties`),
  and the full biaxial suite (`sectionToPolygon`, `polygonFullProperties`,
  `biaxialAtOrientation`, `analyzeBiaxial`, `biaxialCracking`, `biaxialDecompStrains`).
- `steelPresets.js` → the 6 presets (Gr 60/65/70 mild; Gr 150/250/270 prestressing) with
  `{ Es, fpu, fpy, stressCap, Q, R, K, defaultFse }`; allow user-defined custom grades.
- `dxfParser.js`, `dxfGeometry.js`, `generatePdfReport.js`, and the component patterns
  (`SectionDrawer`, `BeamInputForm`, `StrainDiagram`, `StressStrainChart`,
  `InteractionDiagram`, `DesignGauges`, `ResultsPanel`, `BiaxialResults`, `DxfImporter`,
  `ExportDialog`).

**Power formula (record verbatim):**
```
fs = Es·εs · [ Q + (1 − Q) / ( 1 + (Es·εs / (K·fpy))^R )^(1/R) ]      (≤ stressCap)
stressCap = fpy (mild steel) | fpu (prestressing steel)
```
Strain compatibility: `εsi = εcu·(di/c − 1) + fse/Es + εdecomp`, with `εcu = 0.003`; neutral
axis `c` solved by bisection on ΣF = 0; `φMn` via ACI 318‑19 §21.2.

**Engine boundary:** keep the engine **pure and UI-free** (plain functions, JSON in/out) so it
can run on the main thread, in a worker, and in tests. The existing JSON job schema is the
contract:
```jsonc
// uniaxial
{ "section": { "sectionType":"rectangular","bf":12,"bw":12,"hf":24,"h":24,"fc":5,"lambda":1,"Mu":150 },
  "steelLayers": [ { "area":0.918,"depth":21,"fse":170,"grade":"grade270" } ] }
// biaxial adds per-layer "x", "mode":"biaxial", and "biaxial":{Mux,Muy,MxService,MyService}
```

**Known gaps to extend (do not assume the engine covers these):** shear, torsion, deflection/
camber, prestress losses, transfer/service stresses, anchorage/development, and **applied
axial load** in the biaxial interaction (columns/walls).

---

## 9. File format `.tsr` (Tessera project file)

- **Extension:** `.tsr`. **Format:** UTF‑8 JSON. **MIME:** `application/json`.
- **Top-level shape** (zod-validated, versioned):
  ```jsonc
  {
    "format": "tessera-project",
    "schemaVersion": 1,
    "appVersion": "x.y.z",
    "meta": { "name": "...", "project": "...", "engineer": "...", "createdISO": "...", "modifiedISO": "..." },
    "settings": { "units": "US", "code": "ACI318-19" },
    "materials": { "concrete": [ ... ], "steel": [ ... ] },
    "sections": [ ... ],
    "members": [ ... ],
    "loadCases": [ ... ],
    "loadCombos": [ ... ],
    "results": { /* optional cache, regenerable */ }
  }
  ```
- **Behavior — MUST:**
  - Project state held in browser memory (Zustand store) as the single source of truth.
  - **Save:** serialize store → download a `.tsr` Blob (use the **File System Access API** when
    available for true "Save/Save As"; fall back to anchor download).
  - **Load:** open `.tsr` via File API → validate with zod → migrate by `schemaVersion` →
    replace store. Reject/explain invalid files; never partially load silently.
  - **Clear:** reset store to an empty project after an unsaved-changes confirmation.
  - Track a dirty flag and warn on unload/navigation when unsaved.
  - No autosave to any server; everything is local.

---

## 10. GUI / UX

- **Layout:** left **project/model tree** (members, sections, materials, loads); central
  **canvas** (2D section editor and/or 3D frame view, toggleable); right **inspector**
  (properties of the selected entity); bottom/side **results & checks** panel; top **toolbar**
  (New/Open/Save/Clear, units, code, run analysis, report).
- **Core workflows:**
  1. New project → add member → choose type → define section (parametric, draw, or DXF) →
     place reinforcement → assign materials → define loads/combos → review checks → report.
  2. DXF import → preview → accept → design.
  3. Vierendeel/frame → define topology & openings → run FEA → review member forces → per-
     member checks.
- **Visualization:** section with rebar/strands, strain diagram, stress–strain curve, moment–
  curvature (when WASM), φMx–φMy / P‑M interaction, RISA-style local axes, deformed shape and
  force diagrams for frames, **design gauges** (utilization), clear pass/fail color coding.
- **Quality bar:** "attractive and user-friendly" — coherent visual system, sensible defaults,
  keyboard-friendly, responsive, accessible (WCAG AA), helpful empty states, inline code
  references. Use the `artifact-design` process to define the token system before building.
- **Reporting:** generate a clean calc package (PDF) per member: inputs, section, materials,
  governing equations with ACI/PCI clauses, results, and pass/fail summary.

---

## 11. Repository & deployment

- **Location (decided):** build Tessera as the **`/tessera` subdirectory of this** OpenSees
  fork, so the WASM build can reference OpenSees source and the whole thing ships from one repo.
- **GitHub Actions:**
  - `web-deploy.yml`: install Node, build the Vite app, deploy to **GitHub Pages**
    (`actions/configure-pages`, `actions/deploy-pages`). Set Vite `base` to the repo/Pages path.
  - `wasm-build.yml` (Phase 3): set up Emscripten SDK, build the trimmed OpenSees → `.wasm`,
    publish as a build artifact consumed by `web-deploy`.
  - Keep the existing OpenSees `build_cmake.yml` for the native engine/tests.
- **Branching:** develop on `claude/compassionate-newton-uvywxx`; open a **draft PR** after the
  first push.

---

## 12. Phased roadmap

- **Phase 0 — Scaffold & rails.** Vite + React + TS app in `/tessera`; Tailwind/shadcn; Zustand
  store; zod; units module (US customary, explicit & tested); CI deploy of a "hello Tessera" to
  GitHub Pages; port the power-formula engine + `steelPresets` to TS with the existing tests
  passing; implement `.tsr` Save/Load/Clear with schema validation.
- **Phase 1 — Single-member flexure parity + checks.** Beam member with parametric/drawn/DXF
  section; reinforcement & strand layers; flexure (power formula) results & diagrams; add
  shear, transfer/service stresses, camber/deflection, min-reinforcement; PDF report; member
  abstraction with local axes (§4.1). Reach feature parity with `prestressed_beam_power`, then
  exceed it.
- **Phase 2 — Member library.** Double-tee/hollowcore floor, wall panel (P‑M), column (P‑M‑M;
  extend biaxial engine with axial load), full DXF convention (§7). Load cases & ACI 318‑19
  load combinations.
- **Phase 3 — FEA engine (WASM).** Spike: prove a minimal elastic frame solve in-browser
  (go/no-go on Fortran-elimination). Then: `FeaEngine` worker, model build/extract, elastic 2D
  then 3D frames; integrate fiber-section moment–curvature.
- **Phase 4 — Frames, Vierendeel & polish.** Vierendeel wall panel (equivalent frame + rigid
  links) solved via WASM, member forces → sectional checks; 3D viewport (deformed shape, force
  diagrams, local axes); multi-member project management; reporting polish; UX refinement.

---

## 13. Non-functional requirements & engineering guardrails

- **Correctness/transparency:** show formulas and ACI/PCI clause numbers; cite editions; report
  solver convergence (`converged === true` before reporting capacity); never silently
  approximate.
- **Units discipline:** one internal unit system (US customary: kip, in, ksi); explicit unit
  labels in UI and reports; conversion helpers are tested.
- **Determinism & offline:** no runtime network calls; identical inputs → identical outputs;
  app works fully offline once loaded.
- **Privacy:** project data never leaves the browser (see §2.3 hosting caveat).
- **Testing:** engine parity tests vs. the reference app and vs. PCI/ACI hand examples;
  property/edge tests for bisection convergence; e2e for import→design→save/load.
- **Performance:** keep the UI responsive; run FEA and heavy sweeps in workers; lazy-load the
  WASM module.
- **Accessibility & responsiveness:** WCAG AA; usable on a laptop and a large tablet.
- **Maintainability:** engine is pure/UI-free; typed interfaces between UI, engine, and FEA;
  documented `.tsr` schema with migrations.

---

## 14. Open decisions to confirm with the owner

**Already ratified (see §0 "Decisions ratified so far"):** repo location (`/tessera` subdir),
hosting posture (public repo, local-only data), and DXF reinforcement (generic placeholders,
no layer parsing). Still open:

1. **Engine language:** port the JS engine to **TypeScript** (recommended) vs. keep JS with
   JSDoc/`ts-check`.
2. **UI library:** Tailwind + shadcn/ui (recommended) vs. MUI vs. other.
3. **Prestress-loss method** for v1: PCI lump-sum (fast) vs. refined time-step.
4. **Column P‑M‑M:** confirm extending the biaxial sweep with applied axial load N as the
   approach for the interaction surface.
5. **Composite/topping** behavior for floor members: in v1 or deferred.

---

*End of draft. Revise §14 first; everything downstream depends on those answers.*
