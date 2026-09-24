/**
 * `@migaia/plugin-host` 错误码的唯一声明处。
 *
 * 契约见 `docs/contracts/error-codes.md`：错误由 `(source, code)` 二元组唯一定位，`source` 恒为
 * `'@migaia/plugin-host'`。抛出点必须引用本文件的常量，不得内联字面量；本地化文本在 `error-text.ts`，两者按码名一一对应。
 *
 * 码值是公开 API 的一部分，改名等同破坏性变更。
 */
export const PluginHostErrorCode = {
  /**
   * Host 已完成 dispose 之后又收到任何 mutation 或注册调用时抛出。
   *
   * 终态不可逆：调用方必须新建 Host，不能复活这一个。落实两阶段生命周期契约中的 terminal 出口。
   */
  hostDisposed: 'HOST_DISPOSED',

  /**
   * Host 处于 closing 窗口（`dispose()` 已开始、尚未到达 terminal）时收到 mutation。
   *
   * 与 `HOST_DISPOSED` 分开是为了让调用方能区分「已经彻底关了」与「正在关，稍后重试也没用」，两者的诊断动作不同。
   */
  hostDisposing: 'HOST_DISPOSING',

  /**
   * 安装一个 `name` 已被占用的插件。
   *
   * 插件名是 Host 内的唯一键；调用方应改名或先 `unUse()` 旧插件。
   */
  pluginDuplicate: 'PLUGIN_DUPLICATE',

  /**
   * 对未安装的插件名调用 `unUse()` 等操作。
   *
   * 调用方通常是重复卸载或名字写错；Host 状态不变。
   */
  pluginNotInstalled: 'PLUGIN_NOT_INSTALLED',

  /**
   * A handle member, or an extension taken from it, is used while that plugin is disabled; also
   * thrown by `activate()` on a disabled lazy plugin. Enforces per-registration liveness (R2); the
   * caller should `enable` the plugin (or its restore token) before retrying.
   */
  pluginDisabled: 'PLUGIN_DISABLED',
  /**
   * A dependent plugin is temporarily suspended because one of its required providers is inactive.
   * The caller must restore or reinstall the provider and wait for automatic resume before
   * retrying. Enforces the R3 suspend dependency policy without treating the registration as
   * removed.
   */
  pluginSuspended: 'PLUGIN_SUSPENDED',
  /**
   * A lazy plugin is accessed synchronously before activation, or a synchronous install needs an
   * inactive lazy provider. Activation is an explicit async step (R9); the caller should `await
   * host.activate(name)` or install through the async `use()` path.
   */
  pluginNotActivated: 'PLUGIN_NOT_ACTIVATED',
  /**
   * `definition.getFeature(name)` or `handle.getFeature(name)` named a Feature the plugin does not
   * declare. Lookups never return `undefined` (R4); the caller has a wrong name or wrong plugin.
   */
  featureNotDeclared: 'FEATURE_NOT_DECLARED',
  /**
   * A required Feature provider was never installed in this host (a removed one reports
   * `PREREQUISITE_REMOVED`). Thrown before any install hook runs (R5); install the provider first
   * or in the same batch.
   */
  prerequisiteMissing: 'PREREQUISITE_MISSING',
  /**
   * Cross-plugin Feature references inside one batch form a cycle. Detected before any install hook
   * runs (R5); the caller must break the cycle in its plugin definitions.
   */
  dependencyCycle: 'DEPENDENCY_CYCLE',
  /**
   * `unUse`/`disable` (or a managed removal) would leave required dependents behind and cascade was
   * not requested. State is unchanged (R6); `detail.blockedBy` lists every transitive dependent in
   * cascade order — pass `cascade: true`, include them, or inspect `dryRun` first.
   */
  dependencyBlocked: 'DEPENDENCY_BLOCKED',
  /**
   * `replace(name, next)` received a candidate whose name differs from `name`. Nothing is installed
   * (R8); the caller passed the wrong definition.
   */
  replaceNameMismatch: 'REPLACE_NAME_MISMATCH',
  /**
   * `replace()` published the new provider, but at least one dependent that had to restart (no
   * `onDependencyReplaced`, or the hook threw) failed to reinstall. The replacement stays
   * committed, the previous provider is disposed, and the failed restart closure stays uninstalled.
   * `cause` is an `AggregateError` whose first entry is the restart failure, followed by the hook
   * and cleanup errors; the caller should reinstall the listed dependents after fixing them.
   */
  dependentRestartFailed: 'DEPENDENT_RESTART_FAILED',
  /**
   * A plugin definition carries a retired or unsupported field (for example `shared`), or its
   * dependency data is structurally invalid. Rejected at definition admission (R14); migrate the
   * definition to Feature dependencies.
   */
  pluginDefinitionInvalid: 'PLUGIN_DEFINITION_INVALID',

  /**
   * 插件 `install()` 抛错。原始安装错误**恒为 primary**（挂在 `cause` 上，按错误码契约 §3.2 保持 `===` 可达）。
   *
   * `detail` 保留失败插件名与按回滚顺序排列的原始 rollback identities；异步 `use()` 直接发布已完成的冻结 detail， 同步 `useSync()`
   * 发布冻结快照并通过 `detail.completion` 提供最终冻结 detail。回滚/清理失败仍经
   * `PLUGIN_INSTALL_ROLLBACK_FAILED`（诊断码）上报，永不覆盖原始构造错误（L-T39 / `docs/lifecycle/migration.sdd.md`
   * §3.7.4 M-T44）。调用方应 await completion 后再做需要完整 secondary identity 的错误转换。
   */
  pluginInstallFailed: 'PLUGIN_INSTALL_FAILED',

  /**
   * 单个插件的 `unUse()` 过程中有 disposer 失败。
   *
   * 失败被聚合后抛出，但卸载流程仍会走完 —— 一个 disposer 失败不阻断其余资源释放。调用方应把它当作资源泄漏告警而非状态回滚信号。
   */
  pluginDisposeFailed: 'PLUGIN_DISPOSE_FAILED',

  /**
   * 插件 `install()` 返回的扩展属性名与 Host 上已存在的属性冲突。
   *
   * 扩展挂载是独占的；调用方需改扩展名或调整插件安装顺序。冲突在挂载前检测，不会产生半挂载状态。
   */
  extensionDuplicate: 'EXTENSION_DUPLICATE',

  /**
   * 扩展属性名与 `Object.prototype` 上的键冲突（如 `toString`、`constructor`）。
   *
   * 允许挂载会污染原型链查找并可能被误用为原型污染入口，因此在挂载前拒绝。
   */
  extensionObjectPrototype: 'EXTENSION_OBJECT_PROTOTYPE',

  /**
   * 扩展属性名命中 Host 的保留键（`config`、`onDispose`、`usePipeline` 等）。
   *
   * 保留键是 Host 自身协议的一部分，被覆盖会让插件之间互相破坏；调用方必须改名。
   */
  extensionReserved: 'EXTENSION_RESERVED',

  /**
   * A Feature prerequisite exists but its owner is temporarily disabled. The caller may enable that
   * owner and retry the same lookup.
   */
  prerequisiteDisabled: 'PREREQUISITE_DISABLED',

  /**
   * A previously published Feature prerequisite lost its owner through removal. The caller must
   * install a provider again; retrying the unchanged lookup cannot recover it.
   */
  prerequisiteRemoved: 'PREREQUISITE_REMOVED',

  /**
   * 在插件 `install()` 生命周期之外调用 `onDispose()` 注册资源。
   *
   * 资源必须归属于某次具体的安装，否则无人负责在对应的 `unUse()` 时释放它。调用方应把注册移进 `install()` 内。
   */
  resourceOutsideInstall: 'RESOURCE_OUTSIDE_INSTALL',

  /**
   * 在插件生命周期回调（install / dispose / update）内部反过来调用 Host 的 mutation API。
   *
   * 重入会让安装事务的回滚边界无法确定。调用方应把后续 mutation 移到生命周期回调之外。
   */
  lifecycleMutation: 'LIFECYCLE_MUTATION',

  /**
   * 构造 Host 时传入了不在 `'sync' | 'async' | 'generator' | 'async-generator'` 内的 pipeline mode。
   *
   * 配置期校验，Host 不会被构造出来。
   */
  invalidPipelineMode: 'INVALID_PIPELINE_MODE',

  /**
   * 向 Host 注册了与其 pipeline mode 不兼容的 stage。
   *
   * 例如 sync 模式的 Host 收到 generator stage。模式决定了 stage 的执行与错误语义，不能混用；错误消息会同时给出 host 模式与 stage 模式。
   */
  pipelineModeMismatch: 'PIPELINE_MODE_MISMATCH',

  /**
   * 同一次 pipeline step 内重复调用 `next()`。
   *
   * 每次调用只允许推进一次，重复调用会让同一个值被下游处理多次。调用方需要检查 stage 里的分支是否遗漏了 return。
   */
  pipelineNextDuplicate: 'PIPELINE_NEXT_DUPLICATE',

  /**
   * Stage 已经返回或完成之后才调用 `next()`。
   *
   * 此时该值已无法安全进入 pipeline，调用被忽略。通常是 stage 内部把 `next()` 放进了未 await 的异步分支。
   */
  pipelineNextLate: 'PIPELINE_NEXT_LATE',

  /**
   * Pipeline 正在执行期间注册新 stage。
   *
   * 执行中改变 stage 列表会让本次执行的行为取决于注册时机。调用方应在执行开始前完成注册。
   */
  pipelineExecuting: 'PIPELINE_EXECUTING',

  /**
   * Async pipeline 的 stage 与 downstream 同时失败，二者聚合为一个 `AggregateError`（`errors` 顺序固定为 `[stageError,
   * downstreamError]`）。
   *
   * 落实 `docs/contracts/error-codes.md` §2/§3.2 的「包内新建的边界错误必须携带 `(source, code)`」；两个原始错误均以 `===` 保留于
   * `errors[]`。调用方展开 `errors` 逐条处理，不要把它当成单一 stage 失败重试。
   */
  pipelineFailed: 'PIPELINE_FAILED',

  /**
   * 诊断码，**不抛出**。
   *
   * 插件 `install()` 抛错，**且回滚过程本身也失败**时，经 `diagnostic` 通道上报（`#reportRollbackFailure`）。原始安装错误**保持为
   * primary**（顶层码 `PLUGIN_INSTALL_FAILED`、`cause === 原始错误`，见 L-T39 /
   * `docs/lifecycle/migration.sdd.md` §3.7.4 M-T44）——本码只作为附加诊断信号，不得改写或替换 primary。这是 Host
   * 状态可能不一致的信号：部分已安装插件未能干净卸载，调用方应视为不可恢复并重建 Host。
   */
  pluginInstallRollbackFailed: 'PLUGIN_INSTALL_ROLLBACK_FAILED',

  /**
   * 诊断码，**不抛出**。
   *
   * 插件 `install()` 返回值上的非枚举键被有意跳过挂载时上报。非枚举键被忽略是设计行为，但必须可观测，否则插件作者会困惑于「属性为什么没出现在 host
   * 上」。要暴露该属性需改成枚举属性。
   */
  extensionNonEnumerableIgnored: 'EXTENSION_NON_ENUMERABLE_IGNORED',

  /**
   * Mutation 在 FIFO 队列中等待超过配置的入队上限，被移出队列并拒绝。
   *
   * 这是正式 SLA 不是缺陷。阈值由调用方配置（未配置时只发诊断、不拒绝）；底座侧对应 `@migaia/lifecycle` 的 `QUEUE_ADMISSION_TIMEOUT`，本码是
   * plugin-host 边界上的包装，底座错误挂在 `cause` 上。
   *
   * 语义是**终止**：该 mutation 不会再被执行。与 `DISPOSE_STEP_TIMEOUT` 的降级继续相反。
   */
  mutationQueueTimeout: 'MUTATION_QUEUE_TIMEOUT',

  /**
   * 单个 disposer（pipeline disposer / 插件 dispose 钩子 / resource disposer）等待超过阈值仍未 settle。
   *
   * 覆盖 disposer 反过来 `await` 触发它的那次 `host.dispose()` 这种循环等待 —— 那种等待永远无法自行完成。
   *
   * 语义是**降级继续**：不中断 disposer 的执行（JS 无法安全撤销已在跑的 Promise 链），只停止等待并把这一步计为失败，让整个 dispose 事务仍能收敛到
   * disposed。与 `MUTATION_QUEUE_TIMEOUT` 的终止语义相反。
   */
  disposeStepTimeout: 'DISPOSE_STEP_TIMEOUT',

  /**
   * 入参校验失败（`TypeError`，类型不变、码作为附加字段挂上）：插件名/配置路径/pipeline stage/extension/domain core/资源 disposer
   * 等输入不满足契约时抛出。
   *
   * 落实 `docs/contracts/error-codes.md` §7「裸抛扫描」门禁与 `error-code-rollout.sdd.md` §3「参数校验统一」归纳原则。调用方修正
   * 输入后重试；这是编程错误，不是运行时状态问题。
   */
  invalidOption: 'INVALID_OPTION',
  /** Config value violates the admitted plain-data grammar; caller must supply an allowed value. */
  invalidConfigValue: 'INVALID_CONFIG_VALUE',
  /** Config input contains a reference cycle; caller must supply an acyclic value graph. */
  configCycleRejected: 'CONFIG_CYCLE_REJECTED',
  /** A lifecycle hook exceeded the admitted mutation budget and lost commit authority. */
  mutationExecutionTimeout: 'MUTATION_EXECUTION_TIMEOUT',

  /** A previously published view was logically revoked by removal or disposal. */
  registrationRevoked: 'REGISTRATION_REVOKED',

  /** Plugin install returned an own `then` key, which is never a publishable extension result. */
  installResultThenable: 'INSTALL_RESULT_THENABLE',

  /** Active pipeline work did not drain before the explicit disposal budget elapsed. */
  pipelineDrainTimeout: 'PIPELINE_DRAIN_TIMEOUT',

  /** Logical disposal completed while one or more physical cleanup tasks remain unsettled. */
  cleanupIncomplete: 'CLEANUP_INCOMPLETE',
  /**
   * `openComposition` was given a target this package never registered as a managed host.
   *
   * The managed protocol is reached through the composition entry rather than off the host
   * instance, so the only admissible targets are the ones the host registers at construction. A
   * caller that gets this has an object that is not a host of this package — a plain object, a host
   * from a different copy of the package, or a value that was never constructed at all.
   */
  compositionTargetUnmanaged: 'COMPOSITION_TARGET_UNMANAGED'
} as const

export type IPluginHostErrorCode = (typeof PluginHostErrorCode)[keyof typeof PluginHostErrorCode]

/**
 * `(source, code)` 二元组中 `source` 的唯一声明处（`docs/contracts/error-codes.md` §2）。
 *
 * 全仓每个离开 plugin-host 边界的错误都以此为 `source`，禁止在抛出点或 `error-text.ts` 手写该字符串字面量。
 */
export const PLUGIN_HOST_SOURCE = '@migaia/plugin-host' as const
