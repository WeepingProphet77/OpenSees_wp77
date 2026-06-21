import { describe, it, expect } from 'vitest';
import { prestressLosses, relaxationC } from './prestressLosses';

// 12×30 section, 2.0 in² of Gr 270 LR strand at e=6, fpi=189 ksi (0.70 fpu).
const input = {
  Eps: 28800,
  Eci: 3605,
  Ec: 4415,
  fpu: 270,
  fpi: 189,
  strandType: '270LR' as const,
  A: 360,
  I: 27000,
  e: 6,
  Aps: 2.0,
  Mg: 1500,
  Msd: 800,
  VS: 3.0,
  RH: 70,
};

describe('prestressLosses — PCI/Zia approximate method', () => {
  const r = prestressLosses(input);
  it('prestress force before transfer', () => {
    expect(r.Pi).toBeCloseTo(378, 6);
  });
  it('concrete stress at strand cg at transfer', () => {
    expect(r.fcir).toBeCloseTo(1.0653, 3);
  });
  it('elastic shortening ES', () => {
    expect(r.ES).toBeCloseTo(8.51, 1);
  });
  it('creep CR', () => {
    expect(r.CR).toBeCloseTo(11.58, 1);
  });
  it('shrinkage SH', () => {
    expect(r.SH).toBeCloseTo(5.81, 1);
  });
  it('relaxation RE (C = 0.75 at fpi/fpu = 0.70)', () => {
    expect(r.C).toBeCloseTo(0.75, 5);
    expect(r.RE).toBeCloseTo(2.97, 1);
  });
  it('total loss and effective prestress', () => {
    expect(r.total).toBeCloseTo(28.87, 1);
    expect(r.fse).toBeCloseTo(160.13, 1);
  });
});

describe('relaxationC', () => {
  it('is 1.0 at fpi/fpu = 0.75 for both strand classes', () => {
    expect(relaxationC(0.75, true)).toBeCloseTo(1.0, 6);
    expect(relaxationC(0.75, false)).toBeCloseTo(1.0, 6);
  });
  it('interpolates between table nodes', () => {
    const c = relaxationC(0.775, true); // between 0.77 (1.11) and 0.78 (1.16)
    expect(c).toBeGreaterThan(1.11);
    expect(c).toBeLessThan(1.16);
  });
  it('clamps below the table range', () => {
    expect(relaxationC(0.5, true)).toBeCloseTo(0.35, 6);
  });
});

describe('prestressLosses — overrides', () => {
  it('accepts an explicit C factor', () => {
    const r = prestressLosses({ ...input, C: 1.0 });
    expect(r.C).toBe(1.0);
  });
  it('uses the lightweight creep coefficient when requested', () => {
    const nw = prestressLosses(input);
    const lw = prestressLosses({ ...input, lightweight: true });
    // Kcr 1.6 (LW) vs 2.0 (NW) → smaller creep loss.
    expect(lw.CR).toBeLessThan(nw.CR);
    expect(lw.CR / nw.CR).toBeCloseTo(1.6 / 2.0, 6);
  });
});
