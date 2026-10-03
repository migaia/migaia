import { threadId } from 'node:worker_threads'
import { loadavg } from 'node:os'
import { performance } from 'node:perf_hooks'
import { RpcCoreErrorText } from '../../dist/core/error-text.js'
import { RpcCoreErrorCode } from '../../dist/core/error-code.js'
import { RpcDebugProperty } from '../../dist/core/internal/test-observer.js'

/**
 * Records every observable failure dimension through existing rejection/failure channels.
 *
 * @param {unknown} error Original package error, when the rejection channel supplies one.
 * @param {string | null} [reason] Existing package-local rejection reason.
 * @returns {object} Complete classification with an explicitly absent reason and redacted text.
 */
export function classifyFailure(error, reason = null) {
  return {
    source: error?.source ?? '@migaia/rpc/core',
    code: error?.code ?? 'UNCLASSIFIED',
    name: error?.name ?? (error === undefined ? 'RejectionEvent' : typeof error),
    reason: reason ?? error?.reason ?? null,
    message: String(error?.message ?? error ?? 'rejection without error')
      .replace(/(token|secret|authorization|password)\s*[:=]\s*\S+/giu, '$1=[REDACTED]')
      .slice(0, 300)
  }
}

/**
 * Projects the existing rejection reason to its canonical failure-response contract.
 *
 * @param {object} rejection Original provider rejection event, which carries no Error object.
 * @returns {object} All five classification fields, with explicit provenance of the text
 *   projection.
 */
export function classifyProviderRejection(rejection) {
  const texts = {
    replayLedgerFull: RpcCoreErrorText.requestReplayLedgerIsFull,
    concurrency: RpcCoreErrorText.providerAdmissionLimitReached,
    bindingExpired: RpcCoreErrorText.verifiedPeerBindingExpired
  }
  return {
    source: '@migaia/rpc/core',
    code: RpcCoreErrorCode.overloaded,
    name: 'Error',
    reason: rejection.reason,
    message: texts[rejection.reason] ?? 'UNCLASSIFIED',
    provenance: 'existing onRejected reason and canonical failure-response text',
    method: rejection.method,
    controllerKey: rejection.controllerKey
  }
}

/**
 * Reads both process and isolate ownership without retaining providers, requests or errors.
 *
 * @param {object} runtime Canonical fixture runtime with existing passive snapshot readers.
 * @returns {object} PID/thread/clock/cpu/memory/ledger observations for independent recomputation.
 */
export function nativeSample(runtime) {
  return {
    UTC: new Date().toISOString(),
    monotonicMs: performance.now(),
    timeOrigin: performance.timeOrigin,
    pid: process.pid,
    threadId,
    cpu: process.cpuUsage(),
    threadCpu: process.threadCpuUsage?.() ?? null,
    elu: performance.eventLoopUtilization(),
    memory: process.memoryUsage(),
    load: loadavg(),
    qualified: runtime.receipt.qualified,
    physicalActive: runtime.receipt.active,
    snapshot: runtime.snapshot(),
    providerState: runtime.snapshot()?.providerState,
    inboundReplay: runtime.snapshot()?.[RpcDebugProperty.replayState],
    outbound: runtime.outboundSnapshot?.(),
    outboundReplay: runtime.outboundSnapshot?.()?.[RpcDebugProperty.replayState]
  }
}
