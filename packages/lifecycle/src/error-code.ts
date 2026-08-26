/**
 * `@migaia/lifecycle` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/lifecycle'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更。
 */
export const LifecycleErrorCode = {
  /**
   * `close()` 之后调用 `own()` 或某个 registry 的 `retain()` 时抛出。
   *
   * 容器已停止接受新工作；调用方应新建 scope，而不是复用这个。落实 §4.1 的两阶段契约：`close()` 是同步的、不可失败的、不调用用户代码的状态变更。
   */
  scopeClosed: 'SCOPE_CLOSED',

  /**
   * 容器已到达 `terminal`（`dispose()` 已完成）之后，任何登记/激活操作都抛出。
   *
   * 与 `SCOPE_CLOSED` 分开是因为它是更强的终态信号——`terminal` 不可逆，调用方不该重试，只能新建。
   */
  scopeTerminal: 'SCOPE_TERMINAL',

  /**
   * Disposer 内部重入本 scope 的 `dispose()` 时抛出。
   *
   * 错误归属到引发重入的那个 disposer（沿正常的 try/catch 传播），其余资源照常释放完毕。调用方应把 清理逻辑移出 disposer，不要让一个资源的释放去释放正在释放它的那个
   * scope。
   */
  scopeReentrantDispose: 'SCOPE_REENTRANT_DISPOSE',

  /**
   * Disposer 内部调用本 scope 的 `own()` 时抛出。
   *
   * 同上错误归属规则。释放期间容器已进入 `closing`，再登记新资源没有人会负责释放它。
   */
  scopeReentrantOwn: 'SCOPE_REENTRANT_OWN',

  /**
   * `SyncLifecycleScope` 收到 `syncSafe !== true` 的 descriptor，或收到一个 `LifecycleScope` /
   * `ProvisionalScope` 实例作为待 own 的资源时，在注册时（而非释放时）立即抛出。
   *
   * 调用方要么把该资源迁到异步 `LifecycleScope`，要么把它的 descriptor 显式标注 `syncSafe: true` 并确保其 force/graceful 从不返回
   * thenable。
   */
  scopeSyncViolation: 'SCOPE_SYNC_VIOLATION',

  /**
   * `throw` 错误策略在多个资源释放失败时的聚合出口（`AggregateError` 外壳）。
   *
   * 调用方应展开 `error.errors` 逐条处理；单个资源失败时不会用到这个码，错误原样抛出。
   */
  scopeDisposalFailed: 'SCOPE_DISPOSAL_FAILED',

  /**
   * 一个或多个 abort listener 在同一取消派发中失败。 取消信号必须跑完全部 listener 并保留每个失败，落实 lifecycle-extraction.sdd.md
   * §4.10.2 的取消边界；调用方应检查单错本体或聚合错误的 `errors[]`，不要把取消当作未发生。
   */
  abortListenerFailed: 'ABORT_LISTENER_FAILED',

  /**
   * `LifecycleUnit.start()` 返回的 thenable 被 reject，单元进入 `failed`。
   *
   * 调用方可以显式调用 `start()`/`restart()` 开启新 generation 重试，或调用 `close()`/`dispose()` 让单元到达
   * `terminal`；`failed` 不是无出口终态。
   */
  unitStartFailed: 'UNIT_START_FAILED',

  /**
   * 一次异步操作的结果在提交点已被更晚的 generation 取代，结果被丢弃。
   *
   * 这不是失败，是正常的竞态处理信号：调用方通常只需要静默忽略，除非在诊断路径里需要感知它。
   */
  generationSuperseded: 'GENERATION_SUPERSEDED',

  /**
   * Generation 取消期间的 timer、parent listener 或 signal cleanup 失败。 generation 作废必须先完成状态收敛并按登记顺序保留所有
   * cleanup 失败，落实 lifecycle-extraction.sdd.md §4.10.2；调用方应处理该错误并依赖新 generation，不得复活旧 generation。
   */
  generationCancellationFailed: 'GENERATION_CANCELLATION_FAILED',

  /**
   * 在已经 `dispose()` 过的 `GenerationController` 上调用 `begin()`。
   *
   * 该控制器不可复用；调用方应新建一个。
   */
  generationDisposed: 'GENERATION_DISPOSED',

  /**
   * `seal()` 之后又调用 `retain()` 时抛出。
   *
   * 封存表示「不再接受新的租约」；调用方要么在 seal 之前完成所有 retain，要么改走 `whenZeroOnce()` 的非独占路径。
   */
  quiescenceSealed: 'QUIESCENCE_SEALED',

  /**
   * 未先调用 `seal(key)` 就调用严格 `whenZero(key)` 时，在调用的当次同步抛出（不是返回一个 rejected Promise）。
   *
   * 严格归零等待必须先切断新租约的来源，否则「归零」的保证不成立；调用方应先 `seal()`，或改用 `whenZeroOnce()` 自行承担二次校验的责任。
   */
  quiescenceUnsealedWait: 'QUIESCENCE_UNSEALED_WAIT',

  /**
   * 同一个 `ProvisionalScope` 二次 `commitTo()`，或在 `rollback()` 之后再次 `commitTo()`/`rollback()`。
   *
   * Commit/rollback 是二选一的终态动作；调用方的状态机出现了重复调用，需要检查调用路径。
   */
  provisionalSettled: 'PROVISIONAL_SETTLED',

  /**
   * `commitTo()` 的目标 parent 已经进入 `closing`/`terminal`，拒绝接收资源。
   *
   * 已转移给 parent 的资源保持在 parent 名下；尚未转移的部分会被这次调用自动释放，调用方不需要 再手动 `rollback()`。
   */
  provisionalParentClosed: 'PROVISIONAL_PARENT_CLOSED',

  /**
   * Mutation 在队列中等待超过配置的 `queueAdmissionTimeoutMs`，被移出队列并拒绝。
   *
   * 这是一条可配置的入队 SLA，不是硬编码行为——未配置时不会触发。调用方应检查是否有任务卡住了 队列前面的位置，或调大阈值。
   */
  queueAdmissionTimeout: 'QUEUE_ADMISSION_TIMEOUT',

  /**
   * 同一个 owner 标签在自己尚未完成时又向同一队列提交了新任务，且该提交方正在（通过 `await`） 等待这个新任务——这会死锁，因为 FIFO 队列要求前一个任务先完成。
   *
   * 调用方应避免在一个任务内部同步等待同 owner 的另一个排队任务；必要时拆分成两次独立的顶层调用。
   */
  queueSelfDependency: 'QUEUE_SELF_DEPENDENCY',

  /**
   * Descriptor 的 `force` 抛出（或其 Promise 被 reject），而契约要求 `force` 必须无条件成功完成。
   *
   * 错误仍会按当前错误策略收集/上报，释放流程仍会推进到 terminal；调用方应把这个错误当作 「不可恢复的资源泄漏风险」处理，而不是可重试的瞬时失败。
   */
  releaseForceFailed: 'RELEASE_FORCE_FAILED',

  /**
   * 共享的绝对 deadline 已经过去，但仍有资源被要求进入一个新的 graceful 阶段。
   *
   * 只在诊断/边界场景下作为显式错误码使用；正常的「graceful 超时降级到 force」走的是降级路径， 不抛出这个码（见下方「不是错误码」的说明）。
   */
  deadlineExceeded: 'DEADLINE_EXCEEDED',

  /**
   * `systemScheduler` 依赖的宿主能力（`performance.now` / `setTimeout` / `clearTimeout`）缺失。
   *
   * 首次调用 `now()`（缺 `performance.now`）或 `schedule()`（缺 `setTimeout`/`clearTimeout`）时
   * fail-fast。调用方要么注入自实现 `ILifecycleScheduler`，要么在具备这些跨运行时公共 API 的环境里运行。
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /**
   * Scheduler 收到非法的时间/延迟参数：`schedule()` 的 `delayMs` 或 manual `advance(ms)` 的 `ms` 非有限或为负数。
   *
   * 落实 `docs/contracts/runtime-neutrality.sdd.md` R-9/T-16 的「delay 有限非负、now 单调不递减」；
   * 调用方应修正传入的延迟/推进量，不要重试同一份非法参数。
   */
  invalidOption: 'INVALID_OPTION'
} as const

export type ILifecycleErrorCode = (typeof LifecycleErrorCode)[keyof typeof LifecycleErrorCode]
