/**
 * Turn the raw closed rings parsed from a DXF into the section geometry the
 * analysis engine expects (build spec §7). Ported from the reference app's
 * dxfGeometry.js.
 *
 * Engine "custom"/"dxf" convention: coordinates in inches, y DOWN with y = 0 at
 * the top (extreme compression fiber), x from the left. DXF is y-UP with an
 * arbitrary origin, so this module classifies rings by nesting depth (even =
 * solid, odd = opening), scales to inches, and flips/translates Y.
 */
import { polygonProperties } from '../engine/beamCalculations';
import type { Pt } from './dxfParser';
export { UNIT_SCALE_TO_INCHES } from './dxfParser';

function pointInRing(pt: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersects =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function ringCentroid(ring: Pt[]): Pt {
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a2) < 1e-12) return { x: ring[0].x, y: ring[0].y };
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

function representativePoint(ring: Pt[]): Pt {
  const c = ringCentroid(ring);
  const v = ring[0];
  return { x: v.x + 1e-6 * (c.x - v.x), y: v.y + 1e-6 * (c.y - v.y) };
}

/** Nesting depth of each ring (even ⇒ solid, odd ⇒ opening). */
export function classifyRings(rings: Pt[][]): number[] {
  const reps = rings.map(representativePoint);
  return rings.map((_, i) => {
    let depth = 0;
    for (let j = 0; j < rings.length; j++) {
      if (j !== i && pointInRing(reps[i], rings[j])) depth++;
    }
    return depth;
  });
}

export interface DxfSection {
  points: Pt[];
  holes: Pt[][];
  h: number;
  nodes: Array<{ x: number; depth: number }>;
  stats: { width: number; height: number; area: number; openingCount: number; nodeCount: number };
  warnings: string[];
}

/** Normalize parsed DXF rings into engine-ready section geometry. */
export function dxfRingsToSection(
  rings: Pt[][],
  { unitScale = 1, nodes = [] as Pt[] }: { unitScale?: number; nodes?: Pt[] } = {},
): DxfSection {
  if (!rings || !rings.length) {
    throw new Error('No closed geometry was found in the DXF.');
  }
  const warnings: string[] = [];
  const depths = classifyRings(rings);

  const solids = rings.filter((_, i) => depths[i] % 2 === 0);
  const openings = rings.filter((_, i) => depths[i] === 1);
  const islands = rings.filter((_, i) => depths[i] >= 2);

  if (solids.length === 0) {
    throw new Error('Could not identify a solid outer boundary in the DXF.');
  }
  if (solids.length > 1) {
    throw new Error(
      `Found ${solids.length} separate solid regions. This section type supports a ` +
        `single connected outer boundary with interior openings. Combine the solids ` +
        `into one closed outline, or remove the extra regions.`,
    );
  }
  if (islands.length) {
    warnings.push(
      `${islands.length} ring(s) nested inside an opening were ignored (islands within voids are not modeled).`,
    );
  }

  const outer = solids[0];

  let minX = Infinity;
  let maxY = -Infinity;
  let minYraw = Infinity;
  let maxYraw = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.y > maxYraw) maxYraw = p.y;
      if (p.y < minYraw) minYraw = p.y;
    }
  }

  const tx = (p: Pt): Pt => ({
    x: (p.x - minX) * unitScale,
    y: (maxY - p.y) * unitScale,
  });
  const points = outer.map(tx);
  const holes = openings.map((ring) => ring.map(tx));

  const h = (maxYraw - minYraw) * unitScale;

  const section = { sectionType: 'dxf' as const, points, holes };
  const { A } = polygonProperties(section);
  let width = 0;
  for (const p of points) if (p.x > width) width = p.x;

  const transformedNodes = nodes.map((p) => {
    const t = tx(p);
    return { x: t.x, depth: t.y };
  });
  let outsideCount = 0;
  for (const n of transformedNodes) {
    const pt = { x: n.x, y: n.depth };
    const inSolid = pointInRing(pt, points);
    const inVoid = holes.some((hole) => hole.length >= 3 && pointInRing(pt, hole));
    if (!inSolid || inVoid) outsideCount++;
  }
  transformedNodes.sort((a, b) => a.depth - b.depth || a.x - b.x);
  if (outsideCount) {
    warnings.push(
      `${outsideCount} node(s) lie outside the concrete (or inside a void). Their ` +
        `steel layers were still created — reposition them or adjust the section.`,
    );
  }

  return {
    points,
    holes,
    h,
    nodes: transformedNodes,
    stats: { width, height: h, area: A, openingCount: holes.length, nodeCount: transformedNodes.length },
    warnings,
  };
}
