import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  StorageContractError,
  StorageContractErrorCode,
  createStorageIteratorLifetime,
  assertOperationContext,
  assertStringStorageKey,
  type IStorageChange,
  type IStorageIterator,
  type IOperationContext,
  type IOperationContextSnapshot
} from '@migaia/storage-contract'
import { deferred, type IDeferred } from '@migaia/utils/promise'
import type { IBackendChangeController } from './change-controller.js'
import { mergeSignals, subscribeToAbort, throwIfAborted } from './operation.js'
import { isStorageErrorFamily } from './error-family.js'
import { createStorageOperationReporter } from './operation-reporter.js'

/** The bridge validates the original public channel domain in one local admission table. */
const changeChannels = ['value', 'bytes', 'record', 'all'] as const
/** Coalesced invalidations deliberately omit narrower key and entity-scope claims. */
const broadChannel = changeChannels[3]

/**
 * Streams the original controller's invalidations through its existing iterator resource owner. One
 * unconsumed slot coalesces multiple events to the latest sequence's broad invalidation. This is
 * not replay or an event queue; the backend retains its original per-next execution pipeline.
 */
export function createBackendChangeIterator(
  controller: IBackendChangeController,
  options: {
    readonly orgId: string
    readonly channel: IStorageChange['channel']
    readonly key?: string
    readonly ctx?: IOperationContext
    readonly execute?: (
      advance: () => Promise<IteratorResult<IStorageChange>>,
      context: IOperationContextSnapshot | undefined
    ) => Promise<IteratorResult<IStorageChange>>
  }
): IStorageIterator<IStorageChange> {
  controller.assertLive()
  /** Public author fields detach once before a subscription or timer can be acquired. */
  let captured: typeof options
  try {
    captured = {
      orgId: options.orgId,
      channel: options.channel,
      key: options.key,
      ctx: options.ctx,
      execute: options.execute
    }
    assertOperationContext({ orgId: captured.orgId })
    if (captured.key !== undefined)
      assertStringStorageKey(captured.key, controller.snapshot.backend)
    if (
      !changeChannels.includes(captured.channel) ||
      (captured.execute !== undefined && typeof captured.execute !== 'function')
    )
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  } catch (cause) {
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
  /** Original diagnostics and deadline/signal cleanup stay on their canonical host helpers. */
  const report = createStorageOperationReporter()
  /** This one context snapshot is passed to the original pipeline on every accepted next. */
  const merged = mergeSignals(captured.ctx, report)
  try {
    throwIfAborted(merged.signal)
  } catch (cause) {
    merged.dispose()
    throw cause
  }
  /** A single pending invalidation bounds idle-consumer storage independently of event count. */
  let slot: IStorageChange | undefined
  /** The native generator alone serializes next calls; this deferred only wakes its current read. */
  let wake: IDeferred<void> | undefined
  /** Cancellation retains the first error even when closure follows it. */
  let failed = false
  /** Rejected undefined values remain distinguishable from an ordinary completed iterator. */
  let failure: unknown
  /** Cleanup closures are assigned before any synchronous abort callback can schedule cleanup. */
  let off: () => void = () => undefined
  /** Caller cancellation detaches with the same original resource cleanup. */
  let stopContext: () => void = () => undefined
  /** Controller closure invalidates every native organization view without a resource registry. */
  let stopClosing: () => void = () => undefined
  /** Original lifetime owns accepted native advances and both cached cleanup promises. */
  const lifetime = createStorageIteratorLifetime<IStorageChange>({
    close: async () => {
      off()
      stopContext()
      stopClosing()
      merged.dispose()
      await native.return(undefined)
    },
    report
  })
  /** Native async-generator serialization adds no backend queue or retry state. */
  const native = (async function* () {
    for (;;) {
      if (failed) throw failure
      if (lifetime.isClosing()) return
      if (slot !== undefined) {
        /** Clearing before yield lets reentrant publications occupy the same one slot. */
        const change = slot
        slot = undefined
        yield change
      } else {
        wake = deferred<void>()
        await wake.promise
        wake = undefined
      }
    }
  })()
  /** Wake accepted reads before the original lifetime waits for them to drain. */
  const close = (): Promise<void> => {
    slot = undefined
    wake?.resolve()
    return lifetime.dispose()
  }
  /** Cancellation first records its own boundary, then follows ordinary symbolic cleanup/reporting. */
  const fail = (cause: unknown): void => {
    if (!failed && !lifetime.isClosing()) {
      failed = true
      failure = cause
    }
    void close()
    void lifetime.symbolic()
  }
  try {
    off = controller.subscribe((change) => {
      if (lifetime.isClosing() || change.orgId !== captured.orgId) return
      if (
        captured.channel !== broadChannel &&
        change.channel !== broadChannel &&
        change.channel !== captured.channel
      )
        return
      if (
        captured.key !== undefined &&
        change.keys !== undefined &&
        change.channel !== broadChannel &&
        !change.keys.some((key) => key === captured.key)
      )
        return
      slot =
        slot === undefined
          ? change
          : Object.freeze({ ...change, channel: broadChannel, keys: undefined, scope: undefined })
      wake?.resolve()
    })
    stopContext = subscribeToAbort(
      merged.signal,
      () => {
        try {
          throwIfAborted(merged.signal)
        } catch (cause) {
          fail(cause)
        }
      },
      report
    )
    stopClosing = subscribeToAbort(
      controller.closingSignal,
      () => {
        try {
          controller.assertLive()
        } catch (cause) {
          fail(cause)
        }
      },
      report
    )
  } catch (cause) {
    void close().catch(report)
    throw cause
  }
  return {
    next: () => {
      if (failed) return Promise.reject(failure)
      /** The existing owner admits the whole native advancement, including its pending wait. */
      const advance = () => {
        // Cancellation may arrive while the original pipeline awaits before invoking this body.
        if (failed) return Promise.reject(failure)
        return lifetime.isClosing() ? lifetime.returned() : lifetime.advance(() => native.next())
      }
      return captured.execute === undefined ? advance() : captured.execute(advance, merged.context)
    },
    return: (value) => {
      void close()
      return lifetime.returned(value)
    },
    dispose: close,
    [asyncDisposeKey]: () => {
      void close()
      return lifetime.symbolic()
    },
    [Symbol.asyncIterator]() {
      return this
    }
  }
}
