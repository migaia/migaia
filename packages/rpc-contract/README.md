# `@migaia/rpc-contract`

**RPC 协议工具包。** 定义 migaia RPC 的线上格式：协议常量、握手、消息信封、可移植数据、分帧、二进制清单与错误树，并提供对应的构造、校验与编解码函数。它只处理"数据长什么样、合不合法"，不打开任何连接，不执行调用，也不依赖 Node、DOM 或任何运行时。

## 谁需要直接使用它

| 你在做什么                                                     | 用到的部分                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| 只是在 TS 里用 RPC 调用进程、Worker 或浏览器对端               | 通常不需要直接导入；它是 `@migaia/rpc-core` 的 peer 依赖   |
| 用其它语言实现兼容的对端（Python / Go / Rust）                 | 线上格式常量、握手、分帧、错误树结构                       |
| 为新的载体（自定义 IPC、Electron 通道等）写适配器              | 分帧（`./framing*`）、握手（`./handshake`）、错误工具      |
| 需要把错误跨进程 / 跨语言传递并还原                            | `./errors`                                                 |
| 需要常量来声明能力（例如 listen 端的 `offer.capabilities`）    | `RpcCapability`、`RpcProtocol`、`RpcCodecId`、`RpcPeerRuntime` |

## 安装

```bash
pnpm add @migaia/rpc-contract
```

运行时依赖只有 `@migaia/utils` 与 `@migaia/serialize`。没有 peer 依赖。

## 入口一览

| 入口                                       | 内容                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `@migaia/rpc-contract`                     | 常用常量（`RpcCapability`、`RpcProtocol`、`RpcCodecId` 等）、信封校验、握手、错误工具、可移植数据 |
| `./wire`                                   | 全部线上格式常量（字段名、枚举、上限、违规原因），不含函数逻辑                                    |
| `./handshake`                              | `createRpcHello`、`acceptRpcHandshake`、`completeRpcHandshake`、`normalizeRpcHandshake`            |
| `./portable`                               | `normalizePortable`：把业务数据规范化为可在线上传输的形式                                         |
| `./errors`                                 | `serializeRpcError`、`deserializeRpcError`、`toJsonRpcError`、`fromJsonRpcError` 等               |
| `./framing`                                | 字符串 / 二进制 framer、消息重组、物理帧大小检查                                                  |
| `./framing/stream`                         | 4 字节长度前缀分帧（`encodeRpcStreamFrame`、`createRpcStreamFrameDecoder`）                         |
| `./framing/jsonrpc`                        | Content-Length 分帧（`encodeJsonRpcFrame`、`createJsonRpcFrameDecoder`）与 JSON-RPC 桥错误码       |
| `./framing/v1`、`./v1`                     | 协议 1.x 的消息 framer 与信封校验                                                                 |
| `./runtime`、`./runtime/lazy`、`./runtime/metadata` | runtime 调用信封的校验与构造；`lazy` 版按需加载重型解析器                                |
| `./stream`                                 | 流式调用的负载校验、序号与背压额度检查                                                            |
| `./binary`、`./binary/lazy`、`./binary/capture`、`./binary/inspect` | 二进制数据的捕获、清单生成、还原与完整性 / 大小检查                       |
| `./schema/wire-error`                      | 错误树的 JSON Schema（随包发布的 JSON 文件）                                                      |

## 示例

**Content-Length 分帧**（数据可以任意切块到达）：

```ts doc-test=run group=readme-framing file=main.ts
import { createJsonRpcFrameDecoder, encodeJsonRpcFrame } from '@migaia/rpc-contract/framing/jsonrpc'

const frame = encodeJsonRpcFrame({ jsonrpc: '2.0', id: 1, method: 'ping', params: { text: '你好' } })

const decoder = createJsonRpcFrameDecoder()
const messages: unknown[] = []
for (let offset = 0; offset < frame.length; offset += 7)
  messages.push(...decoder.push(frame.subarray(offset, offset + 7)))
decoder.finish() // 连接结束时调用：残留半帧会以 JSONRPC_FRAME_INVALID 报错
console.log(messages) // [{ jsonrpc: '2.0', id: 1, method: 'ping', params: { text: '你好' } }]
```

**跨进程 / 跨语言传递错误**：

```ts doc-test=run group=readme-errors file=main.ts
import {
  serializeRpcError,
  deserializeRpcError,
  toJsonRpcError,
  fromJsonRpcError
} from '@migaia/rpc-contract/errors'

const original = new RangeError('bad input', { cause: new Error('root cause') })
const wire = serializeRpcError(original, { report: (failure) => console.error(failure) })
const jsonRpcError = toJsonRpcError(wire, -32000) // 错误树放在 error.data.migaiaWireError

const restored = deserializeRpcError(fromJsonRpcError(jsonRpcError))
console.log(restored instanceof RangeError, restored.message) // true 'bad input'
console.log((restored.cause as Error).message) // 'root cause'
```

## 错误

本包错误的 source 为 `@migaia/rpc/contract`（常量 `RPC_CONTRACT_SOURCE`），code 取自 `RpcContractErrorCode`：

`INVALID_DESCRIPTOR`、`INVALID_ENVELOPE`、`INVALID_STREAM`、`INVALID_FRAME`、`FRAME_LIMIT_EXCEEDED`、`FRAME_ASSEMBLY_EXPIRED`、`INVALID_WIRE_ERROR`、`HANDSHAKE_INVALID`、`HANDSHAKE_INCOMPATIBLE`、`HANDSHAKE_REJECTED`。

Content-Length 分帧错误使用 JSON-RPC 桥的身份 `@migaia/rpc/bridge/jsonrpc`（`JsonRpcBridgeErrorCode`）。各错误码的含义与处理见 [USEGUIDE 第 8 节](./USEGUIDE.md#8-错误码)。

## 相关包

| 包                                                            | 关系                                       |
| ------------------------------------------------------------- | ------------------------------------------ |
| [`@migaia/rpc-core`](../rpc-core/README.md)                   | 使用本包实现 Endpoint、调用与连接          |
| [`@migaia/rpc-bridge-jsonrpc`](../rpc-bridge-jsonrpc/README.md) | 基于本包的 Content-Length 分帧与错误转换 |
| [`@migaia/serialize`](../serialize/README.md)                 | 可移植数据遍历的底层实现                   |

各入口的详细用法见 [USEGUIDE](./USEGUIDE.md)。
