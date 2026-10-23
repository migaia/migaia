# `@migaia/rpc-browser` 使用指南

以下完整示例使用 Node 原生端口与频道，经过公开 API 交付消息或完成真实 Core 握手；不把它们当作浏览器来源验证或 Worker 宿主的证据。

## 按场景查找

| 场景                                         | API                               | 详细说明                                                  |
| -------------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| 调用有类型的方法并只释放逻辑连接             | `createBrowserPeer`               | [完整示例](#调用有类型的方法并只释放逻辑连接)             |
| 通过同一对端消费远端异步生成器               | `createBrowserPeer`               | [完整示例](#通过同一对端消费远端异步生成器)               |
| 通过原生消息端口转移字节缓冲区               | `createSharedWorkerTransport`     | [完整示例](#通过原生消息端口转移字节缓冲区)               |
| 报告一个消息监听器的失败并继续交付其他监听器 | `createSharedWorkerTransport`     | [完整示例](#报告一个消息监听器的失败并继续交付其他监听器) |
| 把一条广播交付给两个频道参与者               | `createBroadcastChannelTransport` | [完整示例](#把一条广播交付给两个频道参与者)               |
| 独立退订一个监听器并保留原生频道             | `createBroadcastChannelTransport` | [完整示例](#独立退订一个监听器并保留原生频道)             |

## 运行准备

```bash
pnpm add @migaia/rpc-browser @migaia/rpc-core
```

每个示例作为独立的 Node 24 TypeScript 模块运行。node:worker_threads 提供真实 MessageChannel 端口，原生 BroadcastChannel 与 crypto.randomUUID 提供广播路径；withResolvers 只是本地完成信号，不是替代载体。示例不需要浏览器、信令服务或外部网络，并明确释放逻辑订阅与原生资源。

## 调用有类型的方法并只释放逻辑连接

调用方需要通过已有端口取得方法结果，同时仍要由应用管理这个原生端口。

手写请求编号和响应监听会再造一层协议，清理时若顺手关闭借用端口，还会影响端口拥有者。

`createBrowserPeer` 在原生 MessagePort 上完成真实 Core 握手；`request` 返回远端结果，`close` 只释放逻辑连接。

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createBrowserPeer } from '@migaia/rpc-browser'

type ICounterApi = { double(value: number): number }
const { port1, port2 } = new MessageChannel()
const [client, service] = await Promise.all([
  createBrowserPeer<ICounterApi>({ connect: { sharedWorker: { port: port1 } } }),
  createBrowserPeer({
    connect: { sharedWorker: { port: port2 } },
    provide: { double: (value: number) => value * 2 }
  })
])
try {
  console.log(await client.request('double', 21))
  const closing = client.close()
  console.log(closing === client.close())
  await closing
  await service.close()
  const delivered = Promise.withResolvers<unknown>()
  port2.once('message', (data: unknown) => delivered.resolve(data))
  port1.postMessage('端口仍可用')
  console.log(await delivered.promise)
} finally {
  await Promise.all([client.close(), service.close()])
  port1.close()
  port2.close()
}
```

输出：

```text
42
true
端口仍可用
```

输出为 `42`、`true`、`端口仍可用`：远端方法已执行，重复关闭复用同一 Promise，两个 Peer 关闭后原生端口仍能送达消息。

Node MessageChannel 提供 `connect.sharedWorker.port` 接受的真实端口操作；这里只证明端口路径，不代表浏览器 SharedWorker 宿主或窗口来源检查，最终由调用方关闭两个端口。

### 示例参数

connect.sharedWorker.port 是 Node MessageChannel 的真实端口，满足公开结构，不是伪造的 SharedWorker；默认提供方法为空，service.provide.double 是接收 number 并返回 number 的方法，TRemote 只提供静态业务类型。两端用 Promise.all 同时开始握手；省略 defaultTimeoutMs 时为 30000 ms。close 复用同一 Promise，但不关闭端口；withResolvers 和原生 once 监听仅用于证明端口仍可用。

## 通过同一对端消费远端异步生成器

远端任务会陆续产生多个值，单次请求返回值却无法表达这一序列。

在远端先收齐结果会推迟消费，把生成器当普通方法调用又会丢掉迭代协议。

在远端类型中声明异步生成器，并使用 `stream`；每次取下一项都复用已经协商的端口连接。

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createBrowserPeer } from '@migaia/rpc-browser'

type ISequenceApi = { values(start: number): AsyncIterableIterator<number> }
const { port1, port2 } = new MessageChannel()
const [client, service] = await Promise.all([
  createBrowserPeer<ISequenceApi>({ connect: { sharedWorker: { port: port1 } } }),
  createBrowserPeer({
    connect: { sharedWorker: { port: port2 } },
    provide: {
      async *values(start: number) {
        yield start
        yield start + 1
      }
    }
  })
])
try {
  const values: number[] = []
  for await (const value of client.stream('values', 3)) values.push(value)
  console.log(values.join(','))
} finally {
  await Promise.all([client.close(), service.close()])
  port1.close()
  port2.close()
}
```

输出：

```text
3,4
```

完整消费通过原生端口传来的远端生成器后，输出 `3,4`。

`stream` 惰性启动，首次迭代才发送；单个结果使用 `request`。本例不证明浏览器信令、重连或跨窗口授权，两个端口仍由调用方拥有。

### 示例参数

provide.values 是异步生成器，类型与远端 ISequenceApi 对应；start 参数为 3，产出 3、4。client.stream 使用方法名和 payload，未给调用选项时沿默认 30000 ms；for await 消费完毕，finally 释放两端逻辑连接与原生端口。没有模拟 Worker realm 或浏览器授权。

## 通过原生消息端口转移字节缓冲区

应用要显式转移一个缓冲区，需要清楚发送后哪一端还能使用其中的字节。

普通结构化克隆会保留副本，转移列表却会让发送端缓冲区分离；如果隐藏这个选择，后续读写就容易误用已经失效的缓冲区。

通过 `send(message, { transfer })` 传入实际缓冲区，适配器把列表交给原生端口，所有权变化遵循宿主的转移规则。

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'

const { port1, port2 } = new MessageChannel()
const sender = createSharedWorkerTransport(port1)
const receiver = createSharedWorkerTransport(port2)
const received = Promise.withResolvers<unknown>()
const stop = receiver.subscribe(({ data }) => received.resolve(data))
try {
  const bytes = new Uint8Array([7, 8])
  sender.send(bytes.buffer, { transfer: [bytes.buffer] })
  console.log(bytes.byteLength)
  console.log([...new Uint8Array((await received.promise) as ArrayBuffer)].join(','))
} finally {
  stop()
  port1.close()
  port2.close()
}
```

输出：

```text
0
7,8
```

输出先是 `0`，然后是 `7,8`：发送端字节视图已分离，接收端取得原字节值。

`transfer` 默认 `undefined`，此时使用原生克隆。本例是原始载体收发，不是 RPC 载荷契约；调用方最终退订并关闭两个原生端口。

### 示例参数

createSharedWorkerTransport 只接收真实 port；receiver.subscribe 的回调读取消息记录 data。send 的第二个参数 transfer 默认 undefined，本例显式放入 bytes.buffer，使用宿主转移而非复制；Uint8Array 初值 [7,8]，发送端 byteLength 随分离变 0。stop 只退订，物理端口最后单独关闭。

## 报告一个消息监听器的失败并继续交付其他监听器

一个观察者处理消息时抛错，另一个观察者却仍需要收到这条消息。

用没有隔离的循环逐个调用监听器，首个异常就会中断交付，也可能让调用方不知道究竟哪个观察者失败。

在 `subscribe` 之外登记 `onListenerError`；载体通过监听器错误通道报告原异常，并继续分发同一条原生消息。

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'

const { port1, port2 } = new MessageChannel()
const sender = createSharedWorkerTransport(port1)
const receiver = createSharedWorkerTransport(port2)
const failureText = '消息观察者失败'
const failure = new Error(failureText)
const reports: unknown[] = []
const stopErrors = receiver.onListenerError?.((error) => {
  reports.push(error)
})
const stopFirst = receiver.subscribe(() => {
  throw failure
})
const received = Promise.withResolvers<unknown>()
const stopSecond = receiver.subscribe(({ data }) => received.resolve(data))
try {
  sender.send('已交付')
  console.log(await received.promise)
  console.log(reports.length, reports[0] === failure)
} finally {
  stopFirst()
  stopSecond()
  stopErrors?.()
  port1.close()
  port2.close()
}
```

输出：

```text
已交付
1 true
```

输出为 `已交付`、`1 true`：第二个订阅者收到消息，错误观察者恰好收到一次原异常。

这里隔离的是业务监听器失败，不代表原生端口故障可以继续工作；未登记错误观察者时，失败仍留在载体错误通道，清理操作可能再次呈现尚未处理的失败。

### 示例参数

onListenerError 可选注册返回退订函数；reports 保存错误身份，failure 是本例唯一的业务观察异常。两个 subscribe 按注册顺序交付，第一位 throw 原错，第二位 resolve 实际 data；本例有错误观察者，不把失败留到清理时才发现。所有退订函数与端口均在 finally 释放。

## 把一条广播交付给两个频道参与者

多个参与者都需要同一条更新，而不是只选一个独占的远端接收方。

把共享频道当成私有对端，会忽略它的广播性质：其他符合宿主条件的参与者也能收到载荷。

为同名的原生 BroadcastChannel 分别创建载体；本例在 Node 中一次发送，两个已订阅接收者都会得到消息。

```ts doc-test=run
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

const name = crypto.randomUUID()
const channels = Array.from({ length: 3 }, () => new BroadcastChannel(name))
const [sender, first, second] = channels.map(createBroadcastChannelTransport)
const one = Promise.withResolvers<unknown>()
const two = Promise.withResolvers<unknown>()
const stopOne = first.subscribe(({ data }) => one.resolve(data))
const stopTwo = second.subscribe(({ data }) => two.resolve(data))
try {
  sender.send(7)
  console.log((await Promise.all([one.promise, two.promise])).join(','))
} finally {
  stopOne()
  stopTwo()
  for (const channel of channels) channel.close()
}
```

输出：

```text
7,7
```

输出 `7,7`：两个原生频道参与者通过各自载体的订阅收到同一条更新。

这里只证明 Node 原生频道交付，不证明浏览器来源或存储分区准入。BroadcastChannel 不属于 `createBrowserPeer` 来源；端点标识可以选逻辑接收方，但不会把广播变成私有通信。

### 示例参数

channel name 用 crypto.randomUUID 防止与别的运行混用，3 个真实 BroadcastChannel 实例使用同名；没有额外 adapter 选项。两个接收方各有一个 subscribe，Promise.all 保持结果登记顺序而不要求跨参与者到达顺序；发送数值 7，最终逐个关闭频道。

## 独立退订一个监听器并保留原生频道

一个视图退出共享频道，另一个视图却仍要继续接收更新。

如果清理时一次移除全部监听器或直接关闭频道，就会截断尚未退订的其他使用者。

保存每次 `subscribe` 返回的退订函数；释放其中一个订阅不影响另一个，全部退订后也不会关闭调用方拥有的频道。

```ts doc-test=run
import { createBroadcastChannelTransport } from '@migaia/rpc-browser/adapters/broadcast-channel'

const name = crypto.randomUUID()
const outbound = new BroadcastChannel(name)
const inbound = new BroadcastChannel(name)
const sender = createBroadcastChannelTransport(outbound)
const receiver = createBroadcastChannelTransport(inbound)
let retiredCalls = 0
const stopFirst = receiver.subscribe(() => {
  retiredCalls += 1
})
const received = Promise.withResolvers<unknown>()
const stopSecond = receiver.subscribe(({ data }) => received.resolve(data))
try {
  stopFirst()
  stopFirst()
  sender.send('第一条')
  console.log(retiredCalls, await received.promise)
  stopSecond()
  const native = Promise.withResolvers<unknown>()
  inbound.addEventListener('message', ({ data }) => native.resolve(data), { once: true })
  sender.send('原生消息')
  console.log(await native.promise)
} finally {
  stopFirst()
  stopSecond()
  outbound.close()
  inbound.close()
}
```

输出：

```text
0 第一条
原生消息
```

输出 `0 第一条`、`原生消息`：已退订者没有运行，剩余订阅者收到第一条消息，最后退订后原生频道仍可交付消息。

监听移除成功后，重复退订不会再次移除；退订函数只释放此载体的登记，BroadcastChannel 实例仍须由应用关闭。

### 示例参数

两个 subscribe 共享本 transport 的原生 message 监听，stopFirst 重复调用展示正常移除后的幂等；stopSecond 不受影响。全部退订后，原生 once:true 监听仍能从同一个频道收到消息；原生频道最后由应用 close。没有把广播变成独占对端。

## 契约细节

### 归属、入口与选择

根入口提供 createBrowserPeer、公共来源/选项类型，以及 RpcBrowserErrorCode、RPC_BROWSER_ERROR_SOURCE、IRpcBrowserErrorCode。Core 拥有握手、方法目录、调用、取消与错误传输；本包选择浏览器载体并复用它原有的消息路径。根入口按选中的载体延迟加载 adapter，不代表未经测量的体积或速度保证。

| 入口 / 载体            | Runtime Peer                             | 直接 Endpoint transport                                       |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| 根入口 / window        | connect.window，必须给 origin            | adapters/window 的 createWindowMessageTransport               |
| shared-worker          | 页面 connect.sharedWorker；Worker listen | adapters/shared-worker 的 createSharedWorkerTransport         |
| rtc-data-channel       | connect.rtcDataChannel，要求可靠有序     | adapters/rtc-data-channel 的 createRtcDataChannelTransport    |
| broadcast-channel      | 不支持，一对多不是固定对端               | adapters/broadcast-channel 的 createBroadcastChannelTransport |
| service-worker         | 不支持，空闲终止会丢失内存连接           | adapters/service-worker 的 createServiceWorkerTransport       |
| web-transport datagram | 不支持，可丢失和乱序                     | adapters/web-transport 的 createWebTransportDatagramTransport |

Dedicated Worker 与通用 MessagePort 的 transport 在 rpc-core 的 adapters/web-worker、adapters/message-port；由库创建并监督 Worker 时用 rpc-threads。进程通信由 rpc-process 负责。createBrowserPlugin 不存在，也没有 spawn、信令、自动重连监督、额外 Host slot 或跳过来源验证的开关。Node MessageChannel 案例使用真实端口满足 sharedWorker.port 的公开结构，不证明浏览器 SharedWorker 创建、跨源授权、RTC 信令或 WebTransport 网络行为。

安装同时显式声明 @migaia/rpc-browser 与其 peer 依赖 @migaia/rpc-core；依赖范围不构成运行时“版本必须相等”的检查。发布保留 dist 与 schema，以及根入口和六个 adapter 子入口。内部 browser 文件不是额外公开入口。

### Runtime Peer 的参数与方法

`createBrowserPeer<TRemote>(options)` 返回 Core 的原始动态或类型化 Peer。TRemote 描述方法名、输入、结果和流类型，不授予来源信任或执行权限。必须恰好选择 connect 或 listen，不能传入已握手、已信任、已拥有的状态代替真实载体。

| 参数                                   | 取值、默认与作用                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| connect                                | window、sharedWorker、rtcDataChannel 三个来源恰选一个；无默认                      |
| listen                                 | 实际 SharedWorker connect scope，与 connect 互斥；无默认                           |
| provide                                | 默认无业务方法；显式函数或嵌套 own-data 方法组，支持异步生成器；不执行配置 getter  |
| self                                   | 缺省 name 为 browser，instanceId 由 Core 生成；身份说明不是授权凭据                |
| defaultTimeoutMs                       | 默认 30000 ms，必须为正有限 number，可为小数；request/stream 继承此默认            |
| signal                                 | 默认无；连接时取消未完成握手，listen 模式持续监听并在取消时关闭监听器及其逻辑 Peer |
| report                                 | 默认沿原 owner 向 console.error 报告后台失败；回调不替代当前操作可直接返回的错误   |
| providerLimits                         | 默认 global=256、perPeer=64，由 Core 接纳并发提供方调用                            |
| probe                                  | 默认无，可传一个或一组 Core probe；观察不改变协议和来源规则                        |
| authentication、contract               | 可选的 Core 认证配置、显式高级方法模式/schema/幂等声明；默认不额外配置             |
| keyFactory、retryPort、endpointFactory | 保留 Core 的高级扩展入口，没有浏览器层另行生成的默认实现契约                       |

| 方法                              | 调用后发生什么                                                   |
| --------------------------------- | ---------------------------------------------------------------- |
| request(method,payload?,options?) | 等待远端标量结果；业务失败、取消、deadline 等使 Promise 拒绝     |
| notify(method,payload?,options?)  | 只等待本地发送，不证明远端执行完成                               |
| stream(method,payload?,options?)  | 惰性异步迭代，首次 next 开始发送，提前 return 通知生产者结束     |
| group(steps,options?)             | 顺序执行 request，失败后不执行剩余步骤，不回滚已完成步骤         |
| outcome(idempotencyKey)           | 查询已声明幂等调用的结果；结果丢失不等于从未执行                 |
| describe(options?)                | 读取本地身份、已接纳连接和目录，可用 Core 的文本格式投影         |
| on('ready',listener)              | 订阅后续 ready；连接工厂完成已经表示首次握手与目录就绪           |
| close() / Symbol.asyncDispose     | 关闭逻辑连接并共享清理 Promise，释放本端订阅，不关闭借用原生载体 |

业务函数接收 payload 与 Core context，简单返回值无需 context.success。两端同时开始连接，不能先 await 一端握手再启动另一端。单次调用 options.signal 负责该调用取消；timeoutMs 的 number / false 与零预算沿 Core 原有规则，工厂 defaultTimeoutMs 不能填 false 或 0。提供流方法不意味着任何网络载体都变得可靠，重试也不自动提供业务恰好一次保证。

### Window：指定窗口与精确 origin

Peer 来源是 {window,origin,receiver?,allowUnsafeTargetOrigin?}。window 是应用已持有的 iframe.contentWindow、window.parent、window.opener 或 window.open 返回值；origin 必填非空，不继承同源默认。receiver 缺省取具有 addEventListener 的当前全局对象；非 Window 宿主必须明确给接收者。origin='*' 仅在 allowUnsafeTargetOrigin===true 时允许；该选项省略值为 undefined，仍必须匹配指定窗口身份。

直接 createWindowMessageTransport({target,receiver?,targetOrigin?,allowUnsafeTargetOrigin?}) 的 target 必填；receiver 默认同上，targetOrigin 缺省取当前 location.origin，没有可用值时 INVALID_CONFIG。该默认与 Peer 的显式 origin 要求不同。发送调用 target.postMessage(message,targetOrigin,transfer)；transfer 默认 undefined，保留原生结构化克隆与转移语义。

sourceProof 仅接受 source===target 且 origin 匹配；显式通配符只放宽 origin。Peer bridge 在 ACK 和业务处理前使用它；Endpoint 用户把同一 transport 传给 connect。raw transport.subscribe 仍会收到未通过来源的记录，直接订阅者必须自行过滤，不能把收到了事件当作已验证。监听器挂在 receiver，发送者 target 与接收者可以不同。

导航、卸载和页面静默关闭没有通用可靠的远端关闭通知。新页面应重新建立 Peer，旧目录不能代表新页面身份；在途调用通常依赖已配置 deadline 结束，本地 pagehide 可主动 close。

### SharedWorker：每个真实端口一个连接

页面传 connect:{sharedWorker}，sharedWorker 只需暴露真实 port；可传原生 SharedWorker 或 {port}。端口要有 postMessage/addEventListener/removeEventListener，start 可选。createSharedWorkerTransport(port) 没有其他选项，topology 为 exclusive，发送保留 transfer 列表；首次业务订阅调用 start，并共享 message/messageerror 原生监听，最后一位退订后移除。端口仍由创建者关闭。

Worker 传 listen scope，其 addEventListener/removeEventListener 接收 'connect'，每个事件的 ports 是真实端口数组。每个端口独立握手、方法目录和在途调用；同一 scope 只能有一个活动监听器，重复绑定 LISTENER_ALREADY_BOUND，关闭原监听器后可重绑。listen 工厂完成表示接纳入口已安装，不表示已经有客户端握手。

监听器 close 先停止接纳，再清理已接纳 Peer 与尚在打开的资源，并保留同一个清理 Promise。没有客户端或有多个客户端时不能假定存在唯一调用目标。signal 取消加入同一关闭过程；没有提供 report 时，原 owner 报告不能从事件回调返回的失败。借用 scope 和端口不会被终止。对端静默 port.close 通常只能由 Core deadline 发现；messageerror 走载体错误通道。

### BroadcastChannel 与 Service Worker

createBroadcastChannelTransport(channel) 接受真实 BroadcastChannel，无额外选项；topology=broadcast、ownership=borrowed，不支持 transfer 列表。相同名字的频道向其它同域上下文广播，不是独占对端，也不是敏感数据的授权边界。多个提供方应使用唯一 Endpoint id/targetIds 选择逻辑目标。最后业务订阅移除只解绑原生 message 监听，不调用 channel.close。

createServiceWorkerTransport 的 target 与 receiver 必填：页面发送给实际 ServiceWorker，接收用 navigator.serviceWorker；Worker 发送给 clients.get 获得的实际 Client，接收用 self。peerId 可选，缺省 target.id。topology=multiplexed、ownership=borrowed，发送保留 transfer；不创建注册，也不维持后台进程。

Service Worker sourceProof 接受 target 本身，或 id===peerId 的来源。通过验证的跨 realm Client wrapper 被规范化为配置的 target；未验证来源仍按原记录交给 raw 订阅，connect 才按来源接纳。读取恶意 id 失败报告 TRANSPORT 并保留 cause，不变成可信来源。空闲终止后应用负责重建连接和持久化业务状态。

### RTCDataChannel 与 WebTransport

Peer 要求 ordered===true、maxRetransmits===null、maxPacketLifeTime===null；无序或有限重传以 RTC_CHANNEL_UNRELIABLE 拒绝。应用先完成 SDP/ICE 信令和连接；Peer 不创建或关闭原生频道。底层 createRtcDataChannelTransport(channel) 本身只检查公开方法与 readyState：open 可用，closed 构造为已终止；其它状态 INVALID_CONFIG。底层 adapter 不重复检查可靠性，不能因此把不可靠频道当成 Peer 支持契约。

RTC transport topology=exclusive、ownership=borrowed、encodedType='string'，非字符串发送值先 JSON.stringify。raw 订阅收到物理数据；Peer bridge 再 JSON.parse，解码失败 MESSAGE_DECODE_FAILED 且 cause 保留。closing/close/error 使 transport 终止，清理消息及终止监听并报告 TRANSPORT；后安装错误观察者可以看到终止原因。channel.close 与 RTCPeerConnection 仍归应用。

createWebTransportDatagramTransport({readable,writable}) 取得真实 datagram streams，topology=exclusive、ownership=owned、encodedType='uint8array'。构造即取得 writer，首次订阅启动 reader；退订业务回调不停止 reader。发送仅接受 Uint8Array，否则 TypeError/INVALID_CONFIG。仅选择字节 codec 并不足以得到可用 Endpoint：默认 framer 可能产出 unknown，native binary framer 可能产出 fragment 对象，均不满足此载体输入；本包未提供现成兼容的 Endpoint/framer 组合，因此这里不推荐一个未经验证的组合。send 返回经过拒绝分类的 Promise，不保证与 writer.write 返回对象同一引用。

EOF 或读取失败使 datagram transport 终止；close 共享同一 Promise，取消并等待 reader，尝试关闭 writer 和释放锁，保留所有清理失败。它拥有这两个 stream 端口，不拥有外部 WebTransport session；session.close 由应用负责。datagram 可丢失、乱序且受 MTU 限制，没有 Runtime Peer；deadline 只能结束等待，不能补回已丢失消息。

### Endpoint 组合、生命周期与错误

adapter 返回 IRpcTransport，使用 createEndpoint({id,transport,middlewares:[connect({transport})]}) 组合；固定目标可加 targetIds。Endpoint.send(target,method,data,options?) 的 data 必填，无 payload 时传 null；provider 用 context.data / context.success / context.failed。需要业务版本或协议帧时，两端一致配置 contract({version}) / protocol()；Peer 已由 Core 配置其 Runtime 协议，不能把低层中间件重复配置当作 Peer 要求。

Window、SharedWorker、ServiceWorker、BroadcastChannel、RTC 都借用原生载体，Endpoint.dispose 与 Peer.close 释放订阅，创建者仍负责 close。WebTransport 只有其取得的 reader/writer 随 transport 释放。正常退订幂等；原生 remover 失败可能抛错并保留该登记，调用原 disposer 可再次尝试。不要声称所有清理都不失败。

| 本包 code（source=rpc.transport.browser） | 触发与处理                                                      |
| --------------------------------------- | --------------------------------------------------------------- |
| WINDOW_ORIGIN_REQUIRED                  | Window Peer 缺少非空 origin；填写明确对端源                     |
| RTC_CHANNEL_UNRELIABLE                  | Peer 的频道不是可靠有序；改用受支持配置                         |
| LISTENER_ALREADY_BOUND                  | SharedWorker scope 已有监听器；先关闭旧监听器                   |
| INVALID_PEER_SOURCE                     | connect/listen 冲突或来源不支持；恰选一个真实来源               |
| MESSAGE_DECODE_FAILED                   | Peer 的 RTC JSON 无法解码；检查对端物理输入，cause 保留解码原错 |

这些浏览器准入错误保留 TypeError 与 cause。握手、目录、业务调用、取消、超时及 wire 错误由 Core/Remote 拥有；旧 transport 配置错误为 Core INVALID_CONFIG。BroadcastChannel、SharedWorker、ServiceWorker 的原生发送失败，以及 WebTransport 的读写拒绝，由既有边界归类为 Core TRANSPORT：已有完整外包身份的 I/O Error 保留 source/code，可附身份的未分类原生 Error/DOMException 原位分类，不可附加的失败经 cause 保留。Window 与 RTC 的 raw send 直接委托原生发送，RTC 还可能直接抛出 JSON.stringify 错误，不能把上述分类概括到所有 raw send。监听失败与 RTC 终止事件沿各自报告通道保留原错误链；远端 source/code 不构成本地控制权限。

若调用一直超时，检查两端是否同时启动、固定 origin、真实来源窗口、目录及调用目标；Endpoint 还需核对 middleware 和 provide。未配有效等待上限时，不承诺及时发现静默断开。

### 物理观察与数据边界

所有六个 transport 支持 observe(probe)，Peer 的 probe 交给 Core，并经原 raw port.observe 转发。只有一个当前观察 slot；新登记替换旧登记，旧 disposer 不能清掉后来登记，即使复用同一个 probe。RTC 终止与 WebTransport 关闭释放观察者。探针失败走原 listener/report 通道，报告 TRANSPORT 并保留 cause，不改变业务和 sourceProof 路径。

每次物理发送及通过来源验证的接收同步 emit 一次。carrier 为 window/shared-worker/service-worker/broadcast-channel/rtc-data-channel/web-transport；不把被拒来源的载荷交给探针。detail 是复用对象，应立即消费或复制数值：origin 未知为空串，transfers 发送为列表长度、接收为 -1，rejectedSource 是自上次有效接收以来拒绝数，仅出现在下一次有效接收。

默认 capture 关闭，仅直接 byte backing/view 的 sizeBytes 可确定，字符串及容器为 -1。probe.capturing=true 时普通内容保留原引用；直接字节载荷的 backing buffer 确实在该次 transfer 中时，发送前复制将被 detach 的字节。嵌套 transferable 不遍历、不克隆，仍可能在原生转移后分离；不会为捕获执行 payload getter。Window/Worker/Broadcast 使用平台结构化克隆，RTC 使用物理 JSON 字符串，WebTransport 使用字节；Runtime payload 仍必须满足 Core 公共可移植值契约。

### 开发命令

包内脚本保留如下，列出不表示本次文档编辑独立运行：

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
pnpm run build
pnpm run typecheck:e2e
pnpm run test:e2e
```

test 沿用包现有 coverage 配置；浏览器 e2e 与 Node 示例证明不同环境的行为。Node 示例不能替代浏览器真实来源验证、Worker 生命周期、RTC 信令或 WebTransport 服务器验证。
