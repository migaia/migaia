# `@migaia/lifecycle` 使用指南

本指南逐个模块列出全部导出 API 的签名、边界行为与错误码。包的定位、适用/不适用场景与安装方式见 [README](./README.md)。

## 目录

- [公共基础类型](#公共基础类型)：owner/state/disposer/error 的共享结构
- [作用域与释放模块](#作用域与释放模块)：`createLifecycleScope`、`createSyncLifecycleScope`、`executeReleaseDescriptor`、`createDisposeTransaction`、`createSyncStartedDisposalLedger`、`IReleaseDescriptor`、`IReleaseContext`
- [单元与代数模块](#单元与代数模块)：`createGenerationController`
- [静默追踪与租约模块](#静默追踪与租约模块)：`createQuiescenceTracker`、`createObjectLeaseRegistry`、`createStringLeaseRegistry`、`createPendingTracker`
- [事务性所有权模块](#事务性所有权模块)：`createProvisionalScope`
- [变更队列模块](#变更队列模块)：`createMutationQueue`
- [调度器、中止与有界等待模块](#调度器中止与有界等待模块)：`snapshotScheduler`、`resolveScheduler`、`resolveSchedulerOption`、`createAbortController`、`abortableDelay`、`boundedWait`、`createTerminalController`
- [错误基础设施模块](#错误基础设施模块)：`LIFECYCLE_SOURCE`、`containAsyncRejection`、`createErrorCollector`
- [状态常量模块](#状态常量模块)：`LifecycleState`、`LifecycleErrorPolicy`、`DisposeTransactionKind`
- [按需导入与 tree-shaking](#按需导入与-tree-shaking)
- [错误码](#错误码)：`LifecycleErrorCode`（22 个码）逐条语义
- [诊断消息](#诊断消息)：`LifecycleErrorText`
- [高阶组合示例](#高阶组合示例)
- [全部公开 API 索引](#全部公开-api-索引)
- [排查与构建门禁](#排查与构建门禁)

---

<a id="公共基础类型"></a>

## 公共基础类型

这些类型从根入口导出，不创建runtime state：

```ts
type IDisposer = () => void
type ILifecycleState = 'open' | 'closing' | 'terminal'

type ILifecycleOwner = {
  own<T>(resource: T, descriptor: IReleaseDescriptor): T
}

type ICollectedError = Readonly<{
  source: string
  error: unknown
}>

type IErrorPolicy = 'throw' | 'collect' | 'report' | 'firstError'
```

- `IDisposer`：调用方持有的同步、应幂等释放函数形状。
- `ILifecycleOwner`：只表达可接收显式 `IReleaseDescriptor` 的 ownership handoff；`ProvisionalScope.commitTo()` 依赖它，因此同步/异步 scope 都能作为 parent，而无需共享各自不同的 dispose 形状。
- `ILifecycleState`：资源容器存活轴；领域加载状态由各自 owner 定义。
- `ICollectedError`：失败加调用方提供的 source 标签。当前声明的两个字段均 readonly；这是编译期约束，collector 不冻结每个 item。未分类原生错误原位附码，primitive 包装，已有合法外部身份保持不变；raw ledger 不经过该策略投影。
- `IErrorPolicy`：四种释放错误投影。新调用方通常选 `throw`、`collect` 或 `report`；`firstError` 主要服务已有 first-error-wins 迁移。
- `IReleaseContext`、`IReleaseDescriptor` 在下一节完整说明；其他命名类型紧邻其构造函数章节。

---

<a id="作用域与释放模块"></a>

## 作用域与释放模块

```ts
import {
  createLifecycleScope,
  createSyncLifecycleScope,
  executeReleaseDescriptor,
  createDisposeTransaction,
  createSyncStartedDisposalLedger,
  type IReleaseDescriptor,
  type IDisposerContext,
  type IReleaseContext,
  type ILifecycleScope,
  type ILifecycleScopeOptions,
  type ISyncLifecycleScope,
  type ISyncLifecycleScopeOptions,
  type ISyncReleaseDescriptor,
  type IDisposeItem,
  type IDisposeTransaction,
  type IDisposeTransactionMode,
  type IDisposeTransactionOptions,
  type ISyncStartedDisposalLedger,
  type ISyncStartedDisposalOutcome
} from '@migaia/lifecycle'
```

两条正交轴：容器存活轴（`open → closing → terminal`，由 `close()`/`dispose()` 驱动）与资源释放本身。`close()` 永远同步、幂等、不调用用户代码；`dispose()` 永远异步。

### `IReleaseDescriptor` —— 领域表达释放意图的唯一词汇

```ts
type IReleaseDescriptor = {
  readonly syncSafe?: boolean
  readonly order?: number
  readonly graceful?: (context: IReleaseContext) => void | PromiseLike<void>
  readonly gracefulTimeoutMs?: number
  readonly force: (context: IReleaseContext) => void | PromiseLike<void>
  readonly gcFallback?: boolean
  readonly custom?: (context: IReleaseContext) => void | PromiseLike<void>
}
```

字段语义：

- `syncSafe?: boolean` —— 声明该 descriptor 可被 `SyncLifecycleScope` 接受，不改变 `LifecycleScope` 本身的静态类型（同/异步由构造的具体类型决定，不由 descriptor 推断）。
- `order?: number` —— 释放排序键，缺省按 `0`；只在 `DisposeTransaction` 的 `order` 模式下生效，数值大者先释放（往「释放顺序的下方」沉降，与分配顺序相反）。
- `graceful?` —— 优雅释放；超时**只放弃等待**（不取消它），随即降级到 `force`；`graceful` 本身抛错（非超时）不会阻止 `force` 继续跑。同步返回的 `graceful` 视为已完成释放：即使超过预算也不再跑 `force`，只通过 `context.report` 上报一条 `DEADLINE_EXCEEDED` 诊断。
- `gracefulTimeoutMs?: number` —— 优雅阶段自己的预算，会被事务共享的绝对 `deadlineAt` 进一步封顶（取两者较小值）。
- `force: (context) => void | PromiseLike<void>`（**必填**）—— 必须无条件完成，不得依赖任何前置条件。
- `gcFallback?: boolean` —— 异步 scope 可注册尽力而为的 `FinalizationRegistry` 兜底，显式释放（`dispose()`/`release()`）会 unregister。存活的 scope 强引用其资源，因此不会单独回收某个仍被 scope 拥有的资源；它只能作为遗忘整个 owner 后的兜底，不能替代显式 dispose。同步 scope 接受此共享 descriptor 字段，但不注册 finalizer。
- `custom?` —— 逃生舱：一旦提供，完全接管释放，`graceful`/`force` 被忽略。

`IReleaseContext`（回调收到的第一参数）：`signal: IAbortSignal`（容器进入 closing 时中止）、`deadlineAt: number | undefined`、`scheduler?: IScheduler`（产出 `deadlineAt` 的时间域，缺省 `systemScheduler`）、`report(error: unknown): void`（诊断通道，自身 throw/rejection 交 utils 共享宿主异常队列）、`disposer?: IDisposerContext`。由 `LifecycleScope` 驱动的 disposer 才有 `disposer.join()`；该显式 owner self-join operation 在同步调用及任意 await、microtask、Promise chain、nested helper 或 timer 后都立即抛 `SCOPE_REENTRANT_DISPOSE`，不返回 outer disposal Promise。没有 scope owner 的 generic `createDisposeTransaction()` 不伪造此 capability；不要捕获 scope 后在 disposer 中直接调用 `scope.dispose()` 绕过 context。

### `createLifecycleScope`

```ts
function createLifecycleScope(options?: ILifecycleScopeOptions): ILifecycleScope

type ILifecycleScopeOptions = {
  readonly errorPolicy?: 'throw' | 'collect' | 'report' | 'firstError' // 默认 'throw'
  readonly report?: (error: unknown) => void
  readonly deadlineAt?: number
  readonly scheduler?: IScheduler // 默认 systemScheduler
}

type ILifecycleScope = ILifecycleOwner & {
  readonly lifecycle: 'open' | 'closing' | 'terminal'
  own<T>(resource: T, descriptor: IReleaseDescriptor): T
  release(resource: unknown): boolean
  close(): void
  dispose(): Promise<readonly ICollectedError[]>
  [Symbol.asyncDispose](): Promise<void> // await using；丢弃收集到的错误结果
}
```

通用异步所有权容器：

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

边界行为：

- `own(resource, descriptor)`：容器处于 `closing`/`terminal` 时抛 `SCOPE_CLOSED`/`SCOPE_TERMINAL`；在 disposer 内部重入调用抛 `SCOPE_REENTRANT_OWN`；descriptor 形状非法（`order`/`custom`/`graceful`/`gracefulTimeoutMs`/`force`，规则同 dispose 时的 descriptor 校验）时在注册时就抛 `INVALID_OPTION`，访问器抛错则原样抛出。
- `release(resource)`：反注册但不释放（调用方已自行释放），返回是否找到并移除了该条目；若曾设置 `gcFallback`，同时 unregister 对应的 `FinalizationRegistry` 条目。
- `close()`：同步、幂等；`open → closing`。
- `dispose()`：逆序（LIFO）释放全部已注册资源；并发多次调用复用同一个 Promise；需要在 disposer 中表达 owner self-join 时使用 `context.disposer.join()`，该操作抛 `SCOPE_REENTRANT_DISPOSE` 且不改变 canonical Promise；容器已 `terminal` 时仍返回首次 dispose Promise，保留原结果或 rejection。`errorPolicy: 'collect'` 时返回值为收集到的 `ICollectedError[]`；其余三种策略要么抛出要么内部上报，返回空数组。
- 提供 `[Symbol.asyncDispose](): Promise<void>`，可直接用于 `await using`（TypeScript 需包含 `ESNext.Disposable` 类型库）。

### `createSyncLifecycleScope`

```ts
function createSyncLifecycleScope(options?: ISyncLifecycleScopeOptions): ISyncLifecycleScope

type ISyncLifecycleScopeOptions = {
  readonly errorPolicy?: 'throw' | 'collect' | 'report' | 'firstError' // 默认 'throw'
  readonly report?: (error: unknown) => void
}

type ISyncReleaseDescriptor = IReleaseDescriptor & { readonly syncSafe: true }

type ISyncLifecycleScope = {
  readonly lifecycle: 'open' | 'closing' | 'terminal'
  own<T>(resource: T, descriptor: ISyncReleaseDescriptor): T
  release(resource: unknown): boolean
  close(): void
  dispose(): readonly ICollectedError[] // 永远同步
  [Symbol.dispose](): void // using；丢弃收集到的错误结果
}
```

纯同步容器：

```ts
const scope = createSyncLifecycleScope()
scope.own(node, { syncSafe: true, force: () => node.detach() })
scope.close()
const failures = scope.dispose() // 同步返回
```

约束与边界：

- 每个 descriptor 必须显式 `syncSafe: true`，否则 `own()` 在**注册时**（不是释放时）就抛 `SCOPE_SYNC_VIOLATION`。
- descriptor 形状校验与异步版本相同：`order` 非有限数、`force` 缺失等非法值在 `own()` 时抛 `INVALID_OPTION`。
- 不能 `own()` 一个 `LifecycleScope`/`ProvisionalScope` 实例（内部品牌检测），命中同样抛 `SCOPE_SYNC_VIOLATION`。
- 某个 callback（`custom`/`graceful`/`force`）若返回 thenable，在释放当次同步探测到并抛 `SCOPE_SYNC_VIOLATION`（`graceful` 违规时会继续跑 `force`，`force`/`custom` 违规则该项失败计入当前错误策略）。
- 降级链与异步版本相同（`custom` → 否则 `graceful` → `force`），但没有超时竞速——没有可等待的对象。
- `release()`/`close()` 语义与异步版本一致；`dispose()` 幂等，二次调用返回 `[]`；在 disposer 内部重入抛 `SCOPE_REENTRANT_DISPOSE`。
- 提供 `[Symbol.dispose](): void`，可直接用于 `using`（TypeScript 需包含 `ESNext.Disposable` 类型库）。

### `executeReleaseDescriptor`

```ts
function executeReleaseDescriptor(
  descriptor: IReleaseDescriptor,
  context: IReleaseContext
): Promise<readonly unknown[]>
```

独立运行单个 descriptor 的完整降级链（`custom` → 否则 `graceful`（带超时竞速）→ `force`），不经过完整事务，常用于测试或自定义编排：

```ts
const errors = await executeReleaseDescriptor(descriptor, {
  signal: controller.signal,
  deadlineAt: undefined,
  report: (e) => console.error(e)
})
```

`descriptor`、`context` 均必填，`context` 无可选项——必须直接构造完整对象。descriptor 执行及准入失败进入返回的错误数组（成功为空数组）；context getter 或非法 deadline 等 context 准入失败会使 Promise reject；`graceful` 超时时会通过 `context.report` 上报一条诊断（`DEADLINE_EXCEEDED` 或空转到 `force`），`force` 失败时额外通过 `report` 上报一条 `RELEASE_FORCE_FAILED` 标签的错误（原始错误仍原样进入返回数组）。

### `createDisposeTransaction`

```ts
function createDisposeTransaction(
  mode: { readonly kind: 'order' } | { readonly kind: 'plan' },
  options?: IDisposeTransactionOptions
): IDisposeTransaction

type IDisposeItem = { readonly source: string; readonly descriptor: IReleaseDescriptor }

type IDisposeTransactionOptions = {
  readonly errorPolicy?: 'throw' | 'collect' | 'report' | 'firstError' // 默认 'throw'
  readonly report?: (error: unknown) => void
  readonly deadlineAt?: number
  readonly scheduler?: IScheduler // 默认 systemScheduler
  readonly signal?: IAbortSignal
  readonly disposer?: IDisposerContext // LifecycleScope 驱动时传入，提供 disposer.join()
  readonly pending?: { drain(): Promise<void> }
}

type IDisposeTransaction = {
  readonly mode: { readonly kind: 'order' } | { readonly kind: 'plan' }
  run(items: readonly IDisposeItem[]): Promise<readonly ICollectedError[]>
}
```

编排多个资源的释放，`order` 弱排序或 `plan` 强序列二选一，同一实例不能混用：

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

边界行为：

- `{ kind: 'order' }`：按每个 item 的 `descriptor.order`（缺省 `0`）降序分组释放，稳定排序保留同序调用方给定的相对顺序；只在此模式读取 `order`。
- `{ kind: 'plan' }`：严格按 `items` 给定顺序执行，从不读取 `order` 字段。
- `signal?`：转发进每个 item 的 `context.signal`；`run()` 开始时自动镜像调用方传入信号的中止状态；无 `signal` 时 item 收到一个永不中止的惰性信号。
- `deadlineAt`/`scheduler`：本次 `run()` 内所有 item 共享，不逐 item 重算。
- `pending?`：全部 item 释放完后仅一次调用 `pending.drain()` 等待其触发的在途工作排空（典型传 `createPendingTracker()`）。
- descriptor 校验（`order`/`custom`/`graceful`/`gracefulTimeoutMs`/`force` 的类型与访问）逐项独立进行——一个 item 的非法 descriptor（贴 `INVALID_OPTION` 码）不阻断其余 item 的释放，会作为该 item 的失败计入错误策略。
- `errorPolicy` 语义同 `createErrorCollector`；`throw` 策略下单错保留原生实例并给未分类错误附 `SCOPE_DISPOSAL_FAILED`，primitive 通过 cause 包装；已有合法外部身份不变。多错聚合为携带 `SCOPE_DISPOSAL_FAILED` 码的 `AggregateError`。

### `mergeCleanupResults`

`mergeCleanupResults(values)` 接受 cleanup result 或其 PromiseLike 数组，等待每个结果的 `physicalCompletion` 链，返回冻结的 `{ cleanupErrors }`。错误按输入顺序及各输入的当前/迟到顺序归并；源 Promise 拒绝也保留为原错误，不会丢弃其它分支。不使用 realm-local `instanceof Promise`，跨 realm Promise 与 thenable 都可用。

`ICleanupResult<TError>` 是 lifecycle、PluginHost 与 Tray 的共同边界：当前 `cleanupErrors` 与后续 `physicalCompletion` **不重复包含同一轮错误**。领域的 logical terminal、ok、cleanupComplete 等标志仍归各调用方。不要把全量错误列表放进 physical continuation，否则会重复计数。

```ts
import { mergeCleanupResults } from '@migaia/lifecycle/disposal'

const first = new Error('flush')
const late = new Error('socket close')
const result = await mergeCleanupResults([{
  cleanupErrors: [first],
  physicalCompletion: Promise.resolve({ cleanupErrors: [late] })
}])
// result.cleanupErrors === [first, late]，两个 error 身份不变。
```

`mergeCleanupResults` observes current cleanup snapshots and their later physical continuations. Each continuation contains only newly observed errors. It accepts PromiseLike values across realms, retains original rejection identities, and merges branches in input order without discarding successful or failed siblings. Domain state stays with its owner.

### `createSyncStartedDisposalLedger`

```ts
function createSyncStartedDisposalLedger(): ISyncStartedDisposalLedger

type ISyncStartedDisposalLedger = {
  readonly lifecycle: 'open' | 'closing' | 'terminal'
  readonly pending: number
  start(source: string, callback: () => unknown): void
  seal(): ISyncStartedDisposalOutcome
  whenTerminal(): Promise<void>
}

type ICleanupResult<TError = unknown> = Readonly<{
  cleanupErrors: readonly TError[]
  physicalCompletion?: Promise<ICleanupResult<TError>>
}>

type ISyncStartedDisposalOutcome = ICleanupResult<ICollectedError> & Readonly<{
  physicalCompletion: Promise<ICleanupResult<ICollectedError>>
}>
```

用于“同步启动全部 disposer，但异步统一等待”的领域容器。Ledger 是 pending、raw error 与 terminal 的唯一事实源；调用方仍负责生成顺序计划、清空领域 registry，以及把 raw errors 投影成自己的 throw/report/aggregate 契约。

```ts
import { createSyncStartedDisposalLedger, mergeCleanupResults } from '@migaia/lifecycle/disposal'

const ledger = createSyncStartedDisposalLedger()

// 调用顺序由领域层决定；每个 callback 在 start() 的当前 stack 执行。
ledger.start('connection', () => connection.close())
ledger.start('cache', () => cache.flush())

const outcome = ledger.seal()
if (outcome.cleanupErrors.length === 1) {
  throw outcome.cleanupErrors[0].error
}

const { cleanupErrors: finalErrors } = await mergeCleanupResults([outcome])
// 合并当前快照与迟到增量；领域层决定是否 throw/aggregate/report。
```

状态和 identity：

- 初始 `open`；`start()` 不改变 lifecycle。
- 首次 `seal()` 同步进入 `closing`，冻结当时已经观察到的全部错误，并返回唯一 outcome；重复 `seal()` 返回同一对象，`outcome.physicalCompletion` 也保持同一 Promise。
- 已 seal 且 `pending === 0` 时进入 `terminal`；否则最后一个 thenable settle 后进入 `terminal`。`whenTerminal()` 只表达 terminal 等待，不承诺 Promise 对象 identity。
- 合法 thenable 永不 settle 时保持 `closing`；Ledger 不自造 timeout、abort、retry 或强制 terminal。

Callback 与 thenable：

- `start()` 先校验 `source` 为 string、`callback` 为 function；非法输入同步抛 `INVALID_OPTION`，且不调用 callback。
- callback 同步 throw 或读取 `.then` getter throw：记录进 seal 时的 `cleanupErrors` 快照；`start()` 不重抛 item failure，因此调用方仍能启动后续 item。
- thenable 的 `.then` 只读取一次，并以原 thenable 为 receiver 调用；resolve/reject first-settlement-wins。Rejection按 settlement observation order进入最终 ledger。
- 每条错误是冻结的 `{ source, error }`；原始 `error` identity不被 Ledger替换。`physicalCompletion` 因 item failure也不会 reject，避免 Ledger抢走领域错误政策。

重入和关闭边界：

- 当前 item callback/thenable probe 尚未结束时重入 `start()` 或 `seal()`，同步抛 `SCOPE_REENTRANT_OWN`（`disposalLedgerReentrant` 文案）；外层 `start()` 把它当作当前 item 的同步 failure收集。
- seal 后再 `start()` 同步抛 `SCOPE_CLOSED`（`disposalLedgerClosed` 文案），不调用新 callback。
- Ledger 没有 rollback：进入 closing 后只能等待 admitted thenables settle。

错误政策边界：Ledger 固定采用 raw `collect`。`firstError` 是最终 ledger 的第一条 observation；`throw`、`report`、`AggregateError` message/source/code和reporter failure containment全部属于调用 adapter，不应反向写入 Ledger。

---

<a id="单元与代数模块"></a>

## 单元与代数模块

```ts
import {
  createGenerationController,
  type IGenerationController,
  type IGenerationControllerOptions,
  type IGenerationRequest,
  type IGenerationToken
} from '@migaia/lifecycle'
```

### `createGenerationController`

```ts
function createGenerationController(options?: IGenerationControllerOptions): IGenerationController

type IGenerationControllerOptions = {
  readonly parentSignal?: IAbortSignal
  readonly onSuperseded?: (info: ILifecycleError) => void
  readonly scheduler?: IScheduler // 默认 systemScheduler
  readonly report?: (error: unknown) => void
}

type IGenerationToken = object

type IGenerationRequest = {
  readonly generation: number
  readonly token: IGenerationToken
  readonly signal: IAbortSignal
}

type IGenerationController = {
  readonly generation: number
  readonly disposed: boolean
  begin(options?: { readonly timeoutMs?: number }): IGenerationRequest
  isCurrent(token: IGenerationToken): boolean
  complete(token: IGenerationToken): boolean
  supersede(reason?: unknown): void
  adopt<T>(
    token: IGenerationToken,
    value: T,
    release: (value: T) => void | PromiseLike<void>,
    onReleaseError?: (error: unknown) => void
  ): boolean
  dispose(reason?: unknown): void
}
```

代数 + 每代一个 `AbortSignal`，新一代自动使旧一代失效：

```ts
const shutdown = new AbortController()
const generations = createGenerationController({ parentSignal: shutdown.signal })
const request = generations.begin({ timeoutMs: 5000 }) // 超过 5s 自动 abort 当前代
const result = await fetchWithSignal(request.signal)
if (generations.adopt(request.token, result, (v) => v.close())) {
  use(result) // 仍是当前代，安全采用
} // 否则内部已调用 release() 回收 result，返回 false
```

边界行为：

- `begin(options?)`：使当前活跃代（若存在）立即失效（触发其 `signal` 中止），`generation` 自增，返回新的 `{ generation, token, signal }`。`options.timeoutMs?` 非法（非有限/负数）抛 `INVALID_OPTION`；超过该毫秒数后当前代的 `signal` 自动中止。控制器已 `dispose()` 后调用抛 `GENERATION_DISPOSED`。
- `isCurrent(token)`：`token` 是否仍是当前代；`dispose()` 之后恒为 `false`。
- `supersede(reason?)`：作废当前代（其 `signal` 中止）但控制器本身仍可用，之后 `begin()` 仍能开新代；对已 `dispose()` 的控制器调用是空操作。
- `complete(token)`：只释放匹配的当前代，返回 true 并使 token 不再 current；先清 timer、再移除 parent listener，保持 signal 未中止。stale/disposed token 返回 false，不影响当前代。cleanup 失败仍以原 `GENERATION_CANCELLATION_FAILED` 保留原 cause，失败后 token 已作废；后续 `begin()` 仍可用。真正取消继续使用 `supersede`/parent/timeout/dispose，保持原 signal 与 reason。
- `adopt(token, value, release, onReleaseError?)`：`token` 仍是当前代时返回 `true`，`value` 留给调用方；否则调用 `release(value)` 回收并返回 `false`——`release` 本身抛出/reject 只会经 `onReleaseError` 上报，绝不反过来污染"当前是哪一代"这一状态（不会抛出、不会重新计入错误策略）。若提供了 `onSuperseded`，在过期路径上先额外触发一次携带 `GENERATION_SUPERSEDED` 码的诊断信息（非失败信号）。
- `dispose(reason?)`：终态；之后 `begin()` 恒抛 `GENERATION_DISPOSED`，`isCurrent()` 恒 `false`。
- `parentSignal` 中止时，当前活跃代同步中止（清理 timer、移除 parent listener、abort 自身 controller）；清理过程中任一步失败会聚合为 `GENERATION_CANCELLATION_FAILED`。

---

<a id="静默追踪与租约模块"></a>

## 静默追踪与租约模块

```ts
import {
  createQuiescenceTracker,
  createStringLeaseRegistry,
  createObjectLeaseRegistry,
  createPendingTracker,
  type IQuiescenceTracker,
  type ILeaseRegistry,
  type IPendingTracker
} from '@migaia/lifecycle'
```

### `createQuiescenceTracker` / `createStringLeaseRegistry`

```ts
function createQuiescenceTracker<TKey extends object>(): IQuiescenceTracker<TKey>
function createStringLeaseRegistry(): IQuiescenceTracker<string>

type IQuiescenceTracker<TKey> = {
  retain(key: TKey): IDisposer // IDisposer = () => void
  count(key: TKey): number
  whenZero(key: TKey): Promise<void> // 严格独占等待
  whenZeroOnce(key: TKey): Promise<void> // 非独占等待
  seal(key: TKey): void
  isSealed(key: TKey): boolean
  forget(key: TKey): boolean
}
```

按 key 计数的租约追踪：对象键用 `WeakMap`（自动 GC），字符串键用 `Map`（归零后自动清理未 seal 的条目）：

```ts
const tracker = createQuiescenceTracker<object>() // 或 createStringLeaseRegistry()
const release = tracker.retain(key)
tracker.count(key) // 1
tracker.seal(key) // 之后 retain(key) 抛 QUIESCENCE_SEALED
release()
await tracker.whenZero(key) // 必须先 seal，否则同步抛 QUIESCENCE_UNSEALED_WAIT
```

两者均无构造参数。边界行为：

- `retain(key)`：已 `seal(key)` 的 key 上调用抛 `QUIESCENCE_SEALED`；返回的释放函数重复调用幂等（只在首次调用时递减计数）。
- `whenZero(key)`：**必须先 `seal(key)`**，否则**同步**抛 `QUIESCENCE_UNSEALED_WAIT`（不是返回 rejected Promise）；已归零时立即 resolve。
- `whenZeroOnce(key)`：不要求 seal，随时可等待"下一次归零"，不阻塞新 `retain()`。
- `seal(key)`：幂等，标记该 key 之后拒绝新租约。
- `forget(key)`：仅当计数为 0 且没有任何等待者时才移除该 key 的状态并返回 `true`；否则返回 `false`。
- 一个未 seal 且归零的 key（字符串键）会被自动从底层 `Map` 中删除，避免长期驻留；已 `seal` 的 key 的"已 seal"事实会保留。

### `createObjectLeaseRegistry` / `createStringLeaseRegistry`

```ts
function createObjectLeaseRegistry<TKey extends object>(): ILeaseRegistry<TKey>
function createStringLeaseRegistry(): ILeaseRegistry<string>
// type ILeaseRegistry<TKey> = IQuiescenceTracker<TKey>
```

与上面完全同一引擎的别名（内部就是分别调用 `createQuiescenceTracker()`/`createStringLeaseRegistry()`），供领域友好命名的调用点使用；无构造参数。

### `createPendingTracker`

```ts
function createPendingTracker(): IPendingTracker

type IPendingTracker = {
  track<T>(promise: Promise<T>): Promise<T>
  drain(): Promise<void>
  readonly size: number
}
```

只暴露 `track`/`drain`/`size` 的窄接口，用于追踪并排空在途 Promise（内部基于一个字符串键 `createStringLeaseRegistry()`）：

```ts
const pending = createPendingTracker()
pending.track(doWork()) // 原样返回传入的 promise
await pending.drain() // 等到 size 归零；排空期间新增的 track() 不会被漏计（内部循环 whenZeroOnce）
pending.size // 当前在途数量
```

无构造参数。`track(promise)` 结算后（无论 resolve 还是 reject）自动释放内部租约；`drain()` 永不抛出（内部忽略释放函数自身的异常，`release` 本身也不会抛）；`drain()` 内部循环调用 `whenZeroOnce()`，因此排空期间新 `track()` 进来的 promise 也会被等到。

---

<a id="事务性所有权模块"></a>

## 事务性所有权模块

```ts
import {
  createProvisionalScope,
  type IProvisionalScope,
  type IProvisionalScopeOptions,
  type ILifecycleOwner
} from '@migaia/lifecycle'
```

### `createProvisionalScope`

```ts
function createProvisionalScope(options?: IProvisionalScopeOptions): IProvisionalScope

type IProvisionalScopeOptions = { readonly parentSignal?: IAbortSignal }

type IProvisionalScope = {
  readonly signal: IAbortSignal
  own<T>(resource: T, descriptor: IReleaseDescriptor): T
  commitTo(parent: ILifecycleOwner): Promise<void>
  rollback(): Promise<void>
}

type ILifecycleOwner = { own<T>(resource: T, descriptor: IReleaseDescriptor): T }
```

构造期两阶段所有权：资源先暂存这里，最终要么 `commitTo(parent)` 转移给真正的 owner，要么 `rollback()` 释放，二选一、只能选一次：

```ts
const shutdown = new AbortController()
const provisional = createProvisionalScope({ parentSignal: shutdown.signal })
const db = provisional.own(await connect(), { force: (ctx) => db.close() })
try {
  await provisional.commitTo(outerScope) // 按注册顺序逐个 own() 到 parent
} catch (error) {
  // parent 中途拒绝（如已在 closing）：已转移部分留在 parent 名下，剩余部分已被自动释放并 await 完成
}
```

边界行为：

- `own(resource, descriptor)`：已 commit/rollback 后调用抛 `PROVISIONAL_SETTLED`；descriptor 形状非法时抛 `INVALID_OPTION`（不读取 `order`，commit 时由 parent 的 `own()` 校验）。
- `commitTo(parent)`：按注册顺序逐个调用 `parent.own(resource, descriptor)`；某项失败时，已转移给 parent 的部分保留在 parent 名下，尚未转移的部分由本作用域**逆序释放并 await 完成**后才重新抛出原错误——不会有资源被两边都不持有，也不会有资源留给"none"；若失败原因是 `parent` 已处于 `closing`/`terminal`（错误码为 `SCOPE_CLOSED`/`SCOPE_TERMINAL`），额外包一层 `PROVISIONAL_PARENT_CLOSED`，原错误仍在 `cause`，遗留资源的释放失败列表挂在 `errors`。
- `rollback()`：逆序释放全部已注册资源，单错保留附码原生实例，primitive 通过 cause 包装；多错聚合为携带 `SCOPE_DISPOSAL_FAILED` 码的 `AggregateError`；幂等——并发/重复调用复用同一个 settle Promise。
- 重复 rollback 复用首次 Promise，包括其 rejection；成功 commit 后 rollback、重复 commit 或 rollback 后 commit 才以 `PROVISIONAL_SETTLED` 拒绝（rollback 返回 rejected Promise）。
- `parentSignal` 中止时（构造时已中止，或之后中止），`signal` 同步跟随中止，但不会自动触发 rollback/commit——仍需调用方显式二选一。

---

<a id="变更队列模块"></a>

## 变更队列模块

```ts
import {
  createMutationQueue,
  type IMutationQueue,
  type IMutationQueueOptions,
  type IEnqueueOptions
} from '@migaia/lifecycle'
```

### `createMutationQueue`

```ts
function createMutationQueue(options?: IMutationQueueOptions): IMutationQueue

type IMutationQueueOptions = {
  readonly queueAdmissionTimeoutMs?: number | false // 默认 undefined（只诊断，从不因排队超时而拒绝）
  readonly admissionDiagnosticMs?: number | false // 默认 1000
  readonly onAdmissionDiagnostic?: (info: { owner: string | undefined; waitedMs: number }) => void
  readonly scheduler?: IScheduler // 默认 systemScheduler
}

type IEnqueueOptions = {
  readonly owner?: string
  readonly queueAdmissionTimeoutMs?: number | false // 覆盖本次任务的队列默认值
}

type IMutationQueue = {
  enqueue<T>(task: () => T | PromiseLike<T>, options?: IEnqueueOptions): Promise<T>
  readonly size: number
}
```

严格 FIFO 串行队列，无并发池，带可选的入队 SLA 看门狗：

```ts
const queue = createMutationQueue({ queueAdmissionTimeoutMs: 5000 })
const result = await queue.enqueue(() => applyMutation(), { owner: 'sync-loop' })
queue.size // 排队中 + 正在执行的任务数（0 或 1）
```

边界行为：

- `queueAdmissionTimeoutMs`：数字表示任务在队列中等待超过这个时长即被移出队列并以 `QUEUE_ADMISSION_TIMEOUT` reject；`undefined`（默认）只诊断、从不因排队超时而拒绝；`false` 连诊断计时器也不开。
- `admissionDiagnosticMs`：仅在 `queueAdmissionTimeoutMs` 为 `undefined` 且提供了 `onAdmissionDiagnostic` 时生效的诊断阈值；`false` 关闭诊断计时器。
- `owner`：用于自依赖检测——同一 `owner` 在自己**正在运行**时又向同一队列提交新任务，会立即以 `QUEUE_SELF_DEPENDENCY` reject（因为 FIFO 队列不可能在当前任务完成前跑新任务）。这是**部分**防护：正在运行的任务提交一个不同/无 `owner` 的任务并原地 `await` 它同样会死锁，但没有可靠信号能检测这种情况，因此不拦截；安全模式是提交后续任务而不在当前任务内 `await` 它。
- `size`：只读，等于排队数加运行中的 0/1。

---

<a id="调度器中止与有界等待模块"></a>

## 调度器、中止与有界等待模块

```ts
import {
  snapshotScheduler,
  createAbortController,
  boundedWait,
  createTerminalController,
  type IAbortController,
  type ITerminalController
} from '@migaia/lifecycle'
import type { IAbortSignal } from '@migaia/utils/promise'

// 仅 leaf entry 导出的 scheduler 组合工具：
import {
  resolveScheduler,
  resolveSchedulerOption
} from '@migaia/lifecycle/scheduler'

// 调度器契约与实现来自 utils：
import { systemScheduler, type IScheduler, type IScheduledTask } from '@migaia/utils/scheduler';
import { createManualScheduler, type IManualScheduler } from '@migaia/utils/testing';
```

调度器契约 `IScheduler`/`IScheduledTask` 与默认实现 `systemScheduler`（`performance.now()` 单调时钟）由 `@migaia/utils/scheduler` 导出；`createManualScheduler`/`IManualScheduler` 由 `@migaia/utils/testing` 导出，本包不再导出或再导出它们。本包保留注入准入层：`createMutationQueue`、`createGenerationController`、`boundedWait` 与 dispose transaction 未注入 scheduler 时，使用 `resolveScheduler(systemScheduler)` 的快照，所以非法延迟仍以 lifecycle `INVALID_OPTION`（`detail.field: 'delayMs'`）拒绝；直接调用 utils `systemScheduler.schedule()` 时同样输入得到的是 utils `INVALID_ARGUMENT`。

`abortableDelay(scheduler, ms, signal, reportCleanup?)` 的前三个位置参数必填，直接使用传入 scheduler；需要准入时由调用者先 resolve/snapshot。

### `snapshotScheduler`

```ts
function snapshotScheduler(value: unknown): IScheduler | undefined
```

把任意 duck-typed 值快照成标准 `IScheduler`（校验并锁定 accessor，防止 hostile getter 二次读取）：

```ts
const snap = snapshotScheduler(candidate) // 不是合法 scheduler 时返回 undefined，而不是抛错
```

单参数 `value: unknown`，无选项；`now`/`schedule` 都不是函数时返回 `undefined`；读取 `now`/`schedule` 属性本身抛错时抛 `TypeError`（`INVALID_OPTION`）。快照的 `schedule()` 先以 `validateSchedulerDelay` 校验延迟，再调用注入的 `schedule`，然后按 `cancel`、`unref` 的顺序各读一次返回任务的访问器：`cancel` 缺失或不是函数时抛 `INVALID_OPTION`；`unref` 为函数时快照任务带 `unref()` 并以原任务为接收者转发，缺省时快照不含 `unref`；`unref` 读取抛出（原生 `TypeError`，原值在 `cause`）或不是函数时抛 `INVALID_OPTION`，且在抛出前先调用已读到的 `cancel` 回滚注入方已启动的 timer；回滚本身失败时，主错误不变，回滚错误挂在主错误的 `errors` 上。

### `resolveScheduler` / `resolveSchedulerOption`

```ts
function resolveScheduler(value: unknown): IScheduler
function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined,
  fallback: IScheduler
): IScheduler
function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined
): IScheduler | undefined
```

内部/自定义 scheduler 实现复用的边界解析函数：`resolveScheduler(value)` 对非法值抛 `SCHEDULER_INVALID` 文案的 `INVALID_OPTION` 错误（而不是像 `snapshotScheduler` 那样返回 `undefined`）；`resolveSchedulerOption(options, fallback?)` 读取 `options.scheduler`，未提供时返回 `fallback`（若调用形态未传 `fallback` 则返回 `undefined`），读取该属性本身抛错时抛 `TypeError`（`INVALID_OPTION`）。

### `createAbortController`

```ts
function createAbortController(): IAbortController
// type IAbortSignal = { readonly aborted: boolean; readonly reason?: unknown; addEventListener(...); removeEventListener(...) };
// type IAbortController = { readonly signal: IAbortSignal; abort(reason?: unknown): void };
```

本包委托当前宿主的原生 `AbortController`，返回真实 host instance（结构上与 DOM/Node 的 `AbortSignal` 兼容，可互相传递）：

```ts
const controller = createAbortController()
controller.signal.addEventListener('abort', () => console.log('aborted'))
controller.abort('reason')
```

无构造参数，也不接受 custom factory。实际对象由当前 realm 的 host-owned `globalThis.AbortController` 构造；lifecycle 不返回 facade、Proxy 或自建 EventTarget。宿主 constructor 缺失、getter throw、不可构造、构造失败或结果不满足最小 controller/signal shape时，抛保留原始 cause 的 `ENV_UNSUPPORTED`。

V2 intentional breaking behavior：

- `abort()` 与 `abort(undefined)` 使用宿主默认 reason，通常是原生 `DOMException`（name 为 `AbortError`），不再保留 V1 的 `undefined`。
- non-`undefined` explicit reason保持 `===` identity；把 structural parent signal 的 `undefined` reason转发给native child时，同样规范化为宿主 `AbortError`。
- 重复 `abort()` 幂等，不覆盖第一次固化的 reason。
- 外部 listener throw走宿主 EventTarget error channel；`try/catch controller.abort()` 不能同步捕获它，lifecycle也不再提供 `ABORT_LISTENER_FAILED`。
- Lifecycle 自己登记的 parent/cancellation callback 经过 package-private observed-subscription：处理 already-aborted、registration-time abort、post-registration recheck和幂等remove，并把自身 callback/read/cleanup failure交给对应 operation的collect/report边界。它不代理、枚举或捕获同一 signal 上的外部 listener。

如果业务需要旧式“listener错误由调用 abort 的栈聚合抛出”，应使用业务自己拥有的回调编排器；不要包裹或 monkey-patch native `AbortSignal`。

### `boundedWait`

```ts
function boundedWait(
  task: PromiseLike<unknown>,
  deadlineAt: number,
  options?: {
    readonly scheduler?: IScheduler // 默认 systemScheduler
    readonly reportCleanup?: (error: unknown) => void
  }
): Promise<boolean>
```

等到绝对截止时间为止，**从不取消**被等待的任务：

```ts
const won = await boundedWait(task, deadlineAt) // true=task 先完成；false=截止时间先到（task 仍在跑）
```

`task`、`deadlineAt` 均必填（`deadlineAt` 是绝对时刻，经 `validateSchedulerTime` 校验）。无论超时与否都会挂一个 `.catch()` 观察 `task`，避免它日后 reject 变成未处理拒绝；`deadlineAt` 已经过去时立即返回 `false`（仍会先观察 `task`）。

### `createTerminalController`

```ts
function createTerminalController(): ITerminalController

type ITerminalController = {
  readonly lifecycle: 'open' | 'closing' | 'terminal'
  close(): void
  forceTerminal(): void
  whenTerminal(): Promise<void>
}
```

独立复用的容器存活轴状态机，`createLifecycleScope`/`createSyncLifecycleScope` 内部都基于它：

```ts
const terminal = createTerminalController()
terminal.close() // open → closing，幂等
terminal.forceTerminal() // 直接进 terminal，resolve whenTerminal()
await terminal.whenTerminal()
```

无构造参数。`close()`：同步幂等，只在 `open` 时生效（`closing`/`terminal` 时空操作）。`forceTerminal()`：同步幂等，直接到 `terminal`（跳过 `closing`）。`whenTerminal()`：返回同一个 Promise，只在到达 `terminal` 时 resolve 一次；`terminal` 之前调用不会立即 resolve。

---

<a id="按需导入与-tree-shaking"></a>

## 按需导入与 tree-shaking

根入口 `@migaia/lifecycle` 提供维护中的公开原语；对 bundle retained graph敏感的消费者可使用以下稳定 subpath：

| Subpath                        | 主要导出                                                    |
| ------------------------------ | ----------------------------------------------------------- |
| `@migaia/lifecycle/abort`      | `createAbortController`、`observeAbortSubscription`、`IAbortController`、`IObservedAbortSubscription`、`IObservedAbortFailureSink`（结构化 signal 类型 `IAbortSignal` 由 `@migaia/utils` 提供） |
| `@migaia/lifecycle/scheduler`  | snapshot、resolve 与安全时间相加                               |
| `@migaia/lifecycle/quiescence` | quiescence/lease/pending trackers                           |
| `@migaia/lifecycle/scope`      | `createLifecycleScope`                                      |
| `@migaia/lifecycle/generation` | `createGenerationController`                                |
| `@migaia/lifecycle/disposal`   | release transaction与sync-start ledger                      |
| `@migaia/lifecycle/errors`     | thenable/error helpers与error identity                      |

```ts
import { createAbortController } from '@migaia/lifecycle/abort'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createSyncStartedDisposalLedger, mergeCleanupResults } from '@migaia/lifecycle/disposal'
```

Root 与 subpath 都re-export preserve-modules产物中的同一实现，同名runtime function/object保持 `===`；没有第二份module-scoped state。Package exports不开放 `dist/*` wildcard，内部文件不是公共API。

`package.json` 声明 `sideEffects: false`，各模块import不会启动timer、登记listener或修改global。Tree-shaking是bundler行为：Node/Bun直接ESM import会解析依赖图，但不会替你删除未使用代码。验证按需效果时应检查Rollup/Vite retained modules或chunk内容；单独比较gzip总字节容易被压缩噪声误导。

Leaf依赖仍会正常保留。例如 `/disposal` 必须保留thenable/error helper；“按需”只保证不把无关Scope、Generation或scheduler实现拉入，不保证单文件零依赖。

---

<a id="错误基础设施模块"></a>

## 错误基础设施模块

```ts
import {
  LIFECYCLE_SOURCE,
  containAsyncRejection,
  createErrorCollector,
  type ILifecycleError,
  type IErrorCollector
} from '@migaia/lifecycle'
import { probeThenable, assimilateCapturedThen, type IThenableProbe } from '@migaia/utils/function'
```

### `LIFECYCLE_SOURCE`

```ts
const LIFECYCLE_SOURCE: '@migaia/lifecycle'
```

本包所有错误的 `source` 字段固定值，字符串常量，无调用。

错误构造与身份附加由包内部维护；业务包应使用自身 source/code owner 构造错误。

### `containAsyncRejection`

```ts
function containAsyncRejection(value: unknown, onRejected: (error: unknown) => void): void
```

保护性地探测某个返回值是否是 thenable，是则观察其 rejection 而不让其变成未处理拒绝：

```ts
containAsyncRejection(maybeAsyncCallbackResult, (error) => report(error))
```

`value`、`onRejected` 均必填。非 thenable 时直接返回，不调用 `onRejected`；`onRejected` 自身 throw/rejection 交 utils 共享宿主异常队列（最后一道错误边界）。

### `probeThenable`（utils）

从 `@migaia/utils/function` 导入；下述工具属于 utils，不是 lifecycle 的公开导出。

```ts
function probeThenable(value: unknown): IThenableProbe

type IThenableProbe =
  | { readonly kind: 'not-thenable' }
  | { readonly kind: 'thenable'; readonly thenFn: (resolve: unknown, reject: unknown) => void }
  | { readonly kind: 'failed'; readonly error: unknown }
```

只读一次 `value.then`，返回判别结果（不是布尔值，是否 thenable/是否 getter 抛错都会区分）：

```ts
const probe = probeThenable(result)
if (probe.kind === 'thenable') {
  /* probe.thenFn 已捕获，可安全 apply 一次 */
}
```

单参数 `value: unknown`，无选项。三种结果：`'not-thenable'`（`null`/非对象非函数，或 `.then` 不是函数）、`'thenable'`（捕获到 `thenFn`）、`'failed'`（读 `.then` 本身抛错，`error` 是原始抛出物）。

### `assimilateCapturedThen`

```ts
function assimilateCapturedThen<T>(
  thenFn: (resolve: unknown, reject: unknown) => void,
  thenable: unknown
): Promise<T>
```

把 `probeThenable` 捕获到的 `thenFn` 安全地 apply 成一个真正的 `Promise`，且只调用一次（内部用 `Reflect.apply` 保持 `this === thenable`）：

```ts
const promise = assimilateCapturedThen<T>(probe.thenFn, thenableValue)
```

`thenFn`（必填，须来自 `probeThenable` 的捕获结果）、`thenable`（必填，作为 `this` receiver 传给 `thenFn`）。无可选项。

### `createErrorCollector`

```ts
function createErrorCollector(
  policy: 'throw' | 'collect' | 'report' | 'firstError',
  report: ((error: unknown) => void) | undefined
): IErrorCollector

type IErrorCollector = {
  readonly policy: IErrorPolicy
  add(source: string, error: unknown): void
  finalize(message: string): readonly ICollectedError[]
}
```

按四种错误策略收集/上报错误，`createDisposeTransaction`/`createSyncLifecycleScope` 内部都用它：

```ts
const collector = createErrorCollector('collect', undefined)
collector.add('item-1', error)
const collected = collector.finalize('teardown failed') // 'collect' 策略下返回 ICollectedError[]
```

`policy`、`report`（必填，`throw`/`collect` 可显式传 `undefined`；`report`/`firstError` 必须提供函数，否则创建时抛 `INVALID_OPTION`）。`add(source, error)` 按策略即时处理（`'report'` 策略立即调用 `report`；`'firstError'` 只记住第一个错误，其余经 `report` 观测）。`finalize(message)`：`'collect'` 返回收集到的数组；`'report'` 返回空数组（已在 `add` 时上报）；`'throw'` 单错保留原生实例并给未分类错误附 `SCOPE_DISPOSAL_FAILED`，primitive 通过 cause 包装；已有合法外部身份不变。多错聚合成携带 `SCOPE_DISPOSAL_FAILED` 码的 `AggregateError`；`'firstError'` 有错误时抛首个，否则返回空数组。

---

<a id="状态常量模块"></a>

## 状态常量模块

```ts
import {
  LifecycleState,
  LifecycleErrorPolicy,
  DisposeTransactionKind
} from '@migaia/lifecycle'
import { ThenableProbeKind } from '@migaia/utils/function'
```

均为纯常量对象（`as const`），无调用参数，用于替代裸字符串字面量做比较/`switch`。

| 常量                     | 取值                                                                                          | 语义                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `LifecycleState`         | `{ open: 'open', closing: 'closing', terminal: 'terminal' }`                                  | 容器存活轴                                                                                      |
| `LifecycleErrorPolicy`   | `{ throw: 'throw', collect: 'collect', report: 'report', firstError: 'firstError' }`          | 释放错误策略；`firstError` 只为兼容 `web-rpc` discovery-registry 的迁移语义存在，不是通用默认值 |
| `DisposeTransactionKind` | `{ order: 'order', plan: 'plan' }`                                                            | `createDisposeTransaction` 的模式                                                               |

---

<a id="错误码"></a>

## 错误码

```ts
import { LifecycleErrorCode, type ILifecycleErrorCode } from '@migaia/lifecycle'
```

稳定错误码表，**22 个码**，唯一声明处 `src/error-code.ts`，`source` 恒为 `'@migaia/lifecycle'`：

```ts
if (error.code === LifecycleErrorCode.scopeClosed) {
  /* ... */
}
```

| `LifecycleErrorCode` 键        | 码值                             | 触发条件                                                                                                              |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `delayFailed` | `DELAY_FAILED` | 相对延时无法注册、调度或清理；原错误保持可追溯，取消本身返回 false 而非错误 |
| `scopeClosed`                  | `SCOPE_CLOSED`                   | `close()` 之后调用 `own()`（异步/同步 scope）或某个 registry 的 `retain()`                                            |
| `scopeTerminal`                | `SCOPE_TERMINAL`                 | 容器已到达 `terminal` 之后，任何登记/激活操作                                                                         |
| `scopeReentrantDispose`        | `SCOPE_REENTRANT_DISPOSE`        | disposer 内部重入本 scope 的 `dispose()`                                                                              |
| `scopeReentrantOwn`            | `SCOPE_REENTRANT_OWN`            | disposer 内部调用本 scope 的 `own()`                                                                                  |
| `scopeSyncViolation`           | `SCOPE_SYNC_VIOLATION`           | `SyncLifecycleScope` 收到 `syncSafe !== true` 的 descriptor、收到一个异步 scope 实例作为资源、或某回调返回了 thenable |
| `scopeDisposalFailed`          | `SCOPE_DISPOSAL_FAILED`          | `throw` 错误策略在多个资源释放失败时的 `AggregateError` 聚合出口                                                      |
| `unitStartFailed`              | `UNIT_START_FAILED`              | `LifecycleUnit.start()` 返回的 thenable 被 reject（单元进入 `failed`）                                                |
| `generationSuperseded`         | `GENERATION_SUPERSEDED`          | 一次异步操作的结果在 `adopt()` 提交点已被更晚的 generation 取代（非失败信号，仅诊断）                                 |
| `generationCancellationFailed` | `GENERATION_CANCELLATION_FAILED` | generation 取消期间的 timer、parent listener 或 signal cleanup 失败                                                   |
| `generationDisposed`           | `GENERATION_DISPOSED`            | 在已 `dispose()` 的 `GenerationController` 上调用 `begin()`                                                           |
| `generationTimedOut` | `GENERATION_TIMED_OUT` | 当前 generation 的 timeoutMs 预算到期；signal.reason 为带码 Error |
| `quiescenceSealed`             | `QUIESCENCE_SEALED`              | `seal()` 之后又调用 `retain()`                                                                                        |
| `quiescenceUnsealedWait`       | `QUIESCENCE_UNSEALED_WAIT`       | 未先 `seal(key)` 就调用严格 `whenZero(key)`（同步抛出，非 rejected Promise）                                          |
| `provisionalSettled`           | `PROVISIONAL_SETTLED`            | 重复 commit、rollback 后 commit、成功 commit 后 rollback；重复 rollback 复用原 Promise                                                  |
| `provisionalParentClosed`      | `PROVISIONAL_PARENT_CLOSED`      | `commitTo()` 的目标 parent 已 `closing`/`terminal`，拒绝接收资源                                                      |
| `queueAdmissionTimeout`        | `QUEUE_ADMISSION_TIMEOUT`        | mutation 在队列中等待超过配置的 `queueAdmissionTimeoutMs`                                                             |
| `queueSelfDependency`          | `QUEUE_SELF_DEPENDENCY`          | 同一 `owner` 在自己尚未完成时又向同一队列提交新任务且被等待，会死锁                                                   |
| `releaseForceFailed`           | `RELEASE_FORCE_FAILED`           | descriptor 的 `force` 抛出/reject（契约要求 `force` 必须无条件成功）                                                  |
| `deadlineExceeded`             | `DEADLINE_EXCEEDED`              | 共享绝对 deadline 已过去，但仍有资源被要求进入新的 graceful 阶段；或同步 `graceful` 超过预算才返回（仍算成功，不跑 `force`）。两者都只经 `report` 上报，正常降级路径不用这个码 |
| `envUnsupported`               | `ENV_UNSUPPORTED`                | lifecycle 需要的宿主 `AbortController` 能力缺失；调度器宿主能力缺失由 utils `ENV_UNSUPPORTED` 报告                    |
| `invalidOption`                | `INVALID_OPTION`                 | scheduler 收到非法时间/延迟参数，或 descriptor 字段类型非法                                                           |

逐条设计动机见源码 `src/error-code.ts` 的 JSDoc；调用方应始终以 `error.code === LifecycleErrorCode.xxx` 判别，不要硬编码码值字符串。

---

<a id="诊断消息"></a>

## 诊断消息

```ts
import { LifecycleErrorText, type ILifecycleErrorText } from '@migaia/lifecycle'
```

稳定诊断消息表（本包内部错误信息的唯一声明处，公开是为了让调用方按文本断言/比对）：

```ts
error.message === LifecycleErrorText.disposeTransactionFailed
```

全部 49 个键：`delayFailed`、`waitCleanupReporterInvalid`、`provisionalCleanupFailed`、`disposeTransactionFailed`、`scopeReentrantDispose`、`disposeDescriptorInvalid`、`cleanupResultInvalid`、`syncGracefulOverBudget`、`mutationAdmissionTimedOut`、`generationCancellationFailed`、`disposalLedgerClosed`、`disposalLedgerReentrant`、`envUnsupported`、`abortSignalInvalid`、`schedulerTaskCancelGetterFailed`、`schedulerTaskInvalid`、`schedulerAccessorFailed`、`schedulerDeferInvalid`、`schedulerInvalid`、`schedulerNumberType`、`schedulerNumberRange`、`schedulerDelayRange`、`schedulerTimeOverflow`、`errorPolicyReporterMissing`、`generationSupersededReason`、`generationTimedOutReason`、`unitDisposedReason`、`scopeClosedReason`、`provisionalRolledBackReason`、`provisionalCommittedReason`、`quiescenceSealed`、`quiescenceUnsealedWait`、`provisionalSettled`、`provisionalParentClosed`、`unitStartFailed`、`unitTerminal`、`unitClosing`、`generationDisposed`、`generationSupersededBeforeAdopt`、`sharedDeadlinePassed`、`releaseForceFailed`、`syncCallbackReturnedThenable`、`scopeTerminal`、`scopeClosing`、`scopeReentrantOwn`、`syncScopeRequiresSyncSafe`、`syncScopeOwnsAsyncOwner`、`syncScopeDisposalFailed`、`generationTimeoutAccessorFailed`。每个键的稳定文本和语义见 `src/error-text.ts`。

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
import { attachSecondaryErrors } from '@migaia/utils/error'

const rootScope = createLifecycleScope()

async function setupModule() {
  const provisional = createProvisionalScope()
  try {
    const db = provisional.own(await connectDb(), { force: (ctx) => closeDb(db) })
    const cache = provisional.own(await connectCache(), { force: (ctx) => closeCache(cache) })
    await provisional.commitTo(rootScope) // 全部转移给 rootScope，之后随 rootScope.dispose() 释放
  } catch (error) {
    try {
      await provisional.rollback() // 完成补偿后仍保留 setup 的 primary
    } catch (cleanupError) {
      throw attachSecondaryErrors(error, [cleanupError])
    }
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
import { createDisposeTransaction, type IDisposeItem } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing';

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

### 5. 同步作用域：用 `using` 确定性释放纯同步资源

```ts
import { createSyncLifecycleScope } from '@migaia/lifecycle'

function withListeners() {
  using scope = createSyncLifecycleScope() // 离开作用域时自动调用 [Symbol.dispose]()，同步释放
  const handler = () => console.log('tick')
  window.addEventListener('tick', handler)
  scope.own(handler, { syncSafe: true, force: () => window.removeEventListener('tick', handler) })
}
```

### 6. 同步入口 + 异步清理：Registry 的 residual disposer

`dispose()` 必须同步返回、但内部 disposer 可能返回 Promise 时，用 ledger 启动并统一观测；不要让每个 Registry 自造 pending/error 状态机：

```ts
import { createSyncStartedDisposalLedger, mergeCleanupResults } from '@migaia/lifecycle'

const ledger = createSyncStartedDisposalLedger()

function disposeRegistry(): void {
  ledger.start('cache', () => cache.dispose())
  ledger.start('worker', () => worker.dispose())
  ledger.seal()
}

disposeRegistry()
const outcome = ledger.seal()
const { cleanupErrors: allErrors } = await mergeCleanupResults([outcome])
```

`cleanupErrors` 是 seal 当时的错误快照；`physicalCompletion` 只返回之后新增的错误。`mergeCleanupResults([outcome])` 等待并归并两部分；原始错误投影留给 Registry 的公开契约。

### 7. 服务退出：停止接单，等待在途任务，再释放资源

```ts
import { createLifecycleScope, createPendingTracker } from '@migaia/lifecycle'

const scope = createLifecycleScope({ errorPolicy: 'collect' })
const pending = createPendingTracker()

function handle(request: Request): Promise<Response> {
  return pending.track(route(request))
}

async function shutdown() {
  await pending.drain()
  return scope.dispose()
}
```

这里 `createPendingTracker()` 产出的 tracker 只负责“还有多少工作”，`LifecycleScope` 只负责“资源由谁释放”；职责不互相替代。

---

<a id="全部公开-api-索引"></a>

## 全部公开 API 索引

根入口 `@migaia/lifecycle` 可直接导入以下全部符号：

- 构造/执行：`createAbortController`、`createSyncStartedDisposalLedger`、`mergeCleanupResults`、`snapshotScheduler`、`containAsyncRejection`、`createErrorCollector`、`abortableDelay`、`boundedWait`、`createTerminalController`、`createLifecycleScope`、`createSyncLifecycleScope`、`createGenerationController`、`createQuiescenceTracker`、`createObjectLeaseRegistry`、`createStringLeaseRegistry`、`createPendingTracker`、`createProvisionalScope`、`createMutationQueue`、`executeReleaseDescriptor`、`createDisposeTransaction`。
- 常量：`LifecycleState`、`LifecycleErrorPolicy`、`DisposeTransactionKind`、`LifecycleErrorCode`、`LifecycleErrorText`、`LIFECYCLE_SOURCE`。
- 类型：`IDisposer`、`ILifecycleOwner`、`ILifecycleState`、`IDisposerContext`、`IReleaseContext`、`IReleaseDescriptor`、`ICollectedError`、`IErrorPolicy`、`IDisposeTransactionKind`、`IAbortController`、`ISyncStartedDisposalLedger`、`ISyncStartedDisposalOutcome`、`ICleanupResult`、`ILifecycleErrorCode`、`ILifecycleErrorText`、`ILifecycleError`、`IErrorCollector`、`ITerminalController`、`ILifecycleScope`、`ILifecycleScopeOptions`、`ISyncLifecycleScope`、`ISyncLifecycleScopeOptions`、`ISyncReleaseDescriptor`、`IGenerationController`、`IGenerationControllerOptions`、`IGenerationRequest`、`IGenerationToken`、`IQuiescenceTracker`、`ILeaseRegistry`、`IPendingTracker`、`IProvisionalScope`、`IProvisionalScopeOptions`、`IMutationQueue`、`IMutationQueueOptions`、`IEnqueueOptions`、`IDisposeItem`、`IDisposeTransaction`、`IDisposeTransactionMode`、`IDisposeTransactionOptions`。

Leaf entry 提供更小的按需边界。只有五个名称不在根入口：`@migaia/lifecycle/scheduler` 的 `resolveScheduler`、`resolveSchedulerOption`，以及 `@migaia/lifecycle/abort` 的 `observeAbortSubscription`、`IObservedAbortSubscription`、`IObservedAbortFailureSink`。`IAbortSignal` 属于 `@migaia/utils/promise`，lifecycle 不再导出；其余 leaf 符号是根入口子集。完整入口映射见“按需导入与 tree-shaking”。

---

<a id="排查与构建门禁"></a>

## 排查与构建门禁

- **`own()` 抛 `SCOPE_CLOSED`/`SCOPE_TERMINAL`**：容器已进入 `closing`/`terminal`，不接受新登记；应新建 scope，而不是复用已关闭的实例。
- **`own()`/`dispose()` 抛 `SCOPE_REENTRANT_OWN`/`SCOPE_REENTRANT_DISPOSE`**：disposer 回调内部直接调用了正在释放它的那个 scope 的 `own()`/`dispose()`；把这类逻辑挪到 disposer 之外，或改由外层协调。
- **`SyncLifecycleScope.own()` 抛 `SCOPE_SYNC_VIOLATION`**：descriptor 缺少 `syncSafe: true`，或某回调返回了 thenable，或试图 own 一个异步 `LifecycleScope`/`ProvisionalScope` 实例；同步作用域绝不 await，把异步资源迁到 `createLifecycleScope()`。
- **`whenZero(key)` 同步抛 `QUIESCENCE_UNSEALED_WAIT`**：忘记先 `seal(key)`；严格归零等待要求先切断新租约来源，改用 `whenZeroOnce()` 可跳过这一要求（但语义变为非独占）。
- **`GenerationController.begin()` 抛 `GENERATION_DISPOSED`**：控制器已 `dispose()`，不可复用，需新建一个。
- **`commitTo()` 抛 `PROVISIONAL_PARENT_CLOSED`**：目标 parent 已进入 `closing`/`terminal`；已转移的资源留在 parent 名下，未转移的部分已被自动释放，不需要再手动 `rollback()`。
- **`enqueue()` 抛 `QUEUE_SELF_DEPENDENCY`**：同一 `owner` 在自身运行期间又提交并同步等待了新任务，FIFO 队列必然死锁；拆分成两次独立的顶层调用。
- **`systemScheduler` 抛 `ENV_UNSUPPORTED`**（`source: '@migaia/utils'`）：宿主缺 `performance.now`/`setTimeout`/`clearTimeout`；注入自实现的 `IScheduler`，或改在具备这些能力的运行时里运行。
- **需要事件总线/当前值订阅/依赖图拓扑**：`@migaia/lifecycle` 刻意不提供，应分别参考 `@migaia/event-subscriber`、`@migaia/reactive`、`@migaia/capability/graph`。

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

验收用例位于 `test/` 目录。

## 可中止的相对延时

`abortableDelay(scheduler, ms, signal, reportCleanup?)` 从 `@migaia/lifecycle` 根入口导入。
`scheduler` 负责计时，`ms` 必须有限且非负；`signal` 可以传 `undefined`。
返回 `Promise<boolean>`：到期为 `true`，abort 事件先到为 `false`；调用方决定取消是否应变成领域 AbortError。
监听器注册与 scheduler 接纳结束前不提交同步 callback 的结果；接纳失败保持 primary，原始错误实例或 cause 链可追溯。
任务句柄最多 cancel 一次，abort 监听由 canonical observed-subscription 管理。

```ts
import { abortableDelay, createAbortController } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing';

const scheduler = createManualScheduler()
const controller = createAbortController()
const waiting = abortableDelay(scheduler, 250, controller.signal)
controller.abort()
console.log(await waiting) // false；没有遗留 timer
```

清理失败默认使 wait 拒绝；提供 `reportCleanup(error)` 后，清理失败走该观察渠道，不替换已完成或已取消的结果。
注册或调度失败仍拒绝，`DELAY_FAILED` 保留 native Error 的身份与 stack，不能附加身份时用 cause 保留原值。
无效时长或 cleanup reporter 在接纳前以 `INVALID_OPTION` 拒绝。

`boundedWait(task, deadlineAt, { scheduler, reportCleanup? })` 仍负责绝对截止时间与任务竞争，不会取消 task。
它的默认清理失败行为不变；可选 `reportCleanup` 允许 logger flush 把 timer 清理失败作为诊断，保留任务或 deadline winner。
批处理 debounce、health 周期调度与预算授予定时器不等同于一次性相对延时，不强行转换其 owner 语义。

### Scope 入口边界

`@migaia/lifecycle/scope` 是异步 `createLifecycleScope` 的窄入口；同步与 provisional scope 从 root 导入 `createSyncLifecycleScope` / `createProvisionalScope`。包不提供第二套 scope 实现。generation/quiescence 子路径直接映射各自 canonical owner，未构建的同名 barrel 已删除。

### 已收回内部的辅助 API

`createLifecycleUnit` 及其 option/result types 不再从 package 导出；应用使用 `createGenerationController` 管理过期任务，并由领域层持有加载状态。`createStringQuiescenceTracker` 改用有真实消费方的 `createStringLeaseRegistry`。`validateSchedulerTime`、`validateSchedulerDelay`、`tagLifecycleError`、`createLifecycleRangeError` 只供包内部使用，root 与 leaf 均不再暴露。`/scheduler` 公开 snapshot/resolve 准入工具。错误构造器与 scheduler 算术 helper 均已收回内部，不提供兼容 alias；业务错误使用所属包的身份。

Generation controller 的 `report?: (error: unknown) => void` 负责没有调用方接收的失败：adopt 未传 onReleaseError 时的过期资源释放错误，以及异步 timeout 的 timer/parent-listener 清理错误。reporter 自身的 throw/rejection 交 utils 共享宿主异常队列；省略时这些诊断不外发。

### Deferred method capture

`resolveScheduler`/`snapshotScheduler` preserve an admitted `IScheduler.defer` alongside now/schedule. Later method replacement cannot redirect registered owners; raw getters are read during admission. Missing required methods still make snapshotScheduler return undefined, while getter failures preserve cause and a supplied malformed deferred method throws a coded TypeError. This does not add a second clock or alter deadline cancellation. A legacy object may omit defer and use the utils deferred helper's zero-delay fallback.
