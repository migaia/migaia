/** Stable public diagnostics owned by `@migaia/store-ssr`. */
export const StoreSsrErrorText = {
  timeoutOption: '[store] SSR awaitResources timeoutMs must be finite and non-negative',
  runtimeOptionsExclusive: '[store] SSR scope accepts runtime or runtimeOptions, not both',
  optionsObject: '[store] SSR request scope options must be an object',
  ownedOption: '[store] SSR registration options.owned must be boolean',
  differentRuntime: (kind: string, key: string): string =>
    `[store] SSR ${kind} "${key}" belongs to a different Runtime`,
  duplicate: (kind: string, key: string): string => `[store] duplicate SSR ${kind} key: ${key}`,
  hydrateFailed:
    '[store] SSR hydrate() failed for one or more stores/resources; entries that could apply were still applied (best-effort, not atomic)',
  resourceTimeout: (key: string, timeoutMs: number | undefined): string =>
    `[store] SSR resource "${key}" did not settle within ${timeoutMs}ms`,
  resourceRoundLimit: (maxRounds: number): string =>
    `[store] SSR resources kept registering new resources past ${maxRounds} rounds`,
  scopeDisposalFailed: '[store] SSR request scope disposal failed',
  scopeDisposed: '[store] SSR request scope is disposed',
  invalidScriptId: '[store] invalid SSR state script id',
  codecOutput: (type: string): string =>
    `[store] SSR codec ${type} must produce wire data, not a value chunk`,
  codecMissing: (type: string): string =>
    `[store] SSR payload was written by codec "${type}", which is not registered`,
  invalidStateVersion: '[store] invalid SSR state version',
  invalidStoresSnapshot: '[store] invalid SSR stores snapshot',
  invalidResourcesSnapshot: '[store] invalid SSR resources snapshot',
  invalidStoreKey: '[store] invalid SSR store key',
  invalidResourceSnapshot: (key: string): string => `[store] invalid SSR resource snapshot: ${key}`,
  propertyAccess: (path: string): string => `[store] ${path} could not be read safely`,
  plainObject: (path: string): string => `[store] ${path} must be a plain object`,
  nodeLimit: (path: string): string => `[store] ${path} exceeds the JSON node limit`,
  depthLimit: (path: string): string => `[store] ${path} exceeds the JSON depth limit`,
  nonFinite: (path: string): string => `[store] ${path} contains a non-finite number`,
  notSerializable: (path: string): string => `[store] ${path} is not JSON serializable`,
  cycle: (path: string): string => `[store] ${path} contains a cycle`,
  nonPlain: (path: string): string => `[store] ${path} contains a non-plain object`
} as const;
