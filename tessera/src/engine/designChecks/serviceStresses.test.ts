import { describe, it, expect } from 'vitest';
import { serviceStressChecks } from './serviceStresses';

// Rectangular 12×30 in section: A=360, Ig=27000, yt=yb=15.
const base = {
  props: { A: 360, Ig: 27000, yt: 15, yb: 15 },
  fc: 6,
  fci: 4.5,
  Pi: 250,
  Pe: 200,
  e: 8,
  Mg: 1500,
  Msustained: 2500,
  Mtotal: 3500,
};

describe('serviceStressChecks — fiber stresses (compression +)', () => {
  const r = serviceStressChecks(base);
  it('computes transfer fiber stresses', () => {
    // top = Pi/A − Pi·e·yt/Ig + Mg·yt/Ig
    expect(r.transfer.top).toBeCloseTo(0.41667, 4);
    expect(r.transfer.bottom).toBeCloseTo(0.97222, 4);
  });
  it('computes service (total) fiber stresses', () => {
    expect(r.serviceTotal.top).toBeCloseTo(1.61111, 4);
    expect(r.serviceTotal.bottom).toBeCloseTo(-0.5, 4); // bottom in tension
  });
  it('computes sustained top compression', () => {
    expect(r.serviceSustained.top).toBeCloseTo(1.05556, 4);
  });
});

describe('serviceStressChecks — allowables (ACI 318-19 §24.5)', () => {
  const r = serviceStressChecks(base);
  it('transfer compression 0.60 f′ci', () => {
    expect(r.allowables.transferCompression).toBeCloseTo(2.7, 6);
  });
  it('service compression 0.45 / 0.60 f′c', () => {
    expect(r.allowables.serviceCompressionSustained).toBeCloseTo(2.7, 6);
    expect(r.allowables.serviceCompressionTotal).toBeCloseTo(3.6, 6);
  });
  it('class U tension 7.5√f′c', () => {
    expect(r.allowables.serviceTension).toBeCloseTo((7.5 * Math.sqrt(6000)) / 1000, 6);
  });
  it('all checks pass for this section', () => {
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
  });
});

describe('serviceStressChecks — options', () => {
  it('end-region relaxes transfer limits (0.70 f′ci, 6√f′ci)', () => {
    const r = serviceStressChecks({ ...base, endRegion: true });
    expect(r.allowables.transferCompression).toBeCloseTo(0.7 * 4.5, 6);
    expect(r.allowables.transferTension).toBeCloseTo((6 * Math.sqrt(4500)) / 1000, 6);
  });
  it('Class T raises the service tension limit to 12√f′c', () => {
    const r = serviceStressChecks({ ...base, serviceClass: 'T' });
    expect(r.allowables.serviceTension).toBeCloseTo((12 * Math.sqrt(6000)) / 1000, 6);
  });
  it('flags a bottom tension failure when overloaded', () => {
    const r = serviceStressChecks({ ...base, Mtotal: 6000 });
    const bottomTension = r.checks.find((c) => c.id === 'service-bottom-tension');
    expect(bottomTension?.status).toBe('fail');
  });
});
