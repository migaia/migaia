/** Stable error domain owned by this code table; package moves preserve this identity. */
export const ERROR_SOURCE = 'reactive'

/**
 * The single declaration site for `reactive` error codes.
 *
 * See `docs/contracts/error-codes.md`. The pair `(source, code)` uniquely identifies an error.
 * `source` is always `'reactive'`. Throw sites use these constants instead of inline
 * values.
 *
 * The migration assigns codes to previously untagged errors. `SCOPE_CLOSED`,
 * `SCOPE_REENTRANT_DISPOSE`, `SCOPE_SYNC_VIOLATION`, `GENERATION_DISPOSED`, and
 * `SCOPE_DISPOSAL_FAILED` move with `lifecycle-primitives.ts` and `generation-controller.ts`. Those
 * five codes belong to `@migaia/lifecycle` and do not appear here.
 *
 * Code values are public API. Renaming a code is a breaking change.
 */
export const ReactiveErrorCode = {
  /**
   * An unclassified action, batch, untracked, or tracked derivation callback threw. Annotatable
   * native errors keep identity and stack; immutable and primitive values remain on cause. Existing
   * package identities are preserved. Handle the callback failure before retrying the operation.
   */
  callbackFailed: 'CALLBACK_FAILED',
  /**
   * Thrown when a read or write operation targets a disposed `Signal`, `Computed`, or custom
   * source.
   *
   * Value access rejects after disposal to prevent reading stale values from disconnected nodes.
   * Stop using the disposed node and create a replacement instance.
   */
  nodeDisposed: 'NODE_DISPOSED',

  /**
   * Thrown when evaluating a `Computed` directly or indirectly reads its own pending result.
   *
   * A cycle cannot produce a determinate value. Further evaluation loops or returns incomplete
   * stale data. Inspect the dependency graph and remove the cycle.
   */
  circularDependency: 'CIRCULAR_DEPENDENCY',

  /**
   * Thrown when a node from one `Runtime` is read, subscribed, or checked at another runtime's
   * boundary.
   *
   * Each `Runtime` owns an independent dependency graph and ownership table. Cross-graph operations
   * cannot preserve consistency and can leave stale dependency edges. Ensure the node and its
   * consumer belong to the same `Runtime`. Do not share nodes across runtimes.
   */
  crossRuntime: 'CROSS_RUNTIME',

  /**
   * Thrown when an object lacks the internal registration supplied by this library's runtime or
   * node factories.
   *
   * The kernel trusts only registered runtimes and nodes. It rejects unregistered objects at the
   * entry boundary instead of allowing later failures that obscure their source. Use an object from
   * this library's factories.
   */
  notRuntimeOwned: 'NOT_RUNTIME_OWNED',

  /**
   * Thrown at the second registration when the same node object is assigned to different runtimes.
   *
   * A node cannot belong to two dependency graphs without invalidating ownership checks. Create
   * independent nodes for each `Runtime` instead of reusing an object across runtimes.
   */
  ownershipConflict: 'OWNERSHIP_CONFLICT',

  /**
   * Reports multiple library copies, such as duplicate installations, bundled and CDN copies, or
   * separate microfrontend bundles. Also thrown when `assertSingleRuntimeCopy()` finds more than
   * one copy.
   *
   * Copies do not share ownership tables or synchronous tracking contexts. Cross-copy reads can
   * therefore return stale data without detection. Deduplicate dependencies to keep one library
   * copy in the process. Use `assertSingleRuntimeCopy()` when the deployment must reject multiple
   * copies.
   */
  copyConflict: 'COPY_CONFLICT',

  /**
   * Thrown when a cross-copy diagnostic brand has an unexpected shape.
   *
   * `Object.defineProperty` installs this read-only internal marker. An invalid brand indicates
   * modification outside the supported path and invalidates ownership checks. Do not modify
   * internal properties on managed objects.
   */
  brandCorrupted: 'BRAND_CORRUPTED',

  /**
   * Thrown when a new version is requested after the monotonic clock reaches its configured limit.
   * The production default is `Number.MAX_SAFE_INTEGER`.
   *
   * Resetting the counter would collide with versions held by live nodes and cause missed updates.
   * The clock therefore stops on exhaustion. Dispose all nodes owned by the current `Runtime`,
   * discard that runtime, and create a new one instead of reusing the graph.
   */
  versionExhausted: 'VERSION_EXHAUSTED',

  /**
   * Thrown when one observer executes more than `maxFlushPasses` times in one flush. The default is
   * 100.
   *
   * This usually indicates an effect writes to its own dependency and triggers itself. The
   * scheduler clears pending work and ends the flush to prevent a synchronous infinite loop.
   * Inspect the discarded items in the error message to locate and remove the cycle.
   */
  flushLoop: 'FLUSH_LOOP',

  /**
   * Thrown or reported as an `AggregateError` when multiple observer `tick()` calls fail in a
   * flush, or multiple observable lifecycle hooks (`onObserved` or `onUnobserved`) fail.
   *
   * Inspect each entry in `error.errors`. A single observer failure retains the original error
   * without this code.
   */
  observerFailed: 'OBSERVER_FAILED',

  /**
   * Tags the aggregate when both the business action and final flush fail in `runBatched()`. If
   * reading the business error's `cause` fails, all three original failures enter
   * `AggregateError.errors`.
   *
   * A writable business error remains the top-level error, with the flush failure attached through
   * `cause`. Inspect the top-level error and its `cause` or `errors`.
   */
  actionFlushFailed: 'ACTION_FLUSH_FAILED',

  /**
   * Reserved diagnostic code for unhandled failures in an async scheduling callback or
   * `reportError()`.
   *
   * The default `adapter.reportError` is a no-op, so no default throw or report site uses this
   * code. The code remains stable for custom `onAsyncError` or `onError` handlers that need
   * scheduler-failure semantics.
   */
  schedulerFailed: 'SCHEDULER_FAILED',

  /**
   * Thrown when `commitCapture()` receives an invalid or consumed token, a token from another
   * tracker, or a token whose observer is disposed.
   *
   * A capture token can be validated and committed only once. Reevaluate instead of reusing the
   * token, for example during a Concurrent React render.
   */
  captureInvalid: 'CAPTURE_INVALID',

  /**
   * Thrown when `observe` is called on an `IObserverBinding` that already owns an active observer.
   *
   * `observe` is not idempotent. Duplicate calls indicate a repeated state-machine transition.
   * Ensure the previous observation ends before calling `observe` again.
   */
  bindingDuplicate: 'BINDING_DUPLICATE',

  /**
   * Thrown when an extension binding targets a node with existing graph bookkeeping. Replacing its
   * sets would orphan live edges. Bind a fresh custom node once; do not rebind a Signal, Computed,
   * Effect, Resource, or an already bound custom node.
   */
  graphNodeRegistered: 'GRAPH_NODE_REGISTERED',

  /**
   * Thrown when `registerInternals()` registers the same `Runtime` object twice.
   *
   * Register internals once during construction. Duplicate registration is a programming error, not
   * an instruction to replace the existing internals. Check the runtime construction path.
   */
  internalsRegistered: 'INTERNALS_REGISTERED',

  /**
   * Thrown during construction or invocation when an option fails validation. Examples include
   * `maxFlushPasses`, the maximum version, and a traced action's name.
   *
   * Entry validation prevents invalid configuration from entering runtime state. Correct the option
   * value.
   */
  invalidOption: 'INVALID_OPTION'
} as const

/** Value union of `ReactiveErrorCode`; compare `error.code` against these values. */
export type IReactiveErrorCode = (typeof ReactiveErrorCode)[keyof typeof ReactiveErrorCode]
