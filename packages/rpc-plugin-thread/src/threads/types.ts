import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IThreadHandle } from '@migaia/supervision/threads'
import type { IRemoteChannel } from '@migaia/rpc-host/plugin'

/**
 * Message channels retain scheduler identity; explicit capabilities are local proposals, never
 * agreements.
 */
export type IThreadChannelOptions = Readonly<{
  /** Required borrowed scheduler; use the same instance as the owning supervisor and budget. */
  scheduler: IScheduler
  /**
   * Omission selects the synchronous fixed profile. Explicit fixed-profile subsets remain
   * synchronous; runtime extensions await Core's actual bilateral ACK and cannot assert trust.
   */
  capabilities?: readonly string[]
  /** SDK connection budget feeds the existing capability acknowledgement deadline. */
  timeoutMs?: number
}>
/** A launcher handle opens one independently owned remote generation. */
export type IThreadChannelFactory<THandle extends IThreadHandle> = Readonly<{
  /**
   * Open this handle's generation under its cancellation signal; adopted execution stays
   * supervised.
   */
  open(handle: THandle, signal: IAbortSignal, timeoutMs?: number): Promise<IRemoteChannel>
}>
/** Structural EventTarget surface also admits a worker-global scope on the service side. */
export type IThreadWebPort = {
  /**
   * Post one native message; transfer is forwarded to the actual port, not emulated by
   * serialization.
   */
  postMessage(message: unknown, transfer?: readonly unknown[]): void
  /** Install the exact EventTarget listener used by bootstrap or the message carrier. */
  addEventListener(type: string, listener: (event: any) => void): void
  /** Remove the same listener identity without terminating the Worker that owns this port. */
  removeEventListener(type: string, listener: (event: any) => void): void
}
