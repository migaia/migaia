import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'

/**
 * 结构化取消信号：只描述 `AbortSignal` 用到的那部分形状，不依赖 DOM lib.d.ts—— 这个包要在 Deno/Bun/小程序等不一定有全局 `AbortSignal`
 * 类型的运行时里可用。
 *
 * 故意在这里复制一份而不是从 `@migaia/rpc/core` 里借用同名类型：serialize 是 store-persist/store-ssr/store-worker 依赖的底层
 * codec 原语，而 RPC core 是更上层的传输层；反向依赖会倒置层次，也会让只需要 codec 的消费者被迫依赖整个 RPC 包。
 */
import {
  SERIALIZE_SOURCE,
  createSerializeRangeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText
} from './errors.js'
import { isUint8Array } from '@migaia/utils/bytes'
import type { ISerializeErrorCode } from './error-code.js'
import {
  SerializeChunkKind,
  SerializeCleanupKind,
  SerializeCleanupPolicy,
  SerializePhase
} from './format-constants.js'

/**
 * Serialization chunk protocol.
 *
 * Each chunk carries a kind tag that controls assembly. One output can mix kinds, such as a text
 * header followed by streamed byte chunks. Parsers can produce a single chunk, a Promise, or an
 * async iterable.
 *
 * `text` carries wire text for localStorage or inline HTML. `bytes` carries wire bytes for
 * zero-copy transfer, IndexedDB, or Wasm. `value` carries a complete object requiring no further
 * parsing. Passthrough parsers, such as memory storage or test stubs, avoid an unnecessary encoding
 * round trip.
 */
export type ISerializeChunk =
  | readonly [typeof SerializeChunkKind.text, string]
  | readonly [typeof SerializeChunkKind.bytes, Uint8Array]
  | readonly [typeof SerializeChunkKind.value, unknown]

export type ISerializeContext = {
  /**
   * Cancellation signal. Even if the parser ignores it, the registry rejects with `ABORTED` and
   * discards the eventual result.
   */
  readonly signal: IAbortSignal
  /** Included in failure messages to identify the affected store or key. */
  readonly context: string
}

export type ISerializeOutput =
  | ISerializeChunk
  | Promise<ISerializeChunk>
  | Iterable<ISerializeChunk>
  | AsyncIterable<ISerializeChunk>

/**
 * Parser implementation. Synchronous implementations return values directly without creating their
 * own Promises or extra microtasks.
 */
export type ISerializeParser = {
  readonly name: string
  encode(value: unknown, context: ISerializeContext): ISerializeOutput
  decode(chunk: ISerializeChunk, context: ISerializeContext): unknown | Promise<unknown>
  /**
   * Releases parser-owned resources such as worker ports or Wasm handles. Return a Promise for
   * asynchronous release; the framework awaits it.
   */
  dispose?(): void | Promise<void>
}

/**
 * Registers a parser under an envelope format tag. Reads can use older registered formats while new
 * writes use a new format without clearing data.
 */
export type ISerializePlugin = {
  readonly type: string
  readonly parser: ISerializeParser
}

export type ISerializePhase = (typeof SerializePhase)[keyof typeof SerializePhase]

/**
 * Allowed plugin `type` characters.
 *
 * The type enters the SSR `data-codec` HTML attribute and the persistence header
 * `MW1|<type>|<t|b>|`. Quotes can close attributes, `>` can close tags, and `|` can break envelope
 * parsing. Plugin types often come from untrusted third-party packages.
 *
 * Registration accepts only token characters. Write sites also escape them, retaining both
 * protections.
 */
export const SERIALIZE_TYPE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export function assertSerializeType(type: string): void {
  if (!SERIALIZE_TYPE_PATTERN.test(type)) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      `invalid serialize plugin type: ${JSON.stringify(type)}; expected ${String(SERIALIZE_TYPE_PATTERN)}`
    )
  }
}

/**
 * Distinguishes one chunk from a container of chunks.
 *
 * Both are arrays. A chunk begins with a kind string; a container begins with another chunk array.
 * This checks the string shape without validating the tag. Invalid tags reach
 * `validateSerializeChunk` for precise diagnostics instead of being mistaken for a container.
 */
export const isChunkShape = (value: unknown): value is readonly [string, unknown] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'

/**
 * Validate one chunk at a package boundary and retain its stream position in any failure. Registry
 * encoding and public stream collection share this validator so malformed tuples cannot escape as
 * raw property-access failures or be misreported as transport failures.
 */
export function validateSerializeChunk(
  candidate: unknown,
  details: {
    readonly type: string
    readonly phase: ISerializePhase
    readonly context: string
    readonly chunkIndex: number
    readonly bytesConsumed: number
  }
): ISerializeChunk {
  const fail = (message: string): never => {
    throw new SerializeCodecError(message, {
      ...details,
      code: SerializeErrorCode.invalidChunk
    })
  }

  try {
    if (!Array.isArray(candidate) || candidate.length !== 2) {
      fail('serialize chunk must be a [type, data] pair')
    }
    const tuple = candidate as readonly [unknown, unknown]
    const kind = tuple[0]
    const data = tuple[1]
    if (kind === SerializeChunkKind.text) {
      if (typeof data !== 'string') fail('text chunk data must be a string')
      // Copy only the tuple container. Payload identity, including Uint8Array/value references,
      // remains unchanged while later consumers cannot reread a hostile tuple.
      return Object.freeze([kind, data]) as ISerializeChunk
    }
    if (kind === SerializeChunkKind.bytes) {
      if (!isUint8Array(data)) {
        fail('bytes chunk data must be a Uint8Array')
      }
      return Object.freeze([kind, data]) as ISerializeChunk
    }
    if (kind !== SerializeChunkKind.value) fail('unknown serialize chunk type')
    return Object.freeze([kind, data]) as ISerializeChunk
  } catch (error) {
    if (error instanceof SerializeCodecError) throw error
    throw new SerializeCodecError('serialize chunk validation failed', {
      ...details,
      code: SerializeErrorCode.invalidChunk,
      cause: error
    })
  }
}

/**
 * Encoding or decoding error with `type`, `phase`, `chunkIndex`, and `bytesConsumed` for failure
 * location. Codes include `CODEC_NOT_FOUND`, `ENCODE_FAILED`, `DECODE_FAILED`, `INVALID_CHUNK`, and
 * `ABORTED`. Construction and lifecycle failures use `createSerializeError` instead of this class.
 *
 * `TCode` defaults to registered serialize codes, `ISerializeErrorCode`. Higher-level packages such
 * as store-worker can supply their own code union when reusing the class.
 */
export class SerializeCodecError<TCode extends string = ISerializeErrorCode> extends Error {
  readonly source: string
  readonly code: TCode
  readonly context?: string
  readonly type: string
  readonly phase: ISerializePhase
  readonly chunkIndex: number
  readonly bytesConsumed: number
  // `Error` owns `cause`; `super(message, { cause })` retains the original object by identity.

  constructor(
    message: string,
    details: {
      code: TCode
      type: string
      phase: ISerializePhase
      chunkIndex: number
      bytesConsumed: number
      context?: string
      /**
       * Overrides the default `@migaia/serialize` source when a higher-level package reuses this
       * error class.
       */
      source?: string
      cause?: unknown
    }
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined)
    this.name = 'SerializeCodecError'
    this.source = details.source ?? SERIALIZE_SOURCE
    this.code = details.code
    if (details.context !== undefined) this.context = details.context
    this.type = details.type
    this.phase = details.phase
    this.chunkIndex = details.chunkIndex
    this.bytesConsumed = details.bytesConsumed
  }
}

/**
 * Encode one text chunk inside its collection boundary, preserving encoder receiver semantics and
 * distinguishing a thrown encoder from a non-byte encoder result.
 */
export function encodeSerializeTextChunk(
  encoder: ITextEncoder,
  text: string,
  details: {
    readonly type: string
    readonly phase: ISerializePhase
    readonly context: string
    readonly chunkIndex: number
    readonly bytesConsumed: number
  }
): Uint8Array {
  let encoded: unknown
  try {
    encoded = encoder.encode(text)
  } catch (error) {
    throw new SerializeCodecError(
      `${SerializeErrorText.textEncodeFailed} at chunk ${details.chunkIndex}`,
      { ...details, code: SerializeErrorCode.encodeFailed, cause: error }
    )
  }
  if (isUint8Array(encoded)) return encoded
  const invalidReturn =
    encoded === undefined
      ? createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeErrorText.textEncoderOutputInvalid
        )
      : encoded
  throw new SerializeCodecError(
    `${SerializeErrorText.textEncoderOutputInvalid} at chunk ${details.chunkIndex}`,
    { ...details, code: SerializeErrorCode.invalidChunk, cause: invalidReturn }
  )
}

/**
 * Structural Encoding API capability injected into core, plugins, and registry without requiring
 * concrete host classes.
 */
export type ITextEncoder = { encode(input: string): Uint8Array }
export type ITextDecoder = { decode(input: Uint8Array): string }

export type ISerializeRegistry = {
  /** Default write format, taken from the first registered plugin. */
  readonly primaryType: string
  readonly types: readonly string[]
  has(type: string): boolean
  encode(
    value: unknown,
    options?: {
      readonly type?: string
      readonly signal?: IAbortSignal
      readonly context?: string
    }
  ): Promise<ISerializeChunk>
  decode(
    chunk: ISerializeChunk,
    options?: {
      readonly type?: string
      readonly signal?: IAbortSignal
      readonly context?: string
    }
  ): Promise<unknown>
  /**
   * Synchronously rejects new requests and aborts the internal closing controller. Idempotent and
   * never invokes parser disposers.
   */
  close(): void
  /**
   * Closes first, then drains pending work until settlement or `deadlineAt` before awaiting parser
   * cleanup. Repeated calls share the same Promise. The first admitted call fixes `deadlineAt`.
   */
  dispose(options?: { readonly deadlineAt?: number }): Promise<void>
}

export type ISerializeCleanupError = {
  readonly kind: typeof SerializeCleanupKind.cleanupError
  readonly source: string
  readonly error: unknown
}

export type ISerializeTimeoutDiagnostic = {
  readonly kind: typeof SerializeCleanupKind.drainTimeout
  readonly source: string
  readonly deadlineAt?: number
  readonly pendingCount?: number
}

export type ISerializeRegistryOptions = {
  /**
   * Defaults to `systemScheduler` from `@migaia/utils/scheduler`. Fixed at construction; the
   * scheduler subpath defines its monotonic clock contract.
   */
  readonly scheduler?: IScheduler
  /**
   * Defaults to the host `TextEncoder`, explicitly requiring the Encoding API. Fixed at
   * construction.
   */
  readonly encoder?: ITextEncoder
  /**
   * Defaults to the host `TextDecoder`, explicitly requiring the Encoding API. Fixed at
   * construction.
   */
  readonly decoder?: ITextDecoder
  /**
   * Optional cleanup error policy. Defaults to `{ policy: 'throw' }`. The report policy requires a
   * reporter.
   */
  readonly cleanup?:
    | { readonly policy: typeof SerializeCleanupPolicy.throw }
    | {
        readonly policy: typeof SerializeCleanupPolicy.report
        readonly report: (d: ISerializeCleanupError) => void
      }
  /** Optional drain-timeout observer, separate from the cleanup error boundary. */
  readonly onDrainTimeout?: (d: ISerializeTimeoutDiagnostic) => void
  /**
   * Optional reporter for secondary or late registry failures. Defaults to a fixed static no-op.
   * Reports iterator `return()` failures during active draining through `drainAsyncIterable`. Also
   * reports late rejections from detached work after the deadline and cleanup through `track`. Late
   * work does not rejoin the registry lifecycle. Neither report changes the primary rejection or
   * terminal state.
   */
  readonly report?: (error: unknown) => void
}
