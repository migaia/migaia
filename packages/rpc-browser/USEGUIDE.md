# `@migaia/rpc-browser` 使用手册

本手册说明每个浏览器载体适配器的参数、来源校验规则与资源所有权。安装与最短示例见 [README](./README.md)。Endpoint 的组装、`send` / `provide` 的完整语义与中间件见 [rpc-core USEGUIDE](../rpc-core/USEGUIDE.md)。

## 目录

1. [如何组装：transport + Endpoint](#1-如何组装transport--endpoint)
2. [window：iframe 与弹窗](#2-windowiframe-与弹窗)
3. [broadcast-channel：同源标签页](#3-broadcast-channel同源标签页)
4. [shared-worker：页面与 SharedWorker](#4-shared-worker页面与-sharedworker)
5. [service-worker：页面与 Service Worker](#5-service-worker页面与-service-worker)
6. [高阶用法：WebRTC 与 WebTransport](#6-高阶用法webrtc-与-webtransport)
7. [选择指南](#7-选择指南)
8. [错误与常见问题](#8-错误与常见问题)

---

## 1. 如何组装：transport + Endpoint

每个适配器返回一个 `IRpcTransport`。把它交给 `@migaia/rpc-core` 的 `createEndpoint`，并在 `connect` 中间件里再传一次，用于消息来源校验：

```ts doc-test=check group=browser-endpoint-helper
import { connect, createEndpoint, type IRpcTransport } from '@migaia/rpc-core'

/** 实际载体由调用方持有；返回的 Endpoint 由调用方 dispose。 */
export async function openBrowserEndpoint(transport: IRpcTransport) {
  const endpoint = await createEndpoint({
    id: 'my-side',
    targetIds: ['other-side'],
    transport,
    middlewares: [connect({ transport })]
  })
  endpoint.provide('ping', (context) => context.success('pong'))
  return endpoint
}
```

- `send(target, method, data, options?)` 的 `data` 是必填参数，不需要参数时传 `null`。
- 提供方用 `context.data` 读取参数，用 `context.success(value)` 返回结果，或 `context.failed(error)` 返回错误。
- 需要版本约定与协议帧时，加入 `contract({ version })` 和 `protocol()` 中间件（README 的 iframe 示例就是这样）。两端的中间件组合必须一致。

下面以 BroadcastChannel 为例的完整代码已在 Node 24 中实际运行（Node 内置 BroadcastChannel）：

```ts doc-test=run group=browser-broadcast-pair file=main.ts
import { connect, createEndpoint } from '@migaia/rpc-core'
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

// 两个标签页（这里用同一进程里的两个 BroadcastChannel 实例模拟）共享频道名 'cart'。
const channelA = new BroadcastChannel('cart')
const channelB = new BroadcastChannel('cart')
const tabATransport = createBroadcastChannelTransport(channelA)
const tabBTransport = createBroadcastChannelTransport(channelB)

const tabB = await createEndpoint({
  id: 'tab-b',
  transport: tabBTransport,
  middlewares: [connect({ transport: tabBTransport })]
})
tabB.provide('cart.count', (context) => context.success(3))

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
  // 适配器借用频道，不负责关闭；由创建它的一方关闭。
  channelA.close()
  channelB.close()
}
```

## 2. window：iframe 与弹窗

```ts doc-test=check
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'

/** 页面必须实际包含这个 iframe；本片段由浏览器宿主运行。 */
const iframe = document.querySelector<HTMLIFrameElement>('#billing')!
const transport = createWindowMessageTransport({
  target: iframe.contentWindow!,
  receiver: window,
  targetOrigin: 'https://billing.example'
})
```

| 选项                      | 说明                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `target`                  | 对端窗口：`iframe.contentWindow`、`window.parent`、`window.opener` 或 `window.open()` 的返回值 |
| `receiver`                | 监听 `message` 事件的对象。在窗口环境中可省略，默认为当前全局对象                          |
| `targetOrigin`            | 对端的源。省略时默认 `location.origin`（只适用于同源）；跨域必须显式写出                    |
| `allowUnsafeTargetOrigin` | 设为 `true` 才允许 `targetOrigin: '*'`；仅在确实无法得知对端源时使用                         |

**来源校验**：只有同时满足"事件的 `source` 就是 `target` 这个窗口"和"事件的 `origin` 等于 `targetOrigin`"的消息才会被处理。页面中其它 iframe、扩展脚本发来的消息即使格式正确也会被忽略。使用 `'*'` 时仍会校验 `source`。

**时机**：父页面要等 iframe 的 `load` 事件之后再创建 Endpoint；iframe 内的代码也需要先完成 `createEndpoint` 和 `provide`，父页面的调用才会被处理。对端尚未就绪时，调用会在超时后失败，可以在业务层重试或先约定一个就绪信号。

## 3. broadcast-channel：同源标签页

```ts doc-test=run
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

const channel = new BroadcastChannel('cart')
const transport = createBroadcastChannelTransport(channel)
// 尚未交给 Endpoint；创建方负责关闭借用频道。
channel.close()
```

- 频道名相同的所有同源上下文（标签页、iframe、Worker）都会收到消息。用 Endpoint 的 `id` 与 `targetIds` 区分要调用的对象。
- 同一频道上有多个对端提供同名方法时，用唯一的 `id` 定位调用目标。
- 适配器借用频道，不负责关闭。

## 4. shared-worker：页面与 SharedWorker

页面一侧：

```ts doc-test=check file=page.ts
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'

const worker = new SharedWorker(new URL('./shared.worker.js', import.meta.url), { type: 'module' })
const transport = createSharedWorkerTransport(worker.port)
```

SharedWorker 一侧，对每个连接进来的页面各创建一个 Endpoint：

```ts doc-test=check file=shared-worker.ts
import { connect, createEndpoint } from '@migaia/rpc-core'
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'

self.addEventListener('connect', (event) => {
  const port = (event as MessageEvent).ports[0]!
  const transport = createSharedWorkerTransport(port)
  void createEndpoint({
    id: 'shared-worker', transport, middlewares: [connect({ transport })]
  }).then((endpoint) => {
    endpoint.provide('ping', (context) => context.success('pong'))
  }).catch((error: unknown) => console.error(error))
})
```

- 适配器会在需要时调用 `port.start()`，并监听 `messageerror`（无法反序列化的消息）作为载体错误上报。
- 每个页面与 SharedWorker 之间是独立的端口，对端身份由端口本身区分。

## 5. service-worker：页面与 Service Worker

页面一侧（发给当前控制页面的 Service Worker）：

```ts doc-test=check file=page.ts
import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'

const registration = await navigator.serviceWorker.ready
const transport = createServiceWorkerTransport({
  target: registration.active!,
  receiver: navigator.serviceWorker
})
```

Service Worker 一侧（回复某个具体页面）：

```ts doc-test=skip reason="此模块运行于真实 ServiceWorkerGlobalScope，使用 worker 宿主的 clients 和 MessageEvent.source Client" file=service-worker.ts
// service-worker.ts：由浏览器作为 Service Worker 加载。
import { createServiceWorkerTransport } from '@migaia/rpc-browser/adapters/service-worker'

self.addEventListener('message', (event) => {
  /** Service Worker 也可能收到非 Client 来源；这里只为实际页面建立回复通道。 */
  const source = event.source
  if (!source || !('id' in source)) return
  const clientId = source.id
  void self.clients.get(clientId).then((client) => {
    if (!client) return
    const transport = createServiceWorkerTransport({
      target: client,
      receiver: self,
      peerId: client.id
    })
    // 把这个实际 Client 的 transport 交给该页面对应的 Endpoint。
  }).catch((error: unknown) => console.error(error))
})
```

| 选项       | 说明                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------- |
| `target`   | 发送目标：页面一侧为 `ServiceWorker`，Service Worker 一侧为某个 `Client`                |
| `receiver` | 监听 `message` 的对象：页面一侧为 `navigator.serviceWorker`，Service Worker 一侧为 `self` |
| `peerId`   | 期望的对端 Client id；默认取 `target.id`                                                  |

**来源校验**：消息的 `source` 必须是 `target` 本身，或其 `id` 等于 `peerId`。其它页面发来的消息会被忽略。

**生命周期提示**：Service Worker 空闲时可能被浏览器终止，内存中的 Endpoint 随之消失。页面侧的调用会超时；在业务层准备好重建连接，并让需要持久的状态落到 IndexedDB 等存储中。

## 6. 高阶用法：WebRTC 与 WebTransport

点对点与服务器 datagram 载体需要你自行完成信令或会话建立，并且对消息可靠性有额外要求。

### 6.1 rtc-data-channel：WebRTC 点对点

```ts doc-test=check
import { createRtcDataChannelTransport } from '@migaia/rpc-browser/adapters/rtc-data-channel'

/** 已完成信令的真实连接由调用方提供；适配器借用其可靠、有序的 DataChannel。 */
export async function openRtcTransport(peerConnection: RTCPeerConnection) {
  const channel = peerConnection.createDataChannel('rpc', { ordered: true })
  await new Promise<void>((resolve) => channel.addEventListener('open', () => resolve(), { once: true }))
  return createRtcDataChannelTransport(channel)
}
```

- 请使用**可靠且有序**的 DataChannel（默认配置即是）。RPC 依赖消息不丢失、不乱序。
- 适配器以字符串收发：发送对象时自动 `JSON.stringify`。
- **先等 `open` 再创建 transport**：DataChannel 仍处于 `connecting` 时创建会以 `INVALID_CONFIG`（`TypeError`）拒绝。已经 `closed` 的频道创建后立即处于关闭状态，发送以 `TRANSPORT` 失败。
- `closing` / `close` / `error` 事件会作为载体关闭上报，之后的发送以 `TRANSPORT` 失败。
- 信令（交换 SDP 与 ICE）不在本包范围内。适配器借用 DataChannel，不负责关闭。

### 6.2 web-transport：WebTransport datagram

```ts doc-test=check
import { createWebTransportDatagramTransport } from '@migaia/rpc-browser/adapters/web-transport'

const session = new WebTransport('https://rpc.example:4433/rpc')
await session.ready
const transport = createWebTransportDatagramTransport(session.datagrams)
```

- **只接受 `Uint8Array`**：Endpoint 必须配置把消息编码为字节的 codec 中间件，否则发送时以 `TypeError` 拒绝。
- **datagram 不可靠**：可能丢失、乱序，且单个 datagram 的大小受路径 MTU 限制（通常一千多字节）。丢失的调用只能靠超时发现。只适合小消息、可容忍丢失的场景；需要可靠传输时，请在应用层改用其它载体。
- 适配器取得 `datagrams.writable` 的写入端，关闭 transport 时一并关闭；`WebTransport` 会话本身仍由你关闭。

## 7. 选择指南

| 需求                                   | 推荐                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| 嵌入第三方页面 / 被第三方嵌入          | `window`，并精确设置 `targetOrigin`                          |
| 同一站点多个标签页共享状态或选主       | `broadcast-channel`                                          |
| 多个标签页共享一个计算或连接           | `shared-worker`                                              |
| 离线缓存、推送、后台同步               | `service-worker`                                             |
| 页面内的后台计算                       | `@migaia/rpc-threads`（由库创建 Worker）或 rpc-core 的 `web-worker` 适配器 |
| 浏览器之间直连                         | `rtc-data-channel`                                           |
| 低延迟、可丢包的服务器推送             | `web-transport`                                              |

## 8. 错误与常见问题

本包不定义自己的错误码，错误都带 `@migaia/rpc/core` 的身份：

| code              | 何时发生                                                                     |
| ----------------- | ---------------------------------------------------------------------------- |
| `INVALID_CONFIG`  | 参数缺失或非法，例如非窗口环境下没有 `receiver`、`targetOrigin` 为空或未经允许的 `'*'`、DataChannel 尚未 `open` |
| `TRANSPORT`       | 载体失败：频道已关闭、DataChannel 不是 `open`、WebTransport 已关闭等          |

**调用一直超时？**
最常见的原因是来源校验没有通过：检查 `targetOrigin` 是否与对端实际的源一致（协议、域名、端口都要相同），以及 `target` 是否是真正发消息的那个窗口。其次检查对端是否已经完成 `createEndpoint` 与 `provide`。

**页面关闭后需要清理吗？**
在 `pagehide` 中调用 `endpoint.dispose()`，注销监听器并拒绝在途调用。

**能传 `ArrayBuffer` 吗？**
window、shared-worker、service-worker 基于结构化克隆，可以传输；rtc-data-channel 以 JSON 字符串传输，二进制需要自行编码（例如 base64）。
