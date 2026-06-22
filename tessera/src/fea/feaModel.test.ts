import { describe, it, expect } from 'vitest';
import { FeaModelSchema, FeaResultSchema, normalizeFeaModel } from './feaModel';
import { buildPortalFrame, buildSimpleBeam } from './feaBuilders';

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
    expect(m.elements[0].type).toBe('elasticBeamColumn2d');
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
    expect(fixed.nodalLoads).toEqual([{ nodeId: 'tl', fx: 5, fy: 0, mz: 0 }]);

    const pinned = normalizeFeaModel(buildPortalFrame({ span: 240, height: 144, E: 4000, A: 12, I: 300, base: 'pinned' }));
    expect(pinned.supports.every((s) => s.rz)).toBe(false);
  });

  it('buildPortalFrame applies beam gravity as a downward local load', () => {
    const m = normalizeFeaModel(buildPortalFrame({ span: 240, height: 144, E: 4000, A: 12, I: 300, beamGravity: 0.02 }));
    expect(m.elementLoads).toEqual([{ elementId: 'beam', wy: -0.02 }]);
  });

  it('buildSimpleBeam discretizes into N elements with the right supports', () => {
    const simple = normalizeFeaModel(buildSimpleBeam({ length: 120, segments: 4, E: 4000, A: 10, I: 200, udl: 0.01 }));
    expect(simple.nodes).toHaveLength(5);
    expect(simple.elements).toHaveLength(4);
    expect(simple.elementLoads).toHaveLength(4);
    expect(simple.supports.map((s) => s.nodeId)).toEqual(['n0', 'n4']);

    const cant = normalizeFeaModel(buildSimpleBeam({ length: 120, segments: 2, E: 4000, A: 10, I: 200, support: 'cantilever' }));
    expect(cant.supports).toEqual([{ nodeId: 'n0', dx: true, dy: true, rz: true }]);
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
