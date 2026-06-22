import { describe, it, expect } from 'vitest';
import {
  transformedComposite,
  compositeServiceStresses,
  interfaceShearCheck,
} from './compositeSection';

// Precast 12×24 (A=288, Ig=13824, yCg=12) + 48×2 topping, f'c 4 (topping) / 6 (precast).
const precast = { A: 288, Ig: 13824, yCg: 12, h: 24 };
const topping = { width: 48, thickness: 2, fc: 4 };

describe('transformedComposite', () => {
  const c = transformedComposite(precast, topping, 6);
  it('modular ratio n = √(f′c_topping/f′c_precast)', () => {
    expect(c.n).toBeCloseTo(Math.sqrt(4 / 6), 6); // ≈ 0.8165
  });
  it('transformed area = n·A_topping + A_precast', () => {
    expect(c.A).toBeCloseTo(Math.sqrt(4 / 6) * 96 + 288, 4); // ≈ 366.38
  });
  it('composite centroid from topping top', () => {
    expect(c.sc).toBeCloseTo(11.218, 2);
  });
  it('transformed moment of inertia', () => {
    expect(c.I).toBeCloseTo(24263, -1); // ~24,260 in⁴
  });
  it('total depth and fiber distances', () => {
    expect(c.H).toBe(26);
    expect(c.cPrecastBot).toBeCloseTo(26 - 11.218, 2);
    expect(c.cToppingTop).toBeCloseTo(11.218, 2);
  });
  it('composite I exceeds the bare precast Ig (stiffer)', () => {
    expect(c.I).toBeGreaterThan(precast.Ig);
  });
});

describe('compositeServiceStresses — staged superposition', () => {
  const composite = transformedComposite(precast, topping, 6);
  const r = compositeServiceStresses({
    precast,
    composite,
    precastFc: 6,
    toppingFc: 4,
    Pe: 300,
    e: 7,
    Mprecast: 800, // self + construction on bare precast
    Mcomposite: 1500, // SDL + LL on composite
  });
  it('produces the three fiber stresses and checks', () => {
    expect(Number.isFinite(r.precastBottom)).toBe(true);
    expect(Number.isFinite(r.toppingTop)).toBe(true);
    expect(r.checks.length).toBe(3);
  });
  it('topping carries compression at its top fiber under positive moment', () => {
    expect(r.toppingTop).toBeGreaterThan(0);
  });
  it('extra composite moment reduces precast bottom compression (adds tension)', () => {
    const less = compositeServiceStresses({
      precast, composite, precastFc: 6, toppingFc: 4, Pe: 300, e: 7, Mprecast: 800, Mcomposite: 500,
    });
    expect(r.precastBottom).toBeLessThan(less.precastBottom);
  });
});

describe('interfaceShearCheck (ACI 318-19 §16.4)', () => {
  it('φVnh = 0.75·vnh·bv·d and pass/fail', () => {
    const r = interfaceShearCheck({ Vu: 20, bv: 12, d: 22, vnh: 80 });
    // φVnh = 0.75·80·12·22/1000 = 15.84 kip
    expect(r.phiVnh).toBeCloseTo(15.84, 2);
    expect(r.check.status).toBe('fail'); // 20 > 15.84
  });
  it('higher vnh (ties + roughened) can pass', () => {
    const r = interfaceShearCheck({ Vu: 20, bv: 12, d: 22, vnh: 260 });
    expect(r.check.status).toBe('pass');
  });
});
