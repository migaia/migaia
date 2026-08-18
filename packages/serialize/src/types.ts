/**
 * 结构化取消信号：只描述 `AbortSignal` 用到的那部分形状，不依赖 DOM lib.d.ts—— 这个包要在 Deno/Bun/小程序等不一定有全局 `AbortSignal`
 * 类型的运行时里可用。
 *
 * 故意在这里复制一份而不是从 `@migaia/web-rpc` 里借用同名类型：serialize 是 store-persist/store-ssr/store-worker 依赖的底层
 * codec 原语，web-rpc 是更上层的 传输库，反过来依赖它会把依赖方向倒过来，也会让只想用 codec、不碰 RPC 的消费方 在依赖图上被迫挂上整个 web-rpc 包。
 */
import {
  SERIALIZE_SOURCE,
  createSerializeRangeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText
} from './errors.js';
import type { ISerializeErrorCode } from './error-code.js';
import {
  SerializeChunkKind,
  SerializeCleanupKind,
  SerializeCleanupPolicy,
  SerializePhase
} from './format-constants.js';

export type ISerializeAbortSignal = {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { readonly once?: boolean }
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
};

/**
 * 序列化分段协议。
 *
 * 每一段都自带形态标签，框架据此决定怎么把多段拼成完整结果——所以一次输出里 允许混用形态（例如先吐一段 text 头、再流式吐若干 bytes 体）。这是异步与流式 能力的落点：parser
 * 可以返回单段、Promise、或异步可迭代对象。
 *
 * 三种形态各自的意义： text —— 字符串线材。落 localStorage、内联进 HTML 走这条。 bytes —— 字节线材。transfer 零拷贝、落 IndexedDB、喂
 * wasm 走这条。 value —— 已经是成品对象，不需要再解析。用于「直通」型 parser（例如 memory storage 或测试桩），避免为了走流程而做一次无谓的编解码往返。
 */
export type ISerializeChunk =
  | readonly [typeof SerializeChunkKind.text, string]
  | readonly [typeof SerializeChunkKind.bytes, Uint8Array]
  | readonly [typeof SerializeChunkKind.value, unknown];

export type ISerializeChunkType = ISerializeChunk[0];

export type ISerializeContext = {
  /** 协作式取消。parser 若忽略它，框架仍会丢弃其结果并以 AbortError 结束。 */
  readonly signal: ISerializeAbortSignal;
  /** 出错时拼进消息，用来定位是哪个 store / 哪个 key 出的事。 */
  readonly context: string;
};

export type ISerializeOutput =
  | ISerializeChunk
  | Promise<ISerializeChunk>
  | Iterable<ISerializeChunk>
  | AsyncIterable<ISerializeChunk>;

/** 一个具体的编解码实现。同步实现直接返回非 Promise 值即可——框架不会为同步路径 额外制造微任务。 */
export type ISerializeParser = {
  readonly name: string;
  encode(value: unknown, context: ISerializeContext): ISerializeOutput;
  decode(chunk: ISerializeChunk, context: ISerializeContext): unknown | Promise<unknown>;
  /** 释放 parser 自己持有的资源（worker 端口、wasm 句柄等）。异步释放时返回 Promise，框架会 await。 */
  dispose?(): void | Promise<void>;
};

/** 注册项。`type` 是写进信封的格式标签，读取时据此找回对应 parser——因此同一份 存档可以用旧格式读、用新格式写，格式迁移不需要清空用户数据。 */
export type ISerializePlugin = {
  readonly type: string;
  readonly parser: ISerializeParser;
};

export type ISerializePhase = (typeof SerializePhase)[keyof typeof SerializePhase];

/**
 * 插件 type 的合法字符集。
 *
 * 这个字符串会被写进两个对转义敏感的位置：SSR 的 `data-codec="..."` HTML 属性， 以及 persist 存档头 `MW1|<type>|<t|b>|`
 * 的分隔字段。引号能闭合属性、`>` 能闭合 标签、`|` 能撕裂信封解析——而 type 往往来自第三方插件包，属于不可信输入。
 *
 * 所以在注册这一关就收死，只放行 token 字符。写入点仍然做转义，两道防线。
 */
export const SERIALIZE_TYPE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function assertSerializeType(type: string): void {
  if (!SERIALIZE_TYPE_PATTERN.test(type)) {
    throw createSerializeRangeError(
      SerializeErrorCode.invalidOption,
      `invalid serialize plugin type: ${JSON.stringify(type)}; expected ${String(SERIALIZE_TYPE_PATTERN)}`
    );
  }
}

/**
 * 判定一个值是「单段」还是「多段容器」。
 *
 * 二者都是数组，必须靠首元素消歧：单段的首元素是形态标签字符串，多段容器的首 元素是另一个分段（数组）。这里刻意只查 typeof 而不查标签是否合法——非法标签 要落到
 * validateSerializeChunk 里报出精确原因，而不是在这里被误判成多段容器。
 */
export const isChunkShape = (value: unknown): value is ISerializeChunk =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string';

/**
 * Validate one chunk at a package boundary and retain its stream position in any failure. Registry
 * encoding and public stream collection share this validator so malformed tuples cannot escape as
 * raw property-access failures or be misreported as transport failures.
 */
export function validateSerializeChunk(
  candidate: unknown,
  details: {
    readonly type: string;
    readonly phase: ISerializePhase;
    readonly context: string;
    readonly chunkIndex: number;
    readonly bytesConsumed: number;
  }
): ISerializeChunk {
  const fail = (message: string): never => {
    throw new SerializeCodecError(message, {
      ...details,
      code: SerializeErrorCode.invalidChunk
    });
  };

  try {
    if (!Array.isArray(candidate) || candidate.length !== 2) {
      fail('serialize chunk must be a [type, data] pair');
    }
    const tuple = candidate as readonly [unknown, unknown];
    const kind = tuple[0];
    const data = tuple[1];
    if (kind === SerializeChunkKind.text) {
      if (typeof data !== 'string') fail('text chunk data must be a string');
      // Copy only the tuple container. Payload identity, including Uint8Array/value references,
      // remains unchanged while later consumers cannot reread a hostile tuple.
      return Object.freeze([kind, data]) as ISerializeChunk;
    }
    if (kind === SerializeChunkKind.bytes) {
      if (!(data instanceof Uint8Array)) {
        fail('bytes chunk data must be a Uint8Array');
      }
      return Object.freeze([kind, data]) as ISerializeChunk;
    }
    if (kind !== SerializeChunkKind.value) fail('unknown serialize chunk type');
    return Object.freeze([kind, data]) as ISerializeChunk;
  } catch (error) {
    if (error instanceof SerializeCodecError) throw error;
    throw new SerializeCodecError('serialize chunk validation failed', {
      ...details,
      code: SerializeErrorCode.invalidChunk,
      cause: error
    });
  }
}

/**
 * Encode/decode 错误（`CODEC_NOT_FOUND`/`ENCODE_FAILED`/`DECODE_FAILED`/`INVALID_CHUNK`/`ABORTED`）：携带
 * `type`/`phase`/`chunkIndex`/`bytesConsumed` 定位。构造/生命周期错误走 `createSerializeError`（tagged 原生
 * Error），不 new 本类。
 *
 * `TCode` 默认收紧为 serialize 登记码 `ISerializeErrorCode`；复用本类的上层包（如 store-worker）可传自己的码联合覆盖 `code`。
 */
export class SerializeCodecError<TCode extends string = ISerializeErrorCode> extends Error {
  readonly source: string;
  readonly code: TCode;
  readonly context?: string;
  readonly type: string;
  readonly phase: ISerializePhase;
  readonly chunkIndex: number;
  readonly bytesConsumed: number;
  // cause 继承自 Error（经 super(message, { cause }) 挂载，error.cause === 原对象）

  constructor(
    message: string,
    details: {
      code: TCode;
      type: string;
      phase: ISerializePhase;
      chunkIndex: number;
      bytesConsumed: number;
      context?: string;
      /** 覆盖 `source`（默认 `@migaia/serialize`）供复用本类的上层包标自己的 source。 */
      source?: string;
      cause?: unknown;
    }
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = 'SerializeCodecError';
    this.source = details.source ?? SERIALIZE_SOURCE;
    this.code = details.code;
    if (details.context !== undefined) this.context = details.context;
    this.type = details.type;
    this.phase = details.phase;
    this.chunkIndex = details.chunkIndex;
    this.bytesConsumed = details.bytesConsumed;
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
    readonly type: string;
    readonly phase: ISerializePhase;
    readonly context: string;
    readonly chunkIndex: number;
    readonly bytesConsumed: number;
  }
): Uint8Array {
  let encoded: unknown;
  try {
    encoded = encoder.encode(text);
  } catch (error) {
    throw new SerializeCodecError(
      `${SerializeErrorText.textEncodeFailed} at chunk ${details.chunkIndex}`,
      { ...details, code: SerializeErrorCode.encodeFailed, cause: error }
    );
  }
  if (encoded instanceof Uint8Array) return encoded;
  const invalidReturn =
    encoded === undefined
      ? createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeErrorText.textEncoderOutputInvalid
        )
      : encoded;
  throw new SerializeCodecError(
    `${SerializeErrorText.textEncoderOutputInvalid} at chunk ${details.chunkIndex}`,
    { ...details, code: SerializeErrorCode.invalidChunk, cause: invalidReturn }
  );
}

/** 结构化 Encoding API（`TextEncoder`/`TextDecoder` 鸭子类型），供 core/plugins/registry 注入使用。 */
export type ITextEncoder = { encode(input: string): Uint8Array };
export type ITextDecoder = { decode(input: Uint8Array): string };

/**
 * Serialize 的结构化 scheduler（`ILifecycleScheduler` 的结构子集，字段签名一致，不 import
 * lifecycle）。鸭子类型：`ILifecycleScheduler` 可赋值给它（T-18 兼容门禁）。
 */
export type ISerializeScheduler = {
  now(): number;
  schedule(callback: () => void, delayMs: number): { cancel(): void };
};

export type ISerializeRegistry = {
  /** 写入使用的格式：插件数组的第一项。 */
  readonly primaryType: string;
  readonly types: readonly string[];
  has(type: string): boolean;
  encode(
    value: unknown,
    options?: {
      readonly type?: string;
      readonly signal?: ISerializeAbortSignal;
      readonly context?: string;
    }
  ): Promise<ISerializeChunk>;
  decode(
    chunk: ISerializeChunk,
    options?: {
      readonly type?: string;
      readonly signal?: ISerializeAbortSignal;
      readonly context?: string;
    }
  ): Promise<unknown>;
  /** 同步：拒绝新请求并 abort 内部 closing controller；幂等；不调用 parser disposer。 */
  close(): void;
  /** 异步：隐含先 close()；等待在途结算或到达 deadlineAt 后同步释放 parser；幂等复用同一 promise，首次调用冻结 deadlineAt。 */
  dispose(options?: { readonly deadlineAt?: number }): Promise<void>;
};

export type ISerializeCleanupError = {
  readonly kind: typeof SerializeCleanupKind.cleanupError;
  readonly source: string;
  readonly error: unknown;
};

export type ISerializeTimeoutDiagnostic = {
  readonly kind: typeof SerializeCleanupKind.drainTimeout;
  readonly source: string;
  readonly deadlineAt?: number;
  readonly pendingCount?: number;
};

export type ISerializeRegistryOptions = {
  /** 默认 lifecycle `systemScheduler`；创建后不可更换（scheduler 时间域契约见 R-9，此处不重复解释）。 */
  readonly scheduler?: ISerializeScheduler;
  /** 省略时用宿主 `TextEncoder`（Encoding API，明确声明 host capability）；创建后不可更换。 */
  readonly encoder?: ITextEncoder;
  /** 省略时用宿主 `TextDecoder`（Encoding API，明确声明 host capability）；创建后不可更换。 */
  readonly decoder?: ITextDecoder;
  /** Cleanup error 出口（可选，默认 `{ policy: 'throw' }`；report 策略强制携带 reporter）。 */
  readonly cleanup?:
    | { readonly policy: typeof SerializeCleanupPolicy.throw }
    | {
        readonly policy: typeof SerializeCleanupPolicy.report;
        readonly report: (d: ISerializeCleanupError) => void;
      };
  /** Drain-timeout 观测（可选；与 cleanup error 边界分离）。 */
  readonly onDrainTimeout?: (d: ISerializeTimeoutDiagnostic) => void;
  /**
   * 通用 registry 二次/迟到错误 reporter（可选；不提供时用本 registry 的固定静态 no-op fallback）。 承载两类语义：① iterator
   * `return()` 的二次错误（active drain 期，`drainAsyncIterable` 上报）； ② deadline 后 detached task 的迟到
   * rejection（cleanup 后，`track` 上报，不重新接入 registry 生命周期）。 两类都不改变 primary rejection，也不改变 terminal。
   */
  readonly report?: (error: unknown) => void;
};
