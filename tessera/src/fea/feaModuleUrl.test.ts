import { describe, it, expect } from 'vitest';
import { resolveFeaModuleUrls } from './feaModuleUrl';

describe('resolveFeaModuleUrls', () => {
  it('imports the module URL verbatim — never re-appends a path segment', () => {
    // Deployed (GitHub Pages base) — the case that regressed to a double `fea/`.
    const { glueUrl, locateFile } = resolveFeaModuleUrls('/OpenSees_wp77/fea/feaEngine.mjs');
    expect(glueUrl).toBe('/OpenSees_wp77/fea/feaEngine.mjs');
    expect(glueUrl).not.toContain('/fea/fea/');
    expect(locateFile('feaEngine.wasm')).toBe('/OpenSees_wp77/fea/feaEngine.wasm');
    expect(locateFile('feaEngine.wasm')).not.toContain('/fea/fea/');
  });

  it('locates the .wasm as a sibling of the glue module (dev base)', () => {
    const { glueUrl, locateFile } = resolveFeaModuleUrls('/fea/feaEngine.mjs');
    expect(glueUrl).toBe('/fea/feaEngine.mjs');
    expect(locateFile('feaEngine.wasm')).toBe('/fea/feaEngine.wasm');
  });

  it('works with an absolute origin URL', () => {
    const { locateFile } = resolveFeaModuleUrls('https://host.dev/app/fea/feaEngine.mjs');
    expect(locateFile('feaEngine.wasm')).toBe('https://host.dev/app/fea/feaEngine.wasm');
  });

  it('propagates a cache-busting query onto the sibling .wasm', () => {
    const { glueUrl, locateFile } = resolveFeaModuleUrls('/OpenSees_wp77/fea/feaEngine.mjs?v=abc1234');
    // Glue is imported verbatim (query intact).
    expect(glueUrl).toBe('/OpenSees_wp77/fea/feaEngine.mjs?v=abc1234');
    // The .wasm gets the SAME query so glue+wasm are a matched pair, and the dir
    // is derived from the path (not the query) — no `/fea/fea/`.
    expect(locateFile('feaEngine.wasm')).toBe('/OpenSees_wp77/fea/feaEngine.wasm?v=abc1234');
    expect(locateFile('feaEngine.wasm')).not.toContain('/fea/fea/');
  });
});
