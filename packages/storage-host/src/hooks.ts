import { tryReadProperty } from '@migaia/utils/error'
import { createEventHub, EventDelivery } from '@migaia/event-subscriber'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { createStorageTypeError, StorageErrorCode } from './errors.js'
import { StorageErrorText } from './error-text.js'
import type { IStorageHookMap, IStorageHooks } from './hook-types.js'

/** A lazy payload producer is evaluated once only when the original event channel has listeners. */
export type IStorageHookEmitter = <K extends keyof IStorageHookMap>(
  name: K,
  payload: () => IStorageHookMap[K]
) => void

/** One synchronous registry delegates subscription boundaries and cancellation to event-subscriber. */
export function createStorageHooks(report: (error: unknown) => void): {
  readonly hooks: IStorageHooks
  readonly emit: IStorageHookEmitter
  readonly hasListeners: (name: keyof IStorageHookMap) => boolean
  readonly clear: () => void
} {
  /** This is the only event channel owner for constructor, host and installed plugin listeners. */
  const hub = createEventHub<IStorageHookMap>({
    report: ({ error }) => report(error),
    terminalReport: report
  })
  return {
    hooks: {
      on(name, handler) {
        if (typeof handler !== 'function')
          throw createStorageTypeError(
            StorageErrorCode.invalidConfig,
            StorageErrorText.invalidHookHandler
          )
        return hub.subscribe(
          name,
          (payload) => {
            try {
              /**
               * Listeners remain synchronous observations; their failures never change storage
               * results.
               */
              const result: unknown = handler(payload)
              observeThenableRejection(result, inspectThenable(result), report)
            } catch (error) {
              report(error)
            }
          },
          { delivery: EventDelivery.value }
        )
      }
    },
    hasListeners: (name) => hub.size(name) !== 0,
    emit(name, payload) {
      if (hub.size(name) === 0) return
      try {
        hub.publish(name, payload())
      } catch (error) {
        report(error)
      }
    },
    clear: () => hub.clear()
  }
}

/** Read a semantic diagnostic code without allowing an arbitrary failure getter to escape. */
export function readStorageHookFailureCode(
  error: unknown,
  report: (error: unknown) => void
): string | undefined {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return undefined
  /** Failure values remain original; only their stable code is observed. */
  const code = tryReadProperty(error as { readonly code?: unknown }, 'code')
  if (code.threw) {
    report(code.error)
    return undefined
  }
  return typeof code.value === 'string' ? code.value : undefined
}
