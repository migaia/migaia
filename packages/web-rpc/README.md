# @migaia/web-rpc

**传输无关的双向 RPC 框架**——同一套 API，同时支持 `Window.postMessage`、Web Worker、SharedWorker、ServiceWorker、BroadcastChannel、WebRTC DataChannel、WebTransport，以及自定义传输通道。

## 1. 这是什么

如果你需要在两段**互相隔离、不能直接调用对方函数**的 JavaScript 代码之间通信——比如主页面和 iframe、主线程和 Worker、多个浏览器标签页之间——通常只能用 `postMessage`/`onmessage` 这种"发消息、猜是谁发的、手动对应请求和响应"的原始方式。写多了你会发现自己在反复造轮子：怎么把"调用一个方法并拿到返回值"这件事伪装成同步函数调用的样子？怎么知道这条消息是回复哪个请求的？对方老半天不回怎么办？消息太大发不过去怎么拆？谁能证明这条消息真的是我认识的那个 iframe 发的，而不是页面里被注入的恶意脚本冒充的？

`@migaia/web-rpc` 就是把这些问题一次性解决掉的库。它在任意一种"能发消息、能收消息"的传输通道上，包出一层**类型安全的双向 RPC**：一端用 `provide(method, handler)` 注册方法，另一端用 `await endpoint.send(targetId, method, data)` 调用，写法和调本地异步函数几乎一样，超时、重试、鉴权、分片、断线检测、多接收端负载均衡这些细节全部由框架处理。

这个包本身**不关心你在什么环境运行**——它不 import DOM、不依赖 React、不依赖任何具体的宿主 API。真正"怎么发消息""怎么收消息"这件事被抽成一个叫 `Transport`（传输适配器）的接口，框架核心只认这个接口。官方自带 9 种适配器覆盖浏览器常见场景，你也可以为任何自定义通道（比如 WebSocket、Electron 的 `ipcRenderer`）实现一个只有两个方法的适配器接入进来。

## 2. 适合什么场景

| 场景 | 说明 |
| --- | --- |
| 主页面 ↔ iframe 通信 | 需要验证消息来源、防止同源恶意脚本伪造 |
| 主线程 ↔ Web Worker / SharedWorker / ServiceWorker | 把耗时计算丢进 Worker，用"调用函数"的写法拿结果 |
| 多个浏览器标签页 / 窗口互通 | 用 BroadcastChannel 做一对多广播，或做单播路由 |
| 点对点实时通信 | 基于 WebRTC DataChannel，比如协作编辑、P2P 游戏状态同步 |
| 大文件 / 大对象跨端传输 | 超过单次消息大小限制自动分片，接收端自动重组 |
| 微前端子应用间通信 | 各子应用独立部署、独立运行时，仍需要互相调用能力 |
| 需要断线容错的长连接场景 | WebTransport datagram、连接可能中断，需要超时/重试/存活探测 |

不适合的场景：如果两端本来就在同一个 JS 线程里、能直接互相 import 调用，用这个库反而是多此一举——它解决的是"物理隔离、只能靠消息通信"这个约束下的问题。

## 3. 用了之后能得到什么

- **类型安全的端到端调用**：`send<T>(targetId, method, data)` 的返回值类型、`provide()` 里 `ctx.data` 的类型都可以通过 `IWebRpcMethodSchema`（配合 zod / valibot 等任意实现了 `parse()` 的校验库）在运行时强校验，而不只是编译期的自我欺骗。
- **双向调用**：不是"客户端发请求、服务端只能回响应"的单向模型——每一端既可以是调用方也可以是被调用方，`provide()` 和 `send()` 在同一个 `endpoint` 上共存。
- **超时与重试**：`timeout()` 中间件统一管理请求超时和可配置的重试策略，不用每个业务调用点自己写 `Promise.race` 加计时器。
- **鉴权与加密**：`authentication()` 中间件对每一帧（包括分片帧、控制帧）做签名/验签、加解密，`connect()` 中间件对"这条消息真的来自我认识的那个 peer 吗"做验证，不是只信任 `senderId` 这个可以被伪造的字符串字段。
- **大消息自动分片**：`chunk()` 中间件在发送侧按字节预算自动切分、接收侧自动重组，并从并发消息数、单 peer 消息数、分片数、分片大小、缓冲区总量、重组超时六个维度限制资源占用，防止恶意/异常大消息把内存打爆。
- **多接收端的服务发现与负载均衡**：同一个 `targetId` 背后可以有多个存活的接收端（比如多个 SharedWorker tab），框架自动维护"谁还活着"的路由表，未指定接收端时对活跃接收端做首次成功即返回的竞速调用；也支持手动模式精确控制发现/注册/固定路由。
- **统一的错误处理**：所有失败都是 `WebRpcError` 的实例，带稳定的 `error.code` 字符串（不是本地化文案，不是运行时特定的错误类），可以安全地按 code 做 `switch`/分支处理。
- **可控的生命周期**：`dispose()` 保证按预期顺序清理中间件、传输连接、进行中的请求，任何一步清理失败都会被收集而不是让后续清理步骤中断。

## 4. 五分钟上手

下面这个例子完全不依赖浏览器 API，用内置的内存传输（`createMemoryTransportPair`）在同一个进程里模拟两端通信，可以直接跑：

```ts
import { createEndpoint, contract, protocol, connect } from '@migaia/web-rpc';
import { createMemoryTransportPair } from '@migaia/web-rpc/adapters/memory';

// 一对互相连通的传输通道，分别给"客户端"和"服务端"用
const [clientTransport, serverTransport] = createMemoryTransportPair();

// 服务端：声明自己是谁（id），注册一个方法
const server = await createEndpoint({
  id: 'server',
  transport: serverTransport,
  middlewares: [
    contract({ version: '1' }),
    protocol(),
    connect({ transport: serverTransport })
  ]
});
server.provide('add', (ctx) => {
  const { a, b } = ctx.data as { a: number; b: number };
  return ctx.success(a + b);
});

// 客户端：同样声明身份，然后直接"调用"服务端的方法
const client = await createEndpoint({
  id: 'client',
  transport: clientTransport,
  targetIds: ['server'],
  middlewares: [
    contract({ version: '1' }),
    protocol(),
    connect({ transport: clientTransport })
  ]
});

const result = await client.send<number>('server', 'add', { a: 1, b: 2 });
console.log(result); // 3

await client.dispose();
await server.dispose();
```

看懂这一个例子，你就理解了这个库的核心心智模型：**每一端都是一个 `endpoint`，`endpoint` 靠 `provide()` 暴露方法、靠 `send()` 调用别人的方法，`middlewares` 决定这个 endpoint 具备哪些能力**（协议编解码、版本契约、来源验证……）。换一个真实传输（比如把 `createMemoryTransportPair()` 换成 `createWebWorkerTransport(worker)`），业务代码一行都不用改。

## 5. 核心概念一览

| 概念 | 是什么 | 类比 |
| --- | --- | --- |
| **Endpoint（端点）** | `createEndpoint()` 返回的对象，代表通信链路里的"我方" | 一个 RPC 客户端兼服务端实例 |
| **Transport（传输）** | 只负责"发字节/对象、收字节/对象"的最底层适配器 | HTTP 里的 TCP 连接 |
| **Middleware（中间件）** | 给 endpoint 安装某种能力（协议编解码、鉴权、分片……） | Express 的中间件链，但装的是能力而不是请求处理逻辑 |
| **Provider（提供者）** | 通过 `provide(method, fn)` 注册的方法处理函数 | HTTP 里的路由 handler |
| **Adapter（适配器）** | 官方提供的 `createXxxTransport()` 工厂函数，把某个具体宿主 API 包成 `Transport` | 数据库驱动之于数据库协议 |
| **Contract（契约）** | 双方约定的协议版本号 + 每个方法的入参/出参 schema | 接口的 IDL/OpenAPI 定义 |
| **Discovery（发现）** | 同一个 `targetId` 背后有哪些接收端存活、路由到谁 | 服务注册与发现 |

## 6. 支持的传输适配器

适配器不在主入口导出，按需从子路径引入（避免把用不到的浏览器 API 探测代码打进你的 bundle）：

| 适配器 | 导入路径 | 适用场景 | 关键约束 |
| --- | --- | --- | --- |
| `createWindowMessageTransport` | `@migaia/web-rpc/adapters/window` | 主页面 ↔ iframe / 弹出窗口 | 跨源必须显式传 `targetOrigin`；无法可靠感知对方窗口被关闭，需配合超时 |
| `createBrowserMessagePortTransport` | `@migaia/web-rpc/adapters/message-port` | 浏览器 `MessageChannel`/`MessagePort` | 默认 `owned`（框架负责关闭 port），显式传 `borrowed` 可保留控制权 |
| `createWebWorkerTransport` | `@migaia/web-rpc/adapters/web-worker` | 主线程 ↔ dedicated Worker | `error`/`messageerror` 无消息体，统一走 `onTransportError` 让所有挂起请求立即失败 |
| `createSharedWorkerTransport` | `@migaia/web-rpc/adapters/shared-worker` | 多标签页共享同一个 SharedWorker | 不引入 DOM/Worker 全局类型即可编译 |
| `createServiceWorkerTransport` | `@migaia/web-rpc/adapters/service-worker` | 页面 ↔ ServiceWorker | 发送方与接收方是两个独立的宿主对象 |
| `createBroadcastChannelTransport` | `@migaia/web-rpc/adapters/broadcast-channel` | 同源多标签页广播 | **匿名分组只是"诚实节点"路由，不是身份边界**，见下方安全提示 |
| `createRtcDataChannelTransport` | `@migaia/web-rpc/adapters/rtc-data-channel` | WebRTC 点对点数据通道 | 要求可靠有序通道（`ordered: true`） |
| `createWebTransportDatagramTransport` | `@migaia/web-rpc/adapters/web-transport` | HTTP/3 WebTransport datagram | 协议编解码需自行处理（datagram 无内建分帧） |
| `createMemoryTransportPair` | `@migaia/web-rpc/adapters/memory` | 单元测试、同进程联调、不依赖任何浏览器 API | 仅供测试/开发使用，两端物理上就是同一个 JS 堆 |

> 用不了官方适配器？实现 `IWebRpcTransport`（只有 `send`/`subscribe` 两个必需方法）就能接入任意自定义通道，见 [USEGUIDE.md](./USEGUIDE.md#自定义传输适配器)。

## 7. 常用中间件一览

| 中间件 | 作用 | 什么时候必须要 |
| --- | --- | --- |
| `contract()` | 声明协议版本、按方法校验入参/出参 schema | 建议总是加，否则契约不匹配时问题会在业务代码里才暴露 |
| `protocol()` | 定义消息的编码/解码方式（默认恒等） | 需要自定义序列化格式（如 MessagePack）时配置 |
| `connect()` | 验证对端身份、驱动服务发现 | **几乎总是需要**——没有它无法做来源校验，多接收端场景也无法路由 |
| `authentication()` | 对每一帧做签名/验签、加解密 | 通信通道本身不可信（比如匿名 BroadcastChannel）时必须加 |
| `chunk()` | 大消息自动分片与重组 | 消息可能超过传输通道的单条大小限制时加 |
| `timeout()` | 统一请求超时与重试策略 | 建议总是加，否则默认行为可能是无限等待 |
| `ping()` | 提供 `endpoint.ping(targetId, receiverId?, options?)` 存活探测 | 需要主动探测对端是否还在时加 |
| `abort()` | 支持 `AbortSignal` 取消进行中的请求 | 需要可取消调用时加 |
| `hooks()` | 订阅框架内部生命周期事件，用于日志/监控 | 需要可观测性时加 |
| `uuid()` | 自定义请求/消息 ID 生成策略 | 默认策略不满足需求（如需要和其他系统的 trace id 对齐）时加 |

## 8. 安装

```bash
pnpm add @migaia/web-rpc
```

无运行时依赖，不依赖 Store、React、WASM，也不绑定任何具体宿主环境。

## 9. 典型使用模式（更多完整示例见 USEGUIDE.md）

- **主线程调度 Worker 计算**：`createWebWorkerTransport(worker)` + `provide('compute', ...)`，把 CPU 密集任务丢给 Worker，主线程 `await endpoint.send('worker', 'compute', input)` 拿结果，写法和调本地 async 函数一样。
- **iframe 双向鉴权通信**：`createWindowMessageTransport` + `connect({ identifier: (ctx) => allowlist.has(ctx.origin) })`，只信任白名单里的 origin。
- **标签页广播通知**：`createBroadcastChannelTransport` + `endpoint.dispatchAll(method, data)` 单向通知所有存活标签页，不等待响应。
- **大文件跨端传输**：`chunk({ chunkSize: 16_384, maxMessageBytes: 4 * 1024 * 1024 })`，业务代码不用关心分片逻辑，正常 `send()` 一个大 payload 即可。

## 10. 注意事项（最容易踩的坑）

1. **`senderId` 是不可信字段**，任何拿到该消息的代码都能自己拼一个假的。跨源/共享传输场景必须配置 `connect()` 的 `identifier` 做真正的来源校验，不要只信任 `senderId`。
2. **匿名 BroadcastChannel 不是身份边界**。同源的任何脚本都能观察和伪造匿名组里的帧；`uniqueTargetId` 是路由标识，**不是凭证**，需要真正的鉴权时配置 `authentication()` 中间件。
3. **`ping()` 超时/失败一律返回 `false`**，不会抛错；不要用 try/catch 包它。
4. **响应大小超限、连接被动断开这类"传输层失败"和"业务失败"是两种错误**，规范上区分为 `TRANSPORT`、`DEADLINE_EXCEEDED` 等 code，判断时按 `error.code` 分支，不要依赖 `error.message` 或 `error instanceof` 具体子类。
5. **`Window.postMessage` 无法可靠探测对方窗口被关闭**——依赖 `timeoutMs`（默认有限超时）或显式的宿主生命周期信号，不要假设"没报错就代表还活着"。
6. **`dispose()` 是幂等的、会等待全部清理完成才 settle**；某一步清理失败不会阻止其余步骤执行，失败信息汇总在抛出的错误的 `cleanupErrors` 里，每一项都带着资源名，方便定位是哪个中间件或传输没清理干净。
7. **自定义传输必须准确声明 `topology`**（`exclusive` / `multiplexed` / `broadcast`）。声明为 `multiplexed` 的传输必须提供 peer/source 身份或显式校验，框架不会把它当成"只有一个发送方"的独占通道来信任。
8. **回调函数不依赖 `this`**。中间件 `install`、`provider`、`verifier`、pipeline 回调都以裸函数形式被调用（框架内部明确不使用 `bind`/`call`/`apply`），请用箭头函数或闭包捕获状态。

## 11. 深入参考

以上是能让你在 5 分钟内跑起来、并且不踩常见坑的最小知识集合。每个中间件的完整配置项、每个适配器的构造参数与平台限制、公开 API 的完整签名、全部错误码的触发场景与建议处理、发现机制（自动/手动）的完整语义、以及更多贴近真实场景的完整示例，见 **[USEGUIDE.md](./USEGUIDE.md)**。
