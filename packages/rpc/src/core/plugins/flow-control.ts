import type { IRpcEnvelope, IRpcRuntimeEnvelope } from '../../contract/index.js'
import type { IRpcFeature } from '../feature.js'
import type { IRpcTransport } from '../transport.js'
import type { IRpcOutboundAdmission, IRpcOutboundGate } from '../internal/outbound-gate.js'

/** Stable diagnostic event names shared by the gate, endpoint hook, and process log adapter. */
export const IpcLogEventName = {
  'ipc.backlog.high': 'ipc.backlog.high',
  'ipc.backlog.low': 'ipc.backlog.low',
  'ipc.backlog.rejected': 'ipc.backlog.rejected',
  'ipc.send.failed': 'ipc.send.failed',
  'ipc.stderr': 'ipc.stderr'
} as const
export type IpcLogEventName = keyof typeof IpcLogEventName

/** One connection reserves a separate class for control traffic under data saturation. */
export const IpcSendClass = { data: 'data', control: 'control' } as const
export type IpcSendClass = keyof typeof IpcSendClass

/** Immutable local backlog snapshot; it is never serialized onto the RPC wire. */
export type IIpcBacklogEvent = Readonly<{
  name: Exclude<IpcLogEventName, 'ipc.stderr'>
  connectionId: string
  sessionId?: string
  pendingData: number
  pendingControl: number
  active: IpcSendClass | null
  trace?: string
  error?: unknown
}>

/** Existing outbound owner supplies live cancellation and settlement semantics. */
export type IIpcSendAdmission = IRpcOutboundAdmission

/** Whole-envelope gate, with observation and bounded drain owned by one connection. */
export type IIpcSendGate = Omit<IRpcOutboundGate, 'onEvent'> &
  Readonly<{
    run(
      envelope: IRpcEnvelope | IRpcRuntimeEnvelope,
      sendNow: () => void | Promise<void>,
      admission?: IIpcSendAdmission
    ): Promise<void>
    onEvent(listener: (event: IIpcBacklogEvent) => void): () => void
    whenIdle(): Promise<void>
  }>

/** Physical wrapper exposes a read-only projection, while core discovers the WeakMap brand. */
export type IIpcGatedTransport = IRpcTransport & Readonly<{ ipcSendGate: IIpcSendGate }>

/** A positive total capacity includes both the in-flight and queued envelopes. */
export type IIpcSendQueueOptions = Readonly<{
  connectionId: string
  sessionId?: string
  maxPendingData?: number
  maxPendingControl?: number
}>

/** Gate identity and the one native Feature token must be installed together. */
export type IIpcSendQueueInstallation = Readonly<{
  feature: IRpcFeature<Record<never, never>>
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
    }>

/** The reporter Feature and explicit stderr intake share one installation lifetime. */
export type IIpcLogInstallation = Readonly<{
  feature: IRpcFeature<Record<never, never>>
  recordStderr(record: Extract<IIpcLogRecord, { name: 'ipc.stderr' }>): void
}>
