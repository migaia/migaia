# `@migaia/rpc-core`

**RPC 的运行时无关核心。** 定义一次调用从发出到返回的全部语义：路由、超时、取消、分组、幂等、并发准入、错误还原、生命周期，并提供两层 API：

- **Runtime Peer**（`@migaia/rpc-core/remote`）：`request` / `notify` / `stream` / `group` / `outcome`，按方法路径调用，带类型推导。进程、线程、桥接包都在这一层上构建。
- **Endpoint**（包根）：`createEndpoint` + 中间件，`send` / `provide`，用于在任意载体（iframe、BroadcastChannel、MessagePort 等）上自行组装。

本包不包含任何平台代码：没有 `node:` 导入，也不依赖 DOM。启动进程、创建 Worker 由其它包负责。

## 我应该用哪个包？

| 需求                                         | 使用                                                              |
| -------------------------------------------- | ----------------------------------------------------------------- |
| 调用子进程或本机其它进程                     | [`@migaia/rpc-process`](../rpc-process/README.md)                 |
| 调用 Worker 线程                             | [`@migaia/rpc-threads`](../rpc-threads/README.md)                 |
| iframe、标签页、SharedWorker、Service Worker | [`@migaia/rpc-browser`](../rpc-browser/README.md) + 本包的 Endpoint |
| 调用 Python / Go / Rust 服务                 | [`@migaia/rpc-bridge-jsonrpc`](../rpc-bridge-jsonrpc/README.md)   |
| 在单元测试里模拟两个对端                     | 本包 `./testing` 的 `createPeerPair`                              |
| 已有 `MessagePort` 或 Dedicated Worker       | 本包 `./adapters/message-port`、`./adapters/web-worker` + Endpoint |
| 为新平台或新载体写适配器                     | 本包 `./adapter`                                                  |

## 安装

```bash
pnpm add @migaia/rpc-core @migaia/rpc-contract
```

`@migaia/rpc-contract` 是 peer 依赖，两者版本必须一致（当前 `0.0.7`）。运行时依赖 `@migaia/lifecycle`、`@migaia/plugin-host`、`@migaia/event-subscriber`、`@migaia/serialize`、`@migaia/supervision`、`@migaia/utils`，随包安装。

同一个页面或进程里只能加载一份 `@migaia/rpc-core`。依赖解析出两份副本时，第二份在取得任何资源前抛出 `@migaia/rpc/core` / `DUPLICATE_MODULE_INSTANCE`；请修正依赖，让所有 RPC 包解析到同一份。不同 Worker 各自独立，不受影响。

## 入口一览

| 入口                                   | 内容                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `@migaia/rpc-core`                     | `createEndpoint`、中间件（`connect`、`contract`、`protocol`、`codec`、`framer`、`abort`、`timeout`、`ping`、`authentication`、`hooks`、`uuid`）、错误码与错误守卫、`createRpcIdempotencyStore` |
| `./remote`                             | `createRuntimePeer`、`createManagedRuntimePeer`、`createRuntimePlugin`、出口与事件常量、`RPC_REMOTE_ERROR_SOURCE` |
| `./testing`                            | `createPeerPair`：内存中两个真实 Peer，用于测试                                      |
| `./adapters/memory`                    | `createMemoryTransportPair`                                                          |
| `./adapters/message-port`              | `createNodeMessagePortTransport`、`createBrowserMessagePortTransport`                |
| `./adapters/web-worker`                | `createWebWorkerTransport`                                                           |
| `./client`、`./provider`、`./full`、`./composed` | 只装需要的能力的 Endpoint 工厂，减小打包体积                               |
| `./features/*`、`./stream`             | 供 `./composed` 选择的功能模块                                                       |
| `./plugins/log`、`./plugins/send-queue`、`./plugins/flow-control` | IPC 日志、发送队列等可选中间件                          |
| `./transport-kit`、`./transport-constants` | 编写自定义 transport 的工具与常量                                                |
| `./adapter`                            | 运行时适配器作者用的构造函数（见 USEGUIDE 第 9 节）                                  |

## 快速开始

**在测试里模拟两个对端**（真实的 Peer 与调用路径，内存传输）：

```ts
import { createPeerPair } from '@migaia/rpc-core/testing'

const pair = await createPeerPair({
  a: { provide: { echo: (text: string) => text } },
  b: { provide: { double: (value: number) => value * 2 } }
})
try {
  console.log(await pair.a.request('double', 21)) // 42：a 调用 b 提供的方法
  console.log(await pair.b.request('echo', 'ready')) // 'ready'
} finally {
  await Promise.all([pair.a.close(), pair.b.close()])
}
```

**在任意载体上组装 Endpoint**（这里用内存载体演示，换成 iframe、MessagePort 等时只换 transport）：

```ts
import { connect, createEndpoint } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'

const [left, right] = createMemoryTransportPair()

const server = await createEndpoint({
  id: 'server',
  transport: right,
  middlewares: [connect({ transport: right })]
})
server.provide('add', (context) => {
  const [a, b] = context.data as [number, number]
  return context.success(a + b)
})

const client = await createEndpoint({
  id: 'client',
  targetIds: ['server'],
  transport: left,
  middlewares: [connect({ transport: left })]
})
console.log(await client.send<number>('server', 'add', [20, 22])) // 42

await client.dispose()
await server.dispose()
```

## 调用语义速览

这些规则对所有 RPC 包都成立：

- **超时**：`request` / `stream` 默认 30000 ms；单次调用用 `timeoutMs` 覆盖，`false` 关闭。
- **取消**：`signal` 取消是协作式的，本地放弃等待，不保证对端没有开始执行。`cancel: 'before-start'` 只在对端尚未开始时撤销。
- **notify**：只保证已发出，不代表对端执行成功。
- **group**：一组 request 按顺序执行，失败后的步骤为 `not-executed`，**不回滚**。
- **幂等**：带 `idempotencyKey` 的调用可用 `outcome(key)` 查询结果，`pending` / `done` / `unknown`。
- **并发准入**：每个对端最多 64 个、全局最多 256 个同时执行的入站调用；超出返回 `OVERLOADED`，对端函数不被调用。
- **错误还原**：对端抛出的错误还原为原生类型，保留 `message`、`stack` 与 `cause` 链。
- **重试**：超时、取消、断线、`unknown` 都**不能证明对端没执行**。重试非幂等操作前先对账。

## 错误

| source                 | 常量                      | code 表                   |
| ---------------------- | ------------------------- | ------------------------- |
| `@migaia/rpc/core`     | `RPC_CORE_ERROR_SOURCE`   | `RpcCoreErrorCode`        |
| `@migaia/rpc/remote`   | `RPC_REMOTE_ERROR_SOURCE` | `RpcRemoteLayerErrorCode` |

按 `(source, code)` 分支，不要匹配 `message`。跨 Worker、iframe 或模块副本时，用 `isRpcErrorInstance`、`isRpcRemoteError`、`isRpcTimeoutError` 判断错误族，而不是 `instanceof`。全部错误码及处理建议见 [USEGUIDE 第 10 节](./USEGUIDE.md#10-错误码与处理)。

## 相关包

| 包                                                              | 关系                                       |
| --------------------------------------------------------------- | ------------------------------------------ |
| [`@migaia/rpc-contract`](../rpc-contract/README.md)             | 线上格式与协议工具；peer 依赖              |
| [`@migaia/rpc-process`](../rpc-process/README.md)               | 跨进程                                     |
| [`@migaia/rpc-threads`](../rpc-threads/README.md)               | Worker 线程                                |
| [`@migaia/rpc-browser`](../rpc-browser/README.md)               | 浏览器载体                                 |
| [`@migaia/rpc-bridge-jsonrpc`](../rpc-bridge-jsonrpc/README.md) | 其它语言                                   |
| [`@migaia/plugin-host`](../plugin-host/README.md)               | `createRuntimePlugin` 安装的宿主           |

完整用法见 [USEGUIDE](./USEGUIDE.md)。
