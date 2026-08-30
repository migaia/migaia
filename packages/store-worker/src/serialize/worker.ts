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
import { abort, connect, createEndpoint, protocol, timeout } from '@migaia/web-rpc'
import type { IWebRpcContext } from '@migaia/web-rpc'
import { WebRpcPlatform } from '@migaia/web-rpc/protocol-constants'
import {
  createWebWorkerTransport,
  type IWebWorkerLikePort
} from '@migaia/web-rpc/adapters/web-worker'
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
  WorkerByteOwnership,
  WorkerDiagnosticType,
  WorkerRpcIdentity,
  WorkerSerializeFrameKind,
  WorkerSerializeFrameMethod,
  WorkerSerializePhase,
  type IByteOwnership
} from '../worker-constants.js'
import { transferablesOf } from './transferables.js'
import { CursorQueue } from '../cursor-queue.js'

/** Worker 出事的三种途径，全都得监听，否则请求会永久悬挂。 */
export type IWorkerFailureEvent = 'error' | 'messageerror'

export type IWorkerLike = IWebWorkerLikePort & {
  terminate?(): void
}

type IWorkerSerializeFrame = {
  readonly streamId: string
  readonly kind: keyof typeof WorkerSerializeFrameKind
  readonly sequence: number
  readonly chunk?: ISerializeChunk
  readonly error?: unknown
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
  return new DOMException('serialize stream cancelled', 'AbortError')
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
  ownership: IByteOwnership,
  optionType: string | undefined,
  phase: ISerializePhase,
  chunk: ISerializeChunk,
  context: ISerializeContext,
  abortCause: unknown
): SerializeCodecError<IStoreWorkerErrorCode> {
  return new SerializeCodecError(
    StoreWorkerErrorText.aborted(ownership === WorkerByteOwnership.transfer),
    {
      type: optionType ?? WorkerDiagnosticType.worker,
      phase,
      context: context.context,
      chunkIndex: 0,
      bytesConsumed: chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0,
      code: StoreWorkerErrorCode.requestAborted,
      source: STORE_WORKER_SOURCE,
      cause: abortCause
    }
  )
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
      if (frame.kind === WorkerSerializeFrameKind.error) {
        failure = frame.error ?? new Error(StoreWorkerErrorText.invalidChunk)
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

/**
 * 字节过界的所有权语义。
 *
 * Transfer 是**破坏性**的：底层 ArrayBuffer 连同指向它的所有别名视图一起被 detach。调用方交出去之后，一旦 worker 崩溃或请求被取消，就既没有结果、
 * 也失去了输入——原地数据丢失。所以默认是 copy，转移必须显式要求。
 */
/** Encodes one worker input using the canonical byte brand without copying its payload. */
export function encodeWorkerValue(value: unknown): ISerializeChunk {
  return isUint8Array(value) ? [SerializeChunkKind.bytes, value] : [SerializeChunkKind.value, value]
}

/** Encodes one worker decode result, preserving byte payload identity for transfer handling. */
export function decodeWorkerValue(value: unknown): ISerializeChunk {
  return isUint8Array(value) ? [SerializeChunkKind.bytes, value] : [SerializeChunkKind.value, value]
}

export type IWorkerPluginOptions = {
  readonly worker: IWorkerLike
  /** 注册到 registry 的格式标签，需与 worker 侧实际使用的编码一致。 */
  readonly type?: string
  /** 卸载时是否顺带终止 worker。外部传入的 worker 默认归调用方所有。 */
  readonly terminateOnDispose?: boolean
  /** 默认 'copy'：安全但要复制一遍。只有当调用方确认这段字节独占、且交出去之后 不再使用时，才该选 'transfer' 换取零拷贝。 */
  readonly ownership?: IByteOwnership
  /** Overrides the default client id (a fixed value rather than a factory — see `src/rpc`). */
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
 * 只有当视图恰好覆盖整个 buffer 时，转移才不会波及别人。
 *
 * `subarray()` 出来的视图与原 buffer 共享底层内存，转移它会把整个 buffer 连同 所有其他视图一起 detach —— 调用方只想交出一小段，结果整块没了。这种情况必须
 * 退回复制。
 */
/**
 * 把编解码放到 worker 里做。
 *
 * 实测结论决定了它的正确用法（1M 条 / 71.5MB，主线程阻塞时长）： - 字节进、字节出，结果不还原成主线程对象图 → 主线程 1.4ms，比主线程直接做 JSON 的 65ms 少约
 * 46 倍，墙钟基本持平。这是唯一真正划算的形态。 - 把对象图 postMessage 进 worker → 主线程 126ms，比直接在主线程做还慢一倍。
 * 结构化克隆是在调用方线程同步完成的，成本只是从 stringify 换成 clone。 所以：用它承接落盘/传输这类「拿到字节就结束」的活，不要用它加速 hydrate。
 */
export function workerParser(options: IWorkerPluginOptions): ISerializeParser {
  assertWorkerParserOptions(options)
  let worker: IWorkerPluginOptions['worker']
  let optionType: string | undefined
  let clientId: string | undefined
  let ownership: IWorkerPluginOptions['ownership']
  let terminateOnDispose: boolean | undefined
  try {
    worker = options.worker
    optionType = options.type
    clientId = options.clientId
    ownership = options.ownership
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
  if (
    ownership !== undefined &&
    ownership !== WorkerByteOwnership.copy &&
    ownership !== WorkerByteOwnership.transfer
  ) {
    throw createStoreWorkerError(StoreWorkerErrorCode.invalidOption, StoreWorkerErrorText.ownership)
  }
  if (terminateOnDispose !== undefined && typeof terminateOnDispose !== 'boolean') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.terminateOnDispose
    )
  }
  const resolvedOwnership = ownership ?? WorkerByteOwnership.copy
  const resolvedTerminateOnDispose = terminateOnDispose ?? false
  const transport = createWebWorkerTransport(worker, { peerId: WorkerRpcIdentity.worker })
  const client = createEndpoint<typeof WorkerRpcIdentity.worker>({
    id: clientId ?? WorkerRpcIdentity.main,
    targetIds: [WorkerRpcIdentity.worker],
    transport,
    middlewares: [connect({ transport }), protocol(), abort(), timeout()]
  })

  const streams = new Map<string, IWorkerFrameQueue>()
  let nextStreamId = 1
  let frameSubscription: Promise<() => void> | undefined
  const ensureFrameSubscription = (): Promise<() => void> => {
    frameSubscription ??= client.then((endpoint) =>
      endpoint.on(WorkerSerializeFrameMethod, (context: IWebRpcContext) => {
        const frame = context.data as IWorkerSerializeFrame
        const stream = streams.get(frame.streamId)
        if (!stream) return
        stream.push(frame)
        if (
          frame.kind === WorkerSerializeFrameKind.end ||
          frame.kind === WorkerSerializeFrameKind.error
        )
          streams.delete(frame.streamId)
      })
    )
    return frameSubscription
  }

  const request = async (
    phase: ISerializePhase,
    chunk: ISerializeChunk,
    context: ISerializeContext
  ): Promise<ISerializeChunk> => {
    try {
      const endpoint = await client
      const result = await endpoint.send<ISerializeChunk>(
        WorkerRpcIdentity.worker,
        WorkerRpcIdentity.call,
        { phase, chunk },
        { signal: context.signal, transfer: transferablesOf(chunk, resolvedOwnership) }
      )
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
      // (chunk index / bytes consumed / which format), and to flag when
      // ownership: 'transfer' means the input is now unrecoverably detached.
      if (error instanceof Error && error.name === 'AbortError') {
        // web-rpc may synthesize its own AbortError at the transport boundary;
        // the caller's explicit reason is the authoritative original failure
        // and must remain reachable for identity/stack diagnostics.
        const abortCause = context.signal.reason ?? error
        throw createWorkerRequestAbortedError(
          resolvedOwnership,
          optionType,
          phase,
          chunk,
          context,
          abortCause
        )
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
          resolvedOwnership,
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
        void client.then((endpoint) =>
          endpoint.dispatch(WorkerRpcIdentity.worker, WorkerSerializeFrameMethod, {
            streamId,
            kind: WorkerSerializeFrameKind.cancel,
            sequence: -1
          })
        )
      },
      (sequence) => {
        void client.then((endpoint) =>
          endpoint.dispatch(WorkerRpcIdentity.worker, WorkerSerializeFrameMethod, {
            streamId,
            kind: WorkerSerializeFrameKind.ack,
            sequence
          })
        )
      }
    )
    streams.set(streamId, queue)
    void ensureFrameSubscription()
      .then(() => client)
      .then((endpoint) =>
        endpoint.send(
          WorkerRpcIdentity.worker,
          WorkerRpcIdentity.call,
          { phase: WorkerSerializePhase.encode, chunk, streamId },
          { signal: context.signal, transfer: transferablesOf(chunk, resolvedOwnership) }
        )
      )
      .then(
        () => undefined,
        (error: unknown) => {
          queue.fail(error)
          streams.delete(streamId)
        }
      )
    return queue.output
  }

  let disposePromise: Promise<void> | undefined
  const disposeOnce = async (): Promise<void> => {
    let endpointError: unknown
    try {
      const endpoint = await client
      await endpoint.dispose()
    } catch (error) {
      endpointError = error
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
      // 已经是字节就按 bytes 段送：只有这一种形态能进 transferList 走零拷贝。
      // 包成 value 段的话会退化成结构化克隆，把整份数据在主线程上复制一遍——
      // 实测里这正是「丢给 worker 反而更慢」的成因。
      streamEncode(encodeWorkerValue(value), context),
    decode: async (chunk, context) => {
      // 回包可能是 value 段（对象图，结构化克隆回来）也可能是 bytes 段
      // （parser 配了 decodeTo: 'jsonBytes'，走 transfer 回来）。两种情况
      // 要的都是段里的负载本身。
      const result = await request(WorkerSerializePhase.decode, chunk, context)
      return result[1]
    },
    dispose() {
      disposePromise ??= disposeOnce()
      return disposePromise
    }
  }
}

export const workerPlugin = (options: IWorkerPluginOptions): ISerializePlugin => {
  const parser = workerParser(options)
  return { type: parser.name, parser }
}

/**
 * Worker 侧的对端。把一个普通 parser 装进 worker，按上面的报文协议应答。
 *
 * 与 core/worker.ts 里的 createWorkerHandler 同一手法：错误一律转成回包，绝不让 异常逃逸成 worker 的 unhandled
 * error——那会静默吞掉请求方的 Promise。
 */
export function createSerializeWorkerHandler(
  parser: ISerializeParser,
  post: (message: unknown, transfer?: readonly Transferable[]) => void
): IManagedRpcHandler {
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
  let deliver: (message: unknown) => void = () => undefined
  const transport = {
    platform: WebRpcPlatform.worker,
    peerId: 'main' as const,
    send: (message: unknown, sendOptions?: { transfer?: readonly Transferable[] }) =>
      post(message, sendOptions?.transfer),
    subscribe: (listener: (message: { data: unknown }) => void) => {
      deliver = (message) => listener({ data: message })
      return () => {
        deliver = () => undefined
      }
    }
  }
  const streamStates = new Map<string, IWorkerAckState>()
  const endpoint = createEndpoint({
    id: WorkerRpcIdentity.worker,
    targetIds: [WorkerRpcIdentity.main],
    transport,
    provider: {
      call: async (context) => {
        const { phase, chunk } = context.data as { phase: ISerializePhase; chunk: ISerializeChunk }
        if (!isChunkShape(chunk))
          throw createStoreWorkerError(
            StoreWorkerErrorCode.invalidRequestChunk,
            StoreWorkerErrorText.invalidRequestChunk
          )
        const serializeContext: ISerializeContext = {
          signal: context.signal,
          context: 'serialize-worker'
        }
        if (phase === WorkerSerializePhase.encode) {
          const request = context.data as { readonly streamId?: unknown }
          if (typeof request.streamId !== 'string' || request.streamId.length === 0)
            throw createStoreWorkerError(
              StoreWorkerErrorCode.invalidOption,
              StoreWorkerErrorText.invalidPhase
            )
          const streamId = request.streamId
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
          context.signal.addEventListener('abort', abort, { once: true })
          let sequence = 0
          let completed = false
          let iterator: AsyncIterator<ISerializeChunk> | Iterator<ISerializeChunk> | undefined
          const send = async (
            kind: keyof typeof WorkerSerializeFrameKind,
            next?: ISerializeChunk,
            error?: unknown
          ) => {
            if (kind === WorkerSerializeFrameKind.chunk) await waitForWorkerCredit(ackState)
            context.dispatchTo({
              id: WorkerRpcIdentity.main,
              method: WorkerSerializeFrameMethod,
              data: {
                streamId,
                kind,
                sequence: sequence++,
                ...(next ? { chunk: next } : {}),
                ...(error ? { error } : {})
              }
            })
          }
          try {
            context.dispatchTo({
              id: WorkerRpcIdentity.main,
              method: WorkerSerializeFrameMethod,
              data: { streamId, kind: WorkerSerializeFrameKind.open, sequence: sequence++ }
            })
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
            completed = true
            return context.success({ streamId })
          } catch (error) {
            try {
              await send(WorkerSerializeFrameKind.error, undefined, error)
            } catch {
              // Cancellation may close the operation before an error frame can be delivered.
            }
            throw error
          } finally {
            if (!completed && iterator?.return) {
              try {
                await iterator.return()
              } catch {
                // Preserve the primary stream failure; endpoint error serialization owns it.
              }
            }
            context.signal.removeEventListener('abort', abort)
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
        const result: ISerializeChunk = decodeWorkerValue(value)
        return context.success(result, {
          transfer: transferablesOf(result, WorkerByteOwnership.transfer)
        })
      }
    },
    middlewares: [connect({ transport }), protocol(), abort(), timeout()]
  })
  void endpoint.then((resolved) =>
    resolved.on(WorkerSerializeFrameMethod, (context) => {
      const frame = context.data as Partial<IWorkerSerializeFrame>
      if (typeof frame.streamId !== 'string') return
      const state = streamStates.get(frame.streamId)
      if (!state) return
      if (frame.kind === WorkerSerializeFrameKind.cancel) {
        state.cancelled = true
        wakeAllWorkers(state)
        state.cancelReject?.(workerStreamCancelledError())
        state.cancelReject = undefined
        return
      }
      if (frame.kind !== WorkerSerializeFrameKind.ack) return
      if (frame.sequence !== state.nextAckSequence) return
      state.nextAckSequence++
      state.credits++
      takeWorkerWake(state)?.()
    })
  )
  return toManagedRpcHandler(endpoint, (message) => deliver(message))
}
