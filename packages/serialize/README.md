# `@migaia/serialize`

**存储无关的分段序列化协议 + 编解码器注册表**——把「一个值怎么变成能落盘/能传输的线材，线材又怎么变回值」这件事，从具体存储介质（localStorage、IndexedDB、HTTP body、SSR HTML）里剥离出来，做成一套可插拔、可流式、可协作式取消的协议层。

## 适用与不适用场景

**适用**：需要持久化/传输任意值，且格式可能不止一种（JSON 之外还想接 CBOR/MessagePack）、可能升级（旧存档要继续读得出来）、体量可能很大（导出百万行不能卡主线程）、或者需要给第三方 parser 一个不会被注入攻击的安全接入点。

**不适用**：只是简单地 `JSON.stringify`/`JSON.parse` 一次性用完，不需要格式可插拔、不需要流式、不需要多格式共存——直接用原生 API 更省事。本包不是 JSON 的替代品，也不提供存储/Worker/SSR 的具体落地实现（那是上层 `store-*` 系列包的事），只提供协议与编解码原语。

## 安装

```bash
pnpm add @migaia/serialize
```

依赖 `@migaia/lifecycle`（异步作用域、调度器、AbortController）与 `@migaia/utils`（Base64/UTF-8 底层算法、错误身份标注）。

## 目录

- [`.`：主入口（chunk 协议、registry、stream、Base64、错误、格式常量）](#主入口)
- [`/core`：静态复用 lifecycle abort leaf 的纯协议子集](#core-模块)
- [`/plugins`：内置 JSON 插件](#plugins-模块)
- [`/registry`：仅 registry 实现面](#registry-模块)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="主入口"></a>

## 主入口 `@migaia/serialize`

聚合了下面三个子路径外加内置格式常量的**完整公共表面**，日常使用从这里导入即可：

```ts
import {
  createSerializeRegistry,
  chunkToText,
  chunkToBytes,
  jsonPlugin,
  jsonParser,
  encodeStream,
  decodeStream,
  collectStream,
  sliceByFrameBudget,
  bytesToBase64,
  base64ToBytes,
  streamBase64Chunks,
  SerializeCodecError,
  SerializeErrorCode,
  assertSerializeType,
  SERIALIZE_TYPE_PATTERN,
  createSerializeError,
  createSerializeTypeError,
  createSerializeRangeError,
  tagSerializeError,
  isChunkShape,
  SerializeChunkKind
} from '@migaia/serialize';
```

### Versioned identity codec

```ts
import { identityCodec } from '@migaia/serialize/codecs/identity/v1';
import { identityCodecV1 } from '@migaia/serialize/codec';

// The versioned entry is the modern name; the retained alias is the same object.
const sameCodec = identityCodec === identityCodecV1;
const literal: { readonly ok: true } = identityCodec.encode({ ok: true } as const);
```

`identityCodec` preserves the runtime value and its actual TypeScript type in both directions. The
legacy `identityCodecV1` export remains available for existing callers.

**`createSerializeRegistry` + `registry.encode`/`.decode`｜10 秒上手** —— 建一个只认 JSON 的注册表，编解码一个值：

```ts
const registry = createSerializeRegistry([jsonPlugin()]);

const chunk = await registry.encode({ answer: 42 }, { context: 'settings' });
// chunk 是 ['text', '{"answer":42}']

const value = await registry.decode(chunk, { context: 'settings' });
// value 是 { answer: 42 }

registry.dispose(); // 等待在途操作结算，再释放全部 parser
```

`createSerializeRegistry(plugins, options?)` 全部参数：

- `plugins: readonly ISerializePlugin[]`（必填）—— `{ type: string; parser: ISerializeParser }[]`，至少 1 项（空数组抛 `RangeError`／`INVALID_OPTION`）；数组第一项的 `type` 就是 `primaryType`；`type` 必须匹配 `SERIALIZE_TYPE_PATTERN`，重复 `type` 会抛 `RangeError`／`INVALID_OPTION`
- `options?.scheduler?: ISerializeScheduler` —— 默认 `@migaia/lifecycle` 的 `systemScheduler`；创建后不可更换
- `options?.encoder?: ITextEncoder` —— 默认宿主 `TextEncoder`；两者都缺失时构造期即抛 `ENV_UNSUPPORTED`
- `options?.decoder?: ITextDecoder` —— 默认宿主 `TextDecoder`；同上
- `options?.cleanup?: { policy: 'throw' } | { policy: 'report'; report: (d) => void }` —— 默认 `{ policy: 'throw' }`；parser `dispose()` 失败时是并入 `dispose()` 的 reject，还是转发给 `report` 而不影响 `dispose()` 的结算
- `options?.onDrainTimeout?: (d) => void` —— 默认 no-op；`dispose({ deadlineAt })` 到期时仍有在途操作时触发的诊断回调
- `options?.report?: (error: unknown) => void` —— 默认 no-op；结算之后才到达的迟到错误、以及 iterator 二次清理错误的观测出口

返回的 `registry` 对象：`primaryType`（只读 `string`）、`types`（只读 `string[]`，注册顺序）、`has(type)`、`encode(value, options?)`、`decode(chunk, options?)`、`close()`（同步、幂等，切断新请求但不释放 parser）、`dispose(options?)`（异步、幂等，`options.deadlineAt?: number` 到期后即使仍有在途操作也会强制释放 parser 并触发 `onDrainTimeout`）。

`encode`/`decode` 的 `options?`：`type?: string`（默认 `primaryType`）、`signal?: ISerializeAbortSignal`、`context?: string`（默认 `'anonymous'`，出错时拼进消息定位是哪个调用点）。

**`jsonPlugin`｜3 秒上手** —— 内置 JSON 编解码器，多数场景唯一需要的 parser：

```ts
createSerializeRegistry([jsonPlugin({ space: 0 })]);
```

全部选项见 [`/plugins` 模块](#plugins-模块)。

**`encodeStream` / `collectStream`｜10 秒上手** —— 大数组编码成分段流，一次性收集完整结果（适合"最终要一个完整 blob"的场景）：

```ts
import { systemScheduler } from '@migaia/lifecycle';

const stream = encodeStream(registry, hugeArrayOfRows, {
  initialItems: 500,
  maxInFlight: 2,
  scheduler: systemScheduler
});
const chunk = await collectStream(stream);
```

更常见的是逐片消费（写文件、发 fetch body、`postMessage` 给 worker）而不整体收集，全部选项见 [USEGUIDE §7 流式序列化](./USEGUIDE.md#7-流式序列化)。

**`chunkToText` / `chunkToBytes`｜5 秒上手** —— 把任意分段规约成单一线材形态；`encoder`/`decoder` 都是必填参数（本包不假定宿主一定有 Encoding API）：

```ts
chunkToText(chunk, new TextDecoder()); // text 原样返回；bytes 用 decoder 解码；value 抛 TypeError
chunkToBytes(chunk, new TextEncoder()); // bytes 返回 .slice() 拷贝；text 用 encoder 编码；value 抛 TypeError
```

**`bytesToBase64` / `base64ToBytes` / `streamBase64Chunks`｜5 秒上手** —— 二进制数据走只认字符串的通道：

```ts
bytesToBase64(bytes); // string，一次性拼接完整结果
base64ToBytes(text); // Uint8Array；非法输入抛 TypeError／INVALID_OPTION（不保留原始 cause）
for (const part of streamBase64Chunks(bytes)) send(part); // 固定按 32763 字节（3 的倍数）分块 yield，不整段现造
```

三者均无可选项；`streamBase64Chunks` 的分块大小是内部实现细节，不对外暴露为参数。

**`SerializeCodecError` / `SerializeErrorCode`｜5 秒上手** —— 所有编解码期失败都是 `SerializeCodecError`，携带定位字段：

```ts
try {
  await registry.decode(badChunk);
} catch (error) {
  if (error instanceof SerializeCodecError) {
    console.error(
      error.code,
      error.type,
      error.phase,
      error.chunkIndex,
      error.bytesConsumed,
      error.context
    );
  }
}
```

`SerializeErrorCode` 全部取值：`registryDisposed`(`REGISTRY_DISPOSED`)、`codecNotFound`(`CODEC_NOT_FOUND`)、`encodeFailed`(`ENCODE_FAILED`)、`decodeFailed`(`DECODE_FAILED`)、`invalidChunk`(`INVALID_CHUNK`)、`aborted`(`ABORTED`)、`invalidOption`(`INVALID_OPTION`)、`envUnsupported`(`ENV_UNSUPPORTED`)。构造/生命周期类失败（`REGISTRY_DISPOSED`/`ENV_UNSUPPORTED`/协作式取消）不是 `SerializeCodecError`，而是原生 `Error`/`TypeError`/`RangeError` 经 `createSerializeError`/`createSerializeTypeError`/`createSerializeRangeError` 打上 `source: '@migaia/serialize'` 与对应 `code`——用同一套 `code` 判断即可，不需要区分类。

**`assertSerializeType` / `SERIALIZE_TYPE_PATTERN`｜3 秒上手** —— 插件 `type` 字符串会被下游写入 HTML 属性、存档头等对转义敏感的位置，注册时统一按此模式收死：

```ts
SERIALIZE_TYPE_PATTERN.test('cbor-v2'); // true；/^[a-z0-9][a-z0-9._-]{0,63}$/i
assertSerializeType('bad type!'); // 抛 RangeError／INVALID_OPTION
```

无可选项；`createSerializeRegistry` 内部对每个 `plugin.type` 自动调用它，一般不需要手动调用。

**`SerializeChunkKind` 等格式常量｜3 秒上手** —— 仅从主入口可拿到（`/core` 不导出），用于按标签分支处理 chunk：

```ts
if (chunk[0] === SerializeChunkKind.bytes) {
  /* ... */
}
```

无调用参数，是现成的常量对象；全部常量与取值见 [USEGUIDE §2.5](./USEGUIDE.md#25-格式常量root-only)。

---

<a id="core-模块"></a>

## `/core` 模块

```ts
import {
  SerializeCodecError,
  assertSerializeType,
  isChunkShape,
  SERIALIZE_TYPE_PATTERN,
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
  sliceByFrameBudget
} from '@migaia/serialize/core';
```

Core 静态复用 `@migaia/lifecycle/abort` 作为唯一取消 owner；packed consumer 可保留 abort leaf 的必要闭包，但必须 tree-shake lifecycle root、scope、scheduler、generation、quiescence 与 disposal。timer 一律经 `scheduler` 注入、Encoding 一律经 `ITextEncoder`/`ITextDecoder` 注入。**不包含** `createSerializeRegistry`（依赖 `@migaia/lifecycle` 其他 leaf，只在主入口/`/registry` 提供）、内置 JSON 插件、以及格式常量（`SerializeChunkKind` 等，只在主入口提供）。

其余每个导出的完整选项与 `/registry`、`/plugins` 相同（同一份实现），见上文与 [USEGUIDE.md](./USEGUIDE.md)。适合只需要 chunk 协议 + Base64 + 流式切片、只引入 lifecycle abort leaf 的场景（例如纯算法层的 CBOR/MessagePack parser 包）。

---

<a id="plugins-模块"></a>

## `/plugins` 模块

```ts
import { jsonParser, jsonPlugin, type IJsonPluginOptions } from '@migaia/serialize/plugins';
```

**`jsonParser`｜5 秒上手** —— 返回一个符合 `ISerializeParser` 的对象（`name: 'json'`），可单独拿来测试，或包进自定义 `ISerializePlugin`：

```ts
const parser = jsonParser({ reviver: (k, v) => (k === 'date' ? new Date(v as string) : v) });
```

**`jsonPlugin`｜3 秒上手** —— `{ type: 'json', parser: jsonParser(options) }` 的简写，直接喂给 `createSerializeRegistry`：

```ts
createSerializeRegistry([jsonPlugin()]);
```

`IJsonPluginOptions` 全部字段（`jsonParser`/`jsonPlugin` 共用，均可选）：

- `replacer?: (key: string, value: unknown) => unknown` —— 传给 `JSON.stringify`，裁剪不可序列化字段
- `reviver?: (key: string, value: unknown) => unknown` —— 传给 `JSON.parse`，还原 `Date` 之类的富类型
- `space?: number` —— 缩进，仅调试用；线上留空避免白白撑大体积
- `decoder?: ITextDecoder` —— `bytes` 段解码用；省略时用宿主 `TextDecoder`，两者都不可用时 `decode()` 抛 `ENV_UNSUPPORTED`

行为要点：`encode()` 在 `JSON.stringify` 结果为 `undefined`（如传入函数）时抛 `TypeError`／`ENCODE_FAILED`；`decode()` 对 `value` 段原样返回、`text` 段直接 `JSON.parse`、`bytes` 段先解码再 `JSON.parse`。

---

<a id="registry-模块"></a>

## `/registry` 模块

```ts
import {
  createSerializeRegistry,
  chunkToText,
  chunkToBytes,
  type ISerializeRegistry,
  type ISerializeRegistryOptions,
  type ISerializeCleanupError,
  type ISerializeTimeoutDiagnostic
} from '@migaia/serialize/registry';
```

只导出 registry 实现面（`createSerializeRegistry`、`chunkToText`、`chunkToBytes`）与相关类型，不含 chunk 协议基础设施、Base64、流式切片或 JSON 插件——需要那些能力时从主入口或 `/core` 导入。完整参数见上文「主入口」一节与 [USEGUIDE §3](./USEGUIDE.md#3-registry-api-完整参考)。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 大数据导出：分片编码 + 协作式取消 + 错误定位

```ts
import {
  createSerializeRegistry,
  encodeStream,
  decodeStream,
  jsonPlugin,
  SerializeCodecError
} from '@migaia/serialize';
import { systemScheduler } from '@migaia/lifecycle';

const registry = createSerializeRegistry([jsonPlugin()]);
const controller = new AbortController();
const wire: unknown[] = [];

try {
  for await (const chunk of encodeStream(registry, hugeArrayOfRows, {
    initialItems: 500,
    maxInFlight: 2,
    signal: controller.signal as never,
    context: 'export-rows',
    scheduler: systemScheduler
  })) {
    wire.push(chunk); // 换成 writable.write(chunk) / port.postMessage(chunk) 等真实 sink
  }
} catch (error) {
  if (error instanceof SerializeCodecError) {
    console.error(`导出在第 ${error.chunkIndex} 片失败：${error.message}`, { cause: error.cause });
  }
  throw error;
}

const restored: unknown[] = [];
for await (const rows of decodeStream(registry, wire as never, { context: 'export-rows' })) {
  restored.push(...(rows as unknown[]));
}
await registry.dispose();
```

### 2. 多格式共存：新旧存档平滑迁移

```ts
import { createSerializeRegistry, jsonPlugin } from '@migaia/serialize';

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

### 3. 二进制走文本通道：编码 + Base64 + 带截止时间释放

```ts
import {
  createSerializeRegistry,
  bytesToBase64,
  base64ToBytes,
  jsonPlugin
} from '@migaia/serialize';

const registry = createSerializeRegistry([jsonPlugin()]);
const chunk = await registry.encode(largeObject);
const wire = chunk[0] === 'bytes' ? bytesToBase64(chunk[1]) : chunk[1];
// ... 落 localStorage / 内联进 HTML ...
const restoredBytes = typeof wire === 'string' ? base64ToBytes(wire) : undefined;

// 应用退出前：最多等待 500ms 排空在途操作，超时也强制释放 parser（不会永久挂起）
await registry.dispose({ deadlineAt: Date.now() + 500 });
```

### 4. 自定义 parser 接入 + 安全的 type 校验

```ts
import {
  createSerializeRegistry,
  jsonPlugin,
  assertSerializeType,
  type ISerializeParser,
  type ISerializePlugin
} from '@migaia/serialize';

function makeCborPlugin(type: string): ISerializePlugin {
  assertSerializeType(type); // 第三方格式名先做一次显式校验，早失败好过注册时才发现
  const parser: ISerializeParser = {
    name: 'cbor',
    encode: (value) => ['bytes', encodeCbor(value)],
    decode: (chunk) =>
      decodeCbor(chunk[0] === 'bytes' ? chunk[1] : new TextEncoder().encode(chunk[1] as string)),
    dispose: () => releaseCborResources()
  };
  return { type, parser };
}

const registry = createSerializeRegistry([jsonPlugin(), makeCborPlugin('cbor')]);
await registry.encode(payload, { type: 'cbor' });
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test && pnpm run build
```
