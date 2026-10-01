import type { IAbortSignal } from '@migaia/lifecycle'
import type { IProcessHandle, IProcessSupervisorOptions } from '@migaia/supervision/process'
import type { ISupervisorBaseOptions } from '@migaia/supervision'
import type { IScheduler } from '@migaia/utils/scheduler'
import type {
  IRemoteChannel,
  IRemoteEndpointFactory,
  IRemotePluginHostPort,
  IRemoteRetryPort
} from '../../remote/types.js'
import type { IRemoteContract } from '../../remote/contract.js'
import type { IRemotePluginDefinition } from '../../remote/plugin.js'
import type { IProcessByteChannel, IProcessMessageChannel } from '../types.js'
import type { ProcessPluginChannelKind, ProcessPluginWire } from './constants.js'

/** Session labels are created once per generation and forwarded unchanged to the channel adapter. */
export type IProcessPluginSession = Readonly<{
  connectionId: string
  sessionId: string
  processId?: string
}>

/** The caller-owned adapter completes authentication and hands over one ready remote channel. */
export type IProcessPluginEstablish = (
  raw: IProcessByteChannel | IProcessMessageChannel,
  options: Readonly<{
    signal: IAbortSignal
    role: 'initiator' | 'responder'
    session: IProcessPluginSession
    scheduler: IScheduler
    token?: string
    verify?: (value: unknown) => void | Promise<void>
    stderr?: (listener: (chunk: Uint8Array) => void) => () => void
  }>
) => Promise<IRemoteChannel>

/** Spawn retains ownership of the supervised child and its exact spec, budget, and launcher. */
export type ISpawnProcessPluginDeployment<THandle extends IProcessHandle = IProcessHandle> =
  Readonly<{
    kind: 'spawn'
    supervision: IProcessSupervisorOptions<THandle>
    rawChannel(
      handle: THandle,
      signal: IAbortSignal
    ): Promise<IProcessByteChannel | IProcessMessageChannel>
    channelKind: ProcessPluginChannelKind
    wire?: ProcessPluginWire
    token?: string
    establish: IProcessPluginEstablish
  }>

/** Connect owns a socket session while the target process and rendezvous remain borrowed. */
export type IConnectProcessPluginDeployment = Readonly<{
  kind: 'connect'
  address: string
  token: string
  dial(address: string, signal: IAbortSignal): Promise<IProcessByteChannel>
  establish: IProcessPluginEstablish
  supervision?: Pick<
    ISupervisorBaseOptions<IProcessConnectionHandle>,
    'restart' | 'startupTimeoutMs' | 'stop' | 'terminalPolicy' | 'scheduler'
  >
}>

/** A local session settles only when its physical byte channel closes. */
export type IProcessConnectionHandle = Readonly<{
  identity: Readonly<{ fingerprint: string }>
  exited: Promise<Readonly<{ reason: unknown }>>
  channel: IProcessByteChannel
  close(): Promise<void>
}>

/** The client facade adds only process deployment and optional whole-process replacement. */
export type IProcessPluginOptions<THandle extends IProcessHandle = IProcessHandle> = Readonly<{
  name: string
  contract: IRemoteContract
  host: IRemotePluginHostPort & {
    replace?(name: string, candidate: IRemotePluginDefinition): Promise<unknown>
  }
  endpointFactory: IRemoteEndpointFactory
  report(error: unknown): void
  keyFactory?: () => string
  retryPort?: IRemoteRetryPort
  deployment: ISpawnProcessPluginDeployment<THandle> | IConnectProcessPluginDeployment
}>
