# 浏览器 RPC 使用指南

[English](./USEGUIDE.en.md) · [包概览](./README.md) · [统一调用规则](../rpc-host/USEGUIDE.md)

应用取得真实原生资源，每个 Host 通常选择一种传输。根对象管理身份、provider 与关闭；调用进入对应 namespace。以下完整模块按公开 dist 类型检查，不把静态通过当作真实 realm、认证或整体迁移验收。

## Dedicated Worker

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function doubleInWorker(worker: Worker) {
  const host = await createRpcHost({
    plugins: [dedicatedWorkerPlugin({ worker, connect: { timeoutMs: 1500 } })]
  })
  try {
    return await host.worker.request('double', 21)
  } finally {
    await host.close()
  }
}
```

Worker 端模块见 README，使用 Worker 全局类型。`host.worker` 是默认调用入口；`namespace` 可改名。Host 关闭不会调用 `worker.terminate()`，应用最终终止自己创建的 Worker。Node/Bun/Deno 原生线程使用 thread plugin，不使用这个浏览器资源边界。

## Window 与 iframe

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { windowPlugin } from '@migaia/rpc-plugin-browser'

export async function callFrame(target: Window, origin: string) {
  const host = await createRpcHost({
    plugins: [windowPlugin({ window: target, origin, receiver: window })]
  })
  try {
    return await host.window.request('title')
  } finally {
    await host.close()
  }
}
```

对端指向本页面并提供 `title`。目标 Window 与本地 receiver 分别指定，origin 必须非空；通配符另需显式 `allowUnsafeTargetOrigin: true`。校验真实 source，不为被拒绝的来源读取业务载荷；自报身份不能绕过原生来源校验。

Window 在对端监听安装前会丢弃消息，载体通过 `startupMessagesMayBeLost: true` 声明这一事实。id 较小的非应答方第一次收到对方 hello 后补发一次原 hello；应答方对同一对端的重复 hello 复用原候选或会话，不重复接纳。其他可靠载体不增加握手帧。

## SharedWorker 多端口

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { sharedWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function readSharedValue(worker: SharedWorker) {
  const host = await createRpcHost({
    plugins: [sharedWorkerPlugin({ sharedWorker: worker })]
  })
  try {
    return await host.sharedWorker.request('value')
  } finally {
    await host.close()
  }
}
```

页面借用 `sharedWorker.port`，Worker 端选择 `sharedWorkerPlugin({ listen: self })`。两种来源互斥。listener 从真实 connect 事件取得每个端口，分别建会话；本地 Host 关闭不关闭借入端口或 terminate 共享 Worker。

## BroadcastChannel 多参与者

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'

export async function listenOnChannel(channel: BroadcastChannel) {
  return createRpcHost({
    plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1500 } })],
    provide: { double: (value: number) => value * 2 }
  })
}
```

调用者最终先 `await host.close()`，再按自身归属关闭 channel。发现/握手决定当前 RPC 参与者集合；原生广播不等于接纳所有消息为业务。`host.broadcastChannel.request` 使用当前集合，`send` 指定一个当前对端；空集合和重连 downtime 不能解释为业务完成。该原生 API 没有 transfer list。

首次广播 join 即使在另一参与者创建前丢失，后来的参与者仍会广播自己的 join。现有 listener 会先回复 targeted join，再发送语义 hello；同一原生发送方的有序投递使对端先安装路由。这里复用已有发现机制，不再叠加语义 hello 补发。

## ServiceWorker 的发送与接收

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { serviceWorkerPlugin } from '@migaia/rpc-plugin-browser'

export async function askServiceWorker(worker: ServiceWorker) {
  const host = await createRpcHost({
    plugins: [serviceWorkerPlugin({ serviceWorker: worker, receiver: navigator.serviceWorker })]
  })
  try {
    return await host.serviceWorker.request('version')
  } finally {
    await host.close()
  }
}
```

`serviceWorker` 是发送目标，`receiver` 是本地订阅面，页面默认使用 `navigator.serviceWorker`。Worker 端选择 `serviceWorkerPlugin({ clients: self })`，按真实事件 source.id 通过 `clients.get` 解析原生 Client。插件不替应用注册、更新或 unregister Worker。

## 可靠 RTCDataChannel

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { rtcDataChannelPlugin } from '@migaia/rpc-plugin-browser'

export async function callRtc(channel: RTCDataChannel) {
  const host = await createRpcHost({
    plugins: [rtcDataChannelPlugin({ rtcDataChannel: channel })]
  })
  try {
    return await host.rtcDataChannel.request('echo', 'hello')
  } finally {
    await host.close()
  }
}
```

应用先完成协商并打开频道。要求 `ordered === true`、`maxRetransmits === null`、`maxPacketLifeTime === null`；插件不等待 WebRTC signaling，不接受不可靠或部分可靠配置。Host 只拥有自己的 RPC 订阅，不替应用关闭借入 channel。该路径使用 JSON 文本，不提供 native transfer。

## WebTransport 可靠字节流

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { webTransportPlugin, type IWebTransportPluginOptions } from '@migaia/rpc-plugin-browser'

export async function callReliableSession(session: IWebTransportPluginOptions['session']) {
  const host = await createRpcHost({
    plugins: [webTransportPlugin({ session, connect: { timeoutMs: 1500 } })]
  })
  try {
    return await host.webTransport.request('echo', 'hello')
  } finally {
    await host.close()
  }
}
```

插件等待借入 session 的 ready，然后创建一个可靠双向 stream。对端必须实现 `migaia.rpc/2` 的相同字节载体；普通 HTTP handler、任意 JSON 文本或 datagram 不是这个协议。Host 释放自身 reader/writer 和锁，不调用借入 session.close；不支持 native backing transfer。

## Feature 与介入插件

```ts doc-test=check
import { createRpcHost } from '@migaia/rpc-host'
import { windowPlugin } from '@migaia/rpc-plugin-browser'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { probe } from '@migaia/rpc-host/plugins/probe'

export async function observeFrame(target: Window, origin: string) {
  const observer = probe({
    stages: ['peer'],
    emit(view) {
      console.log(view.lifecycle)
    }
  })
  return createRpcHost({
    plugins: [observer, windowPlugin({ window: target, origin, features: [timeout({ ms: 1500 })] })]
  })
}
```

调用者负责关闭返回的 Host。`timeout`/`retry` 是传输选择的完整业务 feature，放在该工厂的 `features`。probe/schema/auth/chunk/batch/typegen 是实际 host 介入插件，入口是 `@migaia/rpc-host/plugins/*`，启动前安装。`connect.timeoutMs` 只约束握手；业务 `timeoutMs` 与 `signal` 约束调用，不能把取消当成远端从未执行。

`outcome` 等可选扩展需要相应实际 plugin；完整自动 claim、身份 scope 和跨重连重放仍有未闭合项。不要配置根 Host 的旧策略字段、部署 assembler、手工 profile/ACK 或强制转换不支持的选项。

## 职责与已知边界

`rpc-contract` 提供纯协议/能力类型/错误契约，Host 管理调用与会话，Browser 管理原生来源和 I/O；业务 schema 交给 `/plugins/schema`。自定义载体作者使用 `@migaia/rpc-host/sdk` 的 canonical carrier，不再创建第二个 Host 或并行 codec。

原生 origin/source 校验不等于 auth verifier/principal/session 已全部接通。Host-close/drain、重启 downtime 与部分 observer 诊断兼容性仍有保留差异；本指南不承诺对应旧行为均已闭合。多种 transport 混装通常增加路由和权限歧义，优先独立 Host。

处理 `rpc.transport.browser` 与通用 RPC 错误时保留原生类型、`source/code/cause/errors` 和 stack。不要重建错误以丢弃原因，也不要只根据一次发送成功推断业务执行结果。应用最终释放其 Worker、端口、channel、session；Host 只释放自身资源。
