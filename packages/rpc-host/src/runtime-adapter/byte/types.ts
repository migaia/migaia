import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcHandshakeOffer, IRpcPeerInfo, IRpcPortableValue } from '@migaia/rpc-contract'
import type { IIpcLogInstallation, IIpcLogRecord } from '../../core/plugins/flow-control.js'
import type { IRpcTransport } from '../../core/transport.js'
import type { IRuntimePeerSourceResult } from '../../remote/runtime-api/peer.js'

/** Ordered physical I/O held by the adapter; labels never establish Core authority. */
export type IRuntimeByteIO = Readonly<{
  kind: 'byte'
  write(chunk: Uint8Array): Promise<void>
  /** Observes native writes and actual backpressure drain without changing write settlement. */
  onWrite?(listener: (chunk: Uint8Array, drainMs: number) => void): () => void
  onData(listener: (chunk: Uint8Array) => void): () => void
  onClose(listener: (reason?: unknown) => void): () => void
  close(): void | Promise<void>
}>

/** Whole-message physical I/O remains useful to generic Core carrier composition. */
export type IRuntimeMessageIO = Readonly<{
  kind: 'message'
  send(value: unknown): void | Promise<void>
  onMessage(listener: (value: unknown) => void): () => void
  onClose(listener: (reason?: unknown) => void): () => void
  close(): void | Promise<void>
}>

/** Plain adapter-owned diagnostics preserve existing public errors without granting control facts. */
export type IRuntimeDiagnosticError = Readonly<{ source: string; code: string; message: string }>

/** Byte control failures use the adapter's canonical error/code/text data. */
export type IRuntimeByteDiagnostics = Readonly<{
  /** Adapter-owned error identity/text for a closed byte channel. */
  closed: IRuntimeDiagnosticError
  /** Adapter-owned error identity/text for handshake expiry. */
  timeout: IRuntimeDiagnosticError
  /** Adapter-owned authentication refusal diagnostic. */
  authenticationRejected: IRuntimeDiagnosticError
  /** Stable text for a second binding of the same physical resource. */
  duplicateBinding: string
  /** Stable text for rejected byte connection configuration. */
  optionsInvalid: string
  /** Stable text for a profile requiring the JSON codec. */
  jsonCodecRequired: string
  /** Stable text for an accepted codec the actual assembly cannot implement. */
  negotiatedCodecUnsupported: string
  /** Stable text for invalid handshake timeout configuration. */
  handshakeTimeoutInvalid: string
}>

/** Shared ordinary connection inputs; platform is presentation, never provenance. */
export type IRuntimeConnectionOptions = Readonly<{
  /** Presentation carrier label; it does not establish provenance or trust. */
  platform: IRpcTransport['platform']
  /** Adapter-owned diagnostic text for a non-text frame. */
  expectedStringText: string
  /** Direct peer address used by this actual connection. */
  peerId: string
  /** Cancel opening/handshake work through its existing owner. */
  signal?: import('@migaia/utils/promise').IAbortSignal
  /** Finite non-negative handshake budget; defaults to 10000 ms. */
  handshakeTimeoutMs?: number
  /** Borrowed deadline scheduler; omission uses the system scheduler. */
  scheduler?: IScheduler
  /** Required observer for background and secondary cleanup failures. */
  report(error: unknown): void
  /** Connection-owned backlog and diagnostic settings. */
  ipc: Readonly<{
    /** Stable local connection label used by backlog diagnostics. */
    connectionId: string
    /** Original accepted session label. */
    sessionId: string
    /** Positive safe-integer data-lane capacity including active sends; defaults to 256. */
    maxPendingData?: number
    /** Positive safe-integer reserved control capacity including active sends; defaults to 8. */
    maxPendingControl?: number
    /**
     * Observe local backlog/stderr diagnostics; observer failure does not change business
     * settlement.
     */
    log(record: IIpcLogRecord): void | Promise<void>
  }>
}>

/** Authentication is the actual verifier operation; only Core captures its returned principal. */
export type IRuntimeByteOptions = IRuntimeConnectionOptions &
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

/** A constructed connection owns actual diagnostic cleanup before its physical close. */
export type IRuntimeByteConnection = IRuntimePeerSourceResult &
  Readonly<{
    /** Original connection logger installation; it owns only diagnostic observation. */
    log: IIpcLogInstallation
    /** Register additional connection cleanup before physical close. */
    ownClose(resource: Readonly<{ close(): void | Promise<void> }>): void
  }>
