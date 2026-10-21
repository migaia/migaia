import type { IRpcEnvelope, IRpcRuntimeEnvelope } from '@migaia/rpc-contract'
import type { IRpcFeature } from '../feature.js'
import type { IRpcTransport } from '../transport.js'
import type { IRpcOutboundAdmission, IRpcOutboundGate } from '../internal/outbound-gate.js'

/** Stable diagnostic event names shared by the gate, endpoint hook, and process log adapter. */
export const IpcLogEventName = {
  /** Accepted backlog crossed the high watermark. */ 'ipc.backlog.high': 'ipc.backlog.high',
  /** Backlog drained below the low watermark. */ 'ipc.backlog.low': 'ipc.backlog.low',
  /** The selected lane could not admit another envelope. */ 'ipc.backlog.rejected':
    'ipc.backlog.rejected',
  /** An admitted physical send failed. */ 'ipc.send.failed': 'ipc.send.failed',
  /** Explicit stderr text supplied by a process owner. */ 'ipc.stderr': 'ipc.stderr'
} as const
/** Stable local backlog/stderr diagnostic name. */
export type IpcLogEventName = keyof typeof IpcLogEventName

/** One connection reserves a separate class for control traffic under data saturation. */
export const IpcSendClass = {
  /** Application traffic uses the data capacity. */ data: 'data',
  /** Cancellation and liveness controls retain separate reserved capacity. */ control: 'control'
} as const
/** Data or reserved-control admission lane. */
export type IpcSendClass = keyof typeof IpcSendClass

/** Immutable local backlog snapshot; it is never serialized onto the RPC wire. */
export type IIpcBacklogEvent = Readonly<{
  /** High/low/rejected/send-failed event produced by this gate. */
  name: Exclude<IpcLogEventName, 'ipc.stderr'>
  /** Stable local physical connection label. */
  connectionId: string
  /** Optional session label supplied by the connection owner. */
  sessionId?: string
  /** Accepted data envelopes, including the active send. */
  pendingData: number
  /** Accepted control envelopes, including the active send. */
  pendingControl: number
  /** Class currently using the physical sender, or null while idle. */
  active: IpcSendClass | null
  /** Explicit logical trace when present on the observed envelope. */
  trace?: string
  /** Original local failure for rejection or send failure events. */
  error?: unknown
}>

/** Existing outbound owner supplies live cancellation and settlement semantics. */
export type IIpcSendAdmission = IRpcOutboundAdmission

/** Whole-envelope gate, with observation and bounded drain owned by one connection. */
export type IIpcSendGate = Omit<IRpcOutboundGate, 'onEvent'> &
  Readonly<{
    /** Admit one whole envelope and run sendNow only when the reserved lane reaches the sender. */
    run(
      envelope: IRpcEnvelope | IRpcRuntimeEnvelope,
      sendNow: () => void | Promise<void>,
      admission?: IIpcSendAdmission
    ): Promise<void>
    /** Subscribe to local backlog observations and return this registration's remover. */
    onEvent(listener: (event: IIpcBacklogEvent) => void): () => void
    /** Wait for accepted queued and active sends to settle, without proving remote execution. */
    whenIdle(): Promise<void>
  }>

/** Physical wrapper exposes a read-only projection, while core discovers the WeakMap brand. */
export type IIpcGatedTransport = IRpcTransport & Readonly<{ ipcSendGate: IIpcSendGate }>

/** A positive total capacity includes both the in-flight and queued envelopes. */
export type IIpcSendQueueOptions = Readonly<{
  /** Local identity included in every backlog event. */
  connectionId: string
  /** Optional session identity included in backlog diagnostics. */
  sessionId?: string
  /** Positive safe-integer total data capacity, including active work; defaults to 256. */
  maxPendingData?: number
  /** Positive safe-integer reserved control capacity, including active work; defaults to 8. */
  maxPendingControl?: number
}>

/** Gate identity and the one native Feature token must be installed together. */
export type IIpcSendQueueInstallation = Readonly<{
  /** Native Feature token installed with the exact gate at endpoint construction. */
  feature: IRpcFeature<Record<never, never>>
  /** Original connection-owned admission/drain gate. */
  gate: IIpcSendGate
}>

/** Local IPC diagnostic or explicit process stderr record. */
export type IIpcLogRecord =
  | IIpcBacklogEvent
  | Readonly<{
      name: 'ipc.stderr'
      connectionId: string
      sessionId: string
      processId?: string
      text: string
      /** Overflow summaries count omitted source chunks without exposing their bytes. */
      droppedChunks?: number
    }>

/** The reporter Feature and explicit stderr intake share one installation lifetime. */
export type IIpcLogInstallation = Readonly<{
  /** Native reporter Feature whose lifetime follows endpoint installation. */
  feature: IRpcFeature<Record<never, never>>
  /** Report explicit process stderr through this installation; this does not capture stderr itself. */
  recordStderr(record: Extract<IIpcLogRecord, { name: 'ipc.stderr' }>): void
}>
