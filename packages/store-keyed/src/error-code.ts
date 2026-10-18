/**
 * Declares the public error codes for `@migaia/store-keyed` in one place.
 *
 * The registry in `docs/contracts/error-codes.md` identifies errors by `(source, code)`. The
 * `source` is always `'@migaia/store-keyed'`. Throw sites use these constants instead of inline
 * literals.
 *
 * Code values are public API. Renaming a code is a breaking change
 * (`docs/contracts/error-code-rollout.sdd.md` §1.2).
 */
export const StoreKeyedErrorCode = {
  /**
   * An atom store is used after disposal.
   *
   * Create a new store instead of reusing the disposed instance.
   */
  atomStoreDisposed: 'ATOM_STORE_DISPOSED',

  /**
   * Multiple entries fail to clean up while an atom store is disposed. An `AggregateError` exposes
   * each failure through `errors[]`.
   *
   * Treat this as a disposal failure and inspect each cause.
   */
  disposalFailed: 'DISPOSAL_FAILED',

  /**
   * An atom preview cycle is detected within one render or preview stack.
   *
   * Check derived dependencies for cycles.
   */
  circularPreview: 'CIRCULAR_PREVIEW',

  /**
   * An atom override chain contains a cycle and cannot resolve its final definition.
   *
   * Check whether override targets point back to each other.
   */
  cyclicOverride: 'CYCLIC_OVERRIDE',

  /**
   * An override replaces a writable definition with a read-only target and breaks its write
   * contract.
   *
   * Preserve the read and write semantics across overrides.
   */
  overrideContract: 'OVERRIDE_CONTRACT',

  /**
   * A primitive factory without `previewSafe` is evaluated during preview.
   *
   * Mark the factory as `previewSafe` or avoid evaluating it during preview.
   */
  previewUnsafe: 'PREVIEW_UNSAFE',

  /**
   * An atom is accessed from a different `Runtime`, whose dependency graph cannot see the atom.
   *
   * Access the atom within its own `Runtime` instead of sharing it across runtimes.
   */
  crossRuntime: 'CROSS_RUNTIME',

  /**
   * The host lacks `WeakRef`/`FinalizationRegistry` for the family cache or `structuredClone` for
   * independent primitive templates in AtomStore.
   *
   * Enable these capabilities in the host sandbox. This is a deployment issue.
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /**
   * An application accessor or proxy fails while an optic reads or immutably copies its input.
   * Native mutable errors retain their identity and stack; frozen/non-Error originals stay on
   * cause. Inspect the application accessor rather than treating this as a missing path or target
   * key.
   */
  opticAccessFailed: 'OPTIC_ACCESS_FAILED',

  /**
   * Input validation fails for `maxSize`, a non-atom definition, an empty or inaccessible focus
   * path, duplicate keys, a missing target key, or a thenable initial value.
   *
   * Correct the input named in the error message.
   */
  invalidOption: 'INVALID_OPTION'
} as const

export type IStoreKeyedErrorCode = (typeof StoreKeyedErrorCode)[keyof typeof StoreKeyedErrorCode]
