/**
 * Acquires borrowed Worker message sources and preserves their native error or deserialization
 * diagnostics.
 */
import { safeString } from '@migaia/rpc-contract/errors'
import { RpcCarrierPlatform } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode, RPC_ENDPOINT_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'
import { attachErrorIdentity } from '@migaia/utils/error'
import { browserMessageCarrier, type IBrowserEventPort } from '../native-message.ts'
import type { IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import { BrowserRpcErrorText } from '../error-text.ts'
import { BrowserPeerEvent } from '../peer-text.ts'

/** Preserve native Error/name/stack and the original browser script/deserialization cause. */
function failure(message: string, cause: unknown): Error {
  return attachErrorIdentity(new Error(message, { cause }), {
    source: RPC_ENDPOINT_ERROR_SOURCE,
    code: RpcCoreErrorCode.transport
  })
}

/** The original failed data getter is retained even when its diagnostic conversion also fails. */
export function workerReadFailure(cause: unknown, report: (error: unknown) => void): Error {
  /** Conversion remains an exceptional-path operation; business graph data is never inspected. */
  const detail = safeString(cause, undefined, ({ error }) => {
    report(failure(BrowserRpcErrorText.workerMessageReadFailed(''), error))
    return undefined
  })
  return failure(BrowserRpcErrorText.workerMessageReadFailed(detail), cause)
}

/** Read the original native error/message once; reflection failures do not replace the primary. */
function reportWorkerFailure(
  event: unknown,
  reason: string,
  report: (error: unknown) => void
): void {
  /** Native event.error is a local cause reference, never a serialized substitute. */
  let cause: unknown
  /** The original fallback is used when a native message is absent or conversion fails. */
  let detail: string
  try {
    cause = (event as { error?: unknown } | undefined)?.error ?? event
    detail = safeString(
      (event as { message?: unknown } | undefined)?.message || reason,
      reason,
      ({ error }) => {
        report(failure(BrowserRpcErrorText.workerFailure(reason, reason), error))
        return undefined
      }
    )
  } catch (error) {
    cause = error
    report(failure(BrowserRpcErrorText.workerFailure(reason, reason), error))
    detail = reason
  }
  report(failure(BrowserRpcErrorText.workerFailure(reason, detail), cause))
}

/** Native registration is the original error-before-messageerror pair with exact callback rollback. */
export function subscribeWorkerErrors(
  port: IBrowserEventPort,
  listener: (error: unknown) => void,
  report: (error: unknown) => void
): () => void {
  /** Each original native event keeps its own fallback diagnostic reason. */
  const error = (event: unknown): void =>
    reportWorkerFailure(event, BrowserRpcErrorText.workerFailedReason, listener)
  /** Deserialization failure uses the original native event without payload decoding. */
  const messageError = (event: unknown): void =>
    reportWorkerFailure(event, BrowserRpcErrorText.workerMessageErrorReason, listener)
  port.addEventListener(BrowserPeerEvent.error, error)
  try {
    port.addEventListener(BrowserPeerEvent.messageError, messageError)
  } catch (primary) {
    try {
      port.removeEventListener(BrowserPeerEvent.error, error)
    } catch (cleanup) {
      report(cleanup)
    }
    throw primary
  }
  /** Exact acquired callbacks and their native owner form one explicit cleanup operation. */
  const operation = { port, error, messageError }
  return () => {
    /** Attempt both exact native removers; a first failure cannot retain its sibling. */
    const errors: unknown[] = []
    try {
      operation.port.removeEventListener(BrowserPeerEvent.error, operation.error)
    } catch (cause) {
      errors.push(cause)
    }
    try {
      operation.port.removeEventListener(BrowserPeerEvent.messageError, operation.messageError)
    } catch (cause) {
      errors.push(cause)
    }
    if (errors.length)
      throw attachErrorIdentity(
        new AggregateError(errors, BrowserRpcErrorText.workerCleanupFailed, { cause: errors[0] }),
        { source: RPC_ENDPOINT_ERROR_SOURCE, code: RpcCoreErrorCode.transport }
      )
  }
}

/** Acquire the actual borrowed Worker source once; SDK owns codec, subscription and retirement. */
export function createDedicatedWorkerCarrier(
  worker: IBrowserEventPort,
  context: Pick<IRpcTransportSetupContext, 'report'>
) {
  return browserMessageCarrier(
    {
      receiver: worker,
      start: () => worker.start?.(),
      onError: (listener) => subscribeWorkerErrors(worker, listener, context.report),
      readError: (cause) => workerReadFailure(cause, context.report),
      send: (value, transfer) => worker.postMessage(value, transfer)
    },
    context,
    RpcCarrierPlatform.worker
  )
}
