/**
 * Minimal, dependency-free ASCII DXF reader for the "Custom (DXF Import)"
 * section type (build spec §7). Ported from the reference app's dxfParser.js.
 *
 * Walks the ENTITIES section and extracts the closed loops needed to define a
 * concrete cross-section (closed LWPOLYLINE / POLYLINE with bulge arcs
 * tessellated, and CIRCLE entities), plus POINT entities as reinforcement
 * locations. Reads $INSUNITS so the caller can scale to inches. Output is in raw
 * DXF coordinates (y up); normalization lives in dxfGeometry.ts.
 */
export interface Pt {
  x: number;
  y: number;
}
interface Vertex {
  x: number;
  y: number;
  bulge: number;
}
interface Token {
  code: number;
  value: string;
}
export interface ParsedDxf {
  rings: Pt[][];
  nodes: Pt[];
  units: string | null;
  warnings: string[];
}

const INSUNITS_TO_INCHES: Record<number, number> = {
  1: 1,
  2: 12,
  4: 1 / 25.4,
  5: 1 / 2.54,
  6: 1000 / 25.4,
};

export const UNIT_SCALE_TO_INCHES: Record<string, number> = {
  in: 1,
  ft: 12,
  mm: 1 / 25.4,
  cm: 1 / 2.54,
  m: 1000 / 25.4,
};

const INSUNITS_TO_NAME: Record<number, string> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };

const ENDPOINT_EPS = 1e-6;

function tessellateBulge(p1: Vertex, p2: Vertex, bulge: number): Pt[] {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const chord = Math.hypot(dx, dy);
  if (Math.abs(bulge) < 1e-9 || chord < 1e-12) return [];

  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const k = (1 - bulge * bulge) / (4 * bulge);
  const cx = mx - dy * k;
  const cy = my + dx * k;

  const theta = 4 * Math.atan(bulge);
  const a1 = Math.atan2(p1.y - cy, p1.x - cx);
  const R = Math.hypot(p1.x - cx, p1.y - cy);

  const n = Math.max(1, Math.ceil(Math.abs(theta) / (Math.PI / 8)));
  const pts: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const a = a1 + (theta * i) / n;
    pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  }
  return pts;
}

function cleanRing(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < ENDPOINT_EPS) continue;
    out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < ENDPOINT_EPS) out.pop();
  }
  return out;
}

function tokenize(text: string): Token[] {
  const lines = text.split(/\r\n|\r|\n/);
  const tokens: Token[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeStr = lines[i].trim();
    if (codeStr === '') {
      i -= 1;
      continue;
    }
    const code = Number(codeStr);
    if (!Number.isInteger(code)) {
      throw new Error('This does not look like a text (ASCII) DXF file. Re-export as ASCII DXF.');
    }
    tokens.push({ code, value: lines[i + 1] });
  }
  return tokens;
}

export function parseDxf(text: string): ParsedDxf {
  if (typeof text !== 'string' || text.indexOf('\0') !== -1) {
    throw new Error('This does not look like a text (ASCII) DXF file. Re-export as ASCII DXF.');
  }
  const tokens = tokenize(text);
  if (!tokens.length) throw new Error('The DXF file is empty or unreadable.');

  const rings: Pt[][] = [];
  const nodes: Pt[] = [];
  const warnings: string[] = [];
  let units: string | null = null;

  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].code === 9 && tokens[i].value.trim() === '$INSUNITS') {
      const next = tokens[i + 1];
      const code = Number(next.value);
      if (Number.isFinite(code)) units = INSUNITS_TO_NAME[code] ?? null;
      break;
    }
  }

  let start = 0;
  let end = tokens.length;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].code === 2 && tokens[i].value.trim() === 'ENTITIES') start = i + 1;
    if (start && tokens[i].code === 0 && tokens[i].value.trim() === 'ENDSEC' && i > start) {
      end = i;
      break;
    }
  }

  let i = start;
  while (i < end) {
    const tok = tokens[i];
    if (tok.code !== 0) {
      i++;
      continue;
    }
    const type = tok.value.trim();

    if (type === 'LWPOLYLINE') {
      const res = readLwpolyline(tokens, i + 1, end);
      i = res.next;
      const ring = finalizeRing(res.vertices, res.closed, warnings, 'LWPOLYLINE');
      if (ring) rings.push(ring);
    } else if (type === 'POLYLINE') {
      const res = readPolyline(tokens, i + 1, end);
      i = res.next;
      const ring = finalizeRing(res.vertices, res.closed, warnings, 'POLYLINE');
      if (ring) rings.push(ring);
    } else if (type === 'CIRCLE') {
      const res = readCircle(tokens, i + 1, end);
      i = res.next;
      if (res.circle) rings.push(circleToRing(res.circle));
    } else if (type === 'POINT') {
      const res = readPoint(tokens, i + 1, end);
      i = res.next;
      if (res.point) nodes.push(res.point);
    } else if (type === 'ELLIPSE' || type === 'SPLINE') {
      warnings.push(`A ${type} entity was found and skipped — only closed polylines and circles are supported.`);
      i++;
    } else {
      i++;
    }
  }

  if (!rings.length) {
    if (nodes.length) {
      throw new Error(
        `Found ${nodes.length} node(s) but no closed section outline. Draw the ` +
          `concrete cross-section with a closed polyline so the nodes can be placed inside it.`,
      );
    }
    throw new Error('No closed polylines (or circles) were found in the DXF. Draw the section with closed polylines.');
  }

  return { rings, nodes, units, warnings };
}

function readLwpolyline(tokens: Token[], from: number, end: number) {
  let closed = false;
  const verts: Vertex[] = [];
  let cur: Vertex | null = null;
  let i = from;
  for (; i < end; i++) {
    const { code, value } = tokens[i];
    if (code === 0) break;
    if (code === 70) {
      closed = (Number(value) & 1) === 1;
    } else if (code === 10) {
      if (cur) verts.push(cur);
      cur = { x: Number(value), y: 0, bulge: 0 };
    } else if (code === 20 && cur) {
      cur.y = Number(value);
    } else if (code === 42 && cur) {
      cur.bulge = Number(value);
    }
  }
  if (cur) verts.push(cur);
  return { vertices: verts, closed, next: i };
}

function readPolyline(tokens: Token[], from: number, end: number) {
  let closed = false;
  const verts: Vertex[] = [];
  let i = from;
  for (; i < end; i++) {
    const { code, value } = tokens[i];
    if (code === 0) break;
    if (code === 70) closed = (Number(value) & 1) === 1;
  }
  while (i < end) {
    const { code, value } = tokens[i];
    if (code !== 0) {
      i++;
      continue;
    }
    const t = value.trim();
    if (t === 'VERTEX') {
      const v: Vertex = { x: 0, y: 0, bulge: 0 };
      i++;
      for (; i < end; i++) {
        const tk = tokens[i];
        if (tk.code === 0) break;
        if (tk.code === 10) v.x = Number(tk.value);
        else if (tk.code === 20) v.y = Number(tk.value);
        else if (tk.code === 42) v.bulge = Number(tk.value);
      }
      verts.push(v);
    } else if (t === 'SEQEND') {
      i++;
      break;
    } else {
      break;
    }
  }
  return { vertices: verts, closed, next: i };
}

function readCircle(tokens: Token[], from: number, end: number) {
  const c = { x: 0, y: 0, r: 0 };
  let i = from;
  for (; i < end; i++) {
    const { code, value } = tokens[i];
    if (code === 0) break;
    if (code === 10) c.x = Number(value);
    else if (code === 20) c.y = Number(value);
    else if (code === 40) c.r = Number(value);
  }
  return { circle: c.r > 0 ? c : null, next: i };
}

function readPoint(tokens: Token[], from: number, end: number) {
  const p: { x: number | null; y: number | null } = { x: null, y: null };
  let i = from;
  for (; i < end; i++) {
    const { code, value } = tokens[i];
    if (code === 0) break;
    if (code === 10) p.x = Number(value);
    else if (code === 20) p.y = Number(value);
  }
  const ok = Number.isFinite(p.x) && Number.isFinite(p.y);
  return { point: ok ? { x: p.x as number, y: p.y as number } : null, next: i };
}

function finalizeRing(vertices: Vertex[], closed: boolean, warnings: string[], kind: string): Pt[] | null {
  if (vertices.length < 2) return null;

  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  const coincident = Math.hypot(first.x - last.x, first.y - last.y) < ENDPOINT_EPS;
  const isClosed = closed || coincident;
  if (!isClosed) {
    warnings.push(`An open ${kind} was skipped — only closed polylines define solids or openings.`);
    return null;
  }

  const pts: Pt[] = [];
  const n = vertices.length;
  const segCount = closed && !coincident ? n : n - 1;
  for (let k = 0; k < n; k++) {
    const v = vertices[k];
    pts.push({ x: v.x, y: v.y });
    if (k < segCount) {
      const nv = vertices[(k + 1) % n];
      if (Math.abs(v.bulge || 0) > 1e-9) {
        pts.push(...tessellateBulge(v, nv, v.bulge));
      }
    }
  }

  const ring = cleanRing(pts);
  return ring.length >= 3 ? ring : null;
}

function circleToRing(c: { x: number; y: number; r: number }, segments = 48): Pt[] {
  const ring: Pt[] = [];
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * 2 * Math.PI;
    ring.push({ x: c.x + c.r * Math.cos(a), y: c.y + c.r * Math.sin(a) });
  }
  return ring;
}

export { INSUNITS_TO_INCHES };
