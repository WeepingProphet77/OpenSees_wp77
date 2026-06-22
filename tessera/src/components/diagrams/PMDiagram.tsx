import type { PMInteractionResult } from '@/engine/columnPM';

/**
 * Column φP–φMₙ interaction diagram (uniaxial). φM on the horizontal axis
 * (kip-ft), φP on the vertical (kip, compression up). The factored demand point
 * (Mu, Pu) is plotted and colored by pass/fail.
 */
export function PMDiagram({
  result,
  demand,
}: {
  result: PMInteractionResult;
  demand?: { M: number; P: number; pass: boolean };
}) {
  const pts = result.points;
  const maxM = Math.max(...pts.map((p) => p.phiM), demand?.M ?? 0, 1) * 1.1;
  const maxP = Math.max(...pts.map((p) => p.phiP), demand?.P ?? 0, 1) * 1.1;
  const minP = Math.min(...pts.map((p) => p.phiP), demand?.P ?? 0, 0) * 1.1;

  const W = 360;
  const H = 340;
  const m = { l: 52, r: 16, t: 16, b: 40 };
  const plotW = W - m.l - m.r;
  const plotH = H - m.t - m.b;
  const X = (mom: number) => m.l + (mom / maxM) * plotW;
  const Y = (p: number) => m.t + plotH - ((p - minP) / (maxP - minP)) * plotH;

  const curve = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${X(p.phiM).toFixed(1)} ${Y(p.phiP).toFixed(1)}`).join(' ');
  const zeroP = Y(0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img" aria-label="Column P-M interaction diagram">
      {/* axes */}
      <line x1={m.l} y1={m.t} x2={m.l} y2={m.t + plotH} stroke="var(--foreground)" strokeWidth={1.2} />
      <line x1={m.l} y1={zeroP} x2={m.l + plotW} y2={zeroP} stroke="var(--border)" strokeWidth={1} />
      {/* axial cap line */}
      <line x1={m.l} y1={Y(result.phiPnMax)} x2={m.l + plotW} y2={Y(result.phiPnMax)} stroke="#f59e0b" strokeWidth={1} strokeDasharray="5,3" />
      <text x={m.l + plotW} y={Y(result.phiPnMax) - 3} textAnchor="end" fontSize={9} fill="#b45309">
        φPn,max = {result.phiPnMax.toFixed(0)} kip
      </text>
      {/* envelope */}
      <path d={curve} fill="var(--primary)" fillOpacity={0.08} stroke="var(--primary)" strokeWidth={2} />
      {/* demand point */}
      {demand && (
        <g>
          <line x1={m.l} y1={Y(demand.P)} x2={X(demand.M)} y2={Y(demand.P)} stroke="#ef4444" strokeWidth={0.8} strokeDasharray="3,2" />
          <line x1={X(demand.M)} y1={zeroP} x2={X(demand.M)} y2={Y(demand.P)} stroke="#ef4444" strokeWidth={0.8} strokeDasharray="3,2" />
          <circle cx={X(demand.M)} cy={Y(demand.P)} r={5} fill={demand.pass ? '#22c55e' : '#ef4444'} stroke="var(--card)" strokeWidth={1.5} />
          <text x={X(demand.M) + 7} y={Y(demand.P) - 5} fontSize={9} fill="var(--foreground)">
            (Mu={demand.M.toFixed(0)}, Pu={demand.P.toFixed(0)})
          </text>
        </g>
      )}
      {/* labels */}
      <text x={m.l + plotW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">φMₙ (kip-ft)</text>
      <text x={14} y={m.t + plotH / 2} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)" transform={`rotate(-90, 14, ${m.t + plotH / 2})`}>φPₙ (kip, comp +)</text>
    </svg>
  );
}
