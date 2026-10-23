import type { INativeAbortSignal } from '@migaia/utils/promise'
import type { IProcessHandle, IProcessSupervisorOptions } from '@migaia/supervision/process'
import type { ISupervisorBaseOptions } from '@migaia/supervision'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRemoteChannel } from '@migaia/rpc-host/plugin'
import type { IProcessByteChannel, IProcessMessageChannel } from '../types.js'
import type {
  IListenProcessByteChannel,
  IProcessCommonOptions,
  IProcessPendingByteConnection
} from '../types.js'
import type { IRpcHandshakeOffer, IRpcPeerInfo } from '@migaia/rpc-contract'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { ProcessPluginChannelKind, ProcessPluginWire } from './constants.js'
import type { IProcessSessionIdentity } from '../resilience/types.js'
import type { IRpcIdempotencyConfig, IRpcProviderLimits } from '@migaia/rpc-host'
import type { IRemoteServeEndpoint } from '@migaia/rpc-host/plugin'
/** Session labels are created once per generation and forwarded unchanged to the channel adapter. */
export type IProcessPluginSession = Readonly<{
  /** Per-connection diagnostic identity, unrelated to authentication credentials. */
  connectionId: string
  /** Logical session identity retained through channel establishment. */
  sessionId: string
  /** Optional supervised process identity; borrowed sessions need not have one. */
  processId?: string
}>

/** The caller-owned adapter completes authentication and hands over one ready remote channel. */
export type IProcessPluginEstablish = (
  raw: IProcessByteChannel | IProcessMessageChannel,
  options: Readonly<{
    /** Generation cancellation; the establish operation must release acquisitions on failure. */
    signal: INativeAbortSignal
    /** Initiators send the first offer; responders verify the remote offer. */
    role: 'initiator' | 'responder'
    /** Stable labels allocated for this generation's actual connection. */
    session: IProcessPluginSession
    /** Borrowed scheduler shared with the binding's supervision. */
    scheduler: IScheduler
    /** Optional secret for the selected handshake; never copy it into diagnostic metadata. */
    token?: string
    /** The client deployment's exact native proposal; responders may omit it. */
    offer?: IRpcHandshakeOffer
    /** Optional bootstrap verifier supplied by child ingress. */
    verify?: (value: unknown) => void | Promise<void>
    /** Optional borrowed stderr subscription, independent of business-frame reads. */
    stderr?: (listener: (chunk: Uint8Array) => void) => () => void
    /** The SDK's one handshake budget reaches the original native negotiation owner. */
    handshakeTimeoutMs?: number
    /** Explicit process features override only these original IPC configuration fields. */
    ipc?: Partial<
      Pick<IProcessCommonOptions['ipc'], 'maxPendingData' | 'maxPendingControl' | 'log'>
    >
  }>
) => Promise<IRemoteChannel>

/** Spawn retains ownership of the supervised child and its exact spec, budget, and launcher. */
export type ISpawnProcessPluginDeployment<THandle extends IProcessHandle = IProcessHandle> =
  Readonly<{
    /** Select supervised child ownership, including stop/restart and whole-process replacement. */
    kind: 'spawn'
    /** Original process specification, launcher, budget, and lifecycle policy. */
    supervision: IProcessSupervisorOptions<THandle>
    /** Obtain the raw carrier from this actual handle; do not create a second reader. */
    rawChannel(
      handle: THandle,
      signal: INativeAbortSignal
    ): Promise<IProcessByteChannel | IProcessMessageChannel>
    /** 'byte' requires bootstrap/negotiation; 'message' already has native message boundaries. */
    channelKind: ProcessPluginChannelKind
    /** Byte deployments require 'native' or 'jsonrpc'; message deployments omit this field. */
    wire?: ProcessPluginWire
    /**
     * Byte deployments require a nonempty credential matching bootstrap; custom message
     * establishment may use it.
     */
    token?: string
    /** An optional native proposal shared with every establish call for this deployment. */
    offer?: IRpcHandshakeOffer
    /** Authenticate and return the channel adopted by this generation. */
    establish: IProcessPluginEstablish
  }>

/** Connect owns a socket session while the target process and rendezvous remain borrowed. */
export type IConnectProcessPluginDeployment = Readonly<{
  /** Select borrowed external-process ownership; only the local connection is supervised. */
  kind: 'connect'
  /** Native is the default; JSON-RPC disables default ping while preserving custom health. */
  wire?: ProcessPluginWire
  /** Exact address forwarded to dial and later reconnection attempts. */
  address: string
  /** Required credential for establishment, separate from the address and principal identity. */
  token: string
  /** An optional native proposal shared with every establish call for this deployment. */
  offer?: IRpcHandshakeOffer
  /** Open one raw connection under the current generation's abort signal. */
  dial(address: string, signal: INativeAbortSignal): Promise<IProcessByteChannel>
  /** Negotiate the ready connection; failures remain inside generation rollback. */
  establish: IProcessPluginEstablish
  /** Optional reconnect/startup/stop/health policy for the local session, not the target process. */
  supervision?: Pick<
    ISupervisorBaseOptions<IProcessConnectionHandle>,
    'restart' | 'startupTimeoutMs' | 'stop' | 'terminalPolicy' | 'scheduler' | 'health'
  >
}>

/** A local session settles only when its physical byte channel closes. */
export type IProcessConnectionHandle = Readonly<{
  /** Local connection fingerprint, not a claim about a remote native PID. */
  identity: Readonly<{ fingerprint: string }>
  /** Settles when the physical connection closes and retains its terminal reason. */
  exited: Promise<Readonly<{ reason: unknown }>>
  /** Owned local byte connection; the target process remains borrowed. */
  channel: IProcessByteChannel
  /** Close only this connection, sharing its original release operation. */
  close(): Promise<void>
}>

/** Child ingress reads bootstrap before any responder handshake or provider installation. */
export type IProcessServeChildIngress = Readonly<{
  /** Child ingress consumes its parent bootstrap before providing an endpoint. */
  kind: 'child'
  /** Physical carrier kind; bytes and whole messages have different bootstrap paths. */
  channelKind: ProcessPluginChannelKind
  /** Open the original carrier once; byte ingress returns the already-read bootstrap separately. */
  openRaw(
    signal: INativeAbortSignal
  ): Promise<IProcessMessageChannel | Readonly<{ raw: IProcessByteChannel; bootstrap: Uint8Array }>>
  /** Optional verifier derived from the original bootstrap bytes. */
  createVerifier?(bootstrap: Uint8Array): (value: unknown) => void | Promise<void>
  /** Complete authentication and return one ready remote channel. */
  establish: IProcessPluginEstablish
  /** Parent-loss exit/probe policy; process exit remains owned by this platform port. */
  parentLoss: Readonly<{
    exit(code: 0 | 1): void
    graceMs?: number
    probe?(onLost: (reason?: unknown) => void): () => void
  }>
}>

/** Listener ingress owns pending authentication and gives each session its own IPC identity. */
export type IProcessServeListenerIngress = Readonly<{
  /** Listener ingress accepts independent authenticated sessions without launching a child. */
  kind: 'listener'
  /** Borrowed platform bind/accept implementation. */
  listen: IListenProcessByteChannel
  /** Address passed unchanged to the platform listener. */
  address: string
  /** Verify the credential and return a nonempty principal, not the peer's claimed routing name. */
  verify(auth: IRpcPortableValue | undefined, peer: IRpcPeerInfo): string | Promise<string>
  /** Local proposal shared by responder handshakes. */
  offer: IRpcHandshakeOffer
  /** Optional session clock; omission selects systemScheduler. */
  scheduler?: IScheduler
  /** Create independent nonsecret routing and IPC labels for each pending physical connection. */
  createConnectionContext(pending: IProcessPendingByteConnection): Readonly<{
    peerId: string
    ipc: IProcessCommonOptions['ipc']
  }>
}>

/** Session configuration is supplied after authentication and before endpoint construction. */
export type IProcessServeEndpointFactory = (
  channel: IRemoteChannel,
  signal: INativeAbortSignal,
  session: Readonly<{
    /** Authenticated principal and physical-session labels. */
    identity: IProcessSessionIdentity
    /** Governor-owned replay scope shared by this principal across sessions. */
    idempotency: IRpcIdempotencyConfig
    /** Per-connection concurrency limits supplied by the governor. */
    limits: IRpcProviderLimits
  }>
) => Promise<IRemoteServeEndpoint>
