import { attachErrorIdentity, attachSecondaryErrors, isNativeErrorValue } from '@migaia/utils/error'
import type { IWorkerMessageEvent } from '../worker-message-event.js'
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
import type { IWebWorkerLikePort } from '@migaia/rpc-plugin-browser/adapters/web-worker'
import { RpcLifecycleError } from '@migaia/rpc-host'
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
export type IWorkerLike = IWebWorkerLikePort & {
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

/** Creates a bounded-consumer queue for frames dispatched beside one RPC response. */
function createWorkerFrameQueue(
  streamId: string,
  cancelRemote: () => void,
  ackRemote: (sequence: number) => void
): IWorkerFrameQueue {
  const chunks = new CursorQueue<IQueuedWorkerChunk>()
  const waiters = new CursorQueue<{
    readonly resolve: (result: IteratorResult<ISerializeChunk>) => void
    readonly reject: (error: unknown) => void
  }>()
  let failure: unknown
  let finished = false
  let expectedSequence = 0
  const settle = (): void => {
    if (!finished || waiters.size === 0) return
    let waiter: ReturnType<typeof waiters.take>
    while ((waiter = waiters.take()) !== undefined) {
      if (failure !== undefined) waiter.reject(failure)
      else waiter.resolve({ done: true, value: undefined })
    }
  }
  const output: AsyncIterable<ISerializeChunk> = {
    [Symbol.asyncIterator]() {
      return {
        next: async (): Promise<IteratorResult<ISerializeChunk>> => {
          const queued = chunks.take()
          if (queued) {
            ackRemote(queued.sequence)
            return { done: false, value: queued.chunk }
          }
          if (failure !== undefined) throw failure
          if (finished) return { done: true, value: undefined }
          return await new Promise<IteratorResult<ISerializeChunk>>((resolve, reject) => {
            waiters.push({ resolve, reject })
          })
        },
        return: async (): Promise<IteratorResult<ISerializeChunk>> => {
          if (!finished) {
            finished = true
            cancelRemote()
            settle()
          }
          return { done: true, value: undefined }
        }
      }
    }
  }
  return {
    output,
    push(frame) {
      if (finished || frame.streamId !== streamId) return
      if (frame.sequence !== expectedSequence) {
        failure = createStoreWorkerError(
          StoreWorkerErrorCode.invalidResponseChunk,
          StoreWorkerErrorText.invalidChunk
        )
        finished = true
        settle()
        return
      }
      expectedSequence++
      if (frame.kind === WorkerSerializeFrameKind.open) return
      if (frame.kind === WorkerSerializeFrameKind.chunk) {
        if (!isChunkShape(frame.chunk)) {
          failure = createStoreWorkerError(
            StoreWorkerErrorCode.invalidResponseChunk,
            StoreWorkerErrorText.invalidChunk
          )
          finished = true
          settle()
          return
        }
        const waiter = waiters.take()
        if (waiter) {
          ackRemote(frame.sequence)
          waiter.resolve({ done: false, value: frame.chunk })
        } else chunks.push({ chunk: frame.chunk, sequence: frame.sequence })
        return
      }
      finished = true
      settle()
    },
    fail(error) {
      if (finished) return
      failure = error
      finished = true
      settle()
    },
    finish() {
      finished = true
      settle()
    },
    cancel() {
      if (finished) return
      finished = true
      cancelRemote()
      settle()
    }
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
  assertWorkerParserOptions(options)
  let worker: IWorkerPluginOptions['worker']
  let optionType: string | undefined
  let clientId: string | undefined
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
  const resolvedTerminateOnDispose = terminateOnDispose ?? false
  const streams = new Map<string, IWorkerFrameQueue>()
  let nextStreamId = 1
  let frameSubscription: Promise<() => void> | undefined
  let disposePromise: Promise<void> | undefined
  /** The actual Host advertises its frame provider before either side starts remote discovery. */
  let unsubscribeFrame: () => void = () => undefined
  const client: Promise<IWorkerContractEndpoint> = createWorkerContractEndpoint(
    worker,
    {
      id: clientId ?? WorkerRpcIdentity.main,
      targetId: WorkerRpcIdentity.worker
    },
    (endpoint) => {
      if (disposePromise === undefined)
        unsubscribeFrame = endpoint.onRequest(WorkerSerializeFrameMethod, (payload) => {
          const frame = payload as IWorkerSerializeFrame
          const stream = streams.get(frame.streamId)
          if (!stream) return
          stream.push(frame)
          if (frame.kind === WorkerSerializeFrameKind.end) streams.delete(frame.streamId)
        })
      return endpoint
    }
  )
  const ensureFrameSubscription = (): Promise<() => void> => {
    frameSubscription ??= client.then(() => {
      if (disposePromise !== undefined) return () => undefined
      return unsubscribeFrame
    })
    return frameSubscription
  }

  const request = async (
    phase: ISerializePhase,
    chunk: ISerializeChunk,
    context: ISerializeContext
  ): Promise<ISerializeChunk> => {
    try {
      const endpoint = await client
      if (disposePromise !== undefined) throw new RpcLifecycleError(StoreWorkerErrorText.disposed)
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
        const abortCause = context.signal.reason ?? error
        throw createWorkerRequestAbortedError(optionType, phase, chunk, context, abortCause)
      }
      throw error
    }
  }

  const streamEncode = (
    chunk: ISerializeChunk,
    context: ISerializeContext
  ): AsyncIterable<ISerializeChunk> => {
    if (context.signal.aborted) {
      const abortCause = context.signal.reason ?? workerStreamCancelledError()
      return Promise.reject(
        createWorkerRequestAbortedError(
          optionType,
          WorkerSerializePhase.encode,
          chunk,
          context,
          abortCause
        )
      ) as never
    }
    const streamId = `${clientId ?? WorkerRpcIdentity.main}:${nextStreamId++}`
    const queue = createWorkerFrameQueue(
      streamId,
      () => {
        void client.then((endpoint) => {
          if (disposePromise !== undefined) return
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
        void client.then((endpoint) => {
          if (disposePromise !== undefined) return
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
    streams.set(streamId, queue)
    void ensureFrameSubscription()
      .then(() => client)
      .then((endpoint) => {
        if (disposePromise !== undefined) throw new RpcLifecycleError(StoreWorkerErrorText.disposed)
        return endpoint.request(
          {
            phase: WorkerSerializePhase.encode,
            chunk,
            streamId,
            clientId: clientId ?? WorkerRpcIdentity.main
          },
          { signal: context.signal }
        )
      })
      .then(
        () => undefined,
        (error: unknown) => {
          queue.fail(error)
          streams.delete(streamId)
        }
      )
    return queue.output
  }

  const disposeOnce = async (): Promise<void> => {
    const terminalError = new RpcLifecycleError(StoreWorkerErrorText.disposed)
    for (const queue of streams.values()) queue.fail(terminalError)
    streams.clear()
    let endpointError: unknown
    try {
      const endpoint = await client
      await endpoint.close()
    } catch (error) {
      endpointError =
        error instanceof RpcLifecycleError
          ? error
          : new RpcLifecycleError('Endpoint disposal completed with cleanup errors', error, [
              { resource: 'transport subscription', error }
            ])
    }
    let terminateError: unknown
    if (resolvedTerminateOnDispose) {
      try {
        worker.terminate?.()
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

  return {
    name: optionType ?? WorkerDiagnosticType.worker,
    encode: (value, context) =>
      // 本地只分类 bytes/value；portable bridge 复制并另编码载荷，不分离调用方的 buffer。
      streamEncode(workerChunk(value), context),
    decode: async (chunk, context) => {
      // 回包按 value/bytes 分类；两种情况都返回段内负载，不返回段外壳。
      const result = await request(WorkerSerializePhase.decode, chunk, context)
      return result[1]
    },
    dispose() {
      disposePromise ??= disposeOnce()
      return disposePromise
    }
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
  let inboundListener: ((event: IWorkerMessageEvent) => void) | undefined
  const streamStates = new Map<string, IWorkerAckState>()
  const endpointPromise = createWorkerContractEndpoint(
    {
      postMessage: (message, transfer) => post(message, transfer),
      addEventListener: (type, listener) => {
        if (type === 'message') inboundListener = listener as (event: IWorkerMessageEvent) => void
      },
      removeEventListener: (type, listener) => {
        if (type === 'message' && inboundListener === listener) inboundListener = undefined
      }
    },
    { id: WorkerRpcIdentity.worker, targetId: WorkerRpcIdentity.main },
    (readyEndpoint) => {
      const unsubscribeFrame = readyEndpoint.onRequest(
        WorkerSerializeFrameMethod,
        async (payload) => {
          const frame = payload as Partial<IWorkerSerializeFrame>
          if (typeof frame.streamId !== 'string') return undefined
          const state = streamStates.get(frame.streamId)
          if (!state) return undefined
          if (frame.kind === WorkerSerializeFrameKind.cancel) {
            state.cancelled = true
            wakeAllWorkers(state)
            state.cancelReject?.(workerStreamCancelledError())
            state.cancelReject = undefined
            return undefined
          }
          if (frame.kind !== WorkerSerializeFrameKind.ack) return undefined
          if (frame.sequence !== state.nextAckSequence) return undefined
          state.nextAckSequence++
          state.credits++
          takeWorkerWake(state)?.()
          return undefined
        }
      )
      const unsubscribe = readyEndpoint.onRequest(
        WorkerRpcIdentity.call,
        async (payload, signal) => {
          const { phase, chunk } = payload as { phase: ISerializePhase; chunk: ISerializeChunk }
          if (!isChunkShape(chunk))
            throw createStoreWorkerError(
              StoreWorkerErrorCode.invalidRequestChunk,
              StoreWorkerErrorText.invalidRequestChunk
            )
          const serializeContext: ISerializeContext = {
            signal: signal,
            context: 'serialize-worker'
          }
          if (phase === WorkerSerializePhase.encode) {
            const request = payload as { readonly streamId?: unknown; readonly clientId?: unknown }
            if (typeof request.streamId !== 'string' || request.streamId.length === 0)
              throw createStoreWorkerError(
                StoreWorkerErrorCode.invalidOption,
                StoreWorkerErrorText.invalidPhase
              )
            const streamId = request.streamId
            const targetId = request.clientId
            if (typeof targetId !== 'string' || targetId.length === 0)
              throw createStoreWorkerError(
                StoreWorkerErrorCode.invalidOption,
                StoreWorkerErrorText.invalidPhase
              )
            const ackState: IWorkerAckState = {
              credits: 2,
              cancelled: false,
              nextAckSequence: 1,
              wake: new CursorQueue()
            }
            streamStates.set(streamId, ackState)
            const abort = (): void => {
              ackState.cancelled = true
              wakeAllWorkers(ackState)
              ackState.cancelReject?.(workerStreamCancelledError())
              ackState.cancelReject = undefined
            }
            signal.addEventListener('abort', abort, { once: true })
            let sequence = 0
            let iterator: AsyncIterator<ISerializeChunk> | Iterator<ISerializeChunk> | undefined
            const send = async (
              kind: keyof typeof WorkerSerializeFrameKind,
              next?: ISerializeChunk
            ) => {
              if (kind === WorkerSerializeFrameKind.chunk) await waitForWorkerCredit(ackState)
              await readyEndpoint.notify(
                {
                  streamId,
                  kind,
                  sequence: sequence++,
                  ...(next ? { chunk: next } : {})
                },
                WorkerSerializeFrameMethod,
                {
                  /** Unauthenticated automatic frames retain the existing portable copy profile. */
                  targetId
                }
              )
            }
            try {
              await readyEndpoint.notify(
                { streamId, kind: WorkerSerializeFrameKind.open, sequence: sequence++ },
                WorkerSerializeFrameMethod,
                { targetId }
              )
              const output = await parser.encode(chunk[1], serializeContext)
              if (isChunkShape(output)) {
                await send(WorkerSerializeFrameKind.chunk, output)
              } else {
                const candidate = Object(output) as {
                  readonly [Symbol.asyncIterator]?: () => AsyncIterator<ISerializeChunk>
                  readonly [Symbol.iterator]?: () => Iterator<ISerializeChunk>
                }
                const asyncFactory = candidate[Symbol.asyncIterator]
                const syncFactory = candidate[Symbol.iterator]
                if (typeof asyncFactory === 'function')
                  iterator = (candidate as AsyncIterable<ISerializeChunk>)[Symbol.asyncIterator]()
                else if (typeof syncFactory === 'function')
                  iterator = (candidate as Iterable<ISerializeChunk>)[Symbol.iterator]()
                else throw new TypeError(StoreWorkerErrorText.invalidChunk)
                while (true) {
                  let rejectCancellation!: (reason: unknown) => void
                  const cancellation = new Promise<never>((_resolve, reject) => {
                    rejectCancellation = reject
                    ackState.cancelReject = reject
                    if (ackState.cancelled) reject(workerStreamCancelledError())
                  })
                  let step: IteratorResult<ISerializeChunk>
                  try {
                    step = await Promise.race([Promise.resolve(iterator.next()), cancellation])
                  } finally {
                    if (ackState.cancelReject === rejectCancellation)
                      ackState.cancelReject = undefined
                  }
                  if (step.done) break
                  if (!isChunkShape(step.value))
                    throw new TypeError(StoreWorkerErrorText.invalidChunk)
                  await send(WorkerSerializeFrameKind.chunk, step.value)
                }
              }
              await send(WorkerSerializeFrameKind.end)
              return { streamId }
            } catch (primary) {
              try {
                await iterator?.return?.()
              } catch (cleanup) {
                // Canonical attachment keeps the primary first; RPC already transfers errors[]/cause.
                throw attachSecondaryErrors(primary, [cleanup])
              }
              throw primary
            } finally {
              signal.removeEventListener('abort', abort)
              streamStates.delete(streamId)
            }
          }
          if (phase !== WorkerSerializePhase.decode) {
            throw createStoreWorkerError(
              StoreWorkerErrorCode.invalidOption,
              StoreWorkerErrorText.invalidPhase
            )
          }
          const value = await parser.decode(chunk, serializeContext)
          const result: ISerializeChunk = workerChunk(value)
          return result
        }
      )
      return {
        dispose: async () => {
          unsubscribeFrame()
          unsubscribe()
          await readyEndpoint.close()
        }
      }
    }
  )
  return toManagedRpcHandler(endpointPromise, (message) =>
    inboundListener?.({ data: message } as IWorkerMessageEvent)
  )
}
