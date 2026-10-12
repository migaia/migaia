import type { IRpcProbeEventView } from '@migaia/rpc-core/probe'
import type { RpcLogCategory, RpcLogLevel } from './text.js'

/** Structural logger boundary: each method should enqueue work without blocking the RPC caller. */
export type IRpcLogSink = Readonly<{
  debug(message: string, fields: object): unknown
  info(message: string, fields: object): unknown
  warn(message: string, fields: object): unknown
  error(message: string, fields: object): unknown
}>

/** Logging policy compiles once; the owning emitter applies source sampling and method filters. */
export type IRpcLogProbeOptions = Readonly<{
  slowMs?: number
  sample?: number
  methods?: readonly string[]
  stages?: readonly ('message' | 'peer')[]
  /** Opts subscribed stages into capture; emit receives already-redacted caller-owned content. */
  content?: boolean
  levels?: Readonly<Partial<Record<RpcLogCategory, RpcLogLevel>>>
  /** Called synchronously for qualifying events; the reusable view must never be retained. */
  message?(view: IRpcProbeEventView): string
  /** Receives logger or formatting failures without changing the business flow. */
  onError?(error: unknown): void
}>
