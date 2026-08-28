# `@migaia/lifecycle`

运行时中立的**生命周期原语**：作用域所有权、代数（generation）、静默追踪（quiescence）与释放事务。零领域知识——公开 API 里不出现 store / plugin / capability / service / rpc / storage 等词汇，只知道「资源」和「怎么释放资源」。

设计文档：`docs/lifecycle/lifecycle-extraction.sdd.md`（SDD 1/3）；错误码契约：`docs/contracts/error-codes.md`。

## 适用与不适用场景

**适用**：需要明确资源所有权、关闭边界、代数失效（用新结果取代旧结果）、静默/排空、或多资源释放事务（含超时降级与错误聚合）的 runtime-neutral 库或运行时宿主。

**不适用**：不要把它当作事件总线、当前值存储/订阅、能力依赖图、拓扑排序/环检测（那些属于 `@migaia/capability/graph`）、业务队列策略，或跨进程传输。`ready`/`blocked` 之类需要依赖关系才能回答的问题，本包刻意不回答。

### 场景怎么选

| 业务问题                                                        | 首选 API                                            | 典型场景                                                      |
| --------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| 一组资源随 owner 统一关闭                                       | `createLifecycleScope`                              | 页面/插件/服务实例拥有 socket、timer、subscription、DB handle |
| 资源必须在当前 stack 释放                                       | `createSyncLifecycleScope`                          | DOM listener、observer、纯同步 native handle                  |
| 同步 `dispose()` 启动异步 disposer，另提供 awaitable completion | `createSyncStartedDisposalLedger`                   | Store/registry 的 sync + async 双销毁 API                     |
| 只接受最新一次异步请求结果                                      | `createGenerationController`                        | 搜索联想、路由加载、刷新覆盖、重连                            |
| 管理 start/restart 的 idle/loading/loaded/failed                | `createLifecycleUnit`                               | 服务初始化、懒加载模块、配置加载                              |
| 等所有在途 Promise 真正排空                                     | `createPendingTracker`                              | flush、close、批处理 drain、SSR request completion            |
| 按 key/object 统计占用并封存                                    | `create*QuiescenceTracker` / `create*LeaseRegistry` | session、channel、cache entry、共享资源引用                   |
| 构造成功才转交资源，失败自动回滚                                | `createProvisionalScope`                            | 插件安装、模块装配、连接组初始化                              |
| 多个变更必须 FIFO 串行                                          | `createMutationQueue`                               | config CRUD、拓扑变更、schema/register mutation               |
| 多资源 graceful→force、deadline、错误聚合                       | `createDisposeTransaction`                          | 服务停机、连接池关闭、插件卸载                                |
| 真实平台取消信号                                                | `createAbortController`                             | fetch、stream、timer、Worker/RPC operation                    |
| 可重复、无真实等待的时间测试                                    | `createManualScheduler`                             | timeout、deadline、重试和队列 SLA 单测                        |

选择原则：Scope 管“谁拥有资源”；Generation 管“哪个异步结果仍有效”；Pending/Lease 管“还有多少工作”；MutationQueue 管“谁先修改”；DisposeTransaction/Ledger 管“如何结束”。这些轴可以组合，但不要让两个原语同时成为同一状态的 owner。

## 安装

```bash
pnpm add @migaia/lifecycle
```

唯一依赖是同层的 `@migaia/utils`（时间/错误原语）；不引入 DOM、Node 或任何领域包类型。

## 目录

- [作用域与释放](#作用域与释放模块)：`createLifecycleScope`、`createSyncLifecycleScope`、`executeReleaseDescriptor`、`createDisposeTransaction`、`createSyncStartedDisposalLedger`
- [单元与代数](#单元与代数模块)：`createLifecycleUnit`、`createGenerationController`
- [静默追踪与租约](#静默追踪与租约模块)：`createQuiescenceTracker`、`createStringQuiescenceTracker`、`createObjectLeaseRegistry`、`createStringLeaseRegistry`、`createPendingTracker`
- [事务性所有权](#事务性所有权模块)：`createProvisionalScope`
- [变更队列](#变更队列模块)：`createMutationQueue`
- [调度器、中止与有界等待](#调度器中止与有界等待模块)：`systemScheduler`、`createManualScheduler`、`snapshotScheduler`、`validateSchedulerDelay`、`validateSchedulerTime`、`createAbortController`、`boundedWait`、`createTerminalController`
- [错误基础设施](#错误基础设施模块)：`LIFECYCLE_SOURCE`、`createLifecycleError`、`createLifecycleRangeError`、`tagLifecycleError`、`containAsyncRejection`、`probeThenable`、`assimilateCapturedThen`、`createErrorCollector`、`LifecycleErrorCode`、`LifecycleErrorText`
- [状态常量](#状态常量模块)：`LifecycleState`、`LifecycleUnitState`、`LifecycleErrorPolicy`、`ThenableProbeKind`、`DisposeTransactionKind`
- [按需导入与 tree-shaking](#按需导入与-tree-shaking)
- [高阶组合示例](#高阶组合示例)
- [构建门禁](#构建门禁)

完整签名、边界行为与错误码，见 [USEGUIDE.md](./USEGUIDE.md)。

---

<a id="作用域与释放模块"></a>

## 作用域与释放模块

```ts
import {
  createLifecycleScope,
  createSyncLifecycleScope,
  executeReleaseDescriptor,
  createDisposeTransaction,
  type IReleaseDescriptor,
  type IReleaseContext
} from '@migaia/lifecycle'
```

两条正交轴：容器存活轴（`open → closing → terminal`，由 `close()`/`dispose()` 驱动）与资源释放本身。`close()` 永远同步、幂等、不调用用户代码；`dispose()` 永远异步（唯一形态，不提供同步版本）。

**`createLifecycleScope`｜10 秒上手** —— 通用异步所有权容器：

```ts
const scope = createLifecycleScope()
const connection = scope.own(
  { close: () => undefined },
  {
    force: (ctx) => connection.close()
  }
)
scope.close() // 同步、幂等，之后 own() 抛 SCOPE_CLOSED
const failures = await scope.dispose() // 逆序释放，'throw' 策略下失败即抛
```

全部选项（`ILifecycleScopeOptions`）：

- `errorPolicy?: 'throw' | 'collect' | 'report' | 'firstError'` —— 默认 `'throw'`
- `report?: (error: unknown) => void` —— `report`/`firstError` 策略下的诊断通道；异常被自身吞掉（最后一道错误边界）
- `deadlineAt?: number` —— 本次 `dispose()` 内所有资源共享的绝对释放截止时间
- `scheduler?: ILifecycleScheduler` —— 默认 `systemScheduler`；决定 `deadlineAt`/`gracefulTimeoutMs` 的时间域

`own(resource, descriptor)` 返回的方法：`own`、`release(resource)`（反注册但不释放，用于调用方已自行释放的场景）、`close()`、`dispose()`。`dispose()` 并发多次调用复用同一个 Promise；disposer 内部重入 `own()`/`dispose()` 分别抛 `SCOPE_REENTRANT_OWN`/`SCOPE_REENTRANT_DISPOSE`。环境支持时自动挂载 `[Symbol.asyncDispose]`。

**`createSyncLifecycleScope`｜10 秒上手** —— 纯同步容器，`dispose()` 不返回 Promise：

```ts
const scope = createSyncLifecycleScope()
scope.own(node, { syncSafe: true, force: () => node.detach() })
scope.close()
const failures = scope.dispose() // 同步返回，不可能有异步资源
```

全部选项（`ISyncLifecycleScopeOptions`）：`errorPolicy?`（同上，默认 `'throw'`）、`report?`（同上）。**约束**：每个 descriptor 必须显式 `syncSafe: true`，否则 `own()` 在注册时（不是释放时）就抛 `SCOPE_SYNC_VIOLATION`；某个 callback 若返回 thenable，同样在释放时抛 `SCOPE_SYNC_VIOLATION`。不能 `own()` 一个 `LifecycleScope`/`ProvisionalScope` 实例。环境支持时挂载 `[Symbol.dispose]`。

**`IReleaseDescriptor`｜10 秒上手** —— 领域表达释放意图的唯一词汇（类型，非函数，随 `own()` 一起使用）：

```ts
scope.own(handle, {
  syncSafe: false,
  order: 10, // 大的先释放；只在 order 模式事务里生效
  graceful: (ctx) => flush(), // 优雅释放；超时只放弃等待，仍会跑 force
  gracefulTimeoutMs: 200,
  force: (ctx) => handle.close(), // 必填，必须无条件完成
  gcFallback: true // 显式释放时自动 unregister 的 FinalizationRegistry 兜底
})
```

全部字段：`force: (context: IReleaseContext) => void | PromiseLike<void>`（**必填**）；`syncSafe?: boolean`；`order?: number`（缺省按 `0`）；`graceful?: (context) => void | PromiseLike<void>`；`gracefulTimeoutMs?: number`；`gcFallback?: boolean`；`custom?: (context) => void | PromiseLike<void>`（逃生舱，设置后完全接管释放，`graceful`/`force` 被忽略）。回调收到的 `IReleaseContext`：`signal`（容器进入 closing 时中止）、`deadlineAt`、`scheduler?`、`report(error)`。

**`executeReleaseDescriptor`｜5 秒上手** —— 独立运行单个 descriptor 的完整降级链（`custom` → 否则 `graceful` 带超时 → `force`），不经过完整事务，常用于测试或自定义编排：

```ts
const errors = await executeReleaseDescriptor(descriptor, {
  signal: controller.signal,
  deadlineAt: undefined,
  report: (e) => console.error(e)
})
```

参数：`descriptor: IReleaseDescriptor`（必填）、`context: IReleaseContext`（必填，无可选项——直接构造完整 context 对象）。返回全部失败错误的数组（成功为空数组），从不抛出。

**`createDisposeTransaction`｜10 秒上手** —— 编排多个资源的释放，`order` 弱排序或 `plan` 强序列二选一：

```ts
const transaction = createDisposeTransaction(
  { kind: 'plan' },
  { errorPolicy: 'collect', signal: controller.signal }
)
const failures = await transaction.run([
  { source: 'db', descriptor: dbDescriptor },
  { source: 'socket', descriptor: socketDescriptor }
])
```

第一参数 `mode`（必填）：`{ kind: 'order' }`（按 `descriptor.order` 降序分组，稳定排序保留同序调用方给定的相对顺序；只读 order 模式的 items）或 `{ kind: 'plan' }`（严格按 `items` 给定顺序执行，从不读取 `order`）——同一事务不能混用。

全部选项（`IDisposeTransactionOptions`）：

- `errorPolicy?` —— 默认 `'throw'`
- `report?: (error: unknown) => void`
- `deadlineAt?: number` —— 本次 `run()` 内所有 item 共享的绝对截止时间
- `scheduler?: ILifecycleScheduler` —— 默认 `systemScheduler`
- `signal?: IAbortSignal` —— 转发进每个 item 的 `context.signal`；`run()` 开始时自动镜像中止状态
- `pending?: { drain(): Promise<void> }` —— 每个 item 释放完后等待其触发的在途工作排空（通常传 `createPendingTracker()`）

**`createSyncStartedDisposalLedger`｜10 秒上手** —— 为同步 `dispose()` 启动的异步 disposer 提供唯一 pending/error/completion 账本：

```ts
import { createSyncStartedDisposalLedger } from '@migaia/lifecycle/disposal'

const ledger = createSyncStartedDisposalLedger()
ledger.start('socket', () => socket.close()) // callback 在当前 stack 立即执行
ledger.start('cache', () => cache.flush())

const outcome = ledger.seal() // open → closing；之后不再接受 start()
if (outcome.synchronousErrors.length > 0) {
  // 领域层决定 throw、report、firstError 或 AggregateError 投影。
}
const allErrors = await outcome.completion // 永远 resolve raw error ledger，不因 item failure reject
await ledger.whenTerminal()
```

Ledger 不决定 disposer 顺序、不拥有领域资源、也不制造领域错误。`start()` 捕获 callback 同步失败与 hostile then getter；thenable 只读一次并保持 receiver。`seal()`/`completion` identity 稳定；pending 全部 settle 后才进入 `terminal`。永不 settle 的合法 thenable 会让 ledger 保持 `closing`，本原语不自造 timeout 或 cancellation。

---

<a id="单元与代数模块"></a>

## 单元与代数模块

```ts
import { createLifecycleUnit, createGenerationController } from '@migaia/lifecycle'
```

**`createLifecycleUnit`｜10 秒上手** —— 单元装载轴的状态机（`idle`/`loading`/`loaded`/`failed`），内部用一个 `GenerationController` 丢弃过期结果：

```ts
const unit = createLifecycleUnit<Config>()
unit.start(() => fetchConfig()) // thenable → 先进 'loading'，settle 后进 'loaded'/'failed'
unit.state // 'loading'
unit.value // undefined（settle 前）
unit.restart(() => fetchConfig()) // 新 generation，旧一次的迟到结果被静默丢弃
```

全部选项（`ILifecycleUnitOptions`）：`report?: (error: unknown) => void` —— `start()` 的 factory 同步抛出或 thenable reject 时，除了把原始错误存进 `unit.error`（原样、不打标签），还会额外把一份打上 `UNIT_START_FAILED` 标签的错误发给 `report`。`start`/`restart` 是同一函数的两个别名；同步非 thenable 返回直接落 `loaded`（跳过 `loading`）。`close()` 同步；`dispose()` 同步（单元本身不持有需要等待的资源，只是终结 generation controller）。

**`createGenerationController`｜10 秒上手** —— 代数 + 每代一个 `AbortSignal`，新一代自动使旧一代失效：

```ts
const shutdown = new AbortController()
const generations = createGenerationController({ parentSignal: shutdown.signal })
const request = generations.begin({ timeoutMs: 5000 }) // 超过 5s 自动 abort 当前代
const result = await fetchWithSignal(request.signal)
if (generations.adopt(request.token, result, (v) => v.close())) {
  use(result) // 仍是当前代，安全采用
} // 否则内部已调用 release() 回收 result，返回 false
```

全部选项（`IGenerationControllerOptions`）：

- `parentSignal?: IAbortSignal` —— 该信号中止时，当前活跃代同步中止
- `onSuperseded?: (info: ILifecycleError) => void` —— `adopt()` 发现 token 已过期时的诊断钩子（`GENERATION_SUPERSEDED`），不是失败信号
- `scheduler?: ILifecycleScheduler` —— 默认 `systemScheduler`；驱动 `begin({ timeoutMs })` 的计时

返回方法：`generation`（只读当前代号）、`disposed`（只读）、`begin(options?)` → `{ generation, token, signal }`（`options.timeoutMs?: number`，超时/父中止/新 `begin()` 都会使这个 token 的 `signal` 中止）、`isCurrent(token)`、`supersede(reason?)`（作废当前代但控制器仍可用）、`adopt(token, value, release, onReleaseError?)`、`dispose(reason?)`（终态，之后 `begin()` 抛 `GENERATION_DISPOSED`）。

---

<a id="静默追踪与租约模块"></a>

## 静默追踪与租约模块

```ts
import {
  createQuiescenceTracker,
  createStringQuiescenceTracker,
  createObjectLeaseRegistry,
  createStringLeaseRegistry,
  createPendingTracker
} from '@migaia/lifecycle'
```

**`createQuiescenceTracker` / `createStringQuiescenceTracker`｜10 秒上手** —— 按 key 计数的租约追踪，`WeakMap`（对象键，自动 GC）或 `Map`（字符串键，归零后自动清理未 seal 的条目）：

```ts
const tracker = createQuiescenceTracker<object>() // 或 createStringQuiescenceTracker()
const release = tracker.retain(key)
tracker.count(key) // 1
tracker.seal(key) // 之后 retain(key) 抛 QUIESCENCE_SEALED
release()
await tracker.whenZero(key) // 必须先 seal，否则同步抛 QUIESCENCE_UNSEALED_WAIT
```

两者均无构造参数。返回方法：`retain(key)` → 返回释放函数 `IDisposer`（重复调用幂等）；`count(key)`；`whenZero(key)`（严格独占等待，**必须先 `seal(key)`**，否则同步抛错，不是 rejected Promise）；`whenZeroOnce(key)`（非独占，不要求 seal，随时可等待下一次归零）；`seal(key)`（幂等）；`isSealed(key)`。

**`createObjectLeaseRegistry` / `createStringLeaseRegistry`｜3 秒上手** —— 与上面完全同一引擎的别名，供领域友好命名的调用点使用：

```ts
const leases = createObjectLeaseRegistry<object>() // 内部就是 createQuiescenceTracker()
```

无构造参数；`ILeaseRegistry<TKey>` 类型等价于 `IQuiescenceTracker<TKey>`。

**`createPendingTracker`｜5 秒上手** —— 只暴露 `track`/`drain`/`size` 的窄接口，用于追踪并排空在途 Promise：

```ts
const pending = createPendingTracker()
pending.track(doWork()) // 原样返回传入的 promise
await pending.drain() // 等到 size 归零；排空期间新增的 track() 不会被漏计（内部循环 whenZeroOnce）
pending.size // 当前在途数量
```

无构造参数。`track(promise)` 结算后自动释放内部租约，无论 resolve 还是 reject；`drain()` 永不抛出（内部忽略释放函数自身的异常，release 本身也不会抛）。

---

<a id="事务性所有权模块"></a>

## 事务性所有权模块

```ts
import { createProvisionalScope, type ILifecycleOwner } from '@migaia/lifecycle'
```

**`createProvisionalScope`｜10 秒上手** —— 构造期两阶段所有权：资源先暂存这里，最终要么 `commitTo(parent)` 转移给真正的 owner，要么 `rollback()` 释放，二选一、只能选一次：

```ts
const provisional = createProvisionalScope()
const db = provisional.own(await connect(), { force: (ctx) => db.close() })
try {
  await provisional.commitTo(outerScope) // 按注册顺序逐个 own() 到 parent
} catch (error) {
  // parent 中途拒绝（如已在 closing）：已转移部分留在 parent 名下，剩余部分已被自动释放并 await 完成
}
```

全部选项（`IProvisionalScopeOptions`）：`parentSignal?: IAbortSignal` —— 转发到 `provisional.signal`，令其也随父信号中止。

返回方法：`signal`（只读）、`own(resource, descriptor)`、`commitTo(parent: ILifecycleOwner)`（逐个转移；某项失败时，已转移的留给 parent，未转移的由本作用域逆序释放并 **await** 完成后才重新抛出原错误；若失败原因是 parent 已 `closing`/`terminal`，额外包一层 `PROVISIONAL_PARENT_CLOSED`，原错误仍在 `cause`）、`rollback()`（逆序释放全部已注册资源，聚合失败为 `AggregateError`，幂等——并发/重复调用复用同一个 settle Promise）。`commitTo`/`rollback` 二次调用（或 commit 后 rollback / rollback 后 commit）抛 `PROVISIONAL_SETTLED`。

---

<a id="变更队列模块"></a>

## 变更队列模块

```ts
import { createMutationQueue } from '@migaia/lifecycle'
```

**`createMutationQueue`｜10 秒上手** —— 严格 FIFO 串行队列，无并发池，带可选的入队 SLA 看门狗：

```ts
const queue = createMutationQueue({ queueAdmissionTimeoutMs: 5000 })
const result = await queue.enqueue(() => applyMutation(), { owner: 'sync-loop' })
queue.size // 排队中 + 正在执行的任务数
```

全部选项（`IMutationQueueOptions`）：

- `queueAdmissionTimeoutMs?: number | false` —— 默认 `undefined`（只诊断、从不因排队超时而拒绝）；数字表示任务排队超过这个时长即被移出队列并以 `QUEUE_ADMISSION_TIMEOUT` reject；`false` 连诊断计时器也不开
- `admissionDiagnosticMs?: number | false` —— 默认 `1000`；仅在 `queueAdmissionTimeoutMs` 为 `undefined` 时生效的诊断阈值，`false` 关闭诊断计时器
- `onAdmissionDiagnostic?: (info: { owner: string | undefined; waitedMs: number }) => void`
- `scheduler?: ILifecycleScheduler` —— 默认 `systemScheduler`

`enqueue(task, options?)` 的 `options`（`IEnqueueOptions`）：`owner?: string`（用于自依赖检测——同一 owner 在自己正在运行时又提交新任务会立即以 `QUEUE_SELF_DEPENDENCY` reject，因为 FIFO 队列不可能在当前任务完成前跑新任务）、`queueAdmissionTimeoutMs?: number | false`（覆盖本次任务的队列默认值）。`size` 只读，等于排队数加运行中的 0/1。

---

<a id="调度器中止与有界等待模块"></a>

## 调度器、中止与有界等待模块

```ts
import {
  systemScheduler,
  createManualScheduler,
  snapshotScheduler,
  validateSchedulerDelay,
  validateSchedulerTime,
  createAbortController,
  boundedWait,
  createTerminalController
} from '@migaia/lifecycle'
```

**`systemScheduler`｜3 秒上手** —— 默认调度器，`now()` 用 `performance.now()`、`schedule()` 用 `setTimeout`/`clearTimeout`，一般不用手动传，除非要换成 `createManualScheduler()`：

```ts
systemScheduler.now() // 单调递增毫秒数
```

无配置，纯常量对象；宿主缺 `performance.now`/`setTimeout`/`clearTimeout` 时，首次调用对应方法才 fail-fast 抛 `ENV_UNSUPPORTED`。

**`createManualScheduler`｜10 秒上手** —— 单测里把时间变成确定性的虚拟时钟：

```ts
const scheduler = createManualScheduler()
const task = scheduler.schedule(() => console.log('fired'), 100)
scheduler.advance(100) // 一次性 flush 所有到期回调（含到期回调内部再排的到期任务）
```

无入参；返回 `IManualScheduler`（在标准 `ILifecycleScheduler` 的 `now()`/`schedule()` 基础上加 `advance(ms)`）。`advance` 单次循环超过 10000 个 flush 任务会抛 `INVALID_OPTION`（runaway guard）；`ms`/`delayMs` 必须是有限非负数，否则抛 `INVALID_OPTION`。

**`snapshotScheduler`｜5 秒上手** —— 把任意 duck-typed 值快照成标准 `ILifecycleScheduler`（校验并锁定 accessor，防止 hostile getter 二次读取）：

```ts
const snap = snapshotScheduler(candidate) // 不是合法 scheduler 时返回 undefined，而不是抛错
```

单参数 `value: unknown`，无选项；`now`/`schedule` 都不是函数时返回 `undefined`；读取 `now`/`schedule` 属性本身抛错时抛 `TypeError`（`INVALID_OPTION`）。

**`validateSchedulerDelay` / `validateSchedulerTime` / `addSchedulerTime`｜3 秒上手** —— 本包内部用来校验时间值和安全相加的公开工具，自定义 scheduler 实现也可复用：

```ts
validateSchedulerTime(value, 'deadlineAt') // 非 number 抛 TypeError，非有限抛 RangeError
validateSchedulerDelay(value) // 在上面基础上还要求 >= 0，否则抛 RangeError
addSchedulerTime(now, delayMs, 'deadlineAt') // 两个有限数相加；溢出 Infinity 时抛 RangeError
```

`validateSchedulerTime(value, label)`：`label: string` 必填，仅用于错误信息里标注字段名。`validateSchedulerDelay(value, label?)`：`label` 可选，默认 `'delayMs'`。`addSchedulerTime(base, delta, label)` 只从 `/scheduler` leaf 导出，验证两端及结果都是有限数。三者返回校验后的数值。

**`createAbortController`｜5 秒上手** —— 委托当前宿主的原生 `AbortController`，返回真实 host instance：

```ts
const controller = createAbortController()
controller.signal.addEventListener('abort', () => console.log('aborted'))
controller.abort('reason')
```

无构造参数。`abort(reason?)` 保持宿主 native brand、reason 与 listener dispatch 语义；宿主能力缺失时抛出带 `ENV_UNSUPPORTED` 的 lifecycle error。

这是 V2 breaking change：`abort()` 或 `abort(undefined)` 的 reason 是宿主 `DOMException`/`AbortError`，不再是 `undefined`；non-`undefined` reason 保持对象 identity。外部 listener 抛错走宿主 EventTarget 错误通道，**不会**从 `controller.abort()` 同步抛出 lifecycle `ABORT_LISTENER_FAILED`。Lifecycle 自己登记的 parent/cancellation callback 由内部 observed-subscription 边界捕获并交给对应 operation 的 collect/report 通道，不会拦截同一 signal 上的外部 listener。

**`boundedWait`｜5 秒上手** —— 等到绝对截止时间为止，**从不取消**被等待的任务：

```ts
const won = await boundedWait(task, deadlineAt) // true=task 先完成；false=截止时间先到（task 仍在跑）
```

参数：`task: PromiseLike<unknown>`（必填）、`deadlineAt: number`（必填，绝对时刻）、第三参数选项 `{ scheduler?: ILifecycleScheduler }`（默认 `systemScheduler`）。无论超时与否都会挂一个 `.catch()` 观察 `task`，避免它日后 reject 变成未处理拒绝；`deadlineAt` 已经过去时立即返回 `false`（仍会先观察 `task`）。

**`createTerminalController`｜5 秒上手** —— 独立复用的容器存活轴状态机，`createLifecycleScope`/`createSyncLifecycleScope`/`createLifecycleUnit` 内部都基于它：

```ts
const terminal = createTerminalController()
terminal.close() // open → closing，幂等
terminal.forceTerminal() // 直接进 terminal，resolve whenTerminal()
await terminal.whenTerminal()
```

无构造参数。`lifecycle`（只读，`'open' | 'closing' | 'terminal'`）、`close()`（同步幂等，只在 `open` 时生效）、`forceTerminal()`（同步幂等，直接到 `terminal`）、`whenTerminal()`（返回同一个 Promise，只在到达 `terminal` 时 resolve 一次）。

---

## 按需导入与 tree-shaking

根入口保持兼容；需要控制 retained graph 时使用稳定 leaf：

```ts
import { createAbortController } from '@migaia/lifecycle/abort'
import { snapshotScheduler } from '@migaia/lifecycle/scheduler'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'
import { createGenerationController } from '@migaia/lifecycle/generation'
import { createSyncStartedDisposalLedger } from '@migaia/lifecycle/disposal'
import { probeThenable } from '@migaia/lifecycle/errors'
```

可用 subpath：`/abort`、`/scheduler`、`/quiescence`、`/scope`、`/generation`、`/disposal`、`/errors`。Root 和 subpath 都 re-export 同一 preserve-modules 实现，同名 runtime export 保持 `===`；包不开放 `dist/*` wildcard。`sideEffects: false` 表示未导入 leaf 可被 bundler 删除；Node/Bun 直接 ESM import 本身不执行 tree-shaking，体积验收应看 bundler retained modules，而不是只看 gzip 总字节。

---

<a id="错误基础设施模块"></a>

## 错误基础设施模块

```ts
import {
  LIFECYCLE_SOURCE,
  createLifecycleError,
  createLifecycleRangeError,
  tagLifecycleError,
  containAsyncRejection,
  probeThenable,
  assimilateCapturedThen,
  createErrorCollector,
  LifecycleErrorCode,
  LifecycleErrorText
} from '@migaia/lifecycle'
```

**`LIFECYCLE_SOURCE`｜3 秒上手** —— 本包所有错误的 `source` 字段固定值：

```ts
LIFECYCLE_SOURCE // '@migaia/lifecycle'
```

字符串常量，无调用。

**`createLifecycleError`｜5 秒上手** —— 构造一个携带 `(source, code)` 身份的 `Error`，从不改写 `stack`：

```ts
throw createLifecycleError(LifecycleErrorCode.scopeClosed, '[lifecycle] scope is closing')
```

参数：`code: string`（必填，建议取自 `LifecycleErrorCode`）、`message: string`（必填）、第三参数选项：`cause?: unknown`、`phase?: string`、`detail?: Readonly<Record<string, unknown>>`、`errors?: readonly unknown[]`（非空时冻结挂到 `.errors`）。

**`createLifecycleRangeError`｜3 秒上手** —— 同上但产出原生 `RangeError`（保留原生类型，用于入参越界场景）：

```ts
throw createLifecycleRangeError(LifecycleErrorCode.invalidOption, 'delayMs must be >= 0')
```

参数：`code`、`message`（均必填）、第三参数选项 `{ cause?: unknown; detail?: Readonly<Record<string, unknown>> }`。

**`createLifecycleTypeError` / `createLifecycleFailure`｜5 秒上手** —— `/errors` leaf 的边界构造器：前者创建保留原生类型的 `TypeError`；后者尽量给既有 Error 原位附码，primitive/不可扩展错误则包装并通过 `cause` 保留。

```ts
import { createLifecycleFailure, createLifecycleTypeError } from '@migaia/lifecycle/errors'

throw createLifecycleTypeError(LifecycleErrorCode.invalidOption, 'invalid option')
// catch (cause) { throw createLifecycleFailure(code, message, cause); }
```

**`tagLifecycleError`｜5 秒上手** —— 给一个已存在（非本包构造）的错误对象就地贴上 `(source, code)`，常用于给原生 `AggregateError` 打标：

```ts
tagLifecycleError(new AggregateError(errors, 'msg'), LifecycleErrorCode.scopeDisposalFailed)
```

参数：`error: E extends Error`（必填）、`code: string`（必填）。返回同一个对象（原地修改）。

**`containAsyncRejection`｜5 秒上手** —— 保护性地探测某个返回值是否是 thenable，是则观察其 rejection 而不让其变成未处理拒绝：

```ts
containAsyncRejection(maybeAsyncCallbackResult, (error) => report(error))
```

参数：`value: unknown`（必填）、`onRejected: (error: unknown) => void`（必填）。非 thenable 时直接返回，不调用 `onRejected`。

**`probeThenable`｜5 秒上手** —— 只读一次 `value.then`，返回判别结果（不是布尔值，是否 thenable/是否 getter 抛错都会区分）：

```ts
const probe = probeThenable(result)
if (probe.kind === 'thenable') {
  /* probe.thenFn 已捕获，可安全 apply 一次 */
}
```

单参数 `value: unknown`，无选项。三种结果：`{ kind: 'not-thenable' }`、`{ kind: 'thenable', thenFn }`、`{ kind: 'failed', error }`（读 `.then` 本身抛错）。

**`assimilateCapturedThen`｜5 秒上手** —— 把 `probeThenable` 捕获到的 `thenFn` 安全地 apply 成一个真正的 `Promise`，且只调用一次：

```ts
const promise = assimilateCapturedThen<T>(probe.thenFn, thenableValue)
```

参数：`thenFn`（必填，来自 `probeThenable` 的 `thenFn`）、`thenable: unknown`（必填，作为 `this` receiver 传给 `thenFn`）。无可选项。

**`createErrorCollector`｜10 秒上手** —— 按四种错误策略收集/上报错误，`createDisposeTransaction`/`createSyncLifecycleScope` 内部都用它：

```ts
const collector = createErrorCollector('collect', undefined)
collector.add('item-1', error)
const collected = collector.finalize('teardown failed') // 'collect' 策略下返回 ICollectedError[]
```

参数：`policy: 'throw' | 'collect' | 'report' | 'firstError'`（必填）、`report: ((error: unknown) => void) | undefined`（必填，显式传 `undefined` 表示无诊断通道）。`add(source, error)` 按策略即时处理（`report` 策略立即调用 `report`）；`finalize(message)`：`collect` 返回收集到的数组，`report` 返回空数组（已在 `add` 时上报），`throw` 单错原样抛、多错聚合成携带 `SCOPE_DISPOSAL_FAILED` 码的 `AggregateError`，`firstError` 有错误时抛首个（其余经 `report` 观测），否则返回空数组。

**`LifecycleErrorCode`｜10 秒上手** —— 稳定错误码表（20 个码），唯一声明处，`source` 恒为 `'@migaia/lifecycle'`：

```ts
if (error.code === LifecycleErrorCode.scopeClosed) {
  /* ... */
}
```

全部取值：`scopeClosed`(`SCOPE_CLOSED`)、`scopeTerminal`(`SCOPE_TERMINAL`)、`scopeReentrantDispose`(`SCOPE_REENTRANT_DISPOSE`)、`scopeReentrantOwn`(`SCOPE_REENTRANT_OWN`)、`scopeSyncViolation`(`SCOPE_SYNC_VIOLATION`)、`scopeDisposalFailed`(`SCOPE_DISPOSAL_FAILED`)、`unitStartFailed`(`UNIT_START_FAILED`)、`generationSuperseded`(`GENERATION_SUPERSEDED`)、`generationCancellationFailed`(`GENERATION_CANCELLATION_FAILED`)、`generationDisposed`(`GENERATION_DISPOSED`)、`quiescenceSealed`(`QUIESCENCE_SEALED`)、`quiescenceUnsealedWait`(`QUIESCENCE_UNSEALED_WAIT`)、`provisionalSettled`(`PROVISIONAL_SETTLED`)、`provisionalParentClosed`(`PROVISIONAL_PARENT_CLOSED`)、`queueAdmissionTimeout`(`QUEUE_ADMISSION_TIMEOUT`)、`queueSelfDependency`(`QUEUE_SELF_DEPENDENCY`)、`releaseForceFailed`(`RELEASE_FORCE_FAILED`)、`deadlineExceeded`(`DEADLINE_EXCEEDED`)、`envUnsupported`(`ENV_UNSUPPORTED`)、`invalidOption`(`INVALID_OPTION`)。逐条语义见 [USEGUIDE.md](./USEGUIDE.md#错误码)。

**`LifecycleErrorText`｜3 秒上手** —— 稳定诊断消息表（本包内部错误信息的唯一声明处，公开是为了让调用方按文本断言/比对）：

```ts
error.message === LifecycleErrorText.disposeTransactionFailed
```

全部键：`provisionalCleanupFailed`、`disposeTransactionFailed`、`disposeDescriptorInvalid`、`mutationAdmissionTimedOut`、`generationCancellationFailed`、`disposalLedgerClosed`、`disposalLedgerReentrant`、`envUnsupported`、`abortSignalInvalid`、`schedulerTaskCancelGetterFailed`、`schedulerTaskInvalid`、`schedulerAccessorFailed`、`schedulerInvalid`、`schedulerNumberType`、`schedulerNumberRange`、`schedulerDelayRange`、`schedulerTimeOverflow`、`generationTimeoutAccessorFailed`。

---

<a id="状态常量模块"></a>

## 状态常量模块

```ts
import {
  LifecycleState,
  LifecycleUnitState,
  LifecycleErrorPolicy,
  ThenableProbeKind,
  DisposeTransactionKind
} from '@migaia/lifecycle'
```

均为纯常量对象（`as const`），无调用参数，用于替代裸字符串字面量做比较/`switch`。

**`LifecycleState`｜3 秒上手** —— 容器存活轴：`{ open: 'open', closing: 'closing', terminal: 'terminal' }`。

**`LifecycleUnitState`｜3 秒上手** —— 单元装载轴：`{ idle: 'idle', loading: 'loading', loaded: 'loaded', failed: 'failed' }`。

**`LifecycleErrorPolicy`｜3 秒上手** —— 释放错误策略：`{ throw: 'throw', collect: 'collect', report: 'report', firstError: 'firstError' }`；`firstError` 不是通用默认值，只为兼容 `web-rpc` discovery-registry 的迁移语义存在。

**`ThenableProbeKind`｜3 秒上手** —— `probeThenable`/内部归化逻辑的判别结果：`{ notThenable: 'not-thenable', thenable: 'thenable', failed: 'failed', promise: 'promise' }`。

**`DisposeTransactionKind`｜3 秒上手** —— `createDisposeTransaction` 的模式：`{ order: 'order', plan: 'plan' }`。

---

<a id="高阶组合示例"></a>

## 高阶组合示例

### 1. 作用域 + 代数：请求场景下取代过期结果

```ts
import { createLifecycleScope, createGenerationController } from '@migaia/lifecycle'

const scope = createLifecycleScope({ errorPolicy: 'collect' })
const generations = createGenerationController()

async function loadUser(id: string) {
  const request = generations.begin({ timeoutMs: 5000 })
  const user = await fetchUser(id, { signal: request.signal })
  if (!generations.adopt(request.token, user, (u) => u.dispose?.())) return // 已过期，静默丢弃
  scope.own(user, { force: () => user.dispose?.() })
}
```

### 2. 事务性所有权：构造期失败自动回滚，成功后转移给长期 scope

```ts
import { createLifecycleScope, createProvisionalScope } from '@migaia/lifecycle'

const rootScope = createLifecycleScope()

async function setupModule() {
  const provisional = createProvisionalScope()
  try {
    const db = provisional.own(await connectDb(), { force: (ctx) => closeDb(db) })
    const cache = provisional.own(await connectCache(), { force: (ctx) => closeCache(cache) })
    await provisional.commitTo(rootScope) // 全部转移给 rootScope，之后随 rootScope.dispose() 释放
  } catch (error) {
    await provisional.rollback() // 任一步失败：已注册的资源逆序释放，冒泡原错误
    throw error
  }
}
```

### 3. 静默追踪 + 变更队列：确保排空后才提交下一批变更

```ts
import { createPendingTracker, createMutationQueue } from '@migaia/lifecycle'

const pending = createPendingTracker()
const queue = createMutationQueue({ queueAdmissionTimeoutMs: 3000 })

async function applyBatch(mutations: Array<() => Promise<void>>) {
  for (const mutation of mutations) {
    pending.track(queue.enqueue(mutation, { owner: 'batch' }))
  }
  await pending.drain() // 等到本批（含批内动态追加的）全部落地
}
```

### 4. 释放事务 + 有界等待：手动编排一组资源的优雅关闭

```ts
import {
  createDisposeTransaction,
  createManualScheduler,
  type IDisposeItem
} from '@migaia/lifecycle'

const scheduler = createManualScheduler()
const items: IDisposeItem[] = [
  {
    source: 'socket',
    descriptor: {
      order: 10,
      graceful: (ctx) => flushSocket(),
      gracefulTimeoutMs: 100,
      force: () => forceCloseSocket()
    }
  },
  { source: 'db', descriptor: { order: 5, force: () => closeDb() } }
]
const transaction = createDisposeTransaction(
  { kind: 'order' },
  { errorPolicy: 'collect', scheduler }
)
const runPromise = transaction.run(items)
scheduler.advance(100) // 驱动 socket 的 graceful 超时降级到 force
const failures = await runPromise
```

### 5. 同步作用域：可暴露 `using` 语法的纯同步资源

```ts
import { createSyncLifecycleScope } from '@migaia/lifecycle'

function withListeners() {
  using scope = createSyncLifecycleScope() // 环境支持 `[Symbol.dispose]` 时可用 `using`
  const handler = () => console.log('tick')
  window.addEventListener('tick', handler)
  scope.own(handler, { syncSafe: true, force: () => window.removeEventListener('tick', handler) })
  // 作用域结束时自动 dispose()，移除监听器
}
```

---

<a id="构建门禁"></a>

## 构建门禁

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

验收矩阵（L-T1 ~ L-T44）见 `docs/lifecycle/lifecycle-extraction.sdd.md` §5.4；每个 `L-T` 编号都能在 `test/` 下检索到对应用例。
