import { describe, it, expect } from 'vitest';
import { shearChecks } from './shear';

describe('shearChecks — nonprestressed beam (ACI 318-19 §22.5.5.1)', () => {
  // f'c=4, bw=12, d=21.5, h=24, Vu=40, #3 stirrups Av=0.22 @ s=10.
  const r = shearChecks({
    fc: 4,
    bw: 12,
    d: 21.5,
    h: 24,
    Vu: 40,
    Mu: 0,
    Av: 0.22,
    fyt: 60,
    s: 10,
  });
  it('Vc = 2λ√f′c·bw·d', () => {
    expect(r.Vc).toBeCloseTo(32.635, 2);
  });
  it('Vs = Av·fyt·d/s', () => {
    expect(r.Vs).toBeCloseTo(28.38, 2);
  });
  it('φVn = 0.75(Vc+Vs)', () => {
    expect(r.phiVn).toBeCloseTo(45.761, 2);
  });
  it('Av,min and max spacing', () => {
    expect(r.AvMin).toBeCloseTo(0.1, 4); // 50·bw·s/fyt governs
    expect(r.sMax).toBeCloseTo(10.75, 4); // min(d/2, 24)
    expect(r.stirrupsRequired).toBe(true);
  });
  it('strength check passes (Vu < φVn)', () => {
    const strength = r.checks.find((c) => c.id === 'shear-strength');
    expect(strength?.status).toBe('pass');
  });
});

describe('shearChecks — prestressed beam, simplified Vc (Table 22.5.6.2)', () => {
  // f'c=6, bw=6, d=dp=20, h=24, Vu=50, Mu=1500 kip-in.
  const r = shearChecks({
    fc: 6,
    bw: 6,
    d: 20,
    h: 24,
    dp: 20,
    Vu: 50,
    Mu: 1500,
    prestressed: true,
    Av: 0.22,
    fyt: 60,
    s: 8,
  });
  it('clamps Vc to the upper bound 5λ√f′c·bw·d', () => {
    expect(r.Vc).toBeCloseTo(r.VcBounds.upper, 6);
    expect(r.Vc).toBeCloseTo(46.476, 2);
  });
  it('Vs and φVn', () => {
    expect(r.Vs).toBeCloseTo(33.0, 4);
    expect(r.phiVn).toBeCloseTo(59.607, 2);
  });
  it('strength check passes', () => {
    expect(r.checks.find((c) => c.id === 'shear-strength')?.status).toBe('pass');
  });
});

describe('shearChecks — undersized section fails strength', () => {
  const r = shearChecks({ fc: 4, bw: 8, d: 12, h: 14, Vu: 80, Mu: 0 });
  it('φVn < Vu without stirrups', () => {
    expect(r.checks.find((c) => c.id === 'shear-strength')?.status).toBe('fail');
  });
});
