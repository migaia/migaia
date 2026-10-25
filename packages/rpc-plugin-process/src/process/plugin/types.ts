/**
 * Defines complete Process features and full spawn, connect, child and listener acquisition
 * recipes. Native supervision and handshake-verifier inputs remain distinct from Host provider
 * execution.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IProcessHandle, IProcessSupervisorOptions } from '@migaia/supervision/process'
import type { ISupervisorBaseOptions } from '@migaia/supervision'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcCallFeature } from '@migaia/rpc-contract/interfaces'
import type { IRpcNativeTransportFeature, IRpcFlowFeature } from '@migaia/rpc-host/sdk'
import type { IRpcPeerInfo, IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import type { sendQueue } from '../../features/send-queue.js'
import type { flowControl } from '../../features/flow-control.js'
import type { ipcLog } from '../../features/log.js'
import type {
  IProcessByteChannel,
  IProcessMessageChannel,
  IListenProcessByteChannel,
  IProcessCommonOptions,
  IProcessPendingByteConnection
} from '../types.js'

/** Installed process behavior is complete execution; call features remain selected by Host. */
export type IProcessFeature =
  | IRpcCallFeature
  | IRpcFlowFeature<object>
  | IRpcNativeTransportFeature
  | ReturnType<typeof sendQueue>
  | ReturnType<typeof flowControl>
  | ReturnType<typeof ipcLog>

/** Spawn retains its exact native specification, budget, launcher and physical IO acquisition. */
export type ISpawnProcessPluginDeployment<THandle extends IProcessHandle = IProcessHandle> =
  Readonly<{
    kind: 'spawn'
    supervision: IProcessSupervisorOptions<THandle>
    rawChannel(
      handle: THandle,
      signal: IAbortSignal
    ): Promise<IProcessByteChannel | IProcessMessageChannel>
    channelKind: 'byte' | 'message'
    /**
     * The original private launch token is retained for the installed auth owner, never source
     * facts.
     */
    token?: string
  }>

/** Connect supervises only the local socket while the external process remains borrowed. */
export type IConnectProcessPluginDeployment = Readonly<{
  kind: 'connect'
  address: string
  token: string
  dial(address: string, signal: IAbortSignal): Promise<IProcessByteChannel>
  supervision?: Pick<
    ISupervisorBaseOptions<IProcessConnectionHandle>,
    'restart' | 'startupTimeoutMs' | 'stop' | 'terminalPolicy' | 'scheduler' | 'health'
  >
}>

/** A local connection's original physical close is its execution-unit exit receipt. */
export type IProcessConnectionHandle = Readonly<{
  identity: Readonly<{ fingerprint: string }>
  exited: Promise<Readonly<{ reason: unknown }>>
  channel: IProcessByteChannel
  close(): Promise<void>
}>

/** Child bootstrap discovery retains the actual native streams and native parent-loss policy. */
export type IProcessServeChildIngress = Readonly<{
  kind: 'child'
  channelKind: 'byte' | 'message'
  openRaw(
    signal: IAbortSignal
  ): Promise<IProcessMessageChannel | Readonly<{ raw: IProcessByteChannel; bootstrap: Uint8Array }>>
  parentLoss: Readonly<{
    exit(code: 0 | 1): void
    graceMs?: number
    probe?(onLost: (reason?: unknown) => void): () => void
  }>
}>

/** A listener owns pending sockets; accepted Session handles remain with its native serve owner. */
export type IProcessServeListenerIngress = Readonly<{
  kind: 'listener'
  listen: IListenProcessByteChannel
  address: string
  verify(auth: IRpcPortableValue | undefined, peer: IRpcPeerInfo): string | Promise<string>
  scheduler?: IScheduler
  createConnectionContext(pending: IProcessPendingByteConnection): Readonly<{
    peerId: string
    ipc: IProcessCommonOptions['ipc']
  }>
}>
