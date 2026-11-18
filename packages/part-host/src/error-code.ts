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
  blueprintUnknown: 'BLUEPRINT_UNKNOWN'
} as const

/** Value union of every `part.host` error code. */
export type IPartHostErrorCode = (typeof PartHostErrorCode)[keyof typeof PartHostErrorCode]
