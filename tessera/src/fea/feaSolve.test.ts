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

if (ENGINES.length === 0) {
  describe('WASM elastic 2D frame solve', () => {
    it.skip('skipped — run `npm run build:wasm` (+ build:wasm:oracle) to build public/fea modules', () => {});
  });
}
