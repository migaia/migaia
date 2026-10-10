import type { IAbortSignal } from '@migaia/lifecycle'
import type { IProcessHandle, IProcessSupervisorOptions } from '@migaia/supervision/process'
import type { IProcessSpec } from '@migaia/supervision/process'
import type { ISupervisorBaseOptions } from '@migaia/supervision'
import type { IReplaceOutcome, ReplaceStrategy } from '@migaia/supervision'
import type { IScheduler } from '@migaia/utils/scheduler'
import type {
  IRemoteChannel,
  IRemoteEndpointFactory,
  IRemotePluginHostPort,
  IRemoteRetryPort
} from '../../remote/index.js'
import type { IRemoteContract } from '../../remote/index.js'
import type { IRemotePluginDefinition } from '../../remote/index.js'
import type { IProcessByteChannel, IProcessMessageChannel } from '../types.js'
import type {
  IListenProcessByteChannel,
  IProcessCommonOptions,
  IProcessPendingByteConnection
} from '../types.js'
import type { IRpcHandshakeOffer, IRpcPeerInfo } from '../../contract/index.js'
import type { IRpcPortableValue } from '../../contract/index.js'
import type { ProcessPluginChannelKind, ProcessPluginWire } from './constants.js'
import type { IProcessDependencyHostPort, IProcessResilience } from '../resilience/types.js'
import type { IProcessSessionIdentity } from '../resilience/types.js'
import type { IRpcIdempotencyConfig, IRpcProviderLimits } from '../../core/index.js'
import type { IRemoteServeEndpoint } from '../../remote/index.js'

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
    /** The client deployment's exact native proposal; responders may omit it. */
    offer?: IRpcHandshakeOffer
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
    /** An optional native proposal shared with every establish call for this deployment. */
    offer?: IRpcHandshakeOffer
    establish: IProcessPluginEstablish
  }>

/** Connect owns a socket session while the target process and rendezvous remain borrowed. */
export type IConnectProcessPluginDeployment = Readonly<{
  kind: 'connect'
  /** Native is the default; JSON-RPC disables default ping while preserving custom health. */
  wire?: ProcessPluginWire
  address: string
  token: string
  /** An optional native proposal shared with every establish call for this deployment. */
  offer?: IRpcHandshakeOffer
  dial(address: string, signal: IAbortSignal): Promise<IProcessByteChannel>
  establish: IProcessPluginEstablish
  supervision?: Pick<
    ISupervisorBaseOptions<IProcessConnectionHandle>,
    'restart' | 'startupTimeoutMs' | 'stop' | 'terminalPolicy' | 'scheduler' | 'health'
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
  /** The local Host that will own and, if necessary, liquidate this exact registration. */
  registrationOwner: Readonly<{ name: string; host: IProcessDependencyHostPort }>
  /** Caller-owned governance may replace the default process registration policy. */
  resilience?: IProcessResilience
  host: IRemotePluginHostPort & {
    replace?(name: string, candidate: IRemotePluginDefinition): Promise<unknown>
  }
  endpointFactory: IRemoteEndpointFactory
  report(error: unknown): void
  keyFactory?: () => string
  retryPort?: IRemoteRetryPort
  deployment: ISpawnProcessPluginDeployment<THandle> | IConnectProcessPluginDeployment
}>

/** The process facade returns the underlying supervisor result or the trusted Host candidate. */
export type IProcessPluginReplaceResult =
  | Readonly<{ strategy: 'stop-then-start'; outcome: IReplaceOutcome }>
  | Readonly<{ strategy: 'start-then-switch'; plugin: IProcessPlugin }>

/** A trusted remote definition carries one whole-process replacement entry. */
export type IProcessPlugin = IRemotePluginDefinition &
  Readonly<{
    replace(
      options?: Readonly<{ spec?: IProcessSpec; strategy?: ReplaceStrategy }>
    ): Promise<IProcessPluginReplaceResult>
  }>

/** Child ingress reads bootstrap before any responder handshake or provider installation. */
export type IProcessServeChildIngress = Readonly<{
  kind: 'child'
  channelKind: ProcessPluginChannelKind
  openRaw(
    signal: IAbortSignal
  ): Promise<IProcessMessageChannel | Readonly<{ raw: IProcessByteChannel; bootstrap: Uint8Array }>>
  createVerifier?(bootstrap: Uint8Array): (value: unknown) => void | Promise<void>
  establish: IProcessPluginEstablish
  parentLoss: Readonly<{
    exit(code: 0 | 1): void
    graceMs?: number
    probe?(onLost: (reason?: unknown) => void): () => void
  }>
}>

/** Listener ingress owns pending authentication and gives each session its own IPC identity. */
export type IProcessServeListenerIngress = Readonly<{
  kind: 'listener'
  listen: IListenProcessByteChannel
  address: string
  verify(auth: IRpcPortableValue | undefined, peer: IRpcPeerInfo): string | Promise<string>
  offer: IRpcHandshakeOffer
  scheduler?: IScheduler
  createConnectionContext(pending: IProcessPendingByteConnection): Readonly<{
    peerId: string
    ipc: IProcessCommonOptions['ipc']
  }>
}>

/** Session configuration is supplied after authentication and before endpoint construction. */
export type IProcessServeEndpointFactory = (
  channel: IRemoteChannel,
  signal: IAbortSignal,
  session: Readonly<{
    identity: IProcessSessionIdentity
    idempotency: IRpcIdempotencyConfig
    limits: IRpcProviderLimits
  }>
) => Promise<IRemoteServeEndpoint>
