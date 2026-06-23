/**
 * `FeaEngine` — the single decoupled interface between the Tessera app and the
 * OpenSees-lineage WebAssembly solver (build spec §2.1/§2.2). Everything the
 * app knows about finite-element analysis goes through this contract:
 * a validated model in, a validated result out, asynchronously.
 *
 * The app MUST remain fully usable for sectional design even if the engine is
 * unavailable (WASM failed to load, no Worker support, etc.) — callers should
 * treat `solve` rejection / `converged === false` as a non-fatal "FEA
 * unavailable" state, never as an app error.
 *
 * Two implementations are provided:
 *   - `createWorkerFeaEngine()` — production path: loads the WASM module inside
 *     a dedicated Web Worker so heavy solves never block the UI thread.
 *   - `createDirectFeaEngine()` — same module on the calling thread; used by
 *     tests (Node) and any non-Worker context.
 */
import {
  FeaResultSchema,
  normalizeFeaModel,
  type FeaModelInput,
  type FeaResult,
} from './feaModel';

export interface FeaEngine {
  /** Resolves once the WASM module is instantiated and ready to solve. */
  ready(): Promise<void>;
  /** Validate, solve, and return a parsed result. Rejects on invalid input or solver failure. */
  solve(model: FeaModelInput): Promise<FeaResult>;
  /** Release the underlying worker/module. */
  dispose(): void;
}

/** Minimal shape of the Emscripten module this engine drives. */
export interface FeaWasmModule {
  solve(model: unknown): unknown;
}

export type FeaModuleFactory = (opts?: {
  locateFile?: (path: string, scriptDirectory: string) => string;
}) => Promise<FeaWasmModule>;

/** Default runtime URL of the Emscripten glue (served from `public/fea`). */
export function defaultModuleUrl(): string {
  // import.meta.env.BASE_URL is Vite's configured `base` ('/OpenSees_wp77/' in prod).
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${base}fea/feaEngine.mjs`;
}

/**
 * Engine that runs the WASM module on the current thread (no Worker). Accepts a
 * module factory so callers control how/where the Emscripten glue is loaded
 * (dynamic import in the browser/tests, fs in Node). Lazily instantiates.
 */
export function createDirectFeaEngine(loadFactory: () => Promise<FeaModuleFactory>, opts?: {
  locateFile?: (path: string, scriptDirectory: string) => string;
}): FeaEngine {
  let modulePromise: Promise<FeaWasmModule> | null = null;

  const getModule = (): Promise<FeaWasmModule> => {
    if (!modulePromise) {
      modulePromise = loadFactory().then((factory) =>
        factory(opts?.locateFile ? { locateFile: opts.locateFile } : undefined),
      );
    }
    return modulePromise;
  };

  return {
    async ready() {
      await getModule();
    },
    async solve(model) {
      const normalized = normalizeFeaModel(model);
      const mod = await getModule();
      const raw = mod.solve(normalized);
      return FeaResultSchema.parse(raw);
    },
    dispose() {
      modulePromise = null;
    },
  };
}

// ---- Worker protocol --------------------------------------------------------

export type FeaWorkerRequest =
  | { type: 'init'; moduleUrl: string }
  | { type: 'solve'; id: number; model: unknown };

export type FeaWorkerResponse =
  | { type: 'ready' }
  | { type: 'result'; id: number; result: unknown }
  | { type: 'error'; id: number; error: string }
  | { type: 'initError'; error: string };

export interface WorkerFeaEngineOptions {
  /** Factory for the Worker; defaults to the Vite module-worker URL. */
  createWorker?: () => Worker;
  /** Runtime URL of the Emscripten glue; defaults to `defaultModuleUrl()`. */
  moduleUrl?: string;
}

/**
 * Production engine: hosts the WASM module in a dedicated module Worker. The
 * `.wasm` is lazy-loaded; until it resolves the app keeps working for sectional
 * design. Input is validated on the main thread (fast failure) before posting.
 */
export function createWorkerFeaEngine(options: WorkerFeaEngineOptions = {}): FeaEngine {
  const moduleUrl = options.moduleUrl ?? defaultModuleUrl();
  const worker =
    options.createWorker?.() ??
    new Worker(new URL('./feaWorker.ts', import.meta.url), { type: 'module' });

  let nextId = 1;
  const pending = new Map<number, { resolve: (r: FeaResult) => void; reject: (e: Error) => void }>();
  let readyResolve!: () => void;
  let readyReject!: (e: Error) => void;
  const readyPromise = new Promise<void>((res, rej) => {
    readyResolve = res;
    readyReject = rej;
  });

  worker.onmessage = (ev: MessageEvent<FeaWorkerResponse>) => {
    const msg = ev.data;
    switch (msg.type) {
      case 'ready':
        readyResolve();
        break;
      case 'initError':
        readyReject(new Error(msg.error));
        break;
      case 'result': {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          try {
            p.resolve(FeaResultSchema.parse(msg.result));
          } catch (e) {
            p.reject(e instanceof Error ? e : new Error(String(e)));
          }
        }
        break;
      }
      case 'error': {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p.reject(new Error(msg.error));
        }
        break;
      }
    }
  };
  worker.onerror = (ev) => {
    const err = new Error(`FEA worker error: ${ev.message}`);
    readyReject(err);
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };

  worker.postMessage({ type: 'init', moduleUrl } satisfies FeaWorkerRequest);

  return {
    ready: () => readyPromise,
    solve(model) {
      // Validate up front so bad input fails fast and never crosses the wire.
      const normalized = normalizeFeaModel(model);
      const id = nextId++;
      return new Promise<FeaResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'solve', id, model: normalized } satisfies FeaWorkerRequest);
      });
    },
    dispose() {
      worker.terminate();
      pending.clear();
    },
  };
}
