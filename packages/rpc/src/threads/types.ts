import type { IAbortSignal } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import type {
  IThreadHandle,
  IThreadSupervisorOptions,
  IThreadSpec
} from '@migaia/supervision/threads'
import type {
  IRemoteChannel,
  IRemoteEndpointFactory,
  IRemoteRetryPort,
  IRemotePluginHostPort
} from '../remote/types.js'
import type { IRemoteContract, IRemoteHostCatalog } from '../remote/contract.js'
import type { IRemoteServePluginOptions } from '../remote/serve-plugin.js'
import type { IRemoteServeHostOptions } from '../remote/serve-host.js'

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
/** Facades add no restart policy and transfer every selected supervisor option unchanged. */
export type IThreadCommonOptions<THandle extends IThreadHandle> = Readonly<{
  spec: IThreadSpec
  launcher: IThreadSupervisorOptions<THandle>['launcher']
  budget: IThreadSupervisorOptions<THandle>['budget']
  scheduler: IScheduler
  channelFactory: IThreadChannelFactory<THandle>
  endpointFactory: IRemoteEndpointFactory
  report(error: unknown): void
  health?: IThreadSupervisorOptions<THandle>['health']
  supervisor?: Partial<
    Pick<
      IThreadSupervisorOptions<THandle>,
      'id' | 'ready' | 'startupTimeoutMs' | 'restart' | 'terminalPolicy' | 'stop' | 'isolation'
    >
  >
  keyFactory?: () => string
  retryPort?: IRemoteRetryPort
}>
/** PluginHost definitions expose only the declared remote Plugin contract. */
export type IThreadPluginOptions<THandle extends IThreadHandle> = IThreadCommonOptions<THandle> &
  Readonly<{ name: string; contract: IRemoteContract; host: IRemotePluginHostPort }>
/** Host mode owns one nonempty name-addressed catalog rather than a Plugin contract. */
export type IThreadHostOptions<THandle extends IThreadHandle> = IThreadCommonOptions<THandle> &
  Readonly<{ catalog: IRemoteHostCatalog }>
/** Serve construction transfers its dedicated channel/endpoint but borrows the local Host. */
export type IServeThreadPluginOptions = Omit<IRemoteServePluginOptions, 'endpoint'> &
  Readonly<{ channel: IRemoteChannel; endpointFactory: IRemoteEndpointFactory }>
/** The synchronous local resolver remains outside portable catalog and wire data. */
export type IServeThreadHostOptions = Omit<IRemoteServeHostOptions, 'endpoint'> &
  Readonly<{ channel: IRemoteChannel; endpointFactory: IRemoteEndpointFactory }>
