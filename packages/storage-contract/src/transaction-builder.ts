import type { IAbortSignal } from '@migaia/utils/promise'
import type { IStorageBase } from './store.js'
import type { IBackendKind } from './capabilities.js'
import { readTransactionConcurrency, assertTransactionCallback } from './transaction.js'
import { assertOperationContext } from './operation-context.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'
import {
  assertConcurrencyPolicy,
  ConcurrencyLocking,
  snapshotLockKey,
  normalizeLockKeys,
  associateNormalizedLockKeys,
  type ILockKey,
  type IConcurrencyPolicy,
  type ITransactionOptions,
  type ITransactionBuilder,
  type IOptimisticTransactionBuilder
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
/** Produces the existing argument boundary without introducing backend or execution authority. */
function invalidBuilder(backend: IBackendKind, cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend, cause },
    StorageContractErrorText.concurrencyArgument
  )
}
/** Optional native author mode exposes no key locks and delegates optimistic execution unchanged. */
export type IOptimisticTransactionBuilderMode = { readonly mode: 'optimistic' }
/** Native option extensions remain precise while key locking and pessimistic overrides are excluded. */
type IOptimisticBuilderOptions<TStore extends IBuilderStore> = Omit<
  NonNullable<Parameters<TStore['transaction']>[1]>,
  'lock' | 'concurrency'
> & {
  readonly lock?: never
  readonly concurrency?: IConcurrencyPolicy & { readonly locking: 'optimistic' }
}
/** Original store and pure configuration are shared by the derived finite builder branches. */
type IBuilderDefinition<TStore extends IBuilderStore, TMethods extends object> = {
  readonly store: TStore
  readonly backend: IBackendKind
  readonly options: ITransactionOptions & object
  readonly methods: TMethods | undefined
  readonly optimistic: boolean
}
/** A branch owns only configuration; the actual backend still owns transaction execution. */
class TransactionBuilder<TStore extends IBuilderStore, TMethods extends object> {
  /** Every branch delegates to the same original store and native option domain. */
  readonly #definition: IBuilderDefinition<TStore, TMethods>
  /** Persistent lock blocks and scalar choices determine only this branch’s eventual request. */
  readonly #state: IBuilderState
  /** Runtime terminal presence follows the same locked/optimistic public type state. */
  readonly #locked: boolean
  /** A new branch shares old blocks without copying its complete history. */
  constructor(
    definition: IBuilderDefinition<TStore, TMethods>,
    state: IBuilderState,
    locked: boolean
  ) {
    this.#definition = definition
    this.#state = state
    this.#locked = locked
  }
  /** Publish finite fluent methods whose state stays on this named owner. */
  build(): object {
    /** Feature functions retain identity and receive the exact published branch as receiver. */
    const branch = {
      ...this.#definition.methods,
      ...(this.#definition.optimistic
        ? {}
        : { lock: (first: ILockKey, ...rest: readonly ILockKey[]) => this.#lock(first, rest) }),
      concurrency: (policy: IConcurrencyPolicy) => this.#concurrency(policy),
      signal: (signal: IAbortSignal) => this.#signal(signal),
      timeout: (timeoutMs: number) => this.#timeout(timeoutMs)
    }
    if (!this.#locked && !this.#definition.optimistic) return branch
    return {
      ...branch,
      run: <TResult>(run: (scope: IBuilderScopeOf<TStore>) => TResult) => this.#run(run)
    }
  }
  /** Only the new branch state is replaced; existing branch histories remain independent. */
  #derive(state: IBuilderState, locked = this.#locked): object {
    return new TransactionBuilder(this.#definition, state, locked).build()
  }
  /** Mutable key components must retain their declared identity while queued transactions await. */
  #lock(first: ILockKey, rest: readonly ILockKey[]): object {
    /** A new block detaches only its own keys and shares all older blocks. */
    const keys = [first, ...rest].map((key) => snapshotLockKey(key, this.#definition.backend))
    return this.#derive({ ...this.#state, block: { previous: this.#state.block, keys } }, true)
  }
  /** Policy selection validates authentic metadata without executing its decision callback. */
  #concurrency(policy: IConcurrencyPolicy): object {
    assertConcurrencyPolicy(
      policy,
      this.#definition.optimistic ? ConcurrencyLocking.optimistic : undefined,
      this.#definition.backend
    )
    return this.#derive({ ...this.#state, concurrency: policy })
  }
  /** Signal validation is synchronous and retains the original caller signal. */
  #signal(signal: IAbortSignal): object {
    assertOperationContext({ signal })
    return this.#derive({ ...this.#state, signal })
  }
  /** Relative timeout validation does not start a timer or claim a native admission budget. */
  #timeout(timeoutMs: number): object {
    assertOperationContext({ timeoutMs })
    return this.#derive({ ...this.#state, timeoutMs })
  }
  /** Flatten the original persistent blocks once before canonical key normalization. */
  #normalizedLocks(): ReturnType<typeof normalizeLockKeys> | undefined {
    if (this.#definition.optimistic) return undefined
    /** An explicit stack avoids recursion and repeated copying of earlier blocks. */
    const blocks: IBuilderLockBlock[] = []
    for (let block = this.#state.block; block; block = block.previous) blocks.push(block)
    /** Each declared key appears once in the normalization input. */
    const keys: ILockKey[] = []
    while (blocks.length > 0) for (const key of blocks.pop()!.keys) keys.push(key)
    return normalizeLockKeys(keys, this.#definition.backend)
  }
  /** Invoke the actual original store once and return its exact Promise unchanged. */
  #run<TResult>(run: (scope: IBuilderScopeOf<TStore>) => TResult): Promise<Awaited<TResult>> {
    assertTransactionCallback(run, this.#definition.backend)
    /** The same metadata is borrowed by the original logical loop instead of normalized again. */
    const normalized = this.#normalizedLocks()
    /** Merge actual scalar branch choices into the complete native option domain. */
    const options = {
      ...this.#definition.options,
      concurrency: this.#state.concurrency,
      signal: this.#state.signal,
      timeoutMs: this.#state.timeoutMs,
      ...(normalized === undefined ? {} : { lock: normalized.map((entry) => entry.key) })
    }
    if (normalized !== undefined) associateNormalizedLockKeys(options, normalized)
    // The private constraint erases the store’s custom argument tuple; the public factory retains it.
    return this.#definition.store.transaction(run as never, options as never) as Promise<
      Awaited<TResult>
    >
  }
}
/**
 * Build a finite native transaction branch without another loop, lifecycle owner or option
 * snapshot.
 */
/** Native atomic mode exposes the backend’s actual optimistic unlocked scope. */
export function createTransactionBuilder<
  const TStore extends IBuilderStore,
  TAugmentMethods extends object = Record<never, never>
>(
  store: TStore,
  options: IOptimisticBuilderOptions<TStore> | undefined,
  methods: TAugmentMethods | undefined,
  mode: IOptimisticTransactionBuilderMode
): IOptimisticTransactionBuilder<IBuilderScopeOf<TStore>, TAugmentMethods>
/** Ordinary mode requires a declared lock before its native transaction terminal. */
export function createTransactionBuilder<
  const TStore extends IBuilderStore,
  TAugmentMethods extends object = Record<never, never>
>(
  store: TStore,
  options?: Omit<NonNullable<Parameters<TStore['transaction']>[1]>, 'lock'>,
  methods?: TAugmentMethods
): ITransactionBuilder<IBuilderScopeOf<TStore>, TAugmentMethods>
export function createTransactionBuilder<
  const TStore extends IBuilderStore,
  TAugmentMethods extends object = Record<never, never>
>(
  store: TStore,
  options?: Omit<NonNullable<Parameters<TStore['transaction']>[1]>, 'lock'>,
  methods?: TAugmentMethods,
  mode?: IOptimisticTransactionBuilderMode
):
  | ITransactionBuilder<IBuilderScopeOf<TStore>, TAugmentMethods>
  | IOptimisticTransactionBuilder<IBuilderScopeOf<TStore>, TAugmentMethods> {
  /** Only the original registered store supplies backend diagnostics. */
  const { backend } = readTransactionConcurrency(store)
  if (
    mode !== undefined &&
    (typeof mode !== 'object' ||
      mode === null ||
      Array.isArray(mode) ||
      mode.mode !== ConcurrencyLocking.optimistic)
  )
    throw invalidBuilder(backend, new TypeError(StorageContractErrorText.concurrencyArgument))
  /** Native atomic backends expose their actual unlocked optimistic terminal. */
  const optimistic = mode !== undefined
  if (
    (options !== undefined &&
      (typeof options !== 'object' || options === null || Array.isArray(options))) ||
    typeof store.transaction !== 'function'
  )
    throw invalidBuilder(backend)
  if (methods !== undefined) {
    if (typeof methods !== 'object' || methods === null || Array.isArray(methods))
      throw invalidBuilder(backend, new TypeError(StorageContractErrorText.concurrencyArgument))
    for (const key of Reflect.ownKeys(methods))
      if (
        (typeof key === 'string' && Object.hasOwn(TransactionBuilderMethod, key)) ||
        typeof methods[key as keyof TAugmentMethods] !== 'function'
      )
        throw invalidBuilder(backend, new TypeError(StorageContractErrorText.concurrencyArgument))
  }
  /** Synchronous admission needs validation only; execution captures its actual merged options. */
  const configuration = (options ?? {}) as ITransactionOptions
  assertOperationContext(configuration)
  if (configuration.concurrency !== undefined)
    assertConcurrencyPolicy(
      configuration.concurrency,
      optimistic ? ConcurrencyLocking.optimistic : undefined,
      backend
    )
  if (optimistic && configuration.lock !== undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported, { backend })
  /** Definition references retain the original native method receiver and pure Feature functions. */
  const definition = { store, backend, options: configuration, methods, optimistic }
  return new TransactionBuilder(
    definition,
    {
      block: undefined,
      concurrency: configuration.concurrency,
      signal: configuration.signal,
      timeoutMs: configuration.timeoutMs
    },
    false
  ).build() as
    | ITransactionBuilder<IBuilderScopeOf<TStore>, TAugmentMethods>
    | IOptimisticTransactionBuilder<IBuilderScopeOf<TStore>, TAugmentMethods>
}
