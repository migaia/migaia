# `@migaia/rpc-browser` 使用手册

本包提供浏览器 Runtime Peer 和六个 Endpoint transport。Peer 的握手、方法目录、调用、取消与错误语义由 Core 实现；浏览器层选择并借用载体。安装与最短 iframe 示例见 [README](./README.md)。Endpoint 的 `send` / `provide` 与中间件见 [rpc-core USEGUIDE](../rpc-core/USEGUIDE.md)。

## 目录

1. [Runtime Peer 的公共 API](#1-runtime-peer-的公共-api)
2. [window：iframe 与弹窗](#2-windowiframe-与弹窗)
3. [shared-worker：每个页面一个 Peer](#3-shared-worker每个页面一个-peer)
4. [高阶用法：rtc-data-channel 可靠有序的 Peer](#4-高阶用法rtc-data-channel-可靠有序的-peer)
5. [broadcast-channel：同源标签页](#5-broadcast-channel同源标签页)
6. [service-worker：页面与 Service Worker](#6-service-worker页面与-service-worker)
7. [web-transport：不可靠 datagram](#7-web-transport不可靠-datagram)
8. [直接使用 Endpoint / transport](#8-直接使用-endpoint--transport)
9. [选择指南](#9-选择指南)
10. [错误与生命周期](#10-错误与生命周期)

## 1. Runtime Peer 的公共 API

根入口的 `createBrowserPeer<TRemote>()` 返回与进程、线程相同的 Runtime Peer，按远端 API 类型推导方法名、payload 与结果类型。选择一个 `connect` 或 `listen` 来源；不接受已握手、已信任或已拥有的状态，也没有 `spawn`。

| API                                   | 语义                                                             |
| ------------------------------------- | ---------------------------------------------------------------- |
| `request(method, payload?, options?)` | 等待远端方法结果。                                               |
| `notify(method, payload?, options?)`  | 只等待发送；完成不代表远端执行成功。                             |
| `stream(method, payload?, options?)`  | 惰性异步迭代；第一次 `next()` 开始发送，提前退出通知生产者结束。 |
| `group(steps, options?)`              | 顺序执行 request；失败后剩余步骤不执行，不回滚已完成步骤。       |
| `outcome(idempotencyKey)`             | 查询有声明的幂等调用结果；结果丢失不能解释为从未执行。           |
| `describe(options?)`                  | 本地查询身份、已接纳连接与方法目录。                             |
| `on('ready', listener)`               | 订阅后续 ready；连接工厂完成已表示首次握手就绪。                 |
| `close()` / `[Symbol.asyncDispose]()` | 幂等关闭逻辑连接，释放本端监听器；借用的原生资源仍由调用方关闭。 |

公共选项类型为 `IRuntimeBrowserPeerOptions`，来源联合为 `IRuntimeBrowserConnect`。Window、SharedWorker、RTC 分别使用 `IRuntimeBrowserWindowConnect`、`IRuntimeBrowserSharedWorkerConnect`、`IRuntimeBrowserRtcConnect` / `IRuntimeBrowserRtcDataChannel`；Worker scope 与事件形状为 `IRuntimeBrowserListen` / `IRuntimeBrowserConnectEvent`。

公共选项包括 `provide`、`defaultTimeoutMs`、`signal` 与 `report`。`provide` 接受业务函数或异步生成器；不需要 `context.success`。`signal` 可取消未完成的握手；监听器保持订阅该 signal，取消时关闭监听器与已接纳的逻辑 Peer。`report` 接收不能从当前操作直接抛出的错误。默认调用 deadline 为 Core 的 30000 ms；工厂 `defaultTimeoutMs` 和单次调用的 `timeoutMs` 可调整等待上限。单次业务调用的取消使用该调用的 `signal`。

```ts doc-test=check
import { createBrowserPeer } from '@migaia/rpc-browser'

/** iframe 已提供这些业务方法；流方法返回逐项结果。 */
type IActionApi = {
  double(value: number): number
  note(value: string): void
  count(limit: number): AsyncIterableIterator<number>
}

/** 在实际 iframe 上演示 request、notify、stream、group 与资源释放。 */
export async function useFrame(iframe: HTMLIFrameElement) {
  /** origin 必须来自应用固定的对端契约。 */
  const peer = await createBrowserPeer<IActionApi>({
    connect: { window: iframe.contentWindow!, origin: 'https://billing.example' },
    defaultTimeoutMs: 5000
  })
  try {
    console.log(await peer.request('double', 21)) // 42
    await peer.notify('note', 'hello')
    for await (const value of peer.stream('count', 3)) console.log(value)
    console.log(
      await peer.group([
        { method: 'double', payload: 1 },
        { method: 'double', payload: 2 }
      ])
    )
    console.log(await peer.describe())
  } finally {
    await peer.close()
  }
}
```

`outcome` 与幂等方法声明沿用 [rpc-process 公共 Peer API](../rpc-process/USEGUIDE.md#4-调用-api) 的规则。类型只是业务契约，不授予载体身份或来源信任。

## 2. window：iframe 与弹窗

```ts doc-test=check
import { createBrowserPeer } from '@migaia/rpc-browser'

/** 页面实际持有的 iframe；对端提供 calculateTotal。 */
const iframe = document.querySelector<HTMLIFrameElement>('#billing')!
/** 远端契约决定输入与返回值类型。 */
type IBillingApi = { calculateTotal(input: { prices: number[]; taxRate: number }): number }
/** 只借用指定窗口；Core 在该载体上完成握手。 */
const billing = await createBrowserPeer<IBillingApi>({
  connect: { window: iframe.contentWindow!, origin: 'https://billing.example' }
})
console.log(await billing.request('calculateTotal', { prices: [12, 30], taxRate: 0.08 }))
await billing.close()
```

| Window Peer 选项          | 说明                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `window`                  | `iframe.contentWindow`、`window.parent`、`window.opener` 或 `window.open()` 的真实返回值。 |
| `origin`                  | 必填的精确对端源；没有同源默认值。                                                         |
| `receiver`                | 接收 `message` 的实际窗口；窗口环境默认使用当前全局对象。                                  |
| `allowUnsafeTargetOrigin` | 只有显式 `true` 才允许 `origin: '*'`；仍检查来源窗口。                                     |

Peer 复用现有 Window transport：`event.source` 必须是指定窗口，且 `event.origin` 必须等于指定 origin。错误 origin 或其它窗口的消息会被忽略。没有信任跳过开关。

两端都启动 Peer 工厂；握手完成后才能调用。导航或卸载没有通用的远端关闭通知，在途调用按 Core deadline 失败。新页面需建立新 Peer；不能把旧方法目录当成新页面的身份。`close()` 只释放本端，不关闭借用窗口。

直接 Endpoint 仍从 `@migaia/rpc-browser/adapters/window` 导入 `createWindowMessageTransport`，选项名称保留 `target` / `receiver` / `targetOrigin`；其中 `targetOrigin` 的既有同源默认值不适用于 Peer 的 `origin`。

## 3. shared-worker：每个页面一个 Peer

页面连接已有 SharedWorker；每个页面有独立端口、握手与方法目录。

```ts doc-test=check file=page.ts
import { createBrowserPeer } from '@migaia/rpc-browser'

/** 与 Worker 保持一致的业务接口。 */
type ISharedApi = {
  ping(): string
  note(value: string): void
  count(limit: number): AsyncIterableIterator<number>
}
/** 页面创建原生 Worker，并保留关闭其端口的责任。 */
const worker = new SharedWorker(new URL('./shared.worker.js', import.meta.url), { type: 'module' })
/** 此 Peer 仅代表当前页面的端口。 */
const shared = await createBrowserPeer<ISharedApi>({ connect: { sharedWorker: worker } })
try {
  console.log(await shared.request('ping')) // pong
  await shared.notify('note', 'hello')
  for await (const value of shared.stream('count', 3)) console.log(value) // 1 2 3
} finally {
  await shared.close()
  worker.port.close()
}
```

Worker 监听 `connect`，每个进入端口由 Core 接纳为独立 Peer。两个页面同时连接时不会共享方法目录或在途调用。

```ts doc-test=check file=shared.worker.ts
import { createBrowserPeer, type IRuntimeBrowserListen } from '@migaia/rpc-browser'

/** 本模块运行于真实 SharedWorker；文档编译器以公开 connect scope 形状声明宿主 self。 */
declare const self: IRuntimeBrowserListen

/** 逐项生产计数，供每个页面的 stream 消费。 */
async function* count(limit: number) {
  for (let value = 1; value <= limit; value++) yield value
}
/** 借用 SharedWorkerGlobalScope 的 connect 事件，不接管其原生生命周期。 */
const server = await createBrowserPeer({
  listen: self,
  provide: { ping: () => 'pong', note: (value: string) => console.log(value), count },
  report: (error) => console.error(error)
})
server.on('ready', (event) => console.log(event.instanceId))
```

- 页面传入的 `sharedWorker` 只需提供实际 `port`；可直接传 `SharedWorker`，或 `{ port }`。Peer 不接受 caller-supplied trusted 状态。
- `listen` 绑定实际接收 `connect` 的 scope，同一 scope 同时只能有一个监听器。先 `server.close()`，再重新绑定。
- 监听器关闭时停止接纳并关闭已接纳的逻辑 Peer，不关闭借用端口。
- 页面的 `port.close()` 没有通用远端通知；Worker 侧的 pending request 按 Core deadline 失败。
- `messageerror` 沿用载体错误报告。直接 Endpoint 仍使用 `createSharedWorkerTransport(worker.port)`。

## 4. 高阶用法：rtc-data-channel 可靠有序的 Peer

信令（SDP / ICE）和频道创建由应用负责。Peer 只借用已打开的可靠有序频道。

Advanced usage: finish signaling and wait for the caller-owned RTCDataChannel to open before creating the Peer. The channel must be ordered and reliable. Core owns the handshake and method directory; `peer.close()` releases the logical connection while the application retains ownership of the native channel.

```ts doc-test=check
import { createBrowserPeer } from '@migaia/rpc-browser'

/** 对端在同一可靠有序频道上提供 echo。 */
type IRtcApi = { echo(value: string): string }
/** 应用先完成信令与 open，再交给 Peer。 */
export async function useRtc(channel: RTCDataChannel) {
  /** 信令与 DataChannel 的所有权留在应用。 */
  const peer = await createBrowserPeer<IRtcApi>({ connect: { rtcDataChannel: channel } })
  try {
    console.log(await peer.request('echo', 'hello'))
  } finally {
    await peer.close()
  }
}
```

`ordered` 必须为 `true`，`maxRetransmits` 与 `maxPacketLifeTime` 必须均为 `null`（默认可靠配置）。否则以浏览器 `RTC_CHANNEL_UNRELIABLE` 拒绝，不把无序/丢包频道伪装为 Runtime Peer。DataChannel 尚未 `open` 时沿用 transport 的 Core `INVALID_CONFIG`。

RTC transport 以 JSON 字符串收发。接收数据无法解码时报告 `MESSAGE_DECODE_FAILED`，保留原解码错误 cause。`closing` / `close` / `error` 沿用载体失败路径。`peer.close()` 不调用 `channel.close()`；应用负责关闭频道与 RTCPeerConnection。

直接 Endpoint 入口 `@migaia/rpc-browser/adapters/rtc-data-channel` 及 `createRtcDataChannelTransport` 保留。

## 5. broadcast-channel：同源标签页

BroadcastChannel 为一对多同源广播，没有固定的一对一对端；不提供 Runtime Peer。继续用 Endpoint 的 id 与 targetIds 定位逻辑目标，频道不应承担敏感数据的独占通道。

```ts doc-test=run
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

/** 尚未交给 Endpoint 的借用频道，由创建者关闭。 */
const channel = new BroadcastChannel('cart')
/** adapter 注册监听器时仍沿用既有来源边界。 */
const transport = createBroadcastChannelTransport(channel)
channel.close()
```

相同频道名的所有同源上下文都会收到消息。多个对端提供同名方法时，使用唯一 Endpoint id 选择目标。完整运行示例见第 8 节。

## 6. service-worker：页面与 Service Worker

Service Worker 可能在空闲时被浏览器终止，内存握手与目录随之消失；本次不提供 Runtime Peer。页面仍可使用既有 Endpoint transport，并按业务需要重建连接、持久化状态。

页面一侧发给当前控制页面的 Worker：

```ts doc-test=check file=service-page.ts
import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'

/** 等待浏览器确认当前注册可用，不由 RPC 创建注册。 */
const registration = await navigator.serviceWorker.ready
/** 发送与接收主体分开；adapter 借用两者。 */
const transport = createServiceWorkerTransport({
  target: registration.active!,
  receiver: navigator.serviceWorker
})
```

Worker 一侧应先从实际 `clients.get(clientId)` 取得 Client，再调用下面的模块函数。使用 transport 的公开宿主形状，片段可在文档的 DOM 编译环境检查；没有模拟或授予 Client 身份。

```ts doc-test=check file=service-worker.ts
import {
  createServiceWorkerTransport,
  type IServiceWorkerMessageReceiver,
  type IServiceWorkerMessageTarget
} from '@migaia/rpc-browser/adapters/service-worker'

/** 宿主从 clients.get() 取得实际 Client 后，借用该 Client 与真实 Worker receiver。 */
export function openClientTransport(
  client: IServiceWorkerMessageTarget & { readonly id: string },
  receiver: IServiceWorkerMessageReceiver
) {
  return createServiceWorkerTransport({ target: client, receiver, peerId: client.id })
}
```

| transport 选项 | 说明                                                     |
| -------------- | -------------------------------------------------------- |
| `target`       | 页面端为 `ServiceWorker`，Worker 端为实际 `Client`。     |
| `receiver`     | 页面端为 `navigator.serviceWorker`，Worker 端为 `self`。 |
| `peerId`       | 期望的对端 Client id，默认取 `target.id`。               |

原始 transport 的 subscribe 保留消息记录；connect 中间件或 Peer 投影根据 sourceProof 接纳 target 本身或 id 等于 peerId 的来源，忽略其它页面。直接 raw 订阅者负责来源过滤。Worker 的空闲终止通常只能由调用超时发现。

## 7. web-transport：不可靠 datagram

```ts doc-test=check
import { createWebTransportDatagramTransport } from '@migaia/rpc-browser/adapters/web-transport'

/** 应用创建并持有服务器会话。 */
const session = new WebTransport('https://rpc.example:4433/rpc')
await session.ready
/** transport 取得 datagram 写入端，但不接管整个会话。 */
const transport = createWebTransportDatagramTransport(session.datagrams)
```

不提供 Runtime Peer：datagram 可丢失或乱序，且消息大小受路径 MTU 限制。适合小消息、可容忍丢失的 Endpoint 场景；调用丢失由 deadline 发现。

transport 只接受 `Uint8Array`，Endpoint 需配置输出字节的 codec，否则发送以 `TypeError` 拒绝。关闭 transport 会关闭取得的 datagram 写入端；`session.close()` 仍由应用负责。

## 8. 直接使用 Endpoint / transport

每个适配器返回 `IRpcTransport`，交给 `createEndpoint`，并在 `connect` 中间件中再传一次以校验来源。以下完整 BroadcastChannel 示例使用 Node 的两个频道模拟同源标签页。

```ts doc-test=run group=browser-broadcast-pair file=main.ts
import { connect, createEndpoint } from '@migaia/rpc-core'
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

/** 两个同源上下文使用同一频道名；创建者负责关闭频道。 */
const channelA = new BroadcastChannel('cart')
/** 第二个逻辑标签页的独立频道实例。 */
const channelB = new BroadcastChannel('cart')
/** 只借用第一个频道。 */
const tabATransport = createBroadcastChannelTransport(channelA)
/** 只借用第二个频道。 */
const tabBTransport = createBroadcastChannelTransport(channelB)
/** 提供方法的 Endpoint，由示例负责 dispose。 */
const tabB = await createEndpoint({
  id: 'tab-b',
  transport: tabBTransport,
  middlewares: [connect({ transport: tabBTransport })]
})
tabB.provide('cart.count', (context) => context.success(3))
/** 调用端固定目标 id，transport 仍为同源广播。 */
const tabA = await createEndpoint({
  id: 'tab-a',
  targetIds: ['tab-b'],
  transport: tabATransport,
  middlewares: [connect({ transport: tabATransport })]
})
try {
  console.log(await tabA.send<number>('tab-b', 'cart.count', null)) // 3
} finally {
  await tabA.dispose()
  await tabB.dispose()
  channelA.close()
  channelB.close()
}
```

`send` 的 data 为必填参数，无 payload 时传 `null`。Endpoint 方法通过 `context.data` 读取参数、`context.success` / `context.failed` 返回结果。业务版本和协议帧仍由 `contract({ version })` / `protocol()` 选择；两端组合需一致。Peer 已由 Core 配置其 Runtime 协议，不要求用户复制这些步骤。

## 9. 选择指南

| 需求                                 | 推荐                                                 |
| ------------------------------------ | ---------------------------------------------------- |
| iframe、弹窗、嵌入第三方页面         | Window Peer，显式固定 origin 和实际窗口。            |
| 多个页面共享一个 Worker              | SharedWorker Peer；Worker listen，每个页面独立连接。 |
| 浏览器之间直连                       | 完成信令后借用可靠有序的 RTCDataChannel Peer。       |
| 同源多个标签页广播或选主             | BroadcastChannel Endpoint。                          |
| 离线缓存、推送、后台同步             | Service Worker Endpoint，应用负责重建与持久化。      |
| 可容忍丢包的服务器 datagram          | WebTransport Endpoint。                              |
| 页面内后台计算                       | `@migaia/rpc-threads` 的 `createThreadPeer`。        |
| 已有 MessagePort 或 Dedicated Worker | rpc-core 对应 transport + Endpoint。                 |

`createBrowserPlugin` 暂不提供；没有新增 Host slot、Proxy facade、信令、重连监督或跨源信任快捷方式。六个原 transport 子入口均保留。

## 10. 错误与生命周期

浏览器 Peer 自身错误的 source 为 `RPC_BROWSER_ERROR_SOURCE`（`@migaia/rpc/browser`），code 从 `RpcBrowserErrorCode` 读取。

| Browser code             | 场景与处理                                                    |
| ------------------------ | ------------------------------------------------------------- |
| `WINDOW_ORIGIN_REQUIRED` | Window Peer 未显式提供非空 origin；填写固定对端源。           |
| `RTC_CHANNEL_UNRELIABLE` | RTCDataChannel 无序或配置了有限重传；使用默认可靠有序频道。   |
| `LISTENER_ALREADY_BOUND` | 同一个 SharedWorker scope 已绑定监听器；关闭原监听器再绑定。  |
| `INVALID_PEER_SOURCE`    | connect/listen 来源或选项组合非法；选择一个受支持的真实载体。 |
| `MESSAGE_DECODE_FAILED`  | RTC 消息无法解码；排查双方发送的数据，原失败保留在 cause。    |

Core / Remote 继续拥有握手、目录、调用、取消与超时错误。现有 transport 的非法配置为 Core `INVALID_CONFIG`，物理载体失败为 Core `TRANSPORT`；调用 deadline 使用既有 Core code。已有完整外部语义身份的 I/O Error 保持原身份；未分类的可变原生 Error/DOMException 原位附 Core `TRANSPORT`，不可附加身份的值保留在 cause。RTC 错误事件的原 error 保留在 cause。WebTransport send 返回处理写入拒绝后的 Promise，不保证与 native writer.write 的 Promise 引用相同。不要把远端传回的 source/code 当成本地控制权限。

**关闭与竞争：** `close()` 可重复调用；初始化中可用 signal 取消握手并释放已安装的监听器。close 后不再接纳晚到的业务消息。窗口导航/卸载、页面静默关闭 SharedWorker 端口没有可靠的远端关闭事件，pending 调用沿用 Core deadline；未配置有效等待上限时不能承诺及时发现断开。

**调用一直超时：** 检查固定 origin、真实来源窗口、对端是否已经启动 Peer，以及两端实际方法目录。Endpoint 用户还需检查中间件与 provide。

**页面退出：** 在本地 `pagehide` 中调用 `peer.close()` 或 `endpoint.dispose()`；借用端口与频道仍由创建者关闭。

**二进制：** Window / SharedWorker / Service Worker transport 使用结构化克隆；RTC 以 JSON 字符串传输，二进制需应用选择合适的编码。Runtime payload 仍受 Core 的公共可移植值契约约束。

## Probe 与 raw port

`createBrowserPeer({ probe })` 将原 handle 交给 Core。`IMessageAdapterPort.observe?` 转发既有 native browser carrier 的观察 slot；不另建 MessagePort 事件路径。支持的 carrier 同步在 send 内 emit，失败由原 listener/report channel 报告，业务与 source proof 保持原路径。

Metadata 只读取已知 native backing/view 长度，字符串及容器为 -1；capture 默认关闭。直接且实际转移的 bytes 按字节保留，nested transferable 保持原容器引用，可能在 transfer 后分离，getter 不被捕获逻辑遍历。Detail 是复用引用，保留数值需显式消费或快照。
