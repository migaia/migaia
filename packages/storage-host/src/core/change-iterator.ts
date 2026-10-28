import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertOperationContext,
  assertStringStorageKey,
  type IStorageChange,
  type IStorageIterator,
  type IOperationContext,
  type IOperationContextSnapshot
} from '@migaia/storage-contract'
import { createStorageIteratorLifetime } from '../authoring/resource.ts'
import { deferred, type IDeferred } from '@migaia/utils/promise'
import type { IBackendChangeController } from './change-controller.ts'
import { mergeSignals, subscribeToAbort, throwIfAborted } from './operation.ts'
import { createStorageOperationReporter } from './operation-reporter.ts'

/** The bridge validates the original public channel domain in one local admission table. */
const changeChannels = ['value', 'bytes', 'record', 'all'] as const
/** Coalesced invalidations deliberately omit narrower key and entity-scope claims. */
const broadChannel = changeChannels[3]

/**
 * Streams the original controller's invalidations through its existing iterator resource owner. One
 * unconsumed slot coalesces multiple events to the latest sequence's broad invalidation. This is
 * not replay or an event queue; the backend retains its original per-next execution pipeline.
 */

/** One change iterator owns its coalesced slot and native subscription handles. */
type IBackendChangeIteratorContext = {
  /** Original controller is captured before native construction begins. */
  readonly controller: IBackendChangeController
  /** Original options is captured before native construction begins. */
  readonly options: {
    readonly orgId: string
    readonly channel: IStorageChange['channel']
    readonly key?: string
    readonly ctx?: IOperationContext
    readonly execute?: (
      advance: () => Promise<IteratorResult<IStorageChange>>,
      context: IOperationContextSnapshot | undefined
    ) => Promise<IteratorResult<IStorageChange>>
  }

  /** Scalar filters remain stable across asynchronous change delivery. */
  captured: IBackendChangeIteratorContext['options']

  /** Original diagnostics and deadline/signal cleanup stay on their canonical host helpers. */
  report: ReturnType<typeof createStorageOperationReporter>

  /** This one context snapshot is passed to the original pipeline on every accepted next. */
  merged: ReturnType<typeof mergeSignals>

  /** A single pending invalidation bounds idle-consumer storage independently of event count. */
  slot: IStorageChange | undefined

  /** The native generator alone serializes next calls; this deferred only wakes its current read. */
  wake: IDeferred<void> | undefined

  /** Cancellation retains the first error even when closure follows it. */
  failed: boolean

  /** Rejected undefined values remain distinguishable from an ordinary completed iterator. */
  failure: unknown

  /** Cleanup closures are assigned before any synchronous abort callback can schedule cleanup. */
  off: () => void

  /** Caller cancellation detaches with the same original resource cleanup. */
  stopContext: () => void

  /** Controller closure invalidates every native organization view without a resource registry. */
  stopClosing: () => void

  /** Original lifetime owns accepted native advances and both cached cleanup promises. */
  lifetime: ReturnType<typeof createStorageIteratorLifetime<IStorageChange>>

  /** Native async-generator serialization adds no backend queue or retry state. */
  native: AsyncGenerator<IStorageChange, void, unknown>
}
export type IBackendChangeIteratorOptions = {
  readonly orgId: string
  readonly channel: IStorageChange['channel']
  readonly key?: string
  readonly ctx?: IOperationContext
  readonly execute?: (
    advance: () => Promise<IteratorResult<IStorageChange>>,
    context: IOperationContextSnapshot | undefined
  ) => Promise<IteratorResult<IStorageChange>>
}

/** Construct a change feed only when its backend explicitly selects this iterator owner. */
export function createBackendChangeIterator(
  controller: IBackendChangeController,
  options: IBackendChangeIteratorOptions
): IStorageIterator<IStorageChange> {
  /** Initialize native facts in original construction order before publishing any port. */
  const iteratorState = { controller, options } as IBackendChangeIteratorContext

  admitChangeIterator(iteratorState)
  initializeChangeIterator(iteratorState)
  subscribeChangeIterator(iteratorState)
  return createChangeIteratorMethods(iteratorState)
}

/** Capture scalar filters before asynchronous delivery, then validate through canonical owners. */
function admitChangeIterator(iteratorState: IBackendChangeIteratorContext): void {
  iteratorState.controller.assertLive()

  iteratorState.captured = {
    orgId: iteratorState.options.orgId,
    channel: iteratorState.options.channel,
    key: iteratorState.options.key,
    ctx: iteratorState.options.ctx,
    execute: iteratorState.options.execute
  }
  assertOperationContext({ orgId: iteratorState.captured.orgId })
  if (iteratorState.captured.key !== undefined)
    assertStringStorageKey(iteratorState.captured.key, iteratorState.controller.snapshot.backend)
  if (
    !changeChannels.includes(iteratorState.captured.channel) ||
    (iteratorState.captured.execute !== undefined &&
      typeof iteratorState.captured.execute !== 'function')
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
}

/** Install the original lifetime and generator after synchronous admission. */
function initializeChangeIterator(iteratorState: IBackendChangeIteratorContext): void {
  /** Original diagnostics and deadline/signal cleanup stay on their canonical host helpers. */
  iteratorState.report = createStorageOperationReporter()

  /** This one context snapshot is passed to the original pipeline on every accepted next. */
  iteratorState.merged = mergeSignals(iteratorState.captured.ctx, iteratorState.report)

  try {
    throwIfAborted(iteratorState.merged.signal)
  } catch (cause) {
    iteratorState.merged.dispose()
    throw cause
  }

  /** Cancellation retains the first error even when closure follows it. */
  iteratorState.failed = false

  /** Cleanup closures are assigned before any synchronous abort callback can schedule cleanup. */
  Object.assign(iteratorState, {
    off: () => undefined,
    /** Caller cancellation detaches with the same original resource cleanup. */
    stopContext: () => undefined,
    /** Controller closure invalidates every native organization view without a resource registry. */
    stopClosing: () => undefined
  })

  /** Original lifetime owns accepted native advances and both cached cleanup promises. */
  iteratorState.lifetime = createStorageIteratorLifetime<IStorageChange>({
    close: async () => {
      iteratorState.off()
      iteratorState.stopContext()
      iteratorState.stopClosing()
      iteratorState.merged.dispose()
      await iteratorState.native.return(undefined)
    },
    report: iteratorState.report
  })

  /** Native async-generator serialization adds no backend queue or retry state. */
  iteratorState.native = iterateBackendChanges(iteratorState)
}

/** Acquire native subscriptions with rollback through the existing iterator lifetime. */
function subscribeChangeIterator(iteratorState: IBackendChangeIteratorContext): void {
  try {
    iteratorState.off = iteratorState.controller.subscribe((change) => {
      if (
        iteratorState.lifetime.isClosing() ||
        (change.orgId !== iteratorState.captured.orgId &&
          !(change.kind === 'reset' && change.orgId === undefined))
      )
        return
      if (
        iteratorState.captured.channel !== broadChannel &&
        change.channel !== broadChannel &&
        change.channel !== iteratorState.captured.channel
      )
        return
      if (
        iteratorState.captured.key !== undefined &&
        change.keys !== undefined &&
        change.channel !== broadChannel &&
        !change.keys.some((key) => key === iteratorState.captured.key)
      )
        return
      iteratorState.slot =
        iteratorState.slot === undefined
          ? change
          : { ...change, channel: broadChannel, keys: undefined, scope: undefined }
      iteratorState.wake?.resolve()
    })
    iteratorState.stopContext = subscribeToAbort(
      iteratorState.merged.signal,
      () => {
        try {
          throwIfAborted(iteratorState.merged.signal)
        } catch (cause) {
          fail(iteratorState, cause)
        }
      },
      iteratorState.report
    )
    iteratorState.stopClosing = subscribeToAbort(
      iteratorState.controller.closingSignal,
      () => {
        try {
          iteratorState.controller.assertLive()
        } catch (cause) {
          fail(iteratorState, cause)
        }
      },
      iteratorState.report
    )
  } catch (cause) {
    void close(iteratorState).catch(iteratorState.report)
    throw cause
  }
}

/** Wake accepted reads before the original lifetime waits for them to drain. */
function close(iteratorState: IBackendChangeIteratorContext): Promise<void> {
  iteratorState.slot = undefined
  iteratorState.wake?.resolve()
  return iteratorState.lifetime.dispose()
}

/** Cancellation first records its own boundary, then follows ordinary symbolic cleanup/reporting. */
function fail(iteratorState: IBackendChangeIteratorContext, cause: unknown): void {
  if (!iteratorState.failed && !iteratorState.lifetime.isClosing()) {
    iteratorState.failed = true
    iteratorState.failure = cause
  }
  void close(iteratorState)
  void iteratorState.lifetime.symbolic()
}
/** Publish change-iterator ports over their original canonical lifetime. */
function createChangeIteratorMethods(
  iteratorState: IBackendChangeIteratorContext
): IStorageIterator<IStorageChange> {
  return {
    next: () => {
      if (iteratorState.failed) return Promise.reject(iteratorState.failure)
      if (iteratorState.lifetime.isClosing()) return iteratorState.lifetime.returned()
      /** The original owner retains the complete pipeline Promise, including pre-native awaits. */
      return iteratorState.lifetime.advance(async () => {
        /** A late continuation must settle directly instead of waiting on its own cleanup. */
        const advance = async (): Promise<IteratorResult<IStorageChange>> => {
          if (iteratorState.failed) throw iteratorState.failure
          if (iteratorState.lifetime.isClosing()) return { done: true, value: undefined }
          return iteratorState.native.next()
        }
        return iteratorState.options.execute === undefined
          ? advance()
          : iteratorState.options.execute(advance, iteratorState.merged.context)
      })
    },
    return: (value) => {
      void close(iteratorState)
      return iteratorState.lifetime.returned(value)
    },
    dispose: () => close(iteratorState),
    [asyncDisposeKey]: () => {
      void close(iteratorState)
      return iteratorState.lifetime.symbolic()
    },
    [Symbol.asyncIterator]() {
      return this
    }
  }
}

/** Native async-generator serialization alone queues accepted change reads. */
async function* iterateBackendChanges(
  iteratorState: IBackendChangeIteratorContext
): AsyncGenerator<IStorageChange, void, unknown> {
  for (;;) {
    if (iteratorState.failed) throw iteratorState.failure
    if (iteratorState.lifetime.isClosing()) return
    if (iteratorState.slot !== undefined) {
      /** Clearing before yield lets reentrant publications occupy the same one slot. */
      const change = iteratorState.slot
      iteratorState.slot = undefined
      yield change
    } else {
      iteratorState.wake = deferred<void>()
      await iteratorState.wake.promise
      iteratorState.wake = undefined
    }
  }
}
