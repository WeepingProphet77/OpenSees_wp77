/**
 * Pure geometry for force diagrams: map a sampled (x, value) series into SVG
 * path data. Kept React-free so it can be unit-tested directly. The series x
 * runs 0..length along the member; values are plotted about a centered zero
 * baseline (positive up), scaled to the largest magnitude in the series.
 */
import type { DiagramPoint } from '@/fea/feaDiagrams';

export interface DiagramGeometry {
  width: number;
  height: number;
  /** y of the zero axis (SVG units, y grows downward). */
  baselineY: number;
  /** SVG path for the curve. */
  line: string;
  /** SVG path for the curve filled to the baseline. */
  area: string;
  /** Largest-magnitude sample, mapped to SVG coords (for annotation). */
  peak: { x: number; y: number; value: number } | null;
  /** Maps a member station x → SVG x (exposed for tick/label placement). */
  scaleX: (x: number) => number;
}

export function buildDiagramGeometry(
  points: readonly DiagramPoint[],
  length: number,
  width: number,
  height: number,
  pad = 8,
): DiagramGeometry {
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;
  const baselineY = pad + innerH / 2;
  const maxAbs = Math.max(1e-12, ...points.map((p) => Math.abs(p.value)));
  const scaleX = (x: number) => pad + (length > 0 ? (x / length) * innerW : 0);
  const scaleY = (v: number) => baselineY - (v / maxAbs) * (innerH / 2);

  const xy = points.map((p) => ({ px: scaleX(p.x), py: scaleY(p.value) }));
  const line = xy.map((q, i) => `${i ? 'L' : 'M'}${q.px.toFixed(2)} ${q.py.toFixed(2)}`).join(' ');
  const area = xy.length
    ? `M${scaleX(0).toFixed(2)} ${baselineY.toFixed(2)} ` +
      xy.map((q) => `L${q.px.toFixed(2)} ${q.py.toFixed(2)}`).join(' ') +
      ` L${scaleX(length).toFixed(2)} ${baselineY.toFixed(2)} Z`
    : '';

  let peakPt: DiagramPoint | null = null;
  for (const p of points) if (!peakPt || Math.abs(p.value) > Math.abs(peakPt.value)) peakPt = p;
  const peak = peakPt ? { x: scaleX(peakPt.x), y: scaleY(peakPt.value), value: peakPt.value } : null;

  return { width, height, baselineY, line, area, peak, scaleX };
}
