// Standalone Node smoke test for the freshly-built WASM FEA module.
//
// Run right after `fea/build.sh` (locally and in wasm-build.yml) to prove the
// artifact solves correctly before it is published / consumed by the app.
// Validates against closed-form Euler-Bernoulli solutions and static
// equilibrium. Exits non-zero on any failure.
//
// Usage: node tessera/fea/test/smoke.mjs [path/to/feaEngine.mjs]
import { fileURLToPath } from 'node:url';

const mjs = process.argv[2]
  ? fileURLToPath(new URL(process.argv[2], `file://${process.cwd()}/`))
  : fileURLToPath(new URL('../../public/fea/feaEngine.mjs', import.meta.url));

const createFeaModule = (await import(mjs)).default;
const mod = await createFeaModule();

let pass = 0;
let fail = 0;
const near = (a, b, rel = 1e-4, abs = 1e-9) => Math.abs(a - b) <= Math.max(abs, rel * Math.abs(b));
const check = (name, a, b, rel, abs) => {
  const ok = near(a, b, rel, abs);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${(+a).toPrecision(6)} expect ${(+b).toPrecision(6)}`);
  ok ? pass++ : fail++;
};

// Case 1 — cantilever, tip vertical load.
{
  const E = 29000, I = 100, A = 10, L = 100, P = -10;
  const r = mod.solve({
    nodes: [{ id: 'b', x: 0, y: 0 }, { id: 't', x: L, y: 0 }],
    materials: [{ id: 'm', E }],
    sections: [{ id: 's', A, I }],
    elements: [{ id: 'e', type: 'elasticBeamColumn', nodeI: 'b', nodeJ: 't', materialId: 'm', sectionId: 's' }],
    supports: [{ nodeId: 'b', dx: true, dy: true, rz: true }],
    nodalLoads: [{ nodeId: 't', fx: 0, fy: P, mz: 0 }],
    elementLoads: [],
  });
  console.log(`\n== Cantilever ==  converged=${r.converged} solver="${r.solver}" residual=${r.residual.toExponential(2)}`);
  check('tip dy = PL^3/3EI', r.nodalDisplacements.find((d) => d.nodeId === 't').dy, (P * L ** 3) / (3 * E * I));
  check('base reaction fy', r.reactions.find((x) => x.nodeId === 'b').fy, -P);
  check('base reaction |mz|=|PL|', Math.abs(r.reactions.find((x) => x.nodeId === 'b').mz), Math.abs(P * L));
}

// Case 2 — simply supported beam, UDL (2 elements -> midspan node).
{
  const E = 29000, I = 200, A = 10, L = 120, w = -0.01;
  const r = mod.solve({
    nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'm', x: 60, y: 0 }, { id: 'c', x: 120, y: 0 }],
    materials: [{ id: 'mat', E }],
    sections: [{ id: 's', A, I }],
    elements: [
      { id: 'e1', type: 'elasticBeamColumn', nodeI: 'a', nodeJ: 'm', materialId: 'mat', sectionId: 's' },
      { id: 'e2', type: 'elasticBeamColumn', nodeI: 'm', nodeJ: 'c', materialId: 'mat', sectionId: 's' },
    ],
    supports: [{ nodeId: 'a', dx: true, dy: true, rz: false }, { nodeId: 'c', dx: false, dy: true, rz: false }],
    nodalLoads: [],
    elementLoads: [{ elementId: 'e1', wy: w }, { elementId: 'e2', wy: w }],
  });
  console.log(`\n== Simple beam UDL ==  converged=${r.converged}`);
  check('midspan dy = 5wL^4/384EI', r.nodalDisplacements.find((d) => d.nodeId === 'm').dy, (5 * w * L ** 4) / (384 * E * I));
  check('reaction A fy = wL/2', r.reactions.find((x) => x.nodeId === 'a').fy, (-w * L) / 2);
  check('reaction C fy = wL/2', r.reactions.find((x) => x.nodeId === 'c').fy, (-w * L) / 2);
  check('midspan |M| = wL^2/8', Math.abs(r.elementForces.find((e) => e.elementId === 'e1').jM), Math.abs((w * L ** 2) / 8));
}

// Case 3 — fixed-base portal frame, lateral load (static equilibrium).
{
  const E = 29000, I = 300, A = 12, H = 144, B = 240, Hload = 5;
  const nodes = [
    { id: 'bl', x: 0, y: 0 }, { id: 'br', x: B, y: 0 },
    { id: 'tl', x: 0, y: H }, { id: 'tr', x: B, y: H },
  ];
  const r = mod.solve({
    nodes,
    materials: [{ id: 'm', E }],
    sections: [{ id: 's', A, I }],
    elements: [
      { id: 'colL', type: 'elasticBeamColumn', nodeI: 'bl', nodeJ: 'tl', materialId: 'm', sectionId: 's' },
      { id: 'colR', type: 'elasticBeamColumn', nodeI: 'br', nodeJ: 'tr', materialId: 'm', sectionId: 's' },
      { id: 'beam', type: 'elasticBeamColumn', nodeI: 'tl', nodeJ: 'tr', materialId: 'm', sectionId: 's' },
    ],
    supports: [
      { nodeId: 'bl', dx: true, dy: true, rz: true },
      { nodeId: 'br', dx: true, dy: true, rz: true },
    ],
    nodalLoads: [{ nodeId: 'tl', fx: Hload, fy: 0, mz: 0 }],
    elementLoads: [],
  });
  console.log(`\n== Portal frame ==  converged=${r.converged}`);
  check('Sum Fx = -Hload', r.reactions.reduce((a, x) => a + x.fx, 0), -Hload);
  check('Sum Fy = 0', r.reactions.reduce((a, x) => a + x.fy, 0), 0, 1, 1e-6);
  const Mreact = r.reactions.reduce((a, x) => {
    const n = nodes.find((nn) => nn.id === x.nodeId);
    return a + x.mz + (n.x * x.fy - n.y * x.fx);
  }, 0);
  check('Moment equilibrium (reactions balance applied)', Mreact, H * Hload, 1e-4, 1e-4);
}

// Fiber moment–curvature — production OpenSees engine only. The Eigen oracle is
// a linear-elastic solver and has no momentCurvature binding, so skip there.
if (typeof mod.momentCurvature !== 'function') {
  console.log('\n== M–φ ==  skipped (elastic-only engine — no momentCurvature)');
} else {
// Case 4 — RC rectangular section: fiber moment–curvature vs closed-form Mn.
{
  const b = 12, h = 24, d = 21.5, As = 3.0, fy = 60, fc = 5;
  const r = mod.momentCurvature({
    section: { b, h, concreteLayers: 50 },
    concrete: { fc },
    steel: [{ As, d, fy, Es: 29000 }],
    strands: [],
    steps: 120,
    maxKappa: 3.0e-3,
  });
  const a = (As * fy) / (0.85 * fc * b);
  const Mn = As * fy * (d - a / 2); // Whitney stress-block nominal moment
  const ptsN = r.points.length;
  const M = (i) => r.points[i].M;
  const K = (i) => r.points[i].kappa;
  console.log(`\n== M–φ (RC) ==  converged=${r.converged} points=${ptsN} peakM=${(+r.peakMoment).toPrecision(5)} msg="${r.message}"`);
  check('peak moment ≈ Whitney Mn (±12%)', r.peakMoment, Mn, 0.12);
  check('curve has points', ptsN > 20 ? 1 : 0, 1);
  check('M(0) ≈ 0 for non-prestressed', M(0), 0, 1, 1e-3);
  check('moment rises with curvature (monotone onset)', M(3) > M(1) && K(3) > K(1) ? 1 : 0, 1);
}

// Case 5 — prestressed section: exercises PowerFormulaStrand + InitStrain.
{
  const b = 12, h = 24;
  const r = mod.momentCurvature({
    section: { b, h, concreteLayers: 50 },
    concrete: { fc: 6 },
    steel: [],
    strands: [{ Aps: 0.918, d: 20, Eps: 28500, fpy: 243, fpu: 270, Q: 0.031, K: 1.04, R: 7.36, fse: 175 }],
    steps: 120,
    maxKappa: 3.0e-3,
  });
  const peak = r.peakMoment;
  const m0 = r.points.length ? r.points[0].M : 0;
  console.log(`\n== M–φ (prestressed) ==  converged=${r.converged} points=${r.points.length} M(0)=${(+m0).toPrecision(4)} peakM=${(+peak).toPrecision(5)} msg="${r.message}"`);
  check('prestressed solve converged', r.converged ? 1 : 0, 1);
  // At κ=0 the eccentric strand tension is held by a positive (sagging) section
  // moment; capacity then climbs well above it as curvature increases.
  check('prestress moment present at zero curvature', m0 > 500 ? 1 : 0, 1);
  check('ultimate capacity develops above the prestress moment', peak > 3000 && peak > m0 ? 1 : 0, 1);
}
}  // end moment–curvature (production engine) guard

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
