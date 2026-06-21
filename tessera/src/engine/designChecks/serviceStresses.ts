/**
 * Transfer & service flexural fiber-stress checks for prestressed members.
 * ACI 318-19 §24.5 (permissible stresses in prestressed flexural members).
 *
 * Sign convention: compression is POSITIVE. The section is uncracked and linear
 * elastic (gross section). For a fiber at distance y from the centroid, with the
 * prestress force P (compression) acting at eccentricity e (positive below the
 * centroid) and an applied sagging moment M (positive):
 *
 *   top fiber:    f_t = P/A − P·e·yt/Ig + M·yt/Ig
 *   bottom fiber: f_b = P/A + P·e·yb/Ig − M·yb/Ig
 *
 * where yt, yb are the (positive) distances from the centroid to the top
 * (compression) and bottom (tension) fibers.
 *
 * Stage 1 — immediately after transfer (§24.5.3): force = Pi, moment = Mg
 *   (member self-weight). Governing checks: bottom-fiber compression, top-fiber
 *   tension.
 * Stage 2 — service loads after all losses (§24.5.2): force = Pe.
 *   Governing checks: top-fiber compression (sustained 0.45 f'c, total 0.60 f'c)
 *   and bottom-fiber tension (Class U/T limit).
 *
 * All stresses in ksi.
 */
import { check, type DesignCheck } from './checkTypes';

export interface StressSectionProps {
  /** Gross area (in²). */
  A: number;
  /** Gross moment of inertia about the centroid (in⁴). */
  Ig: number;
  /** Distance centroid → top (compression) fiber (in). */
  yt: number;
  /** Distance centroid → bottom (tension) fiber (in). */
  yb: number;
}

export interface ServiceStressInput {
  props: StressSectionProps;
  /** f'c at service (ksi). */
  fc: number;
  /** f'ci at transfer (ksi). */
  fci: number;
  /** Lightweight factor λ (default 1). */
  lambda?: number;
  /** Use the relaxed end-region limits at transfer (default false). */
  endRegion?: boolean;
  /** Service tension class (default 'U'). */
  serviceClass?: 'U' | 'T';
  /** Prestress force at transfer (kip, compression +). */
  Pi: number;
  /** Effective prestress force after all losses (kip). */
  Pe: number;
  /** Eccentricity of prestress centroid below the section centroid (in). */
  e: number;
  /** Member self-weight moment at the section (kip-in). */
  Mg: number;
  /** Sustained-load moment at service (self-weight + superimposed dead) (kip-in). */
  Msustained: number;
  /** Total service-load moment (sustained + live) (kip-in). */
  Mtotal: number;
}

export interface FiberStresses {
  top: number;
  bottom: number;
}

export interface ServiceStressResult {
  transfer: FiberStresses;
  serviceSustained: FiberStresses;
  serviceTotal: FiberStresses;
  /** Allowable stress magnitudes (ksi) used, for reporting. */
  allowables: {
    transferCompression: number;
    transferTension: number;
    serviceCompressionSustained: number;
    serviceCompressionTotal: number;
    serviceTension: number;
  };
  checks: DesignCheck[];
}

/** √f'c in ksi from f'c in ksi, evaluated in psi (ACI convention). */
function sqrtFcKsi(fc: number): number {
  return Math.sqrt(fc * 1000) / 1000;
}

function fiberStresses(
  props: StressSectionProps,
  P: number,
  e: number,
  M: number,
): FiberStresses {
  const { A, Ig, yt, yb } = props;
  return {
    top: P / A - (P * e * yt) / Ig + (M * yt) / Ig,
    bottom: P / A + (P * e * yb) / Ig - (M * yb) / Ig,
  };
}

export function serviceStressChecks(input: ServiceStressInput): ServiceStressResult {
  const {
    props,
    fc,
    fci,
    lambda = 1,
    endRegion = false,
    serviceClass = 'U',
    Pi,
    Pe,
    e,
    Mg,
    Msustained,
    Mtotal,
  } = input;

  const transfer = fiberStresses(props, Pi, e, Mg);
  const serviceSustained = fiberStresses(props, Pe, e, Msustained);
  const serviceTotal = fiberStresses(props, Pe, e, Mtotal);

  // Allowable magnitudes (ksi).
  const transferCompression = (endRegion ? 0.7 : 0.6) * fci; // §24.5.3.1
  const transferTension = (endRegion ? 6 : 3) * lambda * sqrtFcKsi(fci); // §24.5.3.2
  const serviceCompressionSustained = 0.45 * fc; // §24.5.2.1
  const serviceCompressionTotal = 0.6 * fc; // §24.5.2.1
  const serviceTension = (serviceClass === 'T' ? 12 : 7.5) * lambda * sqrtFcKsi(fc); // Table 24.5.2.1

  // Tension magnitude = max(0, -stress) since compression is positive.
  const tension = (s: number) => Math.max(0, -s);
  const compression = (s: number) => Math.max(0, s);

  const checks: DesignCheck[] = [
    check({
      id: 'transfer-bottom-compression',
      label: 'Transfer — bottom fiber compression',
      clause: 'ACI 318-19 §24.5.3.1',
      formula: `f_b = Pi/A + Pi·e·yb/Ig − Mg·yb/Ig ≤ ${endRegion ? '0.70' : '0.60'}·f'ci`,
      demand: compression(transfer.bottom),
      capacity: transferCompression,
      unit: 'ksi',
    }),
    check({
      id: 'transfer-top-tension',
      label: 'Transfer — top fiber tension',
      clause: 'ACI 318-19 §24.5.3.2',
      formula: `f_t = Pi/A − Pi·e·yt/Ig + Mg·yt/Ig ≥ −${endRegion ? '6' : '3'}·λ·√f'ci`,
      demand: tension(transfer.top),
      capacity: transferTension,
      unit: 'ksi',
      note: 'If exceeded, ACI 318-19 §24.5.3.2.1 requires bonded reinforcement to resist the tensile force.',
    }),
    check({
      id: 'service-top-compression-sustained',
      label: 'Service — top fiber compression (sustained)',
      clause: 'ACI 318-19 §24.5.2.1',
      formula: "f_t (prestress + sustained load) ≤ 0.45·f'c",
      demand: compression(serviceSustained.top),
      capacity: serviceCompressionSustained,
      unit: 'ksi',
    }),
    check({
      id: 'service-top-compression-total',
      label: 'Service — top fiber compression (total)',
      clause: 'ACI 318-19 §24.5.2.1',
      formula: "f_t (prestress + total load) ≤ 0.60·f'c",
      demand: compression(serviceTotal.top),
      capacity: serviceCompressionTotal,
      unit: 'ksi',
    }),
    check({
      id: 'service-bottom-tension',
      label: `Service — bottom fiber tension (Class ${serviceClass})`,
      clause: 'ACI 318-19 §24.5.2.1 (Table 24.5.2.1)',
      formula: `f_b = Pe/A + Pe·e·yb/Ig − Mtotal·yb/Ig ≥ −${serviceClass === 'T' ? '12' : '7.5'}·λ·√f'c`,
      demand: tension(serviceTotal.bottom),
      capacity: serviceTension,
      unit: 'ksi',
      note:
        serviceClass === 'U'
          ? 'Class U: assumed uncracked (ft ≤ 7.5λ√f′c).'
          : 'Class T: transition (7.5λ√f′c < ft ≤ 12λ√f′c).',
    }),
  ];

  return {
    transfer,
    serviceSustained,
    serviceTotal,
    allowables: {
      transferCompression,
      transferTension,
      serviceCompressionSustained,
      serviceCompressionTotal,
      serviceTension,
    },
    checks,
  };
}
