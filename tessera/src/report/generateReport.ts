/**
 * Member design calc-package PDF (build spec §10).
 *
 * Produces a clean, printable report: inputs, materials, a vector section
 * sketch, flexure & serviceability results, and the full ACI/PCI checks table
 * with clause + formula + demand/capacity/utilization/status. Built with jsPDF
 * (works in the browser; no server).
 */
import { jsPDF } from 'jspdf';
import type { MemberDesignInput } from '@/design/memberDesign';
import { buildEngineSection, designToInput } from '@/design/memberDesign';
import type { MemberAnalysis } from '@/engine/analyzeMember';
import { sectionToPolygon } from '@/engine/beamCalculations';
import { formatQuantity } from '@/units/units';
import { APP_NAME, APP_VERSION } from '@/appInfo';

const M = 54; // page margin (pt)
const PAGE_W = 612;
const PAGE_H = 792;

export function generateMemberReport(opts: {
  projectName: string;
  engineer?: string;
  design: MemberDesignInput;
  analysis: MemberAnalysis;
}): void {
  const { projectName, engineer, design, analysis } = opts;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  let y = M;

  const text = (s: string, x: number, opt?: { bold?: boolean; size?: number; color?: number }) => {
    doc.setFont('helvetica', opt?.bold ? 'bold' : 'normal');
    doc.setFontSize(opt?.size ?? 9);
    doc.setTextColor(opt?.color ?? 30);
    doc.text(s, x, y);
  };
  const rule = () => {
    doc.setDrawColor(210);
    doc.line(M, y, PAGE_W - M, y);
  };
  const newPageIfNeeded = (need = 24) => {
    if (y + need > PAGE_H - M) {
      doc.addPage();
      y = M;
    }
  };

  // ── Title block ──
  doc.setFillColor(15, 23, 42);
  doc.rect(M, y, PAGE_W - 2 * M, 40, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(`${APP_NAME} — Member Design Report`, M + 12, y + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('ACI 318-19 + PCI Design Handbook 8th Ed. · US customary (kip, in, ksi)', M + 12, y + 32);
  y += 56;

  text(`Project: ${projectName || '—'}`, M, { bold: true, size: 10 });
  text(`Member: ${design.name}`, PAGE_W / 2, { bold: true, size: 10 });
  y += 14;
  text(`Engineer: ${engineer || '—'}`, M);
  text(`Date: ${new Date().toLocaleDateString()}`, PAGE_W / 2);
  text(`v${APP_VERSION}`, PAGE_W - M - 30);
  y += 14;
  rule();
  y += 18;

  // ── Inputs + section sketch (two columns) ──
  const colR = PAGE_W / 2 + 10;
  const yStart = y;
  text('Section & Materials', M, { bold: true, size: 11 });
  y += 16;
  const geom =
    design.sectionType === 'tbeam'
      ? `T-beam: bf=${design.bf}", hf=${design.hf}", bw=${design.b}", h=${design.h}"`
      : design.sectionType === 'custom'
        ? `Custom polygon (${design.points?.length ?? 0} vertices)`
        : `Rectangular: b=${design.b}", h=${design.h}"`;
  const rows: [string, string][] = [
    ['Section', geom],
    ["f'c / f'ci", `${design.fc} / ${design.fci} ksi`],
    ['Unit wt / λ', `${design.wc} pcf / ${design.lambda}`],
    ['Span L', `${design.L} ft`],
    ['Loads (SD / L)', `${design.superDead} / ${design.live} klf`],
    ['Strands fpi', `${design.fpi} ksi (${design.strandType})`],
    ['Stirrups', `Av=${design.Av} in² @ ${design.stirrupSpacing}" (fyt=${design.fyt})`],
  ];
  for (const [k, v] of rows) {
    text(k, M, { color: 110 });
    text(v, M + 95, { bold: true });
    y += 13;
  }
  text('Reinforcement', M, { bold: true });
  y += 13;
  for (const r of design.layers) {
    text(`• ${r.kind === 'strand' ? 'Strand' : 'Bar'} ${r.gradeId}`, M, { color: 110 });
    text(`A=${r.area} in², d=${r.depth}"${r.kind === 'strand' ? `, fse=${r.fse} ksi` : ''}`, M + 95, { bold: true });
    y += 13;
  }

  // Section sketch in the right column.
  drawSection(doc, design, colR, yStart, PAGE_W - M - colR, 150);

  y = Math.max(y, yStart + 160);
  rule();
  y += 18;

  // ── Results ──
  text('Flexure (power formula, ACI 318-19 strain compatibility)', M, { bold: true, size: 11 });
  y += 16;
  const f = analysis.flexure;
  const resRows: [string, string][] = [
    ['φMn', `${formatQuantity(f.phiMnFt, 'kip-ft', 1)}  (φ=${f.phi.toFixed(2)})`],
    ['Mu (1.2D+1.6L)', formatQuantity(analysis.demands.Mu / 12, 'kip-ft', 1)],
    ['Neutral axis c / a', `${f.c.toFixed(2)} / ${f.a.toFixed(2)} in`],
    ['εt (net tensile)', `${f.epsilonT.toFixed(5)} (${f.ductile ? 'tension-ctrl' : f.transition ? 'transition' : 'comp-ctrl'})`],
    ['Mcr', formatQuantity(f.cracking.McrFt, 'kip-ft', 1)],
    ['Converged', f.converged ? 'yes' : 'NO'],
  ];
  twoColRows(resRows, M, () => y, (v) => (y = v), text);
  y += 4;
  text('Serviceability', M, { bold: true, size: 11 });
  y += 16;
  const c = analysis.camber;
  const svcRows: [string, string][] = [
    ['Camber (release)', formatQuantity(c.camberAtRelease, 'in', 3)],
    ['Camber (final)', formatQuantity(c.finalCamber, 'in', 3)],
    ['Live deflection', formatQuantity(c.liveDeflection, 'in', 3)],
  ];
  if (analysis.losses) svcRows.push(['fse (est.)', `${formatQuantity(analysis.losses.fse, 'ksi', 1)} (loss ${analysis.losses.total.toFixed(1)})`]);
  twoColRows(svcRows, M, () => y, (v) => (y = v), text);
  y += 6;
  rule();
  y += 18;

  // ── Checks table ──
  text('Code checks', M, { bold: true, size: 11 });
  y += 16;
  const cols = { name: M, demand: 318, cap: 396, util: 474, status: 528 };
  text('Check / clause', cols.name, { bold: true, color: 110 });
  text('Demand', cols.demand, { bold: true, color: 110 });
  text('Capacity', cols.cap, { bold: true, color: 110 });
  text('U', cols.util, { bold: true, color: 110 });
  text('Status', cols.status, { bold: true, color: 110 });
  y += 6;
  rule();
  y += 13;
  for (const ck of analysis.checks) {
    newPageIfNeeded(28);
    text(ck.label, cols.name);
    text(formatQuantity(ck.demand, ck.unit), cols.demand);
    text(formatQuantity(ck.capacity, ck.unit), cols.cap);
    text(Number.isFinite(ck.utilization) ? `${(ck.utilization * 100).toFixed(0)}%` : '—', cols.util);
    const ok = ck.status === 'pass';
    text(ok ? 'PASS' : 'FAIL', cols.status, { bold: true, color: ok ? 22 : 200 });
    if (!ok) {
      doc.setTextColor(200, 30, 30);
    }
    y += 11;
    text(`${ck.clause}  ·  ${ck.formula}`, cols.name + 8, { size: 7.5, color: 130 });
    y += 14;
  }

  newPageIfNeeded(40);
  y += 6;
  rule();
  y += 14;
  const gov = analysis.governing;
  text(
    `Governing: ${gov.check?.label ?? '—'} — utilization ${Number.isFinite(gov.utilization) ? (gov.utilization * 100).toFixed(0) + '%' : '—'} — ${gov.status === 'pass' ? 'ALL CHECKS PASS' : 'CHECK FAILS'}`,
    M,
    { bold: true, size: 10, color: gov.status === 'pass' ? 22 : 200 },
  );

  const slug = (design.name || 'member').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  doc.save(`${slug || 'member'}-report.pdf`);
}

function twoColRows(
  rowsArr: [string, string][],
  x: number,
  getY: () => number,
  setY: (v: number) => void,
  text: (s: string, x: number, opt?: { bold?: boolean; size?: number; color?: number }) => void,
): void {
  let y = getY();
  for (const [k, v] of rowsArr) {
    text(k, x, { color: 110 });
    text(v, x + 110, { bold: true });
    y += 13;
    setY(y);
  }
}

/** Draw a scaled vector sketch of the section + reinforcement into a box. */
function drawSection(doc: jsPDF, design: MemberDesignInput, bx: number, by: number, bw: number, bh: number): void {
  const section = buildEngineSection(design);
  const input = designToInput(design);
  const poly = sectionToPolygon(section);
  const positive = [poly.outer, ...(poly.extra ?? [])].filter((r) => r && r.length >= 3);
  const holes = poly.holes ?? [];
  const all = positive.flat().concat(holes.flat());
  if (all.length < 3) return;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const pad = 10;
  const scale = Math.min((bw - pad * 2) / w, (bh - pad * 2) / h);
  const ox = bx + pad;
  const oy = by + pad;
  const X = (x: number) => ox + (x - minX) * scale;
  const Y = (yy: number) => oy + (yy - minY) * scale;

  const drawRing = (r: typeof poly.outer, fill: [number, number, number] | null) => {
    doc.setDrawColor(60, 90, 160);
    doc.setLineWidth(1);
    if (fill) doc.setFillColor(...fill);
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      doc.line(X(a.x), Y(a.y), X(b.x), Y(b.y));
    }
  };
  for (const r of positive) drawRing(r, null);
  for (const r of holes) drawRing(r, null);

  const centerX = (minX + maxX) / 2;
  for (const l of input.layers) {
    const lx = l.x ?? centerX;
    if (l.fse > 0) doc.setFillColor(245, 158, 11);
    else doc.setFillColor(30, 41, 59);
    doc.circle(X(lx), Y(l.depth), 2.2, 'F');
  }
  doc.setFontSize(7);
  doc.setTextColor(130);
  doc.text('Section (in)', bx + 2, by + bh + 2);
}
