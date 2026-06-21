import { describe, it, expect } from 'vitest';
import { camberDeflection, PCI_MULTIPLIERS } from './camberDeflection';

// 12×30 section, 30 ft span. Eci=3605 (f'ci=4), Ec=4415 (f'c=6), Ig=27000.
const input = {
  Pi: 300,
  e: 6,
  L: 360,
  Eci: 3605,
  Ec: 4415,
  Ig: 27000,
  wSelf: 0.03125, // kip/in
  wSuperDead: 0.02,
  wLive: 0.04,
};

describe('camberDeflection — PCI multiplier method', () => {
  const r = camberDeflection(input);
  it('instantaneous prestress camber Pi·e·L²/(8·Eci·Ig)', () => {
    expect(r.prestressCamber).toBeCloseTo(0.2996, 3);
  });
  it('instantaneous self-weight deflection', () => {
    expect(r.selfWeightDeflection).toBeCloseTo(0.0702, 3);
  });
  it('net camber at release', () => {
    expect(r.camberAtRelease).toBeCloseTo(0.2294, 3);
  });
  it('net camber at erection uses 1.80 / 1.85 multipliers', () => {
    const expected =
      PCI_MULTIPLIERS.erectionPrestress * r.prestressCamber -
      PCI_MULTIPLIERS.erectionSelfWeight * r.selfWeightDeflection;
    expect(r.camberAtErection).toBeCloseTo(expected, 8);
    expect(r.camberAtErection).toBeCloseTo(0.4094, 3);
  });
  it('final camber stays upward', () => {
    expect(r.finalCamber).toBeCloseTo(0.4343, 3);
    expect(r.finalCamber).toBeGreaterThan(0);
  });
  it('live deflection and its L/360 check', () => {
    expect(r.liveDeflection).toBeCloseTo(0.0734, 3);
    const live = r.checks.find((c) => c.id === 'deflection-live');
    expect(live?.capacity).toBeCloseTo(1.0, 6); // L/360 = 360/360
    expect(live?.status).toBe('pass');
  });
  it('long-term downward check passes while in camber', () => {
    expect(r.checks.find((c) => c.id === 'deflection-longterm')?.status).toBe('pass');
  });
});
