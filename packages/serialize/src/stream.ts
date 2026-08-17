import {
  SerializeCodecError,
  type ISerializeAbortSignal,
  type ISerializeChunk,
  type ISerializeRegistry,
  type ISerializeScheduler,
  type ITextEncoder
} from './types.js';
import {
  createSerializeError,
  createSerializeRangeError,
  createSerializeTypeError,
  SerializeErrorCode
} from './errors.js';
import { SerializeChunkKind, SerializePhase } from './format-constants.js';

/**
 * 帧预算切片。
 *
 * 实测（100 万条 → worker）：整包一次性编码会连续占住主线程 237ms，约合掉 14 帧； 切成 5 万条一片、片间让出后，最长单次阻塞降到 14.2ms —— 压在 60fps 的
 * 16.7ms 预算之内，一帧不掉，墙钟还快了 37%。但切过头同样有害：1 万条一片时最长阻塞 只有 3.1ms，可 100 次让出的固定开销把墙钟顶回了整包水平。
 *
 * 所以片大小不能按字节数写死，得按**实测耗时**反推。这里的做法是让生成器在 yield 之后挂起，消费者取下一片时才恢复——挂起与恢复之间的时差正好等于消费者
 * 处理这一片的真实耗时，据此调整下一片。
 */
export type IFrameBudgetOptions = {
  /** 每片目标耗时。默认 8ms：60fps 一帧 16.7ms，留一半余量给渲染与其他任务， 免得刚好卡在预算边缘时被别的工作顶出去。 */
  readonly targetMs?: number;
  /** 片大小下界，防止把开销摊成纯消息成本。 */
  readonly minItems?: number;
  /** 片大小上界，防止首片就把主线程占死。 */
  readonly maxItems?: number;
  /** 首片大小。太大则第一片必然超预算，所以刻意保守。 */
  readonly initialItems?: number;
  /**
   * 让出方式。缺省用 `scheduler.schedule(resolve, 0)`；可换成 `scheduler.yield()`（更精确）或
   * requestIdleCallback（更保守）。
   */
  readonly yieldTo?: () => Promise<void>;
  readonly signal?: ISerializeAbortSignal;
  /**
   * Runtime-neutral scheduler（**必填**，R-4：core 无默认 timer、不直接使用宿主
   * `setTimeout`/`performance`/`Date.now`）。
   */
  readonly scheduler: ISerializeScheduler;
};

const clamp = (value: number, low: number, high: number): number =>
  value < low ? low : value > high ? high : value;

/** 有限正数；NaN 与 Infinity 都要挡住。 */
function assertPositiveMs(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      `frame budget ${name} must be a finite positive number, got ${value}`
    );
  }
}

/** 条目数必须是有限正整数——小数会让片边界漂移，NaN 会让循环停不下来。 */
function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      `frame budget ${name} must be a positive integer, got ${value}`
    );
  }
}

/**
 * 按帧预算把一个大数组切成若干片，片间让出主线程。
 *
 * 用法是 `for await (const slice of sliceByFrameBudget(rows))`，循环体里做实际 工作——那段耗时会被自动量到，用来定下一片的大小。
 */
export async function* sliceByFrameBudget<T>(
  items: readonly T[],
  options: IFrameBudgetOptions
): AsyncGenerator<readonly T[], void, undefined> {
  const {
    targetMs = 8,
    minItems = 64,
    maxItems = 250_000,
    initialItems = 2_048,
    yieldTo,
    signal,
    scheduler
  } = options;
  // scheduler 必填（R-4）：core 无默认 timer，不直接触碰宿主 `setTimeout`/`performance`/`Date.now`。
  if (
    !scheduler ||
    typeof scheduler.now !== 'function' ||
    typeof scheduler.schedule !== 'function'
  ) {
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      'frame budget scheduler must be { now, schedule }'
    );
  }
  const now = (): number => scheduler.now();
  const resolveYield =
    yieldTo ?? (() => new Promise<void>((resolve) => void scheduler.schedule(resolve, 0)));
  // NaN 必须显式挡掉：NaN <= 0 是 false，能穿过朴素的范围检查，然后
  // clamp(NaN) 仍是 NaN、slice(0, NaN) 得到空数组、index += 0 —— while 永不结束。
  // 这类参数常来自配置或远端下发，不能假定调用方给的是数字。
  assertPositiveMs(targetMs, 'targetMs');
  assertCount(minItems, 'minItems');
  assertCount(maxItems, 'maxItems');
  assertCount(initialItems, 'initialItems');
  if (maxItems < minItems) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      'frame budget maxItems must be at least minItems'
    );
  }

  let size = clamp(initialItems, minItems, maxItems);
  let index = 0;
  while (index < items.length) {
    if (signal?.aborted)
      throw createSerializeError(SerializeErrorCode.aborted, 'serialize aborted');
    const slice = items.slice(index, index + size);
    const startedAt = now();
    yield slice;
    // 恢复点：消费者已经处理完这一片，时差即其真实耗时
    const elapsed = now() - startedAt;
    index += slice.length;

    // 阻尼调整：直接按比例缩放会在噪声下来回振荡，取当前值与目标值的中点。
    // elapsed 极小时用下限兜底，避免除出一个荒谬的放大倍数。
    const ratio = targetMs / Math.max(elapsed, 0.05);
    const target = clamp(Math.round(size * ratio), minItems, maxItems);
    size = clamp(Math.round((size + target) / 2), minItems, maxItems);

    if (index < items.length) await resolveYield();
  }
}

export type IEncodeStreamOptions = IFrameBudgetOptions & {
  readonly type?: string;
  readonly context?: string;
  /** 同时在途的请求数上限，即背压。默认 1：编好一片就等它落地再编下一片， 峰值内存只有一片。调高可以让编码与 worker 处理重叠，代价是峰值内存翻倍。 */
  readonly maxInFlight?: number;
};

/**
 * 把一个大数组编码成分段流，**不做拼装**。
 *
 * 与 registry.encode 的区别就在这里：encode 会把所有分段合并成一整块返回， 适合「最终要一个完整 blob」的场景；而落 IndexedDB、写文件、发 fetch
 * body 这类消费者能逐片吃下，拼装反而白白制造一个全量大对象的峰值内存。
 */
export async function* encodeStream<T>(
  registry: ISerializeRegistry,
  items: readonly T[],
  options: IEncodeStreamOptions
): AsyncGenerator<ISerializeChunk, void, undefined> {
  const { type, context = 'stream', signal, maxInFlight = 1 } = options;
  // NaN 会让 `inFlight.length >= maxInFlight` 恒为 false，背压彻底关闭，
  // 在途请求无限堆积直到内存耗尽
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      `maxInFlight must be a positive integer, got ${maxInFlight}`
    );
  }
  const inFlight: Promise<ISerializeChunk>[] = [];
  let sliceIndex = 0;

  const drainOne = async (): Promise<ISerializeChunk> => {
    const pending = inFlight.shift()!;
    try {
      return await pending;
    } catch (error) {
      // 刻意不透传内层 SerializeCodecError：它的 chunkIndex 说的是「本次编码的第几段」，
      // 恒为 0，会把「流里的第几片」这个真正有用的位置盖掉。原错误挂在 cause 上。
      throw new SerializeCodecError(
        `encode stream failed at slice ${sliceIndex}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          type: type ?? registry.primaryType,
          phase: SerializePhase.encode,
          context,
          chunkIndex: sliceIndex,
          bytesConsumed: 0,
          code: SerializeErrorCode.encodeFailed,
          cause: error
        }
      );
    }
  };

  try {
    for await (const slice of sliceByFrameBudget(items, options)) {
      if (signal?.aborted)
        throw createSerializeError(SerializeErrorCode.aborted, 'serialize aborted');
      inFlight.push(registry.encode(slice, { type, signal, context }));
      // 背压：在途数达到上限就先把最早那笔排空，避免无限堆积
      while (inFlight.length >= maxInFlight) {
        yield await drainOne();
        sliceIndex++;
      }
    }
    while (inFlight.length > 0) {
      yield await drainOne();
      sliceIndex++;
    }
  } finally {
    // 消费者可能提前 break/throw，此时生成器会被 return()。留下的在途 Promise
    // 若无人认领就会变成 unhandled rejection，所以在这里统一接住。
    for (const pending of inFlight) pending.catch(() => undefined);
    inFlight.length = 0;
  }
}

/** 把分段流逐片解码，同样不做拼装。 */
export async function* decodeStream(
  registry: ISerializeRegistry,
  chunks: AsyncIterable<ISerializeChunk> | Iterable<ISerializeChunk>,
  options: {
    readonly type?: string;
    readonly context?: string;
    readonly signal?: ISerializeAbortSignal;
  } = {}
): AsyncGenerator<unknown, void, undefined> {
  const { type, context = 'stream', signal } = options;
  let index = 0;
  for await (const chunk of chunks as AsyncIterable<ISerializeChunk>) {
    if (signal?.aborted)
      throw createSerializeError(SerializeErrorCode.aborted, 'serialize aborted');
    try {
      yield await registry.decode(chunk, { type, signal, context });
    } catch (error) {
      // 同上：保留流位置，内层错误挂 cause
      throw new SerializeCodecError(
        `decode stream failed at chunk ${index}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          type: type ?? registry.primaryType,
          phase: SerializePhase.decode,
          context,
          chunkIndex: index,
          bytesConsumed: 0,
          code: SerializeErrorCode.decodeFailed,
          cause: error
        }
      );
    }
    index++;
  }
}

/** 把分段流合并成一整块。只在消费者确实需要完整 blob 时才用——它会把整份数据 同时驻留在内存里，正是流式想避免的那笔峰值。 */
export async function collectStream(
  chunks: AsyncIterable<ISerializeChunk>,
  encoder?: ITextEncoder
): Promise<ISerializeChunk> {
  const collected: ISerializeChunk[] = [];
  let sawBytes = false;
  for await (const chunk of chunks) {
    if (chunk[0] === SerializeChunkKind.value) {
      throw createSerializeTypeError(
        SerializeErrorCode.invalidChunk,
        'cannot collect a value chunk into a stream'
      );
    }
    if (chunk[0] === SerializeChunkKind.bytes) sawBytes = true;
    collected.push(chunk);
  }
  if (collected.length === 0) return ['text', ''];
  if (!sawBytes) {
    // Joining once avoids repeatedly copying the accumulated string for a
    // long stream (which otherwise turns collection into quadratic work).
    return ['text', collected.map((chunk) => chunk[1] as string).join('')];
  }
  // core 无默认 Encoding adapter（R-4）：出现 bytes 需要合并时必须注入 encoder，不直接使用宿主 TextEncoder。
  const enc = encoder;
  if (enc === undefined) {
    throw createSerializeError(SerializeErrorCode.envUnsupported, 'TextEncoder is unavailable');
  }
  const parts = collected.map((chunk) =>
    chunk[0] === SerializeChunkKind.bytes ? chunk[1] : enc.encode(chunk[1] as string)
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
