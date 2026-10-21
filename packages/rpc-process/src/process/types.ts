import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcHandshakeOffer, IRpcPeerInfo } from '@migaia/rpc-contract'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IIpcLogRecord } from '@migaia/rpc-core/plugins/flow-control'
import type { IRemoteChannel } from '@migaia/rpc-core/remote'

/** Message channels already have framing and do not perform a byte handshake. */
export type IProcessMessageChannel = Readonly<{
  /** Select whole-message delivery; no byte framing is added to this port. */
  kind: 'message'
  /** Send one native message; a returned Promise represents the carrier's own drain. */
  send(value: unknown): void | Promise<void>
  /** Subscribe to messages and return an identity-preserving unsubscribe operation. */
  onMessage(listener: (value: unknown) => void): () => void
  /** Observe physical termination; the implementation supplies its terminal reason. */
  onClose(listener: (reason?: unknown) => void): () => void
  /** Release this carrier, independently of any supervised process termination. */
  close(): void | Promise<void>
}>

/** Byte channels expose one ordered, backpressured physical stream. */
export type IProcessByteChannel = Readonly<{
  /** Select ordered byte delivery; the connection owner supplies framing and negotiation. */
  kind: 'byte'
  /** Write bytes and wait for this carrier's backpressure, not a remote business response. */
  write(chunk: Uint8Array): Promise<void>
  /** Subscribe to ordered chunks; callers must not assume chunk boundaries are message boundaries. */
  onData(listener: (chunk: Uint8Array) => void): () => void
  /** Observe EOF or failure and return an unsubscribe operation. */
  onClose(listener: (reason?: unknown) => void): () => void
  /** Release the physical stream; cleanup failures may reject the returned Promise. */
  close(): void | Promise<void>
}>

/** Per-connection identity, diagnostics, and lifecycle ports supplied by the owner. */
export type IProcessCommonOptions = Readonly<{
  /** Local routing label for the remote party; it is not an authenticated principal. */
  peerId: string
  /** Optional connection cancellation; omission adds no caller abort signal. */
  signal?: import('@migaia/utils/promise').IAbortSignal
  /** Finite nonnegative handshake budget in milliseconds; defaults to 10000. */
  handshakeTimeoutMs?: number
  /** Borrowed clock and timer port; omission selects the shared system scheduler. */
  scheduler?: IScheduler
  /** Receive asynchronous diagnostics; reporter failures remain observable through the host route. */
  report(error: unknown): void
  /** Nonsecret connection labels and bounded IPC diagnostics, separate from handshake credentials. */
  ipc: Readonly<{
    /** Label for this physical connection's log records. */
    connectionId: string
    /** Label for this logical session's log records. */
    sessionId: string
    /** Optional supervised process label; absence does not fabricate a native PID. */
    processId?: string
    /** Pending data-send capacity, default 256, forwarded to Core's IPC flow controller. */
    maxPendingData?: number
    /** Separate pending control-send capacity, default 8, forwarded to Core's IPC flow controller. */
    maxPendingControl?: number
    /** Consume structured records; asynchronous failures are reported rather than becoming traffic. */
    log(record: IIpcLogRecord): void | Promise<void>
    /** Optional borrowed stderr subscription; raw bytes are represented by redacted diagnostics. */
    stderr?: (listener: (chunk: Uint8Array) => void) => () => void
  }>
}>

/**
 * Initiators send an offer; responders also select required verification or explicit no-auth mode.
 * Required verification may return a principal string; the authenticated socket listener requires
 * that string to be nonempty. Negotiation and authentication failures reject channel creation.
 */
export type IProcessByteOptions = IProcessCommonOptions &
  (
    | Readonly<{ role: 'initiator'; offer: IRpcHandshakeOffer }>
    | Readonly<{
        role: 'responder'
        offer: IRpcHandshakeOffer
        auth:
          | Readonly<{
              mode: 'required'
              verify(
                auth: IRpcPortableValue | undefined,
                peer: IRpcPeerInfo
              ): string | void | Promise<string | void>
            }>
          | Readonly<{ mode: 'none' }>
      }>
  )

/**
 * Both message parties declare identity codec and capabilities in exactly the same order. These
 * declarations do not prove permission for runtime expansion: Core observes the actual control ACK
 * and retains only its fixed profile if that exchange times out.
 */
export type IProcessMessageOptions = IProcessCommonOptions &
  Readonly<{
    staticAgreement: Readonly<{
      local: Readonly<{ codec: 'identity'; capabilities: readonly string[] }>
      peer: Readonly<{ codec: 'identity'; capabilities: readonly string[] }>
    }>
  }>

/** A listener owns its address until close, but not channels already handed out. */
export type IProcessByteListener = Readonly<{
  /** Actual bound address; loopback port zero is replaced with the assigned port. */
  address: string
  /** Stop accepts and close pending handshakes; ready channels remain caller-owned. */
  close(): Promise<void>
}>

/** A verified principal is returned separately from the route peer identity. */
export type IAuthenticatedProcessChannel = Readonly<{
  /** Negotiated channel transferred to the accepting owner. */
  channel: IRemoteChannel
  /** Nonempty identity returned by the local verifier, independent of the peer's route label. */
  principalId: string
}>

/** A pending socket cannot exchange business frames before authorized acceptance. */
export type IProcessPendingByteConnection = Readonly<{
  /** Accept once using responder negotiation; repeated or closed acceptance rejects CHANNEL_CLOSED. */
  accept(
    options: IProcessCommonOptions & Readonly<{ offer: IRpcHandshakeOffer }>
  ): Promise<IAuthenticatedProcessChannel>
  /** Reject a still-pending candidate; an already-transferred ready channel is unaffected. */
  close(): Promise<void>
}>

/** Platform deep paths implement the same authenticated listener port. */
export type IListenProcessByteChannel = (
  options: Readonly<{
    /** Absolute Unix path, supported Windows pipe, or numeric loopback TCP URL. */
    address: string
    /** Stable, non-secret owner for safe recovery of an abandoned Unix socket path. */
    serviceId?: string
    /** Optional lifetime cancellation for this listener and its unaccepted candidates. */
    signal?: import('@migaia/utils/promise').IAbortSignal
    /** Required authentication; a successful verifier returns a stable nonempty principal. */
    auth: Readonly<{
      mode: 'required'
      verify(auth: IRpcPortableValue | undefined, peer: IRpcPeerInfo): string | Promise<string>
    }>
    /** Accept or close the candidate before this callback settles; an unaccepted return closes it. */
    onConnection(pending: IProcessPendingByteConnection): void | Promise<void>
    /** Receive callback, post-bind native, and path-cleanup diagnostics. */
    report(error: unknown): void
  }>
) => Promise<IProcessByteListener>
