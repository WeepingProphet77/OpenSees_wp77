import { generateStressStrainCurve } from '@/engine/beamCalculations';
import type { BeamResult } from '@/engine/beamCalculations';
import steelPresets from '@/engine/steelPresets';

/**
 * Power-formula stress-strain curves for every steel preset, with the current
 * analysis' tension-layer operating points overlaid. Ported from the reference
 * app's StressStrainChart.
 */
export function StressStrainChart({ result }: { result?: BeamResult }) {
  const width = 540;
  const height = 360;
  const margin = { top: 24, right: 16, bottom: 48, left: 56 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const curves = steelPresets.map((preset) => ({ preset, points: generateStressStrainCurve(preset, 150) }));
  const maxStrain = 0.05;
  const maxStress = 300;
  const xScale = (v: number) => margin.left + (v / maxStrain) * plotW;
  const yScale = (v: number) => margin.top + plotH - (v / maxStress) * plotH;

  const colors = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#10b981'];
  const xTicks = [0, 0.01, 0.02, 0.03, 0.04, 0.05];
  const yTicks = [0, 60, 120, 180, 240, 300];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width }} role="img" aria-label="Steel stress-strain curves">
      {xTicks.map((t) => (
        <line key={`xg${t}`} x1={xScale(t)} y1={margin.top} x2={xScale(t)} y2={margin.top + plotH} stroke="var(--border)" strokeWidth={0.5} />
      ))}
      {yTicks.map((t) => (
        <line key={`yg${t}`} x1={margin.left} y1={yScale(t)} x2={margin.left + plotW} y2={yScale(t)} stroke="var(--border)" strokeWidth={0.5} />
      ))}
      <line x1={margin.left} y1={margin.top + plotH} x2={margin.left + plotW} y2={margin.top + plotH} stroke="var(--foreground)" strokeWidth={1.2} />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotH} stroke="var(--foreground)" strokeWidth={1.2} />
      <text x={margin.left + plotW / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">Strain εs</text>
      <text x={14} y={margin.top + plotH / 2} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)" transform={`rotate(-90, 14, ${margin.top + plotH / 2})`}>Stress fs (ksi)</text>
      {xTicks.map((t) => (
        <text key={`xt${t}`} x={xScale(t)} y={margin.top + plotH + 15} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">{t.toFixed(2)}</text>
      ))}
      {yTicks.map((t) => (
        <text key={`yt${t}`} x={margin.left - 6} y={yScale(t) + 3} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">{t}</text>
      ))}
      {curves.map(({ preset, points }, ci) => (
        <path
          key={preset.id}
          d={points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.strain).toFixed(1)} ${yScale(p.stress).toFixed(1)}`).join(' ')}
          fill="none"
          stroke={colors[ci % colors.length]}
          strokeWidth={1.8}
          opacity={0.85}
        />
      ))}
      {result?.layerResults.map((lr, i) =>
        lr.strain > 0 ? (
          <circle key={i} cx={xScale(lr.strain)} cy={yScale(Math.abs(lr.stress))} r={4.5} fill="#ef4444" stroke="var(--card)" strokeWidth={1.5}>
            <title>{`Layer ${i + 1}: εs=${lr.strain.toFixed(4)}, fs=${lr.stress.toFixed(1)} ksi`}</title>
          </circle>
        ) : null,
      )}
      {curves.map(({ preset }, ci) => {
        const lx = margin.left + 10;
        const ly = margin.top + 10 + ci * 15;
        return (
          <g key={`leg${preset.id}`}>
            <line x1={lx} y1={ly} x2={lx + 18} y2={ly} stroke={colors[ci % colors.length]} strokeWidth={2.5} />
            <text x={lx + 23} y={ly + 3.5} fontSize={9.5} fill="var(--foreground)">{preset.name}</text>
          </g>
        );
      })}
    </svg>
  );
}
