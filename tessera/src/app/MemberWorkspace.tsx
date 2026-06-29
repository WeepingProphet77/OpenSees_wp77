import { useMemo, useRef, useState } from 'react';
import { FileText, FileUp, Plus, Trash2 } from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import {
  defaultMemberDesign,
  designToInput,
  gradeOptions,
  sectionCenterX,
  type MemberDesignInput,
  type ReinfRow,
} from '@/design/memberDesign';
import { parseDxf, UNIT_SCALE_TO_INCHES } from '@/dxf/dxfParser';
import { dxfRingsToSection } from '@/dxf/dxfGeometry';
import { analyzeMember, type MemberAnalysis } from '@/engine/analyzeMember';
import { analyzeBiaxial, type BiaxialResult } from '@/engine/beamCalculations';
import { pmInteraction, momentCapacityAtP, type PMInteractionResult } from '@/engine/columnPM';
import { handlingStresses } from '@/engine/handlingStresses';
import { PMDiagram } from '@/components/diagrams/PMDiagram';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Stat } from '@/components/ui/stat';
import { UtilizationGauge } from '@/components/ui/utilizationGauge';
import { Spinner } from '@/components/ui/spinner';
import { NumberField, SelectField } from '@/components/ui/field';
import { SectionView } from '@/components/diagrams/SectionView';
import { SectionDrawer } from '@/components/diagrams/SectionDrawer';
import { StressStrainChart } from '@/components/diagrams/StressStrainChart';
import { MomentCurvatureChart } from '@/components/diagrams/MomentCurvatureChart';
import { InteractionDiagram } from '@/components/diagrams/InteractionDiagram';
import { buildMomentCurvatureSpec } from '@/fea/momentCurvatureSpec';
import { useMomentCurvature } from '@/fea/useMomentCurvature';
import { ResultsPanel } from '@/components/results/ResultsPanel';
import { MemberForceDiagrams } from '@/components/results/MemberForceDiagrams';

export function MemberWorkspace() {
  const memberDesigns = useProjectStore((s) => s.project.memberDesigns);
  const activeMemberId = useProjectStore((s) => s.project.activeMemberId);
  const projectName = useProjectStore((s) => s.project.meta.name);
  const engineer = useProjectStore((s) => s.project.meta.engineer);
  const setDesign = useProjectStore((s) => s.setDesign);

  const activeEntry = memberDesigns.find((m) => m.id === activeMemberId) ?? memberDesigns[0];
  const design = activeEntry?.design ?? defaultMemberDesign();

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

  const isColumn = design.memberType === 'column';
  const isWall = design.memberType === 'wall';
  const isPM = isColumn || isWall;
  const pm = useMemo((): PMInteractionResult | null => {
    if (!isPM) return null;
    try {
      return pmInteraction(input.section, input.layers, { tie: design.tie });
    } catch {
      return null;
    }
  }, [isPM, design.tie, input]);

  // P-M demand check (column / wall out-of-plane): is (Mu, Pu) inside the φ envelope?
  const pmCheck = useMemo(() => {
    if (!pm || !analysis.ok) return null;
    const Pu = design.axialPu; // kip, compression +
    const Mu = analysis.value.demands.Mu / 12; // kip-ft
    const capM = momentCapacityAtP(pm, Pu);
    const axialOk = Pu <= pm.phiPnMax + 1e-6;
    return { Pu, Mu, capM, pass: axialOk && Mu <= capM + 1e-6 };
  }, [pm, analysis, design.axialPu]);

  // Wall handling / stripping stress check.
  const handling = useMemo(() => {
    if (!isWall || !analysis.ok) return null;
    return handlingStresses({
      L: design.L * 12,
      wSelf: analysis.value.properties.wSelf,
      S: analysis.value.properties.Sb,
      fci: design.fci,
      impactFactor: design.handlingImpact,
      lambda: design.lambda,
    });
  }, [isWall, analysis, design.L, design.fci, design.handlingImpact, design.lambda]);

  // Fiber moment–curvature of the actual section (flexural members only). FEA is
  // additive — a null spec or an unavailable engine just hides the chart.
  const mcSpec = useMemo(() => {
    if (isPM || !design.layers.some((r) => r.area > 0)) return null;
    try {
      return buildMomentCurvatureSpec(input.section, design.layers, design.fc);
    } catch {
      return null;
    }
  }, [isPM, input.section, design.layers, design.fc]);
  const momentCurvature = useMomentCurvature(mcSpec);

  const isT = design.sectionType === 'tbeam';
  const isCustom = design.sectionType === 'custom';
  const isDxf = design.sectionType === 'dxf';
  const isDT = design.sectionType === 'doubletee';
  const isHC = design.sectionType === 'hollowcore';
  const isSandwich = design.sectionType === 'sandwich';
  const isFloor = isDT || isHC;
  const centerX = sectionCenterX(design);

  const updateLayer = (i: number, patch: Partial<ReinfRow>) =>
    set('layers', design.layers.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addLayer = () =>
    set('layers', [
      ...design.layers,
      { id: crypto.randomUUID(), gradeId: 'grade60', area: 0.31, depth: design.h - 2.5, fse: 0, kind: 'mild' },
    ]);
  const removeLayer = (i: number) => set('layers', design.layers.filter((_, idx) => idx !== i));

  const dxfInputRef = useRef<HTMLInputElement>(null);
  const [dxfMsg, setDxfMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const handleImportDxf = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseDxf(text);
      const scale = parsed.units ? (UNIT_SCALE_TO_INCHES[parsed.units] ?? 1) : 1;
      const sec = dxfRingsToSection(parsed.rings, { unitScale: scale, nodes: parsed.nodes });
      const layers: ReinfRow[] = sec.nodes.map((n) => ({
        id: crypto.randomUUID(),
        gradeId: 'grade60',
        area: 0,
        depth: n.depth,
        x: n.x,
        fse: 0,
        kind: 'mild',
      }));
      setDesign({ sectionType: 'dxf', points: sec.points, holes: sec.holes, h: sec.h, layers });
      const warn = [...parsed.warnings, ...sec.warnings];
      setDxfMsg({
        kind: 'ok',
        text:
          `Imported: ${sec.stats.width.toFixed(1)}×${sec.stats.height.toFixed(1)} in, ` +
          `${sec.stats.openingCount} opening(s), ${sec.stats.nodeCount} reinforcement placeholder(s). ` +
          `Assign each placeholder's type/size/grade below.` +
          (warn.length ? ` ⚠ ${warn.join(' ')}` : ''),
      });
    } catch (e) {
      setDxfMsg({ kind: 'error', text: `DXF import failed: ${(e as Error).message}` });
    }
  };

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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="member-name">Member name</Label>
                <Input id="member-name" value={design.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <SelectField label="Member type" value={design.memberType} onChange={(v) => set('memberType', v as MemberDesignInput['memberType'])}>
                <option value="beam">Beam (flexure)</option>
                <option value="column">Column (P-M)</option>
                <option value="wall">Wall panel (P-M)</option>
              </SelectField>
            </div>
            <SelectField label="Section type" value={design.sectionType} onChange={(v) => set('sectionType', v as MemberDesignInput['sectionType'])}>
              <option value="rectangular">Rectangular</option>
              <option value="tbeam">T-beam</option>
              <option value="doubletee">Double-tee</option>
              <option value="hollowcore">Hollowcore</option>
              <option value="sandwich">Sandwich wall</option>
              <option value="custom">Custom (drawn)</option>
              <option value="dxf">DXF import</option>
            </SelectField>

            <div className="space-y-2">
              <input
                ref={dxfInputRef}
                type="file"
                accept=".dxf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportDxf(f);
                  e.target.value = '';
                }}
              />
              <Button size="sm" variant="outline" onClick={() => dxfInputRef.current?.click()}>
                <FileUp /> Import DXF…
              </Button>
              {dxfMsg && (
                <p
                  className={
                    'rounded-md border px-3 py-2 text-xs ' +
                    (dxfMsg.kind === 'ok'
                      ? 'border-input bg-accent text-accent-foreground'
                      : 'border-destructive/40 bg-destructive/10 text-destructive')
                  }
                >
                  {dxfMsg.text}
                </p>
              )}
            </div>

            {isCustom ? (
              <SectionDrawer
                value={{ points: design.points, holes: design.holes }}
                onChange={(points, holes) => setDesign({ points: points ?? undefined, holes })}
              />
            ) : isDxf ? (
              <div className="space-y-2">
                <div className="flex justify-center rounded-lg border bg-muted/30 py-3">
                  <SectionView section={input.section} layers={input.layers} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Imported from DXF (read-only). Each DXF <code>POINT</code> became a generic
                  reinforcement placeholder — assign type/size/grade/fse below. Re-import to replace.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {(isDT || isHC) && <NumberField label="Width bf" value={design.bf} onChange={(v) => set('bf', v)} suffix="in" positive />}
                  {(design.sectionType === 'rectangular' || isT) && (
                    <NumberField label={isT ? 'Web width bw' : 'Width b'} value={design.b} onChange={(v) => set('b', v)} suffix="in" positive />
                  )}
                  <NumberField label="Depth h" value={design.h} onChange={(v) => set('h', v)} suffix="in" positive />
                  {(isT || isDT) && <NumberField label="Flange width bf" value={design.bf} onChange={(v) => set('bf', v)} suffix="in" positive />}
                  {(isT || isDT) && <NumberField label="Flange thk hf" value={design.hf} onChange={(v) => set('hf', v)} suffix="in" positive />}
                  {isDT && <NumberField label="# stems" value={design.numStems} onChange={(v) => set('numStems', Math.max(1, Math.round(v)))} />}
                  {isDT && <NumberField label="Stem width" value={design.stemWidth} onChange={(v) => set('stemWidth', v)} suffix="in" />}
                  {isHC && <NumberField label="# voids" value={design.numVoids} onChange={(v) => set('numVoids', Math.max(0, Math.round(v)))} />}
                  {isHC && <NumberField label="Void dia." value={design.voidDiameter} onChange={(v) => set('voidDiameter', v)} suffix="in" />}
                  {isHC && <NumberField label="Void depth" value={design.voidCenterDepth} onChange={(v) => set('voidCenterDepth', v)} suffix="in" />}
                  {isSandwich && <NumberField label="Top wythe width bt" value={design.bt} onChange={(v) => set('bt', v)} suffix="in" />}
                  {isSandwich && <NumberField label="Top wythe thk ht" value={design.ht} onChange={(v) => set('ht', v)} suffix="in" />}
                  {isSandwich && <NumberField label="Gap hg" value={design.hg} onChange={(v) => set('hg', v)} suffix="in" />}
                  {isSandwich && <NumberField label="Bot wythe width bb" value={design.bb} onChange={(v) => set('bb', v)} suffix="in" />}
                </div>
                <div className="flex justify-center rounded-lg border bg-muted/30 py-3">
                  <SectionView section={input.section} layers={input.layers} />
                </div>
                {isFloor && (
                  <div className="rounded-lg border p-3">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={design.hasTopping} onChange={(e) => set('hasTopping', e.target.checked)} />
                      Composite cast-in-place topping
                    </label>
                    {design.hasTopping && (
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <NumberField label="Width" value={design.toppingWidth} onChange={(v) => set('toppingWidth', v)} suffix="in" />
                        <NumberField label="Thickness" value={design.toppingThickness} onChange={(v) => set('toppingThickness', v)} suffix="in" />
                        <NumberField label="f′c" value={design.toppingFc} onChange={(v) => set('toppingFc', v)} suffix="ksi" />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Materials, span &amp; loads</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <NumberField label="f′c" value={design.fc} onChange={(v) => set('fc', v)} suffix="ksi" positive />
            <NumberField label="f′ci (transfer)" value={design.fci} onChange={(v) => set('fci', v)} suffix="ksi" positive />
            <NumberField label="Unit weight wc" value={design.wc} onChange={(v) => set('wc', v)} suffix="pcf" positive />
            <NumberField label="λ (lightweight)" value={design.lambda} onChange={(v) => set('lambda', v)} positive />
            <NumberField label="Span L" value={design.L} onChange={(v) => set('L', v)} suffix="ft" positive />
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
                  <Select
                    className="max-w-[60%]"
                    aria-label={`Layer ${i + 1} reinforcement type`}
                    value={r.kind}
                    onChange={(e) => updateLayer(i, { kind: e.target.value as ReinfRow['kind'] })}
                  >
                    <option value="mild">Mild bar</option>
                    <option value="strand">Strand</option>
                  </Select>
                  <Button size="icon" variant="ghost" aria-label={`Remove layer ${i + 1}`} onClick={() => removeLayer(i)}>
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SelectField label="Grade" value={r.gradeId} onChange={(v) => updateLayer(i, { gradeId: v })}>
                    {gradeOptions.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </SelectField>
                  <NumberField label="Area" value={r.area} onChange={(v) => updateLayer(i, { area: v })} suffix="in²" positive />
                  <NumberField label="Depth d" value={r.depth} onChange={(v) => updateLayer(i, { depth: v })} suffix="in" positive />
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
            {isPM && (
              <>
                <NumberField label="Axial Pu (factored)" value={design.axialPu} onChange={(v) => set('axialPu', v)} suffix="kip" />
                <SelectField label="Confinement" value={design.tie} onChange={(v) => set('tie', v as MemberDesignInput['tie'])}>
                  <option value="tied">Tied</option>
                  <option value="spiral">Spiral</option>
                </SelectField>
              </>
            )}
            {isWall && (
              <NumberField label="Handling impact ×" value={design.handlingImpact} onChange={(v) => set('handlingImpact', v)} />
            )}
            <SelectField label="Service class" value={design.serviceClass} onChange={(v) => set('serviceClass', v as 'U' | 'T')}>
              <option value="U">Class U (uncracked)</option>
              <option value="T">Class T (transition)</option>
            </SelectField>
            <SelectField label="Strand type" value={design.strandType} onChange={(v) => set('strandType', v as MemberDesignInput['strandType'])}>
              <option value="270LR">270 low-relax</option>
              <option value="250LR">250 low-relax</option>
              <option value="270SR">270 stress-rel</option>
              <option value="250SR">250 stress-rel</option>
            </SelectField>
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

            <MemberForceDiagrams
              lengthFt={design.L}
              E={analysis.value.properties.Ec}
              A={analysis.value.properties.A}
              I={analysis.value.properties.Ig}
              w={analysis.value.properties.wSelf + (design.superDead + design.live) / 12}
              loads={{
                dead: analysis.value.properties.wSelf + design.superDead / 12,
                live: design.live / 12,
              }}
              stress={
                analysis.value.stresses
                  ? {
                      props: {
                        A: analysis.value.properties.A,
                        Ig: analysis.value.properties.Ig,
                        yt: analysis.value.properties.yt,
                        yb: analysis.value.properties.yb,
                      },
                      Pi: analysis.value.prestress.Pi,
                      Pe: analysis.value.prestress.Pe,
                      e: analysis.value.prestress.e,
                      transferRatio:
                        analysis.value.demands.Mtotal !== 0
                          ? analysis.value.demands.Mg / analysis.value.demands.Mtotal
                          : 0,
                      transferCompression: analysis.value.stresses.allowables.transferCompression,
                      transferTension: analysis.value.stresses.allowables.transferTension,
                      serviceCompression: analysis.value.stresses.allowables.serviceCompressionTotal,
                      serviceTension: analysis.value.stresses.allowables.serviceTension,
                    }
                  : undefined
              }
            />

            {analysis.value.composite && (
              <Card>
                <CardHeader>
                  <CardTitle>Composite topping (staged / transformed)</CardTitle>
                  <CardDescription>
                    Bare precast carries transfer + wet topping; composite section carries SDL + live.
                    Topping transformed by n = √(f′c,topping/f′c,precast). Interface shear per §16.4.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                  <Stat label="n (modular)" value={analysis.value.composite.props.n.toFixed(3)} />
                  <Stat label="Composite Ic" value={`${analysis.value.composite.props.I.toFixed(0)} in⁴`} />
                  <Stat label="Depth H" value={`${analysis.value.composite.props.H.toFixed(1)} in`} />
                  <Stat label="Precast bottom" value={`${analysis.value.composite.stresses.precastBottom.toFixed(3)} ksi`} />
                  <Stat label="Topping top" value={`${analysis.value.composite.stresses.toppingTop.toFixed(3)} ksi`} />
                  <Stat label="Interface φVnh" value={`${analysis.value.composite.interface.phiVnh.toFixed(1)} kip`} />
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Steel stress-strain (power formula)</CardTitle>
                <CardDescription>Devalapura–Tadros curves for all grades; current operating points overlaid.</CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center">
                <StressStrainChart result={analysis.value.flexure} />
              </CardContent>
            </Card>

            {!isPM && (
              <Card>
                <CardHeader>
                  <CardTitle>Moment–curvature (fiber section)</CardTitle>
                  <CardDescription>
                    OpenSees-WASM fiber analysis of the actual section geometry; closed-form Mₙ and cracking
                    moment overlaid for cross-check, with equivalent-yield ductility μ = φu/φy.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex justify-center">
                  {momentCurvature.status === 'ready' && momentCurvature.result ? (
                    <MomentCurvatureChart
                      result={momentCurvature.result}
                      closedFormMn={analysis.ok ? analysis.value.flexure.Mn : undefined}
                      crackingMoment={analysis.ok ? analysis.value.flexure.cracking.Mcr : undefined}
                    />
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                      {momentCurvature.status === 'loading' ? (
                        <>
                          <Spinner /> Computing moment–curvature…
                        </>
                      ) : momentCurvature.status === 'idle' ? (
                        'Add reinforcement to trace the moment–curvature response.'
                      ) : (
                        'Moment–curvature unavailable (FEA engine not loaded).'
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {pm && (
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <div>
                    <CardTitle>Column interaction (φP–φMₙ)</CardTitle>
                    <CardDescription>
                      Axial-extended biaxial sweep (ΣF = N); φ per §21.2.2, cap 0.80/0.85·φ·Po (§22.4.2.1).
                    </CardDescription>
                  </div>
                  {pmCheck && (
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={
                          'rounded-full px-2.5 py-1 text-xs font-semibold ' +
                          (pmCheck.pass ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-destructive/15 text-destructive')
                        }
                      >
                        {pmCheck.pass ? 'P-M PASS' : 'P-M FAIL'} · φMn@Pu = {pmCheck.capM.toFixed(0)} kip-ft
                      </span>
                      <UtilizationGauge
                        className="w-40"
                        utilization={pmCheck.capM > 0 ? pmCheck.Mu / pmCheck.capM : NaN}
                        status={pmCheck.pass ? 'pass' : 'fail'}
                      />
                    </div>
                  )}
                </CardHeader>
                <CardContent className="flex justify-center">
                  <PMDiagram result={pm} demand={pmCheck ? { M: pmCheck.Mu, P: pmCheck.Pu, pass: pmCheck.pass } : undefined} />
                </CardContent>
              </Card>
            )}

            {handling && (
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <div>
                    <CardTitle>Handling / stripping</CardTitle>
                    <CardDescription>
                      Two-point symmetric pickup (a = {handling.a.toFixed(1)} in); f = M_strip/S ≤ fr = 7.5λ√f′ci (§19.2.3 / PCI).
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={
                        'rounded-full px-2.5 py-1 text-xs font-semibold ' +
                        (handling.check.status === 'pass' ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-destructive/15 text-destructive')
                      }
                    >
                      {handling.check.status === 'pass' ? 'HANDLING PASS' : 'HANDLING FAIL'}
                    </span>
                    <UtilizationGauge className="w-40" utilization={handling.check.utilization} status={handling.check.status} />
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2 text-sm">
                  <Stat label="Stripping M" value={`${(handling.Mgov / 12).toFixed(1)} kip-ft`} />
                  <Stat label="Tensile f" value={`${handling.stress.toFixed(3)} ksi`} />
                  <Stat label="fr allow." value={`${handling.allowable.toFixed(3)} ksi`} />
                </CardContent>
              </Card>
            )}

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
            <CardContent className="py-8 text-sm text-destructive" role="alert">
              Analysis error: {analysis.error}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
