# `@migaia/rpc-pool`

把真实线程或进程连接组合成有容量上限的池，让业务调用、等待队列、扩缩容和排空各有明确的完成点。

## 你可能遇到过

- 创建了多个 Worker，请求却仍挤在同一个上：手写轮转没有记录成员是否正被使用。
- 高峰时等待任务越来越多：只维护一个无限数组，没有接纳上限，也没移除取消的排队项。
- 缩容时正在读取的流突然断了：回收逻辑直接终止成员，没有等待其当前操作完成。
- 应用开始关闭后还接到了新任务：接纳与排空没有分开，清理顺序也无法等待。
- 子进程失败后，同一业务又执行了一次：恢复连接与重放失败业务被混成了同一件事。

## 为什么选它

- **把独立操作分给真实空闲线程。** 每个成员保留一个客户端操作槽并轮转空闲成员，[把调用分配给独立的原生 Worker](./USEGUIDE.md#把调用分配给独立的原生-worker) 用原生线程标识核对分配结果。
- **等待有上限，取消只移除对应任务。** 有限 FIFO 在派发前拒绝溢出并保留排队取消原因，[限制等待任务并取消其中一项](./USEGUIDE.md#限制等待任务并取消其中一项) 用真实流占槽验证这些边界。
- **缩容不抢占已经接纳的流。** resize 优先回收空闲成员并等待忙成员结束，[缩减空闲容量而不中断在用的流](./USEGUIDE.md#缩减空闲容量而不中断在用的流) 展示了在途迭代和最终容量。
- **关闭先停止接纳，再完成已接受工作。** close 立即进入 closing 并复用同一 Promise，[关闭时完成已接纳工作并拒绝新调用](./USEGUIDE.md#关闭时完成已接纳工作并拒绝新调用) 同时核对拒新和排空结果。
- **失败保持原原因，不自动重放业务。** 池直接调用原连接并原样传播失败，[保留原 Peer 失败而不重放调用](./USEGUIDE.md#保留原-peer-失败而不重放调用) 检查了原生原因链和实际执行次数。

## 从这里开始

下面使用 Node 24 的真实 Worker；保存为独立 ESM TypeScript 文件执行，子线程会重新加载该文件。先安装本包与必需的三个 peer 依赖：

```bash
pnpm add @migaia/rpc-pool @migaia/rpc-core @migaia/rpc-process @migaia/rpc-threads
```

```ts doc-test=run
import { createThreadPool } from '@migaia/rpc-pool'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'
if (await isThreadChild()) {
  await createThreadPeer({ provide: { double: (value: number) => value * 2 } })
} else {
  const pool = await createThreadPool<{ double(value: number): number }>({ spawn: true, size: 1 })
  try {
    console.log(await pool.request('double', 21))
  } finally {
    await pool.close()
  }
}
```

输出：

```text
42
```

多成员分配看[把调用分配给独立的原生 Worker](./USEGUIDE.md#把调用分配给独立的原生-worker)，等待上限与取消看[限制等待任务并取消其中一项](./USEGUIDE.md#限制等待任务并取消其中一项)。

## 手写时的隐患

下面只展示原生 Worker 上的手写轮转，检查类型但不运行：

```ts doc-test=check
import type { Worker } from 'node:worker_threads'

const makeDispatcher = (workers: readonly Worker[]) => {
  let cursor = 0
  return {
    send(value: number) {
      const worker = workers[cursor++ % workers.length]!
      worker.postMessage(value) // 隐患：不看成员是否忙，也没有有限等待队列。
      // 隐患：没有请求关联与失败结算，发送不代表业务完成。
    },
    close() {
      for (const worker of workers) void worker.terminate() // 隐患：没有排空已接纳工作。
    }
  }
}
void makeDispatcher
```

上一节用 request 等待原连接的业务结果，池记录占槽与等待项；close 则停止接纳、排空工作，再沿原连接的所有权清理。

## 三分钟心智模型

| 遇到什么问题               | 用什么                                           |
| -------------------------- | ------------------------------------------------ |
| 同一种线程程序需要多个成员 | createThreadPool，spawn 交给原线程工厂。         |
| 需要独立进程承载业务       | createProcessPool，保留原进程入口与 wire 规则。  |
| 一个结果或一个通知         | request 等业务结果，notify 只等发送。            |
| 连续结果或容量变化         | stream 从首次 next 占槽，resize 等待安全退休。   |
| 应用结束                   | close 停止接纳并等待排空，stats 查看当前池状态。 |

Peer 是已经接通远端方法的连接，原工厂负责发现和目录交换；成员是池拥有的一个 Peer。槽只表示本池的一次客户端操作，FIFO 是按先来后到等待槽的队列，排空是等待已经接受的操作结算；这些都不是远端 CPU 或 provider 并发指标。

## 典型场景

| 场景                     | 怎么组合                                           | 详细说明                                                                           |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 分配调用到多个真实线程   | createThreadPool → request × 2 → stats → close     | [把调用分配给独立的原生 Worker](./USEGUIDE.md#把调用分配给独立的原生-worker)       |
| 高峰拒绝溢出并取消等待   | stream.next → request → AbortController → return   | [限制等待任务并取消其中一项](./USEGUIDE.md#限制等待任务并取消其中一项)             |
| 缩容时继续消费在途流     | stream.next → resize → stream.return → stats       | [缩减空闲容量而不中断在用的流](./USEGUIDE.md#缩减空闲容量而不中断在用的流)         |
| 用独立子进程执行计算     | createProcessPool → request → close                | [用真实子进程处理池化业务调用](./USEGUIDE.md#用真实子进程处理池化业务调用)         |
| 应用关闭时保留已接受工作 | request / stream → close → 拒绝新请求 → 完成旧工作 | [关闭时完成已接纳工作并拒绝新调用](./USEGUIDE.md#关闭时完成已接纳工作并拒绝新调用) |
| 追查业务失败且不重复执行 | request.catch → cause → 再请求执行次数             | [保留原 Peer 失败而不重放调用](./USEGUIDE.md#保留原-peer-失败而不重放调用)         |

## 安装

```bash
pnpm add @migaia/rpc-pool @migaia/rpc-core @migaia/rpc-process @migaia/rpc-threads
```

三个 RPC 包都是必需 peer 依赖，直接安装如上。Node 引擎要求为 24 或更新版本，唯一入口为 `@migaia/rpc-pool`。其他宿主支持继承对应 Peer 工厂，不能由 Node 示例推断。

## 常用 API

| API                   | 用途                                   |
| --------------------- | -------------------------------------- |
| createThreadPool      | 创建拥有真实 Thread Peer 的池。        |
| createProcessPool     | 创建拥有真实 Process Peer 的池。       |
| pool.request / notify | 等业务结果或原始发送完成。             |
| pool.stream           | 首次 next 才接纳的异步结果流。         |
| pool.resize           | 按顺序改变目标容量，等待忙成员退休。   |
| pool.close / stats    | 排空并清理，或读取新的浅冻结状态快照。 |

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
