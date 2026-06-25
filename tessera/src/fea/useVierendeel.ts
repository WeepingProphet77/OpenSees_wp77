/**
 * React hook: build a Vierendeel panel's equivalent frame, solve it through the
 * FEA engine, and screen every member. Like the other FEA hooks it is additive —
 * a bad grid resolves to `invalid` and an unavailable engine to `unavailable`,
 * without throwing. Shares the app-lifetime worker-engine singleton.
 */
import { useEffect, useState } from 'react';
import { createWorkerFeaEngine, type FeaEngine } from './FeaEngine';
import { buildVierendeelFrame } from './feaBuilders';
import type { FeaModelInput, FeaResult } from './feaModel';
import {
  vierendeelLinesFromGrid,
  vierendeelMemberResults,
  vierendeelSummary,
  type VierendeelGrid,
  type VierendeelLines,
  type VierendeelMemberResult,
} from '@/engine/vierendeel';

let engineSingleton: FeaEngine | null = null;
function getEngine(): FeaEngine {
  if (!engineSingleton) engineSingleton = createWorkerFeaEngine();
  return engineSingleton;
}

export interface VierendeelInput {
  grid: VierendeelGrid;
  /** Young's modulus (ksi). */
  E: number;
  /** Concrete strength (ksi) for the member checks. */
  fc: number;
  /** Lightweight factor λ (default 1). */
  lambda?: number;
  /** Total in-plane lateral force at the top (kip). */
  lateralLoad?: number;
  /** Uniform gravity on chords (kip/in, positive magnitude). */
  gravity?: number;
  base?: 'fixed' | 'pinned';
}

export interface VierendeelState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'invalid';
  lines: VierendeelLines | null;
  model: FeaModelInput | null;
  result: FeaResult | null;
  members: VierendeelMemberResult[];
  summary: { maxUtilization: number; governing: VierendeelMemberResult | null };
  error?: string;
}

const EMPTY: VierendeelState = {
  status: 'idle',
  lines: null,
  model: null,
  result: null,
  members: [],
  summary: { maxUtilization: 0, governing: null },
};

export function useVierendeel(input: VierendeelInput | null): VierendeelState {
  const [state, setState] = useState<VierendeelState>(EMPTY);
  const key = input ? JSON.stringify(input) : '';

  useEffect(() => {
    if (!input) {
      setState(EMPTY);
      return;
    }
    // Geometry is synchronous — surface an invalid grid before touching the engine.
    let lines: VierendeelLines;
    let model: FeaModelInput;
    try {
      lines = vierendeelLinesFromGrid(input.grid);
      model = buildVierendeelFrame({
        verticals: lines.verticals,
        horizontals: lines.horizontals,
        thickness: input.grid.thickness,
        E: input.E,
        lateralLoad: input.lateralLoad,
        gravity: input.gravity,
        base: input.base,
      });
    } catch (e) {
      setState({ ...EMPTY, status: 'invalid', error: e instanceof Error ? e.message : String(e) });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', lines, model }));
    getEngine()
      .solve(model)
      .then((result) => {
        if (cancelled) return;
        if (!result.converged) {
          setState({ ...EMPTY, status: 'unavailable', lines, model, result, error: result.message });
          return;
        }
        const members = vierendeelMemberResults(model, result, { fc: input.fc, lambda: input.lambda });
        setState({ status: 'ready', lines, model, result, members, summary: vierendeelSummary(members) });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({ ...EMPTY, status: 'unavailable', lines, model, error: e instanceof Error ? e.message : String(e) });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
