import { buildDiagramGeometry } from './forceDiagramGeometry';
import type { DiagramPoint } from '@/fea/feaDiagrams';

/**
 * A single internal-force diagram (shear, moment, axial, …) drawn as a filled
 * SVG curve about a centered zero axis, with the peak value annotated.
 * Presentational only — it renders whatever sampled series it is handed.
 */
export function ForceDiagram({
  points,
  length,
  title,
  unit,
  digits = 1,
  colorClass = 'text-primary',
}: {
  points: DiagramPoint[];
  length: number;
  title: string;
  unit: string;
  digits?: number;
  colorClass?: string;
}) {
  const W = 440;
  const H = 120;
  const pad = 16;
  const g = buildDiagramGeometry(points, length, W, H, pad);
  const peakLabel = g.peak ? `${g.peak.value.toFixed(digits)} ${unit}` : '';
  // Keep the peak label inside the box.
  const labelAnchor = g.peak && g.peak.x > W - 90 ? 'end' : 'start';
  const labelX = g.peak ? Math.min(Math.max(g.peak.x + 6, pad), W - pad) : 0;

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
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md border bg-card" role="img" aria-label={`${title} diagram`}>
        {/* member axis (zero line) */}
        <line x1={pad} y1={g.baselineY} x2={W - pad} y2={g.baselineY} className="stroke-border" strokeWidth={1} />
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
      </svg>
    </figure>
  );
}
