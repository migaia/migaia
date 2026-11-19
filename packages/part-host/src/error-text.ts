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
    `modifier "${id}" must provide place exactly when placement is true`,
  /** Unknown resource id. */
  resourceUnknown: (id: string): string => `resource "${id}" is not in the catalog`,
  /** Unknown resource command. */
  resourceCommandUnknown: (id: string, command: string): string =>
    `resource "${id}" has no command "${command}"`,
  /** Unknown model id. */
  modelUnknown: (id: string): string => `model "${id}" is not in the catalog`,
  /** Runtime arguments failed their schema. */
  argsInvalid: (target: string): string => `arguments of ${target} failed schema validation`,
  /** A restricted or isolated effect called an operation outside its grants. */
  effectForbidden: (effect: string, operation: string): string =>
    `effect "${effect}" is not allowed to ${operation}`,
  /** An isolated effect ran without an isolated runner. */
  effectIsolationUnavailable: (effect: string): string =>
    `effect "${effect}" is isolated but no isolated runner is registered`
} as const
