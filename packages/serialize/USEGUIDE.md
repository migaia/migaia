# 使用手册

本文是 `@migaia/serialize` 的完整参考手册。先看 [README.md](./README.md) 的五分钟上手示例，跑起来之后再回来查这里的细节——README 讲"是什么、为什么用、5 分钟怎么跑起来"，本文讲"每一个类型、每一个 API、每一种边界行为"。

## 目录

1. [导入](#1-导入)
2. [Chunk 协议详解](#2-chunk-协议详解)
3. [Registry API 完整参考](#3-registry-api-完整参考)
4. [错误体系：SerializeCodecError 与 tagged 原生错误](#4-错误体系serializecodecerror-与-tagged-原生错误)
5. [chunkToText / chunkToBytes](#5-chunktotext--chunktobytes)
6. [Base64 编解码](#6-base64-编解码)
7. [流式序列化](#7-流式序列化)
8. [内置 json 插件](#8-内置-json-插件)
9. [编写自定义 parser / plugin](#9-编写自定义-parser--plugin)
10. [插件 type 的安全约束](#10-插件-type-的安全约束)
11. [子路径导出面：/core、/plugins、/registry](#11-子路径导出面corepluginsregistry)
12. [完整组合示例](#12-完整组合示例)
13. [构建、测试与常见问题排查](#13-构建测试与常见问题排查)

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
  SERIALIZE_SOURCE,
  SerializeCodecError,
  SerializeErrorCode,
  tagSerializeError,
  createSerializeError,
  createSerializeTypeError,
  createSerializeRangeError,
  bytesToBase64,
  base64ToBytes,
  streamBase64Chunks,
  encodeStream,
  decodeStream,
  collectStream,
  sliceByFrameBudget,
  jsonPlugin,
  jsonParser,
  SerializeChunkKind,
  SerializeOutput,
  SerializePhase,
  SerializeCleanupPolicy,
  SerializeCleanupKind,
  SerializePluginType,
  type ISerializeChunk,
  type ISerializeChunkType,
  type ISerializeContext,
  type ISerializeOutput,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin,
  type ISerializeRegistry,
  type ISerializeRegistryOptions,
  type ISerializeScheduler,
  type ISerializeCleanupError,
  type ISerializeTimeoutDiagnostic,
  type ISerializeErrorCode,
  type ISerializeTaggedError,
  type ISerializeTypeError,
  type ISerializeRangeError,
  type ISerializeLifecycleError,
  type ISerializeAbortSignal,
  type ITextEncoder,
  type ITextDecoder,
  type IEncodeStreamOptions,
  type IFrameBudgetOptions,
  type IJsonPluginOptions,
  type ISerializeChunkKind,
  type ISerializeOutputFormat,
  type ISerializeCleanupPolicy,
  type ISerializeCleanupKind,
  type ISerializePluginType
} from '@migaia/serialize';
```

包有四个导出入口：主入口 `.`（上面这份完整列表）、`./core`（静态复用 lifecycle abort leaf 的纯协议子集）、`./plugins`（内置 JSON 插件）、`./registry`（仅 registry 实现面）。四者的精确导出面见 [§11](#11-子路径导出面corepluginsregistry)。

运行时依赖 `@migaia/lifecycle` 的按需子路径（`/scheduler`、`/abort`、`/scope`、`/quiescence`）与 `@migaia/utils`（Base64/UTF-8 底层算法、`attachErrorIdentity` 错误身份标注）。registry 的 pending/drain、closing controller 与 parser scope 直接复用 lifecycle leaf；Serialize 仍只拥有 codec registry、stream、context 与自身错误投影。协作式取消信号类型 `ISerializeAbortSignal` 是包内独立定义的结构化类型（`{ aborted, reason?, addEventListener, removeEventListener }`），不依赖 DOM `AbortSignal`，但原生 `AbortSignal` 满足这个结构，可以直接传入。

---

## 2. Chunk 协议详解

### 2.1 三种形态

```ts
type ISerializeChunk =
  readonly ['text', string] | readonly ['bytes', Uint8Array] | readonly ['value', unknown];
```

| 形态    | 数据类型     | 典型用途                                                                                             |
| ------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| `text`  | `string`     | 落 localStorage、内联进 HTML、走只认字符串的通道                                                     |
| `bytes` | `Uint8Array` | transfer 零拷贝、落 IndexedDB、喂 wasm                                                               |
| `value` | `unknown`    | 已经是成品对象，不需要再编解码——"直通"型 parser（如 memory storage、测试桩）用它跳过无谓的编解码往返 |

`ISerializeChunkType` 是这个联合类型的首元素类型，即 `'text' | 'bytes' | 'value'`。三种标签值本身由 [`SerializeChunkKind`](#25-格式常量root-only) 常量定义（`SerializeChunkKind.text === 'text'` 等），只在主入口可拿到。

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

`registry.encode()` 内部会把 parser 的输出**收敛拼装**成一个最终 chunk（`collectChunks`），规则如下：

- 全是 `text` 段 → 直接拼字符串，省掉一次 UTF-8 转换往返
- 出现过 `bytes` 段（哪怕只有一段） → 把所有 `text` 段就地转成字节（用 registry 的 `encoder`，见 [§3.1](#31-createserializeregistry-与-iserializeregistryoptions)），整体按字节拼接
- 出现 `value` 段 → **必须独占这一次输出**；与其他任何段混用（不论先后顺序）都会抛 `SerializeCodecError`／`INVALID_CHUNK`（"a value chunk cannot be combined with other chunks"），因为 value 已经是成品对象，没有可拼接的语义
- 输出为空（一段都没有） → 抛 `SerializeCodecError`／`ENCODE_FAILED`（"serialize produced no chunks"）

流式分支（`Iterable`/`AsyncIterable`）是边取边校验的：每一段拿到手就立刻做形状校验并累计 `chunkIndex`/`bytesConsumed`，这样中途失败时报出的段号和已消费字节数是真实进度，不是猜测值；每一段被消费之前都会先检查 `signal.aborted`，命中则立即抛 `SerializeCodecError`／`ABORTED`。异步迭代器中途失败时框架会显式调用 `iterator.return()` 做清理，清理本身失败会作为 secondary 错误路由到 registry 的 `report` 回调，不覆盖主错误。

### 2.3 单段形状判定

```ts
const isChunkShape: (value: unknown) => value is ISerializeChunk;
```

判定一个值是「单段」还是「多段容器」——二者都是数组，必须靠首元素消歧：单段的首元素是形态标签字符串，多段容器的首元素是另一个分段（数组）。`isChunkShape` 刻意只查 `typeof value[0] === 'string'`，不校验标签是否是合法的三种之一——非法标签会在内部的形状校验里报出精确原因（"unknown serialize chunk type"、"text chunk data must be a string" 等，均为 `SerializeCodecError`／`INVALID_CHUNK`），而不是在这里被误判成多段容器。

### 2.4 Context

```ts
type ISerializeContext = {
  readonly signal: ISerializeAbortSignal;
  readonly context: string;
};
```

每次 `encode`/`decode` 调用都会构造一份 context 传给 parser：`signal` 是协作式取消信号，parser 即使忽略它，框架仍会在检测到 `aborted` 时丢弃其结果并以 `SerializeCodecError`／`ABORTED` 结束；`context` 是出错时拼进消息的定位标签，用来标出「哪个 store / 哪个 key」出的事，调用 `registry.encode`/`.decode` 时不传则默认为 `'anonymous'`。

> 注意字段名是 `context`，不是旧版本的 `source`——避免与错误对象的 `source`（固定为 `'@migaia/serialize'`）混淆。

<a id="25-格式常量root-only"></a>

### 2.5 格式常量（root-only）

```ts
const SerializeChunkKind: {
  readonly value: 'value';
  readonly text: 'text';
  readonly bytes: 'bytes';
};
const SerializeOutput: {
  readonly text: 'text';
  readonly structured: 'structured';
  readonly binary: 'binary';
};
const SerializePhase: { readonly encode: 'encode'; readonly decode: 'decode' };
const SerializeCleanupPolicy: { readonly throw: 'throw'; readonly report: 'report' };
const SerializeCleanupKind: {
  readonly cleanupError: 'cleanup-error';
  readonly drainTimeout: 'drain-timeout';
};
const SerializePluginType: { readonly json: 'json' };
```

这些是 `format-constants.ts` 里声明的现成常量对象，只从**主入口**导出（`/core` 不导出——它们不属于 core 的最小协议表面）：

| 常量                     | 取值                              | 用途                                                                      |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------------- |
| `SerializeChunkKind`     | `value` / `text` / `bytes`        | chunk 首元素标签，按标签分支处理 chunk 时用它而不是裸字符串字面量         |
| `SerializeOutput`        | `text` / `structured` / `binary`  | 更粗粒度的编解码输出表现形式分类，供上层适配器做能力协商                  |
| `SerializePhase`         | `encode` / `decode`               | 错误对象的 `phase` 字段取值                                               |
| `SerializeCleanupPolicy` | `throw` / `report`                | `createSerializeRegistry` 的 `cleanup.policy` 取值                        |
| `SerializeCleanupKind`   | `cleanup-error` / `drain-timeout` | `ISerializeCleanupError`/`ISerializeTimeoutDiagnostic` 的 `kind` 字段取值 |
| `SerializePluginType`    | `json`                            | 内置插件的 `type`/`name` 取值来源，避免各处手写字符串字面量               |

每个常量对象都配有一个同名（`I` 前缀）联合类型，例如 `ISerializeChunkKind = (typeof SerializeChunkKind)[keyof typeof SerializeChunkKind]`。用法：

```ts
if (chunk[0] === SerializeChunkKind.bytes) {
  /* ... */
}
```

无调用参数，都是现成的常量对象，不需要构造。

---

## 3. Registry API 完整参考

### 3.1 createSerializeRegistry 与 ISerializeRegistryOptions

```ts
function createSerializeRegistry(
  plugins: readonly ISerializePlugin[],
  options?: ISerializeRegistryOptions
): ISerializeRegistry;

type ISerializePlugin = { readonly type: string; readonly parser: ISerializeParser };

type ISerializeRegistryOptions = {
  readonly scheduler?: ISerializeScheduler;
  readonly encoder?: ITextEncoder;
  readonly decoder?: ITextDecoder;
  readonly cleanup?:
    | { readonly policy: 'throw' }
    | { readonly policy: 'report'; readonly report: (d: ISerializeCleanupError) => void };
  readonly onDrainTimeout?: (d: ISerializeTimeoutDiagnostic) => void;
  readonly report?: (error: unknown) => void;
};

type ISerializeScheduler = {
  now(): number;
  schedule(callback: () => void, delayMs: number): { cancel(): void };
};
```

`plugins`（必填）：

- 至少 1 项，空表抛 `RangeError`／`INVALID_OPTION`（"serialize registry needs at least one plugin"）
- 数组第一项的 `type` 就是 `primaryType`
- 每项的 `type` 必须匹配 `SERIALIZE_TYPE_PATTERN`（见 [§10](#10-插件-type-的安全约束)），非法字符抛 `RangeError`／`INVALID_OPTION`
- `parser` 必须提供 `encode`/`decode` 函数（`dispose` 可选但若提供必须是函数），否则抛 `TypeError`／`INVALID_OPTION`（"invalid serialize plugin at index N"，原始失败挂 `cause`）
- 重复 `type` 抛 `RangeError`／`INVALID_OPTION`（"duplicate serialize plugin type: ..."）
- 校验逐项进行且发生在任何 parser 被 registry 接管之前，因此校验失败不需要回滚任何已注册的 parser

`options`（全部可选）：

| 字段                              | 默认值                                   | 说明                                                                                                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheduler?: ISerializeScheduler` | `@migaia/lifecycle` 的 `systemScheduler` | 创建后不可更换；结构非法（缺 `now`/`schedule`，或 `now()` 不返回有限数字）抛 `TypeError`／`INVALID_OPTION`（"serialize scheduler must be { now, schedule }" 等）                                                                                                    |
| `encoder?: ITextEncoder`          | 宿主 `TextEncoder`                       | 用于把 `text` 段就地转成字节（多段拼装出现 `bytes` 时）；省略且宿主没有 `TextEncoder` → 构造期抛 `ENV_UNSUPPORTED`；提供了但形状不对（没有 `.encode` 方法）→ `TypeError`／`INVALID_OPTION`                                                                          |
| `decoder?: ITextDecoder`          | 宿主 `TextDecoder`                       | 目前构造期只做能力探测（供后续经该 registry 派生的 API 复用），同上校验规则                                                                                                                                                                                         |
| `cleanup?`                        | `{ policy: 'throw' }`                    | `{ policy: 'throw' }`：`dispose()` 时任一 parser `dispose()` 失败会并入 `dispose()` 的 reject（见 [§3.3](#33-释放语义详解)）；`{ policy: 'report'; report }`：转发给 `report`，不影响 `dispose()` 的正常结算；`report` 缺失或非函数抛 `TypeError`／`INVALID_OPTION` |
| `onDrainTimeout?: (d) => void`    | no-op                                    | `dispose({ deadlineAt })` 到期时仍有在途操作，触发一次诊断回调；回调抛错被吞掉（containment），不影响 `dispose()`                                                                                                                                                   |
| `report?: (error) => void`        | no-op                                    | 两类"迟到"错误的观测出口：① 操作已经因 abort 提前 settle，但底层 parser task 之后才真正 reject（detached 迟到 rejection，`cleanedUp` 之后到达）；② 流式 `encode`/`decode` 内部 async iterator 二次清理失败。两类都不改变已结算的 primary 结果                       |

非对象/非函数的 `options` 本身（例如传了一个 `null`）会抛 `TypeError`／`INVALID_OPTION`。

### 3.2 encode / decode / close / dispose

```ts
type ISerializeRegistry = {
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
  close(): void;
  dispose(options?: { readonly deadlineAt?: number }): Promise<void>;
};
```

| API                                | 参数                                                         | 返回值                     | 同步/异步 | 行为                                                                                       |
| ---------------------------------- | ------------------------------------------------------------ | -------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `registry.primaryType`             | —                                                            | `string`                   | 同步只读  | `plugins[0].type`；`encode()`/`decode()` 不传 `type` 时的默认值                            |
| `registry.types`                   | —                                                            | `readonly string[]`        | 同步只读  | 全部已注册的 `type`，顺序为注册顺序                                                        |
| `registry.has(type)`               | `type: string`                                               | `boolean`                  | 同步      | 是否已注册该 `type`                                                                        |
| `registry.encode(value, options?)` | `value: unknown`；`options.type`/`.signal`/`.context` 均可选 | `Promise<ISerializeChunk>` | 异步      | 调对应 parser 的 `encode`，拼装多段输出，见 [§2.2](#22-parser-的输出可以是单段promise或流) |
| `registry.decode(chunk, options?)` | `chunk: ISerializeChunk`；options 同上                       | `Promise<unknown>`         | 异步      | 先校验 `chunk` 形状，再调对应 parser 的 `decode`                                           |
| `registry.close()`                 | —                                                            | `void`                     | 同步      | 见下方"两阶段释放"                                                                         |
| `registry.dispose(options?)`       | `options.deadlineAt?: number`                                | `Promise<void>`            | 异步      | 见 [§3.3](#33-释放语义详解)                                                                |

`encode`/`decode` 的 `options`：

- `type?: string` —— 省略时用 `primaryType`；传了但 registry 里没有注册这个 `type` 会抛 `SerializeCodecError`／`CODEC_NOT_FOUND`（"no serialize plugin registered for type: ..."），`context` 字段固定为 `'registry'`（与调用方传入的 `context` 无关）
- `signal?: ISerializeAbortSignal` —— 与 registry 内部因 `close()`/`dispose()` 触发的关闭信号**复合**（first-observed-wins）：任一方先 abort，操作立即以 `SerializeCodecError`／`ABORTED` 结束，不等 parser 真正返回
- `context?: string` —— 省略时为 `'anonymous'`；出错时拼进消息，定位是哪个调用点

`registry.decode()` 的校验顺序：先检查 registry 是否已 `close()`/`dispose()`（是则抛 `REGISTRY_DISPOSED`，见下），再检查 `type` 是否已注册（否则 `CODEC_NOT_FOUND`），最后才校验 `chunk` 自身形状（否则 `INVALID_CHUNK`）——三者互斥，按此优先级依次判定。

registry 被 `close()`/`dispose()` 之后再调用 `encode`/`decode`：抛出的**不是** `SerializeCodecError`，而是一个 tagged 原生 `Error`（`createSerializeError(SerializeErrorCode.registryDisposed, 'serialize registry is disposed')`）——判断时用 `error.code === SerializeErrorCode.registryDisposed`，不要用 `instanceof SerializeCodecError`。

### 3.3 释放语义详解

`close()` 是**同步**的：切断新的 `encode`/`decode` 请求（后续调用立即抛 `REGISTRY_DISPOSED`），并 abort 内部的 closing 信号——这会让**当下正在进行中**的 `encode`/`decode` 也因信号复合而提前以 `ABORTED` 结束，不等 parser 真正返回。`close()` 幂等，且**不调用**任何 parser 的 `dispose()`。

`dispose(options?)` 是**异步**的，隐含先调用一次 `close()`，随后：

1. 等待所有在途 `encode`/`decode` 结算（因 `close()` 而被 abort 的操作会很快 reject）；若传了 `deadlineAt`（`scheduler.now()` 时间域下的绝对时间戳，必须是有限数字，否则整个 `dispose()` 立即以 `TypeError`／`INVALID_OPTION` reject），则改为在"排空"与"到达 deadline"之间赛跑；到达 deadline 时仍有未结算操作，会触发一次 `onDrainTimeout({ kind: 'drain-timeout', source: '@migaia/serialize', deadlineAt, pendingCount })` 回调，随后**不等它们**，直接进入下一步
2. 逐个释放已注册 parser（每个 parser 实例只释放一次，即使被多个 `type` 共用）；parser 的 `dispose()` 可以是异步的，registry 会 `await`
3. 按 `cleanup` 策略处理 parser 释放失败：`{ policy: 'throw' }`（默认）—— 若第 1 步没有先发生 deadline 相关失败，释放失败会直接成为 `dispose()` 的 reject 值；若已经有 deadline 相关的 primary 错误，释放失败会追加进该错误的 `errors` 数组（对象不可扩展时改用 `AggregateError` 包裹两者）。`{ policy: 'report'; report }`—— 释放失败改为调用 `report({ kind: 'cleanup-error', source: '@migaia/serialize', error })`，`dispose()` 本身仍正常 resolve
4. `dispose()` **幂等**：第二次及以后的调用直接返回第一次调用产生的同一个 Promise，`deadlineAt` 以首次调用为准冻结，之后的调用即使传了不同的 `deadlineAt` 也不生效

已经结算的操作若其底层 parser task 在 `cleanedUp` 之后才真正 settle（detached 迟到 rejection），该 rejection 会被 `report` 观测但不会改变任何已公开的结果或重新接入生命周期。

---

## 4. 错误体系：SerializeCodecError 与 tagged 原生错误

包内错误分两类：**编解码期失败**用专门的 `SerializeCodecError` 类（携带 `type`/`phase`/`chunkIndex`/`bytesConsumed` 定位字段）；**构造期/生命周期类失败**（`REGISTRY_DISPOSED`、`ENV_UNSUPPORTED`、参数校验、协作式取消等）不建自定义类，而是给原生 `Error`/`TypeError`/`RangeError` 打标签（`source`/`code`/`context?`），`instanceof Error`/`instanceof TypeError`/`instanceof RangeError` 照常成立。两类失败**统一用 `error.code` 判断**，不需要先判断是哪个类。

### 4.1 SerializeCodecError（编解码期失败）

```ts
class SerializeCodecError<TCode extends string = ISerializeErrorCode> extends Error {
  readonly source: string; // 默认 '@migaia/serialize'
  readonly code: TCode;
  readonly context?: string;
  readonly type: string;
  readonly phase: 'encode' | 'decode';
  readonly chunkIndex: number;
  readonly bytesConsumed: number;
  // cause 继承自 Error（经 super(message, { cause }) 挂载）
}
```

裸抛一个 `SyntaxError`/`TypeError` 回答不了"哪个 store、哪种格式、第几段、已经吃进去多少字节"——排查线上存档损坏时这几个数才是关键。`TCode` 默认收紧为本包登记的 `ISerializeErrorCode`；如果上层包（如 `store-worker`）想复用这个类但注册自己的错误码联合，可以显式传 `TCode` 类型参数覆盖 `code` 的类型，构造时也可传 `source` 覆盖默认的 `'@migaia/serialize'`。

`SerializeCodecError` 只在 `/core`（进而在主入口）导出，`/registry` 不单独导出它（不重复导出同一个类）。

### 4.2 SerializeErrorCode 全部取值

```ts
const SerializeErrorCode: {
  readonly registryDisposed: 'REGISTRY_DISPOSED';
  readonly codecNotFound: 'CODEC_NOT_FOUND';
  readonly encodeFailed: 'ENCODE_FAILED';
  readonly decodeFailed: 'DECODE_FAILED';
  readonly invalidChunk: 'INVALID_CHUNK';
  readonly aborted: 'ABORTED';
  readonly invalidOption: 'INVALID_OPTION';
  readonly envUnsupported: 'ENV_UNSUPPORTED';
};
type ISerializeErrorCode = (typeof SerializeErrorCode)[keyof typeof SerializeErrorCode];
```

| 码                  | 触发场景                                                                                                                                                     | 载体                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `REGISTRY_DISPOSED` | `registry.close()`/`.dispose()` 之后又调用 `encode`/`decode`                                                                                                 | tagged 原生 `Error`                                                        |
| `CODEC_NOT_FOUND`   | 请求的 `type` 没有对应注册 parser                                                                                                                            | `SerializeCodecError`                                                      |
| `ENCODE_FAILED`     | parser `encode` 抛错、流式编码中途失败、或产出为空                                                                                                           | `SerializeCodecError`（原始异常在 `cause`）                                |
| `DECODE_FAILED`     | parser `decode` 抛错、或流式解码中途失败                                                                                                                     | `SerializeCodecError`（原始异常在 `cause`）                                |
| `INVALID_CHUNK`     | chunk 形状非法（不是 `[type, data]` 对、text/bytes 数据类型错、未知形态标签、value 段被用于只接受线材的载体如 `chunkToText`/`chunkToBytes`/`collectStream`） | `SerializeCodecError` 或 tagged `TypeError`（视具体 API 而定，见各自小节） |
| `ABORTED`           | 编解码被协作式取消（`AbortSignal` 在 parser 返回前中止）                                                                                                     | `SerializeCodecError` 或 tagged 原生 `Error`（视具体调用栈而定）           |
| `INVALID_OPTION`    | 入参校验失败：非法插件 `type`、空插件表、重复插件 `type`、帧预算/`maxInFlight` 非法、`scheduler` 结构非法、`base64ToBytes` 输入非法等                        | tagged `TypeError`／`RangeError`                                           |
| `ENV_UNSUPPORTED`   | 环境能力缺失：构造 registry 或使用内置 JSON 插件时探测不到 `TextEncoder`/`TextDecoder`                                                                       | tagged 原生 `Error`（原始缺失原因在 `cause`，若有）                        |

码值是公开 API 的一部分，改名等同破坏性变更；抛出点内部统一引用 `SerializeErrorCode` 常量，不内联字符串字面量。

### 4.3 tagSerializeError / createSerializeError / createSerializeTypeError / createSerializeRangeError（构造期失败）

```ts
const SERIALIZE_SOURCE: '@migaia/serialize';

type ISerializeTaggedError<TError extends Error> = TError & {
  readonly source: string;
  readonly code: ISerializeErrorCode;
  readonly context?: string;
};
type ISerializeTypeError = ISerializeTaggedError<TypeError>;
type ISerializeRangeError = ISerializeTaggedError<RangeError>;
type ISerializeLifecycleError = ISerializeTaggedError<Error> & {
  readonly errors?: readonly unknown[];
};

function tagSerializeError<E extends Error>(
  error: E,
  code: ISerializeErrorCode,
  context?: string
): ISerializeTaggedError<E>;

function createSerializeError(
  code: ISerializeErrorCode,
  message: string,
  options?: {
    readonly cause?: unknown;
    readonly context?: string;
    readonly errors?: readonly unknown[];
  }
): ISerializeLifecycleError;

function createSerializeTypeError(
  code: ISerializeErrorCode,
  message: string,
  options?: { readonly cause?: unknown; readonly context?: string }
): ISerializeTypeError;

function createSerializeRangeError(
  code: ISerializeErrorCode,
  message: string,
  options?: { readonly cause?: unknown; readonly context?: string }
): ISerializeRangeError;
```

| 函数                        | 底层类型          | 典型场景                                                                                                                                                     |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createSerializeError`      | 原生 `Error`      | `REGISTRY_DISPOSED`、`ENV_UNSUPPORTED`、`ABORTED`（协作式取消）；可选 `errors` 是 rollback 完成后一次性创建的不可变快照（`Object.freeze`），为空则省略该字段 |
| `createSerializeTypeError`  | 原生 `TypeError`  | 参数结构非法（如 `scheduler` 不是 `{ now, schedule }`）、`base64ToBytes` 输入非法                                                                            |
| `createSerializeRangeError` | 原生 `RangeError` | 插件表为空/重复/`type` 不合法、帧预算参数越界                                                                                                                |
| `tagSerializeError`         | 任意 `Error` 子类 | 前三者的底层实现；也可直接用来给自定义错误打标签                                                                                                             |

`tagSerializeError` 的行为要点（只读附加字段，不重建、不替换、不覆盖 `stack`）：

- 未标记过的错误：调用 `attachErrorIdentity` 附加 `source: '@migaia/serialize'`、`code`，`context` 若提供则一并写入
- 已标记且 `(source, code)` 与本次调用一致：**幂等**直接返回；`context` 仅在原先未定义时补写一次
- 已标记但 `(source, code)` 不一致：抛 `TypeError`（"serialize error already tagged with a different (source, code): ..."）——不允许静默改写已标记的错误，避免二次 `Object.defineProperty` 因 `configurable: false` 抛错

`createSerializeError`/`createSerializeTypeError`/`createSerializeRangeError` 均支持 `options.cause`（挂到 `Error` 构造函数的标准 `cause` 上）与 `options.context`（定位字段）。这几个函数与 `SerializeCodecError` 一起构成本包**唯一**的错误制造入口，包内部不允许手写裸 `throw new Error(...)`（`docs/contracts/error-codes.md` 契约）。

### 4.4 错误场景速查表

| 触发场景                                                 | 错误载体                  | `code`              | 关键定位字段                                                                            |
| -------------------------------------------------------- | ------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `createSerializeRegistry([])`                            | `RangeError`              | `INVALID_OPTION`    | —                                                                                       |
| `createSerializeRegistry` 插件 `type` 重复/非法          | `RangeError`／`TypeError` | `INVALID_OPTION`    | —                                                                                       |
| `registry.close()`/`.dispose()` 之后调 `encode`/`decode` | 原生 `Error`              | `REGISTRY_DISPOSED` | —                                                                                       |
| `registry.encode`/`.decode` 传入未注册 `type`            | `SerializeCodecError`     | `CODEC_NOT_FOUND`   | `context` 固定为 `'registry'`                                                           |
| `encode()` 时 parser 输出为空                            | `SerializeCodecError`     | `ENCODE_FAILED`     | `chunkIndex`/`bytesConsumed` 恒为 `0`                                                   |
| `encode()` 时某一段形状非法                              | `SerializeCodecError`     | `INVALID_CHUNK`     | 出错时已收集的段数/字节数                                                               |
| `encode()` 时 `value` 段与其他段混用                     | `SerializeCodecError`     | `INVALID_CHUNK`     | 出错段的下标                                                                            |
| `encode()`/`decode()` 时组合 `signal` 已 abort           | `SerializeCodecError`     | `ABORTED`           | 已产生的进度值                                                                          |
| `decode()` 时传入的 `chunk` 形状非法                     | `SerializeCodecError`     | `INVALID_CHUNK`     | 恒为 `0`                                                                                |
| `decode()` 时 parser 内部抛错                            | `SerializeCodecError`     | `DECODE_FAILED`     | 该 chunk 的字节数，原错误挂 `cause`                                                     |
| `encodeStream()` 中某一片编码失败                        | `SerializeCodecError`     | `ENCODE_FAILED`     | `chunkIndex` 是**流里的第几片**（不是该次 encode 内部的段号），`bytesConsumed` 恒为 `0` |
| `decodeStream()` 中某一个 chunk 解码失败                 | `SerializeCodecError`     | `DECODE_FAILED`     | `chunkIndex` 是**流里的第几个 chunk**，`bytesConsumed` 恒为 `0`                         |
| `collectStream()` 收到 `value` 段                        | `SerializeCodecError`     | `INVALID_CHUNK`     | —                                                                                       |
| `collectStream()` 需要合并 `bytes` 但未传 `encoder`      | 原生 `Error`              | `ENV_UNSUPPORTED`   | —                                                                                       |
| `chunkToText`/`chunkToBytes` 传入 `value` 段             | `TypeError`               | `INVALID_CHUNK`     | —                                                                                       |
| `sliceByFrameBudget`/`encodeStream` 参数越界             | `RangeError`／`TypeError` | `INVALID_OPTION`    | —                                                                                       |
| `base64ToBytes` 输入非法                                 | `TypeError`               | `INVALID_OPTION`    | 不保留原始 `cause`                                                                      |
| `createSerializeRegistry`/JSON 插件探测不到 Encoding API | 原生 `Error`              | `ENV_UNSUPPORTED`   | 原始缺失原因（如有）在 `cause`                                                          |

`encodeStream`/`decodeStream` 内部捕获到单次 `registry.encode`/`decode` 抛出的 `SerializeCodecError` 后，**不会直接透传**——那个内层错误的 `chunkIndex` 说的是"这一次 encode/decode 内部的第几段"，恒为 0，会把"流里的第几片/第几个 chunk"这个真正有用的位置信息盖掉。所以会重新包一层新的 `SerializeCodecError`，用流位置作为 `chunkIndex`，原始错误挂在 `cause` 上——排查时应该顺着 `cause` 链往下看真正的根因。

---

## 5. chunkToText / chunkToBytes

```ts
function chunkToText(chunk: ISerializeChunk, decoder: ITextDecoder): string;
function chunkToBytes(chunk: ISerializeChunk, encoder: ITextEncoder): Uint8Array;
```

把任意分段规约成某一种线材形态，供只认单一形态的载体使用。两者都在 `registry.ts` 中实现，主入口与 `/registry` 均导出；`encoder`/`decoder` 都是**必填**参数——本包不假定宿主一定有 Encoding API，调用方需要显式传入 `new TextEncoder()`/`new TextDecoder()` 或等价的鸭子类型对象。

| 函数           | 参数                             | 同步/异步 | `text` 段                        | `bytes` 段                                | `value` 段                                                          |
| -------------- | -------------------------------- | --------- | -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `chunkToText`  | `chunk`, `decoder: ITextDecoder` | 同步      | 原样返回                         | 用 `decoder.decode()` 解码成字符串        | 抛 `TypeError`／`INVALID_CHUNK`（"a value chunk has no text form"） |
| `chunkToBytes` | `chunk`, `encoder: ITextEncoder` | 同步      | 用 `encoder.encode()` 编码成字节 | 返回 `.slice()`（拷贝，不是原数组的引用） | 抛 `TypeError`／`INVALID_CHUNK`（"a value chunk has no byte form"） |

`chunkToBytes` 对 `bytes` 段做了拷贝而不是直接返回原数组，调用方修改返回值不会影响 chunk 内部持有的数据。

```ts
const text = chunkToText(chunk, new TextDecoder());
const bytes = chunkToBytes(chunk, new TextEncoder());
```

---

## 6. Base64 编解码

```ts
function bytesToBase64(bytes: Uint8Array): string;
function base64ToBytes(text: string): Uint8Array;
function streamBase64Chunks(bytes: Uint8Array): Generator<string, void, void>;
```

在 localStorage、JSON API 等只能传文本的边界转换字节时使用。三者的核心分块算法委托给 `@migaia/utils/bytes` 的规范实现，本包只负责错误类型转换与块大小常量。

### 为什么要分块

朴素实现——逐字节 `binary += String.fromCharCode(bytes[i])` 拼字符串，再对整个输入调一次 `btoa()`——会让一个 71MB 的 payload 同时在内存里 held 住原始 `Uint8Array`、一个 7100 万字符的中间二进制字符串、以及完整的 base64 输出，峰值内存是输入体积的好几倍，并且全程占着主线程——而这个 codec 存在的意义恰恰是处理大 payload。

内部按 `CHUNK_BYTES = 32763`（`0x7ffd` 向下取到 3 的倍数）分块处理：分块把中间二进制字符串和单次 `btoa()` 的工作量都限制在一块以内；`bytesToBase64` 最终只有拼接完的完整 base64 字符串仍然整份持有（面向的调用方——`persist.ts`/SSR 这类要「一个完整字符串」的场景——本来就需要这个结果）。

块大小必须是 3 的倍数：base64 把 3 字节编码成 4 字符，块边界如果不是 3 对齐，`btoa()` 会在块中间插入 `=` 补齐，导致第一个未对齐块之后的每一块都被破坏。`String.fromCharCode(...chunk)` 的展开参数个数也必须远低于引擎的单次调用参数上限（多数引擎约 65536），这是选定这个具体块大小的另一层原因。

| 函数                        | 输入               | 输出                | 同步/异步 | 行为                                                                                                                                                                                      |
| --------------------------- | ------------------ | ------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bytesToBase64(bytes)`      | `Uint8Array`       | `string`            | 同步      | 内部分块处理后拼接成完整 base64 字符串一次返回                                                                                                                                            |
| `base64ToBytes(text)`       | `string`（base64） | `Uint8Array`        | 同步      | 解出二进制并转回字节；输入非法（不是合法 base64）时抛 `TypeError`／`INVALID_OPTION`（"invalid base64 input"）——**不保留**原始底层异常为 `cause`                                           |
| `streamBase64Chunks(bytes)` | `Uint8Array`       | `Generator<string>` | 同步      | 与 `bytesToBase64` 相同的分块逻辑，但**逐块 yield 而不拼接**——真正的生成器，惰性消费不会提前算出未被请求的块；空输入不产出任何块（生成器本身不涉及 `Promise`/`await`，`next()` 同步返回） |

`streamBase64Chunks` 面向"写入一个 sink（`WritableStream`、分块上传）从不需要一次性拿到完整字符串"的调用方；如果最终就是想要一整个字符串（比如 JSON/localStorage 字段），直接用 `bytesToBase64`——自己拼接 `streamBase64Chunks` 的输出只是绕了一圈重新构造同一个字符串。三个函数均**无可选项**，分块大小是内部实现细节，不对外暴露为参数。

Base64 会让数据体积膨胀（约 4/3 倍）；IndexedDB/Worker 这类能直接传 `Uint8Array` 的通道应该优先走原生二进制，不经过 Base64。

---

## 7. 流式序列化

### 7.1 sliceByFrameBudget：按实测耗时自适应切片

```ts
type IFrameBudgetOptions = {
  readonly targetMs?: number; // 默认 8
  readonly minItems?: number; // 默认 64
  readonly maxItems?: number; // 默认 250_000
  readonly initialItems?: number; // 默认 2_048
  readonly yieldTo?: () => Promise<void>;
  readonly signal?: ISerializeAbortSignal;
  readonly scheduler: ISerializeScheduler; // 必填
};

function sliceByFrameBudget<T>(
  items: readonly T[],
  options: IFrameBudgetOptions
): AsyncGenerator<readonly T[], void, undefined>;
```

> `options` 本身是**必填**参数，因为 `scheduler` 没有默认值——`/core` 不假定任何宿主全局 timer，一律经 `scheduler` 注入（`setTimeout`/`performance.now`/`Date.now` 都不会被直接调用）。主入口/`/registry` 场景下通常传 `@migaia/lifecycle` 的 `systemScheduler`。

实测数据（100 万条数据编码进 worker）：整包一次性编码会连续占住主线程 237ms（约合掉 14 帧）；切成 5 万条一片、片间让出后，最长单次阻塞降到 14.2ms——压在 60fps 的 16.7ms 预算之内、一帧不掉，墙钟总耗时反而快了 37%。但切太碎同样有害：1 万条一片时最长阻塞只有 3.1ms，但 100 次让出的固定开销又把墙钟顶回了整包水平。

所以片大小不能按固定字节数写死，必须按**实测耗时**反推：生成器在 `yield` 之后挂起，消费者取下一片时才恢复，挂起与恢复之间的时差正好等于消费者处理这一片的真实耗时，据此调整下一片大小——`ratio = targetMs / max(elapsed, 0.05)`，新片大小取"当前值"与"按比例算出的目标值"的中点（阻尼调整，避免噪声下来回振荡），再钳制在 `[minItems, maxItems]` 之内。

| 选项           | 说明                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `targetMs`     | 每片目标耗时，默认 8ms：60fps 一帧 16.7ms，留一半余量给渲染与其他任务，避免刚好卡在预算边缘时被别的工作顶出去                                                       |
| `minItems`     | 片大小下界，防止把开销摊成纯消息成本                                                                                                                                |
| `maxItems`     | 片大小上界，防止首片就把主线程占死                                                                                                                                  |
| `initialItems` | 首片大小；太大则第一片必然超预算，所以刻意保守                                                                                                                      |
| `yieldTo`      | 让出方式，省略时用 `scheduler.schedule(resolve, 0)`（内部自带信号感知，`signal` 在等待期间被 abort 会让这次让出立即以 `ABORTED` reject），可换成更精确/更保守的实现 |
| `signal`       | 每次取下一片前检查是否已 abort；命中则抛 `ABORTED`（原生 `Error`，非 `SerializeCodecError`）                                                                        |
| `scheduler`    | **必填**；`now()` 必须返回有限数字，`schedule(cb, delayMs)` 必须返回带 `cancel()` 的任务句柄，否则抛 `TypeError`／`INVALID_OPTION`                                  |

参数校验：`targetMs` 必须是有限正数（`NaN`/`Infinity` 都会被 `RangeError`／`INVALID_OPTION` 挡住）；`minItems`/`maxItems`/`initialItems` 必须是安全整数且 `>= 1`；`maxItems` 必须 `>= minItems`。这些校验是必要的——`NaN <= 0` 是 `false`，能穿过朴素的范围检查，而 `clamp(NaN, ...)` 仍是 `NaN`，`slice(0, NaN)` 得到空数组，循环下标永远不前进，`while` 永不结束；这类参数经常来自配置或远端下发，不能假定调用方给的一定是合法数字。

用法是 `for await (const slice of sliceByFrameBudget(rows, { scheduler }))`，循环体里做实际工作——那段耗时会被自动量到，用来定下一片的大小。它是通用工具，不限于序列化场景，CSV 导出、批量 UI 处理等任何"大数组分片处理"的需求都能直接用。

### 7.2 encodeStream：编码成分段流，不做拼装

```ts
type IEncodeStreamOptions = IFrameBudgetOptions & {
  readonly type?: string;
  readonly context?: string; // 默认 'stream'
  readonly maxInFlight?: number; // 默认 1
};

function encodeStream<T>(
  registry: ISerializeRegistry,
  items: readonly T[],
  options: IEncodeStreamOptions
): AsyncGenerator<ISerializeChunk, void, undefined>;
```

`options`（含继承自 `IFrameBudgetOptions` 的 `scheduler`）同样是**必填**参数。与 `registry.encode()` 的区别：`registry.encode()` 会把所有分段合并成一整块返回，适合"最终要一个完整 blob"的场景；`encodeStream()` 面向落 IndexedDB、写文件、发 fetch body 这类能逐片消费的下游——拼装反而会白白制造一次全量大对象的峰值内存。

内部行为：用 `sliceByFrameBudget(items, options)` 切片，每片调用一次 `registry.encode(slice, { type, signal, context })`（`context` 默认 `'stream'`）；`maxInFlight`（默认 1）控制**同时在途的编码请求数**，即背压——默认值意味着编好一片就等它被消费（`yield` 返回）后再编下一片，峰值内存只有一片；调高能让编码与下游消费重叠，代价是峰值内存同比增加。`maxInFlight` 必须是正整数，否则抛 `RangeError`／`INVALID_OPTION`（`NaN` 会让 `>= maxInFlight` 的判断恒为 `false`，背压彻底失效，在途请求无限堆积直到内存耗尽，因此这里的校验和 `sliceByFrameBudget` 一样是必要的）。

单片编码失败会被重新包装为 `SerializeCodecError`／`ENCODE_FAILED`（消息 `encode stream failed at slice N: ...`，`chunkIndex` 是**流里的第几片**，`bytesConsumed` 恒为 `0`，原始错误挂 `cause`）——见 [§4.4](#44-错误场景速查表)。消费者提前 `break`/`throw` 导致生成器被 `return()` 时，尚未被认领的在途 Promise 会被统一 `.catch(() => undefined)` 接住，不会产生 unhandled rejection。

### 7.3 decodeStream：逐片解码，同样不做拼装

```ts
function decodeStream(
  registry: ISerializeRegistry,
  chunks: AsyncIterable<ISerializeChunk> | Iterable<ISerializeChunk>,
  options?: {
    readonly type?: string;
    readonly context?: string;
    readonly signal?: ISerializeAbortSignal;
  }
): AsyncGenerator<unknown, void, undefined>;
```

`options` 可选（默认 `{}`），`context` 默认 `'stream'`。逐个 chunk 调用 `registry.decode()` 并 `yield` 结果；每次取下一个 chunk 前检查 `signal?.aborted`，命中则抛 `ABORTED`。错误处理与 `encodeStream` 对称：单个 chunk 解码失败会被重新包装为 `SerializeCodecError`／`DECODE_FAILED`（消息 `decode stream failed at chunk N: ...`，`chunkIndex` 是**流里的第几个 chunk**，`bytesConsumed` 恒为 `0`，原错误挂 `cause`）。

### 7.4 collectStream：把流合并回一个 chunk

```ts
function collectStream(
  chunks: AsyncIterable<ISerializeChunk> | Iterable<ISerializeChunk>,
  encoder?: ITextEncoder
): Promise<ISerializeChunk>;
```

只在消费者确实需要完整 blob 时才用——它会把整份数据同时驻留在内存里，正是流式设计想要避免的那笔峰值。`encoder` 参数只在合并结果里出现过 `bytes` 段（需要把 `text` 段就地转成字节）时才用得到；如果流里始终只有 `text` 段，`encoder` 可以省略。

拼装规则与 [§2.2](#22-parser-的输出可以是单段promise或流) 描述的单次 `encode()` 拼装规则一致：

- 全是 `text` → 用 `Array.join('')` 一次性拼接成一个字符串（而不是逐段 `+=`，避免长流退化成二次方级别的字符串复制）
- 出现过 `bytes` → 需要把 `text` 段就地转成字节整体拼接，此时若未提供 `encoder` 会抛原生 `Error`／`ENV_UNSUPPORTED`（"TextEncoder is unavailable"）——`/core` 不假定宿主一定有 `TextEncoder`
- 出现 `value` → 抛 `SerializeCodecError`／`INVALID_CHUNK`（"cannot collect a value chunk into a stream"，协议流里不允许 value 段）
- 空流 → 返回 `['text', '']`

流中每个 chunk 在被并入结果前都会先经过与 `registry.encode()` 相同的形状校验（`isChunkShape`/`validateSerializeChunk`），非法形状同样抛 `SerializeCodecError`／`INVALID_CHUNK`，并保留流位置（`chunkIndex`）与累计的 `bytesConsumed`。校验之外的其他迭代失败（如源迭代器本身抛错）会被包装为 `SerializeCodecError`／`ENCODE_FAILED`（消息 `collect stream failed at chunk N: ...`）。

```ts
const stream = encodeStream(registry, hugeArrayOfRows, {
  initialItems: 500,
  maxInFlight: 2,
  scheduler
});
const chunk = await collectStream(stream, new TextEncoder()); // 只在流里可能出现 bytes 段时才需要传 encoder
```

---

## 8. 内置 json 插件

```ts
type IJsonPluginOptions = {
  readonly replacer?: (key: string, value: unknown) => unknown;
  readonly reviver?: (key: string, value: unknown) => unknown;
  readonly space?: number;
  readonly decoder?: ITextDecoder;
};

function jsonParser(options?: IJsonPluginOptions): ISerializeParser; // name: 'json'
function jsonPlugin(options?: IJsonPluginOptions): ISerializePlugin; // type: 'json'
```

默认方案，也是实测下最快的一条：V8 的 JSON 是高度优化的 C++ 实现，在"需要拿到主线程上的对象图"这个前提下没有任何方案能赢它。只有当不需要对象图（比如字节直通场景）、或者格式本身不是 V8 能识别的 JSON 时，才该换别的 parser。

| 配置字段   | 类型                      | 必填性 | 默认值             | 说明                                                                                                   |
| ---------- | ------------------------- | ------ | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `replacer` | `(key, value) => unknown` | 可选   | 无                 | 传给 `JSON.stringify`，用于裁剪不可序列化字段                                                          |
| `reviver`  | `(key, value) => unknown` | 可选   | 无                 | 传给 `JSON.parse`，用于还原 `Date` 之类的富类型                                                        |
| `space`    | `number`                  | 可选   | 无                 | 缩进，仅调试用途——线上留空以免白白撑大体积                                                             |
| `decoder`  | `ITextDecoder`            | 可选   | 宿主 `TextDecoder` | 解码 `bytes` 段时用；省略且宿主没有 `TextDecoder` 时，`decode()` 遇到 `bytes` 段会抛 `ENV_UNSUPPORTED` |

行为细节：

- `encode(value)` 返回 `['text', JSON.stringify(value, replacer, space)]`；`JSON.stringify` 结果是 `undefined`（如传入函数、`undefined` 本身）时抛 `TypeError`／`ENCODE_FAILED`（"json parser cannot serialize this value"）
- `decode(chunk)` 对 `value` 段直接原样返回（不做 JSON 解析）；`text` 段直接 `JSON.parse(chunk[1], reviver)`；`bytes` 段先用 `decoder ?? 宿主 TextDecoder` 解码成字符串再 `JSON.parse`，两者都不可用时抛原生 `Error`／`ENV_UNSUPPORTED`（"TextDecoder is unavailable"）
- `jsonPlugin(options)` 就是 `{ type: 'json', parser: jsonParser(options) }` 的简写，`type`/`name` 均取自 `SerializePluginType.json`（即 `'json'`），直接传给 `createSerializeRegistry([jsonPlugin()])` 使用

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

- `encode`/`decode` 拿到的第二个参数是 `ISerializeContext`（`{ signal, context }`），需要支持取消的 parser 应该在耗时操作中检查 `signal.aborted`；即使 parser 完全忽略它，registry 在拼装结果时仍会检测 `signal.aborted` 并以 `SerializeCodecError`／`ABORTED` 结束
- 想要流式产出（比如边编码边压缩）时，`encode()` 可以返回一个 `AsyncGenerator<ISerializeChunk>`，框架会边取边校验形状
- 需要持有资源的 parser（worker 端口、wasm 实例）实现可选的 `dispose()`（可返回 Promise），registry 的 `dispose()` 会在释放时 `await` 它；`dispose()` 失败按 registry 构造时的 `cleanup` 策略处理（见 [§3.3](#33-释放语义详解)）
- `type` 字符串会经过 `assertSerializeType` 校验，见下一节
- 同一个 `parser` 对象可以被多个 `type` 共用；`dispose()` 只会对每个唯一的 parser 实例调用一次

---

## 10. 插件 type 的安全约束

```ts
const SERIALIZE_TYPE_PATTERN: RegExp; // /^[a-z0-9][a-z0-9._-]{0,63}$/i
function assertSerializeType(type: string): void; // 不合法则抛 RangeError／INVALID_OPTION
```

插件 `type` 会被下游写入两类对转义敏感的位置：SSR 场景的 `data-codec="..."` HTML 属性，以及 persist 存档头 `MW1|<type>|<t|b>|` 这种以 `|` 分隔字段的信封格式。引号能闭合 HTML 属性、`>` 能闭合标签、`|` 能撕裂信封解析——而 `type` 往往来自第三方插件包，属于不可信输入。

所以 `createSerializeRegistry()` 在注册这一关就用 `SERIALIZE_TYPE_PATTERN` 收死，只放行字母、数字、`.`、`_`、`-` 组成、且以字母数字开头、长度 1–64 的字符串；不合法的 `type` 会在注册时立即抛 `RangeError`／`INVALID_OPTION`（"invalid serialize plugin type: ...; expected /^[a-z0-9][a-z0-9._-]{0,63}$/i"），而不是留到写入 HTML/存档头那一刻才出问题（写入点本身仍然应该做转义，`assertSerializeType` 是第二道防线，不是唯一防线）。自定义插件如果需要提前校验 `type` 是否合法（而不是等注册时才知道），可以直接调用 `assertSerializeType(type)`。

```ts
SERIALIZE_TYPE_PATTERN.test('cbor-v2'); // true
assertSerializeType('bad type!'); // 抛 RangeError／INVALID_OPTION
```

---

## 11. 子路径导出面：/core、/plugins、/registry

### 11.1 `/core`

```ts
import {
  SERIALIZE_TYPE_PATTERN,
  SerializeCodecError,
  assertSerializeType,
  isChunkShape,
  SERIALIZE_SOURCE,
  SerializeErrorCode,
  tagSerializeError,
  createSerializeError,
  createSerializeTypeError,
  createSerializeRangeError,
  base64ToBytes,
  bytesToBase64,
  streamBase64Chunks,
  collectStream,
  decodeStream,
  encodeStream,
  sliceByFrameBudget,
  type ISerializeAbortSignal,
  type ISerializeChunk,
  type ISerializeChunkType,
  type ISerializeContext,
  type ISerializeOutput,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin,
  type ISerializeRegistry,
  type ISerializeScheduler,
  type ITextDecoder,
  type ITextEncoder,
  type ISerializeErrorCode,
  type ISerializeTaggedError,
  type ISerializeTypeError,
  type ISerializeRangeError,
  type ISerializeLifecycleError,
  type IEncodeStreamOptions,
  type IFrameBudgetOptions
} from '@migaia/serialize/core';
```

Core 静态复用 `@migaia/lifecycle/abort` 作为唯一取消 owner；packed consumer 可保留 abort leaf 的必要闭包，但必须排除 lifecycle root、scope、scheduler、generation、quiescence 与 disposal。Core 不假定宿主全局 timer，timer 一律经 `scheduler` 注入、Encoding 一律经 `ITextEncoder`/`ITextDecoder` 注入（这也是为什么 `sliceByFrameBudget`/`encodeStream` 的 `options.scheduler`、`collectStream` 需要 `bytes` 段合并时的 `encoder` 都是必填/条件必填的）。**不包含**：

- `createSerializeRegistry`（依赖 `@migaia/lifecycle`，只在主入口/`/registry` 提供）
- `chunkToText`/`chunkToBytes`（同样定义在 `registry.ts`，只在主入口/`/registry` 提供）
- 内置 JSON 插件（只在主入口/`/plugins` 提供）
- 格式常量 `SerializeChunkKind` 等（只在主入口提供，见 [§2.5](#25-格式常量root-only)）

其余每个导出的完整选项、行为、错误码与主入口同一份实现完全一致，见上文各节。适合只需要 chunk 协议 + Base64 + 流式切片、只依赖 lifecycle abort leaf 的场景（例如纯算法层的 CBOR/MessagePack parser 包）。

### 11.2 `/plugins`

```ts
import { jsonParser, jsonPlugin, type IJsonPluginOptions } from '@migaia/serialize/plugins';
```

零包依赖；只导出内置 JSON 插件（`jsonParser`/`jsonPlugin`/`IJsonPluginOptions`），完整参数见 [§8](#8-内置-json-插件)。

### 11.3 `/registry`

```ts
import {
  createSerializeRegistry,
  chunkToText,
  chunkToBytes,
  type ISerializeAbortSignal,
  type ISerializeChunk,
  type ISerializeCleanupError,
  type ISerializeContext,
  type ISerializeParser,
  type ISerializePhase,
  type ISerializePlugin,
  type ISerializeRegistry,
  type ISerializeRegistryOptions,
  type ISerializeScheduler,
  type ISerializeTimeoutDiagnostic,
  type ITextDecoder,
  type ITextEncoder
} from '@migaia/serialize/registry';
```

只导出 registry 实现面（`createSerializeRegistry`、`chunkToText`、`chunkToBytes`）与相关类型，**不含** chunk 协议基础设施（`isChunkShape`/`SerializeCodecError` 构造工具等）、Base64、流式切片或 JSON 插件——需要那些能力时从主入口或 `/core` 导入。完整参数见 [§3](#3-registry-api-完整参考) 与 [§5](#5-chunktotext--chunktobytes)。

---

## 12. 完整组合示例

```ts
import {
  createSerializeRegistry,
  encodeStream,
  decodeStream,
  jsonPlugin,
  SerializeCodecError
} from '@migaia/serialize';
import { systemScheduler } from '@migaia/lifecycle';

// 1. 建一个只认 JSON 的 registry
const registry = createSerializeRegistry([jsonPlugin({ space: 0 })]);

// 2. 大数组分片编码，逐片写进某个 sink（这里用内存数组模拟）
const wire: unknown[] = [];
const controller = new AbortController();

try {
  for await (const chunk of encodeStream(registry, hugeArrayOfRows, {
    initialItems: 500,
    maxInFlight: 2,
    signal: controller.signal as never,
    context: 'export-rows',
    scheduler: systemScheduler
  })) {
    wire.push(chunk); // 换成 port.postMessage(chunk) / writable.write(chunk) 等真实 sink
  }
} catch (error) {
  if (error instanceof SerializeCodecError) {
    console.error(`导出在第 ${error.chunkIndex} 片失败：${error.message}`, { cause: error.cause });
  }
  throw error;
}

// 3. 接收端逐片解码
const restored: unknown[] = [];
for await (const rows of decodeStream(registry, wire as never, { context: 'export-rows' })) {
  restored.push(...(rows as unknown[]));
}

// 4. 应用退出前：最多等待 500ms 排空在途操作，超时也强制释放 parser（不会永久挂起）
await registry.dispose({ deadlineAt: Date.now() + 500 });
```

多格式共存（新旧存档平滑迁移）：

```ts
import { createSerializeRegistry, jsonPlugin, type ISerializeChunk } from '@migaia/serialize';

// 数组第一项 (jsonPlugin) 是 primaryType，写入永远用它；legacyPlugin 只用于读旧存档。
const registry = createSerializeRegistry([jsonPlugin(), legacyPlugin]);

async function load(record: { type: string; chunk: ISerializeChunk }) {
  return registry.decode(record.chunk, { type: record.type }); // 按存档记录的 type 找回对应 parser
}

async function save(value: unknown) {
  const chunk = await registry.encode(value); // 不传 type，永远用 primaryType（新格式）写入
  return { type: registry.primaryType, chunk };
}
```

---

## 13. 构建、测试与常见问题排查

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

**Q：`chunkToText`/`chunkToBytes` 抛了 `TypeError`，`code` 是 `INVALID_CHUNK`。**
传入的 chunk 是 `value` 形态。`value` 段没有文本/字节形式——它本来就不该被当作"线材"处理，直接使用 `chunk[1]` 里的成品对象即可。

**Q：`registry.encode()`/`decode()` 抛了 `code: 'CODEC_NOT_FOUND'`。**
传入的 `options.type` 在这个 registry 里没有注册过对应插件。检查 `registry.types` 确认已注册的类型列表，或者在 `createSerializeRegistry([...])` 时把对应插件加进去。

**Q：调用 `encode`/`decode` 抛了 `code: 'REGISTRY_DISPOSED'`，但我没主动调用过 `dispose()`。**
检查是否有别处调用了 `registry.close()`（同步、只切断新请求并 abort 在途操作，不释放 parser）或 `registry.dispose()`。`close()`/`dispose()` 都是幂等的，调用后 registry 永久不可再用，需要新建一个 registry 实例。

**Q：`encodeStream`/`decodeStream` 报出的 `chunkIndex` 和内层错误的 `chunkIndex` 对不上。**
这是设计如此。外层 `SerializeCodecError` 的 `chunkIndex` 是"流里的第几片/第几个 chunk"；内层挂在 `error.cause` 上的 `SerializeCodecError`（如果原因本身也是一个 `SerializeCodecError`）说的是"那一次 encode/decode 内部的第几段"，两者刻度不同，见 [§4.4](#44-错误场景速查表)。

**Q：`sliceByFrameBudget`/`encodeStream` 报 `TypeError: serialize scheduler must be { now, schedule }`。**
`/core` 不提供默认 timer，`scheduler` 是必填选项。主入口场景下从 `@migaia/lifecycle` 导入 `systemScheduler` 传入即可；自定义 scheduler 需要同时提供 `now(): number`（返回有限数字）和 `schedule(callback, delayMs): { cancel(): void }`。

**Q：大数据导出还是卡主线程。**
检查 `encodeStream`/`sliceByFrameBudget` 的 `yieldTo` 是否被覆盖成了同步函数，或者 `maxItems`/`initialItems` 是否设置得过大导致首片就超出预算太多——自适应算法需要几轮才能收敛到合适的片大小，极端参数会削弱这个自适应过程的效果。

**Q：`collectStream` 抛了 `code: 'ENV_UNSUPPORTED'`。**
流里出现过 `bytes` 段，需要把其余 `text` 段就地转成字节合并，但没有传 `encoder` 参数且宿主没有全局 `TextEncoder`。显式传入 `collectStream(stream, new TextEncoder())`。

**Q：`bytesToBase64` 输出比预期长很多。**
Base64 编码本身会让体积膨胀约 4/3 倍，这不是本包的开销，是编码格式的固有特性。如果下游通道能直接接受 `Uint8Array`（IndexedDB、Worker transfer），应该跳过 Base64 直接传二进制。

**Q：`base64ToBytes` 抛错时 `error.cause` 是 `undefined`，看不到底层失败原因。**
这是刻意行为：`base64ToBytes` 捕获任意底层解析失败后统一抛出一个不带 `cause` 的 `TypeError`／`INVALID_OPTION`（"invalid base64 input"），不透传底层实现细节。
# Versioned codec boundaries

`@migaia/serialize/codec` defines the generic `ICodec<TValue, TEncoded, TId, TVersion>`
shape and retains the `identityCodecV1` compatibility alias. New version-specific callers import
`identityCodec` from `@migaia/serialize/codecs/identity/v1`; it is the same runtime object and
preserves the input value's concrete type through `encode` and `decode`. Format implementations are intentionally split:
`codecs/json`, `codecs/message-pack`, `codecs/cbor`, and `codecs/protobuf`. Importing the
generic or identity path does not load binary format runtimes.
