import type { MemberAnalysis } from '@/engine/analyzeMember';
import { formatQuantity } from '@/units/units';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StrainDiagram } from '@/components/diagrams/StrainDiagram';
import { ChecksTable } from './ChecksTable';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function ResultsPanel({ analysis }: { analysis: MemberAnalysis }) {
  const { flexure, demands, governing, losses, camber, prestress } = analysis;
  const govOk = governing.status === 'pass';

  return (
    <div className="space-y-6">
      {/* Governing banner */}
      <div
        className={
          'flex items-center justify-between rounded-xl border px-4 py-3 ' +
          (govOk ? 'border-[var(--success)]/40 bg-[var(--success)]/10' : 'border-destructive/40 bg-destructive/10')
        }
      >
        <div>
          <div className="text-sm font-semibold">{govOk ? 'All checks pass' : 'One or more checks fail'}</div>
          <div className="text-xs text-muted-foreground">
            Governing: {governing.check?.label ?? '—'} ({governing.check?.clause ?? ''})
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-bold tabular-nums">
            {Number.isFinite(governing.utilization) ? `${(governing.utilization * 100).toFixed(0)}%` : '—'}
          </div>
          <div className="text-[11px] text-muted-foreground">max utilization</div>
        </div>
      </div>

      {/* Flexure summary + strain diagram */}
      <Card>
        <CardHeader>
          <CardTitle>Flexure — power formula</CardTitle>
          <CardDescription>
            Devalapura–Tadros / PCI strain-compatibility; neutral axis by bisection (ΣF = 0).
            {flexure.converged ? ' Converged.' : ' Did NOT converge.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="φMₙ" value={formatQuantity(flexure.phiMnFt, 'kip-ft', 1)} sub={`φ = ${flexure.phi.toFixed(2)} (§21.2)`} />
              <Stat label="Mu (factored)" value={formatQuantity(demands.Mu / 12, 'kip-ft', 1)} sub={`governs: ${demands.combo} (§5.3)`} />
              <Stat label="Neutral axis c" value={formatQuantity(flexure.c, 'in', 2)} sub={`a = ${flexure.a.toFixed(2)} in`} />
              <Stat label="Net tensile strain εₜ" value={flexure.epsilonT.toFixed(5)} sub={flexure.ductile ? 'tension-controlled' : flexure.transition ? 'transition' : 'compression-controlled'} />
              <Stat label="Mcr" value={formatQuantity(flexure.cracking.McrFt, 'kip-ft', 1)} sub="§24.5 cracking" />
              {prestress.hasStrands && (
                <Stat label="Effective prestress P" value={formatQuantity(prestress.Pe, 'kip', 1)} sub={`e = ${prestress.e.toFixed(2)} in`} />
              )}
            </div>
            <div className="flex items-center justify-center">
              <StrainDiagram result={flexure} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Serviceability summary */}
      <Card>
        <CardHeader>
          <CardTitle>Serviceability</CardTitle>
          <CardDescription>Camber/deflection (PCI multipliers){losses ? ' and prestress losses (PCI/Zia)' : ''}.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Camber at release" value={formatQuantity(camber.camberAtRelease, 'in', 3)} sub="+ up" />
            <Stat label="Final camber" value={formatQuantity(camber.finalCamber, 'in', 3)} sub="long-term, + up" />
            <Stat label="Live Δ" value={formatQuantity(camber.liveDeflection, 'in', 3)} sub="immediate" />
            {losses && <Stat label="fse (est.)" value={formatQuantity(losses.fse, 'ksi', 1)} sub={`ΔfpT = ${losses.total.toFixed(1)} ksi`} />}
          </div>
          {losses && (
            <p className="mt-3 text-[11px] italic text-muted-foreground">{losses.note}</p>
          )}
        </CardContent>
      </Card>

      {/* All checks */}
      <Card>
        <CardHeader>
          <CardTitle>Code checks</CardTitle>
          <CardDescription>Each cites its ACI 318-19 / PCI clause and governing formula.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChecksTable checks={analysis.checks} />
        </CardContent>
      </Card>
    </div>
  );
}
