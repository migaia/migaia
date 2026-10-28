/**
 * Defines raw Process byte/message channels, listener custody and pending native-accept transfer.
 * Authentication stays at installed handshake hooks; stderr labels remain local native facts.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcByteIO, IRpcMessageIO } from '@migaia/rpc-host/sdk'
import type { IIpcLogRecord } from '../features/flow-control.ts'

/** Process bytes use the sole native SDK read/write lifecycle without a protocol facade. */
export type IProcessByteChannel = IRpcByteIO &
  Readonly<{
    /** Only the original native stdio owner may lend current exclusive-reader qualification. */
    isExclusive?(): boolean
  }>
/** A custom native whole-message recipe still has no native backing-transfer authority. */
export type IProcessMessageChannel = IRpcMessageIO & Readonly<{ kind: 'message' }>
/** Physical listener ownership ends after pending candidates transfer to actual accepted Sessions. */
export type IProcessByteListener = Readonly<{ address: string; close(): Promise<void> }>
/** Native accept retains its pending socket through actual Session/auth admission and rollback. */
export type IProcessPendingByteConnection = Readonly<{
  accept<T>(adopt: (raw: IProcessByteChannel) => Promise<T>): Promise<T>
  close(): Promise<void>
}>
/** Bind only local native addresses; authentication belongs to installed handshake hooks. */
export type IListenProcessByteChannel = (
  options: Readonly<{
    address: string
    serviceId?: string
    signal?: IAbortSignal
    onConnection(pending: IProcessPendingByteConnection): void | Promise<void>
    report(error: unknown): void
  }>
) => Promise<IProcessByteListener>
/** Native stderr presentation keeps original nonsecret per-connection labels. */
export type IProcessCommonOptions = Readonly<{
  report(error: unknown): void
  ipc: Readonly<{
    connectionId: string
    sessionId: string
    processId?: string
    stderr?: (listener: (chunk: Uint8Array) => void) => () => void
    log(record: IIpcLogRecord): void | Promise<void>
  }>
}>
