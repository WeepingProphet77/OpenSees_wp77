/**
 * Unit tests for the prestressed/RC beam strength engine.
 *
 * Reference values are hand-verified from ACI 318-19 / PCI closed-form
 * expressions. These act as regression guards: a change that moves an
 * engineering answer will fail here loudly.
 *
 * Ported verbatim from `prestressed_beam_power`
 * (src/utils/beamCalculations.test.js); only the steelPresets import path
 * changed (co-located in the engine module).
 */
import { describe, it, expect } from 'vitest';
import {
  beta1,
  phiFactor,
  powerFormulaStress,
  steelStrain,
  concreteModulus,
  decompressionStrains,
  grossSectionProperties,
  prestressAndCracking,
  analyzeBeam,
  analyzeBiaxial,
} from './beamCalculations';
import steelPresets from './steelPresets';

const byId = (id) => steelPresets.find((p) => p.id === id);
const GR60 = byId('grade60');
const GR270 = byId('grade270');

describe('beta1 (ACI 318-19 §22.2.2.4.3)', () => {
  it('is 0.85 at or below 4 ksi', () => {
    expect(beta1(3)).toBe(0.85);
    expect(beta1(4)).toBe(0.85);
  });
  it('floors at 0.65 for high strength', () => {
    expect(beta1(8)).toBe(0.65);
    expect(beta1(12)).toBe(0.65);
  });
  it('interpolates between 4 and 8 ksi', () => {
    expect(beta1(5)).toBeCloseTo(0.80, 10);
    expect(beta1(6)).toBeCloseTo(0.75, 10);
  });
});

describe('phiFactor (ACI 318-19 §21.2)', () => {
  const ety = 0.00207; // Gr60: 60/29000
  it('is 0.65 when compression-controlled (eps <= ety)', () => {
    expect(phiFactor(0.001, ety)).toBe(0.65);
    expect(phiFactor(ety, ety)).toBe(0.65);
  });
  it('is 0.90 when tension-controlled (eps >= ety + 0.003)', () => {
    expect(phiFactor(ety + 0.003, ety)).toBe(0.90);
    expect(phiFactor(0.01, ety)).toBe(0.90);
  });
  it('interpolates linearly in the transition zone', () => {
    const mid = ety + 0.0015;
    expect(phiFactor(mid, ety)).toBeCloseTo(0.775, 6);
  });
});

describe('powerFormulaStress', () => {
  it('caps mild steel at fpy', () => {
    const fs = powerFormulaStress(0.05, GR60); // huge strain
    expect(fs).toBeCloseTo(GR60.fpy, 6);
  });
  it('caps prestressing strand at fpu', () => {
    const fs = powerFormulaStress(0.1, GR270);
    expect(fs).toBeCloseTo(GR270.fpu, 6);
  });
  it('is approximately elastic (Es*eps) at small strain for mild steel', () => {
    const eps = 0.001;
    expect(powerFormulaStress(eps, GR60)).toBeCloseTo(GR60.Es * eps, 1);
  });
  it('is odd in strain (sign follows strain)', () => {
    expect(powerFormulaStress(-0.002, GR60)).toBeCloseTo(-powerFormulaStress(0.002, GR60), 10);
  });
});

describe('concreteModulus', () => {
  it('matches 57000√f\'c for normalweight concrete', () => {
    // f'c = 5 ksi -> 57000*sqrt(5000) ≈ 4030.5 ksi
    expect(concreteModulus(5)).toBeCloseTo(4030.5, 0);
  });
});

describe('grossSectionProperties (rectangular)', () => {
  it('matches closed-form A, yCg, Ig, Sb', () => {
    const { A, yCg, Ig, Sb } = grossSectionProperties({
      sectionType: 'rectangular', bw: 10, h: 20,
    });
    expect(A).toBeCloseTo(200, 6);
    expect(yCg).toBeCloseTo(10, 6);
    expect(Ig).toBeCloseTo((10 * 20 ** 3) / 12, 4); // 6666.67
    expect(Sb).toBeCloseTo(666.667, 2);
  });
});

describe('steelStrain components', () => {
  it('adds flexural + prestrain + decompression', () => {
    // d=20, c=5 -> flexural = 0.003*(20/5 - 1) = 0.009
    const eps = steelStrain(20, 5, 174, 28800, 0.0005);
    expect(eps).toBeCloseTo(0.009 + 174 / 28800 + 0.0005, 8);
  });
});

describe('decompressionStrains', () => {
  const section = { sectionType: 'rectangular', bw: 12, h: 24, fc: 5 };
  const props = grossSectionProperties(section);
  it('is zero for mild (non-tensioned) layers', () => {
    const layers = [{ area: 1, depth: 21, fse: 0, steel: GR60 }];
    expect(decompressionStrains(layers, props, 5)).toEqual([0]);
  });
  it('is positive and small for a prestressed layer below the centroid', () => {
    const layers = [{ area: 0.918, depth: 21, fse: 170, steel: GR270 }];
    const [d] = decompressionStrains(layers, props, 5);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(0.001); // typically << yield strain
  });
});

describe('analyzeBeam — classic singly-reinforced RC beam', () => {
  // b=12, h=24, d=21.5, As=3.0 Gr60, f'c=4 ksi.
  // a = As*fy/(0.85 f'c b) = 180/40.8 = 4.412 in
  // Mn = As*fy*(d - a/2) = 180*(21.5 - 2.206) = 3473 kip-in = 289.4 kip-ft
  const section = { sectionType: 'rectangular', bf: 12, bw: 12, hf: 24, h: 24, fc: 4 };
  const layers = [{ area: 3.0, depth: 21.5, fse: 0, steel: GR60 }];
  const res = analyzeBeam(section, layers);

  it('converges', () => {
    expect(res.converged).toBe(true);
  });
  it('yields the tension steel (capped at fy)', () => {
    expect(res.layerResults[0].stress).toBeCloseTo(60, 3);
  });
  it('matches the closed-form a and Mn within tolerance', () => {
    expect(res.a).toBeCloseTo(4.412, 1);
    expect(res.MnFt).toBeGreaterThan(283);
    expect(res.MnFt).toBeLessThan(296);
  });
  it('is tension-controlled with phi = 0.90', () => {
    expect(res.ductile).toBe(true);
    expect(res.phi).toBeCloseTo(0.90, 6);
  });
});

describe('prestressAndCracking — 1.33Mu exception (ACI 318-19 §9.6.1.3)', () => {
  const section = { sectionType: 'rectangular', bw: 12, h: 24, fc: 5, lambda: 1 };
  const layers = [{ area: 0.918, depth: 21, fse: 170, steel: GR270 }];

  it('uses 1.2Mcr when no factored demand is given', () => {
    const c = prestressAndCracking(section, layers, 1e6, 0);
    expect(c.governs).toBe('1.2Mcr');
    expect(c.threshold).toBeCloseTo(c.Mcr12, 6);
  });
  it('relieves to 1.33Mu when that is smaller', () => {
    const c = prestressAndCracking(section, layers, 1e6, 100); // Mu = 100 kip-in (tiny)
    expect(c.governs).toBe('1.33Mu');
    expect(c.threshold).toBeCloseTo(133, 6);
  });
  it('applies the lightweight lambda to fr', () => {
    const normal = prestressAndCracking({ ...section, lambda: 1 }, layers, 1e6, 0);
    const light = prestressAndCracking({ ...section, lambda: 0.75 }, layers, 1e6, 0);
    expect(light.fr).toBeCloseTo(normal.fr * 0.75, 8);
  });
});

describe('decompression strain raises strand stress / capacity', () => {
  // Same prestressed beam analyzed with and without the decompression term.
  const section = { sectionType: 'rectangular', bf: 12, bw: 12, hf: 24, h: 24, fc: 5 };
  const layers = [{ area: 0.918, depth: 21, fse: 170, steel: GR270 }];
  it('produces a finite, converged result with strand near but not above fpu', () => {
    const res = analyzeBeam(section, layers);
    expect(res.converged).toBe(true);
    expect(res.layerResults[0].stress).toBeLessThanOrEqual(GR270.fpu + 1e-6);
    expect(res.layerResults[0].epsDecomp).toBeGreaterThan(0);
  });
});

describe('analyzeBiaxial — symmetric section sanity', () => {
  const section = {
    sectionType: 'rectangular', bf: 12, bw: 12, hf: 24, h: 24, fc: 5, lambda: 1,
    bendingMode: 'biaxial',
  };
  const layers = [
    { area: 0.459, depth: 21, x: 3, fse: 170, steel: GR270 },
    { area: 0.459, depth: 21, x: 9, fse: 170, steel: GR270 },
  ];
  const res = analyzeBiaxial(section, layers, {});
  it('builds an envelope and anchors', () => {
    expect(res.mode).toBe('biaxial');
    expect(res.envelope.length).toBeGreaterThan(10);
    expect(res.anchors.xSag.phiMx).toBeGreaterThan(0);
  });
});
