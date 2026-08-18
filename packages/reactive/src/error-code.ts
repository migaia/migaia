/**
 * `@migaia/reactive` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/reactive'`。抛出点必须引用本文件的常量，不得内联字面量。
 *
 * 迁移背景（`docs/lifecycle/migration.sdd.md` §3.7.1）：本表把包内原本裸 `throw new Error('…')` 的字符串归纳成码；随
 * `lifecycle-primitives.ts` / `generation-controller.ts` 一并迁出的 `SCOPE_CLOSED` /
 * `SCOPE_REENTRANT_DISPOSE` / `SCOPE_SYNC_VIOLATION` / `GENERATION_DISPOSED` /
 * `SCOPE_DISPOSAL_FAILED` 五个码**不进本表**，归属 `@migaia/lifecycle`。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更。
 */
export const ReactiveErrorCode = {
  /**
   * 在已 dispose 的 Signal / Computed / 自定义 Source 上调用读取或写入方法时抛出。
   *
   * 节点释放后所有对外方法一律拒绝，避免读到已断边的陈旧值。调用方应停止持有该节点的引用， 改用重新创建的实例。
   */
  nodeDisposed: 'NODE_DISPOSED',

  /**
   * 求值 Computed 时检测到它（直接或间接）读取了自己正在求值的结果。
   *
   * 循环依赖无法产生确定的值，继续求值只会死循环或返回陈旧半成品。调用方应检查依赖图，拆掉 循环引用。
   */
  circularDependency: 'CIRCULAR_DEPENDENCY',

  /**
   * 一个属于某个 Runtime 的节点，在另一个 Runtime 的追踪/所有权边界上被读取、订阅或校验时抛出。
   *
   * 每个 Runtime 维护独立的依赖图与所有权表，跨图操作无法保证一致性，静默放行会产生跨图的陈旧 依赖边。调用方应确认节点与消费它的 Runtime 是同一个，不要跨 Runtime
   * 共享节点实例。
   */
  crossRuntime: 'CROSS_RUNTIME',

  /**
   * 传入的对象不是由 `createRuntime()` 创建、或不携带内部所有权登记时抛出。
   *
   * 内核只信任自己登记过的 Runtime/节点；未登记的对象冒充 Runtime 会在后续每一步产生难以追溯的 错误，所以在入口就拒绝。调用方应确认传入的值确实来自本库的工厂函数。
   */
  notRuntimeOwned: 'NOT_RUNTIME_OWNED',

  /**
   * 同一个节点对象被重复登记到不同的 Runtime 时，在第二次登记处抛出。
   *
   * 一个节点同时属于两张依赖图，任何后续所有权校验都无法给出正确答案。调用方应为每个 Runtime 各自创建独立的节点，不要跨 Runtime 复用同一个对象。
   */
  ownershipConflict: 'OWNERSHIP_CONFLICT',

  /**
   * 检测到本库存在多份运行时副本（重复安装/打包产物与 CDN 副本共存/微前端各自打包），或 `assertSingleRuntimeCopy()` 校验到副本数大于一时抛出。
   *
   * 多副本下所有权表与同步追踪上下文互相看不见彼此，跨副本读取会静默拿到陈旧数据。调用方应 去重依赖，确保进程内只有一份本库；无法去重时才需要
   * `assertSingleRuntimeCopy()` 主动失败。
   */
  copyConflict: 'COPY_CONFLICT',

  /**
   * 跨副本诊断品牌（`Object.defineProperty` 写入的只读标记）被发现处于非预期形状时抛出。
   *
   * 品牌本应是不可变的内部诊断标记；出现这个错误意味着有代码绕过了正常路径直接篡改了它， 所有权判断已不可信。调用方应停止篡改被托管对象上的内部属性。
   */
  brandCorrupted: 'BRAND_CORRUPTED',

  /**
   * 单调版本时钟达到配置的上限（生产默认 `Number.MAX_SAFE_INTEGER`）后，再次申请新版本号时抛出。
   *
   * 原地归零会与仍存活节点持有的旧版本号碰撞、制造漏更新，因此故意 fail-stop。调用方应释放当前 Runtime 持有的全部节点、丢弃它，再创建一份新的
   * Runtime，而不是试图复用同一张依赖图。
   */
  versionExhausted: 'VERSION_EXHAUSTED',

  /**
   * 一次冲刷内的重算轮数超过 `maxFlushPasses`（默认 100）时抛出。
   *
   * 这通常意味着依赖图里存在自触发环——effect 的写操作又落回了它自己的依赖。为避免整个宿主卡死在 同步死循环里，调度器会清空剩余队列并终止本轮冲刷；调用方应检查错误信息里列出的被丢弃项，
   * 定位并拆掉环。
   */
  flushLoop: 'FLUSH_LOOP',

  /**
   * 一次冲刷中有多个 observer 的 `tick()` 失败、或多个 observable 的生命周期钩子 （`onObserved`/`onUnobserved`）失败时，作为
   * `AggregateError` 外壳抛出/上报。
   *
   * 调用方应展开 `error.errors` 逐条处理；单个 observer 失败时不会用到这个码，错误原样抛出/上报。
   */
  observerFailed: 'OBSERVER_FAILED',

  /**
   * `runBatched()` 内业务动作与其收尾的 flush 同时失败时，作为聚合外壳附加在原始业务错误的 `cause` 上。
   *
   * 业务错误优先于 flush 错误对外可见，避免原始失败原因被 finally 里的收尾错误覆盖；调用方应 从 `error.cause` 取出 flush 失败的详情。
   */
  actionFlushFailed: 'ACTION_FLUSH_FAILED',

  /**
   * 预留：异步调度策略回调或 `reportError()` 捕获到未被上层处理的错误时，作为诊断上报的通道码。
   *
   * 默认诊断出口改为 `adapter.reportError`（no-op）后，本码不再有默认抛出/上报点；保留以维持公开码表稳定，供自定义 `onAsyncError`/`onError`
   * 需要「异步调度器错误」这一语义时使用。
   */
  schedulerFailed: 'SCHEDULER_FAILED',

  /**
   * `capture()` 产生的 token 在 `commitCapture()` 时已失效、已被消费、属于另一个 tracker，或对应 的 observer 已 dispose 时抛出。
   *
   * Capture token 只能被验证并提交一次；调用方（通常是 Concurrent React 的渲染路径）应重新求值， 不要复用同一个 token。
   */
  captureInvalid: 'CAPTURE_INVALID',

  /**
   * 同一个 `IObserverBinding` 被重复调用 observe 方法（已经处于 observed 状态）时抛出。
   *
   * Binding 的 observe 不是幂等操作，重复调用意味着调用方状态机出现了重复触发。调用方应在再次 observe 前先检查 binding 当前是否已在观察中。
   */
  bindingDuplicate: 'BINDING_DUPLICATE',

  /**
   * 同一个 Runtime 对象被重复注册内部面（`registerInternals()`）时抛出。
   *
   * 内部面只应在 Runtime 构造时登记一次；重复登记视为编程错误，直接拒绝而不是静默覆盖。调用方 应检查 Runtime 构造流程，确认没有重复调用注册函数。
   */
  internalsRegistered: 'INTERNALS_REGISTERED',

  /**
   * 构造 Runtime / Scheduler / VersionClock 时传入的选项（`maxFlushPasses`、最大版本号、 traced action
   * 名称等）不满足取值要求时，在构造/调用当次抛出。
   *
   * 这是入口参数校验，早失败优于把非法配置带进运行时状态。调用方应修正传入的选项值。
   */
  invalidOption: 'INVALID_OPTION'
} as const;

export type IReactiveErrorCode = (typeof ReactiveErrorCode)[keyof typeof ReactiveErrorCode];
