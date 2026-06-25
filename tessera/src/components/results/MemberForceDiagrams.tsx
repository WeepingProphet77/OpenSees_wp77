import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { ForceDiagram } from '@/components/diagrams/ForceDiagram';
import { StressDiagram } from '@/components/diagrams/StressDiagram';
import { useMemberDiagrams } from '@/fea/useMemberDiagrams';
import { interpolateDiagram, type DiagramPoint } from '@/fea/feaDiagrams';
import { memberStressDistribution } from '@/engine/designChecks/serviceStresses';
import { MEMBER_LOAD_COMBOS, memberLoadFactor } from '@/engine/loadCombinations';

const scaleValues = (pts: DiagramPoint[], k: number): DiagramPoint[] =>
  pts.map((p) => ({ x: p.x, value: p.value * k }));

/**
 * Prestress + section data needed to overlay service fiber-stress diagrams on
 * the solved moment. Optional — omit it (e.g. non-prestressed) and the card
 * shows only V/M/Δ.
 */
export interface MemberStressInputs {
  props: { A: number; Ig: number; yt: number; yb: number };
  /** Prestress force at transfer / after losses (kip). */
  Pi: number;
  Pe: number;
  /** Tendon eccentricity below the centroid (in). */
  e: number;
  /** Mg/Mtotal — self-weight share of total load; transfer moment = ratio·M(x). */
  transferRatio: number;
  /** Allowable stress magnitudes (ksi). */
  transferCompression: number;
  transferTension: number;
  serviceCompression: number;
  serviceTension: number;
}

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
  loads,
  stress,
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
  /** Dead & live load components (kip/in) → enables the load-combination selector. */
  loads?: { dead: number; live: number };
  /** Optional prestress/section data → adds service fiber-stress diagrams. */
  stress?: MemberStressInputs;
}) {
  const { status, diagram, reactions } = useMemberDiagrams({ lengthIn: lengthFt * 12, E, A, I, w });
  const [cursorXFrac, setCursorXFrac] = useState<number | null>(null);
  const [comboId, setComboId] = useState('service');

  if (status === 'idle') return null;

  // The structure is linear-elastic, so the service (D+L) result scales to any
  // gravity combination by a single factor — no re-solve. Demands (V/M/Δ) scale;
  // the service fiber stresses below keep the unfactored service moment.
  const combo = MEMBER_LOAD_COMBOS.find((c) => c.id === comboId) ?? MEMBER_LOAD_COMBOS[0];
  const factor = loads ? memberLoadFactor(combo.combination, loads.dead, loads.live) : 1;

  // Fiber-stress distribution from the solved moment (kip-in, sagging +).
  const stressDist =
    stress && diagram
      ? memberStressDistribution({
          props: stress.props,
          Pi: stress.Pi,
          Pe: stress.Pe,
          e: stress.e,
          moment: diagram.moment,
          transferRatio: stress.transferRatio,
        })
      : null;

  // Live readout at the cursor station (member coords are inches).
  const readout =
    diagram && cursorXFrac != null
      ? (() => {
          const x = cursorXFrac * diagram.length;
          return {
            xFt: x / 12,
            V: interpolateDiagram(diagram.shear, x) * factor,
            Mft: (interpolateDiagram(diagram.moment, x) / 12) * factor,
            N: interpolateDiagram(diagram.axial, x) * factor,
            defl: interpolateDiagram(diagram.deflection, x) * factor,
          };
        })()
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shear, moment &amp; deflection (FEA)</CardTitle>
        <CardDescription>
          Simply-supported span solved by the OpenSees WebAssembly engine (16 elements). Demands
          (V, M, Δ) are shown for the selected gravity load combination; the service fiber stresses
          below always use the unfactored service moment. Hover or drag a plot to read values.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Spinner /> Solving…
          </p>
        )}
        {status === 'unavailable' && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            FEA engine unavailable — diagrams skipped.
          </p>
        )}
        {status === 'ready' && diagram && (
          <div className="space-y-4">
            {/* load-combination selector */}
            {loads && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Load combination:</span>
                <div className="inline-flex overflow-hidden rounded-md border">
                  {MEMBER_LOAD_COMBOS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setComboId(c.id)}
                      title={c.clause}
                      className={`px-2.5 py-1 font-mono transition-colors ${
                        c.id === comboId ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {!combo.service && (
                  <span className="text-muted-foreground">
                    factored demands (×{factor.toFixed(2)}) — service stresses below unchanged
                  </span>
                )}
              </div>
            )}

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
                points={scaleValues(diagram.shear, factor)}
                length={diagram.length}
                colorClass="text-sky-600 dark:text-sky-400"
                cursorXFrac={cursorXFrac}
                onHover={setCursorXFrac}
              />
              <ForceDiagram
                title="Moment M"
                unit="kip-ft"
                digits={1}
                points={scaleValues(diagram.moment, factor / 12)}
                length={diagram.length}
                colorClass="text-primary"
                cursorXFrac={cursorXFrac}
                onHover={setCursorXFrac}
              />
              <ForceDiagram
                title="Deflection Δ"
                unit="in"
                digits={3}
                points={scaleValues(diagram.deflection, factor)}
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
                    <span className="font-mono font-semibold tabular-nums">Rᵧ = {(r.fy * factor).toFixed(2)} kip</span>
                    {Math.abs(r.mz) > 1e-6 && (
                      <span className="ml-2 font-mono tabular-nums text-muted-foreground">
                        M = {((r.mz / 12) * factor).toFixed(2)} kip-ft
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* service fiber stresses vs. allowables (ACI 318-19 §24.5) */}
            {stress && stressDist && (
              <div className="space-y-2 border-t pt-4">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Service fiber stresses (compression +) — top & bottom along the span vs. ACI §24.5 limits
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <StressDiagram
                    title="Transfer (Pi, self-wt)"
                    stations={stressDist.transfer}
                    length={diagram.length}
                    compLimit={stress.transferCompression}
                    tenLimit={stress.transferTension}
                    compLabel={`≤ ${stress.transferCompression.toFixed(2)} ksi`}
                    tenLabel={`≥ −${stress.transferTension.toFixed(2)} ksi`}
                    cursorXFrac={cursorXFrac}
                    onHover={setCursorXFrac}
                  />
                  <StressDiagram
                    title="Service (Pe, total load)"
                    stations={stressDist.service}
                    length={diagram.length}
                    compLimit={stress.serviceCompression}
                    tenLimit={stress.serviceTension}
                    compLabel={`≤ ${stress.serviceCompression.toFixed(2)} ksi`}
                    tenLabel={`≥ −${stress.serviceTension.toFixed(2)} ksi`}
                    cursorXFrac={cursorXFrac}
                    onHover={setCursorXFrac}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
