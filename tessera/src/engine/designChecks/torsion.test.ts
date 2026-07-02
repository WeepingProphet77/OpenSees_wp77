import { describe, it, expect } from 'vitest';
import { torsionChecks, ringAreaPerimeter, PHI_TORSION } from './torsion';

// Rectangular 14×24, f'c = 5 ksi, nonprestressed.
const rect = () => ({ fc: 5, lambda: 1, bw: 14, d: 21.5, Acp: 336, pcp: 76, Aoh: 215.25, ph: 62, Vc: 42 });

describe('ringAreaPerimeter', () => {
  it('computes area and perimeter of a rectangle (shoelace)', () => {
    const r = ringAreaPerimeter([
      { x: 0, y: 0 },
      { x: 14, y: 0 },
      { x: 14, y: 24 },
      { x: 0, y: 24 },
    ]);
    expect(r.area).toBeCloseTo(336, 6);
    expect(r.perimeter).toBeCloseTo(76, 6);
  });
});

describe('torsion (ACI 318-19 §22.7)', () => {
  it('threshold torsion Tth = λ√f′c·(Acp²/pcp) (hand value)', () => {
    const r = torsionChecks({ ...rect(), Tu: 1, Vu: 0 });
    // √5000·(336²/76)/1000 = 105.0 kip-in
    expect(r.Tth).toBeCloseTo(105.0, 1);
    expect(r.Tcr).toBeCloseTo(4 * r.Tth, 6);
  });

  it('neglects torsion below φ·Tth (single passing threshold check)', () => {
    const r = torsionChecks({ ...rect(), Tu: 50, Vu: 30 });
    expect(r.negligible).toBe(true);
    expect(r.checks).toHaveLength(1);
    expect(r.checks[0].id).toBe('torsion-threshold');
    expect(r.checks[0].status).toBe('pass');
  });

  it('requires design above φ·Tth and emits the four torsion checks', () => {
    const r = torsionChecks({ ...rect(), Tu: 200, Vu: 40 });
    expect(r.negligible).toBe(false);
    expect(r.checks.map((c) => c.id)).toEqual([
      'torsion-strength',
      'torsion-section-adequacy',
      'torsion-longitudinal',
      'torsion-min-transverse',
    ]);
  });

  it('providing the required At/s makes φTn ≈ Tu (utilization ≈ 1)', () => {
    const base = { ...rect(), Tu: 200, Vu: 40 };
    const req = torsionChecks({ ...base, Tu: 200, Vu: 40 });
    const s = 12;
    const At = req.AtSReq * s; // provide exactly the required amount
    const r = torsionChecks({ ...base, At, s, fyt: 60 });
    expect(r.phiTn).toBeCloseTo(200, 0);
    const strength = r.checks.find((c) => c.id === 'torsion-strength')!;
    expect(strength.utilization).toBeCloseTo(1, 2);
  });

  it('fails torsional strength when no closed stirrups are provided', () => {
    const r = torsionChecks({ ...rect(), Tu: 200, Vu: 40, At: 0, s: 0 });
    const strength = r.checks.find((c) => c.id === 'torsion-strength')!;
    expect(strength.status).toBe('fail');
  });

  it('prestress raises the threshold via the √(1+fpc/4λ√f′c) factor', () => {
    const plain = torsionChecks({ ...rect(), Tu: 1, Vu: 0 });
    const pre = torsionChecks({ ...rect(), Tu: 1, Vu: 0, prestressed: true, fpc: 0.8 });
    expect(pre.Tth).toBeGreaterThan(plain.Tth);
  });

  it('φ is 0.75', () => {
    expect(PHI_TORSION).toBe(0.75);
  });
});
