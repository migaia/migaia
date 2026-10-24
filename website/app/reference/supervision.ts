/**
 * Bilingual reference checked against current packages/supervision/src, README and USEGUIDE on
 * 2026-10-18. Omitted budget overflow queues; local reservations precede parent acquisition and
 * parent leases release first. Coroutine heartbeat.intervalMs defaults to timeoutMs and its
 * failureThreshold defaults to one, distinct from health-check and process-sampling defaults.
 */
import {
  supervisionCases,
  supervisionOptionCases,
  supervisionOptionFieldExamples as fieldExamples,
  supervisionOptionExamples as optionExamples
} from './supervision-cases.js'
import type { ILibraryReference, IMemberDoc, IText, ITypeDoc } from './contract.js'

/** Keeps both locales on every reader-facing node. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Documents a property without repeating its TypeScript type. */
const p = (en: string, zh: string, fallback?: IText): IMemberDoc => ({
  summary: t(en, zh),
  ...(fallback ? { default: fallback } : {})
})
/** Documents a callable member, including its ownership result. */
const m = (
  en: string,
  zh: string,
  params: Record<string, IText>,
  returns: IText,
  example: string
): IMemberDoc => ({ summary: t(en, zh), params, returns, example })
/** Documents aliases whose discriminated cases are explained in their summary. */
const a = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })
/** Native scheduler is external to this package. */
const scheduler = p(
  'Monotonic clock and timers supplied by the application; see `IScheduler` in `@migaia/utils/scheduler`.',
  '应用提供的单调时钟与计时器；参见 `@migaia/utils/scheduler` 的 `IScheduler`。',
  t('`systemScheduler`; uses the host timers.', '默认 `systemScheduler`，使用宿主计时器。')
)
/** Failure reporting callbacks never own task completion. */
const report = p(
  'Application callback receiving each contained launch, health, cleanup or late error; returns void synchronously and must not throw. Late health-check failure remains reported after monitor closure; only the exact abort reason is suppressed, and passive failures retain the original object.',
  '应用提供的上报回调，接收启动、健康、清理及迟到失败的原始错误；同步返回空值，不能抛错。健康检查在关闭后迟到失败仍报告，只有精确取消原因不重复上报，被动失败保留原对象。'
)
/** A complete cooperative example requires no runtime adapter. */
const coroutineExample = `import { createUnitBudget } from '@migaia/supervision'
import { createCoroutineSupervisor } from '@migaia/supervision/coroutine'

const budget = createUnitBudget({ kind: 'coroutine', maxUnits: 1 })
const supervisor = createCoroutineSupervisor({
  id: 'jobs', budget, report: console.error,
  spec: { task: ({ signal, expose, heartbeat }) => new Promise<void>((resolve) => {
    expose({ ping: () => 'pong' })
    heartbeat()
    signal.addEventListener('abort', () => resolve(), { once: true })
  }) }
})
const outcome = await supervisor.start()
if (outcome.state === 'ready') console.log((await outcome.unit.exposed).ping())
await supervisor.dispose()
budget.close()`
/** Common option documentation also covers inherited profile options. */
const base: Record<string, IMemberDoc> = {
  id: p(
    'Nonempty stable name chosen by the application for diagnostics and durable process ownership.',
    '应用指定的非空稳定名称，用于诊断以及持久进程所有权记录。'
  ),
  report,
  ready: p(
    'Optional asynchronous handshake receiving the launched handle and attempt cancellation signal; resolve to admit readiness, reject or throw to fail startup.',
    '可选异步握手，接收已启动句柄及本轮取消信号；兑现后就绪，拒绝或抛错会使启动失败。',
    t('Absent: launch completion is readiness.', '默认不设置，启动完成即视为就绪。')
  ),
  startupTimeoutMs: p(
    'Finite nonnegative launch-plus-readiness deadline in scheduler milliseconds; zero expires immediately. Expiry retires the attempt and follows normal restart/terminal policy, publishing a stable outcome instead of leaving the supervisor starting.',
    '启动加就绪握手的调度器毫秒时限，须有限且非负，零立即到期；到期退役尝试并沿正常重启或终止策略发布稳定结果，不停留在启动中。',
    t('`10000` milliseconds for each attempt.', '默认每轮等待 `10000` 毫秒。')
  ),
  restart: p(
    'Automatic restart policy for classified exits; nested fields control mode, backoff and the failure window.',
    '分类退出后的自动重启策略；嵌套字段控制重启模式、退避和失败时间窗口。',
    t('An empty policy uses the nested defaults below.', '默认使用下列各个嵌套字段的默认值。')
  ),
  'restart.mode': {
    ...p(
      'Chooses which actual exits schedule an automatic restart; manual restart remains available.',
      '选择哪些实际退出会安排自动重启；手动重启仍然可以使用。',
      t('`on-failure`; normal completion stops.', '默认 `on-failure`，正常完成后停止。')
    ),
    values: { enum: 'RestartMode' }
  },
  'restart.initialDelayMs': p(
    'Finite nonnegative first restart delay in scheduler milliseconds.',
    '第一次重启前的调度器等待毫秒数，须有限且非负。',
    t('`250` milliseconds before the first retry.', '默认首次重试前等待 `250` 毫秒。')
  ),
  'restart.factor': p(
    'Finite multiplier of successive restart delays; must be at least one.',
    '连续重启延迟的有限倍数，必须大于或等于一。',
    t('`2`; each failure doubles the delay until its cap.', '默认 `2`，每次失败加倍直到达到上限。')
  ),
  'restart.maxDelayMs': p(
    'Finite nonnegative upper bound of exponential retry delay in milliseconds.',
    '指数重试延迟的毫秒上限，须为有限非负数值。',
    t('`30000` milliseconds caps backoff.', '默认退避最多等待 `30000` 毫秒。')
  ),
  'restart.maxRestarts': p(
    'Nonnegative safe integer controlling failures admitted in one sliding restart window.',
    '单个滑动重启窗口允许的失败次数，须为非负安全整数。',
    t('`5` failures before exhaustion.', '默认容许窗口内 `5` 次失败。')
  ),
  'restart.windowMs': p(
    'Finite nonnegative scheduler window for counting recent failures.',
    '计算近期失败次数的调度器时间窗口，须有限且非负。',
    t('`60000` milliseconds of failure history.', '默认保留 `60000` 毫秒失败记录。')
  ),
  terminalPolicy: p(
    'After exhaustion, keeps terminal admission closed or schedules an explicit cooldown.',
    '重启耗尽后保持终止状态，或者按明确的冷却时间重新开放准入。',
    t('Absent: remain terminal until explicit restart.', '默认保持终止状态，等待显式重启。')
  ),
  'terminalPolicy.mode': {
    ...p(
      'Selects a terminal wait until explicit restart or a timed cooldown retry after exhaustion; only disposal permanently closes the supervisor.',
      '选择耗尽后等候显式重启或冷却后自动重试；只有释放才永久关闭监督器。'
    ),
    values: { enum: 'TerminalPolicyMode' }
  },
  'terminalPolicy.afterMs': p(
    'Finite nonnegative cooldown duration required only for the cooldown policy.',
    '仅冷却策略必须提供的等待毫秒数，须为有限非负数值。'
  ),
  stop: p(
    'Ordered application drain, graceful exit and forced reap phases for each retiring unit.',
    '每个退役单元依次执行应用排空、优雅退出和强制回收三个阶段。',
    t('Absent: each phase uses its nested default.', '默认各阶段使用下列嵌套默认时限。')
  ),
  'stop.beforeTerminate': p(
    'Asynchronous application drain receiving handle, native cancellation signal and remainingMs getter; resolve when drained. Failure is reported and termination proceeds.',
    '异步应用排空回调，接收句柄、原生取消信号和剩余毫秒读取函数；排空后兑现，失败会上报并继续终止。',
    t('Absent: skip application draining work.', '默认不设置，直接跳过应用排空工作。')
  ),
  'stop.drainTimeoutMs': p(
    'Finite nonnegative maximum application drain time; a command graceMs overrides this phase only.',
    '应用排空的有限非负毫秒上限；命令中的 `graceMs` 只覆盖此阶段。',
    t('`5000` milliseconds for application drain.', '默认应用排空等待 `5000` 毫秒。')
  ),
  'stop.exitTimeoutMs': p(
    'Finite nonnegative wait for actual graceful exit before requesting force.',
    '请求强制终止之前等待实际优雅退出的毫秒数，须有限且非负。',
    t('`5000` milliseconds before force.', '默认强制终止前等待 `5000` 毫秒。')
  ),
  'stop.reapTimeoutMs': p(
    'Finite nonnegative recovery wait after force. Explicitly unsupported exit observation reports EXIT_UNOBSERVABLE immediately; abandoned leases remain held until actual exit.',
    '强制终止后的有限非负回收毫秒数；明确不支持退出观察时立即报告 EXIT_UNOBSERVABLE，abandoned 租约仍保留直到实际退出。',
    t('`5000` milliseconds of forced recovery.', '默认强制回收等待 `5000` 毫秒。')
  ),
  health: p(
    'Serial periodic checks for ready handles; consecutive failures invalidate the generation.',
    '针对就绪句柄串行执行周期检查；连续失败会使当前世代失效。',
    t('Absent: no health monitor is installed.', '默认不设置，不安装健康检查器。')
  ),
  'health.check': p(
    'Application asynchronous check receiving the current handle and cancellation signal; resolve if healthy, reject or throw to count failure.',
    '应用提供的异步检查，接收当前句柄和取消信号；健康时兑现，拒绝或抛错累计失败。'
  ),
  'health.intervalMs': p(
    'Finite positive interval between serial checks, measured by the scheduler.',
    '串行健康检查之间的调度器毫秒间隔，须为有限正数。',
    t('`5000` milliseconds between checks.', '默认检查间隔为 `5000` 毫秒。')
  ),
  'health.timeoutMs': p(
    'Finite nonnegative deadline for one health check before recording failure.',
    '单次健康检查记录失败前的等待上限，须为有限非负毫秒数。',
    t('`2000` milliseconds for one check.', '默认单次检查等待 `2000` 毫秒。')
  ),
  'health.failureThreshold': p(
    'Nonnegative safe integer threshold of consecutive failed checks that invalidates readiness.',
    '使就绪状态失效的连续检查失败阈值，须为非负安全整数。',
    t('`3` consecutive failures invalidate the unit.', '默认连续 `3` 次失败使单元失效。')
  ),
  isolation: {
    ...p(
      'Required admission accepts enforced or monitored capabilities; best effort records weaker guarantees as degradation.',
      '严格准入接受强制或监测保证；尽力模式会把较弱能力记为降级。',
      t(
        '`required`; insufficient capabilities fail construction.',
        '默认 `required`，能力不足会使构造失败。'
      )
    ),
    values: { enum: 'IsolationMode' }
  },
  requires: p(
    'Additional capability names chosen by the application, merged with profile requirements before admission.',
    '应用指定的额外能力名称，在准入前与单元策略的要求合并。',
    t('An empty list adds no capability requirements.', '默认空列表，不增加额外能力要求。')
  ),
  scheduler
}
/** Canonical launch inputs used by all profile constructors. */
const launchFields: Record<string, IMemberDoc> = {
  launcher: p(
    'Runtime adapter supplied by the application; its launch result must settle exited only after execution and resources stop.',
    '应用提供的运行时适配器；启动结果的 `exited` 必须等执行与资源全部停止后才兑现。'
  ),
  spec: p(
    'Initial application specification validated by the selected unit profile before admission.',
    '应用提供的初始运行规格，在准入之前由所选单元策略校验。'
  ),
  budget: p(
    'Shared matching-kind budget returned by `createUnitBudget`; actual exit releases its occupied lease.',
    '来自 `createUnitBudget` 的同种单元共享预算；实际退出后才释放占用租约。'
  )
}
/** Process monitor and durable registry policy. */
const processFields: Record<string, IMemberDoc> = {
  ...launchFields,
  usage: p(
    'Native resource sampling policy used when process memory or CPU limits are monitored.',
    '进程内存或处理器时长限制通过监测实现时，使用的原生资源采样策略。',
    t('Absent: samples use interval and threshold defaults.', '默认使用下列采样间隔与阈值。')
  ),
  'usage.intervalMs': p(
    'Finite positive scheduler interval for native process resource samples. Both supervisor and prewarm pool reject zero/nonfinite intervals and nonpositive or unsafe failure thresholds as RangeError/INVALID_OPTION.',
    '读取进程资源样本的调度器间隔，须有限且为正；监督器与预热池均以 `RangeError/INVALID_OPTION` 拒绝零或非有限间隔，以及非正或不安全的失败阈值。',
    t('`1000` milliseconds between samples.', '默认每隔 `1000` 毫秒采样。')
  ),
  'usage.failureThreshold': p(
    'Positive safe-integer count of consecutive sampleUsage rejections before the process is unhealthy. A successful sample resets this count; a successful sample exceeding a monitored limit terminates immediately.',
    '采样连续拒绝后使进程不健康的次数，须为正安全整数；成功样本重置计数，成功样本超过监测限制则立即终止。',
    t(
      '`3` consecutive sampleUsage rejections, not three successful over-limit samples.',
      '默认连续三次资源采样拒绝，并非三次成功越限样本。'
    )
  ),
  output: p(
    'Bounds diagnostic stdout and stderr tails while launchers continue draining regardless of observers.',
    '限制标准输出与错误输出的诊断尾部大小；适配器始终排空，不依赖观察者速度。',
    t(
      'Absent: retain bounded tails without a chunk observer.',
      '默认保留有界尾部，不登记字节块观察者。'
    )
  ),
  'output.tailBytes': p(
    'Positive safe-integer maximum bytes retained separately per output stream; zero is invalid and does not disable tail capture.',
    '每条输出流独立保留的最大字节数，须为正安全整数；零为非法值，不能用于关闭尾部捕获。',
    t('`65536` bytes for each stream.', '默认每条流保留 `65536` 字节。')
  ),
  'output.onChunk': p(
    'Synchronous observer receives stream label and drained bytes; returns void and does not own draining. Throws are reported.',
    '同步观察回调接收输出流标签和已排空字节；返回空值且不控制排空，抛错会被上报。',
    t('Absent: only bounded diagnostic tails are retained.', '默认不设置，仅保留有界诊断尾部。')
  ),
  registry: p(
    'Application durable record port and namespace for recovering prior-run process identities.',
    '应用提供的持久记录端口和命名空间，用于恢复上次运行的进程身份。',
    t('Absent: no durable records or orphan recovery.', '默认不设置，不保存记录或恢复孤儿进程。')
  ),
  'registry.port': p(
    'Application storage implementing `IProcessRegistry`; add and removal follow actual process ownership.',
    '应用实现的 `IProcessRegistry` 存储；记录增删遵循实际进程所有权。'
  ),
  'registry.namespace': p(
    'Application chosen isolation name; recovery lists only records in this namespace.',
    '应用指定的隔离名称；恢复时只列出该命名空间中的记录。'
  ),
  prewarm: p(
    'Pool from createPrewarmPool with matching budget, launcher and spec; transfers the idle handle and lease. Matching id, registry port and namespace reuse the exact warm durable record and its actual-exit cleanup; different owners create their own records.',
    '来自 `createPrewarmPool` 且预算、适配器和规格匹配的池，转交空闲句柄与租约。同标识、注册端口及命名空间复用原预热记录与实际退出清理；不同所有者另行登记。',
    t('Absent: launch every admitted process cold.', '默认不设置，每次准入都冷启动进程。')
  ),
  wallClock: p(
    'Epoch clock supplied by the application for durable launch timestamps; not used for deadlines.',
    '应用提供的纪元时钟，用于持久启动时间戳，不用于截止时间。',
    t('`systemWallClock`; uses host epoch time.', '默认 `systemWallClock`，读取宿主纪元时间。')
  )
}
/** Supervisor command surface shared by core and profile aliases. */
const supervisorMembers: Record<string, IMemberDoc> = {
  state: {
    ...p(
      'Current lifecycle state read synchronously without launching or checking the unit.',
      '同步读取当前生命周期状态，不会启动单元或执行健康检查。'
    ),
    values: { enum: 'SupervisorState' }
  },
  generation: p(
    'Attempt generation used to correlate commands and events; it does not count successful restarts.',
    '关联命令与事件的尝试世代序号，不能据此推断成功重启次数。'
  ),
  start: m(
    'Starts or joins readiness; construction creates no native unit. Startup timeout follows the configured failure policy, while acquireUnit rejection becomes LAUNCH_FAILED with cause even before a lease exists.',
    '启动或加入既有就绪过程，构造不创建原生单元；启动超时遵循失败策略，即使尚无租约，预获取拒绝也成为保留原因的 `LAUNCH_FAILED`。',
    {},
    t(
      'An `IReadyOutcome`; disposal rejects with `SCOPE_CLOSED` or `SCOPE_TERMINAL`.',
      '返回 `IReadyOutcome`；释放期间或之后以 `SCOPE_CLOSED`、`SCOPE_TERMINAL` 拒绝。'
    ),
    'const ready = await supervisor.start()'
  ),
  whenReady: m(
    'Observes stable readiness without starting a new command; cancellation rejects with the caller signal reason.',
    '观察稳定就绪结果而不发起新的启动命令；取消会以调用方信号原因拒绝。',
    {
      signal: t(
        'Optional application cancellation signal; abort affects this wait only.',
        '应用可选取消信号；中止只影响本次等待。'
      )
    },
    t(
      'The current `IReadyOutcome`, or rejection on cancellation.',
      '返回当前 `IReadyOutcome`，取消时拒绝。'
    ),
    'const waiting = supervisor.whenReady(); await supervisor.start(); const ready = await waiting'
  ),
  stop: m(
    'Drains and retires current work; concurrent calls share the pending stop Promise, and the supervisor can later start again.',
    '排空并退役当前工作；并发调用共享待定停止承诺，之后仍可再次启动。',
    {
      options: t(
        'Optional `ISupervisorStopOptions` from the caller; graceMs overrides application drain only.',
        '调用方可选的 `ISupervisorStopOptions`；`graceMs` 只覆盖应用排空。'
      )
    },
    t(
      'Resolves after bounded teardown; abandoned actual work retains its lease.',
      '有界拆卸结束后兑现；尚未实际退出的工作继续占用租约。'
    ),
    'await supervisor.stop({ graceMs: 1000 })'
  ),
  kill: m(
    'Upgrades the existing teardown to force immediately; joining callers keep the original pending stop Promise.',
    '立即把既有拆卸升级为强制终止；加入调用仍取得原来的待定停止承诺。',
    {},
    t('Resolves after the same bounded stop sequence.', '相同的有界停止流程结束后兑现。'),
    'await supervisor.kill()'
  ),
  restart: m(
    'Resets recent restart failures, retires the active unit and launches a fresh attempt.',
    '重置近期重启失败记录，退役活动单元并启动一次新的尝试。',
    {},
    t(
      'Readiness outcome for the fresh attempt; disposal rejects with a scope error.',
      '返回新尝试的就绪结果；释放状态会以作用域错误拒绝。'
    ),
    'const ready = await supervisor.restart()'
  ),
  replace: m(
    'Replaces an active unit with the same or a new spec; invalid strategy throws `INVALID_OPTION` before changing the serving unit.',
    '用相同或新规格替换活动单元；策略非法时在改变服务单元前抛出 `INVALID_OPTION`。',
    {
      options: t(
        'Replacement options: default stop-then-start and current spec. Start-then-switch needs another slot; the serving unit remains owned by its active slot after startup attempt completion. Only candidate readiness and the switched event permit cancelling the old task.',
        '替换默认先停再启并复用当前规格；先启后切需要另一名额。启动尝试完成后，服务单元仍由活动槽位拥有；必须等候候选就绪及切换事件后才取消旧任务。'
      )
    },
    t(
      '`IReplaceOutcome` reports replacement, admission refusal, or failure without hiding the original error.',
      '`IReplaceOutcome` 报告替换成功、准入拒绝或失败，保留原始错误。'
    ),
    "const outcome = await supervisor.replace({ strategy: 'start-then-switch' })"
  ),
  inspect: m(
    'Reads diagnostics without sampling native resources or modifying lifecycle state.',
    '读取诊断快照，不会采样原生资源，也不会修改生命周期状态。',
    {},
    t(
      'An `ISupervisorSnapshot` of current state and contained failures.',
      '返回当前状态和已容纳失败的 `ISupervisorSnapshot`。'
    ),
    'console.log(supervisor.inspect())'
  ),
  subscribe: m(
    'Registers a synchronous event observer; it receives `ISupervisorEvent` changes and observer throws are reported.',
    '登记同步事件观察者，接收 `ISupervisorEvent` 变化；观察者抛错会被上报。',
    {
      listener: t(
        'Application callback receives a discriminated event, returns void synchronously, and should not throw.',
        '应用回调接收带判别字段的事件，同步返回空值，不应抛错。'
      )
    },
    t('Idempotent removal function for this observer only.', '只移除本次观察者的幂等清理函数。'),
    'const off = supervisor.subscribe((event) => console.log(event.type)); await supervisor.start(); off()'
  ),
  dispose: m(
    'Closes admission permanently and joins bounded retirement; repeated in-flight calls share one disposal Promise.',
    '永久关闭准入并等待有界退役；释放期间重复调用共享同一个释放承诺。',
    {},
    t(
      'Resolves when disposal reaches its terminal state; future unit-producing commands reject.',
      '释放进入终态后兑现；后续创建单元的命令都会拒绝。'
    ),
    'await supervisor.dispose()'
  )
}
/** Shared budget surface and lease semantics. */
const budgetMembers: Record<string, IMemberDoc> = {
  kind: p(
    'Unit kind chosen at budget construction; parent and supervisor kinds must match it.',
    '构造预算时指定的单元种类；父预算和监督器的种类必须与其一致。'
  ),
  acquire: m(
    'Requests a FIFO lease respecting capacity, rate, parent and cancellation. It reserves local capacity before waiting for the parent; reservation is not a started unit. Refusal is data and composite release returns parent before child.',
    '按先进先出请求租约，遵守容量、速率、父预算及取消；先预留本地再等待父预算，预留不等于启动。拒绝以数据返回，组合租约先释放父再释放子。',
    {
      signal: t(
        'Optional caller cancellation signal; aborted requests return the aborted reason.',
        '调用方可选取消信号；中止的请求返回取消原因。'
      )
    },
    t(
      'An `IBudgetOutcome`; granted leases must be released after actual exit.',
      '返回 `IBudgetOutcome`；获准租约须在实际退出后释放。'
    ),
    "const outcome = await budget.acquire(); if (outcome.kind === 'granted') outcome.lease.release()"
  ),
  tryAcquire: m(
    'Attempts immediate admission without joining the wait queue; existing queued callers have precedence.',
    '尝试立即准入而不加入等待队列；已有排队调用方享有优先权。',
    {},
    t(
      'A synchronous granted lease or stable rejection reason.',
      '同步返回获准租约或稳定拒绝原因。'
    ),
    "const outcome = budget.tryAcquire(); if (outcome.kind === 'granted') outcome.lease.release()"
  ),
  inUse: p(
    'Number of occupied local unit leases; queued requests are counted separately.',
    '已占用本地单元租约的数量；排队请求另行计数。'
  ),
  pending: p(
    'Unresolved acquire calls including the active FIFO queue head.',
    '尚未解决的租约请求数量，包括当前先进先出队头。'
  ),
  closed: p(
    'Whether admission has permanently closed; existing occupied leases remain valid.',
    '准入是否已经永久关闭；此前已占用的租约仍然有效。'
  ),
  close: m(
    'Rejects waiting and future acquisitions; existing leases remain occupied until their owners release them.',
    '拒绝等待中和后续的租约请求；已有租约继续占用直到所有者释放。',
    {},
    t(
      'Admission is closed; repeated close calls have no further effect.',
      '准入已关闭；重复关闭没有额外效果。'
    ),
    'budget.close()'
  )
}
/** Budget constructor configuration. */
const budgetOptions: Record<string, IMemberDoc> = {
  kind: p(
    'Choose which kind of work this budget counts: processes, threads or coroutines, where a coroutine is a task running within the current runtime. Set kind when creating the budget so unrelated resource types do not share capacity. If parent is supplied, its kind must match; a mismatch makes construction throw TypeError.',
    '选择此预算统计哪种工作：进程、线程，或在当前运行环境内执行的协程任务。创建预算时设置 kind，避免不同资源类型共用同一份容量。配置 parent 父预算时，两者种类必须一致；不一致会使构造抛出 TypeError。'
  ),
  maxUnits: p(
    'Finite nonnegative integer local concurrency cap; zero admits no unit.',
    '本地并发容量的有限非负整数上限；零表示不准入任何单元。'
  ),
  overflow: {
    ...p(
      'Explicit reject refuses full capacity immediately; queue waits in FIFO order.',
      '显式拒绝模式在容量满时立即拒绝；排队模式按先进先出等待。',
      t(
        'Omitted: queues in the current implementation; set reject explicitly for immediate refusal.',
        '省略时当前实现会排队；需要立即拒绝时显式设置 `reject`。'
      )
    ),
    values: { enum: 'BudgetOverflow' }
  },
  queueTimeoutMs: p(
    'Finite positive scheduler deadline for a queued acquisition; expiry is a queue-timeout result.',
    '排队租约请求的调度器截止时间，须有限且为正；到期返回排队超时。',
    t('`30000` milliseconds for each acquisition.', '默认每个请求最多等待 `30000` 毫秒。')
  ),
  launchRate: {
    ...p(
      'Sliding grant rate independent of concurrent capacity; false disables rate limiting.',
      '独立于并发容量的滑动授予速率；`false` 表示关闭速率限制。',
      t(
        '`{ max: 8, windowMs: 1000 }` grants eight leases per second.',
        '默认 `{ max: 8, windowMs: 1000 }`，每秒授予八个租约。'
      )
    ),
    values: {
      false: t(
        'Disable launch-rate limiting while retaining concurrency limits.',
        '关闭启动速率限制，但继续遵守并发容量限制。'
      )
    }
  },
  'launchRate.max': p(
    'Positive integer maximum successful grants in one sliding launch-rate window.',
    '一个滑动启动窗口内成功授予租约的最大次数，须为正整数。'
  ),
  'launchRate.windowMs': p(
    'Finite positive scheduler length of the sliding grant-rate window.',
    '滑动租约速率窗口的调度器时长，须为有限正毫秒数。'
  ),
  parent: p(
    'Optional matching-kind budget obtained from another createUnitBudget call; the lease composes both slots.',
    '来自另一次 `createUnitBudget` 的可选同种父预算；租约同时持有两个名额。',
    t('Absent: only local admission is applied.', '默认不设置，只执行本地准入。')
  ),
  scheduler
}
/** Simple unit and identity members reused across runtime profiles. */
const identity = p(
  'Launcher-issued stable fingerprint distinguishing this exact unit from reused native identifiers.',
  '适配器签发的稳定指纹，用来区分当前单元与复用原生编号的新单元。'
)
/** Unit exit promises never imply a mere termination request. */
const exited = p(
  'Launcher Promise fulfills after actual execution and owned resources stop; requesting termination alone does not settle it.',
  '适配器承诺在实际执行与所属资源停止后兑现；仅提出终止请求不会使其完成。'
)
/** Native process or thread launch example uses an injected environment adapter. */
const processExample = `import { createUnitBudget } from '@migaia/supervision'
import { createProcessSupervisor } from '@migaia/supervision/process'
const budget = createUnitBudget({ kind: 'process', maxUnits: 2 })
const supervisor = createProcessSupervisor({ id: 'worker', launcher, spec, budget, report: console.error })
await supervisor.start()
await supervisor.dispose()
budget.close()`
/** Thread adapters supply their own native launcher. */
const threadExample = `import { createUnitBudget } from '@migaia/supervision'
import { createThreadSupervisor } from '@migaia/supervision/threads'
const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
const supervisor = createThreadSupervisor({ id: 'worker', launcher, spec: { entry: './worker.ts' }, budget, report: console.error })
await supervisor.start()
await supervisor.dispose()
budget.close()`
/** Reusable supervision type for profile-specific aliases. */
const supervisorType: ITypeDoc = {
  summary: t(
    'Application-owned command controller for one active execution unit and bounded restart policy.',
    '应用持有的命令控制器，管理一个活动执行单元及有界重启策略。'
  ),
  scenarios: [
    t(
      'Keep a background task alive and release it at application shutdown.',
      '维持后台任务运行，并在应用关闭时释放。'
    )
  ],
  example: coroutineExample,
  members: supervisorMembers
}
/** Constructor descriptors are documented without inventing native launch implementations. */
const budgetType: ITypeDoc = {
  summary: t(
    'Application-owned shared admission budget; closing admission does not release live leases.',
    '应用持有的共享准入预算；关闭准入不会释放仍存活的租约。'
  ),
  scenarios: [
    t(
      'Share a concurrency ceiling across several supervisors of the same kind.',
      '让多个同种监督器共享并发上限。'
    )
  ],
  example:
    "const budget = createUnitBudget({ kind: 'process', maxUnits: 2 }); const outcome = await budget.acquire(); if (outcome.kind === 'granted') outcome.lease.release(); budget.close()",
  members: budgetMembers
}

/** Every exported literal domain is documented even when declaration merging obscures it. */
const domains: Record<string, { summary: IText; values: Record<string, IText> }> = {
  SupervisorState: {
    summary: t(
      'Observable command and unit lifecycle states returned by state and inspect.',
      '状态属性和诊断快照呈现的命令与单元生命周期状态。'
    ),
    values: {
      idle: t(
        'No start command has created an execution attempt yet.',
        '尚未通过启动命令创建任何执行尝试。'
      ),
      queued: t(
        'Admission is waiting for the shared unit budget.',
        '准入正在等待共享单元预算授予租约。'
      ),
      starting: t(
        'Launch or readiness handshake is in progress.',
        '正在执行启动或就绪握手的过程。'
      ),
      ready: t(
        'A promoted unit is ready for application work.',
        '已有成功提升的单元可接收应用工作。'
      ),
      backoff: t(
        'A bounded restart delay is waiting to expire.',
        '正在等待有界自动重启退避时间结束。'
      ),
      stopping: t(
        'Application drain and bounded unit teardown are running.',
        '正在执行应用排空与有界单元拆卸。'
      ),
      stopped: t(
        'No unit is serving; a later start can run again.',
        '当前没有服务单元，后续可以再次启动。'
      ),
      terminal: t(
        'Restart policy exhausted or disabled further attempts.',
        '重启策略已经耗尽或停止后续自动尝试。'
      ),
      disposed: t(
        'Permanent disposal prevents future unit-producing commands.',
        '永久释放完成，禁止后续创建单元命令。'
      )
    }
  },
  ExitReason: {
    summary: t(
      'Reasons attached to exit events and last-exit diagnostics.',
      '退出事件及最近退出诊断记录携带的原因集合。'
    ),
    values: {
      exited: t(
        'The profile classified natural completion as successful.',
        '单元策略把自然完成分类为正常退出。'
      ),
      crashed: t(
        'The profile observed an unsuccessful execution result.',
        '单元策略观察到不成功的执行结果。'
      ),
      stopped: t(
        'A normal stop retired the active execution unit.',
        '正常停止命令退役了当前执行单元。'
      ),
      killed: t(
        'A force command requested immediate unit termination.',
        '强制命令要求立即终止当前执行单元。'
      ),
      abandoned: t(
        'Bounded recovery ended before actual exit was observed.',
        '有界回收结束时仍未观察到实际退出。'
      ),
      launchFailed: t(
        'Launching, attachment or readiness failed with a cause.',
        '启动、附加或就绪流程失败并携带原因。'
      ),
      startupTimeout: t(
        'Launch or readiness exceeded the startup deadline.',
        '启动或就绪超过配置的启动截止时间。'
      ),
      unhealthy: t(
        'Repeated health checks invalidated the ready generation.',
        '重复健康检查失败使就绪世代失效。'
      ),
      resourceViolation: t(
        'A monitored or native resource limit was exceeded.',
        '超过监测或原生执行的资源限制。'
      )
    }
  },
  RestartMode: {
    summary: t(
      'Selects which exits trigger automatic restart scheduling.',
      '选择哪些退出会触发自动重启调度的策略集合。'
    ),
    values: {
      never: t('Never schedule automatic retries after an exit.', '退出后从不安排自动重启尝试。'),
      onFailure: t(
        'Retry failed exits; successful natural completion stops.',
        '失败退出会重试，正常自然完成后停止。'
      ),
      always: t(
        'Restart both successful completion and failed exits.',
        '正常完成和失败退出都会再次启动。'
      )
    }
  },
  TerminalPolicyMode: {
    summary: t(
      'Controls admission after the restart failure window is exhausted.',
      '控制重启失败窗口耗尽之后的准入行为。'
    ),
    values: {
      stay: t(
        'Keep terminal state until explicit restart(); this policy does not permanently dispose the supervisor. Only dispose() closes unit-producing admission permanently.',
        '维持终止状态直到显式 `restart()`，不永久释放监督器；只有 `dispose()` 永久关闭单元创建准入。'
      ),
      cooldown: t(
        'Wait afterMs and allow another generation automatically.',
        '等待指定冷却毫秒数后允许新的世代。'
      )
    }
  },
  ReplaceStrategy: {
    summary: t(
      'Orders retirement and candidate startup during replacement.',
      '控制替换过程中旧单元退役与候选启动顺序。'
    ),
    values: {
      stopThenStart: t(
        'Retire the old unit before launching its replacement.',
        '先退役旧单元，再启动替换的新单元。'
      ),
      startThenSwitch: t(
        'Launch a second unit, switch at ready, then retire the old unit.',
        '先启动第二单元，就绪切换后退役旧单元。'
      )
    }
  },
  CapabilityLevel: {
    summary: t(
      'Launcher declarations describe the actual strength of each capability.',
      '适配器声明中描述每项能力实际保证强度的等级。'
    ),
    values: {
      enforced: t(
        'The runtime enforces this capability directly.',
        '运行时直接强制执行此项能力保证。'
      ),
      monitored: t(
        'A resource monitor detects violation and enforces recovery.',
        '资源监测发现违规后执行回收处理。'
      ),
      cooperative: t(
        'The unit must cooperate; required isolation rejects this grade.',
        '依赖单元主动配合，严格隔离拒绝此等级。'
      ),
      unsupported: t(
        'No guarantee is available; best effort records degradation.',
        '无法提供保证，尽力模式记录能力降级。'
      )
    }
  },
  IsolationMode: {
    summary: t(
      'Admission strictness for launcher capability guarantees.',
      '控制适配器能力保证是否满足准入的严格程度。'
    ),
    values: {
      required: t(
        'Accept enforced or monitored termination; reject cooperative or unsupported requirements. Thread heap-limit and exit-observation remain enforced-or-unsupported declarations; a monitored guarantee is not evidence of native enforcement.',
        '接受强制或监测终止，拒绝协作或不支持的必需能力。线程堆限制与退出观察仍仅声明强制或不支持，监测保证不代表已证明原生强制。'
      ),
      bestEffort: t(
        'Admit weak guarantees and expose their names as degraded.',
        '允许较弱保证，并公开降级能力名称。'
      )
    }
  },
  TerminationMode: {
    summary: t(
      'Termination strength requested from a unit profile or process handle.',
      '向单元策略或进程句柄请求的终止强度。'
    ),
    values: {
      graceful: t(
        'Request normal exit before the configured forced phase.',
        '在配置的强制阶段之前请求正常退出。'
      ),
      force: t(
        'Request immediate hard termination through the launcher.',
        '通过适配器立即请求强制终止单元。'
      )
    }
  },
  BudgetOverflow: {
    summary: t(
      'Capacity overflow policy of a shared admission budget.',
      '共享准入预算容量耗尽时的处理策略。'
    ),
    values: {
      queue: t(
        'Wait in FIFO order until a lease or deadline is available.',
        '按先进先出等待租约可用或截止到期。'
      ),
      reject: t(
        'Return full immediately when local capacity is occupied.',
        '本地容量占满时立即返回容量拒绝。'
      )
    }
  },
  BudgetRejection: {
    summary: t(
      'Stable refusal reasons returned instead of throwing during budget admission.',
      '预算准入时以返回数据而非抛错报告的稳定拒绝原因。'
    ),
    values: {
      full: t(
        'Concurrent capacity or a queued predecessor prevents immediate admission.',
        '并发容量或在先队列阻止立即准入。'
      ),
      rateLimited: t(
        'Recent grants reached the sliding launch-rate ceiling.',
        '近期授予次数达到滑动启动速率上限。'
      ),
      queueTimeout: t(
        'The queued acquisition exceeded its scheduler deadline.',
        '排队请求超过调度器配置截止时间。'
      ),
      aborted: t(
        'The caller cancellation signal aborted this acquisition.',
        '调用方取消信号中止了本次准入请求。'
      ),
      closed: t(
        'Budget admission closed before this request was granted.',
        '本请求获准前预算已经关闭准入。'
      )
    }
  },
  LaunchPhase: {
    summary: t(
      'Startup stage recorded in launch-failure diagnostics.',
      '启动失败诊断记录中区分具体阶段的标识。'
    ),
    values: {
      launch: t(
        'The runtime launcher failed to create a valid handle.',
        '运行时启动器未能创建有效单元句柄。'
      ),
      attach: t(
        'Post-launch attachment of owned resources failed.',
        '启动后附加所属资源的处理过程失败。'
      ),
      ready: t(
        'Application readiness handshake failed or timed out.',
        '应用就绪握手发生失败或等待超时。'
      )
    }
  },
  LaunchCause: {
    summary: t(
      'The command or policy timer responsible for a launch attempt.',
      '标识启动尝试来自哪个命令或策略计时器。'
    ),
    values: {
      start: t(
        'Initial or later start explicitly requested by application.',
        '应用显式请求的初次或后续启动。'
      ),
      restart: t(
        'Application requested a fresh restart generation.',
        '应用显式请求重新开始一个新世代。'
      ),
      replace: t(
        'An active unit is being replaced by a candidate.',
        '正在以候选单元替换现有活动单元。'
      ),
      backoff: t(
        'Automatic retry delay expired after a prior failure.',
        '先前失败后的自动重试退避已经到期。'
      ),
      cooldown: t(
        'Terminal cooldown expired and reopened automatic admission.',
        '终止冷却到期并重新开放自动准入。'
      )
    }
  },
  SupervisorEventType: {
    summary: t(
      'Discriminants of the synchronous supervisor observation stream.',
      '监督器同步观察事件流使用的判别字段集合。'
    ),
    values: {
      state: t(
        'A lifecycle transition carries previous and next state.',
        '生命周期迁移携带先前与后续状态。'
      ),
      exit: t(
        'An execution attempt exited with its classified reason.',
        '执行尝试退出并携带分类后的原因。'
      ),
      terminal: t(
        'Restart policy entered terminal state with its error.',
        '重启策略进入终止状态并携带错误。'
      ),
      switched: t(
        'Ready replacement switched the active generation.',
        '就绪替换已经切换当前活动世代。'
      ),
      restart: t(
        'A manual or automatic restart successfully became ready.',
        '手动或自动重启已成功进入就绪状态。'
      ),
      degraded: t(
        'Admitted capability degradation changed after replacement.',
        '替换之后已准入的能力降级集合改变。'
      )
    }
  },
  StandardCapability: {
    summary: t(
      'Capability names required by execution profiles beyond their own limits.',
      '执行单元策略除自身限制外使用的通用能力名称。'
    ),
    values: {
      termination: t(
        'The launcher can stop execution and observe actual completion.',
        '适配器能够停止执行并观察实际完成。'
      ),
      faultIsolation: t(
        'A unit failure cannot corrupt the supervising execution realm.',
        '单元故障不会破坏监督器所在执行域。'
      )
    }
  },
  CoroutineOutcome: {
    summary: t(
      'Coroutine settlement is carried as data on the fulfilled exit Promise.',
      '协程结算通过已兑现退出承诺中的数据表达。'
    ),
    values: {
      fulfilled: t(
        'The task or async iterator completed without rejection.',
        '任务或异步迭代器已完成且没有拒绝。'
      ),
      rejected: t(
        'The task failed; the original thrown value remains in error.',
        '任务已经失败，原始抛出值保留在错误字段。'
      )
    }
  },
  coroutineCapabilities: {
    summary: t(
      'The cooperative launcher cannot isolate faults from its shared event loop.',
      '协作启动器无法隔离共享事件循环中的故障。'
    ),
    values: {
      termination: t(
        'Termination only aborts cooperatively and waits for actual completion.',
        '终止只发出协作取消并等待实际完成。'
      ),
      'fault-isolation': t(
        'No isolation is provided from the supervising event loop.',
        '不提供与监督器事件循环之间的隔离。'
      )
    }
  },
  StdinMode: {
    summary: t(
      'Selects the standard-input carrier supplied by a process launcher.',
      '选择进程启动器提供的标准输入载体。'
    ),
    values: {
      channel: t(
        'Expose an input channel; required by stdin bootstrap.',
        '暴露输入通道，也是标准输入引导的要求。'
      ),
      ignore: t(
        'Do not expose a standard-input channel to consumers.',
        '不向调用方暴露标准输入数据通道。'
      )
    }
  },
  StdoutMode: {
    summary: t(
      'Selects channel access, diagnostic draining or ignored standard output.',
      '选择标准输出通道、诊断排空或忽略输出。'
    ),
    values: {
      channel: t(
        'Expose stdout as a consumer channel through the launcher.',
        '通过启动器把标准输出暴露为消费通道。'
      ),
      drain: t(
        'Continuously drain stdout into bounded diagnostics.',
        '持续排空标准输出并保留有界诊断。'
      ),
      ignore: t(
        'Ignore stdout rather than exposing a diagnostic stream.',
        '忽略标准输出，不提供诊断输出流。'
      )
    }
  },
  StderrMode: {
    summary: t(
      'Selects diagnostic draining or ignored standard error.',
      '选择标准错误输出的诊断排空或忽略方式。'
    ),
    values: {
      drain: t(
        'Continuously drain stderr into bounded diagnostics.',
        '持续排空标准错误并保留有界诊断。'
      ),
      ignore: t(
        'Ignore stderr rather than retaining diagnostic bytes.',
        '忽略标准错误，不保留其诊断字节。'
      )
    }
  },
  DrainedStream: {
    summary: t(
      'Identifies which drained process stream produced an observed byte chunk.',
      '标识观察到的字节块来自哪条已排空进程流。'
    ),
    values: {
      stdout: t(
        'The observed bytes came from process standard output.',
        '观察的字节来自进程标准输出流。'
      ),
      stderr: t(
        'The observed bytes came from process standard error.',
        '观察的字节来自进程标准错误输出流。'
      )
    }
  },
  ProcessCapability: {
    summary: t(
      'Process-specific guarantees inferred from launch specification fields.',
      '根据进程启动规格字段推导的专用能力保证。'
    ),
    values: {
      memoryLimit: t(
        'A requested memory ceiling must be enforced or monitored.',
        '请求的内存上限必须被强制执行或监测。'
      ),
      cpuTimeLimit: t(
        'A requested CPU-time ceiling must be enforced or monitored.',
        '请求的处理器时长上限必须被执行或监测。'
      ),
      permissions: t(
        'The launcher enforces requested permission restrictions.',
        '启动器强制执行规格中的权限限制。'
      ),
      bootstrapStdin: t(
        'The launcher sends bootstrap bytes through stdin only.',
        '启动器仅经标准输入传递引导字节。'
      ),
      bootstrapFd: t(
        'The launcher sends bootstrap bytes through a dedicated descriptor.',
        '启动器通过专用文件描述符传递引导字节。'
      )
    }
  },
  ProcessLimit: {
    summary: t(
      'Stable field names used to report process resource-limit violations.',
      '报告进程资源越限时使用的稳定字段名称。'
    ),
    values: {
      memoryBytes: t(
        'Resident process memory exceeded its requested byte limit.',
        '进程驻留内存超过请求的字节上限。'
      ),
      cpuTimeMs: t(
        'Process CPU time exceeded its requested millisecond limit.',
        '进程处理器时长超过请求的毫秒上限。'
      ),
      callWallTimeMs: t(
        'Consumer-owned call wall deadline, not a profile resource monitor.',
        '调用方负责的调用墙钟截止，不由策略监测。'
      )
    }
  },
  BootstrapVia: {
    summary: t(
      'Permitted private bootstrap carriers keep payloads out of arguments and environment.',
      '允许的私有引导载体避免载荷进入参数和环境。'
    ),
    values: {
      stdin: t(
        'Prefix the stdin channel; fd must be omitted.',
        '把载荷放在标准输入前缀，不得指定描述符。'
      ),
      fd: t(
        'Use a dedicated integer file descriptor at least three.',
        '使用大于或等于三的专用整数文件描述符。'
      )
    }
  },
  OrphanProbeResult: {
    summary: t(
      'Fingerprint-aware recovery distinguishes a live original process from PID reuse.',
      '指纹恢复区分原始存活进程与进程编号复用。'
    ),
    values: {
      alive: t(
        'The recorded original process still lives and must be terminated.',
        '记录的原始进程仍存活，需要进行终止。'
      ),
      gone: t(
        'The original process is gone; remove its stale record.',
        '原始进程已经消失，可以移除旧记录。'
      ),
      reused: t(
        'The PID now identifies another process; remove only the record.',
        '编号现属其他进程，只移除旧记录。'
      )
    }
  },
  ParentLossExitCode: {
    summary: t(
      'Parent-loss guard exit callback codes distinguish completion from forced failure.',
      '父进程丢失守卫的退出码区分正常完成和强制失败。'
    ),
    values: {
      completed: t(
        'Shutdown resolved before the deadline; invoke exit with zero.',
        '关闭在截止前兑现，以零调用退出函数。'
      ),
      forced: t(
        'Shutdown failed or timed out; invoke exit with one.',
        '关闭失败或超时，以一调用退出函数。'
      )
    }
  },
  ThreadUnitKind: {
    summary: t(
      'Fixed unit kind that links thread profiles to matching shared budgets.',
      '把线程单元策略与对应共享预算关联的固定种类。'
    ),
    values: {
      thread: t(
        'Use this kind when creating a budget for native workers.',
        '为原生工作线程创建预算时选择此种类。'
      )
    }
  },
  ThreadCapability: {
    summary: t(
      'Native worker guarantees in addition to standard isolation capabilities.',
      '除通用隔离能力之外的原生工作线程保证。'
    ),
    values: {
      heapLimit: t(
        'The launcher enforces a requested worker heap byte limit.',
        '启动器强制执行工作线程堆字节上限。'
      ),
      exitObservation: t(
        'The launcher resolves actual exit after the worker stopped.',
        '工作线程停止后启动器才兑现实际退出。'
      )
    }
  },
  ThreadLimit: {
    summary: t(
      'Native worker limit reported in its final exit status.',
      '原生工作线程最终退出状态报告的资源限制。'
    ),
    values: {
      heapBytes: t(
        'The runtime reported the configured worker heap ceiling.',
        '运行时报告已经达到配置的线程堆上限。'
      )
    }
  }
}
/** Error scenarios also explain the corresponding stable diagnostic text entries. */
const errors: Record<string, IText> = {
  invalidOption: t(
    '`INVALID_OPTION`: invalid constructor, specification or command option; correct the named field before retrying.',
    '`INVALID_OPTION`：构造、规格或命令选项非法；重试前修正指明的字段。'
  ),
  capabilityUnsupported: t(
    '`CAPABILITY_UNSUPPORTED`: required capability lacks a sufficient guarantee; change launcher or isolation policy.',
    '`CAPABILITY_UNSUPPORTED`：必需能力保证不足；更换启动器或隔离策略。'
  ),
  launchFailed: t(
    'LAUNCH_FAILED: preacquisition, launch, attachment or readiness failed. An acquireUnit failure before lease acquisition still returns a controlled failed readiness outcome and follows the configured failure policy; inspect phase and preserved cause.',
    '`LAUNCH_FAILED`：预获取、启动、附加或就绪失败；租约前的预获取失败仍返回受控就绪失败并遵循既定策略，检查阶段及保留原因。'
  ),
  startupTimeout: t(
    'STARTUP_TIMEOUT: startup missed its deadline. Bounded retirement advances to the configured backoff, stopped or terminal policy without leaking a temporary terminal event or leaving starting stuck; readiness receives a stable failed result.',
    '`STARTUP_TIMEOUT`：启动超期，有界退役后进入既定退避、停止或终止策略，不泄露临时终止事件，也不滞留启动中；就绪观察取得稳定失败结果。'
  ),
  exitUnexpected: t(
    '`EXIT_UNEXPECTED`: unexpected actual exit; inspect native status and original cause.',
    '`EXIT_UNEXPECTED`：发生意外实际退出；检查原生状态和原始原因。'
  ),
  unhealthy: t(
    '`UNHEALTHY`: health failures crossed the threshold; the generation is invalidated.',
    '`UNHEALTHY`：健康失败超过阈值；当前运行世代被标记失效。'
  ),
  resourceLimitExceeded: t(
    '`RESOURCE_LIMIT_EXCEEDED`: resource monitoring observed a limit breach; inspect the limit detail.',
    '`RESOURCE_LIMIT_EXCEEDED`：资源监测发现越限；检查具体限制字段。'
  ),
  reapTimeout: t(
    '`REAP_TIMEOUT`: observable exit or pending launch exceeded its recovery deadline; the lease remains occupied.',
    '`REAP_TIMEOUT`：可观察退出或尚未完成的启动超过回收期限；租约继续保持占用。'
  ),
  exitUnobservable: t(
    '`EXIT_UNOBSERVABLE`: the launcher explicitly declares exit-observation unsupported. Force reports immediately with kind, generation and capability, publishes abandoned, and retains the lease until actual exit. Choose an observable launcher when an exit receipt is required.',
    '`EXIT_UNOBSERVABLE`：启动器明确声明 exit-observation 不支持；强制回收立即报告 kind、generation、capability 并发布 abandoned，租约保留直到实际退出。需要退出回执时更换可观察的启动器。'
  ),
  supervisionExhausted: t(
    '`SUPERVISION_EXHAUSTED`: restart window exhausted; inspect terminal error before explicit restart.',
    '`SUPERVISION_EXHAUSTED`：重启窗口耗尽；显式重启之前检查终止错误。'
  ),
  scopeClosed: t(
    '`SCOPE_CLOSED`: a unit-producing command ran during disposal; wait for completion.',
    '`SCOPE_CLOSED`：释放期间执行创建单元命令；等待释放流程结束。'
  ),
  scopeTerminal: t(
    '`SCOPE_TERMINAL`: a unit-producing command ran after disposal; create a new supervisor.',
    '`SCOPE_TERMINAL`：释放后执行创建单元命令；应创建新的监督器。'
  ),
  heartbeatMissed: t(
    '`HEARTBEAT_MISSED`: a coroutine heartbeat became stale; inspect cooperative task progress.',
    '`HEARTBEAT_MISSED`：协程心跳已过期；检查协作任务是否继续推进。'
  ),
  orphanReclaimFailed: t(
    'ORPHAN_RECLAIM_FAILED: registry listing or a per-record probe/termination/removal failed. Listing failure is collected and reported with detail.step=list and original cause; no record is touched. Failed records remain available for retry.',
    '`ORPHAN_RECLAIM_FAILED`：注册表列举或逐记录探测、终止及删除失败；列举失败经收集和报告，详情步骤为 `list` 并保留原始原因，不触碰任何记录，失败记录留待重试。'
  )
}
domains.SupervisionErrorCode = {
  summary: t(
    'Stable semantic errors from supervisor construction and contained execution failures.',
    '监督器构造与受控执行失败使用的稳定语义错误码。'
  ),
  values: errors
}
domains.SupervisionErrorText = {
  summary: t(
    'Canonical diagnostic messages associated with the supervision error-code scenarios.',
    '与监督错误码场景对应的规范诊断消息集合。'
  ),
  values: errors
}
/** Each common field has a short example at its own configuration boundary. */
for (const [field, doc] of Object.entries(base)) {
  Object.assign(doc, { example: fieldExamples['base.' + field] })
}
Object.assign(report, {
  whenToUse: t(
    'Supply a synchronous nonthrowing sink for contained failures. A failed drain is reported while retirement continues. Reporting does not retry work or complete shutdown; this callback is required.',
    '提供同步、不抛错的失败接收器。排空失败会上报，退役仍继续。上报不会重试工作，也不会代替完成关闭；此回调为必填项。'
  ),
  example: optionExamples.stop
})
Object.assign(scheduler, { example: fieldExamples['base.scheduler'] })
Object.assign(base.ready!, {
  whenToUse: t(
    'Set ready when creating a handle does not yet make its service usable. Resolve after the handshake; rejection fails startup and follows restart policy. Omit it to accept launch completion as readiness.',
    '创建句柄后服务仍需握手时设置 ready。握手成功后兑现，拒绝会使启动失败并沿重启策略处理。省略时启动完成就视为就绪。'
  )
})
Object.assign(base['restart.mode']!, {
  whenToUse: t(
    'Use on-failure to retry crashes but stop after normal completion. never disables automatic retries; always also restarts normal exits. Omission selects on-failure. The task follows the configured backoff when a startup attempt fails.',
    '崩溃后需要重试、正常结束后应停止时使用 on-failure。never 关闭自动重试，always 也会重启正常退出。省略时使用 on-failure。启动尝试失败后，任务按所配置的退避策略处理。'
  )
})
Object.assign(base['terminalPolicy.mode']!, {
  whenToUse: t(
    'Choose stay when an operator must intervene after restart exhaustion. cooldown reopens admission after afterMs. Omitting terminalPolicy keeps the stay behavior. Disposal permanently closes either policy.',
    '重启耗尽后需要人工介入时选择 stay；cooldown 在 afterMs 后重新准入。省略 terminalPolicy 时保持等待。释放则永久关闭任一种策略。'
  )
})
for (const field of ['stop', 'stop.beforeTerminate'])
  Object.assign(base[field]!, {
    whenToUse: t(
      'Set beforeTerminate to drain pending application work before termination. Resolve after flushing; rejection is reported and retirement continues. drainTimeoutMs, exitTimeoutMs and reapTimeoutMs bound separate phases. Omit the callback to skip draining; omitted phase limits are 5000 ms.',
      '终止前需要排空应用待处理工作时设置 beforeTerminate。写完后兑现，拒绝会上报但继续退役。drainTimeoutMs、exitTimeoutMs 和 reapTimeoutMs 分别限制不同阶段。省略回调就跳过排空，省略阶段时限则各为 5000 毫秒。'
    )
  })
for (const field of ['health', 'health.check'])
  Object.assign(base[field]!, {
    whenToUse: t(
      'Set health for a service that can become unresponsive without exiting. check resolves on success; rejection or timeout counts toward failureThreshold. Reaching that threshold invalidates readiness. Omit health for no periodic checks; coroutine heartbeat cannot coexist with it.',
      '服务可能不退出却失去响应时设置 health。check 成功时兑现，拒绝或超时累计到 failureThreshold。达到阈值后使就绪状态失效。省略时不执行周期检查，协程心跳不能与它同时配置。'
    )
  })
Object.assign(base.isolation!, {
  whenToUse: t(
    'Keep required, the default, when requested capabilities must be enforced or monitored; weaker declarations fail construction. Choose best-effort only when weaker guarantees are acceptable. This coroutine cannot isolate faults, so its additional fault-isolation requirement appears in degraded diagnostics.',
    '要求能力均由强制或监测保证时，保留默认 required；声明较弱会使构造失败。只有能接受较弱保证时才选择 best-effort。本协程无法隔离故障，额外要求的 fault-isolation 会出现在降级诊断中。'
  )
})
for (const [field, doc] of Object.entries(launchFields))
  Object.assign(doc, {
    example: fieldExamples['launch.' + field]
  })
for (const [field, doc] of Object.entries(processFields)) {
  if (field === 'launcher' || field === 'spec' || field === 'budget') continue
  Object.assign(doc, {
    example: fieldExamples['process.' + field]
  })
}
for (const field of ['output', 'output.onChunk'])
  Object.assign(processFields[field]!, {
    whenToUse: t(
      'Set output to keep smaller diagnostic tails, and onChunk to observe drained bytes as they arrive. The synchronous observer returns void; a throw is reported without stopping the drain. Omission keeps 65536 bytes per stream and installs no observer. The observer sees arriving bytes while the retained tail is bounded.',
      '需要更小的诊断尾部时设置 output，需要随到随看排空字节时设置 onChunk。同步观察者返回空值，抛错会上报而不停止排空。省略时每条流保留 65536 字节，不安装观察者。观察者收到到达的字节，留存尾部仍受大小限制。'
    )
  })
for (const [field, doc] of Object.entries(budgetOptions))
  Object.assign(doc, {
    example: fieldExamples['budget.' + field]
  })
Object.assign(budgetOptions.overflow!, {
  whenToUse: t(
    'Use reject for immediate overload feedback: full capacity returns full. queue waits in FIFO order until a slot or queueTimeoutMs; omission currently queues too. The parent-budget example queues for at most five seconds; the rate example rejects overload immediately.',
    '需要立即反馈过载时使用 reject，容量满返回 full。queue 按先进先出等待名额或 queueTimeoutMs，当前省略也会排队。父预算示例最多排队五秒，速率示例立即拒绝过载。'
  )
})
Object.assign(budgetOptions.launchRate!, {
  whenToUse: t(
    'Configure max and windowMs to limit rapid starts even after prior slots are released. false disables that sliding grant window but retains maxUnits. Omission allows eight grants in 1000 ms. The example permits four grants per second.',
    '前次名额已释放后仍需限制快速启动时，配置 max 与 windowMs。false 关闭滑动授予窗口，仍保留 maxUnits 并发限制。省略时 1000 毫秒允许八次授予。示例每秒允许四次授予。'
  )
})

/** Complete bilingual surface for the core and its three profile entry points. */
export const reference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Runtime-neutral budgets, launch profiles and supervisor commands; start with createUnitBudget and createSupervisor for custom execution units.',
        '运行时中立的预算、启动策略和监督命令；自定义执行单元从 `createUnitBudget` 与 `createSupervisor` 开始。'
      ),
      example: coroutineExample
    },
    coroutine: {
      summary: t(
        'Use this entry to supervise a Promise-based task or asynchronous iterator that shares your application’s event loop. Import `@migaia/supervision/coroutine` for this ready-made task profile rather than assembling the root supervisor’s profile and launcher yourself.\n\n`createCoroutineSupervisor()` takes a task and a coroutine budget, then provides startup, restart, and disposal through the shared supervisor. Stopping asks the task to cooperate through its signal; use a thread or process when work needs a separate execution environment.',
        '需要监督返回 `Promise` 的任务或异步迭代器，且任务与应用共用事件循环时，使用此入口。从 `@migaia/supervision/coroutine` 导入现成的任务适配，不必自行组装根入口监督器所需的任务规则与启动器。\n\n`createCoroutineSupervisor()` 接收任务和协程数量预算，复用通用监督器完成启动、重启与释放。停止时通过信号请求任务配合退出；工作需要独立执行环境时，应选择线程或进程入口。'
      ),
      example: coroutineExample
    },
    process: {
      summary: t(
        'Use this entry to supervise a native child process and observe its output and exit. Import `@migaia/supervision/process` for process-specific behavior rather than assembling a process profile around the generic root supervisor.\n\n`createProcessSupervisor()` combines your process specification, launcher, and process budget with the shared restart and disposal rules. You supply the runtime launcher that actually starts and terminates processes; this entry does not provide a platform process launcher.',
        '需要监督原生子进程并观察其输出与退出时，使用此入口。从 `@migaia/supervision/process` 导入进程专用行为，不必围绕根入口的通用监督器自行组装进程规则。\n\n`createProcessSupervisor()` 把进程说明、启动器和进程数量预算接入通用的重启与释放规则。实际启动和终止进程的运行环境启动器由你提供；此入口不提供平台进程启动器。'
      ),
      example: processExample
    },
    threads: {
      summary: t(
        'Use this entry to supervise a worker running in a separate execution environment. Import `@migaia/supervision/threads` for worker-specific rules rather than assembling a thread profile around the generic root supervisor.\n\n`createThreadSupervisor()` accepts your worker entry, launcher, and thread budget and reuses the shared startup, restart, and disposal rules. The launcher must declare the isolation and termination capabilities it actually supplies; this entry does not create a platform worker launcher for you.',
        '需要监督在独立执行环境中运行的工作线程时，使用此入口。从 `@migaia/supervision/threads` 导入线程专用规则，不必围绕根入口的通用监督器自行组装线程适配。\n\n`createThreadSupervisor()` 接收线程入口、启动器和线程数量预算，复用通用的启动、重启与释放规则。启动器必须声明实际提供的隔离与终止能力；此入口不会替你创建平台线程启动器。'
      ),
      example: threadExample
    }
  },
  symbols: {
    ...Object.fromEntries(
      Object.entries(domains).map(([name, doc]) => [
        name,
        {
          role: name.startsWith('SupervisionError') ? ('error' as const) : ('constant' as const),
          purpose: t(
            `${doc.summary.en} Values are stable public contract identifiers; use the matching table entries below.`,
            `${doc.summary.zh}各项取值属于稳定公开契约，具体选择及可观察结果见下表。`
          ),
          example: `import { ${name} } from '@migaia/supervision${['CoroutineOutcome', 'coroutineCapabilities'].includes(name) ? '/coroutine' : ['ThreadCapability', 'ThreadLimit', 'ThreadUnitKind'].includes(name) ? '/threads' : ['StdinMode', 'StdoutMode', 'StderrMode', 'DrainedStream', 'ProcessCapability', 'ProcessLimit', 'BootstrapVia', 'OrphanProbeResult', 'ParentLossExitCode'].includes(name) ? '/process' : ''}'\nconsole.log(${name})`
        }
      ])
    ),
    SUPERVISION_SOURCE: {
      role: 'error',
      purpose: t(
        'Stable package source `supervision` attached to coded supervisor failures; combine source and code when classifying reports.',
        '编码监督错误附带的稳定包来源 `supervision`；分类上报时同时检查来源和错误码。'
      ),
      example: 'if (error.source === SUPERVISION_SOURCE) console.log(error.code)'
    },
    createUnitBudget: {
      role: 'factory',
      cases: supervisionCases.createUnitBudget,
      purpose: t(
        'Creates a shared runtime-neutral capacity and launch-rate budget. Pair with createSupervisor or profile constructors; retain leases until actual unit exit.',
        '创建运行时中立的共享容量与启动速率预算。搭配 `createCoroutineSupervisor` 等监督工厂使用；租约保持到单元实际退出。'
      ),
      options: 'IUnitBudgetOptions',
      returns: t(
        'An `IUnitBudget`; invalid numeric limits or parent-kind mismatch throw coded `INVALID_OPTION` before admission starts.',
        '返回 `IUnitBudget`；数值限制非法或父种类不匹配时，在准入前抛出编码错误 `INVALID_OPTION`。'
      ),
      example: coroutineExample
    },
    createSupervisor: {
      role: 'factory',
      purpose: t(
        'Creates a command controller around an application profile, runtime launcher and shared budget. Construction validates policy but does not start execution.',
        '围绕应用单元策略、运行时启动器和共享预算创建命令控制器；构造会校验策略，但不会开始执行。'
      ),
      options: 'ISupervisorOptions',
      returns: t(
        'An `ISupervisor`; invalid configuration throws `INVALID_OPTION`, insufficient required capabilities throw `CAPABILITY_UNSUPPORTED`.',
        '返回 `ISupervisor`；配置非法抛 `INVALID_OPTION`，必需能力不足抛 `CAPABILITY_UNSUPPORTED`。'
      ),
      example: `const supervisor = createSupervisor({ id: 'custom', launcher, profile, spec, budget, report: console.error })\nawait supervisor.start()\nawait supervisor.dispose()`
    },
    createCoroutineSupervisor: {
      role: 'factory',
      cases: supervisionCases.createCoroutineSupervisor,
      purpose: t(
        'Supervises a cooperative task or async iterator without native process isolation. Task cancellation is cooperative; an unending task keeps its budget lease after bounded recovery.',
        '监督协作任务或异步迭代器，不提供原生进程隔离；取消依赖任务主动响应，任务不停则在有界回收后继续占用预算租约。'
      ),
      options: 'ICoroutineSupervisorOptions',
      returns: t(
        'An `ICoroutineSupervisor`; invalid task or simultaneous heartbeat and health policies throw `INVALID_OPTION`.',
        '返回 `ICoroutineSupervisor`；任务非法或同时配置心跳与健康策略时抛 `INVALID_OPTION`。'
      ),
      example: coroutineExample
    },
    createProcessSupervisor: {
      role: 'factory',
      cases: supervisionCases.createProcessSupervisor,
      purpose: t(
        'Supervises shell-free native processes through an injected launcher, with optional resource monitoring, bounded output tails and durable ownership records.',
        '通过注入启动器监督不经命令解释器的原生进程，可监测资源、保留有界输出尾部并持久保存所有权记录。'
      ),
      options: 'IProcessSupervisorOptions',
      returns: t(
        'An `IProcessSupervisor`; invalid closed specification throws `INVALID_OPTION`, unsupported capabilities fail before launch.',
        '返回 `IProcessSupervisor`；封闭规格非法抛 `INVALID_OPTION`，能力不支持时在启动前失败。'
      ),
      example: processExample
    },
    createThreadSupervisor: {
      role: 'factory',
      purpose: t(
        'Supervises native workers through an injected launcher. Admission checks termination and requested heap limits; an adapter without enforced exit observation requires an explicit health policy.',
        '通过注入启动器监督原生工作线程；准入检查终止能力及请求的堆限制，适配器不能强制观察退出时必须显式提供健康策略。'
      ),
      options: 'IThreadSupervisorOptions',
      returns: t(
        'An `IThreadSupervisor`; invalid specification or unsupported isolation fails before native launch.',
        '返回 `IThreadSupervisor`；规格非法或隔离能力不足时在原生启动前失败。'
      ),
      example: threadExample
    },
    createPrewarmPool: {
      role: 'factory',
      cases: supervisionCases.createPrewarmPool,
      purpose: t(
        'Maintains a bounded non-restarting pool of idle native processes. Pair with createProcessSupervisor to transfer ready handles and occupied leases without cold startup.',
        '维护有界且不自动重启的空闲原生进程池。搭配 `createProcessSupervisor` 转交就绪句柄和已占用租约，减少冷启动。'
      ),
      options: 'IPrewarmPoolOptions',
      returns: t(
        'An `IPrewarmPool`; every idle process consumes the same shared process budget, and disposal retires remaining owned entries.',
        '返回 `IPrewarmPool`；每个空闲进程占用同一共享预算，释放会退役池仍持有的条目。'
      ),
      example: `const pool = createPrewarmPool({ id: 'warm', launcher, spec, budget, size: 1, report: console.error })\nconst supervisor = createProcessSupervisor({ id: 'active', launcher, spec, budget, prewarm: pool, report: console.error })\nawait supervisor.start()\nawait supervisor.dispose()\nawait pool.dispose()`
    },
    createParentLossGuard: {
      role: 'factory',
      cases: supervisionCases.createParentLossGuard,
      purpose: t(
        'Creates an idempotent parent-loss trigger that runs one cancellable shutdown and requests exit code zero on success or one on failure or deadline.',
        '创建幂等父进程丢失触发器，执行一次可取消关闭；成功请求退出码零，失败或截止请求退出码一。'
      ),
      optionCases: supervisionOptionCases.guard,
      optionDocs: {
        shutdown: {
          example: optionExamples.guard,
          whenToUse: t(
            'Provide the cleanup to run once on parent loss. Resolve within graceMs for exit zero; throw or reject for exit one and reporting. This callback is required.',
            '提供父进程丢失后只执行一次的清理。graceMs 内兑现则退出码为零，抛错或拒绝则上报并请求一。此回调必填。'
          ),
          ...p(
            'Application shutdown callback receives the guard cancellation signal and returns a PromiseLike resolving after cleanup. A throw or rejection is reported, then requests forced exit.',
            '应用关闭回调接收守卫取消信号，返回清理结束后兑现的承诺；抛错或拒绝会上报并请求强制退出。'
          )
        },
        exit: {
          example: optionExamples.guard,
          whenToUse: t(
            'Provide the child runtime exit operation. Zero means cleanup completed; one means failure or deadline. Here a recorder shows the request. The callback is required and its own throws propagate.',
            '提供子进程运行时的退出操作。零代表清理完成，一代表失败或截止。此处用记录器展示请求。回调必填，自身抛错会传播。'
          ),
          ...p(
            'Application synchronous exit callback receives ParentLossExitCode zero on shutdown completion or one on failure/deadline; its own throws propagate.',
            '应用同步退出回调接收 `ParentLossExitCode`：关闭完成为零，失败或截止为一；自身抛错直接传播。'
          )
        },
        report: { ...report, example: optionExamples.guardFailure },
        graceMs: p(
          'Finite positive shutdown deadline in scheduler milliseconds; expiry aborts shutdown before requesting forced exit.',
          '关闭截止时间的调度器毫秒数，须为有限正数；到期先中止关闭再请求强制退出。',
          t('`5000` milliseconds for one shutdown attempt.', '默认一次关闭最多等待 `5000` 毫秒。')
        ),
        scheduler
      },
      params: {
        options: t(
          'Application object with shutdown(signal), exit(code), report(error), optional positive graceMs (5000), and scheduler (systemScheduler). Shutdown may be async; throws are reported then forced exit is requested.',
          '应用对象提供 `shutdown(signal)`、`exit(code)`、`report(error)`；可选正数 `graceMs` 默认 `5000`，`scheduler` 默认 `systemScheduler`。关闭可异步，抛错会上报并请求强制退出。'
        )
      },
      returns: t(
        'A trigger controller with trigger(reason?) and triggered. Repeated triggers do nothing; deadline aborts shutdown with the first reason.',
        '返回含 `trigger(reason?)` 和 `triggered` 的控制器；重复触发无效，截止会以首次原因中止关闭。'
      ),
      example:
        'const guard = createParentLossGuard({ shutdown: async (signal) => application.shutdown(signal), exit: (code) => process.exit(code), report: console.error })\nguard.trigger(new Error("parent disconnected"))'
    },
    reclaimOrphanProcesses: {
      role: 'operation',
      cases: supervisionCases.reclaimOrphanProcesses,
      purpose: t(
        'Scans one durable namespace and probes fingerprints before reclaiming prior processes. Only original live identities are terminated; reused PIDs only lose stale records.',
        '扫描持久命名空间并先检查指纹再恢复旧进程；只终止原始存活身份，已复用编号仅移除旧记录。'
      ),
      optionCases: supervisionOptionCases.reclaim,
      optionDocs: {
        registry: p(
          'Application-owned durable IProcessRegistry supplies namespace records and removes only successfully reclaimed entries.',
          '应用拥有的持久 `IProcessRegistry` 提供命名空间记录，只移除成功恢复的条目。'
        ),
        namespace: processFields['registry.namespace'],
        launcher: p(
          'Application runtime launcher must implement probe(record) and terminateRecord(record); fingerprint checks precede every actual termination.',
          '应用运行启动器必须实现 `probe(record)` 和 `terminateRecord(record)`；每次实际终止前先检查指纹。'
        ),
        report: {
          ...report,
          example: optionExamples.reclaimFailure,
          whenToUse: t(
            'Record recovery failures without throwing. A failed listing reports ORPHAN_RECLAIM_FAILED and leaves every record untouched. Reporting is required; it does not retry recovery.',
            '记录恢复失败且不抛错。列举失败会上报 ORPHAN_RECLAIM_FAILED，保留所有记录。上报为必填项，不会代替重试恢复。'
          )
        }
      },
      params: {
        options: t(
          'Application registry, namespace, launcher with probe and terminateRecord, and synchronous nonthrowing report(error). Recovery awaits each adapter operation and retains failed records.',
          '应用提供注册表、命名空间、含 `probe` 与 `terminateRecord` 的启动器，以及同步不抛错的 `report(error)`；逐项等待适配器操作，失败记录保留。'
        )
      },
      returns: t(
        'An IOrphanReclaimResult with terminated/removed IDs and collected failures. Listing rejection returns empty ID lists and a reported ORPHAN_RECLAIM_FAILED carrying detail.step=list and cause; no record is touched. Per-record failures use the same collection.',
        '返回含已终止、已删除标识及失败集合的恢复结果。列举拒绝时标识列表为空，报告保留原始原因且步骤为 `list` 的恢复错误，不触碰记录；逐记录失败进入相同集合。'
      ),
      example:
        "const result = await reclaimOrphanProcesses({ registry, namespace: 'app', launcher, report: console.error }); console.log(result.removed)"
    }
  },
  types: {
    ISupervisor: supervisorType,
    ICoroutineSupervisor: supervisorType,
    IProcessSupervisor: { ...supervisorType, example: processExample },
    IThreadSupervisor: { ...supervisorType, example: threadExample },
    IUnitBudget: budgetType,
    IProcessBudget: budgetType,
    IThreadBudget: budgetType,
    IUnitBudgetOptions: {
      optionCases: supervisionOptionCases.budget,
      summary: t(
        'Application configuration for one concurrency budget and optional same-kind parent.',
        '应用为单个并发预算及可选同种父预算提供的配置。'
      ),
      members: budgetOptions
    },
    ISupervisorBaseOptions: {
      optionCases: supervisionOptionCases.common,
      summary: t(
        'Shared readiness, restart, drain and health policy used by every execution profile.',
        '所有执行单元策略共用的就绪、重启、排空及健康配置。'
      ),
      members: base
    },
    ISupervisorOptions: {
      optionCases: supervisionOptionCases.core,
      summary: t(
        'Custom unit construction policy joining runtime adapter, profile and application ownership.',
        '连接运行时适配器、单元策略及应用所有权的自定义单元构造配置。'
      ),
      members: {
        ...base,
        ...launchFields,
        profile: {
          example: optionExamples.custom,
          ...p(
            'Application-supplied `IUnitProfile` owns validation, required capabilities, termination and exit classification.',
            '应用提供的 `IUnitProfile` 负责校验、必需能力、终止及退出分类。'
          )
        },
        hooks: {
          example: optionExamples.customHooks,
          ...p(
            'Optional `ISupervisionHooks` supplied by the outer adapter for adoption, attachment and diagnostics.',
            '外层适配器提供的可选 `ISupervisionHooks`，用于接管、附加和诊断。',
            t('Absent: no adapter extension hooks run.', '默认不设置，不运行适配扩展钩子。')
          )
        }
      }
    },
    IUnitIdentity: {
      summary: t(
        'Exact launched unit identity, issued and owned by its runtime launcher.',
        '由运行时启动器签发并持有的精确单元身份。'
      ),
      members: { fingerprint: identity }
    },
    IUnitHandle: {
      summary: t(
        'Launcher-owned live execution handle whose exited promise confirms actual completion.',
        '启动器持有的活动执行句柄，退出承诺确认实际完成。'
      ),
      members: {
        identity: p(
          'Stable identity returned by the launcher for this exact execution.',
          '启动器为本次精确执行返回的稳定身份对象。'
        ),
        exited
      }
    },
    ILaunchContext: {
      summary: t(
        'Attempt-scoped launch inputs created by the supervisor and passed to its adapter.',
        '监督器创建并传给适配器的单次启动尝试上下文。'
      ),
      members: {
        signal: p(
          'Native cancellation signal for this attempt; adapters must stop outstanding launch work when aborted.',
          '本轮尝试的原生取消信号；中止时适配器须停止未完成的启动工作。'
        ),
        executionGeneration: p(
          'Reserved cold ordinal supplied by the original supervisor; readiness promotion alone advances it.',
          '原监督器提供的预留冷启动序号；只有提升为就绪才会推进。',
          t(
            'May be absent for launchers outside the supervisor.',
            '监督器之外调用启动器时可以缺省。'
          )
        )
      }
    },
    IUnitLauncher: {
      summary: t(
        'Application adapter boundary for real unit creation and declared capability guarantees.',
        '应用实现的实际单元创建及能力保证声明的适配边界。'
      ),
      members: {
        capabilities: p(
          'Capability names mapped to `CapabilityLevel`; declarations must reflect actual runtime guarantees.',
          '能力名称到 `CapabilityLevel` 的映射；声明必须符合实际运行时保证。'
        ),
        launch: m(
          'Creates a unit asynchronously and returns its owned handle; throws or rejection become a launch failure cause.',
          '异步创建单元并返回所属句柄；抛错或拒绝会成为启动失败的原因。',
          {
            spec: t(
              'Application specification validated by the profile before launch.',
              '启动前由单元策略校验的应用规格。'
            ),
            context: t(
              'Supervisor-created attempt signal and optional execution ordinal.',
              '监督器创建的本轮信号及可选执行序号。'
            )
          },
          t(
            'A handle whose exited Promise settles only after actual exit.',
            '返回退出承诺只在实际退出后结算的句柄。'
          ),
          'const handle = await launcher.launch(spec, context)'
        )
      }
    },
    IUnitProfile: {
      summary: t(
        'Runtime-neutral unit-kind policy; the profile owns validation and exit meaning, not native launch.',
        '运行时中立的单元种类策略，负责校验和退出含义，不负责原生启动。'
      ),
      members: {
        kind: p(
          'Stable application profile kind; it must equal the shared budget kind.',
          '应用策略的稳定种类，必须与共享预算的种类相同。'
        ),
        gracefulTermination: p(
          'Whether retirement requests a graceful phase before hard termination.',
          '退役时是否在强制终止之前先请求优雅退出阶段。'
        ),
        requirements: m(
          'Returns the capability keys required by a particular application specification.',
          '返回特定应用运行规格要求具备的能力名称列表。',
          {
            spec: t(
              'Validated application specification to inspect.',
              '需要检查能力要求的应用运行规格。'
            )
          },
          t('Capability names merged with additional requires.', '返回与额外要求合并的能力名称。'),
          'const required = profile.requirements(spec)'
        ),
        validateSpec: m(
          'Rejects unsupported or malformed application specifications before unit admission.',
          '在单元准入前拒绝不支持或格式不正确的应用运行规格。',
          {
            spec: t(
              'Initial or replacement specification from the caller.',
              '调用方提供的初始或替换运行规格。'
            )
          },
          t(
            'Returns void on acceptance; throws on invalid specification.',
            '接受时返回空值，规格非法时抛错。'
          ),
          'profile.validateSpec(spec)'
        ),
        launchContext: m(
          'Optionally adds profile-specific context to the base supervisor launch context.',
          '可选地为监督器基础启动上下文增加单元策略专用信息。',
          {
            base: t('Supervisor-created attempt context.', '监督器创建的本轮启动尝试上下文。'),
            unit: t(
              'Supervisor-created runtime scopes for this unit.',
              '监督器为该单元创建的运行作用域。'
            )
          },
          t(
            'A context passed directly to the launcher; absent hook uses base.',
            '返回直接传给启动器的上下文；未提供钩子则使用基础上下文。'
          ),
          'const context = profile.launchContext?.(base, unit) ?? base'
        ),
        terminate: m(
          'Requests the selected termination strength; actual exit is observed independently.',
          '请求所选强度的终止；实际退出通过独立承诺观察。',
          {
            handle: t(
              'Handle returned from this profile launcher.',
              '来自本单元策略启动器返回的句柄。'
            ),
            mode: t(
              'Supervisor-selected graceful or force termination mode.',
              '监督器选择的优雅或强制终止模式。'
            )
          },
          t(
            'Returns after requesting termination, not after actual exit.',
            '发出终止请求后返回，不代表已经实际退出。'
          ),
          "profile.terminate(handle, 'force')"
        ),
        classifyExit: m(
          'Maps runtime-specific exit facts to normal, crashed or resource-violation classification.',
          '把运行时专用退出事实映射为正常、崩溃或资源违规分类。',
          {
            status: t(
              'Exit value fulfilled by the launched handle.',
              '启动句柄退出承诺兑现的退出值。'
            )
          },
          t(
            'An `IExitClassification` preserving the original failure cause.',
            '返回保留原始失败原因的 `IExitClassification`。'
          ),
          'const classification = profile.classifyExit(await handle.exited)'
        ),
        exitStatus: m(
          'Optionally preserves actual native status for normal and manually retired execution units.',
          '可选地保留正常退出及手动退役执行单元的实际原生状态。',
          { status: t('Actual fulfilled native exit value.', '实际退出承诺兑现的原生退出值。') },
          t(
            'An `IUnitExitStatus` for diagnostics; absence omits native status.',
            '返回诊断所用的 `IUnitExitStatus`；未提供则省略原生状态。'
          ),
          'const status = profile.exitStatus?.(await handle.exited)'
        )
      }
    },
    IUnitRuntime: {
      summary: t(
        'Supervisor-owned lifecycle scopes available to adapter hooks for one generation.',
        '监督器持有并提供给适配钩子的单世代生命周期作用域。'
      ),
      members: {
        generation: p(
          'Supervisor-assigned generation for the current attempt resources.',
          '监督器为当前尝试资源分配的世代编号。'
        ),
        scope: p(
          'External `ILifecycleScope` for attachments released after unit retirement.',
          '外部 `ILifecycleScope`，用于单元退役后释放附加资源。'
        ),
        monitors: p(
          'External `ILifecycleScope` whose health and usage monitors release before the unit.',
          '外部 `ILifecycleScope`，其中健康和用量监测在单元之前释放。'
        ),
        signal: p(
          'Native lifetime cancellation signal of this runtime, separate from launch-attempt cancellation.',
          '该运行实例的原生生命周期信号，与启动尝试取消信号分开。'
        )
      }
    },
    IUnitLease: {
      summary: t(
        'Proof that a process, thread or coroutine occupies one slot of a budget. The budget hands it to whoever owns that unit, and the owner keeps it until the unit has actually exited.',
        '表示一个进程、线程或协程占用了预算中的一个名额。预算把它交给负责这个单元的一方，由对方一直持有，直到单元真正退出。'
      ),
      scenarios: [
        t(
          'Call release after the process, thread or coroutine has really stopped, so the budget can admit the next one.',
          '进程、线程或协程真正停止后调用 release，把名额还给预算，让下一个单元可以进入。'
        )
      ],
      example:
        "const outcome = await budget.acquire(); if (outcome.kind === 'granted') outcome.lease.release()",
      members: {
        release: m(
          'Returns this occupied slot and any parent slot exactly once; repeated calls do nothing.',
          '恰好一次归还本地及父预算占用名额；重复调用没有效果。',
          {},
          t(
            'The budget can admit a waiting unit if otherwise eligible.',
            '条件满足时预算可以准入等待中的单元。'
          ),
          'lease.release(); lease.release()'
        )
      }
    },
    IBudgetOutcome: {
      summary: t(
        'Discriminated admission result: granted carries a lease; rejection creates no unit.',
        '准入判别结果：获准时携带租约，拒绝时不创建任何单元。'
      ),
      members: {
        kind: {
          ...p(
            'Discriminates successful lease ownership from admission refusal.',
            '区分成功取得租约所有权和准入拒绝两种结果。'
          ),
          values: {
            granted: t(
              'A lease is owned and must later be released.',
              '已经取得租约所有权，之后必须释放。'
            ),
            rejected: t(
              'No lease was created; inspect the refusal reason.',
              '没有创建租约，需要检查拒绝原因。'
            )
          }
        },
        lease: p(
          'IUnitLease present only for a granted outcome; release after actual work ends.',
          '仅获准结果含有的 `IUnitLease`，实际工作结束后释放。'
        ),
        reason: {
          ...p(
            'BudgetRejection present only when admission was refused.',
            '仅准入被拒绝时存在的预算拒绝原因。'
          ),
          values: { enum: 'BudgetRejection' }
        }
      }
    },
    IReadyOutcome: {
      summary: t(
        'Readiness result carries a handle only after successful promotion of its generation.',
        '就绪结果只在成功提升运行世代之后才携带句柄。'
      ),
      members: {
        state: {
          ...p(
            'Discriminates ready, stopped, terminal, disposed or not-yet-started idle outcomes.',
            '区分就绪、停止、终止、释放及尚未启动的空闲结果。'
          ),
          values: {
            ready: domains.SupervisorState.values.ready,
            stopped: domains.SupervisorState.values.stopped,
            terminal: domains.SupervisorState.values.terminal,
            disposed: domains.SupervisorState.values.disposed,
            idle: domains.SupervisorState.values.idle
          }
        },
        generation: supervisorMembers.generation,
        unit: p(
          'Launcher-created ready handle, present only in the ready result.',
          '启动器创建的就绪句柄，只存在于就绪结果。'
        ),
        rejection: {
          ...p(
            'Optional BudgetRejection explaining why a stopped outcome could not acquire admission.',
            '可选预算拒绝原因，用来说明停止结果为何未能取得准入。'
          ),
          values: { enum: 'BudgetRejection' }
        }
      }
    },
    IReplaceOutcome: {
      summary: t(
        'Replacement outcome distinguishes successful switch, refusal and preserved failure.',
        '替换结果区分成功切换、准入拒绝以及保留的失败。'
      ),
      members: {
        kind: {
          ...p(
            'Selects successful replacement, admission refusal or failed attempt.',
            '选择替换成功、准入拒绝或尝试失败三种结果。'
          ),
          values: {
            replaced: t(
              'The candidate became the new active generation.',
              '候选已经成为新的活动运行世代。'
            ),
            rejected: t(
              'Admission or lifecycle state refused replacement.',
              '准入或生命周期状态拒绝本次替换。'
            ),
            failed: t(
              'Replacement failed and preserves its error.',
              '替换失败并保留其原始错误对象。'
            )
          }
        },
        generation: supervisorMembers.generation,
        reason: {
          ...p(
            'Refusal from the budget or the terminal/stopped supervisor lifecycle.',
            '来自预算或监督器终止、停止状态的拒绝原因。'
          ),
          values: {
            ...Object.fromEntries(
              Object.entries(domains.BudgetRejection.values).map(([key, value]) => [
                key === 'rateLimited'
                  ? 'rate-limited'
                  : key === 'queueTimeout'
                    ? 'queue-timeout'
                    : key,
                value
              ])
            ),
            terminal: domains.SupervisorState.values.terminal,
            stopped: domains.SupervisorState.values.stopped
          }
        },
        error: p(
          'Original replacement failure retained in the failed result.',
          '替换失败结果中保留的原始失败对象。'
        )
      }
    },
    ISupervisorEvent: {
      summary: t(
        'Synchronous discriminated observations of lifecycle, exits, terminal state and switching.',
        '同步的判别观察事件，涵盖生命周期、退出、终止状态和切换。'
      ),
      members: {
        type: {
          ...p(
            'SupervisorEventType selecting the event-specific payload fields.',
            '选择本事件专用载荷字段的监督器事件类型。'
          ),
          values: { enum: 'SupervisorEventType' }
        },
        from: {
          ...p(
            'Previous lifecycle state for state events, or previous generation for switched events.',
            '状态事件的先前生命周期状态，或切换事件的先前世代。'
          ),
          values: { enum: 'SupervisorState' }
        },
        to: {
          ...p(
            'Next lifecycle state for state events, or newly active generation for switched events.',
            '状态事件的后续生命周期状态，或切换事件的新活动世代。'
          ),
          values: { enum: 'SupervisorState' }
        },
        generation: supervisorMembers.generation,
        reason: {
          ...p(
            'Profile or command exit classification carried only by exit events.',
            '退出事件携带的单元策略或命令退出分类。'
          ),
          values: { enum: 'ExitReason' }
        },
        error: p(
          'Original contained failure carried by failed exit or terminal events.',
          '失败退出或终止事件携带的原始受控失败对象。'
        ),
        status: p(
          'Optional actual native IUnitExitStatus supplied by the profile.',
          '单元策略提供的可选实际原生 `IUnitExitStatus`。'
        ),
        observedAt: p(
          'Scheduler observation timestamp, measured in monotonic milliseconds.',
          '使用单调毫秒计量的调度器观察时间戳。'
        ),
        entry: p(
          'Lifetime terminal-entry ordinal carried by a terminal event.',
          '终止事件携带的生命周期累计终止进入序号。'
        ),
        unit: p(
          'Launcher-created newly active handle carried by a switched event.',
          '切换事件携带的启动器新活动句柄。'
        ),
        count: p(
          'Lifetime successful restart count carried by a restart event.',
          '重启事件携带的生命周期累计成功重启次数。'
        ),
        degraded: p(
          'Admitted degraded capability names carried when their set changes.',
          '已准入降级能力集合变化时携带的能力名称列表。'
        )
      }
    },
    ISupervisionErrorCode: a(
      'Union of stable values in SupervisionErrorCode used with the package source to classify contained failures.',
      '`SupervisionErrorCode` 稳定取值联合，与包来源共同用于分类受控失败。'
    ),
    IExitClassification: {
      summary: t(
        'Profile-created meaning of actual unit exit with original diagnostic cause.',
        '单元策略创建的实际退出含义以及原始诊断原因。'
      ),
      members: {
        reason: {
          ...p(
            'One of exited, crashed or resource-violation, selected by the profile from actual status.',
            '单元策略根据实际状态选择正常退出、崩溃或资源违规。'
          ),
          values: {
            exited: domains.ExitReason.values.exited,
            crashed: domains.ExitReason.values.crashed,
            'resource-violation': domains.ExitReason.values.resourceViolation
          }
        },
        detail: p(
          'Optional profile-specific read-only facts that explain the classified exit.',
          '可选的单元策略专用只读事实，用于解释该退出分类。'
        ),
        cause: p(
          'Original failure retained by identity when a failed exit has a cause.',
          '失败退出存在原因时按身份保留的原始失败对象。'
        )
      }
    },
    IUnitExitStatus: {
      summary: t(
        'Native exit facts projected by the unit profile without synthesizing a new status.',
        '单元策略投影的原生退出事实，不合成新的退出状态。'
      ),
      members: {
        code: p(
          'Actual numeric native exit code, or null when the runtime has no code.',
          '实际原生数字退出码；运行时没有退出码时为 `null`。'
        ),
        signal: p(
          'Actual native termination signal, when the runtime exposes one.',
          '运行时能够提供时记录的实际原生终止信号。'
        )
      }
    },
    ISupervisorStopOptions: {
      summary: t(
        'Per-command override of application drain time without altering exit or reap budgets.',
        '单次命令覆盖应用排空时长，不改变退出或回收预算。'
      ),
      members: {
        graceMs: p(
          'Finite nonnegative scheduler milliseconds replacing the drain phase for this stop.',
          '本次停止用于替代排空阶段的调度器毫秒数，须有限且非负。',
          t('Absent: use stop.drainTimeoutMs.', '默认使用 `stop.drainTimeoutMs` 的配置。')
        )
      }
    },
    IHealthSnapshot: {
      summary: t(
        'Monitor observation separate from the ready state of the execution unit.',
        '独立于执行单元就绪状态的监测观察记录。'
      ),
      members: {
        state: {
          ...p(
            'Pending, checking, healthy or unhealthy observation of the serialized health monitor.',
            '串行健康监测器当前的等待、检查、健康或不健康观察。'
          ),
          values: {
            pending: t('No completed health observation exists yet.', '尚未存在已完成的健康观察。'),
            checking: t('One health check is currently in flight.', '当前正在进行一次健康检查。'),
            healthy: t('The latest completed health check passed.', '最近完成的健康检查已经通过。'),
            unhealthy: t(
              'The latest health observation recorded failure.',
              '最近健康观察记录了检查失败。'
            )
          }
        },
        failures: p(
          'Number of consecutive failures recorded by this monitor.',
          '该监测器已经记录的连续检查失败次数。'
        ),
        observedAt: p(
          'Optional scheduler timestamp of the latest health state transition, including entry into checking; it is not limited to completed checks.',
          '最近健康状态变化的可选调度器时间戳，进入检查中即记录，并非只在检查完成时记录。'
        )
      }
    },
    ISupervisorSnapshot: {
      summary: t(
        'Read-only state and diagnostics captured without causing fresh resource samples.',
        '不触发新的资源采样而读取的状态与诊断快照。'
      ),
      members: {
        kind: p('Profile kind selected during construction.', '构造阶段所选择的执行单元策略种类。'),
        state: supervisorMembers.state,
        generation: supervisorMembers.generation,
        identity: p(
          'Current handle identity, absent when there is no admitted current unit.',
          '当前句柄身份；没有已准入当前单元时省略。'
        ),
        failuresInWindow: p(
          'Recent failure count still inside the restart sliding window.',
          '仍在重启滑动时间窗口之内的近期失败次数。'
        ),
        restartCount: p(
          'Lifetime successful manual or automatic restart count, excluding initial start and replacements.',
          '生命周期内成功手动或自动重启的次数，不含初始启动及替换。'
        ),
        health: p(
          'Current IHealthSnapshot; absent without an active health monitor.',
          '当前 `IHealthSnapshot`；没有活动健康监测器时省略。'
        ),
        lastExit: p(
          'Last exit generation, reason and optional original error, native status and scheduler observedAt.',
          '最近退出的世代、原因及可选原始错误、原生状态和调度器观察时间。'
        ),
        terminalError: p(
          'Original failure that most recently entered terminal state, if available.',
          '最近一次进入终止状态的原始失败，存在时保留。'
        ),
        terminalEntries: p(
          'Lifetime count of transitions into the terminal policy state.',
          '生命周期中进入终止策略状态的累计次数。'
        ),
        degraded: p(
          'Capability names admitted below the required guarantee in best-effort mode.',
          '尽力模式下准入但未达到严格保证等级的能力名称。'
        ),
        abandoned: p(
          'Count of bounded recoveries that ended before actual unit exit.',
          '在实际单元退出前就结束的有界回收累计数量。'
        ),
        unit: p(
          'Optional profile-hook inspection facts; core does not sample native usage here.',
          '可选单元策略钩子检查事实；核心此处不读取原生用量。'
        )
      }
    },
    ISupervisionHooks: {
      summary: t(
        'Optional outer-adapter hooks for adopting leases, attaching resources and inspecting ready units.',
        '外层适配器用于接管租约、附加资源和检查就绪单元的可选钩子。'
      ),
      members: {
        acquireUnit: m(
          'Synchronously offers a pre-existing handle and occupied lease instead of cold launch.',
          '同步提供已有句柄与占用租约，用于替代一次冷启动。',
          {
            request: t(
              'Supervisor request with launch cause and validated specification.',
              '监督器请求，包含启动原因及已校验运行规格。'
            )
          },
          t(
            'Owned handle and lease, or undefined to use normal cold launch; throws fail startup.',
            '返回所属句柄及租约，或 `undefined` 执行正常冷启动；抛错会使启动失败。'
          ),
          'const adopted = hooks.acquireUnit?.({ cause: "start", spec })'
        ),
        afterLaunch: m(
          'Asynchronously attaches resources before readiness; own attachments in the provided runtime scope.',
          '在就绪前异步附加资源；通过传入运行作用域登记附加资源所有权。',
          {
            handle: t(
              'Handle from the launcher or adopted prewarm entry.',
              '来自启动器或已接管预热条目的句柄。'
            ),
            unit: t(
              'Supervisor-created scopes and runtime signal.',
              '监督器创建的作用域及运行信号。'
            )
          },
          t(
            'Resolve once attachment succeeds; throw or rejection fails the attach phase.',
            '附加成功后兑现；抛错或拒绝使附加阶段失败。'
          ),
          'await hooks.afterLaunch?.(handle, unit)'
        ),
        onReady: m(
          'Installs ready-generation monitoring; a synchronous failure invalidates readiness.',
          '安装就绪世代监测；同步失败会使就绪流程失败。',
          {
            handle: t(
              'Handle whose launch and readiness completed.',
              '已经完成启动与就绪握手的句柄。'
            ),
            unit: t('Runtime scopes that own installed monitors.', '拥有安装监测器的运行作用域。'),
            fail: t(
              'Supervisor callback receiving resource-violation or unhealthy, detail facts and optional original cause; call synchronously when monitor detects failure.',
              '监督器回调接收 `resource-violation` 或 `unhealthy`、详细事实及可选原始原因；监测发现失败时调用。'
            )
          },
          t(
            'Returns void after monitor registration; monitor resources belong to unit.monitors.',
            '监测登记后返回空值；监测资源归 `unit.monitors` 所有。'
          ),
          'hooks.onReady?.(handle, unit, (reason, detail, cause) => console.error(reason, detail, cause))'
        ),
        inspectUnit: m(
          'Synchronously reads adapter-owned diagnostic facts without changing core lifecycle.',
          '同步读取适配器所属诊断事实，不改变核心生命周期。',
          {
            handle: t(
              'Currently admitted handle supplied by the supervisor.',
              '监督器提供的当前已准入句柄。'
            )
          },
          t(
            'Read-only diagnostic record used by inspect; a synchronous throw propagates to the inspect caller.',
            '返回检查使用的只读诊断记录；同步抛错会传播给检查调用方。'
          ),
          'const facts = hooks.inspectUnit?.(handle)'
        )
      }
    },
    ICoroutineSupervisorOptions: {
      optionCases: supervisionOptionCases.coroutine,
      summary: t(
        'Cooperative task policy with optional heartbeat monitoring; heartbeat and health cannot coexist.',
        '协作任务配置及可选心跳监测；心跳与健康检查不能同时配置。'
      ),
      members: {
        ...base,
        spec: launchFields.spec,
        budget: launchFields.budget,
        heartbeat: {
          example: optionExamples.heartbeat,
          ...p(
            'Optional heartbeat-age watchdog observing task progress rather than native health.',
            '可选心跳年龄看门狗，观察任务推进而非原生健康状态。',
            t('Absent: no heartbeat watchdog is installed.', '默认不设置，不安装心跳看门狗。')
          )
        },
        'heartbeat.timeoutMs': p(
          'Finite positive maximum scheduler age since the last explicit or iterator heartbeat.',
          '距上次显式或迭代心跳的最大调度器时长，须为有限正毫秒数。'
        ),
        'heartbeat.intervalMs': p(
          'Positive scheduler interval between heartbeat-age observations.',
          '两次心跳年龄观察之间的正数调度器毫秒间隔。',
          t(
            'The configured heartbeat.timeoutMs duration.',
            '默认等于配置的 `heartbeat.timeoutMs`。'
          )
        ),
        'heartbeat.failureThreshold': p(
          'Consecutive stale heartbeat observations required before invalidating the coroutine.',
          '使协程失效之前必须连续观察到过期心跳的次数。',
          t('`1`; the first stale observation fails.', '默认 `1`，首次过期观察即失败。')
        )
      }
    },
    ICoroutineSpec: {
      summary: t(
        'Application task specification executed cooperatively in the supervising realm.',
        '在监督器执行域中协作运行的应用任务规格。'
      ),
      members: {
        name: p(
          'Optional application-chosen label for identifying the task specification.',
          '应用指定的可选标签，用来识别此任务规格。',
          t('Absent: no additional task label is supplied.', '默认不设置，不提供额外任务标签。')
        ),
        task: p(
          'Application callback receives `ICoroutineRunContext`; returns void, PromiseLike or AsyncIterable. Throws and rejections become rejected exit data; iterable steps refresh heartbeat.',
          '应用回调接收 `ICoroutineRunContext`，返回空值、承诺对象或异步可迭代对象；抛错和拒绝变为失败退出数据，迭代步骤刷新心跳。'
        )
      }
    },
    ICoroutineTask: a(
      'Callback receives supervisor-created ICoroutineRunContext. Return void, PromiseLike or AsyncIterable; settlement becomes ICoroutineExitStatus, rejection preserves the original error. Cancellation is cooperative. A custom AsyncIterable may have outstanding next and return concurrently; a rejected return is reported immediately but exited and the lease remain pending until next settles.',
      '回调接收监督器创建的 `ICoroutineRunContext`，返回空值、承诺对象或异步可迭代对象，结算成为退出状态且拒绝保留原错。取消依赖协作；自定义迭代器可同时存在待定读取与返回，返回拒绝立即报告，但退出及租约须等待原读取结束。'
    ),
    ICoroutineRunContext: {
      summary: t(
        'Task-owned cooperative cancellation, one-time port exposure and progress heartbeat.',
        '任务持有的协作取消、一次端口暴露及进度心跳上下文。'
      ),
      scenarios: [
        t(
          'Expose a service port while the cooperative task waits for cancellation.',
          '协作任务等待取消期间暴露服务端口。'
        )
      ],
      example: coroutineExample,
      members: {
        signal: p(
          'Native task lifetime signal; terminate requests abort, so the task must settle or stop iteration.',
          '任务生命周期原生信号；终止会请求中止，任务须结算或停止迭代。'
        ),
        expose: m(
          'Publishes the application port exactly once; calling twice throws `INVALID_OPTION`.',
          '恰好一次发布应用端口；重复调用抛出 `INVALID_OPTION`。',
          {
            port: t(
              'Application-created service value resolved by handle.exposed.',
              '应用创建的服务值，由 `handle.exposed` 兑现。'
            )
          },
          t(
            'The exposed Promise resolves to this port; no return value.',
            '端口承诺以该值兑现；没有返回值。'
          ),
          'context.expose({ ping: () => "pong" })'
        ),
        heartbeat: m(
          'Records scheduler progress for the heartbeat watchdog without producing application output.',
          '为心跳看门狗记录调度器进度，不生成应用输出。',
          {},
          t('Updates handle.lastHeartbeatAt synchronously.', '同步更新句柄的最近心跳时间。'),
          'context.heartbeat()'
        )
      }
    },
    ICoroutineHandle: {
      summary: t(
        'Cooperative execution handle with actual settlement, optional published port and heartbeat time.',
        '协作执行句柄，包含实际结算、可选发布端口和心跳时间。'
      ),
      members: {
        identity: p(
          'Coroutine launcher-issued fingerprint of this exact task execution.',
          '协程启动器签发的本次任务执行精确指纹。'
        ),
        exited,
        exposed: p(
          'Promise of the value supplied once to context.expose; remains pending when the task never exposes a port.',
          '一次 `context.expose` 提供值的承诺；任务未暴露端口时保持待定。'
        ),
        lastHeartbeatAt: p(
          'Scheduler time of latest explicit heartbeat or consumed iterator step.',
          '最近显式心跳或已消费迭代步骤的调度器时间。'
        )
      }
    },
    ICoroutineExitStatus: {
      summary: t(
        'Coroutine exit Promise always fulfills and retains rejection as discriminated data.',
        '协程退出承诺始终兑现，并把拒绝保留为判别数据。'
      ),
      members: {
        outcome: {
          ...p(
            'CoroutineOutcome distinguishes successful completion from the original task rejection.',
            '协程结算标识区分成功完成与原始任务拒绝。'
          ),
          values: { enum: 'CoroutineOutcome' }
        },
        error: p(
          'Original thrown or rejected task value, present only for the rejected outcome.',
          '原始任务抛出或拒绝值，仅在拒绝结果中存在。'
        )
      }
    },
    IProcessSupervisorOptions: {
      optionCases: supervisionOptionCases.process,
      summary: t(
        'Process profile construction with optional usage monitoring, output tails, registry and prewarm adoption.',
        '进程策略构造配置，包括可选用量监测、输出尾部、注册表和预热接管。'
      ),
      members: { ...base, ...processFields }
    },
    IPrewarmPoolOptions: {
      optionCases: supervisionOptionCases.prewarm,
      summary: t(
        'Bounded idle-process ownership policy using the same budget and launcher as consumers.',
        '使用与消费方相同预算和启动器的有界空闲进程所有权配置。'
      ),
      members: {
        id: base.id,
        report: base.report,
        isolation: base.isolation,
        requires: base.requires,
        startupTimeoutMs: base.startupTimeoutMs,
        scheduler,
        ...launchFields,
        registry: processFields.registry,
        'registry.port': processFields['registry.port'],
        'registry.namespace': processFields['registry.namespace'],
        usage: processFields.usage,
        'usage.intervalMs': processFields['usage.intervalMs'],
        'usage.failureThreshold': processFields['usage.failureThreshold'],
        wallClock: processFields.wallClock,
        size: p(
          'Nonnegative integer target of ready idle processes, each retaining one shared budget lease.',
          '就绪空闲进程的非负整数目标数量，每个条目保留一个共享预算租约。'
        ),
        idleTimeoutMs: p(
          'Finite nonnegative maximum idle retention before an unused prewarm handle is retired; zero expires immediately.',
          '未使用预热句柄退役前的最大空闲保留时长，须有限且非负；零表示立即到期。',
          t('`60000` milliseconds of idle retention.', '默认空闲最多保留 `60000` 毫秒。')
        ),
        exitTimeoutMs: { ...base['stop.exitTimeoutMs'], example: optionExamples.prewarmPolicy },
        reapTimeoutMs: { ...base['stop.reapTimeoutMs'], example: optionExamples.prewarmPolicy }
      }
    },
    IPrewarmPool: {
      summary: t(
        'Application-owned pool whose take transfers handle and lease ownership to its consumer.',
        '应用持有的池，取出条目会把句柄和租约所有权转交消费方。'
      ),
      scenarios: [
        t(
          'Reserve a small number of warm processes before serving traffic.',
          '服务流量到达前预留少量已预热进程。'
        )
      ],
      example:
        'const pool = createPrewarmPool({ id: "warm", launcher, spec, budget, size: 1, report: console.error }); console.log(pool.idle); await pool.dispose()',
      members: {
        id: p(
          'Application identifier supplied at pool construction.',
          '构造池时应用提供的稳定标识名称。'
        ),
        spec: p(
          'The process launch settings supplied when the pool was created, such as the command and its arguments. The pool passes them to its launcher to start idle processes ahead of a request, so a later caller can take an already-started process.',
          '创建池时提供的进程启动设置，例如命令与参数。池用这些设置调用启动器，提前创建空闲进程，供之后的调用方直接取用已启动的进程。'
        ),
        budget: p(
          'The process-capacity budget supplied to the pool. Each idle process occupies one slot, represented by a lease: an object that records and later releases that capacity. Taking a process transfers its lease to the caller instead of freeing the slot. When the pool closes an idle process, the slot stays occupied until that process actually exits.',
          '传给池的进程容量预算。每个空闲进程都占用一个名额，由租约对象记录并在之后释放这份占用。取用进程时，租约会一同转交调用方，不会立即空出名额。池关闭空闲进程时，也要等该进程实际退出后才释放名额。'
        ),
        launcher: p(
          'The runtime adapter that actually starts the pool processes. Its launch() result supplies an exited Promise, which must complete only after execution and associated resources have stopped. The pool uses that completion when deciding that a closed process no longer occupies capacity; merely requesting termination is not enough.',
          '实际负责启动池中进程的运行环境适配器。其 launch() 返回值提供 exited Promise；只有进程执行与相关资源都停止后，该 Promise 才应完成。池据此确认已关闭进程不再占用容量，只发出终止请求还不够。'
        ),
        idle: p(
          'Current number of ready idle entries still owned by the pool.',
          '池当前仍持有的就绪空闲条目数量。'
        ),
        take: m(
          'Synchronously transfers one ready idle entry and its occupied lease to the caller.',
          '同步把一个就绪空闲条目及其占用租约转交调用方。',
          {},
          t(
            'An `IPrewarmEntry`, or undefined when no eligible entry exists.',
            '返回 `IPrewarmEntry`；没有合适条目时为 `undefined`。'
          ),
          'const entry = pool.take()'
        ),
        invalidate: m(
          'Retires owned idle entries; already transferred entries remain owned by their consumers.',
          '退役池持有的空闲条目；已经转交的条目仍属于消费方。',
          {},
          t(
            'Idle entries begin retirement without synchronously awaiting actual exit.',
            '空闲条目开始退役，不会同步等待实际退出。'
          ),
          'pool.invalidate()'
        ),
        dispose: m(
          'Permanently closes the pool and awaits bounded teardown of every remaining owned entry.',
          '永久关闭池，并等待剩余所属条目的有界拆卸完成。',
          {},
          t(
            'Resolves after owned idle entries finish bounded retirement.',
            '所属空闲条目的有界退役完成后兑现。'
          ),
          'await pool.dispose()'
        )
      }
    },
    IPrewarmEntry: {
      summary: t(
        'Transferred process handle with its occupied lease and an output observer handoff.',
        '转交的进程句柄，附带占用租约及输出观察者交接。'
      ),
      scenarios: [
        t(
          'Consume an idle process while preserving its live budget lease.',
          '消费空闲进程并保留其存活预算租约。'
        )
      ],
      example:
        'const entry = pool.take(); if (entry) { entry.bindOutput((stream, bytes) => console.log(stream, bytes.length)); entry.handle.terminate("force"); await entry.handle.exited; entry.lease.release() }',
      members: {
        handle: p(
          'Live handle returned by the pool launcher and transferred on take.',
          '来自池启动器并在取出时转交的活动句柄。'
        ),
        lease: p(
          'Occupied shared budget lease transferred from the pool; release only after actual exit.',
          '从池转交的已占用共享预算租约；只在实际退出后释放。'
        ),
        bindOutput: m(
          'Synchronously replaces the output observer and replays the buffered tail. Buffered replay and live forwarding share observer isolation: a sink throw is reported without interrupting launcher draining or later output delivery.',
          '同步替换输出观察者并回放已缓冲尾部；回放与实时转发共用观察隔离，接收端抛错经报告而不打断底层排空或后续输出。',
          {
            sink: t(
              'Application synchronous callback receives DrainedStream and Uint8Array; returns void; observer failure is reported.',
              '应用同步回调接收 `DrainedStream` 和 `Uint8Array`，返回空值；观察者失败会上报。'
            )
          },
          t('Subsequent output is forwarded to the new sink.', '后续输出会转发给新的接收端。'),
          'entry.bindOutput((stream, chunk) => console.log(stream, chunk.length))'
        )
      }
    },
    IProcessEnv: {
      summary: t(
        'Explicit environment allowlist prevents accidental ambient environment inheritance.',
        '显式环境允许列表，避免意外继承周围环境变量。'
      ),
      members: {
        inherit: p(
          'Names chosen by the application for ambient values the launcher may inherit.',
          '应用指定的变量名称，只允许启动器继承这些环境值。'
        ),
        set: p(
          'Application-provided string values explicitly assigned in the child environment.',
          '应用提供并显式赋给子进程环境的字符串变量值。'
        )
      }
    },
    IProcessStdio: {
      summary: t(
        'Required standard-stream policies interpreted by the native process launcher.',
        '原生进程启动器解释的必需标准流处理策略。'
      ),
      members: {
        stdin: {
          ...p(
            'Selects whether native input is available as a channel or ignored.',
            '选择原生输入是否暴露为数据通道或被忽略。'
          ),
          values: { enum: 'StdinMode' }
        },
        stdout: {
          ...p(
            'Selects channel, bounded diagnostic drain or ignored native output.',
            '选择通道、有界诊断排空或忽略原生输出。'
          ),
          values: { enum: 'StdoutMode' }
        },
        stderr: {
          ...p(
            'Selects bounded diagnostic drain or ignored native error output.',
            '选择有界诊断排空或忽略原生错误输出。'
          ),
          values: { enum: 'StderrMode' }
        }
      }
    },
    IProcessLimits: {
      summary: t(
        'Positive relative process limits; call wall time remains a consumer responsibility.',
        '进程正数相对限制；调用墙钟时限仍由消费方负责。'
      ),
      members: {
        memoryBytes: p(
          'Finite positive resident-memory byte ceiling requested from the launcher.',
          '向启动器请求的驻留内存字节上限，须为有限正数。'
        ),
        cpuTimeMs: p(
          'Finite positive process CPU-time millisecond ceiling requested from the launcher.',
          '向启动器请求的进程处理器毫秒时长上限，须为有限正数。'
        ),
        callWallTimeMs: p(
          'Finite positive call wall-clock budget forwarded for the consumer to enforce.',
          '转交消费方执行的调用墙钟预算，须为有限正毫秒数。'
        )
      }
    },
    IProcessBootstrap: {
      summary: t(
        'Private bootstrap bytes sent through stdin or a dedicated file descriptor.',
        '通过标准输入或专用文件描述符发送的私有引导字节。'
      ),
      members: {
        via: {
          ...p(
            'Carrier chosen by the application; payload is never sent as arguments or environment.',
            '应用选择的载体；载荷从不通过参数或环境变量传递。'
          ),
          values: { enum: 'BootstrapVia' }
        },
        fd: p(
          'Required integer descriptor at least three for fd mode; forbidden for stdin mode.',
          '描述符模式必需且至少为三的整数描述符；标准输入模式禁止提供。'
        ),
        payload: p(
          'Application-owned secret byte payload; diagnostic validation never interpolates its contents.',
          '应用持有的秘密字节载荷；诊断校验不会插入其内容。'
        )
      }
    },
    IProcessSpec: {
      summary: t(
        'Closed shell-free process launch data; unknown fields or NUL-bearing arguments are rejected.',
        '封闭的不经命令解释器进程启动数据；拒绝未知字段及含空字符参数。'
      ),
      members: {
        command: p(
          'Application-chosen nonempty NUL-free executable name or path; never interpreted as shell text.',
          '应用指定的非空且不含空字符的程序名称或路径，不作为命令解释器文本。'
        ),
        args: p(
          'Application argument strings forwarded individually without shell interpolation.',
          '应用参数字符串逐项传递，不经命令解释器插值。'
        ),
        cwd: p(
          'Optional nonempty NUL-free working directory chosen by the application.',
          '应用指定的可选非空工作目录，不得含空字符。'
        ),
        tmpDir: p(
          'Optional nonempty NUL-free temporary directory understood by the runtime launcher.',
          '运行时启动器理解的可选非空临时目录，不得含空字符。'
        ),
        env: p(
          'Required IProcessEnv with explicit inherited names and assigned values.',
          '必需的 `IProcessEnv`，显式列明继承名称和赋值。'
        ),
        stdio: p(
          'Required IProcessStdio selecting native input, output and error carriers.',
          '必需的 `IProcessStdio`，选择原生输入、输出及错误载体。'
        ),
        limits: p(
          'Optional positive IProcessLimits; missing limits request no corresponding resource cap.',
          '可选正数 `IProcessLimits`；省略时不请求相应资源上限。'
        ),
        permissions: p(
          'Optional application permission strings; nonempty requests require launcher permission enforcement.',
          '可选应用权限字符串；非空请求要求启动器强制执行权限。'
        ),
        bootstrap: p(
          'Optional IProcessBootstrap sent privately through its declared carrier.',
          '可选 `IProcessBootstrap`，通过声明的私有载体发送。'
        )
      }
    },
    IProcessExitStatus: {
      summary: t(
        'Actual native code and signal supplied after process execution and launcher resources stop.',
        '进程执行及启动器资源停止后提供的实际原生退出码与信号。'
      ),
      members: {
        code: p(
          'Native numeric exit code, or null if termination has no code.',
          '原生数字退出码；终止没有退出码时为 `null`。'
        ),
        signal: p(
          'Actual termination signal, or null for a normal code-based exit.',
          '实际终止信号；按退出码正常结束时为 `null`。'
        )
      }
    },
    IProcessIdentity: {
      summary: t(
        'Exact process fingerprint plus an optional diagnostic native process identifier.',
        '精确进程指纹，以及可选诊断所用原生进程编号。'
      ),
      members: {
        fingerprint: identity,
        pid: p(
          'Native process identifier from the launcher; fingerprint must also match before recovery termination.',
          '启动器提供的原生进程编号；恢复终止前还必须匹配指纹。'
        )
      }
    },
    IProcessHandle: {
      summary: t(
        'Runtime-owned process handle; requesting termination and observing actual exit remain separate.',
        '运行时拥有的进程句柄；请求终止与观察实际退出保持分离。'
      ),
      members: {
        identity: p(
          'Launcher-issued IProcessIdentity identifying the original process.',
          '启动器签发的 `IProcessIdentity`，识别原始进程。'
        ),
        exited,
        terminate: m(
          'Idempotently requests termination of the entire declared process container.',
          '幂等地请求终止整个已声明的进程容器。',
          {
            mode: t(
              'Supervisor-selected graceful or force termination strength.',
              '监督器选择的优雅或强制终止强度。'
            )
          },
          t(
            'The termination request has been issued; await exited for actual completion.',
            '终止请求已发出；实际完成须等待退出承诺。'
          ),
          'handle.terminate("force"); await handle.exited'
        ),
        sampleUsage: m(
          'Optionally reads native usage for this exact process without aggregating unrelated parent work.',
          '可选读取该精确进程的原生用量，不汇总无关父进程工作。',
          {},
          t(
            'An IProcessUsage sample; adapter rejection is handled by the resource monitor.',
            '返回 `IProcessUsage` 样本；适配器拒绝由资源监测器处理。'
          ),
          'const usage = await handle.sampleUsage?.()'
        )
      }
    },
    IProcessLaunchContext: {
      summary: t(
        'Process launch attempt signal plus a continuously drained output destination.',
        '进程启动尝试信号以及持续排空的输出接收端。'
      ),
      members: {
        signal: p(
          'Supervisor native attempt signal that cancels outstanding launch work.',
          '监督器原生尝试信号，用于取消尚未完成的启动工作。'
        ),
        executionGeneration: p(
          'Optional execution ordinal reserved by the supervisor for this cold attempt.',
          '监督器为本轮冷启动预留的可选执行序号。'
        ),
        output: m(
          'Accepts bytes continuously drained by the launcher from startup, independent of consumer speed.',
          '从启动开始持续接收启动器排空的字节，不依赖消费方速度。',
          {
            stream: t(
              'Launcher label stdout or stderr for this chunk.',
              '启动器给出的本字节块标准输出或错误标签。'
            ),
            chunk: t(
              'Byte chunk supplied by the launcher drain loop.',
              '启动器排空循环提供的字节块。'
            )
          },
          t('Returns void after forwarding the observed chunk.', '转发本次观察字节块后返回空值。'),
          'context.output("stderr", new Uint8Array([10]))'
        )
      }
    },
    IProcessLauncher: {
      summary: t(
        'Application native process launcher with optional fingerprint-aware durable recovery operations.',
        '应用原生进程启动器，以及可选基于指纹的持久恢复操作。'
      ),
      members: {
        capabilities: p(
          'Actual process capability guarantees declared by the runtime adapter.',
          '运行时适配器声明的实际进程能力保证。'
        ),
        launch: m(
          'Creates a native process from a closed specification and drains output from startup.',
          '根据封闭规格创建原生进程，并从启动起排空输出。',
          {
            spec: t(
              'Profile-validated application process specification.',
              '单元策略已经校验的应用进程规格。'
            ),
            context: t(
              'Supervisor-created IProcessLaunchContext with signal and output sink.',
              '监督器创建的 `IProcessLaunchContext`，含信号及输出接收端。'
            )
          },
          t(
            'A live process handle; reject with original startup failure.',
            '返回活动进程句柄；失败以原始启动错误拒绝。'
          ),
          'const handle = await launcher.launch(spec, context)'
        ),
        probe: m(
          'Checks that a durable record still identifies the original process, distinguishing reused PIDs.',
          '检查持久记录是否仍识别原始进程，区分已复用进程编号。',
          {
            record: t(
              'Record returned from the configured IProcessRegistry.',
              '配置的 `IProcessRegistry` 返回的记录。'
            )
          },
          t(
            'Alive, gone or reused; rejection preserves the record for later recovery.',
            '返回存活、消失或复用；拒绝会保留记录以便后续恢复。'
          ),
          'const status = await launcher.probe?.(record)'
        ),
        terminateRecord: m(
          'Terminates only the original fingerprint-matching process and waits for actual completion.',
          '只终止指纹匹配的原始进程，并等待实际完成。',
          {
            record: t(
              'Original durable record previously accepted by the launcher probe.',
              '启动器探测已经接受的原始持久记录。'
            )
          },
          t(
            'Resolves after recovery termination; rejection leaves the durable record intact.',
            '恢复终止后兑现；拒绝时保留持久记录。'
          ),
          'await launcher.terminateRecord?.(record)'
        )
      }
    },
    IProcessRecord: {
      summary: t(
        'Durable ownership record created for an admitted process and removed after actual exit.',
        '为已准入进程创建并在实际退出后移除的持久所有权记录。'
      ),
      members: {
        id: p(
          'Supervisor-produced record identifier used for duplicate detection and removal.',
          '监督器生成的记录标识，用于重复检测及记录移除。'
        ),
        namespace: p(
          'Application registry isolation namespace supplied at construction.',
          '构造时应用提供的注册表隔离命名空间。'
        ),
        identity: p(
          'Launcher-issued fingerprint and optional PID of the exact process.',
          '启动器签发的精确进程指纹及可选编号。'
        ),
        launchedAt: p(
          'Epoch launch timestamp from the configured wall clock, not scheduler time.',
          '配置的纪元时钟提供的启动时间戳，不是调度器时间。'
        )
      }
    },
    IProcessRegistry: {
      summary: t(
        'Application durable storage contract for exact process ownership and later orphan recovery.',
        '应用为精确进程所有权和后续孤儿恢复实现的持久存储契约。'
      ),
      members: {
        add: m(
          'Durably registers one process ownership record; duplicate identifiers fail.',
          '持久登记一条进程所有权记录；重复标识会失败。',
          {
            record: t(
              'Supervisor-produced record of the admitted process.',
              '监督器生成的已准入进程记录。'
            )
          },
          t(
            'Resolves after storage succeeds; rejection fails attachment.',
            '存储成功后兑现；拒绝会使附加阶段失败。'
          ),
          'await registry.add(record)'
        ),
        remove: m(
          'Removes one durable ownership record; an absent identifier succeeds without effect.',
          '移除一条持久所有权记录；标识不存在时成功且无效果。',
          {
            id: t(
              'Identifier from the supervisor-created or listed process record.',
              '来自监督器生成或列出的进程记录标识。'
            )
          },
          t(
            'Resolves after the record is absent; failures remain reportable.',
            '记录不存在后兑现；失败仍可被上报。'
          ),
          'await registry.remove(record.id)'
        ),
        list: m(
          'Lists all durable records owned by one application namespace.',
          '列出一个应用命名空间持有的全部持久记录。',
          {
            namespace: t(
              'Application namespace used when records were registered.',
              '登记记录时使用的应用命名空间。'
            )
          },
          t(
            'Read-only record array used by fingerprint-aware recovery.',
            '返回指纹恢复使用的只读记录数组。'
          ),
          'const records = await registry.list("app")'
        )
      }
    },
    IProcessUsage: {
      summary: t(
        'Adapter samples actual process resource use; absent fields mean the adapter has no observation.',
        '适配器采样的实际进程资源用量；字段缺省表示没有观测值。'
      ),
      members: {
        rssBytes: p(
          'Resident process memory in bytes for memory-limit monitoring.',
          '用于内存限制监测的进程驻留内存字节数。'
        ),
        cpuTimeMs: p(
          'Process cumulative CPU milliseconds for CPU-time monitoring.',
          '用于处理器时长监测的进程累计毫秒数。'
        ),
        cpuUserMicros: p(
          'Cumulative user CPU microseconds of this actual PID, excluding parent and descendants.',
          '该实际进程累计用户处理器微秒数，不含父进程和后代。'
        ),
        cpuSystemMicros: p(
          'Cumulative system CPU microseconds of this actual PID.',
          '该实际进程累计系统处理器微秒数。'
        )
      }
    },
    IOrphanReclaimResult: {
      summary: t(
        'Recoverable scan result preserving successful IDs and per-record collected failures.',
        '恢复扫描结果，保留成功记录标识和逐记录收集的失败。'
      ),
      scenarios: [
        t(
          'Inspect which prior processes were reclaimed and which records need another recovery attempt.',
          '检查已恢复的旧进程以及仍需后续恢复的记录。'
        )
      ],
      example:
        'const result = await reclaimOrphanProcesses({ registry, namespace: "app", launcher, report: console.error }); console.log(result.terminated, result.removed, result.failures)',
      members: {
        terminated: p(
          'Record identifiers whose original live processes were terminated successfully.',
          '原始存活进程已经成功终止的记录标识列表。'
        ),
        removed: p(
          'Record identifiers removed after successful probe and optional termination.',
          '成功探测及可选终止后已经移除的记录标识列表。'
        ),
        failures: p(
          'External ICollectedError entries retaining coded recovery errors and their original causes.',
          '外部 `ICollectedError` 条目，保留编码恢复错误及其原始原因。'
        )
      }
    },
    IThreadSupervisorOptions: {
      optionCases: supervisionOptionCases.thread,
      summary: t(
        'Native worker construction policy sharing the core readiness and lifecycle commands.',
        '原生工作线程构造策略，共用核心就绪和生命周期命令。'
      ),
      members: { ...base, ...launchFields }
    },
    IThreadSpec: {
      summary: t(
        'Application worker entry and cloneable startup data interpreted by its runtime launcher.',
        '由运行时启动器解释的应用线程入口及可克隆启动数据。'
      ),
      members: {
        entry: p(
          'Nonempty application worker entry string understood by the selected launcher.',
          '所选启动器理解的应用工作线程非空入口字符串。'
        ),
        name: p(
          'Optional application worker label forwarded to the native launcher.',
          '转交原生启动器的可选应用工作线程标签。'
        ),
        data: p(
          'Optional application startup payload; the launcher determines its cloneable representation.',
          '可选应用启动载荷；可克隆表示由启动器决定。'
        ),
        limits: p(
          'Optional IThreadLimits; positive limits are forwarded unchanged to the launcher.',
          '可选 `IThreadLimits`；正数限制原样转交启动器。'
        )
      }
    },
    IThreadLimits: {
      summary: t(
        'Positive worker limits supplied to a capable runtime adapter without reinterpretation.',
        '原样提供给具备能力的运行时适配器的正数工作线程限制。'
      ),
      members: {
        heapBytes: p(
          'Finite positive heap byte ceiling requiring the heap-limit capability.',
          '要求具备堆限制能力的有限正数堆字节上限。'
        ),
        callWallTimeMs: p(
          'Finite positive call wall deadline, left to the consuming protocol to enforce.',
          '交由消费协议执行的有限正数调用墙钟毫秒时限。'
        )
      }
    },
    IThreadIdentity: {
      summary: t(
        'Launcher-issued fingerprint distinguishes native workers with reused numeric identifiers.',
        '启动器签发的指纹区分复用数字编号的原生工作线程。'
      ),
      members: {
        threadId: p(
          'Optional native worker identifier provided by the selected launcher.',
          '所选启动器提供的可选原生工作线程编号。'
        ),
        fingerprint: identity
      }
    },
    IThreadHandle: {
      summary: t(
        'Native worker handle separates idempotent termination request from actual exited settlement.',
        '原生线程句柄分开幂等终止请求和实际退出结算。'
      ),
      members: {
        identity: p(
          'Launcher-issued exact native worker identity and fingerprint.',
          '启动器签发的精确原生工作线程身份与指纹。'
        ),
        exited,
        terminate: m(
          'Idempotently requests native worker termination through its runtime adapter.',
          '通过运行时适配器幂等请求终止原生工作线程。',
          {},
          t(
            'Termination was requested; await exited before releasing ownership.',
            '已请求终止；释放所有权前须等待实际退出。'
          ),
          'handle.terminate(); await handle.exited'
        ),
        sampleUsage: m(
          'Optionally performs a cold local observation of this isolate, never parent-process aggregate CPU.',
          '可选执行该隔离域的冷读取观测，从不使用父进程汇总处理器用量。',
          {},
          t(
            'An IThreadUsage sample; unsupported fields remain absent.',
            '返回 `IThreadUsage` 样本；不支持的字段保持缺省。'
          ),
          'const usage = await handle.sampleUsage?.()'
        )
      }
    },
    IThreadLauncher: {
      summary: t(
        'Application native worker adapter whose exited promise resolves only after execution stops.',
        '应用原生工作线程适配器，退出承诺只在执行停止后兑现。'
      ),
      members: {
        capabilities: p(
          'Native worker guarantee grades, including exit-observation and requested heap enforcement.',
          '原生工作线程保证等级，包括退出观察及请求的堆限制执行。'
        ),
        launch: m(
          'Creates a native worker from a validated application entry and attempt context.',
          '根据已校验应用入口和本轮上下文创建原生工作线程。',
          {
            spec: t(
              'Application IThreadSpec validated by the thread profile.',
              '线程策略已校验的应用 `IThreadSpec`。'
            ),
            context: t(
              'Supervisor-created launch signal and execution generation.',
              '监督器创建的启动信号及执行世代。'
            )
          },
          t(
            'A live native worker handle, or rejection with the original launch failure.',
            '返回活动原生线程句柄，或以原始启动失败拒绝。'
          ),
          'const handle = await launcher.launch(spec, context)'
        )
      }
    },
    IThreadExitStatus: {
      summary: t(
        'Actual worker settlement retains its native code, original failure and runtime limit report.',
        '实际线程结算保留原生退出码、原始失败及运行时限制报告。'
      ),
      members: {
        code: p(
          'Actual worker exit code, or null if the runtime supplies no numeric code.',
          '实际工作线程退出码；运行时没有数字码时为 `null`。'
        ),
        error: p(
          'Original worker failure when the adapter observed one.',
          '适配器观察到失败时保留的原始工作线程错误。'
        ),
        limit: {
          ...p(
            'Native runtime limit identified at worker exit; currently the heapBytes limit.',
            '线程退出时识别的原生运行时限制，目前为堆字节限制。'
          ),
          values: { enum: 'ThreadLimit' }
        }
      }
    },
    IThreadUsage: {
      summary: t(
        'Optional resource samples, not a capability map. Isolate-local fields are only meaningful when the adapter can observe them independently; shared process IDs do not establish per-thread usage. Event-loop activity and CPU time have separate units.',
        '可选资源样本而非能力映射；仅适配器能独立观察时才代表线程本地用量，共享进程编号不能证明线程独立用量，事件循环活动与处理器时长单位不同。'
      ),
      members: {
        sharedPid: p(
          'Optional host process ID shared with this worker, for diagnostics only.',
          '该线程共享的可选宿主进程编号，仅用于诊断。'
        ),
        heapUsedBytes: p(
          'Observed worker-local heap memory use in bytes.',
          '观察到的工作线程本地堆内存字节数。'
        ),
        heapTotalBytes: p(
          'Observed worker-local total heap capacity in bytes.',
          '观察到的工作线程本地堆总容量字节数。'
        ),
        cpuUserMicros: p(
          'Observed worker-local user CPU microseconds, when supported by the runtime.',
          '运行时支持时观察到的线程本地用户处理器微秒数。'
        ),
        cpuSystemMicros: p(
          'Observed worker-local system CPU microseconds, when supported by the runtime.',
          '运行时支持时观察到的线程本地系统处理器微秒数。'
        ),
        elu: p(
          'Event-loop active and idle durations plus utilization ratio; these are not CPU time.',
          '事件循环活动、空闲时长与利用率；这些值不是处理器时长。'
        )
      }
    }
  },
  enums: domains,
  enhancers: {}
}
