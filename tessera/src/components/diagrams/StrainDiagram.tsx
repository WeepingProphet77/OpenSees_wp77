import type { BeamResult } from '@/engine/beamCalculations';

/**
 * Strain & stress-block distribution across the section depth at flexural
 * capacity. Ported from the reference app's StrainDiagram, typed against
 * `BeamResult`. εcu = 0.003 at the top; the neutral axis is at depth c.
 */
export function StrainDiagram({ result }: { result: BeamResult }) {
  const { c, a, layerResults, section } = result;
  const h = section.h ?? 0;
  if (!h || !c) return null;

  const width = 380;
  const height = 300;
  const margin = { top: 24, right: 16, bottom: 24, left: 16 };
  const beamW = 38;
  const gap = 34;
  const plotH = height - margin.top - margin.bottom;
  const yScale = (depth: number) => margin.top + (depth / h) * plotH;

  const ecu = 0.003;
  const strainLeft = margin.left + beamW + gap;
  const strainW = 130;
  const maxTension = Math.max(...layerResults.map((lr) => Math.abs(lr.strain)), ecu);
  const strainScale = strainW / (maxTension + ecu);
  const topStrain = -ecu;
  const botStrain = ecu * (h / c - 1);
  const zeroX = strainLeft + ecu * strainScale;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width }} role="img" aria-label="Strain distribution">
      {/* Beam depth bar */}
      <rect x={margin.left} y={margin.top} width={beamW} height={plotH} fill="var(--muted)" stroke="var(--foreground)" strokeWidth={1.2} />
      {/* Whitney stress block */}
      <rect x={margin.left} y={margin.top} width={beamW} height={(a / h) * plotH} fill="var(--primary)" fillOpacity={0.25} stroke="var(--primary)" strokeWidth={1} />
      {/* Neutral axis */}
      <line x1={margin.left} y1={yScale(c)} x2={margin.left + beamW} y2={yScale(c)} stroke="#ef4444" strokeWidth={1.4} strokeDasharray="4,2" />
      {layerResults.map((lr, i) => (
        <circle key={i} cx={margin.left + beamW / 2} cy={yScale(lr.depth)} r={3} fill={lr.strain > 0 ? '#22c55e' : '#f59e0b'} stroke="var(--foreground)" strokeWidth={0.7} />
      ))}

      {/* Strain title */}
      <text x={strainLeft + strainW / 2} y={margin.top - 8} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
        Strain (εcu = 0.003)
      </text>
      {/* zero line */}
      <line x1={zeroX} y1={margin.top} x2={zeroX} y2={margin.top + plotH} stroke="var(--border)" strokeWidth={0.8} strokeDasharray="3,2" />
      {/* strain triangle */}
      <polygon
        points={`${zeroX + topStrain * strainScale},${margin.top} ${zeroX},${yScale(c)} ${zeroX + botStrain * strainScale},${margin.top + plotH}`}
        fill="#ef4444"
        fillOpacity={0.1}
        stroke="#ef4444"
        strokeWidth={1.4}
      />
      <text x={zeroX + topStrain * strainScale - 4} y={margin.top - 1} textAnchor="end" fontSize={10} fill="var(--foreground)">
        {topStrain.toFixed(4)}
      </text>
      <text x={zeroX + botStrain * strainScale + 4} y={margin.top + plotH + 14} textAnchor="start" fontSize={10} fill="var(--foreground)">
        {botStrain.toFixed(4)}
      </text>
      {layerResults.map((lr, i) => {
        const y = yScale(lr.depth);
        const x = zeroX + lr.strain * strainScale;
        return (
          <g key={i}>
            <line x1={zeroX} y1={y} x2={x} y2={y} stroke="#ef4444" strokeWidth={0.8} strokeDasharray="2,2" />
            <circle cx={x} cy={y} r={3} fill="#ef4444" stroke="var(--card)" strokeWidth={1} />
          </g>
        );
      })}
    </svg>
  );
}
