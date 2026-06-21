/**
 * Prestress losses — the PCI/Zia approximate ("lump-sum") method
 * (Zia, Preston, Scott & Workman, "Estimating Prestress Losses," Concrete
 * International, 1979; PCI Design Handbook). This is the ratified v1 method
 * (build spec §6, §14). A refined time-step method is deferred.
 *
 * Total loss = ES + CR + SH + RE, producing the effective prestress fse = fpi − ΣΔ.
 *
 *   Elastic shortening:  ES = Kes·(Eps/Eci)·fcir,  Kes = 1.0 (pretensioned)
 *     fcir = Kcir·(Pi/A + Pi·e²/I) − Mg·e/I,        Kcir = 0.9 (pretensioned)
 *   Creep:               CR = Kcr·(Eps/Ec)·(fcir − fcds)
 *     Kcr = 2.0 (normalweight) | 1.6 (lightweight);  fcds = Msd·e/I
 *   Shrinkage:           SH = 8.2e-6·Ksh·Eps·(1 − 0.06·V/S)·(100 − RH)   [psi]
 *   Relaxation:          RE = [Kre − J·(SH + CR + ES)]·C                 [psi]
 *
 * Stresses are returned in ksi. The relaxation Kre/J coefficients and the C
 * factor are tabulated by strand type below and should be verified against the
 * owner's PCI edition; C can also be supplied directly.
 */
export type StrandType = '270LR' | '250LR' | '270SR' | '250SR';

/** Relaxation coefficients Kre (psi) and J by strand type (Zia et al., 1979). */
export const RELAXATION_COEFFS: Record<StrandType, { Kre: number; J: number; lowRelax: boolean }> = {
  '270LR': { Kre: 5000, J: 0.04, lowRelax: true },
  '250LR': { Kre: 4630, J: 0.037, lowRelax: true },
  '270SR': { Kre: 20000, J: 0.15, lowRelax: false },
  '250SR': { Kre: 18500, J: 0.14, lowRelax: false },
};

/**
 * Relaxation C-factor vs fpi/fpu (Zia et al., 1979). Two columns: low-relaxation
 * and stress-relieved strand. VERIFY against your PCI edition before production
 * use; `C` may be passed explicitly to bypass this table.
 */
const C_TABLE: Array<{ r: number; lr: number; sr: number }> = [
  { r: 0.8, lr: 1.28, sr: 1.45 },
  { r: 0.79, lr: 1.22, sr: 1.36 },
  { r: 0.78, lr: 1.16, sr: 1.27 },
  { r: 0.77, lr: 1.11, sr: 1.18 },
  { r: 0.76, lr: 1.05, sr: 1.09 },
  { r: 0.75, lr: 1.0, sr: 1.0 },
  { r: 0.74, lr: 0.95, sr: 0.94 },
  { r: 0.73, lr: 0.9, sr: 0.89 },
  { r: 0.72, lr: 0.85, sr: 0.84 },
  { r: 0.71, lr: 0.8, sr: 0.79 },
  { r: 0.7, lr: 0.75, sr: 0.75 },
  { r: 0.69, lr: 0.7, sr: 0.7 },
  { r: 0.68, lr: 0.66, sr: 0.66 },
  { r: 0.66, lr: 0.57, sr: 0.57 },
  { r: 0.64, lr: 0.49, sr: 0.49 },
  { r: 0.6, lr: 0.35, sr: 0.35 },
];

/** Linear interpolation of the C-factor for a given fpi/fpu and strand class. */
export function relaxationC(ratio: number, lowRelax: boolean): number {
  const col = (e: { lr: number; sr: number }) => (lowRelax ? e.lr : e.sr);
  const sorted = [...C_TABLE].sort((a, b) => a.r - b.r);
  if (ratio <= sorted[0].r) return col(sorted[0]);
  if (ratio >= sorted[sorted.length - 1].r) return col(sorted[sorted.length - 1]);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (ratio >= a.r && ratio <= b.r) {
      const t = (ratio - a.r) / (b.r - a.r);
      return col(a) + t * (col(b) - col(a));
    }
  }
  return col(sorted[sorted.length - 1]);
}

export interface LossInput {
  Eps: number; // strand modulus (ksi)
  Eci: number; // concrete modulus at transfer (ksi)
  Ec: number; // concrete modulus at service (ksi)
  fpu: number; // ultimate strand strength (ksi)
  /** Strand stress just before transfer, after seating/initial relaxation (ksi). */
  fpi: number;
  strandType?: StrandType; // default '270LR'
  A: number; // gross area (in²)
  I: number; // gross moment of inertia (in⁴)
  e: number; // eccentricity (in)
  Aps: number; // total strand area (in²)
  Mg: number; // self-weight moment at the section (kip-in)
  Msd?: number; // superimposed sustained dead moment (kip-in)
  VS: number; // volume-to-surface ratio (in)
  RH: number; // ambient relative humidity (%)
  lightweight?: boolean; // affects Kcr default
  // Optional coefficient overrides
  Kes?: number;
  Kcir?: number;
  Kcr?: number;
  Ksh?: number;
  C?: number;
}

export interface LossResult {
  Pi: number; // prestress force before transfer (kip)
  fcir: number; // concrete stress at strand cg at transfer (ksi)
  fcds: number; // concrete stress at strand cg from sustained superimposed dead (ksi)
  ES: number;
  CR: number;
  SH: number;
  RE: number;
  total: number; // total loss (ksi)
  fse: number; // effective prestress after all losses (ksi)
  C: number; // relaxation C-factor used
  note: string;
}

export function prestressLosses(input: LossInput): LossResult {
  const {
    Eps,
    Eci,
    Ec,
    fpu,
    fpi,
    strandType = '270LR',
    A,
    I,
    e,
    Aps,
    Mg,
    Msd = 0,
    VS,
    RH,
    lightweight = false,
    Kes = 1.0,
    Kcir = 0.9,
    Kcr = lightweight ? 1.6 : 2.0,
    Ksh = 1.0,
  } = input;

  const Pi = Aps * fpi; // kip

  // Concrete stress at the strand centroid at transfer (ksi).
  const fcir = Kcir * (Pi / A + (Pi * e * e) / I) - (Mg * e) / I;
  // Concrete stress at the strand centroid from sustained superimposed dead (ksi).
  const fcds = (Msd * e) / I;

  const ES = Kes * (Eps / Eci) * fcir; // ksi
  const CR = Kcr * (Eps / Ec) * (fcir - fcds); // ksi
  // Shrinkage in psi then to ksi.
  const SH_psi = 8.2e-6 * Ksh * (Eps * 1000) * (1 - 0.06 * VS) * (100 - RH);
  const SH = SH_psi / 1000; // ksi

  const { Kre, J, lowRelax } = RELAXATION_COEFFS[strandType];
  const C = input.C ?? relaxationC(fpi / fpu, lowRelax);
  // Relaxation in psi (Kre, J operate on psi-valued losses).
  const RE_psi = (Kre - J * ((SH + CR + ES) * 1000)) * C;
  const RE = Math.max(0, RE_psi) / 1000; // ksi (relaxation cannot be negative)

  const total = ES + CR + SH + RE;
  const fse = fpi - total;

  return {
    Pi,
    fcir,
    fcds,
    ES,
    CR,
    SH,
    RE,
    total,
    fse,
    C,
    note:
      'PCI/Zia (1979) approximate method. Relaxation C-factor and Kre/J are tabulated ' +
      'by strand type — verify against your PCI edition; C may be supplied explicitly.',
  };
}
