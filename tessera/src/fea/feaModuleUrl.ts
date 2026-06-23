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
 */
export function resolveFeaModuleUrls(moduleUrl: string): {
  glueUrl: string;
  locateFile: (path: string) => string;
} {
  const dir = moduleUrl.slice(0, moduleUrl.lastIndexOf('/') + 1);
  return { glueUrl: moduleUrl, locateFile: (path: string) => `${dir}${path}` };
}
