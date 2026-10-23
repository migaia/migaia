# `@migaia/rpc-plugin-browser`

把实际浏览器载体接入 `createRpcHost`：Window、Dedicated/Shared/Service Worker、BroadcastChannel、可靠 RTCDataChannel 与 WebTransport。

[English](./README.en.md) · [使用指南](./USEGUIDE.md)

## 为什么选它

- 所有载体共用 host 的双向调用、方法目录、期限、取消与错误表示。
- Window 绑定实际发送方和显式 origin；ServiceWorker 区分发送 target 与接收 owner。
- SharedWorker、BroadcastChannel 与 ServiceWorker 可接纳多个独立会话，而每个 host 仍只有一个调用端点。
- 借入的 Worker、端口、频道和会话由应用拥有；关闭 RPC 不会擅自终止它们。

## 从这里开始

```bash
pnpm add @migaia/rpc-host @migaia/rpc-contract @migaia/rpc-plugin-browser
```

在页面入口创建实际模块 Worker；`worker.js` 是下方独立 Worker 入口编译后的地址。

```ts
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
try {
  const host = await createRpcHost<{ double(value: number): number }>({
    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]
  })
  try {
    console.log(await host.request('double', 21))
  } finally {
    await host.close()
  }
} finally {
  worker.terminate()
}
```

独立 `worker.ts` 使用 Worker 全局类型与模块构建配置：

```ts
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

await createRpcHost({
  plugins: [dedicatedWorkerPlugin({ worker: self })],
  provide: { double: (value: number) => value * 2 }
})
```

页面输出 `42`。双方必须使用兼容的 RPC 协议；应用决定 Worker 地址、创建时机与最终 terminate。

## 七种载体

| 工厂                     | 真实来源                                                  | 说明                                                                                        |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `windowPlugin`           | `{ window, origin, receiver? }`                           | Window/iframe 对端，origin 必填；`'*'` 另需 `allowUnsafeTargetOrigin: true`                 |
| `dedicatedWorkerPlugin`  | `{ worker }`                                              | 页面 Worker 或 Worker 内的 `self`，复用原 EventTarget 载体                                  |
| `sharedWorkerPlugin`     | `{ sharedWorker }` **或** `{ listen: self }`              | 页面借用 `sharedWorker.port`；Worker 端从 connect 事件接纳多个端口                          |
| `broadcastChannelPlugin` | `{ channel }`                                             | 借入实际 BroadcastChannel，原发现/握手接入各参与者                                          |
| `serviceWorkerPlugin`    | `{ serviceWorker, receiver? }` **或** `{ clients: self }` | 页面发送到实际 Worker，默认接收面是 navigator.serviceWorker；Worker 端按真实 Client.id 接纳 |
| `rtcDataChannelPlugin`   | `{ rtcDataChannel }`                                      | 只接纳 ordered=true，maxRetransmits/maxPacketLifeTime 均为 null 的可靠有序频道              |
| `webTransportPlugin`     | `{ session }`                                             | 等待既有 session.ready，创建一次双向可靠字节流；不用 datagram                               |

这些选项还可带 `name`、`expose` 和 `connect: { timeoutMs }`。SharedWorker 与 ServiceWorker 的两种来源互斥；不要把普通对象或消息里自报的 client ID 当成已接受来源。

## 目标、来源与业务

一对一会话两端都可 `provide`，并使用 `request`、`notify`、`stream`、`group`、`outcome`。多对端时，不指定目标就是 host 广播，结果按 [host 规则](../rpc-host/README.md#调用与目标) 分开；`send(nameOrId, method, payload)` 只选择当前直连对象。

BroadcastChannel 的参与者需要先完成发现与握手，频道名本身不等于对端身份。ServiceWorker 的 `serviceWorker` 是发送目标，`receiver` 是订阅消息的容器；Worker 侧用事件的真实 source/Client.id 解析原生 Client，再做 RPC 握手。Window 同时检查 origin 与实际 event.source。握手超时由 `connect.timeoutMs` 约束，握手前业务不会进入 provider。

WebTransport 的服务端须实现相同可靠字节 RPC 协议。插件仅拥有自己创建的 stream：关闭 reader/writer 并释放锁，不调用借入 session 的 close。它不支持不可靠 datagram RPC。

## 归属、错误与扩展

`await host.close()` 退订自己的消息接收并关闭逻辑会话。应用仍负责自己创建的 Worker、MessagePort、BroadcastChannel、RTCDataChannel 与 WebTransport session。SharedWorker listener 关闭不 terminate 共享 Worker；单个会话退出不关闭其他会话。

原生 structured clone 支持并不自动等于 RPC ownership transfer 可用；transfer 取决于该真实会话的能力与认证配置。BroadcastChannel 没有 transfer list。RPC 失败保留原错误原因，不以可克隆就推断可传输任意 JS 图。

浏览器来源/载体错误使用 `rpc.transport.browser`；通用握手和调用错误可使用 `rpc.endpoint` 或 `rpc.remote`。按 source/code/cause 处理，例如缺失来源、缺失 Window origin 或不可靠 RTC 配置会在原准入边界拒绝。

根入口导出七个 plugin、选项类型与错误身份。`/adapters/window`、`shared-worker`、`service-worker`、`broadcast-channel`、`web-transport`、`rtc-data-channel`、`message-port`、`web-worker` 为明确需要低级载体的作者保留；应用直接把对应 plugin 安装进 host。更多场景见[使用指南](./USEGUIDE.md)。
