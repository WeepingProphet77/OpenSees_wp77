/**
 * End-to-end numeric tests of the WASM solver, driven through the public
 * `FeaEngine` contract. These validate the spike against closed-form structural
 * solutions (Euler-Bernoulli beam theory + static equilibrium).
 *
 * The test loads the built Emscripten module from `public/fea`. If it has not
 * been built yet (fresh checkout, `npm run build:wasm` not run), the suite is
 * skipped so `npm test` stays green without the toolchain. CI builds the WASM
 * first, so these run for real there.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDirectFeaEngine, type FeaEngine, type FeaModuleFactory } from './FeaEngine';
import { buildPortalFrame, buildSimpleBeam } from './feaBuilders';

const mjsPath = fileURLToPath(new URL('../../public/fea/feaEngine.mjs', import.meta.url));
const wasmPath = fileURLToPath(new URL('../../public/fea/feaEngine.wasm', import.meta.url));
const built = existsSync(mjsPath) && existsSync(wasmPath);

function makeEngine(): FeaEngine {
  return createDirectFeaEngine(
    async () => {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(mjsPath).href)) as {
        default: FeaModuleFactory;
      };
      return mod.default;
    },
    { locateFile: () => wasmPath },
  );
}

const near = (a: number, b: number, rel = 1e-4, abs = 1e-9) =>
  Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));

describe.skipIf(!built)('WASM elastic 2D frame solve (closed-form parity)', () => {
  it('cantilever tip load: deflection, base reactions, element end forces', async () => {
    const engine = makeEngine();
    const E = 29000, I = 100, A = 10, L = 100, P = -10;
    const model = {
      nodes: [
        { id: 'b', x: 0, y: 0 },
        { id: 't', x: L, y: 0 },
      ],
      materials: [{ id: 'm', E }],
      sections: [{ id: 's', A, I }],
      elements: [{ id: 'e', nodeI: 'b', nodeJ: 't', materialId: 'm', sectionId: 's' }],
      supports: [{ nodeId: 'b', dx: true, dy: true, rz: true }],
      nodalLoads: [{ nodeId: 't', fy: P }],
    };
    const r = await engine.solve(model);
    expect(r.converged).toBe(true);
    expect(r.solver).toMatch(/Eigen/);
    expect(r.residual).toBeLessThan(1e-8);

    const tip = r.nodalDisplacements.find((d) => d.nodeId === 't')!;
    expect(near(tip.dy, (P * L ** 3) / (3 * E * I))).toBe(true); // PL³/3EI

    const base = r.reactions.find((x) => x.nodeId === 'b')!;
    expect(near(base.fy, -P)).toBe(true);
    expect(near(Math.abs(base.mz), Math.abs(P * L))).toBe(true);

    const ef = r.elementForces.find((e) => e.elementId === 'e')!;
    expect(near(Math.abs(ef.iV), Math.abs(P))).toBe(true);
    expect(near(Math.abs(ef.iM), Math.abs(P * L))).toBe(true);
    expect(near(ef.jM, 0, 1, 1e-6)).toBe(true); // free end: zero moment
    engine.dispose();
  });

  it('simply-supported beam under UDL: midspan deflection, reactions, midspan moment', async () => {
    const engine = makeEngine();
    const E = 29000, I = 200, A = 10, L = 120, w = 0.01;
    const model = buildSimpleBeam({ length: L, segments: 4, E, A, I, udl: w });
    const r = await engine.solve(model);
    expect(r.converged).toBe(true);

    const mid = r.nodalDisplacements.find((d) => d.nodeId === 'n2')!;
    expect(near(mid.dy, (-5 * w * L ** 4) / (384 * E * I), 2e-3)).toBe(true); // 5wL⁴/384EI

    const ra = r.reactions.find((x) => x.nodeId === 'n0')!;
    const rc = r.reactions.find((x) => x.nodeId === 'n4')!;
    expect(near(ra.fy, (w * L) / 2)).toBe(true);
    expect(near(rc.fy, (w * L) / 2)).toBe(true);

    // Midspan moment = wL²/8, recovered as the end-J moment of the element left of midspan.
    const e1 = r.elementForces.find((e) => e.elementId === 'e1')!;
    expect(near(Math.abs(e1.jM), (w * L ** 2) / 8, 1e-3)).toBe(true);
    engine.dispose();
  });

  it('fixed-base portal frame under lateral load: global static equilibrium', async () => {
    const engine = makeEngine();
    const H = 144, span = 240, lateral = 5;
    const model = buildPortalFrame({ span, height: H, E: 29000, A: 12, I: 300, lateralLoad: lateral });
    const r = await engine.solve(model);
    expect(r.converged).toBe(true);

    const sumFx = r.reactions.reduce((a, x) => a + x.fx, 0);
    const sumFy = r.reactions.reduce((a, x) => a + x.fy, 0);
    expect(near(sumFx, -lateral)).toBe(true); // ΣFx + applied = 0
    expect(near(sumFy, 0, 1, 1e-6)).toBe(true);

    // Moment of reactions about the origin balances the applied lateral load's moment (−H·lateral).
    const Mreact = r.reactions.reduce((a, x) => {
      const node = model.nodes.find((n) => n.id === x.nodeId)!;
      return a + x.mz + (node.x * x.fy - node.y * x.fx);
    }, 0);
    expect(near(Mreact, H * lateral, 1e-4, 1e-4)).toBe(true);

    // Symmetric-ish lateral drift, both top nodes move in load direction.
    const tl = r.nodalDisplacements.find((d) => d.nodeId === 'tl')!;
    const tr = r.nodalDisplacements.find((d) => d.nodeId === 'tr')!;
    expect(tl.dx).toBeGreaterThan(0);
    expect(tr.dx).toBeGreaterThan(0);
    engine.dispose();
  });

  it('reports non-convergence for an unstable (under-restrained) model rather than throwing', async () => {
    const engine = makeEngine();
    // A single free beam with no supports → singular stiffness (rigid-body modes).
    const model = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 100, y: 0 },
      ],
      materials: [{ id: 'm', E: 29000 }],
      sections: [{ id: 's', A: 10, I: 100 }],
      elements: [{ id: 'e', nodeI: 'a', nodeJ: 'b', materialId: 'm', sectionId: 's' }],
      nodalLoads: [{ nodeId: 'b', fy: -5 }],
    };
    const r = await engine.solve(model);
    expect(r.converged).toBe(false);
    expect(r.message.length).toBeGreaterThan(0);
    engine.dispose();
  });
});

if (!built) {
  describe('WASM elastic 2D frame solve', () => {
    it.skip('skipped — run `npm run build:wasm` to build public/fea/feaEngine.{mjs,wasm}', () => {});
  });
}
