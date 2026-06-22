import { useEffect, useRef, useState } from 'react';
import type { Point } from '@/engine/types';
import { Button } from '@/components/ui/button';

/**
 * Interactive cross-section drawer for the "custom" section type. Ported from
 * the reference app. Coordinates are in inches with y downward (depth-from-top),
 * matching the analysis engine. Ring 0 is the solid outer ring; further rings
 * are holes. Reports closed rings via onChange(outer, holes).
 *
 * Arrow keys move the cursor · Space drops a node · Backspace undoes ·
 * Enter closes the ring · click the first node to close.
 */
const GRID = 48;
const PX = 9;
const PAD = 18;
const SNAP = 1.0;
const RING_COLORS = ['var(--primary)', '#b45309', '#0e7490', '#7c3aed'];

interface Ring {
  points: Point[];
  closed: boolean;
}

export function SectionDrawer({
  value,
  onChange,
}: {
  value?: { points?: Point[]; holes?: Point[][] };
  onChange: (points: Point[] | null, holes: Point[][]) => void;
}) {
  const [rings, setRings] = useState<Ring[]>(() => {
    if (value?.points && value.points.length >= 3) {
      const outer: Ring = { points: value.points.map((p) => ({ ...p })), closed: true };
      const holes: Ring[] = (value.holes ?? []).map((h) => ({ points: h.map((p) => ({ ...p })), closed: true }));
      return [outer, ...holes];
    }
    return [{ points: [], closed: false }];
  });
  const [cursor, setCursor] = useState<Point>({ x: GRID / 2, y: GRID / 2 });
  const [step, setStep] = useState(0.25);
  const svgRef = useRef<SVGSVGElement>(null);

  const snap = (v: number) => Math.round(v / step) * step;
  const clamp = (v: number) => Math.max(0, Math.min(GRID, v));
  const toPx = (v: number) => PAD + v * PX;

  const activeRing = rings.find((r) => !r.closed) ?? null;
  const lastNode = activeRing && activeRing.points.length ? activeRing.points[activeRing.points.length - 1] : null;

  useEffect(() => {
    const closed = rings.filter((r) => r.closed && r.points.length >= 3);
    if (!closed.length) {
      onChange(null, []);
      return;
    }
    const [outer, ...holes] = closed;
    onChange(outer.points, holes.map((h) => h.points));
    // onChange is provided by the parent and is stable for this use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rings]);

  const dropNode = (pt: Point) =>
    setRings((prev) => {
      const next = prev.map((r) => ({ ...r, points: [...r.points] }));
      let idx = next.findIndex((r) => !r.closed);
      if (idx < 0) {
        next.push({ points: [], closed: false });
        idx = next.length - 1;
      }
      const ring = next[idx];
      if (ring.points.length >= 3 && Math.hypot(pt.x - ring.points[0].x, pt.y - ring.points[0].y) <= SNAP) {
        ring.closed = true;
      } else {
        ring.points.push({ x: pt.x, y: pt.y });
      }
      return next;
    });

  const undoNode = () =>
    setRings((prev) => {
      const next = prev.map((r) => ({ ...r, points: [...r.points] }));
      let idx = next.findIndex((r) => !r.closed);
      if (idx < 0) {
        idx = next.length - 1;
        next[idx].closed = false;
      }
      const ring = next[idx];
      if (ring.points.length) ring.points.pop();
      else if (next.length > 1) next.pop();
      return next;
    });

  const closeRing = () =>
    setRings((prev) => {
      const idx = prev.findIndex((r) => !r.closed);
      if (idx < 0 || prev[idx].points.length < 3) return prev;
      return prev.map((r, i) => (i === idx ? { ...r, closed: true } : r));
    });

  const startHole = () =>
    setRings((prev) => (prev.some((r) => !r.closed) ? prev : [...prev, { points: [], closed: false }]));

  const clearAll = () => setRings([{ points: [], closed: false }]);

  const moveCursor = (dx: number, dy: number) =>
    setCursor((c) => ({ x: clamp(snap(c.x) + dx * step), y: clamp(snap(c.y) + dy * step) }));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === 'ArrowUp') (e.preventDefault(), moveCursor(0, -1));
    else if (k === 'ArrowDown') (e.preventDefault(), moveCursor(0, 1));
    else if (k === 'ArrowLeft') (e.preventDefault(), moveCursor(-1, 0));
    else if (k === 'ArrowRight') (e.preventDefault(), moveCursor(1, 0));
    else if (k === ' ') (e.preventDefault(), dropNode(cursor));
    else if (k === 'Backspace') (e.preventDefault(), undoNode());
    else if (k === 'Enter') (e.preventDefault(), closeRing());
  };

  const onMouse = (e: React.MouseEvent, place: boolean) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = rect.width / (GRID * PX + PAD * 2);
    const ix = clamp(snap(((e.clientX - rect.left) / s - PAD) / PX));
    const iy = clamp(snap(((e.clientY - rect.top) / s - PAD) / PX));
    setCursor({ x: ix, y: iy });
    if (place) dropNode({ x: ix, y: iy });
  };

  const svgSize = GRID * PX + PAD * 2;
  const grid = [];
  for (let i = 0; i <= GRID; i += 4) {
    grid.push(
      <line key={`v${i}`} x1={toPx(i)} y1={toPx(0)} x2={toPx(i)} y2={toPx(GRID)} stroke="var(--border)" strokeWidth={i % 12 === 0 ? 1 : 0.4} />,
      <line key={`h${i}`} x1={toPx(0)} y1={toPx(i)} x2={toPx(GRID)} y2={toPx(i)} stroke="var(--border)" strokeWidth={i % 12 === 0 ? 1 : 0.4} />,
    );
  }
  const outerClosed = rings[0]?.closed && rings[0].points.length >= 3;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        <strong>Arrows</strong> move · <strong>Space</strong> node · <strong>Backspace</strong> undo ·{' '}
        <strong>Enter</strong> close · click first node to close. Step:
        {[0.25, 0.5, 1, 2].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(s)}
            className={'ml-1 rounded border px-1 ' + (step === s ? 'bg-accent font-semibold' : '')}
          >
            {s}″
          </button>
        ))}
      </p>
      <div tabIndex={0} onKeyDown={onKeyDown} role="application" aria-label="Custom section drawing canvas" className="rounded-lg border bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          width="100%"
          style={{ maxWidth: svgSize, touchAction: 'none' }}
          onMouseMove={(e) => onMouse(e, false)}
          onClick={(e) => onMouse(e, true)}
        >
          <rect x={toPx(0)} y={toPx(0)} width={GRID * PX} height={GRID * PX} fill="var(--card)" stroke="var(--border)" />
          {grid}
          {rings.map((ring, ri) => {
            if (!ring.points.length) return null;
            const color = RING_COLORS[ri % RING_COLORS.length];
            const isHole = ri > 0;
            const d = ring.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toPx(p.x)} ${toPx(p.y)}`).join(' ') + (ring.closed ? ' Z' : '');
            return (
              <g key={ri}>
                <path d={d} fill={ring.closed ? (isHole ? 'var(--card)' : 'var(--primary)') : 'none'} fillOpacity={ring.closed && !isHole ? 0.12 : 1} stroke={color} strokeWidth={2} strokeDasharray={isHole ? '5,3' : undefined} />
                {ring.points.map((p, i) => (
                  <circle key={i} cx={toPx(p.x)} cy={toPx(p.y)} r={i === 0 && !ring.closed ? 5 : 3.5} fill={i === 0 && !ring.closed ? '#22c55e' : color} stroke="var(--card)" strokeWidth={1} />
                ))}
              </g>
            );
          })}
          {lastNode && <line x1={toPx(lastNode.x)} y1={toPx(lastNode.y)} x2={toPx(cursor.x)} y2={toPx(cursor.y)} stroke="var(--primary)" strokeWidth={1.2} strokeDasharray="4,3" />}
          <line x1={toPx(cursor.x) - 7} y1={toPx(cursor.y)} x2={toPx(cursor.x) + 7} y2={toPx(cursor.y)} stroke="#ef4444" strokeWidth={1.3} />
          <line x1={toPx(cursor.x)} y1={toPx(cursor.y) - 7} x2={toPx(cursor.x)} y2={toPx(cursor.y) + 7} stroke="#ef4444" strokeWidth={1.3} />
        </svg>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={closeRing} disabled={!activeRing || activeRing.points.length < 3}>Close shape</Button>
        <Button type="button" size="sm" variant="outline" onClick={startHole} disabled={!outerClosed || rings.some((r) => !r.closed)}>+ Hole</Button>
        <Button type="button" size="sm" variant="ghost" onClick={undoNode}>Undo</Button>
        <Button type="button" size="sm" variant="ghost" onClick={clearAll}>Clear</Button>
      </div>
      {!outerClosed && <p className="text-[11px] text-amber-600">Draw and close the outer shape (≥3 nodes) to analyze.</p>}
    </div>
  );
}
