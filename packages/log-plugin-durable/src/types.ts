import type { ILogPlugin } from '@migaia/log-host/plugin'
import type { LogRecordState, LogStage } from './state-constants.ts'

/** Portable JSON data accepted by durable records. */
export type ILogPayload =
  | null
  | boolean
  | number
  | string
  | readonly ILogPayload[]
  | { readonly [key: string]: ILogPayload }
/** Structural admission retains named interfaces and readonly tuple positions. */
export type ILogPayloadInput<T> = T extends null | boolean | number | string
  ? T
  : T extends (...args: never[]) => unknown
    ? never
    : T extends readonly (infer U)[]
      ? readonly ILogPayloadInput<U>[]
      : T extends object
        ? { readonly [K in keyof T]: ILogPayloadInput<T[K]> }
        : never
/** Caller input before the store assigns identity and time. */
export type ILogRecordInput = { readonly kind: string; readonly payload: unknown }
/** Checks each member without widening a heterogeneous batch. */
export type ILogBatchInput<T extends readonly ILogRecordInput[]> = {
  readonly [K in keyof T]: T[K] & { readonly payload: ILogPayloadInput<T[K]['payload']> }
}
/** An independent committed record snapshot. */
export type ILogRecord = {
  readonly seq: number
  readonly time: number
  readonly kind: string
  readonly payload: ILogPayload
}
/** Observation metadata deliberately excludes business records and native resources. */
export type ILogObservation = Readonly<{
  stage: LogStage
  owner: 'store' | 'binlog' | 'wal' | 'undo'
  operation: string
  seq?: number
  count?: number
  durationMs?: number
}>
/** Observations never participate in the commit decision. */
export type ILogObserver = (event: ILogObservation) => void
/** Standalone resource diagnostics use the caller reporter or logger terminal reporting. */
export type ILogStoreOptions = {
  readonly observe?: ILogObserver
  readonly report?: (error: unknown) => void
}
/** One real nonempty commit, published by the resource owner. */
export type ILogAppendNotice = Readonly<{ lastSeq: number; count: number }>
/** Atomic ordered storage; the creator owns disposal even while a plugin borrows it. */
export type ILogStore = {
  append<const T extends readonly ILogRecordInput[]>(
    records: T & ILogBatchInput<T>
  ): Promise<readonly number[]>
  read(fromSeq: number, limit: number): Promise<readonly ILogRecord[]>
  lastSeq(): Promise<number>
  onAppend(listener: (notice: ILogAppendNotice) => void): () => void
  truncate(beforeSeq: number): Promise<void>
  setState(seq: number, state: LogRecordState): Promise<void>
  states(filter: typeof LogRecordState.pending): Promise<readonly number[]>
  dispose(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}
/** Existing native transaction authority; logger neither begins nor ends the transaction. */
export type ILogAppendPort = Readonly<{
  store: ILogStore
  append(
    records: readonly { readonly kind: string; readonly payload: ILogPayload }[]
  ): Promise<readonly number[]>
  onCommit(effect: () => void): () => void
  onRollback(effect: () => void): () => void
}>
/** Transactional calls start immediately and return provisional sequence numbers. */
export type ILogAppendOptions = { readonly transaction?: ILogAppendPort }
/** The original store and observer are closure-captured, never plugin configuration. */
export type IDurablePluginOptions = { readonly store: ILogStore; readonly observe?: ILogObserver }
/** Optional metadata-only echo through the ordinary logger pipeline. */
export type IBinlogOptions = IDurablePluginOptions & { readonly echo?: boolean }
/** Installed ordered log operations. */
export type IBinlogExt = {
  readonly binlog: {
    ready(): Promise<void>
    whenIdle(): Promise<void>
    append<T>(
      kind: string,
      payload: T & ILogPayloadInput<T>,
      options?: ILogAppendOptions
    ): Promise<number>
    appendBatch<const T extends readonly ILogRecordInput[]>(
      records: T & ILogBatchInput<T>,
      options?: ILogAppendOptions
    ): Promise<readonly number[]>
    read(fromSeq: number, options?: { readonly limit?: number }): Promise<readonly ILogRecord[]>
    subscribe(fromSeq: number, listener: (record: ILogRecord) => void | Promise<void>): () => void
    lastSeq(): Promise<number>
    truncate(beforeSeq: number): Promise<void>
  }
}
/** Installed write-ahead operations; begin finishes its own durable commit. */
export type IWalExt = {
  readonly wal: {
    ready(): Promise<void>
    whenIdle(): Promise<void>
    begin<T>(kind: string, payload: T & ILogPayloadInput<T>): Promise<number>
    complete(seq: number): Promise<void>
    abort(seq: number): Promise<void>
    pending(): Promise<readonly ILogRecord[]>
  }
}
/** A business target and its two JSON images; null remains a legitimate value. */
export type IUndoImage = {
  readonly target: ILogPayload
  readonly before: ILogPayload | null
  readonly after: ILogPayload | null
}
/** Installed undo storage; business conflict checks and replay belong to the consumer. */
export type IUndoLogExt = {
  readonly undo: {
    ready(): Promise<void>
    whenIdle(): Promise<void>
    record<
      const T extends readonly {
        readonly target: unknown
        readonly before: unknown
        readonly after: unknown
      }[]
    >(
      txId: string,
      images: T & ILogPayloadInput<T>,
      options?: ILogAppendOptions
    ): Promise<void>
    get(txId: string): Promise<readonly IUndoImage[] | undefined>
    list(options?: {
      readonly sinceTime?: number
      readonly limit?: number
    }): Promise<readonly { readonly txId: string; readonly time: number }[]>
    forget(txId: string): Promise<void>
  }
}
/** Concrete factory output keeps nested extension inference on Logger construction. */
export type IDurablePlugin<E extends Record<string, unknown>> = ILogPlugin<E, Record<string, never>>
