import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NumberField, SelectField } from '@/components/ui/field';
import { Stat } from '@/components/ui/stat';
import { UtilizationGauge } from '@/components/ui/utilizationGauge';
import { Spinner } from '@/components/ui/spinner';
import { VierendeelDiagram } from '@/components/diagrams/VierendeelDiagram';
import { useVierendeel, type VierendeelInput } from '@/fea/useVierendeel';

interface PanelState {
  width: number;
  height: number;
  thickness: number;
  cols: number;
  rows: number;
  pierWidth: number;
  chordDepth: number;
  fc: number;
  lambda: number;
  unitWeight: number;
  lateralLoad: number;
  gravity: number;
  base: 'fixed' | 'pinned';
}

const DEFAULT_PANEL: PanelState = {
  width: 240,
  height: 144,
  thickness: 8,
  cols: 2,
  rows: 1,
  pierWidth: 36,
  chordDepth: 24,
  fc: 5,
  lambda: 1,
  unitWeight: 150,
  lateralLoad: 15,
  gravity: 0.02,
  base: 'fixed',
};

/**
 * Vierendeel wall-panel tool (build spec §10 workflow 3): define the panel and
 * its opening grid, solve the equivalent frame in the WASM engine, and review
 * member forces + per-member sectional screening. Panel state is local to this
 * view for now (not yet persisted to the .tsr project).
 */
export function VierendeelWorkspace() {
  const [panel, setPanel] = useState<PanelState>(DEFAULT_PANEL);
  const set = <K extends keyof PanelState>(key: K, value: PanelState[K]) =>
    setPanel((p) => ({ ...p, [key]: value }));

  // Ec from f′c (ACI 19.2.2, normal-weight): 57000√f′c (psi) → ksi.
  const E = useMemo(() => (57000 * Math.sqrt(panel.fc * 1000)) / 1000, [panel.fc]);

  const input: VierendeelInput = {
    grid: {
      width: panel.width,
      height: panel.height,
      thickness: panel.thickness,
      cols: Math.max(1, Math.round(panel.cols)),
      rows: Math.max(1, Math.round(panel.rows)),
      pierWidth: panel.pierWidth,
      chordDepth: panel.chordDepth,
    },
    E,
    fc: panel.fc,
    lambda: panel.lambda,
    unitWeight: panel.unitWeight,
    lateralLoad: panel.lateralLoad,
    gravity: panel.gravity,
    base: panel.base,
  };
  const v = useVierendeel(input);

  const members = useMemo(
    () => [...v.members].sort((a, b) => b.utilization - a.utilization),
    [v.members],
  );
  const govOk = v.summary.maxUtilization <= 1 + 1e-9;

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* ── Inputs ── */}
      <div className="space-y-6 lg:col-span-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Panel &amp; openings</CardTitle>
            <CardDescription>
              A wall pierced by a regular grid of openings, idealized as a rigid-jointed (Vierendeel)
              frame and solved by the WASM engine.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <NumberField label="Panel width" value={panel.width} onChange={(x) => set('width', x)} suffix="in" positive />
            <NumberField label="Panel height" value={panel.height} onChange={(x) => set('height', x)} suffix="in" positive />
            <NumberField label="Thickness" value={panel.thickness} onChange={(x) => set('thickness', x)} suffix="in" positive />
            <NumberField label="f′c" value={panel.fc} onChange={(x) => set('fc', x)} suffix="ksi" positive />
            <NumberField label="Openings across" value={panel.cols} onChange={(x) => set('cols', x)} min={1} step="1" />
            <NumberField label="Openings up" value={panel.rows} onChange={(x) => set('rows', x)} min={1} step="1" />
            <NumberField label="Pier width" value={panel.pierWidth} onChange={(x) => set('pierWidth', x)} suffix="in" positive />
            <NumberField label="Chord depth" value={panel.chordDepth} onChange={(x) => set('chordDepth', x)} suffix="in" positive />
            <NumberField label="λ (lightweight)" value={panel.lambda} onChange={(x) => set('lambda', x)} positive />
            <SelectField label="Base fixity" value={panel.base} onChange={(x) => set('base', x as 'fixed' | 'pinned')}>
              <option value="fixed">Fixed</option>
              <option value="pinned">Pinned</option>
            </SelectField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Loads</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <NumberField label="Lateral force (top)" value={panel.lateralLoad} onChange={(x) => set('lateralLoad', x)} suffix="kip" />
            <NumberField label="Superimposed gravity" value={panel.gravity} onChange={(x) => set('gravity', x)} suffix="kip/in" />
            <NumberField label="Unit weight" value={panel.unitWeight} onChange={(x) => set('unitWeight', x)} suffix="pcf" />
          </CardContent>
        </Card>
      </div>

      {/* ── Results ── */}
      <div className="space-y-6 lg:col-span-7">
        {v.status === 'invalid' ? (
          <Card>
            <CardContent className="py-8 text-sm text-destructive" role="alert">
              {v.error ?? 'Invalid panel geometry.'}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Panel elevation</CardTitle>
                  <CardDescription>
                    Openings cut from the solid; members colored by utilization. Base supports shown.
                  </CardDescription>
                </div>
                {v.status === 'ready' && (
                  <span
                    className={
                      'rounded-full px-2.5 py-1 text-xs font-semibold ' +
                      (govOk ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-destructive/15 text-destructive')
                    }
                  >
                    {govOk ? 'PASS' : 'OVERSTRESS'} · max {(v.summary.maxUtilization * 100).toFixed(0)}%
                  </span>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {v.lines ? (
                  <div className="flex justify-center">
                    <VierendeelDiagram lines={v.lines} members={v.members} />
                  </div>
                ) : null}
                {v.status !== 'ready' && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                    {v.status === 'loading' ? (
                      <>
                        <Spinner /> Solving the equivalent frame…
                      </>
                    ) : v.status === 'unavailable' ? (
                      `FEA engine unavailable${v.error ? ` — ${v.error}` : ''}.`
                    ) : (
                      'Adjust the panel to solve.'
                    )}
                  </p>
                )}
                {v.status === 'ready' && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat label="Members" value={String(v.members.length)} />
                    <Stat label="Opening size" value={`${(v.lines!.openingWidth).toFixed(0)}×${(v.lines!.openingHeight).toFixed(0)} in`} />
                    <Stat label="Governing" value={v.summary.governing?.label ?? '—'} />
                    <Stat label="Max utilization" value={`${(v.summary.maxUtilization * 100).toFixed(0)}%`} />
                  </div>
                )}
              </CardContent>
            </Card>

            {v.status === 'ready' && (
              <Card>
                <CardHeader>
                  <CardTitle>Member checks</CardTitle>
                  <CardDescription>
                    Each member screened as a concrete strip — flexural cracking (§19.2.3.1) and one-way
                    shear (§22.5.5.1). Sorted worst-first. Plain strips: exceeding cracking means flexural
                    steel must be designed.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Member</th>
                        <th className="py-2 pr-3 font-medium">N (kip)</th>
                        <th className="py-2 pr-3 font-medium">V (kip)</th>
                        <th className="py-2 pr-3 font-medium">M (kip-ft)</th>
                        <th className="py-2 pr-3 font-medium">Cracking</th>
                        <th className="py-2 font-medium">Shear</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.elementId} className="border-b align-middle last:border-0">
                          <td className="py-2 pr-3">{m.label}</td>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums">{m.N.toFixed(1)}</td>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums">{m.V.toFixed(1)}</td>
                          <td className="py-2 pr-3 font-mono text-xs tabular-nums">{(m.M / 12).toFixed(1)}</td>
                          <td className="py-2 pr-3">
                            <UtilizationGauge utilization={m.checks[0].utilization} status={m.checks[0].status} className="w-28" />
                          </td>
                          <td className="py-2">
                            <UtilizationGauge utilization={m.checks[1].utilization} status={m.checks[1].status} className="w-28" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
