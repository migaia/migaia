/** Stable messages for errors thrown by the part host. */
export const PartHostErrorText = {
  /** Two plugins registered the same id. */
  catalogConflict: (id: string, owner: string): string =>
    `"${id}" is already registered by plugin "${owner}"`,
  /** Enhancer ordering cycle on one tag. */
  enhancerCycle: (tag: string): string => `enhancers on "${tag}" declare a cycle in after`,
  /** Enhancer mutated its input. */
  enhancerMutatedInput: (id: string): string => `enhancer "${id}" modified its frozen input`,
  /** Derive attempted a write. */
  deriveWrite: (path: string): string => `derive computation may not write state "${path}"`,
  /** Effect failure wrapper. */
  effectFailed: (id: string): string => `effect "${id}" failed`,
  /** No renderer installed. */
  rendererMissing: 'no renderer plugin is installed',
  /** Second renderer. */
  rendererDuplicate: (owner: string): string => `renderer already provided by plugin "${owner}"`,
  /** Host disposed. */
  hostDisposed: 'part host has been disposed',
  /** Unknown blueprint. */
  blueprintUnknown: (id: string): string => `blueprint "${id}" has not been loaded`,
  /** Placement flag and place function disagree. */
  modifierPlacementMismatch: (id: string): string =>
    `modifier "${id}" must provide place exactly when placement is true`
} as const
