# `@migaia/rpc-contract` 使用手册

本包定义线上格式并提供纯数据函数：给定输入，返回规范化后的结果，或抛出带 `(source, code)` 的错误。它不持有连接、不调度、不执行业务。安装与入口一览见 [README](./README.md)。

## 目录

1. [常量与线上格式](#1-常量与线上格式)
2. [握手](#2-握手)
3. [可移植数据](#3-可移植数据)
4. [分帧](#4-分帧)
5. [runtime 调用信封](#5-runtime-调用信封)
6. [流式调用的校验](#6-流式调用的校验)
7. [二进制数据](#7-二进制数据)
8. [错误码](#8-错误码)
9. [高阶用法：跨进程与跨语言传递错误](#9-高阶用法跨进程与跨语言传递错误)
10. [常见问题](#10-常见问题)

---

## 1. 常量与线上格式

所有字段名、枚举值与上限都以常量对象导出，其它语言的实现应以这些值为准，不要自行拼写字符串：

| 常量                                                  | 内容                                                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `RpcProtocol`                                         | 协议标识 `migaia.rpc` 与当前版本 `major` / `minor`（1.1）                                                 |
| `RpcCodecId`                                          | codec 名，例如 `json`                                                                                     |
| `RpcPeerRuntime`                                      | 对端运行时标签：`node`、`bun`、`deno`、`browser` 等                                                       |
| `RpcCapability`                                       | 能力名，形如 `name@version`：`ping@1`、`batch@1`、`stream@1`、`runtime-api@1`、`group@1`、`transfer@1` 等 |
| `RpcEnvelopeKind`                                     | 信封种类                                                                                                  |
| `RpcRouteField`                                       | 路由字段名：`timeoutMs`、`idempotencyKey`、`trace` 等                                                     |
| `RpcWireLimit`、`RpcStreamLimit`、`RpcWireErrorLimit` | 各类上限（深度、长度、字节数）                                                                            |
| `RpcRuntime*`（`./runtime`）                          | runtime 调用的模式、字段、结果状态等                                                                      |
| `RpcBinary*`（`./binary*`）                           | 二进制清单的 profile、存储方式、标签                                                                      |

完整列表从 `@migaia/rpc-contract/wire` 导入；该入口只导出常量，不包含校验逻辑。

## 2. 握手

连接建立后，双方先交换一次握手：发起方发送 hello，响应方选出共同的版本、codec 与能力并回复 accept 或 reject，发起方再确认结果。

```ts doc-test=run
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  createRpcHello
} from '@migaia/rpc-contract/handshake'
import { RpcCapability, RpcCodecId, RpcPeerRuntime, RpcProtocol } from '@migaia/rpc-contract'

const clientOffer = {
  peer: { id: 'client', runtime: RpcPeerRuntime.node },
  versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
  codecs: [RpcCodecId.json],
  capabilities: [RpcCapability.ping, RpcCapability.batch]
}
const hello = createRpcHello(clientOffer) // JSON 文本，作为第一帧发送

// 响应方：
const accepted = acceptRpcHandshake(
  {
    peer: { id: 'server', runtime: RpcPeerRuntime.node },
    versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
    codecs: [RpcCodecId.json],
    capabilities: [RpcCapability.batch]
  },
  hello
)
// accepted.ok === true；accepted.reply 是要发回的 JSON 文本
// accepted.agreement: { major: 1, minor: 1, codec: 'json', capabilities: ['batch@1'], peer: { id: 'client', … } }

// 发起方：
const agreement = completeRpcHandshake(clientOffer, accepted.reply)
// { major: 1, minor: 1, codec: 'json', capabilities: ['batch@1'], peer: { id: 'server', … } }
```

- 协商规则：取双方都支持的最高主版本，次版本取较小者；codec 按发起方的顺序选第一个共同项；能力取交集，保持发起方的顺序。
- 没有共同版本或 codec 时，`acceptRpcHandshake` 返回 `{ ok: false, reply, error }`，`reply` 是要发回的 reject 文本。发起方的 `completeRpcHandshake` 收到 reject 时以 `HANDSHAKE_REJECTED` 或 `HANDSHAKE_INCOMPATIBLE` 抛出。
- offer 中的 `auth` 字段（可选）用于携带认证凭据，由响应方的上层逻辑校验。

## 3. 可移植数据

`normalizePortable(value)` 把业务数据转换为可在线上传输的形式，并在不支持时抛错：

```ts doc-test=run
import { normalizePortable } from '@migaia/rpc-contract/portable'
import { classifyRpcContractError } from '@migaia/rpc-contract'

normalizePortable({ a: 1, b: [1, 2], c: new Uint8Array([1, 2]) })
// { a: 1, b: [1, 2], c: { $rpc: 'bytes', base64url: 'AQI' } }

try {
  normalizePortable({ when: new Date() })
} catch (error) {
  const diagnostic = classifyRpcContractError(error)
  if (!diagnostic) throw error
  console.error(diagnostic.code) // TypeError，@migaia/rpc/contract / INVALID_ENVELOPE
}
```

| 输入                                                                                                                       | 结果                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `null`、布尔、字符串、有限数值（含 `-0`）                                                                                  | 原样保留                                                    |
| 普通对象                                                                                                                   | 冻结的无原型副本；getter 只读取一次                         |
| 数组                                                                                                                       | 逐项规范化                                                  |
| `Uint8Array`                                                                                                               | 标签对象 `{ $rpc: 'bytes', base64url }`（无填充 base64url） |
| `ArrayBuffer`、`Date`、`Map`、`Set`、类实例、函数、`undefined`（包括值为 `undefined` 的属性）、`NaN`、`Infinity`、循环引用 | 拒绝                                                        |

`ArrayBuffer` 不能直接作为可移植数据；Peer 调用中的 `ArrayBuffer` 由协商后的二进制 profile（第 7 节）处理。

最大嵌套深度为 `RPC_PORTABLE_MAX_DEPTH`（64）。同一对象被多处引用时，每处得到独立副本。

## 4. 分帧

分帧负责把消息切分成可在字节流上传输的帧，以及把收到的字节重新组装成完整消息。本包提供三种格式：

| 格式                | 入口                | 用途                                            |
| ------------------- | ------------------- | ----------------------------------------------- |
| 4 字节大端长度前缀  | `./framing/stream`  | 原生协议的字节流（stdio、socket）；bootstrap 帧 |
| `Content-Length` 头 | `./framing/jsonrpc` | JSON-RPC 桥                                     |
| 完整字符串消息      | `./framing`         | 载体本身已按消息投递（例如 postMessage 字符串） |

### 长度前缀

```ts doc-test=run
import {
  createRpcStreamFrameDecoder,
  encodeRpcStreamFrame
} from '@migaia/rpc-contract/framing/stream'

const frame = encodeRpcStreamFrame(new TextEncoder().encode('hello')) // 4 字节长度 + 5 字节内容

const decoder = createRpcStreamFrameDecoder({
  onFrame: (payload) => console.log(new TextDecoder().decode(payload)),
  onError: (error) => console.error(error) // 只会收到第一个分帧错误
})
decoder.push(frame.subarray(0, 3))
decoder.push(frame.subarray(3)) // 输出 hello
decoder.finish() // 连接结束；残留半帧报告 INVALID_FRAME
```

- 空负载不能编码（`INVALID_FRAME`）。单帧上限为 `RPC_STREAM_MAX_FRAME_BYTES`（16 MiB），超出时报告 `FRAME_LIMIT_EXCEEDED`。
- `createRpcStreamFrameDecoderWithLimit(options, () => limit)` 在每帧分配内存前读取当前上限，适合握手阶段使用更小的上限。
- `createRpcBootstrapFrameReceiver` 与 `createRpcHandshakeFrameReceiver` 分别处理连接上的 bootstrap 帧与握手帧，供适配器作者在激活前排队后续数据。

### Content-Length

```ts doc-test=run
import { createJsonRpcFrameDecoder, encodeJsonRpcFrame } from '@migaia/rpc-contract/framing/jsonrpc'

const bytes = encodeJsonRpcFrame({ jsonrpc: '2.0', id: 1, method: 'ping' })
const decoder = createJsonRpcFrameDecoder()
const messages = decoder.push(bytes) // 返回本次完整解出的消息数组
decoder.finish()
```

- `push` 返回已完整的消息；数据可以任意切块。
- 头部或 UTF-8 / JSON 非法、连接在一帧中途结束时，抛出 `@migaia/rpc/bridge/jsonrpc` / `JSONRPC_FRAME_INVALID`。
- 长度按 UTF-8 字节计算；上限见 `JsonRpcLimit`。

### 完整字符串消息

载体已经保证每次交付一条完整字符串时，用 `./framing` 的 `processStringFramer`；接收值类型不确定时用 `remoteProcessStringFramer`，它会先校验输入是字符串（否则 `TypeError` / `INVALID_FRAME`）。两者都不再分片，保留载体自身的消息边界。

### 物理帧大小

`inspectRpcPhysicalFrame(value, limit)` 测量一个编码后帧的实际字节数；批量超限时可用其 `splitBatch` 对半拆分，单条消息超限则以 `RangeError` 拒绝。

## 5. runtime 调用信封

runtime 调用（Peer 的 request / notify / stream / group）在线上以 runtime 信封传输：

| 函数                                                  | 入口                 | 用途                                                            |
| ----------------------------------------------------- | -------------------- | --------------------------------------------------------------- |
| `normalizeRuntimeEnvelope(value)`                     | `./runtime`          | 严格校验收到的信封：只接受自身数据属性，不执行 getter           |
| `normalizeRuntimeEnvelopeDecoded(value)`              | `./runtime`          | 校验**由本库 codec 刚解码出的**纯 JSON 对象，省去属性描述符检查 |
| `createRuntimeCallEnvelope(...)`                      | `./runtime/metadata` | 按类型构造出站调用信封                                          |
| `normalizeRuntimeGeneration`、`normalizeRuntimeSteps` | `./runtime/metadata` | 校验代次与 group 步骤                                           |
| 同名函数                                              | `./runtime/lazy`     | 异步版本，首次使用时才加载完整解析器，适合冷启动路径            |

**`*Decoded` 系列只用于本库 codec 的输出**：它们读取对象自身的可枚举属性时会执行 getter，不对调用方自行构造的对象做防御性检查。接收来源不确定的数据时，使用对应的严格版本（`normalizeRuntimeEnvelope`、`restoreRpcBinary`）。

## 6. 流式调用的校验

`./stream` 提供流式调用的负载校验与状态检查，供实现流式传输的适配器使用：

- `normalizeStreamPayload(value)`：校验一条流消息的负载。
- `checkRpcStreamSequence`、`checkRpcStreamProgress`、`checkRpcStreamConsumerCredit`、`checkRpcStreamProducerCredit`：检查序号连续性、进度，以及消费者额度与生产者忙碌状态。合法时返回 `undefined`，违规时**返回**（不抛出）带 code 的错误，由调用方决定报告、终止还是取消。
- `checkRpcRuntimeStreamTransition`、`checkRpcRuntimeStreamIntent`：检查结束控制与提前控制是否与流的起始选项一致。

## 7. 二进制数据

二进制数据可以内联在消息中（base64url 标签），也可以作为原生 sidecar 随消息传输并以摘要校验完整性。

| 函数                                                         | 入口                        | 用途                                                            |
| ------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------- |
| `prepareRpcBinary(envelope, storage, limit, digest, codec?)` | `./binary`、`./binary/lazy` | 为出站消息生成二进制清单、原生 sidecar 列表与总字节数           |
| `restoreRpcBinary(...)`                                      | `./binary`、`./binary/lazy` | 校验清单与完整性后还原数据                                      |
| `restoreRpcBinaryDecoded(...)`                               | 同上                        | 同上，用于本库 codec 刚解码的数据（限制同第 5 节）              |
| `captureRpcBinaryData(...)`                                  | `./binary/capture`          | 先同步捕获数据，稍后再 `prepare()`；适合捕获点早于编码的场景    |
| `assertRpcNativeBinaryFrameSize` 等                          | `./binary/inspect`          | 按完整 backing 字节数检查帧大小、读取原生二进制、判断完整性错误 |

- 大小与配额按**完整的底层 `ArrayBuffer`** 计算，而不只是视图可见的部分。
- `./binary/lazy` 导出同名函数，在加载完整 codec 前先同步捕获数据并计算第一个摘要，适合冷启动路径。
- `digest` 由调用方提供，必须是真实的 SHA-256；自定义的元数据 codec 通过最后一个参数传入，需保证输出准确。

## 8. 错误码

本包错误的 source 为 `@migaia/rpc/contract`（`RPC_CONTRACT_SOURCE`）：

| code                     | 何时发生                                   | 处理                                           |
| ------------------------ | ------------------------------------------ | ---------------------------------------------- |
| `INVALID_DESCRIPTOR`     | codec / framer / 协议描述不合法            | 修正配置                                       |
| `INVALID_ENVELOPE`       | 信封字段或数据不合法（包括不可移植的数据） | 修正发送端；不要重发同一坏消息                 |
| `INVALID_STREAM`         | 流消息的序号、字段或值不合法               | 终止该流；已交付的项不重放                     |
| `INVALID_FRAME`          | 物理帧格式错误                             | 修正分帧或编码                                 |
| `FRAME_LIMIT_EXCEEDED`   | 帧超过上限                                 | 减小数据量，或改用流式传输                     |
| `FRAME_ASSEMBLY_EXPIRED` | 分片重组超时                               | 关闭未完成的重组；对应调用是否已执行需另行确认 |
| `INVALID_WIRE_ERROR`     | 收到的错误树不合法                         | 拒绝该错误帧；调用结果视为未知                 |
| `HANDSHAKE_INVALID`      | 握手文本的 UTF-8、JSON 或字段不合法        | 关闭连接，修正后重新建立                       |
| `HANDSHAKE_INCOMPATIBLE` | 没有共同的版本、codec 或必需能力           | 升级双方实现；不会降级到旧协议                 |
| `HANDSHAKE_REJECTED`     | 对端拒绝握手（例如认证失败）               | 查看 `cause`，修正凭据或配置                   |

`./framing/jsonrpc` 另导出 JSON-RPC 桥的错误常量（source `@migaia/rpc/bridge/jsonrpc`）：`JSONRPC_FRAME_INVALID`、`JSONRPC_EXTENSION_MISSING`、`JSONRPC_PROFILE_INVALID`、`JSONRPC_UNSUPPORTED_MODE`、`JSONRPC_HANDSHAKE_TIMEOUT`，说明见 [Process JSON-RPC 错误](../rpc-process/USEGUIDE.md#json-rpc-6-错误处理)。

其它 RPC 包的错误身份：

| 包                                     | source 常量                                                   | code 表                   |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------- |
| `@migaia/rpc-contract`                 | `RPC_CONTRACT_SOURCE`（`@migaia/rpc/contract`）               | `RpcContractErrorCode`    |
| `@migaia/rpc-core`                     | `RPC_CORE_ERROR_SOURCE`（`@migaia/rpc/core`）                 | `RpcCoreErrorCode`        |
| `@migaia/rpc-core/remote`              | `RPC_REMOTE_ERROR_SOURCE`（`@migaia/rpc/remote`）             | `RpcRemoteLayerErrorCode` |
| `@migaia/rpc-process`                  | `RPC_PROCESS_ERROR_SOURCE`（`@migaia/rpc/process`）           | `RpcProcessErrorCode`     |
| `@migaia/rpc-threads`                  | `RPC_THREAD_ERROR_SOURCE`（`@migaia/rpc/threads`）            | `RpcThreadErrorCode`      |
| `@migaia/rpc-contract/framing/jsonrpc` | `JSONRPC_BRIDGE_ERROR_SOURCE`（`@migaia/rpc/bridge/jsonrpc`） | `JsonRpcBridgeErrorCode`  |

请按 `(source, code)` 分支。错误的 `message` 文本只用于展示，可能变化，不要据此决定重试。

## 9. 高阶用法：跨进程与跨语言传递错误

### 序列化与还原

```ts doc-test=run
import { serializeRpcError, deserializeRpcError } from '@migaia/rpc-contract/errors'

const original = new RangeError('bad input', { cause: new Error('root cause') })
const wire = serializeRpcError(original, { report: (failure) => console.error(failure) })
// { source: 'unknown', code: 'UNKNOWN', name: 'RangeError', message: 'bad input', stack: '…', cause: {…} }

const restored = deserializeRpcError(wire)
restored instanceof RangeError // true；stack 保留发送方的原始 stack
```

- 错误树必有 `source`、`code`、`name`、`message`、`stack`；可选 `cause`、`errors`（`AggregateError`）、可移植的 `data`、路由信息 `route`，以及表示被截断的 `truncated: true`。
- 序列化受深度、节点数和字节数上限约束（`RpcWireErrorLimit`），超出部分被截断，并通过 `report` 报告被省略的内容。读取错误属性时 getter 抛错也会经 `report` 报告，不会中断序列化。
- `normalizeRpcSerializedError(value)` 校验收到的错误树；`reachRpcError(error)` 遍历本地错误的 `cause` 与 `errors`，按引用去重。
- JSON Schema 随包发布在 `@migaia/rpc-contract/schema/wire-error`，其它语言可用它校验。

**脱敏**：可以给 `serializeRpcError` 传第三个参数 `{ summaries, routes }`（两个以 Error 对象为键的 `WeakMap`），为指定的错误提供对外展示的摘要（例如统一的 code 与消息），隐藏内部细节与 `cause`。

### 与 JSON-RPC 互转

```ts doc-test=run
import { serializeRpcError, toJsonRpcError, fromJsonRpcError } from '@migaia/rpc-contract/errors'

/** JSON-RPC 示例自己构造错误树，不依赖上一个章节的局部变量。 */
const wire = serializeRpcError(new RangeError('bad input'), {
  report: (failure) => console.error(failure)
})
const jsonRpcError = toJsonRpcError(wire, -32000)
// { code: -32000, message: 'bad input', data: { migaiaWireError: { …错误树… } } }

const back = fromJsonRpcError(jsonRpcError)
console.log(back.name, back.message) // RangeError bad input
```

- 错误树放在 `error.data.migaiaWireError`（`RpcJsonRpcWireError.dataKey`）；整数 `code` 由调用方按 JSON-RPC 约定选择。
- `fromJsonRpcError` 也接受不带扩展数据的普通 JSON-RPC 错误：此时 source 记为 `RpcJsonRpcWireError.foreignSource`，code 为整数的字符串形式。

### 为自己的适配器定义错误身份

第三方适配器应使用自己的 source 和 code，不要冒用 `@migaia/rpc/*` 的身份。用 `@migaia/utils/error` 的 `attachErrorIdentity` 给原生错误附加身份：

```ts doc-test=check
import { attachErrorIdentity } from '@migaia/utils/error'
import { serializeRpcError, toJsonRpcError } from '@migaia/rpc-contract/errors'

const ADAPTER_SOURCE = '@example/electron-carrier'
const AdapterErrorCode = { writeFailed: 'WRITE_FAILED' } as const

export function writeFailure(cause: unknown, report: (failure: unknown) => void) {
  const error = attachErrorIdentity(new Error('adapter write failed', { cause }), {
    source: ADAPTER_SOURCE,
    code: AdapterErrorCode.writeFailed
  })
  const wire = serializeRpcError(error, { report })
  return { error, wire, jsonrpc: toJsonRpcError(wire, -32000) }
}
```

### 识别本包抛出的错误

`classifyRpcContractError(error)` 判断一个错误是否确实由本包在本地抛出（按对象引用识别，复制的错误或来自其它进程的错误返回 `undefined`），并返回其 code 与对外消息：

```ts doc-test=run
import { classifyRpcContractError, normalizeRpcEnvelope } from '@migaia/rpc-contract'

try {
  normalizeRpcEnvelope({})
} catch (error) {
  const diagnostic = classifyRpcContractError(error)
  if (!diagnostic) throw error
  console.error(diagnostic.code, diagnostic.message) // INVALID_ENVELOPE rpc envelope is invalid
}
```

还原出的错误身份只用于诊断：它不代表该错误由本地库产生，也不授予任何重试或控制权限。

## 10. 常见问题

**为什么 `Date` / `Map` 不能直接传？**
线上格式要求所有语言都能无歧义地表示同一个值。请转换为字符串（例如 ISO 时间）、数组或普通对象。

**我在其它语言里实现对端，最少需要实现什么？**
原生协议需要长度前缀分帧、握手（第 2 节）与 runtime 信封；JSON-RPC 桥只需要 Content-Length 分帧与四个扩展方法，见 [Process JSON-RPC 协议](../rpc-process/USEGUIDE.md#json-rpc-5-高阶用法对端协议规范)。

**`*Decoded` 和严格版本该用哪个？**
数据刚从本库 codec 解码出来、没有经过其它代码时可用 `*Decoded`；其它情况一律用严格版本。
