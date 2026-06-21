import { describe, it, expect } from 'vitest';
import { defaultMemberDesign, designToInput, MemberDesignSchema } from './memberDesign';
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
