# `@migaia/rpc-bridge-jsonrpc`

**与非 TypeScript 语言互通的 JSON-RPC 桥。** 让 Node / Bun / Deno 端用与其它 RPC 包相同的 `request` / `notify` 调用 Python、Go、Rust 等语言实现的服务。对端只需要实现标准 JSON-RPC 2.0（Content-Length 分帧），再加四个 `migaia.*` 扩展方法，不需要引入任何 migaia 的库。

## 适用与不适用场景

**适用：**

- 主程序是 TypeScript，部分能力由 Python / Go / Rust 等语言的子进程或本机服务提供。
- 对端已经有 JSON-RPC 实现，或者希望用最少的代码接入。

**不适用：**

- 对端也是 TypeScript：直接用 [`@migaia/rpc-process`](../rpc-process/README.md) 的原生协议，功能更全。
- 需要 `stream`（流式返回）或 `transfer`：桥接协议不支持，包含 stream 方法的声明会以 `JSONRPC_UNSUPPORTED_MODE` 拒绝。

## 安装

```bash
pnpm add @migaia/rpc-bridge-jsonrpc @migaia/rpc-process @migaia/rpc-core @migaia/rpc-contract
```

`@migaia/rpc-core`、`@migaia/rpc-contract`、`@migaia/rpc-process` 是 peer 依赖，版本必须与本包完全一致（当前 `0.0.7`）。本包通过 `@migaia/rpc-process` 获得子进程或 socket 的字节通道。

## 工作方式

```text
TypeScript（本包）                              对端（任意语言）
createProcessPeer({ spawn: { command, args, wire: 'jsonrpc', contract } })
  └─ JSON-RPC bridge ── Content-Length + JSON-RPC 2.0 ──► migaia.hello     认证与能力协商
                                                                     migaia.describe  返回可调用方法目录
     request('math.add', …)  ───────────────────────────────────────► migaia.invoke   执行业务方法
     取消                    ───────────────────────────────────────► migaia.cancel   取消在途调用
```

1. 本包在你提供的字节通道上发送 `migaia.hello`，携带会话 token。对端校验后回复 accept，并列出它实现的四个扩展方法。
2. 本包调用 `migaia.describe` 获取对端的方法目录。之后只有目录中的方法可以调用。
3. 每次 `request` 被翻译为一次 `migaia.invoke`。`notify` 是不带 `id` 的 `migaia.invoke`，对端不回复。多个并发调用会合并成 JSON-RPC 批量数组发送。
4. 对端返回的错误会被还原为带 `(source, code)` 的错误对象。

## 快速开始

TypeScript 端启动一个 Python 子进程并调用它（对端实现见 [USEGUIDE 第 4 节](./USEGUIDE.md#4-对端最小实现python)，约 100 行，只用标准库）：

```ts doc-test=run group=python-bridge file=main.ts
import { fileURLToPath } from 'node:url'
import { createProcessPeer } from '@migaia/rpc-process'
import type { IRemoteContract } from '@migaia/rpc-core/remote'

type IPythonApi = { echo(values: string[]): string[]; math: { add(values: number[]): number } }
/** This is the peer-specific local declaration; the accepted remote directory still owns routing. */
const contract: IRemoteContract = {
  schemaVersion: 1, plugin: 'python-service',
  features: { math: { methods: { add: { mode: 'request', idempotent: false } } } }
}
const peer = await createProcessPeer<IPythonApi>({
  spawn: { command: 'python3', args: [fileURLToPath(new URL('./service.py', import.meta.url))], wire: 'jsonrpc', contract }
})
try {
  console.log(await peer.request('echo', ['hello', 'python'])) // ['hello', 'python']
  console.log(await peer.request('math.add', [20, 22])) // 42
  await peer.notify('echo', ['notification'])
  console.log(await Promise.all([peer.request('math.add', [1, 2]), peer.request('math.add', [3, 4])])) // [3, 7]
  try { await peer.request('math.add', []) }
  catch (error) {
    const detail = error as { source?: string; code?: string }
    if (detail.source !== 'python-service' || detail.code !== 'BUSINESS') throw error
    console.log(detail.code) // BUSINESS
  }
} finally { await peer.close() }
```

`spawn` 保留子进程的监督、退出与 budget 所有权；`peer.close()` 关闭连接和子进程。只需声明对端特有的 command、args、wire 与本地 contract；launcher、预算、随机 stdin token 和桥接握手由既有操作组合。需要自有字节通道时，仍可使用 `createJsonRpcRemoteChannel`，见 USEGUIDE。文档检查器将本段与 USEGUIDE 的 `service.py` 联合执行；缺少 `python3` 时报告 SKIP-WARN。

## 错误

| source                          | 典型 code                                              | 含义                                         |
| ------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| `@migaia/rpc/bridge/jsonrpc`    | `JSONRPC_FRAME_INVALID`、`JSONRPC_EXTENSION_MISSING`、`JSONRPC_PROFILE_INVALID`、`JSONRPC_UNSUPPORTED_MODE`、`JSONRPC_HANDSHAKE_TIMEOUT` | 分帧、扩展方法、配置、模式或握手问题 |
| `@migaia/rpc/core`              | `DEADLINE_EXCEEDED`、`CANCELLED`、`PROVIDER_NOT_FOUND` | 调用层错误                                    |

通过 Peer 调用时，对端业务错误按原始类型、source / code、stack 和原因链恢复。Python 示例的业务错误携带 `python-service` / `BUSINESS`；这些字段只用于诊断，不获得本地控制身份。详见 [USEGUIDE 第 6 节](./USEGUIDE.md#6-错误处理)。

## 相关包

| 包                                                  | 关系                                         |
| --------------------------------------------------- | -------------------------------------------- |
| [`@migaia/rpc-process`](../rpc-process/README.md)   | 提供子进程与本机 socket 字节通道             |
| [`@migaia/rpc-core`](../rpc-core/README.md)         | `createRuntimePeer` 与调用语义               |
| [`@migaia/rpc-contract`](../rpc-contract/README.md) | Content-Length 分帧工具、错误码常量、wire 错误转换 |

完整的对端协议说明、Python 参考实现与错误处理见 [USEGUIDE](./USEGUIDE.md)。

Carrier observation 仍待接入：计划通过 `transport.observe(probe)` 为每个实际 JSON-RPC 消息或 batch
报告 `jsonrpcId`、`jsonrpcMethod`、`batchSize`，默认只采集 metadata，开启 capture 后保留内容引用。
当前翻译与最终 transport 归 `rpc-core/src/runtime-adapter/jsonrpc` 和
`rpc-core/src/runtime-adapter/object` 所有，公开 Bridge factory 委托这些唯一实现；最终 IPC 队列没有转发
`observe`。在这些 owner 提供观察接入点前，本包不额外解析字节、不包装逻辑消息，也不宣称此能力已实现。
