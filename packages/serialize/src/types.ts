/** Public chunk, parser and registry contracts own shared tuple and encoding admission. */
import { SerializeDiagnosticText } from './diagnostic-text.ts'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IScheduler } from '@migaia/utils/scheduler'

/**
 * 结构化取消信号：只描述 `AbortSignal` 用到的那部分形状，不依赖 DOM lib.d.ts—— 这个包要在 Deno/Bun/小程序等不一定有全局 `AbortSignal`
 * 类型的运行时里可用。
 *
 * 信号形状由中立的 utils 原语提供；serialize 不反向依赖 RPC、Store 或宿主适配器，避免只需要 codec 的消费者被迫引入上层传输实现。
 */
import {
  SERIALIZE_SOURCE,
  createSerializeRangeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText
} from './errors.ts'
import { isUint8Array } from '@migaia/utils/bytes'
import type { ISerializeErrorCode } from './error-code.ts'
import {
  SerializeChunkKind,
  SerializeCleanupKind,
  SerializeCleanupPolicy,
  SerializePhase
} from './format-constants.ts'

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

/** Per-operation parser context; the registry owns cancellation composition and diagnostic labels. */
export type ISerializeContext = {
  /**
   * Cancellation signal. Even if the parser ignores it, the registry rejects with `ABORTED` and
   * discards the eventual result.
   */
  readonly signal: IAbortSignal
  /** Included in failure messages to identify the affected store or key. */
  readonly context: string
}

/** One chunk, a Promise of one chunk, or a synchronous/asynchronous chunk sequence to assemble. */
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
  /** Parser's diagnostic name; plugin.type, rather than this name, selects registry routing. */
  readonly name: string
  /** Produces chunks for one value; registry collection rejects empty or mixed value outputs. */
  encode(value: unknown, context: ISerializeContext): ISerializeOutput
  /** Decodes one admitted chunk; returned values are not automatically cloned or portable-checked. */
  decode(chunk: ISerializeChunk, context: ISerializeContext): unknown | Promise<unknown>
  /**
   * Releases parser-owned resources such as worker ports or Wasm handles. Return a Promise for
   * asynchronous release; registry disposal awaits it once per parser identity, even when several
   * plugin types share that parser. Omitted by default.
   */
  dispose?(): void | Promise<void>
}

/**
 * Registers a parser under an envelope format tag. Reads can use older registered formats while new
 * writes use a new format without clearing data.
 */
export type ISerializePlugin = {
  /**
   * Envelope routing token matching SERIALIZE_TYPE_PATTERN; first registered type is the write
   * default.
   */
  readonly type: string
  /** Parser whose methods and original receiver are captured when registry ownership begins. */
  readonly parser: ISerializeParser
}

/** Encode/decode location domain carried by SerializeCodecError, not a lifecycle state. */
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

/**
 * Validates a 1–64 character routing token without changing it; invalid spelling throws coded
 * RangeError INVALID_OPTION.
 */
export function assertSerializeType(type: string): void {
  if (!SERIALIZE_TYPE_PATTERN.test(type)) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      SerializeDiagnosticText.invalidType(type, SERIALIZE_TYPE_PATTERN)
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

/** Rejects a malformed tuple with its exact collection location and no additional wrapper. */
function rejectSerializeChunk(
  message: string,
  details: Parameters<typeof validateSerializeChunk>[1]
): never {
  throw new SerializeCodecError(message, { ...details, code: SerializeErrorCode.invalidChunk })
}

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
  try {
    if (!Array.isArray(candidate) || candidate.length !== 2) {
      rejectSerializeChunk(SerializeDiagnosticText.chunkPair, details)
    }
    /** Only the admitted pair container is read before producing a frozen snapshot. */
    const tuple = candidate as unknown as readonly [unknown, unknown]
    /** Chunk discriminant is captured once so caller getters cannot change the branch. */
    const kind = tuple[0]
    /** Payload identity is preserved while tuple properties are snapshotted. */
    const data = tuple[1]
    if (kind === SerializeChunkKind.text) {
      if (typeof data !== 'string') rejectSerializeChunk(SerializeDiagnosticText.chunkText, details)
      // Copy only the tuple container. Payload identity, including Uint8Array/value references,
      // remains unchanged while later consumers cannot reread a hostile tuple.
      return Object.freeze([kind, data]) as ISerializeChunk
    }
    if (kind === SerializeChunkKind.bytes) {
      if (!isUint8Array(data)) {
        rejectSerializeChunk(SerializeDiagnosticText.chunkBytes, details)
      }
      return Object.freeze([kind, data]) as ISerializeChunk
    }
    if (kind !== SerializeChunkKind.value)
      rejectSerializeChunk(SerializeDiagnosticText.chunkUnknown, details)
    return Object.freeze([kind, data]) as ISerializeChunk
  } catch (error) {
    if (error instanceof SerializeCodecError) throw error
    throw new SerializeCodecError(SerializeDiagnosticText.chunkValidation, {
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
  /** Package owning this failure; defaults to the serialize source unless explicitly overridden. */
  readonly source: string
  /** Public semantic failure code; independent of the human-readable message. */
  readonly code: TCode
  /** Optional caller label identifying the operation, store, or key. */
  readonly context?: string
  /** Selected parser format or stream diagnostic type. */
  readonly type: string
  /** Whether failure occurred while encoding or decoding. */
  readonly phase: ISerializePhase
  /** Zero-based chunk or stream-slice position supplied by the reporting boundary. */
  readonly chunkIndex: number
  /** Byte progress recorded at that boundary; text characters are not implicitly counted as bytes. */
  readonly bytesConsumed: number
  // `Error` owns `cause`; `super(message, { cause })` retains the original object by identity.

  /**
   * Builds a diagnostic error with the supplied location and original cause; does not freeze
   * payloads.
   */
  constructor(
    message: string,
    details: {
      /** Required public semantic failure code. */
      code: TCode
      /** Required format or stream label. */
      type: string
      /** Required encode/decode location. */
      phase: ISerializePhase
      /** Required zero-based position selected by the boundary. */
      chunkIndex: number
      /** Required accumulated byte count selected by the boundary. */
      bytesConsumed: number
      /** Optional caller diagnostic label; omitted by default. */
      context?: string
      /**
       * Overrides the default `serialization` source when a higher-level package reuses this error
       * class.
       */
      source?: string
      /** Original failure retained by reference through Error.cause when provided. */
      cause?: unknown
    }
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined)
    this.name = SerializeDiagnosticText.codecErrorName
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
  /** Encoder output is observed once before native byte-array admission. */
  let encoded: unknown
  try {
    encoded = encoder.encode(text)
  } catch (error) {
    throw new SerializeCodecError(SerializeDiagnosticText.textEncodeAt(details.chunkIndex), {
      ...details,
      code: SerializeErrorCode.encodeFailed,
      cause: error
    })
  }
  if (isUint8Array(encoded)) return encoded
  /** An undefined return needs an explicit cause instead of losing its classification. */
  const invalidReturn =
    encoded === undefined
      ? createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeErrorText.textEncoderOutputInvalid
        )
      : encoded
  throw new SerializeCodecError(SerializeDiagnosticText.textEncoderOutputAt(details.chunkIndex), {
    ...details,
    code: SerializeErrorCode.invalidChunk,
    cause: invalidReturn
  })
}

/**
 * Structural Encoding API capability injected into core, plugins, and registry without requiring
 * concrete host classes.
 */
export type ITextEncoder = {
  /** Encodes text to bytes with the implementation's chosen character encoding. */
  encode(input: string): Uint8Array
}
/** Structural byte-to-text capability; consumers inject it instead of requiring a DOM type. */
export type ITextDecoder = {
  /** Decodes bytes using the implementation's encoding and malformed-input policy. */
  decode(input: Uint8Array): string
}

/** Multi-format parser owner with assembled operations, cooperative cancellation, and final cleanup. */
export type ISerializeRegistry = {
  /** Default write format, taken from the first registered plugin. */
  readonly primaryType: string
  /** Registration-order type snapshot; disposing clears routing, not this diagnostic list. */
  readonly types: readonly string[]
  /** Checks current routing membership; returns false for all types after final parser cleanup. */
  has(type: string): boolean
  /**
   * Encodes and assembles one operation: text joins as text, multiple mixed/byte chunks become
   * bytes, and a value chunk must stand alone. Rejects parser, chunk, or cancellation failures with
   * location and cause; closed registries reject REGISTRY_DISPOSED.
   */
  encode(
    value: unknown,
    options?: {
      /** Defaults to primaryType; chunks do not themselves carry this routing token. */
      readonly type?: string
      /**
       * Optional caller cancellation signal; composed with registry closing, not forcibly
       * interrupting parser code.
       */
      readonly signal?: IAbortSignal
      /** Diagnostic label, default anonymous. */
      readonly context?: string
    }
  ): Promise<ISerializeChunk>
  /**
   * Decodes one validated chunk through the selected parser; abort discards late results while
   * underlying work stays observed.
   */
  decode(
    chunk: ISerializeChunk,
    options?: {
      /** Defaults to primaryType; use the stored format token explicitly for older payloads. */
      readonly type?: string
      /** Optional caller cancellation signal, composed with registry closing. */
      readonly signal?: IAbortSignal
      /** Diagnostic label, default anonymous. */
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
   * cleanup. Repeated calls share the same Promise. The first admitted call fixes deadlineAt; its
   * deadline limits draining, not parser cleanup. Invalid deadline input rejects before closing,
   * and cleanup failures follow the configured throw/report policy.
   */
  dispose(options?: {
    /**
     * Finite absolute scheduler-clock deadline; omitted waits indefinitely, past values skip
     * draining.
     */
    readonly deadlineAt?: number
  }): Promise<void>
}

/** Cleanup-policy report describing a parser release failure without replacing its original object. */
export type ISerializeCleanupError = {
  /** Cleanup-error discriminant, separate from a thrown semantic error code. */
  readonly kind: typeof SerializeCleanupKind.cleanupError
  /** Registry package identity. */
  readonly source: string
  /** Original parser cleanup failure or aggregate retained by reference. */
  readonly error: unknown
}

/** Informational deadline observation; reaching this condition does not itself reject disposal. */
export type ISerializeTimeoutDiagnostic = {
  /** Drain-timeout discriminant, distinct from parser cleanup failure. */
  readonly kind: typeof SerializeCleanupKind.drainTimeout
  /** Registry package identity. */
  readonly source: string
  /** Admitted absolute scheduler-clock deadline when supplied. */
  readonly deadlineAt?: number
  /** Number of tracked parser tasks still pending when the deadline is observed. */
  readonly pendingCount?: number
}

/**
 * Construction-time capability and cleanup policy snapshot; later caller mutation does not
 * reconfigure a registry.
 */
export type ISerializeRegistryOptions = {
  /**
   * Defaults to `systemScheduler` from `@migaia/utils/scheduler`. Fixed at construction; the
   * scheduler subpath defines its monotonic clock contract.
   */
  readonly scheduler?: IScheduler
  /**
   * Defaults to the host `TextEncoder`, explicitly requiring the Encoding API. Fixed at
   * construction and used when encoded text must join byte output.
   */
  readonly encoder?: ITextEncoder
  /**
   * Defaults to the host `TextDecoder`, explicitly requiring the Encoding API. Fixed at
   * construction. Parser-specific decoding remains owned by the parser; this option does not
   * replace a JSON plugin's own decoder configuration.
   */
  readonly decoder?: ITextDecoder
  /**
   * Optional cleanup error policy. Defaults to `{ policy: 'throw' }`. The report policy requires a
   * reporter.
   */
  readonly cleanup?:
    | {
        /** Reject disposal with cleanup failure, retaining an earlier primary. */
        readonly policy: typeof SerializeCleanupPolicy.throw
      }
    | {
        /** Observe cleanup failure without making it the disposal primary. */
        readonly policy: typeof SerializeCleanupPolicy.report
        /** Required for report policy; receives the original cleanup diagnostic. */
        readonly report: (d: ISerializeCleanupError) => void
      }
  /**
   * Optional drain-timeout observer, default no-op; synchronous observer failure does not prevent
   * cleanup.
   */
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
