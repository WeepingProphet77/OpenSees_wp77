import { useMemo, useState } from 'react';
import { Boxes, CheckCircle2, FolderOpen, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { analyzeBeam } from '@/engine/beamCalculations';
import steelPresets from '@/engine/steelPresets';
import { formatQuantity } from '@/units/units';
import { useProjectStore } from '@/store/projectStore';
import { parseProject, pickAndReadTsr, saveProjectToFile } from '@/project/tsrFile';
import { APP_NAME, APP_VERSION } from '@/appInfo';

/**
 * Phase 0 "hello Tessera": proves the deploy, and that the ported power-formula
 * engine and the .tsr Save / Load / Clear pipeline run in the browser.
 */
function App() {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const setMeta = useProjectStore((s) => s.setMeta);
  const loadProject = useProjectStore((s) => s.loadProject);
  const clearProject = useProjectStore((s) => s.clearProject);
  const markSaved = useProjectStore((s) => s.markSaved);

  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // A worked example from the engine's own regression suite, computed live in
  // the browser to prove the TypeScript port works end-to-end.
  const demo = useMemo(() => {
    const gr60 = steelPresets.find((p) => p.id === 'grade60')!;
    return analyzeBeam(
      { sectionType: 'rectangular', bf: 12, bw: 12, hf: 24, h: 24, fc: 4 },
      [{ area: 3.0, depth: 21.5, fse: 0, steel: gr60 }],
    );
  }, []);

  const handleSave = async () => {
    try {
      const wrote = await saveProjectToFile(project);
      if (wrote) {
        markSaved();
        setStatus({ kind: 'ok', text: 'Project saved to .tsr file.' });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: `Save failed: ${(e as Error).message}` });
    }
  };

  const handleLoad = async () => {
    try {
      const text = await pickAndReadTsr();
      if (text == null) return;
      const result = parseProject(text);
      if (result.ok) {
        loadProject(result.project);
        setStatus({ kind: 'ok', text: `Loaded "${result.project.meta.name}".` });
      } else {
        setStatus({ kind: 'error', text: result.error });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: `Load failed: ${(e as Error).message}` });
    }
  };

  const handleClear = () => {
    if (dirty && !window.confirm('Discard unsaved changes and start a new project?')) return;
    clearProject();
    setStatus({ kind: 'ok', text: 'Started a new empty project.' });
  };

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      {/* Header */}
      <header className="mb-10 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Boxes className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
            <p className="text-sm text-muted-foreground">
              Precast / prestressed concrete design · ACI 318-19 + PCI 8th · US customary units
            </p>
          </div>
        </div>
        <span className="rounded-full border border-input bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          Phase 0 · v{APP_VERSION}
        </span>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Project / .tsr pipeline */}
        <Card>
          <CardHeader>
            <CardTitle>Project</CardTitle>
            <CardDescription>
              The in-browser model is the single source of truth. Save / Load / Clear use the
              versioned, zod-validated <code className="font-mono text-xs">.tsr</code> format.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Project name</span>
              <input
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={project.meta.name}
                onChange={(e) => setMeta({ name: e.target.value })}
                placeholder="Untitled Project"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleSave}>
                <Save /> Save
              </Button>
              <Button variant="outline" onClick={handleLoad}>
                <FolderOpen /> Load
              </Button>
              <Button variant="ghost" onClick={handleClear}>
                <Trash2 /> Clear
              </Button>
              <span
                className={
                  'ml-auto text-xs font-medium ' +
                  (dirty ? 'text-destructive' : 'text-muted-foreground')
                }
              >
                {dirty ? '● Unsaved changes' : 'Saved'}
              </span>
            </div>

            {status && (
              <p
                className={
                  'rounded-md border px-3 py-2 text-xs ' +
                  (status.kind === 'ok'
                    ? 'border-input bg-accent text-accent-foreground'
                    : 'border-destructive/40 bg-destructive/10 text-destructive')
                }
              >
                {status.text}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Engine proof */}
        <Card>
          <CardHeader>
            <CardTitle>Flexural engine — live check</CardTitle>
            <CardDescription>
              Power formula (Devalapura–Tadros / PCI) with ACI 318-19 strain compatibility,
              ported to TypeScript and run in your browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Singly-reinforced RC beam: 12&nbsp;×&nbsp;24&nbsp;in, f′c&nbsp;=&nbsp;4&nbsp;ksi,
              A<sub>s</sub>&nbsp;=&nbsp;3.0&nbsp;in² Gr&nbsp;60 at d&nbsp;=&nbsp;21.5&nbsp;in.
            </p>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Metric label="φ (§21.2)" value={demo.phi.toFixed(2)} />
              <Metric label="φMₙ" value={formatQuantity(demo.phiMnFt, 'kip-ft', 1)} accent />
              <Metric label="Stress block a (§22.2)" value={formatQuantity(demo.a, 'in', 3)} />
              <Metric label="Net tensile strain εₜ" value={demo.epsilonT.toFixed(5)} />
            </dl>

            <div className="flex items-center gap-2 rounded-md border border-input bg-accent/60 px-3 py-2 text-xs font-medium">
              <CheckCircle2 className="size-4 text-[var(--success)]" />
              {demo.converged ? 'Bisection converged' : 'Did not converge'} · residual{' '}
              {demo.residual.toExponential(1)} kip · tension-controlled:{' '}
              {demo.ductile ? 'yes' : 'no'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Steel catalog */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Steel catalog</CardTitle>
          <CardDescription>
            {steelPresets.length} ported power-formula presets (mild + prestressing). Each carries
            its {`{ Es, fpu, fpy, stressCap, Q, R, K, defaultFse }`} parameters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2">
            {steelPresets.map((s) => (
              <li
                key={s.id}
                className="rounded-md border border-input bg-card px-2.5 py-1 text-xs"
                title={s.description}
              >
                <span className="font-medium">{s.name}</span>{' '}
                <span className="text-muted-foreground">· {s.category}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <footer className="mt-10 border-t pt-6 text-xs text-muted-foreground">
        Tessera is internal-use structural design software. Every reported capacity cites its
        ACI/PCI clause and formula; solvers report convergence; units are explicit (kip, in, ksi).
        FEA (forked OpenSees → WebAssembly) is added in a later phase behind a decoupled engine
        interface.
      </footer>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={'text-right font-mono ' + (accent ? 'font-semibold text-primary' : '')}>
        {value}
      </dd>
    </>
  );
}

export default App;
