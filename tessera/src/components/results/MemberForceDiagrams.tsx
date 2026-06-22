import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ForceDiagram } from '@/components/diagrams/ForceDiagram';
import { useMemberDiagrams } from '@/fea/useMemberDiagrams';
import type { DiagramPoint } from '@/fea/feaDiagrams';

const scaleValues = (pts: DiagramPoint[], k: number): DiagramPoint[] =>
  pts.map((p) => ({ x: p.x, value: p.value * k }));

/**
 * Shear & moment diagrams for the designed member, produced by the OpenSees WASM
 * engine (simply-supported span under the total service uniform load). Additive:
 * renders nothing until a solve succeeds, and a quiet note if the engine is
 * unavailable — sectional design never depends on it.
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
  const { status, diagram } = useMemberDiagrams({ lengthIn: lengthFt * 12, E, A, I, w });

  if (status === 'idle') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shear &amp; moment (FEA)</CardTitle>
        <CardDescription>
          Simply-supported span under the total service load (w = {(w * 12).toFixed(3)} kip/ft),
          solved by the OpenSees WebAssembly engine.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'loading' && <p className="text-sm text-muted-foreground">Solving…</p>}
        {status === 'unavailable' && (
          <p className="text-sm text-muted-foreground">FEA engine unavailable — diagrams skipped.</p>
        )}
        {status === 'ready' && diagram && (
          <div className="grid gap-4 sm:grid-cols-2">
            <ForceDiagram
              title="Shear V"
              unit="kip"
              digits={1}
              points={diagram.shear}
              length={diagram.length}
              colorClass="text-sky-600 dark:text-sky-400"
            />
            <ForceDiagram
              title="Moment M"
              unit="kip-ft"
              digits={1}
              points={scaleValues(diagram.moment, 1 / 12)}
              length={diagram.length}
              colorClass="text-primary"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
