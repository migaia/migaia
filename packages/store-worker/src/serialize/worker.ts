import { attachErrorIdentity, attachSecondaryErrors, isNativeErrorValue } from '@migaia/utils/error'
import { WorkerMessagePort, type IWorkerMessagePort } from '../worker-message-event.js'
import {
  SerializeCodecError,
  SerializeChunkKind,
  isChunkShape,
  type ISerializeChunk,
  type ISerializeContext,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin
} from '@migaia/serialize'
import { isUint8Array } from '@migaia/utils/bytes'
import { RpcLifecycleError } from '@migaia/rpc-contract/errors'
import { createWorkerContractEndpoint, type IWorkerContractEndpoint } from '../worker-contract.js'
import { toManagedRpcHandler, type IManagedRpcHandler } from '../managed-rpc-handler.js'
import {
  createStoreWorkerAggregateError,
  createStoreWorkerError,
  STORE_WORKER_SOURCE,
  StoreWorkerErrorCode
} from '../errors.js'
import type { IStoreWorkerErrorCode } from '../error-code.js'
import { StoreWorkerErrorText } from '../error-text.js'
import { snapshotOwnDescriptors } from '@migaia/utils/object'
import {
  WorkerDiagnosticType,
  WorkerRpcIdentity,
  WorkerSerializeFrameKind,
  WorkerSerializeFrameMethod,
  WorkerSerializePhase
} from '../worker-constants.js'
import { CursorQueue } from '../cursor-queue.js'

/**
 * Identifies the `error` and `messageerror` worker failure events. Both must be observed so
 * requests do not remain pending indefinitely.
 */
export type IWorkerFailureEvent = 'error' | 'messageerror'

/** Borrowed Worker-like port with optional synchronous termination for explicitly owned cleanup. */
export type IWorkerLike = IWorkerMessagePort & {
  /** Called once on parser disposal only when terminateOnDispose is true; otherwise not invoked. */
  terminate?(): void
}

type IWorkerSerializeFrame = {
  readonly streamId: string
  readonly kind: keyof typeof WorkerSerializeFrameKind
  readonly sequence: number
  readonly chunk?: ISerializeChunk
}

type IWorkerFrameQueue = {
  readonly output: AsyncIterable<ISerializeChunk>
  push(frame: IWorkerSerializeFrame): void
  fail(error: unknown): void
  finish(): void
  cancel(): void
}

type IQueuedWorkerChunk = {
  readonly chunk: ISerializeChunk
  readonly sequence: number
}

type IWorkerAckState = {
  credits: number
  cancelled: boolean
  nextAckSequence: number
  readonly wake: CursorQueue<() => void>
  cancelReject?: (reason: unknown) => void
}

/** Creates the stable cancellation failure used while a worker stream is unwinding. */
function workerStreamCancelledError(): DOMException {
  return attachErrorIdentity(
    new DOMException(StoreWorkerErrorText.streamCancelled, StoreWorkerErrorText.abortName),
    { source: STORE_WORKER_SOURCE, code: StoreWorkerErrorCode.requestAborted }
  )
}

/** Waits for consumer credit without allowing an unbounded worker-side chunk queue. */
async function waitForWorkerCredit(state: IWorkerAckState): Promise<void> {
  if (state.cancelled) throw workerStreamCancelledError()
  if (state.credits > 0) {
    state.credits--
    return
  }
  await new Promise<void>((resolve) => state.wake.push(resolve))
  if (state.cancelled) throw workerStreamCancelledError()
  state.credits--
}

/** Takes one producer wake callback with amortized O(1) queue maintenance. */
function takeWorkerWake(state: IWorkerAckState): (() => void) | undefined {
  return state.wake.take()
}

/** Releases every producer waiting for credit during cancellation. */
function wakeAllWorkers(state: IWorkerAckState): void {
  let wake: (() => void) | undefined
  while ((wake = takeWorkerWake(state)) !== undefined) wake()
}

/** Preserves parser codec diagnostics when WebRPC reports an aborted request. */
function createWorkerRequestAbortedError(
  optionType: string | undefined,
  phase: ISerializePhase,
  chunk: ISerializeChunk,
  context: ISerializeContext,
  abortCause: unknown
): SerializeCodecError<IStoreWorkerErrorCode> {
  return new SerializeCodecError(StoreWorkerErrorText.aborted(), {
    type: optionType ?? WorkerDiagnosticType.worker,
    phase,
    context: context.context,
    chunkIndex: 0,
    bytesConsumed: chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0,
    code: StoreWorkerErrorCode.requestAborted,
    source: STORE_WORKER_SOURCE,
    cause: abortCause
  })
}

/** One suspended consumer receives either one chunk, terminal completion or the original failure. */
type IWorkerFrameWaiter = {
  readonly resolve: (result: IteratorResult<ISerializeChunk>) => void
  readonly reject: (error: unknown) => void
}

/** One bounded-consumer stream owns sequence admission, buffered chunks and waiting consumers. */
class WorkerFrameQueue implements IWorkerFrameQueue {
  /** Only this stream's frames may enter the queue. */
  #streamId: string
  /** Remote cancellation belongs to the parser/client that created this queue. */
  #cancelRemote: () => void
  /** Credits are returned only when a consumer actually takes a chunk. */
  #ackRemote: (sequence: number) => void
  /** Cursor queues retain amortized constant-time admission and consumption. */
  #chunks = new CursorQueue<IQueuedWorkerChunk>()
  /** Pending consumers are resolved in arrival order. */
  #waiters = new CursorQueue<IWorkerFrameWaiter>()
  /** Terminal failure remains the exact original thrown value. */
  #failure: unknown
  /** Completion fences later frames and cancellation. */
  #finished = false
  /** The next accepted frame must have this exact sequence. */
  #expectedSequence = 0
  /** Every iterator observes the same stream while retaining its own iterator receipt. */
  readonly output: AsyncIterable<ISerializeChunk> = {
    [Symbol.asyncIterator]: () => ({ next: this.#next, return: this.#return })
  }

  /** Capture the stream and remote actions without dispatching any frame. */
  constructor(streamId: string, cancelRemote: () => void, ackRemote: (sequence: number) => void) {
    this.#streamId = streamId
    this.#cancelRemote = cancelRemote
    this.#ackRemote = ackRemote
  }

  /** Complete all remaining waiters only after the stream becomes terminal. */
  #settle(): void {
    if (!this.#finished || this.#waiters.size === 0) return
    /** Each waiter is removed once, keeping a terminal batch linear in waiter count. */
    let waiter: IWorkerFrameWaiter | undefined
    while ((waiter = this.#waiters.take()) !== undefined) {
      if (this.#failure !== undefined) waiter.reject(this.#failure)
      else waiter.resolve({ done: true, value: undefined })
    }
  }

  /** Consume buffered chunks before observing a terminal error, preserving the existing prefix. */
  #next = async (): Promise<IteratorResult<ISerializeChunk>> => {
    /** Credit is returned for this exact sequence only when consumed. */
    const queued = this.#chunks.take()
    if (queued) {
      Reflect.apply(this.#ackRemote, undefined, [queued.sequence])
      return { done: false, value: queued.chunk }
    }
    if (this.#failure !== undefined) throw this.#failure
    if (this.#finished) return { done: true, value: undefined }
    return await new Promise<IteratorResult<ISerializeChunk>>((resolve, reject) => {
      this.#waiters.push({ resolve, reject })
    })
  }

  /** Iterator return shares the original cancellation and waiter completion boundary. */
  #return = async (): Promise<IteratorResult<ISerializeChunk>> => {
    this.cancel()
    return { done: true, value: undefined }
  }

  /** Admit sequence and chunk shape before delivering to one waiting consumer. */
  push = (frame: IWorkerSerializeFrame): void => {
    if (this.#finished || frame.streamId !== this.#streamId) return
    if (frame.sequence !== this.#expectedSequence) {
      this.fail(
        createStoreWorkerError(
          StoreWorkerErrorCode.invalidResponseChunk,
          StoreWorkerErrorText.invalidChunk
        )
      )
      return
    }
    this.#expectedSequence++
    if (frame.kind === WorkerSerializeFrameKind.open) return
    if (frame.kind === WorkerSerializeFrameKind.chunk) {
      if (!isChunkShape(frame.chunk)) {
        this.fail(
          createStoreWorkerError(
            StoreWorkerErrorCode.invalidResponseChunk,
            StoreWorkerErrorText.invalidChunk
          )
        )
        return
      }
      /** One waiting consumer bypasses buffering without acknowledging twice. */
      const waiter = this.#waiters.take()
      if (waiter) {
        Reflect.apply(this.#ackRemote, undefined, [frame.sequence])
        waiter.resolve({ done: false, value: frame.chunk })
      } else this.#chunks.push({ chunk: frame.chunk, sequence: frame.sequence })
      return
    }
    this.finish()
  }

  /** Preserve the first terminal failure and settle current waiters. */
  fail = (error: unknown): void => {
    if (this.#finished) return
    this.#failure = error
    this.#finished = true
    this.#settle()
  }
  /** Successful terminal frames keep already buffered chunks available. */
  finish = (): void => {
    this.#finished = true
    this.#settle()
  }
  /** Consumer cancellation notifies the remote producer at most once. */
  cancel = (): void => {
    if (this.#finished) return
    this.#finished = true
    Reflect.apply(this.#cancelRemote, undefined, [])
    this.#settle()
  }
}

/** Classifies a local codec payload; actual wire encoding remains owned by worker-contract. */
function workerChunk(value: unknown): ISerializeChunk {
  return isUint8Array(value) ? [SerializeChunkKind.bytes, value] : [SerializeChunkKind.value, value]
}

/** Main-side parser/plugin configuration captured before creating the RPC bridge. */
export type IWorkerPluginOptions = {
  /** Required message port; borrowed unless terminateOnDispose explicitly requests host termination. */
  readonly worker: IWorkerLike
  /**
   * Local registry format/parser label, default worker; actual encode/decode behavior comes from
   * the remote parser.
   */
  readonly type?: string
  /**
   * Controls whether disposal also terminates the worker. A supplied worker remains caller-owned by
   * default (false). Cleanup attempts optional terminate even when endpoint cleanup fails.
   */
  readonly terminateOnDispose?: boolean
  /** Local RPC endpoint id, default main; it is a captured string rather than an id factory. */
  readonly clientId?: string
}

/** Probes public options before property reads so revoked proxies become contract errors. */
function assertWorkerParserOptions(options: unknown): asserts options is IWorkerPluginOptions {
  if (options === null || typeof options !== 'object') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject
    )
  }
  const descriptorSnapshot = snapshotOwnDescriptors(options)
  if (!descriptorSnapshot.ok) {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject,
      { cause: descriptorSnapshot.error }
    )
  }
}

/**
 * Creates the main-side serialization parser for a caller-supplied Worker and remote parser. encode
 * returns a streamed sequence of worker chunks with consumer acknowledgements; decode requests one
 * chunk and returns its decoded payload. The format label defaults to worker. The remote parser
 * owns format behavior, while the bridge validates chunk shapes and carries RPC errors and their
 * causes; pre-cancellation produces REQUEST_ABORTED codec diagnostics.
 *
 * The portable RPC bridge copies inputs and base64url-encodes bytes without detaching buffers.
 * Supported values follow that bridge's portable profile, not arbitrary cyclic objects or
 * custom-class preservation.
 *
 * Invalid options throw at creation. The returned parser's dispose shares one asynchronous cleanup
 * result, closes the endpoint and optionally attempts terminate. Both failures are retained in
 * CLEANUP_FAILED AggregateError; single failures retain their boundary identity. Without explicit
 * termination ownership, the physical Worker remains caller-owned.
 */
export function workerParser(options: IWorkerPluginOptions): ISerializeParser {
  return new WorkerParser(options)
}

/** One parser owns its frame routes, request admission and cached cleanup promise. */
class WorkerParser implements ISerializeParser {
  /** Physical Worker is borrowed unless termination ownership is explicitly requested. */
  #worker: IWorkerLike
  /** Optional diagnostic format label is captured once. */
  #optionType: string | undefined
  /** Stable logical client identity is used in every stream identifier. */
  #clientId: string | undefined
  /** Physical termination remains independent from endpoint cleanup success. */
  #resolvedTerminateOnDispose: boolean
  /** Active stream routing belongs only to this parser. */
  #streams = new Map<string, IWorkerFrameQueue>()
  /** Monotonic stream ids preserve the existing per-parser sequence. */
  #nextStreamId = 1
  /** A single subscription receipt is shared by all encoder requests. */
  #frameSubscription: Promise<() => void> | undefined
  /** Disposal callers receive the exact same promise, including rejection. */
  #disposePromise: Promise<void> | undefined
  /** Native setup advertises the frame provider before discovery starts. */
  #unsubscribeFrame: () => void = () => undefined
  /** The one canonical Host owns connection readiness and physical delivery. */
  #client: Promise<IWorkerContractEndpoint>
  /** Registry-visible name retains the captured format default. */
  readonly name: string

  /** Admit hostile options before starting the actual Worker bridge. */
  constructor(options: IWorkerPluginOptions) {
    assertWorkerParserOptions(options)
    /** Borrowed worker captured before any native setup. */
    let worker: IWorkerPluginOptions['worker']
    /** Format label is read once for stable diagnostics. */
    let optionType: string | undefined
    /** Logical identity is captured once for every stream request. */
    let clientId: string | undefined
    /** Physical termination is opt-in and independent from endpoint cleanup. */
    let terminateOnDispose: boolean | undefined
    try {
      worker = options.worker
      optionType = options.type
      clientId = options.clientId
      terminateOnDispose = options.terminateOnDispose
    } catch (error) {
      throw createStoreWorkerError(
        StoreWorkerErrorCode.invalidOption,
        StoreWorkerErrorText.optionsObject,
        { cause: error }
      )
    }
    if (optionType !== undefined && typeof optionType !== 'string') {
      throw createStoreWorkerError(
        StoreWorkerErrorCode.invalidOption,
        StoreWorkerErrorText.stringOption('type')
      )
    }
    if (clientId !== undefined && typeof clientId !== 'string') {
      throw createStoreWorkerError(
        StoreWorkerErrorCode.invalidOption,
        StoreWorkerErrorText.stringOption('clientId')
      )
    }
    if (worker === null || typeof worker !== 'object') {
      throw createStoreWorkerError(StoreWorkerErrorCode.invalidOption, StoreWorkerErrorText.worker)
    }
    if (terminateOnDispose !== undefined && typeof terminateOnDispose !== 'boolean') {
      throw createStoreWorkerError(
        StoreWorkerErrorCode.invalidOption,
        StoreWorkerErrorText.terminateOnDispose
      )
    }
    this.#worker = worker
    this.#optionType = optionType
    this.#clientId = clientId
    this.#resolvedTerminateOnDispose = terminateOnDispose ?? false
    this.#client = createWorkerContractEndpoint(
      this.#worker,
      {
        id: this.#clientId ?? WorkerRpcIdentity.main,
        targetId: WorkerRpcIdentity.worker
      },
      (endpoint) => {
        if (this.#disposePromise === undefined)
          this.#unsubscribeFrame = endpoint.onRequest(WorkerSerializeFrameMethod, (payload) => {
            const frame = payload as IWorkerSerializeFrame
            const stream = this.#streams.get(frame.streamId)
            if (!stream) return
            stream.push(frame)
            if (frame.kind === WorkerSerializeFrameKind.end) this.#streams.delete(frame.streamId)
          })
        return endpoint
      }
    )
    this.name = optionType ?? WorkerDiagnosticType.worker
  }

  /** Join the one original frame subscription after local bridge preparation. */
  #ensureFrameSubscription = (): Promise<() => void> => {
    this.#frameSubscription ??= this.#client.then(() => {
      if (this.#disposePromise !== undefined) return () => undefined
      return this.#unsubscribeFrame
    })
    return this.#frameSubscription
  }

  /** Request one decoded chunk and retain original abort diagnostics. */
  #request = async (
    phase: ISerializePhase,
    chunk: ISerializeChunk,
    context: ISerializeContext
  ): Promise<ISerializeChunk> => {
    try {
      /** Every request and cleanup caller shares this original prepared endpoint. */
      const endpoint = await this.#client
      if (this.#disposePromise !== undefined)
        throw new RpcLifecycleError(StoreWorkerErrorText.disposed)
      /** The response must retain the existing serialization chunk envelope. */
      const result = (await endpoint.request(
        { phase, chunk },
        { signal: context.signal }
      )) as ISerializeChunk
      if (!isChunkShape(result)) {
        throw createStoreWorkerError(
          StoreWorkerErrorCode.invalidResponseChunk,
          StoreWorkerErrorText.invalidChunk
        )
      }
      return result
    } catch (error) {
      // Endpoint's abort rejection is generic; re-throw it as the
      // SerializeCodecError shape this parser's callers rely on for diagnostics
      // (chunk index / bytes consumed / which format). Inputs remain caller-owned copies.
      if (error instanceof Error && error.name === 'AbortError') {
        // web-rpc may synthesize its own AbortError at the transport boundary;
        // the caller's explicit reason is the authoritative original failure
        // and must remain reachable for identity/stack diagnostics.
        /** Explicit caller cancellation retains the authoritative original reason. */
        const abortCause = context.signal.reason ?? error
        throw createWorkerRequestAbortedError(this.#optionType, phase, chunk, context, abortCause)
      }
      throw error
    }
  }

  /** Allocate one acknowledged output stream while readiness and errors stay with the client. */
  #streamEncode = (
    chunk: ISerializeChunk,
    context: ISerializeContext
  ): AsyncIterable<ISerializeChunk> => {
    if (context.signal.aborted) {
      /** Pre-cancellation rejects before opening a remote stream. */
      const abortCause = context.signal.reason ?? workerStreamCancelledError()
      return Promise.reject(
        createWorkerRequestAbortedError(
          this.#optionType,
          WorkerSerializePhase.encode,
          chunk,
          context,
          abortCause
        )
      ) as never
    }
    /** Per-parser sequence keeps concurrent streams isolated. */
    const streamId = `${this.#clientId ?? WorkerRpcIdentity.main}:${this.#nextStreamId++}`
    /** This output stream alone owns its buffered consumer prefix. */
    const queue = new WorkerFrameQueue(
      streamId,
      () => {
        void this.#client.then((endpoint) => {
          if (this.#disposePromise !== undefined) return
          return endpoint.notify(
            {
              streamId,
              kind: WorkerSerializeFrameKind.cancel,
              sequence: -1
            },
            WorkerSerializeFrameMethod
          )
        })
      },
      (sequence) => {
        void this.#client.then((endpoint) => {
          if (this.#disposePromise !== undefined) return
          return endpoint.notify(
            {
              streamId,
              kind: WorkerSerializeFrameKind.ack,
              sequence
            },
            WorkerSerializeFrameMethod
          )
        })
      }
    )
    this.#streams.set(streamId, queue)
    void this.#ensureFrameSubscription()
      .then(() => this.#client)
      .then((endpoint) => {
        if (this.#disposePromise !== undefined)
          throw new RpcLifecycleError(StoreWorkerErrorText.disposed)
        return endpoint.request(
          {
            phase: WorkerSerializePhase.encode,
            chunk,
            streamId,
            clientId: this.#clientId ?? WorkerRpcIdentity.main
          },
          { signal: context.signal }
        )
      })
      .then(
        () => undefined,
        (error: unknown) => {
          queue.fail(error)
          this.#streams.delete(streamId)
        }
      )
    return queue.output
  }

  /** Fail streams, close the endpoint, then attempt explicitly owned physical termination. */
  #disposeOnce = async (): Promise<void> => {
    /** All active streams observe the same disposal boundary error. */
    const terminalError = new RpcLifecycleError(StoreWorkerErrorText.disposed)
    for (const queue of this.#streams.values()) queue.fail(terminalError)
    this.#streams.clear()
    /** Endpoint cleanup remains the primary failure when termination also fails. */
    let endpointError: unknown
    try {
      /** Every request and cleanup caller shares this original prepared endpoint. */
      const endpoint = await this.#client
      await endpoint.close()
    } catch (error) {
      endpointError =
        error instanceof RpcLifecycleError
          ? error
          : new RpcLifecycleError(StoreWorkerErrorText.endpointCleanup, error, [
              { resource: StoreWorkerErrorText.transportSubscription, error }
            ])
    }
    /** Physical termination failure follows the endpoint failure in aggregates. */
    let terminateError: unknown
    if (this.#resolvedTerminateOnDispose) {
      try {
        this.#worker.terminate?.()
      } catch (error) {
        terminateError = error
      }
    }
    if (endpointError !== undefined && terminateError !== undefined) {
      throw createStoreWorkerAggregateError(
        StoreWorkerErrorCode.cleanupFailed,
        [endpointError, terminateError],
        StoreWorkerErrorText.cleanupFailed
      )
    }
    if (endpointError !== undefined) throw endpointError
    if (terminateError !== undefined) throw terminateError
  }

  /** Encode keeps portable input copying and the existing acknowledged chunk stream. */
  encode: ISerializeParser['encode'] = (value, context) =>
    this.#streamEncode(workerChunk(value), context)
  /** Decode returns the admitted chunk payload, preserving the caller's cancellation context. */
  decode: ISerializeParser['decode'] = async (chunk, context) => {
    /** The canonical request path validates the returned chunk before exposing its payload. */
    const result = await this.#request(WorkerSerializePhase.decode, chunk, context)
    return result[1]
  }
  /** One cached receipt covers endpoint cleanup and optional owned termination. */
  dispose = (): Promise<void> => {
    this.#disposePromise ??= this.#disposeOnce()
    return this.#disposePromise
  }
}

/**
 * Creates workerParser and pairs its name with the parser in a registry plugin descriptor. Use when
 * installing a worker-backed format in createSerializeRegistry. Options, failures and parser
 * disposal are identical to workerParser; the descriptor does not create another Worker or
 * automatically own a caller-supplied Worker without terminateOnDispose.
 */
export const workerPlugin = (options: IWorkerPluginOptions): ISerializePlugin => {
  const parser = workerParser(options)
  return { type: parser.name, parser }
}

/**
 * Installs an ordinary parser on the worker side and responds through the serialization message
 * protocol.
 *
 * The caller forwards native message.data to the returned managed callback and supplies post for
 * outbound frames/optional transfers. Encode accepts a single chunk or synchronous/asynchronous
 * chunk iterable; chunks travel incrementally with a two-credit acknowledgement window rather than
 * merging a complete result. Decode returns the remote parser's decoded value through RPC.
 *
 * Invalid parser/post inputs throw INVALID_OPTION, preserving existing error identity or cause.
 * Operation failures travel through RPC with original/iterator-cleanup causes, and cancellation is
 * cooperative. Handler delivery completion is not parser completion. Await handler.dispose for its
 * endpoint cleanup, then separately detach the native listener and dispose the borrowed parser or
 * physical host if their owner requires it; this handler does not dispose the parser.
 */
export function createSerializeWorkerHandler(
  parser: ISerializeParser,
  post: (message: unknown, transfer?: readonly unknown[]) => void
): IManagedRpcHandler {
  assertSerializeHandlerInputs(parser, post)
  return new SerializeWorkerHandler(parser, post).handler
}

/** Admit parser/post inputs and retain native error identity before endpoint construction. */
function assertSerializeHandlerInputs(
  parser: ISerializeParser,
  post: (message: unknown, transfer?: readonly unknown[]) => void
): void {
  try {
    if (
      parser === null ||
      typeof parser !== 'object' ||
      typeof parser.encode !== 'function' ||
      typeof parser.decode !== 'function' ||
      typeof post !== 'function'
    ) {
      throw createStoreWorkerError(
        StoreWorkerErrorCode.invalidOption,
        StoreWorkerErrorText.handlerInvalid
      )
    }
  } catch (error) {
    if (isNativeErrorValue(error)) {
      /** Classify this public factory input without invoking error metadata getters. */
      let identified: Error | undefined
      try {
        /** Complete identities remain with the package that already owns the failure. */
        const source = Object.getOwnPropertyDescriptor(error, 'source')
        /** Unowned extensible native errors receive this existing invalid-input identity in place. */
        const code = Object.getOwnPropertyDescriptor(error, 'code')
        if (typeof source?.value === 'string' && typeof code?.value === 'string') identified = error
        else if (!source && !code && Object.isExtensible(error))
          identified = attachErrorIdentity(error, {
            source: STORE_WORKER_SOURCE,
            code: StoreWorkerErrorCode.invalidOption
          })
      } catch (metadataError) {
        throw createStoreWorkerAggregateError(
          StoreWorkerErrorCode.invalidOption,
          [error, metadataError],
          StoreWorkerErrorText.handlerInvalid
        )
      }
      if (identified) throw identified
    }
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.handlerInvalid,
      { cause: error }
    )
  }
}

/** One worker provider owns active streams and the two canonical Host registrations. */
class SerializeWorkerHandler {
  /** The parser remains borrowed and is never disposed by endpoint cleanup. */
  #parser: ISerializeParser
  /** Existing flow-control state is routed by the original stream identifier. */
  #streams = new Map<string, WorkerEncodeStream>()
  /** The actual prepared endpoint alone owns RPC registration and physical delivery. */
  #endpoint!: IWorkerContractEndpoint
  /** Cleanup removes the original frame subscription. */
  #unsubscribeFrame!: () => void
  /** Cleanup removes the original computation subscription after frame removal. */
  #unsubscribe!: () => void
  /** Callable managed admission retains its one readiness and disposal receipt. */
  readonly handler: IManagedRpcHandler

  /** Start one bridge after input validation, borrowing physical output and the parser. */
  constructor(
    parser: ISerializeParser,
    post: (message: unknown, transfer?: readonly unknown[]) => void
  ) {
    this.#parser = parser
    /** Raw delivery and listener lifetime share the existing local bridge owner. */
    const port = new WorkerMessagePort(post)
    /** Local preparation registers providers before the remote discovery can complete. */
    const endpointPromise = createWorkerContractEndpoint(
      port,
      { id: WorkerRpcIdentity.worker, targetId: WorkerRpcIdentity.main },
      (endpoint) => this.#prepare(endpoint)
    )
    this.handler = toManagedRpcHandler(endpointPromise, port.deliver)
  }

  /** Register frame control before computation, preserving the original provider order. */
  #prepare(endpoint: IWorkerContractEndpoint): { dispose(): Promise<void> } {
    this.#endpoint = endpoint
    this.#unsubscribeFrame = endpoint.onRequest(WorkerSerializeFrameMethod, this.#onFrame)
    this.#unsubscribe = endpoint.onRequest(WorkerRpcIdentity.call, this.#onRequest)
    return { dispose: this.#dispose }
  }

  /** Frame control updates only the matching existing stream. */
  #onFrame = async (payload: unknown): Promise<undefined> => {
    /** Wire frames are validated against their stream's original sequence owner. */
    const frame = payload as Partial<IWorkerSerializeFrame>
    if (typeof frame.streamId !== 'string') return undefined
    /** Unknown or already terminal streams retain the original ignored-frame behavior. */
    const stream = this.#streams.get(frame.streamId)
    if (!stream) return undefined
    if (frame.kind === WorkerSerializeFrameKind.cancel) stream.cancel()
    else if (frame.kind === WorkerSerializeFrameKind.ack) stream.ack(frame.sequence)
    return undefined
  }

  /** Validate one computation, then dispatch its encode or decode responsibility. */
  #onRequest = async (payload: unknown, signal: ISerializeContext['signal']): Promise<unknown> => {
    const { phase, chunk } = payload as { phase: ISerializePhase; chunk: ISerializeChunk }
    if (!isChunkShape(chunk))
      throw createStoreWorkerError(
        StoreWorkerErrorCode.invalidRequestChunk,
        StoreWorkerErrorText.invalidRequestChunk
      )
    /** The borrowed parser receives the original cooperative provider signal. */
    const context: ISerializeContext = { signal, context: 'serialize-worker' }
    if (phase === WorkerSerializePhase.encode) {
      /** Stream identity and target admission precede any parser work. */
      const stream = new WorkerEncodeStream(this.#endpoint, this.#parser, payload, context)
      this.#streams.set(stream.id, stream)
      try {
        return await stream.encode(chunk)
      } finally {
        this.#streams.delete(stream.id)
      }
    }
    if (phase !== WorkerSerializePhase.decode)
      throw createStoreWorkerError(
        StoreWorkerErrorCode.invalidOption,
        StoreWorkerErrorText.invalidPhase
      )
    /**
     * Decode preserves the parser result before classifying it into the existing worker chunk
     * shape.
     */
    const value = await this.#parser.decode(chunk, context)
    return workerChunk(value)
  }

  /** Endpoint cleanup never disposes the borrowed parser or physical Worker. */
  #dispose = async (): Promise<void> => {
    this.#unsubscribeFrame()
    this.#unsubscribe()
    await this.#endpoint.close()
  }
}

/** One encoder stream owns credit, sequence, cancellation and iterator cleanup. */
class WorkerEncodeStream {
  /** The actual Host endpoint owns physical writes and notifications. */
  #endpoint: IWorkerContractEndpoint
  /** Parser methods retain their original parser receiver. */
  #parser: ISerializeParser
  /** Original provider context includes its cooperative cancellation signal. */
  #context: ISerializeContext
  /** Logical target is validated once before stream registration. */
  #targetId: string
  /** Existing two-credit producer state remains canonical. */
  #state: IWorkerAckState = {
    credits: 2,
    cancelled: false,
    nextAckSequence: 1,
    wake: new CursorQueue()
  }
  /** Frames consume one monotonically increasing stream sequence. */
  #sequence = 0
  /** The original iterator remains reachable for primary-preserving cleanup. */
  #iterator: AsyncIterator<ISerializeChunk> | Iterator<ISerializeChunk> | undefined
  /** Stream routing preserves the caller's supplied identifier. */
  readonly id: string

  /** Validate stream and peer identity before taking parser or iterator ownership. */
  constructor(
    endpoint: IWorkerContractEndpoint,
    parser: ISerializeParser,
    payload: unknown,
    context: ISerializeContext
  ) {
    /** The original request may carry hostile getters; retain their original read count/order. */
    const request = payload as { readonly streamId?: unknown; readonly clientId?: unknown }
    if (typeof request.streamId !== 'string' || request.streamId.length === 0)
      throw createStoreWorkerError(
        StoreWorkerErrorCode.invalidOption,
        StoreWorkerErrorText.invalidPhase
      )
    this.id = request.streamId
    /** Capture target before its shape validation, matching original admission. */
    const targetId = request.clientId
    if (typeof targetId !== 'string' || targetId.length === 0)
      throw createStoreWorkerError(
        StoreWorkerErrorCode.invalidOption,
        StoreWorkerErrorText.invalidPhase
      )
    this.#targetId = targetId
    this.#endpoint = endpoint
    this.#parser = parser
    this.#context = context
  }

  /**
   * Remote/provider cancellation wakes credit and iterator waiters with the original cancellation
   * type.
   */
  cancel = (): void => {
    this.#state.cancelled = true
    wakeAllWorkers(this.#state)
    this.#state.cancelReject?.(workerStreamCancelledError())
    this.#state.cancelReject = undefined
  }

  /** Only the expected acknowledgement returns one credit and wakes one producer. */
  ack(sequence: number | undefined): void {
    if (sequence !== this.#state.nextAckSequence) return
    this.#state.nextAckSequence++
    this.#state.credits++
    takeWorkerWake(this.#state)?.()
  }

  /** Sequence allocation and acknowledged chunk writes share one original physical boundary. */
  async #send(kind: keyof typeof WorkerSerializeFrameKind, next?: ISerializeChunk): Promise<void> {
    if (kind === WorkerSerializeFrameKind.chunk) await waitForWorkerCredit(this.#state)
    await this.#endpoint.notify(
      { streamId: this.id, kind, sequence: this.#sequence++, ...(next ? { chunk: next } : {}) },
      WorkerSerializeFrameMethod,
      { targetId: this.#targetId }
    )
  }

  /** Select the parser's original asynchronous or synchronous iterator without invoking it twice. */
  #takeIterator(output: unknown): AsyncIterator<ISerializeChunk> | Iterator<ISerializeChunk> {
    /** Object coercion matches the existing parser output admission. */
    const candidate = Object(output) as {
      readonly [Symbol.asyncIterator]?: () => AsyncIterator<ISerializeChunk>
      readonly [Symbol.iterator]?: () => Iterator<ISerializeChunk>
    }
    /** Both properties are read before selecting the asynchronous form. */
    const asyncFactory = candidate[Symbol.asyncIterator]
    /** Synchronous output remains the fallback for a missing asynchronous factory. */
    const syncFactory = candidate[Symbol.iterator]
    if (typeof asyncFactory === 'function')
      return (candidate as AsyncIterable<ISerializeChunk>)[Symbol.asyncIterator]()
    if (typeof syncFactory === 'function')
      return (candidate as Iterable<ISerializeChunk>)[Symbol.iterator]()
    throw new TypeError(StoreWorkerErrorText.invalidChunk)
  }

  /** Race each iterator step with the existing cancellation channel, releasing its rejection slot. */
  async #next(): Promise<IteratorResult<ISerializeChunk>> {
    /** Identity protects a later iterator step's cancellation slot from earlier cleanup. */
    let rejectCancellation!: (reason: unknown) => void
    /** This is the original cooperative cancellation receipt, not an additional queue. */
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject
      this.#state.cancelReject = reject
      if (this.#state.cancelled) reject(workerStreamCancelledError())
    })
    try {
      return await Promise.race([Promise.resolve(this.#iterator!.next()), cancellation])
    } finally {
      if (this.#state.cancelReject === rejectCancellation) this.#state.cancelReject = undefined
    }
  }

  /** Stream chunks after the open frame, preserving primary/iterator cleanup failure order. */
  async encode(chunk: ISerializeChunk): Promise<{ streamId: string }> {
    this.#context.signal.addEventListener('abort', this.cancel, { once: true })
    try {
      await this.#send(WorkerSerializeFrameKind.open)
      /** Parser output is consumed incrementally without whole-result accumulation. */
      const output = await this.#parser.encode(chunk[1], this.#context)
      if (isChunkShape(output)) await this.#send(WorkerSerializeFrameKind.chunk, output)
      else {
        this.#iterator = this.#takeIterator(output)
        while (true) {
          /** One iterator result is shape-checked before its corresponding frame write. */
          const step = await this.#next()
          if (step.done) break
          if (!isChunkShape(step.value)) throw new TypeError(StoreWorkerErrorText.invalidChunk)
          await this.#send(WorkerSerializeFrameKind.chunk, step.value)
        }
      }
      await this.#send(WorkerSerializeFrameKind.end)
      return { streamId: this.id }
    } catch (primary) {
      try {
        await this.#iterator?.return?.()
      } catch (cleanup) {
        throw attachSecondaryErrors(primary, [cleanup])
      }
      throw primary
    } finally {
      this.#context.signal.removeEventListener('abort', this.cancel)
    }
  }
}
