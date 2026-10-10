import { BrowserBenchText } from './text.mjs'

/**
 * Supply the original sampling-only provider policy to both real public Thread Peers.
 *
 * @param {{ failures: object[]; rejections: object[] }} classification Existing receipt owner.
 * @returns {object} Provider policy and full coded report classifier; no new production diagnostic.
 */
export function peerOptions(classification) {
  return {
    providerLimits: {
      maxReplayEntriesPerPeer: 1200,
      onRejected: (event) =>
        classification.rejections.push({
          ...event,
          verifiedPeerKey: '[REDACTED]',
          source: '@migaia/rpc/core',
          code: 'OVERLOADED',
          name: null,
          message: BrowserBenchText.rejected,
          classificationSource: 'existing onRejected; name not supplied'
        })
    },
    report: (error) =>
      classification.failures.push({
        source: error?.source ?? null,
        code: error?.code ?? null,
        name: error?.name ?? typeof error,
        reason: error?.reason ?? null,
        message: String(error?.message ?? error).replace(/x{16,}/g, '[REDACTED_PAYLOAD]')
      })
  }
}
