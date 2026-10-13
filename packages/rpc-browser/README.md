# `@migaia/rpc-browser`

**浏览器 Runtime Peer 与通信载体。** 用 `createBrowserPeer` 在父页面与 iframe、页面与 SharedWorker、可靠有序的 WebRTC DataChannel 之间调用函数。`request` / `notify` / `stream` / `group` / `outcome`、握手、方法目录、错误身份与 [`@migaia/rpc-threads`](../rpc-threads/README.md)、[`@migaia/rpc-process`](../rpc-process/README.md) 共用 Core 的 Runtime Peer。六个 transport 子入口继续支持自行组装 Endpoint。

## 适用与不适用场景

**适用：**

| 载体                     | Runtime Peer                                      | Endpoint / transport 与原因                                                                   |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `window`：iframe、弹窗   | `connect: { window, origin }`                     | 绑定指定窗口与显式 origin，满足一对一通信。                                                   |
| `shared-worker`          | 页面 `connect: { sharedWorker }`；Worker `listen` | 每个连接端口各有一个独立 Peer，Worker 可服务多个页面。                                        |
| `rtc-data-channel`       | `connect: { rtcDataChannel }`                     | 只接受可靠、有序的频道；无序或设置重传次数/时间上限会拒绝。                                   |
| `service-worker`         | 不支持                                            | 浏览器可在空闲时终止 Worker，不能承诺持续的 Peer 生命周期；保留 `./adapters/service-worker`。 |
| `broadcast-channel`      | 不支持                                            | 同源一对多广播不具备固定的一对一对端；保留 `./adapters/broadcast-channel`。                   |
| `web-transport` datagram | 不支持                                            | datagram 可丢失、乱序；保留 `./adapters/web-transport`。                                      |

**不适用：**

- Dedicated Worker 与 `MessagePort`：适配器在 `@migaia/rpc-core/adapters/web-worker` 与 `@migaia/rpc-core/adapters/message-port`。如果要由库创建和管理 Worker，用 [`@migaia/rpc-threads`](../rpc-threads/README.md)。
- Node / Bun / Deno 的进程与线程：用 [`@migaia/rpc-process`](../rpc-process/README.md)、[`@migaia/rpc-threads`](../rpc-threads/README.md)。

## 安装

```bash
pnpm add @migaia/rpc-browser @migaia/rpc-core
```

`@migaia/rpc-core` 是 peer 依赖，版本必须一致。根入口导出 `createBrowserPeer`、`IRuntimeBrowserPeerOptions` 与各载体选项类型、`RpcBrowserErrorCode` 与 `RPC_BROWSER_ERROR_SOURCE`。Peer 按所选载体延迟加载 transport；高级用法仍从对应的 `./adapters/*` 子入口导入。

## 快速开始：父页面调用 iframe

iframe 内（`https://billing.example`）提供方法：

```ts doc-test=check file=billing-frame.ts
// billing-frame.ts
import { createBrowserPeer } from '@migaia/rpc-browser'

/** 当前 iframe 的 Peer 只接受指定父窗口与源；页面关闭时释放本端监听器。 */
const billing = await createBrowserPeer({
  connect: { window: window.parent, origin: 'https://shop.example' },
  provide: {
    /** 按总价与税率返回含税金额。 */
    calculateTotal: (input: { prices: number[]; taxRate: number }) =>
      input.prices.reduce((sum, price) => sum + price, 0) * (1 + input.taxRate)
  }
})

window.addEventListener('pagehide', () => void billing.close(), { once: true })
```

父页面（`https://shop.example`）调用：

```ts doc-test=check file=parent.ts
// parent.ts
import { createBrowserPeer } from '@migaia/rpc-browser'

/** 对端公开的方法形状，决定 request 的方法名、输入与结果类型。 */
type IBillingApi = { calculateTotal(input: { prices: number[]; taxRate: number }): number }
/** 页面中的实际 iframe；调用方固定其对端源。 */
const iframe = document.querySelector<HTMLIFrameElement>('#billing')!
/** 工厂完成表示两端握手与方法目录已就绪。 */
const billing = await createBrowserPeer<IBillingApi>({
  connect: { window: iframe.contentWindow!, origin: 'https://billing.example' }
})

console.log(await billing.request('calculateTotal', { prices: [12, 30], taxRate: 0.08 })) // 45.36
await billing.close()
```

两端都启动工厂后，Core 完成握手与方法目录交换。无需手写 Endpoint、中间件、目标 id 或 `context.success`。`peer.on('ready', listener)` 订阅后续 ready 事件；第一次连接的 ready 已由工厂完成表示。`peer[Symbol.asyncDispose]()` 等同于 `close()`。

## SharedWorker：一个 Worker 服务多个页面

页面连接已有的 SharedWorker：

```ts doc-test=check file=shared-page.ts
import { createBrowserPeer } from '@migaia/rpc-browser'

/** Worker 提供的类型契约。 */
type ISharedApi = { ping(): string }
/** Worker 与端口由页面持有；Peer 只借用端口。 */
const worker = new SharedWorker(new URL('./shared.worker.js', import.meta.url), { type: 'module' })
/** 当前页面有自己的连接与方法目录。 */
const shared = await createBrowserPeer<ISharedApi>({ connect: { sharedWorker: worker } })
console.log(await shared.request('ping')) // pong
await shared.close()
worker.port.close()
```

SharedWorker 模块为每个 `connect` 事件接纳一个独立 Peer：

```ts doc-test=check file=shared.worker.ts
import { createBrowserPeer, type IRuntimeBrowserListen } from '@migaia/rpc-browser'

/** 本模块由真实 SharedWorker 宿主加载；声明其 connect 事件形状供 DOM 文档编译器检查。 */
declare const self: IRuntimeBrowserListen

/** Worker 的连接监听器；调用 close() 时停止接纳并关闭已接纳的逻辑 Peer。 */
const server = await createBrowserPeer({
  listen: self,
  provide: { ping: () => 'pong' },
  report: (error) => console.error(error)
})
```

重复绑定同一个 `listen` scope 会拒绝；先关闭原监听器，再重新绑定。`createBrowserPlugin` 暂不提供：现有 Host 的 thread/process slot 不表达浏览器借用载体，本次仅增加 standalone Peer。

## 直接使用 Endpoint / transport

六个 transport 均支持 `transport.observe(probe)`：每次物理发送和通过 `sourceProof` 的接收各报告一次事件，`carrier` 为 `window`、`shared-worker`、`service-worker`、`broadcast-channel`、`rtc-data-channel` 或 `web-transport`。`detail` 复用同一个对象，含 `origin`（未知时为空字符串）、`transfers`（本次发送 transfer 列表长度，接收时因原生事件不提供发送方 transfer 选择而为 -1）与 `rejectedSource`（自上次有效接收后的来源拒绝数，仅附在下一次有效接收）。字符串与直接字节载荷提供准确的 `sizeBytes`，其他对象为 `-1`。默认只报告元数据；`probe.capturing` 为 `true` 时内容保留引用，可受调用方后续修改影响；直接字节载荷的 buffer 列入本次 transfer 时，发送前仅复制这些将被 detach 的字节。保留事件时应立即读取 detail。返回的 disposer 可重复调用，旧 disposer 不影响后续注册，即使复用了同一个 probe；RTC 终止与 WebTransport 关闭均释放观察者。探针异常沿现有 listener 错误通道报告 `TRANSPORT`，原异常保留在 `cause`，发送与接收继续。

BroadcastChannel、Service Worker 与 WebTransport datagram 使用这一层。已有 Endpoint 用户也可保留原组合；所有六个 transport 子入口均未移除。

以下保留同一 iframe 业务的直接 Endpoint 实现。iframe 提供方：

```ts doc-test=check file=advanced-billing-frame.ts
// billing-frame.ts
import { connect, contract, createEndpoint, protocol } from '@migaia/rpc-core'
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'

const transport = createWindowMessageTransport({
  target: window.parent,
  receiver: window,
  targetOrigin: 'https://shop.example' // 只接受来自、也只发往父页面这个源
})
const billing = await createEndpoint({
  id: 'billing-frame',
  transport,
  middlewares: [contract({ version: '1' }), protocol(), connect({ transport })]
})

billing.provide('calculateTotal', (context) => {
  const input = context.data as { prices: number[]; taxRate: number }
  const subtotal = input.prices.reduce((sum, price) => sum + price, 0)
  return context.success(subtotal * (1 + input.taxRate))
})

window.addEventListener('pagehide', () => void billing.dispose(), { once: true })
```

父页面调用：

```ts doc-test=check file=advanced-parent.ts
// parent.ts
import { connect, contract, createEndpoint, protocol } from '@migaia/rpc-core'
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'

const iframe = document.querySelector<HTMLIFrameElement>('#billing')!
await new Promise<void>((resolve) =>
  iframe.addEventListener('load', () => resolve(), { once: true })
)

const transport = createWindowMessageTransport({
  target: iframe.contentWindow!,
  receiver: window,
  targetOrigin: new URL(iframe.src).origin
})
const billing = await createEndpoint({
  id: 'checkout-page',
  targetIds: ['billing-frame'],
  transport,
  middlewares: [contract({ version: '1' }), protocol(), connect({ transport })]
})

const total = await billing.send<number>('billing-frame', 'calculateTotal', {
  prices: [12, 30],
  taxRate: 0.08
})
console.log(total) // 45.36

await billing.dispose()
```

两端的 `middlewares` 必须一致：`contract({ version })` 约定业务版本，`protocol()` 启用协议帧，`connect({ transport })` 在收发前校验消息来源。

## 安全要点

- **Window Peer 必须显式指定 `origin`**，没有同源默认值。`'*'` 会被拒绝，除非同时设置 `allowUnsafeTargetOrigin: true`；接收时仍校验来源窗口。直接使用 Window transport 时选项名是 `targetOrigin`，保留既有同源默认行为。
- 接收端只接受来自 `target` 那个窗口的消息，其它窗口（包括其它 iframe）发来的同格式消息会被忽略。
- BroadcastChannel 对同源的所有标签页可见，不要用它传输只应发给某一方的敏感数据。

## 资源所有权

Window、SharedWorker 端口、RTCDataChannel 都是**借用**资源；`peer.close()` 幂等地关闭逻辑连接并注销监听器，不关闭传入窗口、端口或频道。本 API 没有 `spawn`，没有由 Peer 创建的原生载体。SharedWorker 监听器关闭时停止接纳并清理所有已接纳的逻辑 Peer；端口仍由创建者关闭。

Window 导航/卸载和页面静默关闭 SharedWorker 端口没有通用的远端关闭事件。在途调用通过配置的 Core deadline 失败；不能把它当成立即检测断开。用 `defaultTimeoutMs` 指定等待上限；本地 `pagehide` 可主动调用 `close()`。

直接 Endpoint 的 `dispose()` 同样注销监听器。除 WebTransport 外，六个适配器均借用原生资源，创建者负责 `BroadcastChannel.close()`、`port.close()`、`RTCDataChannel.close()`。WebTransport 适配器取得 datagram 写入端，关闭 transport 时一并关闭；会话本身仍由调用方关闭。

## 错误

Peer 配置与载体解码错误使用 `RPC_BROWSER_ERROR_SOURCE`（`@migaia/rpc/browser`）及 `RpcBrowserErrorCode`：`WINDOW_ORIGIN_REQUIRED`、`RTC_CHANNEL_UNRELIABLE`、`LISTENER_ALREADY_BOUND`、`INVALID_PEER_SOURCE`、`MESSAGE_DECODE_FAILED`。错误保持原生类型与 cause。握手、调用、取消、超时沿用 Core / Remote 的错误身份；现有 transport 配置错误与载体失败继续使用 Core 的 `INVALID_CONFIG` / `TRANSPORT`。

## 相关包

| 包                                                | 关系                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| [`@migaia/rpc-core`](../rpc-core/README.md)       | Runtime Peer、adapter SDK、Endpoint 与调用语义 |
| [`@migaia/rpc-threads`](../rpc-threads/README.md) | 由库创建并监督的 Web Worker                    |

各适配器的参数、行为差异与选择建议见 [USEGUIDE](./USEGUIDE.md)。
