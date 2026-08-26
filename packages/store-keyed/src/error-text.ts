/** Stable public diagnostics owned by `@migaia/store-keyed`. */
export const StoreKeyedErrorText = {
  weakRef:
    '[store] family definitions require WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox',
  createFamilyWeakRef:
    '[store] createFamily() requires WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox',
  familyCapacity: '[store] family maxSize must be a positive integer',
  familyLabel: '[store] family debugLabel must be a string',
  familyTtl: '[store] family ttl must be non-negative',
  familyNow: '[store] family now must be a function',
  familyComputedOptions: '[store] computed family options could not be read',
  familyCallback: (name: string): string => `[store] family ${name} must be a function`,
  disposedFamily: '[store] cannot use a disposed family',
  evictionFailed: '[store] family capacity eviction failed for multiple entries',
  familyDisposalFailed: '[store] family disposal failed for multiple entries',
  crossRuntime: '[store] cross-runtime atom access is not allowed',
  focusPath: '[store] focusDef requires at least one path segment',
  primitiveClone: '[store] primitive initial values require structuredClone support',
  primitiveCloneFailed: '[store] primitive initial value cannot be cloned independently',
  disposedAtomStore: '[store] cannot use a disposed atom store',
  notDefinition: '[store] not an atom definition',
  writeContract: '[store] atom override must preserve the original write contract',
  cyclicOverride: '[store] cyclic atom override',
  circularPreview: '[store] circular atom preview detected',
  previewUnsafe: '[store] atom factory is not marked preview-safe',
  readonlyOverride: '[store] atom override resolved to a read-only definition',
  atomDisposalFailed: '[store] atom store disposal failed',
  opticRead: (label: string, key: PropertyKey): string =>
    `[store] ${label} cannot read path segment ${String(key)}`,
  opticWrite: (label: string, key: PropertyKey): string =>
    `[store] ${label} cannot write path segment ${String(key)}`,
  opticUnique: (label: string): string => `[store] ${label} keys must be unique`,
  opticMissing: (label: string): string => `[store] ${label}`,
  thenable: (context: string): string =>
    `[store] ${context} returned a thenable — async initial values are not supported here; compose with @migaia/resource instead (e.g. \`familyDef((id) => createResource(() => fetch(id)))\`)`
} as const
