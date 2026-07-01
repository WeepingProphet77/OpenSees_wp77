/**
 * Resolve where the Emscripten FEA glue module and its sibling `.wasm` live at
 * runtime. The worker is handed the FULL module URL (e.g.
 * `/OpenSees_wp77/fea/feaEngine.mjs`) and imports it directly; the `.wasm` is
 * located in the same directory. Kept tiny and dependency-free so both the
 * worker and a unit test can use it.
 *
 * (Regression guard: an earlier version passed only the module's *directory* and
 * the worker re-appended `fea/`, producing `…/fea/fea/feaEngine.mjs` → 404 →
 * "FEA engine unavailable" on the deployed site. Never reconstruct the path from
 * fragments — import the exact URL.)
 *
 * A cache-busting query on the glue URL (`…/feaEngine.mjs?v=<sha>`) is carried
 * onto the sibling `.wasm` so both are fetched as a matched pair after a redeploy.
 */
export function resolveFeaModuleUrls(moduleUrl: string): {
  glueUrl: string;
  locateFile: (path: string) => string;
} {
  const q = moduleUrl.indexOf('?');
  const query = q >= 0 ? moduleUrl.slice(q) : '';
  const pathPart = q >= 0 ? moduleUrl.slice(0, q) : moduleUrl;
  const dir = pathPart.slice(0, pathPart.lastIndexOf('/') + 1);
  return { glueUrl: moduleUrl, locateFile: (path: string) => `${dir}${path}${query}` };
}
