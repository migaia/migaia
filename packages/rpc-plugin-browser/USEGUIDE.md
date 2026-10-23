# 浏览器 RPC 使用指南

[English](./USEGUIDE.en.md) · [包概览](./README.md) · [统一调用规则](../rpc-host/USEGUIDE.md)

应用创建一个 `createRpcHost`，安装一种浏览器传输 plugin，再按需叠加 feature。载体对象由应用取得；plugin 借用它，host 拥有自己的会话、订阅与调用资源。

## Dedicated Worker

页面与 Worker 都必须运行同一套 RPC 协议。下面页面代码借用已创建的 Worker；返回业务结果后先关 host，再由创建者终止 Worker。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function doubleInWorker(worker: Worker) {
  const host = await createRpcHost<{ double(value: number): number }>({
    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]
  })
  try {
    return await host.request('double', 21)
  } finally {
    await host.close()
  }
}
```

Worker 模块使用 `dedicatedWorkerPlugin({ worker: self })`，并在同一个 `createRpcHost` 中提供 `provide: { double: (value: number) => value * 2 }`。Worker 端文件应使用 Worker 全局类型，而不是把页面的 Window 类型强制转换成 Worker。

`host.close()` 不调用 `worker.terminate()`。需要复用 Worker 的应用可继续使用该原生对象；应用结束时仍须自行 terminate。此包承载浏览器 Worker；Node、Bun、Deno 原生线程使用 [thread plugin](../rpc-plugin-thread/USEGUIDE.md)。

## Window 与 iframe

发送目标与本地接收面分别指定。`origin` 必须非空；除非明确设置 `allowUnsafeTargetOrigin: true`，否则不接纳 `'*'`。除 origin 外还检查真实 `event.source`，因此不能把其他 iframe 的消息当作目标会话。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { windowPlugin } from '@migaia/rpc-plugin-browser'

export async function callFrame(target: Window, origin: string) {
  const host = await createRpcHost<{ title(): string }>({
    plugins: [windowPlugin({ window: target, origin, receiver: window })]
  })
  try {
    return await host.request('title')
  } finally {
    await host.close()
  }
}
```

对端同样把发送目标指向本页面，并提供 `title`。不要把接收消息里的自报身份作为绕过 origin/source 校验的依据。

## SharedWorker 多端口

页面用 `sharedWorkerPlugin({ sharedWorker })`；Worker 端用 `sharedWorkerPlugin({ listen: self })`。这两种来源互斥。Worker listener 从真实 connect 事件接纳每个 MessagePort，每个端口独立握手，同一个 host 仍只拥有一个调用端点。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function readSharedValue(worker: SharedWorker) {
  const host = await createRpcHost<{ value(): number }>({
    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]
  })
  try {
    return await host.request('value')
  } finally {
    await host.close()
  }
}
```

关闭一条会话不影响其他端口。host 关闭只撤回自己的监听和逻辑会话，不关闭借入端口或 terminate 共享 Worker；原生资源最终归创建者。

## BroadcastChannel 多参与者

向每个参与者传入实际 `BroadcastChannel`，使用 `broadcastChannelPlugin({ channel })`。原发现与 join/leave 握手为每个参与者建立独立来源；频道名不是 peer 身份，原生 broadcast 也不等于已接受的 RPC 目标集合。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'

export async function listenOnChannel(channel: BroadcastChannel) {
  const host = await createRpcHost({
    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],
    provide: { double: (value: number) => value * 2 }
  })
  return host
}
```

调用者负责最后 `await host.close()`，然后再按自身归属关闭 channel。没有当前对端时，无目标调用遵循 host 的空集合行为；对端就绪后，多目标广播返回逐目标结果。默认身份使用唯一实例 ID；显式相同 name 仍执行 host 的同名仲裁。直连调用可使用当前 name 或 peer ID。BroadcastChannel 不提供 transfer list。

## ServiceWorker 的发送与接收

页面使用 `serviceWorkerPlugin({ serviceWorker, receiver? })`。`serviceWorker` 是实际发送目标；默认接收面为 `navigator.serviceWorker`，可显式传入容器。Worker 端使用 `serviceWorkerPlugin({ clients: self })`，与页面来源互斥。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function askServiceWorker(worker: ServiceWorker) {
  const host = await createRpcHost<{ version(): string }>({
    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]
  })
  try {
    return await host.request('version')
  } finally {
    await host.close()
  }
}
```

Worker 侧根据真实 message 事件的 source.id，通过原生 `clients.get(id)` 解析当前 Client，然后才握手接纳。消息载荷自报的 client ID 不具备来源权限。一个 Client 离开不会关闭其他 Client；本插件不替应用注册、更新或 unregister ServiceWorker。

## 可靠 RTCDataChannel

`rtcDataChannelPlugin({ rtcDataChannel })` 接受已经由应用建立的可靠有序频道：`ordered === true`，`maxRetransmits === null`，`maxPacketLifeTime === null`。不可靠或部分可靠设置在业务前拒绝。应用负责 WebRTC 协商、连接建立及最终 channel.close；host 只拥有其 RPC 订阅。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'

export async function callRtc(channel: RTCDataChannel) {
  const host = await createRpcHost<{ echo(value: string): string }>({
    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]
  })
  try {
    return await host.request('echo', 'hello')
  } finally {
    await host.close()
  }
}
```

## WebTransport 可靠字节流

`webTransportPlugin({ session })` 借用既有 session，等待其 ready，并只创建一次双向可靠流。服务端必须实现兼容的可靠字节 RPC 协议；HTTP 请求处理器或 datagram 服务不能直接充当该对端。

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'

export async function callReliableSession(session: IWebTransportPluginOptions['session']) {
  const host = await createRpcHost<{ echo(value: string): string }>({
    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]
  })
  try {
    return await host.request('echo', 'hello')
  } finally {
    await host.close()
  }
}
```

关闭 host 会取消所拥有的 reader、终止 writer 并释放锁，不调用借入 session.close。握手失败、取消和正常关闭都沿同一归属清理。此传输不使用 datagram，也不把流关闭等同于关闭整个 WebTransport session。

## 调用、取消与错误

所有载体共用 host 的 `request/notify/stream/group/outcome`。双方均可提供业务；多参与者的无目标调用是广播，`send(targetId, method, payload)` 只选当前直连对象。返回的流结束或显式 return 后释放本次调用资源，不 terminate 借入载体。

`connect.timeoutMs` 是 identity/能力握手预算；调用的 `timeoutMs` 与 `signal` 分别约束本次业务。握手前业务不会进入 provider。native structured clone 可用不代表 backing transfer 已资格化；实际会话的能力、认证和 payload 所有权决定显式 transfer 是否允许。

来源与载体错误使用 `rpc.transport.browser`，通用 RPC/握手错误保留 `rpc.endpoint`、`rpc.remote` 等原身份与完整 cause 链。不要仅按 message 匹配，也不要重建错误而丢失原生 TypeError、stack 或 cause。

普通 `PluginHost` 可安装同一传输定义，`name`/`expose` 用于该安装的注册与公开业务。需要编写载体的作者可使用本包八个 `/adapters/*` 入口与 host `/plugin` SDK 的安全原始部署工具；应用无需另建 endpoint 或调用底层工厂。
