import { describe, it, expect } from 'vitest';
import { FeaModelSchema, FeaResultSchema, normalizeFeaModel } from './feaModel';
import { buildPortalFrame, buildSimpleBeam, buildVierendeelFrame } from './feaBuilders';

describe('FeaModel schema & normalization', () => {
  it('applies defaults for analysis, dimension, element type, and load components', () => {
    const m = FeaModelSchema.parse({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 100, y: 0 },
      ],
      materials: [{ id: 'm', E: 29000 }],
      sections: [{ id: 's', A: 10, I: 100 }],
      elements: [{ id: 'e', nodeI: 'a', nodeJ: 'b', materialId: 'm', sectionId: 's' }],
    });
    expect(m.analysis).toBe('linearStatic');
    expect(m.dimension).toBe(2);
    expect(m.elements[0].type).toBe('elasticBeamColumn');
    expect(m.supports).toEqual([]);
    expect(m.nodalLoads).toEqual([]);
    expect(m.elementLoads).toEqual([]);
  });

  it('fills support fixity and nodal-load components with zeros/false by default', () => {
    const m = normalizeFeaModel({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 100, y: 0 },
      ],
      materials: [{ id: 'm', E: 29000 }],
      sections: [{ id: 's', A: 10, I: 100 }],
      elements: [{ id: 'e', nodeI: 'a', nodeJ: 'b', materialId: 'm', sectionId: 's' }],
      supports: [{ nodeId: 'a', dx: true }],
      nodalLoads: [{ nodeId: 'b', fy: -5 }],
    });
    expect(m.supports[0]).toMatchObject({ dx: true, dy: false, rz: false });
    expect(m.nodalLoads[0]).toMatchObject({ fx: 0, fy: -5, mz: 0 });
  });

  it('rejects a positive-only modulus/area/inertia violation', () => {
    expect(() =>
      FeaModelSchema.parse({
        nodes: [{ id: 'a', x: 0, y: 0 }],
        materials: [{ id: 'm', E: -1 }],
        sections: [{ id: 's', A: 10, I: 100 }],
        elements: [{ id: 'e', nodeI: 'a', nodeJ: 'a', materialId: 'm', sectionId: 's' }],
      }),
    ).toThrow();
  });

  describe('referential integrity (normalizeFeaModel)', () => {
    const base = {
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 100, y: 0 },
      ],
      materials: [{ id: 'm', E: 29000 }],
      sections: [{ id: 's', A: 10, I: 100 }],
      elements: [{ id: 'e', nodeI: 'a', nodeJ: 'b', materialId: 'm', sectionId: 's' }],
    };

    it('flags an element referencing a missing node', () => {
      expect(() =>
        normalizeFeaModel({
          ...base,
          elements: [{ id: 'e', nodeI: 'a', nodeJ: 'zzz', materialId: 'm', sectionId: 's' }],
        }),
      ).toThrow(/missing nodeJ zzz/);
    });

    it('flags a zero-length element', () => {
      expect(() =>
        normalizeFeaModel({
          ...base,
          elements: [{ id: 'e', nodeI: 'a', nodeJ: 'a', materialId: 'm', sectionId: 's' }],
        }),
      ).toThrow(/zero length/);
    });

    it('flags an element referencing a missing material/section', () => {
      expect(() =>
        normalizeFeaModel({
          ...base,
          elements: [{ id: 'e', nodeI: 'a', nodeJ: 'b', materialId: 'nope', sectionId: 's' }],
        }),
      ).toThrow(/missing material nope/);
    });

    it('flags loads/supports targeting missing entities', () => {
      expect(() => normalizeFeaModel({ ...base, supports: [{ nodeId: 'q' }] })).toThrow(/missing node q/);
      expect(() => normalizeFeaModel({ ...base, elementLoads: [{ elementId: 'q', wy: -1 }] })).toThrow(
        /missing element q/,
      );
    });
  });
});

describe('FEA builders', () => {
  it('buildPortalFrame produces 4 nodes, 3 elements, fixed/pinned bases', () => {
    const fixed = normalizeFeaModel(buildPortalFrame({ span: 240, height: 144, E: 4000, A: 12, I: 300, lateralLoad: 5 }));
    expect(fixed.nodes).toHaveLength(4);
    expect(fixed.elements.map((e) => e.id)).toEqual(['colL', 'colR', 'beam']);
    expect(fixed.supports.every((s) => s.rz)).toBe(true);
    expect(fixed.nodalLoads).toEqual([{ nodeId: 'tl', fx: 5, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }]);

    const pinned = normalizeFeaModel(buildPortalFrame({ span: 240, height: 144, E: 4000, A: 12, I: 300, base: 'pinned' }));
    expect(pinned.supports.every((s) => s.rz)).toBe(false);
  });

  it('buildPortalFrame applies beam gravity as a downward local load', () => {
    const m = normalizeFeaModel(buildPortalFrame({ span: 240, height: 144, E: 4000, A: 12, I: 300, beamGravity: 0.02 }));
    expect(m.elementLoads).toEqual([{ elementId: 'beam', wy: -0.02, wz: 0, wx: 0 }]);
  });

  it('buildVierendeelFrame (centerline) maps a pier×chord grid to nodes, members, sections & loads', () => {
    // 3 piers × 2 chords = one row of 2 openings. Pass lines out of order to
    // exercise the internal sort. rigidEndZones off → pure centerline mapping.
    const m = buildVierendeelFrame({
      verticals: [
        { x: 120, width: 8 },
        { x: 0, width: 8 },
        { x: 60, width: 6 },
      ],
      horizontals: [
        { y: 96, depth: 10 },
        { y: 0, depth: 10 },
      ],
      thickness: 8,
      E: 4000,
      lateralLoad: 10,
      gravity: 0.02,
      rigidEndZones: false,
    });
    // nodes = nV·nH = 6; members = piers nV·(nH−1)=3 + chords nH·(nV−1)=4 = 7.
    expect(m.nodes).toHaveLength(6);
    expect(m.elements).toHaveLength(7);
    expect(m.elements.filter((e) => e.id.startsWith('p'))).toHaveLength(3);
    expect(m.elements.filter((e) => e.id.startsWith('c'))).toHaveLength(4);
    // Interior pier (width 6, t 8): A = 48, I = 8·6³/12 = 144.
    expect(m.sections.find((s) => s.id === 'pier1')).toMatchObject({ A: 48, I: 144 });
    // Base supports on the lowest chord line, fixed.
    expect(m.supports.map((s) => s.nodeId).sort()).toEqual(['n0_0', 'n1_0', 'n2_0']);
    expect(m.supports.every((s) => s.rz)).toBe(true);
    // Lateral load split equally over the 3 top nodes; gravity on the 4 chords.
    expect(m.nodalLoads).toHaveLength(3);
    expect(m.nodalLoads.every((l) => Math.abs((l.fx ?? 0) - 10 / 3) < 1e-9)).toBe(true);
    expect(m.elementLoads).toHaveLength(4);
    // Sorting: leftmost pier centerline x is 0.
    expect(Math.min(...m.nodes.map((n) => n.x))).toBe(0);
  });

  it('buildVierendeelFrame (rigid) adds end-zone stubs, face nodes and joint self-weight', () => {
    const m = buildVierendeelFrame({
      verticals: [
        { x: 0, width: 8 },
        { x: 60, width: 6 },
        { x: 120, width: 8 },
      ],
      horizontals: [
        { y: 0, depth: 10 },
        { y: 96, depth: 10 },
      ],
      thickness: 8,
      E: 4000,
      unitWeight: 150,
    });
    const flex = m.elements.filter((e) => /^[pc]\d+_\d+$/.test(e.id));
    const stubs = m.elements.filter((e) => e.id.startsWith('rl_'));
    expect(flex).toHaveLength(7); // flexible members keep p/c ids
    expect(stubs).toHaveLength(14); // 2 rigid stubs per member
    expect(m.sections.some((s) => s.id === 'rigid')).toBe(true);
    expect(m.nodes).toHaveLength(6 + 2 * 7); // 6 joints + 2 face nodes per member
    // Every joint overlap is applied as a downward nodal self-weight (6 joints).
    expect(m.nodalLoads.filter((l) => (l.fy ?? 0) < 0)).toHaveLength(6);
    // Self-weight on all 7 flexible members.
    expect(m.elementLoads).toHaveLength(7);
  });

  it('buildVierendeelFrame self-weight equals the solid panel weight (joints included)', () => {
    const verticals = [
      { x: 0, width: 8 },
      { x: 60, width: 6 },
      { x: 120, width: 8 },
    ];
    const horizontals = [
      { y: 0, depth: 12 },
      { y: 96, depth: 10 },
      { y: 192, depth: 10 },
    ];
    const t = 8;
    const pcf = 150;
    const m = buildVierendeelFrame({ verticals, horizontals, thickness: t, E: 4000, unitWeight: pcf });
    const xy = new Map(m.nodes.map((n) => [n.id, n]));
    let applied = m.elementLoads.reduce((a, el) => {
      const e = m.elements.find((x) => x.id === el.elementId)!;
      const ni = xy.get(e.nodeI)!;
      const nj = xy.get(e.nodeJ)!;
      // weight magnitude per length is whichever of axial (piers) / transverse (chords) is set
      const wmag = Math.abs(el.wx ?? 0) + Math.abs(el.wy ?? 0);
      return a + wmag * Math.hypot(nj.x - ni.x, nj.y - ni.y);
    }, 0);
    applied += m.nodalLoads.reduce((a, nl) => a + Math.max(0, -(nl.fy ?? 0)), 0);

    // True panel extent runs face-to-face of the edge strips.
    const left = Math.min(...verticals.map((v) => v.x - v.width / 2));
    const right = Math.max(...verticals.map((v) => v.x + v.width / 2));
    const bottom = Math.min(...horizontals.map((h) => h.y - h.depth / 2));
    const top = Math.max(...horizontals.map((h) => h.y + h.depth / 2));
    let openings = 0;
    for (let i = 0; i < verticals.length - 1; i++)
      for (let j = 0; j < horizontals.length - 1; j++) {
        const ow = verticals[i + 1].x - verticals[i + 1].width / 2 - (verticals[i].x + verticals[i].width / 2);
        const oh = horizontals[j + 1].y - horizontals[j + 1].depth / 2 - (horizontals[j].y + horizontals[j].depth / 2);
        openings += ow * oh;
      }
    const solidWeight = ((right - left) * (top - bottom) - openings) * t * (pcf / 1728 / 1000);
    expect(applied).toBeCloseTo(solidWeight, 6);
  });

  it('buildVierendeelFrame rejects a degenerate grid (needs ≥2 piers and ≥2 chords)', () => {
    expect(() =>
      buildVierendeelFrame({
        verticals: [{ x: 0, width: 8 }],
        horizontals: [{ y: 0, depth: 10 }, { y: 96, depth: 10 }],
        thickness: 8,
        E: 4000,
      }),
    ).toThrow(/at least 2 piers/);
  });

  it('buildSimpleBeam discretizes into N elements with the right supports', () => {
    const simple = normalizeFeaModel(buildSimpleBeam({ length: 120, segments: 4, E: 4000, A: 10, I: 200, udl: 0.01 }));
    expect(simple.nodes).toHaveLength(5);
    expect(simple.elements).toHaveLength(4);
    expect(simple.elementLoads).toHaveLength(4);
    expect(simple.supports.map((s) => s.nodeId)).toEqual(['n0', 'n4']);

    const cant = normalizeFeaModel(buildSimpleBeam({ length: 120, segments: 2, E: 4000, A: 10, I: 200, support: 'cantilever' }));
    expect(cant.supports).toEqual([
      { nodeId: 'n0', dx: true, dy: true, dz: false, rx: false, ry: false, rz: true },
    ]);
  });
});

describe('FeaResult schema', () => {
  it('round-trips a minimal solver result', () => {
    const r = FeaResultSchema.parse({
      converged: true,
      solver: 'Eigen LDLT',
      message: 'ok',
      residual: 1e-15,
      nodalDisplacements: [{ nodeId: 'a', dx: 0, dy: -1, rz: 0.01 }],
      reactions: [{ nodeId: 'a', fx: 0, fy: 5, mz: 100 }],
      elementForces: [{ elementId: 'e', iN: 0, iV: 5, iM: 100, jN: 0, jV: -5, jM: 0 }],
    });
    expect(r.converged).toBe(true);
    expect(r.elementForces[0].iM).toBe(100);
  });
});
