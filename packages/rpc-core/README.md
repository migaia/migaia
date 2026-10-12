# `@migaia/rpc-core`

**RPC 的运行时无关核心。** 定义一次调用从发出到返回的全部语义：路由、超时、取消、分组、幂等、并发准入、错误还原、生命周期，并提供两层 API：

- **Runtime Peer**（`@migaia/rpc-core/remote`）：`request` / `notify` / `stream` / `group` / `outcome`，按方法路径调用，带类型推导。进程、线程、浏览器、桥接包都在这一层上构建。
- **Endpoint**（包根）：`createEndpoint` + 中间件，`send` / `provide`，用于在任意载体（iframe、BroadcastChannel、MessagePort 等）上自行组装。

本包不包含任何平台代码：没有 `node:` 导入，也不依赖 DOM。启动进程、创建 Worker 由其它包负责。

## 我应该用哪个包？

| 需求                                              | 使用                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| 调用子进程或本机其它进程                          | [`@migaia/rpc-process`](../rpc-process/README.md)                        |
| 调用 Worker 线程                                  | [`@migaia/rpc-threads`](../rpc-threads/README.md)                        |
| iframe、SharedWorker、可靠有序的 RTCDataChannel   | [`@migaia/rpc-browser`](../rpc-browser/README.md) 的 `createBrowserPeer` |
| 标签页广播、Service Worker、WebTransport datagram | `rpc-browser` transport + 本包的 Endpoint                                |
| 调用 Python / Go / Rust 服务                      | [`@migaia/rpc-bridge-jsonrpc`](../rpc-bridge-jsonrpc/README.md)          |
| 在单元测试里模拟两个对端                          | 本包 `./testing` 的 `createPeerPair`                                     |
| 已有 `MessagePort` 或 Dedicated Worker            | 本包 `./adapters/message-port`、`./adapters/web-worker` + Endpoint       |
| 为新平台或新载体写适配器                          | 本包 `./adapter`                                                         |

## 安装

```bash
pnpm add @migaia/rpc-core @migaia/rpc-contract
```

`@migaia/rpc-contract` 是 peer 依赖，两者版本必须一致（当前 `0.0.7`）。运行时依赖 `@migaia/lifecycle`、`@migaia/plugin-host`、`@migaia/event-subscriber`、`@migaia/serialize`、`@migaia/supervision`、`@migaia/utils`，随包安装。

同一个页面或进程里只能加载一份 `@migaia/rpc-core`。依赖解析出两份副本时，第二份在取得任何资源前抛出 `@migaia/rpc/core` / `DUPLICATE_MODULE_INSTANCE`；请修正依赖，让所有 RPC 包解析到同一份。不同 Worker 各自独立，不受影响。

## 入口一览

| 入口                                                              | 内容                                                                                                                                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@migaia/rpc-core`                                                | `createEndpoint`、中间件（`connect`、`contract`、`protocol`、`codec`、`framer`、`abort`、`timeout`、`ping`、`authentication`、`hooks`、`uuid`）、错误码与错误守卫、`createRpcIdempotencyStore` |
| `./remote`                                                        | `createRuntimePeer`、`createManagedRuntimePeer`、`createRuntimePlugin`、出口与事件常量、`RPC_REMOTE_ERROR_SOURCE`                                                                              |
| `./testing`                                                       | `createPeerPair`：内存中两个真实 Peer，用于测试                                                                                                                                                |
| `./adapters/memory`                                               | `createMemoryTransportPair`                                                                                                                                                                    |
| `./adapters/message-port`                                         | `createNodeMessagePortTransport`、`createBrowserMessagePortTransport`                                                                                                                          |
| `./adapters/web-worker`                                           | `createWebWorkerTransport`                                                                                                                                                                     |
| `./client`、`./provider`、`./full`、`./composed`                  | 只装需要的能力的 Endpoint 工厂，减小打包体积                                                                                                                                                   |
| `./features/*`、`./stream`                                        | 供 `./composed` 选择的功能模块                                                                                                                                                                 |
| `./plugins/log`、`./plugins/send-queue`、`./plugins/flow-control` | IPC 日志、发送队列等可选中间件                                                                                                                                                                 |
| `./transport-kit`、`./transport-constants`                        | 编写自定义 transport 的工具与常量                                                                                                                                                              |
| `./adapter`                                                       | `defineMessageAdapter`、`defineByteAdapter`：运行时适配器作者的任务级构造函数（见 USEGUIDE 第 9 节）                                                                                           |
| `./probe`                                                         | Probe 类型、数值常量与名称表、`defineProbe`、`snapshotProbeEvent`、`rpcProbeSampleKey` 与 Endpoint 安装入口 `probePlugin`                                                                              |

## 快速开始

**在测试里模拟两个对端**（真实的 Peer 与调用路径，内存传输）：

```ts doc-test=run group=readme-peer-pair file=main.ts
import { createPeerPair } from '@migaia/rpc-core/testing'

const pair = await createPeerPair({
  a: { provide: { echo: (text: string) => text } },
  b: { provide: { double: (value: number) => value * 2 } }
})
/** 两个实际 Peer 都在模块作用域结束时调用原 close。 */
await using client = pair.a
await using server = pair.b
console.log(await client.request('double', 21)) // 42：a 调用 b 提供的方法
console.log(await server.request('echo', 'ready')) // 'ready'
```

**在任意载体上组装 Endpoint**（这里用内存载体演示，换成 iframe、MessagePort 等时只换 transport）：

```ts doc-test=run group=readme-endpoints file=main.ts
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

## Probe

`@migaia/rpc-core/probe` 在 Core Peer 或 Endpoint 上安装同步观察。默认只读元数据；请求、返回值与错误保持原有语义。下面的 `connect` 示例使用实际 MessagePort。当前 managed Thread spawn 与 Process `spawn: true` 的选项重建没有转发 `probe`，这些路径的跨包观察仍待补齐。

```ts doc-test=run group=readme-probe-peer file=main.ts
import assert from 'node:assert/strict'
import { MessageChannel } from 'node:worker_threads'
import { createThreadPeer, createNodeThreadChannel } from '@migaia/rpc-threads'
import { systemScheduler } from '@migaia/utils/scheduler'
import { defineProbe, RpcProbeStageName } from '@migaia/rpc-core/probe'

/** 调用方已有的对象保留同一身份，定义 Probe 后被冻结。 */
const host = { name: 'metrics' }
/** 同步计数确认示例实际收到了元数据，未保留复用 view。 */
let observedEvents = 0
/** 此 Probe 只读 message 元数据，不捕获业务内容。 */
const probe = defineProbe({
  stages: ['message'],
  emit(view) {
    observedEvents += 1
    console.log(RpcProbeStageName[view.stage], view.method, view.durationMs)
  }
}, host)
console.log(probe === host, Object.isFrozen(host), probe.name) // true, true, 'metrics'

/** 创建方拥有实际 MessagePort；Peer 只负责自己的 Endpoint。 */
const { port1, port2 } = new MessageChannel()
try {
  const [client, server] = await Promise.all([
    createThreadPeer<{ echo(value: string): string }>({
      self: { name: 'client', instanceId: 'probe-client' }, probe,
      connect: async (context) => createNodeThreadChannel(port1, 'probe-server', {
        scheduler: systemScheduler, capabilities: context.capabilities
      })
    }),
    createThreadPeer({
      self: { name: 'server', instanceId: 'probe-server' }, provide: { echo: (value: string) => value },
      connect: async (context) => createNodeThreadChannel(port2, 'probe-client', {
        scheduler: systemScheduler, capabilities: context.capabilities
      })
    })
  ])
  await using observed = client
  await using provider = server
  assert.equal(await observed.request('echo', 'ready'), 'ready')
  assert.ok(observedEvents > 0)
} finally {
  port1.close()
  port2.close()
}
```

Endpoint 用户把 `probePlugin` 放进既有 `middlewares`；它不会创建 transport：

```ts doc-test=run group=readme-probe-endpoint file=main.ts
import assert from 'node:assert/strict'
import { connect, createEndpoint } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'
import { defineProbe, probePlugin } from '@migaia/rpc-core/probe'

/** 在同步回调中读标量，不保留复用 view。 */
let events = 0
const probe = defineProbe({ stages: ['message'], emit() { events += 1 } })
const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({ id: 'server', transport: right, middlewares: [connect({ transport: right })] })
server.provide('echo', (context) => context.success(context.data))
const client = await createEndpoint({ id: 'client', targetIds: ['server'], transport: left, middlewares: [probePlugin(probe), connect({ transport: left })] })
try {
  assert.equal(await client.send('server', 'echo', 'ready'), 'ready')
  assert.ok(events > 0)
} finally {
  await client.dispose()
  await server.dispose()
}
```

`defineProbe(definition, host)` 直接为 `host` 添加五个 Probe 字段、注册私有状态并冻结该对象，返回 `THost & IRpcProbe`，与 `host` 为同一引用；原有成员保持不变，包括已有的 `emit`。私有状态持有 `definition.emit`，不会用它覆盖 host 的方法。省略 `host` 时沿用独立 handle 形式。`host` 必须是可扩展且未冻结的非 null 对象，不能已有这五个 Probe 字段或已注册为 Probe；验证失败时对象保持原样。

事件 view 仅在 `emit` 调用期间有效。需保留它时显式调用 `snapshotProbeEvent(view)`（SC9c）；快照复制顶层字段，`detail`、`error` 与 `content` 仍保留引用，调用方稍后修改对象时这些引用可见修改。录制 codec 在格式转换边界形成新表示（SC9b）。`methods` 只过滤 `message` 与 `envelope`；其它阶段只按采样过滤。采样使用 `(senderId, messageId)` 的稳定 FNV-1a 32 位键。

`capture` 默认关闭，必须显式列出需要捕获内容的阶段，且定义时为 `stages` 的子集。`protected` 内容也须显式启用，并只在认证保护路径存在时产生。`setStages([])` 暂停；恢复时设置所需阶段，原 `captureMask` 保持不变。host 的公开 `stageMask` 为初始定义值，后续选择保存在私有状态；独立 handle 的 getter 则反映当前值。详细契约见 [USEGUIDE 的 Probe 节](./USEGUIDE.md#13-probe)。

## 高阶用法：编写适配器

已有消息端口或有序字节流时，用 `defineMessageAdapter` / `defineByteAdapter` 的 `open` 取得真实资源，再调用定义返回的 `peer` 或 `plugin`。通信、握手、治理和关闭沿用原 Core owner。完整可运行的 MessagePort、Host 与字节流例子见 [USEGUIDE 第 9 节](./USEGUIDE.md#9-高阶用法编写一个适配器)。

`./adapter/internal-advanced` 是仓库内原生 Process、Threads 与 Bridge 的低级接入入口；网站用户 API 索引以这两个任务级定义函数为适配器作者的起点。安装包仍保留原生包需要的实际导出。

## 调用语义速览

Runtime Peer 支持 `await using`，其 `Symbol.asyncDispose` 就是原来的 `close` 函数，保留相同 Promise 与错误。Core 的 `createRuntimePeer` 可以省略 `self` 与 `report`：生成本地身份，后台错误默认交给 `console.error`。

独立 Peer 的 `on(event, listener)` 使用与 Host 出口相同的事件投影；返回的取消函数可重复调用。首次 ready 由 factory 的 `await` 表示，订阅不重放它。受监督的 Peer 只发布真实重启后的 ready 和原 supervisor 的 exit/restart/degraded；listener 只发布真实接受的 session ready。raw Peer 没有原生执行生命周期，不伪造 exit，也没有后续 ready。事件不能代替 `close` 或 `await using` 释放资源。完整可执行例子见 [USEGUIDE 第 2.5 节](./USEGUIDE.md#25-作用域释放与真实生命周期事件)。

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

| source               | 常量                      | code 表                   |
| -------------------- | ------------------------- | ------------------------- |
| `@migaia/rpc/core`   | `RPC_CORE_ERROR_SOURCE`   | `RpcCoreErrorCode`        |
| `@migaia/rpc/remote` | `RPC_REMOTE_ERROR_SOURCE` | `RpcRemoteLayerErrorCode` |

按 `(source, code)` 分支，不要匹配 `message`。跨 Worker、iframe 或模块副本时，用 `isRpcErrorInstance`、`isRpcRemoteError`、`isRpcTimeoutError` 判断错误族，而不是 `instanceof`。全部错误码及处理建议见 [USEGUIDE 第 10 节](./USEGUIDE.md#10-错误码与处理)。

## 相关包

| 包                                                              | 关系                                 |
| --------------------------------------------------------------- | ------------------------------------ |
| [`@migaia/rpc-contract`](../rpc-contract/README.md)             | 线上格式与协议工具；peer 依赖        |
| [`@migaia/rpc-process`](../rpc-process/README.md)               | 跨进程                               |
| [`@migaia/rpc-threads`](../rpc-threads/README.md)               | Worker 线程                          |
| [`@migaia/rpc-browser`](../rpc-browser/README.md)               | 浏览器 Runtime Peer 与 Endpoint 载体 |
| [`@migaia/rpc-bridge-jsonrpc`](../rpc-bridge-jsonrpc/README.md) | 其它语言                             |
| [`@migaia/plugin-host`](../plugin-host/README.md)               | `createRuntimePlugin` 安装的宿主     |

完整用法见 [USEGUIDE](./USEGUIDE.md)。
