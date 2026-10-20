/**
 * Defines the error codes owned by `@migaia/storage-contract` in one place.
 *
 * The `(source, code)` pair uniquely identifies an error under `docs/contracts/error-codes.md`.
 * `source` is always `@migaia/storage-contract`. Throw sites reference these constants rather than
 * inline literals.
 *
 * Code values are public API, so renaming one is a breaking change.
 */
export const StorageContractErrorCode = Object.freeze({
  /**
   * A public argument or descriptor fails contract shape validation. Applies to codec descriptors,
   * capability descriptors, key domains, transaction options, and operation contexts.
   *
   * Enforces runtime public argument and contract shape validation. Adapter-specific configuration
   * validation uses the web `INVALID_CONFIG` code instead.
   *
   * The caller corrects the argument before retrying. The failure persists until the argument
   * changes.
   */
  invalidArgument: 'INVALID_ARGUMENT',

  /**
   * An `IStorageKey` violates the key domain through an invalid type, excessive depth, node count
   * or binary bytes, a cycle, or an empty array.
   *
   * Enforces contract key validation.
   *
   * The caller corrects the key rather than retrying the same invalid key.
   */
  invalidKey: 'INVALID_KEY',

  /**
   * An operation requires a capability that the current backend does not provide. Examples include
   * failed `asRecordStore` narrowing and a structured codec on a text-only backend.
   *
   * Enforces contract capability narrowing.
   *
   * The caller checks `capabilities` or `isRecordStore`, or selects a backend with the required
   * capability. The operation does not silently fall back.
   */
  unsupported: 'UNSUPPORTED_CAPABILITY',

  /**
   * A storage operation runs after the store is disposed, violating the lifecycle contract.
   *
   * Enforces contract lifecycle semantics.
   *
   * The caller creates a new store instead of reusing the closed instance.
   */
  disposed: 'STORE_DISPOSED',

  /**
   * `IOperationContext.signal` cancels an operation or `timeoutMs` expires.
   *
   * Enforces contract cancellation semantics.
   *
   * The caller handles the result as cancellation. A write that has entered atomic commit reports
   * the actual commit result rather than claiming rollback.
   */
  aborted: 'ABORTED'
} as const)

export type IStorageContractErrorCode =
  (typeof StorageContractErrorCode)[keyof typeof StorageContractErrorCode]
