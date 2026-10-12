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
import { createProcessPeer } from '@migaia/rpc-process'
import { createNodeProcessLauncher } from '@migaia/rpc-process/adapters/node-child-process'
import { createJsonRpcRemoteChannel } from '@migaia/rpc-bridge-jsonrpc'
import type { IRemoteContract } from '@migaia/rpc-core/remote'
import { createUnitBudget } from '@migaia/supervision'
import { RpcCapability } from '@migaia/rpc-contract'
import { systemWallClock } from '@migaia/utils/scheduler'

/** The standard-library responder receives positional JSON-RPC arguments. */
type IPythonApi = { echo(values: string[]): string[]; math: { add(pair: [number, number]): number } }
/** A local scalar contract is checked before the remote directory becomes callable. */
const contract: IRemoteContract = {
  schemaVersion: 1,
  plugin: 'python-service',
  features: { math: { methods: { add: { mode: 'request', idempotent: true } } } }
}
/** Record only classified diagnostic messages, never the ephemeral session credential. */
const report = (error: unknown) => console.error(error)
/** One token belongs to this supervised child and is written through its original stdin frame. */
const token = randomBytes(32).toString('base64url')
/** The exact real launcher retains child execution and termination ownership. */
const launcher = createNodeProcessLauncher()
/** Closing the public Peer must release its genuine process budget. */
const budget = createUnitBudget({ kind: 'process', maxUnits: 1 })
/** Public generic construction supplies the remote method type without a Peer cast. */
const peer = await createProcessPeer<IPythonApi>({
  self: { name: 'node-client', instanceId: 'node-client-1' },
  report,
  spawn: {
    kind: 'spawn', channelKind: 'byte', wire: 'jsonrpc', token,
    supervision: {
      id: 'python-service', isolation: 'best-effort', restart: { mode: 'never' }, budget,
      report, launcher,
      spec: {
        command: 'python3', args: [fileURLToPath(new URL('./service.py', import.meta.url))],
        env: { inherit: ['PATH'], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
      }
    },
    rawChannel: async (handle) => (handle as Awaited<ReturnType<typeof launcher.launch>>).channel!,
    establish: async (raw, prepared) => {
      if (raw.kind !== 'byte') throw new TypeError('This example requires a byte channel')
      return createJsonRpcRemoteChannel({
        byte: raw, peerId: 'python-service', target: { kind: 'plugin', contract },
        offer: {
          versions: [{ major: 1, minor: 1 }],
          peer: { id: 'node-client-1', runtime: 'node' },
          capabilities: [RpcCapability.deadline, RpcCapability.trace]
        },
        token: prepared.token!, scheduler: prepared.scheduler, wallClock: systemWallClock,
        ipc: { ...prepared.session, log: () => undefined }, signal: prepared.signal,
        report
      })
    }
  }
})
try {
  console.log(await peer.request('echo', ['hello', 'python'])) // ['hello', 'python']
  console.log(await peer.request('math.add', [20, 22])) // 42
} finally {
  await peer.close() // 关闭连接、结束监督子进程并释放 budget
}
```

`spawn` 保留子进程的监督、退出与 budget 所有权；`peer.close()` 负责关闭连接和子进程。`establish` 收到当前代次的 token、scheduler、session 和取消信号，桥接仍在实际字节连接上完成握手。普通 Core `connect` 来源也可以使用 `createRuntimePeer<IPythonApi>(options)`，无需把返回值断言为 `IRuntimeTypedPeer`。

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
