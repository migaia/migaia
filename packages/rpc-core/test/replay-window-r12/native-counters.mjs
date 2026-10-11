import { RequestReplayLedger } from '../../dist/core/internal/request-replay-ledger.js'
import { ReplayWindow } from '../../dist/core/internal/replay.js'
import { defaultRpcId } from '../../dist/core/internal/id.js'

/** Isolated diagnostic counters never enter the formal timing run. */
const counts = {
  ledgerAdmit: 0,
  activeAdmit: 0,
  completedAdmit: 0,
  ledgerSettle: 0,
  completedOnSettlement: 0,
  maxActive: 0,
  maxCompleted: 0,
  outboundReserve: 0,
  outboundRelease: 0,
  outboundTombstone: 0,
  legacyUuid: 0,
  positiveControlUuid: 0,
  clear: 0
}
/** Keep exact native receiver semantics for private fields while observing the original method. */
const admit = RequestReplayLedger.prototype.admit
RequestReplayLedger.prototype.admit = function (...args) {
  const beforeActive = this.activeSize
  const beforeCompleted = this.size - beforeActive
  const result = Reflect.apply(admit, this, args)
  counts.ledgerAdmit++
  if (result) {
    counts.activeAdmit += this.activeSize > beforeActive ? 1 : 0
    counts.completedAdmit += this.size - this.activeSize > beforeCompleted ? 1 : 0
  }
  counts.maxActive = Math.max(counts.maxActive, this.activeSize)
  counts.maxCompleted = Math.max(counts.maxCompleted, this.size - this.activeSize)
  return result
}
/** Actual final settlement proves no L completion record was retained. */
const settle = RequestReplayLedger.prototype.releaseActive
RequestReplayLedger.prototype.releaseActive = function (...args) {
  const before = this.size - this.activeSize
  const result = Reflect.apply(settle, this, args)
  counts.ledgerSettle++
  counts.completedOnSettlement += this.size - this.activeSize > before ? 1 : 0
  return result
}
/** Exact reserve/release calls observe the existing outbound owner rather than estimated in-flight. */
const reserve = ReplayWindow.prototype.reserveId
ReplayWindow.prototype.reserveId = function (...args) {
  counts.outboundReserve++
  return Reflect.apply(reserve, this, args)
}
const release = ReplayWindow.prototype.releaseId
ReplayWindow.prototype.releaseId = function (...args) {
  const before = this.size
  const result = Reflect.apply(release, this, args)
  counts.outboundRelease++
  counts.outboundTombstone += this.size === before ? 1 : 0
  return result
}
/** Verify the old generator counter can fire, then reset only that positive-control observation. */
const randomUUID = globalThis.crypto.randomUUID
globalThis.crypto.randomUUID = () => {
  counts.legacyUuid++
  return Reflect.apply(randomUUID, globalThis.crypto, [])
}
defaultRpcId()
counts.positiveControlUuid = counts.legacyUuid
counts.legacyUuid = 0

/**
 * Snapshots executed owner paths for E2; no rate/latency conclusions use this run.
 *
 * @returns {Readonly<Record<string, number>>} Independently counted native and legacy branches.
 */
export function executionCounters() {
  return { ...counts }
}
