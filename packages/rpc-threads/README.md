# `@migaia/rpc-threads`

把函数调用交给真实 Worker 执行，通过一套双向请求与流接口管理结果、重启和关闭。

## 你可能遇到过

- **Worker 卡住了，调用一直等不到结果。** 输入太大、算法陷入死循环，或者用户已经取消，主线程的 Promise 却一直 pending，只能自己拼超时和取消消息。[示例](./USEGUIDE.md#调用卡住时按期限失败或中途取消)
- **Worker 崩溃后，等待中的调用永远等不到回复。** 线程已经退出，没人去拒绝那些还在等的 Promise。[示例](./USEGUIDE.md#worker-崩溃时进行中的调用立即失败)
- **Worker 抛出的错误到了主线程，`code` 不见了。** 自定义错误变成普通 `Error`，没法按错误类型处理。[示例](./USEGUIDE.md#错误类名code-和-cause-跨-worker-原样返回)
- **请求高峰时，消息在 Worker 队列里越堆越多。** 每个调用等得越来越久，内存一起上涨，调用方却看不出 Worker 已经过载。[示例](./USEGUIDE.md#worker-忙不过来时直接拒绝超额调用)
- **Worker 要回调主线程、或要逐项返回结果。** 只好另建一套消息类型和路由，再维护一遍请求和回复的对应关系。[示例](./USEGUIDE.md#通过同一连接反向调用父端并消费-worker-结果)

## 为什么选它

常见做法是给 `postMessage` 加一层请求编号，或者用把 Worker 包装成代理对象的轻量封装，把调用写成 `await api.method()`。它们让调用看起来像本地函数，却不管调用出了问题之后怎么办。本包补上的正是这一段：

- **卡住的调用会到期，也能随时取消。** 常见封装只在 Worker 回复时 resolve，超时和取消都要自己拼。这里每次调用默认有 30 秒期限，可以用 `timeoutMs` 单独设置，也可以传入 `AbortSignal`；到期或取消时分别以带 `code` 的 `TimeoutError`、`AbortError` 拒绝。[示例](./USEGUIDE.md#调用卡住时按期限失败或中途取消)
- **Worker 崩溃，进行中的调用立刻失败。** 常见封装要你自己监听 `exit`，再逐个拒绝还在等的调用。这里连接一断，未完成的调用就以 `REMOTE_RESULT_UNKNOWN` 拒绝，明确告诉你“结果未知，先对账再重试”。[示例](./USEGUIDE.md#worker-崩溃时进行中的调用立即失败)
- **错误原样回到主线程。** 结构化克隆会把自定义错误变成普通 `Error`，并丢掉 `code` 这类自定义字段。这里类名、`code` 和 `cause` 链都会还原，主线程可以继续按 `code` 分支。[示例](./USEGUIDE.md#错误类名code-和-cause-跨-worker-原样返回)
- **忙不过来时直接拒绝，不无限排队。** 常见封装把消息全部塞进 Worker 的队列。这里同时执行的调用数有上限，超出的调用立即以 `OVERLOADED` 拒绝，提供方函数不会执行，调用方可以马上限流或降级。[示例](./USEGUIDE.md#worker-忙不过来时直接拒绝超额调用)
- **双向调用和流共用一条连接。** 两端都能提供方法、发起调用；返回异步生成器的方法用 `stream()` 逐项读取，不用另建消息路由。[示例](./USEGUIDE.md#通过同一连接反向调用父端并消费-worker-结果)

什么时候不需要它：只是偶尔把一段计算交给 Worker，不在乎超时、崩溃和过载时，原生 `postMessage` 更简单。需要进程级的权限或故障隔离时，用 [rpc-process](../rpc-process/README.md)。

## 从这里开始

先安装本包及 Core、Contract 两个 peer，保存为 ESM 项目的 overview.ts，用 Node 24 直接运行；整个入口会在 Worker 中再次执行。

```bash
pnpm add @migaia/rpc-threads @migaia/rpc-core @migaia/rpc-contract
```

```ts doc-test=run
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

if (await isThreadChild()) {
  await createThreadPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  const worker = await createThreadPeer<{ double(value: number): number }>({ spawn: true })
  try {
    console.log(await worker.request('double', 21))
  } finally {
    await worker.close()
  }
}
```

输出：

```text
42
```

需要复制或转移字节时看[未签名的 RPC 转移被拒绝后仍可使用原字节](./USEGUIDE.md#未签名的-rpc-转移被拒绝后仍可使用原字节)，需要重启后立即调用时看[Host 报告重启就绪后立即调用新 Worker](./USEGUIDE.md#host-报告重启就绪后立即调用新-worker)。

provide.double 接收数值参数；spawn: true 选择当前入口，父端 finally 关闭自己拥有的 Worker。短来源默认容量 1、systemScheduler、best-effort 隔离和 30000 ms 调用期限；未设置 self 使用自动身份，未设置 report 使用默认诊断输出。

## 手写时的隐患

仅展示同一“发数值、取计算结果”场景，不运行：

```ts doc-test=check
import { Worker } from 'node:worker_threads'

const source = `
  import { parentPort } from 'node:worker_threads'
  parentPort.on('message', (value) => parentPort.postMessage(value * 2))
`
const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(source)))
worker.once('message', (value) => console.log(value)) // 没有请求标识，并发结果难以对应
worker.postMessage(21) // 没有调用期限或取消路径
void worker // 未安排最终释放，Worker 可能继续存活
```

上一节用 request 关联一次调用及其结果，并在 finally 中关闭拥有的 Worker；child guard 则避免当前入口在子线程中再次派生。原生片段只展示隐患，不运行。

## 三分钟心智模型

| 需要解决的问题      | 使用工具                         | 谁负责释放                           |
| ------------------- | -------------------------------- | ------------------------------------ |
| 一个独立 Worker     | createThreadPeer + spawn         | Peer 创建者 await close。            |
| Worker 反向调用     | 父端 provide + 子端 request      | 同一个 Peer 连接。                   |
| 多个结果逐项到达    | stream + iterable provider       | 消费方结束迭代，最后关闭 Peer。      |
| Host 管理重启与替换 | createThreadPlugin + host.thread | Host。                               |
| 已有 MessagePort    | connect + channel                | 连接只退订，原生端口仍由调用方关闭。 |

**Peer** 是持有一条逻辑连接的调用对象；**代次** 是一次启动得到的 Worker 实例；**能力提案** 是本地愿意支持的协议标签，双方实际确认后才可用；**预算** 限制同时存活的 Worker，不是 CPU 计时。

## 典型场景

| 场景                                       | 怎么组合                                                    | 详细说明                                                             |
| ------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| 在真实 Worker 上执行任务并区分线程与进程   | isThreadChild → createThreadPeer → request → close          | [完整代码](./USEGUIDE.md#在真实-worker-上执行任务并区分线程与进程)   |
| 通过同一连接反向调用父端并消费 Worker 结果 | provide → request / stream → close                          | [完整代码](./USEGUIDE.md#通过同一连接反向调用父端并消费-worker-结果) |
| 未签名的 RPC 转移被拒绝后仍可使用原字节    | request → transfer admission → request                      | [完整代码](./USEGUIDE.md#未签名的-rpc-转移被拒绝后仍可使用原字节)    |
| Host 报告重启就绪后立即调用新 Worker       | createThreadPlugin → host.use → restart → request → dispose | [完整代码](./USEGUIDE.md#host-报告重启就绪后立即调用新-worker)       |
| 关闭借用通道后继续使用原生端口             | channel → subscribe → close → native postMessage            | [完整代码](./USEGUIDE.md#关闭借用通道后继续使用原生端口)             |
| 真实原生转移后保留捕获字节并替换观察回调   | observe → send(transfer) → replace / stop                   | [完整代码](./USEGUIDE.md#真实原生转移后保留捕获字节并替换观察回调)   |

## 安装

```bash
pnpm add @migaia/rpc-threads @migaia/rpc-core @migaia/rpc-contract
```

Node 24 可直接运行本页真实 .ts 文件；发布的 Node engine 下限为 >=18，不代表所有版本都有 Node 24 的类型剥离能力。浏览器入口需使用已构建的模块 URL。两个底层通道场景直接导入 utils，Host 场景直接导入 PluginHost，按需另装：

```bash
pnpm add @migaia/plugin-host @migaia/utils
```

## 常用 API

| API                              | 什么时候用                            |
| -------------------------------- | ------------------------------------- |
| createThreadPeer                 | 独立持有一条 Worker 或已有端口连接。  |
| isThreadChild                    | self spawn 前先区分父子分支。         |
| peer.request / notify            | 单次结果或无需业务完成回执的调用。    |
| peer.stream                      | 逐项消费远端序列。                    |
| createThreadPlugin / host.thread | 把 Worker 安装、重启和替换交给 Host。 |
| peer.close / host.dispose        | 释放自己拥有的连接和 Worker。         |

## 契约细节

### 职责、安装与入口

本包创建 Worker、接入消息端口，并把 Worker 的预算、启动、重启和释放交给监督器。调用关联、目录、超时、取消、错误还原和重试归 Core；协议与便携值归 Contract。它适合把解析、压缩、图像处理等计算移出主线程，以及让 Host 统一管理多条 Worker 连接。

线程共享进程，不能代替独立进程的权限或故障隔离。需要独立进程时使用 [rpc-process](../rpc-process/README.md)；跨窗口、iframe、SharedWorker、可靠有序 RTCDataChannel 的 Peer 使用 [rpc-browser](../rpc-browser/README.md)，Service Worker 和 BroadcastChannel 使用该包的 Endpoint transport。SharedArrayBuffer / Atomics 共享内存不在本包支持范围内。

| 入口                                         | 内容                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `@migaia/rpc-threads`                        | Peer、Plugin、child guard、错误码、高级通道与 Web launcher，以及公开配置和 handle 类型。 |
| `@migaia/rpc-threads/adapters/node`          | `createNodeThreadLauncher`、`createNodeThreadChannelFactory`。                           |
| `@migaia/rpc-threads/adapters/electron-main` | `createElectronMainThreadLauncher`、`createElectronMainThreadChannelFactory`。           |

直接安装 Core 与 Contract 两个 peer 依赖；不以硬编码版本相等作为运行时规则。lifecycle、supervision、utils 是运行时依赖。Electron-main 入口另需可选 peer `electron: ^44.0.0`。示例直接导入 PluginHost 或 utils 时，也应直接安装相应包。

Web、Bun、Deno 和 Electron renderer 使用根入口的 `createWebThreadLauncher`、`createWebThreadChannelFactory`。`INodeThreadHandle`、`IWebThreadHandle`、`IWebThreadLauncherOptions` 和高级原生运行时类型从根入口导入。根入口还重新导出 Core 的 typed surface、查询、详情、列表、事件与 thread stop 类型；这些不是另一套调用协议。

### Peer 来源、类型与调用

`createThreadPeer<TRemote>(options, runtime?)` 返回 typed Peer。`TRemote` 默认 `Record<never, never>`，只约束调用端类型，不注册 Worker 方法。`IRuntimeDynamicSurface` 可以放宽静态路径检查，运行时仍以对端真实目录为准。默认本地身份为 `{ name: 'thread', instanceId: 自动生成值 }`；需要稳定地址时显式传 `self.name`、`self.instanceId`。

主线程可以指定短 `spawn`、完整 `spawn` 或 Core 的 `connect` / `listen` 来源；来源不能混用。库 launcher 创建的 Worker 内省略来源，由真实 Node parentPort / workerData 或 Web Worker bootstrap 自动连接父线程。单独执行普通 Worker 文件不会获得这种连接。`isThreadChild()` 只读取库的启动标记以区分父子分支，不为外部 Worker 授权，也不替代能力确认。

`provide` 缺省不暴露应用方法；自身可枚举数据属性中的函数形成方法，嵌套对象形成点分路径，不接受 accessor 作为方法声明。返回 iterable / async iterable 的方法通过 `stream` 调用。Worker 端也是 Peer，可反向调用父线程的 `provide`。

| 调用                                 | 用途与边界                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `request(method, ...args)`           | 等待一次结果，参数形式由真实目录与 typed surface 约束。                    |
| `notify(method, ...args)`            | 单向调用，不提供业务执行完成回执。                                         |
| `stream(method, ...args)`            | 逐项消费远端 iterable / async iterable；取消仍依赖远端配合。               |
| `group`、`outcome`、`describe`、`on` | 复用 Core 的分组、结果对账、目录和事件规则。                               |
| `close()`、异步释放协议              | 调用方释放独立 Peer；spawn 来源还释放它拥有的 Worker，借用来源只释放连接。 |

`defaultTimeoutMs` 缺省 30000，必须是正有限值，只用于 request / stream。单次 `timeoutMs` 可为非负有限值或 `false`；0 表示立即到期，false 关闭该次期限。全局并发默认 256，每个对端 64，通过 `providerLimits.maxGlobal`、`providerLimits.maxPerPeer` 调整；超额以 `OVERLOADED` 拒绝，不执行该次 provider。设置 `spec.limits.callWallTimeMs` 会进一步压低调用期限。

`signal` 是协作取消，超时、取消或断线都不能证明 Worker 尚未执行。非幂等写入先用业务标识对账；已声明幂等且仍保留结果的调用可结合 `idempotencyKey` / `outcome(key)`，不能把任意重试当作只执行一次。`report` 缺省 Core 的默认诊断输出（通常为 console.error）；它接收后台失败。`probe`、`contract`、`authentication`、`endpointFactory`、`keyFactory`、`retryPort` 延续 Core 各自 owner 的契约。

### 短 spawn、入口解析与监督默认值

| `spawn`                 | 含义                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `true`                  | 重新执行当前主入口的全部顶层代码；先 await child guard，把主线程副作用放在父分支。 |
| URL                     | 精确使用该 URL。                                                                   |
| 路径字符串              | Node / Bun / Deno 下相对主入口目录解析；绝对文件路径按文件 URL 编码。              |
| `{ entry, ...options }` | entry 接受 true、URL、字符串，可覆盖下表字段。                                     |

| 短对象字段                   | 省略值与用途                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `base`                       | 未设置；相对 entry 默认以主入口为基准，显式模块 URL / URL 字符串可改基准，不通过堆栈猜调用模块。                              |
| `name`、`data`、`limits`     | 未设置；传入 Worker spec。data 先经 normalizePortable 形成快照，失败在 Worker 构造前以 Core INVALID_CONFIG 拒绝并保留 cause。 |
| `scheduler`                  | systemScheduler；同一预算和默认 channel factory 使用它。                                                                      |
| `budget`                     | `createUnitBudget({ kind: 'thread', maxUnits: 1, scheduler })`。                                                              |
| `launcher`、`channelFactory` | 按真实运行时延迟加载；自定义 factory 必须使用同一个 scheduler。                                                               |
| `report`                     | 先取 source.report，再取顶层 options.report，最后 Core 默认 reporter。                                                        |
| `health`                     | 未设置；仅当 launcher 没有 enforced exit-observation 时，绑定补实际 Endpoint ping；显式 health 优先且保留引用。               |
| `supervisor.isolation`       | 短形式默认 `'best-effort'`；取值 `'required'` / `'best-effort'`。                                                             |
| `keyFactory`、`retryPort`    | 未设置；顶层同名配置优先于 source 字段。                                                                                      |

短形式只是展开已有完整 source，不允许自报“已经协商”或“已经信任”。监督字段继续由 supervision 校验和执行：

| 字段                                                          | 默认与取值                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `supervisor.id`                                               | 自动生成。                                                                                                               |
| `supervisor.ready`                                            | 未设置；可提供真实就绪检查。                                                                                             |
| `supervisor.startupTimeoutMs`                                 | 10000 ms。                                                                                                               |
| `supervisor.restart.mode`                                     | `'on-failure'`；另有 `'never'`、`'always'`。                                                                             |
| `supervisor.restart.maxRestarts` / `windowMs`                 | 5 / 60000 ms。                                                                                                           |
| `supervisor.restart.initialDelayMs` / `factor` / `maxDelayMs` | 250 ms / 2 / 30000 ms，有界指数退避。                                                                                    |
| `supervisor.terminalPolicy`                                   | 省略相当于 mode 为 stay，保持 terminal；另可选 mode 为 cooldown 并提供 afterMs 后重新尝试，terminal 不是“永远无法恢复”。 |
| `supervisor.stop.exitTimeoutMs` / `reapTimeoutMs`             | 各 5000 ms。                                                                                                             |
| `supervisor.stop.beforeTerminate`                             | 未设置；绑定先在剩余预算内排空当前调用，再调用自定义钩子。                                                               |

默认 RPC health 使用 5000 ms 间隔、2000 ms 单次上限、连续 3 次失败策略。Endpoint 尚未绑定时由原准备期限管理，绑定后只探测该 handle 的真实 Endpoint。显式去掉 ping 却未提供自定义 health 会以 INVALID_CONFIG 拒绝；健康检查不会把 unsupported 原生退出能力变成 enforced。

Node / Bun self spawn 保留运行时 flags；显式不同入口会过滤父进程的 eval、print、测试控制参数，保留 loader 等运行时 flags。REPL、eval、单文件二进制、Electron 和测试运行器等没有可复用主入口时，self spawn 以 INVALID_CONFIG 拒绝，不猜入口；显式可用入口不受“不能 self spawn”的推断限制。

Node 24 可剥离 .ts 类型，但不把相对 `./x.js` 重定向为 `./x.ts`；Bun 支持此映射。含这种 specifier 的工程在 Node / Deno 下使用构建输出或合适 loader，解析错误保留原 cause。浏览器只接受明确 URL，不接受 true / 裸字符串；动态 Worker 构造也不能替代 bundler 的字面量源码发现。应提供预构建模块 URL，或在自定义构造器内保留字面量 Worker 构造。Deno Worker 仍需相应宿主权限。

### PluginHost 与代次所有权

`createThreadPlugin(options, runtime?)` 复用 Peer 来源、provide 与认证配置，另需 `name`，`expose` 缺省为空数组：不向 Worker 暴露 Host 应用方法。只有明确选中的 Host 路径可见。安装后由 Host 持有连接和 Worker，经 `host.thread` 操作；直接 Peer 则由创建者关闭。

`host.thread.request` / notify / stream / group / outcome 的第一参数是连接名或 `{ name, instanceId }`。list / get 查询连接及当前代次，broadcast 返回每个目标的独立结果，on / watch 复用 Core 事件目录。stop / kill / restart / replace 仅用于 spawn 来源；连接来源不能据此终止外部 Worker。线程 stop 只接受 `{ graceMs }`，出现 signal 字段（即便 undefined）也拒绝。

restart 返回 ready、replace 返回 replaced 时，新代次已经发布进调用目录，可以立即调用，不需额外等待事件或自行退避。替换不会把已发往旧代次的业务自动迁移到新代次。Host 的 execution.mutationTimeoutMs 和 pipelineDrainTimeoutMs 必须显式配置，false 表示不设该预算。

### 二进制复制、签名与转移

| 输入或选项                          | 行为                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| ArrayBuffer / Uint8Array            | 默认按值复制，原 buffer 仍可用；Uint8Array 的 offset / length 得到保留。                  |
| `{ transfer: [buffer] }`            | 必须实际协商原生二进制与 transfer 能力，并建立签名认证；不满足时 CAPABILITY_UNSUPPORTED。 |
| SharedArrayBuffer / 其它 TypedArray | 不支持，调用准入时拒绝。                                                                  |

要使用普通 factory 的签名原生二进制，在双方 `createThreadPeer` 配置 `authentication: { sign, verify }`；无需另建 Endpoint。`sign` 保护完整语义输入及 Core 为原生 backing 计算的摘要，`verify` 必须拒绝伪造签名。该 profile 签名但不加密，encodedType 使用默认 any。能力提案经实际端口双边确认，配置里的字符串不构成信任证据。

使用 HMAC 时，双方从各自部署配置读取同一个密钥；密钥不经 RPC 发送，也不进入日志。可由应用用 createHmac 对完整输入生成签名，verify 先检查签名长度再用 timingSafeEqual 校验，失败抛出认证错误。旧示例中的 RPC_SIGNING_KEY 是应用环境变量名，不是库自动提供的凭据。Node Worker 继承环境，应用应在加载读取密钥的模块前设置部署配置。

buffer 在消息真正提交到原生端口时失效，byteLength 变为 0，共享 backing 的所有 view 同时失效。之后即使对端拒绝签名或调用失败，也不能恢复原 buffer。带 transfer 的调用不自动重试，库不保留输入副本；确认业务结果后按需重新构造数据。这里描述原生转移机制，没有未经测量的速度保证。

### 现有端口与高级 source

`createNodeThreadChannel(port, peerId, options)` 借用 EventEmitter 端口，`createWebThreadChannel` 借用 EventTarget 端口；options.scheduler 必填。未传 capabilities 时使用固定基础 profile，同步返回且不做运行时 hello。固定子集只含 stream / batch 时也走同步固定路径；扩展能力提案返回 Promise，Core 在实际端口等待双边 ACK，缺失或错误 ACK 会拒绝，不能把单方声明当作完成协商。

在 Peer 的 connect callback 中把 `context.capabilities` 交给 channel，并让两端同时开始。context.self 是 Core 为本地准备的真实地址；peerId 表示对端连接。显式 capabilities 可缩小提案，不可扩大实际 launch offer、伪造协商或信任。逻辑 channel.close / Peer.close 解除自己的监听和 observer，不物理关闭借入端口；调用方最后关闭原生端口。固定 raw channel 不等于完整 runtime Peer。

完整 `IRuntimeThreadSpawn` 必填 spec、launcher、budget、scheduler、channelFactory、report；health、supervisor、keyFactory、retryPort 可省略。完整 source 不继承短形式的 isolation 覆盖：省略 supervisor.isolation 时由 supervision 默认 required 处理。spec.entry 是 Node 绝对路径 / file URL，Web 是绝对模块 URL；spec.name / data / limits 可省略。heapBytes 和 callWallTimeMs 是正限制：前者映射为 Node Worker 的 maxOldGenerationSizeMb，后者限制调用期限；不是进程总内存 / 总 CPU 限额。

| 平台                            | launcher / channel factory     | 原生能力                                                                                                |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Node                            | node 子入口的两个工厂          | termination / exit-observation / heap-limit 均 enforced，真实 exit 才结算 exited。                      |
| Bun                             | 根入口的两个 Web 工厂          | termination / exit-observation enforced，原生 Worker 的 close 事件结算 exited；heap-limit unsupported。 |
| Deno、浏览器、Electron renderer | 根入口的两个 Web 工厂          | 三项均 unsupported；terminate 请求不产生真实 exit 回执。                                                |
| Electron main                   | electron-main 子入口的两个工厂 | 复用 worker_threads，但明确三项 unsupported，不把 Node 验证外推到 Electron。                            |

Web launcher 必填 report，可选 Worker 构造器（默认全局 Worker）和 runtimeApi；构造器接收 entry 与 `{ type: 'module', name }`。Node launcher options 默认空对象，可显式 execArgv / runtimeApi；高级 createAdapterNodeThreadLauncher 另接真实 runtime resource。工厂只在实际启动时获取宿主能力。Node 的 sampleUsage 为冷查询：可用时报告该 isolate 的 heap、CPU 微秒和 ELU，sharedPid 只是共享进程身份；缺少原生方法时字段缺席，退出后返回空对象，不拿整个父进程用量冒充线程用量。

handle.identity 含稳定 fingerprint，Node 另含创建时 threadId；handle.port 为实际消息资源，terminate 只请求停止，exited 表示退出，Web 还提供 prepared。Node 由原生 exit、Bun 由原生 Worker close 结算 exited；Deno、浏览器和 Electron renderer 的退出观察为 unsupported，强制回收立即报告 supervision EXIT_UNOBSERVABLE 并保留 abandoned budget lease，不等待 reapTimeoutMs，也不能提前把槽位当空闲。可观察退出超时仍报告 REAP_TIMEOUT；best-effort 准入诊断 CAPABILITY_UNSUPPORTED 不变。自定义 Node / Web handle 的 open(signal, { scheduler, capabilities? }) 打开对应代次；channel factory 与它使用同一 scheduler。

构造或打开失败时，launcher / 监督 owner 释放已取得监听和候选 Worker；主错误保持原对象或在 cause 链中，清理错误保留在 errors。Node Endpoint 构造失败会回收真实 Worker 和预算；Web 请求 terminate 仍不能补出退出证明。高级调用方若直接 launch，须负责逻辑 channel 关闭、terminate 请求和等待真实 exited 的边界，不能在缺少原生回执的 Web 路径无限 await exited。

AdapterNodeThreadParentChannel 在构造时只保留真实 parentPort，open 才建立固定 profile，不先添加 listener。createAdapterNodeThreadPeer 接收已持有 parentPort 和原始 workerData；runtime resource 的 load 获取真实 Worker 模块，pid 表示共享进程。receiveThreadData 只消费匹配的初始 bootstrap，移除自己的 listener，await prepare(data, peerId) 后发送 ready；返回便携业务 data。readThreadBootstrap 校验并拆出 peerId / data；这些工具不给任意外部 Worker 授权。

新适配器复用 [Core adapter SDK](../rpc-core/USEGUIDE.md) 的 defineMessageAdapter；复杂原生组装可使用它的 internal-advanced 入口，不复制能力协商、重试或生命周期 owner。Node Worker 与 Bun 1.4.3 原生 Worker 已有业务与关闭运行证据；这些结果不证明浏览器、Deno 或 Electron 的权限与退出能力。

### 载体观察

最终 channel 的 `transport.observe(probe)` 安装物理消息观察；发送、接收各报告一次。发送 detail.transfers 为原生 transfer 列表长度，接收为 -1，因为 structured clone 不能说明收到的 buffer 是复制还是转移。直接 ArrayBuffer / view 的 sizeBytes 是字节长度，其它原生消息为 -1，不通过额外序列化估算对象大小。

仅 probe.capturing 开启时读取内容；未转移内容借用原引用，实际转移的 buffer 在发送前复制以保留观察字节。Core 对 own-data 原生容器的选择性捕获保留 Array、Record、Map、Set 中的环、共享 backing 和未转移对象引用；只经 accessor 返回转移 buffer 的情形不提供额外读取保证，不能为捕获再执行 getter。

probe 失败经 onListenerError 报 Core TRANSPORT，原异常保留在 cause，消息仍继续发送和接收。重复 observe 替换旧代，旧 disposer 不会移除新代；当前 disposer、逻辑 close 和既有原生 terminal 路径退休观察。借用端口 close 不改变物理端口所有权，也不改变既有监听与错误 cause 次序。

### 错误与重试

下表区分线程采样、监督、Core 与 Remote 的错误来源。线程 API 从 `@migaia/rpc-threads` 导入；Core 与 Remote API 分别从 `@migaia/rpc-core` 和 `@migaia/rpc-core/remote` 导入，`source` 值保留各自的错误身份。

| source / code                                      | 含义与处理                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `@migaia/rpc/threads` / THREAD_USAGE_SAMPLE_FAILED | 线程 CPU / 内存采样失败，原因为 cause；显示不可用，不据此改变 Worker 生命周期。 |
| @migaia/supervision / EXIT_UNOBSERVABLE            | 退出观察明确不支持；立即 abandoned，不等回收窗口，租约仍保留。                  |
| `@migaia/rpc/core` / INVALID_CONFIG                | 入口、来源、bootstrap、能力 ACK、portable data 或配置不合法；检查字段与 cause。 |
| `@migaia/rpc/core` / TRANSPORT                     | 原生消息 I/O / 启动资源边界失败，保留原生错误类型和原因。                       |
| `@migaia/rpc/core` / DEADLINE_EXCEEDED             | TimeoutError；Worker 可能已执行，先对账。                                       |
| `@migaia/rpc/core` / CANCELLED                     | AbortError；协作取消，不能证明业务未执行。                                      |
| `@migaia/rpc/core` / OVERLOADED                    | 并发额度满，provider 未调用，降低并发后重试。                                   |
| `@migaia/rpc/core` / CAPABILITY_UNSUPPORTED        | 需要未协商能力，例如未签名的 transfer。                                         |
| `@migaia/rpc/core` / TARGET_UNKNOWN                | 当前目录没有该目标，检查名字和当前代次。                                        |
| `@migaia/rpc/remote` / REMOTE_CLOSED               | 连接或代次已关闭，重新选择目标，并对已发调用对账。                              |

Node launcher 的原生 Worker 构造参数被拒绝时，使用 Core INVALID_CONFIG 标识；若已有原生 code，则以包装错误保留原 Error、name、message、stack 和原生 code 于 cause，不覆盖它们。此分类只描述 Node 构造边界，不泛化为所有 Web 构造器异常。

本包本地错误码对象 RpcThreadErrorCode 只有 usageSampleFailed，值为 THREAD_USAGE_SAMPLE_FAILED，RPC_THREAD_ERROR_SOURCE 为 `@migaia/rpc/threads`。调用、监督和 Host 边界各使用自己的 source，不把所有失败改成本包采样码。按 source / code 分支，不匹配 message 文本；业务异常跨 Worker 后保留原生类型、message、stack、source/code 与 cause / errors 链，不能承诺接收端对象与发送端同一 identity。

Worker 单独运行配置失败通常是没有库 launcher bootstrap；默认 buffer 未失效是复制语义；Worker 是否重启取决于 restart 策略。需人工恢复时用 Host 的 restart / replace，并查看 list / get 的当前代次与退出信息。
