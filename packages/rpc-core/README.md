# `@migaia/rpc-core`

把异步消息变成可关联答复、可设置期限并能协作取消的调用，保持传输资源的关闭责任明确。

## 你可能遇到过

- 后发请求先返回，却唤醒了前一个等待者：只按方法名或单个当前请求槽匹配答复。
- 同名方法被另一条初始化路径悄悄替换：登记表直接覆盖，没有冲突准入。
- 组件卸载时连共享通道一起关闭：订阅的生命周期和物理资源归属混在了一起。
- 某次调用的期限变化影响了其他请求：只改共享配置，没有逐次调用选项。
- 页面已离开，远端任务仍占用资源：只拒绝本地等待，没有把取消通知交给处理方。

## 为什么选它

- **并发答复仍回到各自请求。** 每次 send 使用独立的操作身份关联结果，见[让并发答复回到各自的请求](./USEGUIDE.md#让并发答复回到各自的请求)。
- **当场发现重复方法登记。** provide 拒绝同名处理函数并保留原登记，见[拒绝重复登记，并保留原处理函数](./USEGUIDE.md#拒绝重复登记并保留原处理函数)。
- **把端点释放与物理通道关闭分开。** Endpoint 遵循实际 transport 的 owned/borrowed 归属，见[释放端点，同时保留借入的传输通道](./USEGUIDE.md#释放端点同时保留借入的传输通道)。
- **只为选中的调用覆盖等待期限。** timeout 中间件的默认值可被单次 timeoutMs 覆盖，见[只覆盖某次请求的继承期限](./USEGUIDE.md#只覆盖某次请求的继承期限)。
- **让运行中的处理函数收到协作取消。** abort 将调用方取消传给对应 context.signal，见[让已经运行的处理函数协作停止](./USEGUIDE.md#让已经运行的处理函数协作停止)。

## 从这里开始

```ts doc-test=run
import { connect, createEndpoint } from '@migaia/rpc-core'
import { createMemoryTransportPair } from '@migaia/rpc-core/adapters/memory'

const [left, right] = createMemoryTransportPair()
const server = await createEndpoint({
  id: 'server',
  transport: right,
  middlewares: [connect({ transport: right })]
})
server.provide('double', (context) => context.success((context.data as number) * 2))
const client = await createEndpoint({
  id: 'client',
  targetIds: ['server'],
  transport: left,
  middlewares: [connect({ transport: left })]
})
console.log(await client.send<number>('server', 'double', 21))
await client.dispose()
await server.dispose()
left.close()
```

输出：

```text
42
```

下一步：答复乱序看[并发请求关联](./USEGUIDE.md#让并发答复回到各自的请求)，页面离开后要收尾看[远端协作取消](./USEGUIDE.md#让已经运行的处理函数协作停止)。

## 手写时的隐患

下面用原生发送回调与接收函数表示同一请求任务，只展示、不执行；行内标出请求关联和释放的隐患。

```ts doc-test=check
let pending: ((value: unknown) => void) | undefined
function request(send: (value: unknown) => void, value: unknown) {
  return new Promise<unknown>((resolve) => {
    pending = resolve // 隐患：第二个请求会覆盖第一个等待者。
    send(value)
  })
}
function receive(value: unknown) {
  pending?.(value) // 隐患：没有操作标识，无法区分并发答复。
} // 隐患：没有取消与关闭入口，未完成等待无人负责。
void request
void receive
```

## 三分钟心智模型

先选择调用层次，再把真实载体交给它；登记处理函数后发送请求，最终释放调用层和自己拥有的物理资源。

| 术语                  | 含义                               | 对应工具                                      |
| --------------------- | ---------------------------------- | --------------------------------------------- |
| 载体（transport）     | 实际传送消息的对象                 | 内存、MessagePort 或平台适配器                |
| 端点（Endpoint）      | 按目标 id 与方法名关联请求答复     | createEndpoint / connect / provide / send     |
| 对端（Runtime Peer）  | 交换方法目录、按路径调用的高层连接 | remote 入口；平台包基于它组装                 |
| 处理上下文（context） | 本次调用的数据、取消信号与结算入口 | data / signal / success / failed              |
| 拥有 / 借用           | 决定谁关闭底层资源                 | owned / borrowed，Endpoint 不擅自接管借用资源 |

## 典型场景

| 场景                             | 怎么组合                                               | 详细说明                                                   |
| -------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| 通过一对内存端点调用实际处理函数 | `createMemoryTransportPair → connect → provide → send` | [完整示例](./USEGUIDE.md#通过一对内存端点调用实际处理函数) |
| 让并发答复回到各自的请求         | `provide(async) → send × 2`                            | [完整示例](./USEGUIDE.md#让并发答复回到各自的请求)         |
| 拒绝重复登记，并保留原处理函数   | `provide → duplicate rejection → send`                 | [完整示例](./USEGUIDE.md#拒绝重复登记并保留原处理函数)     |
| 释放端点，同时保留借入的传输通道 | `dispose → transport.close`                            | [完整示例](./USEGUIDE.md#释放端点同时保留借入的传输通道)   |
| 只覆盖某次请求的继承期限         | `timeout → send(timeoutMs)`                            | [完整示例](./USEGUIDE.md#只覆盖某次请求的继承期限)         |
| 让已经运行的处理函数协作停止     | `abort → send(signal) → context.signal`                | [完整示例](./USEGUIDE.md#让已经运行的处理函数协作停止)     |

## 安装

```bash
pnpm add @migaia/rpc-core @migaia/rpc-contract
```

## 常用 API

| API                       | 用途                       |
| ------------------------- | -------------------------- |
| `createEndpoint(config)`  | 在真实载体上组装双向端点   |
| `connect(config)`         | 绑定载体并处理目标发现     |
| `endpoint.provide / send` | 登记处理函数并等待对应答复 |
| `timeout(config?)`        | 配置默认期限，允许单次覆盖 |
| `abort()`                 | 通知远端处理函数协作取消   |
| `endpoint.dispose()`      | 释放端点订阅和在途调用     |

## 契约细节

### 分层、安装与入口

本包拥有运行时中立的 RPC 调用、路由、取消、期限、准入、错误还原与生命周期语义，不创建操作系统进程或 Worker，也没有 node: 导入。Coroutine 使用受支持宿主的全局 MessageChannel，在当前事件循环运行。Process、Threads、Browser 等平台包依赖这一内层，线上格式归 rpc-contract。

安装时显式添加 @migaia/rpc-core 与其 peer 依赖 @migaia/rpc-contract；不要把工作区当前同版本误读为运行时的版本相等校验。其余直接依赖为 event-subscriber、lifecycle、plugin-host、serialize、supervision、utils。Node 引擎要求 >=18。运行时/平台工厂的具体可用性仍取决于宿主能力。

| 入口                                                           | 用途                                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 根入口                                                         | createEndpoint（即 createFullEndpoint）、createFullOneWayEndpoint、中间件、错误守卫与幂等存储 |
| ./remote                                                       | Runtime Peer、受管理 Peer、Runtime/Coroutine 插件、契约、出口和事件                           |
| ./testing                                                      | createPeerPair，在真实内存载体上组装两个原 Peer，不是 Endpoint 替身                           |
| ./client / ./provider / ./full / ./composed                    | 客户端、提供方、双向与显式 Feature 组合工厂                                                   |
| ./features/outbound / one-way / provider / discovery / control | 为组合工厂选择根能力                                                                          |
| ./stream                                                       | 流式与分片功能                                                                                |
| ./adapters/memory                                              | createMemoryTransportPair                                                                     |
| ./adapters/message-port                                        | Node 与浏览器 MessagePort transport                                                           |
| ./adapters/web-worker                                          | Dedicated Worker / self transport                                                             |
| ./plugins/log / send-queue / flow-control                      | 可选诊断与发送策略中间件                                                                      |
| ./transport-kit / ./transport-constants                        | 自定义载体的工具、平台/拓扑/归属值                                                            |
| ./adapter                                                      | defineMessageAdapter / defineByteAdapter，适配器作者的任务级定义                              |
| ./adapter/internal-advanced                                    | 原生 Process、Threads、Bridge 需要的低级接入，不是常用起点                                    |
| ./probe                                                        | 同步观察、阶段常量、快照、采样和 Endpoint 安装                                                |

| 应用任务                                       | 入口选择                                               |
| ---------------------------------------------- | ------------------------------------------------------ |
| 子进程、本机进程或 Python/Go/Rust 服务         | rpc-process                                            |
| Worker 线程                                    | rpc-threads                                            |
| 当前进程内受监督任务                           | remote 的 createCoroutinePlugin                        |
| iframe、SharedWorker、可靠有序 RTCDataChannel  | rpc-browser 的 createBrowserPeer                       |
| 标签广播、ServiceWorker、WebTransport datagram | rpc-browser transport 加本包 Endpoint                  |
| 已有 MessagePort 或 Dedicated Worker           | 本包 adapters/message-port 或 adapters/web-worker      |
| 新平台、新物理 I/O                             | 本包 adapter；测试内对端可用 testing 的 createPeerPair |

发布保留 dist 与 schema，以及以上 24 个实际导出路径；根入口源码归 core/index，而不是顶层 index。按需工厂限制所装能力，实际产物由构建器决定，不写未经测量的体积或速度承诺。

### Endpoint：按目标与方法路由

Endpoint 适合已有 transport 的调用方；它用目标 id 和方法名路由，不自动交换 Runtime 方法目录。createEndpoint(config) 异步完成中间件安装后返回实际 Endpoint，调用方负责 dispose。

| 构造字段                        | 含义                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| id                              | 必填，无默认；非空本端稳定标识                                        |
| targetIds                       | 默认 []；已知目标去重并排除本端 id，自动发现可再解析目标              |
| transport                       | 可由 factory 或 connect 提供同一个实际载体，无内置物理资源默认        |
| middlewares                     | 必填中间件元组，构造时原子安装                                        |
| features                        | 可选有限元组，同步 Feature 组合                                       |
| scheduler                       | 默认 systemScheduler；单调时钟，Endpoint 期限与内部 Host 使用同一实例 |
| wallClock                       | 默认宿主墙钟，仅用于 wire sentAt、hook at 等诊断                      |
| providerLimits                  | 入站额度与拒绝观察                                                    |
| replay                          | 出站消息标识保留策略                                                  |
| construction.signal / timeoutMs | 取消安装或设置安装期限，timeoutMs: false 不设期限                     |

完整工厂提供 send、provide、discovery、control 等默认根，ping/pingAll 的公开类型仍由选中的 ping 中间件决定。createClientEndpoint 只发起调用；createProviderEndpoint 提供方法并保留出站调用；createFullEndpoint 双向；createComposedEndpoint(config, roots) 显式选择 Feature 根。createFullOneWayEndpoint 等 one-way 预设增加 sendOneWay，其 Promise 只表示物理发送，不表示业务完成。

provide(method, handler) 返回 Endpoint，可链式注册；重复方法拒绝，不覆盖旧 handler。handler 通过 context.data 读取输入，通过 context.success(value) 或 context.failed(message, code) 结算；不完成会得到 PROVIDER_NOT_SETTLED，过期 context 的 success/failed 返回 ok:false 与 PROVIDER_CONTEXT_EXPIRED，应检查该返回值。

`send<T>`(target, method, data, options?) 等待结果，前三参数必填，无载荷时传 null。sendAll(method, data, options?) 对已知目标汇总 fulfilled/rejected；dispatch(target, method, data) 与 dispatchAll(method, data) 同步返回 void，不等待结果。根 Endpoint 没有 Runtime Peer 的 notify 方法。group/outcome 需要实际组合的能力；ping 需要中间件；on 和 hooks.on 订阅相应事件，返回的释放句柄不代替整个 Endpoint 的 dispose。

send 的 options 可含 signal、timeoutMs、idempotencyKey、trace、transfer。未装 timeout 中间件时，Endpoint 使用 1000 毫秒 fallback；安装 timeout({}) 时未配置值为 undefined，反而不设期限，显式 timeoutMs: false 同样不计时。单次 timeoutMs: 0 在发送前拒绝，false 关闭默认；Runtime Peer 的 30000 毫秒是另一层默认，不能混用。abort() 接入远端取消通知，本地预先取消的 signal 即使没有该中间件也会拒绝。取消或超时不能证明对端没有执行。dispose 注销监听并拒绝在途等待；借用载体不会因此自动关闭，已产生的业务副作用也不回滚。

createRuntimeApiEndpoint(config, channel) 是高级 Runtime 组装入口，同步返回后先 await endpoint.ready。单参数形式限于 { binding }，必须提供完整、真实的 owned binding operations，不能交入假 Endpoint。其 facade 重复及同步重入 dispose 共用首次结算 Promise，底层只调用一次。

该高级配置还支持 protocol、codec、framer、provider、idempotency、providerLimits、replay、middlewares、features 与 construction；transport 接收 framer 的输出，codec 输出必须匹配 framer 输入。provider 在构造完成前登记，idempotency 只用于带键的调用，不自动把所有方法变成幂等操作。

### 中间件与扩展边界

| 中间件                                                                 | 参数与作用                                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| connect({ transport })                                                 | 连接与发现，按 sourceProof 过滤来源                                                                        |
| contract({ version, acceptVersions?, schemas?, maxIdentifierLength? }) | 业务版本与 schema；标识长度限制 discovery 的 targetId/receiverId/uniqueTargetId/variation id，不限制方法名 |
| protocol()                                                             | 标准协议帧                                                                                                 |
| codec(descriptor) / framer(descriptor)                                 | 选编码与分帧，必须匹配实际 transport                                                                       |
| abort()                                                                | 接入取消                                                                                                   |
| timeout({ timeoutMs })                                                 | 设置默认调用期限，可用单次 options 覆盖                                                                    |
| ping()                                                                 | 接入 ping / pingAll                                                                                        |
| authentication({ sign, verify, encrypt, decrypt, encodedType? })       | 逐帧认证/加密；encodedType 为 any/string/uint8array                                                        |
| hooks({ listeners, onHookError? })                                     | 观察生命周期，钩子错误走回调，不改变业务结果                                                               |
| uuid({ generate })                                                     | 自定义消息标识生成                                                                                         |

defineMiddleware / defineFeature 使用原 owner 扩展日志、诊断或策略；公开扩展不能自行引入新的协议级根能力。功能与中间件声明的字段不能冲突；两端编码、分帧和能力组合必须兼容。connect 的 discoveryMode 默认 automatic，可选 manual；useBaseIdVerifyOnly 仅显式 false 时才调用自定义 identifier，此时缺 identifier 拒绝 INVALID_CONFIG，uniqueTargetId 也只在该组合生效。construction.timeoutMs 省略或 false 均不设期限，内部 Host 的 mutation/drain 沿 construction.timeoutMs ?? false。构造失败会回滚已接纳资源，不留下可用的半安装 Endpoint。

### 载体、归属与调度

IRpcTransport 提供 send(message, options?)、subscribe(listener) 与可选 close，并声明 platform、可选 topology/ownership/encodedType/sourceProof/onTransportError/onListenerError。sourceProof 为多路载体提供来源证明；普通地址字符串不构成认证。ownership 省略按 owned 处理，表示关闭时释放底层；borrowed 只撤销自己的监听，物理资源由原 owner 关闭。

createMemoryTransportPair(options?) 默认 {}，返回两端而非单个 transport。双方都是 borrowed、exclusive 的同进程载体；关闭任一端会关闭整个 pair，之后 send 抛错。默认异步交付沿原生微任务顺序；传入 scheduler 只控制 pair delivery，不替代 Endpoint 自己的期限时钟。先 dispose 两 Endpoint，再由创建方 close pair。

createBrowserMessagePortTransport 的 ownership 默认 owned，可选 borrowed；后者只撤监听，端口由调用者关闭。createNodeMessagePortTransport 使用真实 Node 风格端口。createWebWorkerTransport 接收实际 Worker 或 self，capabilities 是静态约定列表，双方须一致；peerId 标识对端，这个低层载体不做握手。更具体的 window、广播、SharedWorker、ServiceWorker、WebRTC、WebTransport 场景由 rpc-browser 的载体或 Peer 负责。

transport-kit 复用监听器集合、失败收集/报告和安全属性读取，不应在各适配器中另造同一套 listener owner。手动时钟必须推进零时间工作，以执行 deferred reconciliation、departure 通知与策略关闭；旧的两方法时钟通过 schedule(callback, 0) 接收延后工作。默认 deadline 的 schedule(0) 语义不变，迟到回调仍检查关闭与报告边界。

### Runtime Peer 与方法目录

Runtime Peer 位于 Endpoint 之上，用 request/notify/stream/group/outcome 按点分方法路径调用，并在握手交换能力与方法目录。createRuntimePeer(options) 的 spawn/connect/listen 必须且只能有一个，Core 层均为回调；平台包才可提供对象式来源。

| Peer 字段                | 默认与约束                                                                   |
| ------------------------ | ---------------------------------------------------------------------------- |
| self                     | 可省略；显示名 peer 与生成的唯一 instanceId，显式值保持原样，name 不用于认证 |
| provide                  | 本端方法树，可省略                                                           |
| spawn / connect / listen | 来源回调收到 self 和真实编译 capabilities，返回已完成协议协商的实际 channel  |
| defaultTimeoutMs         | 30000；request/stream 使用的有限正数默认期限                                 |
| providerLimits           | maxPerPeer 64、maxGlobal 256，可用 onRejected 观察拒绝                       |
| authentication           | 可选，沿原认证 owner 配置签名 native transfer                                |
| contract                 | 可选模式、幂等声明与 schema                                                  |
| keyFactory / retryPort   | 可选键生成与重试端口                                                         |
| endpointFactory          | 可选高级组装，接收真实 channel 视图                                          |
| probe                    | 可选单个 Probe 或 readonly 数组                                              |
| report                   | 可省略，后台错误默认 console.error                                           |

provide 只读自身可枚举数据属性，嵌套普通对象生成 math.double 等点分路径。getter、循环、非法名字、重复路径在打开来源前拒绝。对端只能调用已协商目录。输入/返回值遵循可移植值域：JSON 值与协商后二进制，Date/Map/类实例等拒绝。没有 API 泛型时无静态可调用的方法；IRuntimeDynamicSurface 只放宽编译检查，运行时仍校验目录。流方法返回 IterableIterator 或 AsyncIterableIterator，类型才会被 stream 识别；IRuntimeSurface 从 Host/插件提取纯类型，不生成运行时代码。

| 方法                                | 完成与生命周期                                     |
| ----------------------------------- | -------------------------------------------------- |
| request(method, payload?, options?) | 等待结果                                           |
| notify(method, payload?, options?)  | 仅确认发出，不确认业务成功                         |
| stream(method, payload?, options?)  | 惰性，首次 next 才发送，提前 return 通知提供方停止 |
| group(steps, options?)              | steps 按序执行，首错后余项 not-executed，不回滚    |
| outcome(key)                        | pending/done/unknown；unknown 不证明未执行         |
| describe(options?)                  | 本地身份、连接与目录查询                           |
| close()                             | 拒绝新调用并关闭原 owner，重复返回同一 Promise     |
| on(event, listener)                 | 返回幂等取消订阅，不重放首次 ready                 |
| Symbol.asyncDispose                 | 原 close 函数本身，支持 await using                |

调用选项含 timeoutMs、signal、idempotencyKey、orderKey、cancel、transfer。request/stream 默认 30000 毫秒，单次 false 关闭默认、0 立即到期，并受来源单次上限约束；重试和等待下一代沿用同一个绝对期限，不在新代次重置。signal 为协作取消；cancel: 'before-start' 只撤销尚未开始的调用，已开始则保留真实结果。同 orderKey 在提供方串行。transfer 仅支持已协商的线程能力，不适用于普通内存 pair。

非法方法名、参数或选项可能在 Promise 返回前同步抛错，把整个调用表达式放进 try，而非只接 .catch。Peer 已经关闭、或它的代次已被停止和替换时，新调用会同步抛出 REMOTE_CLOSED；监督器正在启动下一代（例如 Worker 崩溃后正在重启）时，调用返回以 REMOTE_CLOSED 拒绝的 Promise，不会同步抛错。close 与事件不提供业务回滚，也不能把断线解释为调用未执行。

### Host 出口、安装与 Coroutine

createRuntimePlugin、createCoroutinePlugin 及平台插件安装到原 Plugin Host；同族连接共享 host.process/thread/coroutine，RuntimePluginKey 给出名称。request/notify/stream/group/outcome 先传连接名或 { name, instanceId } 精确目标，同名多实例不能唯一确定时拒绝。

list/get/describe 默认对象，查询可选文本格式；不可知事实用 unavailable，不伪造为 0。on 支持 ready/exit/degraded/restart/terminal/liquidated；watch 是有界异步迭代器，超过 100 个事件积压以 RUNTIME_EVENT_OVERFLOW 报告并结束，先用当前查询重新对账。broadcast 汇总各目标结果，不保证全部成功。

stop/kill/restart/replace 仅适用于真正由 spawn 或 coroutine task 创建的单元；对 connect/listen 借入连接拒绝 CAPABILITY_CONFLICT。expose 默认不公开本端 Host 方法，必须显式列出。本地 Feature expose 在安装未提交期间的调用等候原 Host batch commit；回滚以 TARGET_UNKNOWN 拒绝，不能把此保证扩展到 forward/catalog。ready 只代表目录可达，不是任意远端安装事务已完成的确认。

首次 ready 已包含 factory await，不向后来订阅重放。受监督 Peer 的后续 exit/restart/degraded 来自真实 supervisor，listener ready 来自实际接纳 session；raw Peer 不伪造原生 exit 或后续 ready。unsubscribe 不关闭执行单元；释放必须 close / await using，开始关闭时撤销事件订阅。

Coroutine 父模式 createCoroutinePlugin({ name, task, supervisor? }) 在同一事件循环监督 task，每代拥有 MessageChannel；子模式 { name, connect } 只接入该 task 收到的 opaque connect，不能传任意 MessagePort。task/connect 必须二选一，都可 provide/expose，expose 的本端 provider 须先安装。

task 收到 signal、heartbeat()、connect，自行在 finally 释放所创建子 Host。resolve 表示 exited，reject 表示 crashed，重启按 supervisor 策略。默认每插件占一个 coroutine 单元；replace(name, { task }) 更换下一代，非函数以 INVALID_CONFIG 拒绝而旧单元保留。取消靠 task 合作；忽略 signal 可延迟结束、预算租约保持到 settlement，阻塞事件循环的 task 无法强制终止。terminal 事件保留终止重启链的 source/code 与连接名，不用逻辑关闭伪装原生退出。

### 准入、重放与幂等结果

request/notify/stream 都占入站额度，默认每对端 64、全局 256。超限时业务函数不被调用；调用方只见 OVERLOADED，要区分并发或其它准入原因，用提供方 providerLimits.onRejected 的 RpcProviderRejectionReason。createProviderAdmissionScope 可让多个 Endpoint 共享原额度 owner，不以客户端在途数冒充提供方并发。

原生 Process/Threads launcher 证明的独占通道只记录在途调用，不套用普通载体的结果保留窗口。其它载体使用有界账本：出站每 Endpoint 默认 maxEntries 4096、ttlMs 310000；入站每对端 maxReplayEntriesPerPeer 1024、全局 4096，同样保留 310000 毫秒。它们限制保留窗口内的接纳总量，不能把 burst 能力或容量/TTL 推导当作实测吞吐量。

createRpcIdempotencyStore 默认 retentionMs 300000、maxEntries 1024、maxEntriesPerScope 256、maxBytes 8 MiB、maxOutcomeBytes 1 MiB，均为正安全整数。pending 不按 retention 自动过期；容量可保留结果不可用的 tombstone，outcome 因而可能 unavailable，而非重新执行。内存 owner 重启会丢状态，不保证跨重启连续性或无限期至多一次。

### 二进制、转发与重试边界

ArrayBuffer / Uint8Array 需要双方协商二进制；视图 offset/length 保留。inline 只携带可见字节，native 线程清单保留全 backing 并验证摘要；SharedArrayBuffer、Atomics 与其它 TypedArray 不属于支持路径。transfer 在真实提交后分离 buffer，失败也不能恢复，不保留输入副本且不自动重试；签名认证/能力不满足以 CAPABILITY_UNSUPPORTED 拒绝，不降级成复制。

expose 可让第三方经插件转发已接纳连接的方法前缀；每跳绑定当时目标代次，最多三跳，环路/超限拒绝，中继不缓存业务结果。最终提供方认证的是直接上一跳，而不是最初调用者。

超时、取消、断线、连接恢复、unknown 都不能证明业务未执行。仅有独立未执行证据时（如明确并发拒绝或成功的 before-start 撤销）才可直接重试；其余通过同 idempotencyKey 查 outcome 或业务对账。不要通过换键重发逃避未知结果，总预算与退避由调用者控制。

### 为真实物理 I/O 定义适配器

defineMessageAdapter({ open, launch? }) 的 open 取得真实端口，可选 launch 执行原启动操作；结果创建独立 peer 或 host.thread 插件。defineByteAdapter({ open, listen?, dial? }) 接入有序字节 I/O，生成 Peer 或 host.process 插件。它们不接受成品 Peer、channel、已协商能力、可信身份或自称 ownership 的替身。

消息 Peer 创建方保有借入端口的物理关闭责任；字节 I/O 提供真实 write/onData/onClose/close，Core 沿同一握手、分帧、能力与目录 owner 完成连接。launch 返回原生端口、exited、terminate；冷启动取消、握手失败或关闭由原 termination-once owner 释放，不重造 supervisor。平台 managed 来源仍使用既有监督/代次 owner。

governor 沿原 rate/payload/连续超时/idle 策略，disposer 归实际连接 close。adapter.scope(store?) 创建 provider scope，共享者须等所有 Peer 关闭后 scope.close。会话幂等范围依赖从实际认证连接捕获的 principal，普通地址字符串无此权限；字节 responder 须由实际 auth.verify 建立认证身份。

字节 auth.verify 失败原对象通过本地 cause 和 report 保留，对端只收到净化拒绝摘要，不泄露验证器原链。第三方适配器使用 utils attachErrorIdentity 附自己的 source/code，保留原错在 cause，不冒充 Core/Contract 身份。

### 错误与归因

错误保留原生类型、message、stack 与 cause；错误形状用 IRpcError，平台/拓扑值域用 IRpcPlatformValue / IRpcTransportTopologyValue。按稳定 source/code 而非 message 分支，远端身份只作诊断，不授予本地控制权。

下表的 `source` 是错误的身份值，不是导入路径。Core API 从 `@migaia/rpc-core` 导入，Remote API 从 `@migaia/rpc-core/remote` 导入。

| source               | 常量 / 表                                         |
| -------------------- | ------------------------------------------------- |
| `rpc.endpoint`   | RPC_CORE_ERROR_SOURCE / RpcCoreErrorCode          |
| `rpc.remote` | RPC_REMOTE_ERROR_SOURCE / RpcRemoteLayerErrorCode |

isRpcErrorInstance / isRpcRemoteError / isRpcTimeoutError 按稳定字段跨 realm/副本判断，不能依赖 instanceof；isRpcError 只检查字符串 code，不能替代错误族守卫。RpcError、RpcRemoteError、RpcTimeoutError 等仅类型导出，唯一公开可构造类为 RpcLifecycleError，供持有自身释放状态的消费方使用。

| Core code                                                       | 处理含义                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| DEADLINE_EXCEEDED / CANCELLED                                   | TimeoutError / AbortError；结果可能未知，查账而非盲重试              |
| OVERLOADED                                                      | 准入拒绝，具体原因看提供方 onRejected                                |
| TRANSPORT                                                       | 载体失败，已送达与否需对账                                           |
| PROVIDER_NOT_FOUND / PROVIDER_DUPLICATED / PROVIDER_NOT_SETTLED | 路径缺失、重复登记、未结算                                           |
| PROVIDER_CONTEXT_EXPIRED                                        | 过期 context 结算返回 ok:false                                       |
| PAYLOAD_INVALID / SCHEMA_INVALID                                | 值域、尺寸、二进制或 schema 错误                                     |
| CONTRACT_INVALID / PROTOCOL_INVALID                             | 方法/模式/键或协议消息非法                                           |
| CAPABILITY_UNSUPPORTED / CAPABILITY_CONFLICT                    | 能力未协商或归属/实例有歧义                                          |
| INVALID_CONFIG                                                  | 配置非法，含不适用的 transfer                                        |
| TARGET_UNKNOWN / TARGET_NOT_IDENTIFIABLE                        | 无目标或同名实例不唯一                                               |
| ENDPOINT_DISPOSED                                               | 实例终结，需新建                                                     |
| AUTHENTICATION_FAILED                                           | 认证失败，先修会话/凭据                                              |
| STREAM_RESULT_UNKNOWN                                           | 已交付项以外的流结果未知                                             |
| IDEMPOTENCY_RESULT_UNAVAILABLE                                  | 业务已执行，结果未保留，不换键重执行                                 |
| PROVIDER_GENERATION_MISMATCH / PROVIDER_GENERATION_RETIRED      | 目标代次不符/退役，转发调用可能已执行                                |
| FORWARD_LOOP / FORWARD_HOP_LIMIT                                | 环路或超过三跳                                                       |
| MIDDLEWARE_DUPLICATED / MIDDLEWARE_MISSING                      | 组装重复或缺失                                                       |
| CHUNK_INVALID                                                   | 分片重组失败                                                         |
| PROPERTY_READ_FAILED / STRING_CONVERSION_FAILED                 | 属性访问或转字符串失败，保留原因                                     |
| CALLBACK_FAILED                                                 | 冷 Probe listener、中间件安装或 reporter 失败，检查 cause / 宿主队列 |
| INTERNAL                                                        | 内部失败，不默认重试                                                 |

认证 reason 为 RpcAuthenticationRejectionReason.sessionUnknown（重新发现会话）或 challengeInvalid（修正帧）。手动 connect.query 取消保留原生 DOMException/AbortError，CANCELLED 的 cause 指向 signal.reason。Core serializeRpcError/deserializeRpcError 还保留本层脱敏与转发路由元数据；树结构与 JSON-RPC 映射由 rpc-contract 拥有。

| Remote code             | 处理含义                            |
| ----------------------- | ----------------------------------- |
| REMOTE_START_FAILED     | 来源/握手失败，检查 cause           |
| REMOTE_CLOSED           | 连接/代次已关，不自动转投同名后继   |
| REMOTE_RESULT_UNKNOWN   | 业务可能已执行，outcome 或对账      |
| REMOTE_CONTRACT_INVALID | 目录或契约非法                      |
| REMOTE_HOST_NOT_ADOPTED | 先完成对应 hostUse                  |
| RUNTIME_EVENT_OVERFLOW  | 超过 100 条积压，查当前状态后重订阅 |

owned supervisor 即使 Endpoint 释放失败，仍尝试关闭 channel 与原生资源；primary 沿 cause/errors 可达。迟到物理发送拒绝仍被观察；用户 reporter 自身 throw 经既有宿主异常队列可见，不制造未处理 reaction Promise。

### Probe：同步观察与保留边界

Probe 从 ./probe 导入，不改变请求/结果的业务路径。导出阶段、方向、kind、outcome 的数值常量与同序名称表，以及 defineProbe、snapshotProbeEvent、rpcProbeSampleKey、probePlugin、readProbeStages、subscribeProbeStages、既有 hostRethrowReporter / IpcReporterContext。Peer 传 probe，Endpoint 激活前安装 probePlugin，两者使用同一 emitter。

defineProbe(definition, host?) 定义时验证 stages 非空且为已知名称；capture 默认关闭且须为 stages 子集；sample 默认全采样，范围 (0, 1]；methods 只过滤 message/envelope 中的方法，没有 method 的 variation 通过该过滤，其它阶段只受采样。redact 处理显式捕获，不打开未选择 capture；describe/emit/onError 分别负责描述、同步消费与错误报告。定义错误保留 TypeError / INVALID_CONFIG。

省略 host 返回独立冻结 handle；提供 host 则直接添加 stageMask/captureMask/methods/sampleThreshold/setStages 五字段，以原对象身份登记并冻结，返回 THost & IRpcProbe，不复制。host 必须可扩展、未冻结、非 null，不能已有这些字段或已注册为 Probe；验证先于修改，失败保持原样。已有 host.emit 不被替换，definition.emit 由私有状态持有。

每 emitter 复用事件 view，只能在同步 emit 中读取。snapshotProbeEvent 显式复制并冻结顶层，detail/error/content 仍保留原引用与所有权，不是深快照。未知 sizeBytes/chunk/members/durationMs 使用 -1；字符串和 opaque 容器的 sizeBytes 恒为 -1，不为观察而额外编码/扫描。已有字节 backing/view 长度直接读取；nested transferable 不遍历 getter、不深扫描/复制，可能在真实 transfer 后分离，直接捕获且将分离的 backing/view 才保存字节。

protected 只在真实认证路径存在且显式 capture 时出现，不伪造事件。setStages([]) 暂停，设置已知阶段可恢复，captureMask 保持定义值；host.stageMask 是初始值，独立 handle getter 反映私有当前值。readProbeStages 读有效 mask，subscribeProbeStages 只在实际改变后通知，返回幂等释放；无效阶段以 INVALID_CONFIG 保持旧值。冷 listener 抛错时先通知其余监听、使 emitter 采用新 mask，再传播 CALLBACK_FAILED。

emit、redact、describe 的 throw/reject 通过 onError 报 PROBE_FAILED，cause 保留原错，无回调则用宿主 reporter，不进入业务管线。激活后交付一次 descriptor，只有载体实际提供 observe 才调用，disposer 归原资源 scope；关闭后停止事件。managed spawn 与 Process/Thread/Browser/pool 均沿原 Probe 引用，不以观察重造生命周期。

variation 字段保留原 route.variation，含 ping/pong/close/abort 和已登记 subtype；abort kind 为 cancel，其余为 control，request/response 等无 variation。rpcProbeSampleKey 对 senderId/messageId 拼接的 UTF-8 计算 FNV-1a 32 位键，是采样关联，不是认证或唯一身份。

carrierSeq 是同一 emitter 的 inbound carrier 序号，无关联时 -1；Core receive 捕获它并随原物理记录经过异步 unprotect/decode。collector 按原 Endpoint/source 序号转为全局 wire 序号；已淘汰的未解析 origin 不能恢复，已读链接在 dependent 行保留时仍有效，source 序号重置为旧 origin 留 cutoff，防止误连新行，不在摄取时新增代次历史。

outbound carrier 借用本次 send 的 envelope（messageId/senderId/targetId/trace），同步返回后清空；仓库载体同步 emit，第三方跨异步间隙 emit 没有该 context。physical batch 只取首个实际成员代表，不展开业务内容。Byte carrier 在实际交付前发出，启动排队帧以交付时间各发一次，关闭/溢出前未交付帧不发业务事件；复用 detail 的 frameBytes 表示跨度，drainMs 初值 -1，真实 writer false/drain 后更新，不改变原 write 结算，也不补异步事件。

观察保留 fast/native/batch/chunk 选择：descriptor 可含 frame，fast send 不伪造 frame；认证 descriptor 读取 sign 或 encrypt-sign。解密前缺 sender/message 身份，无法保证与后续阶段同采样键；多块匿名记录不猜测身份，仅最后解码块可经 carrierSeq 关联。Native Peer 调用选项不带 trace，应用在自己的 Endpoint.send 显式传已有 trace。
