/**
 * Tests for DXF ring classification + normalization, and an end-to-end check
 * that a DXF-derived section analyzes identically to an equivalent hand-built
 * section. Ported from the reference app (src/utils/dxfGeometry.test.js).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDxf } from './dxfParser';
import { classifyRings, dxfRingsToSection } from './dxfGeometry';
import { analyzeBeam, analyzeBiaxial, grossSectionProperties } from '../engine/beamCalculations';
import steelPresets from '../engine/steelPresets';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '__fixtures__', name), 'utf8');
const GR60 = steelPresets.find((p) => p.id === 'grade60')!;
const GR270 = steelPresets.find((p) => p.id === 'grade270')!;

describe('classifyRings', () => {
  it('marks an outer ring as solid (depth 0) and a nested ring as an opening (depth 1)', () => {
    const { rings } = parseDxf(fixture('rect-with-hole.dxf'));
    const depths = classifyRings(rings);
    expect(depths[0]).toBe(0);
    expect(depths[1]).toBe(1);
  });

  it('marks two disjoint rings both as solids (depth 0)', () => {
    const { rings } = parseDxf(fixture('two-solids.dxf'));
    expect(classifyRings(rings)).toEqual([0, 0]);
  });
});

describe('dxfRingsToSection — normalization', () => {
  it('flips Y so the top fiber is at y = 0 and sets h', () => {
    const { rings } = parseDxf(fixture('rect.dxf'));
    const { points, holes, h, stats } = dxfRingsToSection(rings, { unitScale: 1 });
    expect(h).toBeCloseTo(24, 6);
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0, 6);
    expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(24, 6);
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(0, 6);
    expect(holes).toHaveLength(0);
    expect(stats.area).toBeCloseTo(288, 6);
  });

  it('carries an interior opening through as a hole and nets its area', () => {
    const { rings } = parseDxf(fixture('rect-with-hole.dxf'));
    const { holes, stats } = dxfRingsToSection(rings, { unitScale: 1 });
    expect(holes).toHaveLength(1);
    expect(stats.area).toBeCloseTo(288 - 32, 6);
    expect(stats.openingCount).toBe(1);
  });

  it('applies the unit scale (mm → in)', () => {
    const { rings } = parseDxf(fixture('rect.dxf'));
    const { h, stats } = dxfRingsToSection(rings, { unitScale: 1 / 25.4 });
    expect(h).toBeCloseTo(24 / 25.4, 6);
    expect(stats.width).toBeCloseTo(12 / 25.4, 6);
  });

  it('rejects multiple separate solids', () => {
    const { rings } = parseDxf(fixture('two-solids.dxf'));
    expect(() => dxfRingsToSection(rings, { unitScale: 1 })).toThrow(/separate solid/i);
  });
});

describe('dxfRingsToSection — reinforcement nodes', () => {
  it('transforms POINT nodes to engine coords and orders them', () => {
    const { rings, nodes } = parseDxf(fixture('rect-with-nodes.dxf'));
    const { nodes: out, stats } = dxfRingsToSection(rings, { unitScale: 1, nodes });
    expect(stats.nodeCount).toBe(2);
    expect(out[0]).toMatchObject({ x: 6, depth: 3 });
    expect(out[1]).toMatchObject({ x: 2, depth: 22 });
  });

  it('applies the unit scale to nodes', () => {
    const { rings, nodes } = parseDxf(fixture('rect-with-nodes.dxf'));
    const { nodes: out } = dxfRingsToSection(rings, { unitScale: 1 / 25.4, nodes });
    expect(out[0].x).toBeCloseTo(6 / 25.4, 6);
    expect(out[0].depth).toBeCloseTo(3 / 25.4, 6);
  });

  it('warns when a node lies outside the concrete', () => {
    const { rings } = parseDxf(fixture('rect-with-nodes.dxf'));
    const outside = [{ x: 20, y: 20 }];
    const { nodes: out, stats, warnings } = dxfRingsToSection(rings, { unitScale: 1, nodes: outside });
    expect(stats.nodeCount).toBe(1);
    expect(out).toHaveLength(1);
    expect(warnings.some((w) => /outside the concrete/i.test(w))).toBe(true);
  });

  it('returns no nodes when none are supplied', () => {
    const { rings } = parseDxf(fixture('rect.dxf'));
    const { nodes: out, stats } = dxfRingsToSection(rings, { unitScale: 1 });
    expect(out).toEqual([]);
    expect(stats.nodeCount).toBe(0);
  });

  it('node-derived layers feed the (unchanged) biaxial engine end to end', () => {
    const { rings, nodes } = parseDxf(fixture('rect-with-nodes.dxf'));
    const { points, holes, h, nodes: out } = dxfRingsToSection(rings, { unitScale: 1, nodes });
    const section = { sectionType: 'dxf' as const, points, holes, h, fc: 5, bendingMode: 'biaxial' as const, lambda: 1 };
    const layers = out.map((n) => ({ area: 0.153, depth: n.depth, x: n.x, fse: 170, steel: GR270 }));

    const res = analyzeBiaxial(section, layers, { Mux: 0, Muy: 0 });
    expect(res.mode).toBe('biaxial');
    expect(res.envelope.length).toBeGreaterThan(0);
    expect(Number.isFinite(res.anchors.xSag.phiMx)).toBe(true);
  });
});

describe('DXF section ↔ engine equivalence', () => {
  it('a DXF rectangle gives the same gross properties as the built-in rectangle', () => {
    const { rings } = parseDxf(fixture('rect.dxf'));
    const { points, holes, h } = dxfRingsToSection(rings, { unitScale: 1 });
    const dxfSection = { sectionType: 'dxf' as const, points, holes, h, fc: 4 };
    const rect = { sectionType: 'rectangular' as const, bw: 12, h: 24, fc: 4 };

    const a = grossSectionProperties(dxfSection);
    const b = grossSectionProperties(rect);
    expect(a.A).toBeCloseTo(b.A, 4);
    expect(a.yCg).toBeCloseTo(b.yCg, 4);
    expect(a.Ig).toBeCloseTo(b.Ig, 2);
  });

  it('analyzeBeam matches the equivalent hand-built custom section', () => {
    const { rings } = parseDxf(fixture('rect.dxf'));
    const { points, holes, h } = dxfRingsToSection(rings, { unitScale: 1 });
    const layers = [{ area: 3.0, depth: 21.5, fse: 0, steel: GR60 }];

    const dxfRes = analyzeBeam({ sectionType: 'dxf', points, holes, h, fc: 4 }, layers);
    const customRes = analyzeBeam({ sectionType: 'custom', points, holes, h, fc: 4 }, layers);

    expect(dxfRes.converged).toBe(true);
    expect(dxfRes.MnFt).toBeCloseTo(customRes.MnFt, 6);
    expect(dxfRes.phiMnFt).toBeCloseTo(customRes.phiMnFt, 6);
    expect(dxfRes.a).toBeCloseTo(4.412, 1);
    expect(dxfRes.MnFt).toBeGreaterThan(283);
    expect(dxfRes.MnFt).toBeLessThan(296);
  });
});
