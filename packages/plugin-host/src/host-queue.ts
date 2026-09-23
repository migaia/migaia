import { LifecycleErrorCode } from '@migaia/lifecycle'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'

/**
 * The queue's two host-facing behaviours: how a wait is reported, and how a rejection is retold.
 *
 * Both are translation, not policy — the mutation queue decides who waits and who is turned away,
 * and these give the host's callers a plugin-host error and a plugin-host diagnostic instead of a
 * lifecycle one. Keeping them beside the host rather than inside it also keeps the queue's error
 * shape in one place; it used to be spelled out inside `#enqueue`'s catch block.
 */

/** Reports an admission wait. Observation only: nothing is dequeued, rejected, or code-tagged. */
export const reportQueueWait = (
  diagnostic: (message: string) => void,
  info: { readonly owner: string | undefined; readonly waitedMs: number }
): void => {
  try {
    diagnostic(
      `[plugin-host] mutation waited in the queue for ${info.waitedMs}ms${info.owner ? ` (owner: ${info.owner})` : ''}`
    )
  } catch {
    // Diagnostics must never alter control flow.
  }
}

/**
 * Retells a lifecycle admission timeout as this package's own error, or rethrows unchanged.
 *
 * The message carries the configured threshold while `detail` carries what actually happened — the
 * observed wait and the owner, both passed through from the lifecycle error. The original stays on
 * `cause`, so the chain still reaches the queue that made the decision.
 */
export const translateQueueRejection = (error: unknown, threshold: number | false | undefined) => {
  if (
    !error ||
    typeof error !== 'object' ||
    (error as { code?: unknown }).code !== LifecycleErrorCode.queueAdmissionTimeout
  )
    return error
  const detail = (error as { detail?: { owner?: unknown; waitedMs?: number } }).detail
  return new PluginHostError(
    PluginHostErrorCode.mutationQueueTimeout,
    ERROR_TEXT.MUTATION_QUEUE_TIMEOUT(typeof threshold === 'number' ? threshold : 0),
    { cause: error, detail: { owner: detail?.owner, waitedMs: detail?.waitedMs ?? 0 } }
  )
}
