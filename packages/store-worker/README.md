# `@migaia/store-worker`

把通用计算或序列化解析器接到真实 Worker，让调用方继续使用 Promise、Resource 和序列化注册表。

## 你可能遇到过

- 发出两次计算请求后，结果交给了错误的等待者：原始消息没有替你关联请求与响应。
- 页面关闭后，借用的 Worker 也被终止：客户端订阅与物理线程的所有权混在了一起。
- Worker 只回传一条错误消息：原生错误类型、原因链和堆栈在线程边界丢失了。
- 输入变了，界面还显示旧计算结果：请求旁又手写了一份加载状态与缓存。
- 现有注册表要接入 Worker 解析器：临时消息代码重复实现了格式选择和清理。

## 为什么选它

- **用同一套请求接口跨越真实线程边界。** `WorkerAdapter.request` 等待端点初始化并交给 Core 关联结果，[把计算交给真实 Worker](./USEGUIDE.md#把计算交给真实-worker) 用进程和线程标识证明计算位置。
- **请求入口和物理 Worker 分开释放。** `close` 停止接纳、`dispose` 共享异步清理 Promise，[停止请求并保留借用的 Worker](./USEGUIDE.md#停止请求并保留借用的-worker) 在清理后仍通过原生端口收到了消息。
- **跨线程失败仍能沿原因链排查。** `createWorkerHandler` 复用 RPC 错误传输，[保留 Worker 计算失败的原因链](./USEGUIDE.md#保留-worker-计算失败的原因链) 检查了原生类型、嵌套原因和堆栈。
- **计算结果直接使用已有状态与缓存模型。** `workerComputed` 把输入选择和请求接入 Resource，[用 Resource 管理 Worker 结果与缓存](./USEGUIDE.md#用-resource-管理-worker-结果与缓存) 展示了按需取值、新鲜缓存复用和显式刷新。
- **保留应用原有的注册表调用。** `workerPlugin` 以标准插件接入 Worker 中的 parser，[把现有 JSON 解析器接入 Worker 注册表插件](./USEGUIDE.md#把现有-json-解析器接入-worker-注册表插件) 通过原有 encode / decode 完成往返。

## 从这里开始

在 Node 24 中把下面代码保存为独立的 ESM TypeScript 文件执行；子线程会重新加载当前文件，不能放进交互式标准输入。先安装本包：

```bash
pnpm add @migaia/store-worker
```

```ts doc-test=run
import { Worker, MessageChannel, workerData, isMainThread } from 'node:worker_threads'
import { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'
if (!isMainThread) {
  const handler = createWorkerHandler(Number, (m) => workerData.postMessage(m))
  workerData.on('message', (m: unknown) => void handler(m).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1)
  console.log(await adapter.request('42'))
  await adapter.dispose()
  port1.close()
  await worker.terminate()
}
```

输出：

```text
42
```

下一步看[把计算交给真实 Worker](./USEGUIDE.md#把计算交给真实-worker)，核对计算位置以及完整的清理顺序。

## 手写时的隐患

下面只展示原生消息的手写请求草图，仅检查类型，不运行：

```ts doc-test=check
import { MessageChannel } from 'node:worker_threads'

const { port1 } = new MessageChannel()
let resolveResult: ((value: number) => void) | undefined
const request = (input: string) =>
  new Promise<number>((resolve) => {
    resolveResult = resolve // 隐患：并发请求会覆盖前一次的等待者。
    port1.postMessage(input) // 隐患：没有等待就绪，也没有失败结算路径。
  })
port1.on('message', (value: number) => resolveResult?.(value))
// 隐患：监听器与物理端口的清理责任没有分开。
void request
```

上一节通过 Adapter 等待初始化并关联请求，释放时等待端点清理；自己创建的端口和 Worker 仍由调用方关闭与终止。

## 三分钟心智模型

| 你要做的事             | 使用什么                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| 主端发起通用计算       | WorkerAdapter.request，像等待普通异步结果一样等待。                        |
| Worker 侧接收请求      | createWorkerHandler 包装 compute，再把真实消息交给 handler。               |
| 让结果带加载状态与缓存 | workerComputed 返回 Resource，借用已有 Adapter。                           |
| 保持序列化注册表调用   | Worker 侧 createSerializeWorkerHandler，主端 workerPlugin / workerParser。 |

端点是本次消息连接；适配器借用物理端口。Resource 管理结果的新鲜度与取值状态，不创建线程。parser 负责实际格式算法，type 只是注册表标签。copy 保留输入，transfer 则显式交出符合条件的字节存储，不代表载荷零拷贝。

## 典型场景

| 场景                       | 怎么组合                                               | 详细说明                                                                                           |
| -------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 核对计算确实进入 Worker    | createWorkerHandler → WorkerAdapter.request → dispose  | [把计算交给真实 Worker](./USEGUIDE.md#把计算交给真实-worker)                                       |
| 客户端结束但复用 Worker    | close → dispose → 原生端口继续通信                     | [停止请求并保留借用的 Worker](./USEGUIDE.md#停止请求并保留借用的-worker)                           |
| 追查跨线程计算错误         | createWorkerHandler → request.catch → cause            | [保留 Worker 计算失败的原因链](./USEGUIDE.md#保留-worker-计算失败的原因链)                         |
| 随输入刷新结果并复用缓存   | workerComputed → state / promise → refetch → dispose   | [用 Resource 管理 Worker 结果与缓存](./USEGUIDE.md#用-resource-管理-worker-结果与缓存)             |
| 把现有格式放到 Worker 解析 | createSerializeWorkerHandler → workerPlugin → registry | [把现有 JSON 解析器接入 Worker 注册表插件](./USEGUIDE.md#把现有-json-解析器接入-worker-注册表插件) |
| 取消解码并保留输入字节     | workerParser → decode(context.signal) → dispose        | [取消解码时保留输入字节](./USEGUIDE.md#取消解码时保留输入字节)                                     |

## 安装

```bash
pnpm add @migaia/store-worker
```

使用指南中的 Resource 与序列化场景直接导入另外两个包，需要直接安装：

```bash
pnpm add @migaia/reactive @migaia/serialize
```

本包有根入口与精确子入口 `@migaia/store-worker/serialize/worker`；不要从根入口导入 workerPlugin 或 workerParser。下面 Node 示例使用真实 Worker；浏览器部署仍需按构建器安排 Worker 文件与运行环境。

## 常用 API

| API                          | 用途                                                 |
| ---------------------------- | ---------------------------------------------------- |
| WorkerAdapter                | request 发起计算，close 停止接纳，dispose 释放端点。 |
| createWorkerHandler          | Worker 侧包装通用计算并交付消息。                    |
| workerComputed               | 由同步输入选择器创建 Resource。                      |
| workerPlugin                 | 把 Worker parser 注册到序列化注册表。                |
| workerParser                 | 直接使用 Worker 序列化 parser。                      |
| createSerializeWorkerHandler | Worker 侧连接真实 parser 与消息端口。                |

## 契约细节

### 职责、入口与运行边界

本包提供两条 Worker 接线：WorkerAdapter / createWorkerHandler 执行通用计算，workerComputed 把该请求接入 Resource；序列化子入口则把普通 parser 接入 Worker 和 SerializeRegistry。请求关联、provider、取消、deadline、来源与错误传输归 rpc-core，Resource 的缓存、重试和响应式生命周期归 resource，格式解析与注册表归 serialize。本包只拥有应用载荷转换、分段 credit / ACK 和这些 API 的接线，不创建另一套 RPC 引擎。

| 入口                                    | 公开内容                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@migaia/store-worker`                  | WorkerAdapter、createWorkerHandler、workerComputed、IManagedRpcHandler、端口 / Resource 配置类型、所有权 / 诊断常量与错误。 |
| `@migaia/store-worker/serialize/worker` | workerParser、workerPlugin、createSerializeWorkerHandler，及 IWorkerPluginOptions、IWorkerLike、IWorkerFailureEvent。       |

reactive、resource、serialize、rpc-core、rpc-contract、utils 是运行时依赖。直接导入它们时，应用也应直接安装需要的包。根入口不导出序列化 factory，没有 serialize/* 通配入口；旧根 aliases 需迁移到精确子路径，没有兼容 shim。encodeWorkerValue / decodeWorkerValue 与 transferablesOf 是内部工具，不作为业务导出。无抛点的旧 CHUNK_MERGE_FAILED 已移除，当前保留六码。

该桥固定使用 exclusive 拓扑：一个逻辑连接对应一对端口，默认本端 main、对端 worker，经 connect 做 Core 的一致性检查和目录接线，不使用自定义 identifier。这不赋予任意共享 Worker 对象多客户端复用保证。一个 MessagePort 可以满足端口形状，但创建者仍须安排独立的物理连接和资源归属。

IWorkerPort 是 Core IWebWorkerLikePort 的别名，要求 postMessage、addEventListener、removeEventListener，消息事件为 message / error / messageerror。浏览器 Worker / MessagePort / 单条 SharedWorker.port 可提供这种面；Node 示例使用真实 Worker 内运行的 handler 与原生 MessagePort，不伪造端口。IWorkerLike 额外允许可选 terminate()；结构可传入不等于本包获得原生 Worker 的创建或退出所有权。

### WorkerAdapter：调用方的连接

`new WorkerAdapter(port, options?)` 同步返回对象，内部 Endpoint 异步初始化；request 自动等初始化，不需要额外 ready API。

| 构造或调用参数             | 默认与行为                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------- |
| port                       | 必填，借用实际消息端口。                                                           |
| options.clientId           | main，本端 Core id。一个物理连接按固定一对使用；不推荐给同一 Worker 重复建适配器。 |
| options.timeoutMs          | undefined，不设默认请求期限；需要时显式给毫秒数。                                  |
| request(payload, options?) | payload 为调用输入，返回结果 Promise；Input / Output 泛型只提供调用端静态类型。    |
| request 的 signal          | 未设置，按请求独立协作取消。                                                       |
| request 的 transfer        | 未设置，显式原生转移列表；它不等于序列化插件 ownership 策略。                      |

构造 options 的 clientId / timeoutMs、请求 options 的 signal / transfer 各在入口捕获，不在等待初始化后重读调用方 getter。非法 options 对象或读取失败带 INVALID_OPTION，捕获原错保留在 cause；request 返回 rejected Promise，构造期失败同步抛出。端口与 RPC 配置的后续准入继续由 Core 负责，不把所有 Core 错误改成本包错误。

同一 Adapter 可并发 request；Core 按请求关联结果、隔离 deadline 与取消。独立请求可用 Promise.all，让支持 batch@1 的内建载体在物理写进行时合并已就绪请求或响应；空闲时立即单帧发送，有依赖的串行 await 不会因此变成批处理。request 等处理结果，内部 one-way notify 仅等物理发送，不是业务执行回执。

| 成员      | 生命周期                                                                                    |
| --------- | ------------------------------------------------------------------------------------------- |
| disposed  | `adapter.disposed` 在 `adapter.close()` 或 `adapter.dispose()` 开始时同步变为 `true`，表示该适配器已停止接纳请求。                                                             |
| close()   | 无参数，同步幂等标记不可用；新 request 拒绝 ADAPTER_DISPOSED，不释放 Endpoint。             |
| dispose() | 无参数，唯一异步释放入口；先 close，等初始化，再关闭 Endpoint，重复调用返回同一个 Promise。 |

Adapter.dispose 不 terminate 借用的 Worker / port。清理失败以 rejected Promise 暴露，不吞掉；close-before-ready 也不能在稍后初始化完成后继续派发已退休请求。物理 Worker 由创建者按应用顺序终止；端点完成清理不等于得到了原生线程退出回执。

### Worker 侧 handler 与输入载荷

`createWorkerHandler<Input, Output>(compute, postMessage, options?)` 验证两个必填函数，再建立消息处理器。compute(payload, { signal }) 可同步返回或返回 Promise；signal 是原生取消信号，长任务应配合检查或监听，框架不强制中断正在执行的同步代码。postMessage(message) 把 Core 消息交给真实父端口。options.timeoutMs 缺省 undefined，只影响该端点发起的 request，不为本端 compute 设置运行期限；请求期限通常由主端 Adapter 配置。

返回 IManagedRpcHandler 后，调用方要把真实 message.data 交给 handler。它不是自己安装全局 onmessage 的 Worker 创建器；浏览器可在监听器中交付数据，Node 使用 MessagePort 监听。handler 返回 Promise，初始化或交付路径失败仍应由宿主观察；普通 provider compute 抛错由 Core 转为失败响应，不能据此泛称所有宿主回调都永远不 reject。

桥会把业务输入转换为 portable 数据：支持普通记录 / 数组、有限基础值、undefined，以及 ArrayBuffer / Uint8Array 的显式字节表示。它不是任意原型、函数、Map / Set 或循环对象图的无损 structured clone；业务需要这些形状时先定义可传输表示或使用合适 parser。内部 $worker 标签为保留表示，不能把相同标记形状当成普通业务对象，也不能用来宣称信任。

### IManagedRpcHandler 的关闭与清理

| 成员             | 行为                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| handler(message) | 接收已解析的原始消息值；关闭后 resolve 并忽略，不处理晚到队列残留。                |
| pendingCount     | 已接纳、正在等待 Endpoint 初始化或交付消息的数量，不代表 provider compute 已完成。 |
| disposed         | `handler.disposed` 在 `handler.close()` 或 `handler.dispose()` 开始时同步变为 `true`，表示该处理器不再接收消息。                                                    |
| close()          | 同步幂等停止接纳，不执行 Endpoint 或用户清理。                                     |
| dispose()        | 先 close，等待初始化，再执行 Endpoint 清理；同一个 Promise，失败保持拒绝。         |

初始化期间已经接纳的消息在 close 后也不再交付，pendingCount 最终回到 0。不要把该计数当成安全 terminate 的静默门禁；端点 provider drain 和清理由 Core 契约负责，应等待 dispose 并按物理资源 owner 规则处理 Worker。此接口没有 disposeAsync。序列化 handler 也只释放自己的 Endpoint / provider 注册，不自动调用借入 parser.dispose，parser 生命周期仍归创建者。

### workerComputed 与 Resource

`workerComputed(adapter, selectInput, options?)` 返回标准 `Resource<Output>`。每次 Resource fetcher 同步调用 selectInput 一次，再以该输入请求 Adapter，并转发 Resource signal 和可选 transfer(input)。同步读取的 signal / computed 依赖由 Resource 追踪；await 后才读取的值不自动归入这次同步依赖。它不提供跨 Resource 或跨 Worker 的全局缓存 / 请求去重。

| 参数 / 选项          | 默认与语义                                                                |
| -------------------- | ------------------------------------------------------------------------- |
| adapter              | 必填的 WorkerAdapter 实例；Resource 借用，不负责 dispose。                |
| selectInput          | 必填同步函数，返回当前计算输入。                                          |
| runtime              | defaultRuntime。                                                          |
| transfer             | undefined；若提供必须是函数，返回此次输入的转移列表。                     |
| ttl                  | Infinity，Resource 缓存有效期。                                           |
| autoStart            | true；false 只跳过构造时主动启动，读取 state / promise 仍可触发按需取值。 |
| staleWhileRevalidate | false。                                                                   |
| retry                | 0；也可按 (failureCount, error) 返回是否重试。                            |
| retryDelay           | 0；也可按 (failureCount, error) 返回等待毫秒数。                          |
| keepAlive            | false。                                                                   |
| initialSnapshot      | undefined。                                                               |
| debugName            | undefined。                                                               |
| scheduler            | systemScheduler。                                                         |

这些 Resource 字段原样交给 Resource，不在 Worker 层重新实现规则。读取已知 options 各一次，不通过对象 rest 枚举未知 getter；非法 adapter、selectInput、transfer 或配置 getter 在 Resource 接管 / 自动启动前以 INVALID_OPTION 同步拒绝，原错为 cause。Resource 的 refetch、load、state 和 dispose 继续遵循 resource 包。

结束时先释放 Resource，再 await adapter.dispose，最后由创建者终止原生 Worker / 端口，避免销毁 Resource 仍在使用的连接。传 transfer 时必须由应用决定输入以后是否还会读取；Resource 重试不使已经 detach 的 backing 自动恢复。

### 序列化 parser 与插件

workerParser(options) 是主端 ISerializeParser；workerPlugin(options) 只是把它的 name / parser 组合成标准 ISerializePlugin，供 createSerializeRegistry 使用。两者仅从 /serialize/worker 导入。

| IWorkerPluginOptions 字段 | 默认与用途                                                                      |
| ------------------------- | ------------------------------------------------------------------------------- |
| worker                    | 必填，IWorkerLike 端口。                                                        |
| type                      | worker，格式标签，必须与真实 Worker parser 的编码含义相符；读存档时用正确标签。 |
| clientId                  | main。                                                                          |
| ownership                 | copy；另一个值为 transfer，见字节规则。                                         |
| terminateOnDispose        | false，借用 Worker 由调用方拥有。                                               |

options 的这五个字段在入口各读一次；非对象、反射或读取失败、非法字段值以 INVALID_OPTION 拒绝。parser 无 timeoutMs 选项，不能建议配置不存在的 parser.timeoutMs；取消使用 SerializeContext.signal，注册表另有自己的生命周期预算。

encode(value, context) 将 Uint8Array 输入分类为 bytes，其他为 value，返回按块消费的异步序列；不是同步返回一份合并好的 chunk。decode(chunk, context) 请求 Worker 解码，返回结果段的 payload，不再给调用方多包一层 chunk。context 提供 signal 和用于诊断的 context 名称；注册表会传入其真实上下文。

workerParser.dispose 异步退休活跃输出并关闭 Endpoint，默认不终止原生 Worker；terminateOnDispose 为 true 时，即便端点清理失败也继续尝试调用可选 terminate。只有同步 terminate 调用抛错才由这段捕获，不宣称等待原生异步退出。端点单独失败保留 RpcLifecycleError 清理信息，terminate 单独抛错保留原错，两者均失败才生成 CLEANUP_FAILED AggregateError，errors 按端点、terminate 顺序保留。重复 parser.dispose 返回同一个 Promise。Registry.dispose 需要 await 才能观察其异步清理结果。

### Worker 侧序列化与分段流

createSerializeWorkerHandler(parser, post) 的两个参数必填：真实 parser 必须提供 encode / decode，post(message, transfer?) 委托真实 Worker 端口。非对象 / 非函数在 Endpoint 创建前同步拒绝。parser 成员 getter 抛错时，可注记未归属原生 Error 保留同一对象、类型和 stack 并附 INVALID_OPTION；完整外包 source/code 保留，不可注记值通过 cause 或聚合链保留。

handler 传 parser.encode 输入段的 payload；输出可为一个合法 ISerializeChunk，或同步 / 异步 chunk iterable。主端以 open / chunk / end 帧增量接收，初始两个 credit、按顺序 ACK，消费后补 credit；不调用 collectStream 或先把所有结果拼为一份。credit 限制单流发送进度，不是全 Worker 的总字节上限，producer 可先取得下一块再等待发送 credit。

返回的合法 text / bytes / value 段保持顺序，可有空流和混合段；删掉的 CHUNK_MERGE_FAILED 不再承担这种路径。parser.decode 接收原 chunk，解码结果是 Uint8Array 则分类为 bytes，否则为 value。Worker 侧向外发送的完整 bytes backing 可按其发送规则转移，不由主端输入 ownership 自动赋予输出重用保证。

消费者提前结束或取消会通知对应 stream，唤醒等待 credit 的 producer，并尝试 iterator.return；清理又失败时用既有 secondary-error 附加保留主错与次错。终结错误通过 Core RPC rejection 传 source/code/name/message/stack/cause/errors 链，不另造普通 error 应用帧。实际不可合作的业务代码仍须由应用负责，不把流取消宣称为强制停止 Worker。

### 字节复制、转移与实际载荷

WorkerByteOwnership 是公开词表 copy / transfer，IByteOwnership 是其值联合；WorkerDiagnosticType 只有 worker，IWorkerDiagnosticType 是该值类型。它们不接收参数。默认 copy 保留调用方输入；transfer 是显式放弃独占输入存储的策略。

序列化输入只有 bytes 段、真实 Uint8Array、且视图覆盖整个普通 ArrayBuffer（offset 为 0、length 等于 backing 长度）才进入 transfer list。局部 subarray、SharedArrayBuffer backing 等不满足条件时回退复制；普通 ArrayBuffer 的其他别名不会被检测并排除转移，整块转移可能同时使它们失效。共享 backing 不因此变成一个支持的共享内存计算协议。顶层非 bytes 的 text / value 不因 ownership 自动转移内部对象。

实际原生 post 提交后，转移可能让整个 backing 及所有别名 view detach；预取消尚未发送时输入仍可用，不能看到 transfer 选项或取消码就断言数据已丢失。重试前检查实际 buffer 状态，或选择 copy / 保留应用副本。transferablesOf / exclusiveBuffer 是内部工具，不作为公开 API 调用。

当前 portable 桥先把 bytes 转成 base64url 载荷，再独立传 native transfer list，因此 detach 不证明载荷零拷贝。小计算与复杂对象图还要承担编码和往返成本；旧实现耗时与倍率不代表当前实现，没有本轮性能数字或速度保证。应用应按真实工作量判断是否值得卸载，而不是从“用了 Worker”推导提速。

### 取消、错误与清理归属

通用 Adapter request 保留 canonical Core 取消、超时、transport 与远程错误。compute 异常通常在 RpcRemoteError / INTERNAL 外层之下恢复原生 TypeError / RangeError 等 cause、message 和 stack；不要要求接收对象与 Worker 原对象 identity 相同，也不要把所有顶层异常当成业务原生类型。未配置期限且 provider 一直不结算时，请求仍可能等待；不能承诺任何坏 Worker 都必然及时 settle。

序列化 decode / request 与预取消 encode 使用 SerializeCodecError / REQUEST_ABORTED，包含 type（默认 worker）、phase（encode / decode）、context、chunkIndex 0 和 bytesConsumed（输入 bytes 长度，否则 0），原 signal.reason 保留在 cause。活动 encode 流可以由原始 RPC / 取消失败终结，不保证每个失败都有全部 codec 字段。credit 等待和显式流停止创建原生 DOMException / AbortError，message 为 serialize stream cancelled，附 REQUEST_ABORTED；其原生类型、message 和 stack 由错误链保留。

| StoreWorkerErrorCode 属性 / 值                | 触发                                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| invalidOption / INVALID_OPTION                | 非法或不可读取的 Worker / parser / Resource 配置。       |
| adapterDisposed / ADAPTER_DISPOSED            | 已 close / dispose 的通用 Adapter 继续 request。         |
| requestAborted / REQUEST_ABORTED              | 序列化请求或流协作取消，检查 reason 与真实 buffer 状态。 |
| invalidRequestChunk / INVALID_REQUEST_CHUNK   | Worker 请求的 chunk 形状非法。                           |
| invalidResponseChunk / INVALID_RESPONSE_CHUNK | 返回 chunk 或帧序列不合法。                              |
| cleanupFailed / CLEANUP_FAILED                | parser 端点与可选 terminate 同时清理失败。               |

STORE_WORKER_SOURCE 为 @migaia/store-worker。createStoreWorkerError(code, message, options?) 接收必填码和消息，可选 options.cause，返回带身份的 Error；createStoreWorkerAggregateError(code, errors, message) 返回 AggregateError，保留 errors 顺序和原值。code 类型为 IStoreWorkerErrorCode，工厂不覆盖 stack。外包完整身份继续由原 owner 负责。

### 排查与维护

请求一直等待时先检查真实 message.data 是否交给正确 handler，再看 WorkerAdapter.timeoutMs / 调用 signal；workerParser 只能用已有 context.signal，没有 parser.timeoutMs。Chunk 多段问题应按增量迭代处理，不套用旧“Worker 内先合并单段”的做法。释放端点后 Worker 仍存活通常是借用所有权：通用路径由创建者 terminate，序列化可选择 terminateOnDispose，但仍不等于确认原生退出。

包已有 fmt / lint / typecheck / typecheck:test / test / build，以及 typecheck:e2e / test:e2e。浏览器 e2e 需要已安装 Playwright 浏览器；本轮 Node 场景不冒充浏览器授权或多宿主证据。实际报告说明哪些命令运行与通过，不把命令列表或旧性能记录当成当前验证结论。
