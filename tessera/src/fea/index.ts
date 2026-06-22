/** Public surface of the Tessera FEA layer (build spec §2.1/§2.2). */
export * from './feaModel';
export * from './feaBuilders';
export * from './feaDiagrams';
export {
  createWorkerFeaEngine,
  createDirectFeaEngine,
  defaultModuleUrl,
  type FeaEngine,
  type FeaModuleFactory,
  type FeaWasmModule,
} from './FeaEngine';
