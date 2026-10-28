import { createAbortController, type IAbortController } from '@migaia/lifecycle'
import { observeAbortSubscription, type IObservedAbortSubscription } from '@migaia/lifecycle/abort'
import { observeThenableRejection } from '@migaia/utils/function'
import {
  createConcurrencyLimiter,
  deferred,
  type IAbortSignal,
  type IConcurrencyLimiter
} from '@migaia/utils/promise'
import {
  snapshotOperationContext,
  snapshotRecordStore,
  resolveConcurrencyPolicy,
  runWithConcurrency
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContext,
  type IRecordStore,
  type ITransactionOptions,
  type IConcurrencyAttemptContext,
  type IConcurrencyAttempt
} from '@migaia/storage-contract'
import type { IPersistHandle, IPersistStorage } from './types.ts'
import { createStorePersistTypeError } from '../errors.ts'
import { StorePersistErrorCode } from '../error-code.ts'
import { StorePersistErrorText } from '../error-text.ts'
import { snapshotPersistOptions } from './options.ts'

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

/** Cleanup diagnostics use the original host reporting queue without replacing transaction results. */
function reportCoordinationFailure(cause: unknown): void {
  observeThenableRejection(undefined, { error: cause }, (error) => {
    throw error
  })
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
  const options = ctx === undefined ? {} : snapshotPersistOptions(ctx as object)
  /** Common timing validation reuses the contract owner, without dropping concrete extra fields. */
  const timing = snapshotOperationContext(options as IOperationContext | undefined)
  /** Only the original transaction registration supplies a default or validates an override. */
  const policy = resolveConcurrencyPolicy(
    admitted.store,
    (options as ITransactionOptions).concurrency
  )
  /** Disposal only cancels this coordination; the backend signal owns actual native rollback. */
  const controller: IAbortController = createAbortController()
  /** A private cancellation reason distinguishes disposal from an arbitrary outside signal reason. */
  let disposalReason: unknown
  /** This borrowed listener relays external abort; the contract loop alone owns deadline and waits. */
  let externalAbort: IObservedAbortSubscription | undefined
  try {
    if (timing?.signal !== undefined) {
      try {
        externalAbort = observeAbortSubscription(
          timing.signal,
          (reason) => controller.abort(reason),
          reportCoordinationFailure
        )
      } catch (cause) {
        throw createStorePersistTypeError(
          StorePersistErrorCode.invalidOption,
          StorePersistErrorText.optionsObject,
          { cause }
        )
      }
      externalAbort.retryRegistrationCleanup()
    }
    return await runWithConcurrency<Awaited<TResult>>(
      { store: admitted.store, options: { ...options, signal: controller.signal }, policy },
      { attempt: execute }
    )
  } catch (cause) {
    if (
      disposalReason !== undefined &&
      cause instanceof Error &&
      (cause as { readonly code?: unknown }).code === StorageContractErrorCode.aborted &&
      cause.cause === disposalReason
    )
      throw disposalReason
    throw cause
  } finally {
    externalAbort?.unsubscribe()
  }

  /** Slots and attachment state remain owned until the delegated transaction actually ends. */
  async function execute(
    context: IConcurrencyAttemptContext
  ): Promise<IConcurrencyAttempt<Awaited<TResult>>> {
    /** The original loop always receives the disposal signal, including when no deadline exists. */
    const signal = context.signal!
    /** This controller only removes this attempt's actual utility waiter after cancellation/timeout. */
    const queueController = createAbortController()
    /** Queue cancellation follows the original combined signal without creating a deadline. */
    const queueAbort = observeAbortSubscription(
      signal,
      (reason) => queueController.abort(reason),
      reportCoordinationFailure
    )
    queueAbort.retryRegistrationCleanup()
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
        /** Free slots start immediately; only an actual conflict enters the original policy loop. */
        const busy = participant.limiter.activeCount !== 0
        if (busy && context.admission === 'try')
          return {
            status: 'conflict',
            phase: 'acquire',
            keys: context.lock ?? [],
            holder: undefined
          }
        /** The utility limiter owns queue cancellation and FIFO scheduling. */
        const acquired = deferred<void>()
        /** This task owns exactly one slot until native transaction completion. */
        const released = deferred<void>()
        /** A rejected waiter resolves this handshake so the loop never receives a late rejection. */
        let admissionFailure: { readonly cause: unknown } | undefined
        /** The original limiter alone owns FIFO queueing and eventual slot task completion. */
        const done = participant.limiter.run(
          async () => {
            acquired.resolve()
            await released.promise
          },
          { signal: queueController.signal }
        )
        held.push({ release: () => released.resolve(), done })
        void done.then(undefined, (cause) => {
          admissionFailure = { cause }
          acquired.resolve()
        })
        if (busy) await context.wait(acquired.promise)
        else await acquired.promise
        if (admissionFailure !== undefined) throw admissionFailure.cause
        assertNotAborted()
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
      assertNotAborted()
      /** The existing store method owns callback execution, transaction views, commit and rollback. */
      const result = (await Reflect.apply(store.transaction, store, [
        (scope: ITransactionScopeOf<TStore>) => {
          assertNotAborted()
          for (const participant of paused) participant.bind(scope as object, admitted!.store)
          return run(scope)
        },
        context
      ])) as Awaited<TResult>
      committed = true
      return { status: 'committed', value: result }
    } catch (cause) {
      failure = cause
      queueController.abort(cause)
      throw cause
    } finally {
      try {
        for (let index = paused.length - 1; index >= 0; index--) {
          try {
            paused[index]!.finish(committed, failure)
          } catch (cause) {
            // Restoring a background schedule cannot replace the actual transaction's outcome.
            reportCoordinationFailure(cause)
          }
        }
      } finally {
        for (let index = held.length - 1; index >= 0; index--) held[index]!.release()
        try {
          /** Queued cancellation is acknowledged here before the next policy attempt can start. */
          await Promise.allSettled(held.map((slot) => slot.done))
        } finally {
          queueAbort.unsubscribe()
          completion.resolve()
        }
      }
    }

    /** Cancellation before native admission retains the same original reason on a coded boundary. */
    function assertNotAborted(): void {
      if (signal.aborted)
        throw new StorageContractError(StorageContractErrorCode.aborted, { cause: signal.reason })
    }
  }
}
