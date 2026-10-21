# `@migaia/rpc-browser`

为已有浏览器载体接入函数调用或原始消息收发，明确区分逻辑连接和原生资源的关闭责任。

## 你可能遇到过

- 手写请求编号与回包监听越来越多：方法调用和来源验证被混进消息处理器。
- 远端连续产出数据却只能等一大包结果：把流当成了单次请求。
- 发送后缓冲区突然长度为零：没有区分结构化克隆与显式转移。
- 一个监听器抛错后其他观察者没收到消息：分发循环没有隔离业务回调。
- 以为共享频道只发给指定页面：忽略了 BroadcastChannel 的一对多交付。

## 为什么选它

- **通过方法名调用远端，不再手写回包关联。** 连接模式下 createBrowserPeer 复用 Core 的真实握手与方法目录，request 取得远端结果，同时保留原生端口的调用方所有权，见[调用有类型的方法并只释放逻辑连接](./USEGUIDE.md#调用有类型的方法并只释放逻辑连接)。
- **逐项消费远端生成器，无需先收齐整个结果。** stream 从首次迭代开始使用已协商连接，标量调用与流调用各有明确入口，见[通过同一对端消费远端异步生成器](./USEGUIDE.md#通过同一对端消费远端异步生成器)。
- **把缓冲区转移选择留在发送调用处。** SharedWorker transport 将 transfer 列表交给真实端口，发送端分离和接收端字节都能直接检查，见[通过原生消息端口转移字节缓冲区](./USEGUIDE.md#通过原生消息端口转移字节缓冲区)。
- **一个业务监听器失败不截断其他监听器。** 载体通过 onListenerError 报告原异常，再继续向同一消息的其他订阅者交付，见[报告一个消息监听器的失败并继续交付其他监听器](./USEGUIDE.md#报告一个消息监听器的失败并继续交付其他监听器)。
- **把广播的多方接收语义显式保留下来。** BroadcastChannel transport 为同名频道分别订阅，一次发送可由多个接收方取得，见[把一条广播交付给两个频道参与者](./USEGUIDE.md#把一条广播交付给两个频道参与者)。

## 从这里开始

```ts doc-test=run
import { MessageChannel } from 'node:worker_threads'
import { createSharedWorkerTransport } from '@migaia/rpc-browser/adapters/shared-worker'

const { port1, port2 } = new MessageChannel()
const sender = createSharedWorkerTransport(port1)
const receiver = createSharedWorkerTransport(port2)
const received = Promise.withResolvers<unknown>()
const stop = receiver.subscribe(({ data }) => received.resolve(data))
sender.send('你好')
console.log(await received.promise)
stop()
port1.close()
port2.close()
```

输出：

```text
你好
```

需要函数调用看[有类型的方法](./USEGUIDE.md#调用有类型的方法并只释放逻辑连接)，需要广播看[多个接收方](./USEGUIDE.md#把一条广播交付给两个频道参与者)。

## 手写时的隐患

下面用原生端口写同一条消息收发，只展示、不执行；手工解绑需要保留原回调身份，并区分消息登记与端口所有权。

```ts doc-test=check
import { MessageChannel } from 'node:worker_threads'

const { port1, port2 } = new MessageChannel()
const received = Promise.withResolvers<unknown>()
port2.on('message', (data: unknown) => received.resolve(data))
port1.postMessage('你好')
console.log(await received.promise)
port2.off('message', (data: unknown) => received.resolve(data)) // 隐患：新建函数不是原回调，无法移除原登记。
port1.close() // 隐患：逻辑解绑与物理关闭绑在一起，无法继续借用端口。
port2.close()
```

上一节用 subscribe 返回的独立退订函数释放消息登记，原生端口仍由调用方关闭；需要握手、方法目录和请求结果时再使用 createBrowserPeer。

## 三分钟心智模型

先决定需要“调用函数”还是“直接收发消息”，再选择载体。Peer 是 Core 已握手的逻辑连接；transport 是原生消息接口；borrowed 表示只借用、不替创建者关闭。

| 问题 / 术语              | 工具                            | 白话含义                              |
| ------------------------ | ------------------------------- | ------------------------------------- |
| 等待一个业务结果 / Peer  | createBrowserPeer → request     | 双方同时握手，按方法目录调用          |
| 连续结果 / stream        | peer.stream → for await         | 逐项消费，提前退出交回清理            |
| 已有消息端口 / transport | createSharedWorkerTransport     | 包装实际端口，保留 transfer 选择      |
| 多方更新 / broadcast     | createBroadcastChannelTransport | 同名频道向多个参与者交付              |
| 释放责任 / borrowed      | stop / close → native close     | 退订逻辑登记，再由 owner 关闭原生载体 |

## 典型场景

| 场景                                         | 怎么组合                                         | 详细说明                                                               |
| -------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| 调用有类型的方法并只释放逻辑连接             | `connect.sharedWorker.port → request → close`    | [完整示例](./USEGUIDE.md#调用有类型的方法并只释放逻辑连接)             |
| 通过同一对端消费远端异步生成器               | `provide(generator) → stream → for await`        | [完整示例](./USEGUIDE.md#通过同一对端消费远端异步生成器)               |
| 通过原生消息端口转移字节缓冲区               | `send(buffer,{transfer}) → subscribe → stop`     | [完整示例](./USEGUIDE.md#通过原生消息端口转移字节缓冲区)               |
| 报告一个消息监听器的失败并继续交付其他监听器 | `onListenerError → subscribe → dispatch`         | [完整示例](./USEGUIDE.md#报告一个消息监听器的失败并继续交付其他监听器) |
| 把一条广播交付给两个频道参与者               | `BroadcastChannel(name) → subscribe × 2 → send`  | [完整示例](./USEGUIDE.md#把一条广播交付给两个频道参与者)               |
| 独立退订一个监听器并保留原生频道             | `subscribe × 2 → stopOne → stopTwo → native I/O` | [完整示例](./USEGUIDE.md#独立退订一个监听器并保留原生频道)             |

## 安装

```bash
pnpm add @migaia/rpc-browser @migaia/rpc-core
```

Node 示例使用内置 MessageChannel/BroadcastChannel，无需额外包；浏览器载体仍须由应用提供实际窗口、Worker、RTC 频道或 WebTransport 会话。

## 常用 API

| API                                        | 用途                                      |
| ------------------------------------------ | ----------------------------------------- |
| `createBrowserPeer(options)`               | 在受支持的一对一载体上取得 Core Peer      |
| `createWindowMessageTransport(options)`    | 直接包装指定窗口与接收窗口                |
| `createSharedWorkerTransport(port)`        | 直接包装实际消息端口                      |
| `createBroadcastChannelTransport(channel)` | 参与同名频道的一对多消息交付              |
| `createServiceWorkerTransport(options)`    | 分开配置 ServiceWorker 的发送与接收 owner |
| `createRtcDataChannelTransport(channel)`   | 直接包装已建立的 RTC 物理字符串通道       |

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

表中的 `source` 标识浏览器错误的归属；本包公开 API 的导入路径是 `@migaia/rpc-browser`。

| 本包 code（source=`@migaia/rpc/browser`） | 触发与处理                                                      |
| ----------------------------------------- | --------------------------------------------------------------- |
| WINDOW_ORIGIN_REQUIRED                    | Window Peer 缺少非空 origin；填写明确对端源                     |
| RTC_CHANNEL_UNRELIABLE                    | Peer 的频道不是可靠有序；改用受支持配置                         |
| LISTENER_ALREADY_BOUND                    | SharedWorker scope 已有监听器；先关闭旧监听器                   |
| INVALID_PEER_SOURCE                       | connect/listen 冲突或来源不支持；恰选一个真实来源               |
| MESSAGE_DECODE_FAILED                     | Peer 的 RTC JSON 无法解码；检查对端物理输入，cause 保留解码原错 |

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
