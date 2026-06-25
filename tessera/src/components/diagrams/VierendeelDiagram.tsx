import type { FeaModelInput } from '@/fea/feaModel';
import type { VierendeelLines, VierendeelMemberResult } from '@/engine/vierendeel';

/**
 * Elevation of a Vierendeel panel: the solid concrete with its openings cut out,
 * overlaid with the equivalent-frame members colored by utilization
 * (green ≤ 0.9, amber ≤ 1.0, red > 1.0) and the base supports. Geometry is drawn
 * in model units (in) via the viewBox; structural +y is up (SVG y flipped).
 */
export interface VierendeelDiagramProps {
  lines: VierendeelLines;
  model: FeaModelInput;
  members: VierendeelMemberResult[];
}

const utilColor = (u: number | undefined) =>
  u == null ? 'var(--muted-foreground)' : u > 1 ? 'var(--destructive)' : u > 0.9 ? 'var(--warning)' : 'var(--success)';

export function VierendeelDiagram({ lines, model, members }: VierendeelDiagramProps) {
  const { verticals, horizontals } = lines;
  const W = Math.max(...verticals.map((v) => v.x + v.width / 2));
  const H = Math.max(...horizontals.map((h) => h.y + h.depth / 2));
  const flip = (y: number) => H - y;
  const stroke = Math.max(W, H) * 0.014;
  const r = Math.max(W, H) * 0.011;
  const utilById = new Map(members.map((m) => [m.elementId, m.utilization]));
  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));

  // Opening rectangles (cells between adjacent piers and chords).
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
      {/* solid concrete */}
      <rect x={0} y={0} width={W} height={H} fill="var(--muted)" stroke="var(--border)" strokeWidth={stroke * 0.5} />
      {/* openings */}
      {openings.map((o, i) => (
        <rect key={i} x={o.x} y={o.y} width={o.w} height={o.h} fill="var(--card)" stroke="var(--border)" strokeWidth={stroke * 0.4} />
      ))}
      {/* equivalent-frame members, colored by utilization */}
      {model.elements.map((e) => {
        const a = nodeById.get(e.nodeI)!;
        const b = nodeById.get(e.nodeJ)!;
        return (
          <line
            key={e.id}
            x1={a.x}
            y1={flip(a.y)}
            x2={b.x}
            y2={flip(b.y)}
            stroke={utilColor(utilById.get(e.id))}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        );
      })}
      {/* joints */}
      {model.nodes.map((n) => (
        <circle key={n.id} cx={n.x} cy={flip(n.y)} r={r} fill="var(--foreground)" />
      ))}
      {/* base supports (lowest chord line, y = 0) */}
      {model.nodes
        .filter((n) => n.y === 0)
        .map((n) => (
          <polygon
            key={`s${n.id}`}
            points={`${n.x},${flip(0)} ${n.x - r * 2},${flip(0) + r * 3} ${n.x + r * 2},${flip(0) + r * 3}`}
            fill="var(--muted-foreground)"
          />
        ))}
    </svg>
  );
}
