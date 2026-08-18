/* oxlint-disable unicorn/no-thenable -- browser fixtures verify thenable admission. */
import { createRuntime } from '@migaia/reactive';
import { atomDef, atomDefFactory, createAtomStore, derivedDef } from '@migaia/store-keyed';

declare global {
  interface Window {
    runStoreKeyedScenario(): readonly unknown[];
    runStoreKeyedThenableGuardScenario(): readonly unknown[];
  }
}

window.runStoreKeyedScenario = () => {
  const runtime = createRuntime();
  const store = createAtomStore(runtime);
  const count = atomDef(1, 'count');
  const doubled = derivedDef((get) => get(count) * 2, 'doubled');
  const replacement = atomDef(10, 'replacement');
  store.set(count, 2);
  const beforeOverride = store.get(doubled);
  const restore = store.override(count, replacement);
  const duringOverride = store.get(doubled);
  restore();
  const afterRestore = store.get(doubled);
  store.dispose();
  return [beforeOverride, duringOverride, afterRestore, store.disposed];
};

window.runStoreKeyedThenableGuardScenario = () => {
  const failure = new Error('browser then getter failed');
  let reads = 0;
  const hostile = Object.defineProperty({}, 'then', {
    get() {
      reads += 1;
      throw failure;
    }
  });
  let directCode: unknown;
  let directCauseMatches = false;
  try {
    atomDef(hostile);
  } catch (error) {
    directCode = (error as { code?: unknown }).code;
    directCauseMatches = (error as Error).cause === failure;
  }
  const runtime = createRuntime();
  const store = createAtomStore(runtime);
  const callable = Object.assign(() => 42, { then: () => undefined });
  const definition = atomDefFactory(() => callable);
  let factoryCode: unknown;
  try {
    store.get(definition);
  } catch (error) {
    factoryCode = (error as { code?: unknown }).code;
  }
  store.dispose();
  return [reads, directCode, directCauseMatches, factoryCode];
};
