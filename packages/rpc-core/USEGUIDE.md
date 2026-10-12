# `@migaia/rpc-core` 使用手册

本手册覆盖 Core 的全部公开能力。安装、入口一览与最短示例见 [README](./README.md)。用进程、线程、浏览器或其它语言的具体场景，请先看对应包的文档，它们都建立在本手册描述的语义之上。

## 目录

1. [两层 API：Runtime Peer 与 Endpoint](#1-两层-apiruntime-peer-与-endpoint)
2. [Runtime Peer](#2-runtime-peer)
3. [Plugin 与 Host 出口](#3-plugin-与-host-出口)
4. [Endpoint](#4-endpoint)
5. [中间件](#5-中间件)
6. [载体：内置 transport 与自定义 transport](#6-载体内置-transport-与自定义-transport)
7. [按需组装：减小打包体积](#7-按需组装减小打包体积)
8. [容量、并发与重放窗口](#8-容量并发与重放窗口)
9. [高阶用法：编写一个适配器](#9-高阶用法编写一个适配器)
10. [错误码与处理](#10-错误码与处理)
11. [二进制、转发与重试](#11-二进制转发与重试)
12. [常见问题](#12-常见问题)
13. [Probe](#13-probe)

---

## 1. 两层 API：Runtime Peer 与 Endpoint

| 层             | 入口                       | 调用方式                                                  | 适合                                                   |
| -------------- | -------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| Runtime Peer   | `@migaia/rpc-core/remote`  | `peer.request('math.double', 21)`，方法目录由 `provide` 自动生成，带类型推导 | 进程、线程、桥接；Host 管理的连接                      |
| Endpoint       | `@migaia/rpc-core`         | `endpoint.provide(name, handler)`、`endpoint.send(target, name, data)` | iframe、标签页、MessagePort 等浏览器载体；自定义协议组装 |

两层共享同一套调用语义（超时、取消、错误还原、并发准入）。Runtime Peer 在 Endpoint 之上增加了：握手时交换方法目录、`stream` / `group` / `outcome`、代次与重启、Host 出口。

## 2. Runtime Peer

### 2.1 创建

大多数情况下，Runtime Peer 由平台包的工厂创建：`createProcessPeer`、`createThreadPeer`。Core 提供的 `createRuntimePeer(options)` 用于自定义来源：

```ts doc-test=check
import { createRuntimePeer, type IRuntimePeerSource } from '@migaia/rpc-core/remote'

/** 调用方交入实际协议通道的来源；握手和资源仍由该来源的 owner 完成。 */
export function createClientPeer(connect: IRuntimePeerSource) {
  return createRuntimePeer({
    provide: { ping: () => 'pong' },
    connect
  })
}
```

| 选项                         | 说明                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `self`                       | 可省略；Core 生成显示名 `peer` 与唯一 `instanceId`。显式 `{ name, instanceId }` 保持原值，`name` 不用于认证 |
| `provide`                    | 本端提供的方法树（见 2.2）                                                                               |
| `spawn` / `connect` / `listen` | 来源，必须且只能有一个。Core 层是回调形式 `(context) => Promise<channel>`；平台包另有对象形式          |
| `defaultTimeoutMs`           | request / stream 的默认超时，必须是有限正数；不设时为 30000                                              |
| `providerLimits`             | 入站并发上限：`maxPerPeer`（默认 64）、`maxGlobal`（默认 256）、`onRejected` 观察被拒绝的调用             |
| `contract`                   | 显式的方法契约（模式、幂等声明、schema），一般不需要                                                    |
| `keyFactory`、`retryPort`    | 幂等键生成与重试端口，用于自定义重试策略                                                                 |
| `endpointFactory`            | 自定义 Endpoint 组装（例如加入 `authentication` 中间件）                                                 |
| `report`                     | 接收后台错误；省略时使用 `console.error`                                                                 |

来源回调收到的 `context` 包含本端 `self` 与本端实际编译出的能力 `capabilities`。回调必须返回已经完成握手的协议通道，不能伪造能力或身份。

`createManagedRuntimePeer` 在此基础上加入监督（启动、重启、停止）；平台包的 spawn 来源就是用它实现的。

### 2.2 provide：声明可被调用的方法

```ts doc-test=check
/** 方法树是完整数据；调用方把它交给所选平台 factory 的 provide。 */
export const provide = {
  math: {
    double: (value: number) => value * 2,
    slow: async (ms: number) => {
      await new Promise<void>((resolve) => setTimeout(resolve, ms))
      return ms
    }
  },
  feed: {
    count: async function* (limit: number) {
      for (let index = 1; index <= limit; index++) yield index
    }
  }
}
```

- 只读取对象自身的可枚举数据属性；嵌套对象生成点分路径（`math.double`）。
- getter、循环引用、非法名字或重复路径在打开来源之前就会被拒绝。
- 参数与返回值必须可移植：JSON 能表示的数据，以及协商后的 `ArrayBuffer` / `Uint8Array`。`Date`、`Map`、类实例等会被拒绝。
- 方法目录在握手时由库生成并交换。对端只能调用目录里的方法。

### 2.3 调用

| 方法                                    | 返回                       | 说明                                                                                   |
| --------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| `request(method, payload?, options?)`   | `Promise<结果>`            | 等待结果                                                                               |
| `notify(method, payload?, options?)`    | `Promise<void>`            | 只保证已发出，不代表对端执行成功                                                       |
| `stream(method, payload?, options?)`    | `AsyncIterableIterator`    | 惰性，第一次 `next()` 前不发送；提前 `return()` 会通知对端停止                          |
| `group(steps, options?)`                | `Promise<步骤结果[]>`      | `[{ method, payload? }]` 按顺序执行；第一个失败后其余为 `not-executed`；**不回滚**      |
| `outcome(idempotencyKey)`               | `Promise<…>`               | 查询幂等调用的状态：`pending`、`done`（含结果）、`unknown`（不代表未执行）              |
| `describe(options?)`                    | `Promise<对象>`            | 本地查询：身份、连接、方法目录                                                         |
| `close()`                               | `Promise<void>`            | 立即拒绝新调用；已接受的调用执行完毕后关闭。重复调用返回同一个 Promise                  |
| `on(event, listener)`                    | `取消函数`                 | 订阅真实 owner 的后续生命周期事实；取消可重复调用，不重放首次 ready                    |
| `[Symbol.asyncDispose]()`               | `Promise<void>`            | 原 `close` 函数本身，供 `await using` 释放作用域资源                                   |

调用选项：

| 选项             | 说明                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `timeoutMs`      | 截止时间；`false` 关闭默认超时，`0` 立即到期。受来源设置的单次调用上限约束                       |
| `signal`         | 取消，协作式                                                                                      |
| `idempotencyKey` | 幂等键；同键重复调用复用保留的结果                                                                |
| `orderKey`       | 同一 `orderKey` 的调用在对端串行执行                                                              |
| `cancel`         | `'before-start'`：取消时若对端尚未开始执行则撤销，已开始则仍返回真实结果                          |
| `transfer`       | 仅线程：零拷贝转移的 `ArrayBuffer` 列表，需要协商相应能力                                          |

**同步抛错**：方法名、参数或选项不合法时，调用可能在返回 Promise 之前同步抛出。需要统一处理时，把整个调用表达式放进 `try` 块，而不只是在返回的 Promise 上 `.catch`。

### 2.4 类型

下面的独立 Node 示例使用真实 MessageChannel 载体，并在结束时释放两个端口。平台 Peer 的类型来自 Core，方法树与参数仍严格关联。

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createNodeThreadChannel, createThreadPeer } from '@migaia/rpc-threads'
import { systemScheduler } from '@migaia/utils/scheduler'

type IRemoteApi = {
  math: { double: (value: number) => number }
  feed: { count: (limit: number) => AsyncIterableIterator<number> }
}
/** 真实 MessagePort 是业务载体；创建方在最外层释放它们。 */
const { port1, port2 } = new MessageChannel()
try {
  /** 双方在实际端口上确认能力，Peer 仍使用 Core 的同一套调用与类型规则。 */
  const [peer, server] = await Promise.all([
    createThreadPeer<IRemoteApi>({
      self: { name: 'client', instanceId: 'client-1' },
      connect: async (context) => createNodeThreadChannel(port1, 'server-1', {
        scheduler: systemScheduler,
        capabilities: context.capabilities
      })
    }),
    createThreadPeer({
      self: { name: 'server', instanceId: 'server-1' },
      provide: {
        math: { double: (value: number) => value * 2 },
        feed: { count: async function* (limit: number) {
          for (let index = 1; index <= limit; index++) yield index
        } }
      },
      connect: async (context) => createNodeThreadChannel(port2, 'client-1', {
        scheduler: systemScheduler,
        capabilities: context.capabilities
      })
    })
  ])
  try {
    console.log(await peer.request('math.double', 21)) // number：42
    await peer.notify('math.double', 21) // 只确认发出，不确认业务完成
    for await (const value of peer.stream('feed.count', 3)) console.log(value) // number：1、2、3
    console.log(await peer.group([
      { method: 'math.double', payload: 2 },
      { method: 'math.double', payload: 3 }
    ])) // 顺序执行，得到两个步骤结果
    console.log(await peer.outcome('not-issued')) // unknown 不能证明某个业务操作没有执行
  } finally {
    await Promise.all([peer.close(), server.close()])
  }
} finally {
  port1.close()
  port2.close()
}
```

- 流式方法的返回类型要写成 `AsyncIterableIterator<T>`（或 `IterableIterator<T>`），这样 `stream` 才能识别它。
- 不提供泛型时没有可调用的方法类型。需要按字符串动态调用时用 `IRuntimeDynamicSurface`：只放宽编译期检查，运行时仍按对端目录拒绝未知方法。
- `IRuntimeSurface<THost, TPlugin>` 从 Host 与插件定义中提取纯类型，不产生运行时代码。

### 2.5 作用域释放与真实生命周期事件

首次 ready 已经包含在 `await createThreadPeer(...)` / `await createRuntimePeer(...)` 的完成里。`on('ready')` 从订阅时开始，只观察原 registration 后来真正接受的新代次。受监督的 Peer 从原 supervisor 获取 exit/restart/degraded；listener 的 ready 来自实际接受的 session。raw Peer 没有原生执行生命周期，不伪造 exit 或后续 ready。事件不是资源 disposer；释放仍用 `close` 或 `await using`。

下面的 Node Worker 自然退出，由真实 supervisor 发布 exit；父线程等待该事实，然后由 `await using` 释放 Peer：

```ts doc-test=run file=worker.ts
import { createThreadPeer } from '@migaia/rpc-threads'

await createThreadPeer({
  provide: {
    exit: () => {
      // 先回复调用，再自然退出这个实际 Worker。
      setTimeout(() => process.exit(0), 0)
      return true
    }
  }
})
```

```ts doc-test=run file=main.ts
import { createThreadPeer } from '@migaia/rpc-threads'
import type { IRuntimeEvent } from '@migaia/rpc-core/remote'

type IWorkerApi = { exit(): boolean }
/** 作用域结束时直接调用 Peer 原来的 close。 */
await using worker = await createThreadPeer<IWorkerApi>({
  spawn: new URL('./worker.js', import.meta.url)
})
/** 只等待原 supervisor 对实际 Worker 的退出观察，没有自造 ready 或 exit。 */
const exited = new Promise<IRuntimeEvent>((resolve) => worker.on('exit', resolve))
console.log(await worker.request('exit')) // true
console.log((await exited).type) // exit
```

`Symbol.asyncDispose` 与 `close` 是同一函数引用，重复或并发调用保留同一个原 Promise。取消订阅不会停止 Worker；Peer 开始关闭时注销其事件订阅。listener 没有原生执行控制，raw Peer 也不会把逻辑关闭包装成原生 exit。

## 3. Plugin 与 Host 出口

`createRuntimePlugin`（以及平台包的 `createProcessPlugin`、`createThreadPlugin`）返回一个可以用 `@migaia/plugin-host` 安装的插件。安装后，同一平台的所有连接共享一个出口：`host.process` 或 `host.thread`（名称见 `RuntimePluginKey`）。

| 出口方法                                         | 说明                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `request` / `notify` / `stream` / `group` / `outcome` | 第一个参数是目标：连接名，或 `{ name, instanceId }` 精确指定实例；同名多实例无法唯一确定时拒绝 |
| `list(options?)`、`get(target, options?)`        | 本地查询连接、身份、代次、健康、退出信息；拿不到的事实返回 `unavailable`，不伪造为 0          |
| `on(event, listener)`                            | 订阅事件，返回可重复调用的取消函数。事件名见 `RuntimeEventName`：`ready`、`exit`、`degraded`、`restart`、`liquidated` |
| `watch(options?)`                                | 有界的事件异步迭代器；积压超过 100 条时报告 `RUNTIME_EVENT_OVERFLOW` 并结束                   |
| `broadcast(method, payload?, options?)`          | 对所有目标调用并汇总各自结果；不保证全部成功                                                 |
| `stop` / `kill` / `restart` / `replace`          | 只对由 spawn 创建的连接有效；对 connect / listen 连接以 `CAPABILITY_CONFLICT` 拒绝            |

- **`expose`**：插件默认不向对端公开本端 Host 的任何方法。用 `expose: ['feature.method', …]` 显式列出；只有列出的方法可见。
- **目录就绪 ≠ 远端安装完成**：连接 ready 只说明方法目录已交换，不说明对端 Host 的某个插件安装事务已提交。需要等待远端安装完成时，用应用自己的确认信号。
- **查询格式**：`list` / `get` / `describe` 默认返回对象；可选参数指定为文本格式输出。

## 4. Endpoint

Endpoint 是更底层的 API：没有握手时的方法目录交换，调用按"目标 id + 方法名"路由。

### 4.1 创建

```ts doc-test=check
import { connect, createEndpoint, type IRpcTransport } from '@migaia/rpc-core'

/** transport 由实际载体提供；返回的 Endpoint 由调用方 dispose。 */
export function createClientEndpoint(transport: IRpcTransport) {
  return createEndpoint({
    id: 'client',
    targetIds: ['server'],
    transport,
    middlewares: [connect({ transport })]
  })
}
```

| 配置          | 说明                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| `id`          | 本端稳定标识                                                             |
| `targetIds`   | 已知的对端 id                                                            |
| `transport`   | 载体                                                                     |
| `middlewares` | 中间件列表（第 5 节）。两端的组合必须一致                                |
| `scheduler`   | 单调时钟与定时器；测试中可注入假时钟                                     |
| `wallClock`   | 墙钟，只用于消息时间戳等诊断字段                                         |

### 4.2 提供与调用

```ts doc-test=run
import { connect, createEndpoint } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'

const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({
  id: 'server', transport: right, middlewares: [connect({ transport: right })]
})
server.provide('add', (context) => {
  const [a, b] = context.data as [number, number]
  return context.success(a + b) // 或 context.failed(error)
})
const client = await createEndpoint({
  id: 'client', targetIds: ['server'],
  transport: left, middlewares: [connect({ transport: left })]
})
try {
  const sum = await client.send<number>('server', 'add', [20, 22])
  console.log(sum) // 42；data 必填，没有参数时传 null
} finally {
  await client.dispose()
  await server.dispose()
}
```

| 方法                                      | 说明                                                       |
| ----------------------------------------- | ---------------------------------------------------------- |
| `provide(method, handler)`                | 注册方法；返回 Endpoint，可链式调用                        |
| `send<T>(target, method, data, options?)` | 调用并等待结果                                             |
| `sendAll<T>(method, data, options?)`      | 对所有已知对端调用，返回 `{ fulfilled, rejected }`，按对端分组 |
| `dispatch(target, method, data)`          | 只发送，不等结果                                           |
| `dispatchAll(method, data)`               | 对所有已知对端只发送                                       |
| `group`、`outcome`                        | 与 Runtime Peer 相同（需要相应中间件与能力）               |
| `ping(target)`、`pingAll()`               | 安装 `ping()` 中间件后可用                                 |
| `on(event, listener)`、`hooks.on(...)`    | 订阅事件与钩子                                             |
| `dispose()`                               | 释放：注销监听器，拒绝在途调用                             |

`send` 的选项：`signal`、`timeoutMs`、`idempotencyKey`、`trace`、`transfer`。

### 4.3 createRuntimeApiEndpoint：自定义 runtime Endpoint

`createRuntimeApiEndpoint(config)` 构造支持 runtime 调用（`group`、`outcome` 等）的 Endpoint，平台包内部以及 `endpointFactory` 自定义组装时使用。它同步返回 Endpoint，使用前先 `await endpoint.ready`。

| 配置                       | 说明                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `id`                       | 本端稳定标识，写入每条消息                                                           |
| `targetIds`                | 已知对端 id                                                                          |
| `transport`                | 载体；收到的正是所选 `framer` 的输出                                                 |
| `scheduler`                | 单调时钟与定时器；同一实例也驱动插件宿主的期限                                       |
| `wallClock`                | 墙钟，只用于消息时间戳等诊断字段                                                     |
| `protocol`                 | 协议描述，决定信封格式                                                               |
| `codec`                    | 编码器；输出必须正好是 `framer` 的输入                                               |
| `framer`                   | 分帧器；输出交给 `transport`                                                         |
| `provider`                 | 构造完成前就注册好的方法表                                                           |
| `providerLimits`           | 入站并发上限，默认全局 256、每个对端 64                                              |
| `idempotency`              | 幂等存储与会话作用域，只用于带 `idempotencyKey` 的调用                               |
| `replay`                   | 出站重放账本的上限                                                                   |
| `replay.maxEntries`        | 保留的出站请求 id 数量，默认 4096                                                    |
| `replay.ttlMs`             | 出站请求 id 的保留时间，默认 310 秒                                                  |
| `middlewares`              | 中间件元组，构造时原子安装                                                           |
| `features`                 | 自定义功能模块元组                                                                   |
| `construction`             | 构造过程的取消与期限                                                                 |
| `construction.signal`      | 取消构造；已安装的中间件会被全部回滚                                                 |
| `construction.timeoutMs`   | 构造期限；`false` 表示不设期限                                                       |

## 5. 中间件

| 中间件                       | 作用                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `connect({ transport })`     | 连接与对端发现；按载体的来源证明（`sourceProof`）过滤消息。几乎总是需要            |
| `contract({ version, … })`   | 业务契约：版本、可接受的版本、方法 schema 校验                                    |
| `protocol()`                 | 启用标准协议帧                                                                    |
| `codec(descriptor)`          | 指定编码格式（例如二进制载体需要把消息编码为字节）                                |
| `framer(descriptor)`         | 指定分帧方式                                                                      |
| `abort()`                    | 允许取消在途调用                                                                  |
| `timeout({ timeoutMs })`     | 默认超时                                                                          |
| `ping()`                     | 启用心跳，提供 `ping` / `pingAll`                                                 |
| `authentication({ sign, verify, encrypt, decrypt })` | 逐帧签名 / 加密。启用线程间签名二进制与 transfer 时需要               |
| `hooks({ listeners })`       | 观察调用生命周期事件                                                              |
| `uuid({ … })`                | 自定义消息 id 生成                                                                |

中间件的配置项：

| 中间件与配置                  | 说明                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| `contract` 的 `version`       | 本端业务契约版本                                                           |
| `contract` 的 `acceptVersions` | 额外接受的对端契约版本列表                                                |
| `contract` 的 `maxIdentifierLength` | 方法名等标识符的最大长度                                             |
| `contract` 的 `schemas`       | 按方法名声明参数与结果的 schema，调用时校验                                |
| `authentication` 的 `encodedType` | 受保护帧的编码类型：`any`、`string` 或 `uint8array`                    |
| `hooks` 的 `onHookError`      | 钩子监听器抛错时的回调，不影响调用本身                                     |
| `uuid` 的 `generate`          | 自定义消息 id 生成函数                                                     |

`defineMiddleware` / `defineFeature` 用于编写自定义中间件与功能。自定义中间件适合日志、诊断、策略；新增协议级根能力不属于公开扩展面。

## 6. 载体：内置 transport 与自定义 transport

内置载体：

| 入口                         | 函数                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| `./adapters/memory`          | `createMemoryTransportPair()`：同一进程内的一对载体，用于测试与演示     |
| `./adapters/message-port`    | `createNodeMessagePortTransport(port)`、`createBrowserMessagePortTransport(port, { ownership })` |
| `./adapters/web-worker`      | `createWebWorkerTransport(port, options?)`：Dedicated Worker 或其 `self` |
| `@migaia/rpc-browser`        | window、BroadcastChannel、SharedWorker、Service Worker、WebRTC、WebTransport |

内置载体的选项：

| 选项                                                  | 说明                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `createBrowserMessagePortTransport` 的 `ownership`    | `owned`（默认）：释放 Endpoint 时一并关闭端口；`borrowed`：只注销监听器，端口由你关闭            |
| `createWebWorkerTransport` 的 `capabilities`          | 静态约定的能力列表；两端必须一致（该载体不做握手）                                               |
| `createWebWorkerTransport` 的 `peerId`                | 对端标识                                                                                         |

自定义载体实现 `IRpcTransport`：

| 成员                          | 说明                                                                       |
| ----------------------------- | -------------------------------------------------------------------------- |
| `send(message, options?)`     | 发送一条消息                                                               |
| `subscribe(listener)`         | 订阅收到的消息，返回取消订阅函数                                           |
| `close?()`                    | 关闭                                                                       |
| `platform`                    | 平台标签（`RpcPlatform`）                                                  |
| `ownership?`                  | `owned`（释放时一并关闭底层资源）或 `borrowed`（只注销监听器）             |
| `topology?`                   | 单对端、多对端还是广播组                                                   |
| `sourceProof?(source, origin)` | 多路复用载体用来证明消息确实来自预期对端                                  |
| `encodedType?`                | 载体只接受字符串或字节时声明，以便配置相应 codec                           |
| `onTransportError?`、`onListenerError?` | 上报载体与监听器错误                                             |

`./transport-kit` 提供编写载体常用的工具：监听器集合（`createMessageListenerHub`）、监听器失败的收集与上报、安全读取属性（`safeRead`）等。

## 7. 按需组装：减小打包体积

`createEndpoint` 包含全部能力。只需要部分能力时：

| 入口           | 函数                     | 能力                                     |
| -------------- | ------------------------ | ---------------------------------------- |
| `./client`     | `createClientEndpoint`   | 只发起调用                               |
| `./provider`   | `createProviderEndpoint` | 只提供方法                               |
| `./full`       | `createFullEndpoint`     | 双向                                     |
| `./composed`   | `createComposedEndpoint` | 从 `./features/*` 中显式挑选功能模块      |

`./features/*` 提供 `createOutboundFeature`、`createProviderFeature`、`createOneWayFeature`、`createDiscoveryFeature`、`createControlFeature`，`./stream` 提供流式与分片重组功能。`createProviderAdmissionScope` 用于让多个 Endpoint 共享同一组并发额度。

## 8. 容量、并发与重放窗口

**入站并发**：每个对端最多 64 个、全局最多 256 个同时执行的调用（request / notify / stream 都计入）。超出时调用方收到 `OVERLOADED`，对端函数不会被调用。可通过 `providerLimits` 调整，并用 `onRejected` 观察拒绝原因。调用方的 `OVERLOADED` 错误不包含具体原因；要区分是并发满还是其它准入原因，看对端的 `onRejected`。

**重放窗口**：为了识别重复投递的消息，Core 会在一段时间内记住已完成的调用。

- **进程与线程的原生独占通道**（由平台包的 launcher 建立）只记录在途调用，不受下面的速率限制。
- **其它载体**（浏览器载体、BroadcastChannel、自定义载体）使用有界账本：出站每个 Endpoint 4096 条，入站每个对端 1024 条、全局 4096 条，每条保留 310000 ms。由此得到的**持续**速率上限约为：出站每个 Endpoint 13.2 次/秒，入站每个对端 3.3 次/秒、全局 13.2 次/秒。这是持续速率的上限，不是吞吐量：短时突发可以超过它，但总量受账本容量约束。高频场景请合并调用（批量参数或 `group`）。

**幂等存储**：`createRpcIdempotencyStore({ retentionMs, maxEntries, maxEntriesPerScope, maxBytes, maxOutcomeBytes })` 创建有界的幂等结果存储，用于 `idempotencyKey` 去重与 `outcome` 查询。默认的内存存储在进程重启后会丢失，`outcome` 此时会报告连续性已中断。

## 9. 高阶用法：编写一个适配器

`@migaia/rpc-core/adapter` 提供 `defineMessageAdapter({ open, launch? })` 和 `defineByteAdapter({ open, listen?, dial? })`。定义完成后，用 `adapter.peer(options)` 创建独立 Peer，用 `adapter.plugin(options)` 安装到 Host。`open` 返回真实消息端口或有序字节 I/O；Core 继续完成原来的握手、能力协商、方法目录与收发。

| 定义 | 物理操作 | 创建结果 |
| --- | --- | --- |
| `defineMessageAdapter` | `open` 打开端口；可选 `launch` 调用运行时原有启动操作 | Peer 与 `host.thread` Plugin |
| `defineByteAdapter` | `open` 打开字节流；可选 `dial` 拨号、`listen` 取得一条已接受的字节流 | Peer 与 `host.process` Plugin |

下面是完整的第三方 MessagePort 适配器。它只用公开 SDK；两个原生端口由示例创建和关闭。

```ts doc-test=run group=custom-message-adapter file=peer-main.ts entry=peer-main.ts
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { defineMessageAdapter } from '@migaia/rpc-core/adapter'

/** 把调用方实际持有的端口交给 Core 的现有消息 owner。 */
const adapter = defineMessageAdapter({ open: (port: MessagePort) => port })
/** 原生端口由创建方持有，Peer.close() 释放借用的监听器。 */
const { port1, port2 } = new MessageChannel()
/** 显式地址用于这两个独立端口的对称路由。 */
const [left, right] = await Promise.all([
  adapter.peer<{ echo(value: number): number }>({
    self: { name: 'left', instanceId: 'left' }, connect: port1, peerId: 'right'
  }),
  adapter.peer({
    self: { name: 'right', instanceId: 'right' }, connect: port2, peerId: 'left',
    provide: { echo: (value: number) => value }
  })
])
try {
  console.log(await left.request('echo', 42)) // 42
} finally {
  await Promise.all([left.close(), right.close()])
  port1.close()
  port2.close()
}
```

同一个定义也能构造真正的 Host Plugin。Host 的原安装批次管理连接与资源，插件只公开 `expose` 中的 Host 方法。

```ts doc-test=run group=custom-message-adapter-host file=main.ts
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { defineHost } from '@migaia/plugin-host'
import { defineMessageAdapter } from '@migaia/rpc-core/adapter'

/** 这个第三方定义只负责取得真实端口。 */
const adapter = defineMessageAdapter({ open: (port: MessagePort) => port })
/** 两个端口的物理生命周期仍由创建方持有。 */
const { port1, port2 } = new MessageChannel()
/** 服务端与 Host 安装并发开始，让原消息 owner 完成双向 ACK。 */
const serving = adapter.peer({
  self: { name: 'service', instanceId: 'service' }, connect: port2, peerId: 'host',
  provide: { echo: (value: number) => value }
})
/** 这个定义产生的真实 Plugin 交给原 Host 安装批次。 */
const plugin = adapter.plugin<{ echo(value: number): number }>({
  name: 'custom', self: { name: 'host', instanceId: 'host' },
  connect: port1, peerId: 'service'
})
/** Plugin 元组把实际 thread 出口保留在 Host 类型上。 */
const host = defineHost<Record<string, never>, never, readonly [typeof plugin]>({
  host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
})
/** 与已经开始的服务端 Peer 并发安装，完成原双向握手。 */
const installed = host.use(plugin)
/** 服务端 Peer 与实际安装都完成后才发业务调用。 */
const right = await serving
try {
  await installed
  console.log(await host.thread!.request('custom', 'echo', 42)) // 42
} finally {
  await host.dispose()
  await right.close()
  port1.close()
  port2.close()
}
```

`defineByteAdapter` 同样只接物理 I/O。下面用 Node 标准库的两条 PassThrough 演示有序双向字节流；握手、分帧和目录交换仍由 Core 完成。

```ts doc-test=run group=custom-byte-adapter file=main.ts
import { PassThrough } from 'node:stream'
import { defineByteAdapter } from '@migaia/rpc-core/adapter'

/** 一端持有实际读流和写流，关闭时释放自己持有的两条流。 */
type IStreams = Readonly<{ input: PassThrough; output: PassThrough }>
/** 标准库流只提供字节读写；Core 负责协议和能力判断。 */
const adapter = defineByteAdapter({
  open: (streams: IStreams) => ({
    kind: 'byte' as const,
    write: (chunk: Uint8Array) => new Promise<void>((resolve, reject) => {
      streams.output.write(chunk, (error) => error ? reject(error) : resolve())
    }),
    onData: (listener: (chunk: Uint8Array) => void) => {
      streams.input.on('data', listener)
      return () => { streams.input.off('data', listener) }
    },
    onClose: (listener: (reason?: unknown) => void) => {
      streams.input.on('end', listener)
      return () => { streams.input.off('end', listener) }
    },
    close: () => { streams.input.destroy(); streams.output.destroy() }
  }),
  listen: (streams: IStreams) => ({
    kind: 'byte' as const,
    write: (chunk: Uint8Array) => new Promise<void>((resolve, reject) => {
      streams.output.write(chunk, (error) => error ? reject(error) : resolve())
    }),
    onData: (listener: (chunk: Uint8Array) => void) => {
      streams.input.on('data', listener)
      return () => { streams.input.off('data', listener) }
    },
    onClose: (listener: (reason?: unknown) => void) => {
      streams.input.on('end', listener)
      return () => { streams.input.off('end', listener) }
    },
    close: () => { streams.input.destroy(); streams.output.destroy() }
  })
})
/** 两条真实流分别承载两个方向，顺序由标准库保持。 */
const toLeft = new PassThrough()
const toRight = new PassThrough()
/** 一端发 hello，另一端在自己实际接收的流上 accept。 */
const [left, right] = await Promise.all([
  adapter.peer<{ double(value: number): number }>({
    self: { name: 'left', instanceId: 'left' }, peerId: 'right',
    connect: { input: toLeft, output: toRight }
  }),
  adapter.peer({
    self: { name: 'right', instanceId: 'right' }, peerId: 'left',
    listen: { input: toRight, output: toLeft },
    provide: { double: (value: number) => value * 2 }
  })
])
try {
  console.log(await left.request('double', 21)) // 42
} finally {
  await Promise.all([left.close(), right.close()])
}
```

`launch` 真的调用定义中提供的物理启动操作，并返回端口、`exited` 与 `terminate`。现有运行时可以把自己的 supervisor 的原启动结果交给它；重启、预算与原生退出观察继续属于那个 supervisor。Core 的消息 resource 在握手失败、冷启动取消及 Peer 关闭时，通过同一个 termination-once owner 释放这个实际句柄。rpc-process 与 rpc-threads 的完整 managed 来源仍交给原 supervision 与 generation owner。

治理配置保留为 `peer` / `plugin` 的 `governor` 和 `scope` 选项。`governor` 使用原 rate、payload、连续超时与 idle 策略；其 disposer 挂在实际连接的 close owner 上。`adapter.scope(store?)` 创建原 provider scope，调用方共享它时，在所有 Peer 关闭后执行 `scope.close()`。作用域使用 Core 从实际连接捕获的认证 principal；普通借用端口的地址字符串不提供 principal。需要会话幂等作用域时，字节 responder 必须使用实际 `auth.verify`。

`./adapter/internal-advanced` 保留原生 Process、Threads 与 JSON-RPC Bridge 仍需要的低级操作。第三方的起点是上面的两个定义函数；它们不接受成品 Peer、channel、已协商能力、可信身份或 ownership 声明。

适配器自己的错误继续用 `@migaia/utils/error` 的 `attachErrorIdentity` 附加自己的 source/code，并保留原错误在 `cause` 上；协议错误继续由原 Core/Contract owner 产生。
## 10. 错误码与处理

### 10.1 判断错误

所有错误都是原生 `Error`（或子类），附带 `source` 与 `code`。按 `(source, code)` 分支，不要匹配 `message`。

```ts doc-test=run
import { isRpcTimeoutError, RpcCoreErrorCode, RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-core'
import { createPeerPair } from '@migaia/rpc-core/testing'

/** 可执行的对端让超时例子不依赖未定义 peer。 */
const pair = await createPeerPair({
  a: { provide: {} },
  b: { provide: { math: { slow: async (ms: number) => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms))
    return ms
  } } } }
})
try {
  await pair.a.request('math.slow', 300, { timeoutMs: 50 })
} catch (error) {
  const { source, code } = error as { source?: string; code?: string }
  if (isRpcTimeoutError(error)) {
    console.error(code) // DEADLINE_EXCEEDED：对端可能仍在执行
  } else if (source === RPC_CORE_ERROR_SOURCE && code === RpcCoreErrorCode.overloaded) {
    console.error(code) // 对端额度已满，函数未执行，可以退避重试
  } else throw error
} finally {
  await Promise.all([pair.a.close(), pair.b.close()])
}
```

- `isRpcErrorInstance`、`isRpcRemoteError`、`isRpcTimeoutError` 按稳定字段判断，跨 Worker、iframe、模块副本都有效；不要依赖 `instanceof`。
- `isRpcError` 只检查 `code` 是否为字符串，不能代替上面三个守卫。
- 错误类（`RpcError`、`RpcRemoteError`、`RpcTimeoutError` 等）只作为类型导出。唯一可构造的运行时类是 `RpcLifecycleError`，供持有自身释放状态的消费方（例如 Store Worker）报告生命周期失败。

### 10.2 Core 错误码

source 均为 `@migaia/rpc/core`。

| code                              | 何时发生                                         | 建议处理                                                                 |
| --------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `DEADLINE_EXCEEDED`               | 超时（`TimeoutError`）                           | 对端可能已执行；有 `idempotencyKey` 时查 `outcome`，否则业务对账          |
| `CANCELLED`                       | 被取消（`AbortError`）                           | 同上；`before-start` 撤销成功时可确定未执行                               |
| `OVERLOADED`                      | 并发额度已满，函数未执行                         | 降低并发，带抖动退避后重试                                               |
| `TRANSPORT`                       | 载体失败或连接中断                               | 调用可能已送达；恢复连接后先对账                                          |
| `PROVIDER_NOT_FOUND`              | 对端没有这个方法                                 | 检查方法路径与对端版本，不要盲目重试                                     |
| `PAYLOAD_INVALID`                 | 参数不可移植、超限或二进制形状不支持             | 修正数据                                                                 |
| `SCHEMA_INVALID`                  | 参数或结果不符合 schema                          | 修正数据                                                                 |
| `CONTRACT_INVALID`                | 方法、模式或幂等键使用不合法                     | 修正调用；不要换一个幂等键重发可能已执行的调用                           |
| `PROTOCOL_INVALID`                | 收到不合法的协议消息                             | 修正协议实现或版本                                                       |
| `CAPABILITY_UNSUPPORTED`          | 使用了对端未协商的能力                           | 改用受支持的方式；库不会静默降级                                         |
| `CAPABILITY_CONFLICT`             | 能力或实例归属有歧义，或对借用连接执行 stop/restart | 修正装配或指定实例                                                    |
| `INVALID_CONFIG`                  | 配置或选项不合法（包括进程调用传 `transfer`）    | 修正配置                                                                 |
| `TARGET_UNKNOWN`                  | 出口中找不到目标                                 | 重新读取可用目标                                                         |
| `TARGET_NOT_IDENTIFIABLE`         | 同名多实例无法唯一确定                           | 用 `{ name, instanceId }` 精确指定                                       |
| `ENDPOINT_DISPOSED`               | Endpoint 已释放                                  | 新建；已发出的调用仍按原结果对账                                         |
| `AUTHENTICATION_FAILED`           | 认证失败                                         | 修正凭据或重建会话；不会自动重放旧消息                                   |
| `SESSION_UNKNOWN`、`CHALLENGE_INVALID` | 认证被拒绝的具体原因：会话未知 / 质询格式不合法 | 前者丢弃缓存后重新发现；后者修正帧格式，不要盲目重试                    |
| `STREAM_RESULT_UNKNOWN`           | 流中断，已交付的项之外结果未知                   | 业务对账后再开新流，不重放已交付的项                                     |
| `IDEMPOTENCY_RESULT_UNAVAILABLE`  | 业务已执行，但结果未被保留                       | 对账；不要换键重执行                                                     |
| `PROVIDER_GENERATION_MISMATCH`    | 目标代次不匹配                                   | 重新选择目标                                                             |
| `PROVIDER_GENERATION_RETIRED`     | 目标代次已退役；转发中的调用可能已执行           | 用 `outcome` 或业务对账，不要仅凭此码重执行                              |
| `FORWARD_LOOP`、`FORWARD_HOP_LIMIT` | 转发成环 / 超过三跳                            | 修正转发路径，或改为直接连接                                             |
| `PROVIDER_DUPLICATED`             | 重复注册同名方法                                 | 修正注册                                                                 |
| `PROVIDER_NOT_SETTLED`            | 提供方函数没有完成（未调用 success / failed）    | 修正提供方实现                                                           |
| `PROVIDER_CONTEXT_EXPIRED`        | 提供方在上下文过期后才完成                       | 修正提供方生命周期                                                       |
| `MIDDLEWARE_DUPLICATED`、`MIDDLEWARE_MISSING` | 中间件重复或缺失                     | 修正 Endpoint 组装                                                       |
| `CHUNK_INVALID`                   | 分片重组失败                                     | 修正分帧或载体                                                           |
| `PROPERTY_READ_FAILED`、`STRING_CONVERSION_FAILED` | 读取属性的 getter 抛错 / 无法转为字符串 | 修正输入对象                                                     |
| `DUPLICATE_MODULE_INSTANCE`       | 同一环境加载了两份 rpc-core                      | 修正依赖解析，然后重新加载                                               |
| `INTERNAL`                        | 内部错误                                         | 按 `cause` 处理，默认不自动重试                                          |

### 10.3 Remote 错误码

source 均为 `@migaia/rpc/remote`。

| code                       | 何时发生                                        | 建议处理                                                         |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| `REMOTE_START_FAILED`      | 来源未能建立连接（包括握手被拒绝）              | 查看 `cause`；确认没有发出业务调用后可重新建立                   |
| `REMOTE_CLOSED`            | 连接或代次已关闭                                | 重新选择目标；已发出的调用先对账，不要自动转投同名后继            |
| `REMOTE_RESULT_UNKNOWN`    | 调用结果未知                                    | 业务可能已执行；查 `outcome` 或对账                              |
| `REMOTE_CONTRACT_INVALID`  | 目录或契约不合法                                | 修正契约                                                         |
| `REMOTE_HOST_NOT_ADOPTED`  | 远端 Host 控制未被该连接采纳                    | 先完成对应的 `hostUse`                                          |
| `RUNTIME_EVENT_OVERFLOW`   | `watch` 积压超过 100 条                         | 先用 `list` / `get` 查询当前状态，再重新订阅                     |

### 10.4 跨进程传递错误

`serializeRpcError` / `deserializeRpcError`（包根）在 Core 层传递错误时使用：它们保留 Core 的脱敏与转发路由信息。错误树的结构、校验与 JSON-RPC 映射见 [rpc-contract USEGUIDE 第 9 节](../rpc-contract/USEGUIDE.md#9-高阶用法跨进程与跨语言传递错误)。

对端抛出的业务错误会还原为原生类型并保留 `message`、`stack` 与 `cause` 链。来自对端的 source / code 只用于诊断，不会被当作本地库的错误身份，也不授予任何控制权限。

## 11. 二进制、转发与重试

**二进制**

- `ArrayBuffer` / `Uint8Array` 需要双方协商二进制能力；平台包的默认配置已启用。`Uint8Array` 的 offset 与 length 保持不变。
- 内联传输时只携带视图可见的字节；原生清单（线程）保留完整的底层 buffer 并以摘要校验。
- `SharedArrayBuffer`、`Atomics` 与其它 TypedArray 不支持。
- **transfer**（仅线程）：消息真正提交时 buffer 才失效，之后即使失败也不能恢复；带 transfer 的调用不会自动重试，库不保留输入副本。需要签名认证配置，未满足时以 `CAPABILITY_UNSUPPORTED` 拒绝，不会降级为复制。

**转发**

插件可以用 `expose` 公开它已接受连接的方法前缀，让第三方经它转发调用。每一跳固定当时的目标代次，最多三跳，成环或超过时拒绝。最终提供方认证的是直接上一跳，而不是最初的调用者。中继不缓存业务结果。

**重试原则**

先看 `(source, code)` 与调用进行到了哪一步。只有能独立确认对端没有执行时（例如 `OVERLOADED`、`before-start` 撤销成功），才可以直接重试。超时、断线、`unknown`、连接恢复都不能证明未执行：给调用加 `idempotencyKey`，失败后用 `outcome(key)` 查询，或按业务规则对账。退避与总时间预算由调用方控制。

## 12. 常见问题

**`notify` 成功了，对端却没执行？**
`notify` 只保证已发出。需要确认时用 `request`。

**为什么我的调用同步抛错了？**
参数、方法名或选项在发出前就不合法。把调用放进 `try` 块。

**浏览器载体上高频调用被拒绝？**
非独占载体的重放账本有持续速率上限（第 8 节）。合并调用，或改用原生独占通道。

**两个包各装了一份 rpc-core？**
会得到 `DUPLICATE_MODULE_INSTANCE`。让所有 `@migaia/rpc-*` 包解析到同一份 `@migaia/rpc-core`。

**能自己定义新的协议级能力吗？**
不能。自定义中间件可以做日志、诊断、策略；新的根能力需要在 Core 内实现。

## 13. Probe

`@migaia/rpc-core/probe` 是运行时无关的观察契约入口，导出阶段、方向、kind、outcome 的数值常量与同顺序名称表，以及 `defineProbe`、`snapshotProbeEvent`、`rpcProbeSampleKey` 和 `probePlugin`。

Core Peer 的 `probe` 与 Endpoint 的 `probePlugin` 安装同一 emitter。事件同步交给所订阅的 Probe；throw、reject、redact 或 describe 失败通过 `onError` 报告 `PROBE_FAILED`，原始错误留在 `cause`，不进入业务管道。没有 `onError` 时使用宿主 reporter。当前 managed Thread spawn 与 Process `spawn: true` 在选项重建时遗漏 `probe`；下面使用能够转发选项的直接 `connect` 路径。跨包 managed-source 观察仍为 pending，A7 没有通过。
### 13.1 定义与交入 Peer

```ts doc-test=run group=useguide-probe-peer file=main.ts
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

`probe` 可以是单个 handle 或 readonly 数组。`defineProbe` 在定义时验证选项并编译 `stageMask`、`captureMask`、`methods` 与 `sampleThreshold`；返回对象被冻结，私有状态保留原 `definition.emit` callback。定义失败抛出原生 `TypeError`，带 `@migaia/rpc/core` / `INVALID_CONFIG`。

调用方已有对象需要同时提供其它 API 时，使用 revision 2 的 `defineProbe(definition, host)`。它直接为 `host` 添加 Probe 字段，以该对象的身份注册私有状态，然后冻结 `host`；返回类型为 `THost & IRpcProbe`，不复制或合并到另一个对象。原有成员与引用保持不变，省略 `host` 的形式仍返回独立 handle。

```ts doc-test=check
import { defineProbe } from '@migaia/rpc-core/probe'

/** 已有对象的额外成员不参与 Core 热路径的状态读取。 */
const host = { name: 'metrics' }
/** definition 与 host 直接注册在同一对象身份下，不复制 host。 */
const probe = defineProbe({
  stages: ['message'],
  emit(view) {
    console.log(view.seq)
  }
}, host)
console.log(probe === host, Object.isFrozen(host), probe.name)
```

`host` 必须为可扩展、未冻结的非 null 对象，不能已经拥有 `stageMask`、`captureMask`、`methods`、`sampleThreshold`、`setStages`，也不能已经注册为 Probe。所有验证在修改对象之前完成；失败以 `TypeError` / `INVALID_CONFIG` 拒绝，`host` 不变。已有 `host.emit` 允许保留，附加操作不会覆盖它；Probe 私有状态使用 `definition.emit`。后续 emitter 在安装时从私有 WeakMap 读取编译状态，放入自己的固定形状记录；热路径读取该记录，不读取带额外成员的 `host`。

| 配置 | 契约 |
| --- | --- |
| `stages` | 定义时必须为非空的已知阶段名称数组 |
| `capture` | 默认关闭；定义时必须为 `stages` 子集 |
| `redact` | 处理显式捕获的内容；不会因此开启未选择阶段的 capture |
| `methods` | 只过滤 `message` 与 `envelope`，其它阶段只按采样过滤 |
| `sample` | 范围 `(0, 1]`，默认全部；阈值在定义时计算 |
| `describe`、`emit`、`onError` | 描述、同步事件消费者与错误报告 callback |

`rpcProbeSampleKey(senderId, messageId)` 对二者拼接后的 UTF-8 字节计算 FNV-1a 32 位键。调用方与接收方使用相同标识，所以同一交互的两侧采样决定一致；它不是认证机制或唯一身份。

### 13.2 View 生命周期与内容捕获

每个 emitter 复用固定形状的 `IRpcProbeEventView`。只能在同步 `emit` 中读取它；需要稍后读取时使用快照：

```ts doc-test=check
import { defineProbe, snapshotProbeEvent, type IRpcProbeEventView } from '@migaia/rpc-core/probe'

/** 此示例选择保留事件；分配发生在消费者，而非 Core 观察点。 */
const saved: Readonly<IRpcProbeEventView>[] = []
/** 内容捕获按 frame/protected 显式启用，随后统一脱敏。 */
const probe = defineProbe({
  stages: ['frame', 'protected'],
  capture: ['frame', 'protected'],
  redact() {
    return '<redacted>'
  },
  emit(view) {
    // SC9(c)：调用方显式请求顶层事件快照。
    saved.push(snapshotProbeEvent(view))
  }
})

probe.setStages([]) // 暂停，captureMask 保持原值。
probe.setStages(['frame', 'protected']) // 恢复选定阶段。
```

`snapshotProbeEvent` 是显式复制请求（SC9c）：复制并冻结顶层字段，保留 `detail`、`error` 与 `content` 的引用和所有权。它防止复用 view 改写快照的顶层元数据，不固定这些引用对象的内容。按照 SC9，普通捕获与存储保留引用；调用方发送后修改 `detail`、错误或未被转移的 content 对象，后续读取仍可见修改。只有实际 transfer 会分离的字节缓冲、真实 codec/序列化边界（SC9b），或显式快照 API 才复制必要数据。未知 `sizeBytes`、未分块的 chunk 字段、非批次的 `members` 与未结算的 `durationMs` 都使用 `-1`。

`protected` 仅在认证保护路径存在时产生；没有该能力的路径不会伪造该阶段。内容捕获包括 protected 内容都必须显式启用。Descriptor 的 `stageMask` 描述 endpoint 能产生且当前已订阅的阶段，不证明所有路径都会经历每个阶段。

`setStages([])` 允许暂停，之后可以设置其它已知阶段。它更新私有状态的阶段选择，保留定义时的 `captureMask`；host 上不可写的 `stageMask` 仍为初始定义值，独立 handle 的 `stageMask` getter 反映当前私有值。非法阶段会抛出 `INVALID_CONFIG` 并保留旧 mask。阶段变更的 emitter 订阅机制由 Core 内部持有，不是公开 handle 方法。


### 13.3 Endpoint 安装与生命周期

Endpoint 用户在激活前安装 `probePlugin`。Peer 用户只需传入 `probe`。Core 在激活后交付一次 descriptor；只有载体实际提供 `observe` 才调用它，释放函数由现有 resource scope 在关闭时执行。Peer 阶段覆盖 handshake、ready、exit、restart、directory 与 closing。`setStages([])` 暂停后不再构造所选事件；关闭后不再发送事件。

```ts doc-test=run group=useguide-probe-endpoint file=main.ts
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
