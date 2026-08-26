/** Stable public diagnostics owned by `@migaia/store-devtools`. */
export const StoreDevtoolsErrorText = {
  /** Session methods use this after terminal disposal. */
  sessionDisposed: '[store] DevTools session is disposed',
  /** Cleanup reports all subscription failures through this stable heading. */
  cleanupFailed: '[store] DevTools cleanup failed',
  /** Formats a rejected history identifier without reading user state. */
  unknownHistoryEntry: (id: number): string => `[store] unknown history entry: ${id}`,
  /** Formats invalid bounded diagnostic configuration. */
  invalidLimit: (name: string): string =>
    `[store] DevTools ${name} must be a positive safe integer`,
  invalidDepth: (name: string): string =>
    `[store] DevTools ${name} maxDepth must be a non-negative safe integer`,
  optionsObject: '[store] DevTools options must be an object',
  callbackOption: (name: string): string => `[store] DevTools ${name} must be a function`
} as const
