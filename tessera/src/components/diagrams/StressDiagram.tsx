import { interpolateDiagram, type DiagramPoint } from '@/fea/feaDiagrams';
import type { StressStation } from '@/engine/designChecks/serviceStresses';

const W = 440;
const H = 150;
const PAD_X = 18;
const PAD_Y = 16;

const asSeries = (s: StressStation[], key: 'top' | 'bottom'): DiagramPoint[] =>
  s.map((p) => ({ x: p.x, value: p[key] }));

/**
 * Service fiber-stress diagram for one load stage: the top- and bottom-fiber
 * stress curves along the span (ksi, compression positive) drawn against the
 * allowable compression (+) and tension (−) limit lines. Unlike the centered
 * {@link ForceDiagram}, the y-axis spans absolute ksi so the zero axis and the
 * limit lines carry meaning. Shares the parent's synced cursor.
 */
export function StressDiagram({
  title,
  stations,
  length,
  compLimit,
  tenLimit,
  compLabel,
  tenLabel,
  cursorXFrac = null,
  onHover,
}: {
  title: string;
  stations: StressStation[];
  length: number;
  /** Allowable compression magnitude (ksi, drawn at +value). */
  compLimit: number;
  /** Allowable tension magnitude (ksi, drawn at −value). */
  tenLimit: number;
  compLabel: string;
  tenLabel: string;
  cursorXFrac?: number | null;
  onHover?: (frac: number | null) => void;
}) {
  const top = asSeries(stations, 'top');
  const bottom = asSeries(stations, 'bottom');

  // Symmetric-ish absolute domain that always includes both limit lines and 0.
  const vals = [...top, ...bottom].map((p) => p.value).concat([compLimit, -tenLimit, 0]);
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const pad = (hi - lo) * 0.1 || 1;
  const dHi = hi + pad;
  const dLo = lo - pad;

  const sx = (x: number) => (length > 0 ? PAD_X + (x / length) * (W - 2 * PAD_X) : PAD_X);
  const sy = (v: number) => PAD_Y + ((dHi - v) / (dHi - dLo)) * (H - 2 * PAD_Y);
  const path = (pts: DiagramPoint[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.value).toFixed(1)}`).join(' ');

  const exceeded = stations.some(
    (p) => p.top > compLimit + 1e-9 || p.bottom > compLimit + 1e-9 || p.top < -tenLimit - 1e-9 || p.bottom < -tenLimit - 1e-9,
  );

  const cursor =
    cursorXFrac != null && length > 0
      ? {
          px: sx(cursorXFrac * length),
          top: interpolateDiagram(top, cursorXFrac * length),
          bottom: interpolateDiagram(bottom, cursorXFrac * length),
        }
      : null;

  const limitLine = (v: number, label: string, danger: boolean) => (
    <g>
      <line
        x1={PAD_X}
        y1={sy(v)}
        x2={W - PAD_X}
        y2={sy(v)}
        className={danger ? 'stroke-red-500/70' : 'stroke-muted-foreground/50'}
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <text x={W - PAD_X} y={sy(v) + (v >= 0 ? -3 : 10)} textAnchor="end" className="fill-muted-foreground text-[9px]">
        {label}
      </text>
    </g>
  );

  return (
    <figure>
      <figcaption className="mb-1 flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">{title}</span>
        <span className={`font-mono ${exceeded ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {exceeded ? 'exceeds limit' : 'within limits'}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none rounded-md border bg-card"
        role="img"
        aria-label={`${title} fiber-stress diagram`}
        onPointerMove={(e) => {
          if (!onHover) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width === 0) return;
          const px = ((e.clientX - rect.left) / rect.width) * W;
          onHover(Math.min(1, Math.max(0, (px - PAD_X) / (W - 2 * PAD_X))));
        }}
        onPointerDown={(e) => {
          if (!onHover) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (rect.width === 0) return;
          const px = ((e.clientX - rect.left) / rect.width) * W;
          onHover(Math.min(1, Math.max(0, (px - PAD_X) / (W - 2 * PAD_X))));
        }}
        onPointerLeave={() => onHover?.(null)}
      >
        {/* zero axis */}
        <line x1={PAD_X} y1={sy(0)} x2={W - PAD_X} y2={sy(0)} className="stroke-border" strokeWidth={1} />
        {limitLine(compLimit, compLabel, true)}
        {limitLine(-tenLimit, tenLabel, true)}

        <path d={path(top)} className="stroke-sky-600 dark:stroke-sky-400" strokeWidth={1.5} fill="none" />
        <path d={path(bottom)} className="stroke-primary" strokeWidth={1.5} fill="none" />

        {cursor && (
          <g>
            <line
              x1={cursor.px}
              y1={PAD_Y / 2}
              x2={cursor.px}
              y2={H - PAD_Y / 2}
              className="stroke-muted-foreground/50"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle cx={cursor.px} cy={sy(cursor.top)} r={3} className="fill-sky-600 dark:fill-sky-400" />
            <circle cx={cursor.px} cy={sy(cursor.bottom)} r={3} className="fill-primary" />
          </g>
        )}

        {/* legend */}
        <g className="text-[9px]">
          <text x={PAD_X} y={H - 4} className="fill-sky-600 dark:fill-sky-400">
            ■ top {cursor ? `${cursor.top.toFixed(3)} ksi` : ''}
          </text>
          <text x={W / 2} y={H - 4} className="fill-primary">
            ■ bottom {cursor ? `${cursor.bottom.toFixed(3)} ksi` : ''}
          </text>
        </g>
      </svg>
    </figure>
  );
}
