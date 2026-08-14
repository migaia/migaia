/**
 * 结构化取消信号：只描述 `AbortSignal` 用到的那部分形状，不依赖 DOM lib.d.ts—— 这个包要在 Deno/Bun/小程序等不一定有全局 `AbortSignal`
 * 类型的运行时里可用。
 *
 * 故意在这里复制一份而不是从 `@migaia/web-rpc` 里借用同名类型：serialize 是 store-persist/store-ssr/store-worker 依赖的底层
 * codec 原语，web-rpc 是更上层的 传输库，反过来依赖它会把依赖方向倒过来，也会让只想用 codec、不碰 RPC 的消费方 在依赖图上被迫挂上整个 web-rpc 包。
 */
export type ISerializeAbortSignal = {
  readonly aborted: boolean;
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { readonly once?: boolean }
  ): void;
  removeEventListener(type: 'abort', listener: () => void): void;
  readonly throwIfAborted?: () => void;
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
  | readonly ['text', string]
  | readonly ['bytes', Uint8Array]
  | readonly ['value', unknown];

export type ISerializeChunkType = ISerializeChunk[0];

export type ISerializeContext = {
  /** 协作式取消。parser 若忽略它，框架仍会丢弃其结果并以 AbortError 结束。 */
  readonly signal: ISerializeAbortSignal;
  /** 出错时拼进消息，用来定位是哪个 store / 哪个 key 出的事。 */
  readonly source: string;
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
  /** 释放 parser 自己持有的资源（worker 端口、wasm 句柄等）。 */
  dispose?(): void;
};

/** 注册项。`type` 是写进信封的格式标签，读取时据此找回对应 parser——因此同一份 存档可以用旧格式读、用新格式写，格式迁移不需要清空用户数据。 */
export type ISerializePlugin = {
  readonly type: string;
  readonly parser: ISerializeParser;
};

export type ISerializePhase = 'encode' | 'decode';

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
    throw new RangeError(
      `[store] invalid serialize plugin type: ${JSON.stringify(type)}; expected ${String(SERIALIZE_TYPE_PATTERN)}`
    );
  }
}

/**
 * 判定一个值是「单段」还是「多段容器」。
 *
 * 二者都是数组，必须靠首元素消歧：单段的首元素是形态标签字符串，多段容器的首 元素是另一个分段（数组）。这里刻意只查 typeof 而不查标签是否合法——非法标签 要落到 assertChunk
 * 里报出精确原因，而不是在这里被误判成多段容器。
 */
export const isChunkShape = (value: unknown): value is ISerializeChunk =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string';

/** 携带定位信息的序列化异常。裸抛一个 SyntaxError 无法回答「哪个 store、哪种格式、 第几段、已经吃进去多少字节」——排查线上存档损坏时这几个数才是关键。 */
export class SerializeError extends Error {
  readonly type: string;
  readonly phase: ISerializePhase;
  readonly source: string;
  readonly chunkIndex: number;
  readonly bytesConsumed: number;

  constructor(
    message: string,
    details: {
      type: string;
      phase: ISerializePhase;
      source: string;
      chunkIndex: number;
      bytesConsumed: number;
      cause?: unknown;
    }
  ) {
    super(message, { cause: details.cause });
    this.name = 'SerializeError';
    this.type = details.type;
    this.phase = details.phase;
    this.source = details.source;
    this.chunkIndex = details.chunkIndex;
    this.bytesConsumed = details.bytesConsumed;
  }
}

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
      readonly source?: string;
    }
  ): Promise<ISerializeChunk>;
  decode(
    chunk: ISerializeChunk,
    options?: {
      readonly type?: string;
      readonly signal?: ISerializeAbortSignal;
      readonly source?: string;
    }
  ): Promise<unknown>;
  dispose(): void;
};
