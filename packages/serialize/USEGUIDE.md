# 使用手册

本文是 `@migaia/serialize` 的完整参考手册。先看 [README.md](./README.md#4-五分钟上手) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、5 分钟怎么跑起来"，本文讲"每一个类型、每一个 API、每一种边界行为"。

## 目录

1. [导入](#1-导入)
2. [Chunk 协议详解](#2-chunk-协议详解)
3. [Registry API 完整参考](#3-registry-api-完整参考)
4. [SerializeError 与错误场景](#4-serializeerror-与错误场景)
5. [chunkToText / chunkToBytes](#5-chunktotext--chunktobytes)
6. [Base64 编解码](#6-base64-编解码)
7. [流式序列化](#7-流式序列化)
8. [内置 json 插件](#8-内置-json-插件)
9. [编写自定义 parser / plugin](#9-编写自定义-parser--plugin)
10. [插件 type 的安全约束](#10-插件-type-的安全约束)
11. [完整组合示例](#11-完整组合示例)
12. [构建、测试与常见问题排查](#12-构建测试与常见问题排查)

---

## 1. 导入

```ts
import {
  createSerializeRegistry,
  chunkToText,
  chunkToBytes,
  isChunkShape,
  assertSerializeType,
  SERIALIZE_TYPE_PATTERN,
  SerializeError,
  bytesToBase64,
  base64ToBytes,
  streamBase64Chunks,
  encodeStream,
  decodeStream,
  collectStream,
  sliceByFrameBudget,
  jsonPlugin,
  jsonParser,
  type ISerializeChunk,
  type ISerializeChunkType,
  type ISerializeContext,
  type ISerializeOutput,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin,
  type ISerializeRegistry,
  type IEncodeStreamOptions,
  type IFrameBudgetOptions,
  type IJsonPluginOptions
} from '@migaia/serialize';
```

包只有一个导出入口（`.`），没有子路径导出——所有内置能力（包括 `jsonPlugin`）都从主入口拿。运行时依赖 `@migaia/web-rpc` 仅用于借用它的结构化 `IWebRpcAbortSignal` 类型（一个不依赖 DOM `AbortSignal` 具体实现、只要求 `aborted`/`addEventListener`/`removeEventListener`/可选 `throwIfAborted` 的接口），不引入任何浏览器专属绑定。

---

## 2. Chunk 协议详解

### 2.1 三种形态

```ts
type ISerializeChunk =
  | readonly ['text', string]
  | readonly ['bytes', Uint8Array]
  | readonly ['value', unknown];
```

| 形态 | 数据类型 | 典型用途 |
| --- | --- | --- |
| `text` | `string` | 落 localStorage、内联进 HTML、走只认字符串的通道 |
| `bytes` | `Uint8Array` | transfer 零拷贝、落 IndexedDB、喂 wasm |
| `value` | `unknown` | 已经是成品对象，不需要再编解码——"直通"型 parser（如 memory storage、测试桩）用它跳过无谓的编解码往返 |

`ISerializeChunkType` 是这个联合类型的首元素类型，即 `'text' | 'bytes' | 'value'`。

### 2.2 Parser 的输出可以是单段、Promise、或流

```ts
type ISerializeOutput =
  | ISerializeChunk
  | Promise<ISerializeChunk>
  | Iterable<ISerializeChunk>
  | AsyncIterable<ISerializeChunk>;

type ISerializeParser = {
  readonly name: string;
  encode(value: unknown, context: ISerializeContext): ISerializeOutput;
  decode(chunk: ISerializeChunk, context: ISerializeContext): unknown | Promise<unknown>;
  dispose?(): void | Promise<void>;
};
```

`encode()` 允许返回单段、`Promise<单段>`、同步可迭代对象、或异步可迭代对象——这是异步与流式能力的落点。一次输出里**允许混用形态**（比如先吐一段 `text` 头，再流式吐若干 `bytes` 体）。同步实现直接返回非 Promise 的单段即可，框架不会为纯同步路径额外制造微任务。

`registry.encode()` 内部会把 parser 的输出**收敛拼装**成一个最终 chunk，规则如下：

- 全是 `text` 段 → 直接拼字符串，省掉一次 UTF-8 转换往返
- 出现过 `bytes` 段（哪怕只有一段） → 把所有 `text` 段就地转成字节，整体按字节拼接
- 出现 `value` 段 → **必须独占这一次输出**；与其他任何段混用（不论顺序）都会抛 `SerializeError`，因为 value 已经是成品对象，没有可拼接的语义
- 输出为空（一段都没有） → 抛 `SerializeError`（"serialize produced no chunks"）

流式分支（`Iterable`/`AsyncIterable`）是边取边校验的：每一段拿到手就立刻做形状校验并累计 `chunkIndex`/`bytesConsumed`，这样中途失败时报出的段号和已消费字节数是真实进度，不是猜测值。

### 2.3 单段形状判定

```ts
const isChunkShape: (value: unknown) => value is ISerializeChunk;
```

判定一个值是「单段」还是「多段容器」——二者都是数组，必须靠首元素消歧：单段的首元素是形态标签字符串，多段容器的首元素是另一个分段（数组）。`isChunkShape` 刻意只查 `typeof value[0] === 'string'`，不校验标签是否是合法的三种之一——非法标签会在内部的 `assertChunk` 校验里报出精确原因（"unknown serialize chunk type"、"text chunk data must be a string" 等），而不是在这里被误判成多段容器。

### 2.4 Context

```ts
type ISerializeContext = {
  readonly signal: IWebRpcAbortSignal;
  readonly source: string;
};
```

每次 `encode`/`decode` 调用都会构造一份 context 传给 parser：`signal` 是协作式取消信号，parser 即使忽略它，框架仍会在检测到 `aborted` 时丢弃其结果并以 `SerializeError` 结束；`source` 是出错时拼进消息的定位标签，用来标出「哪个 store / 哪个 key」出的事，不传时默认为 `'anonymous'`。

---

## 3. Registry API 完整参考

```ts
function createSerializeRegistry(plugins: readonly ISerializePlugin[]): ISerializeRegistry;

type ISerializePlugin = { readonly type: string; readonly parser: ISerializeParser };

type ISerializeRegistry = {
  readonly primaryType: string;
  readonly types: readonly string[];
  has(type: string): boolean;
  encode(
    value: unknown,
    options?: { readonly type?: string; readonly signal?: AbortSignal; readonly source?: string }
  ): Promise<ISerializeChunk>;
  decode(
    chunk: ISerializeChunk,
    options?: { readonly type?: string; readonly signal?: AbortSignal; readonly source?: string }
  ): Promise<unknown>;
  dispose(options?: { readonly deadlineAt?: number }): Promise<void>;
};
```

| API | 参数 | 必填性 | 返回值 | 同步/异步 | 行为 |
| --- | --- | --- | --- | --- | --- |
| `createSerializeRegistry(plugins)` | `plugins: ISerializePlugin[]` | 至少 1 项，否则抛 `RangeError` | `ISerializeRegistry` | 同步 | 逐项校验 `type` 合法性（见 [§10](#10-插件-type-的安全约束)），`type` 重复抛 `RangeError` |
| `registry.primaryType` | — | 只读属性 | `string` | 同步 | `plugins[0].type`；`encode()`/`decode()` 不传 `type` 时的默认值 |
| `registry.types` | — | 只读属性 | `readonly string[]` | 同步 | 全部已注册的 `type`，顺序为注册顺序 |
| `registry.has(type)` | `type: string` | 必填 | `boolean` | 同步 | 是否已注册该 `type` |
| `registry.encode(value, options?)` | `value: unknown`；`options.type`/`.signal`/`.source` 均可选 | — | `Promise<ISerializeChunk>` | 异步 | 调对应 parser 的 `encode`，拼装多段输出，见 [§2.2](#22-parser-的输出可以是单段promise或流) |
| `registry.decode(chunk, options?)` | `chunk: ISerializeChunk`；options 同上 | — | `Promise<unknown>` | 异步 | 先校验 `chunk` 形状，再调对应 parser 的 `decode` |
| `registry.dispose(options?)` | `options.deadlineAt` 可选 | — | `Promise<void>` | 异步 | 见下方"释放语义" |

`encode`/`decode` 都不传 `type` 时使用 `primaryType`；传了但 registry 里没有注册这个 `type` 会抛 `SerializeError`（"no serialize plugin registered for type: ..."，`source` 固定为 `'registry'`）。

### 释放语义

`dispose()` 是异步的：先等所有在途 `encode`/`decode` 排空（可配 `deadlineAt` 上限），再把 registry 标成 disposed（后续任何 `encode`/`decode` 调用立即抛 `Error('[store] serialize registry is disposed')`），然后逐个调用已注册 parser 的 `dispose?()`——parser 的 `dispose` 可以是异步的，registry 会 `await`。每个 parser 的 `dispose()` 抛错都会被单独捕获，不会打断其余 parser 的释放（"释放失败反而造成泄漏"是要刻意避免的经典问题）；全部释放完成后，如果只有一个 parser 失败就直接重新抛出该错误，多个失败则聚合成 `AggregateError` 抛出。

---

## 4. SerializeError 与错误场景

```ts
class SerializeError extends Error {
  readonly type: string;
  readonly phase: 'encode' | 'decode';
  readonly source: string;
  readonly chunkIndex: number;
  readonly bytesConsumed: number;
}
```

裸抛一个 `SyntaxError`/`TypeError` 回答不了"哪个 store、哪种格式、第几段、已经吃进去多少字节"——排查线上存档损坏时这几个数才是关键，所以协议层的所有失败都统一成 `SerializeError`，原始错误挂在标准的 `error.cause` 上。

| 触发场景 | `phase` | `chunkIndex`/`bytesConsumed` 含义 |
| --- | --- | --- |
| `encode()` 时 parser 输出为空 | `encode` | 恒为 `0` |
| `encode()` 时某一段形状非法（如 `text` 段的 data 不是字符串） | `encode` | 出错时已收集的段数/字节数 |
| `encode()` 时 `value` 段与其他段混用 | `encode` | 出错段的下标 |
| `encode()` 时流式输出中途抛错 | `encode` | 出错时已收集的段数/字节数，原错误挂 `cause` |
| `encode()`/`decode()` 时 `signal` 已 aborted | 对应 phase | 已产生的进度值 |
| `decode()` 时传入的 `chunk` 形状非法 | `decode` | 恒为 `0` |
| `decode()` 时 parser 内部抛错 | `decode` | 该 chunk 的字节数，原错误挂 `cause` |
| `registry.encode`/`decode` 找不到指定 `type` | 对应 phase | 恒为 `0`，`source` 固定为 `'registry'` |
| `encodeStream()` 中某一片编码失败 | `encode` | `chunkIndex` 是**流里的第几片**（不是该次 encode 内部的段号），`bytesConsumed` 恒为 `0` |
| `decodeStream()` 中某一个 chunk 解码失败 | `decode` | `chunkIndex` 是**流里的第几个 chunk**，`bytesConsumed` 恒为 `0` |

`encodeStream`/`decodeStream` 内部捕获到单次 `registry.encode`/`decode` 抛出的 `SerializeError` 后，**不会直接透传**——那个内层错误的 `chunkIndex` 说的是"这一次 encode 内部的第几段"，恒为 0，会把"流里的第几片/第几个 chunk"这个真正有用的位置信息盖掉。所以会重新包一层新的 `SerializeError`，用流位置作为 `chunkIndex`，原始错误挂在 `cause` 上——排查时应该顺着 `cause` 链往下看真正的根因。

---

## 5. chunkToText / chunkToBytes

```ts
function chunkToText(chunk: ISerializeChunk): string;
function chunkToBytes(chunk: ISerializeChunk): Uint8Array;
```

把任意分段规约成某一种线材形态，供只认单一形态的载体使用：

| 函数 | 参数类型 | 同步/异步 | `text` 段 | `bytes` 段 | `value` 段 |
| --- | --- | --- | --- | --- | --- |
| `chunkToText` | `chunk: ISerializeChunk` | 同步 | 原样返回 | 用 `TextDecoder` 解码成字符串 | 抛 `TypeError('[store] a value chunk has no text form')` |
| `chunkToBytes` | `chunk: ISerializeChunk` | 同步 | 用 `TextEncoder` 编码成字节 | 返回 `.slice()`（拷贝，不是原数组的引用） | 抛 `TypeError('[store] a value chunk has no byte form')` |

`chunkToBytes` 对 `bytes` 段做了拷贝而不是直接返回原数组，调用方修改返回值不会影响 chunk 内部持有的数据。

---

## 6. Base64 编解码

```ts
function bytesToBase64(bytes: Uint8Array): string;
function base64ToBytes(text: string): Uint8Array;
function streamBase64Chunks(bytes: Uint8Array): Generator<string, void, void>;
```

在 localStorage、JSON API 等只能传文本的边界转换字节时使用。

### 为什么要分块

朴素实现——逐字节 `binary += String.fromCharCode(bytes[i])` 拼字符串，再对整个输入调一次 `btoa()`——会让一个 71MB 的 payload 同时在内存里held住原始 `Uint8Array`、一个 7100 万字符的中间二进制字符串、以及完整的 base64 输出，峰值内存是输入体积的好几倍，并且全程占着主线程——而这个 codec 存在的意义恰恰是处理大 payload。

`bytesToBase64`/`streamBase64Chunks` 内部按 `CHUNK_BYTES = 32763`（`0x7ffd` 向下取到 3 的倍数）分块处理：分块把中间二进制字符串和单次 `btoa()` 的工作量都限制在一块以内；最终只有拼接完的完整 base64 字符串仍然整份持有（`bytesToBase64` 面向的调用方——`persist.ts`/SSR 这类要「一个完整字符串」的场景——本来就需要这个结果）。

块大小必须是 3 的倍数：base64 把 3 字节编码成 4 字符，块边界如果不是 3 对齐，`btoa()` 会在块中间插入 `=` 补齐，导致第一个未对齐块之后的每一块都被破坏。`String.fromCharCode(...chunk)` 的展开参数个数也必须远低于引擎的单次调用参数上限（多数引擎约 65536），这是选定这个具体块大小的另一层原因。

| 函数 | 输入 | 输出 | 同步/异步 | 行为 |
| --- | --- | --- | --- | --- |
| `bytesToBase64(bytes)` | `Uint8Array` | `string` | 同步 | 内部分块处理后拼接成完整 base64 字符串一次返回 |
| `base64ToBytes(text)` | `string`（base64） | `Uint8Array` | 同步 | 用 `atob()` 解出二进制字符串，逐字符转回字节 |
| `streamBase64Chunks(bytes)` | `Uint8Array` | `Generator<string>` | 同步 | 与 `bytesToBase64` 相同的分块逻辑，但**逐块 yield 而不拼接**——真正的生成器，惰性消费不会提前算出未被请求的块；空输入不产出任何块（生成器本身不涉及 `Promise`/`await`，`next()` 同步返回） |

`streamBase64Chunks` 面向"写入一个 sink（`WritableStream`、分块上传）从不需要一次性拿到完整字符串"的调用方；如果最终就是想要一整个字符串（比如 JSON/localStorage 字段），直接用 `bytesToBase64`——自己拼接 `streamBase64Chunks` 的输出只是绕了一圈重新构造同一个字符串。

Base64 会让数据体积膨胀（约 4/3 倍）；IndexedDB/Worker 这类能直接传 `Uint8Array` 的通道应该优先走原生二进制，不经过 Base64。

---

## 7. 流式序列化

### 7.1 sliceByFrameBudget：按实测耗时自适应切片

```ts
type IFrameBudgetOptions = {
  readonly targetMs?: number;      // 默认 8
  readonly minItems?: number;      // 默认 64
  readonly maxItems?: number;      // 默认 250_000
  readonly initialItems?: number;  // 默认 2_048
  readonly yieldTo?: () => Promise<void>; // 默认 setTimeout(resolve, 0)
  readonly signal?: AbortSignal;
};

function sliceByFrameBudget<T>(
  items: readonly T[],
  options?: IFrameBudgetOptions
): AsyncGenerator<readonly T[], void, undefined>;
```

实测数据（100 万条数据编码进 worker）：整包一次性编码会连续占住主线程 237ms（约合掉 14 帧）；切成 5 万条一片、片间让出后，最长单次阻塞降到 14.2ms——压在 60fps 的 16.7ms 预算之内、一帧不掉，墙钟总耗时反而快了 37%。但切太碎同样有害：1 万条一片时最长阻塞只有 3.1ms，但 100 次让出的固定开销又把墙钟顶回了整包水平。

所以片大小不能按固定字节数写死，必须按**实测耗时**反推：生成器在 `yield` 之后挂起，消费者取下一片时才恢复，挂起与恢复之间的时差正好等于消费者处理这一片的真实耗时，据此调整下一片大小——`ratio = targetMs / max(elapsed, 0.05)`，新片大小取"当前值"与"按比例算出的目标值"的中点（阻尼调整，避免噪声下来回振荡），再钳制在 `[minItems, maxItems]` 之内。

| 选项 | 说明 |
| --- | --- |
| `targetMs` | 每片目标耗时，默认 8ms：60fps 一帧 16.7ms，留一半余量给渲染与其他任务，避免刚好卡在预算边缘时被别的工作顶出去 |
| `minItems` | 片大小下界，防止把开销摊成纯消息成本 |
| `maxItems` | 片大小上界，防止首片就把主线程占死 |
| `initialItems` | 首片大小；太大则第一片必然超预算，所以刻意保守 |
| `yieldTo` | 让出方式，默认 `setTimeout(0)`（浏览器里正是渲染一帧的位置），可换成 `scheduler.yield()`（更精确）或 `requestIdleCallback`（更保守） |
| `signal` | 每次取下一片前检查 `signal.throwIfAborted()` |

参数校验：`targetMs` 必须是有限正数（`NaN`/`Infinity` 都会被 `RangeError` 挡住）；`minItems`/`maxItems`/`initialItems` 必须是安全整数且 `>= 1`；`maxItems` 必须 `>= minItems`。这些校验是必要的——`NaN <= 0` 是 `false`，能穿过朴素的范围检查，而 `clamp(NaN, ...)` 仍是 `NaN`，`slice(0, NaN)` 得到空数组，循环下标永远不前进，`while` 永不结束；这类参数经常来自配置或远端下发，不能假定调用方给的一定是合法数字。

用法是 `for await (const slice of sliceByFrameBudget(rows))`，循环体里做实际工作——那段耗时会被自动量到，用来定下一片的大小。它是通用工具，不限于序列化场景，CSV 导出、批量 UI 处理等任何"大数组分片处理"的需求都能直接用。

### 7.2 encodeStream：编码成分段流，不做拼装

```ts
type IEncodeStreamOptions = IFrameBudgetOptions & {
  readonly type?: string;
  readonly source?: string;
  readonly maxInFlight?: number; // 默认 1
};

function encodeStream<T>(
  registry: ISerializeRegistry,
  items: readonly T[],
  options?: IEncodeStreamOptions
): AsyncGenerator<ISerializeChunk, void, undefined>;
```

与 `registry.encode()` 的区别：`registry.encode()` 会把所有分段合并成一整块返回，适合"最终要一个完整 blob"的场景；`encodeStream()` 面向落 IndexedDB、写文件、发 fetch body 这类能逐片消费的下游——拼装反而会白白制造一次全量大对象的峰值内存。

内部行为：用 `sliceByFrameBudget(items, options)` 切片，每片调用一次 `registry.encode(slice, { type, signal, source })`；`maxInFlight`（默认 1）控制**同时在途的编码请求数**，即背压——默认值意味着编好一片就等它被消费（`yield` 返回）后再编下一片，峰值内存只有一片；调高能让编码与下游消费重叠，代价是峰值内存同比增加。`maxInFlight` 必须是正整数，否则抛 `RangeError`（`NaN` 会让 `>= maxInFlight` 的判断恒为 `false`，背压彻底失效，在途请求无限堆积直到内存耗尽，因此这里的校验和 `sliceByFrameBudget` 一样是必要的）。

消费者提前 `break`/`throw` 导致生成器被 `return()` 时，尚未被认领的在途 Promise 会被统一 `.catch(() => undefined)` 接住，不会产生 unhandled rejection。

### 7.3 decodeStream：逐片解码，同样不做拼装

```ts
function decodeStream(
  registry: ISerializeRegistry,
  chunks: AsyncIterable<ISerializeChunk> | Iterable<ISerializeChunk>,
  options?: { readonly type?: string; readonly source?: string; readonly signal?: AbortSignal }
): AsyncGenerator<unknown, void, undefined>;
```

逐个 chunk 调用 `registry.decode()` 并 `yield` 结果；每次取下一个 chunk 前检查 `signal?.throwIfAborted()`。错误处理与 `encodeStream` 对称：内层 `SerializeError` 会被重新包装，`chunkIndex` 换成流位置（第几个 chunk），原错误挂 `cause`。

### 7.4 collectStream：把流合并回一个 chunk

```ts
function collectStream(chunks: AsyncIterable<ISerializeChunk>): Promise<ISerializeChunk>;
```

只在消费者确实需要完整 blob 时才用——它会把整份数据同时驻留在内存里，正是流式设计想要避免的那笔峰值。拼装规则与 [§2.2](#22-parser-的输出可以是单段promise或流) 描述的单次 `encode()` 拼装规则一致：全是 `text` → 拼接成一个字符串；出现过 `bytes` → 统一转成字节整体拼接；出现 `value` → 抛 `TypeError('[store] cannot collect a value chunk into a stream')`（协议流里不允许 value 段）；空流返回 `['text', '']`。全文本情况下用 `Array.join('')` 一次性拼接而不是逐段 `+=`，避免长流退化成二次方级别的字符串复制。

---

## 8. 内置 json 插件

```ts
type IJsonPluginOptions = {
  readonly replacer?: (key: string, value: unknown) => unknown;
  readonly reviver?: (key: string, value: unknown) => unknown;
  readonly space?: number;
};

function jsonParser(options?: IJsonPluginOptions): ISerializeParser; // name: 'json'
function jsonPlugin(options?: IJsonPluginOptions): ISerializePlugin; // type: 'json'
```

默认方案，也是实测下最快的一条：V8 的 JSON 是高度优化的 C++ 实现，在"需要拿到主线程上的对象图"这个前提下没有任何方案能赢它。只有当不需要对象图（比如字节直通场景）、或者格式本身不是 V8 能识别的 JSON 时，才该换别的 parser。

| 配置字段 | 类型 | 必填性 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `replacer` | `(key, value) => unknown` | 可选 | 无 | 传给 `JSON.stringify`，用于裁剪不可序列化字段 |
| `reviver` | `(key, value) => unknown` | 可选 | 无 | 传给 `JSON.parse`，用于还原 `Date` 之类的富类型 |
| `space` | `number` | 可选 | 无 | 缩进，仅调试用途——线上留空以免白白撑大体积 |

行为细节：

- `encode(value)` 返回 `['text', JSON.stringify(value, replacer, space)]`；`JSON.stringify` 结果是 `undefined`（如传入函数、`undefined` 本身）时抛 `TypeError('[store] json parser cannot serialize this value')`。
- `decode(chunk)` 对 `value` 段直接原样返回（不做 JSON 解析）；`text` 段直接 `JSON.parse`；`bytes` 段先用 `TextDecoder` 解码成字符串再 `JSON.parse`。
- `jsonPlugin(options)` 就是 `{ type: 'json', parser: jsonParser(options) }` 的简写，直接传给 `createSerializeRegistry([jsonPlugin()])` 使用。

---

## 9. 编写自定义 parser / plugin

任何符合 `ISerializeParser` 接口的对象都能注册进 registry：

```ts
import type { ISerializeChunk, ISerializeParser, ISerializePlugin } from '@migaia/serialize';

const cborParser: ISerializeParser = {
  name: 'cbor',
  encode(value): ISerializeChunk {
    return ['bytes', encodeCbor(value)]; // 你自己的 CBOR 编码实现
  },
  decode(chunk): unknown {
    if (chunk[0] === 'value') return chunk[1];
    const bytes = chunk[0] === 'bytes' ? chunk[1] : new TextEncoder().encode(chunk[1]);
    return decodeCbor(bytes);
  },
  dispose() {
    // 释放 parser 自己持有的资源（worker 端口、wasm 句柄等），可选
  }
};

const cborPlugin: ISerializePlugin = { type: 'cbor', parser: cborParser };
const registry = createSerializeRegistry([jsonPlugin(), cborPlugin]);
// primaryType 仍是 'json'（数组第一项）；显式传 { type: 'cbor' } 才会用到 cborPlugin
```

要点：

- `encode`/`decode` 拿到的第二个参数是 `ISerializeContext`（`{ signal, source }`），需要支持取消的 parser 应该在耗时操作中检查 `signal.aborted`；即使 parser 完全忽略它，registry 在拼装结果时仍会检测 `signal.aborted` 并以 `SerializeError` 结束。
- 想要流式产出（比如边编码边压缩）时，`encode()` 可以返回一个 `AsyncGenerator<ISerializeChunk>`，framework 会边取边校验形状。
- 需要持有资源的 parser（worker 端口、wasm 实例）实现可选的 `dispose()`（可返回 Promise），registry 的 `dispose()` 会在释放时 `await` 它。
- `type` 字符串会经过 `assertSerializeType` 校验，见下一节。

---

## 10. 插件 type 的安全约束

```ts
const SERIALIZE_TYPE_PATTERN: RegExp; // /^[a-z0-9][a-z0-9._-]{0,63}$/i
function assertSerializeType(type: string): void; // 不合法则抛 RangeError
```

插件 `type` 会被下游写入两类对转义敏感的位置：SSR 场景的 `data-codec="..."` HTML 属性，以及 persist 存档头 `MW1|<type>|<t|b>|` 这种以 `|` 分隔字段的信封格式。引号能闭合 HTML 属性、`>` 能闭合标签、`|` 能撕裂信封解析——而 `type` 往往来自第三方插件包，属于不可信输入。

所以 `createSerializeRegistry()` 在注册这一关就用 `SERIALIZE_TYPE_PATTERN` 收死，只放行字母、数字、`.`、`_`、`-` 组成、且以字母数字开头、长度 1–64 的字符串；不合法的 `type` 会在注册时立即抛 `RangeError`，而不是留到写入 HTML/存档头那一刻才出问题（写入点本身仍然应该做转义，`assertSerializeType` 是第二道防线，不是唯一防线）。自定义插件如果需要提前校验 `type` 是否合法（而不是等注册时才知道），可以直接调用 `assertSerializeType(type)`。

---

## 11. 完整组合示例

```ts
import {
  createSerializeRegistry,
  encodeStream,
  decodeStream,
  chunkToText,
  jsonPlugin,
  SerializeError
} from '@migaia/serialize';

// 1. 建一个只认 JSON 的 registry
const registry = createSerializeRegistry([jsonPlugin({ space: 0 })]);

// 2. 大数组分片编码，逐片写进某个 sink（这里用内存数组模拟）
const wire: unknown[] = [];
const controller = new AbortController();

try {
  for await (const chunk of encodeStream(registry, hugeArrayOfRows, {
    initialItems: 500,
    maxInFlight: 2,
    signal: controller.signal,
    source: 'export-rows'
  })) {
    wire.push(chunk); // 换成 port.postMessage(chunk) / writable.write(chunk) 等真实 sink
  }
} catch (error) {
  if (error instanceof SerializeError) {
    console.error(`导出在第 ${error.chunkIndex} 片失败：${error.message}`, { cause: error.cause });
  }
  throw error;
}

// 3. 接收端逐片解码
const restored: unknown[] = [];
for await (const rows of decodeStream(registry, wire as never, { source: 'export-rows' })) {
  restored.push(...(rows as unknown[]));
}

registry.dispose();
```

---

## 12. 构建、测试与常见问题排查

在仓库根目录运行以下包级门禁。`serialize` 的 `test` 脚本直接运行 Vitest；构建需单独运行。

```bash
pnpm --filter @migaia/serialize fmt
pnpm --filter @migaia/serialize lint
pnpm --filter @migaia/serialize typecheck
pnpm --filter @migaia/serialize typecheck:test
pnpm --filter @migaia/serialize build
pnpm --filter @migaia/serialize test
```

**Q：`encode()` 抛了 "a value chunk cannot be combined with other chunks"。**
你的自定义 parser 在一次 `encode()` 里既产出了 `['value', ...]` 段，又产出了 `text`/`bytes` 段（或多个 `value` 段）。`value` 段的语义是"已经是成品对象，无需再编解码"，它必须是这次输出里唯一的一段，见 [§2.2](#22-parser-的输出可以是单段promise或流)。

**Q：`chunkToText`/`chunkToBytes` 抛了 `TypeError`。**
传入的 chunk 是 `value` 形态。`value` 段没有文本/字节形式——它本来就不该被当作"线材"处理，直接使用 `chunk[1]` 里的成品对象即可。

**Q：`registry.encode()`/`decode()` 抛了 "no serialize plugin registered for type"。**
传入的 `options.type` 在这个 registry 里没有注册过对应插件。检查 `registry.types` 确认已注册的类型列表，或者在 `createSerializeRegistry([...])` 时把对应插件加进去。

**Q：`encodeStream`/`decodeStream` 报出的 `chunkIndex` 和内层错误的 `chunkIndex` 对不上。**
这是设计如此。外层 `SerializeError` 的 `chunkIndex` 是"流里的第几片/第几个 chunk"；内层挂在 `error.cause` 上的 `SerializeError`（如果原因本身也是一个 `SerializeError`）说的是"那一次 encode/decode 内部的第几段"，两者刻度不同，见 [§4](#4-serializeerror-与错误场景)。

**Q：大数据导出还是卡主线程。**
检查 `encodeStream`/`sliceByFrameBudget` 的 `yieldTo` 是否被覆盖成了同步函数，或者 `maxItems`/`initialItems` 是否设置得过大导致首片就超出预算太多——自适应算法需要几轮才能收敛到合适的片大小，极端参数会削弱这个自适应过程的效果。

**Q：`bytesToBase64` 输出比预期长很多。**
Base64 编码本身会让体积膨胀约 4/3 倍，这不是本包的开销，是编码格式的固有特性。如果下游通道能直接接受 `Uint8Array`（IndexedDB、Worker transfer），应该跳过 Base64 直接传二进制。
