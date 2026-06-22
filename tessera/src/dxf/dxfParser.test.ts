/**
 * Tests for the ASCII DXF reader. Fixtures live in __fixtures__/.
 * Ported from the reference app (src/utils/dxfParser.test.js).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDxf, UNIT_SCALE_TO_INCHES, type Pt } from './dxfParser';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '__fixtures__', name), 'utf8');

const ringArea = (ring: Pt[]) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
};

describe('parseDxf — closed LWPOLYLINE', () => {
  it('reads a single rectangle and its $INSUNITS', () => {
    const { rings, units } = parseDxf(fixture('rect.dxf'));
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(units).toBe('in');
    expect(ringArea(rings[0])).toBeCloseTo(12 * 24, 6);
  });

  it('reads an outer ring plus an inner (hole) ring', () => {
    const { rings } = parseDxf(fixture('rect-with-hole.dxf'));
    expect(rings).toHaveLength(2);
    expect(ringArea(rings[0])).toBeCloseTo(288, 6);
    expect(ringArea(rings[1])).toBeCloseTo(32, 6);
  });
});

describe('parseDxf — POINT nodes', () => {
  it('reads POINT entities as nodes alongside the section ring', () => {
    const { rings, nodes } = parseDxf(fixture('rect-with-nodes.dxf'));
    expect(rings).toHaveLength(1);
    expect(ringArea(rings[0])).toBeCloseTo(12 * 24, 6);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ x: 2, y: 2 });
    expect(nodes[1]).toMatchObject({ x: 6, y: 21 });
  });

  it('errors when nodes are present but no closed outline exists', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'POINT', '10', '2', '20', '2', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    expect(() => parseDxf(dxf)).toThrow(/no closed section outline/i);
  });
});

describe('parseDxf — bulge tessellation', () => {
  it('expands a two-vertex closed polyline with bulge 1 into a full circle', () => {
    const { rings } = parseDxf(fixture('bulge-circle.dxf'));
    expect(rings).toHaveLength(1);
    expect(rings[0].length).toBeGreaterThan(8);
    expect(ringArea(rings[0])).toBeGreaterThan(76);
    expect(ringArea(rings[0])).toBeLessThan(78.6);
  });
});

describe('parseDxf — CIRCLE', () => {
  it('tessellates a CIRCLE into a closed polygon ring', () => {
    const { rings } = parseDxf(fixture('circle.dxf'));
    expect(rings).toHaveLength(1);
    expect(rings[0].length).toBeGreaterThanOrEqual(32);
    expect(ringArea(rings[0])).toBeGreaterThan(77);
    expect(ringArea(rings[0])).toBeLessThan(78.6);
  });
});

describe('parseDxf — units detection', () => {
  it('maps $INSUNITS = 4 to millimeters', () => {
    const dxf = [
      '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '90', '3', '70', '1',
      '10', '0', '20', '0', '10', '10', '20', '0', '10', '0', '20', '10',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const { units } = parseDxf(dxf);
    expect(units).toBe('mm');
    expect(UNIT_SCALE_TO_INCHES.mm).toBeCloseTo(1 / 25.4, 8);
  });
});

describe('parseDxf — error handling', () => {
  it('rejects binary / non-ASCII content (NUL bytes)', () => {
    expect(() => parseDxf('\x00\x01\x02 not a dxf')).toThrow(/ASCII/i);
  });

  it('rejects content with no closed geometry', () => {
    const open = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '90', '3', '70', '0',
      '10', '0', '20', '0', '10', '10', '20', '0', '10', '5', '20', '8',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    expect(() => parseDxf(open)).toThrow(/no closed polylines/i);
  });

  it('treats a polyline whose last vertex equals the first as closed', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LWPOLYLINE', '90', '4', '70', '0',
      '10', '0', '20', '0', '10', '6', '20', '0', '10', '6', '20', '6',
      '10', '0', '20', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n');
    const { rings } = parseDxf(dxf);
    expect(rings).toHaveLength(1);
    expect(ringArea(rings[0])).toBeCloseTo(18, 6);
  });
});
