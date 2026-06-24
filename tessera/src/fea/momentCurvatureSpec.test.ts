import { describe, it, expect } from 'vitest';
import { discretizeConcreteFibers } from '@/engine/beamCalculations';
import type { Section, ReinforcementLayer } from '@/schema/domain';
import { buildMomentCurvatureSpec } from './momentCurvatureSpec';
import { normalizeMomentCurvatureSpec } from './feaModel';

const sumArea = (fibers: { area: number }[]) => fibers.reduce((s, f) => s + f.area, 0);
const centroid = (fibers: { y: number; area: number }[]) =>
  fibers.reduce((s, f) => s + f.y * f.area, 0) / sumArea(fibers);

describe('discretizeConcreteFibers', () => {
  it('rectangular: total area = b·h, centroid at mid-depth', () => {
    const section: Section = { id: 's', sectionType: 'rectangular', bw: 12, h: 24 };
    const fibers = discretizeConcreteFibers(section, 48);
    expect(fibers.length).toBe(48);
    expect(sumArea(fibers)).toBeCloseTo(12 * 24, 4); // 288
    expect(centroid(fibers)).toBeCloseTo(12, 6);
    expect(fibers.every((f) => f.y > 0 && f.y < 24 && f.area > 0)).toBe(true);
  });

  it('T-beam: total area = flange + web, centroid pulled toward the top flange', () => {
    // bf=48, hf=4 flange + bw=6 over the remaining 20 in.
    const section: Section = { id: 't', sectionType: 'tbeam', bf: 48, bw: 6, hf: 4, h: 24 };
    const fibers = discretizeConcreteFibers(section, 48);
    expect(sumArea(fibers)).toBeCloseTo(48 * 4 + 6 * 20, 2); // 312
    // (192·2 + 120·14)/312 ≈ 6.615 — above mid-depth (12).
    expect(centroid(fibers)).toBeCloseTo(6.615, 1);
    // A top strip (in the flange) is far wider than a bottom strip (web only).
    expect(fibers[0].area).toBeGreaterThan(fibers[fibers.length - 1].area * 5);
  });

  it('custom polygon with a hole: voided area is removed', () => {
    const section: Section = {
      id: 'c',
      sectionType: 'custom',
      h: 20,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 20 },
        { x: 0, y: 20 },
      ],
      holes: [
        [
          { x: 3, y: 5 },
          { x: 7, y: 5 },
          { x: 7, y: 15 },
          { x: 3, y: 15 },
        ],
      ],
    };
    const fibers = discretizeConcreteFibers(section, 40);
    expect(sumArea(fibers)).toBeCloseTo(10 * 20 - 4 * 10, 2); // 200 − 40 = 160
  });
});

describe('buildMomentCurvatureSpec', () => {
  const section: Section = { id: 's', sectionType: 'rectangular', bw: 12, h: 24 };

  it('maps geometry, concrete, and mild/strand reinforcement to the ABI spec', () => {
    const reinforcement: ReinforcementLayer[] = [
      { id: 'r1', kind: 'mild', area: 1.0, depth: 21, fse: 0, gradeId: 'grade60' },
      { id: 'r2', kind: 'strand', area: 0.918, depth: 20, fse: 175, gradeId: 'grade270' },
      { id: 'r3', kind: 'mild', area: 0, depth: 2, fse: 0, gradeId: 'grade60' }, // placeholder — skipped
    ];
    const spec = buildMomentCurvatureSpec(section, reinforcement, 6, { concreteFibers: 50 });

    expect(spec.section.h).toBe(24);
    expect(spec.section.b).toBeUndefined(); // geometry comes from fibers
    expect(spec.concrete.fc).toBe(6);
    expect(sumArea(spec.concreteFibers!)).toBeCloseTo(288, 2);

    expect(spec.steel).toEqual([{ As: 1.0, d: 21, fy: 60, Es: 29000 }]);
    expect(spec.strands).toEqual([
      { Aps: 0.918, d: 20, fse: 175, Eps: 28800, fpy: 243, fpu: 270, Q: 0.031, K: 1.043, R: 7.36 },
    ]);

    // The result is a valid spec the engine boundary accepts.
    expect(() => normalizeMomentCurvatureSpec(spec)).not.toThrow();
  });

  it('falls back to default grades when gradeId is missing/unknown', () => {
    const spec = buildMomentCurvatureSpec(section, [{ id: 'r', kind: 'strand', area: 0.6, depth: 22, fse: 160 }], 5);
    expect(spec.strands[0].fpu).toBe(270); // Gr. 270 fallback
    expect(spec.strands[0].fse).toBe(160);
  });
});
