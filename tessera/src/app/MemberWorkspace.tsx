import { useMemo } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import {
  defaultMemberDesign,
  designToInput,
  gradeOptions,
  sectionCenterX,
  type MemberDesignInput,
  type ReinfRow,
} from '@/design/memberDesign';
import { analyzeMember, type MemberAnalysis } from '@/engine/analyzeMember';
import { analyzeBiaxial, type BiaxialResult } from '@/engine/beamCalculations';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { SectionView } from '@/components/diagrams/SectionView';
import { SectionDrawer } from '@/components/diagrams/SectionDrawer';
import { StressStrainChart } from '@/components/diagrams/StressStrainChart';
import { InteractionDiagram } from '@/components/diagrams/InteractionDiagram';
import { ResultsPanel } from '@/components/results/ResultsPanel';

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function NumberField({
  label,
  value,
  onChange,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
  suffix?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          type="number"
          step={step ?? 'any'}
          value={value}
          className={suffix ? 'pr-10' : undefined}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange(Number.isFinite(v) ? v : 0);
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export function MemberWorkspace() {
  const design = useProjectStore((s) => s.project.design) ?? defaultMemberDesign();
  const projectName = useProjectStore((s) => s.project.meta.name);
  const engineer = useProjectStore((s) => s.project.meta.engineer);
  const setDesign = useProjectStore((s) => s.setDesign);

  const set = <K extends keyof MemberDesignInput>(key: K, value: MemberDesignInput[K]) =>
    setDesign({ [key]: value } as Partial<MemberDesignInput>);

  const input = useMemo(() => designToInput(design), [design]);
  const analysis = useMemo((): { ok: true; value: MemberAnalysis } | { ok: false; error: string } => {
    try {
      return { ok: true, value: analyzeMember(input) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [input]);
  const biaxial = useMemo((): BiaxialResult | null => {
    if (!design.biaxial) return null;
    try {
      return analyzeBiaxial(input.section, input.layers, {});
    } catch {
      return null;
    }
  }, [design.biaxial, input]);

  const isT = design.sectionType === 'tbeam';
  const isCustom = design.sectionType === 'custom';
  const centerX = sectionCenterX(design);

  const updateLayer = (i: number, patch: Partial<ReinfRow>) =>
    set('layers', design.layers.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addLayer = () =>
    set('layers', [
      ...design.layers,
      { id: crypto.randomUUID(), gradeId: 'grade60', area: 0.31, depth: design.h - 2.5, fse: 0, kind: 'mild' },
    ]);
  const removeLayer = (i: number) => set('layers', design.layers.filter((_, idx) => idx !== i));

  const onReport = async () => {
    if (!analysis.ok) return;
    // Lazy-load the PDF generator (jsPDF) so it stays out of the main bundle.
    const { generateMemberReport } = await import('@/report/generateReport');
    generateMemberReport({ projectName, engineer, design, analysis: analysis.value });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* ── Inputs ── */}
      <div className="space-y-6 lg:col-span-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Section &amp; geometry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Member name</Label>
              <Input value={design.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Section type</Label>
              <select
                className={selectClass}
                value={design.sectionType}
                onChange={(e) => set('sectionType', e.target.value as MemberDesignInput['sectionType'])}
              >
                <option value="rectangular">Rectangular</option>
                <option value="tbeam">T-beam</option>
                <option value="custom">Custom (drawn)</option>
              </select>
            </div>

            {isCustom ? (
              <SectionDrawer
                value={{ points: design.points, holes: design.holes }}
                onChange={(points, holes) => setDesign({ points: points ?? undefined, holes })}
              />
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label={isT ? 'Web width bw' : 'Width b'} value={design.b} onChange={(v) => set('b', v)} suffix="in" />
                  <NumberField label="Depth h" value={design.h} onChange={(v) => set('h', v)} suffix="in" />
                  {isT && <NumberField label="Flange width bf" value={design.bf} onChange={(v) => set('bf', v)} suffix="in" />}
                  {isT && <NumberField label="Flange thk hf" value={design.hf} onChange={(v) => set('hf', v)} suffix="in" />}
                </div>
                <div className="flex justify-center rounded-lg border bg-muted/30 py-3">
                  <SectionView section={input.section} layers={input.layers} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Materials, span &amp; loads</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <NumberField label="f′c" value={design.fc} onChange={(v) => set('fc', v)} suffix="ksi" />
            <NumberField label="f′ci (transfer)" value={design.fci} onChange={(v) => set('fci', v)} suffix="ksi" />
            <NumberField label="Unit weight wc" value={design.wc} onChange={(v) => set('wc', v)} suffix="pcf" />
            <NumberField label="λ (lightweight)" value={design.lambda} onChange={(v) => set('lambda', v)} />
            <NumberField label="Span L" value={design.L} onChange={(v) => set('L', v)} suffix="ft" />
            <div />
            <NumberField label="Superimposed dead" value={design.superDead} onChange={(v) => set('superDead', v)} suffix="klf" />
            <NumberField label="Live load" value={design.live} onChange={(v) => set('live', v)} suffix="klf" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Reinforcement</CardTitle>
            <Button size="sm" variant="outline" onClick={addLayer}>
              <Plus /> Add layer
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {design.layers.map((r, i) => (
              <div key={r.id} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <select
                    className={selectClass + ' max-w-[60%]'}
                    value={r.kind}
                    onChange={(e) => updateLayer(i, { kind: e.target.value as ReinfRow['kind'] })}
                  >
                    <option value="mild">Mild bar</option>
                    <option value="strand">Strand</option>
                  </select>
                  <Button size="icon" variant="ghost" aria-label="Remove layer" onClick={() => removeLayer(i)}>
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Grade</Label>
                    <select className={selectClass} value={r.gradeId} onChange={(e) => updateLayer(i, { gradeId: e.target.value })}>
                      {gradeOptions.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <NumberField label="Area" value={r.area} onChange={(v) => updateLayer(i, { area: v })} suffix="in²" />
                  <NumberField label="Depth d" value={r.depth} onChange={(v) => updateLayer(i, { depth: v })} suffix="in" />
                  {r.kind === 'strand' && <NumberField label="fse" value={r.fse} onChange={(v) => updateLayer(i, { fse: v })} suffix="ksi" />}
                  {design.biaxial && <NumberField label="x position" value={r.x ?? centerX} onChange={(v) => updateLayer(i, { x: v })} suffix="in" />}
                </div>
              </div>
            ))}
            {design.layers.length === 0 && <p className="text-sm text-muted-foreground">Add at least one reinforcement layer.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Design parameters</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Service class</Label>
              <select className={selectClass} value={design.serviceClass} onChange={(e) => set('serviceClass', e.target.value as 'U' | 'T')}>
                <option value="U">Class U (uncracked)</option>
                <option value="T">Class T (transition)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Strand type</Label>
              <select className={selectClass} value={design.strandType} onChange={(e) => set('strandType', e.target.value as MemberDesignInput['strandType'])}>
                <option value="270LR">270 low-relax</option>
                <option value="250LR">250 low-relax</option>
                <option value="270SR">270 stress-rel</option>
                <option value="250SR">250 stress-rel</option>
              </select>
            </div>
            <NumberField label="Stirrup Av" value={design.Av} onChange={(v) => set('Av', v)} suffix="in²" />
            <NumberField label="Stirrup spacing s" value={design.stirrupSpacing} onChange={(v) => set('stirrupSpacing', v)} suffix="in" />
            <NumberField label="fyt" value={design.fyt} onChange={(v) => set('fyt', v)} suffix="ksi" />
            <NumberField label="fpi (initial)" value={design.fpi} onChange={(v) => set('fpi', v)} suffix="ksi" />
            <NumberField label="RH" value={design.RH} onChange={(v) => set('RH', v)} suffix="%" />
            <NumberField label="V/S ratio" value={design.VS} onChange={(v) => set('VS', v)} suffix="in" />
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={design.endRegion} onChange={(e) => set('endRegion', e.target.checked)} />
              Use end-region transfer stress limits (0.70 f′ci / 6√f′ci)
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={design.biaxial} onChange={(e) => set('biaxial', e.target.checked)} />
              Biaxial interaction analysis (φMx–φMy)
            </label>
          </CardContent>
        </Card>
      </div>

      {/* ── Results ── */}
      <div className="space-y-6 lg:col-span-7">
        <div className="flex justify-end">
          <Button variant="outline" onClick={onReport} disabled={!analysis.ok}>
            <FileText /> Report (PDF)
          </Button>
        </div>

        {analysis.ok ? (
          <>
            <ResultsPanel analysis={analysis.value} />

            <Card>
              <CardHeader>
                <CardTitle>Steel stress-strain (power formula)</CardTitle>
                <CardDescription>Devalapura–Tadros curves for all grades; current operating points overlaid.</CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center">
                <StressStrainChart result={analysis.value.flexure} />
              </CardContent>
            </Card>

            {biaxial && (
              <Card>
                <CardHeader>
                  <CardTitle>Biaxial interaction (φMx–φMy)</CardTitle>
                  <CardDescription>Strength envelope by neutral-axis-orientation sweep, with cracking envelope and NA-aligned anchors.</CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                  <InteractionDiagram result={biaxial} />
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="py-8 text-sm text-destructive">Analysis error: {analysis.error}</CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
