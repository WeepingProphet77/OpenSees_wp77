import { describe, it, expect } from 'vitest';
import { analyzeMember } from './analyzeMember';
import steelPresets from './steelPresets';

const GR60 = steelPresets.find((p) => p.id === 'grade60')!;
const GR270 = steelPresets.find((p) => p.id === 'grade270')!;

describe('analyzeMember — prestressed rectangular beam', () => {
  const res = analyzeMember({
    section: { sectionType: 'rectangular', bf: 12, bw: 12, hf: 24, h: 24, fc: 6 },
    fci: 4.5,
    layers: [{ area: 1.224, depth: 20, fse: 160, steel: GR270 }],
    L: 360,
    loads: { superDead: 0.05, live: 0.1 },
    design: { serviceClass: 'U', Av: 0.22, fyt: 60, stirrupSpacing: 10, RH: 70, VS: 3 },
    prestress: { fpi: 189, strandType: '270LR' },
  });

  it('computes gross properties and self-weight', () => {
    expect(res.properties.A).toBeCloseTo(288, 6);
    expect(res.properties.wSelf).toBeCloseTo(0.025, 6); // 288·150/1728/1000
  });
  it('self-weight transfer moment Mg = wSelf·L²/8', () => {
    expect(res.demands.Mg).toBeCloseTo(405, 1);
  });
  it('resolves prestress force and eccentricity', () => {
    expect(res.prestress.hasStrands).toBe(true);
    expect(res.prestress.Pe).toBeCloseTo(160 * 1.224, 4);
    expect(res.prestress.e).toBeCloseTo(8, 6); // depth 20 − centroid 12
  });
  it('runs flexure (converged, φMn > 0)', () => {
    expect(res.flexure.converged).toBe(true);
    expect(res.flexure.phiMnFt).toBeGreaterThan(0);
  });
  it('produces stresses, shear, camber, and loss results', () => {
    expect(res.stresses).toBeDefined();
    expect(res.shear.phiVn).toBeGreaterThan(0);
    expect(res.camber.finalCamber).toBeTypeOf('number');
    expect(res.losses?.fse).toBeLessThan(189);
    expect(res.losses?.fse).toBeGreaterThan(120);
  });
  it('aggregates checks with a governing utilization', () => {
    expect(res.checks.length).toBeGreaterThan(5);
    expect(res.governing.utilization).toBeGreaterThan(0);
    expect(['pass', 'fail']).toContain(res.governing.status);
    // every check carries a clause and a formula
    expect(res.checks.every((c) => c.clause && c.formula)).toBe(true);
  });
});

describe('analyzeMember — nonprestressed RC beam', () => {
  const res = analyzeMember({
    section: { sectionType: 'rectangular', bf: 12, bw: 12, hf: 24, h: 24, fc: 4 },
    fci: 4,
    layers: [{ area: 3.0, depth: 21.5, fse: 0, steel: GR60 }],
    L: 300,
    loads: { live: 0.05 },
    design: { Av: 0.22, fyt: 60, stirrupSpacing: 9 },
  });

  it('has no prestress-only results', () => {
    expect(res.prestress.hasStrands).toBe(false);
    expect(res.stresses).toBeUndefined();
    expect(res.losses).toBeUndefined();
  });
  it('still runs flexure and shear', () => {
    expect(res.flexure.converged).toBe(true);
    expect(res.flexure.phiMnFt).toBeGreaterThan(0);
    expect(res.shear.phiVn).toBeGreaterThan(0);
  });
  it('flexure-strength check is present', () => {
    expect(res.checks.find((c) => c.id === 'flexure-strength')).toBeDefined();
  });
});

describe('analyzeMember — double-tee floor with composite topping', () => {
  const res = analyzeMember({
    section: { sectionType: 'doubletee', bf: 120, hf: 2, h: 24, numStems: 2, stemWidth: 4.75, fc: 6 },
    fci: 4.2,
    layers: [{ area: 2.0, depth: 21, fse: 160, steel: GR270 }],
    L: 600,
    loads: { superDead: 0.02, live: 0.04 },
    design: { Av: 0.22, fyt: 60, stirrupSpacing: 12 },
    prestress: { fpi: 189, strandType: '270LR' },
    topping: { width: 120, thickness: 2, fc: 4 },
  });

  it('produces composite results', () => {
    expect(res.composite).toBeDefined();
    expect(res.composite!.props.n).toBeCloseTo(Math.sqrt(4 / 6), 4);
    expect(res.composite!.props.I).toBeGreaterThan(0);
  });
  it('adds composite + interface checks to the aggregate', () => {
    expect(res.checks.find((c) => c.id === 'composite-precast-bottom-tension')).toBeDefined();
    expect(res.checks.find((c) => c.id === 'interface-horizontal-shear')).toBeDefined();
  });
});
