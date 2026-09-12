# 使用手册

本文是 `@migaia/web-rpc` 的完整参考手册，面向已经读过 [README.md](./README.md) 五分钟上手部分、需要深入了解具体配置项和边界行为的开发者。README 讲"是什么、能干什么、怎么快速上手"，本文讲"每一个配置项、每一种错误、每一个坑的具体细节"。

## 目录

1. [核心概念详解](#1-核心概念详解)
2. [入口、预设、Feature 组合与构造配置](#2-入口预设feature-组合与构造配置)
3. [中间件详细参考](#3-中间件详细参考)
4. [传输适配器详细参考](#4-传输适配器详细参考)
5. [自定义传输适配器](#5-自定义传输适配器)
6. [Endpoint 公开 API 参考](#6-endpoint-公开-api-参考)
7. [服务发现：自动模式与手动模式](#7-服务发现自动模式与手动模式)
8. [错误处理](#8-错误处理)
9. [生命周期与资源释放](#9-生命周期与资源释放)
10. [可观测性：hooks 事件参考](#10-可观测性hooks-事件参考)
11. [安全注意事项](#11-安全注意事项)
12. [性能特征与内置限制](#12-性能特征与内置限制)
13. [完整场景示例](#13-完整场景示例)
14. [常见问题排查](#14-常见问题排查)
15. [协议常量与类型工具](#15-协议常量与类型工具)
16. [跨端错误序列化](#16-跨端错误序列化)
17. [构建、格式化与测试](#17-构建格式化与测试)

---

## 1. 核心概念详解

### 1.1 Endpoint（端点）

Endpoint 代表通信链路里“我方”这一端。它实际具备哪些方法，取决于你选择的**预设**或 **Feature**，不是所有入口都固定返回完整双向 API：

- `createClientEndpoint()` 只有调用侧能力：`send`、`sendAll`、`dispatch`、`dispatchAll`。
- `createProviderEndpoint()` 同时具备调用侧能力和 `provide()`。
- 根入口的 `createEndpoint()` 是完整预设 `createFullEndpoint()` 的同一函数引用，额外装配发现、控制和分片 Feature。
- `createComposedEndpoint()` 只公开显式选中的 Feature 投影。

调用方与提供者身份不互斥；完整或 provider 预设可以一边 `provide()`，一边 `send()`。`client` / `provider` 是打包边界和公开能力预设，不是限制网络拓扑的传统客户端/服务端进程角色。

<a id="12-transport传输"></a>

### 1.2 Transport（传输）

Transport 是最底层的抽象，只关心"把一个消息对象发出去"和"收到消息对象时通知我"，完全不理解 RPC 语义（不知道什么是请求、响应、超时）。它的最小接口只有两个必需方法：

```ts
type IWebRpcTransport = {
  send(message: unknown, options?: { transfer?: readonly unknown[] }): void | Promise<void>
  subscribe(
    listener: (message: {
      data: unknown
      peerId?: string
      origin?: string
      source?: unknown
    }) => void
  ): () => void
  // 以下都是可选的能力声明
  close?(): void | Promise<void>
  onTransportError?(listener: (error: unknown) => void): () => void
  onListenerError?(listener: (error: unknown) => void): () => void
  readonly peerId?: string
  readonly origin?: string
  readonly platform:
    | 'Worker'
    | 'Iframe'
    | 'BroadcastChannel'
    | 'MessagePort'
    | 'Memory'
    | 'WebTransport'
    | 'RTCDataChannel'
  readonly topology?: 'exclusive' | 'multiplexed' | 'broadcast'
  readonly encodedType?: 'any' | 'string' | 'uint8array'
  readonly ownership?: 'owned' | 'borrowed'
  readonly sourceProof?: (source: unknown, origin?: string) => boolean
  readonly closed?: boolean
}
```

**`topology` 字段决定框架如何信任这条通道**，是整个安全模型里最重要的一个字段：

| topology      | 含义                                                                              | 信任假设                                                                                              |
| ------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `exclusive`   | 这条通道从始至终只有唯一的一对发送方/接收方（如 dedicated Worker、`MessagePort`） | 第一个观察到的发送方可以被直接信任为唯一对端，无需额外身份校验                                        |
| `multiplexed` | 这条通道上可能有多个不同的逻辑发送方（如 SharedWorker 的多个连接端口）            | **绝不**当作独占通道信任；必须提供 peer/source 身份或显式 `identifier` 校验，否则任何一端都可能被冒充 |
| `broadcast`   | 一对多广播（如 BroadcastChannel）                                                 | 默认是"诚实节点路由"模型，不是身份边界，见 [§11 安全注意事项](#11-安全注意事项)                       |

自定义传输**必须**如实声明 `topology`；声明错误（比如把实际上多路复用的通道声明成 `exclusive`）会直接破坏框架的身份信任假设。

### 1.3 Feature（功能模块）

Feature 由 `defineFeature((core) => surface)` 定义，决定 endpoint 运行时安装哪些领域能力和根对象公开哪些方法。Feature 的私有依赖不会自动扩大根对象的公开 API；只有 Feature 明确返回的 surface 才会投影到 endpoint。

### 1.4 Middleware（中间件）

Middleware 由 `defineMiddleware(name, (core) => descriptor)` 定义，是 PluginHost 管理的配置、协议和策略插件；首方 `connect()`、`contract()`、`timeout()`、`ping()`也使用同一安装归属。它不负责选择 endpoint 根对象的业务表面。

Feature 与 Middleware 必须分开理解：Feature 返回的 surface 才会投影为 endpoint 方法；Middleware 通过 `core.own()` 归属资源，并可通过 `expose()` 提供明确的横切方法。二者随同一个原生 PluginHost batch 安装和回滚，完整参考见 [§3](#3-中间件详细参考)。

### 1.5 Provider（提供者）与 Contract（契约）

`provider` 是通过 `endpoint.provide(method, fn)` 注册的函数，签名固定为：

```ts
type IWebRpcProvider = (
  context: IWebRpcContext
) => IWebRpcProviderResult | Promise<IWebRpcProviderResult>

type IWebRpcContext = {
  readonly data: unknown // 调用方传入的参数（已经过 contract() 的 schema 校验，如果配置了的话）
  readonly signal: IWebRpcAbortSignal // 调用方取消时会触发
  success(data?: unknown, options?: { transfer?: readonly unknown[] }): IWebRpcProviderResult
  failed(message: string, code: string): IWebRpcProviderResult
  dispatchTo(input: { id?: string; method: string; data: unknown }): void // 主动向调用方推一条单向消息
}
```

`contract()` 中间件负责声明协议版本号，以及（可选）每个方法的 `params`/`result` schema——`IWebRpcSchema` 只要求一个 `parse(value): T` 方法，所以 zod、valibot、arktype 等任何实现了这个最小接口的校验库都能直接用：

```ts
contract({
  version: '1',
  schemas: {
    add: {
      params: z.object({ a: z.number(), b: z.number() }),
      result: z.number()
    }
  }
})
```

配置了 schema 后，参数和返回值在跨越网络边界时都会被强校验，校验失败抛 `WebRpcSchemaValidationError`（`code: 'SCHEMA_INVALID'`），而不是让格式错误的数据静默流入业务逻辑。

### 1.6 Adapter（适配器）

适配器是"某个具体宿主 API"和 `IWebRpcTransport` 接口之间的胶水代码，比如 `createWebWorkerTransport(worker)` 把一个 `Worker` 实例包装成 `IWebRpcTransport`。适配器不在包的主入口导出（避免把浏览器专属代码打进不需要它们的 bundle），需要按需从子路径引入，完整参考见 [§4](#4-传输适配器详细参考)。

---

## 2. 入口、预设、Feature 组合与构造配置

### 2.1 应该从哪里导入

| 入口                                   | 工厂/定义                | endpoint 根对象的公开能力                         | 适用场景                     |
| -------------------------------------- | ------------------------ | ------------------------------------------------- | ---------------------------- |
| `@migaia/web-rpc`                      | `createEndpoint`         | 完整预设；等同 `createFullEndpoint`               | 兼容性入口、需要全部一等能力 |
| `@migaia/web-rpc/full`                 | `createFullEndpoint`     | outbound + provider + discovery + control + chunk | 显式完整端点                 |
| `@migaia/web-rpc/client`               | `createClientEndpoint`   | kernel + outbound                                 | 只发请求/事件                |
| `@migaia/web-rpc/provider`             | `createProviderEndpoint` | kernel + outbound + `provide`                     | 暴露方法且可能回调对端       |
| `@migaia/web-rpc/core`                 | `createComposedEndpoint` | kernel + 显式原生 Feature 的根投影                | 自定义最小能力集合           |
| `@migaia/web-rpc`                      | `defineFeature` / `defineMiddleware` | 定义返回的 surface 决定            | 原生扩展                     |
| `@migaia/web-rpc/adapters/<transport>` | transport factory        | 不改变 endpoint 表面                              | 按宿主环境选择传输           |

所有 endpoint 都有 kernel 表面：`on()`、`hooks.on()`、`dispose()`。只有完整预设或显式选择的 Feature 才增加其他方法。要获得可靠 tree-shaking，应直接导入最窄预设或 `/core` 与单独 Feature 子路径，不要从根入口导入完整预设后再只使用其中一部分。

### 2.2 三个预设

只调用远端：

```ts
import { createClientEndpoint } from '@migaia/web-rpc/client'
import { connect } from '@migaia/web-rpc'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'

const [clientTransport, providerTransport] = createMemoryTransportPair()

const client = await createClientEndpoint({
  id: 'client',
  targetIds: ['provider'],
  transport: clientTransport,
  middlewares: [connect({ transport: clientTransport })]
})
```

暴露方法：

```ts
import { createProviderEndpoint } from '@migaia/web-rpc/provider'
import { connect } from '@migaia/web-rpc'

const server = await createProviderEndpoint({
  id: 'provider',
  transport: providerTransport,
  middlewares: [connect({ transport: providerTransport })]
})

server.provide('sum', (context) => {
  const values = context.data as readonly number[]
  return context.success(values.reduce((total, value) => total + value, 0))
})

const result = await client.send<number>('provider', 'sum', [1, 2, 3])
```

根入口的 `createEndpoint` 与 `/full` 的 `createFullEndpoint` 是同一函数引用。完整预设适合确实需要完整表面的应用；它不是推荐给所有调用方的默认最小 bundle。

### 2.3 自定义原生 Feature 与 Middleware

```ts
import { connect, createFullEndpoint, defineFeature, defineMiddleware } from '@migaia/web-rpc'

const status = defineFeature(() => ({ status: () => 'ready' }))
const metrics = defineMiddleware('metrics', (core) => ({
  install: () => {
    core.own({}, () => console.log('metrics disposed'))
    return {}
  },
  expose: () => ({ endpointId: () => core.id })
}))

const endpoint = await createFullEndpoint({
  id: 'dashboard',
  transport,
  middlewares: [connect({ transport }), metrics] as const,
  features: [status] as const
})

endpoint.status()
endpoint.endpointId()
```

- Feature 返回的 surface 决定公开根投影；私有依赖不扩大公开 API。
- Middleware 通过 `core.own()` 交给 Host 清理，并可通过 `expose()` 明确投影横切方法。
- 构造是异步、原子的：任何 Feature 或 Middleware 安装失败时，已安装项会逆序清理，原始失败保留在 `cause` / `AggregateError.errors` 链中。

### 2.4 完整构造配置

```ts
type IWebRpcFactoryConfig<TTargetId extends string = string> = {
  readonly id: string // 必需：本端在整个通信拓扑里的唯一标识
  readonly targetIds?: readonly TTargetId[] // 已知的对端 id 列表（自动发现模式下可省略，首次 send 会懒查询）
  readonly transport?: IWebRpcTransport // 实际收发消息用的传输适配器
  readonly provider?: Readonly<Record<string, IWebRpcProvider>> // 构造时就注册好的方法集合，等价于逐个调用 provide()
  readonly providerLimits?: { readonly maxGlobal?: number; readonly maxPerPeer?: number } // provider 并发上限，默认 256/64，超限立即 OVERLOADED
  readonly middlewares: readonly IWebRpcPlugin[] // 必需：必须包含且只能包含一个 connect()；其他 middleware 按需
  readonly replay?: { readonly maxEntries?: number; readonly ttlMs?: number } // 出站请求 id 的重放保护窗口容量与 TTL
  readonly construction?: {
    readonly signal?: IWebRpcAbortSignal // 构造期取消
    readonly timeoutMs?: number | false // 构造期超时，false 表示不限时
  }
}
```

- **`id`**：整个通信拓扑里必须唯一。它出现在每一条消息的 `senderId` 字段里，但**不是身份凭证**——见 [§11](#11-安全注意事项)。
- **`targetIds`**：只是"我已知这些 id"的预声明，不是必需的。自动发现模式下，第一次对未知 `targetId` 调用 `send`/`dispatch`/`ping` 会触发一次懒查询并缓存结果；`endpoint.discovery` 暴露的远端快照永远不包含 endpoint 自己。
- **`transport`**：可以在工厂配置或 `connect({ transport })` 中提供；两处都提供时必须是同一个对象。没有可解析出的 transport、或出现冲突，会在订阅消息前以 `INVALID_CONFIG` 失败。
- **中间件迁移**：`middlewares` 接受 `defineMiddleware` 或首方工厂返回的原生定义，并在同一个 PluginHost 批次中安装。旧版 `IWebRpcMiddlewareContext`/`install(context)` 描述符不再兼容，并会在订阅传输前以 `INVALID_CONFIG` 拒绝；自定义定义通过 `core.getShared()` 读取依赖，并用 `core.own()` 归属清理。
- **`provider`**：等价于在 `createEndpoint` 返回前，对每一项调用一次 `endpoint.provide(method, fn)`；纯粹是"少写几行"的便利写法。
- **`replay`**：出站请求/消息 id 会在一个有界窗口内保留，防止重放攻击复用同一个 id 让已完成的请求再跑一次 provider。普通请求的 id 在整个 TTL 内都不释放（哪怕响应已经收到）——这是有意为之，防止晚到的重复响应复活一个"看起来还在等"的旧请求；dispatch-only（单向通知）的 id 在发送结算后立即释放，因为它天生不会有响应需要防重放。默认容量 4096、TTL 310 秒；高频单向通知场景一般不需要调大，持续的双向请求量很大时可以按需调整。
- **`construction.signal` / `construction.timeoutMs`**：构造 `createEndpoint()` 本身也是异步的（要跑完全部中间件的 `install()`），可以用这两个字段取消或限时。取消会 reject 构造过程，并且仍然会清理已经安装成功的中间件（不会留下半初始化的资源）。中间件的 `install(context)` 会收到同一个 `signal`，如果中间件自己的初始化工作是可取消的，应该监听它。

### 2.5 PluginHost 的边界

Feature 与 middleware 的安装、依赖顺序、回滚和释放由包内的 PluginHost 统一管理；WebRPC 没有再实现一套平行生命周期系统。这个 PluginHost 是实现所有者，不是额外公开给业务代码的 endpoint API：业务代码只持有投影后的冻结 endpoint，并通过 `dispose()` 释放整棵资源。

因此不要依赖 Feature 安装顺序、内部 shared key 或内部 attachment 类。公开稳定边界是 package export map、endpoint 方法、middleware 配置、错误 `(source, code)` 与文档声明的生命周期语义。

---

## 3. 中间件详细参考

### 3.1 `contract(config?)`

```ts
contract({
  version?: string;               // 本端使用的协议版本号
  acceptVersions?: string[];      // 接受的对端版本号列表（默认只接受自己声明的 version）
  maxIdentifierLength?: number;   // senderId/targetId/method 等标识符的最大长度，默认 128
  schemas?: Record<string, { params: IWebRpcSchema; result: IWebRpcSchema }>;
})
```

版本不匹配时对端请求会被拒绝（`CONTRACT_VERSION_UNSUPPORTED`）。`schemas` 未覆盖的方法名不做参数/返回值校验——按方法名精确匹配，没有通配符。`maxIdentifierLength` **默认 128**，且这个默认值不依赖是否安装了 `contract()` 中间件——`createEndpoint` 内部读取 `contract` capability 时统一 `?? 128`，即使完全不装 `contract()`，`senderId`/`targetId`/`taskId`/`method`/`receiverId` 这些标识符字段也一律按 128 字符上限校验。传入非正安全整数会在构造期抛 `INVALID_CONFIG`。

### 3.2 `codec(descriptor)`

```ts
codec({
  encode?: (value: unknown) => unknown;   // 默认恒等
  decode?: (value: unknown) => unknown;   // 默认恒等
  encodedType?: 'any' | 'string' | 'uint8array';
})
```

决定信封（wire envelope）在发送前/接收后如何编解码。默认不做任何转换（适合传输本身就能传递结构化对象的场景，比如 `postMessage`）。需要自定义序列化格式（MessagePack、Protobuf 等）时在这里接入；`encodedType` 用于和传输层的编码要求做一致性校验，不一致会在构造期直接报错，而不是等到真正发送时才失败。

### 3.3 `connect(config)`

**几乎所有场景都需要这个中间件**——它同时负责来源校验和服务发现。

```ts
connect({
  transport?: IWebRpcTransport;   // 工厂层已经提供 transport 时可省略
  useBaseIdVerifyOnly?: boolean;  // 默认 true：只用适配器提供的 peerId/origin 做基础校验
  identifier?: (context: IWebRpcConnectContext) => boolean | Promise<boolean>; // useBaseIdVerifyOnly: false 时必须提供
  uniqueTargetId?: string | ((context) => string | Promise<string>); // 见下方说明，不是凭证
  discoveryMode?: 'automatic' | 'manual';  // 默认 automatic
  receiverSelector?: (serverList, context) => string | undefined | Promise<string | undefined>; // 自定义多接收端选路
})
```

- **`useBaseIdVerifyOnly: true`（默认）**：只用适配器提供的 `peerId`/`origin` 元数据做基础一致性检查，不执行自定义 `identifier`。
- **`useBaseIdVerifyOnly: false`**：`identifier` 变为必需，且只在适配器提供的基础身份先通过之后才会被调用——单独一个 `source` 对象不构成"基础身份"，必须配合匹配的 `peerId` 或 `origin`，或者显式切换到 `identifier` 模式。`identifier` 收到的 `context` 包含 `senderId`、`targetId`、适配器提供的 `peerId`/`origin`/`source`、`platform`、`topology`。
- **`uniqueTargetId`**：给同一个 `targetId` 下的多个接收端（比如同一个 BroadcastChannel 上跑着好几个 tab）加一个更细粒度的路由标识。**它是路由标识，不是身份凭证**——不要用它做鉴权判断。
- **`discoveryMode`**：`automatic`（默认）下 `endpoint.connect` 只暴露 `getServerList`/`pinReceiver`/`unpinReceiver` 三个只读控制；`manual` 下额外暴露 `query`/`onQuery`/`register`/`unregister`/`ping` 完整控制集，见 [§7](#7-服务发现自动模式与手动模式)。

### 3.4 `authentication(config)`

```ts
authentication({
  encrypt?: (value, context) => unknown | Promise<unknown>;
  decrypt?: (value, context) => unknown | Promise<unknown>;
  sign?: (value, context) => unknown | Promise<unknown>;
  verify?: (value, context) => unknown | Promise<unknown>;
  encodedType?: 'any' | 'string' | 'uint8array';
})
```

对**每一帧**（包括分片帧和 ping/pong/abort 这类控制帧）做保护，不是只保护业务请求/响应。`context` 里的 `direction: 'outbound' | 'inbound'` 告诉你当前是在处理发送还是接收方向。通道本身不可信（比如匿名 BroadcastChannel、未加密的 WebRTC 通道）时应当配置这个中间件；启用后，`Transfer` 列表（如 `ArrayBuffer` 的零拷贝转移）不再受支持，因为加密/签名要求先拿到序列化后的字节。

**成对校验规则（构造期强制，均抛 `INVALID_CONFIG`）**：`encrypt`/`decrypt` 必须同时提供或同时不提供，只给一个会被拒绝；`sign`/`verify` 同理。两对里至少要配置一对（`encrypt`+`decrypt`，或 `sign`+`verify`，或两对都配），完全不给任何一个函数同样会被拒绝——`authentication()` 存在的意义就是至少做一种保护，空配置没有意义。出站顺序固定是先 `encrypt` 后 `sign`（`protect`），入站顺序固定是先 `verify` 后 `decrypt`（`unprotect`），与配置的字段顺序无关。任一 transform 在执行期抛出的异常都会被统一包装成 `WebRpcAuthenticationError`（`code: 'AUTHENTICATION_FAILED'`）。

### 3.5 `framer(descriptor?)`

```ts
framer({
  chunkSize?: number;                 // 单帧最大字节数，超过则自动分片；未设不主动分片
  maxMessageBytes?: number;           // 单条消息（分片前）允许的最大总字节数；未设不检查
  maxConcurrentMessages?: number;     // 端点级别同时进行中的分片重组数量上限，默认 128
  maxConcurrentMessagesPerPeer?: number; // 单个 peer 的重组数量上限，默认 32
  maxBufferedBytes?: number;          // 分片重组缓冲区总字节上限，默认 16MiB（16 * 1024 * 1024）
  maxChunksPerMessage?: number;       // 单条消息允许的最大分片数，默认 4096
  maxChunkBytes?: number;             // 单个分片帧允许的最大字节数，默认 4MiB（4 * 1024 * 1024）
  assemblyTimeoutMs?: number;         // 重组超时，超时未收全则丢弃并报错，默认 30000（30 秒）
  byteLength?: (value: string) => number; // 自定义字节长度测量（默认按 UTF-8）
  split?: (value: string, maxBytes: number) => readonly string[]; // 自定义切分算法
})
```

超过 `chunkSize` 的字符串消息才会被切分；已经是 `Uint8Array` 的消息不支持分片（必须走能整体传输大二进制的传输通道）。**八个可配置项里只有 `chunkSize`/`maxMessageBytes` 是真正的"不设置就不限"**，其余六个容量维度（`maxConcurrentMessages`/`maxConcurrentMessagesPerPeer`/`maxBufferedBytes`/`maxChunksPerMessage`/`maxChunkBytes`/`assemblyTimeoutMs`，分别对应并发消息数、单 peer 消息数、总缓冲字节、分片数、分片字节、重组超时）即使完全不配置也带有上面标注的内置默认值，任意一项超限都会拒绝或丢弃对应的重组任务，防止异常/恶意大消息把内存占满。传入的值必须是正安全整数，否则构造期抛 `INVALID_CONFIG`。分片传递不提供确认应答或重试状态机；需要可靠语义时由业务协议显式定义。

### 3.6 `timeout(config?)`

```ts
timeout({
  timeoutMs?: number | false;    // 默认超时时长，false 表示不限时
})
```

`send()` 调用时可以在 `options.timeoutMs` 里覆盖这个默认值。每次请求只发送一次；调用方负责业务层失败处理。

### 3.7 `ping()`

在 full preset，或显式选择了 `control()` Feature 的组合里，安装后 endpoint 才获得 `ping(targetId, receiverId?, options?)` / `pingAll()`。类型层面同时要求 control Feature 与 `ping()` middleware；缺任一层都不会承诺该方法。`options` 支持 `timeoutMs` 与 `signal`。不可达、超时、传输发送失败和调用信号取消会结算为 `false`；无效标识符、非法 timeout、UUID 冲突和已释放 endpoint 等本地契约/生命周期错误仍会抛出。

### 3.8 `abort()`

让 `send()`/`sendAll()` 支持通过 `options.signal` 传入的 `AbortSignal` 取消进行中的请求。

### 3.9 `hooks(config?)`

```ts
hooks({
  listeners?: IWebRpcHook | readonly IWebRpcHook[];
  onHookError?: (error: unknown, event: IWebRpcHookEvent) => void;
})
```

订阅框架内部生命周期事件用于日志、监控、调试；`endpoint.hooks.on(listener)` 是运行时动态订阅的等价方式，两者可以同时使用。完整事件列表见 [§10](#10-可观测性hooks-事件参考)。

### 3.10 `uuid(config?)`

自定义请求/消息 id 的生成策略，默认使用内置的安全随机生成器。需要和外部系统的 trace id 体系对齐时可以在这里接入自定义生成函数。

---

## 4. 传输适配器详细参考

### 4.1 `createWindowMessageTransport(options)` — `@migaia/web-rpc/adapters/window`

```ts
createWindowMessageTransport({
  target: IWindowMessageTarget;        // 必填，无默认值：出站投递目标，如 iframe.contentWindow / window.opener
  receiver?: IWindowMessageReceiver;   // 默认当前 window
  targetOrigin?: string;               // 默认 window.location.origin；跨源必须显式传
  allowUnsafeTargetOrigin?: boolean;   // 显式opt-in 通配符投递
})
```

`target`（满足 `{ postMessage(message, targetOrigin, transfer?) }` 的对象，如 `iframe.contentWindow`/`window.opener`）是**唯一的必填字段**，没有默认值——不传会在构造期直接抛 `INVALID_CONFIG`。同源场景下 `receiver`/`targetOrigin` 都可以省略，走默认值。跨源场景必须显式传 `targetOrigin`，否则框架会拒绝以通配符 `*` 方式发送——这是刻意的默认拒绝，需要通配符投递必须显式 `allowUnsafeTargetOrigin: true` 才能启用（这个开关只影响**出站**的 origin 过滤，**入站**消息的 `source` 校验不受影响，依然会被验证）。`postMessage` 无法可靠感知对方窗口/iframe 被关闭，请依赖有限的操作超时（`timeout()` 中间件的默认行为）或显式的宿主生命周期信号，`timeoutMs: false` 只是显式允许无限等待，不代表框架能检测到对方关闭。

### 4.2 `createBrowserMessagePortTransport(port, options?)` — `@migaia/web-rpc/adapters/message-port`

```ts
createBrowserMessagePortTransport(port, { ownership?: 'owned' | 'borrowed' })
```

默认 `ownership: 'owned'`——`dispose()` 时框架会关闭传入的 `port`。调用方需要自己保留端口控制权（比如这个 port 还要给别的地方用）时传 `{ ownership: 'borrowed' }`，此时清理阶段只移除框架自己挂的监听器，不关闭底层端口。

另有 `createNodeMessagePortTransport(port)` 适配 Node.js 的 `worker_threads` MessagePort，接口形状略有差异（`INodeMessagePortLike`），用法一致。

### 4.3 `createWebWorkerTransport(worker)` — `@migaia/web-rpc/adapters/web-worker`

包装 `Worker`/`MessagePort` 一类对象。`error`（脚本执行失败）和 `messageerror`（结构化克隆失败）这两类原生事件本身不带消息 payload，无法映射成"哪个请求失败了"，框架统一通过 `onTransportError` 上报，效果是让**当前全部**挂起请求立即失败，而不是让它们各自等到超时才发现出了问题。

### 4.4 `createSharedWorkerTransport(port)` — `@migaia/web-rpc/adapters/shared-worker`

包装 `SharedWorker` 的 `port`。类型定义不依赖 DOM 或 Worker 全局类型，即使在既不是浏览器也不是 Worker 的 `lib` 编译目标下也能正常类型检查（适合跨运行时共享的类型定义文件）。SharedWorker 天生是 `multiplexed` 拓扑（多个标签页共享同一个 worker 实例），务必配合 `connect()` 的身份校验使用。

### 4.5 `createServiceWorkerTransport(options)` — `@migaia/web-rpc/adapters/service-worker`

```ts
createServiceWorkerTransport({ target, receiver, peerId? })
```

ServiceWorker 场景发送方和接收方是两个独立的宿主对象（页面 `postMessage` 给 controller，接收走 `navigator.serviceWorker` 的 `message` 事件），因此需要分别传入 `target`（发送目标）和 `receiver`（接收来源）。

### 4.6 `createBroadcastChannelTransport(channel)` — `@migaia/web-rpc/adapters/broadcast-channel`

包装一个原生 `BroadcastChannel` 实例。**这是匿名广播路由，不是身份边界**——同源的任何脚本都能打开同名 `BroadcastChannel` 观察和伪造帧。真正需要防伪造/防窃听时必须叠加 `authentication()` 中间件，或者改用需要显式握手的传输。详见 [§11](#11-安全注意事项)。

### 4.7 `createRtcDataChannelTransport(channel)` — `@migaia/web-rpc/adapters/rtc-data-channel`

包装一个 WebRTC `RTCDataChannel`。**构造时要求 `channel.readyState` 已经是 `'open'` 或 `'closed'`**——处于 `'connecting'`/`'closing'` 等中间状态时传入会直接抛 `INVALID_CONFIG`（`'RTCDataChannel must be open before transport construction'`），调用方需要自己等到 `channel.readyState === 'open'`（或已知连接已 `'closed'`）之后再构造传输，适配器不负责等待连接建立。要求使用可靠有序模式（创建时 `ordered: true`，默认就是），框架依赖消息按发送顺序到达。内部固定 `encodedType: 'string'`，`send()` 会把非字符串消息 `JSON.stringify` 后再发送。

### 4.8 `createWebTransportDatagramTransport(datagrams)` — `@migaia/web-rpc/adapters/web-transport`

```ts
createWebTransportDatagramTransport({ writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> })
```

包装 HTTP/3 WebTransport 的 datagram 读写流。datagram 是无连接、无内建分帧的字节流，codec/framer descriptors 需要自行处理好帧边界；适配器内部维护一个贯穿整个传输生命周期的持久 reader——取消订阅（移除所有 RPC 监听器）不会连带取消这个 reader，只有调用 `close()` 才会真正取消 reader、释放读锁、关闭 writer；第二次调用 `close()` 会复用第一次的 close 结果，不会重复执行清理。

### 4.9 `createMemoryTransportPair()` — `@migaia/web-rpc/adapters/memory`

```ts
const [transportA, transportB] = createMemoryTransportPair()
```

不依赖任何浏览器/Node 特有 API，两端就是同一个 JS 堆里的一对互相连通的传输，投递通过 `queueMicrotask` 模拟真实异步传输的时序（不是同步回调），因此依赖"调用 `send()` 之后对方还没立即收到"这个假设的代码在这个适配器上依然成立。**仅供单元测试和本地联调使用**，不代表生产可用的进程间/跨端通信方案。

---

## 5. 自定义传输适配器

只需要实现 `IWebRpcTransport` 接口（完整字段见 [§1.2](#12-transport传输)），最小实现只有两个必需方法：

```ts
import type { IWebRpcTransport } from '@migaia/web-rpc'

function createMyTransport(socket: MyRawSocket): IWebRpcTransport {
  return {
    platform: 'Memory', // 没有贴切的内置值时可以选一个语义最接近的
    topology: 'exclusive', // 如实声明拓扑，见 §1.2
    send(message) {
      socket.write(JSON.stringify(message))
    },
    subscribe(listener) {
      const onData = (raw: string) => listener({ data: JSON.parse(raw) })
      socket.on('data', onData)
      return () => socket.off('data', onData)
    },
    close() {
      socket.close()
    },
    onTransportError(listener) {
      socket.on('error', listener)
      return () => socket.off('error', listener)
    }
  }
}
```

要点：

- `topology` 必须如实反映这条通道的复用情况，声明错误会破坏框架的身份信任假设（见 §1.2 表格）。
- `platform` 只是一个描述性标签（用于 hooks 事件、日志），选一个语义最接近的内置值即可，不影响功能。
- `close`/`onTransportError`/`onListenerError` 都是可选的，但强烈建议实现：没有 `onTransportError` 时，底层连接异常断开不会让挂起请求主动失败，只能干等超时。
- 所有传给你的回调（中间件 `install`、`provider`、`verifier`）都以裸函数形式调用，不依赖 `this`，请用箭头函数或闭包捕获状态。

---

## 6. Endpoint 公开 API 参考

下列是 full preset 的最大公开表面。client、provider 和自定义组合只拥有 [§2](#2-入口预设feature-组合与构造配置) 所列子集；读取一个未选择 Feature 的方法得到 `undefined`，TypeScript 的精确入口类型也不会声明它。

```ts
type IWebRpcEndpoint<TTargetId extends string = string> = {
  provide(method: string, provider: IWebRpcProvider): IWebRpcEndpoint<TTargetId>
  on(event: string, listener: IWebRpcEventListener): () => void
  send<T>(targetId: TTargetId, method: string, data: unknown, options?: ISendOptions): Promise<T>
  sendAll<T>(method: string, data: unknown, options?: ISendOptions): Promise<IWebRpcFanoutResult<T>>
  dispatch(targetId: TTargetId, method: string, data: unknown): void
  dispatchAll(method: string, data: unknown): void
  ping(targetId: TTargetId, receiverId?: string, options?: IWebRpcPingOptions): Promise<boolean> // control Feature + ping() middleware
  pingAll(): Promise<IWebRpcFanoutResult<boolean>> // control Feature + ping() middleware
  readonly connect: IWebRpcConnectControlForMode<TTargetId, TMode>
  readonly discovery: IWebRpcDiscoveryControl<TTargetId>
  readonly hooks: { on(listener: IWebRpcHook): () => void }
  dispose(): Promise<void>
}
```

| 方法                                                  | 参数类型                                                                                                                                                                            | 同步/异步                                                                                                                                  | 说明                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `provide(method, fn)`                                 | `method: string`；`fn: IWebRpcProvider`（即 `(context: IWebRpcContext) => IWebRpcProviderResult \| Promise<IWebRpcProviderResult>`）                                                | 同步（直接返回 `this`）                                                                                                                    | 注册一个方法处理函数，返回 `this` 以支持链式调用；`method` 重复注册会抛错                                                               |
| `on(event, listener)`                                 | `event: string`；`listener: IWebRpcEventListener`（即 `(context: IWebRpcContext) => void \| Promise<void>`）                                                                        | 同步（直接返回取消订阅函数）                                                                                                               | 监听对端通过 `dispatch()`/`dispatchAll()` 发来的单向通知，返回取消订阅函数                                                              |
| `send<T>(targetId, method, data, options?)`           | `targetId: TTargetId`；`method: string`；`data: unknown`；`options?: ISendOptions`（`{ signal?: IWebRpcAbortSignal; timeoutMs?: number \| false; transfer?: readonly unknown[] }`） | 异步（返回 `Promise<T>`）                                                                                                                  | 发起一次双向调用并等待结果；`options` 支持 `signal`（需要 `abort()` 中间件）、`timeoutMs`（覆盖默认超时）、`transfer`（零拷贝转移列表） |
| `sendAll<T>(method, data, options?)`                  | `method: string`；`data: unknown`；`options?: ISendOptions`                                                                                                                         | 异步（返回 `Promise<IWebRpcFanoutResult<T>>`）                                                                                             | 向当前全部已知/存活的对端发起同一次调用，返回按目标聚合的结果集，见下方 `IWebRpcFanoutResult`                                           |
| `dispatch(targetId, method, data)`                    | `targetId: TTargetId`；`method: string`；`data: unknown`                                                                                                                            | 同步（返回 `void`）                                                                                                                        | 单向通知，不等待、不产生响应，同步返回（内部异步执行）                                                                                  |
| `dispatchAll(method, data)`                           | `method: string`；`data: unknown`                                                                                                                                                   | 同步（返回 `void`）                                                                                                                        | 单向广播给全部已知/存活对端                                                                                                             |
| `ping(targetId, receiverId?, options?)` / `pingAll()` | `targetId: string`；`receiverId?: string`；`options?: IWebRpcPingOptions`（`{ timeoutMs?: number; signal?: IWebRpcAbortSignal }`）；`pingAll()` 无参数                              | 异步（分别返回 `Promise<boolean>` / `Promise<IWebRpcFanoutResult<boolean>>`）                                                              | 存活探测；不可达/超时/传输失败/调用取消返回 `false`，本地契约和生命周期错误仍抛出                                                       |
| `connect`                                             | 不适用（只读属性，非函数；其下各方法各自的参数见 §7）                                                                                                                               | 视情况（`getServerList`/`pinReceiver`/`unpinReceiver`/`onQuery`/`register` 是同步方法，`query`/`unregister`/`ping` 返回 `Promise`，见 §7） | 服务发现的读写控制，自动模式下只读（`getServerList`/`pinReceiver`/`unpinReceiver`），手动模式下额外有查询/注册控制，见 §7               |
| `discovery`                                           | 不适用（只读属性，非函数）                                                                                                                                                          | 同步（暴露的 `getServerList`/`pinReceiver`/`unpinReceiver` 均为同步方法，不返回 `Promise`）                                                | 只读的远端服务发现快照，等价于 `connect` 的只读子集，命名上更强调"这是给调试/观测用的"                                                  |
| `hooks.on(listener)`                                  | `listener: IWebRpcHook`（即 `(event: IWebRpcHookEvent) => void \| Promise<void>`）                                                                                                  | 同步（直接返回取消订阅函数）                                                                                                               | 运行时动态订阅生命周期事件，等价于 `hooks()` 中间件的 `listeners` 配置项                                                                |
| `dispose()`                                           | 无参数                                                                                                                                                                              | 异步（返回 `Promise<void>`）                                                                                                               | 释放 endpoint，见 [§9](#9-生命周期与资源释放)                                                                                           |

`IWebRpcFanoutResult<T>`：

```ts
type IWebRpcFanoutResult<T> = {
  readonly fulfilled: Partial<Record<string, T>> // key → 成功结果
  readonly rejected: Partial<Record<string, unknown>> // key → 失败原因
}
```

`fulfilled`/`rejected` 使用**空原型对象**（`Object.create(null)`），因为 key 来自不可信的 `targetId`/`receiverId` 字符串——检查一个特定 key 是否存在时用 `Object.hasOwn(result.fulfilled, key)`，不要用 `key in result.fulfilled` 或直接假设它是普通对象（`__proto__` 这类字符串作为合法 target id 时，普通对象会把它解释成原型链操作而不是一个数据 key）。key 本身也不是裸的 `targetId` 字符串，而是打了标签的 `JSON.stringify(...)` 元组，两种形态并存：匿名投递（没有具体接收端信息）用 `JSON.stringify(['target', targetId])`；已识别到具体接收端的投递用 `JSON.stringify(['receiver', targetId, receiverId])`——避免不同 `targetId` 下相同 `receiverId` 互相覆盖，也避免和匿名投递的 key 撞在一起。查找结果时同样要用这个格式构造 key，不能直接用 `targetId` 去查。`sendAll`/`pingAll` 在取"当前有哪些对端"的快照之前会先检查 endpoint 是否已释放，因此哪怕当前一个已知对端都没有，对一个已释放的 endpoint 调用 `sendAll` 依然会稳定地失败，而不是返回一个空结果集。

---

## 7. 服务发现：自动模式与手动模式

`connect()` 中间件的 `discoveryMode` 决定 endpoint 如何知道"某个 `targetId` 背后现在有哪些接收端存活"，两种模式互斥。以下 API 还要求 full preset 或显式选择 `discovery()` Feature；client/provider 预设虽然内部使用 connect 做来源准入，但不会公开 `endpoint.connect` / `endpoint.discovery`。

### 7.1 自动模式（默认）

首次对一个未预先声明在 `targetIds` 里的 `targetId` 调用 `send`/`dispatch`/`ping` 时，框架自动发起一次发现查询，并把结果透明缓存下来；之后同一个 `targetId` 的调用直接复用缓存，不会重复查询。`endpoint.connect`（等价于 `endpoint.discovery`）只暴露只读控制：

```ts
endpoint.connect.getServerList(targetId?); // 查看当前已知的接收端快照（不含 endpoint 自己）
endpoint.connect.pinReceiver(targetId, receiverId); // 固定路由到某个具体接收端
endpoint.connect.unpinReceiver(targetId); // 取消固定
```

没有 pin 的情况下，一次 `send`/`ping` 可能被投递给某个 `targetId` 下**全部**当前存活的接收端，第一个有效响应（无论成功还是失败）就会结算这次调用；`sendAll`/`pingAll` 则会在有发现元数据的情况下为每个接收端各保留一条独立结果。已经 pin 住的接收端如果后续注销，不会静默切换到另一个接收端继续工作——这是有意的：pin 意味着调用方明确要求"就是这一个"，切走反而可能是错误行为。

### 7.2 手动模式（`discoveryMode: 'manual'`）

```ts
endpoint.connect.query(targetId, options?);           // 主动发起一次发现查询
endpoint.connect.onQuery(listener);                   // 监听别人发来的发现查询
endpoint.connect.register(candidate);                 // 把一个候选接收端注册进本地路由表
endpoint.connect.unregister(targetId, receiverId?);    // 从本地路由表移除
endpoint.connect.ping(candidate, options?);            // 对某个候选做纯粹的存活探测
```

手动模式下**没有隐式的自动查询**，`query()` 只返回候选列表，不会自动帮你 `register()`——需要某个接收端变得可路由，必须显式 `register()`。`ping()` 在手动模式下只做 ping/pong 探测，不会附带发现或修改路由表这类副作用。收到的、还没被 `accept`/`reject` 的入站查询会在一个有限的时间窗口后自动过期，过期不会永久占用"待处理查询"的配额上限。

### 7.3 发现相关的生命周期事件

`connect.receiver-registered`、`connect.server-unregistered`、`connect.receiver-pinned`、`connect.receiver-unpinned`、`connect.pinned-receiver-lost`、`connect.multiple-receivers` 这几个 hook 事件覆盖了接收端的注册/注销/固定/多接收端并存等情况；`connect.multiple-receivers` 事件带有 `requesterId` 和一份冻结的 `receiverIds` 快照，方便在日志里定位"这次调用当时到底看到了哪几个候选"。**接收端的注册/注销通知本身只是发现层的元数据**，不代表安全边界——真正的 RPC 请求/响应依然要经过 `connect()` 的身份校验，注册一个假的候选并不能绕过这层校验。

---

## 8. 错误处理

所有跨包失败都携带稳定、不本地化的 `(source, code)`，但**不保证都是 `WebRpcError` 类实例**。参数和边界校验会保留原生 `TypeError` / `RangeError`，多项失败会保留 `AggregateError`，对端业务失败是 `WebRpcRemoteError`；这些对象仍会附加 WebRPC 的错误身份。业务逻辑应优先按 `source` / `code` 分支，不要匹配可能变化的 `message`，需要原生语义时再用 `instanceof TypeError` / `AggregateError`。

```ts
import {
  WEBRPC_SOURCE,
  isWebRpcError,
  WebRpcErrorCode,
  WebRpcConfigurationError,
  WebRpcProtocolError,
  WebRpcContractError,
  WebRpcTransportError,
  WebRpcChunkError
} from '@migaia/web-rpc'

try {
  await endpoint.send('server', 'add', { a: 1, b: 2 })
} catch (error) {
  if (isWebRpcError(error)) {
    switch (error.code) {
      case WebRpcErrorCode.deadlineExceeded:
        // 超时，由调用方按业务策略处理
        break
      case WebRpcErrorCode.authenticationFailed:
        // 鉴权失败，通常应提示配置问题
        break
      default:
      // 兜底处理
    }
  }
}
```

`WEBRPC_SOURCE` 是稳定 source 常量。`WebRpcConfigurationError`、`WebRpcProtocolError`、`WebRpcContractError`、`WebRpcTransportError` 与 `WebRpcChunkError` 是按失败域细分的公开子类；它们便于日志/框架适配器做粗粒度归类，但业务恢复仍应以 `(source, code)` 为准，因为原生 `TypeError`、`RangeError`、`AggregateError` 也可能携带同一错误身份。

### 错误码完整参考

| Code                                                  | 触发场景                                                          | 建议处理                                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `MIDDLEWARE_DUPLICATED`                               | 同一个中间件被重复安装                                            | 检查 `middlewares` 数组，构造期问题，修配置                                              |
| `MIDDLEWARE_MISSING`                                  | 调用了需要某个中间件（如 `ping`）但没安装它的方法                 | 补齐对应中间件                                                                           |
| `PLUGIN_INSTALL_FAILED`                               | 某个中间件的 `install()` 执行时抛出异常（`cause` 挂原始安装异常） | 检查该中间件的工厂实现/配置；安装失败是稳定错误，不要对同一描述符重试                    |
| `INVALID_CONFIG`                                      | `createEndpoint()` 配置本身不合法（含读取配置字段时抛出的异常）   | 修配置；这类错误在任何中间件产生副作用**之前**抛出                                       |
| `PROVIDER_DUPLICATED`                                 | 同一个方法名被 `provide()` 注册了两次                             | 检查方法名是否冲突                                                                       |
| `UUID_UNAVAILABLE` / `UUID_INVALID` / `UUID_CONFLICT` | 自定义 `uuid()` 中间件生成的 id 不合法或冲突                      | 检查自定义生成函数的实现                                                                 |
| `PROTOCOL_INVALID`                                    | 协议编解码失败                                                    | 检查 codec descriptor 的 `encode`/`decode` 实现或对端协议是否一致                       |
| `PROTOCOL_UNSUPPORTED`                                | 协议输出类型和传输要求的 `encodedType` 不匹配                     | 调整 codec descriptor/`encodedType` 配置                                                  |
| `PROTOCOL_DECRYPT_FAILED`                             | `authentication()` 的解密/验签失败                                | 通常代表消息被篡改或密钥不匹配，不建议重试                                               |
| `CONTRACT_INVALID`                                    | 契约配置本身不合法                                                | 检查 `contract()` 配置                                                                   |
| `CONTRACT_VERSION_UNSUPPORTED`                        | 对端协议版本不在可接受范围                                        | 升级/降级到兼容版本                                                                      |
| `PAYLOAD_INVALID`                                     | 序列化/反序列化失败，或分片校验失败                               | 检查发送的数据是否可序列化                                                               |
| `PAYLOAD_TOO_LARGE`                                   | 消息超过 framer descriptor 配置的大小上限                         | 调大限制或减小消息体积                                                                   |
| `METHOD_NOT_FOUND`                                    | 调用了对端没有 `provide()` 的方法名                               | 检查方法名拼写、确认对端已注册                                                           |
| `PROVIDER_NOT_FOUND`                                  | provider 执行器在入站处理阶段解析不到目标 method 的 provider      | 检查 method 是否已 `provide()`；与 `METHOD_NOT_FOUND` 语义相邻但是独立的错误码，不可重试 |
| `PROVIDER_NOT_SETTLED`                                | provider 函数没有正确返回 `success()`/`failed()` 结果             | 检查 provider 实现                                                                       |
| `INTERNAL`                                            | 框架内部未分类错误                                                | 附带原始 `cause`，需要具体排查                                                           |
| `TARGET_UNKNOWN`                                      | 目标 `targetId` 未知且发现失败                                    | 确认目标 id 正确、对端在线                                                               |
| `TARGET_NOT_IDENTIFIABLE`                             | 目标存在但无法唯一定位到具体接收端                                | 检查是否需要 `uniqueTargetId`/`pinReceiver`                                              |
| `ENDPOINT_DISPOSED`                                   | 在 `dispose()` 之后继续使用 endpoint                              | 检查生命周期管理，不要在释放后调用                                                       |
| `CANCELLED`                                           | 请求被 `AbortSignal` 主动取消                                     | 业务预期内的取消，通常不需要当作异常处理                                                 |
| `DEADLINE_EXCEEDED`                                   | 请求超时                                                          | 由调用方按业务策略处理                                                                   |
| `PROVIDER_CONTEXT_EXPIRED`                            | provider 在其 `context` 已过期后才尝试结算                        | 检查 provider 是否有异步逻辑跑得太久                                                     |
| `TRANSPORT`                                           | 底层传输发送/接收失败                                             | 传输层问题，检查连接状态                                                                 |
| `AUTHENTICATION_FAILED`                               | `authentication()`/`connect()` 校验未通过                         | 安全相关，不建议自动重试                                                                 |
| `UNAUTHENTICATED` / `FORBIDDEN`                       | 权限相关拒绝                                                      | 检查鉴权配置或用户权限                                                                   |
| `UNAVAILABLE`                                         | 依赖的能力当前不可用                                              | 检查前置条件                                                                             |
| `SCHEMA_INVALID`                                      | `contract()` 配置的 schema 校验未通过                             | 检查参数/返回值是否符合约定的 schema                                                     |
| `CAPABILITY_CONFLICT`                                 | 多个中间件/配置之间的能力声明冲突                                 | 检查中间件组合是否合理                                                                   |
| `OVERLOADED`                                          | 出站 id 账本、并发限制等资源预算耗尽                              | 降低发送频率或调大对应限制（如 `replay.maxEntries`）                                     |
| `CHUNK_INVALID`                                       | 分片帧不合法                                                      | 检查 framer descriptor 自定义 `split`/`byteLength` 实现                                  |
| `CHUNK_TOO_LARGE`                                     | 单条消息或单个分片超过配置上限                                    | 调整 framer descriptor 限制                                                               |
| `CHUNK_CAPACITY_EXCEEDED`                             | 并发重组数量/缓冲区超限                                           | 降低并发大消息发送量或调大限制                                                           |
| `CHUNK_RECEIVE_TIMEOUT`                               | 分片重组在 `assemblyTimeoutMs` 内未收全                           | 检查网络稳定性，或调大超时                                                               |
| `CHUNK_ACK_TIMEOUT`                                   | 分片确认超时（预留字段，当前分片层不做确认应答）                  | 见 framer descriptor 说明——分片层是尽力而为传递                                          |

`WebRpcRemoteError` 专门代表"对端 provider 主动调用 `ctx.failed(message, code)` 返回的业务失败"，其 `data` 字段携带 provider 传回的附加数据。它继承原生 `Error` 而不是 `WebRpcError`，但仍有 `source` / `code`，所以 `isWebRpcError()` 能按结构识别它。

`WebRpcConstructionError`/`WebRpcLifecycleError`/`WebRpcAbortError`/`WebRpcTimeoutError` 这几个子类在特定场景下会额外携带 `cleanupErrors`（构造/释放过程中，各个资源各自的清理失败详情，见 [§9](#9-生命周期与资源释放)）或 `cleanupPromise`（清理仍在进行中时可以 await 的句柄）。

---

## 9. 生命周期与资源释放

`dispose()` 保证：

1. **立即结算全部进行中的请求**——不会让调用方永远挂起等一个再也不会有结果的 Promise。
2. **立即让入站的 provider 执行上下文失效**——释放过程中新到达的请求不会被处理。
3. **按预期顺序清理**：中间件卸载、传输连接关闭、发现注册表清理等，任何一步失败都会被收集而不是让后续清理中断，最终如果有失败会以 `WebRpcLifecycleError` reject，其 `cleanupErrors` 是一个数组，每一项都保留了具体是哪个资源清理失败（`{ resource: string; error: unknown }`），方便定位到底是中间件、订阅、接收端注销通知，还是自己拥有的传输释放出了问题。
4. **幂等**：`dispose()` 可以安全地调用多次，后续调用复用第一次的清理结果，不会重复执行清理逻辑或产生新的副作用。

```ts
try {
  await endpoint.dispose()
} catch (error) {
  if (error instanceof WebRpcLifecycleError) {
    for (const { resource, error: cause } of error.cleanupErrors ?? []) {
      console.error(`清理 ${resource} 失败：`, cause)
    }
  }
}
```

构造期的取消/失败（`WebRpcConstructionError`/`WebRpcAbortError`）同样携带清理信息——即便构造还没完成就被取消，已经安装成功的那部分中间件依然会被正确回滚，不会留下半初始化的资源。

---

## 10. 可观测性：hooks 事件参考

通过 `hooks()` 中间件的 `listeners` 或 `endpoint.hooks.on(listener)` 订阅。每个事件都是 `IWebRpcHookEvent`：

```ts
type IWebRpcHookEvent = {
  readonly name: string
  readonly at: number // 事件发生时间戳
  readonly localId: string // 本端 id
  readonly code?: string
  readonly error?: unknown
  readonly contract?: unknown
  readonly variation?: unknown
  readonly targetId?: string
  readonly receiverId?: string
  readonly requesterId?: string
  readonly receiverIds?: readonly string[]
  readonly ambiguous?: boolean
  readonly responseCount?: number
}
```

常见事件一览：

| 事件名                                                  | 何时触发                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `receive.failure`                                       | 收到一条无法处理的入站消息（格式错误、校验失败等）                           |
| `authentication.rejected`                               | `authentication()`/`connect()` 的身份或完整性校验未通过                      |
| `response.unmatched`                                    | 收到一条响应，但找不到匹配的挂起请求（可能是重复响应或超时后晚到）           |
| `transport.failure`                                     | 传输层报告的错误（通过 `onTransportError`）                                  |
| `transport.listener.failure`                            | 某个 `subscribe` 监听器自身抛出异常                                          |
| `dispatch.failure`                                      | `dispatch()`/`dispatchAll()` 发送失败                                        |
| `dispose.failure`                                       | 释放过程中某个资源清理失败（对应 `cleanupErrors` 里的一项）                  |
| `variation.failure` / `variation.unmatched`             | ping/pong/abort 这类控制帧发送失败，或收到的控制帧找不到匹配的挂起状态       |
| `connect.receiver-registered`                           | 一个新的接收端被发现并注册进路由表                                           |
| `connect.server-unregistered`                           | 一个接收端注销（比如所在的 endpoint 被 dispose）                             |
| `connect.receiver-pinned` / `connect.receiver-unpinned` | `pinReceiver`/`unpinReceiver` 被调用                                         |
| `connect.pinned-receiver-lost`                          | 已经 pin 住的接收端注销了（不会自动切换到其他接收端，见 §7.1）               |
| `connect.multiple-receivers`                            | 一次调用同时看到了多个候选接收端；`ambiguous`/`receiverIds` 字段说明具体情况 |
| `connect.receiver-announcement.failure`                 | 接收端注册/注销的广播通知发送失败，或超出配额被拒绝                          |

`hooks()` 的 `onHookError` 回调专门捕获监听器自身抛出的异常，防止一个写错的日志监听器影响框架主流程。

---

## 11. 安全注意事项

1. **`senderId` 不是身份凭证**。它只是消息里的一个字符串字段，任何拿到消息的代码都能自己伪造一条 `senderId` 是别人的消息。真正的身份校验必须依赖传输适配器提供的、无法从消息内容里伪造的元数据（`peerId`、`origin`、`source`），通过 `connect()` 的 `identifier` 回调来判断。

2. **匿名 BroadcastChannel 是"诚实节点"路由模型，不是身份边界**。同源的任意脚本都可以打开同名频道，观察全部任务 id 和消息内容，也可以伪造发现帧或业务帧。这不是这个包的实现缺陷——`BroadcastChannel` 这个浏览器 API 本身就没有内建身份机制。需要防伪造/防窃听时，必须叠加 `authentication()` 中间件（保护每一帧，包括控制帧），不要把 `uniqueTargetId` 当凭证使用——它只是一个路由标识，没有任何防伪造设计。

3. **`multiplexed` 拓扑的传输必须要有身份校验**。声明为 `multiplexed` 的自定义传输，框架不会把"第一个观察到的发送方"当成唯一可信对端——这类通道必须提供 peer/source 身份，或者显式配置 `identifier` 校验，否则任何后来的发送方都可能冒充之前的对端。

4. **入站分片帧要求 `connect` 校验已经成功**。没有成功完成 connect 校验时，框架会拒绝接收分片帧，防止未认证的一方通过分片通道绕过校验、耗尽重组资源。

5. **`Fan-out` 结果的 key 来自不可信字符串**，务必用 `Object.hasOwn()` 检查，不要用 `in` 操作符或假设普通对象语义，见 [§6](#6-endpoint-公开-api-参考)。

6. **`authentication()` 保护每一帧，不只是业务请求/响应**。ping/pong、abort、分片帧、发现查询/响应帧都会经过同样的保护，这样对手无法通过伪造一条"看起来只是控制帧"的消息绕过鉴权。

---

## 12. 性能特征与内置限制

以下是框架内置的、影响资源占用与吞吐的默认限制维度（多数可通过对应中间件的配置项调整）：

| 维度                                | 归属                     | 默认值/说明                            |
| ----------------------------------- | ------------------------ | -------------------------------------- |
| 出站请求 id 重放窗口容量            | `replay.maxEntries`      | 4096                                   |
| 出站请求 id 重放窗口 TTL            | `replay.ttlMs`           | 310 秒                                 |
| 分片并发消息数（端点级）            | framer descriptor        | 按配置，未设默认不限                   |
| 分片并发消息数（单 peer）           | framer descriptor        | 按配置                                 |
| 单条消息最大分片数                  | framer descriptor        | 按配置                                 |
| 单个分片最大字节数                  | framer descriptor        | 按配置                                 |
| 分片重组总缓冲字节数                | framer descriptor        | 按配置                                 |
| 分片重组超时                        | framer descriptor        | 按配置                                 |
| 自动发现的入站查询并发/单 peer 限制 | `connect()` 自动模式内部 | 有界，超限时新查询被拒绝而不是无限排队 |
| 手动模式待处理入站查询配额          | `connect()` 手动模式内部 | 有界 + 超时自动过期，不会永久占用配额  |

这些限制存在的目的是**防止单个异常/恶意对端把内存或 CPU 打满**，不是随意设定的性能上限——生产环境一般不需要调整，除非你的场景本身就有超出默认假设的高并发/大消息需求。

分片传递是尽力而为（best-effort），不提供分片级确认应答或自动重试；可靠送达语义必须由业务协议显式定义。

---

## 13. 完整场景示例

### 13.1 主线程调度 Web Worker

```ts
// worker.ts
import { contract, codec, connect } from '@migaia/web-rpc'
import { createProviderEndpoint } from '@migaia/web-rpc/provider'
import { createWebWorkerTransport } from '@migaia/web-rpc/adapters/web-worker'

const transport = createWebWorkerTransport(self as unknown as Worker)
const endpoint = await createProviderEndpoint({
  id: 'worker',
  transport,
  middlewares: [contract({ version: '1' }), codec({ encode: (value) => value, decode: (value) => value }), connect({ transport })]
})
endpoint.provide('heavyCompute', (ctx) => {
  const result = doHeavyWork(ctx.data as number[])
  return ctx.success(result)
})
```

```ts
// main.ts
import { contract, codec, connect, timeout } from '@migaia/web-rpc'
import { createClientEndpoint } from '@migaia/web-rpc/client'
import { createWebWorkerTransport } from '@migaia/web-rpc/adapters/web-worker'

const worker = new Worker(new URL('./worker.ts', import.meta.url))
const transport = createWebWorkerTransport(worker)
const endpoint = await createClientEndpoint({
  id: 'main',
  transport,
  targetIds: ['worker'],
  middlewares: [
    contract({ version: '1' }),
    codec({ encode: (value) => value, decode: (value) => value }),
    connect({ transport }),
    timeout({ timeoutMs: 30_000 })
  ]
})

const result = await endpoint.send<number[]>('worker', 'heavyCompute', [1, 2, 3])
```

### 13.2 iframe 白名单鉴权通信

```ts
import { contract, codec, connect } from '@migaia/web-rpc'
import { createClientEndpoint } from '@migaia/web-rpc/client'
import { createWindowMessageTransport } from '@migaia/web-rpc/adapters/window'

const ALLOWED_ORIGINS = new Set(['https://trusted-partner.example'])

const iframe = document.querySelector('iframe')!
const transport = createWindowMessageTransport({
  target: iframe.contentWindow!,
  receiver: window,
  targetOrigin: 'https://trusted-partner.example'
})

const endpoint = await createClientEndpoint({
  id: 'host',
  transport,
  middlewares: [
    contract({ version: '1' }),
    codec({ encode: (value) => value, decode: (value) => value }),
    connect({
      transport,
      useBaseIdVerifyOnly: false,
      identifier: (ctx) => Boolean(ctx.origin && ALLOWED_ORIGINS.has(ctx.origin))
    })
  ]
})
```

### 13.3 标签页广播通知（不需要响应）

```ts
import { contract, codec, connect } from '@migaia/web-rpc'
import { createClientEndpoint } from '@migaia/web-rpc/client'
import { createBroadcastChannelTransport } from '@migaia/web-rpc/adapters/broadcast-channel'

const transport = createBroadcastChannelTransport(new BroadcastChannel('app-sync'))
const endpoint = await createClientEndpoint({
  id: `tab-${crypto.randomUUID()}`,
  transport,
  middlewares: [contract({ version: '1' }), codec({ encode: (value) => value, decode: (value) => value }), connect({ transport })]
})

endpoint.on('cache-invalidated', (ctx) => {
  console.log('缓存失效通知：', ctx.data)
})

// 任意一个标签页广播，其余全部标签页都会收到
endpoint.dispatchAll('cache-invalidated', { key: 'user-profile' })
```

### 13.4 大文件跨端传输

```ts
import { contract, codec, connect, framer } from '@migaia/web-rpc'
import { createComposedEndpoint } from '@migaia/web-rpc/core'
import { outbound } from '@migaia/web-rpc/features/outbound'

const endpoint = await createComposedEndpoint(
  {
    id: 'sender',
    transport,
    middlewares: [
      contract({ version: '1' }),
      codec({ encode: (value) => value, decode: (value) => value }),
      connect({ transport }),
      framer({
        chunkSize: 16_384, // 单帧 16KB
        maxMessageBytes: 50 * 1024 * 1024, // 单条消息最大 50MB
        assemblyTimeoutMs: 30_000
      })
    ]
  },
  [outbound()] as const
)

// 业务代码完全不用关心分片，正常发一个大 payload 即可
await endpoint.send('receiver', 'uploadFile', { name: 'video.mp4', bytes: largeUint8Array })
```

---

## 14. 常见问题排查

**Q：应该用根入口、client/provider 预设，还是自己组合？**
只发请求/通知用 `@migaia/web-rpc/client`；要 `provide()` 用 `@migaia/web-rpc/provider`；确实需要全部一等能力时用根 `createEndpoint` 或 `/full`；需要严格控制公开表面和 bundle retained graph 时，用 `/core` + `/features/*`。不要为了少写一个子路径导入而固定使用完整预设。

**Q：为什么选了 `discovery()`，endpoint 上还是没有 `send()`？**
Feature 的私有依赖不会扩大根投影。discovery 在内部需要 outbound 完成查询，但它对业务只承诺 `connect` / `discovery`；需要发送能力时显式加 `outbound()`。这是 tree-shaking 与最小权限边界，不是依赖安装失败。

**Q：framing layer 和 `framer()` descriptor 如何配合？**
framing layer 决定是否安装分片帧运行时所有者；`framer()` descriptor 提供 `chunkSize`、容量和超时等策略。`control()` Feature 与 `ping()` middleware 也是同样的分层关系。

**Q：`send()` 一直不 resolve 也不 reject。**
检查是否装了 `timeout()` 中间件——默认没有超时限制的场景下，对端确实没有响应就会一直挂起。同时确认 `connect()` 配置正确，否则请求可能在对端因身份校验失败被静默丢弃（可以订阅 `authentication.rejected`/`receive.failure` hook 事件确认）。

**Q：调用报 `TARGET_UNKNOWN`，但对端明明在线。**
自动发现模式下确认对端确实 `provide()` 了对应方法、`id` 拼写一致；跨源场景确认 `targetOrigin`/`connect` 的身份校验没有把合法请求也拒绝了。手动模式下确认调用方已经 `register()` 过这个接收端。

**Q：大消息发送失败，报 `PAYLOAD_TOO_LARGE` 或 `CHUNK_TOO_LARGE`。**
检查 framer descriptor 的 `chunkSize`/`maxMessageBytes` 是否够用；已经是 `Uint8Array` 的消息不支持自动分片，需要传输通道本身能处理大二进制，或者在业务层手动切分。

**Q：`dispose()` reject 了，应用要怎么继续？**
`dispose()` 的清理是尽力而为——即使 reject，能清理的部分也已经清理完了，`cleanupErrors` 只是告诉你哪些具体资源没清理干净（通常需要人工介入，比如某个外部连接对象自己的 `close()` 抛了异常）。不需要重试 `dispose()`（幂等，重试也只会拿到同一个结果），根据 `cleanupErrors` 里列出的资源名针对性排查即可。

**Q：TypeScript 提示 `endpoint.ping` 不存在。**
`ping` / `pingAll` 同时要求 full/control Feature 与 `ping()` middleware。`endpoint.connect` / `endpoint.discovery` 要求 discovery Feature；其中手动方法（`query` / `register` / ...）还要求 `discoveryMode: 'manual'` 的原生 middleware 定义。自定义组合与 middleware 数组建议写 `as const`，否则宽化后的联合类型只能给出保守表面。

**Q：想知道某条消息为什么被拒绝，去哪里看？**
装上 `hooks()` 中间件，订阅全部事件打日志，[§10](#10-可观测性hooks-事件参考) 的事件表基本覆盖了所有"消息被拒绝/丢弃"的原因分类。生产环境建议至少常驻订阅 `receive.failure`、`authentication.rejected`、`transport.failure`、`dispose.failure` 这几个和"东西坏了"直接相关的事件。

---

如果本文没有回答你的问题，欢迎查看 `packages/web-rpc/src` 下对应模块的源码注释——每一处非显而易见的行为都在代码里留了说明该行为存在的原因。

## 15. 协议常量与类型工具

根入口导出 wire discriminant、transport 元数据和诊断使用的稳定常量。应用和自定义 adapter 应引用这些值，不要复制字符串：

```ts
import {
  type IWebRpcTransport,
  WebRpcPlatform,
  WebRpcTransportTopology,
  WebRpcTransportOwnership,
  WebRpcTransportEncoding,
  WebRpcEndpointStatus,
  WebRpcDebugPhase
} from '@migaia/web-rpc'

const transport = {
  platform: WebRpcPlatform.worker,
  topology: WebRpcTransportTopology.exclusive,
  ownership: WebRpcTransportOwnership.borrowed,
  encodedType: WebRpcTransportEncoding.any,
  send,
  subscribe
} satisfies IWebRpcTransport
```

公开常量与用途：

| 常量                        | 用途                                                 |
| --------------------------- | ---------------------------------------------------- |
| `WebRpcPlatform`            | adapter 平台标签                                     |
| `WebRpcTransportTopology`   | exclusive/multiplexed/broadcast 信任拓扑             |
| `WebRpcTransportOwnership`  | owned/borrowed 资源释放契约                          |
| `WebRpcTransportEncoding`   | any/string/uint8array 编码声明                       |
| `WebRpcOperation`           | send/dispatch/ping 接收端选择操作                    |
| `WebRpcControlKind`         | request/dispatch/ping/discovery 资源准入类别         |
| `WebRpcCandidateStatus`     | active/stale/unregistered 发现候选状态               |
| `WebRpcEndpointStatus`      | 发现元数据中的 endpoint 准入状态                     |
| `WebRpcDebugPhase`          | 测试/诊断快照的 active/disposed 生命周期阶段         |
| `WebRpcContractFailureKind` | schema 校验诊断分类                                  |
| `WebRpcChunkEvent`          | chunk.rejected/chunk.expired hook 名                 |

类型通过根入口统一导出，包括 `IWebRpcFactoryConfig`、`IWebRpcEndpoint`、`IWebRpcTransport`、`IWebRpcProvider`、`IWebRpcContext`、`IWebRpcHookEvent` 和各常量对应的值联合类型。Adapter 自己的宿主形状类型从对应 adapter 子路径导入，避免让根入口承担 DOM/Node 类型。

## 16. 跨端错误序列化

`serializeError()`、`deserializeError()` 和 `reachError()` 用于 Worker、iframe、MessagePort 等边界上的完整错误链传递：

```ts
import { deserializeError, reachError, serializeError } from '@migaia/web-rpc'

const original = new AggregateError(
  [new TypeError('invalid payload'), new Error('transport failed')],
  'request failed',
  { cause: new Error('primary cause') }
)

const wire = serializeError(original)
const restored = deserializeError(structuredClone(wire))

for (const node of reachError(restored)) {
  console.error(node)
}
```

`ISerializedError` 保存 `source`、`code`、`name`、`message`、原始 `stack`，并按需保存 `phase`、`detail`、`data`、`errors` 和 `causes`。序列化会遍历 `cause`、`AggregateError.errors` 以及 lifecycle `cleanupErrors[].error`，确保原始失败仍可从恢复后的图到达。

反序列化会恢复 `AggregateError`、`TypeError`、`RangeError`、`SyntaxError`、`ReferenceError`、`URIError`、`EvalError`；运行时存在 `DOMException` 时恢复标准 `AbortError`，其他名称恢复为 `Error` 并保留原始 `name`。接收方得到的是新的本地错误对象，不应期待与发送方对象保持 `===` 身份。

三个函数都执行安全快照，不信任对象 getter。错误图最大深度 64、最大节点数 1024；超预算、循环 wire 图或字段形状非法时，操作会抛 `WebRpcSerializationError`，`code` 为 `PAYLOAD_INVALID`，不会静默截断。`reachError()` 是诊断遍历工具，也受同样边界保护。

## 17. 构建、格式化与测试

在仓库根目录运行：

```bash
pnpm --filter @migaia/web-rpc fmt
pnpm --filter @migaia/web-rpc lint
pnpm --filter @migaia/web-rpc typecheck
pnpm --filter @migaia/web-rpc typecheck:core
pnpm --filter @migaia/web-rpc typecheck:node-adapter
pnpm --filter @migaia/web-rpc typecheck:test
pnpm --filter @migaia/web-rpc typecheck:e2e
pnpm --filter @migaia/web-rpc test
pnpm --filter @migaia/web-rpc test:e2e
pnpm --filter @migaia/web-rpc build
pnpm --filter @migaia/web-rpc test:packed
```

`test` 覆盖 endpoint、middleware、错误链和适配器；`test:e2e` 验证浏览器/Worker/跨窗口传输；`test:packed` 在构建后检查 package export map。后两者需要 Playwright 浏览器与可构建环境。
