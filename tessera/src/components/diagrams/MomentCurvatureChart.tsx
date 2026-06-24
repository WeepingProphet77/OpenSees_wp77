import type { MomentCurvatureResult } from '@/fea/feaModel';
import { momentCurvatureMetrics } from '@/fea/momentCurvatureMetrics';

/**
 * Fiber-section moment–curvature curve (OpenSees-WASM) with engineering landmarks:
 * the equivalent yield curvature, the nominal peak Mn, and the ultimate curvature,
 * plus horizontal overlays of the closed-form nominal moment and cracking moment
 * for cross-check. Moments shown in kip-ft, curvature in ×10⁻³ /in.
 */
export interface MomentCurvatureChartProps {
  result: MomentCurvatureResult;
  /** Closed-form nominal moment Mn (kip-in) overlay. */
  closedFormMn?: number;
  /** Cracking moment Mcr (kip-in) overlay. */
  crackingMoment?: number;
}

const KIPIN_TO_KIPFT = 1 / 12;
const PHI_SCALE = 1e3; // 1/in → ×10⁻³ /in for axis readability

export function MomentCurvatureChart({ result, closedFormMn, crackingMoment }: MomentCurvatureChartProps) {
  const pts = result.points;
  if (pts.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        Moment–curvature unavailable{result.message ? ` — ${result.message}` : ''}.
      </p>
    );
  }

  const metrics = momentCurvatureMetrics(pts, result.landmarks);
  const width = 560;
  const height = 380;
  const margin = { top: 20, right: 16, bottom: 48, left: 64 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const ft = (m: number) => m * KIPIN_TO_KIPFT;
  const maxKappa = Math.max(...pts.map((p) => p.kappa), metrics?.phiY ?? 0) * 1.02 || 1;
  const maxMomentFt =
    Math.max(
      ...pts.map((p) => Math.abs(ft(p.M))),
      closedFormMn ? Math.abs(ft(closedFormMn)) : 0,
      crackingMoment ? Math.abs(ft(crackingMoment)) : 0,
    ) * 1.08 || 1;

  const xScale = (kappa: number) => margin.left + (kappa / maxKappa) * plotW;
  const yScale = (mFt: number) => margin.top + plotH - (mFt / maxMomentFt) * plotH;

  const nTicks = 5;
  const xTicks = Array.from({ length: nTicks + 1 }, (_, i) => (maxKappa * i) / nTicks);
  const yTicks = Array.from({ length: nTicks + 1 }, (_, i) => (maxMomentFt * i) / nTicks);

  const curve = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.kappa).toFixed(1)} ${yScale(ft(p.M)).toFixed(1)}`)
    .join(' ');

  const mk = (kappa: number, moment: number) => ({ x: xScale(kappa), y: yScale(ft(moment)) });
  const lastPt = pts[pts.length - 1];
  const peak = metrics ? mk(metrics.phiAtPeak, metrics.mn) : null;
  const crackPt = metrics?.cracking ? mk(metrics.cracking.kappa, metrics.cracking.M) : null;
  const yieldPt = metrics?.firstYield ? mk(metrics.firstYield.kappa, metrics.firstYield.M) : null;
  const ultPt = metrics?.crushing ? mk(metrics.crushing.kappa, metrics.crushing.M) : mk(lastPt.kappa, lastPt.M);
  const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const diffPct =
    closedFormMn && metrics && closedFormMn !== 0
      ? ((metrics.mn - closedFormMn) / closedFormMn) * 100
      : null;

  return (
    <div className="w-full" style={{ maxWidth: width }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label="Moment-curvature curve">
        {xTicks.map((t) => (
          <line key={`xg${t}`} x1={xScale(t)} y1={margin.top} x2={xScale(t)} y2={margin.top + plotH} stroke="var(--border)" strokeWidth={0.5} />
        ))}
        {yTicks.map((t) => (
          <line key={`yg${t}`} x1={margin.left} y1={yScale(t)} x2={margin.left + plotW} y2={yScale(t)} stroke="var(--border)" strokeWidth={0.5} />
        ))}
        <line x1={margin.left} y1={margin.top + plotH} x2={margin.left + plotW} y2={margin.top + plotH} stroke="var(--foreground)" strokeWidth={1.2} />
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotH} stroke="var(--foreground)" strokeWidth={1.2} />
        <text x={margin.left + plotW / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
          Curvature φ (×10⁻³ /in)
        </text>
        <text x={16} y={margin.top + plotH / 2} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)" transform={`rotate(-90, 16, ${margin.top + plotH / 2})`}>
          Moment M (kip-ft)
        </text>
        {xTicks.map((t) => (
          <text key={`xt${t}`} x={xScale(t)} y={margin.top + plotH + 15} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">
            {(t * PHI_SCALE).toFixed(2)}
          </text>
        ))}
        {yTicks.map((t) => (
          <text key={`yt${t}`} x={margin.left - 6} y={yScale(t) + 3} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">
            {Math.round(t)}
          </text>
        ))}

        {/* Closed-form overlays */}
        {closedFormMn != null && Math.abs(ft(closedFormMn)) <= maxMomentFt && (
          <g>
            <line x1={margin.left} y1={yScale(ft(closedFormMn))} x2={margin.left + plotW} y2={yScale(ft(closedFormMn))} stroke="#10b981" strokeWidth={1.4} strokeDasharray="5 4" />
            <text x={margin.left + plotW - 4} y={yScale(ft(closedFormMn)) - 4} textAnchor="end" fontSize={9} fill="#10b981">
              closed-form Mₙ
            </text>
          </g>
        )}
        {crackingMoment != null && crackingMoment > 0 && Math.abs(ft(crackingMoment)) <= maxMomentFt && (
          <g>
            <line x1={margin.left} y1={yScale(ft(crackingMoment))} x2={margin.left + plotW} y2={yScale(ft(crackingMoment))} stroke="#f59e0b" strokeWidth={1.2} strokeDasharray="3 4" />
            <text x={margin.left + plotW - 4} y={yScale(ft(crackingMoment)) - 4} textAnchor="end" fontSize={9} fill="#f59e0b">
              M_cr
            </text>
          </g>
        )}

        {/* Yield-curvature guide — only the equivalent secant when no exact landmark */}
        {metrics && !metrics.exactYield && metrics.phiY > 0 && metrics.phiY <= maxKappa && (
          <g>
            <line x1={xScale(metrics.phiY)} y1={margin.top} x2={xScale(metrics.phiY)} y2={margin.top + plotH} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="2 3" />
            <text x={xScale(metrics.phiY) + 3} y={margin.top + 10} fontSize={9} fill="var(--muted-foreground)">
              φ_y (equiv.)
            </text>
          </g>
        )}

        {/* M–φ curve */}
        <path d={curve} fill="none" stroke="#3b82f6" strokeWidth={2} />

        {/* Landmark markers: cracking (amber), first yield (violet), peak (blue), crushing/ultimate (red) */}
        {crackPt && (
          <circle cx={crackPt.x} cy={crackPt.y} r={3.5} fill="#f59e0b" stroke="var(--card)" strokeWidth={1.3}>
            <title>{`Cracking @ φ = ${fmt(metrics!.cracking!.kappa * PHI_SCALE, 3)}×10⁻³/in, M = ${fmt(ft(metrics!.cracking!.M))} kip-ft`}</title>
          </circle>
        )}
        {yieldPt && (
          <circle cx={yieldPt.x} cy={yieldPt.y} r={4} fill="#8b5cf6" stroke="var(--card)" strokeWidth={1.5}>
            <title>{`First yield @ φy = ${fmt(metrics!.firstYield!.kappa * PHI_SCALE, 3)}×10⁻³/in, M = ${fmt(ft(metrics!.firstYield!.M))} kip-ft`}</title>
          </circle>
        )}
        {peak && (
          <circle cx={peak.x} cy={peak.y} r={4} fill="#3b82f6" stroke="var(--card)" strokeWidth={1.5}>
            <title>{`Peak Mn = ${fmt(ft(metrics!.mn))} kip-ft @ φ = ${fmt(metrics!.phiAtPeak * PHI_SCALE, 3)}×10⁻³/in`}</title>
          </circle>
        )}
        <circle cx={ultPt.x} cy={ultPt.y} r={4} fill="#ef4444" stroke="var(--card)" strokeWidth={1.5}>
          <title>{`${metrics?.exactUltimate ? 'Crushing' : 'Ultimate'} φu = ${fmt((metrics?.crushing?.kappa ?? lastPt.kappa) * PHI_SCALE, 3)}×10⁻³/in`}</title>
        </circle>
      </svg>

      {metrics && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Mₙ (fiber)</dt>
            <dd className="font-mono font-semibold">{fmt(ft(metrics.mn))} kip-ft</dd>
          </div>
          {closedFormMn != null && (
            <div>
              <dt className="text-muted-foreground">Mₙ (closed-form)</dt>
              <dd className="font-mono font-semibold">
                {fmt(ft(closedFormMn))} kip-ft{diffPct != null ? ` (${diffPct >= 0 ? '+' : ''}${fmt(diffPct)}%)` : ''}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">
              φ_y {metrics.exactYield ? '(yield)' : '(equiv.)'} / φ_u (×10⁻³/in)
            </dt>
            <dd className="font-mono font-semibold">
              {fmt(metrics.phiY * PHI_SCALE, 3)} / {fmt(metrics.phiU * PHI_SCALE, 3)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ductility μ = φu/φy</dt>
            <dd className="font-mono font-semibold">{fmt(metrics.mu, 2)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
