import { createRemoteRetryPort, dispatchRemoteRetry } from '../retry.js'
import type { IRemoteRetryPort } from '../types.js'
import {
  createRuntimeBindingCalls,
  type ICoreRuntimeCallBinding
} from '../internal/runtime-call.js'

/**
 * Join actual host session events to the existing request capture and retry owners. The supplied
 * binding retains directory, endpoint and generation ownership, including managed source
 * readiness.
 */
export function createHostRetryRequest(
  binding: Omit<ICoreRuntimeCallBinding, 'dispatch'>,
  report: (error: unknown) => void,
  retryPort?: IRemoteRetryPort
): ReturnType<typeof createRuntimeBindingCalls>['request'] {
  /** Original generation receipts and the physical scheduler control all retry waits and deadlines. */
  const owner = { events: binding.events, scheduler: binding.scheduler, report }
  /** Explicit caller policy takes precedence without constructing an unused default policy. */
  const port = retryPort ?? createRemoteRetryPort(owner)
  return createRuntimeBindingCalls({
    ...binding,
    dispatch: (input, forwarded) =>
      forwarded ? dispatchRemoteRetry(owner, input) : port.dispatch(input)
  }).request
}
