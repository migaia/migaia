/**
 * Defines bounded fragment records, assembler outcomes and explicit clock/error/context ports.
 * Callers provide source identity and resource limits; the chunk assembler owns retention while
 * native carriers and semantic codecs keep their separate IO and admission responsibilities.
 */
import type { IRpcErrorWireMetadata } from '@migaia/rpc-contract/errors'

/** Carrier-supplied assembly identity; it does not authenticate a remote sender by itself. */
export type IRpcChunkContext = Readonly<{
  /** Original connection/source namespace used to isolate otherwise equal message ids. */
  source: string
  /** Message identifier for framing and whole-message ingress correlation. */
  messageId: string
}>
/** Pure admission outcome; rejected carries an Error rather than throwing that framing failure. */
export type IRpcChunkResult<TEncoded> =
  | Readonly<{
      /** Assembly is retained but not yet complete. */
      status: 'pending'
    }>
  | Readonly<{
      /** All required fragments have been admitted in order. */
      status: 'complete'
      /** Reassembled encoded value, still awaiting semantic decoding/validation. */
      value: TEncoded
    }>
  | Readonly<{
      /** This physical message was rejected. */
      status: 'rejected'
      /** Classified framing/limit/expiry error for the caller to handle. */
      error: Error
    }>

/** Stable string fragment wire shape; `source` is supplied by the transport boundary. */
export type IRpcStringChunk = Readonly<{
  /** Stable message identifier shared by every fragment. */
  messageId: string
  /** Zero-based fragment position; native reassembly requires ordered delivery. */
  index: number
  /** Total fragment count, bounded before assembly retention. */
  count: number
  /** Complete string length in UTF-16 code units, matching the native string-framer quota. */
  length: number
  /** This fragment's string slice, not a separately encoded JSON document. */
  data: string
}>

/** Stable binary fragment wire shape used by binary transports. */
export type IRpcBinaryChunk = Readonly<{
  /** Identifier shared by all fragments within one source namespace. */
  messageId: string
  /** Zero-based ordered fragment position. */
  index: number
  /** Bounded total fragment count. */
  count: number
  /** Complete message byte length declared before reassembly. */
  length: number
  /** This fragment's byte slice. */
  data: Uint8Array
}>

/** Resource limits applied before a framer allocates or retains fragment state. */
export type IRpcChunkOptions = Readonly<{
  /** Caller-owned presentation maps accompany actual plugin-created errors only. */
  errorMetadata?: IRpcErrorWireMetadata
  /** Defaults to 16384 units: UTF-16 code units for strings, bytes for Uint8Array messages. */
  chunkBytes?: number
  /** Defaults to 16777216 units, with the same string/byte distinction as chunkBytes. */
  maxMessageBytes?: number
  /** Defaults to 4096 fragments per message; must be a positive safe integer. */
  maxChunks?: number
  /** Defaults to 67108864 retained units across assemblies; at least maxMessageBytes. */
  maxBufferedBytes?: number
  /** Defaults to 256 simultaneous source/message assemblies. */
  maxConcurrentMessages?: number
  /** Defaults to min(64, max(1, floor(maxConcurrentMessages / 4))) incomplete messages per source. */
  maxConcurrentMessagesPerSource?: number
  /** Defaults to min(16777216, max(1, floor(maxBufferedBytes / 4))) declared units per source. */
  maxBufferedBytesPerSource?: number
  /** Defaults to 30000 ms; positive safe-integer retention lifetime for an incomplete assembly. */
  assemblyTimeoutMs?: number
  /** Optional timer admission callback; omission uses the host timeout path. */
  schedule?: (callback: () => void, delayMs: number) => unknown
  /** Optional cancellation for scheduled handles; omission uses the host timeout cancellation. */
  cancel?: (handle: unknown) => void
}>

/** Plugin-private ordered chunk assembly has no protocol descriptor or callable identity registry. */
export type IRpcChunkAssembler<T> = Readonly<{
  frame(value: T, context: IRpcChunkContext): readonly (T | IRpcStringChunk | IRpcBinaryChunk)[]
  accept(value: unknown, context: IRpcChunkContext): IRpcChunkResult<T>
  close(): void
  /** Physical retirement releases only this source's assemblies, terminal entries and timers. */
  closeSource(source: string): void
}>
