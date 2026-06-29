import type { VierendeelLines, VierendeelMemberResult } from '@/engine/vierendeel';

/**
 * Elevation of a Vierendeel panel: the solid concrete with its openings cut out,
 * overlaid with the equivalent-frame members (pier/chord centerlines) colored by
 * utilization (green ≤ 0.9, amber ≤ 1.0, red > 1.0) and the base supports. Drawn
 * from the grid lines in model units (in); structural +y is up (SVG y flipped).
 */
export interface VierendeelDiagramProps {
  lines: VierendeelLines;
  members: VierendeelMemberResult[];
}

const utilColor = (u: number | undefined) =>
  u == null ? 'var(--muted-foreground)' : u > 1 ? 'var(--destructive)' : u > 0.9 ? 'var(--warning)' : 'var(--success)';

export function VierendeelDiagram({ lines, members }: VierendeelDiagramProps) {
  const { verticals, horizontals } = lines;
  const W = Math.max(...verticals.map((v) => v.x + v.width / 2));
  const H = Math.max(...horizontals.map((h) => h.y + h.depth / 2));
  const flip = (y: number) => H - y;
  const stroke = Math.max(W, H) * 0.014;
  const r = Math.max(W, H) * 0.011;
  const util = new Map(members.map((m) => [m.elementId, m.utilization]));

  // Member centerlines (joint-to-joint) — independent of the rigid-stub topology.
  const segs: { x1: number; y1: number; x2: number; y2: number; u: number | undefined }[] = [];
  for (let vi = 0; vi < verticals.length; vi++)
    for (let hj = 0; hj < horizontals.length - 1; hj++)
      segs.push({ x1: verticals[vi].x, y1: horizontals[hj].y, x2: verticals[vi].x, y2: horizontals[hj + 1].y, u: util.get(`p${vi}_${hj}`) });
  for (let hj = 0; hj < horizontals.length; hj++)
    for (let vi = 0; vi < verticals.length - 1; vi++)
      segs.push({ x1: verticals[vi].x, y1: horizontals[hj].y, x2: verticals[vi + 1].x, y2: horizontals[hj].y, u: util.get(`c${vi}_${hj}`) });

  const openings: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < verticals.length - 1; i++) {
    for (let j = 0; j < horizontals.length - 1; j++) {
      const left = verticals[i].x + verticals[i].width / 2;
      const right = verticals[i + 1].x - verticals[i + 1].width / 2;
      const bot = horizontals[j].y + horizontals[j].depth / 2;
      const top = horizontals[j + 1].y - horizontals[j + 1].depth / 2;
      openings.push({ x: left, y: flip(top), w: right - left, h: top - bot });
    }
  }

  const pad = stroke * 2;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 3 * pad}`}
      width="100%"
      style={{ maxWidth: 460 }}
      role="img"
      aria-label="Vierendeel panel elevation with member utilization"
    >
      <rect x={0} y={0} width={W} height={H} fill="var(--muted)" stroke="var(--border)" strokeWidth={stroke * 0.5} />
      {openings.map((o, i) => (
        <rect key={i} x={o.x} y={o.y} width={o.w} height={o.h} fill="var(--card)" stroke="var(--border)" strokeWidth={stroke * 0.4} />
      ))}
      {segs.map((s, i) => (
        <line key={i} x1={s.x1} y1={flip(s.y1)} x2={s.x2} y2={flip(s.y2)} stroke={utilColor(s.u)} strokeWidth={stroke} strokeLinecap="round" />
      ))}
      {verticals.map((v, vi) =>
        horizontals.map((h, hj) => <circle key={`j${vi}_${hj}`} cx={v.x} cy={flip(h.y)} r={r} fill="var(--foreground)" />),
      )}
      {/* base supports at the lowest chord line */}
      {verticals.map((v, vi) => (
        <polygon
          key={`s${vi}`}
          points={`${v.x},${flip(0)} ${v.x - r * 2},${flip(0) + r * 3} ${v.x + r * 2},${flip(0) + r * 3}`}
          fill="var(--muted-foreground)"
        />
      ))}
    </svg>
  );
}
