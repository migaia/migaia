# @migaia/serialize

**存储无关的分段序列化协议 + 编解码器注册表**——把「一个值怎么变成能落盘/能传输的线材，线材又怎么变回值」这件事，从具体存储介质（localStorage、IndexedDB、HTTP body、SSR HTML）里剥离出来，做成一套可插拔、可流式、可取消的协议层。

## 1. 这是什么

几乎每个需要持久化或跨端传输数据的项目都会重复发明同一层东西：把对象 `JSON.stringify` 一下、大数据要不要分片导出、二进制怎么塞进只认字符串的通道、格式升级了旧数据还读不读得出来。这些问题分散解决时，通常是「哪个模块要用就在哪里写一遍」，日积月累就是好几套互不兼容的临时方案。

`@migaia/serialize` 把这层收敛成一个统一协议：任何编解码器（parser）只需要实现 `encode(value) -> chunk` 和 `decode(chunk) -> value`，chunk 有且只有三种形态——**text**（字符串线材，落 localStorage、内联 HTML）、**bytes**（字节线材，IndexedDB、wasm、零拷贝 transfer）、**value**（已经是成品对象，跳过编解码往返，给"直通"型 parser 用）。多个 parser 按 `type` 注册进一个 `registry`，读取时按存档里记录的 `type` 找回对应 parser，格式迁移不需要清空用户数据。围绕这个核心协议，包里还带了大数据流式切片、Base64 二进制转文本通道、默认 JSON 编解码器三块配套能力。

可以把它类比成一个**微型、可扩展的 Content-Type 协商层**：registry 相当于「已知格式的路由表」，`type` 字段相当于 HTTP 的 `Content-Type`，`encode`/`decode` 相当于具体的序列化器实现，你可以随时注册新格式而不用改调用方代码。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| 需要持久化任意值到 localStorage / IndexedDB | 用统一的 `registry.encode`/`decode`，不用在每个存储适配器里各写一套 JSON 逻辑 |
| 存档格式可能升级 | 新旧 parser 可以在同一个 registry 里共存，写入用新格式，读取按存档里的 `type` 自动选对 parser |
| 需要导出/导入大量记录而不卡主线程 | `encodeStream`/`sliceByFrameBudget` 按实测耗时自适应切片，边导出边把控制权还给事件循环 |
| 二进制数据要走只认字符串的通道 | `bytesToBase64`/`base64ToBytes`，大数据用 `streamBase64Chunks` 避免整段现造 |
| 需要给第三方 parser 一个安全的接入点 | `type` 字符集在注册时被强校验，避免第三方包的格式名混入不可信字符 |

不适合的场景：如果只是简单地 `JSON.stringify`/`JSON.parse` 一次性用完，不需要格式可插拔、不需要流式、不需要多格式共存，直接用原生 API 更省事——引入这层协议是为了应对「多格式」「大数据量」「跨介质」这几个具体约束，不是 JSON 的替代品。

## 3. 用了之后能得到什么

- **统一的编解码入口**：不管背后是 JSON、还是未来接入的 CBOR/MessagePack，调用方永远是 `registry.encode(value)` / `registry.decode(chunk)`，格式切换不影响调用方代码。
- **格式可平滑迁移**：`registry.types` 里的所有 parser 都能解码，写入只用第一个（`primaryType`）；旧存档不会因为升级默认格式而读不出来。
- **大数据不卡主线程**：`encodeStream()` 内部用 `sliceByFrameBudget()` 按目标帧时长（默认 8ms）动态调整切片大小，并支持 `maxInFlight` 背压，避免瞬间攒出一整块大字符串/大数组占满内存。
- **可定位的错误**：所有失败都是 `SerializeError`，自带 `type`/`phase`/`source`/`chunkIndex`/`bytesConsumed`，出问题时能直接答出「哪个 store、哪种格式、第几段、已经吃进去多少字节」。
- **安全的类型名边界**：插件 `type` 字符串会被下游写入 HTML 属性、存档头等对转义敏感的位置，注册时统一按 `SERIALIZE_TYPE_PATTERN` 收死，第三方插件的格式名不会成为注入点。
- **协作式取消**：所有异步 API 都接受 `AbortSignal`，中途取消会以 `SerializeError` 结束，不会留下悬空的编解码工作。

## 4. 五分钟上手

```ts
import { createSerializeRegistry, jsonPlugin } from '@migaia/serialize';

const registry = createSerializeRegistry([jsonPlugin()]);

const chunk = await registry.encode({ answer: 42 }, { source: 'settings' });
// chunk 是 ['text', '{"answer":42}']

const value = await registry.decode(chunk, { source: 'settings' });
// value 是 { answer: 42 }

registry.dispose();
```

`createSerializeRegistry()` 接受一个插件数组；数组第一项 (`jsonPlugin()`) 就是 `primaryType`，也就是没有显式指定 `type` 时 `encode()` 默认使用的格式。`decode()` 同理，不传 `type` 就按 `primaryType` 解析——想跨格式读取旧存档，显式传 `{ type: 'legacy-json' }` 即可。

大数据量导出场景（一次性拿到完整分段，而不是逐片消费）：

```ts
import { encodeStream, collectStream } from '@migaia/serialize';

const stream = encodeStream(registry, hugeArrayOfRows, { initialItems: 500, maxInFlight: 2 });
const chunk = await collectStream(stream); // 只在确实需要完整 blob 时才这样用
```

更常见的是逐片消费（写文件、发 fetch body、postMessage 给 worker），见 [USEGUIDE.md](./USEGUIDE.md#7-流式序列化)。

## 5. 核心概念一览

| 概念 | 是什么 | 类比 |
| --- | --- | --- |
| **Chunk（分段）** | `['text', string]` \| `['bytes', Uint8Array]` \| `['value', unknown]` 三选一的带标签元组 | HTTP 响应体 + `Content-Type` |
| **Registry（注册表）** | `createSerializeRegistry()` 返回的对象，按 `type` 管理多个 parser | Content-Type 路由表 |
| **Parser（编解码器）** | `{ name, encode(value, ctx), decode(chunk, ctx), dispose?() }` | 具体的序列化实现（如 JSON） |
| **Plugin（插件）** | `{ type, parser }`，`type` 是写进存档/协议的格式标签 | 注册到路由表的一条路由 |
| **Context（上下文）** | 每次 encode/decode 拿到的 `{ signal, source }` | 请求上下文 |
| **SerializeError** | 带 `type`/`phase`/`source`/`chunkIndex`/`bytesConsumed` 的定位型异常 | 带堆栈定位信息的协议错误 |

## 6. 公开入口与模块能力

| 入口 | 提供什么 |
| --- | --- |
| `@migaia/serialize` | 完整公共表面：core、JSON plugin、registry、stream、Base64 和格式常量。日常使用从这里导入。 |
| `@migaia/serialize/core` | chunk/codec/parser contract、错误工具、stream 和 Base64；不导出 lifecycle 依赖的 registry。 |
| `@migaia/serialize/plugins` | `jsonPlugin`、`jsonParser` 及 JSON 配置类型。 |
| `@migaia/serialize/registry` | registry 实现面：`createSerializeRegistry`、`chunkToText`、`chunkToBytes` 与 registry 专属类型。 |

## 7. 安装

```bash
pnpm add @migaia/serialize
```

依赖 `@migaia/web-rpc`（仅用到其结构化的 `IWebRpcAbortSignal` 类型，不引入 DOM/浏览器绑定）；不依赖 Store、Worker、WASM，二进制走文本通道用到的是运行时内建的 `btoa`/`atob`/`TextEncoder`/`TextDecoder`。

## 8. 生命周期、错误与边界

1. **`value` 分段不能和其他分段混用**。一次 `encode()` 的输出如果包含 `['value', ...]`，它必须是唯一的一段——和 `text`/`bytes` 段混在一起会抛 `SerializeError`，因为 value 已经是成品对象，没有可拼接的语义。
2. **`chunkToText`/`chunkToBytes` 对 `value` 段会抛 `TypeError`**，它们只处理 `text`/`bytes` 两种线材形态。
3. **`registry.dispose()` 之后不能再 encode/decode**，会直接抛错；`dispose()` 本身会尽力释放全部 parser，某个 parser 的 `dispose()` 抛错不会阻止其余 parser 释放，多个失败会聚合成 `AggregateError`。
4. **插件 `type` 只能是 `SERIALIZE_TYPE_PATTERN`（`/^[a-z0-9][a-z0-9._-]{0,63}$/i`）允许的字符**，第三方插件的格式名不受信任，注册时就会强校验，不要绕过 `createSerializeRegistry` 直接拼装 registry。
5. **`encodeStream`/`decodeStream` 默认 `maxInFlight: 1`**，即编好一片就等它被消费完才编下一片，峰值内存最小；调大能让编码与下游处理重叠，但峰值内存也会同比增加。
6. **JSON 编解码器不支持函数、循环引用、DOM 节点和 class 私有字段**——这是 `JSON.stringify`/`JSON.parse` 本身的限制，不是本包要偷偷"兼容"的数据类型；需要这些能力得自己实现一个新的 parser。
7. **`bytesToBase64` 的分块大小固定为 32763 字节**（3 的倍数，为了不破坏 base64 的 4 字符对齐），这是内部实现细节，不对外暴露为配置项。

## 9. 深入参考

`SerializeError` 每个字段的精确触发场景、`sliceByFrameBudget` 的自适应算法细节、`encodeStream`/`decodeStream` 的背压与错误定位语义、自定义 parser/plugin 的完整写法、`SERIALIZE_TYPE_PATTERN` 背后的安全考量，见 **[USEGUIDE.md](./USEGUIDE.md)**。
