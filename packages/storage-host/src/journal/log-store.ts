import {
  assertLogInteger,
  createLogStoreIndex,
  LogRecordState,
  prepareLogAppend,
  snapshotLogRecords,
  type ILogAppendPort,
  type ILogAppendNotice,
  type ILogStore
} from '@migaia/logger/plugins/durable'
import { createEventChannel, EventDispatchPolicy } from '@migaia/event-subscriber'
import { createConcurrencyLimiter, deferred } from '@migaia/utils/promise'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ITransactionScope
} from '@migaia/storage-contract'
import { PluginHostError } from '@migaia/plugin-host'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import { isStorageErrorFamily } from '../core/error-family.js'
import { createStorageOperationReporter, reportCleanupError } from '../core/operation-reporter.js'
import { resolveStorageJournalBinding, type IStorageJournalBackendAccess } from './binding.js'
import {
  appendStorageLog,
  prepareStorageLogAppend,
  persistStorageLogAppend,
  readStorageLogHead,
  recoverStorageLog,
  reclaimStorageLogRows,
  setStorageLogState,
  truncateStorageLog,
  type IStorageLogHead,
  type IStorageLogAppend
} from './protocol.js'
import type {
  IStorageBackendPluginHandle,
  IPluginStoreMap,
  IStorageHost,
  IStorageOrgView
} from '../types.js'
import type { IStorageJournalNamespace, IStorageJournalNamespaceView } from './types.js'
import { storageLogNativeAccess, type IStorageLogNativeAccess } from './append-port.js'
import { storageJournalLockKey, StorageJournalLock } from './keys.js'

/** Keep original coded storage failures and retain unknown native I/O errors on cause. */
function journalFailure(cause: unknown): Error {
  return isStorageErrorFamily(cause)
    ? cause
    : new StorageError(
        StorageErrorCode.journalRecoveryFailed,
        { cause },
        StorageErrorText.journalRecoveryFailed
      )
}

/**
 * Open one admitted backend's private journal in this facade's immutable organization. Recovery
 * completes before the log becomes visible; the original registration owns eventual cleanup.
 */
export async function storageLogStore<
  const P extends readonly IStorageBackendPluginHandle[],
  N extends keyof IPluginStoreMap<P> & string
>(
  host: IStorageHost<P> | IStorageOrgView<P>,
  id: N,
  options: { readonly prefix: string }
): Promise<ILogStore> {
  const prefix = snapshotStorageLogPrefix(options)
  return openStorageLogStore(resolveStorageJournalBinding(host, id), prefix)
}

/** Capture the original prefix boundary before any host lookup or private namespace I/O. */
export function snapshotStorageLogPrefix(options: { readonly prefix: string }): string {
  const prefix = options?.prefix
  if (typeof prefix !== 'string' || prefix.length === 0)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return prefix
}

/** Only one original resource's mutable log state is held here, with no second native protocol. */
type IStorageLogContext = {
  readonly access: IStorageJournalBackendAccess
  readonly prefix: string
  readonly namespace: IStorageJournalNamespace
  readonly report: ReturnType<typeof createStorageOperationReporter>
  index: ReturnType<typeof createLogStoreIndex> | undefined
  readonly indexExclusive: boolean
  readonly nativeAtomic: boolean
  readonly hasCommittedPort: boolean
  readonly limiter: ReturnType<typeof createConcurrencyLimiter>
  readonly appended: ReturnType<typeof createEventChannel<ILogAppendNotice>>
  readonly pending: Map<string, StorageLogPendingAttempt>
  accepting: boolean
  failure: Error | undefined
  main: Promise<void> | undefined
  symbolic: Promise<void> | undefined
  forget: () => void
  store: ILogStore | undefined
}
/** Prepare the existing namespace and logger index before publishing any public log method. */
async function prepareStorageLogContext(
  access: IStorageJournalBackendAccess,
  prefix: string
): Promise<IStorageLogContext> {
  let namespace: IStorageJournalNamespace
  try {
    namespace = await access.binding.openNamespace(prefix)
  } catch (cause) {
    throw journalFailure(cause)
  }
  const report = createStorageOperationReporter()
  let index: ReturnType<typeof createLogStoreIndex> | undefined
  let indexExclusive: boolean
  let nativeAtomic: boolean
  let hasCommittedPort: boolean
  try {
    const exclusive = namespace.indexExclusive
    if (exclusive !== undefined && exclusive !== false)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    indexExclusive = exclusive !== false
    if (namespace.assertLive !== undefined && typeof namespace.assertLive !== 'function')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    nativeAtomic = namespace.nativeAtomic
    if (typeof nativeAtomic !== 'boolean')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    if (namespace.runCommitted !== undefined && typeof namespace.runCommitted !== 'function')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    hasCommittedPort = namespace.runCommitted !== undefined
    const recovered = await namespace.run(recoverStorageLog)
    if (indexExclusive) index = createLogStoreIndex(recovered)
  } catch (cause) {
    try {
      await namespace.dispose()
    } catch (cleanup) {
      reportCleanupError(report, cleanup)
    }
    throw journalFailure(cause)
  }
  return {
    access,
    prefix,
    namespace,
    report,
    index,
    indexExclusive,
    nativeAtomic,
    hasCommittedPort,
    limiter: createConcurrencyLimiter({ concurrency: 1 }),
    appended: createEventChannel<ILogAppendNotice>({
      dispatchPolicy: EventDispatchPolicy.queued,
      report: ({ error }) => reportCleanupError(report, error)
    }),
    pending: new Map(),
    accepting: true,
    failure: undefined,
    main: undefined,
    symbolic: undefined,
    forget: () => undefined,
    store: undefined
  }
}
/** Admit before the original FIFO; already accepted work retains its place while closing. */
function admitStorageLog(context: IStorageLogContext): void {
  if (context.failure !== undefined) throw context.failure
  if (!context.accepting) throw new StorageContractError(StorageContractErrorCode.disposed)
  context.namespace.assertLive?.()
}
/** Admission happens before the FIFO; accepted work keeps its original place during closing. */
function runStorageLog<R>(context: IStorageLogContext, work: () => R | PromiseLike<R>): Promise<R> {
  try {
    admitStorageLog(context)
  } catch (cause) {
    return Promise.reject(cause)
  }
  return context.limiter.run(() => {
    if (context.failure !== undefined) throw context.failure
    context.namespace.assertLive?.()
    return work()
  })
}
/** Any uncertain physical write seals this handle; reopening reads the single durable head. */
async function writeStorageLog<R>(
  context: IStorageLogContext,
  work: (view: IStorageJournalNamespaceView, beforeWrite: () => void) => Promise<R>,
  committed?: (value: R) => void
): Promise<R> {
  /** Native admission can reject before the protocol performs any private I/O. */
  let entered = false
  /** Only a physical write attempt can leave a candidate or an unconfirmed head behind. */
  let writing = false
  try {
    const operation = (view: IStorageJournalNamespaceView) => {
      entered = true
      return work(view, () => {
        writing = true
      })
    }
    if (context.hasCommittedPort && committed !== undefined)
      return await context.namespace.runCommitted!(operation, committed)
    const value = await context.namespace.run(operation)
    committed?.(value)
    return value
  } catch (cause) {
    if (!entered) {
      if (isStorageErrorFamily(cause) || cause instanceof PluginHostError) throw cause
      throw new StorageError(StorageErrorCode.extensionFailed, { cause })
    }
    if (!writing) throw journalFailure(cause)
    context.failure = journalFailure(cause)
    throw context.failure
  }
}
/** Publish all same-attempt batches after their original native owner has actually committed. */
function publishStorageLogPlans(
  context: IStorageLogContext,
  plans: readonly IStorageLogAppend[]
): void {
  let count = 0
  let lastSeq = 0
  for (const plan of plans) {
    if (plan.batch.length === 0) continue
    if (context.indexExclusive) context.index!.applyAppend(plan.batch)
    lastSeq = plan.head.lastSeq
    count += plan.batch.length
  }
  if (count === 0) return
  try {
    context.appended.publish({ lastSeq, count })
  } catch (cause) {
    reportCleanupError(context.report, cause)
  }
}
/** One authenticated native attempt owns its pending plans and original terminal observers. */
class StorageLogPendingAttempt {
  /** The enclosing log's exact namespace, index and notice channel remain the sole owners. */
  readonly #context: IStorageLogContext
  /** Native authentication, not caller labels, supplies the attempt identity. */
  readonly #id: string
  /** The first real native head read is shared by concurrent batches in this attempt. */
  readonly #ready = deferred<void>()
  /** Each batch advances only this authentic attempt's current prepared head. */
  #head: IStorageLogHead | undefined
  /** Committed native plans publish together after their original owner completes. */
  readonly #plans: IStorageLogAppend[] = []
  /** The original terminal subscriptions are removed at the same native completion. */
  #offCommit = () => undefined as void
  /** Rollback shares the same original subscription cleanup. */
  #offRollback = () => undefined as void
  /** Register the actual native terminal before starting its one head read. */
  constructor(context: IStorageLogContext, scope: Omit<ITransactionScope, 'use'>, id: string) {
    this.#context = context
    this.#id = id
    try {
      this.#offCommit = context.namespace.onCommit(scope, () => {
        this.#release()
        publishStorageLogPlans(context, this.#plans)
      })
      this.#offRollback = context.namespace.onRollback(scope, () => this.#release())
      context.pending.set(id, this)
      void context.namespace.run(readStorageLogHead, scope).then((current) => {
        this.#head = current
        this.#ready.resolve()
      }, this.#ready.reject)
    } catch (cause) {
      this.#release()
      throw cause
    }
  }
  /** Finish only the attempt's original map row and subscriptions, without a new lease protocol. */
  #release(): void {
    this.#context.pending.delete(this.#id)
    this.#offCommit()
    this.#offRollback()
  }
  /** Snapshot caller records before the shared head Promise yields; native requests stay together. */
  append(view: IStorageJournalNamespaceView, input: Parameters<ILogAppendPort['append']>[0]) {
    const captured = snapshotLogRecords(input)
    return this.#ready.promise.then(() => {
      const plan = prepareStorageLogAppend(this.#head!, captured)
      if (plan.batch.length !== 0) {
        this.#head = plan.head
        this.#plans.push(plan)
      }
      return persistStorageLogAppend(view, plan, undefined, true).then(() =>
        plan.batch.map((row) => row.seq)
      )
    })
  }
}
/** Native ports bypass ordinary FIFO while authentication and completion remain namespace-owned. */
function createStorageLogPort(
  context: IStorageLogContext,
  scope: Omit<ITransactionScope, 'use'>
): ILogAppendPort {
  admitStorageLog(context)
  if (!context.nativeAtomic || !context.hasCommittedPort)
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  const info = context.namespace.transactionInfo(scope)
  return {
    store: context.store!,
    append: (input) => {
      try {
        admitStorageLog(context)
        if (context.namespace.transactionInfo(scope).id !== info.id)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        const pending =
          context.pending.get(info.id) ?? new StorageLogPendingAttempt(context, scope, info.id)
        return context.namespace.run((view) => pending.append(view, input), scope)
      } catch (cause) {
        return Promise.reject(cause)
      }
    },
    onCommit: (effect) => context.namespace.onCommit(scope, effect),
    onRollback: (effect) => context.namespace.onRollback(scope, effect)
  }
}
/** Fixed public methods use explicit state; only short native-I/O callbacks close over each call. */
/** Execute only the original append job using this log resource's explicit context. */
function appendStorageLogRecords(
  context: IStorageLogContext,
  input: Parameters<ILogStore['append']>[0]
) {
  let captured: ReturnType<typeof snapshotLogRecords>
  try {
    admitStorageLog(context)
    captured = snapshotLogRecords(input)
  } catch (cause) {
    return Promise.reject(cause)
  }
  return runStorageLog(context, async () => {
    if (captured.length === 0) return []
    /** Pure logger admission precedes native wrapping and consults its clock exactly once. */
    const prepared = context.indexExclusive ? prepareLogAppend(captured, context.index!) : undefined
    const plan = await writeStorageLog(
      context,
      async (view, beforeWrite) => {
        /** Nonexclusive admission and preparation share the backend's actual write transaction. */
        const current = context.indexExclusive
          ? prepared
          : prepareLogAppend(captured, await recoverStorageLog(view))
        return appendStorageLog(view, captured, current, beforeWrite)
      },
      (plan) => publishStorageLogPlans(context, [plan])
    )
    return plan.batch.map((row) => row.seq)
  })
}

/** Execute only the original read job using this log resource's explicit context. */
function readStorageLogRecords(context: IStorageLogContext, fromSeq: number, limit: number) {
  try {
    assertLogInteger(fromSeq)
    assertLogInteger(limit, 0)
  } catch (cause) {
    return Promise.reject(cause)
  }
  return runStorageLog(context, () =>
    context.indexExclusive
      ? context.index!.read(fromSeq, limit)
      : context.namespace.run(async (view) =>
          createLogStoreIndex(await recoverStorageLog(view)).read(fromSeq, limit)
        )
  )
}

/** Execute only the original lastSeq job using this log resource's explicit context. */
function lastStorageLogSequence(context: IStorageLogContext) {
  return runStorageLog(context, () =>
    context.indexExclusive
      ? context.index!.lastSeq
      : context.namespace.run(async (view) => (await recoverStorageLog(view)).lastSeq)
  )
}

/** Execute only the original onAppend job using this log resource's explicit context. */
function subscribeStorageLogAppend(
  context: IStorageLogContext,
  listener: Parameters<ILogStore['onAppend']>[0]
) {
  admitStorageLog(context)
  if (typeof listener !== 'function')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return context.appended.subscribe((event) => listener(event.value))
}

/** Execute only the original truncate job using this log resource's explicit context. */
function truncateStorageLogRecords(context: IStorageLogContext, beforeSeq: number) {
  try {
    assertLogInteger(beforeSeq)
  } catch (cause) {
    return Promise.reject(cause)
  }
  return runStorageLog(context, async () => {
    if (context.indexExclusive && !context.index!.checkTruncate(beforeSeq)) return
    const truncated = await writeStorageLog(
      context,
      async (view, beforeWrite) => {
        if (
          !context.indexExclusive &&
          !createLogStoreIndex(await recoverStorageLog(view)).checkTruncate(beforeSeq)
        )
          return undefined
        return truncateStorageLog(view, beforeSeq, beforeWrite)
      },
      () => {
        if (context.indexExclusive) context.index!.applyTruncate(beforeSeq)
      }
    )
    if (truncated === undefined) return
    /**
     * A peer may append after the floor commits; cleanup must use this transaction's current
     * head.
     */
    await writeStorageLog(context, async (view, beforeWrite) =>
      reclaimStorageLogRows(
        view,
        context.indexExclusive ? truncated : await readStorageLogHead(view),
        beforeWrite
      )
    )
  })
}

/** Execute only the original setState job using this log resource's explicit context. */
function updateStorageLogState(
  context: IStorageLogContext,
  seq: number,
  state: Parameters<ILogStore['setState']>[1]
) {
  try {
    assertLogInteger(seq)
    if (!Object.values(LogRecordState).includes(state))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  } catch (cause) {
    return Promise.reject(cause)
  }
  return runStorageLog(context, async () => {
    if (context.indexExclusive && !context.index!.checkState(seq, state)) return
    await writeStorageLog(
      context,
      async (view, beforeWrite) => {
        if (
          !context.indexExclusive &&
          !createLogStoreIndex(await recoverStorageLog(view)).checkState(seq, state)
        )
          return
        await setStorageLogState(view, seq, state, beforeWrite)
      },
      () => {
        if (context.indexExclusive) context.index!.applyState(seq, state)
      }
    )
  })
}

/** Execute only the original states job using this log resource's explicit context. */
function readStorageLogStates(
  context: IStorageLogContext,
  filter: Parameters<ILogStore['states']>[0]
) {
  return filter !== LogRecordState.pending
    ? Promise.reject(new StorageContractError(StorageContractErrorCode.invalidArgument))
    : runStorageLog(context, () =>
        context.indexExclusive
          ? context.index!.pending()
          : context.namespace.run(async (view) =>
              createLogStoreIndex(await recoverStorageLog(view)).pending()
            )
      )
}

/** Execute only the original dispose job using this log resource's explicit context. */
function disposeStorageLog(context: IStorageLogContext) {
  if (context.main !== undefined) return context.main
  const completion = deferred<void>()
  context.main = completion.promise
  context.accepting = false
  void (async () => {
    await context.limiter.whenIdle()
    context.limiter.close()
    try {
      await context.namespace.dispose()
    } finally {
      context.appended.clear()
      context.index = undefined
      context.forget()
    }
  })().then(completion.resolve, completion.reject)
  return context.main
}

/** Execute only the original Symbol.asyncDispose job using this log resource's explicit context. */
function disposeStorageLogSymbolically(context: IStorageLogContext) {
  if (context.symbolic !== undefined) return context.symbolic
  const completion = deferred<void>()
  context.symbolic = completion.promise
  void context.store!.dispose().then(completion.resolve, (cause) => {
    reportCleanupError(context.report, cause)
    completion.resolve()
  })
  return context.symbolic
}
/** Fixed public ports preserve the original table shape and route each job to its state owner. */
function createStorageLogApi(context: IStorageLogContext): ILogStore {
  return {
    append: (input) => appendStorageLogRecords(context, input),
    read: (fromSeq, limit) => readStorageLogRecords(context, fromSeq, limit),
    lastSeq: () => lastStorageLogSequence(context),
    onAppend: (listener) => subscribeStorageLogAppend(context, listener),
    truncate: (beforeSeq) => truncateStorageLogRecords(context, beforeSeq),
    setState: (seq, state) => updateStorageLogState(context, seq, state),
    states: (filter) => readStorageLogStates(context, filter),
    dispose: () => disposeStorageLog(context),
    [Symbol.asyncDispose]: () => disposeStorageLogSymbolically(context)
  }
}

/** Open only an authenticated fixed-org namespace, then publish and retain its original log API. */
export async function openStorageLogStore(
  access: IStorageJournalBackendAccess,
  prefix: string
): Promise<ILogStore> {
  const context = await prepareStorageLogContext(access, prefix)
  context.store = createStorageLogApi(context)
  /** The closure verifies this exact object even if a caller copies an enumerable symbol manually. */
  const nativeAccess: IStorageLogNativeAccess = {
    matches: (candidate: IStorageJournalBackendAccess) =>
      candidate.registration === context.access.registration &&
      candidate.orgId === context.access.orgId &&
      candidate.backendInstanceId === context.access.backendInstanceId,
    orgId: context.access.orgId,
    backendInstanceId: context.access.backendInstanceId,
    headLock: storageJournalLockKey(context.prefix, StorageJournalLock.head),
    createPort: (scope) => createStorageLogPort(context, scope)
  }
  Object.defineProperty(context.store, storageLogNativeAccess, {
    value: (candidate: ILogStore) => {
      if (candidate !== context.store)
        throw new StorageContractError(StorageContractErrorCode.unsupported)
      return nativeAccess
    }
  })
  try {
    context.forget = context.access.retain(context.store)
  } catch (cause) {
    try {
      await context.store!.dispose()
    } catch (cleanup) {
      reportCleanupError(context.report, cleanup)
    }
    throw cause
  }
  return context.store
}
