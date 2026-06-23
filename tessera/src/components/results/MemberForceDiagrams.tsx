import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ForceDiagram } from '@/components/diagrams/ForceDiagram';
import { useMemberDiagrams } from '@/fea/useMemberDiagrams';
import { interpolateDiagram, type DiagramPoint } from '@/fea/feaDiagrams';

const scaleValues = (pts: DiagramPoint[], k: number): DiagramPoint[] =>
  pts.map((p) => ({ x: p.x, value: p.value * k }));

/**
 * Shear, moment & deflection diagrams for the designed member, produced by the
 * OpenSees WASM engine (simply-supported span, 16 elements, under the total
 * service uniform load). Interactive: hover/drag across any plot to read V, M, Δ
 * (and N) at a station via a synced cursor, with support reactions shown.
 * Additive — renders nothing until a solve succeeds.
 */
export function MemberForceDiagrams({
  lengthFt,
  E,
  A,
  I,
  w,
}: {
  /** Span (ft). */
  lengthFt: number;
  /** Elastic modulus (ksi). */
  E: number;
  /** Area (in²). */
  A: number;
  /** Moment of inertia (in⁴). */
  I: number;
  /** Total service uniform load, downward magnitude (kip/in). */
  w: number;
}) {
  const { status, diagram, reactions } = useMemberDiagrams({ lengthIn: lengthFt * 12, E, A, I, w });
  const [cursorXFrac, setCursorXFrac] = useState<number | null>(null);

  if (status === 'idle') return null;

  // Live readout at the cursor station (member coords are inches).
  const readout =
    diagram && cursorXFrac != null
      ? (() => {
          const x = cursorXFrac * diagram.length;
          return {
            xFt: x / 12,
            V: interpolateDiagram(diagram.shear, x),
            Mft: interpolateDiagram(diagram.moment, x) / 12,
            N: interpolateDiagram(diagram.axial, x),
            defl: interpolateDiagram(diagram.deflection, x),
          };
        })()
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shear, moment &amp; deflection (FEA)</CardTitle>
        <CardDescription>
          Simply-supported span under the total service load (w = {(w * 12).toFixed(3)} kip/ft),
          solved by the OpenSees WebAssembly engine (16 elements). Hover or drag a plot to read
          values along the span.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'loading' && <p className="text-sm text-muted-foreground">Solving…</p>}
        {status === 'unavailable' && (
          <p className="text-sm text-muted-foreground">FEA engine unavailable — diagrams skipped.</p>
        )}
        {status === 'ready' && diagram && (
          <div className="space-y-4">
            {/* live cursor readout */}
            <div className="flex min-h-[1.5rem] flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
              {readout ? (
                <>
                  <span className="text-muted-foreground">x = {readout.xFt.toFixed(2)} ft</span>
                  <span className="text-sky-600 dark:text-sky-400">V = {readout.V.toFixed(2)} kip</span>
                  <span className="text-primary">M = {readout.Mft.toFixed(2)} kip-ft</span>
                  <span className="text-emerald-600 dark:text-emerald-400">Δ = {readout.defl.toFixed(3)} in</span>
                  {Math.abs(readout.N) > 1e-6 && (
                    <span className="text-amber-600 dark:text-amber-400">N = {readout.N.toFixed(2)} kip</span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">Hover a diagram to read V, M, N at a station.</span>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ForceDiagram
                title="Shear V"
                unit="kip"
                digits={1}
                points={diagram.shear}
                length={diagram.length}
                colorClass="text-sky-600 dark:text-sky-400"
                cursorXFrac={cursorXFrac}
                onHover={setCursorXFrac}
              />
              <ForceDiagram
                title="Moment M"
                unit="kip-ft"
                digits={1}
                points={scaleValues(diagram.moment, 1 / 12)}
                length={diagram.length}
                colorClass="text-primary"
                cursorXFrac={cursorXFrac}
                onHover={setCursorXFrac}
              />
              <ForceDiagram
                title="Deflection Δ"
                unit="in"
                digits={3}
                points={diagram.deflection}
                length={diagram.length}
                colorClass="text-emerald-600 dark:text-emerald-400"
                cursorXFrac={cursorXFrac}
                onHover={setCursorXFrac}
              />
            </div>

            {/* support reactions */}
            {reactions.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs">
                {reactions.map((r, i) => (
                  <div key={r.nodeId} className="rounded-md border bg-card px-3 py-1.5">
                    <span className="text-muted-foreground">
                      {reactions.length === 2 ? (i === 0 ? 'Left support' : 'Right support') : `Support @ ${(r.x / 12).toFixed(1)} ft`}
                    </span>{' '}
                    <span className="font-mono font-semibold tabular-nums">Rᵧ = {r.fy.toFixed(2)} kip</span>
                    {Math.abs(r.mz) > 1e-6 && (
                      <span className="ml-2 font-mono tabular-nums text-muted-foreground">
                        M = {(r.mz / 12).toFixed(2)} kip-ft
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
