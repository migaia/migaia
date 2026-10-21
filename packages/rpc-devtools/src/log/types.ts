import type { IRpcProbeDefinition, IRpcProbeEventView } from '@migaia/rpc-core/probe'
import type { RpcLogCategory, RpcLogLevel } from './text.js'

/** Structural logger boundary: each method should enqueue work without blocking the RPC caller. */
export type IRpcLogSink = Readonly<{
  /** Explicit debug overrides; returned thenable rejections are observed. */
  debug(message: string, fields: object): unknown
  /** Default lifecycle sink, retaining this logger as receiver. */
  info(message: string, fields: object): unknown
  /** Default rejected/timeout/aborted/slow sink; buffering and flushing remain logger-owned. */
  warn(message: string, fields: object): unknown
  /** Default ordinary-failure sink; synchronous or asynchronous failures enter onError. */
  error(message: string, fields: object): unknown
}>

/** Logging policy compiles once; the owning emitter applies source sampling and method filters. */
export type IRpcLogProbeOptions = Readonly<{
  /**
   * Optional finite nonnegative elapsed-ms threshold; omission disables successful slow-call
   * logging.
   */
  slowMs?: number
  /** Sampling ratio, default 1; greater than 0 and at most 1, not a pause switch. */
  sample?: number
  /** Optional exact method selection; omission does not filter eligible methods. */
  methods?: readonly string[]
  /** Defaults to message and peer; this helper does not accept physical stages. */
  stages?: readonly ('message' | 'peer')[]
  /** Opts subscribed stages into capture; emit receives already-redacted caller-owned content. */
  content?: boolean
  /** Explicit subscribed stages whose captured content may be passed to the logger. */
  capture?: IRpcProbeDefinition['capture']
  /** Redacts captured content at the canonical emitter before logger fields are constructed. */
  redact?: IRpcProbeDefinition['redact']
  /**
   * Override failed/rejected/timeout/aborted/slow/lifecycle with debug/info/warn/error/off; omitted
   * keys retain defaults.
   */
  levels?: Readonly<Partial<Record<RpcLogCategory, RpcLogLevel>>>
  /** Called synchronously for qualifying events; the reusable view must never be retained. */
  message?(view: IRpcProbeEventView): string
  /** Receives logger or formatting failures without changing the business flow. */
  onError?(error: unknown): void
}>
