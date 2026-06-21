import { sectionToPolygon } from '@/engine/beamCalculations';
import type { Point, Section, SteelLayer } from '@/engine/types';

/**
 * Read-only cross-section renderer: concrete outline (+ voids) with the
 * reinforcement/strand layers overlaid at their {x, depth}. y is depth from the
 * top fiber (downward), matching the engine convention.
 */
export function SectionView({
  section,
  layers,
  size = 240,
}: {
  section: Section;
  layers: SteelLayer[];
  size?: number;
}) {
  const poly = sectionToPolygon(section);
  const positive: Point[][] = [poly.outer, ...(poly.extra ?? [])].filter((r) => r && r.length >= 3);
  const holes = poly.holes ?? [];
  const all = positive.flat().concat(holes.flat());
  if (all.length < 3) {
    return <div className="text-sm text-muted-foreground">Define a section to preview it.</div>;
  }

  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const pad = 16;
  const scale = (size - pad * 2) / Math.max(w, h);
  const W = w * scale + pad * 2;
  const H = h * scale + pad * 2;
  const tx = (x: number) => pad + (x - minX) * scale;
  const ty = (y: number) => pad + (y - minY) * scale;
  const ringPath = (r: Point[]) =>
    r.map((p, i) => `${i ? 'L' : 'M'} ${tx(p.x)} ${ty(p.y)}`).join(' ') + ' Z';

  const centerX = (minX + maxX) / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img" aria-label="Cross section">
      {positive.map((r, i) => (
        <path key={`p${i}`} d={ringPath(r)} fill="var(--primary)" fillOpacity={0.12} stroke="var(--primary)" strokeWidth={1.5} />
      ))}
      {holes.map((r, i) => (
        <path key={`h${i}`} d={ringPath(r)} fill="var(--card)" stroke="var(--border)" strokeWidth={1} />
      ))}
      {layers.map((l, i) => {
        const x = l.x ?? centerX;
        const isStrand = l.fse > 0;
        return (
          <circle
            key={i}
            cx={tx(x)}
            cy={ty(l.depth)}
            r={4}
            fill={isStrand ? '#f59e0b' : 'var(--foreground)'}
            stroke="var(--card)"
            strokeWidth={1}
          >
            <title>{`${isStrand ? 'Strand' : 'Bar'} — A=${l.area} in², d=${l.depth} in${isStrand ? `, fse=${l.fse} ksi` : ''}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
