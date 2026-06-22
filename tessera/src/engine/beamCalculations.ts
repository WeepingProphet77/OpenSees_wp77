/**
 * Prestressed / Reinforced Concrete Beam Strength Calculator
 * Based on ACI 318 provisions and the Devalapura-Tadros (PCI) power formula.
 *
 * All units: ksi (stress), in (length), in² (area), kip (force), kip-in (moment)
 *
 * Ported to TypeScript from `prestressed_beam_power` (src/utils/beamCalculations.js),
 * preserving the numeric algorithm verbatim. Only types and a few null-safe
 * destructuring defaults (which do not change results for well-formed inputs)
 * have been added.
 */
import type {
  LayerResult,
  Point,
  PolygonFullProps,
  PolySpec,
  PowerFormulaSteel,
  Section,
  SectionProps,
  SteelLayer,
} from './types';

// ─── ACI 318 helpers ────────────────────────────────────────────────────────

/**
 * Whitney stress-block depth factor β₁ per ACI 318-19 §22.2.2.4.3
 */
export function beta1(fc: number): number {
  if (fc <= 4) return 0.85;
  if (fc >= 8) return 0.65;
  return 0.85 - 0.05 * (fc - 4);
}

/**
 * True for section types defined by an outer polygon ring + optional hole rings
 * (the interactively drawn "custom" section and the DXF-imported "dxf" section).
 * Both share the same { points, holes } geometry and analysis path; only the
 * input method and display label differ.
 */
export function isPolygonSection(section: Section | null | undefined): boolean {
  return section?.sectionType === 'custom' || section?.sectionType === 'dxf';
}

/**
 * Concrete modulus of elasticity for normalweight concrete per ACI 318-19
 * §19.2.2.1(b):  Ec = 57000·√f'c  (psi).  Returns ksi.
 */
export function concreteModulus(fc: number): number {
  return 57 * Math.sqrt(fc * 1000); // 57000·√(f'c_psi) / 1000  →  ksi
}

/**
 * Strength reduction factor φ per ACI 318-19 §21.2
 * Based on net tensile strain in the extreme tension steel layer.
 * εty = fpy / Es  (yield strain of outermost tension steel)
 */
export function phiFactor(epsilonT: number, epsilonTy: number): number {
  if (epsilonT >= epsilonTy + 0.003) return 0.9;
  if (epsilonT <= epsilonTy) return 0.65;
  return 0.65 + (0.25 * (epsilonT - epsilonTy)) / 0.003;
}

// ─── Power formula ──────────────────────────────────────────────────────────

/**
 * Devalapura-Tadros / PCI power formula for steel stress.
 *
 *   fs = Es·εs · [ Q + (1 − Q) / [1 + (Es·εs / (K·fpy))^R ]^(1/R) ]
 *
 * The result is capped at:
 *   - fpy (yield) for mild steel (Grade 60, 65, 70)
 *   - fpu (ultimate) for prestressing steel (Gr. 150, 250, 270)
 * This is controlled by the steel.stressCap property.
 *
 * @param epsilonS  total steel strain (positive = tension)
 * @param steel     { Es, fpu, fpy, Q, R, K, stressCap }
 * @returns steel stress (ksi), same sign convention as strain
 */
export function powerFormulaStress(epsilonS: number, steel: PowerFormulaSteel): number {
  const { Es, fpy, Q, R, K } = steel;
  // stressCap: fpy for mild steel, fpu for prestressing steel
  const cap = steel.stressCap ?? steel.fpu;

  if (Math.abs(epsilonS) < 1e-12) return 0;

  const absEps = Math.abs(epsilonS);
  const EsEps = Es * absEps;
  const ratio = EsEps / (K * fpy);
  const ratioR = Math.pow(ratio, R);
  const bracket = Math.pow(1 + ratioR, 1 / R);
  const fs = EsEps * (Q + (1 - Q) / bracket);

  // Cap at yield for mild steel, at ultimate for prestressing steel
  const fsCapped = Math.min(fs, cap);

  return epsilonS >= 0 ? fsCapped : -fsCapped;
}

/**
 * Generate stress-strain curve data points for a given steel type.
 */
export function generateStressStrainCurve(
  steel: PowerFormulaSteel,
  numPoints = 200,
): Array<{ strain: number; stress: number }> {
  const maxStrain = (steel.fpu / steel.Es) * 3; // go well past yield
  const points: Array<{ strain: number; stress: number }> = [];
  for (let i = 0; i <= numPoints; i++) {
    const eps = (i / numPoints) * maxStrain;
    const fs = powerFormulaStress(eps, steel);
    points.push({ strain: eps, stress: fs });
  }
  return points;
}

// ─── Strain compatibility ───────────────────────────────────────────────────

/**
 * Total steel strain at layer i using strain compatibility:
 *
 *   εsi = εcu · (di / c − 1)   (flexural strain at the steel level)
 *       + fse / Es             (effective prestrain, 0 for mild steel)
 *       + εdecomp              (concrete decompression strain at the steel level)
 *
 * εcu = 0.003 per ACI 318.
 */
export function steelStrain(
  di: number,
  c: number,
  fse: number,
  Es: number,
  epsDecomp = 0,
): number {
  const ecu = 0.003;
  const eso = fse / Es; // initial prestrain
  return ecu * (di / c - 1) + eso + epsDecomp;
}

/**
 * Concrete decompression strain at each steel layer, for bonded prestressed
 * layers (fse > 0). Returns an array aligned with steelLayers; entries for
 * non-prestressed layers are 0.
 *
 *   f_ci = P/A + P·e_ps·y_i / Ig         (compression positive)
 * where y_i = d_i − ȳ_cg. The decompression strain is f_ci / Ec.
 */
export function decompressionStrains(
  steelLayers: SteelLayer[],
  sectionProps: SectionProps,
  fc: number,
): number[] {
  const { A, yCg, Ig } = sectionProps;
  const Ec = concreteModulus(fc);
  let P = 0;
  let PdMoment = 0;
  for (const l of steelLayers) {
    if (l.fse > 0) {
      const f = l.fse * l.area;
      P += f;
      PdMoment += f * l.depth;
    }
  }
  const yps = P > 0 ? PdMoment / P : yCg;
  const ePs = yps - yCg;
  return steelLayers.map((l) => {
    if (!(l.fse > 0) || !(Ig > 0) || !(A > 0)) return 0;
    const yi = l.depth - yCg;
    const fci = P / A + (P * ePs * yi) / Ig;
    return fci / Ec;
  });
}

// ─── Section analysis (rectangular / T-beam) ────────────────────────────────

/**
 * Concrete compression force for a rectangular, T-section, sandwich section,
 * double tee, hollow core, or polygon (custom/dxf) section.
 */
export function concreteCompression(
  fc: number,
  a: number,
  bf: number,
  bw: number,
  hf: number,
  section: Section | null = null,
): number {
  // Handle polygon sections (drawn "custom" or DXF-imported), with optional holes
  if (isPolygonSection(section)) {
    return 0.85 * fc * polygonAreaAboveDepth(section as Section, a);
  }

  // Handle sandwich section if section object is provided
  if (section && section.sectionType === 'sandwich') {
    const { bt = 0, ht = 0, hg = 0, bb = 0 } = section;
    if (a <= ht) {
      return 0.85 * fc * a * bt;
    } else if (a <= ht + hg) {
      return 0.85 * fc * ht * bt;
    } else {
      return 0.85 * fc * (ht * bt + (a - ht - hg) * bb);
    }
  }

  // Handle double tee section
  if (section && section.sectionType === 'doubletee') {
    const { numStems = 2, stemWidth = 0 } = section;
    if (a <= hf) {
      return 0.85 * fc * a * bf;
    }
    return 0.85 * fc * (hf * bf + (a - hf) * numStems * stemWidth);
  }

  // Handle hollow core section
  if (section && section.sectionType === 'hollowcore') {
    const { numVoids = 0, voidDiameter = 0, voidCenterDepth = 0 } = section;
    const grossArea = bf * a;

    // Calculate void area within stress block depth a
    let voidArea = 0;
    if (a > voidCenterDepth - voidDiameter / 2 && voidCenterDepth > 0) {
      // Voids intersect with stress block
      for (let i = 0; i < numVoids; i++) {
        const voidTop = voidCenterDepth - voidDiameter / 2;
        const voidBottom = voidCenterDepth + voidDiameter / 2;

        if (a <= voidTop) {
          // Stress block doesn't reach void
          continue;
        } else if (a >= voidBottom) {
          // Full void circle is within stress block
          voidArea += Math.PI * Math.pow(voidDiameter / 2, 2);
        } else {
          // Partial void intersection (circular segment)
          const r = voidDiameter / 2;
          const h = a - voidTop;
          // Use circular segment area formula
          const theta = 2 * Math.acos((r - h) / r);
          const segmentArea = ((r * r) / 2) * (theta - Math.sin(theta));
          voidArea += segmentArea;
        }
      }
    }

    const netArea = grossArea - voidArea;
    return 0.85 * fc * netArea;
  }

  // Handle T-beam and rectangular sections
  if (a <= hf) {
    return 0.85 * fc * a * bf;
  }
  return 0.85 * fc * (hf * bf + (a - hf) * bw);
}

/**
 * Centroid of the compression block from the extreme compression fiber.
 */
export function compressionCentroid(
  a: number,
  bf: number,
  bw: number,
  hf: number,
  section: Section | null = null,
): number {
  // Handle polygon sections (drawn "custom" or DXF-imported), with optional holes
  if (isPolygonSection(section)) {
    return polygonCentroidAboveDepth(section as Section, a);
  }

  // Handle sandwich section if section object is provided
  if (section && section.sectionType === 'sandwich') {
    const { bt = 0, ht = 0, hg = 0, bb = 0 } = section;
    if (a <= ht) {
      return a / 2;
    } else if (a <= ht + hg) {
      return ht / 2;
    } else {
      const topArea = ht * bt;
      const botArea = (a - ht - hg) * bb;
      const totalArea = topArea + botArea;
      return (topArea * (ht / 2) + botArea * (ht + hg + (a - ht - hg) / 2)) / totalArea;
    }
  }

  // Handle double tee section
  if (section && section.sectionType === 'doubletee') {
    const { numStems = 2, stemWidth = 0 } = section;
    if (a <= hf) {
      return a / 2;
    }
    const flangeArea = hf * bf;
    const stemArea = (a - hf) * numStems * stemWidth;
    const totalArea = flangeArea + stemArea;
    return (flangeArea * (hf / 2) + stemArea * (hf + (a - hf) / 2)) / totalArea;
  }

  // Handle hollow core section
  if (section && section.sectionType === 'hollowcore') {
    const { numVoids = 0, voidDiameter = 0, voidCenterDepth = 0 } = section;
    const grossArea = bf * a;
    const grossCentroid = a / 2;

    // Calculate void contribution
    let voidMoment = 0;
    let voidArea = 0;

    if (a > voidCenterDepth - voidDiameter / 2 && voidCenterDepth > 0) {
      for (let i = 0; i < numVoids; i++) {
        const voidTop = voidCenterDepth - voidDiameter / 2;
        const voidBottom = voidCenterDepth + voidDiameter / 2;

        if (a <= voidTop) {
          continue;
        } else if (a >= voidBottom) {
          // Full void circle
          const area = Math.PI * Math.pow(voidDiameter / 2, 2);
          voidArea += area;
          voidMoment += area * voidCenterDepth;
        } else {
          // Partial void intersection
          const r = voidDiameter / 2;
          const h = a - voidTop;
          const theta = 2 * Math.acos((r - h) / r);
          const segmentArea = ((r * r) / 2) * (theta - Math.sin(theta));
          // Centroid of circular segment from chord
          const yBar =
            (4 * r * Math.pow(Math.sin(theta / 2), 3)) / (3 * (theta - Math.sin(theta)));
          const segmentCentroid = voidTop + yBar;
          voidArea += segmentArea;
          voidMoment += segmentArea * segmentCentroid;
        }
      }
    }

    const netArea = grossArea - voidArea;
    if (netArea <= 0) return grossCentroid;
    return (grossArea * grossCentroid - voidMoment) / netArea;
  }

  // Handle T-beam and rectangular sections
  if (a <= hf) {
    return a / 2;
  }
  const flangeArea = hf * bf;
  const webArea = (a - hf) * bw;
  const totalArea = flangeArea + webArea;
  return (flangeArea * (hf / 2) + webArea * (hf + (a - hf) / 2)) / totalArea;
}

/** Result of a uniaxial flexural analysis. */
export interface BeamResult {
  c: number;
  a: number;
  beta1: number;
  Cc: number;
  ccCentroid: number;
  layerResults: LayerResult[];
  Mn: number;
  MnFt: number;
  phi: number;
  phiMn: number;
  phiMnFt: number;
  epsilonT: number;
  cOverD: number;
  fc: number;
  section: Section;
  converged: boolean;
  residual: number;
  demand: { MuFt: number; utilization: number; pass: boolean } | null;
  ductile: boolean;
  transition: boolean;
  cracking: CrackingResult;
}

/**
 * Main analysis: find neutral axis depth c by force equilibrium, then compute Mn.
 */
export function analyzeBeam(section: Section, steelLayers: SteelLayer[]): BeamResult {
  const { fc = 0, h = 0, bf = 0, bw = 0, hf = 0 } = section;
  const b1 = beta1(fc);

  // Concrete decompression strain at each layer (gross-section based, constant
  // through the bisection since it depends only on the effective prestress).
  const sectionProps = grossSectionProperties(section);
  const decomp = decompressionStrains(steelLayers, sectionProps, fc);

  // Bisection to find c where ΣF = 0
  // Compression is positive, tension in steel at bottom is positive
  let cLow = 0.01;
  let cHigh = h;
  let c = h / 2;
  const maxIter = 500;
  const tolerance = 1e-6;
  let residual = Infinity;

  for (let iter = 0; iter < maxIter; iter++) {
    c = (cLow + cHigh) / 2;
    const a = b1 * c;

    // Concrete compression
    const Cc = concreteCompression(fc, a, bf, bw, hf, section);

    // Steel forces (positive = tension)
    let totalSteelForce = 0;
    for (let i = 0; i < steelLayers.length; i++) {
      const layer = steelLayers[i];
      const eps = steelStrain(layer.depth, c, layer.fse, layer.steel.Es, decomp[i]);
      const fs = powerFormulaStress(eps, layer.steel);
      totalSteelForce += fs * layer.area;
    }

    // Equilibrium: Cc − totalSteelForce = 0  (compression balances tension)
    residual = Cc - totalSteelForce;

    if (Math.abs(residual) < tolerance) break;

    if (residual > 0) {
      // Too much compression → c is too large → reduce c
      cHigh = c;
    } else {
      // Too much tension → c is too small → increase c
      cLow = c;
    }
  }

  // Did the bisection actually find equilibrium within the bracket [0.01, h]?
  // A residual that is still large means no root was bracketed and the result
  // is unreliable.
  const converged = Math.abs(residual) < 1e-3;

  // Final results with converged c
  const a = b1 * c;
  const Cc = concreteCompression(fc, a, bf, bw, hf, section);
  const ccCentroid = compressionCentroid(a, bf, bw, hf, section);

  // Compute per-layer results
  const layerResults: LayerResult[] = steelLayers.map((layer, i) => {
    const eps = steelStrain(layer.depth, c, layer.fse, layer.steel.Es, decomp[i]);
    const fs = powerFormulaStress(eps, layer.steel);
    const force = fs * layer.area;
    return {
      ...layer,
      strain: eps,
      epsDecomp: decomp[i],
      stress: fs,
      force,
    };
  });

  // Nominal moment about the extreme compression fiber (top):
  //   Mn = Σ(steel force × depth) − Cc × (compression-block centroid)
  let Mn = 0;
  for (const lr of layerResults) {
    Mn += lr.force * lr.depth;
  }
  Mn -= Cc * ccCentroid;

  // Net tensile strain in outermost tension steel (for φ factor)
  let maxDepth = 0;
  let extremeTensionLayer: LayerResult | null = null;
  for (const lr of layerResults) {
    if (lr.depth > maxDepth) {
      maxDepth = lr.depth;
      extremeTensionLayer = lr;
    }
  }

  const epsilonT = extremeTensionLayer ? extremeTensionLayer.strain : 0;
  const epsilonTy = extremeTensionLayer
    ? extremeTensionLayer.steel.fpy / extremeTensionLayer.steel.Es
    : 0.002;

  const phi = phiFactor(epsilonT, epsilonTy);
  const phiMn = phi * Mn;

  // c/d ratio for ductility check
  const dt = maxDepth || 1;
  const cOverD = c / dt;

  // Prestress & cracking analysis. Mu (factored demand) is optional and, when
  // supplied, enables the ACI 318-19 §9.6.1.3 1.33·Mu exception.
  const MuIn = (section.Mu || 0) * 12; // kip-ft → kip-in
  const cracking = prestressAndCracking(section, steelLayers, phiMn, MuIn);

  // Factored-demand utilization (only meaningful when a demand is provided).
  const MuFt = section.Mu || 0;
  const demand =
    MuFt > 0
      ? { MuFt, utilization: (MuFt * 12) / phiMn, pass: phiMn >= MuFt * 12 }
      : null;

  return {
    c,
    a,
    beta1: b1,
    Cc,
    ccCentroid,
    layerResults,
    Mn, // kip-in
    MnFt: Mn / 12, // kip-ft
    phi,
    phiMn, // kip-in
    phiMnFt: phiMn / 12, // kip-ft
    epsilonT,
    cOverD,
    fc,
    section,
    converged,
    residual,
    demand,
    ductile: epsilonT >= epsilonTy + 0.003,
    transition: epsilonT >= epsilonTy && epsilonT < epsilonTy + 0.003,
    cracking,
  };
}

/**
 * Compute the decompression strain for prestressed layers.
 * This is the additional strain needed to decompress the concrete at the steel level.
 */
export function decompressionStrain(fse: number, Es: number): number {
  return fse / Es;
}

// ─── Custom polygon geometry ─────────────────────────────────────────────────

/**
 * Signed area of a single ring via the shoelace formula.
 */
function ringSignedArea(ring: Point[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/**
 * Area (magnitude), and area-weighted first/second moments of a single ring
 * about the global axes (y = 0). Returns { A, Ay, Iy0 }.
 */
function ringMoments(ring: Point[]): { A: number; Ay: number; Iy0: number } {
  let a2 = 0; // 2·signed area
  let cyNum = 0; // Σ (y_i + y_{i+1})·cross  → 6·signedArea·ȳ
  let iy0Num = 0; // Σ (y_i² + y_i y_{i+1} + y_{i+1}²)·cross → 12·signed Iy0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const cross = p.x * q.y - q.x * p.y;
    a2 += cross;
    cyNum += (p.y + q.y) * cross;
    iy0Num += (p.y * p.y + p.y * q.y + q.y * q.y) * cross;
  }
  const signedArea = a2 / 2;
  if (Math.abs(signedArea) < 1e-12) return { A: 0, Ay: 0, Iy0: 0 };
  const yBar = cyNum / (6 * signedArea);
  const A = Math.abs(signedArea);
  const Iy0 = Math.abs(iy0Num / 12);
  return { A, Ay: A * yBar, Iy0 };
}

/**
 * Clip a single ring to the half-plane y ≤ a (Sutherland–Hodgman).
 */
function clipRingBelow(ring: Point[], a: number): Point[] {
  const out: Point[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const cur = ring[i];
    const nxt = ring[(i + 1) % n];
    const curIn = cur.y <= a;
    const nxtIn = nxt.y <= a;
    if (curIn) out.push(cur);
    if (curIn !== nxtIn) {
      // Edge crosses y = a → add the intersection point.
      const t = (a - cur.y) / (nxt.y - cur.y);
      out.push({ x: cur.x + t * (nxt.x - cur.x), y: a });
    }
  }
  return out;
}

/**
 * Build the list of rings for a custom section: outer first, then holes.
 */
function customRings(section: Section): { outer: Point[]; holes: Point[][] } {
  const outer = section.points || [];
  const holes = section.holes || [];
  return { outer, holes };
}

/**
 * Net concrete area of a custom section between y = 0 and y = a.
 */
export function polygonAreaAboveDepth(section: Section, a: number): number {
  const { outer, holes } = customRings(section);
  if (outer.length < 3) return 0;
  let area = Math.abs(ringSignedArea(clipRingBelow(outer, a)));
  for (const hole of holes) {
    if (hole.length < 3) continue;
    area -= Math.abs(ringSignedArea(clipRingBelow(hole, a)));
  }
  return Math.max(area, 0);
}

/**
 * Centroid (depth from top) of the net concrete area between y = 0 and y = a.
 */
export function polygonCentroidAboveDepth(section: Section, a: number): number {
  const { outer, holes } = customRings(section);
  if (outer.length < 3) return 0;
  let A = 0;
  let Ay = 0;
  const om = ringMoments(clipRingBelow(outer, a));
  A += om.A;
  Ay += om.Ay;
  for (const hole of holes) {
    if (hole.length < 3) continue;
    const hm = ringMoments(clipRingBelow(hole, a));
    A -= hm.A;
    Ay -= hm.Ay;
  }
  return A > 1e-12 ? Ay / A : 0;
}

/**
 * Full gross properties of a custom polygon (with holes).
 * Returns { A, yCg, Ig } with yCg measured from the top fiber (y = 0).
 */
export function polygonProperties(section: Section): { A: number; yCg: number; Ig: number } {
  const { outer, holes } = customRings(section);
  let A = 0;
  let Ay = 0;
  let Iy0 = 0; // ∫ y² dA about the y = 0 axis
  const om = ringMoments(outer);
  A += om.A;
  Ay += om.Ay;
  Iy0 += om.Iy0;
  for (const hole of holes) {
    if (hole.length < 3) continue;
    const hm = ringMoments(hole);
    A -= hm.A;
    Ay -= hm.Ay;
    Iy0 -= hm.Iy0;
  }
  const yCg = A > 1e-12 ? Ay / A : 0;
  // Parallel-axis shift from the y = 0 axis to the centroidal axis.
  const Ig = Iy0 - A * yCg * yCg;
  return { A, yCg, Ig };
}

// ─── Gross section properties ────────────────────────────────────────────────

/**
 * Compute gross cross-section properties for all supported section types.
 * Returns { A, yCg, Ig, yb, Sb }.
 */
export function grossSectionProperties(section: Section): SectionProps {
  const h = section.h ?? 0;

  let A: number;
  let yCg: number;
  let Ig: number;

  switch (section.sectionType) {
    case 'rectangular': {
      const b = section.bw ?? 0;
      A = b * h;
      yCg = h / 2;
      Ig = (b * Math.pow(h, 3)) / 12;
      break;
    }

    case 'tbeam': {
      const bf = section.bf ?? 0;
      const bw = section.bw ?? 0;
      const hf = section.hf ?? 0;
      const hw = h - hf;
      const flangeA = bf * hf;
      const webA = bw * hw;
      A = flangeA + webA;
      yCg = (flangeA * (hf / 2) + webA * (hf + hw / 2)) / A;
      const flangeI = (bf * Math.pow(hf, 3)) / 12 + flangeA * Math.pow(yCg - hf / 2, 2);
      const webI = (bw * Math.pow(hw, 3)) / 12 + webA * Math.pow(hf + hw / 2 - yCg, 2);
      Ig = flangeI + webI;
      break;
    }

    case 'sandwich': {
      const bt = section.bt ?? 0;
      const ht = section.ht ?? 0;
      const hg = section.hg ?? 0;
      const bb = section.bb ?? 0;
      const hb2 = h - ht - hg;
      const topA = bt * ht;
      const botA = bb * hb2;
      A = topA + botA;
      yCg = (topA * (ht / 2) + botA * (ht + hg + hb2 / 2)) / A;
      const topI = (bt * Math.pow(ht, 3)) / 12 + topA * Math.pow(yCg - ht / 2, 2);
      const botI = (bb * Math.pow(hb2, 3)) / 12 + botA * Math.pow(ht + hg + hb2 / 2 - yCg, 2);
      Ig = topI + botI;
      break;
    }

    case 'doubletee': {
      const bf = section.bf ?? 0;
      const hf = section.hf ?? 0;
      const numStems = section.numStems ?? 2;
      const stemWidth = section.stemWidth ?? 0;
      const hs = h - hf;
      const flangeA = bf * hf;
      const stemA = numStems * stemWidth * hs;
      A = flangeA + stemA;
      yCg = (flangeA * (hf / 2) + stemA * (hf + hs / 2)) / A;
      const flangeI = (bf * Math.pow(hf, 3)) / 12 + flangeA * Math.pow(yCg - hf / 2, 2);
      const stemI =
        (numStems * stemWidth * Math.pow(hs, 3)) / 12 + stemA * Math.pow(hf + hs / 2 - yCg, 2);
      Ig = flangeI + stemI;
      break;
    }

    case 'custom':
    case 'dxf': {
      const props = polygonProperties(section);
      A = props.A;
      yCg = props.yCg;
      Ig = props.Ig;
      break;
    }

    case 'hollowcore': {
      const bf = section.bf ?? 0;
      const numVoids = section.numVoids ?? 0;
      const voidDiameter = section.voidDiameter ?? 0;
      const voidCenterDepth = section.voidCenterDepth ?? 0;
      const r = voidDiameter / 2;
      const voidA = numVoids * Math.PI * r * r;
      A = bf * h - voidA;
      // Gross rectangle centroid is h/2; void centroids are at voidCenterDepth
      const grossMoment = bf * h * (h / 2);
      const voidMoment = voidA * voidCenterDepth;
      yCg = (grossMoment - voidMoment) / A;
      // Moment of inertia: gross rectangle minus voids (parallel axis theorem)
      const grossI = (bf * Math.pow(h, 3)) / 12 + bf * h * Math.pow(h / 2 - yCg, 2);
      const voidIself = (numVoids * (Math.PI * Math.pow(r, 4))) / 4;
      const voidIpar = voidA * Math.pow(voidCenterDepth - yCg, 2);
      Ig = grossI - voidIself - voidIpar;
      break;
    }

    default: {
      // Fallback to rectangular using bf × h
      const b = section.bf ?? section.bw ?? 0;
      A = b * h;
      yCg = h / 2;
      Ig = (b * Math.pow(h, 3)) / 12;
    }
  }

  const yb = h - yCg;
  const Sb = Ig / yb;

  return { A, yCg, Ig, yb, Sb };
}

/** Result of the prestress / cracking-moment / minimum-strength check. */
export interface CrackingResult {
  P: number;
  fpc: number;
  e: number;
  yps: number;
  fr: number;
  lambda: number;
  Mcr: number;
  McrFt: number;
  Mcr12: number;
  Mcr12Ft: number;
  Mu133: number;
  Mu133Ft: number;
  Mu: number;
  threshold: number;
  thresholdFt: number;
  governs: '1.2Mcr' | '1.33Mu';
  passesMinStrength: boolean;
  sectionProps: SectionProps;
}

/**
 * Compute prestress force, eccentricity, cracking moment, and the 1.2Mcr /
 * 1.33Mu minimum-strength check (ACI 318-19 §9.6.1.3).
 */
export function prestressAndCracking(
  section: Section,
  steelLayers: SteelLayer[],
  phiMn: number,
  Mu = 0,
): CrackingResult {
  const sectionProps = grossSectionProperties(section);
  const { A, yCg, Sb } = sectionProps;

  // Effective prestress force: only layers with fse > 0
  let P = 0;
  let PeMoment = 0; // Σ(fse_i × As_i × d_i)
  for (const layer of steelLayers) {
    if (layer.fse > 0) {
      const force = layer.fse * layer.area;
      P += force;
      PeMoment += force * layer.depth;
    }
  }

  // Eccentricity of prestress centroid from section centroid
  // e > 0 means prestress centroid is below section centroid (typical)
  const yps = P > 0 ? PeMoment / P : yCg;
  const e = yps - yCg;

  // Average precompressive stress
  const fpc = P / A;

  // Modulus of rupture: fr = 7.5·λ·√f'c (psi units) → convert to ksi
  const fc = section.fc ?? 0;
  const lambda = section.lambda ?? 1;
  const fr = (7.5 * lambda * Math.sqrt(fc * 1000)) / 1000; // ksi

  // Cracking moment: Mcr = Sb × (fr + P/A + P×e/Sb)
  const Mcr = Sb * (fr + P / A + (P * e) / Sb);
  const McrFt = Mcr / 12;

  // Minimum flexural strength, ACI 318-19 §9.6.1.3.
  const Mcr12 = 1.2 * Mcr;
  const Mu133 = 1.33 * Mu;
  const useMuRelief = Mu > 0 && Mu133 < Mcr12;
  const threshold = useMuRelief ? Mu133 : Mcr12;
  const thresholdFt = threshold / 12;
  const governs: '1.2Mcr' | '1.33Mu' = useMuRelief ? '1.33Mu' : '1.2Mcr';
  const passesMinStrength = phiMn >= threshold;

  return {
    P,
    fpc,
    e,
    yps,
    fr,
    lambda,
    Mcr,
    McrFt,
    Mcr12,
    Mcr12Ft: Mcr12 / 12,
    Mu133,
    Mu133Ft: Mu133 / 12,
    Mu,
    threshold,
    thresholdFt,
    governs,
    passesMinStrength,
    sectionProps,
  };
}

// ─── Biaxial bending ─────────────────────────────────────────────────────────

/**
 * Convert any supported section to polygon rings { outer, holes }.
 */
export function sectionToPolygon(section: Section): PolySpec {
  const { sectionType } = section;
  const h = section.h ?? 0;
  const rect = (x0: number, x1: number, y0: number, y1: number): Point[] => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  switch (sectionType) {
    case 'custom':
    case 'dxf':
      return { outer: section.points ?? [], holes: section.holes || [] };

    case 'rectangular': {
      const b = section.bw ?? 0;
      return { outer: rect(0, b, 0, h), holes: [] };
    }

    case 'tbeam': {
      const bf = section.bf ?? 0;
      const bw = section.bw ?? 0;
      const hf = section.hf ?? 0;
      const off = (bf - bw) / 2;
      return {
        outer: [
          { x: 0, y: 0 },
          { x: bf, y: 0 },
          { x: bf, y: hf },
          { x: off + bw, y: hf },
          { x: off + bw, y: h },
          { x: off, y: h },
          { x: off, y: hf },
          { x: 0, y: hf },
        ],
        holes: [],
      };
    }

    case 'sandwich': {
      const bt = section.bt ?? 0;
      const ht = section.ht ?? 0;
      const hg = section.hg ?? 0;
      const bb = section.bb ?? 0;
      const totW = Math.max(bt, bb);
      const topOff = (totW - bt) / 2;
      const botOff = (totW - bb) / 2;
      return {
        outer: rect(topOff, topOff + bt, 0, ht),
        holes: [],
        extra: [rect(botOff, botOff + bb, ht + hg, h)],
      };
    }

    case 'doubletee': {
      const bf = section.bf ?? 0;
      const hf = section.hf ?? 0;
      const numStems = section.numStems ?? 2;
      const stemWidth = section.stemWidth ?? 0;
      const spacing = bf / (numStems + 1);
      const ring: Point[] = [
        { x: 0, y: 0 },
        { x: bf, y: 0 },
        { x: bf, y: hf },
      ];
      for (let i = numStems - 1; i >= 0; i--) {
        const cxs = spacing * (i + 1);
        ring.push({ x: cxs + stemWidth / 2, y: hf });
        ring.push({ x: cxs + stemWidth / 2, y: h });
        ring.push({ x: cxs - stemWidth / 2, y: h });
        ring.push({ x: cxs - stemWidth / 2, y: hf });
      }
      ring.push({ x: 0, y: hf });
      return { outer: ring, holes: [] };
    }

    case 'hollowcore': {
      const bf = section.bf ?? 0;
      const numVoids = section.numVoids ?? 0;
      const voidDiameter = section.voidDiameter ?? 0;
      const voidCenterDepth = section.voidCenterDepth ?? 0;
      const r = voidDiameter / 2;
      const spacing = bf / (numVoids + 1);
      const holes: Point[][] = [];
      const SEG = 32;
      for (let i = 0; i < numVoids; i++) {
        const cxv = spacing * (i + 1);
        const ring: Point[] = [];
        for (let k = 0; k < SEG; k++) {
          const t = (k / SEG) * 2 * Math.PI;
          ring.push({ x: cxv + r * Math.cos(t), y: voidCenterDepth + r * Math.sin(t) });
        }
        holes.push(ring);
      }
      return { outer: rect(0, bf, 0, h), holes };
    }

    default: {
      const b = section.bf ?? section.bw ?? 0;
      return { outer: rect(0, b, 0, h), holes: [] };
    }
  }
}

// Flatten a polygon spec into an array of positive rings and an array of holes.
function ringsOf(polySpec: PolySpec): { positive: Point[][]; holes: Point[][] } {
  const positive = [polySpec.outer, ...(polySpec.extra || [])].filter((r) => r && r.length >= 3);
  const holes = (polySpec.holes || []).filter((r) => r && r.length >= 3);
  return { positive, holes };
}

interface RingIntegrals {
  A: number;
  Sx: number;
  Sy: number;
  Ix: number;
  Iy: number;
  Ixy: number;
}

// Shoelace integrals of a single ring, normalized to a positive (CCW) area.
function ringIntegrals(ring: Point[]): RingIntegrals {
  let A2 = 0;
  let Sx = 0;
  let Sy = 0;
  let Ix = 0;
  let Iy = 0;
  let Ixy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const cr = p.x * q.y - q.x * p.y;
    A2 += cr;
    Sx += (p.x + q.x) * cr;
    Sy += (p.y + q.y) * cr;
    Ix += (p.y * p.y + p.y * q.y + q.y * q.y) * cr;
    Iy += (p.x * p.x + p.x * q.x + q.x * q.x) * cr;
    Ixy += (p.x * q.y + 2 * p.x * p.y + 2 * q.x * q.y + q.x * p.y) * cr;
  }
  const signedA = A2 / 2;
  const s = signedA < 0 ? -1 : 1; // normalize to positive area
  return {
    A: Math.abs(signedA),
    Sx: (s * Sx) / 6,
    Sy: (s * Sy) / 6,
    Ix: (s * Ix) / 12,
    Iy: (s * Iy) / 12,
    Ixy: (s * Ixy) / 24,
  };
}

/**
 * Full gross section properties about the centroid for a polygon spec.
 */
export function polygonFullProperties(polySpec: PolySpec): PolygonFullProps {
  const { positive, holes } = ringsOf(polySpec);
  let A = 0;
  let Sx = 0;
  let Sy = 0;
  let Ix0 = 0;
  let Iy0 = 0;
  let Ixy0 = 0;
  const add = (ri: RingIntegrals, sign: number) => {
    A += sign * ri.A;
    Sx += sign * ri.Sx;
    Sy += sign * ri.Sy;
    Ix0 += sign * ri.Ix;
    Iy0 += sign * ri.Iy;
    Ixy0 += sign * ri.Ixy;
  };
  for (const r of positive) add(ringIntegrals(r), 1);
  for (const r of holes) add(ringIntegrals(r), -1);
  const xCg = A > 1e-12 ? Sx / A : 0;
  const yCg = A > 1e-12 ? Sy / A : 0;
  const Ix = Ix0 - A * yCg * yCg;
  const Iy = Iy0 - A * xCg * xCg;
  const Ixy = Ixy0 - A * xCg * yCg;
  const corners = positive.flatMap((r) => r.map((p) => ({ x: p.x - xCg, y: p.y - yCg })));
  return { A, xCg, yCg, Ix, Iy, Ixy, corners };
}

// Clip a ring to the half-plane proj·m >= threshold; return clipped ring.
function clipRingByLine(ring: Point[], m: Point, threshold: number): Point[] {
  const out: Point[] = [];
  const proj = (p: Point) => p.x * m.x + p.y * m.y;
  for (let i = 0; i < ring.length; i++) {
    const cur = ring[i];
    const nxt = ring[(i + 1) % ring.length];
    const dc = proj(cur) - threshold;
    const dn = proj(nxt) - threshold;
    if (dc >= 0) out.push(cur);
    if (dc >= 0 !== dn >= 0) {
      const t = dc / (dc - dn);
      out.push({ x: cur.x + t * (nxt.x - cur.x), y: cur.y + t * (nxt.y - cur.y) });
    }
  }
  return out;
}

// Net area + centroid of a polygon spec clipped to proj·m >= threshold.
function clippedAreaCentroid(
  polySpec: PolySpec,
  m: Point,
  threshold: number,
): { A: number; cx: number; cy: number } {
  const { positive, holes } = ringsOf(polySpec);
  let A = 0;
  let Sx = 0;
  let Sy = 0;
  const acc = (ring: Point[], sign: number) => {
    if (ring.length < 3) return;
    const ri = ringIntegrals(ring);
    A += sign * ri.A;
    Sx += sign * ri.Sx;
    Sy += sign * ri.Sy;
  };
  for (const r of positive) acc(clipRingByLine(r, m, threshold), 1);
  for (const r of holes) acc(clipRingByLine(r, m, threshold), -1);
  return { A, cx: A > 1e-12 ? Sx / A : 0, cy: A > 1e-12 ? Sy / A : 0 };
}

/** Result of a single neutral-axis orientation in the biaxial sweep. */
export interface BiaxialOrientationResult {
  phi: number;
  c: number;
  a: number;
  m: Point;
  Mx: number;
  My: number;
  phiMx: number;
  phiMy: number;
  phiF: number;
  epsT: number;
  /** Applied axial load this orientation was solved for (kip, tension +). */
  N: number;
  layerResults: LayerResult[];
}

/**
 * Solve flexural capacity for one neutral-axis orientation.
 * @param phi compression-normal direction angle (NA is perpendicular).
 * @param axialN applied axial load (kip, tension +); equilibrium is
 *   ΣF_internal = N (T − Cc = N). Default 0 reproduces the no-axial case.
 * Returns moments (kip-in) and φ-reduced moments about the centroid.
 */
export function biaxialAtOrientation(
  polySpec: PolySpec,
  steelLayers: SteelLayer[],
  props: PolygonFullProps,
  fc: number,
  phi: number,
  decomp: number[] | null = null,
  axialN = 0,
): BiaxialOrientationResult {
  const m = { x: Math.cos(phi), y: Math.sin(phi) };
  const projAll = polySpec.outer.concat(polySpec.extra ? polySpec.extra.flat() : []).map(
    (p) => p.x * m.x + p.y * m.y,
  );
  const projMax = Math.max(...projAll);
  const projMin = Math.min(...projAll);
  const b1 = beta1(fc);
  const depthOf = (p: Point) => projMax - (p.x * m.x + p.y * m.y);
  const decompOf = (i: number) => (decomp ? decomp[i] : 0);

  // Bisection on NA depth c for ΣF = N (T − Cc = N). The bracket extends past
  // the section depth (c up to depth/β₁·1.5) so the Whitney block can engage the
  // full section — needed to reach high axial compression on the P-M surface.
  let lo = 1e-4;
  let hi = ((projMax - projMin) / b1) * 1.5;
  let c = (lo + hi) / 2;
  for (let it = 0; it < 200; it++) {
    c = (lo + hi) / 2;
    const a = b1 * c;
    const Cc = 0.85 * fc * clippedAreaCentroid(polySpec, m, projMax - a).A;
    let T = 0;
    for (let i = 0; i < steelLayers.length; i++) {
      const s = steelLayers[i];
      const eps = steelStrain(depthOf({ x: s.x ?? 0, y: s.depth }), c, s.fse, s.steel.Es, decompOf(i));
      T += powerFormulaStress(eps, s.steel) * s.area;
    }
    const residual = T - Cc - axialN;
    if (Math.abs(residual) < 1e-6) break;
    if (residual > 0) lo = c;
    else hi = c;
  }

  const a = b1 * c;
  const cc = clippedAreaCentroid(polySpec, m, projMax - a);
  const Cc = 0.85 * fc * cc.A;
  let Mx = -Cc * (cc.cy - props.yCg);
  let My = -Cc * (cc.cx - props.xCg);
  let epsT = -Infinity;
  let epsTy = 0.002;
  const layerResults: LayerResult[] = [];
  for (let i = 0; i < steelLayers.length; i++) {
    const s = steelLayers[i];
    const sx = s.x ?? 0;
    const d = depthOf({ x: sx, y: s.depth });
    const eps = steelStrain(d, c, s.fse, s.steel.Es, decompOf(i));
    const fs = powerFormulaStress(eps, s.steel);
    const F = fs * s.area;
    Mx += F * (s.depth - props.yCg);
    My += F * (sx - props.xCg);
    layerResults.push({ ...s, strain: eps, stress: fs, force: F });
    if (eps > epsT) {
      epsT = eps;
      epsTy = s.steel.fpy / s.steel.Es;
    }
  }
  const phiF = phiFactor(epsT, epsTy);
  return {
    phi,
    c,
    a,
    m,
    Mx,
    My,
    phiMx: phiF * Mx,
    phiMy: phiF * My,
    phiF,
    epsT,
    N: axialN,
    layerResults,
  };
}

// Radius (capacity magnitude) of an envelope at a given demand angle.
function envelopeRadiusAtAngle(
  envelope: Array<{ phiMx: number; phiMy: number }>,
  angle: number,
): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = Infinity;
  for (let i = 0; i < envelope.length; i++) {
    const a = envelope[i];
    const b = envelope[(i + 1) % envelope.length];
    const ex = b.phiMx - a.phiMx;
    const ey = b.phiMy - a.phiMy;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const t = (a.phiMx * ey - a.phiMy * ex) / denom; // distance along ray
    const u = (a.phiMx * dy - a.phiMy * dx) / denom; // param along segment
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

/**
 * Concrete decompression strain at each layer for the biaxial (unsymmetric
 * bending) case. Returns an array aligned with steelLayers (0 for non-prestressed).
 */
export function biaxialDecompStrains(
  props: PolygonFullProps,
  steelLayers: SteelLayer[],
  fc: number,
): number[] {
  const { A, Ix, Iy, Ixy, xCg, yCg } = props;
  const det = Ix * Iy - Ixy * Ixy;
  const Ec = concreteModulus(fc);
  let P = 0;
  let Pex = 0;
  let Pey = 0;
  for (const s of steelLayers) {
    if (s.fse > 0) {
      const f = s.fse * s.area;
      P += f;
      Pex += f * ((s.x ?? 0) - xCg);
      Pey += f * (s.depth - yCg);
    }
  }
  const ex = P > 0 ? Pex / P : 0;
  const ey = P > 0 ? Pey / P : 0;
  const kx = (x: number, y: number) => (Iy * y - Ixy * x) / det;
  const ky = (x: number, y: number) => (Ix * x - Ixy * y) / det;
  return steelLayers.map((s) => {
    if (!(s.fse > 0) || !(A > 0) || Math.abs(det) < 1e-12) return 0;
    const x = (s.x ?? 0) - xCg;
    const y = s.depth - yCg;
    // Concrete compressive stress (compression positive) at the layer level.
    const comp = P / A + P * ey * kx(x, y) + P * ex * ky(x, y);
    return comp / Ec;
  });
}

/** Biaxial cracking interaction result. */
export interface BiaxialCrackingResult {
  P: number;
  ex: number;
  ey: number;
  fr: number;
  det: number;
  Mcr: { xPos: number | null; xNeg: number | null; yPos: number | null; yNeg: number | null };
  McrFt: { xPos: number | null; xNeg: number | null; yPos: number | null; yNeg: number | null };
  utilization: number;
  cracks: boolean;
  governing: Point | null;
  envelope: Array<{ Mx: number; My: number }>;
}

export function biaxialCracking(
  props: PolygonFullProps,
  steelLayers: SteelLayer[],
  fc: number,
  MxService: number,
  MyService: number,
  lambda = 1,
): BiaxialCrackingResult {
  const { A, Ix, Iy, Ixy, corners } = props;
  const det = Ix * Iy - Ixy * Ixy;
  const fr = (7.5 * lambda * Math.sqrt(fc * 1000)) / 1000;

  // Prestress force and centroidal eccentricity.
  let P = 0;
  let Pex = 0;
  let Pey = 0;
  for (const s of steelLayers) {
    if (s.fse > 0) {
      const f = s.fse * s.area;
      P += f;
      Pex += f * ((s.x ?? 0) - props.xCg);
      Pey += f * (s.depth - props.yCg);
    }
  }
  const ex = P > 0 ? Pex / P : 0;
  const ey = P > 0 ? Pey / P : 0;

  const kx = (x: number, y: number) => (Iy * y - Ixy * x) / det; // coefficient on Mx
  const ky = (x: number, y: number) => (Ix * x - Ixy * y) / det; // coefficient on My
  // Prestress contributes moments (-P*ey about x, -P*ex about y).
  const sigmaConst = (x: number, y: number) =>
    -P / A + -P * ey * kx(x, y) + -P * ex * ky(x, y);

  // Cracking when σ >= fr at any corner:  Mx*kx + My*ky >= fr - sigmaConst
  const constraints = corners
    .map(({ x, y }) => ({
      aMx: kx(x, y),
      aMy: ky(x, y),
      rhs: fr - sigmaConst(x, y),
      corner: { x, y },
    }))
    .filter((c) => c.rhs > 0); // ignore corners already in tension at service P only

  const intercept = (useX: boolean, sign: number): number | null => {
    // Largest |M| along one axis (other moment 0) before any corner cracks.
    let limit = Infinity;
    for (const c of constraints) {
      const a = useX ? c.aMx : c.aMy;
      if (sign * a > 1e-12) limit = Math.min(limit, c.rhs / (sign * a));
    }
    return Number.isFinite(limit) ? sign * limit : null;
  };

  const Mcr = {
    xPos: intercept(true, 1),
    xNeg: intercept(true, -1),
    yPos: intercept(false, 1),
    yNeg: intercept(false, -1),
  };

  // Service utilization: max over corners of (demand·a)/rhs.
  let U = 0;
  let governing: Point | null = null;
  const MxIn = MxService * 12;
  const MyIn = MyService * 12; // kip-ft -> kip-in
  for (const c of constraints) {
    const u = (MxIn * c.aMx + MyIn * c.aMy) / c.rhs;
    if (u > U) {
      U = u;
      governing = c.corner;
    }
  }

  // Sampled cracking-envelope boundary (kip-ft) for plotting.
  const SAMP = 180;
  const envelope: Array<{ Mx: number; My: number }> = [];
  for (let i = 0; i < SAMP; i++) {
    const ang = (i / SAMP) * 2 * Math.PI;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let maxRate = 0; // max over corners of (dir·a)/rhs per kip-in
    for (const c of constraints) {
      const rate = (dx * c.aMx + dy * c.aMy) / c.rhs;
      if (rate > maxRate) maxRate = rate;
    }
    const rIn = maxRate > 1e-12 ? 1 / maxRate : null;
    if (rIn != null) envelope.push({ Mx: (dx * rIn) / 12, My: (dy * rIn) / 12 });
  }

  return {
    P,
    ex,
    ey,
    fr,
    det,
    Mcr,
    McrFt: {
      xPos: Mcr.xPos != null ? Mcr.xPos / 12 : null,
      xNeg: Mcr.xNeg != null ? Mcr.xNeg / 12 : null,
      yPos: Mcr.yPos != null ? Mcr.yPos / 12 : null,
      yNeg: Mcr.yNeg != null ? Mcr.yNeg / 12 : null,
    },
    utilization: U,
    cracks: U > 1,
    governing,
    envelope,
  };
}

/** Top-level biaxial analysis options. */
export interface BiaxialOpts {
  Mux?: number;
  Muy?: number;
  MxService?: number;
  MyService?: number;
  samples?: number;
  /** Applied axial load (kip, tension +) for the P-M-M envelope at this N. */
  axialN?: number;
}

/** Top-level biaxial analysis result. */
export interface BiaxialResult {
  mode: 'biaxial';
  section: Section;
  props: PolygonFullProps;
  envelope: Array<{
    theta: number;
    phiMx: number;
    phiMy: number;
    Mx: number;
    My: number;
    phiF: number;
    c: number;
  }>;
  anchors: Record<
    'xSag' | 'xHog' | 'yPos' | 'yNeg',
    {
      phiMx: number;
      phiMy: number;
      Mx: number;
      My: number;
      phi: number;
      c: number;
      epsT: number;
      layerResults: LayerResult[];
    }
  >;
  demand: {
    Mux: number;
    Muy: number;
    angle: number;
    capacity: number;
    magnitude: number;
    utilization: number;
    pass: boolean;
  } | null;
  cracking: BiaxialCrackingResult;
  sectionPolygon: PolySpec;
  /** Applied axial load (kip, tension +) for this envelope. */
  axialN: number;
}

/**
 * Top-level biaxial analysis. Returns the strength envelope, on-axis (NA-aligned)
 * capacities φMnx/φMny, demand utilization, and the biaxial cracking check.
 */
export function analyzeBiaxial(
  section: Section,
  steelLayers: SteelLayer[],
  opts: BiaxialOpts = {},
): BiaxialResult {
  const { Mux = 0, Muy = 0, MxService = 0, MyService = 0, samples = 180, axialN = 0 } = opts;
  const polySpec = sectionToPolygon(section);
  const props = polygonFullProperties(polySpec);
  const fc = section.fc ?? 0;
  const lambda = section.lambda ?? 1;
  const decomp = biaxialDecompStrains(props, steelLayers, fc);

  // Sweep orientations -> envelope (kip-ft).
  const raw: BiaxialOrientationResult[] = [];
  for (let i = 0; i < samples; i++) {
    const phi = (i / samples) * 2 * Math.PI;
    const r = biaxialAtOrientation(polySpec, steelLayers, props, fc, phi, decomp, axialN);
    raw.push(r);
  }
  const envelope = raw.map((r) => ({
    theta: r.phi,
    phiMx: r.phiMx / 12,
    phiMy: r.phiMy / 12,
    Mx: r.Mx / 12,
    My: r.My / 12,
    phiF: r.phiF,
    c: r.c,
  }));

  // NA-aligned anchors (exact orientations).
  const anchor = (phi: number) => {
    const r = biaxialAtOrientation(polySpec, steelLayers, props, fc, phi, decomp, axialN);
    return {
      phiMx: r.phiMx / 12,
      phiMy: r.phiMy / 12,
      Mx: r.Mx / 12,
      My: r.My / 12,
      phi: r.phiF,
      c: r.c,
      epsT: r.epsT,
      layerResults: r.layerResults,
    };
  };
  const anchors = {
    xSag: anchor((3 * Math.PI) / 2),
    xHog: anchor(Math.PI / 2),
    yPos: anchor(0),
    yNeg: anchor(Math.PI),
  };

  // Demand utilization (radial).
  let demand: BiaxialResult['demand'] = null;
  if (Mux !== 0 || Muy !== 0) {
    const ang = Math.atan2(Muy, Mux);
    const cap = envelopeRadiusAtAngle(envelope, ang);
    const dem = Math.hypot(Mux, Muy);
    demand = {
      Mux,
      Muy,
      angle: ang,
      capacity: cap,
      magnitude: dem,
      utilization: Number.isFinite(cap) ? dem / cap : Infinity,
      pass: Number.isFinite(cap) && dem <= cap,
    };
  }

  const cracking = biaxialCracking(props, steelLayers, fc, MxService, MyService, lambda);

  return {
    mode: 'biaxial',
    section,
    props,
    envelope,
    anchors,
    demand,
    cracking,
    sectionPolygon: polySpec,
    axialN,
  };
}
