import type { IAbortSignal } from '@migaia/utils/promise'
import type { IStorageBase } from './store.js'
import type { IBackendKind } from './capabilities.js'
import { readTransactionConcurrency, assertTransactionCallback } from './transaction.js'
import { snapshotOperationContext } from './operation-context.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'
import {
  assertConcurrencyPolicy,
  snapshotLockKey,
  normalizeLockKeys,
  associateNormalizedLockKeys,
  type ILockKey,
  type IConcurrencyPolicy,
  type ITransactionOptions,
  type ITransactionBuilder,
  type ILockedTransactionBuilder
} from './concurrency.js'

/** Original builder method names remain reserved across locked and unlocked branches. */
export const TransactionBuilderMethod = Object.freeze({
  lock: 'lock',
  concurrency: 'concurrency',
  signal: 'signal',
  timeout: 'timeout',
  run: 'run'
} as const)

/**
 * This constraint admits an actual transaction function without replacing its scope or option
 * types.
 */
type IBuilderStore = IStorageBase & { transaction: (...args: never[]) => Promise<unknown> }
/** The actual store callback owns the complete scope, including native backend extensions. */
type IBuilderScopeOf<TStore extends IBuilderStore> = Parameters<TStore['transaction']>[0] extends (
  scope: infer TScope
) => unknown
  ? TScope
  : never
/** Each immutable node records only new key snapshots and shares all earlier lock blocks. */
type IBuilderLockBlock = {
  readonly previous: IBuilderLockBlock | undefined
  readonly keys: readonly ILockKey[]
}
/** Configuration changes copy only this fixed-size state, not accumulated keys or native options. */
type IBuilderState = {
  readonly block: IBuilderLockBlock | undefined
  readonly concurrency: IConcurrencyPolicy | undefined
  readonly signal: IAbortSignal | undefined
  readonly timeoutMs: number | undefined
}
/** The locked state determines both actual runtime method presence and the public return shape. */
type IBuilderOf<
  TScope,
  TLocked extends boolean,
  TAugmentMethods extends object
> = TLocked extends true
  ? ILockedTransactionBuilder<TScope, TAugmentMethods>
  : ITransactionBuilder<TScope, TAugmentMethods>

/** Produces the existing argument boundary without introducing backend or execution authority. */
function invalidBuilder(backend: IBackendKind, cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend, cause },
    StorageContractErrorText.concurrencyArgument
  )
}
/**
 * Creates an immutable transaction builder for an original registered store. Configuration starts
 * no I/O or timing owner. Each lock step copies only new keys; run unfolds the shared blocks once,
 * normalizes once, and returns the original store.transaction Promise after one direct invocation.
 * The actual store's full scope and option domain remain visible to callers.
 */
export function createTransactionBuilder<
  const TStore extends IBuilderStore,
  TAugmentMethods extends object = Record<never, never>
>(
  store: TStore,
  options?: Omit<NonNullable<Parameters<TStore['transaction']>[1]>, 'lock'>,
  methods?: TAugmentMethods
): ITransactionBuilder<IBuilderScopeOf<TStore>, TAugmentMethods> {
  /**
   * Authentic registration supplies fixed backend diagnostics without reading mutable store
   * getters.
   */
  const { backend } = readTransactionConcurrency(store)
  /** Captured native options are shared by every branch and copied only at the terminal. */
  let captured: ITransactionOptions & object
  /** The borrowed transaction method is captured once and always invoked with the original store. */
  let transaction: TStore['transaction']
  /** Pure Feature methods retain their references and receive each real derived builder as this. */
  let augmentation: TAugmentMethods | undefined
  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  )
    throw invalidBuilder(backend)
  try {
    captured = { ...options }
    transaction = store.transaction
    if (
      methods !== undefined &&
      (typeof methods !== 'object' || methods === null || Array.isArray(methods))
    )
      throw new TypeError(StorageContractErrorText.concurrencyArgument)
    augmentation = methods === undefined ? undefined : ({ ...methods } as TAugmentMethods)
    if (augmentation !== undefined)
      for (const key of Reflect.ownKeys(augmentation))
        if (
          (typeof key === 'string' && Object.hasOwn(TransactionBuilderMethod, key)) ||
          typeof Reflect.get(augmentation, key) !== 'function'
        )
          throw new TypeError(StorageContractErrorText.concurrencyArgument)
    if (augmentation !== undefined) Object.freeze(augmentation)
  } catch (cause) {
    throw invalidBuilder(backend, cause)
  }
  if (typeof transaction !== 'function') throw invalidBuilder(backend)
  snapshotOperationContext(captured)
  if (captured.concurrency !== undefined) assertConcurrencyPolicy(captured.concurrency)
  Object.freeze(captured)
  /** Factory-local state contains no lock, queue, budget or disposer beyond immutable configuration. */
  function create<TLocked extends boolean>(
    state: IBuilderState,
    locked: TLocked
  ): IBuilderOf<IBuilderScopeOf<TStore>, TLocked, TAugmentMethods> {
    /** Every derived object shares the original immutable options and old lock blocks. */
    const builder = {
      ...augmentation,
      /** Captures only these newly declared identities; earlier branch history remains untouched. */
      lock(first: ILockKey, ...rest: readonly ILockKey[]) {
        /** Snapshot factories detach mutable key components before this call returns. */
        const keys = Object.freeze([first, ...rest].map((key) => snapshotLockKey(key, backend)))
        return create({ ...state, block: { previous: state.block, keys } }, true)
      },
      /** Derives policy metadata without executing its decision callback. */
      concurrency(policy: IConcurrencyPolicy) {
        assertConcurrencyPolicy(policy)
        return create({ ...state, concurrency: policy }, locked)
      },
      /** Validates cancellation intent while preserving the same original signal object. */
      signal(signal: IAbortSignal) {
        snapshotOperationContext({ signal })
        return create({ ...state, signal }, locked)
      },
      /** Validates a relative duration without starting the operation deadline early. */
      timeout(timeoutMs: number) {
        snapshotOperationContext({ timeoutMs })
        return create({ ...state, timeoutMs }, locked)
      }
    }
    if (!locked)
      return Object.freeze(builder) as IBuilderOf<IBuilderScopeOf<TStore>, TLocked, TAugmentMethods>
    return Object.freeze({
      ...builder,
      /**
       * Starts the actual transaction once; old blocks are unfolded without recursion or prefix
       * copying.
       */
      run<TResult>(run: (scope: IBuilderScopeOf<TStore>) => TResult): Promise<Awaited<TResult>> {
        assertTransactionCallback(run, backend)
        /** An explicit stack reverses persistent history once, even for long builder chains. */
        const blocks: IBuilderLockBlock[] = []
        for (let block = state.block; block; block = block.previous) blocks.push(block)
        /** Flattening costs only the declared entries before canonical sorting and deduplication. */
        const keys: ILockKey[] = []
        while (blocks.length > 0) for (const key of blocks.pop()!.keys) keys.push(key)
        /** The same normalization owner shares encoded identities with the real concurrency loop. */
        const normalized = normalizeLockKeys(keys, backend)
        /**
         * Fixed context overrides retain all captured native fields rather than narrowing the
         * backend.
         */
        const transactionOptions = {
          ...captured,
          concurrency: state.concurrency,
          signal: state.signal,
          timeoutMs: state.timeoutMs,
          lock: normalized.map((entry) => entry.key)
        }
        associateNormalizedLockKeys(transactionOptions, normalized)
        return Reflect.apply(transaction, store, [run, transactionOptions]) as Promise<
          Awaited<TResult>
        >
      }
    }) as IBuilderOf<IBuilderScopeOf<TStore>, TLocked, TAugmentMethods>
  }
  return create(
    {
      block: undefined,
      concurrency: captured.concurrency,
      signal: captured.signal,
      timeoutMs: captured.timeoutMs
    },
    false
  )
}
