/**
 * End-to-end numeric tests of the WASM solver(s), driven through the public
 * `FeaEngine` contract. Validates against closed-form structural solutions
 * (Euler-Bernoulli beam theory + static equilibrium) and cross-checks the two
 * engines against each other:
 *   - `feaEngine.*`      — production: OpenSees subset (StaticAnalysis + ProfileSPD)
 *   - `feaEngineEigen.*` — oracle: self-contained Eigen direct-stiffness solver
 *
 * Modules are loaded from `public/fea`. If not built yet (fresh checkout), the
 * relevant suites skip so `npm test` stays green without the toolchain. CI
 * builds both first, so these run for real there.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDirectFeaEngine, type FeaEngine, type FeaModuleFactory } from './FeaEngine';
import { buildPortalFrame, buildSimpleBeam } from './feaBuilders';
import { normalizeFeaModel, normalizeMomentCurvatureSpec } from './feaModel';
import { discretizeConcreteFibers } from '@/engine/beamCalculations';
import { assembleBeamDiagram, computeMemberDiagrams, diagramExtreme, interpolateDiagram } from './feaDiagrams';

const mjsPath = (base: string) => fileURLToPath(new URL(`../../public/fea/${base}.mjs`, import.meta.url));
const wasmPath = (base: string) => fileURLToPath(new URL(`../../public/fea/${base}.wasm`, import.meta.url));
const isBuilt = (base: string) => existsSync(mjsPath(base)) && existsSync(wasmPath(base));

function makeEngine(base: string): FeaEngine {
  return createDirectFeaEngine(
    async () => {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(mjsPath(base)).href)) as {
        default: FeaModuleFactory;
      };
      return mod.default;
    },
    { locateFile: () => wasmPath(base) },
  );
}

const near = (a: number, b: number, rel = 1e-4, abs = 1e-9) =>
  Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));

const ENGINES = [
  { name: 'OpenSees (production)', base: 'feaEngine', solverRe: /OpenSees/ },
  { name: 'Eigen (oracle)', base: 'feaEngineEigen', solverRe: /Eigen/ },
].filter((e) => isBuilt(e.base));

// Capability probe: moment–curvature is a newer binding, so skip those suites if
// the built module predates it (stale local artifact) rather than fail. CI builds
// fresh, so they run there.
let feaEngineHasMomentCurvature = false;
if (isBuilt('feaEngine')) {
  try {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(mjsPath('feaEngine')).href)) as {
      default: FeaModuleFactory;
    };
    const instance = (await mod.default({ locateFile: () => wasmPath('feaEngine') })) as Partial<
      Record<'momentCurvature', unknown>
    >;
    feaEngineHasMomentCurvature = typeof instance.momentCurvature === 'function';
  } catch {
    feaEngineHasMomentCurvature = false;
  }
}

describe.skipIf(ENGINES.length === 0)('WASM elastic 2D frame solve (closed-form parity)', () => {
  for (const eng of ENGINES) {
    describe(eng.name, () => {
      it('cantilever tip load: deflection, base reactions, element end forces', async () => {
        const engine = makeEngine(eng.base);
        const E = 29000, I = 100, A = 10, L = 100, P = -10;
        const r = await engine.solve({
          nodes: [
            { id: 'b', x: 0, y: 0 },
            { id: 't', x: L, y: 0 },
          ],
          materials: [{ id: 'm', E }],
          sections: [{ id: 's', A, I }],
          elements: [{ id: 'e', nodeI: 'b', nodeJ: 't', materialId: 'm', sectionId: 's' }],
          supports: [{ nodeId: 'b', dx: true, dy: true, rz: true }],
          nodalLoads: [{ nodeId: 't', fy: P }],
        });
        expect(r.converged).toBe(true);
        expect(r.solver).toMatch(eng.solverRe);

        const tip = r.nodalDisplacements.find((d) => d.nodeId === 't')!;
        expect(near(tip.dy, (P * L ** 3) / (3 * E * I))).toBe(true); // PL³/3EI

        const base = r.reactions.find((x) => x.nodeId === 'b')!;
        expect(near(base.fy, -P)).toBe(true);
        expect(near(Math.abs(base.mz), Math.abs(P * L))).toBe(true);

        const ef = r.elementForces.find((e) => e.elementId === 'e')!;
        expect(near(Math.abs(ef.iV), Math.abs(P))).toBe(true);
        expect(near(Math.abs(ef.iM), Math.abs(P * L))).toBe(true);
        engine.dispose();
      });

      it('simply-supported beam under UDL: midspan deflection, reactions, moment', async () => {
        const engine = makeEngine(eng.base);
        const E = 29000, I = 200, A = 10, L = 120, w = 0.01;
        const r = await engine.solve(buildSimpleBeam({ length: L, segments: 4, E, A, I, udl: w }));
        expect(r.converged).toBe(true);

        const mid = r.nodalDisplacements.find((d) => d.nodeId === 'n2')!;
        expect(near(mid.dy, (-5 * w * L ** 4) / (384 * E * I), 2e-3)).toBe(true); // 5wL⁴/384EI

        const ra = r.reactions.find((x) => x.nodeId === 'n0')!;
        const rc = r.reactions.find((x) => x.nodeId === 'n4')!;
        expect(near(ra.fy, (w * L) / 2)).toBe(true);
        expect(near(rc.fy, (w * L) / 2)).toBe(true);

        const e1 = r.elementForces.find((e) => e.elementId === 'e1')!;
        expect(near(Math.abs(e1.jM), (w * L ** 2) / 8, 1e-3)).toBe(true); // wL²/8
        engine.dispose();
      });

      it('fixed-base portal frame under lateral load: global static equilibrium', async () => {
        const engine = makeEngine(eng.base);
        const H = 144, span = 240, lateral = 5;
        const model = buildPortalFrame({ span, height: H, E: 29000, A: 12, I: 300, lateralLoad: lateral });
        const r = await engine.solve(model);
        expect(r.converged).toBe(true);

        const sumFx = r.reactions.reduce((a, x) => a + x.fx, 0);
        const sumFy = r.reactions.reduce((a, x) => a + x.fy, 0);
        expect(near(sumFx, -lateral)).toBe(true); // ΣFx + applied = 0
        expect(near(sumFy, 0, 1, 1e-6)).toBe(true);

        const Mreact = r.reactions.reduce((a, x) => {
          const node = model.nodes.find((n) => n.id === x.nodeId)!;
          return a + x.mz + (node.x * x.fy - node.y * x.fx);
        }, 0);
        expect(near(Mreact, H * lateral, 1e-4, 1e-4)).toBe(true);

        const tl = r.nodalDisplacements.find((d) => d.nodeId === 'tl')!;
        const tr = r.nodalDisplacements.find((d) => d.nodeId === 'tr')!;
        expect(tl.dx).toBeGreaterThan(0);
        expect(tr.dx).toBeGreaterThan(0);
        engine.dispose();
      });

      it('reports non-convergence for an unstable (under-restrained) model rather than throwing', async () => {
        const engine = makeEngine(eng.base);
        const r = await engine.solve({
          nodes: [
            { id: 'a', x: 0, y: 0 },
            { id: 'b', x: 100, y: 0 },
          ],
          materials: [{ id: 'm', E: 29000 }],
          sections: [{ id: 's', A: 10, I: 100 }],
          elements: [{ id: 'e', nodeI: 'a', nodeJ: 'b', materialId: 'm', sectionId: 's' }],
          nodalLoads: [{ nodeId: 'b', fy: -5 }],
        });
        expect(r.converged).toBe(false);
        expect(r.message.length).toBeGreaterThan(0);
        engine.dispose();
      });
    });
  }
});

// Cross-engine parity: the production OpenSees engine and the Eigen oracle must
// agree to round-off on the same model (build spec — the oracle's purpose).
describe.skipIf(!isBuilt('feaEngine') || !isBuilt('feaEngineEigen'))(
  'OpenSees ↔ Eigen oracle parity',
  () => {
    it('portal frame: nodal displacements and reactions match', async () => {
      const os = makeEngine('feaEngine');
      const eig = makeEngine('feaEngineEigen');
      const model = buildPortalFrame({
        span: 240,
        height: 144,
        E: 29000,
        A: 12,
        I: 300,
        lateralLoad: 8,
        beamGravity: 0.05,
      });
      const [a, b] = await Promise.all([os.solve(model), eig.solve(model)]);

      for (const da of a.nodalDisplacements) {
        const db = b.nodalDisplacements.find((d) => d.nodeId === da.nodeId)!;
        expect(near(da.dx, db.dx, 1e-6, 1e-9)).toBe(true);
        expect(near(da.dy, db.dy, 1e-6, 1e-9)).toBe(true);
        expect(near(da.rz, db.rz, 1e-6, 1e-9)).toBe(true);
      }
      for (const ra of a.reactions) {
        const rb = b.reactions.find((r) => r.nodeId === ra.nodeId)!;
        expect(near(ra.fx, rb.fx, 1e-5, 1e-6)).toBe(true);
        expect(near(ra.fy, rb.fy, 1e-5, 1e-6)).toBe(true);
        expect(near(ra.mz, rb.mz, 1e-5, 1e-6)).toBe(true);
      }
      os.dispose();
      eig.dispose();
    });
  },
);

// 3D frames — production (OpenSees) engine only; closed-form parity for bending
// about each local axis, torsion, and axial, plus 3D static equilibrium.
describe.skipIf(!isBuilt('feaEngine'))('WASM elastic 3D frame solve (OpenSees, closed-form parity)', () => {
  const E = 29000, G = 11153.846, A = 10, Iz = 100, Iy = 50, J = 20, L = 100;
  // Cantilever along global X with local x=X, y=Y, z=Z (vecxz = global Z).
  const cantilever = (load: Record<string, number>) => ({
    dimension: 3 as const,
    nodes: [
      { id: 'b', x: 0, y: 0, z: 0 },
      { id: 't', x: L, y: 0, z: 0 },
    ],
    materials: [{ id: 'm', E, G }],
    sections: [{ id: 's', A, I: Iz, Iy, J }],
    elements: [{ id: 'e', nodeI: 'b', nodeJ: 't', materialId: 'm', sectionId: 's', vecxz: [0, 0, 1] as [number, number, number] }],
    supports: [{ nodeId: 'b', dx: true, dy: true, dz: true, rx: true, ry: true, rz: true }],
    nodalLoads: [{ nodeId: 't', ...load }],
  });

  it('strong-axis bending (load in local −y): tip dy = PL³/3EIz, base Mz = PL', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.solve(cantilever({ fy: -10 }));
    expect(r.converged).toBe(true);
    const t = r.nodalDisplacements.find((d) => d.nodeId === 't')!;
    expect(near(t.dy, (-10 * L ** 3) / (3 * E * Iz))).toBe(true);
    expect(near(t.dz ?? 0, 0, 1, 1e-6)).toBe(true);
    const e = r.elementForces.find((x) => x.elementId === 'e')!;
    expect(near(Math.abs(e.iM), 10 * L)).toBe(true); // |Mz| = PL
    expect(near(e.iT ?? 0, 0, 1, 1e-6)).toBe(true);
    expect(near(e.iMy ?? 0, 0, 1, 1e-6)).toBe(true);
    engine.dispose();
  });

  it('weak-axis bending (load in local −z): tip dz = PL³/3EIy, base My = PL', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.solve(cantilever({ fz: -10 }));
    expect(r.converged).toBe(true);
    const t = r.nodalDisplacements.find((d) => d.nodeId === 't')!;
    expect(near(t.dz ?? 0, (-10 * L ** 3) / (3 * E * Iy))).toBe(true);
    expect(near(t.dy, 0, 1, 1e-6)).toBe(true);
    const e = r.elementForces.find((x) => x.elementId === 'e')!;
    expect(near(Math.abs(e.iMy ?? 0), 10 * L)).toBe(true); // |My| = PL
    engine.dispose();
  });

  it('torsion: tip twist rx = TL/GJ, base T = applied torque', async () => {
    const engine = makeEngine('feaEngine');
    const torque = 500;
    const r = await engine.solve(cantilever({ mx: torque }));
    expect(r.converged).toBe(true);
    const t = r.nodalDisplacements.find((d) => d.nodeId === 't')!;
    expect(near(t.rx ?? 0, (torque * L) / (G * J))).toBe(true);
    const e = r.elementForces.find((x) => x.elementId === 'e')!;
    expect(near(Math.abs(e.iT ?? 0), torque)).toBe(true);
    engine.dispose();
  });

  it('axial: tip dx = PL/EA, axial force N = P', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.solve(cantilever({ fx: 100 }));
    expect(r.converged).toBe(true);
    const t = r.nodalDisplacements.find((d) => d.nodeId === 't')!;
    expect(near(t.dx, (100 * L) / (E * A))).toBe(true);
    const e = r.elementForces.find((x) => x.elementId === 'e')!;
    expect(near(Math.abs(e.iN), 100)).toBe(true);
    engine.dispose();
  });

  it('3D L-frame: reactions balance an applied 3-component tip force', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.solve({
      dimension: 3,
      nodes: [
        { id: 'a', x: 0, y: 0, z: 0 },
        { id: 'b', x: 120, y: 0, z: 0 },
        { id: 'c', x: 120, y: 0, z: 96 },
      ],
      materials: [{ id: 'm', E, G }],
      sections: [{ id: 's', A, I: Iz, Iy, J }],
      elements: [
        { id: 'e1', nodeI: 'a', nodeJ: 'b', materialId: 'm', sectionId: 's' },
        { id: 'e2', nodeI: 'b', nodeJ: 'c', materialId: 'm', sectionId: 's' },
      ],
      supports: [{ nodeId: 'a', dx: true, dy: true, dz: true, rx: true, ry: true, rz: true }],
      nodalLoads: [{ nodeId: 'c', fx: 3, fy: -5, fz: 2 }],
    });
    expect(r.converged).toBe(true);
    const R = r.reactions.find((x) => x.nodeId === 'a')!;
    expect(near(R.fx, -3)).toBe(true);
    expect(near(R.fy, 5)).toBe(true);
    expect(near(R.fz ?? 0, -2)).toBe(true);
    engine.dispose();
  });

  it('rejects a 3D model missing G / Iy / J', async () => {
    const engine = makeEngine('feaEngine');
    await expect(
      engine.solve({
        dimension: 3,
        nodes: [
          { id: 'b', x: 0, y: 0, z: 0 },
          { id: 't', x: L, y: 0, z: 0 },
        ],
        materials: [{ id: 'm', E }], // missing G
        sections: [{ id: 's', A, I: Iz }], // missing Iy, J
        elements: [{ id: 'e', nodeI: 'b', nodeJ: 't', materialId: 'm', sectionId: 's' }],
        supports: [{ nodeId: 'b', dx: true, dy: true, dz: true, rx: true, ry: true, rz: true }],
        nodalLoads: [{ nodeId: 't', fy: -10 }],
      }),
    ).rejects.toThrow(/missing shear modulus G|missing Iy|missing torsional constant J/);
    engine.dispose();
  });
});

// Member-load library (B3) — concentrated point loads and partial / trapezoidal
// distributed loads, validated against closed-form cantilever solutions.
describe.skipIf(!isBuilt('feaEngine'))('WASM member loads — point & partial/trapezoidal (OpenSees)', () => {
  const E = 29000, I = 100, Iy = 50, A = 10, J = 20, G = 11153.846, L = 100;
  const cant2d = (extra: Record<string, unknown>) => ({
    dimension: 2 as const,
    nodes: [{ id: 'b', x: 0, y: 0 }, { id: 't', x: L, y: 0 }],
    materials: [{ id: 'm', E }],
    sections: [{ id: 's', A, I }],
    elements: [{ id: 'e', nodeI: 'b', nodeJ: 't', materialId: 'm', sectionId: 's' }],
    supports: [{ nodeId: 'b', dx: true, dy: true, rz: true }],
    ...extra,
  });
  const tip = (r: Awaited<ReturnType<FeaEngine['solve']>>) =>
    r.nodalDisplacements.find((d) => d.nodeId === 't')!;
  const ef = (r: Awaited<ReturnType<FeaEngine['solve']>>) =>
    r.elementForces.find((x) => x.elementId === 'e')!;

  it('point load at the tip: dy = PL³/3EI, base M = PL', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.solve(cant2d({ elementPointLoads: [{ elementId: 'e', at: 1, py: -10 }] }));
    expect(r.converged).toBe(true);
    expect(near(tip(r).dy, (-10 * L ** 3) / (3 * E * I))).toBe(true);
    expect(near(Math.abs(ef(r).iM), 10 * L)).toBe(true);
    engine.dispose();
  });

  it('point load at midspan: dy = 5PL³/48EI, base M = P·a', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.solve(cant2d({ elementPointLoads: [{ elementId: 'e', at: 0.5, py: -10 }] }));
    expect(near(tip(r).dy, (5 * -10 * L ** 3) / (48 * E * I))).toBe(true);
    expect(near(Math.abs(ef(r).iM), 10 * (0.5 * L))).toBe(true);
    engine.dispose();
  });

  it('full-span partial load equals a uniform load: dy = wL⁴/8EI', async () => {
    const engine = makeEngine('feaEngine');
    const w = -0.02;
    const r = await engine.solve(cant2d({ elementPartialLoads: [{ elementId: 'e', a: 0, b: 1, wy: w }] }));
    expect(near(tip(r).dy, (w * L ** 4) / (8 * E * I))).toBe(true);
    expect(near(Math.abs(ef(r).iM), (Math.abs(w) * L ** 2) / 2)).toBe(true);
    engine.dispose();
  });

  it('triangular load (0→w): dy = 11wL⁴/120EI, base M = wL²/3', async () => {
    const engine = makeEngine('feaEngine');
    const w = -0.02;
    const r = await engine.solve(
      cant2d({ elementPartialLoads: [{ elementId: 'e', a: 0, b: 1, wy: 0, wyEnd: w }] }),
    );
    expect(near(tip(r).dy, (11 * w * L ** 4) / (120 * E * I))).toBe(true);
    expect(near(Math.abs(ef(r).iM), (Math.abs(w) * L ** 2) / 3)).toBe(true);
    engine.dispose();
  });

  it('3D point load in local z bends about Iy: dz = PL³/3EIy', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.solve({
      dimension: 3,
      nodes: [{ id: 'b', x: 0, y: 0, z: 0 }, { id: 't', x: L, y: 0, z: 0 }],
      materials: [{ id: 'm', E, G }],
      sections: [{ id: 's', A, I, Iy, J }],
      elements: [{ id: 'e', nodeI: 'b', nodeJ: 't', materialId: 'm', sectionId: 's', vecxz: [0, 0, 1] }],
      supports: [{ nodeId: 'b', dx: true, dy: true, dz: true, rx: true, ry: true, rz: true }],
      elementPointLoads: [{ elementId: 'e', at: 1, pz: -10 }],
    });
    expect(r.converged).toBe(true);
    expect(near(tip(r).dz ?? 0, (-10 * L ** 3) / (3 * E * Iy))).toBe(true);
    expect(near(Math.abs(ef(r).iMy ?? 0), 10 * L)).toBe(true);
    engine.dispose();
  });

  it('rejects a partial load with b ≤ a', async () => {
    const engine = makeEngine('feaEngine');
    await expect(
      engine.solve(cant2d({ elementPartialLoads: [{ elementId: 'e', a: 0.6, b: 0.4, wy: -0.02 }] })),
    ).rejects.toThrow(/needs b > a/);
    engine.dispose();
  });
});

// Member end releases (moment hinges) — releasing an end moment turns a propped
// cantilever (fixed + roller) into a simply-supported beam.
describe.skipIf(!isBuilt('feaEngine'))('WASM member end releases (OpenSees)', () => {
  const E = 29000, I = 100, Iy = 50, A = 10, J = 20, G = 11153.846, L = 100, w = -0.02;
  const beam2d = (releases?: Record<string, boolean>) => ({
    dimension: 2 as const,
    nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: L, y: 0 }],
    materials: [{ id: 'm', E }],
    sections: [{ id: 's', A, I }],
    elements: [{ id: 'e', nodeI: 'a', nodeJ: 'b', materialId: 'm', sectionId: 's', ...(releases ? { releases } : {}) }],
    supports: [{ nodeId: 'a', dx: true, dy: true, rz: true }, { nodeId: 'b', dy: true }],
    elementLoads: [{ elementId: 'e', wy: w }],
  });
  const R = (r: Awaited<ReturnType<FeaEngine['solve']>>, id: string) => r.reactions.find((x) => x.nodeId === id)!;
  const EF = (r: Awaited<ReturnType<FeaEngine['solve']>>) => r.elementForces.find((x) => x.elementId === 'e')!;

  it('no release → propped cantilever: R_a = 5wL/8, base M = wL²/8', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.solve(beam2d());
    expect(r.converged).toBe(true);
    expect(near(Math.abs(R(r, 'a').fy), (5 * Math.abs(w) * L) / 8)).toBe(true);
    expect(near(Math.abs(R(r, 'a').mz), (Math.abs(w) * L ** 2) / 8)).toBe(true);
    expect(near(Math.abs(EF(r).iM), (Math.abs(w) * L ** 2) / 8)).toBe(true);
    engine.dispose();
  });

  it('release Mzi → simply supported: R_a = wL/2, base M = 0 (hinge)', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.solve(beam2d({ Mzi: true }));
    expect(near(Math.abs(R(r, 'a').fy), (Math.abs(w) * L) / 2)).toBe(true);
    expect(near(R(r, 'a').mz, 0, 1, 1e-5)).toBe(true);
    expect(near(EF(r).iM, 0, 1, 1e-5)).toBe(true);
    engine.dispose();
  });

  it('3D release Myi about local y (load in −z) → simply supported: R_a fz = wL/2', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.solve({
      dimension: 3,
      nodes: [{ id: 'a', x: 0, y: 0, z: 0 }, { id: 'b', x: L, y: 0, z: 0 }],
      materials: [{ id: 'm', E, G }],
      sections: [{ id: 's', A, I, Iy, J }],
      elements: [{ id: 'e', nodeI: 'a', nodeJ: 'b', materialId: 'm', sectionId: 's', vecxz: [0, 0, 1], releases: { Myi: true } }],
      supports: [
        { nodeId: 'a', dx: true, dy: true, dz: true, rx: true, ry: true, rz: true },
        { nodeId: 'b', dz: true },
      ],
      elementLoads: [{ elementId: 'e', wy: 0, wz: w }],
    });
    expect(r.converged).toBe(true);
    expect(near(Math.abs((R(r, 'a').fz ?? 0)), (Math.abs(w) * L) / 2)).toBe(true);
    expect(near(R(r, 'a').my ?? 0, 0, 1, 1e-5)).toBe(true);
    expect(near(EF(r).iMy ?? 0, 0, 1, 1e-5)).toBe(true);
    engine.dispose();
  });
});

// End-to-end of the member-workspace path: a designed member modeled as a
// simply-supported beam → real solve → reconstructed diagrams.
describe.skipIf(!isBuilt('feaEngine'))('member diagrams end-to-end (buildSimpleBeam → solve → diagrams)', () => {
  it('UDL beam: moment peaks at +wL²/8 mid-span, shear runs +wL/2 → −wL/2', async () => {
    const engine = makeEngine('feaEngine');
    const L = 360, w = 0.05, E = 4000, A = 200, I = 20000; // member-scale (in, kip/in, ksi)
    const input = buildSimpleBeam({ length: L, segments: 1, E, A, I, udl: w, support: 'simple' });
    const result = await engine.solve(input);
    const [d] = computeMemberDiagrams(normalizeFeaModel(input), result, { stations: 41 });

    expect(d.length).toBe(L);
    const peak = diagramExtreme(d.moment);
    expect(near(peak.value, (w * L ** 2) / 8)).toBe(true); // sagging +
    expect(Math.abs(peak.x - L / 2)).toBeLessThan(L / 40 + 1e-6);
    expect(near(d.shear[0].value, (w * L) / 2)).toBe(true);
    expect(near(d.shear[d.shear.length - 1].value, -(w * L) / 2)).toBe(true);
    engine.dispose();
  });

  it('multi-element assembly: continuous M, plus deflected shape ≈ 5wL⁴/384EI at mid', async () => {
    const engine = makeEngine('feaEngine');
    const L = 360, w = 0.05, E = 4000, A = 200, I = 20000;
    const input = buildSimpleBeam({ length: L, segments: 16, E, A, I, udl: w, support: 'simple' });
    const beam = assembleBeamDiagram(normalizeFeaModel(input), await engine.solve(input), { stations: 3 });

    // Stitched diagrams run the full member, end-to-end.
    expect(beam.length).toBe(L);
    expect(near(beam.shear[0].value, (w * L) / 2)).toBe(true);
    expect(near(interpolateDiagram(beam.moment, L / 2), (w * L ** 2) / 8, 2e-3)).toBe(true);

    // Deflected shape: simply-supported, sags downward, peak at midspan.
    const midDefl = interpolateDiagram(beam.deflection, L / 2);
    expect(midDefl).toBeLessThan(0);
    expect(near(midDefl, (-5 * w * L ** 4) / (384 * E * I), 2e-3)).toBe(true);
    expect(near(beam.deflection[0].value, 0, 1, 1e-6)).toBe(true); // pinned end
    engine.dispose();
  });
});

// Fiber-section moment–curvature spec normalization (pure TS — always runs).
describe('normalizeMomentCurvatureSpec', () => {
  it('applies ABI defaults (layers, steps, maxKappa, material params)', () => {
    const s = normalizeMomentCurvatureSpec({
      section: { b: 12, h: 24 },
      concrete: { fc: 5 },
      steel: [{ As: 2, d: 21, fy: 60 }],
    });
    expect(s.section.concreteLayers).toBe(40);
    expect(s.steps).toBe(80);
    expect(s.maxKappa).toBe(3e-3);
    expect(s.axial).toBe(0);
    expect(s.steel[0].Es).toBe(29000);
    expect(s.strands).toEqual([]);
  });

  it('defaults strands to Gr. 270 LR params', () => {
    const s = normalizeMomentCurvatureSpec({
      section: { b: 12, h: 24 },
      concrete: { fc: 6 },
      strands: [{ Aps: 0.918, d: 20, fse: 175 }],
    });
    const st = s.strands[0];
    expect([st.Eps, st.fpy, st.fpu, st.Q, st.K, st.R]).toEqual([28800, 243, 270, 0.031, 1.043, 7.36]);
  });

  it('rejects a reinforcement depth beyond the section and an unreinforced section', () => {
    expect(() =>
      normalizeMomentCurvatureSpec({ section: { b: 12, h: 24 }, concrete: { fc: 5 }, steel: [{ As: 2, d: 30, fy: 60 }] }),
    ).toThrow(/within section depth/);
    expect(() =>
      normalizeMomentCurvatureSpec({ section: { b: 12, h: 24 }, concrete: { fc: 5 }, strands: [{ Aps: 0.9, d: 26 }] }),
    ).toThrow(/within section depth/);
    expect(() => normalizeMomentCurvatureSpec({ section: { b: 12, h: 24 }, concrete: { fc: 5 } })).toThrow(
      /no reinforcement/,
    );
  });
});

// Fiber-section moment–curvature numerics through the engine — production only
// (the Eigen oracle is linear-elastic and has no momentCurvature). Validated
// against closed-form flexural capacity, mirroring the C++ smoke test.
describe.skipIf(!feaEngineHasMomentCurvature)('WASM fiber moment–curvature (OpenSees)', () => {
  it('RC section: peak ≈ Whitney Mn, rising onset, zero moment at zero curvature', async () => {
    const engine = makeEngine('feaEngine');
    const b = 12, h = 24, d = 21.5, As = 3.0, fy = 60, fc = 5;
    const r = await engine.momentCurvature({
      section: { b, h, concreteLayers: 50 },
      concrete: { fc },
      steel: [{ As, d, fy }],
      steps: 120,
      maxKappa: 3e-3,
    });
    expect(r.converged).toBe(true);
    expect(r.solver).toMatch(/FiberSection2d/);
    expect(r.points.length).toBeGreaterThan(20);

    const a = (As * fy) / (0.85 * fc * b);
    const Mn = As * fy * (d - a / 2); // Whitney stress-block nominal moment
    expect(near(r.peakMoment, Mn, 0.12)).toBe(true);
    expect(near(r.points[0].M, 0, 1, 1e-3)).toBe(true);
    expect(r.points[3].M).toBeGreaterThan(r.points[1].M);
    expect(r.points[3].kappa).toBeGreaterThan(r.points[1].kappa);
    engine.dispose();
  });

  it('reports exact cracking < first-yield < crushing landmarks for the RC section', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.momentCurvature({
      section: { b: 12, h: 24, concreteLayers: 60 },
      concrete: { fc: 5 },
      steel: [{ As: 3.0, d: 21.5, fy: 60 }],
      steps: 200,
      maxKappa: 4e-3,
    });
    const { cracking, firstYield, crushing } = r.landmarks;
    expect(firstYield).not.toBeNull();
    expect(crushing).not.toBeNull();
    expect(cracking).not.toBeNull();
    // Ordering: concrete cracks, then tension steel yields, then concrete crushes.
    expect(cracking!.kappa).toBeLessThan(firstYield!.kappa);
    expect(firstYield!.kappa).toBeLessThan(crushing!.kappa);
    // First yield ≈ the bar reaching εy = fy/Es; crushing ≈ εcu.
    expect(firstYield!.strain).toBeGreaterThanOrEqual(60 / 29000 - 1e-6);
    expect(firstYield!.strain).toBeLessThan(60 / 29000 + 1e-3);
    expect(crushing!.strain).toBeCloseTo(-0.003, 6);
    expect(crushing!.kappa / firstYield!.kappa).toBeGreaterThan(1); // ductility μ > 1
    engine.dispose();
  });

  it('general-geometry fibers reproduce the rectangular b×h form', async () => {
    const engine = makeEngine('feaEngine');
    const b = 12, h = 24, d = 21.5, As = 3.0, fy = 60, fc = 5;
    const common = { concrete: { fc }, steel: [{ As, d, fy }], steps: 120, maxKappa: 3e-3 };
    const rect = await engine.momentCurvature({ section: { b, h, concreteLayers: 60 }, ...common });
    // The same rectangle, discretized into explicit fibers by the TS discretizer.
    const concreteFibers = discretizeConcreteFibers({ id: 's', sectionType: 'rectangular', bw: b, h }, 60);
    const general = await engine.momentCurvature({ section: { h }, concreteFibers, ...common });
    expect(general.converged).toBe(true);
    expect(near(general.peakMoment, rect.peakMoment, 0.02)).toBe(true); // within 2%
    engine.dispose();
  });

  it('prestressed section: positive holding moment at κ=0, ultimate climbs above it', async () => {
    const engine = makeEngine('feaEngine');
    const r = await engine.momentCurvature({
      section: { b: 12, h: 24, concreteLayers: 50 },
      concrete: { fc: 6 },
      strands: [{ Aps: 0.918, d: 20, fse: 175 }], // Gr. 270 LR defaults
      steps: 120,
      maxKappa: 3e-3,
    });
    expect(r.converged).toBe(true);
    expect(r.points[0].M).toBeGreaterThan(500); // eccentric prestress holding moment
    expect(r.peakMoment).toBeGreaterThan(3000);
    expect(r.peakMoment).toBeGreaterThan(r.points[0].M);
    engine.dispose();
  });
});

if (ENGINES.length === 0) {
  describe('WASM elastic frame solve', () => {
    it.skip('skipped — run `npm run build:wasm` (+ build:wasm:oracle) to build public/fea modules', () => {});
  });
}
