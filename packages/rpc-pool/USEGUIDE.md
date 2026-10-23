# @migaia/rpc-pool 使用指南

下面六个场景使用 Node 24 的真实 Worker 或子进程，通过公开 Peer 工厂运行；Peer 是已接通远端业务方法的连接；先选任务，再查后面的完整参数与生命周期约定。线程与进程工厂是两个实际创建入口，resize 场景使用它们返回的公开控制方法。

## 按场景查找

| 场景                             | 组合入口            | 详细说明                                      |
| -------------------------------- | ------------------- | --------------------------------------------- |
| 把调用分配给独立的原生 Worker    | `createThreadPool`  | [完整示例](#把调用分配给独立的原生-worker)    |
| 限制等待任务并取消其中一项       | `createThreadPool`  | [完整示例](#限制等待任务并取消其中一项)       |
| 缩减空闲容量而不中断在用的流     | `pool.resize`       | [完整示例](#缩减空闲容量而不中断在用的流)     |
| 用真实子进程处理池化业务调用     | `createProcessPool` | [完整示例](#用真实子进程处理池化业务调用)     |
| 关闭时完成已接纳工作并拒绝新调用 | `createProcessPool` | [完整示例](#关闭时完成已接纳工作并拒绝新调用) |
| 保留原 Peer 失败而不重放调用     | `createProcessPool` | [完整示例](#保留原-peer-失败而不重放调用)     |

## 运行准备

安装本包和三个必需 peer 依赖；示例直接使用 threads 或 process 的子端判断和方法发布。

```bash
pnpm add @migaia/rpc-pool @migaia/rpc-core @migaia/rpc-process @migaia/rpc-threads
```

每个示例保存为独立的 ESM TypeScript 文件，用 Node 24 执行；不要放在交互式标准输入中。spawn: true 重新执行同一入口，必须先判断子端分支，子端只安装业务方法，父端才创建池。线程示例产生真实 Worker，进程示例产生真实 child process；finally 等待池关闭，由原 Peer 释放它拥有的物理资源。Node 的结果不代替其他运行时或系统的验证。

短进程 source 可能经原 reporter 报告 supervision 的 CAPABILITY_UNSUPPORTED 提示，指出 process termination 不受支持并按 best-effort 降级；这不阻止已成功建立的业务调用，也不承诺整棵进程树的强制终止。池保留该原 owner 的诊断，不隐藏提示或增加另一套终止策略。

## 把调用分配给独立的原生 Worker

独立任务需要多个 Worker，调用方却不想每次选择线程或重复执行启动逻辑。

所有工作共用一个客户端可能意外串行；每次调用都新建 Worker，又会反复取得资源，并失去固定容量限制。

用 `createThreadPool` 建立两个成员，在真实 `ThreadPeer` 子线程分支提供方法；顺序读取两次身份可核对空闲成员轮转，统计值描述客户端操作槽，不是远端计算并发。

### 示例参数

`spawn: true` 必填并重跑当前入口；`await isThreadChild()` 先区分子线程，再由 `createThreadPeer({ provide: ... })` 安装无参数的 `identity` 方法。`size: 2` 创建两个成员；省略的 `maxQueue` 为 `256`、`idleTimeoutMs` 为 `undefined`、`scheduler` 为 `systemScheduler`、`probe` 为 `undefined`。`pool.request('identity')` 没有业务载荷或额外调用选项，依次读取可核对空闲轮转。`IWorkerApi` 仅给调用端提供静态方法类型。

```ts doc-test=run
import { createThreadPool } from '@migaia/rpc-pool'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'
import { threadId } from 'node:worker_threads'

type IWorkerApi = { identity(): { pid: number; threadId: number } }
if (await isThreadChild()) {
  await createThreadPeer({ provide: { identity: () => ({ pid: process.pid, threadId }) } })
} else {
  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 2 })
  try {
    const first = await pool.request('identity')
    const second = await pool.request('identity')
    console.log('工作线程：', first.threadId !== second.threadId)
    console.log('所在进程：', first.pid === process.pid, second.pid === process.pid)
    const stats = pool.stats()
    console.log(
      '池状态：',
      stats.targetSize,
      stats.memberCount,
      stats.inFlight,
      stats.queued,
      stats.state
    )
  } finally {
    await pool.close()
  }
}
```

输出：

```text
工作线程： true
所在进程： true true
池状态： 2 2 0 0 open
```

依次输出 `工作线程： true`、`所在进程： true true`、`池状态： 2 2 0 0 open`：两个不同的原生线程共享父进程，调用完成后操作槽恢复空闲。

`size` 必填，`maxQueue` 默认 `256`，`idleTimeoutMs` 默认 `undefined`，`scheduler` 默认 `systemScheduler`；启动、通信和监督仍归原 Peer，池不再增加一套原生恢复机制。

## 限制等待任务并取消其中一项

成员槽已经占满，新调用还在继续进入，其中一项排队请求也已不再需要。

无界等待列表会继续保留过时工作；取消时若没有移除对应的队列项，可能占着等待容量，或误删其他调用方的任务。

用真实流持有唯一客户端槽，把 `maxQueue` 设为 `1`，再用请求自己的信号取消排队项；额外调用在派发前被拒绝，归还流后才释放活跃槽。

### 示例参数

`size: 1` 只提供一个客户端槽，`maxQueue: 1` 把等待容量从默认 `256` 覆盖为 `1`。`pool.stream('values')` 创建无参数惰性流，首次 `next()` 后占槽；即使 provider 已生成后续项，消费方仍须完成或归还流。`request('echo', 7, { signal })` 的 `signal` 来自独立 AbortController；`abort(reason)` 把此原对象保留为排队失败的 `cause`。额外的 `echo(9)` 没有进入远端；未配置闲置回收或池级排队期限。

```ts doc-test=run
import { createThreadPool } from '@migaia/rpc-pool'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IWorkerApi = { values(): AsyncIterableIterator<number>; echo(value: number): number }
if (await isThreadChild()) {
  await createThreadPeer({
    provide: {
      values: async function* () {
        yield 1
        yield 2
      },
      echo: (value: number) => value
    }
  })
} else {
  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 1, maxQueue: 1 })
  const stream = pool.stream('values')
  try {
    console.log('尚未读取：', pool.stats().inFlight)
    await stream.next()
    const controller = new AbortController()
    const queued = pool
      .request('echo', 7, { signal: controller.signal })
      .catch((error: unknown) => error)
    const overflow = await pool.request('echo', 9).catch((error: unknown) => error)
    console.log(
      '容量：',
      pool.stats().inFlight,
      pool.stats().queued,
      (overflow as { code?: string }).code
    )
    const reason = new Error('已不再需要排队请求')
    controller.abort(reason)
    const failure = (await queued) as Error & { code?: string }
    console.log('已取消：', failure.name, failure.code, failure.cause === reason)
    console.log('等待项：', pool.stats().queued)
    await stream.return?.()
    console.log('已释放：', pool.stats().inFlight)
  } finally {
    await stream.return?.()
    await pool.close()
  }
}
```

输出：

```text
尚未读取： 0
容量： 1 1 QUEUE_FULL
已取消： AbortError CALL_ABORTED true
等待项： 0
已释放： 0
```

依次输出 `尚未读取： 0`、`容量： 1 1 QUEUE_FULL`、`已取消： AbortError CALL_ABORTED true`、`等待项： 0`、`已释放： 0`。

本次取消发生在池队列中，`cause` 保留同一个原始原因；已经派发的取消归原 Peer。`maxQueue` 默认 `256`，设为 `0` 禁止等待；创建流不占槽，首次读取后直到完成或归还才释放。

## 缩减空闲容量而不中断在用的流

一条流仍在使用某个成员，应用却需要调低池容量。

任意关闭成员可能中断已经接纳的工作；只改一个容量数字，又可能一直留下不再需要的原生 Worker。

等待 `resize` 完成真实扩缩容；缩容优先释放空闲成员并等待其原 Peer 清理，保留的忙成员继续提供流，归还流后才释放客户端槽。

### 示例参数

`resize(2)` 与 `resize(1)` 的正整数均必填，分别扩到两个成员、再回到一个。流创建时尚未占槽，第一次读取后才进入 `inFlight`；本例缩容可以回收另一个空闲成员，因此保留该流继续读取。若只能回收忙成员，resize 会等其操作结束。省略的 `maxQueue` 为 `256`，`idleTimeoutMs` 为 `undefined`，scheduler 为 `systemScheduler`；`stats` 的三项是目标、已取得成员和客户端在用槽。

```ts doc-test=run
import { createThreadPool } from '@migaia/rpc-pool'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

type IWorkerApi = { values(): AsyncIterableIterator<number> }
if (await isThreadChild()) {
  await createThreadPeer({
    provide: {
      values: async function* () {
        yield 1
        yield 2
      }
    }
  })
} else {
  const pool = await createThreadPool<IWorkerApi>({ spawn: true, size: 1 })
  const stream = pool.stream('values')
  try {
    await pool.resize(2)
    console.log('扩容：', pool.stats().targetSize, pool.stats().memberCount)
    console.log('第一项：', (await stream.next()).value)
    await pool.resize(1)
    console.log('缩容：', pool.stats().targetSize, pool.stats().memberCount, pool.stats().inFlight)
    console.log('继续读取：', (await stream.next()).value)
    await stream.return?.()
    console.log('已释放：', pool.stats().inFlight)
  } finally {
    await stream.return?.()
    await pool.close()
  }
}
```

输出：

```text
扩容： 2 2
第一项： 1
缩容： 1 1 1
继续读取： 2
已释放： 0
```

依次输出 `扩容： 2 2`、`第一项： 1`、`缩容： 1 1 1`、`继续读取： 2`、`已释放： 0`。

`resize` 必填正整数大小，没有默认值，多次调整按调用顺序执行；若必须回收忙成员，会等待它已接纳的操作结束，池不额外强行中断工作，也不添加排空期限。

## 用真实子进程处理池化业务调用

有些任务需要单独的进程，调用方又希望继续使用普通 Peer 的类型化请求接口。

把 Worker 线程当成进程，并不会产生独立 PID；用本地对象代替原生创建，也无法证明进程归属。

用带子进程分支的入口创建 `createProcessPool`，让真实 `ProcessPeer` 发布方法；先调用业务方法，再沿同一个公开请求路径读取两个成员的 PID。

### 示例参数

`spawn: true` 重跑当前入口，`isProcessChild()` 在子进程中建立带 `provide.double` 和 `provide.identity` 的真实 Peer。`size: 2` 是必填目标容量；`double(21)` 返回 `42`，两次 `identity()` 核对不同 PID。没有提供 `probe`、闲置回收或调用选项；`maxQueue` 默认 `256`、scheduler 默认 `systemScheduler`。Process 选项保留原 Peer 类型，不接受 Thread 转移列表。

```ts doc-test=run
import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { double(value: number): number; identity(): number }
if (isProcessChild()) {
  await createProcessPeer({
    provide: {
      double: (value: number) => value * 2,
      identity: () => process.pid
    }
  })
} else {
  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 2 })
  try {
    console.log('结果：', await pool.request('double', 21))
    const first = await pool.request('identity')
    const second = await pool.request('identity')
    console.log('子进程：', first !== process.pid, second !== process.pid, first !== second)
    console.log('成员数：', pool.stats().memberCount)
  } finally {
    await pool.close()
  }
}
```

输出：

```text
结果： 42
子进程： true true true
成员数： 2
```

依次输出 `结果： 42`、`子进程： true true true`、`成员数： 2`：两个成员的 PID 都不同于父进程，也彼此不同。

`spawn` 和 `size` 必填，`spawn: true` 重跑带分支判断的入口；进程调用选项保留原类型，不接受线程专有的转移列表。这里是 Node 24 进程结果，不代替其他运行时或系统的验证。

## 关闭时完成已接纳工作并拒绝新调用

应用开始关闭时，一条流仍在使用成员，后面还排着已经接纳的请求。

立即停掉所有进程会丢掉已接纳工作；继续接收新调用，又会让关闭无法收敛。

调用 `close` 停止新接纳并保存其共享 Promise，显式结束活跃流，让原先排队的请求完成；等待关闭 Promise 后再确认池持有的进程已释放。

### 示例参数

`size: 1` 让活跃流持有唯一槽，`request('double', 21)` 进入默认容量 `256` 的等待队列。`close()` 与 `stats()` 都无参数；close 同步进入 `closing`，重复调用复用 Promise，并拒绝新的 `double(1)`。`stream.return()` 显式结束流，让先前已接纳的请求得到槽；池没有额外排空期限。`finally` 仍观察关闭结果，不把发起关闭等同于关闭完成。

```ts doc-test=run
import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { values(): AsyncIterableIterator<number>; double(value: number): number }
if (isProcessChild()) {
  await createProcessPeer({
    provide: {
      values: async function* () {
        yield 1
        yield 2
      },
      double: (value: number) => value * 2
    }
  })
} else {
  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 1 })
  const stream = pool.stream('values')
  try {
    await stream.next()
    const accepted = pool.request('double', 21)
    const closing = pool.close()
    console.log('关闭中：', pool.stats().state, closing === pool.close(), pool.stats().queued)
    const rejected = await pool.request('double', 1).catch((error: unknown) => error)
    console.log('新任务：', (rejected as { code?: string }).code)
    await stream.return?.()
    console.log('已接纳：', await accepted)
    await closing
    console.log('已关闭：', pool.stats().state, pool.stats().memberCount)
  } finally {
    await stream.return?.()
    await pool.close()
  }
}
```

输出：

```text
关闭中： closing true 1
新任务： POOL_CLOSED
已接纳： 42
已关闭： closed 0
```

依次输出 `关闭中： closing true 1`、`新任务： POOL_CLOSED`、`已接纳： 42`、`已关闭： closed 0`。

`close` 无参数，重复调用返回同一 Promise，不添加池级排空超时；长流可能让关闭继续等待，应消费、归还或取消它。尚未开始读取的流没有取得操作槽，不阻碍关闭。

## 保留原 Peer 失败而不重放调用

子进程已经进入业务方法后失败，重新执行这个方法可能重复其副作用。

给所有失败换上池错误码，会隐藏原来的错误归属；静默重放失败操作，又可能让一次调用执行多遍。

由 `createProcessPool` 透传原 Peer 的拒绝，检查返回的原生 `TypeError` 及其 `RangeError` 原因，再查询真实子进程中的执行次数，确认这次失败业务调用只进入了一次。

### 示例参数

`provide.fail` 先增加进程内计数，再抛出一个 `TypeError`，其 `cause` 为 `RangeError`；两个错误都是业务夹具，池没有重新分类。`size: 1` 确保后面的 `attempts()` 查询仍落在同一进程。比较 `RPC_POOL_ERROR_SOURCE` 用于识别失败不归池；本例顶层即恢复后的原生 `TypeError`，`cause` 为 `RangeError`，接收端不要求与子进程原对象具有相同 identity。未设置额外请求选项，原 Peer 期限和恢复策略仍生效。

```ts doc-test=run
import { createProcessPool, RPC_POOL_ERROR_SOURCE } from '@migaia/rpc-pool'
import { createProcessPeer, isProcessChild } from '@migaia/rpc-process'

type IServiceApi = { fail(): never; attempts(): number }
if (isProcessChild()) {
  let attempts = 0
  const root = new RangeError('金额无效')
  const failure = new TypeError('金额计算失败', { cause: root })
  await createProcessPeer({
    provide: {
      fail: () => {
        attempts += 1
        throw failure
      },
      attempts: () => attempts
    }
  })
} else {
  const pool = await createProcessPool<IServiceApi>({ spawn: true, size: 1 })
  try {
    const failure = (await pool.request('fail').catch((error: unknown) => error)) as Error & {
      source?: string
    }
    const primary = failure
    console.log('远端错误：', failure.name, failure.source !== RPC_POOL_ERROR_SOURCE)
    console.log('原生错误：', primary instanceof TypeError, primary.message)
    console.log('原因：', primary.cause instanceof RangeError)
    console.log('执行次数：', await pool.request('attempts'))
  } finally {
    await pool.close()
  }
}
```

输出：

```text
远端错误： TypeError true
原生错误： true 金额计算失败
原因： true
执行次数： 1
```

依次输出 `远端错误： TypeError true`、`原生错误： true 金额计算失败`、`原因： true`、`执行次数： 1`。

本例失败来自 Peer，池只给自己持有的接纳和清理失败附加池错误码；这里证明业务失败没有重放，没有模拟进程崩溃。原生重启策略仍归原 `ProcessPeer` 启动来源，池不会自动重放失败工作。

## 契约细节

### 职责、入口与所有权

本包把公开 `createThreadPeer` / `createProcessPeer` 创建的连接组合成池，分配客户端操作槽并管理有限等待队列。通信、方法目录、握手、认证、请求关联、取消、期限、原生启动、监督与重启继续由对应 Peer 负责；池不另建原生线程调度器或 RPC 协议，也没有工作窃取、跨机器池或 Proxy 调用面。

唯一入口是 `rpc.pool`。运行时公开 createThreadPool、createProcessPool、RpcPoolState、RpcPoolErrorCode、RPC_POOL_ERROR_SOURCE；类型包括 IThreadPool、IProcessPool、各自 options、IRpcPoolControls、IRpcPoolStats 与 IRpcPoolErrorCode。内部 createPool、校验和错误注记工具不作为业务出口。池的运行时依赖是 lifecycle / utils，三个 RPC 包 core / process / threads 是必需 peer 依赖；直接使用这些包的 API 时也应直接安装。

池拥有自己创建的 Peer、本地 FIFO 和闲置计时任务；没有让应用接管内部 Native 句柄、握手、admission 或 trust 的入口。关闭成员只调用原 Peer.close，由原 owner 执行端口、Worker / 进程和监督资源的清理。

### 工厂与选项

`createThreadPool<TRemote>(options)` 和 `createProcessPool<TRemote>(options)` 异步返回池，初始成员批次全部取得后才交给调用方。远端类型默认 `Record<never, never>`，由应用声明业务方法；该泛型不是运行时 schema 或远端方法安装。

| 字段          | 默认、可选值与行为                                                            |
| ------------- | ----------------------------------------------------------------------------- |
| spawn         | 必填且不能为 null / undefined；原值交给对应公开 Peer 工厂。                   |
| size          | 必填正整数；这是目标成员数，不是 provider 并发数。                            |
| maxQueue      | 256，非负整数；0 表示所有槽忙时不允许等待。                                   |
| idleTimeoutMs | undefined，不做闲置回收；配置时为有限正数且不大于 2147483647 毫秒，允许小数。 |
| scheduler     | systemScheduler；只控制池的闲置计时。                                         |
| probe         | undefined；接受原 Peer 的单个 Probe 或只读 Probe 数组，原值转交每个成员。     |

非法 options 结构、缺少 spawn 或不正确的数值类型以 TypeError / INVALID_OPTIONS 拒绝；数值超出 size、maxQueue、idleTimeoutMs 的范围以 RangeError / INVALID_OPTIONS 拒绝，发生在原生工厂取得资源之前。这里没有额外的 safe-integer 要求，也没有 size 的自动默认值。scheduler 通过 lifecycle 的既有入口在原生工厂调用前捕获和校验，失败保留该 owner 的 source / code 与原因，不改成池错误；不要把这一点扩大为所有 options 字段的一次性深快照。

Thread 的 spawn 保留原工厂支持的 true、入口路径 / URL 与 source 配置；Process 同样保留其入口、运行时、权限和 wire 规则。不同程序可以用不同入口；Process 的外语 JSON-RPC source 仍使用原 `{ command, args, wire: 'jsonrpc', contract }`。这些 source 的字段属于相应工厂，不是池新定义的启动协议。

`spawn: true` 会重新执行主入口，必须先用原 `await isThreadChild()` 或 `isProcessChild()` 区分子端，避免再次建池。相对字符串按主入口目录解释，URL 精确定位入口；浏览器线程沿原 URL 规则。Node 的 TypeScript 去类型不会把源码中的 .js 导入改写为 .ts，需使用可运行的编译输出或适当 loader。只通过主机权限、入口和 native lifetime 约束允许的原生路径启动。

### request、notify、stream 与路由

两个池都直接提供 request / notify / stream，参数与返回类型分别取自 Thread / Process 的公开 Peer；没有池专用的 payload 包装或 Proxy。方法、原始 payload 和派发后的 options 对象原样交给被选 Peer。Thread 保留其转移列表类型和认证边界，Process 的调用选项不接受 Thread 转移列表。

每个成员只占一个客户端操作槽，空闲成员优先，平局轮转；所有槽忙时，后续操作进入有限 FIFO，新调用不越过已等待的项。这里的“最少 in-flight”只有空闲与占用两种槽状态，不是按远端计算成本、CPU、provider 并发或队列长度做原生负载预测。后续调用可能使用不同成员，池不建立全池 sticky session、业务去重或跨成员顺序协议。

| 操作                                | 何时占槽与释放                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| request(method, payload?, options?) | 接纳时占槽，原 Peer 请求 Promise 成功或失败后释放。                               |
| notify(method, payload?, options?)  | 接纳时占槽，原发送 Promise 结算后释放；不是 provider 业务完成回执。               |
| stream(method, payload?, options?)  | 返回惰性异步 iterator，首次 next 才接纳并占槽；done、return、throw 或失败后释放。 |

未开始的 stream 不创建原生 consumer、不占槽，也不阻碍 close。开始后的长流必须继续消费、调用 return / throw，或让原 Peer 的 signal 取消并完成 iterator，才能释放其槽；调用 stream 本身不是一次已发送操作。多个 next 按顺序处理，return / throw 可转交给正在等待的原 iterator，不排在被阻塞的 next 之后。

所有槽忙且等待队列达到 maxQueue 时，新操作拒绝 QUEUE_FULL，不派发业务调用。闲置回收后，新任务可先占据尚在创建的补充槽，不因为暂时没有已就绪成员就必然占 FIFO；初始化中的已接纳操作仍受池拥有和排空。

### 等待取消与原 Peer 期限

池只在等待 FIFO 时拥有 signal 监听器，取消只删除对应的等待项并释放其接纳计数。此时失败为原生 DOMException / AbortError，source 为本包，code 为 CALL_ABORTED，cause 保留原 signal.reason。派发时解除池的取消监听，再把原 options / signal 交给 Peer；已经派发的取消、deadline 与错误由原 Peer 决定，不重建错误对象。

timeoutMs 从操作交给原 Peer 时按其规则计算，等待 FIFO 不另建队列 deadline，也不消耗或缩短这个相对超时。需要限制排队时间时，应用可通过自己的 AbortSignal 取消等待；不要把队列容量当成等待期限。关闭池不会自动取消已经接纳的业务。

### stats 与状态

stats() 无参数，每次返回一个新的浅冻结快照；关闭后仍可读取。它测量本池客户端操作，不是远端 provider concurrency 或 Native CPU 利用率。

| 字段        | 含义                                                                           |
| ----------- | ------------------------------------------------------------------------------ |
| targetSize  | 当前目标容量；idle retirement 不改变目标，resize 才改变。                      |
| memberCount | 已取得实际 Peer 的成员数，可能含尚未清理完的退休成员；不含尚在获取 Peer 的槽。 |
| inFlight    | 已取得 Peer 且被本池操作占用的槽数；不是远端业务并发。                         |
| queued      | 当前 FIFO 中等待分配槽的项数，不含已经预留的创建中槽。                         |
| state       | RpcPoolState.open / closing / closed。                                         |

RpcPoolState 是公开值对象：open 可接纳，closing 只排空已接纳工作，closed 表示成员清理已全部尝试；它描述池的接纳生命周期，不代表每个 Native supervisor 的健康状态。

### resize 与闲置回收

resize(size) 只接收一个必填正整数，返回 Promise；非法值按相同 INVALID_OPTIONS 规则拒绝，关闭后拒绝 POOL_CLOSED。操作按调用顺序执行，前一次拒绝不毒化后一次；close 已进入 closing 时，尚未开始的 resize 也会拒绝。

扩容只补目标差额；失败时回滚新取得的批次并恢复原目标（池仍 open 时），原有成员不被无条件重建。缩容先选空闲成员，忙成员标记退休后等待当前操作结束，再调用原 Peer.close；不会为缩容抢占在途业务。连续扩缩的实际完成点可能等待这些原操作和清理。

idleTimeoutMs 已配置时，只有池仍 open、成员空闲且没有等待需求时才安排其闲置任务。占槽、退休和 close 取消旧任务；其他成员的活动不会重置该成员已经开始的闲置时长。到期沿原 Peer.close 退休，目标容量不变；后续任务经原公开工厂补到目标。获取的任务句柄会尝试调用可选 unref，让 housekeeping 自身不必维持宿主存活；它不改变期限长度。

注入手动 scheduler 可以控制这些闲置到期，不能推进成员自己的监督、握手或请求期限。池接纳 scheduler 及其方法后使用已捕获的能力，不替换原 spawn source 的 supervisor scheduler。

### close、启动失败与恢复

close() 无参数，第一次调用同步进入 closing，停止新的 request / notify、首次 stream.next 和 resize；重复调用返回同一个 Promise。它等待已接纳的活动操作、FIFO、创建批次和 resize 收尾，然后尝试关闭全部成员。清理全部尝试后进入 closed；有失败时，该同一 Promise 以 CLOSE_FAILED AggregateError 拒绝，errors 保留各原失败，cause 指向第一个。

本包没有单独的 drainTimeoutMs 或强制停止计时，未结束的已接纳请求、发送、流或获取会延长排空，可能一直等待。取消或完成业务要按原 Peer / iterator 契约安排，不能把 close 当作抢占式取消。

初始或扩容 / 补充批次部分启动失败时，已取得的 Peer 都尝试关闭；原 primary 按该批工厂输入顺序选取，不按拒绝发生的先后重写。rollback 清理失败通过原默认 reporter 报告，不取代 primary。没有可用存活槽的冷补充失败也会拒绝关联等待项，保留原失败；池不无限重试创建。

成员 Native 崩溃由原 supervisor 按原 source 的预算和重启策略恢复；裸 spawn 沿原 on-failure 与五次预算默认，用户配置不会被池重置。恢复期间原 Peer 可拒绝 CLOSED，恢复后未来新调用继续使用原 Peer。失败的业务调用不会自动重放；重启不证明业务具备 at-most-once 或持久投递保证。

probe 原值转交成员，真实 handshake、ready、restart 仍由原 Peer 发出。共享 Probe 时用 endpointId 区分成员；seq 仍属于各端点，不是全池统一序号。Probe 回调若读可复用 view，应按其 owner 规则在同步回调内读取或提取需要的值。

### 错误与支持环境

| RpcPoolErrorCode 属性 / 值       | 场景                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| invalidOptions / INVALID_OPTIONS | 非法创建或 resize 参数，原生 TypeError / RangeError。                  |
| poolClosed / POOL_CLOSED         | closing / closed 时接纳新操作。                                        |
| queueFull / QUEUE_FULL           | 有限等待 FIFO 已满，未发送业务调用。                                   |
| callAborted / CALL_ABORTED       | 仍在 FIFO 中的操作被 signal 取消，原生 AbortError，cause 为原 reason。 |
| closeFailed / CLOSE_FAILED       | 全部成员清理已尝试后的 AggregateError。                                |

RPC_POOL_ERROR_SOURCE 为 `rpc.pool`，IRpcPoolErrorCode 是以上公开值联合。Peer 向池交出的原错误保留自己的 source / code、实例与原因链，池不替它们重新分类；启动失败与清理聚合仍可沿 cause / errors 到达原失败。状态值不是错误码。

短进程 source 可能经原 reporter 报告 supervision 的 CAPABILITY_UNSUPPORTED 提示，指出 process termination 不受支持并按 best-effort 降级；这不阻止已成功建立的业务调用，也不承诺整棵进程树的强制终止。池保留该原 owner 的诊断，不隐藏提示或增加另一套终止策略。

支持环境继承对应工厂。示例使用 Node 24 的真实 Worker / child process；Bun、Deno、浏览器线程、Electron 和 Windows 仍受原入口、权限、载体及原生生命周期限制，Node 结果不构成这些环境的运行证据。包已有 fmt、lint、typecheck、typecheck:test、build 和带 coverage 的 test 脚本，命令清单不表示本页或本轮已运行它们。
