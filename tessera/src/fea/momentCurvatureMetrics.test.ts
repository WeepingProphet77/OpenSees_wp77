import { describe, it, expect } from 'vitest';
import { momentCurvatureMetrics } from './momentCurvatureMetrics';
import type { MomentCurvaturePoint } from './feaModel';

const pt = (kappa: number, M: number): MomentCurvaturePoint => ({ kappa, M, eps: 0 });

describe('momentCurvatureMetrics', () => {
  it('returns null for a degenerate curve', () => {
    expect(momentCurvatureMetrics([])).toBeNull();
    expect(momentCurvatureMetrics([pt(0, 0)])).toBeNull();
  });

  it('elastic-perfectly-plastic-ish RC curve: peak, yield secant, ductility', () => {
    // Rises ~linearly to Mn=100 at κ=1e-3, then a flat plateau out to κ=5e-3.
    const points = [
      pt(0, 0),
      pt(0.25e-3, 25),
      pt(0.5e-3, 50),
      pt(0.7e-3, 70),
      pt(1.0e-3, 100),
      pt(2.0e-3, 100),
      pt(5.0e-3, 100),
    ];
    const m = momentCurvatureMetrics(points)!;
    expect(m.m0).toBe(0);
    expect(m.mn).toBe(100);
    expect(m.phiU).toBe(5.0e-3);
    // 0.7·Mn = 70 occurs exactly at κ = 0.7e-3 → φy = 0.7e-3 / 0.7 = 1.0e-3.
    expect(m.phiY).toBeCloseTo(1.0e-3, 9);
    expect(m.mu).toBeCloseTo(5.0, 6); // φu/φy = 5e-3 / 1e-3
  });

  it('prestressed curve (M(0) > 0): the starting moment cancels in the yield secant', () => {
    // Starts at M0=20, rises to Mn=120 at κ=1e-3, plateau to κ=4e-3.
    // target = 20 + 0.7·100 = 90, which falls at κ where M=90.
    const points = [
      pt(0, 20),
      pt(0.5e-3, 70), // M0 + 0.5·100
      pt(0.7e-3, 90), // M0 + 0.7·100  → φ@target = 0.7e-3
      pt(1.0e-3, 120),
      pt(4.0e-3, 120),
    ];
    const m = momentCurvatureMetrics(points)!;
    expect(m.mn).toBe(120);
    expect(m.phiY).toBeCloseTo(0.7e-3 / 0.7, 9); // 1.0e-3
    expect(m.mu).toBeCloseTo(4.0, 6);
  });
});
