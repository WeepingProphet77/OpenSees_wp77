import { describe, it, expect } from 'vitest';
import { handlingStresses } from './handlingStresses';

describe('handlingStresses — two-point symmetric pickup', () => {
  // L=240, wSelf=0.05 kip/in, S=288 in³, f'ci=3, impact 1.5, balanced pickup.
  const r = handlingStresses({ L: 240, wSelf: 0.05, S: 288, fci: 3 });

  it('uses the balanced pickup a ≈ 0.207L', () => {
    expect(r.a).toBeCloseTo(49.68, 2);
  });
  it('cantilever and mid-span moments are nearly equal at the balanced pickup', () => {
    expect(r.Mneg).toBeCloseTo(92.55, 1);
    expect(r.Mpos).toBeCloseTo(92.88, 1);
    expect(Math.abs(r.Mneg - r.Mpos)).toBeLessThan(1);
  });
  it('tensile stress = Mgov/S and fr = 7.5√f′ci', () => {
    expect(r.stress).toBeCloseTo(92.88 / 288, 3); // ≈ 0.3225 ksi
    expect(r.allowable).toBeCloseTo((7.5 * Math.sqrt(3000)) / 1000, 6); // ≈ 0.4108 ksi
    expect(r.check.status).toBe('pass');
  });
  it('a higher impact factor increases the stress', () => {
    const hi = handlingStresses({ L: 240, wSelf: 0.05, S: 288, fci: 3, impactFactor: 2.0 });
    expect(hi.stress).toBeGreaterThan(r.stress);
  });
  it('flags a failure for a thin panel (small S)', () => {
    const thin = handlingStresses({ L: 360, wSelf: 0.06, S: 60, fci: 2.5 });
    expect(thin.check.status).toBe('fail');
  });
});
