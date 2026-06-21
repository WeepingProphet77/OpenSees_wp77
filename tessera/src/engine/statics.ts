/**
 * Simply-supported beam statics (Phase 1, v1).
 *
 * Superposition of uniform (full-span), point, and applied-moment loads on a
 * single simple span of length L (in). Sign convention: downward load positive;
 * sagging moment positive; shear positive = left part pushes the right part up.
 * Returns reactions and the shear/moment fields, plus the maximum sagging
 * moment by sampling.
 *
 * Continuous spans and the general support layout come with the FEA engine in a
 * later phase; this closed-form helper covers the single-member beam checks.
 */
export interface SpanLoad {
  /** Uniform load over the full span (kip/in). */
  w?: number;
  /** Point load (kip) at `position`. */
  P?: number;
  /** Applied concentrated moment (kip-in) at `position`. */
  M?: number;
  /** Location from the left support (in), for point/moment loads. */
  position?: number;
}

/** Left/right reactions (kip, upward positive). */
export function reactions(L: number, loads: SpanLoad[]): { Ra: number; Rb: number } {
  let Ra = 0;
  let Rb = 0;
  for (const ld of loads) {
    if (ld.w) {
      const W = ld.w * L;
      Ra += W / 2;
      Rb += W / 2;
    }
    if (ld.P) {
      const a = ld.position ?? L / 2;
      Ra += (ld.P * (L - a)) / L;
      Rb += (ld.P * a) / L;
    }
    if (ld.M) {
      // Applied CCW moment M0: Ra = -M0/L (down), Rb = +M0/L (up).
      Ra += -ld.M / L;
      Rb += ld.M / L;
    }
  }
  return { Ra, Rb };
}

export function shearAt(x: number, L: number, loads: SpanLoad[]): number {
  const { Ra } = reactions(L, loads);
  let V = Ra;
  for (const ld of loads) {
    if (ld.w) V -= ld.w * x;
    if (ld.P) {
      const a = ld.position ?? L / 2;
      if (x > a) V -= ld.P;
    }
  }
  return V;
}

export function momentAt(x: number, L: number, loads: SpanLoad[]): number {
  const { Ra } = reactions(L, loads);
  let M = Ra * x;
  for (const ld of loads) {
    if (ld.w) M -= (ld.w * x * x) / 2;
    if (ld.P) {
      const a = ld.position ?? L / 2;
      if (x > a) M -= ld.P * (x - a);
    }
    if (ld.M) {
      const a = ld.position ?? L / 2;
      if (x >= a) M += ld.M;
    }
  }
  return M;
}

export interface MaxMoment {
  M: number;
  x: number;
}

/** Maximum sagging moment over the span, found by sampling. */
export function maxMoment(L: number, loads: SpanLoad[], samples = 401): MaxMoment {
  let best: MaxMoment = { M: -Infinity, x: 0 };
  const consider = (x: number) => {
    if (x < 0 || x > L) return;
    const M = momentAt(x, L, loads);
    if (M > best.M) best = { M, x };
  };
  for (let i = 0; i <= samples; i++) consider((i / samples) * L);
  // Point/applied-moment loads produce sharp peaks at their location that the
  // uniform sample grid can step over — evaluate those points exactly.
  for (const ld of loads) {
    if ((ld.P || ld.M) && ld.position != null) consider(ld.position);
  }
  return best;
}

/** Maximum |shear|, which for downward gravity load occurs at the supports. */
export function maxShear(L: number, loads: SpanLoad[], samples = 401): number {
  let best = 0;
  for (let i = 0; i <= samples; i++) {
    const x = (i / samples) * L;
    best = Math.max(best, Math.abs(shearAt(x, L, loads)));
  }
  return best;
}

/** Mid-span moment of a single full-span uniform load: wL²/8. */
export function uniformMidspanMoment(w: number, L: number): number {
  return (w * L * L) / 8;
}
