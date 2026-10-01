import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcHandshakeOffer, IRpcPeerInfo } from '../contract/handshake.js'
import type { IRpcPortableValue } from '../contract/types.js'
import type { IIpcLogRecord } from '../core/plugins/flow-control.js'
import type { IRemoteChannel } from '../remote/types.js'

/** Message channels already have framing and do not perform a byte handshake. */
export type IProcessMessageChannel = Readonly<{
  kind: 'message'
  send(value: unknown): void | Promise<void>
  onMessage(listener: (value: unknown) => void): () => void
  onClose(listener: (reason?: unknown) => void): () => void
  close(): void | Promise<void>
}>

/** Byte channels expose one ordered, backpressured physical stream. */
export type IProcessByteChannel = Readonly<{
  kind: 'byte'
  write(chunk: Uint8Array): Promise<void>
  onData(listener: (chunk: Uint8Array) => void): () => void
  onClose(listener: (reason?: unknown) => void): () => void
  close(): void | Promise<void>
}>

/** Per-connection identity, diagnostics, and lifecycle ports supplied by the owner. */
export type IProcessCommonOptions = Readonly<{
  peerId: string
  signal?: AbortSignal
  handshakeTimeoutMs?: number
  scheduler?: IScheduler
  report(error: unknown): void
  ipc: Readonly<{
    connectionId: string
    sessionId: string
    processId?: string
    maxPendingData?: number
    maxPendingControl?: number
    log(record: IIpcLogRecord): void | Promise<void>
    stderr?: (listener: (chunk: Uint8Array) => void) => () => void
  }>
}>

/** Initiators and responders must explicitly supply their local handshake policy. */
export type IProcessByteOptions = IProcessCommonOptions &
  (
    | Readonly<{ role: 'initiator'; offer: IRpcHandshakeOffer }>
    | Readonly<{
        role: 'responder'
        offer: IRpcHandshakeOffer
        auth:
          | Readonly<{
              mode: 'required'
              verify(auth: IRpcPortableValue | undefined, peer: IRpcPeerInfo): void | Promise<void>
            }>
          | Readonly<{ mode: 'none' }>
      }>
  )

/** Both message parties must declare identical static codec and capabilities. */
export type IProcessMessageOptions = IProcessCommonOptions &
  Readonly<{
    staticAgreement: Readonly<{
      local: Readonly<{ codec: 'identity'; capabilities: readonly string[] }>
      peer: Readonly<{ codec: 'identity'; capabilities: readonly string[] }>
    }>
  }>

/** A listener owns its address until close, but not channels already handed out. */
export type IProcessByteListener = Readonly<{ address: string; close(): Promise<void> }>

/** A verified principal is returned separately from the route peer identity. */
export type IAuthenticatedProcessChannel = Readonly<{
  channel: IRemoteChannel
  principalId: string
}>

/** A pending socket cannot exchange business frames before authorized acceptance. */
export type IProcessPendingByteConnection = Readonly<{
  accept(
    options: IProcessCommonOptions & Readonly<{ offer: IRpcHandshakeOffer }>
  ): Promise<IAuthenticatedProcessChannel>
  close(): Promise<void>
}>

/** Platform deep paths implement the same authenticated listener port. */
export type IListenProcessByteChannel = (
  options: Readonly<{
    address: string
    signal?: AbortSignal
    auth: Readonly<{
      mode: 'required'
      verify(auth: IRpcPortableValue | undefined, peer: IRpcPeerInfo): string | Promise<string>
    }>
    onConnection(pending: IProcessPendingByteConnection): void | Promise<void>
    report(error: unknown): void
  }>
) => Promise<IProcessByteListener>
