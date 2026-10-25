/**
 * Defines optional provider concurrency, per-connection governance and rejection-observer options.
 * The installed limits owner supplies the real shared registry and scheduler integration; these
 * contracts do not add policy state or transport acquisition.
 */
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcProviderRejection } from '@migaia/rpc-contract/errors'

export type { IRpcProviderRejection } from '@migaia/rpc-contract/errors'

/** Original native adapter diagnostics retain their selected public source/code/message. */
export type IRpcLimitsOverflow = Readonly<{ source: string; code: string; message: string }>

/** One installed policy owns shared provider capacity and optional per-connection governance. */
export type IRpcLimitsOptions = Readonly<{
  /** Original business concurrency defaults remain 256 globally and 64 per admitted peer. */
  maxGlobal?: number
  maxPerPeer?: number
  /** Omitted connection policy adds no rate, payload, timeout or idle restriction. */
  maxCallsPerMinute?: number
  maxPayloadBytes?: number
  maxConsecutiveTimeouts?: number
  idleTimeoutMs?: number
  violationLimit?: number
  overflow?: IRpcLimitsOverflow
  onRejected?(rejection: IRpcProviderRejection): void | Promise<void>
  scheduler?: IScheduler
  namespaces?: readonly string[]
}>
