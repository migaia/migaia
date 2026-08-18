import {
  SerializeCodecError,
  SerializeChunkKind,
  isChunkShape,
  type ISerializeChunk,
  type ISerializeContext,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin
} from '@migaia/serialize';
import {
  abort,
  connect,
  createEndpoint,
  protocol,
  timeout,
  type IWebRpcAbortSignal
} from '@migaia/web-rpc';
import { WebRpcPlatform } from '@migaia/web-rpc/protocol-constants';
import {
  createWebWorkerTransport,
  type IWebWorkerLikePort
} from '@migaia/web-rpc/adapters/web-worker';
import { toManagedRpcHandler, type IManagedRpcHandler } from '../managed-rpc-handler.js';
import {
  createStoreWorkerAggregateError,
  createStoreWorkerError,
  STORE_WORKER_SOURCE,
  StoreWorkerErrorCode
} from '../errors.js';
import { StoreWorkerErrorText } from '../error-text.js';
import {
  WorkerByteOwnership,
  WorkerDiagnosticType,
  WorkerRpcIdentity,
  WorkerSerializePhase,
  type IWorkerByteOwnership
} from '../worker-constants.js';
import { transferablesOf } from './transferables.js';

/** Worker 出事的三种途径，全都得监听，否则请求会永久悬挂。 */
export type IWorkerFailureEvent = 'error' | 'messageerror';

export type IWorkerLike = IWebWorkerLikePort & {
  terminate?(): void;
};

/**
 * 字节过界的所有权语义。
 *
 * Transfer 是**破坏性**的：底层 ArrayBuffer 连同指向它的所有别名视图一起被 detach。调用方交出去之后，一旦 worker 崩溃或请求被取消，就既没有结果、
 * 也失去了输入——原地数据丢失。所以默认是 copy，转移必须显式要求。
 */
export type IByteOwnership = IWorkerByteOwnership;

export type IWorkerPluginOptions = {
  readonly worker: IWorkerLike;
  /** 注册到 registry 的格式标签，需与 worker 侧实际使用的编码一致。 */
  readonly type?: string;
  /** 卸载时是否顺带终止 worker。外部传入的 worker 默认归调用方所有。 */
  readonly terminateOnDispose?: boolean;
  /** 默认 'copy'：安全但要复制一遍。只有当调用方确认这段字节独占、且交出去之后 不再使用时，才该选 'transfer' 换取零拷贝。 */
  readonly ownership?: IByteOwnership;
  /** Overrides the default client id (a fixed value rather than a factory — see `src/rpc`). */
  readonly clientId?: string;
};

/** Probes public options before property reads so revoked proxies become contract errors. */
function assertWorkerParserOptions(options: unknown): asserts options is IWorkerPluginOptions {
  if (options === null || typeof options !== 'object') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject
    );
  }
  try {
    Object.getOwnPropertyDescriptors(options);
  } catch (error) {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject,
      { cause: error }
    );
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
  assertWorkerParserOptions(options);
  let worker: IWorkerPluginOptions['worker'];
  let optionType: string | undefined;
  let clientId: string | undefined;
  let ownership: IWorkerPluginOptions['ownership'];
  let terminateOnDispose: boolean | undefined;
  try {
    worker = options.worker;
    optionType = options.type;
    clientId = options.clientId;
    ownership = options.ownership;
    terminateOnDispose = options.terminateOnDispose;
  } catch (error) {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.optionsObject,
      { cause: error }
    );
  }
  if (optionType !== undefined && typeof optionType !== 'string') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.stringOption('type')
    );
  }
  if (clientId !== undefined && typeof clientId !== 'string') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.stringOption('clientId')
    );
  }
  if (worker === null || typeof worker !== 'object') {
    throw createStoreWorkerError(StoreWorkerErrorCode.invalidOption, StoreWorkerErrorText.worker);
  }
  if (
    ownership !== undefined &&
    ownership !== WorkerByteOwnership.copy &&
    ownership !== WorkerByteOwnership.transfer
  ) {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.ownership
    );
  }
  if (terminateOnDispose !== undefined && typeof terminateOnDispose !== 'boolean') {
    throw createStoreWorkerError(
      StoreWorkerErrorCode.invalidOption,
      StoreWorkerErrorText.terminateOnDispose
    );
  }
  const resolvedOwnership = ownership ?? WorkerByteOwnership.copy;
  const resolvedTerminateOnDispose = terminateOnDispose ?? false;
  const transport = createWebWorkerTransport(worker, { peerId: WorkerRpcIdentity.worker });
  const client = createEndpoint<typeof WorkerRpcIdentity.worker>({
    id: clientId ?? WorkerRpcIdentity.main,
    targetIds: [WorkerRpcIdentity.worker],
    transport,
    middlewares: [connect({ transport }), protocol(), abort(), timeout()]
  });

  const request = async (
    phase: ISerializePhase,
    chunk: ISerializeChunk,
    context: ISerializeContext
  ): Promise<ISerializeChunk> => {
    try {
      const endpoint = await client;
      const result = await endpoint.send<ISerializeChunk>(
        WorkerRpcIdentity.worker,
        WorkerRpcIdentity.call,
        { phase, chunk },
        { signal: context.signal, transfer: transferablesOf(chunk, resolvedOwnership) }
      );
      if (!isChunkShape(result)) {
        throw createStoreWorkerError(
          StoreWorkerErrorCode.invalidResponseChunk,
          StoreWorkerErrorText.invalidChunk
        );
      }
      return result;
    } catch (error) {
      // Endpoint's abort rejection is generic; re-throw it as the
      // SerializeCodecError shape this parser's callers rely on for diagnostics
      // (chunk index / bytes consumed / which format), and to flag when
      // ownership: 'transfer' means the input is now unrecoverably detached.
      if (error instanceof Error && error.name === 'AbortError') {
        // web-rpc may synthesize its own AbortError at the transport boundary;
        // the caller's explicit reason is the authoritative original failure
        // and must remain reachable for identity/stack diagnostics.
        const abortCause = context.signal.reason ?? error;
        throw new SerializeCodecError(
          StoreWorkerErrorText.aborted(resolvedOwnership === WorkerByteOwnership.transfer),
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
        );
      }
      throw error;
    }
  };

  let disposePromise: Promise<void> | undefined;
  const disposeOnce = async (): Promise<void> => {
    let endpointError: unknown;
    try {
      const endpoint = await client;
      await endpoint.dispose();
    } catch (error) {
      endpointError = error;
    }
    let terminateError: unknown;
    if (resolvedTerminateOnDispose) {
      try {
        worker.terminate?.();
      } catch (error) {
        terminateError = error;
      }
    }
    if (endpointError !== undefined && terminateError !== undefined) {
      throw createStoreWorkerAggregateError(
        StoreWorkerErrorCode.cleanupFailed,
        [endpointError, terminateError],
        StoreWorkerErrorText.cleanupFailed
      );
    }
    if (endpointError !== undefined) throw endpointError;
    if (terminateError !== undefined) throw terminateError;
  };

  return {
    name: optionType ?? WorkerDiagnosticType.worker,
    encode: (value, context) =>
      // 已经是字节就按 bytes 段送：只有这一种形态能进 transferList 走零拷贝。
      // 包成 value 段的话会退化成结构化克隆，把整份数据在主线程上复制一遍——
      // 实测里这正是「丢给 worker 反而更慢」的成因。
      request(
        WorkerSerializePhase.encode,
        value instanceof Uint8Array
          ? [SerializeChunkKind.bytes, value]
          : [SerializeChunkKind.value, value],
        context
      ),
    decode: async (chunk, context) => {
      // 回包可能是 value 段（对象图，结构化克隆回来）也可能是 bytes 段
      // （parser 配了 decodeTo: 'jsonBytes'，走 transfer 回来）。两种情况
      // 要的都是段里的负载本身。
      const result = await request(WorkerSerializePhase.decode, chunk, context);
      return result[1];
    },
    dispose() {
      disposePromise ??= disposeOnce();
      return disposePromise;
    }
  };
}

export const workerPlugin = (options: IWorkerPluginOptions): ISerializePlugin => {
  const parser = workerParser(options);
  return { type: parser.name, parser };
};

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
    );
  }
  let deliver: (message: unknown) => void = () => undefined;
  const transport = {
    platform: WebRpcPlatform.worker,
    peerId: 'main' as const,
    send: (message: unknown, sendOptions?: { transfer?: readonly Transferable[] }) =>
      post(message, sendOptions?.transfer),
    subscribe: (listener: (message: { data: unknown }) => void) => {
      deliver = (message) => listener({ data: message });
      return () => {
        deliver = () => undefined;
      };
    }
  };
  const endpoint = createEndpoint({
    id: WorkerRpcIdentity.worker,
    transport,
    provider: {
      call: async (context) => {
        const { phase, chunk } = context.data as { phase: ISerializePhase; chunk: ISerializeChunk };
        if (!isChunkShape(chunk))
          throw createStoreWorkerError(
            StoreWorkerErrorCode.invalidRequestChunk,
            StoreWorkerErrorText.invalidRequestChunk
          );
        const serializeContext: ISerializeContext = {
          signal: context.signal,
          context: 'serialize-worker'
        };
        if (phase === WorkerSerializePhase.encode) {
          // 无论对面用 value 段还是 bytes 段送来，要编码的都是段里的负载，
          // 不是段本身。之前把整个 bytes 段当值交给 parser，字节快路直接失效。
          const output = await parser.encode(chunk[1], serializeContext);
          // 单段本身也是数组，必须先消歧再决定要不要走拼装
          const result = isChunkShape(output)
            ? output
            : ((Symbol.asyncIterator in Object(output) || Symbol.iterator in Object(output)
                ? await collectInWorker(output as Iterable<ISerializeChunk>, context.signal)
                : await output) as ISerializeChunk);
          return context.success(result, {
            transfer: transferablesOf(result, WorkerByteOwnership.transfer)
          });
        }
        const value = await parser.decode(chunk, serializeContext);
        // 解出来还是字节时（parser 配了 decodeTo: 'jsonBytes'）按 bytes 段回，
        // 才能走 transfer；包成 value 段就退化成结构化克隆，把整份复制回主线程。
        const result: ISerializeChunk =
          value instanceof Uint8Array
            ? [SerializeChunkKind.bytes, value]
            : [SerializeChunkKind.value, value];
        return context.success(result, {
          transfer: transferablesOf(result, WorkerByteOwnership.transfer)
        });
      }
    },
    middlewares: [connect({ transport }), protocol(), abort(), timeout()]
  });
  return toManagedRpcHandler(endpoint, (message) => deliver(message));
}

/** Worker 侧不引 registry，就地把分段拼一次，避免把整个注册表打进 worker 包。 */
async function collectInWorker(
  output: Iterable<ISerializeChunk> | AsyncIterable<ISerializeChunk>,
  signal?: IWebRpcAbortSignal
): Promise<ISerializeChunk> {
  const chunks: ISerializeChunk[] = [];
  if (Symbol.asyncIterator in Object(output)) {
    for await (const chunk of output as AsyncIterable<ISerializeChunk>) {
      signal?.throwIfAborted?.();
      chunks.push(chunk);
    }
  } else {
    for (const chunk of output as Iterable<ISerializeChunk>) {
      signal?.throwIfAborted?.();
      chunks.push(chunk);
    }
  }
  return mergeWorkerChunks(chunks);
}

/** Merges worker-produced wire chunks without coercing materialized values. */
export function mergeWorkerChunks(chunks: readonly ISerializeChunk[]): ISerializeChunk {
  if (chunks.length === 0)
    throw new SerializeCodecError(StoreWorkerErrorText.emptyChunks, {
      type: WorkerDiagnosticType.worker,
      phase: WorkerSerializePhase.encode,
      context: 'serialize-worker',
      chunkIndex: 0,
      bytesConsumed: 0,
      code: StoreWorkerErrorCode.chunkMergeFailed,
      source: STORE_WORKER_SOURCE
    });
  if (chunks.length === 1) return chunks[0]!;
  if (chunks.every((chunk) => chunk[0] === SerializeChunkKind.text)) {
    return [SerializeChunkKind.text, chunks.map((chunk) => chunk[1] as string).join('')];
  }
  const encoder = new TextEncoder();
  const parts = chunks.map((chunk) => {
    if (chunk[0] === SerializeChunkKind.bytes) return chunk[1];
    if (chunk[0] === SerializeChunkKind.text) return encoder.encode(chunk[1]);
    throw new SerializeCodecError(StoreWorkerErrorText.valueChunks, {
      type: WorkerDiagnosticType.worker,
      phase: WorkerSerializePhase.encode,
      context: 'serialize-worker',
      chunkIndex: 0,
      bytesConsumed: 0,
      code: StoreWorkerErrorCode.chunkMergeFailed,
      source: STORE_WORKER_SOURCE
    });
  });
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return [SerializeChunkKind.bytes, merged];
}
