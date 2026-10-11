import type { IAbortSignal } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IThreadHandle } from '@migaia/supervision/threads'
import type { IRemoteChannel } from '@migaia/rpc-core/remote'

/** Message channels retain the scheduler identity and static capability declaration. */
export type IThreadChannelOptions = Readonly<{
  scheduler: IScheduler
  capabilities?: readonly string[]
}>
/** A launcher handle opens one independently owned remote generation. */
export type IThreadChannelFactory<THandle extends IThreadHandle> = Readonly<{
  open(handle: THandle, signal: IAbortSignal): Promise<IRemoteChannel>
}>
/** Structural EventTarget surface also admits a worker-global scope on the service side. */
export type IThreadWebPort = {
  postMessage(message: unknown, transfer?: readonly unknown[]): void
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
}
