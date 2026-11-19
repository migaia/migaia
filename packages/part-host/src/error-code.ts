/** Stable error domain owned by this code table; it names the part runtime host. */
export const ERROR_SOURCE = 'part.host'

/** The single declaration site for `part.host` error codes. Code values are public API. */
export const PartHostErrorCode = {
  /**
   * An `id@major` is registered by a second plugin name that does not list it in `override`. The
   * first registration stays. Rename the definition or list it in `override`.
   */
  catalogConflict: 'CATALOG_CONFLICT',
  /** Enhancers on one tag declare `after` edges that form a cycle. Correct the `after` lists. */
  enhancerCycle: 'ENHANCER_CYCLE',
  /**
   * An enhancer modified its frozen input instead of returning a new configuration. The original
   * TypeError is on `cause`; return a new object.
   */
  enhancerMutatedInput: 'ENHANCER_MUTATED_INPUT',
  /** A derive computation tried to write state. Move the write into an effect. */
  deriveWrite: 'DERIVE_WRITE',
  /**
   * An effect threw or rejected. The original error is on `cause`; later dispatches to the same
   * effect still run. The host has already reported it once.
   */
  effectFailed: 'EFFECT_FAILED',
  /** `mount` was called while no renderer plugin is installed. Install one renderer plugin. */
  rendererMissing: 'RENDERER_MISSING',
  /** A second renderer plugin with another name tried to register. Install one; use `replace`. */
  rendererDuplicate: 'RENDERER_DUPLICATE',
  /** `load`, `patch`, `mount` or `dispatch` was called after `dispose`. Create a new host. */
  hostDisposed: 'HOST_DISPOSED',
  /** `patch` or `mount` named a blueprint id that was never loaded. Load it first. */
  blueprintUnknown: 'BLUEPRINT_UNKNOWN',
  /**
   * `defineModifier` was given `placement: true` without `place`, or `place` with `placement:
   * false`. Provide both together or neither.
   */
  modifierPlacementMismatch: 'MODIFIER_PLACEMENT_MISMATCH',
  /**
   * `query`, `refresh`, `errorOf` or `run` named a resource id that is not in the catalog (never
   * registered, or its plugin was removed or suspended). Install the plugin that provides it.
   * Watches do not throw this; they show an error snapshot with this code instead.
   */
  resourceUnknown: 'RESOURCE_UNKNOWN',
  /** `run` named a command the resource does not declare. Use a command from the resource spec. */
  resourceCommandUnknown: 'RESOURCE_COMMAND_UNKNOWN',
  /** `models.validate` named a model id that is not in the catalog. Register the model first. */
  modelUnknown: 'MODEL_UNKNOWN',
  /**
   * Resource parameters or command arguments failed their Standard Schema at runtime. The issue
   * list is on `cause`; the command did not run. A resource entry shows this code in its error
   * snapshot instead of throwing. Fix the arguments.
   */
  argsInvalid: 'ARGS_INVALID',
  /**
   * A `restricted` or `isolated` effect called something its grants do not allow: a resource
   * command outside `part.grants.resources`, a state write outside the `part.grants.state`
   * prefixes, or a dispatch or part reference into another blueprint. The call is refused and
   * reported once; grant the operation in the application's trust configuration if it is intended.
   */
  effectForbidden: 'EFFECT_FORBIDDEN',
  /**
   * An `isolated` effect ran while no isolated runner was registered on the `effect` Feature.
   * Install the plugin that provides isolation (for example part-plugin-remote) before running it.
   */
  effectIsolationUnavailable: 'EFFECT_ISOLATION_UNAVAILABLE'
} as const

/** Value union of every `part.host` error code. */
export type IPartHostErrorCode = (typeof PartHostErrorCode)[keyof typeof PartHostErrorCode]
