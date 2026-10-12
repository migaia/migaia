# `@migaia/rpc-browser`

**浏览器通信载体适配器。** 把浏览器里的各种消息通道包装成 `@migaia/rpc-core` 的 transport，用来在父页面与 iframe、标签页之间、页面与 SharedWorker / Service Worker 之间，以及经 WebRTC 或 WebTransport 进行 RPC 调用。本包只做"载体"这一层：消息来源校验、监听器注册与释放。调用、超时、错误处理由 `@migaia/rpc-core` 的 Endpoint 提供。

## 适用与不适用场景

**适用：**

| 场景                                         | 适配器                                  |
| -------------------------------------------- | --------------------------------------- |
| 父页面 ↔ iframe、页面 ↔ `window.open` 弹窗   | `./adapters/window`                     |
| 同源多个标签页之间广播或协作                 | `./adapters/broadcast-channel`          |
| 页面 ↔ SharedWorker                          | `./adapters/shared-worker`              |
| 页面 ↔ Service Worker                        | `./adapters/service-worker`             |
| 两个浏览器之间经 WebRTC DataChannel          | `./adapters/rtc-data-channel`           |
| 浏览器 ↔ 服务器经 WebTransport datagram      | `./adapters/web-transport`              |

**不适用：**

- Dedicated Worker 与 `MessagePort`：适配器在 `@migaia/rpc-core/adapters/web-worker` 与 `@migaia/rpc-core/adapters/message-port`。如果要由库创建和管理 Worker，用 [`@migaia/rpc-threads`](../rpc-threads/README.md)。
- Node / Bun / Deno 的进程与线程：用 [`@migaia/rpc-process`](../rpc-process/README.md)、[`@migaia/rpc-threads`](../rpc-threads/README.md)。

## 安装

```bash
pnpm add @migaia/rpc-browser @migaia/rpc-core
```

`@migaia/rpc-core` 是 peer 依赖，版本必须一致（当前 `0.0.7`）。本包没有根入口，每个适配器从各自的子路径导入，不会把用不到的载体打进包里。

## 快速开始：父页面调用 iframe

iframe 内（`https://billing.example`）提供方法：

```ts
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

父页面（`https://shop.example`）调用：

```ts
// parent.ts
import { connect, contract, createEndpoint, protocol } from '@migaia/rpc-core'
import { createWindowMessageTransport } from '@migaia/rpc-browser/adapters/window'

const iframe = document.querySelector<HTMLIFrameElement>('#billing')!
await new Promise<void>((resolve) => iframe.addEventListener('load', () => resolve(), { once: true }))

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

- **必须指定 `targetOrigin`**。省略时默认使用当前页面的 origin；跨域 iframe 必须显式写出对方的源。`'*'` 会被拒绝，除非同时设置 `allowUnsafeTargetOrigin: true`（即使这样，接收时仍会校验来源窗口）。
- 接收端只接受来自 `target` 那个窗口的消息，其它窗口（包括其它 iframe）发来的同格式消息会被忽略。
- BroadcastChannel 对同源的所有标签页可见，不要用它传输只应发给某一方的敏感数据。

## 资源所有权

除 WebTransport 外，适配器都**借用**你传入的窗口、端口或频道，不负责关闭它们。`endpoint.dispose()` 会注销适配器注册的监听器；`BroadcastChannel.close()`、`port.close()`、`RTCDataChannel.close()` 等由创建它们的代码负责。例如在 Node 或测试中使用 BroadcastChannel，不关闭频道会让进程一直存活。WebTransport 适配器会取得 datagram 的写入端，关闭 transport 时一并关闭它。

## 错误

本包没有自己的错误码（`RpcBrowserErrorCode` 为空），所有错误都使用 `@migaia/rpc-core` 的身份，例如配置错误为 `@migaia/rpc/core` / `INVALID_CONFIG`，载体失败为 `TRANSPORT`。

## 相关包

| 包                                                    | 关系                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| [`@migaia/rpc-core`](../rpc-core/README.md)           | `createEndpoint`、中间件、MessagePort 与 Dedicated Worker 适配器 |
| [`@migaia/rpc-threads`](../rpc-threads/README.md)     | 由库创建并监督的 Web Worker                                   |

各适配器的参数、行为差异与选择建议见 [USEGUIDE](./USEGUIDE.md)。
