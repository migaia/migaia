import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRpcHandshakeOffer, IRpcPeerInfo, IRpcPortableValue } from '@migaia/rpc-contract'
import type { IIpcLogInstallation, IIpcLogRecord } from '../../core/plugins/flow-control.js'
import type { IRpcTransport } from '../../core/transport.js'
import type { IRuntimePeerSourceResult } from '../../remote/index.js'

/** Ordered physical I/O held by the adapter; labels never establish Core authority. */
export type IRuntimeByteIO = Readonly<{
  kind: 'byte'
  write(chunk: Uint8Array): Promise<void>
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
  closed: IRuntimeDiagnosticError
  timeout: IRuntimeDiagnosticError
  authenticationRejected: IRuntimeDiagnosticError
  duplicateBinding: string
  optionsInvalid: string
  jsonCodecRequired: string
  negotiatedCodecUnsupported: string
  handshakeTimeoutInvalid: string
}>

/** Shared ordinary connection inputs; platform is presentation, never provenance. */
export type IRuntimeConnectionOptions = Readonly<{
  platform: IRpcTransport['platform']
  expectedStringText: string
  peerId: string
  signal?: AbortSignal
  handshakeTimeoutMs?: number
  scheduler?: IScheduler
  report(error: unknown): void
  ipc: Readonly<{
    connectionId: string
    sessionId: string
    maxPendingData?: number
    maxPendingControl?: number
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
    log: IIpcLogInstallation
    ownClose(resource: Readonly<{ close(): void | Promise<void> }>): void
  }>
