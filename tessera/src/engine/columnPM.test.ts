import { describe, it, expect } from 'vitest';
import { analyzeBiaxial } from './beamCalculations';
import { pmInteraction, momentCapacityAtP } from './columnPM';
import steelPresets from './steelPresets';

const GR60 = steelPresets.find((p) => p.id === 'grade60')!;

// 16×16 tied column, f'c=5, 4 bars (2 layers of 2.0 in²) at d=2.5 and d=13.5.
const section = { sectionType: 'rectangular' as const, bf: 16, bw: 16, hf: 16, h: 16, fc: 5 };
const layers = [
  { area: 2.0, depth: 2.5, x: 8, fse: 0, steel: GR60 },
  { area: 2.0, depth: 13.5, x: 8, fse: 0, steel: GR60 },
];

describe('analyzeBiaxial — axial load extension (ΣF = N)', () => {
  it('records the applied axial load and still converges', () => {
    const r = analyzeBiaxial(section, layers, { axialN: -150 });
    expect(r.axialN).toBe(-150);
    expect(r.envelope.length).toBeGreaterThan(10);
    expect(Number.isFinite(r.anchors.xSag.phiMx)).toBe(true);
  });
  it('axial compression increases the moment anchor vs no axial (below balance)', () => {
    const none = analyzeBiaxial(section, layers, { axialN: 0 });
    const comp = analyzeBiaxial(section, layers, { axialN: -150 });
    expect(comp.anchors.xSag.phiMx).toBeGreaterThan(none.anchors.xSag.phiMx);
  });
});

describe('pmInteraction — column P-M curve', () => {
  const r = pmInteraction(section, layers, { tie: 'tied' });

  it('computes the squash load Po = 0.85f′c(Ag−Ast) + fy·Ast', () => {
    // 0.85·5·(256−4) + 60·4 = 1071 + 240 = 1311
    expect(r.Po).toBeCloseTo(1311, 0);
  });
  it('caps φPn,max at 0.65·0.80·Po (tied)', () => {
    expect(r.phiPnMax).toBeCloseTo(0.65 * 0.8 * 1311, 0);
  });
  it('builds a curve with a pure-flexure point (P ≈ 0, M > 0)', () => {
    const flexure = r.points.reduce((a, b) => (Math.abs(b.P) < Math.abs(a.P) ? b : a));
    expect(Math.abs(flexure.P)).toBeLessThan(40);
    expect(flexure.phiM).toBeGreaterThan(0);
  });
  it('never exceeds the axial cap', () => {
    expect(Math.max(...r.points.map((p) => p.phiP))).toBeLessThanOrEqual(r.phiPnMax + 1e-6);
  });
  it('spiral columns get a higher cap than tied', () => {
    const spiral = pmInteraction(section, layers, { tie: 'spiral' });
    expect(spiral.phiPnMax).toBeGreaterThan(r.phiPnMax);
  });

  it('momentCapacityAtP interpolates and clamps', () => {
    const lo = r.points.reduce((a, b) => (a.P < b.P ? a : b));
    const hi = r.points.reduce((a, b) => (a.P > b.P ? a : b));
    // Mid-axial capacity is finite and within the curve's moment range.
    const mMid = momentCapacityAtP(r, 200);
    expect(mMid).toBeGreaterThan(0);
    // Clamps beyond the range.
    expect(momentCapacityAtP(r, hi.P + 1e6)).toBeCloseTo(hi.phiM, 6);
    expect(momentCapacityAtP(r, lo.P - 1e6)).toBeCloseTo(lo.phiM, 6);
  });
});
