import type { BiaxialResult } from '@/engine/beamCalculations';

/** "Nice" axis step for the interaction grid. */
function niceStep(ext: number): number {
  const raw = ext / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
  return step * mag;
}

/**
 * Biaxial φMx–φMy interaction diagram: strength envelope (+ cracking envelope)
 * with the NA-aligned φMnx/φMny anchors. Ported from the reference app.
 * Moments in kip-ft.
 */
export function InteractionDiagram({ result }: { result: BiaxialResult }) {
  const { envelope, anchors, cracking } = result;
  const strength = envelope.map((p) => ({ x: p.phiMx, y: p.phiMy }));
  const crack = (cracking.envelope || []).map((p) => ({ x: p.Mx, y: p.My }));
  const allPts = [...strength, ...crack];
  const ext = Math.max(...allPts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))), 1) * 1.1;

  const SIZE = 340;
  const PAD = 28;
  const half = (SIZE - 2 * PAD) / 2;
  const cx = PAD + half;
  const cy = PAD + half;
  const sc = half / ext;
  const X = (mx: number) => cx + mx * sc;
  const Y = (my: number) => cy - my * sc;
  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ') + ' Z';

  const step = niceStep(ext);
  const ticks: number[] = [];
  for (let v = step; v < ext; v += step) ticks.push(v);

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" style={{ maxWidth: SIZE }} role="img" aria-label="Biaxial interaction diagram">
      <line x1={PAD} y1={cy} x2={SIZE - PAD} y2={cy} stroke="var(--border)" strokeWidth={1} />
      <line x1={cx} y1={PAD} x2={cx} y2={SIZE - PAD} stroke="var(--border)" strokeWidth={1} />
      {ticks.map((v) => (
        <g key={v} stroke="var(--border)">
          <line x1={X(v)} y1={cy - 3} x2={X(v)} y2={cy + 3} />
          <line x1={X(-v)} y1={cy - 3} x2={X(-v)} y2={cy + 3} />
          <line x1={cx - 3} y1={Y(v)} x2={cx + 3} y2={Y(v)} />
          <line x1={cx - 3} y1={Y(-v)} x2={cx + 3} y2={Y(-v)} />
        </g>
      ))}
      <text x={SIZE - PAD} y={cy - 6} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">+φMx</text>
      <text x={cx + 6} y={PAD + 8} fontSize={10} fill="var(--muted-foreground)">+φMy</text>
      {crack.length > 2 && <path d={toPath(crack)} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5,3" />}
      <path d={toPath(strength)} fill="var(--primary)" fillOpacity={0.1} stroke="var(--primary)" strokeWidth={2} />
      {[anchors.xSag, anchors.xHog, anchors.yPos, anchors.yNeg].map((a, i) => (
        <circle key={i} cx={X(a.phiMx)} cy={Y(a.phiMy)} r={3.5} fill="#16a34a" stroke="var(--card)" strokeWidth={1} />
      ))}
      <g transform={`translate(${PAD}, ${SIZE - 6})`} fontSize={9.5} fill="var(--muted-foreground)">
        <line x1={0} y1={-4} x2={14} y2={-4} stroke="var(--primary)" strokeWidth={2} />
        <text x={18} y={-1}>φMn strength</text>
        <line x1={104} y1={-4} x2={118} y2={-4} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4,2" />
        <text x={122} y={-1}>cracking</text>
      </g>
    </svg>
  );
}
