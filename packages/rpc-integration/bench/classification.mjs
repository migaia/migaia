/** Recorded failures/rejections retain missing reasons explicitly, never infer a cause from code. */
export const classification = { failures: [], rejections: [], reports: [] }
globalThis.__IPC_BENCH_CLASSIFICATION = classification
/**
 * Redact fixture credentials and payloads while retaining semantic classification fields.
 *
 * @param {unknown} error Original provider or transport failure.
 * @returns {object} Redacted package code, reason, native name and message.
 */
export function classify(error) {
  return {
    source: error?.source ?? null,
    code: error?.code ?? null,
    name: error?.name ?? typeof error,
    reason: error?.reason ?? null,
    message: String(error?.message ?? error)
      .replaceAll('bench-local', '[REDACTED_AUTH]')
      .replace(/x{16,}/g, '[REDACTED_PAYLOAD]')
  }
}
/**
 * Observe provider reasons through the existing rejection callback outside instrumentation.
 *
 * @param {object} event Original provider rejection, including its actual reason.
 * @returns {void}
 */
export function rejected(event) {
  classification.rejections.push({
    ...event,
    verifiedPeerKey: '[REDACTED]',
    source: '@migaia/rpc/core',
    code: 'OVERLOADED',
    name: null,
    message: 'provider rejection event',
    classificationSource: 'existing onRejected; name not supplied'
  })
}
/**
 * Preserve original reported failures in the current isolate's receipt.
 *
 * @param {unknown} error Original reported failure.
 * @returns {void}
 */
export function report(error) {
  classification.reports.push(classify(error))
}
/** Sampling capacity fits ready, warmup and 1000 echoes; the product default is unchanged. */
export const nativeProviderLimits = { maxReplayEntriesPerPeer: 1200, onRejected: rejected }
