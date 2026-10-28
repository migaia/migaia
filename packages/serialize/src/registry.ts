import { SerializeContext } from './operation-constants.ts'
/** Registry admission, parser ownership, operations and terminal draining share one owner. */
import { createAbortController } from '@migaia/lifecycle/abort'
import { createLifecycleScope, type ILifecycleScope } from '@migaia/lifecycle/scope'
import { createPendingTracker, type IPendingTracker } from '@migaia/lifecycle/quiescence'
import {
  SerializeCodecError,
  validateSerializeChunk,
  type ISerializeChunk,
  type ISerializeOutput,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin,
  type ISerializeRegistry,
  type ISerializeRegistryOptions,
  type ITextDecoder,
  type ITextEncoder
} from './types.ts'
import {
  createSerializeError,
  createSerializeRangeError,
  createSerializeTypeError,
  SERIALIZE_SOURCE,
  SerializeErrorCode,
  SerializeErrorText,
  tagSerializeFailure
} from './errors.ts'
import {
  SerializeChunkKind,
  SerializeCleanupKind,
  SerializeCleanupPolicy,
  SerializePhase
} from './format-constants.ts'
import { composeSerializeSignal } from './signal.ts'
import { reasonOf, appendCleanupErrors } from './operation-support.ts'
import { snapshotOperationOptions } from './operation-options.ts'
import { snapshotRegistryOptions, type IRegistryOptionsSnapshot } from './registry-options.ts'
import {
  snapshotPluginList,
  snapshotPlugin,
  type IInvokable,
  type IParserSnapshot,
  type IParserMethodsSnapshot
} from './registry-protocol.ts'
import { ChunkCollection } from './registry-chunks.ts'
import { SerializeAbortRace } from './registry-abort.ts'
import { SerializeDiagnosticText } from './diagnostic-text.ts'

/** Registry state owns parser routes and delegates scope, abort and drain primitives to lifecycle. */
class SerializeRegistryOwner {
  /** Closing cancellation is created before parser admission and never revived. */
  readonly #closing = createAbortController()
  /** The existing lifecycle scope owns each unique parser exactly once, in registration order. */
  readonly #scope: ILifecycleScope = createLifecycleScope()
  /** Captured construction capabilities cannot be reconfigured by caller mutation. */
  readonly #options: IRegistryOptionsSnapshot
  /** Routing entries are removed together after parser cleanup, including cleanup failure. */
  readonly #byType = new Map<string, IParserSnapshot>()
  /** First admitted plugin determines operation defaults throughout the registry lifetime. */
  #primaryType = ''
  /** Tracker leases remain pending after a public cancellation until parser tasks settle. */
  readonly #pending: IPendingTracker
  /** Close rejects new operations before notifying closing-signal listeners. */
  #closed = false
  /** Disposal fixes terminal state before the first asynchronous drain boundary. */
  #disposed = false
  /** The first valid disposal publishes this Promise before any reentrant user callback. */
  #disposePromise: Promise<void> | undefined

  /** Validates the entire plugin graph before acquiring any asynchronous parser ownership. */
  constructor(plugins: readonly ISerializePlugin[], options: IRegistryOptionsSnapshot) {
    this.#options = options
    /** Shared parser identities snapshot their methods once even under several routing tokens. */
    const parserMethods = new WeakMap<ISerializeParser, IParserMethodsSnapshot>()
    for (let index = 0; index < plugins.length; index++) {
      /** This plugin graph is admitted before its type enters routing. */
      const snapshot = snapshotPlugin(plugins[index], index, parserMethods)
      if (this.#byType.has(snapshot.type)) {
        throw createSerializeRangeError(
          SerializeErrorCode.invalidOption,
          SerializeDiagnosticText.pluginDuplicate(snapshot.type)
        )
      }
      if (index === 0) this.#primaryType = snapshot.type
      this.#byType.set(snapshot.type, snapshot)
    }
    /** Only unique parser identities enter the scope; disposal retains lifecycle LIFO ordering. */
    const ownedParsers = new Set<ISerializeParser>()
    /** Parser registration retains its captured receiver until lifecycle cleanup. */
    for (const snapshot of this.#byType.values()) {
      if (ownedParsers.has(snapshot.parser)) continue
      ownedParsers.add(snapshot.parser)
      /** Captured disposal preserves its original parser receiver without rereading a getter. */
      const capturedDispose = snapshot.dispose as IInvokable<void | Promise<void>> | undefined
      this.#scope.own(snapshot.parser, {
        force:
          capturedDispose === undefined
            ? () => undefined
            : () => Reflect.apply(capturedDispose, snapshot.parser, [])
      })
    }
    this.#pending = createPendingTracker()
  }

  /** Publishes the original mutable plain-object shape with independently callable own methods. */
  publish(): ISerializeRegistry {
    return {
      primaryType: this.#primaryType,
      types: [...this.#byType.keys()],
      has: (type) => this.#byType.has(type),
      encode: (value, options) => this.#encode(value, options),
      decode: (chunk, options) => this.#decode(chunk, options),
      close: () => this.#close(),
      dispose: (options) => this.#dispose(options)
    }
  }

  /** Closed state takes precedence over missing-type diagnostics. */
  #resolve(type: string, phase: ISerializePhase): IParserSnapshot {
    if (this.#closed || this.#disposed) {
      throw createSerializeError(
        SerializeErrorCode.registryDisposed,
        SerializeDiagnosticText.registryDisposed
      )
    }
    /** Map routing keeps each operation lookup O(1), independent of plugin count. */
    const parser = this.#byType.get(type)
    if (parser === undefined) {
      throw new SerializeCodecError(SerializeDiagnosticText.pluginMissing(type), {
        type,
        phase,
        context: SerializeContext.registry,
        chunkIndex: 0,
        bytesConsumed: 0,
        code: SerializeErrorCode.codecNotFound
      })
    }
    return parser
  }

  /** Admission and public cancellation preserve the original outer async operation boundary. */
  async #encode(
    value: unknown,
    options: Parameters<ISerializeRegistry['encode']>[1]
  ): Promise<ISerializeChunk> {
    /** Operation fields are read in their original type/signal/context order. */
    const operation = snapshotOperationOptions(options, this.#primaryType)
    /** Parser lookup runs before composing any signal listeners. */
    const parser = this.#resolve(operation.type, SerializePhase.encode)
    /** Composition owns both registrations until parser work finishes. */
    const composed = composeSerializeSignal(
      operation.signal,
      this.#closing.signal,
      this.#options.report
    )
    /** Complete parser collection, rather than public cancellation, owns the drain lease. */
    const parserTask = this.#encodeParser(value, parser, operation.context, composed)
    this.#pending.track(parserTask)
    return await new SerializeAbortRace(
      parserTask,
      composed.signal,
      { type: operation.type, phase: SerializePhase.encode, context: operation.context },
      this.#options.report
    ).promise
  }

  /** Parser execution retains the same synchronous call, collection await and final abort check. */
  async #encodeParser(
    value: unknown,
    parser: IParserSnapshot,
    context: string,
    composed: ReturnType<typeof composeSerializeSignal>
  ): Promise<ISerializeChunk> {
    /** Composed signal is reused for parser admission, collection and final cancellation. */
    const signal = composed.signal
    try {
      /** Parser output may be a chunk, thenable or either iterable protocol. */
      let output: ISerializeOutput
      try {
        output = Reflect.apply(parser.encode as IInvokable<ISerializeOutput>, parser.parser, [
          value,
          { signal, context }
        ])
      } catch (error) {
        throw new SerializeCodecError(SerializeDiagnosticText.stepFailed(reasonOf(error)), {
          type: parser.type,
          phase: SerializePhase.encode,
          context,
          chunkIndex: 0,
          bytesConsumed: 0,
          code: SerializeErrorCode.encodeFailed,
          cause: error
        })
      }
      /** Chunk assembly does not publish partial data on encoder or iterator failure. */
      const chunk = await new ChunkCollection(
        { type: parser.type, phase: SerializePhase.encode, context, signal },
        this.#options.encoder,
        this.#options.report
      ).collect(output)
      if (signal.aborted) {
        throw new SerializeCodecError(SerializeErrorText.aborted, {
          type: parser.type,
          phase: SerializePhase.encode,
          context,
          chunkIndex: 0,
          bytesConsumed: chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0,
          code: SerializeErrorCode.aborted,
          cause: signal.reason
        })
      }
      return chunk
    } finally {
      composed.dispose()
    }
  }

  /** Decode admission retains the same outer Promise and cancellation-race boundary. */
  async #decode(
    chunk: ISerializeChunk,
    options: Parameters<ISerializeRegistry['decode']>[1]
  ): Promise<unknown> {
    /** Public options are captured before parser lookup or cancellation registration. */
    const operation = snapshotOperationOptions(options, this.#primaryType)
    /** The parser receiver and its decode method were captured at construction. */
    const parser = this.#resolve(operation.type, SerializePhase.decode)
    /** Operation-owned listener registrations survive until the actual parser task settles. */
    const composed = composeSerializeSignal(
      operation.signal,
      this.#closing.signal,
      this.#options.report
    )
    /** Underlying work remains tracked even after public cancellation. */
    const parserTask = this.#decodeParser(chunk, parser, operation.context, composed)
    this.#pending.track(parserTask)
    return await new SerializeAbortRace(
      parserTask,
      composed.signal,
      { type: operation.type, phase: SerializePhase.decode, context: operation.context },
      this.#options.report
    ).promise
  }

  /** One validated tuple enters the captured parser before the final cancellation recheck. */
  async #decodeParser(
    chunk: ISerializeChunk,
    parser: IParserSnapshot,
    context: string,
    composed: ReturnType<typeof composeSerializeSignal>
  ): Promise<unknown> {
    /** This signal is the same reference passed to parser decode. */
    const signal = composed.signal
    try {
      /** Tuple admission captures hostile getters once while retaining payload identity. */
      const validatedChunk = validateSerializeChunk(chunk, {
        type: parser.type,
        phase: SerializePhase.decode,
        context,
        chunkIndex: 0,
        bytesConsumed: 0
      })
      /** Awaited parser output keeps the original thenable and microtask behavior. */
      let value: unknown
      try {
        value = await Reflect.apply(
          parser.decode as IInvokable<unknown | Promise<unknown>>,
          parser.parser,
          [validatedChunk, { signal, context }]
        )
      } catch (error) {
        throw new SerializeCodecError(SerializeDiagnosticText.deserializeFailed(reasonOf(error)), {
          type: parser.type,
          phase: SerializePhase.decode,
          context,
          chunkIndex: 0,
          bytesConsumed:
            validatedChunk[0] === SerializeChunkKind.bytes ? validatedChunk[1].byteLength : 0,
          code: SerializeErrorCode.decodeFailed,
          cause: error
        })
      }
      if (signal.aborted) {
        throw new SerializeCodecError(SerializeDiagnosticText.deserializeAborted, {
          type: parser.type,
          phase: SerializePhase.decode,
          context,
          chunkIndex: 0,
          bytesConsumed: chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0,
          code: SerializeErrorCode.aborted,
          cause: signal.reason
        })
      }
      return value
    } finally {
      composed.dispose()
    }
  }

  /** Stops new admission before notifying operation cancellation listeners. */
  #close(): void {
    if (this.#closed || this.#disposed) return
    this.#closed = true
    this.#closing.abort()
  }

  /** First valid deadline fixes one terminal Promise before any user-owned callback can reenter. */
  #dispose(options: Parameters<ISerializeRegistry['dispose']>[0]): Promise<void> {
    if (this.#disposePromise !== undefined) return this.#disposePromise
    /** Invalid deadline reads reject without closing registry admission. */
    let deadlineAt: number | undefined
    try {
      deadlineAt = options?.deadlineAt
    } catch (cause) {
      return Promise.reject(
        createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeDiagnosticText.deadlineRead,
          { cause }
        )
      )
    }
    if (deadlineAt !== undefined && !Number.isFinite(deadlineAt)) {
      return Promise.reject(
        createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeDiagnosticText.deadlineFinite
        )
      )
    }
    /** Resolvers are captured synchronously before terminal work starts. */
    let resolveDispose!: () => void
    /** Rejection is observed by the published single-flight Promise. */
    let rejectDispose!: (error: unknown) => void
    this.#disposePromise = new Promise<void>((resolve, reject) => {
      resolveDispose = resolve
      rejectDispose = reject
    })
    void this.#runDispose(deadlineAt).then(resolveDispose, rejectDispose)
    return this.#disposePromise
  }

  /** Reports one drain deadline without allowing observer failure to prevent parser cleanup. */
  #reportTimeout(deadlineAt: number | undefined): void {
    try {
      this.#options.onDrainTimeout({
        kind: SerializeCleanupKind.drainTimeout,
        source: SERIALIZE_SOURCE,
        deadlineAt,
        pendingCount: this.#pending.size
      })
    } catch {
      // Timeout observers are contained exactly as in the original registry transaction.
    }
  }

  /** Drains and releases parsers in the original await order, retaining the first primary failure. */
  async #runDispose(deadlineAt: number | undefined): Promise<void> {
    this.#close()
    this.#disposed = true
    /** One transaction-local slot retains even undefined thrown primaries. */
    const state: IDisposeFailure = { primaryError: undefined, hasPrimaryError: false }
    /** Admitted deadline task is cancelled once in the drain finally boundary. */
    let timer: { cancel(): void } | undefined
    try {
      if (deadlineAt === undefined) {
        await this.#pending.drain()
      } else {
        /** Past deadlines report immediately without scheduling a task. */
        const remaining = deadlineAt - this.#options.scheduler.now()
        if (remaining <= 0) {
          this.#reportTimeout(deadlineAt)
        } else {
          /** Timer callback only resolves; scheduler admission failures remain primary. */
          let resolveDeadline!: () => void
          /** The deadline Promise never rejects and adds no detached failure path. */
          const deadlineReached = new Promise<void>((resolve) => {
            resolveDeadline = resolve
          })
          try {
            timer = this.#options.scheduler.schedule(resolveDeadline, remaining)
          } catch (error) {
            recordDisposeFailure(state, error)
          }
          if (!state.hasPrimaryError) {
            await Promise.race([this.#pending.drain(), deadlineReached])
            if (this.#pending.size > 0) this.#reportTimeout(deadlineAt)
          }
        }
      }
    } catch (error) {
      recordDisposeFailure(state, error)
    } finally {
      if (timer !== undefined) {
        try {
          timer.cancel()
        } catch (error) {
          recordDisposeFailure(state, error)
        }
      }
    }
    /** Parser cleanup remains separate from the drain deadline. */
    let cleanupError: unknown
    /** Undefined thrown cleanup values still count as failures. */
    let hasCleanupError = false
    try {
      await this.#scope.dispose()
    } catch (error) {
      cleanupError = error
      hasCleanupError = true
    } finally {
      this.#byType.clear()
    }
    if (hasCleanupError) {
      if (this.#options.cleanup.policy === SerializeCleanupPolicy.throw) {
        if (state.hasPrimaryError)
          state.primaryError = appendCleanupErrors(state.primaryError, [cleanupError])
        else recordDisposeFailure(state, cleanupError)
      } else {
        try {
          this.#options.cleanup.report({
            kind: SerializeCleanupKind.cleanupError,
            source: SERIALIZE_SOURCE,
            error: cleanupError
          })
        } catch {
          // Cleanup reporters cannot replace the original terminal result.
        }
      }
    }
    if (state.hasPrimaryError) throw state.primaryError
  }
}

/** First disposal failure survives later deadline cancellation and parser cleanup errors. */
type IDisposeFailure = { hasPrimaryError: boolean; primaryError: unknown }

/** Records only the first scheduler/drain failure for the terminal transaction. */
function recordDisposeFailure(state: IDisposeFailure, error: unknown): void {
  if (state.hasPrimaryError) return
  state.primaryError = error
  state.hasPrimaryError = true
}

/**
 * Converts text or byte chunks to text using the required `decoder`. Value chunks reject because
 * they have no text form. Text returns unchanged; byte decoding delegates to the supplied receiver.
 * Decoder failures retain coded native identity where possible, and value rejection is
 * INVALID_CHUNK.
 */
export function chunkToText(chunk: ISerializeChunk, decoder: ITextDecoder): string {
  if (chunk[0] === SerializeChunkKind.text) return chunk[1]
  if (chunk[0] === SerializeChunkKind.bytes) {
    try {
      return decoder.decode(chunk[1])
    } catch (error) {
      throw tagSerializeFailure(
        error,
        SerializeErrorCode.decodeFailed,
        SerializeErrorText.textDecodeFailed
      )
    }
  }
  throw createSerializeTypeError(
    SerializeErrorCode.invalidChunk,
    SerializeErrorText.valueTextUnsupported
  )
}

/**
 * Converts text or byte chunks to bytes using the required `encoder`, for transfer, IndexedDB, or
 * Wasm. Existing bytes are copied to a new Uint8Array; text delegates to the supplied encoder.
 * Encoder failures retain coded native identity where possible; value chunks reject INVALID_CHUNK.
 */
export function chunkToBytes(chunk: ISerializeChunk, encoder: ITextEncoder): Uint8Array {
  if (chunk[0] === SerializeChunkKind.bytes) return new Uint8Array(chunk[1])
  if (chunk[0] === SerializeChunkKind.text) {
    try {
      return encoder.encode(chunk[1])
    } catch (error) {
      throw tagSerializeFailure(
        error,
        SerializeErrorCode.encodeFailed,
        SerializeErrorText.textEncodeFailed
      )
    }
  }
  throw createSerializeTypeError(
    SerializeErrorCode.invalidChunk,
    SerializeErrorText.valueBytesUnsupported
  )
}

export type {
  ISerializeChunk,
  ISerializeCleanupError,
  ISerializeContext,
  ISerializeParser,
  ISerializePhase,
  ISerializePlugin,
  ISerializeRegistry,
  ISerializeRegistryOptions,
  ISerializeTimeoutDiagnostic,
  ITextDecoder,
  ITextEncoder
} from './types.ts'

/** Captures and validates construction inputs before publishing a multi-format parser owner. */
export function createSerializeRegistry(
  plugins: readonly ISerializePlugin[],
  options?: ISerializeRegistryOptions
): ISerializeRegistry {
  /** Plugin-list admission precedes every capability and parser getter. */
  const snapshot = snapshotPluginList(plugins)
  if (snapshot.length === 0)
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      SerializeDiagnosticText.pluginsEmpty
    )
  return new SerializeRegistryOwner(snapshot, snapshotRegistryOptions(options)).publish()
}
