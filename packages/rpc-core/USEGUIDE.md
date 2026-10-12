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
9. [高阶用法：为新运行时编写适配器](#9-高阶用法为新运行时编写适配器)
10. [错误码与处理](#10-错误码与处理)
11. [二进制、转发与重试](#11-二进制转发与重试)
12. [常见问题](#12-常见问题)

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

```ts
import { createRuntimePeer } from '@migaia/rpc-core/remote'

const peer = await createRuntimePeer({
  self: { name: 'client', instanceId: 'client-1' },
  provide: { ping: () => 'pong' },
  connect: async (context) => openChannelSomehow(context), // 返回已完成握手的协议通道
  report: (error) => console.error(error)
})
```

| 选项                         | 说明                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `self`                       | 本端身份 `{ name, instanceId }`。`name` 只是显示标签，不用于认证                                         |
| `provide`                    | 本端提供的方法树（见 2.2）                                                                               |
| `spawn` / `connect` / `listen` | 来源，必须且只能有一个。Core 层是回调形式 `(context) => Promise<channel>`；平台包另有对象形式          |
| `defaultTimeoutMs`           | request / stream 的默认超时，必须是有限正数；不设时为 30000                                              |
| `providerLimits`             | 入站并发上限：`maxPerPeer`（默认 64）、`maxGlobal`（默认 256）、`onRejected` 观察被拒绝的调用             |
| `contract`                   | 显式的方法契约（模式、幂等声明、schema），一般不需要                                                    |
| `keyFactory`、`retryPort`    | 幂等键生成与重试端口，用于自定义重试策略                                                                 |
| `endpointFactory`            | 自定义 Endpoint 组装（例如加入 `authentication` 中间件）                                                 |
| `report`                     | 接收后台错误，必填                                                                                       |

来源回调收到的 `context` 包含本端 `self` 与本端实际编译出的能力 `capabilities`。回调必须返回已经完成握手的协议通道，不能伪造能力或身份。

`createManagedRuntimePeer` 在此基础上加入监督（启动、重启、停止）；平台包的 spawn 来源就是用它实现的。

### 2.2 provide：声明可被调用的方法

```ts
provide: {
  math: {
    double: (value: number) => value * 2,         // request / notify
    slow: async (ms: number) => { … }             // 返回 Promise 也可以
  },
  feed: {
    count: async function* (limit: number) {      // 返回 iterable / async iterable → stream
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

```ts
type IRemoteApi = {
  math: { double: (value: number) => number }
  feed: { count: (limit: number) => AsyncIterableIterator<number> }
}
const peer = await createThreadPeer<IRemoteApi>(options)
peer.request('math.double', 21) // Promise<number>
peer.stream('feed.count', 3) // AsyncIterableIterator<number>
```

- 流式方法的返回类型要写成 `AsyncIterableIterator<T>`（或 `IterableIterator<T>`），这样 `stream` 才能识别它。
- 不提供泛型时没有可调用的方法类型。需要按字符串动态调用时用 `IRuntimeDynamicSurface`：只放宽编译期检查，运行时仍按对端目录拒绝未知方法。
- `IRuntimeSurface<THost, TPlugin>` 从 Host 与插件定义中提取纯类型，不产生运行时代码。

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

```ts
import { connect, createEndpoint } from '@migaia/rpc-core'

const endpoint = await createEndpoint({
  id: 'client',                     // 本端 id，写入每条消息
  targetIds: ['server'],            // 已知对端；自动发现可在运行中补充
  transport,                        // 载体（第 6 节）
  middlewares: [connect({ transport })]
})
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

```ts
endpoint.provide('add', (context) => {
  const [a, b] = context.data as [number, number]
  return context.success(a + b) // 或 context.failed(error)
})

const sum = await endpoint.send<number>('server', 'add', [20, 22]) // data 必填，没有参数时传 null
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

## 9. 高阶用法：为新运行时编写适配器

平台适配器共用 `resolveAdapterEntry`：原生层只提供主入口 URL 与运行参数快照，Core 不读取 Node、Bun 或 Deno 的全局对象。相对路径以主入口目录为基准；显式 `base` 可覆盖基准；URL 始终精确。`true` 在 REPL、eval、测试框架、Electron 或单文件可执行程序中拒绝自派生，要求显式入口。URL 解析错误保留原始 `cause`。

```ts doc-test=run
import { resolveAdapterEntry, retainAdapterRuntimeFlags } from '@migaia/rpc-core/adapter'

const entry = resolveAdapterEntry('./service.ts', { mainEntry: new URL('file:///app/main.ts') })
console.log(entry) // file:///app/service.ts
console.log(retainAdapterRuntimeFlags(['--import', './loader.mjs', '--eval', '1'])) // 保留 loader
```

`@migaia/rpc-core/adapter` 面向适配器作者：为一种新的运行时或载体（例如 Electron 的某种通道、自定义 IPC）实现与 rpc-process、rpc-threads 同等的能力。

**原则**：适配器只交给 Core 它实际持有的原始资源（字节流、消息端口、启动句柄）。握手、能力协商、信任判断都由 Core 在自己的收发路径上完成。接口不接受"已协商 / 已认证 / 已拥有"之类的声明，也不接受对已有 transport 的登记。

| 分组           | 函数                                                                                                                  | 用途                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 消息端口       | `createEventEmitterMessageResource`、`createEventTargetMessageResource`                                               | 持有原始端口；`openStatic` 建立固定能力通道，`open` 经能力确认（ACK）建立扩展通道 |
| 字节连接       | `createRuntimeEventByteIO`、`createRuntimeByteConnection`、`readRuntimeByteBootstrap`                                 | 在有序字节流上完成握手、认证与 bootstrap 读取              |
| 消息连接       | `createRuntimeMessageConnection`                                                                                      | 完整消息 I/O；固定基础能力零握手，扩展能力经 ACK           |
| 对象连接       | `holdAdapterObjectChannel`、`materializeAdapterJson`                                                                  | 文本 / 对象 I/O 的协商与构造（JSON-RPC 桥使用）            |
| 准入与会话     | `createRuntimeProviderGovernor`、`createRuntimeProviderScope`                                                         | 连接数、速率、payload 限额，以及按认证身份划分的会话作用域 |
| Peer 与启动    | `prepareAdapterPeer`、`holdAdapterLaunch`、`createAdapterBindingDrain`、`createAdapterPlugin`、`holdAdapterRegistration` | 复用 Core 的 Peer、启动、绑定、插件生命周期               |
| 数据与诊断     | `createAdapterId`、`readAdapterAbortReason`、`validateAdapterPeerTimeout`、`validateAdapterPeerMethods`、`normalizeAdapterDescription`、`adapterContractRequiresStream`、`createAdapter*Error`、`IpcReporterContext` | 配置校验、目录规范化、标准错误构造 |

最小示例：在你持有的事件端口上建立 Runtime Peer，扩展能力由 Core 读取对端 ACK 决定：

```ts
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import {
  createEventEmitterMessageResource,
  prepareAdapterPeer,
  type IAdapterEventEmitterMessagePort
} from '@migaia/rpc-core/adapter'
import type { IRuntimePeer, IRuntimePeerOptions, IRuntimePeerSource } from '@migaia/rpc-core/remote'
import { systemScheduler } from '@migaia/utils/scheduler'

export function openCustomRuntimePeer(
  port: IAdapterEventEmitterMessagePort,
  parentId: string,
  options: Omit<IRuntimePeerOptions, 'spawn' | 'connect' | 'listen'>
): Promise<IRuntimePeer> {
  const preparation = prepareAdapterPeer(options, 'custom-runtime')
  const resource = createEventEmitterMessageResource(port)
  const connect: IRuntimePeerSource = (context) =>
    resource.open({
      peerId: parentId,
      scheduler: systemScheduler,
      offer: context.capabilities,
      control: rpcMessageCapabilityControl
    })
  return preparation.peer({ ...options, self: preparation.context.self, connect })
}
```

对端没有回 ACK，或 ACK 中没有某项扩展能力时，该能力不启用。参考实现见 `@migaia/rpc-process`（字节与消息通道）和 `@migaia/rpc-threads`（Worker 端口）的源码。

**适配器自己的错误**：用 `@migaia/utils/error` 的 `attachErrorIdentity` 附加你自己的 source 与 code，不要冒用 `@migaia/rpc/*`：

```ts
import { attachErrorIdentity } from '@migaia/utils/error'

const ADAPTER_SOURCE = '@example/custom-carrier'
const AdapterErrorCode = { writeFailed: 'WRITE_FAILED' } as const

export function raiseAdapterWriteFailure(cause: unknown): never {
  throw attachErrorIdentity(new Error('adapter write failed', { cause }), {
    source: ADAPTER_SOURCE,
    code: AdapterErrorCode.writeFailed
  })
}
```

## 10. 错误码与处理

### 10.1 判断错误

所有错误都是原生 `Error`（或子类），附带 `source` 与 `code`。按 `(source, code)` 分支，不要匹配 `message`。

```ts
import { isRpcTimeoutError, RpcCoreErrorCode, RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-core'

try {
  await peer.request('math.slow', 300, { timeoutMs: 50 })
} catch (error) {
  const { source, code } = error as { source?: string; code?: string }
  if (isRpcTimeoutError(error)) {
    // 超时（DEADLINE_EXCEEDED）：对端可能仍在执行
  } else if (source === RPC_CORE_ERROR_SOURCE && code === RpcCoreErrorCode.overloaded) {
    // 对端额度已满，函数未执行，可以退避重试
  } else throw error
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
