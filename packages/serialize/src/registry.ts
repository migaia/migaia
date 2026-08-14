import {
  SerializeError,
  assertSerializeType,
  isChunkShape,
  type ISerializeAbortSignal,
  type ISerializeChunk,
  type ISerializeContext,
  type ISerializeOutput,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin,
  type ISerializeRegistry
} from './types';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const NEVER_ABORTED = new AbortController().signal;

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
    source: string;
    chunkIndex: number;
    bytesConsumed: number;
  }
): asserts candidate is ISerializeChunk {
  const fail = (reason: string): never => {
    throw new SerializeError(`[store] ${reason}`, details);
  };
  if (!Array.isArray(candidate) || candidate.length !== 2) {
    fail('serialize chunk must be a [type, data] pair');
  }
  const [kind, data] = candidate as [unknown, unknown];
  if (kind === 'text') {
    if (typeof data !== 'string') fail('text chunk data must be a string');
    return;
  }
  if (kind === 'bytes') {
    if (!(data instanceof Uint8Array)) {
      fail('bytes chunk data must be a Uint8Array');
    }
    return;
  }
  if (kind !== 'value') {
    fail(`unknown serialize chunk type: ${String(kind)}`);
  }
}

/** 把根因拼进消息：只挂 cause 的话，日志里看到的是一句无信息量的空壳。 */
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const chunkSize = (chunk: ISerializeChunk): number => {
  if (chunk[0] === 'text') return textEncoder.encode(chunk[1]).byteLength;
  if (chunk[0] === 'bytes') return chunk[1].byteLength;
  return 0;
};

/**
 * 把 parser 吐出的分段收敛成一段。
 *
 * 拼装规则： - 全是 text → 直接拼字符串，省掉一次 UTF-8 转换 - 出现过 bytes → 把 text 段就地转成字节，整体按字节拼 - 出现 value →
 * 必须独占一次输出；与其他段混用属于 parser 实现错误 每一段的取用都单独包住，异常带上段序号与已消费量，便于定位截断/损坏的位置。
 */
async function collectChunks(
  output: ISerializeOutput,
  details: { type: string; phase: ISerializePhase; source: string; signal: ISerializeAbortSignal }
): Promise<ISerializeChunk> {
  const collected: ISerializeChunk[] = [];
  let sawBytes = false;
  let sawValue = false;
  let chunkIndex = 0;
  let bytesConsumed = 0;

  const take = (candidate: unknown): void => {
    if (details.signal.aborted) {
      throw new SerializeError('[store] serialize aborted', {
        type: details.type,
        phase: details.phase,
        source: details.source,
        chunkIndex,
        bytesConsumed
      });
    }
    const at = { ...details, chunkIndex, bytesConsumed };
    assertChunk(candidate, at);
    if (candidate[0] === 'value') sawValue = true;
    if (candidate[0] === 'bytes') sawBytes = true;
    // value 段必须独占一次输出：它已经是成品对象，和线材段没有可拼接的语义
    if (sawValue && chunkIndex > 0) {
      throw new SerializeError('[store] a value chunk cannot be combined with other chunks', at);
    }
    collected.push(candidate);
    bytesConsumed += chunkSize(candidate);
    chunkIndex++;
  };

  // 单段与 Promise 走快路；只有真正的多段容器才进流式分支。
  // 流式分支边取边校验，这样中途失败时报出的段号与已消费量才是真实进度。
  if (isChunkShape(output)) {
    take(output);
  } else if (isAsyncIterable(output) || isSyncIterable(output)) {
    try {
      if (isAsyncIterable(output)) {
        for await (const chunk of output) take(chunk);
      } else {
        for (const chunk of output) take(chunk);
      }
    } catch (error) {
      if (error instanceof SerializeError) throw error;
      throw new SerializeError(
        `[store] serialize stream failed at chunk ${chunkIndex}: ${reasonOf(error)}`,
        { ...details, chunkIndex, bytesConsumed, cause: error }
      );
    }
  } else {
    let single: unknown;
    try {
      single = await output;
    } catch (error) {
      throw new SerializeError(`[store] serialize step failed: ${reasonOf(error)}`, {
        ...details,
        chunkIndex,
        bytesConsumed,
        cause: error
      });
    }
    take(single);
  }

  if (chunkIndex === 0) {
    throw new SerializeError('[store] serialize produced no chunks', {
      ...details,
      chunkIndex: 0,
      bytesConsumed: 0
    });
  }
  if (sawValue) return collected[0];
  // 全文本时直接拼字符串，省掉一次 UTF-8 往返
  if (!sawBytes) {
    let text = '';
    for (const chunk of collected) text += chunk[1] as string;
    return ['text', text];
  }

  // 混合形态：统一到字节再拼
  const parts = collected.map((chunk) =>
    chunk[0] === 'bytes' ? chunk[1] : textEncoder.encode(chunk[1] as string)
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

/** 把任意分段规约成字符串，供只接受文本的载体（localStorage、HTML）使用。 */
export function chunkToText(chunk: ISerializeChunk): string {
  if (chunk[0] === 'text') return chunk[1];
  if (chunk[0] === 'bytes') return textDecoder.decode(chunk[1]);
  throw new TypeError('[store] a value chunk has no text form');
}

/** 把任意分段规约成字节，供 transfer / IndexedDB / wasm 使用。 */
export function chunkToBytes(chunk: ISerializeChunk): Uint8Array {
  if (chunk[0] === 'bytes') return chunk[1].slice();
  if (chunk[0] === 'text') return textEncoder.encode(chunk[1]);
  throw new TypeError('[store] a value chunk has no byte form');
}

export function createSerializeRegistry(plugins: readonly ISerializePlugin[]): ISerializeRegistry {
  if (plugins.length === 0) {
    throw new RangeError('[store] serialize registry needs at least one plugin');
  }
  const byType = new Map<string, ISerializeParser>();
  for (const plugin of plugins) {
    // type 会进 HTML 属性和存档头分隔字段，且常来自第三方包——注册这关就收死
    assertSerializeType(plugin.type);
    if (byType.has(plugin.type)) {
      throw new RangeError(`[store] duplicate serialize plugin type: ${plugin.type}`);
    }
    byType.set(plugin.type, plugin.parser);
  }
  const primaryType = plugins[0].type;
  let disposed = false;

  const resolve = (type: string, phase: ISerializePhase): ISerializeParser => {
    if (disposed) {
      throw new Error('[store] serialize registry is disposed');
    }
    const parser = byType.get(type);
    if (!parser) {
      throw new SerializeError(`[store] no serialize plugin registered for type: ${type}`, {
        type,
        phase,
        source: 'registry',
        chunkIndex: 0,
        bytesConsumed: 0
      });
    }
    return parser;
  };

  const contextFor = (
    options: { signal?: ISerializeAbortSignal; source?: string } | undefined
  ): ISerializeContext => ({
    signal: options?.signal ?? NEVER_ABORTED,
    source: options?.source ?? 'anonymous'
  });

  return {
    primaryType,
    types: [...byType.keys()],
    has: (type) => byType.has(type),

    async encode(value, options) {
      const type = options?.type ?? primaryType;
      const parser = resolve(type, 'encode');
      const context = contextFor(options);
      let output: ISerializeOutput;
      try {
        // parser.encode() is called separately from awaiting its result: called inline as an
        // argument expression, a synchronous throw here would happen outside any try/catch and
        // propagate as the parser's raw error instead of a structured SerializeError — the one
        // failure path in this module that skipped the wrapping every other path applies.
        output = parser.encode(value, context);
      } catch (error) {
        throw new SerializeError(`[store] serialize step failed: ${reasonOf(error)}`, {
          type,
          phase: 'encode',
          source: context.source,
          chunkIndex: 0,
          bytesConsumed: 0,
          cause: error
        });
      }
      const chunk = await collectChunks(output, {
        type,
        phase: 'encode',
        source: context.source,
        signal: context.signal
      });
      if (context.signal.aborted) {
        throw new SerializeError('[store] serialize aborted', {
          type,
          phase: 'encode',
          source: context.source,
          chunkIndex: 0,
          bytesConsumed: chunkSize(chunk)
        });
      }
      return chunk;
    },

    async decode(chunk, options) {
      const type = options?.type ?? primaryType;
      const parser = resolve(type, 'decode');
      const context = contextFor(options);
      assertChunk(chunk, {
        type,
        phase: 'decode',
        source: context.source,
        chunkIndex: 0,
        bytesConsumed: 0
      });
      let value: unknown;
      try {
        value = await parser.decode(chunk, context);
      } catch (error) {
        throw new SerializeError(`[store] deserialize failed: ${reasonOf(error)}`, {
          type,
          phase: 'decode',
          source: context.source,
          chunkIndex: 0,
          bytesConsumed: chunkSize(chunk),
          cause: error
        });
      }
      if (context.signal.aborted) {
        throw new SerializeError('[store] deserialize aborted', {
          type,
          phase: 'decode',
          source: context.source,
          chunkIndex: 0,
          bytesConsumed: chunkSize(chunk)
        });
      }
      return value;
    },

    dispose() {
      if (disposed) return;
      // 先切断新请求，再释放：否则释放过程中还能进来新的 encode/decode
      disposed = true;
      // 尽力释放：一个 parser 抛错不能让后面的 worker 端口漏掉，
      // 那正是「释放失败反而造成泄漏」的经典形态。错误聚合后一次抛出。
      const failures: unknown[] = [];
      for (const parser of byType.values()) {
        try {
          parser.dispose?.();
        } catch (error) {
          failures.push(error);
        }
      }
      byType.clear();
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, '[store] several serialize parsers failed to dispose');
      }
    }
  };
}
