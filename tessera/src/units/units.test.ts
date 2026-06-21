import { describe, it, expect } from 'vitest';
import {
  convert,
  dimensionOf,
  toCanonical,
  fromCanonical,
  formatQuantity,
  ftToIn,
  inToFt,
  kipToLb,
  lbToKip,
  ksiToPsi,
  psiToKsi,
  ksfToKsi,
  kipFtToKipIn,
  kipInToKipFt,
  plfToKlf,
  CANONICAL_UNIT,
} from './units';

describe('dimensionOf', () => {
  it('classifies units into their physical dimension', () => {
    expect(dimensionOf('in')).toBe('length');
    expect(dimensionOf('ft')).toBe('length');
    expect(dimensionOf('kip')).toBe('force');
    expect(dimensionOf('ksi')).toBe('stress');
    expect(dimensionOf('kip-ft')).toBe('moment');
    expect(dimensionOf('klf')).toBe('distributedLoad');
    expect(dimensionOf('pcf')).toBe('unitWeight');
  });
  it('throws on an unknown unit', () => {
    // @ts-expect-error intentionally passing an invalid unit
    expect(() => dimensionOf('furlong')).toThrow();
  });
});

describe('convert — length', () => {
  it('1 ft = 12 in', () => {
    expect(convert(1, 'ft', 'in')).toBe(12);
    expect(ftToIn(1)).toBe(12);
  });
  it('24 in = 2 ft', () => {
    expect(convert(24, 'in', 'ft')).toBe(2);
    expect(inToFt(24)).toBe(2);
  });
});

describe('convert — force', () => {
  it('1 kip = 1000 lb', () => {
    expect(convert(1, 'kip', 'lb')).toBe(1000);
    expect(kipToLb(1)).toBe(1000);
  });
  it('2500 lb = 2.5 kip', () => {
    expect(convert(2500, 'lb', 'kip')).toBe(2.5);
    expect(lbToKip(2500)).toBe(2.5);
  });
});

describe('convert — stress', () => {
  it('1 ksi = 1000 psi', () => {
    expect(convert(1, 'ksi', 'psi')).toBe(1000);
    expect(ksiToPsi(1)).toBe(1000);
  });
  it('5000 psi = 5 ksi', () => {
    expect(convert(5000, 'psi', 'ksi')).toBe(5);
    expect(psiToKsi(5000)).toBe(5);
  });
  it('1 ksi = 144 ksf', () => {
    expect(convert(1, 'ksi', 'ksf')).toBeCloseTo(144, 10);
    expect(ksfToKsi(144)).toBeCloseTo(1, 10);
  });
  it('1 ksi = 144000 psf', () => {
    expect(convert(1, 'ksi', 'psf')).toBeCloseTo(144000, 6);
  });
});

describe('convert — moment', () => {
  it('1 kip-ft = 12 kip-in', () => {
    expect(convert(1, 'kip-ft', 'kip-in')).toBe(12);
    expect(kipFtToKipIn(1)).toBe(12);
  });
  it('120 kip-in = 10 kip-ft', () => {
    expect(convert(120, 'kip-in', 'kip-ft')).toBe(10);
    expect(kipInToKipFt(120)).toBe(10);
  });
  it('1 kip-ft = 1000 lb-ft', () => {
    expect(convert(1, 'kip-ft', 'lb-ft')).toBeCloseTo(1000, 10);
  });
});

describe('convert — distributed load', () => {
  it('1 klf = 1000 plf', () => {
    expect(convert(1, 'klf', 'plf')).toBe(1000);
    expect(plfToKlf(1000)).toBe(1);
  });
});

describe('convert — guards & round-trips', () => {
  it('refuses cross-dimension conversion', () => {
    expect(() => convert(1, 'ksi', 'in')).toThrow(/dimension/i);
    expect(() => convert(1, 'kip', 'kip-ft')).toThrow(/dimension/i);
  });
  it('is identity when from === to', () => {
    expect(convert(42.5, 'ksi', 'ksi')).toBe(42.5);
  });
  it('round-trips through every unit', () => {
    const units = ['in', 'ft', 'lb', 'kip', 'psi', 'ksi', 'kip-in', 'kip-ft', 'plf', 'klf'] as const;
    for (const u of units) {
      const canon = CANONICAL_UNIT[dimensionOf(u)];
      const there = convert(7.123, u, canon);
      const back = convert(there, canon, u);
      expect(back).toBeCloseTo(7.123, 9);
    }
  });
  it('toCanonical / fromCanonical agree with convert', () => {
    expect(toCanonical(2, 'ft')).toBe(24); // ft -> in
    expect(fromCanonical(24, 'ft')).toBe(2); // in -> ft
  });
});

describe('formatQuantity', () => {
  it('labels the value with its unit', () => {
    expect(formatQuantity(4.567, 'ksi')).toBe('4.567 ksi');
    expect(formatQuantity(4.0306, 'ksi')).toBe('4.031 ksi'); // rounds to 3 dp
    expect(formatQuantity(12, 'in', 0)).toBe('12 in');
    expect(formatQuantity(150, 'kip-ft', 1)).toBe('150.0 kip·ft');
  });
});
