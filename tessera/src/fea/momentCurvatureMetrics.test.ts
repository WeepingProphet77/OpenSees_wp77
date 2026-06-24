import { describe, it, expect } from 'vitest';
import { momentCurvatureMetrics } from './momentCurvatureMetrics';
import type { MomentCurvatureLandmarks, MomentCurvaturePoint } from './feaModel';

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
    expect(m.exactYield).toBe(false);
    expect(m.exactUltimate).toBe(false);
  });

  it('prefers the engine exact landmarks for φy, φu and μ when present', () => {
    const points = [pt(0, 0), pt(0.5e-3, 60), pt(1.0e-3, 100), pt(3.0e-3, 95)];
    const landmarks: MomentCurvatureLandmarks = {
      cracking: { kappa: 0.15e-3, M: 18, strain: 1.3e-4 },
      firstYield: { kappa: 0.9e-3, M: 92, strain: 2.07e-3 },
      crushing: { kappa: 2.7e-3, M: 96, strain: -0.003 },
    };
    const m = momentCurvatureMetrics(points, landmarks)!;
    expect(m.exactYield).toBe(true);
    expect(m.exactUltimate).toBe(true);
    expect(m.phiY).toBe(0.9e-3); // from firstYield landmark, not the secant
    expect(m.phiU).toBe(2.7e-3); // from crushing landmark, not the last point (3.0e-3)
    expect(m.mu).toBeCloseTo(2.7 / 0.9, 6);
    expect(m.cracking).toEqual({ kappa: 0.15e-3, M: 18 });
    expect(m.firstYield).toEqual({ kappa: 0.9e-3, M: 92 });
  });

  it('falls back to secant yield / last-point ultimate when landmarks are all null', () => {
    const points = [pt(0, 0), pt(0.7e-3, 70), pt(1.0e-3, 100), pt(4.0e-3, 100)];
    const landmarks: MomentCurvatureLandmarks = { cracking: null, firstYield: null, crushing: null };
    const m = momentCurvatureMetrics(points, landmarks)!;
    expect(m.exactYield).toBe(false);
    expect(m.exactUltimate).toBe(false);
    expect(m.phiY).toBeCloseTo(1.0e-3, 9); // secant: φ@0.7Mn / 0.7
    expect(m.phiU).toBe(4.0e-3); // last point
  });
});
