import { describe, it, expect } from 'vitest';
import {
  combinationValue,
  governingStrength,
  serviceValue,
  gravityStrength,
  memberLoadFactor,
  MEMBER_LOAD_COMBOS,
  ACI_318_19_STRENGTH,
} from './loadCombinations';

describe('ACI 318-19 §5.3 load combinations', () => {
  it('1.4D combination', () => {
    const u1 = ACI_318_19_STRENGTH[0];
    expect(combinationValue(u1, { D: 10 })).toBeCloseTo(14, 6);
  });
  it('1.2D + 1.6L + 0.5Lr combination', () => {
    const u2 = ACI_318_19_STRENGTH[1];
    expect(combinationValue(u2, { D: 10, L: 5, Lr: 4 })).toBeCloseTo(1.2 * 10 + 1.6 * 5 + 0.5 * 4, 6);
  });

  it('gravity governs by 1.2D+1.6L when live is significant', () => {
    const g = gravityStrength(10, 5); // U1=14, U2=12+8=20
    expect(g.value).toBeCloseTo(20, 6);
    expect(g.combination.name).toBe('U2');
  });
  it('gravity governs by 1.4D when live is small', () => {
    const g = gravityStrength(10, 1); // U1=14, U2=12+1.6=13.6
    expect(g.value).toBeCloseTo(14, 6);
    expect(g.combination.name).toBe('U1');
  });

  it('returns all evaluated combinations', () => {
    const g = governingStrength({ D: 10, L: 5 });
    expect(g.all.length).toBe(ACI_318_19_STRENGTH.length);
  });

  it('service value sums unfactored loads', () => {
    expect(serviceValue({ D: 10, L: 5, Lr: 2 })).toBeCloseTo(17, 6);
  });

  it('wind uplift combination 0.9D + 1.0W can govern reversal', () => {
    // With negative W (uplift) the 0.9D combo gives the least restoring effect.
    const u6 = ACI_318_19_STRENGTH.find((c) => c.name === 'U6')!;
    expect(combinationValue(u6, { D: 10, W: -15 })).toBeCloseTo(0.9 * 10 - 15, 6);
  });
});

describe('memberLoadFactor — scale service result to a gravity combination', () => {
  const byId = (id: string) => MEMBER_LOAD_COMBOS.find((c) => c.id === id)!.combination;

  it('service (D + L) factor is 1', () => {
    expect(memberLoadFactor(byId('service'), 2, 1)).toBeCloseTo(1, 9);
  });
  it('1.4D factor = 1.4·D / (D + L)', () => {
    expect(memberLoadFactor(byId('u1'), 2, 1)).toBeCloseTo((1.4 * 2) / 3, 9);
  });
  it('1.2D + 1.6L factor = (1.2D + 1.6L) / (D + L)', () => {
    expect(memberLoadFactor(byId('u2'), 2, 1)).toBeCloseTo((1.2 * 2 + 1.6 * 1) / 3, 9);
  });
  it('zero total load → factor 1 (no divide-by-zero)', () => {
    expect(memberLoadFactor(byId('u2'), 0, 0)).toBe(1);
  });
  it('exposes service + two strength combos, service first', () => {
    expect(MEMBER_LOAD_COMBOS.map((c) => c.id)).toEqual(['service', 'u1', 'u2']);
    expect(MEMBER_LOAD_COMBOS[0].service).toBe(true);
  });
});
