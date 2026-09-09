# @migaia/web-rpc

**传输无关的双向 RPC 框架**——同一套 API，同时支持 `Window.postMessage`、Web Worker、SharedWorker、ServiceWorker、BroadcastChannel、WebRTC DataChannel、WebTransport，以及自定义传输通道。

## 1. 这是什么

如果你需要在两段**互相隔离、不能直接调用对方函数**的 JavaScript 代码之间通信——比如主页面和 iframe、主线程和 Worker、多个浏览器标签页之间——通常只能用 `postMessage`/`onmessage` 这种"发消息、猜是谁发的、手动对应请求和响应"的原始方式。写多了你会发现自己在反复造轮子：怎么把"调用一个方法并拿到返回值"这件事伪装成同步函数调用的样子？怎么知道这条消息是回复哪个请求的？对方老半天不回怎么办？消息太大发不过去怎么拆？谁能证明这条消息真的是我认识的那个 iframe 发的，而不是页面里被注入的恶意脚本冒充的？

`@migaia/web-rpc` 就是把这些问题一次性解决掉的库。它在任意一种"能发消息、能收消息"的传输通道上，包出一层**类型安全的双向 RPC**：一端用 `provide(method, handler)` 注册方法，另一端用 `await endpoint.send(targetId, method, data)` 调用，写法和调本地异步函数几乎一样，超时、鉴权、分片、断线检测、多接收端负载均衡这些细节全部由框架处理。

这个包的 endpoint 核心**不关心你在什么环境运行**——核心入口不绑定 DOM、React、Store、Node 或某个具体宿主 API。真正“怎么发消息、怎么收消息”被抽成 `Transport`（传输适配器）；浏览器、Worker 和 Node MessagePort 代码只存在于按需导入的 adapter 子路径。官方提供 9 组适配器，也可以为 WebSocket、Electron IPC 或业务总线实现自己的 `IWebRpcTransport`。

## 2. 适合什么场景

| 场景                                               | 说明                                                        |
| -------------------------------------------------- | ----------------------------------------------------------- |
| 主页面 ↔ iframe 通信                               | 需要验证消息来源、防止同源恶意脚本伪造                      |
| 主线程 ↔ Web Worker / SharedWorker / ServiceWorker | 把耗时计算丢进 Worker，用"调用函数"的写法拿结果             |
| 多个浏览器标签页 / 窗口互通                        | 用 BroadcastChannel 做一对多广播，或做单播路由              |
| 点对点实时通信                                     | 基于 WebRTC DataChannel，比如协作编辑、P2P 游戏状态同步     |
| 大文件 / 大对象跨端传输                            | 超过单次消息大小限制自动分片，接收端自动重组                |
| 微前端子应用间通信                                 | 各子应用独立部署、独立运行时，仍需要互相调用能力            |
| 需要断线探测的长连接场景                             | WebTransport datagram、连接可能中断，需要超时/存活探测 |

不适合的场景：如果两端本来就在同一个 JS 线程里、能直接互相 import 调用，用这个库反而是多此一举——它解决的是"物理隔离、只能靠消息通信"这个约束下的问题。

## 3. 用了之后能得到什么

- **类型安全的端到端调用**：`send<T>(targetId, method, data)` 的返回值类型、`provide()` 里 `ctx.data` 的类型都可以通过 `IWebRpcMethodSchema`（配合 zod / valibot 等任意实现了 `parse()` 的校验库）在运行时强校验，而不只是编译期的自我欺骗。
- **双向调用**：不是"客户端发请求、服务端只能回响应"的单向模型——每一端既可以是调用方也可以是被调用方，`provide()` 和 `send()` 在同一个 `endpoint` 上共存。
- **请求超时**：`timeout()` 中间件统一管理请求 deadline；每个请求只发送一次，避免隐含的 at-least-once 语义。
- **鉴权与加密**：`authentication()` 中间件对每一帧（包括分片帧、控制帧）做签名/验签、加解密，`connect()` 中间件对"这条消息真的来自我认识的那个 peer 吗"做验证，不是只信任 `senderId` 这个可以被伪造的字符串字段。
- **大消息自动分片**：`framer()` 层在发送侧按字节预算自动切分、接收侧自动重组，并从并发消息数、单 peer 消息数、分片数、分片大小、缓冲区总量、重组超时六个维度限制资源占用，防止恶意/异常大消息把内存打爆。
- **多接收端的服务发现与负载均衡**：同一个 `targetId` 背后可以有多个存活的接收端（比如多个 SharedWorker tab），框架自动维护"谁还活着"的路由表，未指定接收端时对活跃接收端做首次成功即返回的竞速调用；也支持手动模式精确控制发现/注册/固定路由。
- **统一的错误处理**：跨包错误都带稳定的 `(source, code)`；原生 `TypeError`/`RangeError`/`AggregateError` 和远端 `WebRpcRemoteError` 保留自己的运行时类型，调用方可先用 `isWebRpcError()`/结构化 `code` 分支，再按需检查原生类型。
- **可控的生命周期**：`dispose()` 保证按预期顺序清理中间件、传输连接、进行中的请求，任何一步清理失败都会被收集而不是让后续清理步骤中断。

## 4. 安装

```bash
pnpm add @migaia/web-rpc
```

包内部复用 `@migaia/plugin-host`、Capability Graph、Lifecycle 等运行时中立基础包，但不依赖 Store、React、WASM，也不从根入口加载任何具体浏览器/Node 适配器。

## 5. 目录

- [核心概念一览](#6-核心概念一览)
- [入口、预设、Feature 组合与 Endpoint API](#7-入口预设feature-组合与-endpoint-api)
- [中间件](#8-中间件)
- [传输适配器](#9-传输适配器)
- [错误处理与跨端错误序列化](#10-错误处理与跨端错误序列化)
- [高阶组合示例](#11-高阶组合示例)
- [注意事项（最容易踩的坑）](#12-注意事项最容易踩的坑)
- [构建门禁](#13-构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

## 6. 核心概念一览

| 概念                     | 职责                                                                                      | 是否改变公开方法                          |
| ------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Endpoint（端点）**     | 一条通信链路上的本地实例，拥有统一生命周期                                                | 是最终公开对象                            |
| **Preset（预设）**       | `client` / `provider` / `full` 三种官方 Feature 组合                                      | 是；决定返回对象拥有哪些方法              |
| **Feature（功能模块）**  | 选择业务面：outbound、provider、discovery、control、chunk                                 | 是；未选择的 Feature 不出现在类型和根对象 |
| **Middleware（中间件）** | 配置横切策略：connect、contract、protocol、authentication、timeout、ping、abort、hooks 等 | 通常不直接扩展方法；`ping()` 是条件能力   |
| **Transport（传输）**    | 只负责发送、订阅、关闭和来源证明，不理解 RPC 请求/响应                                    | 否                                        |
| **Provider（提供者）**   | 通过 `provide(method, fn)` 注册方法处理函数                                               | 由 provider Feature 提供                  |
| **Adapter（适配器）**    | 把 Window、Worker、MessagePort 等宿主 API 适配成 Transport                                | 否                                        |
| **Discovery（发现）**    | 维护一个 `targetId` 下的接收端候选、pin 与路由                                            | 由 discovery Feature 提供                 |

`Transport` 的 `topology` 字段（`exclusive` / `multiplexed` / `broadcast`）决定框架如何信任这条通道，是整个安全模型里最重要的一个字段，完整语义见 [USEGUIDE §1.2](./USEGUIDE.md#12-transport传输)。

---

## 7. 入口、预设、Feature 组合与 Endpoint API

### 7.1 先选入口，不要一律导入完整端点

| 需求                               | 导入                                                     | 返回的公开能力                                                         |
| ---------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| 双向 RPC、发现、控制、分片全部需要 | `createEndpoint` from `@migaia/web-rpc`                  | 完整端点；它与 `createFullEndpoint` 是同一个函数值                     |
| 显式使用完整预设                   | `createFullEndpoint` from `@migaia/web-rpc/full`         | 与根 `createEndpoint` 相同                                             |
| 只发请求/通知                      | `createClientEndpoint` from `@migaia/web-rpc/client`     | `send`、`sendAll`、`dispatch`、`dispatchAll`、`on`、`hooks`、`dispose` |
| 提供方法，同时允许主动回调对端     | `createProviderEndpoint` from `@migaia/web-rpc/provider` | client 能力 + `provide`                                                |
| 精确选择 Feature                   | `createComposedEndpoint` from `@migaia/web-rpc/core`     | kernel 能力 + 所选 Feature 的根投影                                    |
| 自定义组合的 Feature token         | `@migaia/web-rpc/features/{outbound,provider,...}`       | 由 token tuple 静态推导                                                |

这些子路径不是兼容别名。它们是 tree-shaking 边界：例如 client 入口不会把 provider、discovery、control、chunk 的实现带入 retained graph；provider 只私下安装它必须依赖的 outbound 安全闭包。Feature 的依赖会自动安装，但**依赖不会偷偷扩大根对象**：只选择 `discovery()` 时，不会因为它内部依赖 outbound 就额外得到 `send()`。

### 7.2 最小可运行示例：client 调 provider

下面使用内存 transport，代码可以直接放进测试或本地程序。真实项目只需换 adapter。

```ts
import { connect } from '@migaia/web-rpc'
import { createClientEndpoint } from '@migaia/web-rpc/client'
import { createProviderEndpoint } from '@migaia/web-rpc/provider'
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'

const [clientTransport, serverTransport] = createMemoryTransportPair()

const server = await createProviderEndpoint({
  id: 'math-service',
  transport: serverTransport,
  middlewares: [connect({ transport: serverTransport })],
  provider: {
    add: (ctx) => {
      const { a, b } = ctx.data as { a: number; b: number }
      return ctx.success(a + b)
    }
  }
})

const client = await createClientEndpoint({
  id: 'app',
  targetIds: ['math-service'],
  transport: clientTransport,
  middlewares: [connect({ transport: clientTransport })]
})

try {
  const sum = await client.send<number>('math-service', 'add', { a: 1, b: 2 })
  console.log(sum) // 3
} finally {
  await Promise.all([client.dispose(), server.dispose()])
}
```

`connect()` 是唯一必需 middleware。`contract()`、`codec()`、`timeout()` 等按需要添加；不应为了“凑齐默认栈”机械安装。

### 7.3 完整预设：根 `createEndpoint`

```ts
import { createEndpoint, contract, codec, connect } from '@migaia/web-rpc'
```

根入口的 `createEndpoint` 是 `createFullEndpoint` 的公开别名，适合确实同时需要 provider、discovery、control 和 chunk 的应用。它不是所有场景的唯一入口：只调用远端时优先使用 client preset。

```ts
const endpoint = await createEndpoint({
  id: 'server',
  transport,
middlewares: [contract({ version: '1' }), codec(identityCodecV1), connect({ transport })]
})
endpoint.provide('add', (ctx) => {
  const { a, b } = ctx.data as { a: number; b: number }
  return ctx.success(a + b)
})
```

全部配置项（`IWebRpcFactoryConfig`）：

- `id: string`（必填）—— 本端在整个通信拓扑里的唯一标识，出现在每条消息的 `senderId` 字段（不是身份凭证）；长度受 `contract().maxIdentifierLength` 限制（默认 128，即使不装 `contract()` 也生效）
- `middlewares: readonly IWebRpcPlugin[]`（必填）—— 至少要包含 `connect()`，否则构造直接抛 `MIDDLEWARE_MISSING`
- `transport?: IWebRpcTransport` —— 也可以只在 `connect({ transport })` 里提供，二选一即可
- `targetIds?: readonly string[]` —— 已知对端 id 的预声明，非必需；自动发现模式下首次 `send`/`dispatch`/`ping` 未知 `targetId` 会懒查询
- `provider?: Readonly<Record<string, IWebRpcProvider>>` —— 构造时批量注册的方法集合，等价于逐个调用 `provide()`
- `providerLimits?: { maxGlobal?: number; maxPerPeer?: number }` —— provider 并发上限，默认 `256/64`；超限立即返回 `OVERLOADED`，不排队
- `replay?: { maxEntries?: number; ttlMs?: number }` —— 出站请求 id 重放保护窗口，默认容量 4096、TTL 310 秒
- `construction?: { signal?: IWebRpcAbortSignal; timeoutMs?: number | false }` —— 构造期本身的取消/超时；取消/超时后仍会正确回滚已安装成功的中间件

`middlewares` 现在只接受原生 `IWebRpcPlugin` 描述符（包含 `metadata` 与 Host install scope）。0.x 的 `IWebRpcMiddlewareContext`/`install(context)` 形状已移除；继续传入旧形状会在任何传输副作用前以 `INVALID_CONFIG` 拒绝。自定义插件应通过 `scope.getShared` 读取依赖，并通过 `scope.own` 注册清理。

### 7.4 自定义 Feature 组合

Feature 从独立子路径导入；`createComposedEndpoint` 会解析依赖、在任何 transport 订阅前检查冲突，再通过一个 PluginHost batch 原子安装。安装失败会回滚已经取得的资源，原始错误保留在 `cause`/`AggregateError.errors` 链上。

```ts
import { connect, ping } from '@migaia/web-rpc'
import { createComposedEndpoint } from '@migaia/web-rpc/core'
import { outbound } from '@migaia/web-rpc/features/outbound'
import { discovery } from '@migaia/web-rpc/features/discovery'
import { control } from '@migaia/web-rpc/features/control'

const endpoint = await createComposedEndpoint(
  {
    id: 'probe',
    transport,
    middlewares: [connect({ transport }), ping()] as const
  },
  [outbound(), discovery(), control()] as const
)

await endpoint.send('service', 'health', undefined)
const alive = await endpoint.ping('service')
```

官方 token：

- `outbound()`：`send` / `sendAll` / `dispatch` / `dispatchAll`。
- `provider()`：`provide`，并把 inseparable outbound closure 投影到根对象。
- `discovery()`：`connect` / `discovery`；内部依赖 outbound，但单独选择时不暴露发送方法。
- `control()`：ping/pong 控制面；公开 `ping` / `pingAll` 还要求 middleware tuple 包含 `ping()`。
- `framer()`：分片 framing，没有独立公开方法；具体限制来自 framing descriptor 配置。

`Feature` 和 layer descriptor 不是重复实现：前者决定运行时模块与公开 surface，后者只提供配置/capability。分片能力由 framing layer 负责，策略由 framer descriptor 决定。

### 7.5 Endpoint 方法

**`endpoint.provide(method, fn)`｜5 秒上手** —— 注册一个方法处理函数，同名重复注册抛 `PROVIDER_DUPLICATED`：

```ts
endpoint.provide('greet', (ctx) => ctx.success(`hello, ${ctx.data}`))
```

`fn` 收到的 `IWebRpcContext` 全部字段：`data: unknown`（已过 `contract()` schema 校验，如果配置了的话）、`signal: IWebRpcAbortSignal`（调用方取消时触发）、`success(data?, { transfer? })`、`failed(message, code)`、`dispatchTo({ id?, method, data })`（主动向调用方推一条单向消息）。返回 `this`，可以链式调用。

**`endpoint.send<T>(targetId, method, data, options?)`｜5 秒上手** —— 发起一次双向调用并等待结果：

```ts
const sum = await endpoint.send<number>('server', 'add', { a: 1, b: 2 })
```

`options?: ISendOptions` 全部字段：`signal?: IWebRpcAbortSignal`（需要装 `abort()` 中间件）、`timeoutMs?: number | false`（覆盖 `timeout()` 中间件的默认值）、`transfer?: readonly unknown[]`（零拷贝转移列表）。

**`endpoint.sendAll<T>(method, data, options?)`｜5 秒上手** —— 向当前全部已知/存活对端发起同一次调用：

```ts
const { fulfilled, rejected } = await endpoint.sendAll<number>('ping-check', undefined)
```

`options` 同 `send`。返回 `IWebRpcFanoutResult<T>`（`{ fulfilled, rejected }`，两者都是**空原型对象**，查找必须用 `Object.hasOwn()`，不能用 `in`——完整 key 编码规则见 [USEGUIDE §6](./USEGUIDE.md#6-endpoint-公开-api-参考)）。对一个已释放的 endpoint 调用 `sendAll` 会稳定失败，即使当前没有任何已知对端。

**`endpoint.dispatch(targetId, method, data)` / `dispatchAll(method, data)`｜3 秒上手** —— 单向通知，不等待响应，同步返回（内部异步执行）：

```ts
endpoint.dispatch('worker', 'log', { level: 'info', message: 'started' })
endpoint.dispatchAll('cache-invalidated', { key: 'user-profile' })
```

均无可选项（`dispatch` 需要 `targetId`，`dispatchAll` 广播给全部已知/存活对端）。

**`endpoint.on(event, listener)`｜3 秒上手** —— 监听对端 `dispatch()`/`dispatchAll()` 发来的单向通知：

```ts
const off = endpoint.on('cache-invalidated', (ctx) => console.log(ctx.data))
off() // 取消订阅
```

`listener: IWebRpcEventListener`（`(context: IWebRpcContext) => void | Promise<void>`），无其他选项；返回取消订阅函数。

**`endpoint.hooks.on(listener)`｜3 秒上手** —— 运行时动态订阅生命周期事件，等价于 `hooks()` 中间件的 `listeners` 配置项：

```ts
const off = endpoint.hooks.on((event) => console.log(event.name, event.at))
```

**`endpoint.dispose()`｜5 秒上手** —— 释放 endpoint，立即结算全部进行中的请求、清理中间件与传输：

```ts
await endpoint.dispose()
```

无参数，幂等（可安全多次调用），失败时抛 `WebRpcLifecycleError`（`cleanupErrors` 逐项列出哪个资源没清理干净），完整语义见 [USEGUIDE §9](./USEGUIDE.md#9-生命周期与资源释放)。

**`endpoint.connect` / `endpoint.discovery`** —— 服务发现的读写控制，自动模式下只读（`getServerList`/`pinReceiver`/`unpinReceiver`），手动模式下额外有 `query`/`onQuery`/`register`/`unregister`/`ping`，完整参考见 [USEGUIDE §7](./USEGUIDE.md#7-服务发现自动模式与手动模式)。

---

## 8. 中间件

```ts
import {
  contract,
  protocol,
  connect,
  authentication,
  chunk,
  timeout,
  ping,
  abort,
  hooks,
  uuid
} from '@migaia/web-rpc'
```

**`contract(config?)`｜5 秒上手** —— 声明协议版本、按方法校验入参/出参 schema：

```ts
contract({
  version: '1',
  schemas: { add: { params: z.object({ a: z.number(), b: z.number() }), result: z.number() } }
})
```

全部选项：`version?: string`（本端协议版本号）、`acceptVersions?: string[]`（接受的对端版本号，默认只接受自己声明的 `version`）、`maxIdentifierLength?: number`（`id`/`targetId`/method 等标识符最大长度，**默认 128**，不装这个中间件时同样生效默认值）、`schemas?: Record<string, { params: IWebRpcSchema; result: IWebRpcSchema }>`（未覆盖的方法名不做校验，按方法名精确匹配）。建议总是加，否则契约不匹配问题会在业务代码里才暴露。

**`codec(descriptor)`｜3 秒上手** —— 定义消息信封的编码/解码方式：

```ts
codec({ encode: (v) => msgpackEncode(v), decode: (v) => msgpackDecode(v) })
```

全部选项：`encode?: (value) => unknown`（默认恒等）、`decode?: (value) => unknown`（默认恒等）、`encodedType?: 'any' | 'string' | 'uint8array'`（默认 `'any'`，需要和传输层的编码要求一致，不一致在构造期直接报错）。

**`connect(config)`｜10 秒上手** —— **几乎所有场景都需要**，同时负责来源校验和服务发现：

```ts
connect({
  transport,
  useBaseIdVerifyOnly: false,
  identifier: (ctx) => allowlist.has(ctx.origin)
})
```

全部选项：`transport?: IWebRpcTransport`（工厂层已提供 `transport` 时可省略）、`useBaseIdVerifyOnly?: boolean`（**默认 `true`**：只用适配器提供的 `peerId`/`origin` 做基础校验；设为 `false` 时 `identifier` 变为必需）、`identifier?: (context) => boolean | Promise<boolean>`（`useBaseIdVerifyOnly: false` 时必须提供）、`uniqueTargetId?: string | ((context) => string | Promise<string>)`（同一 `targetId` 下多接收端的路由标识，**不是凭证**）、`discoveryMode?: 'automatic' | 'manual'`（默认 `'automatic'`）、`receiverSelector?: (serverList, context) => string | undefined | Promise<string | undefined>`（自定义多接收端选路）。

**`authentication(config)`｜10 秒上手** —— 对每一帧（含分片帧、ping/pong/abort 控制帧）做签名/验签、加解密：

```ts
authentication({
  sign: (value) => hmacSign(value, key),
  verify: (value) => hmacVerify(value, key)
})
```

全部选项：`encrypt?`/`decrypt?`/`sign?`/`verify?: (value, context) => unknown | Promise<unknown>`（`context.direction` 为 `'outbound' | 'inbound'`；`encrypt`/`decrypt` 必须成对提供，`sign`/`verify`同理，且至少要配置一对，否则构造期抛 `INVALID_CONFIG`）、`encodedType?: 'any' | 'string' | 'uint8array'`（默认 `'any'`）。启用后 `Transfer` 零拷贝列表不再受支持。通道本身不可信（如匿名 BroadcastChannel）时必须加。

**`framer(descriptor?)`｜10 秒上手** —— 大消息自动分片与重组：

```ts
framer({ chunkSize: 16_384, maxMessageBytes: 50 * 1024 * 1024, assemblyTimeoutMs: 30_000 })
```

全部选项（六个容量维度即使不配置也带内置默认值，不是"不设置就不限"）：`chunkSize?: number`（单帧字节数，超过触发分片，未设不主动分片）、`maxMessageBytes?: number`（单条消息总字节数上限，未设不检查）、`maxConcurrentMessages?: number`（端点级并发重组数，默认 128）、`maxConcurrentMessagesPerPeer?: number`（单 peer 并发重组数，默认 32）、`maxBufferedBytes?: number`（重组缓冲区总字节，默认 16MiB）、`maxChunksPerMessage?: number`（单消息最大分片数，默认 4096）、`maxChunkBytes?: number`（单分片最大字节，默认 4MiB）、`assemblyTimeoutMs?: number`（重组超时，默认 30 秒）、`byteLength?: (value) => number`（自定义字节测量，默认按 UTF-8）、`split?: (value, maxBytes) => readonly string[]`（自定义切分算法）。已是 `Uint8Array` 的消息不支持自动分片。

**`timeout(config?)`｜5 秒上手** —— 统一请求超时：

```ts
timeout({ timeoutMs: 5000 })
```

全部选项：`timeoutMs?: number | false`（默认超时，`false` 表示不限时；`send()` 的 `options.timeoutMs` 可逐次覆盖）。每次请求只发送一次，失败由调用方按业务需要处理。

**`ping()`｜3 秒上手** —— 在 full preset，或选择了 `control()` Feature 的组合里，安装后 endpoint 获得 `ping`/`pingAll` 方法：

```ts
ping()
const alive = await endpoint.ping('server') // 对端不可达、超时或调用信号取消时返回 false
```

无配置项。`ping(targetId, receiverId?, options?)` 的 `options?: { timeoutMs?: number; signal?: IWebRpcAbortSignal }`。公开方法同时要求 control Feature 和 `ping()` middleware；缺任一层时，精确类型都不会承诺该方法。

**`abort()`｜3 秒上手** —— 让 `send()`/`sendAll()` 支持 `options.signal` 取消：

```ts
abort()
const controller = new AbortController()
endpoint.send('server', 'slow', {}, { signal: controller.signal })
controller.abort()
```

无配置项。

**`hooks(config?)`｜5 秒上手** —— 订阅框架内部生命周期事件：

```ts
hooks({ listeners: (event) => console.log(event.name), onHookError: (err) => console.error(err) })
```

全部选项：`listeners?: IWebRpcHook | readonly IWebRpcHook[]`、`onHookError?: (error, event) => void`（监听器自身抛错时的兜底，防止一个写错的日志监听器影响主流程）。完整事件表见 [USEGUIDE §10](./USEGUIDE.md#10-可观测性hooks-事件参考)。

**`uuid(config?)`｜3 秒上手** —— 自定义请求/消息 id 的生成策略：

```ts
uuid({ generate: (ctx) => myTraceIdGenerator(ctx.variation) })
```

全部选项：`generate?: (context: { variation: 'task' | 'message' | 'variation'; senderId: string; targetId?: string }) => string`，默认使用内置安全随机生成器。

---

## 9. 传输适配器

适配器不在主入口导出，按需从子路径引入（避免把用不到的浏览器 API 探测代码打进你的 bundle）。

**`createMemoryTransportPair()`｜3 秒上手** —— `@migaia/web-rpc/adapters/memory`，单元测试/本地联调专用，不依赖任何浏览器 API：

```ts
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory'
const [clientTransport, serverTransport] = createMemoryTransportPair()
```

无参数；返回一对互相连通的传输，通过 `queueMicrotask` 模拟真实异步时序。仅供测试/开发使用。

**`createWebWorkerTransport(port, options?)`｜5 秒上手** —— `@migaia/web-rpc/adapters/web-worker`，主线程 ↔ dedicated Worker：

```ts
import { createWebWorkerTransport } from '@migaia/web-rpc/adapters/web-worker'
const transport = createWebWorkerTransport(worker)
```

全部选项：`options?: { peerId?: string; origin?: string }`（静态声明已知对端身份元数据）。`error`/`messageerror` 原生事件无消息体，统一通过 `onTransportError` 让全部挂起请求立即失败。

**`createWindowMessageTransport(options)`｜10 秒上手** —— `@migaia/web-rpc/adapters/window`，主页面 ↔ iframe/弹出窗口：

```ts
import { createWindowMessageTransport } from '@migaia/web-rpc/adapters/window'
const transport = createWindowMessageTransport({
  target: iframe.contentWindow!,
  targetOrigin: 'https://trusted-partner.example'
})
```

全部选项：`target: IWindowMessageTarget`（**必填**，出站投递目标，如 `iframe.contentWindow`/`window.opener`）、`receiver?: IWindowMessageReceiver`（默认当前 `window`）、`targetOrigin?: string`（默认 `window.location.origin`；跨源必须显式传）、`allowUnsafeTargetOrigin?: boolean`（显式 opt-in 通配符 `'*'` 投递，只影响出站过滤，入站 `source` 校验依然生效）。

**`createBrowserMessagePortTransport(port, options?)`｜5 秒上手** —— `@migaia/web-rpc/adapters/message-port`，浏览器 `MessageChannel`/`MessagePort`：

```ts
import { createBrowserMessagePortTransport } from '@migaia/web-rpc/adapters/message-port'
const transport = createBrowserMessagePortTransport(port, { ownership: 'borrowed' })
```

全部选项：`ownership?: 'owned' | 'borrowed'`（默认 `'owned'`——`dispose()`/`close()` 时框架会关闭传入的 `port`；`'borrowed'` 只移除框架自己的监听器）。另有 `createNodeMessagePortTransport(port)` 适配 Node `worker_threads` 的 MessagePort，无选项，用法一致。

**`createSharedWorkerTransport(port)`｜3 秒上手** —— `@migaia/web-rpc/adapters/shared-worker`，多标签页共享同一个 SharedWorker：

```ts
import { createSharedWorkerTransport } from '@migaia/web-rpc/adapters/shared-worker'
const transport = createSharedWorkerTransport(sharedWorker.port)
```

单参数，无选项。天生是 `multiplexed` 拓扑，务必配合 `connect()` 的身份校验使用。

**`createServiceWorkerTransport(options)`｜5 秒上手** —— `@migaia/web-rpc/adapters/service-worker`，页面 ↔ ServiceWorker：

```ts
import { createServiceWorkerTransport } from '@migaia/web-rpc/adapters/service-worker'
const transport = createServiceWorkerTransport({
  target: navigator.serviceWorker.controller!,
  receiver: navigator.serviceWorker
})
```

全部选项：`target: IServiceWorkerMessageTarget`（必填，发送目标）、`receiver: IServiceWorkerMessageReceiver`（必填，接收来源）、`peerId?: string`（默认取 `target.id`）。发送方和接收方是两个独立的宿主对象，因此需要分别传入。

**`createBroadcastChannelTransport(channel)`｜3 秒上手** —— `@migaia/web-rpc/adapters/broadcast-channel`，同源多标签页广播：

```ts
import { createBroadcastChannelTransport } from '@migaia/web-rpc/adapters/broadcast-channel'
const transport = createBroadcastChannelTransport(new BroadcastChannel('app-sync'))
```

单参数，无选项。**这是匿名广播路由，不是身份边界**，需要防伪造/防窃听必须叠加 `authentication()`。

**`createRtcDataChannelTransport(channel)`｜5 秒上手** —— `@migaia/web-rpc/adapters/rtc-data-channel`，WebRTC 点对点数据通道：

```ts
import { createRtcDataChannelTransport } from '@migaia/web-rpc/adapters/rtc-data-channel'
const transport = createRtcDataChannelTransport(dataChannel)
```

单参数，无选项。要求 `channel.readyState` 在构造时已经是 `'open'` 或 `'closed'`（否则抛 `INVALID_CONFIG`）；要求可靠有序模式（`ordered: true`，创建时默认就是）；内部固定 `encodedType: 'string'`。

**`createWebTransportDatagramTransport(datagrams)`｜5 秒上手** —— `@migaia/web-rpc/adapters/web-transport`，HTTP/3 WebTransport datagram：

```ts
import { createWebTransportDatagramTransport } from '@migaia/web-rpc/adapters/web-transport'
const transport = createWebTransportDatagramTransport({
  writable: session.datagrams.writable,
  readable: session.datagrams.readable
})
```

单参数 `{ writable: WritableStream<Uint8Array>; readable: ReadableStream<Uint8Array> }`，无其他选项。datagram 无内建分帧，codec/framer descriptors 需自行处理帧边界；`close()` 才会真正取消内部持久 reader，取消订阅不会。

> 用不了官方适配器？实现 `IWebRpcTransport`（只有 `send`/`subscribe` 两个必需方法）就能接入任意自定义通道，见 [USEGUIDE.md](./USEGUIDE.md#5-自定义传输适配器)。

---

## 10. 错误处理与跨端错误序列化

```ts
import {
  isWebRpcError,
  WebRpcErrorCode,
  serializeError,
  deserializeError,
  reachError
} from '@migaia/web-rpc'
```

**错误处理｜5 秒上手** —— 所有跨包失败都带稳定的 `(source, code)`；部分失败保留原生 `TypeError`、`RangeError`、`AggregateError` 或 `WebRpcRemoteError` 类型：

```ts
try {
  await endpoint.send('server', 'add', { a: 1, b: 2 })
} catch (error) {
  if (isWebRpcError(error)) {
    switch (error.code) {
      case WebRpcErrorCode.deadlineExceeded:
        /* 超时 */ break
      default: /* 兜底 */
    }
  }
}
```

业务分支应优先使用 `isWebRpcError(error)` 后检查 `source` / `code`，不要匹配可能变化的 `message`；需要区分入参类型错误或聚合清理失败时，再检查保留下来的原生错误类型。错误码全表与各类错误的完整语义见 [USEGUIDE §8](./USEGUIDE.md#8-错误处理)。

**`serializeError`｜5 秒上手** —— 把任意错误（含 `cause`/`AggregateError` 链）转成可安全 `postMessage`/`JSON.stringify` 的数据结构：

```ts
const wire = serializeError(new Error('outer', { cause: new Error('inner') }))
```

单参数 `error: unknown`，无选项；图深度上限 64、节点数上限 1024，超限抛 `WebRpcSerializationError`（`PAYLOAD_INVALID`）。

**`deserializeError`｜5 秒上手** —— 逆操作，从 wire 数据重建出真正的 `Error` 实例（按 `name` 还原对应原生子类）：

```ts
const restored = deserializeError(wire)
```

单参数 `serialized: ISerializedError`，无选项。

**`reachError`｜3 秒上手** —— 生成器，按遍历顺序 yield 一个错误能到达的全部节点，用于日志/脱敏：

```ts
for (const node of reachError(topLevelError)) console.error(node)
```

单参数 `error: unknown`，无选项；和序列化使用同一安全预算，图超过 64 层或 1024 个节点、或 hostile getter 读取失败时会抛带 `PAYLOAD_INVALID` 的 `WebRpcSerializationError`，不会返回不完整遍历。完整字段与类型定义见 [USEGUIDE §16](./USEGUIDE.md#16-跨端错误序列化)。此外主入口还整体导出传输与契约常量，用于替代手写字符串字面量，完整清单见 [USEGUIDE §15](./USEGUIDE.md#15-协议常量与类型工具)。

---

## 11. 高阶组合示例

### 1. 主线程调度 Web Worker

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
endpoint.provide('heavyCompute', (ctx) => ctx.success(doHeavyWork(ctx.data as number[])))
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

### 2. iframe 白名单鉴权通信

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

### 3. 标签页广播通知（不需要响应）

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

endpoint.on('cache-invalidated', (ctx) => console.log('缓存失效通知：', ctx.data))
endpoint.dispatchAll('cache-invalidated', { key: 'user-profile' }) // 其余标签页都会收到
```

### 4. 大文件跨端传输（自动分片）

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
        chunkSize: 16_384,
        maxMessageBytes: 50 * 1024 * 1024,
        assemblyTimeoutMs: 30_000
      })
    ]
  },
  [outbound()] as const
)

// 业务代码完全不用关心分片，正常发一个大 payload 即可
await endpoint.send('receiver', 'uploadFile', { name: 'video.mp4', bytes: largeUint8Array })
```

### 5. 超时 + 可取消调用

```ts
import { contract, codec, connect, timeout, abort } from '@migaia/web-rpc'
import { createClientEndpoint } from '@migaia/web-rpc/client'

const endpoint = await createClientEndpoint({
  id: 'client',
  transport,
  targetIds: ['server'],
  middlewares: [
    contract({ version: '1' }),
    codec({ encode: (value) => value, decode: (value) => value }),
    connect({ transport }),
    timeout({
      timeoutMs: 5000,
      timeoutMs: 5000
    }),
    abort()
  ]
})

const controller = new AbortController()
const resultPromise = endpoint.send('server', 'flaky', {}, { signal: controller.signal })
// 需要时可随时 controller.abort() 主动取消
const result = await resultPromise
```

---

<a id="12-注意事项最容易踩的坑"></a>

## 12. 注意事项（最容易踩的坑）

1. **`senderId` 是不可信字段**，任何拿到该消息的代码都能自己拼一个假的。跨源/共享传输场景必须配置 `connect()` 的 `identifier` 做真正的来源校验，不要只信任 `senderId`。
2. **匿名 BroadcastChannel 不是身份边界**。同源的任何脚本都能观察和伪造匿名组里的帧；`uniqueTargetId` 是路由标识，**不是凭证**，需要真正的鉴权时配置 `authentication()` 中间件。
3. **`ping()` 把不可达、超时和调用信号取消归一为 `false`**；配置错误、UUID 冲突和已释放 endpoint 等本地契约/生命周期错误仍会抛出，不能把 `false` 当作所有失败的统一出口。
4. **响应大小超限、连接被动断开这类"传输层失败"和"业务失败"是两种错误**，规范上区分为 `TRANSPORT`、`DEADLINE_EXCEEDED` 等 code，判断时按 `error.code` 分支，不要依赖 `error.message` 或 `error instanceof` 具体子类。
5. **`Window.postMessage` 无法可靠探测对方窗口被关闭**——依赖 `timeoutMs`（默认有限超时）或显式的宿主生命周期信号，不要假设"没报错就代表还活着"；`createWindowMessageTransport` 的 `target` 是必填字段，没有默认值。
6. **`dispose()` 是幂等的、会等待全部清理完成才 settle**；某一步清理失败不会阻止其余步骤执行，失败信息汇总在抛出的错误的 `cleanupErrors` 里，每一项都带着资源名，方便定位是哪个中间件或传输没清理干净。
7. **自定义传输必须准确声明 `topology`**（`exclusive` / `multiplexed` / `broadcast`），且 `platform` 必须是内置枚举值之一（`WebRpcPlatform` 常量表列出的 7 个值）。声明为 `multiplexed` 的传输必须提供 peer/source 身份或显式校验，框架不会把它当成"只有一个发送方"的独占通道来信任。
8. **回调函数不依赖 `this`**。中间件 `install`、`provider`、`verifier`、pipeline 回调都以裸函数形式被调用（框架内部明确不使用 `bind`/`call`/`apply`），请用箭头函数或闭包捕获状态。
9. **framer descriptor 的容量限制不是"不设置就不限"**——六个维度里有五个（并发消息数、单 peer 消息数、分片数、分片字节、重组超时）自带内置默认值，只有 `chunkSize`/`maxMessageBytes` 才是真正的"未设不限"。
10. **Feature 决定“有没有这个公开方法”，layer descriptor 决定“这个能力怎样工作”**。分片由 framing layer 负责，控制面由 control Feature 与 `ping()` middleware 共同提供；类型会对缺失的条件能力 fail closed。
11. **优先从最窄子路径导入**。只调用远端用 `@migaia/web-rpc/client`，只提供服务用 `@migaia/web-rpc/provider`；根 `createEndpoint` 是 full preset，不是零成本门面。

## 13. 构建门禁

```bash
pnpm --filter @migaia/web-rpc fmt && pnpm --filter @migaia/web-rpc lint && pnpm --filter @migaia/web-rpc typecheck && pnpm --filter @migaia/web-rpc typecheck:core && pnpm --filter @migaia/web-rpc typecheck:node-adapter && pnpm --filter @migaia/web-rpc typecheck:test && pnpm --filter @migaia/web-rpc test
```

以上是能让你在几分钟内跑起来、并且不踩常见坑的最小知识集合。每个中间件的完整配置项、每个适配器的构造参数与平台限制、公开 API 的完整签名、全部错误码的触发场景与建议处理、发现机制（自动/手动）的完整语义、协议常量、跨端错误序列化，以及更多贴近真实场景的完整示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。
