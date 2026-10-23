# @migaia/store-worker 使用指南

按任务选择下面的完整示例，再查后面的参数与生命周期约定。所有运行示例使用 Node 24 的真实 Worker 与 MessagePort；它们证明线程接线、计算、缓存或清理，不代表浏览器权限或跨进程隔离。

## 按场景查找

| 场景                                     | 主要 API              | 详细说明                                              |
| ---------------------------------------- | --------------------- | ----------------------------------------------------- |
| 把计算交给真实 Worker                    | `WorkerAdapter`       | [完整示例](#把计算交给真实-worker)                    |
| 停止请求并保留借用的 Worker              | `WorkerAdapter`       | [完整示例](#停止请求并保留借用的-worker)              |
| 保留 Worker 计算失败的原因链             | `createWorkerHandler` | [完整示例](#保留-worker-计算失败的原因链)             |
| 用 Resource 管理 Worker 结果与缓存       | `workerComputed`      | [完整示例](#用-resource-管理-worker-结果与缓存)       |
| 把现有 JSON 解析器接入 Worker 注册表插件 | `workerPlugin`        | [完整示例](#把现有-json-解析器接入-worker-注册表插件) |
| 取消解码时保留输入字节                   | `workerParser`        | [完整示例](#取消解码时保留输入字节)                   |

## 运行准备

安装本包；Resource 示例直接导入 reactive，序列化示例直接导入 serialize，因此也要直接安装这两个包。

```bash
pnpm add @migaia/store-worker @migaia/reactive @migaia/serialize
```

把每个示例分别保存为一个独立的 ESM TypeScript 文件，再用 Node 24 执行该文件；不要在交互式标准输入中运行，因为 Worker 会通过 import.meta.url 重新加载同一文件。子线程只接收转移给它的原生端口；父线程负责 finally 中的关闭与终止。无需浏览器端口替身或额外 Worker 包装层。

## 把计算交给真实 Worker

一项计算需要离开界面线程，调用方又不想自己维护消息标识与响应匹配。

只发送业务数据，还需要手写请求匹配、启动就绪和失败处理；主线程的等待也容易与 Worker 初始化错开。

创建真实 Node Worker，把 `MessagePort` 转交给它，再配对 `WorkerAdapter` 与 `createWorkerHandler`；`request` 自动等待端点初始化，返回的进程与线程标识可核对计算位置。

### 示例参数

`new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })` 在另一个线程执行当前文件；`isMainThread` 区分两条分支，`workerData` 是交给子线程的端口，`transferList` 转移的是端口而非业务输入。`port1.start()` 启用原生端口的事件分发。`request` 的两个泛型只声明输入与返回值类型；本例载荷为 `[20, 22]`，未设置 `signal` 或业务转移列表。适配器的 `clientId` 默认 `'main'`，`timeoutMs` 默认 `undefined`，不设期限。

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createWorkerHandler(
    (values: number[]) => ({
      total: values.reduce((sum, value) => sum + value, 0),
      pid: process.pid,
      threadId
    }),
    (message) => port.postMessage(message)
  )
  port.on('message', (message) => void handler(message).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1)
  try {
    const result = await adapter.request<
      number[],
      {
        total: number
        pid: number
        threadId: number
      }
    >([20, 22])
    console.log('结果：', result.total, result.pid === process.pid, result.threadId !== threadId)
  } finally {
    await adapter.dispose()
    port1.close()
    await worker.terminate()
  }
}
```

输出：

```text
结果： 42 true true
```

输出 `结果： 42 true true`：结果是 `42`，Worker 与父线程位于同一进程，却使用不同线程。

这里验证的是 Node 24 原生 Worker，不是浏览器环境或进程隔离；`clientId` 默认 `'main'`，`timeoutMs` 默认 `undefined`。端口由适配器借用，调用方仍需关闭端口并终止自己创建的 Worker。

## 停止请求并保留借用的 Worker

页面关闭了请求客户端，应用却仍持有 Worker 和端口。

在客户端清理时直接终止 Worker，会释放不属于它的资源；只标记关闭，又会留下端点订阅。

用 `close` 立即拒绝新请求，再等待 `dispose` 释放端点；重复销毁复用同一个 Promise，最后用原生消息确认借用的 Worker 端口仍能通信。

### 示例参数

`close()` 与 `dispose()` 都无参数；前者同步退休请求入口，后者异步释放端点，重复调用复用 Promise。示例最后通过 `port1.once` 与原生 `'ping'` / `'pong'` 验证借用端口仍可用；它们不是本包业务协议。`Worker` 与端口由本例创建，因此仍由 `finally` 关闭和终止。

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createWorkerHandler(
    (value: number) => value * 2,
    (message) => port.postMessage(message)
  )
  port.on('message', (message) => {
    if (message === 'ping') {
      port.postMessage('pong')
      return
    }
    void handler(message).catch(console.error)
  })
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1)
  try {
    console.log('关闭前：', await adapter.request(21))
    adapter.close()
    const failure = await adapter.request(21).catch((error: unknown) => error)
    console.log('已关闭：', adapter.disposed, (failure as { code?: string }).code)
    const first = adapter.dispose()
    console.log('同一清理：', first === adapter.dispose())
    await first
    const pong = new Promise<unknown>((resolve) => port1.once('message', resolve))
    port1.postMessage('ping')
    console.log('借用端口：', await pong)
  } finally {
    await adapter.dispose()
    port1.close()
    await worker.terminate()
  }
}
```

输出：

```text
关闭前： 42
已关闭： true ADAPTER_DISPOSED
同一清理： true
借用端口： pong
```

依次输出 `关闭前： 42`、`已关闭： true ADAPTER_DISPOSED`、`同一清理： true`、`借用端口： pong`。

`close` 只停止接收新请求，`dispose` 才执行可能失败的异步端点清理；两者都不关闭原生端口或终止 Worker。最后的探测是独立宿主消息，不是 RPC 请求。

## 保留 Worker 计算失败的原因链

Worker 中的计算因输入问题抛出 `TypeError`，其原因又是一个 `RangeError`，调用方需要同时看到两层失败。

只回传错误消息，会在线程边界丢失原生类型、嵌套原因和原始堆栈信息。

用 `createWorkerHandler` 包装真实计算，并向它转交收到的消息；RPC 返回远端失败，其原因链保留原生 `TypeError` 与内部 `RangeError`，无需另建错误消息协议。

### 示例参数

`createWorkerHandler(compute, postMessage)` 的两个函数均必填；本例 `compute` 抛出含 `cause` 的原生 `TypeError`，`postMessage` 委托原生端口。主端没有设置超时，默认不设期限；错误由跨线程 RPC 原因链读取，不要求接收对象与子线程原对象相同。消息监听器观察 handler 返回 Promise 的投递失败。

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { WorkerAdapter, createWorkerHandler } from '@migaia/store-worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const root = new RangeError('行数据无效')
  const failure = new TypeError('无法计算总数', { cause: root })
  const handler = createWorkerHandler(
    () => {
      throw failure
    },
    (message) => port.postMessage(message)
  )
  port.on('message', (message) => void handler(message).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1)
  try {
    const failure = (await adapter.request([1, 2]).catch((error: unknown) => error)) as Error
    const primary = failure.cause as Error
    const root = primary.cause as Error
    console.log('远端错误：', failure.name, (failure as Error & { code?: string }).code)
    console.log('原始错误：', primary instanceof TypeError, primary.message)
    console.log('原因：', root instanceof RangeError, root.message)
    console.log('堆栈：', Boolean(primary.stack), Boolean(root.stack))
  } finally {
    await adapter.dispose()
    port1.close()
    await worker.terminate()
  }
}
```

输出：

```text
远端错误： RpcRemoteError INTERNAL
原始错误： true 无法计算总数
原因： true 行数据无效
堆栈： true true
```

依次输出 `远端错误： RpcRemoteError INTERNAL`、`原始错误： true 无法计算总数`、`原因： true 行数据无效`、`堆栈： true true`。

外层错误属于 RPC Core，原生错误保留在 `cause` 链中，不会把最外层变成 `TypeError`。消息处理器的 Promise 只等待投递，不代表计算完成；操作结果由主端请求等待。

## 用 Resource 管理 Worker 结果与缓存

界面需要展示加载与成功状态，也需要缓存 Worker 结果，输入之后还可能继续变化。

在请求旁再维护结果变量和缓存，会重复实现 `Resource` 的行为，也容易把旧输入的结果留在界面上。

用 `workerComputed` 同步选择输入，并传入信号所属的运行时；`autoStart: false` 跳过构造时主动启动，读取 `state` 仍可按需取值，再等待 `refetch`、读取缓存并在输入改变后刷新。

### 示例参数

`runtime` 显式使用输入信号所属的运行时；省略时为 `defaultRuntime`。`selectInput` 同步返回 `values.value`；`autoStart: false` 覆盖默认 `true`，只跳过构造时主动启动，首个 `state` 读取仍会触发请求。`ttl` 默认 `Infinity`，本例不覆盖；`refetch()` 强制取值，`promise` 被动读取可复用新鲜缓存。`Resource` 借用适配器，须先释放资源，再清理端点与原生 Worker。

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { createRuntime } from '@migaia/reactive'
import { WorkerAdapter, createWorkerHandler, workerComputed } from '@migaia/store-worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createWorkerHandler(
    (values: number[]) => values.reduce((total, value) => total + value, 0),
    (message) => port.postMessage(message)
  )
  port.on('message', (message) => void handler(message).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const adapter = new WorkerAdapter(port1)
  const runtime = createRuntime()
  const values = runtime.signal([1, 2, 3])
  const sum = workerComputed<number[], number>(adapter, () => values.value, {
    runtime,
    autoStart: false
  })
  try {
    console.log('取值前：', sum.state.status)
    console.log('首次：', await sum.refetch(), sum.state.status)
    const cached = sum.promise
    console.log('缓存：', cached === sum.promise, await cached)
    values.value = [4, 5]
    console.log('更新：', await sum.refetch(), sum.state.status)
  } finally {
    sum.dispose()
    await adapter.dispose()
    port1.close()
    await worker.terminate()
  }
}
```

输出：

```text
取值前： pending
首次： 6 success
缓存： true 6
更新： 9 success
```

依次输出 `取值前： pending`、`首次： 6 success`、`缓存： true 6`、`更新： 9 success`。

`autoStart` 默认 `true`，设为 `false` 只跳过构造时主动启动；首次读取 `state` 会按需取值并显示 `pending`。`ttl` 默认 `Infinity`，被动读取 `promise` 复用新鲜缓存，`refetch` 则强制刷新；先释放资源，再清理借用的适配器与 Worker。

## 把现有 JSON 解析器接入 Worker 注册表插件

应用已经使用序列化注册表，现在需要把某个解析器放到 Worker 执行。

把注册表调用改成临时消息，会重复实现格式选择与清理；主线程再运行一份解析器，又没有建立预期的执行边界。

在真实 Worker 中用 `createSerializeWorkerHandler` 接入 `jsonParser`，主线程注册 `workerPlugin`；继续调用注册表的编码与解码接口，由格式标签选择此插件。

### 示例参数

`workerPlugin` 的 `worker` 必填，本例为原生端口；`type: 'json'` 覆盖默认 `'worker'`，只作为本地注册表格式标签，不改变 Worker 中 `jsonParser()` 的算法。`ownership` 默认 `'copy'`，`clientId` 默认 `'main'`，`terminateOnDispose` 默认 `false`。注册表借助插件进行 `encode` / `decode`，`registry.dispose()` 清理插件端点；本例仍负责原生端口和 Worker。

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { createSerializeRegistry } from '@migaia/serialize'
import { jsonParser } from '@migaia/serialize/plugins'
import { createSerializeWorkerHandler, workerPlugin } from '@migaia/store-worker/serialize/worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>
    port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1])
  )
  port.on('message', (message) => void handler(message).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const registry = createSerializeRegistry([workerPlugin({ worker: port1, type: 'json' })])
  try {
    const chunk = await registry.encode({ title: 'report', count: 2 })
    const value = (await registry.decode(chunk)) as { title: string; count: number }
    console.log('数据块：', chunk[0])
    console.log('恢复：', value.title, value.count)
  } finally {
    await registry.dispose()
    port1.close()
    await worker.terminate()
  }
}
```

输出：

```text
数据块： text
恢复： report 2
```

依次输出 `数据块： text`、`恢复： report 2`：工作端 JSON 解析器返回文本块，并恢复了原有字段。

显式 `type: 'json'` 覆盖默认 `'worker'`，`ownership` 默认 `'copy'`，`terminateOnDispose` 默认 `false`。注册表释放解析器端点，原生端口与 Worker 仍由调用方关闭；这里证明接线，不作速度结论。

## 取消解码时保留输入字节

输入字节可能还要留给下一次重试，当前解码却可能在发送前就不再需要。

转移共用的底层缓冲区可能让所有视图失效；把取消一律当成已经分离，也会丢弃根本没有发送的输入。

为真实 Worker JSON 解析器使用 `workerParser` 的默认复制策略，先完成一次解码，再传入预先中止的信号，检查失败原因和原字节后决定是否重试。

### 示例参数

`workerParser({ worker: port1 })` 使用默认 `type: 'worker'`、`ownership: 'copy'`、`clientId: 'main'` 和 `terminateOnDispose: false`。`decode` 接收 `['bytes', bytes]` 与上下文；`signal` 控制此次调用，`context: 'settings'` 为诊断名称。第二次调用前已取消，原始 `DOMException` 保留在 `cause`，输入未被发送或分离；这不证明在途计算能够被强制中断。

```ts doc-test=run
import {
  Worker,
  MessageChannel,
  workerData,
  isMainThread,
  threadId,
  type MessagePort
} from 'node:worker_threads'
import { jsonParser } from '@migaia/serialize/plugins'
import { createSerializeWorkerHandler, workerParser } from '@migaia/store-worker/serialize/worker'

if (!isMainThread) {
  const port = workerData as MessagePort
  const handler = createSerializeWorkerHandler(jsonParser(), (message, transfer) =>
    port.postMessage(message, transfer as Parameters<typeof port.postMessage>[1])
  )
  port.on('message', (message) => void handler(message).catch(console.error))
} else {
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL(import.meta.url), { workerData: port2, transferList: [port2] })
  port1.start()
  const parser = workerParser({ worker: port1 })
  const bytes = new TextEncoder().encode('{"count":2}')
  try {
    const context = { signal: new AbortController().signal, context: 'settings' }
    const value = (await parser.decode(['bytes', bytes], context)) as { count: number }
    console.log('解码：', value.count, bytes.byteLength)
    const controller = new AbortController()
    const reason = new DOMException('已不再需要此次请求', 'AbortError')
    controller.abort(reason)
    const failure = (await Promise.resolve(
      parser.decode(['bytes', bytes], {
        signal: controller.signal,
        context: 'settings'
      })
    ).catch((error: unknown) => error)) as Error & { code?: string }
    console.log('已取消：', failure.code, failure.cause === reason)
    console.log('输入：', new TextDecoder().decode(bytes))
  } finally {
    await parser.dispose?.()
    port1.close()
    await worker.terminate()
  }
}
```

输出：

```text
解码： 2 11
已取消： REQUEST_ABORTED true
输入： {"count":2}
```

依次输出 `解码： 2 11`、`已取消： REQUEST_ABORTED true`、`输入： {"count":2}`。

默认所有权策略为 `'copy'`；本次预取消保留调用方的原始原因且不发送工作，不证明已经运行的计算会被抢占中断。显式转移和字节分离同样不代表载荷实现了零拷贝。

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
| disposed  | close / dispose 后立即为 true。                                                             |
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
| disposed         | close / dispose 后立即为 true。                                                    |
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

STORE_WORKER_SOURCE 为 store.worker。createStoreWorkerError(code, message, options?) 接收必填码和消息，可选 options.cause，返回带身份的 Error；createStoreWorkerAggregateError(code, errors, message) 返回 AggregateError，保留 errors 顺序和原值。code 类型为 IStoreWorkerErrorCode，工厂不覆盖 stack。外包完整身份继续由原 owner 负责。

### 排查与维护

请求一直等待时先检查真实 message.data 是否交给正确 handler，再看 WorkerAdapter.timeoutMs / 调用 signal；workerParser 只能用已有 context.signal，没有 parser.timeoutMs。Chunk 多段问题应按增量迭代处理，不套用旧“Worker 内先合并单段”的做法。释放端点后 Worker 仍存活通常是借用所有权：通用路径由创建者 terminate，序列化可选择 terminateOnDispose，但仍不等于确认原生退出。

包已有 fmt / lint / typecheck / typecheck:test / test / build，以及 typecheck:e2e / test:e2e。浏览器 e2e 需要已安装 Playwright 浏览器；本轮 Node 场景不冒充浏览器授权或多宿主证据。实际报告说明哪些命令运行与通过，不把命令列表或旧性能记录当成当前验证结论。
