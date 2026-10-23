import { createAbortController, type IAbortController } from '@migaia/lifecycle'
import { observeThenableRejection } from '@migaia/utils/function'
import {
  createConcurrencyLimiter,
  createAbortTimeoutSignal,
  deferred,
  raceWithAbort,
  UtilsAbortError,
  type IAbortSignal,
  type IConcurrencyLimiter
} from '@migaia/utils/promise'
import {
  snapshotOperationContext,
  snapshotRecordStore,
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContext,
  type IRecordStore
} from '@migaia/storage-contract'
import type { IPersistHandle, IPersistStorage } from './types.js'
import { createStorePersistTypeError } from '../errors.js'
import { StorePersistErrorCode } from '../error-code.js'
import { StorePersistErrorText } from '../error-text.js'
import { snapshotPersistOptions } from './options.js'

/** Concrete transaction methods retain their own scope and option types through extraction. */
type IPersistTransactionStore = Omit<IRecordStore, 'use' | 'transaction' | 'tx'> & {
  transaction(run: (scope: unknown) => unknown, ...options: never[]): PromiseLike<unknown>
}

/** Extracts the original backend scope, including its concrete native and Feature extensions. */
export type ITransactionScopeOf<TStore extends IPersistTransactionStore> = Parameters<
  Parameters<TStore['transaction']>[0]
>[0]

/**
 * One attachment borrows the coordinator's cancellation and actual completion, never its scope
 * owner.
 */
export type IPersistParticipationControl = Readonly<{
  signal: IAbortSignal
  abort: (reason: unknown) => void
  completion: Promise<void>
}>

/** Private attachment callbacks coordinate existing scheduling without creating another transaction. */
export type IPersistTransactionParticipant = Readonly<{
  storage: IPersistStorage
  disposed: () => boolean
  pause: (control: IPersistParticipationControl) => Promise<void>
  bind: (scope: object, store: IRecordStore) => void
  finish: (committed: boolean, error: unknown) => void
}>

/**
 * A per-handle FIFO slot serializes only explicit coordination, before native resources are
 * acquired.
 */
type IRegisteredParticipant = IPersistTransactionParticipant & {
  readonly ordinal: number
  readonly limiter: IConcurrencyLimiter
}

/** Only original engine handles can enlist; copied methods and public fields grant no authority. */
const participants = new WeakMap<IPersistHandle, IRegisteredParticipant>()
/** Creation order bounds sorting by seven bytes rather than the gaps between handle identities. */
let nextOrdinal = 0

/** Registers an original engine handle once; no backend operation or resource admission runs here. */
export function registerPersistTransactionParticipant(
  handle: IPersistHandle,
  participant: IPersistTransactionParticipant
): (reason: unknown) => void {
  /** The original utility queue is closed by the handle without releasing an active slot early. */
  const limiter = createConcurrencyLimiter({ concurrency: 1 })
  participants.set(handle, { ...participant, ordinal: nextOrdinal++, limiter })
  return (reason) => limiter.close(reason)
}

/** Seven stable byte passes order nonnegative safe-integer creation ordinals in linear work. */
function orderParticipants(values: IRegisteredParticipant[]): IRegisteredParticipant[] {
  /** The two buffers exchange ownership after each byte without copying accumulated prefixes. */
  let source = values
  /** One reusable destination holds exactly this call's participating handles. */
  let target = [...values]
  for (let byte = 0; byte < 7; byte++) {
    /** Fixed alphabet counts never depend on historical ordinal gaps. */
    const counts = new Uint32Array(256)
    /** JavaScript arithmetic preserves the upper safe-integer bytes without signed bit shifts. */
    const divisor = 2 ** (byte * 8)
    for (const participant of source) counts[Math.floor(participant.ordinal / divisor) % 256]++
    /** Prefix offsets provide stable placement while the source order remains unchanged. */
    let offset = 0
    for (let index = 0; index < counts.length; index++) {
      /** Capture a bucket's size before replacing it with its destination offset. */
      const count = counts[index]!
      counts[index] = offset
      offset += count
    }
    for (const participant of source) {
      /** Each registered handle occupies one slot in the next stable byte order. */
      const bucket = Math.floor(participant.ordinal / divisor) % 256
      target[counts[bucket]!] = participant
      counts[bucket]++
    }
    ;[source, target] = [target, source]
  }
  return source
}

/** Existing option identity covers enlistment misuse without inventing a new error layer. */
function invalidParticipant(cause?: unknown): TypeError {
  return createStorePersistTypeError(
    StorePersistErrorCode.invalidOption,
    StorePersistErrorText.transactionParticipation,
    { cause }
  )
}

/** Coordinates existing handles before delegating the one native transaction to its original store. */
export async function persistTransaction<const TStore extends IPersistTransactionStore, TResult>(
  store: TStore,
  handles: readonly IPersistHandle[],
  run: (tx: ITransactionScopeOf<TStore>) => TResult,
  ctx?: Parameters<TStore['transaction']>[1]
): Promise<Awaited<TResult>> {
  /** Full structural admission happens before slots, hydration, or native transaction acquisition. */
  const admitted = snapshotRecordStore(store)
  if (!admitted)
    throw createStorePersistTypeError(
      StorePersistErrorCode.backendCapability,
      StorePersistErrorText.transactionBackend
    )
  if (!Array.isArray(handles) || handles.length === 0 || typeof run !== 'function')
    throw invalidParticipant()
  /** Deduplication retains authentic handle identity rather than accepting a structural wrapper. */
  const unique = new Set<IRegisteredParticipant>()
  for (const handle of handles) {
    /** The private engine registration is the only participant authority. */
    const participant = participants.get(handle)
    if (!participant || participant.storage !== store || participant.disposed())
      throw invalidParticipant()
    unique.add(participant)
  }
  /** Stable global ordering prevents reversed handle arrays from taking conflicting slot orders. */
  const ordered = orderParticipants([...unique])
  /** Capture custom option fields once; the backend still owns lock/concurrency policy semantics. */
  const options = ctx === undefined ? undefined : snapshotPersistOptions(ctx as object)
  /** Common timing validation reuses the contract owner, without dropping concrete extra fields. */
  const timing = snapshotOperationContext(options as IOperationContext | undefined)
  /** Disposal only cancels this coordination; the backend signal owns actual native rollback. */
  const controller: IAbortController = createAbortController()
  /** A private cancellation reason distinguishes disposal from an arbitrary outside signal reason. */
  let disposalReason: unknown
  /** One deadline includes slot waiting and draining before the backend starts. */
  const deadline = createAbortTimeoutSignal({
    signal: timing?.signal,
    timeoutMs: timing?.timeoutMs,
    timeoutReason: () => new StorageContractError(StorageContractErrorCode.aborted)
  })
  /**
   * The actual operation remains retained until native completion, even if the abort race settles
   * first.
   */
  let work: Promise<Awaited<TResult>> | undefined
  try {
    return await raceWithAbort(
      ({ signal }) => {
        work = execute(signal)
        return work
      },
      {
        signals:
          deadline.signal === undefined
            ? [controller.signal]
            : [controller.signal, deadline.signal],
        cleanupPolicy: 'report'
      }
    )
  } catch (cause) {
    if (work)
      await work.then(
        () => undefined,
        () => undefined
      )
    if (cause instanceof UtilsAbortError) {
      if (disposalReason !== undefined && cause.cause === disposalReason) throw disposalReason
      throw new StorageContractError(StorageContractErrorCode.aborted, { cause: cause.cause })
    }
    throw cause
  } finally {
    deadline.dispose()
  }

  /** Slots and attachment state remain owned until the delegated transaction actually ends. */
  async function execute(signal: IAbortSignal): Promise<Awaited<TResult>> {
    /** Native completion releases every paused attachment, including failed admission midway. */
    const completion = deferred<void>()
    /** Each held task stays active until its explicit reverse-order release. */
    const held: { readonly release: () => void; readonly done: Promise<void> }[] = []
    /** Only successfully paused handles may be resumed during settlement. */
    const paused: IRegisteredParticipant[] = []
    /** Successful commit alone clears each attachment's transactional write outcome. */
    let committed = false
    /** The actual failure is passed through unchanged after restoring normal scheduling. */
    let failure: unknown
    try {
      for (const participant of ordered) {
        /** The utility limiter owns queue cancellation and FIFO scheduling. */
        const acquired = deferred<void>()
        /** This task owns exactly one slot until native transaction completion. */
        const released = deferred<void>()
        /** Failure while queued rejects acquisition before any participant or native work starts. */
        const done = participant.limiter.run(
          async () => {
            acquired.resolve()
            await released.promise
          },
          { signal }
        )
        void done.then(undefined, acquired.reject)
        await acquired.promise
        held.push({ release: () => released.resolve(), done })
        if (signal.aborted) throw signal.reason
        if (participant.disposed()) throw invalidParticipant()
        paused.push(participant)
        await participant.pause({
          signal,
          abort: (reason) => {
            disposalReason = reason
            controller.abort(reason)
          },
          completion: completion.promise
        })
      }
      if (signal.aborted) throw signal.reason
      /**
       * Complete options survive intact; the combined signal includes handle disposal and the
       * original deadline.
       */
      const nativeOptions = { ...options, signal }
      /** The existing store method owns callback execution, transaction views, commit and rollback. */
      const result = (await Reflect.apply(store.transaction, store, [
        (scope: ITransactionScopeOf<TStore>) => {
          if (signal.aborted) throw signal.reason
          for (const participant of paused) participant.bind(scope as object, admitted!.store)
          return run(scope)
        },
        nativeOptions
      ])) as Awaited<TResult>
      committed = true
      return result
    } catch (cause) {
      failure = cause
      throw cause
    } finally {
      try {
        for (let index = paused.length - 1; index >= 0; index--) {
          try {
            paused[index]!.finish(committed, failure)
          } catch (cause) {
            // Restoring a background schedule cannot replace the actual transaction's outcome.
            observeThenableRejection(undefined, { error: cause }, (error) => {
              throw error
            })
          }
        }
      } finally {
        for (let index = held.length - 1; index >= 0; index--) held[index]!.release()
        try {
          await Promise.all(held.map((slot) => slot.done))
        } finally {
          completion.resolve()
        }
      }
    }
  }
}
