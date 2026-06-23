/**
 * React hook: run a single designed member through the FEA engine and return its
 * internal-force diagrams. The member is modeled as a simply-supported beam under
 * its (service) uniform load — `buildSimpleBeam` + the OpenSees WASM solver +
 * `computeMemberDiagrams`.
 *
 * Per the FeaEngine contract, FEA is strictly additive: if the engine can't load
 * (no Worker/WASM), the hook resolves to `unavailable` and the rest of the
 * member-design UI keeps working. The engine is a lazily-created, app-lifetime
 * singleton (a member solve is tiny, but it still runs off the UI thread).
 */
import { useEffect, useState } from 'react';
import { buildSimpleBeam } from './feaBuilders';
import { normalizeFeaModel } from './feaModel';
import {
  computeMemberDiagrams,
  summarizeReactions,
  type MemberDiagram,
  type SupportReaction,
} from './feaDiagrams';
import { createWorkerFeaEngine, type FeaEngine } from './FeaEngine';

let engineSingleton: FeaEngine | null = null;
function getEngine(): FeaEngine {
  if (!engineSingleton) engineSingleton = createWorkerFeaEngine();
  return engineSingleton;
}

export interface MemberBeam {
  /** Span (in). */
  lengthIn: number;
  /** Elastic modulus E (ksi). */
  E: number;
  /** Area (in²). */
  A: number;
  /** Moment of inertia (in⁴). */
  I: number;
  /** Total uniform service load, downward magnitude (kip/in). */
  w: number;
}

export interface MemberDiagramsState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  diagram: MemberDiagram | null;
  reactions: SupportReaction[];
  error?: string;
}

const valid = (b: MemberBeam) =>
  [b.lengthIn, b.E, b.A, b.I].every((v) => Number.isFinite(v) && v > 0) && Number.isFinite(b.w);

export function useMemberDiagrams(beam: MemberBeam): MemberDiagramsState {
  const [state, setState] = useState<MemberDiagramsState>({ status: 'idle', diagram: null, reactions: [] });
  const { lengthIn, E, A, I, w } = beam;

  useEffect(() => {
    if (!valid(beam)) {
      setState({ status: 'idle', diagram: null, reactions: [] });
      return;
    }
    let cancelled = false;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading', diagram: null, reactions: [] }));

    const input = buildSimpleBeam({ length: lengthIn, segments: 1, E, A, I, udl: w, support: 'simple' });
    const model = normalizeFeaModel(input);
    getEngine()
      .solve(input)
      .then((result) => {
        if (cancelled) return;
        const [diagram] = computeMemberDiagrams(model, result, { stations: 41 });
        setState({ status: 'ready', diagram: diagram ?? null, reactions: summarizeReactions(model, result) });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            status: 'unavailable',
            diagram: null,
            reactions: [],
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });

    return () => {
      cancelled = true;
    };
    // Re-solve whenever the beam's defining scalars change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lengthIn, E, A, I, w]);

  return state;
}
