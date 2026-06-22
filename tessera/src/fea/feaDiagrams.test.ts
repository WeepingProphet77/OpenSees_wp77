import { describe, it, expect } from 'vitest';
import { normalizeFeaModel, type FeaResult, type FeaModelInput } from './feaModel';
import { computeMemberDiagrams, diagramExtreme } from './feaDiagrams';

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol + 1e-9 * Math.abs(b);
const valAt = (pts: { x: number; value: number }[], x: number) => {
  const p = pts.find((q) => Math.abs(q.x - x) < 1e-6);
  if (!p) throw new Error(`no station at x=${x} (have ${pts.map((q) => q.x).join(',')})`);
  return p.value;
};
// Build a single-element diagram from a model input + hand-specified end forces.
const oneMember = (model: FeaModelInput, iN: number, iV: number, iM: number) => {
  const result: FeaResult = {
    converged: true, solver: 'test', message: 'ok', residual: 0,
    nodalDisplacements: [], reactions: [],
    elementForces: [{ elementId: 'e', iN, iV, iM, jN: 0, jV: 0, jM: 0 }],
  };
  const [d] = computeMemberDiagrams(normalizeFeaModel(model), result, { stations: 21 });
  return d;
};
const base = {
  dimension: 2 as const,
  nodes: [{ id: 'i', x: 0, y: 0 }, { id: 'j', x: 100, y: 0 }],
  materials: [{ id: 'm', E: 29000 }],
  sections: [{ id: 's', A: 10, I: 100 }],
  elements: [{ id: 'e', nodeI: 'i', nodeJ: 'j', materialId: 'm', sectionId: 's' }],
};

describe('computeMemberDiagrams — internal-force reconstruction', () => {
  it('simply-supported UDL: parabolic moment peaking at wL²/8, linear shear ±wL/2', () => {
    const w = -0.02, L = 100;
    // Engine reports iV = +1, iM = 0 for this case.
    const d = oneMember({ ...base, elementLoads: [{ elementId: 'e', wy: w }] }, 0, 1, 0);
    expect(d.length).toBe(L);
    expect(near(valAt(d.moment, 0), 0)).toBe(true);
    expect(near(valAt(d.moment, 100), 0)).toBe(true);
    expect(near(valAt(d.moment, 50), (Math.abs(w) * L ** 2) / 8)).toBe(true); // +25, sagging
    expect(near(valAt(d.shear, 0), (Math.abs(w) * L) / 2)).toBe(true); // +1
    expect(near(valAt(d.shear, 50), 0)).toBe(true);
    expect(near(valAt(d.shear, 100), -(Math.abs(w) * L) / 2)).toBe(true); // -1
    expect(d.axial.every((p) => p.value === 0)).toBe(true);
  });

  it('cantilever with tip (nodal) load: linear moment −PL→0, constant shear', () => {
    // Fixed at I, free at J, tip load P=10 down — engine reports iV=10, iM=1000.
    const d = oneMember(base, 0, 10, 1000);
    expect(near(valAt(d.moment, 0), -1000)).toBe(true); // hogging
    expect(near(valAt(d.moment, 50), -500)).toBe(true);
    expect(near(valAt(d.moment, 100), 0)).toBe(true);
    expect(d.shear.every((p) => near(p.value, 10))).toBe(true);
    expect(near(diagramExtreme(d.moment).value, -1000)).toBe(true);
  });

  it('axial tension is constant and positive', () => {
    // Engine reports iN = −100 for +100 kip tension.
    const d = oneMember(base, -100, 0, 0);
    expect(d.axial.every((p) => near(p.value, 100))).toBe(true);
  });

  it('member point load: shear steps at the load, moment kinks', () => {
    const d = oneMember(
      { ...base, elementPointLoads: [{ elementId: 'e', at: 0.5, py: -10 }] },
      0, 0, 0,
    );
    expect(near(valAt(d.shear, 25), 0)).toBe(true); // before the load
    expect(near(valAt(d.shear, 75), -10)).toBe(true); // after the load
    expect(near(valAt(d.moment, 50), 0)).toBe(true); // at the load
    expect(near(valAt(d.moment, 100), -10 * 50)).toBe(true); // py·(x−pos)
    // a station exists exactly at the load discontinuity
    expect(d.shear.some((p) => Math.abs(p.x - 50) < 1e-9)).toBe(true);
  });

  it('full-span triangular partial load (0→w): shear=wL/2, moment=wL²/6 at the far end', () => {
    const w = -0.03, L = 100;
    const d = oneMember(
      { ...base, elementPartialLoads: [{ elementId: 'e', a: 0, b: 1, wy: 0, wyEnd: w }] },
      0, 0, 0,
    );
    expect(near(valAt(d.shear, 100), (w * L) / 2)).toBe(true);
    expect(near(valAt(d.moment, 100), (w * L ** 2) / 6)).toBe(true);
    expect(near(valAt(d.shear, 0), 0)).toBe(true);
  });

  it('partial load only over [a,b] does not act before a', () => {
    const w = -0.04, L = 100;
    const d = oneMember(
      { ...base, elementPartialLoads: [{ elementId: 'e', a: 0.5, b: 1, wy: w }] },
      0, 0, 0,
    );
    expect(near(valAt(d.shear, 25), 0)).toBe(true); // before a
    expect(near(valAt(d.shear, 50), 0)).toBe(true); // at a
    // rectangular load over [50,100]: total = w·50 at x=100
    expect(near(valAt(d.shear, 100), w * 50)).toBe(true);
  });
});
