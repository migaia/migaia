/**
 * Defines native launch facts, carrier factories and structural Worker messaging ports. Host
 * Sessions borrow acquired carriers without moving native Worker ownership into Core.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IThreadHandle } from '@migaia/supervision/threads'
import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
import type { IRpcLaunchFacts } from '@migaia/rpc-host/sdk'

/** Native launch metadata is supplied explicitly by the unique installed transport source. */
export type IThreadLaunchFacts = IRpcLaunchFacts
/** A launcher reads current host identity at each real native execution attempt. */
export type IThreadLaunchOptions = Readonly<{
  report?(error: unknown): void
}>
/** Carrier acquisition borrows the supervisor's original scheduler and cancellation budget. */
export type IThreadChannelOptions = Readonly<{
  scheduler: IScheduler
  report?(error: unknown): void
}>
/** Full recipes open real carriers without constructing a Session or request facade. */
export type IThreadChannelFactory<THandle extends IThreadHandle> = Readonly<{
  open(handle: THandle, signal: IAbortSignal): Promise<IRpcCarrier>
  /** Only an actual exclusive native reader may lend current completion-retention eligibility. */
  isExclusive?(handle: THandle): boolean
}>
/** EventTarget messaging is structural so Bun/Deno need no browser library declarations. */
export type IThreadWebPort = Readonly<{
  postMessage(message: unknown, transfer?: readonly unknown[]): void
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
}>
