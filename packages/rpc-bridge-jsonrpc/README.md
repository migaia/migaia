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
createRuntimePeer
  └─ createJsonRpcRemoteChannel ── Content-Length + JSON-RPC 2.0 ──► migaia.hello     认证与能力协商
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

```ts
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createJsonRpcRemoteChannel } from '@migaia/rpc-bridge-jsonrpc'
import { createRuntimePeer } from '@migaia/rpc-core/remote'
import type { IRemoteContract, IRuntimeTypedPeer } from '@migaia/rpc-core/remote'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
import { RpcCapability } from '@migaia/rpc-contract'
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'

type IPythonApi = {
  echo: (values: string[]) => string[]
  math: { add: (pair: [number, number]) => number }
}
// 本地声明：桥接只用它做调用前校验（必须没有 stream 方法）。可调用目录以对端 describe 为准。
const contract: IRemoteContract = {
  schemaVersion: 1,
  plugin: 'python-service',
  features: { math: { methods: { add: { mode: 'request', idempotent: true } } } }
}
const report = (error: unknown) => console.error(error)
const launcher = createNodeProcessLauncher()
const token = randomBytes(32).toString('base64url')
let handle: Awaited<ReturnType<typeof launcher.launch>> | undefined

// createRuntimePeer 本身不带泛型；用 IRuntimeTypedPeer 标注远端方法类型。
const python = (await createRuntimePeer({
  self: { name: 'node-client', instanceId: 'node-client-1' },
  connect: async (context) => {
    handle = await launcher.launch(
      {
        command: 'python3',
        args: [fileURLToPath(new URL('./service.py', import.meta.url))],
        env: { inherit: ['PATH'], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
      },
      { signal: new AbortController().signal, output: () => undefined }
    )
    return createJsonRpcRemoteChannel({
      byte: handle.channel!,
      peerId: 'python-service',
      target: { kind: 'plugin', contract },
      offer: {
        versions: [{ major: 1, minor: 1 }],
        peer: { id: context.self.instanceId, runtime: 'node' },
        capabilities: [RpcCapability.deadline, RpcCapability.trace]
      },
      token,
      scheduler: systemScheduler,
      wallClock: systemWallClock,
      ipc: { connectionId: 'python-1', sessionId: 'python-1', log: () => undefined },
      report
    })
  },
  report
})) as IRuntimeTypedPeer<IPythonApi>
try {
  console.log(await python.request('echo', ['hello', 'python'])) // ['hello', 'python']
  console.log(await python.request('math.add', [20, 22])) // 42
} finally {
  await python.close() // 关闭本端连接
  handle?.terminate('force') // 子进程由启动它的 launcher 负责结束
  await handle?.exited
}
```

`connect` 来源只拥有这条连接，不拥有子进程，所以示例在 `finally` 中自己结束子进程。

## 错误

| source                          | 典型 code                                              | 含义                                         |
| ------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| `@migaia/rpc/bridge/jsonrpc`    | `JSONRPC_FRAME_INVALID`、`JSONRPC_EXTENSION_MISSING`、`JSONRPC_PROFILE_INVALID`、`JSONRPC_UNSUPPORTED_MODE`、`JSONRPC_HANDSHAKE_TIMEOUT` | 分帧、扩展方法、配置、模式或握手问题 |
| `@migaia/rpc/core`              | `DEADLINE_EXCEEDED`、`CANCELLED`、`PROVIDER_NOT_FOUND` | 调用层错误                                    |

对端业务方法抛出的错误以 `RpcRemoteError` 呈现，对端给出的 source / code 保留在 `cause` 上。详见 [USEGUIDE 第 6 节](./USEGUIDE.md#6-错误处理)。

## 相关包

| 包                                                  | 关系                                         |
| --------------------------------------------------- | -------------------------------------------- |
| [`@migaia/rpc-process`](../rpc-process/README.md)   | 提供子进程与本机 socket 字节通道             |
| [`@migaia/rpc-core`](../rpc-core/README.md)         | `createRuntimePeer` 与调用语义               |
| [`@migaia/rpc-contract`](../rpc-contract/README.md) | Content-Length 分帧工具、错误码常量、wire 错误转换 |

完整的对端协议说明、Python 参考实现与错误处理见 [USEGUIDE](./USEGUIDE.md)。
