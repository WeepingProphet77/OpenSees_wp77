import { buildDiagramGeometry } from './forceDiagramGeometry';
import { interpolateDiagram, type DiagramPoint } from '@/fea/feaDiagrams';

const W = 440;
const H = 120;
const PAD = 16;

/**
 * A single internal-force diagram (shear, moment, axial, …) drawn as a filled
 * SVG curve about a centered zero axis, with the peak value annotated and an
 * optional synced cursor that reads the value at a station.
 *
 * `cursorXFrac` (0..1 along the span) is controlled by the parent so multiple
 * diagrams share one cursor; pointer movement is reported via `onHover`.
 */
export function ForceDiagram({
  points,
  length,
  title,
  unit,
  digits = 1,
  colorClass = 'text-primary',
  cursorXFrac = null,
  onHover,
}: {
  points: DiagramPoint[];
  length: number;
  title: string;
  unit: string;
  digits?: number;
  colorClass?: string;
  cursorXFrac?: number | null;
  onHover?: (frac: number | null) => void;
}) {
  const g = buildDiagramGeometry(points, length, W, H, PAD);
  const peakLabel = g.peak ? `${g.peak.value.toFixed(digits)} ${unit}` : '';
  const labelAnchor = g.peak && g.peak.x > W - 90 ? 'end' : 'start';
  const labelX = g.peak ? Math.min(Math.max(g.peak.x + 6, PAD), W - PAD) : 0;

  // Cursor: interpolate this series at the shared station.
  const cursor =
    cursorXFrac != null && length > 0
      ? (() => {
          const xMember = cursorXFrac * length;
          const value = interpolateDiagram(points, xMember);
          return { px: g.scaleX(xMember), py: g.scaleY(value), value };
        })()
      : null;

  const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onHover) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    onHover(Math.min(1, Math.max(0, (px - PAD) / (W - 2 * PAD))));
  };

  return (
    <figure className={colorClass}>
      <figcaption className="mb-1 flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">{title}</span>
        {g.peak && (
          <span className="font-mono tabular-nums">
            max {Math.abs(g.peak.value).toFixed(digits)} {unit}
          </span>
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-md border bg-card touch-none"
        role="img"
        aria-label={`${title} diagram`}
        onPointerMove={handleMove}
        onPointerDown={handleMove}
        onPointerLeave={() => onHover?.(null)}
      >
        {/* member axis (zero line) */}
        <line x1={PAD} y1={g.baselineY} x2={W - PAD} y2={g.baselineY} className="stroke-border" strokeWidth={1} />
        <path d={g.area} className="fill-current opacity-15" />
        <path d={g.line} className="stroke-current" strokeWidth={1.5} fill="none" />

        {g.peak && Math.abs(g.peak.value) > 1e-9 && (
          <>
            <circle cx={g.peak.x} cy={g.peak.y} r={2.5} className="fill-current" />
            <text
              x={labelX}
              y={g.peak.y < g.baselineY ? g.peak.y - 5 : g.peak.y + 12}
              textAnchor={labelAnchor}
              className="fill-current font-mono text-[10px]"
            >
              {peakLabel}
            </text>
          </>
        )}

        {cursor && (
          <g>
            <line x1={cursor.px} y1={PAD / 2} x2={cursor.px} y2={H - PAD / 2} className="stroke-current opacity-40" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={cursor.px} cy={cursor.py} r={3} className="fill-current" />
            <text
              x={Math.min(Math.max(cursor.px + 5, PAD), W - PAD)}
              y={cursor.py < g.baselineY ? cursor.py - 5 : cursor.py + 12}
              textAnchor={cursor.px > W - 70 ? 'end' : 'start'}
              className="fill-current font-mono text-[10px]"
            >
              {cursor.value.toFixed(digits)} {unit}
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}
