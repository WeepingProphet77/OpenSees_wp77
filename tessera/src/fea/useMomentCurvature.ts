/**
 * React hook: run a fiber-section moment–curvature analysis through the FEA
 * engine for a designed member's section. Like `useMemberDiagrams`, FEA is
 * strictly additive — if the engine can't load, the hook resolves to
 * `unavailable` and the rest of the member UI keeps working. Shares the
 * app-lifetime worker-engine singleton.
 */
import { useEffect, useState } from 'react';
import { createWorkerFeaEngine, type FeaEngine } from './FeaEngine';
import type { MomentCurvatureResult, MomentCurvatureSpecInput } from './feaModel';

let engineSingleton: FeaEngine | null = null;
function getEngine(): FeaEngine {
  if (!engineSingleton) engineSingleton = createWorkerFeaEngine();
  return engineSingleton;
}

export interface MomentCurvatureState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  result: MomentCurvatureResult | null;
  error?: string;
}

/**
 * Trace M–φ for `spec`. Pass `null` to stay idle (e.g. no reinforcement yet, or a
 * member type the curve doesn't apply to). The spec is re-solved whenever its
 * JSON content changes, so callers don't need to memoize a stable reference.
 */
export function useMomentCurvature(spec: MomentCurvatureSpecInput | null): MomentCurvatureState {
  const [state, setState] = useState<MomentCurvatureState>({ status: 'idle', result: null });
  const key = spec ? JSON.stringify(spec) : '';

  useEffect(() => {
    if (!spec) {
      setState({ status: 'idle', result: null });
      return;
    }
    let cancelled = false;
    setState((s) => (s.status === 'ready' ? s : { status: 'loading', result: null }));

    getEngine()
      .momentCurvature(spec)
      .then((result) => {
        if (!cancelled) setState({ status: 'ready', result });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            status: 'unavailable',
            result: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });

    return () => {
      cancelled = true;
    };
    // Re-solve on any content change; `key` captures the full spec.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
