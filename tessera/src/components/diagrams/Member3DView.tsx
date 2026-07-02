import { useMemo, useState } from 'react';
import { sectionToPolygon } from '@/engine/beamCalculations';
import type { Point, Section, SteelLayer } from '@/engine/types';
import { projector, type Vec3 } from '@/lib/axonometric';

/**
 * Lightweight axonometric 3D viewport: the member's real cross-section extruded
 * along its span, drawn as an orthographic SVG (no WebGL dependency). Shows the
 * near/far end faces, the longitudinal extrusion edges, the reinforcement runs,
 * and the RISA-style member local-axis triad (x along span, y vertical, z
 * out-of-plane). When solved diagrams are supplied it overlays the analytical
 * model — the deflected member axis and the bending-moment diagram — both auto-
 * scaled for visibility. Yaw/pitch sliders orbit the camera; the view auto-fits.
 */
const DEG = Math.PI / 180;

const AXES = [
  { key: 'x', color: '#ef4444', label: 'x (span)' },
  { key: 'y', color: '#22c55e', label: 'y (depth)' },
  { key: 'z', color: '#3b82f6', label: 'z (width)' },
] as const;

/** A station along the span: x (in, 0..L) and a value (deflection in, or moment kip-in). */
export interface SpanStation {
  x: number;
  value: number;
}

export function Member3DView({
  section,
  lengthIn,
  layers = [],
  deflection,
  moment,
  size = 380,
}: {
  section: Section;
  /** Member length (in) — the extrusion distance along local x. */
  lengthIn: number;
  layers?: SteelLayer[];
  /** Solved deflection along the span (in, signed) — enables the deformed-shape overlay. */
  deflection?: SpanStation[];
  /** Solved bending moment along the span (kip-in) — enables the moment-diagram overlay. */
  moment?: SpanStation[];
  size?: number;
}) {
  const [yawDeg, setYawDeg] = useState(-32);
  const [pitchDeg, setPitchDeg] = useState(16);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const hasData = (deflection?.length ?? 0) >= 2 || (moment?.length ?? 0) >= 2;

  const view = useMemo(() => {
    const poly = sectionToPolygon(section);
    const positive: Point[][] = [poly.outer, ...(poly.extra ?? [])].filter((r) => r && r.length >= 3);
    const holes = (poly.holes ?? []).filter((r) => r && r.length >= 3);
    const sec = positive.flat().concat(holes.flat());
    const L = lengthIn > 0 ? lengthIn : 1;
    if (sec.length < 3) return null;

    // Section bounding box → centre the extrusion on its own centroid.
    const xs = sec.map((p) => p.x);
    const ys = sec.map((p) => p.y);
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const secW = Math.max(...xs) - Math.min(...xs) || 1;
    const secH = Math.max(...ys) - Math.min(...ys) || 1;
    const axisLen = 0.2 * Math.max(L, secH, secW);

    // Section coords: x = width, y = depth from top (down). World: x = span, y = up, z = width.
    const toWorld = (p: Point, t: number): Vec3 => ({ x: t - L / 2, y: midY - p.y, z: p.x - midX });

    const project = projector(yawDeg * DEG, pitchDeg * DEG);
    const raw = (v: Vec3) => {
      const pr = project(v);
      return { X: pr.x, Y: -pr.y, depth: pr.depth };
    };

    const origin: Vec3 = { x: -L / 2, y: 0, z: 0 };
    const axisTips: Record<string, Vec3> = {
      x: { x: -L / 2 + axisLen, y: 0, z: 0 },
      y: { x: -L / 2, y: axisLen, z: 0 },
      z: { x: -L / 2, y: 0, z: axisLen },
    };

    // ── Analytical overlay (deflected axis + moment diagram), auto-scaled ────────
    const defl = showAnalysis ? deflection ?? [] : [];
    const mom = showAnalysis ? moment ?? [] : [];
    const deflMax = Math.max(1e-9, ...defl.map((p) => Math.abs(p.value)));
    const momMax = Math.max(1e-9, ...mom.map((p) => Math.abs(p.value)));
    const deflScale = defl.length >= 2 ? (0.15 * L) / deflMax : 0;
    const momScale = mom.length >= 2 ? (0.18 * L) / momMax : 0;
    // Member axis runs through the section centroid (world y = 0) along the span.
    const axisWorld = (x: number, dy: number): Vec3 => ({ x: x - L / 2, y: dy, z: 0 });
    const deflVecs = deflScale ? defl.map((p) => axisWorld(p.x, deflScale * p.value)) : [];
    const baseVecs = momScale ? mom.map((p) => axisWorld(p.x, 0)) : [];
    const momVecs = momScale ? mom.map((p) => axisWorld(p.x, -momScale * p.value)) : [];

    // Auto-fit over every screen point we will draw (geometry + overlay + axes).
    const fitPts = [
      ...positive.flatMap((r) => r.flatMap((p) => [raw(toWorld(p, 0)), raw(toWorld(p, L))])),
      ...holes.flatMap((r) => r.flatMap((p) => [raw(toWorld(p, 0)), raw(toWorld(p, L))])),
      ...deflVecs.map(raw),
      ...momVecs.map(raw),
      raw(origin),
      ...Object.values(axisTips).map(raw),
    ];
    const Xs = fitPts.map((p) => p.X);
    const Ys = fitPts.map((p) => p.Y);
    const minX = Math.min(...Xs);
    const maxX = Math.max(...Xs);
    const minY = Math.min(...Ys);
    const maxY = Math.max(...Ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const pad = 22;
    const scale = (size - pad * 2) / Math.max(spanX, spanY);
    const W = spanX * scale + pad * 2;
    const H = spanY * scale + pad * 2;
    const tx = (X: number) => pad + (X - minX) * scale;
    const ty = (Y: number) => pad + (Y - minY) * scale;

    const ringPath = (ring: Point[], t: number) =>
      ring.map((p, i) => {
        const r = raw(toWorld(p, t));
        return `${i ? 'L' : 'M'} ${tx(r.X).toFixed(2)} ${ty(r.Y).toFixed(2)}`;
      }).join(' ') + ' Z';
    const polyOf = (vecs: Vec3[]) =>
      vecs.map((v, i) => {
        const r = raw(v);
        return `${i ? 'L' : 'M'} ${tx(r.X).toFixed(2)} ${ty(r.Y).toFixed(2)}`;
      }).join(' ');

    // Painter ordering by end-face depth.
    const avgDepth = (t: number) =>
      positive[0].reduce((s, p) => s + raw(toWorld(p, t)).depth, 0) / positive[0].length;
    const nearT = avgDepth(L) >= avgDepth(0) ? L : 0;
    const farT = nearT === L ? 0 : L;

    const allRings = [...positive, ...holes];
    const edges = allRings.flatMap((ring) =>
      ring.map((p) => {
        const a = raw(toWorld(p, farT));
        const b = raw(toWorld(p, nearT));
        return { x1: tx(a.X), y1: ty(a.Y), x2: tx(b.X), y2: ty(b.Y) };
      }),
    );

    const reinf = layers
      .filter((l) => l.area > 0)
      .map((l) => {
        const p: Point = { x: l.x ?? midX, y: l.depth };
        const a = raw(toWorld(p, 0));
        const b = raw(toWorld(p, L));
        return { x1: tx(a.X), y1: ty(a.Y), x2: tx(b.X), y2: ty(b.Y), strand: l.fse > 0 };
      });

    const o = raw(origin);
    const axes = AXES.map((ax) => {
      const tip = raw(axisTips[ax.key]);
      return { ...ax, x1: tx(o.X), y1: ty(o.Y), x2: tx(tip.X), y2: ty(tip.Y) };
    });

    const momRibbon =
      momVecs.length >= 2
        ? polyOf(baseVecs) +
          ' ' +
          [...momVecs].reverse().map((v) => {
            const r = raw(v);
            return `L ${tx(r.X).toFixed(2)} ${ty(r.Y).toFixed(2)}`;
          }).join(' ') +
          ' Z'
        : '';

    return {
      W,
      H,
      positiveNear: positive.map((r) => ringPath(r, nearT)),
      positiveFar: positive.map((r) => ringPath(r, farT)),
      holesNear: holes.map((r) => ringPath(r, nearT)),
      holesFar: holes.map((r) => ringPath(r, farT)),
      edges,
      reinf,
      axes,
      deflPath: deflVecs.length >= 2 ? polyOf(deflVecs) : '',
      deflFactor: deflScale,
      momLine: momVecs.length >= 2 ? polyOf(momVecs) : '',
      momRibbon,
    };
  }, [section, lengthIn, layers, deflection, moment, showAnalysis, size, yawDeg, pitchDeg]);

  if (!view) {
    return <div className="text-sm text-muted-foreground">Define a section to preview the member in 3D.</div>;
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <svg viewBox={`0 0 ${view.W} ${view.H}`} width="100%" style={{ maxWidth: view.W }} role="img" aria-label="Member 3D view">
        {/* Far end face — outline only. */}
        {view.positiveFar.map((d, i) => (
          <path key={`pf${i}`} d={d} fill="none" stroke="var(--primary)" strokeWidth={1} strokeOpacity={0.4} />
        ))}
        {view.holesFar.map((d, i) => (
          <path key={`hf${i}`} d={d} fill="none" stroke="var(--border)" strokeWidth={1} strokeOpacity={0.5} />
        ))}
        {/* Longitudinal extrusion edges. */}
        {view.edges.map((e, i) => (
          <line key={`e${i}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--primary)" strokeWidth={1} strokeOpacity={0.28} />
        ))}
        {/* Moment diagram (analytical overlay). */}
        {view.momRibbon && <path d={view.momRibbon} fill="#f59e0b" fillOpacity={0.14} stroke="none" />}
        {view.momLine && <path d={view.momLine} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeOpacity={0.9} />}
        {/* Near end face — filled concrete + voids. */}
        {view.positiveNear.map((d, i) => (
          <path key={`pn${i}`} d={d} fill="var(--primary)" fillOpacity={0.16} stroke="var(--primary)" strokeWidth={1.5} />
        ))}
        {view.holesNear.map((d, i) => (
          <path key={`hn${i}`} d={d} fill="var(--card)" stroke="var(--border)" strokeWidth={1} />
        ))}
        {/* Reinforcement / strand runs (x-ray). */}
        {view.reinf.map((r, i) => (
          <line key={`r${i}`} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke={r.strand ? '#f59e0b' : 'var(--foreground)'} strokeWidth={2} strokeOpacity={0.85} strokeLinecap="round" />
        ))}
        {/* Deflected member axis (analytical overlay). */}
        {view.deflPath && <path d={view.deflPath} fill="none" stroke="#22c55e" strokeWidth={2} strokeDasharray="5 3" />}
        {/* RISA member local-axis triad. */}
        {view.axes.map((a) => (
          <g key={a.key}>
            <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={a.color} strokeWidth={2} />
            <circle cx={a.x2} cy={a.y2} r={2.5} fill={a.color} />
            <text x={a.x2} y={a.y2} dx={4} dy={-4} fontSize={11} fontWeight={700} fill={a.color}>
              {a.key}
            </text>
          </g>
        ))}
      </svg>

      <div className="grid w-full max-w-sm grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <label htmlFor="m3d-yaw">Yaw</label>
        <input id="m3d-yaw" type="range" min={-180} max={180} step={1} value={yawDeg} onChange={(e) => setYawDeg(Number(e.target.value))} className="accent-[var(--primary)]" />
        <span className="tabular-nums">{yawDeg}°</span>
        <label htmlFor="m3d-pitch">Pitch</label>
        <input id="m3d-pitch" type="range" min={-85} max={85} step={1} value={pitchDeg} onChange={(e) => setPitchDeg(Number(e.target.value))} className="accent-[var(--primary)]" />
        <span className="tabular-nums">{pitchDeg}°</span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {AXES.map((a) => (
          <span key={a.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: a.color }} />
            {a.label}
          </span>
        ))}
        {hasData && (
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={showAnalysis} onChange={(e) => setShowAnalysis(e.target.checked)} />
            deformed shape + moment
          </label>
        )}
        {showAnalysis && view.deflPath && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#22c55e' }} />
            deflection ×{view.deflFactor >= 1 ? Math.round(view.deflFactor) : view.deflFactor.toFixed(1)}
          </span>
        )}
        {showAnalysis && view.momLine && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#f59e0b' }} />
            bending moment
          </span>
        )}
      </div>
    </div>
  );
}
