/**
 * Dedicated Web Worker that hosts the OpenSees-lineage WASM FEA solver
 * (build spec §2.2 — "Drive it from a Web Worker; load the `.wasm`
 * asynchronously"). Keeps heavy solves off the UI thread.
 *
 * The Emscripten glue lives in `public/fea/feaEngine.mjs` (NOT bundled by Vite),
 * so it is imported dynamically at runtime from the app's base URL, with
 * `locateFile` pointed at the sibling `.wasm`. This is resilient to the GitHub
 * Pages base path (`/OpenSees_wp77/`).
 */
import type { FeaModuleFactory, FeaWasmModule, FeaWorkerRequest, FeaWorkerResponse } from './FeaEngine';
import { resolveFeaModuleUrls } from './feaModuleUrl';

let modulePromise: Promise<FeaWasmModule> | null = null;

function loadModule(moduleUrl: string): Promise<FeaWasmModule> {
  if (!modulePromise) {
    const { glueUrl, locateFile } = resolveFeaModuleUrls(moduleUrl);
    modulePromise = import(/* @vite-ignore */ glueUrl).then((mod: { default: FeaModuleFactory }) =>
      mod.default({ locateFile }),
    );
  }
  return modulePromise;
}

const post = (msg: FeaWorkerResponse) => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (ev: MessageEvent<FeaWorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    try {
      await loadModule(msg.moduleUrl);
      post({ type: 'ready' });
    } catch (e) {
      post({ type: 'initError', error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  if (msg.type === 'solve') {
    try {
      const mod = await modulePromise!;
      const result = mod.solve(msg.model);
      post({ type: 'result', id: msg.id, result });
    } catch (e) {
      post({ type: 'error', id: msg.id, error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  if (msg.type === 'momentCurvature') {
    try {
      const mod = await modulePromise!;
      const result = mod.momentCurvature(msg.spec);
      post({ type: 'result', id: msg.id, result });
    } catch (e) {
      post({ type: 'error', id: msg.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
};
