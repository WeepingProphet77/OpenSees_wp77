import { describe, it, expect } from 'vitest';
import { vierendeelLinesFromGrid, vierendeelMemberResults, vierendeelSummary } from './vierendeel';
import { buildVierendeelFrame } from '../fea/feaBuilders';
import type { FeaResult } from '../fea/feaModel';

describe('vierendeelLinesFromGrid', () => {
  it('lays out evenly-spaced piers and chords around a regular opening grid', () => {
    const lines = vierendeelLinesFromGrid({
      width: 120,
      height: 192,
      thickness: 8,
      cols: 2,
      rows: 2,
      pierWidth: 8,
      chordDepth: 12,
    });
    expect(lines.openingWidth).toBe(48); // (120 − 3·8)/2
    expect(lines.openingHeight).toBe(78); // (192 − 3·12)/2
    expect(lines.verticals.map((v) => v.x)).toEqual([4, 60, 116]);
    expect(lines.horizontals.map((h) => h.y)).toEqual([6, 96, 186]);
    expect(lines.verticals.every((v) => v.width === 8)).toBe(true);
    expect(lines.horizontals.every((h) => h.depth === 12)).toBe(true);
  });

  it('rejects a grid with no opening space or no openings', () => {
    expect(() =>
      vierendeelLinesFromGrid({ width: 120, height: 192, thickness: 8, cols: 2, rows: 2, pierWidth: 50, chordDepth: 12 }),
    ).toThrow(/Piers are too wide/);
    expect(() =>
      vierendeelLinesFromGrid({ width: 120, height: 192, thickness: 8, cols: 0, rows: 2, pierWidth: 8, chordDepth: 12 }),
    ).toThrow(/at least one opening/);
  });
});

describe('vierendeelMemberResults', () => {
  const model = buildVierendeelFrame({
    verticals: [
      { x: 0, width: 8 },
      { x: 60, width: 6 },
      { x: 120, width: 8 },
    ],
    horizontals: [
      { y: 0, depth: 12 },
      { y: 96, depth: 10 },
    ],
    thickness: 8,
    E: 4030,
  });

  // Synthetic solve: all members unloaded except chord c0_1 (depth 10, t 8).
  const elementForces = model.elements.map((e) => ({
    elementId: e.id,
    iN: 0,
    iV: 0,
    iM: 0,
    jN: 0,
    jV: 0,
    jM: 0,
  }));
  Object.assign(elementForces.find((f) => f.elementId === 'c0_1')!, {
    iN: -5,
    jN: 4,
    iV: 3,
    jV: -2,
    iM: 35,
    jM: 20,
  });
  const result = {
    converged: true,
    solver: 'test',
    message: '',
    residual: 0,
    nodalDisplacements: [],
    reactions: [],
    elementForces,
  } as unknown as FeaResult;

  it('extracts governing forces and screens cracking + shear per member', () => {
    const results = vierendeelMemberResults(model, result, { fc: 5 });
    expect(results).toHaveLength(model.elements.length);

    const chord = results.find((r) => r.elementId === 'c0_1')!;
    expect(chord.kind).toBe('chord');
    expect(chord.label).toBe('Chord level 2, bay 1');
    expect(chord.M).toBe(35); // max(|35|,|20|)
    expect(chord.V).toBe(3); // max(|3|,|2|)
    expect(chord.N).toBe(-5); // signed end of greatest magnitude

    // S = t·w²/6 = 8·10²/6 = 133.3; fr = 7.5√5000/1000 = 0.5303 ksi; Mcr ≈ 70.7 kip-in.
    expect(chord.checks[0].capacity).toBeCloseTo(70.71, 1);
    expect(chord.checks[0].utilization).toBeCloseTo(35 / 70.71, 3);
    // φVc = 0.75·2√5000·8·(0.8·10)/1000 ≈ 6.79 kip.
    expect(chord.checks[1].capacity).toBeCloseTo(6.788, 2);
    expect(chord.utilization).toBeCloseTo(35 / 70.71, 3);
  });

  it('summary picks the governing (worst-utilized) member', () => {
    const results = vierendeelMemberResults(model, result, { fc: 5 });
    const { maxUtilization, governing } = vierendeelSummary(results);
    expect(governing?.elementId).toBe('c0_1');
    expect(maxUtilization).toBeCloseTo(35 / 70.71, 3);
  });
});
