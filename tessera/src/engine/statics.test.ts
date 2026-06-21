import { describe, it, expect } from 'vitest';
import {
  reactions,
  shearAt,
  momentAt,
  maxMoment,
  maxShear,
  uniformMidspanMoment,
} from './statics';

describe('statics — uniform load on a simple span', () => {
  const L = 240;
  const loads = [{ w: 0.1 }]; // kip/in

  it('reactions are wL/2 each', () => {
    const { Ra, Rb } = reactions(L, loads);
    expect(Ra).toBeCloseTo(12, 6);
    expect(Rb).toBeCloseTo(12, 6);
  });
  it('shear is ±wL/2 at supports, 0 at midspan', () => {
    expect(shearAt(0, L, loads)).toBeCloseTo(12, 6);
    expect(shearAt(120, L, loads)).toBeCloseTo(0, 6);
    expect(shearAt(240, L, loads)).toBeCloseTo(-12, 6);
  });
  it('mid-span moment is wL²/8', () => {
    expect(momentAt(120, L, loads)).toBeCloseTo(720, 6);
    expect(uniformMidspanMoment(0.1, 240)).toBeCloseTo(720, 6);
  });
  it('maxMoment finds the mid-span peak', () => {
    const m = maxMoment(L, loads);
    expect(m.M).toBeCloseTo(720, 1);
    expect(m.x).toBeCloseTo(120, 0);
    expect(maxShear(L, loads)).toBeCloseTo(12, 6);
  });
});

describe('statics — central point load', () => {
  const L = 240;
  const loads = [{ P: 10, position: 120 }];
  it('splits reactions evenly and peaks PL/4', () => {
    const { Ra, Rb } = reactions(L, loads);
    expect(Ra).toBeCloseTo(5, 6);
    expect(Rb).toBeCloseTo(5, 6);
    expect(maxMoment(L, loads).M).toBeCloseTo(600, 1); // PL/4 = 10·240/4
  });
});

describe('statics — superposition', () => {
  it('adds uniform and point contributions', () => {
    const L = 240;
    const loads = [{ w: 0.1 }, { P: 10, position: 120 }];
    // mid-span: 720 (uniform) + 600 (point) = 1320
    expect(momentAt(120, L, loads)).toBeCloseTo(1320, 1);
  });
});
