import { describe, it, expect } from 'vitest';
import {
  buildEngineSection,
  defaultMemberDesign,
  designToInput,
  engineSectionFrom,
  memberSectionOf,
  MemberDesignSchema,
  sectionCenterX,
  sectionCenterXOf,
} from './memberDesign';
import { analyzeMember } from '../engine/analyzeMember';

describe('memberDesign', () => {
  it('default design is schema-valid with at least one layer', () => {
    const d = defaultMemberDesign();
    expect(MemberDesignSchema.safeParse(d).success).toBe(true);
    expect(d.layers.length).toBeGreaterThan(0);
  });

  it('default design analyzes cleanly (what the workspace renders on load)', () => {
    const res = analyzeMember(designToInput(defaultMemberDesign()));
    expect(res.flexure.converged).toBe(true);
    expect(res.flexure.phiMnFt).toBeGreaterThan(0);
    expect(Number.isFinite(res.governing.utilization)).toBe(true);
    expect(res.checks.length).toBeGreaterThan(4);
    // default is prestressed → stresses + losses present
    expect(res.prestress.hasStrands).toBe(true);
    expect(res.stresses).toBeDefined();
    expect(res.losses?.fse).toBeGreaterThan(0);
  });

  it('converts display units (ft span, klf loads) to engine units (in, kip/in)', () => {
    const input = designToInput({ ...defaultMemberDesign(), L: 30, superDead: 1.2, live: 0 });
    expect(input.L).toBe(360); // 30 ft → in
    expect(input.loads.superDead).toBeCloseTo(0.1, 9); // 1.2 klf → kip/in
  });

  it('rectangular maps flange to full depth (rectangular behavior)', () => {
    const input = designToInput({ ...defaultMemberDesign(), sectionType: 'rectangular', b: 14, h: 30 });
    expect(input.section.bf).toBe(14);
    expect(input.section.bw).toBe(14);
    expect(input.section.hf).toBe(30);
  });
});

// Sections reconciliation, step 1: the geometry is extracted into a MemberSection
// seam (memberSectionOf → engineSectionFrom). These golden tests lock the mapping
// so later steps (a shared sections[] catalog) can't silently change behavior.
describe('member section extraction seam', () => {
  const TYPES = ['rectangular', 'tbeam', 'doubletee', 'hollowcore', 'sandwich', 'custom', 'dxf'] as const;
  const poly = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 24 },
    { x: 0, y: 24 },
  ];

  it('engineSectionFrom(memberSectionOf(d)) equals buildEngineSection(d) for every section type', () => {
    for (const t of TYPES) {
      const d = {
        ...defaultMemberDesign(),
        sectionType: t,
        points: t === 'custom' || t === 'dxf' ? poly : undefined,
      };
      expect(engineSectionFrom(memberSectionOf(d), { fc: d.fc, lambda: d.lambda })).toEqual(buildEngineSection(d));
      expect(sectionCenterXOf(memberSectionOf(d))).toBe(sectionCenterX(d));
    }
  });

  it('locks the engine Section mapping per type (golden)', () => {
    const base = defaultMemberDesign();
    expect(buildEngineSection({ ...base, sectionType: 'rectangular', b: 14, h: 30 })).toMatchObject({ sectionType: 'rectangular', bw: 14, bf: 14, hf: 30, h: 30 });
    expect(buildEngineSection({ ...base, sectionType: 'tbeam', b: 8, bf: 36, hf: 4, h: 28 })).toMatchObject({ sectionType: 'tbeam', bw: 8, bf: 36, hf: 4, h: 28 });
    expect(buildEngineSection({ ...base, sectionType: 'doubletee', bf: 96, hf: 4, numStems: 2, stemWidth: 4.75, h: 24 })).toMatchObject({ sectionType: 'doubletee', bf: 96, hf: 4, numStems: 2, stemWidth: 4.75, bw: 9.5, h: 24 });
    expect(buildEngineSection({ ...base, sectionType: 'hollowcore', bf: 48, numVoids: 6, voidDiameter: 6, voidCenterDepth: 4, h: 8 })).toMatchObject({ sectionType: 'hollowcore', bf: 48, numVoids: 6, voidDiameter: 6, voidCenterDepth: 4, bw: 48, h: 8 });
    expect(buildEngineSection({ ...base, sectionType: 'sandwich', bt: 48, ht: 3, hg: 2, bb: 48, h: 8 })).toMatchObject({ sectionType: 'sandwich', bt: 48, ht: 3, hg: 2, bb: 48, bw: 48, h: 8 });
    expect(buildEngineSection({ ...base, sectionType: 'custom', points: poly })).toMatchObject({ sectionType: 'custom', h: 24, points: poly, holes: [] });
  });
});
