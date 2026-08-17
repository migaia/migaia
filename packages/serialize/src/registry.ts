import {
  SerializeCodecError,
  assertSerializeType,
  isChunkShape,
  type ISerializeAbortSignal,
  type ISerializeChunk,
  type ISerializeContext,
  type ISerializeOutput,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin,
  type ISerializeRegistry,
  type ISerializeScheduler,
  type ITextDecoder,
  type ITextEncoder
} from './types.js';
import {
  createAbortController,
  createLifecycleScope,
  systemScheduler,
  type ILifecycleScope
} from '@migaia/lifecycle';
import {
  createSerializeError,
  createSerializeRangeError,
  createSerializeTypeError,
  SERIALIZE_SOURCE,
  SerializeErrorCode
} from './errors.js';
import {
  SerializeChunkKind,
  SerializeCleanupKind,
  SerializeCleanupPolicy,
  SerializePhase
} from './format-constants.js';

const NEVER_ABORTED: ISerializeAbortSignal = {
  aborted: false,
  reason: undefined,
  addEventListener() {},
  removeEventListener() {}
};

const isAsyncIterable = (value: unknown): value is AsyncIterable<ISerializeChunk> =>
  typeof value === 'object' && value !== null && Symbol.asyncIterator in value;

const isSyncIterable = (value: unknown): value is Iterable<ISerializeChunk> =>
  typeof value === 'object' && value !== null && Symbol.iterator in value;

/** 单段的形状校验：宁可在这里明确报错，也不要让一个畸形段悄悄流进拼装环节。 */
function assertChunk(
  candidate: unknown,
  details: {
    type: string;
    phase: ISerializePhase;
    context: string;
    chunkIndex: number;
    bytesConsumed: number;
  }
): asserts candidate is ISerializeChunk {
  const fail = (reason: string): never => {
    throw new SerializeCodecError(`${reason}`, {
      ...details,
      code: SerializeErrorCode.invalidChunk
    });
  };
  if (!Array.isArray(candidate) || candidate.length !== 2) {
    fail('serialize chunk must be a [type, data] pair');
  }
  const [kind, data] = candidate as [unknown, unknown];
  if (kind === SerializeChunkKind.text) {
    if (typeof data !== 'string') fail('text chunk data must be a string');
    return;
  }
  if (kind === SerializeChunkKind.bytes) {
    if (!(data instanceof Uint8Array)) {
      fail('bytes chunk data must be a Uint8Array');
    }
    return;
  }
  if (kind !== SerializeChunkKind.value) {
    fail(`unknown serialize chunk type: ${String(kind)}`);
  }
}

/** 把根因拼进消息：只挂 cause 的话，日志里看到的是一句无信息量的空壳。 */
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 结构化探测宿主 `TextEncoder`（Encoding API），不 import DOM/Node。 */
const hostTextEncoder = (): ITextEncoder | undefined => {
  const Ctor = (globalThis as { TextEncoder?: new () => ITextEncoder }).TextEncoder;
  return Ctor ? new Ctor() : undefined;
};

/** 结构化探测宿主 `TextDecoder`（Encoding API），不 import DOM/Node。 */
const hostTextDecoder = (): ITextDecoder | undefined => {
  const Ctor = (globalThis as { TextDecoder?: new () => ITextDecoder }).TextDecoder;
  return Ctor ? new Ctor() : undefined;
};

/**
 * 手动消费 AsyncIterable，使 `take` 抛错（abort）时能显式调用 `iterator.return()` 并把其错误作为 secondary 路由到
 * `report`（不覆盖 primary）。
 */
async function drainAsyncIterable(
  output: AsyncIterable<ISerializeChunk>,
  take: (chunk: unknown) => void,
  report: (error: unknown) => void
): Promise<void> {
  const iterator = output[Symbol.asyncIterator]();
  try {
    while (true) {
      const result = await iterator.next();
      if (result.done) break;
      take(result.value);
    }
  } catch (error) {
    try {
      const close = iterator.return?.();
      if (close) await close;
    } catch (closeError) {
      report(closeError);
    }
    throw error;
  }
}

/**
 * 把 parser 吐出的分段收敛成一段。
 *
 * 拼装规则：全 text 直接拼字符串；出现 bytes 就地转字节；出现 value 独占一次输出。
 */
async function collectChunks(
  output: ISerializeOutput,
  details: {
    type: string;
    phase: ISerializePhase;
    context: string;
    signal: ISerializeAbortSignal;
  },
  encoder: ITextEncoder,
  report: (error: unknown) => void
): Promise<ISerializeChunk> {
  const collected: ISerializeChunk[] = [];
  let sawBytes = false;
  let sawValue = false;
  let chunkIndex = 0;
  let bytesConsumed = 0;

  const take = (candidate: unknown): void => {
    if (details.signal.aborted) {
      throw new SerializeCodecError('serialize aborted', {
        type: details.type,
        phase: details.phase,
        context: details.context,
        chunkIndex,
        bytesConsumed,
        code: SerializeErrorCode.aborted,
        // R-1/T-15：abort 带 reason 时必须经 cause 保持 `=== reason` 可达；缺失则不制造原因。
        cause: details.signal.reason
      });
    }
    const at = { ...details, chunkIndex, bytesConsumed };
    assertChunk(candidate, at);
    if (candidate[0] === SerializeChunkKind.value) sawValue = true;
    if (candidate[0] === SerializeChunkKind.bytes) sawBytes = true;
    if (sawValue && chunkIndex > 0) {
      throw new SerializeCodecError('a value chunk cannot be combined with other chunks', {
        ...at,
        code: SerializeErrorCode.invalidChunk
      });
    }
    collected.push(candidate);
    bytesConsumed +=
      candidate[0] === SerializeChunkKind.bytes ? (candidate[1] as Uint8Array).byteLength : 0;
    chunkIndex++;
  };

  if (isChunkShape(output)) {
    take(output);
  } else if (isAsyncIterable(output) || isSyncIterable(output)) {
    try {
      if (isAsyncIterable(output)) {
        await drainAsyncIterable(output, take, report);
      } else {
        for (const chunk of output) take(chunk);
      }
    } catch (error) {
      if (error instanceof SerializeCodecError) throw error;
      throw new SerializeCodecError(
        `serialize stream failed at chunk ${chunkIndex}: ${reasonOf(error)}`,
        {
          ...details,
          chunkIndex,
          bytesConsumed,
          code: SerializeErrorCode.encodeFailed,
          cause: error
        }
      );
    }
  } else {
    let single: unknown;
    try {
      single = await output;
    } catch (error) {
      throw new SerializeCodecError(`serialize step failed: ${reasonOf(error)}`, {
        ...details,
        chunkIndex,
        bytesConsumed,
        code: SerializeErrorCode.encodeFailed,
        cause: error
      });
    }
    take(single);
  }

  if (chunkIndex === 0) {
    throw new SerializeCodecError('serialize produced no chunks', {
      ...details,
      chunkIndex: 0,
      bytesConsumed: 0,
      code: SerializeErrorCode.encodeFailed
    });
  }
  if (sawValue) return collected[0];
  if (!sawBytes) {
    let text = '';
    for (const chunk of collected) text += chunk[1] as string;
    return ['text', text];
  }
  const parts = collected.map((chunk) =>
    chunk[0] === SerializeChunkKind.bytes ? chunk[1] : encoder.encode(chunk[1] as string)
  );
  let total = 0;
  for (const part of parts) total += part.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return ['bytes', merged];
}

/** 把任意分段规约成字符串（文本载体）。`decoder` 必填（Encoding 注入）。 */
export function chunkToText(chunk: ISerializeChunk, decoder: ITextDecoder): string {
  if (chunk[0] === SerializeChunkKind.text) return chunk[1];
  if (chunk[0] === SerializeChunkKind.bytes) return decoder.decode(chunk[1]);
  throw createSerializeTypeError(SerializeErrorCode.invalidChunk, 'a value chunk has no text form');
}

/** 把任意分段规约成字节（transfer / IndexedDB / wasm）。`encoder` 必填（Encoding 注入）。 */
export function chunkToBytes(chunk: ISerializeChunk, encoder: ITextEncoder): Uint8Array {
  if (chunk[0] === SerializeChunkKind.bytes) return chunk[1].slice();
  if (chunk[0] === SerializeChunkKind.text) return encoder.encode(chunk[1]);
  throw createSerializeTypeError(SerializeErrorCode.invalidChunk, 'a value chunk has no byte form');
}

/**
 * 双 Promise 模型（runtime-neutrality.sdd.md R-3）：把 parserTask 与「composed signal 已 abort」赛跑，使调用方在
 * parser 阻塞（encode/decode 永不 settle、AsyncIterable 不再 yield）时仍能因 abort 及时 settle，而不是永久挂起。
 *
 * ParserTask 仍独立运行（detached），其迟到结果/拒绝被观测但不改变已结算的 public promise；abort 的 reason 经 `cause` 保持 `===
 * reason` 可达（R-1/T-15）。`{ once: true }` + settle 后 `removeEventListener` 保证监听器不泄漏。
 */
function raceAbort<T>(
  task: Promise<T>,
  signal: ISerializeAbortSignal,
  details: { readonly type: string; readonly phase: ISerializePhase; readonly context: string }
): Promise<T> {
  const abortError = (): SerializeCodecError =>
    new SerializeCodecError('serialize aborted', {
      type: details.type,
      phase: details.phase,
      context: details.context,
      chunkIndex: 0,
      bytesConsumed: 0,
      code: SerializeErrorCode.aborted,
      cause: signal.reason
    });
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(abortError());
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export function createSerializeRegistry(
  plugins: readonly ISerializePlugin[],
  options?: import('./types.js').ISerializeRegistryOptions
): ISerializeRegistry {
  // 1. 校验 plugins（空表 → INVALID_OPTION）
  if (plugins.length === 0) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      'serialize registry needs at least one plugin'
    );
  }

  // 2. 解析 scheduler（未提供 → lifecycle systemScheduler；结构非法 → TypeError + INVALID_OPTION）
  const scheduler: ISerializeScheduler = options?.scheduler ?? systemScheduler;
  if (typeof scheduler?.now !== 'function' || typeof scheduler?.schedule !== 'function') {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      'serialize scheduler must be { now, schedule }'
    );
  }

  // 3. 解析 encoder/decoder（省略 → 探测宿主 Encoding API；缺失 → ENV_UNSUPPORTED）
  const encoder: ITextEncoder | undefined = options?.encoder ?? hostTextEncoder();
  const decoder: ITextDecoder | undefined = options?.decoder ?? hostTextDecoder();
  if (encoder === undefined || decoder === undefined) {
    throw createSerializeError(
      SerializeErrorCode.envUnsupported,
      'TextEncoder/TextDecoder is unavailable'
    );
  }

  // 4. 建 closing controller + async scope + parser 注册。
  //    先一次性校验全部 plugin 的 type 合法性与重复性，再统一 own 到 scope：
  //    校验失败发生在任何 parser 被 own 之前，因此同步构造无需回滚（也无从回滚异步 parser dispose）。
  const closing = createAbortController();
  const scope: ILifecycleScope = createLifecycleScope();
  const byType = new Map<string, ISerializeParser>();
  for (const plugin of plugins) {
    assertSerializeType(plugin.type);
    if (byType.has(plugin.type)) {
      throw createSerializeRangeError(
        SerializeErrorCode.invalidOption,
        `duplicate serialize plugin type: ${plugin.type}`
      );
    }
    byType.set(plugin.type, plugin.parser);
  }
  for (const parser of byType.values()) {
    scope.own(parser, { force: () => parser.dispose?.() });
  }
  const primaryType = plugins[0].type;

  // 5. pending tracker + close/dispose 状态
  let closed = false;
  let disposed = false;
  let cleanedUp = false;
  let pendingCount = 0;
  const drainResolvers: Array<() => void> = [];
  let disposePromise: Promise<void> | undefined;
  const report = options?.report ?? ((): void => {});

  const track = <T>(task: Promise<T>): Promise<T> => {
    pendingCount++;
    const settle = (): void => {
      pendingCount--;
      if (pendingCount === 0) {
        const resolvers = drainResolvers.splice(0);
        for (const resolve of resolvers) resolve();
      }
    };
    task.then(settle, (error) => {
      settle();
      // Detached 迟到 rejection（cleanup 之后才 settle）走 report 通道观测；不重新接入 registry
      // 生命周期、不改变 terminal、不吞 rejection。report 自身抛错 containment（不影响 observation）。
      if (cleanedUp) {
        try {
          report(error);
        } catch {
          // report 抛错 containment：不影响 parser task 的 rejection observation
        }
      }
    });
    return task;
  };

  const drain = (): Promise<void> => {
    if (pendingCount === 0) return Promise.resolve();
    return new Promise((resolve) => drainResolvers.push(resolve));
  };

  const resolve = (type: string, phase: ISerializePhase): ISerializeParser => {
    if (closed || disposed) {
      throw createSerializeError(
        SerializeErrorCode.registryDisposed,
        'serialize registry is disposed'
      );
    }
    const parser = byType.get(type);
    if (!parser) {
      throw new SerializeCodecError(`no serialize plugin registered for type: ${type}`, {
        type,
        phase,
        context: 'registry',
        chunkIndex: 0,
        bytesConsumed: 0,
        code: SerializeErrorCode.codecNotFound
      });
    }
    return parser;
  };

  const contextFor = (
    opts: { signal?: ISerializeAbortSignal; context?: string } | undefined
  ): ISerializeContext => ({
    signal: opts?.signal ?? NEVER_ABORTED,
    context: opts?.context ?? 'anonymous'
  });

  // composed signal：caller + closing，first-observed-wins；closing 已 aborted 才 closing reason 优先。
  // 返回 `dispose` 供 operation settle 后移除两个 listener（R-3「settle 后移除两个 listener」，防长期 caller signal 上的监听器泄漏）。
  const composeSignal = (
    caller?: ISerializeAbortSignal
  ): { readonly signal: ISerializeAbortSignal; readonly dispose: () => void } => {
    if (closing.signal.aborted || !caller) return { signal: closing.signal, dispose: () => {} };
    if (caller.aborted) return { signal: caller, dispose: () => {} };
    const composed = createAbortController();
    const onCallerAbort = (): void => composed.abort(caller.reason);
    const onClosingAbort = (): void => composed.abort(closing.signal.reason);
    caller.addEventListener('abort', onCallerAbort, { once: true });
    closing.signal.addEventListener('abort', onClosingAbort, { once: true });
    return {
      signal: composed.signal,
      dispose: () => {
        caller.removeEventListener('abort', onCallerAbort);
        closing.signal.removeEventListener('abort', onClosingAbort);
      }
    };
  };

  const doClose = (): void => {
    if (closed || disposed) return;
    closed = true;
    closing.abort();
  };

  return {
    primaryType,
    types: [...byType.keys()],
    has: (type) => byType.has(type),

    encode(value, options) {
      const task = (async (): Promise<ISerializeChunk> => {
        const type = options?.type ?? primaryType;
        const parser = resolve(type, 'encode');
        const context = contextFor(options);
        const composed = composeSignal(options?.signal);
        const signal = composed.signal;

        const parserTask = (async (): Promise<ISerializeChunk> => {
          try {
            let output: ISerializeOutput;
            try {
              output = parser.encode(value, { signal, context: context.context });
            } catch (error) {
              throw new SerializeCodecError(`serialize step failed: ${reasonOf(error)}`, {
                type,
                phase: SerializePhase.encode,
                context: context.context,
                chunkIndex: 0,
                bytesConsumed: 0,
                code: SerializeErrorCode.encodeFailed,
                cause: error
              });
            }
            const chunk = await collectChunks(
              output,
              { type, phase: SerializePhase.encode, context: context.context, signal },
              encoder,
              report
            );
            if (signal.aborted) {
              throw new SerializeCodecError('serialize aborted', {
                type,
                phase: SerializePhase.encode,
                context: context.context,
                chunkIndex: 0,
                bytesConsumed: chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0,
                code: SerializeErrorCode.aborted,
                cause: signal.reason
              });
            }
            return chunk;
          } finally {
            composed.dispose();
          }
        })();

        // 租约唯一释放点 + detached 迟到 rejection 出口（R-3 HIGH-1）：track 完整 collect/encode task，
        // 其迟到 rejection 在 cleanedUp 后经 report 观测、不改变 terminal。
        track(parserTask);
        // 双 Promise（R-3）：public promise = race(parserTask, composed abort)，abort 时及时 settle。
        return await raceAbort(parserTask, signal, {
          type,
          phase: SerializePhase.encode,
          context: context.context
        });
      })();
      return task;
    },

    decode(chunk, options) {
      const task = (async (): Promise<unknown> => {
        const type = options?.type ?? primaryType;
        const parser = resolve(type, 'decode');
        const context = contextFor(options);
        const composed = composeSignal(options?.signal);
        const signal = composed.signal;

        const parserTask = (async (): Promise<unknown> => {
          try {
            assertChunk(chunk, {
              type,
              phase: SerializePhase.decode,
              context: context.context,
              chunkIndex: 0,
              bytesConsumed: 0
            });
            let value: unknown;
            try {
              value = await parser.decode(chunk, { signal, context: context.context });
            } catch (error) {
              throw new SerializeCodecError(`deserialize failed: ${reasonOf(error)}`, {
                type,
                phase: SerializePhase.decode,
                context: context.context,
                chunkIndex: 0,
                bytesConsumed: chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0,
                code: SerializeErrorCode.decodeFailed,
                cause: error
              });
            }
            if (signal.aborted) {
              throw new SerializeCodecError('deserialize aborted', {
                type,
                phase: SerializePhase.decode,
                context: context.context,
                chunkIndex: 0,
                bytesConsumed: chunk[0] === SerializeChunkKind.bytes ? chunk[1].byteLength : 0,
                code: SerializeErrorCode.aborted,
                cause: signal.reason
              });
            }
            return value;
          } finally {
            composed.dispose();
          }
        })();

        track(parserTask);
        return await raceAbort(parserTask, signal, {
          type,
          phase: SerializePhase.decode,
          context: context.context
        });
      })();
      return task;
    },

    close() {
      doClose();
    },

    dispose(opts) {
      if (disposePromise) return disposePromise;
      disposePromise = (async (): Promise<void> => {
        // 输入门禁（runtime-neutrality.sdd.md §4.2）：deadlineAt 必须有限，NaN/Infinity 拒绝；
        // 负值视为「已过」，由下方 remaining <= 0 分支处理，不在此抛错。
        const deadlineAt = opts?.deadlineAt;
        if (deadlineAt !== undefined && !Number.isFinite(deadlineAt)) {
          throw createSerializeTypeError(
            SerializeErrorCode.invalidOption,
            'serialize dispose deadlineAt must be a finite number'
          );
        }
        doClose();
        disposed = true;
        const onDrainTimeout = options?.onDrainTimeout;
        const reportTimeout = (): void => {
          try {
            onDrainTimeout?.({
              kind: SerializeCleanupKind.drainTimeout,
              source: SERIALIZE_SOURCE,
              deadlineAt,
              pendingCount
            });
          } catch {
            // onDrainTimeout 抛错不阻断 cleanup（containment）
          }
        };
        if (deadlineAt === undefined) {
          await drain();
        } else {
          const remaining = deadlineAt - scheduler.now();
          if (remaining <= 0) {
            reportTimeout();
          } else {
            let timer: { cancel(): void } | undefined;
            const deadlineReached = new Promise<void>((resolve) => {
              timer = scheduler.schedule(resolve, remaining);
            });
            await Promise.race([drain(), deadlineReached]);
            timer?.cancel();
            if (pendingCount > 0) reportTimeout();
          }
        }
        // cleanup：判别联合（throw 默认 / report 策略）
        const cleanup = options?.cleanup ?? { policy: SerializeCleanupPolicy.throw };
        try {
          await scope.dispose();
        } catch (error) {
          if (cleanup.policy === SerializeCleanupPolicy.throw) throw error;
          try {
            cleanup.report({
              kind: SerializeCleanupKind.cleanupError,
              source: SERIALIZE_SOURCE,
              error
            });
          } catch {
            // report 自身抛错 containment：dispose 仍 resolve
          }
        } finally {
          byType.clear();
          cleanedUp = true;
        }
      })();
      return disposePromise;
    }
  };
}
