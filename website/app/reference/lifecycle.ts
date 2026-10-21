/**
 * Reference documentation of `@migaia/lifecycle`. Rules: `app/reference/contract.ts`. Verified
 * against public barrels, owning modules, README and USEGUIDE on 2026-10-18. Generic transactions
 * without a signal use an inert signal. Scope unregister removes the earliest active duplicate
 * registration. Late graceful failures and accidental asynchronous hook failures remain observed
 * through the existing report boundary.
 */
import { lifecycleCases } from './lifecycle-cases.js'
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'

/** Builds the two localized versions of one reference sentence. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Complete ownership example shared by the general scope and its minimal owner surface. */
const scopeExample = `import { createLifecycleScope } from '@migaia/lifecycle'

const scope = createLifecycleScope({ errorPolicy: 'collect' })
const resource = scope.own({ active: true }, {
  force: () => { resource.active = false }
})
scope.close()
const errors = await scope.dispose()
console.log(resource.active, errors)`

/** Synchronous ownership example, with the required descriptor declaration. */
const syncScopeExample = `import { createSyncLifecycleScope } from '@migaia/lifecycle'

const scope = createSyncLifecycleScope({ errorPolicy: 'collect' })
const resource = scope.own({ active: true }, {
  syncSafe: true,
  force: () => { resource.active = false }
})
scope.close()
console.log(scope.dispose(), resource.active)`

/** Provisional resources become permanent only after a successful parent transfer. */
const provisionalExample = `import { attachSecondaryErrors } from '@migaia/utils/error'
import { createLifecycleScope, createProvisionalScope } from '@migaia/lifecycle'

const parent = createLifecycleScope()
const provisional = createProvisionalScope()
const resource = provisional.own({ active: true }, {
  force: () => { resource.active = false }
})
try {
  await provisional.commitTo(parent)
} catch (error) {
  try {
    await provisional.rollback()
  } catch (cleanupError) {
    throw attachSecondaryErrors(error, [cleanupError])
  }
  throw error
}
await parent.dispose()`

/** A generation token gates acceptance of a result and completion releases its timer. */
const generationExample = `import { createGenerationController } from '@migaia/lifecycle'

const controller = createGenerationController({ report: console.error })
const request = controller.begin({ timeoutMs: 1000 })
const value = { active: true }
if (controller.adopt(request.token, value, (stale) => { stale.active = false })) {
  console.log(controller.isCurrent(request.token), value)
  controller.complete(request.token)
}
controller.dispose()`

/** Strict draining seals admission before waiting for the last retained lease. */
const leaseExample = `import { createQuiescenceTracker } from '@migaia/lifecycle'

const tracker = createQuiescenceTracker<object>()
const key = {}
const release = tracker.retain(key)
tracker.seal(key)
const drained = tracker.whenZero(key)
release()
await drained
console.log(tracker.count(key), tracker.forget(key))`

/** A caller-supplied plan defines transaction order without resource-shape inference. */
const transactionExample = `import { createDisposeTransaction, DisposeTransactionKind } from '@migaia/lifecycle'

const released: string[] = []
const transaction = createDisposeTransaction(
  { kind: DisposeTransactionKind.plan },
  { errorPolicy: 'collect' }
)
const errors = await transaction.run([
  { source: 'connection', descriptor: { force: () => { released.push('connection') } } },
  { source: 'cache', descriptor: { force: () => { released.push('cache') } } }
])
console.log(released, errors)`

/** Ledger callbacks start on the caller stack; the outcome retains later physical completion. */
const ledgerExample = `import { createSyncStartedDisposalLedger, mergeCleanupResults } from '@migaia/lifecycle'

const ledger = createSyncStartedDisposalLedger()
ledger.start('connection', () => Promise.resolve())
const outcome = ledger.seal()
const complete = await mergeCleanupResults([outcome])
await ledger.whenTerminal()
console.log(ledger.lifecycle, complete.cleanupErrors)`

/** The queue serializes tasks but preserves their result and rejection semantics. */
const queueExample = `import { createMutationQueue } from '@migaia/lifecycle'

const queue = createMutationQueue({ queueAdmissionTimeoutMs: 1000 })
const first = queue.enqueue(async () => 1, { owner: 'settings' })
await first
const second = await queue.enqueue(() => 2, { owner: 'settings' })
console.log(second, queue.size)`

/** A native controller and its paired observed listener share one cancellation reason. */
const abortExample = `import { createAbortController, observeAbortSubscription } from '@migaia/lifecycle/abort'

const controller = createAbortController()
const subscription = observeAbortSubscription(
  controller.signal,
  (reason) => console.log(reason),
  (error) => console.error(error)
)
controller.abort('shutdown')
subscription.unsubscribe()`

/** Shared scheduler option always refers readers to its canonical utils owner. */
const schedulerOption: IMemberDoc = {
  summary: t(
    'Clock and timer implementation from `@migaia/utils/scheduler`. Supply the same scheduler that produced every absolute deadline; lifecycle snapshots methods with their original receiver and rejects invalid shapes with `INVALID_OPTION`.',
    '来自 `@migaia/utils/scheduler` 的时钟与定时器实现。必须与绝对截止时刻采用同一个时钟；本包保留方法接收者并读取方法快照，形状不合法时抛 `INVALID_OPTION`。'
  ),
  default: t(
    'Omitted: use the admitted `systemScheduler` when a timed phase first needs it.',
    '省略时使用已接纳的 `systemScheduler`，在计时阶段需要时启用。'
  )
}

/** One policy choice controls how release failures leave a scope or transaction. */
const errorPolicyOption: IMemberDoc = {
  summary: t(
    'Selects the release error outcome from `LifecycleErrorPolicy`. Every admitted item still receives its release attempt; `report` and `firstError` require a reporter when creating a scope or transaction.',
    '从 `LifecycleErrorPolicy` 选择释放错误的交付方式。每个已接纳项目仍会尝试释放；创建作用域或事务时，`report` 与 `firstError` 必须提供上报回调。'
  ),
  default: t(
    '`throw`: rethrow one original failure or aggregate several after release.',
    '`throw`：释放后原样抛出单个错误，多个错误则聚合抛出。'
  ),
  values: { enum: 'LifecycleErrorPolicy' }
}

/** Reporter callbacks are the final diagnostic boundary, not release operations. */
const reportOption: IMemberDoc = {
  summary: t(
    'Receives each diagnostic or policy-routed `error` from lifecycle. Return nothing synchronously; accidental thenable rejections and synchronous throws are contained. A scope or transaction requires this callback for `report` and `firstError` policies.',
    '接收本包传入的诊断错误或策略转交的 `error`。应同步返回空值；同步抛错和意外返回的异步拒绝都会被隔离。作用域或事务选择 `report`、`firstError` 时必须提供。'
  ),
  default: t(
    'Omitted: diagnostics have no sink; factories reject this omission for `report` and `firstError`.',
    '省略时没有诊断接收方；采用 `report` 或 `firstError` 的工厂会拒绝缺失回调。'
  ),
  params: {
    error: t(
      'Original failure or coded diagnostic supplied by the current lifecycle operation.',
      '由当前生命周期操作传入的原始错误或带码诊断。'
    )
  },
  returns: t(
    'No value is consumed; callback failures do not replace the operation result.',
    '不使用返回值；回调失败不会替换操作结果。'
  ),
  example: `const scope = createLifecycleScope({ errorPolicy: 'report', report: (error) => console.error(error) })
await scope.dispose()`
}

/** Shared absolute deadline never grants a fresh budget to subsequent resources. */
const deadlineOption: IMemberDoc = {
  summary: t(
    'Absolute finite time in the selected scheduler clock. Every item sees the same `deadlineAt`; it caps graceful waiting only, so forced release can continue beyond it.',
    '所选调度器时钟中的有限绝对时刻。所有项目收到同一个 `deadlineAt`；它只限制优雅释放的等待，强制释放仍可在此后继续。'
  ),
  default: t(
    'Omitted: no shared deadline; an individual descriptor may still set its own graceful budget.',
    '省略时没有共享截止时刻；单个描述器仍可指定自己的优雅释放预算。'
  )
}

/** Resource registration is explicit and returns the exact caller-owned resource. */
const ownMember: IMemberDoc = {
  summary: t(
    'Registers one resource and an explicit release descriptor while the owner is open. The same resource identity may be registered more than once; no resource method is discovered automatically.',
    '在所有者开放时登记资源和显式释放描述器。同一资源身份可以多次登记；本包不会自动猜测或寻找资源的释放方法。'
  ),
  params: {
    resource: t(
      'Value allocated by the caller; keep this exact identity for a later unregister operation.',
      '调用方分配的资源值；后续取消登记时保留这个相同身份。'
    ),
    descriptor: t(
      'Caller-authored `IReleaseDescriptor` declaring required `force` and optional graceful/custom release callbacks. Invalid fields fail registration.',
      '调用方编写的 `IReleaseDescriptor`，声明必填 `force` 和可选优雅或自定义释放回调；字段不合法时登记失败。'
    )
  },
  returns: t(
    'The exact `resource` unchanged; closed and terminal owners throw `SCOPE_CLOSED` or `SCOPE_TERMINAL`.',
    '原样返回同一个 `resource`；关闭中和终止的所有者分别抛 `SCOPE_CLOSED`、`SCOPE_TERMINAL`。'
  ),
  example: scopeExample
}

/** Unregistering never releases the resource because responsibility returns to the caller. */
const releaseMember: IMemberDoc = {
  summary: t(
    'Removes the earliest active registration of a resource without calling its descriptor. Use after independently releasing it; repeated calls can remove separate registrations of the same value.',
    '移除资源最早的一条有效登记，不调用释放描述器。资源已由调用方独立释放后使用；重复调用可以移除同一资源的其他登记。'
  ),
  params: {
    resource: t(
      'The exact resource identity previously passed to this scope’s `own()`.',
      '之前传给此作用域 `own()` 的同一个资源身份。'
    )
  },
  returns: t(
    '`true` if one registration was removed; `false` if none remains.',
    '`true` 表示移除了一条登记；`false` 表示没有可移除的登记。'
  ),
  example: `const scope = createLifecycleScope()
const resource = scope.own({}, { force: () => console.log('released') })
console.log(scope.release(resource))
await scope.dispose()`
}

/** Closing is a separate admission transition before actual resource release. */
const closeMember: IMemberDoc = {
  summary: t(
    'Synchronously changes `open` to `closing` and prevents later registration. Repeated calls preserve the current state; resource release callbacks do not run here.',
    '同步把开放状态改为关闭中，阻止后续登记。重复调用保留当前状态；此处不会运行资源释放回调。'
  ),
  returns: t(
    'Admission is closed; call `dispose()` to perform resource release.',
    '登记入口已关闭；调用 `dispose()` 才会执行资源释放。'
  ),
  example: scopeExample
}

/** Shared state property for containers with the survival lifecycle axis. */
const lifecycleMember: IMemberDoc = {
  summary: t(
    'Current survival state from `LifecycleState`; closing forbids new work and terminal is irreversible.',
    '来自 `LifecycleState` 的当前存续状态；关闭中拒绝新工作，终止状态不可逆转。'
  ),
  values: { enum: 'LifecycleState' }
}

/** Shared key input: callers create or choose the identity; the tracker never issues keys. */
const keyParam = t(
  'Caller-selected resource identity, reused unchanged for retain, sealing, counting and waiting.',
  '由调用方选定的资源身份；登记、封闭、计数和等待时复用同一个值。'
)

/** Lease methods are shared verbatim by tracker and registry aliases. */
const leaseMembers: Readonly<Record<string, IMemberDoc>> = {
  retain: {
    summary: t(
      'Adds one active lease for the caller-selected key. Pair with the returned `release()` function to decrement exactly once; sealed keys throw `QUIESCENCE_SEALED`.',
      '为调用方指定的键增加一个有效租约。搭配返回的 `release()` 释放函数减少一次计数；已封闭的键抛 `QUIESCENCE_SEALED`。'
    ),
    params: { key: keyParam },
    returns: t(
      'An idempotent synchronous `IDisposer`; calling it returns this lease and may resolve zero-count waiters.',
      '一个幂等同步 `IDisposer`；调用后归还此租约，并可能唤醒等待归零的调用方。'
    ),
    example: `const tracker = createQuiescenceTracker<object>()
const key = {}
const release = tracker.retain(key)
release()
console.log(tracker.count(key))`
  },
  count: {
    summary: t(
      'Reads the number of active leases for one key without allocating new state or preventing later retains.',
      '读取一个键的有效租约数量，不创建新的状态，也不会阻止后续继续登记租约。'
    ),
    params: { key: keyParam },
    returns: t(
      'A nonnegative count; an unknown key returns zero.',
      '非负计数；从未登记的键返回零。'
    ),
    example: `const tracker = createQuiescenceTracker<object>()
console.log(tracker.count({}))`
  },
  whenZero: {
    summary: t(
      'Waits for strict, exclusive draining of a sealed key. Pair with `seal()` first; otherwise it synchronously throws `QUIESCENCE_UNSEALED_WAIT`.',
      '等待已封闭的键完成独占排空。搭配 `seal()` 先关闭登记；否则同步抛 `QUIESCENCE_UNSEALED_WAIT`。'
    ),
    params: { key: keyParam },
    returns: t(
      'A `Promise<void>` fulfilled after the sealed key has no active lease; zero already fulfills immediately.',
      '一个 `Promise<void>`，在已封闭的键没有租约时完成；计数已为零则立即完成。'
    ),
    example: leaseExample
  },
  whenZeroOnce: {
    summary: t(
      'Waits for the next observed zero count while allowing new leases. A fulfilled wait is a momentary observation, not an admission fence.',
      '允许新租约进入，同时等待下一次观察到计数归零。完成只代表当时归零，并不建立拒绝新租约的屏障。'
    ),
    params: { key: keyParam },
    returns: t(
      'A `Promise<void>` that resolves immediately for an idle key or at the next zero transition.',
      '空闲键立即完成，否则在下次归零时完成的 `Promise<void>`。'
    ),
    example: `const tracker = createQuiescenceTracker<object>()
const key = {}
const release = tracker.retain(key)
const idle = tracker.whenZeroOnce(key)
release()
await idle`
  },
  seal: {
    summary: t(
      'Permanently rejects new leases for this retained key until its zero-count state is forgotten. Pair with `whenZero()` for an exclusive drain.',
      '持续拒绝此键的新租约，直到归零状态被遗忘。搭配 `whenZero()` 可等待不再接纳新租约的独占排空。'
    ),
    params: { key: keyParam },
    returns: t(
      'The key is sealed; repeated sealing does not change its count.',
      '此键已封闭；重复封闭不会改变租约数量。'
    ),
    example: leaseExample
  },
  isSealed: {
    summary: t(
      'Reads whether this key currently carries an admission fence, including a sealed key whose count is already zero.',
      '读取此键是否仍保留登记屏障，包括计数已经归零但尚未遗忘的封闭键。'
    ),
    params: { key: keyParam },
    returns: t(
      '`true` for a sealed state entry; unknown or forgotten keys return `false`.',
      '`true` 表示存在封闭状态；未知或已遗忘的键返回 `false`。'
    ),
    example: `const tracker = createQuiescenceTracker<object>()
const key = {}
tracker.seal(key)
console.log(tracker.isSealed(key))`
  },
  forget: {
    summary: t(
      'Deletes a zero-count entry only when no zero-count waiter remains. Forgetting a sealed entry removes its admission fence.',
      '仅在租约数量为零且没有归零等待方时删除状态；遗忘封闭状态也会移除其登记屏障。'
    ),
    params: { key: keyParam },
    returns: t(
      '`true` if a state entry was removed; `false` if missing, leased or still awaited.',
      '`true` 表示删除了状态；不存在、仍有租约或等待方时返回 `false`。'
    ),
    example: leaseExample
  }
}

/** Release callbacks own resource teardown; the descriptor itself never infers resource shape. */
const descriptorMembers: Readonly<Record<string, IMemberDoc>> = {
  syncSafe: {
    summary: t(
      'Declares that all release callbacks finish synchronously. Required as `true` for the synchronous scope; it never changes an asynchronous scope into a synchronous one.',
      '声明所有释放回调均同步结束。同步作用域要求显式设为 `true`；此标记不会把异步作用域变成同步作用域。'
    ),
    default: t(
      'Omitted: not eligible for a synchronous scope.',
      '省略时不满足同步作用域的登记要求。'
    ),
    values: {
      true: t(
        'Choose only for callbacks guaranteed to return no thenable.',
        '仅在回调保证不会返回异步可等待值时选择。'
      ),
      false: t(
        'Does not promise synchronous release; use the asynchronous scope.',
        '不保证同步释放，应使用异步作用域承接。'
      )
    }
  },
  order: {
    summary: t(
      'Finite caller-defined release priority: larger values release first in order mode, while equal priorities preserve input sequence. Plan mode never reads it.',
      '调用方给出的有限释放优先级：排序模式先释放较大值，相同优先级保持输入顺序；计划模式完全不读取此字段。'
    ),
    default: t(
      '`0`: participates in the stable default-priority group.',
      '`0`：进入默认优先级分组并保持稳定顺序。'
    )
  },
  graceful: {
    summary: t(
      'Optional graceful callback receiving the current `IReleaseContext`. Return void or a thenable; success ends release, while throw/rejection records the original failure and proceeds to force. A timed-out thenable stays observed but is not cancelled.',
      '可选优雅释放回调，接收当前 `IReleaseContext`。返回空值或异步可等待值；成功后结束释放，抛错或拒绝则记录原错误并转入强制释放。异步超时仍观察迟到结果，但不会取消原回调。'
    ),
    default: t(
      'Omitted: run `force` immediately unless `custom` overrides release.',
      '省略时直接执行 `force`，除非由 `custom` 接管释放。'
    ),
    params: {
      context: t(
        'Release context supplied by the executing scope or transaction.',
        '执行中的作用域或事务提供的释放上下文。'
      )
    },
    returns: t(
      'Void or a thenable indicating graceful completion; timeout permits fallback without cancelling it.',
      '空值或表示优雅释放完成的异步可等待值；超时允许降级但不取消该工作。'
    ),
    example: transactionExample
  },
  gracefulTimeoutMs: {
    summary: t(
      'Finite nonnegative budget in milliseconds, measured before invoking graceful code and capped by the shared absolute deadline. A synchronous callback that returns late reports an overrun but still succeeds.',
      '有限非负毫秒预算，从调用优雅回调前开始计时，并受共享绝对截止时刻限制。同步回调迟到返回时只上报超时，仍视为释放成功。'
    ),
    default: t(
      'Omitted: only the shared deadline applies; without either limit the graceful phase has no time bound.',
      '省略时只受共享截止时刻限制；两者都未指定则不限制优雅阶段等待时间。'
    )
  },
  force: {
    summary: t(
      'Required unconditional release callback receiving `IReleaseContext`. Return void or a thenable; its failure is collected and also reported as `RELEASE_FORCE_FAILED` with the original as cause.',
      '必填的无条件释放回调，接收 `IReleaseContext`。返回空值或异步可等待值；失败会被收集，并以原错误为原因上报 `RELEASE_FORCE_FAILED`。'
    ),
    params: {
      context: t(
        'Release context supplied by the scope, transaction or explicit descriptor execution.',
        '由作用域、事务或显式描述器执行传入的释放上下文。'
      )
    },
    returns: t(
      'Void or a thenable completing final teardown; callback failures do not prevent later items from releasing.',
      '空值或表示最终清理完成的异步可等待值；失败不会阻止后续项目释放。'
    ),
    example: scopeExample
  },
  gcFallback: {
    summary: t(
      'Requests best-effort finalization support for an object owned by an asynchronous scope. A reachable scope still strongly owns resources; explicit release unregisters the fallback. The synchronous scope ignores this flag.',
      '为异步作用域拥有的对象申请尽力而为的终结清理。可达作用域仍强持有资源；显式释放会注销后备回调。同步作用域忽略此标记。'
    ),
    default: t(
      '`false`: no finalization registry registration is created.',
      '`false`：不向终结注册表登记后备清理。'
    )
  },
  custom: {
    summary: t(
      'Takes over the entire release sequence with a caller-authored callback receiving `IReleaseContext`. Return void or a thenable; throws and rejections become item errors, and neither graceful nor force runs.',
      '通过调用方回调接管整个释放流程，并接收 `IReleaseContext`。返回空值或异步可等待值；抛错和拒绝成为项目错误，优雅与强制回调均不执行。'
    ),
    default: t(
      'Omitted: use the graceful-to-force sequence.',
      '省略时使用优雅释放降级到强制释放的流程。'
    ),
    params: {
      context: t(
        'The executing release owner supplies cancellation, deadline and diagnostics.',
        '执行释放的所有者提供取消信号、截止时刻与诊断通道。'
      )
    },
    returns: t(
      'Void or a thenable completing the entire custom release.',
      '空值或表示整个自定义释放完成的异步可等待值。'
    ),
    example: `const scope = createLifecycleScope()
scope.own({}, { force: () => undefined, custom: async () => { await Promise.resolve() } })
await scope.dispose()`
  }
}

/** Error-code explanations use the registry semantics, including codes used only in reasons. */
const errorCodeValues = {
  delayFailed: t(
    'Delay registration, scheduling or cleanup failed; retain the original cause before retrying.',
    '等待过程登记、排程或清理失败；重试前检查保留的原始错误。'
  ),
  scopeClosed: t(
    'A closing scope rejects ownership, or its closing signal carries this cancellation reason.',
    '关闭中的作用域拒绝接管资源，或关闭信号以此错误作为取消原因。'
  ),
  scopeTerminal: t(
    'A terminal owner rejects further registration; construct a new owner.',
    '终止的所有者拒绝继续登记；需要重新创建所有者。'
  ),
  scopeReentrantDispose: t(
    'A disposer tries to dispose or join its own releasing scope; move that action outside release.',
    '释放回调尝试释放或等待自身所属作用域；应把此操作移到释放流程之外。'
  ),
  scopeReentrantOwn: t(
    'A release callback tries to register new resources with its active owner, or reenters ledger admission.',
    '释放回调尝试向正在释放的所有者登记资源，或重入释放账本的接纳操作。'
  ),
  scopeSyncViolation: t(
    'A sync descriptor lacks `syncSafe: true`, owns an async scope or returns a thenable.',
    '同步描述器缺少 `syncSafe: true`、拥有异步作用域，或回调返回异步可等待值。'
  ),
  scopeDisposalFailed: t(
    'Several release failures are exposed by an `AggregateError`; inspect every original in `errors`.',
    '多个释放错误通过 `AggregateError` 交付；在 `errors` 中检查各个原始错误。'
  ),
  unitStartFailed: t(
    'A lifecycle unit start throws or rejects; retained for the unit start boundary rather than scope ownership.',
    '生命周期单元启动抛错或拒绝；用于单元启动边界，不代表作用域登记失败。'
  ),
  generationSuperseded: t(
    'A newer generation replaces the active request, or stale adoption reports a discarded result.',
    '新世代替换当前请求，或接纳过期结果时报告该结果已被舍弃。'
  ),
  generationCancellationFailed: t(
    'Generation cancellation or completion cleanup failed after token invalidation; inspect retained causes.',
    '世代取消或完成时的清理失败；令牌已先失效，应检查保留的原因链。'
  ),
  generationDisposed: t(
    'A disposed controller rejects `begin()`; also identifies a disposed unit’s generation cancellation.',
    '已释放的控制器拒绝 `begin()`；也标识单元释放导致的世代取消。'
  ),
  generationTimedOut: t(
    'The per-generation timeout expires and aborts its signal; create a fresh request to retry.',
    '世代独立预算到期并中止信号；重试时需要创建全新请求。'
  ),
  quiescenceSealed: t(
    'A sealed key rejects a new retain; finish admission before sealing.',
    '已封闭的键拒绝新增租约；应在封闭前完成全部登记。'
  ),
  quiescenceUnsealedWait: t(
    'Strict zero waiting ran before sealing and throws synchronously; seal first or use the loose wait.',
    '严格归零等待在封闭前调用并同步抛错；先封闭或改用非独占等待。'
  ),
  provisionalSettled: t(
    'A provisional scope was reused after commit or rollback, or its signal reports that settlement.',
    '临时作用域在提交或回滚后被重复使用，或其信号报告此次结算。'
  ),
  provisionalParentClosed: t(
    'Commit target refused ownership as closed or terminal; uncompensated resources are released before rejection.',
    '提交目标因关闭或终止拒绝接管；未转交资源会在拒绝完成前释放。'
  ),
  queueAdmissionTimeout: t(
    'A queued task exceeded its caller-selected admission budget and was removed without running.',
    '排队任务超过调用方指定的接纳预算，被移出队列且不执行。'
  ),
  queueSelfDependency: t(
    'A task submits work with the currently running owner label; the successor is rejected to prevent self-wait.',
    '提交任务的所有者标签与正在运行的任务相同；后继任务被拒绝以避免自等待。'
  ),
  releaseForceFailed: t(
    'Forced release throws or rejects; the diagnostic retains the original resource failure as cause.',
    '强制释放抛错或拒绝；诊断通过原因链保留原始资源错误。'
  ),
  deadlineExceeded: t(
    'Graceful work exceeded its budget or began after the shared deadline; this is a diagnostic.',
    '优雅工作超过自身预算或在共享截止时刻后开始；此码用于诊断报告。'
  ),
  envUnsupported: t(
    'The host lacks a compliant native `AbortController`; use a supported execution realm.',
    '宿主缺少符合要求的原生 `AbortController`；应使用受支持的执行环境。'
  ),
  invalidOption: t(
    'A scheduler, descriptor, delay, cleanup result or required reporter violates its boundary contract.',
    '调度器、描述器、延迟、清理结果或必需上报回调不符合入口契约。'
  )
}

/** Stable diagnostic texts are documented by scenario rather than translated literal strings. */
const errorTextValues = {
  delayFailed: t(
    'Fallback message for a delay failure whose original value needs a coded wrapper.',
    '延迟失败的原始值需要带码包装时使用的后备提示。'
  ),
  waitCleanupReporterInvalid: t(
    'Reports a wait-cleanup reporter that is present but not callable.',
    '等待清理上报字段已提供但不可调用时使用的提示。'
  ),
  provisionalCleanupFailed: t(
    'Names the provisional cleanup boundary when secondary failures are attached.',
    '临时所有权清理附加次要错误时标记所属边界。'
  ),
  disposeTransactionFailed: t(
    'Aggregate release message supplied when the transaction finalizes several failures.',
    '事务结束并聚合多个释放失败时提供的稳定提示。'
  ),
  scopeReentrantDispose: t(
    'Explains the forbidden attempt to join the scope currently waiting for its disposer.',
    '说明释放回调禁止等待当前正等待它完成的作用域。'
  ),
  disposeDescriptorInvalid: t(
    'Identifies admission failure of a release descriptor or ledger callback shape.',
    '标识释放描述器或账本回调形状无法接纳的失败。'
  ),
  cleanupResultInvalid: t(
    'Reports a cleanup observation without the required `cleanupErrors` array.',
    '清理观察结果缺少必需的 `cleanupErrors` 数组时报告。'
  ),
  syncGracefulOverBudget: t(
    'Diagnostic only: synchronous graceful release returned after its deadline but still succeeded.',
    '仅用于诊断：同步优雅释放在截止后返回，但仍算成功。'
  ),
  mutationAdmissionTimedOut: t(
    'Fallback message for a queued admission timeout or its cleanup attribution.',
    '排队接纳超时或相关清理错误归因时的后备提示。'
  ),
  generationCancellationFailed: t(
    'Labels failed generation cancellation or completion cleanup while retaining original causes.',
    '标记世代取消或完成清理失败，同时保留原始原因。'
  ),
  disposalLedgerClosed: t(
    'Explains why a sealed ledger no longer accepts a new item callback.',
    '说明已封闭的释放账本不再接纳新的项目回调。'
  ),
  disposalLedgerReentrant: t(
    'Explains an admission or sealing attempt made inside the active ledger callback.',
    '说明在账本当前项目回调内发生了登记或封闭重入。'
  ),
  envUnsupported: t(
    'Describes missing native host cancellation support required at construction.',
    '描述构造时缺少本包必需的宿主原生取消能力。'
  ),
  abortSignalInvalid: t(
    'Describes a cancellation signal without callable listener registration and removal methods.',
    '描述取消信号缺少可调用的监听登记或移除方法。'
  ),
  schedulerTaskCancelGetterFailed: t(
    'Describes a scheduled handle whose cancel accessor throws during admission.',
    '描述已排程句柄的取消方法访问器在接纳时抛错。'
  ),
  schedulerTaskInvalid: t(
    'Describes an invalid task handle returned by an injected scheduler.',
    '描述注入调度器返回的任务句柄不符合有效契约。'
  ),
  schedulerAccessorFailed: t(
    'Describes a thrown getter while capturing the selected scheduler or its methods.',
    '描述捕获所选调度器或其方法时访问器抛错。'
  ),
  schedulerDeferInvalid: t(
    'Explains why an optional scheduler defer property must be callable when supplied.',
    '说明可选调度器延后方法一旦提供就必须可调用。'
  ),
  schedulerInvalid: t(
    'Explains that the scheduler requires callable clock and scheduling methods.',
    '说明调度器必须提供可调用的时钟与排程方法。'
  ),
  schedulerNumberType: t(
    'Describes a time or delay value whose runtime type is not numeric.',
    '描述时间或延迟值的运行时类型不是数字的情况。'
  ),
  schedulerNumberRange: t(
    'Describes a numeric time or delay that is not finite.',
    '描述数字形式的时间或延迟不是有限数值的情况。'
  ),
  schedulerDelayRange: t(
    'Describes a delay whose finite numeric value is negative.',
    '描述延迟虽然是有限数值但小于零的情况。'
  ),
  schedulerTimeOverflow: t(
    'Describes addition that would make a scheduler time infinite.',
    '描述调度器时间相加后溢出为无穷值的情况。'
  ),
  errorPolicyReporterMissing: t(
    'Explains the missing reporter for report or first-error release policies.',
    '说明上报或首错释放策略缺少必需的上报回调。'
  ),
  generationSupersededReason: t(
    'Cancellation reason text when a new begin replaces the current generation.',
    '新的启动调用替换当前世代时使用的取消原因提示。'
  ),
  generationTimedOutReason: t(
    'Cancellation reason text when the current generation’s timeout budget expires.',
    '当前世代的独立超时预算耗尽时使用的取消原因提示。'
  ),
  unitDisposedReason: t(
    'Cancellation reason text when disposal terminates a lifecycle unit’s active request.',
    '释放操作终止生命周期单元当前请求时的取消原因提示。'
  ),
  scopeClosedReason: t(
    'Cancellation reason text delivered to owned release callbacks by scope closure.',
    '作用域关闭时传给其释放回调的取消原因提示。'
  ),
  provisionalRolledBackReason: t(
    'Cancellation reason text when a provisional scope chooses rollback.',
    '临时作用域选择回滚并中止信号时的原因提示。'
  ),
  provisionalCommittedReason: t(
    'Cancellation reason text when provisional resources commit to their permanent owner.',
    '临时资源提交到永久所有者并中止临时信号时的原因提示。'
  ),
  quiescenceSealed: t(
    'Explains a new lease request rejected by a sealed key.',
    '说明新增租约请求因目标键已封闭而被拒绝。'
  ),
  quiescenceUnsealedWait: t(
    'Explains the seal prerequisite for strict zero waiting and points to the loose alternative.',
    '说明严格归零等待必须先封闭，并指向非独占等待方式。'
  ),
  provisionalSettled: t(
    'Explains provisional use after commit or rollback has already settled ownership.',
    '说明临时所有权已经提交或回滚后仍被继续使用。'
  ),
  provisionalParentClosed: t(
    'Explains a failed commit whose parent refused ownership after closing.',
    '说明提交因父级关闭后拒绝接管所有权而失败。'
  ),
  unitStartFailed: t(
    'Labels the original failure of a lifecycle unit’s start operation.',
    '标记生命周期单元启动操作对应的原始失败。'
  ),
  unitTerminal: t(
    'Explains refusal of new work by a terminal lifecycle unit.',
    '说明终止状态的生命周期单元拒绝新的工作。'
  ),
  unitClosing: t(
    'Explains refusal of new work by a closing lifecycle unit.',
    '说明关闭中的生命周期单元拒绝新的工作。'
  ),
  generationDisposed: t(
    'Explains why a disposed generation controller cannot begin again.',
    '说明已经释放的世代控制器无法再次启动请求。'
  ),
  generationSupersededBeforeAdopt: t(
    'Diagnostic text when adoption discards a result from a stale token.',
    '接纳操作舍弃过期令牌结果时使用的诊断提示。'
  ),
  sharedDeadlinePassed: t(
    'Diagnostic text when asynchronous graceful work cannot wait beyond the exhausted shared deadline.',
    '共享截止时刻已过，异步优雅工作无法继续等待时的诊断提示。'
  ),
  releaseForceFailed: t(
    'Diagnostic text when unconditional forced teardown fails.',
    '无条件强制清理发生失败时使用的诊断提示。'
  ),
  syncCallbackReturnedThenable: t(
    'Explains that a declared synchronous disposer returned an unsupported thenable.',
    '说明声明为同步的释放回调返回了不受支持的异步可等待值。'
  ),
  scopeTerminal: t(
    'Explains ownership refusal by an irreversibly terminal scope.',
    '说明作用域已不可逆地终止，因此拒绝接管资源。'
  ),
  scopeClosing: t(
    'Explains ownership refusal by a scope whose admission is already closed.',
    '说明作用域已关闭登记入口，因此拒绝接管资源。'
  ),
  scopeReentrantOwn: t(
    'Explains registration attempted from inside the same scope’s active disposer.',
    '说明同一作用域的当前释放回调尝试再次登记资源。'
  ),
  syncScopeRequiresSyncSafe: t(
    'Explains the required explicit synchronization promise on each sync descriptor.',
    '说明同步描述器必须显式声明同步安全承诺。'
  ),
  syncScopeOwnsAsyncOwner: t(
    'Explains why a synchronous scope rejects asynchronous or provisional scope resources.',
    '说明同步作用域为何拒绝接管异步或临时作用域资源。'
  ),
  syncScopeDisposalFailed: t(
    'Aggregate message when several synchronous releases fail.',
    '同步释放流程中多个清理失败聚合时使用的提示。'
  ),
  generationTimeoutAccessorFailed: t(
    'Explains a getter failure while reading the per-request timeout option.',
    '说明读取每次请求的超时选项时访问器发生失败。'
  )
}

/** Complete bilingual reference, shared by root and leaf entry points. */
export const lifecycleReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Runtime-neutral ownership, cancellation, serial mutation and release primitives. Start with `createLifecycleScope()` for durable resources or `createProvisionalScope()` during setup; choose generations and lease tracking for race-sensitive work.',
        '提供不依赖运行时的所有权、取消、串行变更与释放原语。长期资源从 `createLifecycleScope()` 开始，初始化资源使用 `createProvisionalScope()`；竞争敏感工作可选择世代和租约跟踪。'
      ),
      example: scopeExample
    },
    abort: {
      summary: t(
        'Use this entry to send a cancellation signal and explicitly handle failures from cancellation listeners. Import `@migaia/lifecycle/abort` when you need cancellation without the root entry’s resource scopes and other lifecycle tools.\n\n`createAbortController()` creates a native controller; `observeAbortSubscription()` registers a listener and routes callback or listener-cleanup failures to your failure handler. Cancelling the signal asks cooperating work to stop; it does not release resources owned by a scope.',
        '需要发送取消信号，并明确处理取消监听中的失败时，使用此入口。只需要取消工具、不需要根入口中的资源作用域等功能时，可从 `@migaia/lifecycle/abort` 导入。\n\n`createAbortController()` 创建原生取消控制器；`observeAbortSubscription()` 登记监听，并把回调或移除监听时的失败交给你提供的处理函数。信号取消只是通知会响应它的工作停止，不会代替作用域释放资源。'
      ),
      example: abortExample
    },
    disposal: {
      summary: t(
        'Use this entry when you already have cleanup callbacks and need to control how they run. Import `@migaia/lifecycle/disposal` for release execution rather than the root collection of lifecycle tools.\n\n`createDisposeTransaction()` runs a release plan in sequence; `createSyncStartedDisposalLedger()` starts each registered callback immediately and tracks its later completion. Unlike a scope, these tools execute caller-supplied cleanup work rather than collecting resources throughout their lifetime.',
        '已经有清理回调，需要控制它们如何执行时，使用此入口。专门执行释放流程时，可从 `@migaia/lifecycle/disposal` 导入，不必从汇集多类生命周期工具的根入口选择。\n\n`createDisposeTransaction()` 按顺序执行释放计划；`createSyncStartedDisposalLedger()` 立即启动每个登记的回调，并跟踪其后续完成情况。这些工具执行你提供的清理工作；若要在整个使用期间陆续登记资源，应使用作用域入口。'
      ),
      example: transactionExample
    },
    errors: {
      summary: t(
        'Use this entry when several cleanup failures need one consistent return, throw, or reporting policy. Import `@migaia/lifecycle/errors` for lifecycle error handling rather than the root collection of ownership and timing tools.\n\n`createErrorCollector()` creates a collector whose `add()` records failures and whose `finalize()` applies the chosen policy. It preserves existing package error identities; collecting failures does not execute the cleanup callbacks themselves.',
        '多个清理步骤失败后，需要统一决定返回、抛出还是报告错误时，使用此入口。专门处理生命周期错误时，可从 `@migaia/lifecycle/errors` 导入，不必从根入口选择资源管理与计时工具。\n\n`createErrorCollector()` 创建收集器，通过 `add()` 记录失败，再由 `finalize()` 应用选定策略。已有的包级错误标识会被保留；收集错误本身不会执行清理回调。'
      ),
      example: `import { createErrorCollector } from '@migaia/lifecycle/errors'
const collector = createErrorCollector('collect', undefined)
collector.add('connection', new Error('connection failed'))
console.log(collector.finalize('cleanup failed'))`
    },
    generation: {
      summary: t(
        'Use this entry when a newer asynchronous request must prevent an older result from taking its place. Import `@migaia/lifecycle/generation` for this latest-request rule rather than the root collection of resource and cleanup tools.\n\n`createGenerationController()` manages one current request; its `begin()` returns a token, an object that identifies that request, and a cancellation signal. Before accepting a result, pass its token to `adopt()`: it keeps a current result or calls your release function for a stale result. The controller decides which result is current; your code still performs the request and responds to cancellation.',
        '异步请求可能先发后至，旧结果不应覆盖新请求的结果时，使用此入口。只需要这条“以最新请求为准”的规则时，可从 `@migaia/lifecycle/generation` 导入，不必从根入口选择资源与清理工具。\n\n`createGenerationController()` 管理当前请求，调用其 `begin()` 会得到标记该请求的令牌对象与取消信号。接收结果前把令牌交给 `adopt()`：结果仍属当前请求就保留，否则调用你提供的函数释放旧结果。控制器只判断结果是否仍有效，请求执行和响应取消仍由你的代码负责。'
      ),
      example: generationExample
    },
    quiescence: {
      summary: t(
        'Use this entry to wait until all users of a resource have finished before releasing it. Choose `@migaia/lifecycle/quiescence` for usage counting rather than the root collection of lifecycle tools.\n\n`createQuiescenceTracker()` tracks a count for each object: `retain()` adds a user and returns the function that releases that count. Seal the object against new users before awaiting `whenZero()`; use `createPendingTracker()` when you only need to track and drain Promises. Reaching zero does not release the underlying resource for you.',
        '释放资源前，需要等所有使用者结束时，使用此入口。专门统计使用情况时，可从 `@migaia/lifecycle/quiescence` 导入，不必从汇集多类生命周期工具的根入口选择。\n\n`createQuiescenceTracker()` 为每个对象计数：`retain()` 增加一个使用者，并返回归还这次计数的函数。先用 `seal()` 拒绝新使用者，再等待 `whenZero()`；若只需跟踪和等待异步任务结束，可用 `createPendingTracker()`。计数归零不会替你释放底层资源。'
      ),
      example: leaseExample
    },
    scheduler: {
      summary: t(
        'Use this entry when accepting a caller-supplied clock and timer implementation into lifecycle code. Import `@migaia/lifecycle/scheduler` for this validation boundary rather than the root collection of lifecycle tools.\n\n`resolveScheduler()` validates and captures the supplied scheduler’s methods; `resolveSchedulerOption()` handles an optional scheduler. These functions keep lifecycle failures identifiable; normal timer implementations come from `@migaia/utils/scheduler`, and manual time controls come from `@migaia/utils/testing`.',
        '生命周期代码需要接收调用方提供的时钟和定时器实现时，使用此入口。专门检查并接入调度器时，可从 `@migaia/lifecycle/scheduler` 导入，不必从根入口选择其他生命周期工具。\n\n`resolveScheduler()` 检查并保存所提供调度器的方法；`resolveSchedulerOption()` 处理可省略的调度器选项。这些函数让相关失败保留生命周期错误标识；正常计时器实现来自 `@migaia/utils/scheduler`，手动时间控制来自 `@migaia/utils/testing`。'
      ),
      example: `import { resolveScheduler } from '@migaia/lifecycle/scheduler'
import { systemScheduler } from '@migaia/utils/scheduler'
const scheduler = resolveScheduler(systemScheduler)
console.log(scheduler.now())`
    },
    scope: {
      summary: t(
        'Use this entry when several resources belong to one owner and must be released when that owner ends. Choose `@migaia/lifecycle/scope` for asynchronous resource ownership rather than the root collection of lifecycle tools.\n\n`createLifecycleScope()` creates the owner; register each resource with `own()` and an explicit release callback. `close()` stops new registrations, while awaiting `dispose()` performs cleanup; closing alone does not release anything. For directly executing an existing cleanup plan, use the disposal entry.',
        '多个资源属于同一个使用方，需要随它结束而统一释放时，使用此入口。专门管理异步资源所有权时，可从 `@migaia/lifecycle/scope` 导入，不必从根入口选择其他生命周期工具。\n\n`createLifecycleScope()` 创建资源所有者，用 `own()` 登记资源及明确的释放回调。`close()` 只停止新登记，等待 `dispose()` 才会执行清理，单独关闭不会释放资源。如果已经有完整清理计划、只需直接执行，应使用释放入口。'
      ),
      example: scopeExample
    }
  },
  symbols: {
    abortableDelay: {
      role: 'operation',
      purpose: t(
        'Waits a finite nonnegative duration while observing an optional cancellation signal. The timer and listener are owned by this call and cleaned before settlement; cancellation is a boolean outcome rather than an exception.',
        '在观察可选取消信号的同时等待有限非负时长。本次调用持有定时器和监听者，并在结算前清理；取消通过布尔结果表达，不作为异常抛出。'
      ),
      params: {
        scheduler: t(
          'Caller-selected `IScheduler` from `@migaia/utils/scheduler`; supply an admitted scheduler when injecting external methods.',
          '调用方从 `@migaia/utils/scheduler` 选择的 `IScheduler`；注入外部方法时应提供已经接纳的调度器。'
        ),
        ms: t(
          'Finite nonnegative delay in milliseconds, chosen by the caller; invalid values throw `INVALID_OPTION` before registration.',
          '调用方指定的有限非负毫秒延迟；不合法时在登记前抛 `INVALID_OPTION`。'
        ),
        signal: t(
          'An `IAbortSignal` from a controller or parent operation, or `undefined` for no cancellation. An already-aborted signal returns false without scheduling.',
          '来自控制器或父操作的 `IAbortSignal`；传 `undefined` 表示不取消。已中止的信号直接返回假值，不创建定时器。'
        ),
        reportCleanup: t(
          'Optional synchronous `(error) => void` sink receiving coded cleanup failures. Return no value; throws and rejections are contained. Omitted cleanup failures reject the wait.',
          '可选同步 `(error) => void` 回调，接收带码的清理错误。不使用返回值；抛错与拒绝被隔离。省略时清理错误会使等待拒绝。'
        )
      },
      returns: t(
        '`Promise<boolean>`: true for elapsed duration, false for cancellation. Admission or unreported cleanup failure rejects with `DELAY_FAILED` while retaining the original cause.',
        '`Promise<boolean>`：时长届满为真，取消为假。登记或未上报的清理失败以 `DELAY_FAILED` 拒绝，并保留原始原因。'
      ),
      example: `import { abortableDelay, createAbortController } from '@migaia/lifecycle'
import { systemScheduler } from '@migaia/utils/scheduler'
const controller = createAbortController()
const wait = abortableDelay(systemScheduler, 100, controller.signal)
controller.abort()
console.log(await wait)`
    },
    boundedWait: {
      role: 'operation',
      cases: lifecycleCases.boundedWait,
      purpose: t(
        'Observes one task until an existing absolute deadline without cancelling that task. A task rejection before timeout stays primary even if timer cancellation fails: secondary cleanup is attached through cause/errors. Synchronous timer completion waits for its handle before settling, cancels once, and applies the same cleanup policy. Late rejection remains observed.',
        '观察一个任务直到既有绝对截止时刻，不取消任务本身。超时前任务拒绝保持主因，计时器取消失败通过原因或错误列表附加。同步计时器回调等待句柄返回后才结算，取消一次并遵守相同清理策略；迟到拒绝仍被观察。'
      ),
      params: {
        task: t(
          'Caller-owned `PromiseLike<unknown>` from the operation being bounded; this helper never cancels it.',
          '来自被限制操作、由调用方持有的 `PromiseLike<unknown>`；此函数不会取消它。'
        ),
        deadlineAt: t(
          'Finite absolute deadline derived from the selected scheduler’s `now()`, in that same clock domain.',
          '由所选调度器 `now()` 推导的有限绝对截止时刻，必须采用相同时钟。'
        ),
        options: t(
          'Optional scheduler and cleanup-reporter fields described below; omission uses the system clock and rejects cleanup failures.',
          '可选调度器和清理上报字段，含义见下方；省略时使用系统时钟，清理失败会拒绝。'
        )
      },
      optionDocs: {
        scheduler: schedulerOption,
        reportCleanup: {
          ...reportOption,
          summary: t(
            'Receives the raw timer-cancellation `error`; return void synchronously. Reporter throws and rejections are contained so the original task/deadline winner remains the result.',
            '接收定时器取消时的原始 `error`，应同步返回空值。上报回调抛错和拒绝被隔离，因此仍保留任务与截止时刻的原有胜出结果。'
          ),
          default: t(
            'Omitted: timer cancellation failure rejects the wait.',
            '省略时定时器取消失败会使等待拒绝。'
          )
        }
      },
      returns: t(
        'A promise resolving true for task fulfillment or false for timeout; an already passed deadline returns false. Task and scheduler failures can reject without replacing their original identity.',
        '任务成功则为真、超时则为假的异步结果；截止时刻已过直接为假。任务和调度器错误可导致拒绝，并保留原始身份。'
      ),
      example: `import { boundedWait } from '@migaia/lifecycle'
import { systemScheduler } from '@migaia/utils/scheduler'
console.log(await boundedWait(Promise.resolve(), systemScheduler.now() + 100))`
    },
    createLifecycleScope: {
      role: 'factory',
      cases: lifecycleCases.createLifecycleScope,
      purpose: t(
        'Creates an asynchronous resource owner with explicit release descriptors, descending release priority and reverse-registration tie order. Closing stops admission; disposal releases resources and always converges to terminal state.',
        '创建使用显式释放描述器的异步资源所有者，按优先级降序释放，同优先级按登记逆序释放。关闭停止登记，释放执行清理并最终进入终止状态。'
      ),
      options: 'ILifecycleScopeOptions',
      returns: t(
        'An `ILifecycleScope`; repeated external disposal calls return the same promise. Invalid scheduler or a required missing reporter throws `INVALID_OPTION`.',
        '一个 `ILifecycleScope`；重复外部释放调用返回相同异步结果。调度器不合法或缺少必需上报回调时抛 `INVALID_OPTION`。'
      ),
      example: scopeExample
    },
    createSyncLifecycleScope: {
      role: 'factory',
      purpose: t(
        'Creates a resource owner whose release is fully synchronous. It accepts only explicit `syncSafe: true` descriptors and rejects asynchronous or provisional scope resources; accidental thenables produce synchronous `SCOPE_SYNC_VIOLATION`, with their captured then read once and late rejection sent to `report`, or the shared utils host exception queue without a reporter.',
        '创建释放过程完全同步的资源所有者。只接纳显式 `syncSafe: true` 描述器，拒绝异步或临时作用域资源；意外返回异步可等待值时同步产生 `SCOPE_SYNC_VIOLATION`，异步入口只读取一次；迟到拒绝交 `report`，缺省交工具包共享宿主异常队列。'
      ),
      options: 'ISyncLifecycleScopeOptions',
      returns: t(
        'An `ISyncLifecycleScope` supporting synchronous disposal and `Symbol.dispose` when available; a missing required reporter throws `INVALID_OPTION`.',
        '一个 `ISyncLifecycleScope`，支持同步释放以及宿主可用时的 `Symbol.dispose`；缺少必需上报回调时抛 `INVALID_OPTION`。'
      ),
      example: syncScopeExample
    },
    createProvisionalScope: {
      role: 'factory',
      cases: lifecycleCases.createProvisionalScope,
      purpose: t(
        'Accumulates setup resources until the caller chooses commit or rollback. Listener-detach failures enter settlement without skipping remaining cleanup. Pair with `createLifecycleScope()` for a permanent parent: transfer preserves the committed prefix and awaits compensation of every untransferred resource on failure.',
        '在调用方选择提交或回滚前累积初始化资源；移除监听失败进入结算，不跳过剩余清理。搭配 `createLifecycleScope()` 建立永久父级：转交失败时保留已提交前缀，并等待全部未转交资源完成补偿释放。'
      ),
      options: 'IProvisionalScopeOptions',
      returns: t(
        'An `IProvisionalScope` owning a native abort signal. Commit and rollback are alternative terminal actions; parent-listener detach failures join settlement while every resource still receives cleanup. Listener setup or missing host support can fail construction.',
        '一个持有原生中止信号的 `IProvisionalScope`。提交与回滚互斥；父监听移除失败进入结算，仍清理全部资源。监听初始化或宿主能力缺失可使构造失败。'
      ),
      example: provisionalExample
    },
    createTerminalController: {
      role: 'factory',
      purpose: t(
        'Creates the survival-state axis without owning resources or running cleanup. The caller explicitly closes admission and marks terminal when its independently owned work has finished.',
        '创建存续状态轴，本身不持有资源或执行清理。调用方显式关闭登记入口，并在自身负责的工作完成后标记终止。'
      ),
      returns: t(
        'An `ITerminalController` initially open; its terminal promise is retained across repeated waits.',
        '初始开放的 `ITerminalController`；多次等待保留同一个终止异步结果。'
      ),
      example: `const terminal = createTerminalController()
const done = terminal.whenTerminal()
terminal.close()
terminal.forceTerminal()
await done`
    },
    createGenerationController: {
      role: 'factory',
      cases: lifecycleCases.createGenerationController,
      purpose: t(
        'Keeps one active result generation with identity tokens, optional timeout and parent cancellation. Pair `begin()` with `adopt()` or `isCurrent()` before accepting asynchronous results, then complete or dispose the active generation.',
        '通过身份令牌、可选超时和父级取消维护单个有效结果世代。搭配 `begin()` 与 `adopt()` 或 `isCurrent()` 判断异步结果是否可接纳，再完成或释放当前世代。'
      ),
      options: 'IGenerationControllerOptions',
      returns: t(
        'An `IGenerationController` whose generation starts at zero. Invalid schedulers and unsupported native cancellation fail construction.',
        '世代编号初始为零的 `IGenerationController`。调度器不合法或缺少原生取消能力时构造失败。'
      ),
      example: generationExample
    },
    createQuiescenceTracker: {
      role: 'factory',
      purpose: t(
        'Counts active leases by caller-owned object identity using weak-key storage. Pair `retain()` with its returned release function; seal admission before a strict zero-count wait.',
        '通过弱键存储按调用方对象身份统计有效租约。搭配 `retain()` 与它返回的释放函数管理计数；严格等待归零前必须先封闭登记入口。'
      ),
      returns: t(
        'An `IQuiescenceTracker<TKey>` with no global dispose; object keys can be reclaimed once unreachable.',
        '一个无需整体释放的 `IQuiescenceTracker<TKey>`；对象键不可达后可被回收。'
      ),
      example: leaseExample
    },
    createObjectLeaseRegistry: {
      role: 'factory',
      purpose: t(
        'Creates the object-keyed lease vocabulary over the same engine as quiescence tracking. Callers choose object identities and explicitly retain, release, seal and wait without polling counts.',
        '以租约命名暴露与静默跟踪相同的对象键引擎。调用方选择对象身份，显式登记、释放、封闭和等待，无需轮询数量。'
      ),
      returns: t(
        'An `ILeaseRegistry<TKey>` backed by weak object keys; methods preserve tracker semantics.',
        '使用弱对象键的 `ILeaseRegistry<TKey>`；所有方法保持跟踪器语义。'
      ),
      example: `const registry = createObjectLeaseRegistry<object>()
const key = {}
const release = registry.retain(key)
registry.seal(key)
release()
await registry.whenZero(key)`
    },
    createStringLeaseRegistry: {
      role: 'factory',
      purpose: t(
        'Creates lease tracking for caller-selected strings using map storage. Unsealed idle entries are pruned automatically; sealed entries retain their admission fence until explicitly forgotten.',
        '通过映射存储为调用方指定的字符串跟踪租约。未封闭的空闲状态自动删除；已封闭状态保留登记屏障，直到被显式遗忘。'
      ),
      returns: t(
        'An `ILeaseRegistry<string>`; return each retained lease with its idempotent disposer.',
        '一个 `ILeaseRegistry<string>`；通过幂等释放函数归还每个已登记租约。'
      ),
      example: `const registry = createStringLeaseRegistry()
const release = registry.retain('connection')
registry.seal('connection')
release()
await registry.whenZero('connection')
registry.forget('connection')`
    },
    createPendingTracker: {
      role: 'factory',
      cases: lifecycleCases.createPendingTracker,
      purpose: t(
        'Tracks in-flight promises without exposing lease keys or sealing to domain callers. Settlement automatically decrements the count, and draining rechecks work that arrived while an earlier wait was pending.',
        '跟踪未完成异步工作，不向领域调用方暴露租约键或封闭操作。异步结果结算后自动减少数量，排空会再次检查等待期间新增的工作。'
      ),
      returns: t(
        'An `IPendingTracker`; `track()` preserves the original promise and `drain()` does not cancel or propagate tracked rejections.',
        '一个 `IPendingTracker`；`track()` 保留原异步结果，`drain()` 不取消任务，也不转交被跟踪任务的拒绝。'
      ),
      example: `const tracker = createPendingTracker()
const task = tracker.track(Promise.resolve(1))
console.log(await task)
await tracker.drain()`
    },
    createMutationQueue: {
      role: 'factory',
      cases: lifecycleCases.createMutationQueue,
      purpose: t(
        'Serializes caller-authored mutations in submission order. Only waiting tasks receive an admission timer; the current task is never interrupted, and a labeled same-owner submission is rejected to avoid a self-dependent successor.',
        '按提交顺序串行执行调用方变更。只有排队任务接收接纳定时器，当前任务不会被中断；与运行任务相同所有者标签的提交会被拒绝，以避免自依赖后继。'
      ),
      options: 'IMutationQueueOptions',
      returns: t(
        'An `IMutationQueue`; tasks settle independently and a failed task does not stop later submissions.',
        '一个 `IMutationQueue`；任务独立结算，单个失败不会阻止后续提交。'
      ),
      example: queueExample
    },
    createAbortController: {
      role: 'factory',
      purpose: t(
        'Constructs an actual host-native abort controller in the current realm. Pair with `observeAbortSubscription()` when cancellation consumers need a failure sink and explicit listener cleanup.',
        '在当前执行环境构造真实宿主原生中止控制器。搭配 `observeAbortSubscription()` 可为取消消费方提供错误接收通道和显式监听清理。'
      ),
      returns: t(
        'An `IAbortController` whose signal is native; unavailable or noncompliant host support throws `ENV_UNSUPPORTED`.',
        '信号为原生对象的 `IAbortController`；宿主能力缺失或不合规时抛 `ENV_UNSUPPORTED`。'
      ),
      example: abortExample
    },
    observeAbortSubscription: {
      role: 'factory',
      purpose: t(
        'Owns one abort subscription using captured listener methods and an immediate post-registration state check. Delivery happens at most once; callback and removal failures go to the owner rather than native event dispatch.',
        '使用捕获的监听方法和登记后立即复查的信号状态，持有一条中止订阅。最多交付一次原因；回调与移除错误传给所有者，不穿透原生事件派发。'
      ),
      params: {
        signal: t(
          'An `IAbortSignal` from a controller or parent operation, with callable add/remove listener methods; already-aborted sources are delivered immediately.',
          '来自控制器或父操作的 `IAbortSignal`，必须具有可调用的增删监听方法；已中止信号立即交付。'
        ),
        callback: t(
          'Synchronous `(reason) => void`; reason comes from `signal.reason`, or its getter failure. Its return is ignored and synchronous throws go to `onFailure`; returned promises are not observed here.',
          '同步 `(reason) => void` 回调；原因来自 `signal.reason`，访问器失败则收到该错误。不使用返回值，同步抛错转给 `onFailure`；此处不观察返回的异步结果。'
        ),
        onFailure: t(
          'Synchronous `(error) => void` owner sink for callback, reason-access and listener-removal failures. Its return is ignored and synchronous sink throws are contained.',
          '同步 `(error) => void` 所有者回调，接收业务回调、原因访问和监听移除错误。不使用返回值，上报回调的同步抛错被隔离。'
        )
      },
      returns: t(
        'An `IObservedAbortSubscription` for explicit idempotent unsubscription and registration-cleanup retry. Invalid listener methods throw `INVALID_OPTION`; registration failures retain their original identity.',
        '一个 `IObservedAbortSubscription`，提供显式幂等取消订阅与登记清理重试。监听方法不合法时抛 `INVALID_OPTION`；登记错误保留原始身份。'
      ),
      example: abortExample
    },
    createDisposeTransaction: {
      role: 'factory',
      purpose: t(
        'Builds a reusable sequential release executor with one fixed ordering mode and error policy. Every run admits all descriptors before invoking callbacks, releases valid items despite other failures, then drains optional pending work.',
        '创建排序模式和错误策略固定、可重复运行的顺序释放执行器。每次运行先接纳全部描述器再调用回调，其他项目失败时仍释放有效项目，最后排空可选未完成工作。'
      ),
      params: {
        mode: t(
          'Caller-authored `IDisposeTransactionMode`: `order` stably sorts descending priorities; `plan` preserves the supplied sequence and never reads priorities.',
          '调用方编写的 `IDisposeTransactionMode`：`order` 按优先级稳定降序排序；`plan` 保留输入顺序且不读取优先级。'
        )
      },
      options: 'IDisposeTransactionOptions',
      returns: t(
        'An `IDisposeTransaction`; missing required reporters and invalid schedulers fail construction with `INVALID_OPTION`.',
        '一个 `IDisposeTransaction`；缺少必需上报回调或调度器不合法时，构造抛 `INVALID_OPTION`。'
      ),
      example: transactionExample
    },
    executeReleaseDescriptor: {
      role: 'operation',
      purpose: t(
        'Executes one explicit descriptor independently of a resource owner. Custom release overrides all phases; otherwise graceful success finishes, while failure or timeout degrades to force once without cancelling late graceful work. Even an already-exhausted shared deadline observes started graceful work and sends late rejection to `context.report`.',
        '独立于资源所有者执行一个显式描述器。自定义释放接管全部阶段；否则优雅释放成功即结束，失败或超时执行一次强制释放，不取消迟到的优雅工作；共享截止时间已过也观察已启动工作，并把迟到拒绝交 `context.report`。'
      ),
      params: {
        descriptor: t(
          'Caller-authored `IReleaseDescriptor`; `force` remains required even if `custom` takes over. Order is ignored on this single-item path.',
          '调用方编写的 `IReleaseDescriptor`；即使 `custom` 接管也必须提供 `force`。单项目执行忽略优先级。'
        ),
        context: t(
          'Caller-authored `IReleaseContext` with an external signal, shared deadline and reporter. Scheduler and deadline must use one clock domain.',
          '调用方编写的 `IReleaseContext`，包含外部信号、共享截止时刻和上报回调。调度器与截止时刻必须采用相同时钟。'
        )
      },
      returns: t(
        'A promise of original item failures, empty on success. Descriptor admission errors are returned in the list; invalid context access or deadline can reject.',
        '原始项目错误列表的异步结果，成功时为空。描述器接纳错误进入列表；上下文访问或截止时刻不合法可导致拒绝。'
      ),
      example: `const controller = createAbortController()
const errors = await executeReleaseDescriptor(
  { force: () => undefined },
  { signal: controller.signal, deadlineAt: undefined, report: console.error }
)
console.log(errors)`
    },
    createSyncStartedDisposalLedger: {
      role: 'factory',
      purpose: t(
        'Starts each accepted callback synchronously and observes all asynchronous completion without serializing starts. Pair `start()` with `seal()` and await the returned physical completion before treating teardown as finished.',
        '同步启动每个已接纳回调，并观察全部异步完成，不把启动串行化。搭配 `start()` 与 `seal()`，等待返回的物理完成结果后再认定清理结束。'
      ),
      returns: t(
        'An `ISyncStartedDisposalLedger` initially open; the caller supplies item ordering and error projection.',
        '初始开放的 `ISyncStartedDisposalLedger`；调用方负责项目顺序与错误投影。'
      ),
      example: ledgerExample
    },
    mergeCleanupResults: {
      role: 'operation',
      purpose: t(
        'Observes every cleanup result and each later physical-completion continuation. It retains failures in caller branch order and then continuation order, including rejected inputs, so no branch silently loses an error.',
        '观察每个清理结果及其后续物理完成链。按调用方分支顺序、再按后续链顺序保留错误，包括输入拒绝，避免任一分支的错误丢失。'
      ),
      params: {
        values: t(
          'Caller-collected array of `ICleanupResult` objects or promises from ledgers/adapters; each continuation contains only later failures.',
          '调用方从账本或适配器收集的 `ICleanupResult` 对象或异步结果数组；每条后续链只包含之后发生的错误。'
        )
      },
      returns: t(
        'A frozen `ICleanupResult` with a frozen combined `cleanupErrors` array and no pending continuation. A non-array top-level input rejects with `INVALID_OPTION`; malformed branch results become collected failures.',
        '冻结的 `ICleanupResult`，包含冻结的合并 `cleanupErrors`，没有未完成后续链。顶层非数组输入以 `INVALID_OPTION` 拒绝；分支结果不合法则作为错误收集。'
      ),
      example: ledgerExample
    },
    createErrorCollector: {
      role: 'factory',
      purpose: t(
        'Collects release failures by policy. All four policies annotate unclassified native errors with `SCOPE_DISPOSAL_FAILED`, wrap primitives through `cause`, and preserve valid external identity. Multiple throw-policy failures aggregate; reporters cannot replace release results.',
        '收集释放错误并按策略结算。四种策略均为未分类原生失败原位附 `SCOPE_DISPOSAL_FAILED`；原始值通过 `cause` 包装，已有合法外部身份保留。抛错策略多错聚合，上报失败不替换释放结果。'
      ),
      params: {
        policy: t(
          'Value from `LifecycleErrorPolicy`; `report` and `firstError` require a reporter at construction; missing reporters throw `INVALID_OPTION`.',
          '来自 `LifecycleErrorPolicy` 的取值；选择 `report` 或 `firstError` 时必须在构造时提供上报回调，否则抛 `INVALID_OPTION`。'
        ),
        report: t(
          'Synchronous `(error) => void` callback or `undefined`; receives report-policy errors and later first-error failures, ignores its return and contains throws/rejections.',
          '同步 `(error) => void` 回调或 `undefined`；接收上报策略错误与首错策略的后续错误，不使用返回值并隔离抛错及拒绝。'
        )
      },
      returns: t(
        'An `IErrorCollector` retaining failures until finalization; it does not release resources or clear entries on finalize.',
        '一个保留错误直到结算的 `IErrorCollector`；不负责释放资源，结算后也不清空登记。'
      ),
      example: `const collector = createErrorCollector('collect', undefined)
collector.add('connection', new Error('closed'))
console.log(collector.finalize('cleanup failed'))`
    },
    containAsyncRejection: {
      role: 'operation',
      purpose: t(
        'Inspects a callback return through the canonical thenable boundary and observes rejection without awaiting completion. Use for values returned by nominally synchronous hooks that may accidentally be asynchronous.',
        '通过统一异步可等待边界检查回调返回值，不等待完成但观察拒绝。适用于标称同步的钩子可能意外返回异步结果的情况。'
      ),
      params: {
        value: t(
          'The exact return value of a callback, supplied by its caller; ordinary non-thenable values require no observation.',
          '调用方取得的回调原始返回值；普通非异步可等待值不需要观察。'
        ),
        onRejected: t(
          'Synchronous `(error) => void` sink receiving a getter, invocation or rejection failure from the inspected value. Return nothing; the thenable observer contains sink throws.',
          '同步 `(error) => void` 接收回调，取得被检查值的访问器、调用或拒绝错误。应返回空值；观察器会隔离接收回调抛错。'
        )
      },
      returns: t(
        'Returns immediately after attaching rejection observation; it does not expose a completion promise.',
        '附加拒绝观察后立即返回，不提供表示完成的异步结果。'
      ),
      example: `containAsyncRejection(Promise.reject(new Error('failed')), (error) => console.error(error))`
    },
    snapshotScheduler: {
      role: 'operation',
      purpose: t(
        'Captures scheduler accessors once and forwards methods with their original receiver. Returns undefined for a missing scheduler shape, while thrown accessors and invalid optional defer methods produce `INVALID_OPTION`.',
        '单次捕获调度器访问器，并以原接收者转发方法。缺少调度器形状时返回空值；访问器抛错或可选延后方法不合法时产生 `INVALID_OPTION`。'
      ),
      params: {
        value: t(
          'Unknown injection value supplied by the caller, normally an `IScheduler` from `@migaia/utils/scheduler`.',
          '调用方提供的未知注入值，通常为 `@migaia/utils/scheduler` 的 `IScheduler`。'
        )
      },
      returns: t(
        'An `IScheduler` snapshot or undefined. Clock reads require finite numbers, delays finite nonnegative values, and handles callable cancellation. Admitted method and cancel/unref failures receive `INVALID_OPTION`; native type and receiver are preserved where possible, otherwise cause retains the original.',
        '一个 `IScheduler` 快照或空值。时钟读取必须有限、延迟有限非负、句柄提供可调用取消方法。已准入方法及取消或解除引用失败附 `INVALID_OPTION`；尽可能保留原生类型与接收者，否则通过原因保留原错。'
      ),
      example: `import { systemScheduler } from '@migaia/utils/scheduler'
const scheduler = snapshotScheduler(systemScheduler)
console.log(scheduler?.now())`
    },
    resolveScheduler: {
      role: 'operation',
      purpose: t(
        'Requires a valid scheduler snapshot instead of permitting an absent shape. This is the lifecycle injection boundary for callers that must receive usable clock and scheduling methods immediately.',
        '要求有效调度器快照，不允许缺少形状。适用于调用方必须立即取得可用时钟和排程方法的本包注入边界。'
      ),
      params: {
        value: t(
          'Caller-provided unknown scheduler candidate, normally obtained from `@migaia/utils/scheduler`.',
          '调用方提供的未知调度器候选值，通常来自 `@migaia/utils/scheduler`。'
        )
      },
      returns: t(
        'An admitted `IScheduler`; missing shape and validation failures throw `INVALID_OPTION`.',
        '已经接纳的 `IScheduler`；缺少形状或校验失败时抛 `INVALID_OPTION`。'
      ),
      example: `import { systemScheduler } from '@migaia/utils/scheduler'
const scheduler = resolveScheduler(systemScheduler)
console.log(scheduler.now())`
    },
    resolveSchedulerOption: {
      role: 'operation',
      purpose: t(
        'Reads the optional scheduler field once, snapshots a supplied scheduler, and otherwise returns the caller-provided fallback unchanged. Without a fallback it deliberately preserves absence instead of inventing a clock.',
        '单次读取可选调度器字段，为已提供的调度器创建快照，否则原样返回调用方后备值。未提供后备值时保留缺失状态，不自行指定时钟。'
      ),
      params: {
        options: t(
          'Caller-owned object with optional `scheduler`, or null/undefined. Getter failures are `INVALID_OPTION` TypeErrors with the original cause.',
          '调用方持有的可选 `scheduler` 对象，或空对象值。访问器失败会成为带原始原因的 `INVALID_OPTION` 类型错误。'
        ),
        fallback: t(
          'Optional admitted `IScheduler` selected by the caller, used unchanged only when the field is absent.',
          '调用方选择的可选已接纳 `IScheduler`，仅在字段缺失时原样使用。'
        )
      },
      optionDocs: {
        scheduler: {
          ...schedulerOption,
          default: t(
            'Omitted: return the explicit fallback, or undefined when no fallback was supplied.',
            '省略时返回显式后备调度器；未给出后备值则返回空值。'
          )
        }
      },
      returns: t(
        'An admitted selected scheduler, the exact fallback or undefined; invalid supplied shapes throw instead of using fallback.',
        '已接纳的所选调度器、原后备值或空值；已提供形状不合法时抛错，不回退。'
      ),
      example: `import { systemScheduler } from '@migaia/utils/scheduler'
const scheduler = resolveSchedulerOption({}, systemScheduler)
console.log(scheduler.now())`
    },
    LIFECYCLE_SOURCE: {
      role: 'constant',
      purpose: t(
        'Stable source marker stamped onto errors constructed by lifecycle. Check it before interpreting a code because another package can use the same code string for different semantics.',
        '本包构造的错误所携带的稳定来源标记。解释错误码前应先检查来源，因为其他包可能以相同字符串表达不同语义。'
      ),
      example: `if (error.source === LIFECYCLE_SOURCE) console.log(error.code)`
    },
    LifecycleState: {
      role: 'constant',
      purpose: t(
        'Names the three irreversible resource-container survival states, independently of a unit’s loading status. Owners use these values to decide whether registration or terminal waiting remains possible.',
        '命名资源容器三个不可逆的存续状态，与单元加载状态独立。所有者据此判断是否还能登记资源，以及终止等待是否已经完成。'
      ),
      example: `const scope = createLifecycleScope()
console.log(scope.lifecycle === LifecycleState.open)
await scope.dispose()`
    },
    LifecycleErrorPolicy: {
      role: 'constant',
      purpose: t(
        'Names the four release-failure outcomes consumed by scopes, transactions and collectors. It changes failure delivery after attempts continue; it does not select release ordering or suppress later resource attempts.',
        '命名作用域、事务和收集器使用的四种释放失败交付方式。它只改变继续尝试后的错误交付，不选择释放顺序，也不跳过后续资源。'
      ),
      example: `const scope = createLifecycleScope({ errorPolicy: LifecycleErrorPolicy.collect })
console.log(await scope.dispose())`
    },
    DisposeTransactionKind: {
      role: 'constant',
      purpose: t(
        'Names the two release-order contracts: stable priority ordering or an authoritative caller plan. A transaction selects one mode at construction and does not combine priority and plan ordering.',
        '命名两种释放顺序契约：稳定优先级排序或调用方权威计划。事务在构造时选择一种模式，不混合优先级和计划排序。'
      ),
      example: transactionExample
    },
    LifecycleErrorCode: {
      role: 'error',
      purpose: t(
        'Stable semantic error-code table for lifecycle boundaries, diagnostics and cancellation reasons. Compare source first, then inspect the selected code and the retained original cause or aggregate errors.',
        '生命周期边界、诊断和取消原因使用的稳定语义错误码表。先比较来源，再检查对应错误码以及保留的原始原因或聚合错误。'
      ),
      example: `if (error.source === LIFECYCLE_SOURCE && error.code === LifecycleErrorCode.scopeClosed) console.log(error.cause)`
    },
    LifecycleErrorText: {
      role: 'constant',
      purpose: t(
        'Stable public diagnostic messages used when lifecycle constructs or wraps errors. Keys explain scenarios rather than remediation policy; branch on source and code instead of matching these strings.',
        '本包构造或包装错误时使用的稳定公开诊断文本。键表示诊断场景，不决定补救策略；调用方应按来源和错误码分支，避免比较文本。'
      ),
      example: `console.log(LifecycleErrorText.scopeClosing)`
    }
  },
  types: {
    ILifecycleScopeOptions: {
      summary: t(
        'Caller-owned configuration for asynchronous scope failure delivery and shared release timing.',
        '调用方持有的异步作用域配置，决定错误交付方式与共享释放计时。'
      ),
      members: {
        errorPolicy: errorPolicyOption,
        report: reportOption,
        deadlineAt: deadlineOption,
        scheduler: schedulerOption
      }
    },
    ISyncLifecycleScopeOptions: {
      summary: t(
        'Caller-owned configuration for synchronous release error delivery without asynchronous timing.',
        '调用方持有的同步作用域配置，决定同步释放错误的交付方式。'
      ),
      members: { errorPolicy: errorPolicyOption, report: reportOption }
    },
    ILifecycleScope: {
      summary: t(
        'Asynchronous resource owner returned by `createLifecycleScope()`, with distinct admission-close and release-completion phases.',
        '由 `createLifecycleScope()` 返回的异步资源所有者，明确区分登记关闭与释放完成阶段。'
      ),
      scenarios: [
        t(
          'Group resources whose release may await I/O and report all failures only after every release attempt.',
          '集中管理释放时可能等待外部操作的资源，在全部释放尝试后交付错误。'
        )
      ],
      example: scopeExample,
      members: {
        own: ownMember,
        release: releaseMember,
        lifecycle: lifecycleMember,
        close: {
          ...closeMember,
          summary: t(
            'Stops ownership registration synchronously and aborts the scope’s closing signal with `SCOPE_CLOSED`; no resource release callback is invoked here.',
            '同步停止所有权登记，并以 `SCOPE_CLOSED` 中止作用域关闭信号；此处不调用任何资源释放回调。'
          )
        },
        dispose: {
          summary: t(
            'Closes admission and releases the stable resource snapshot by descending priority with reverse-registration ties. External repeated calls share one promise; synchronous self-disposal throws `SCOPE_REENTRANT_DISPOSE`.',
            '关闭登记入口，按优先级降序释放稳定资源快照，同优先级采用登记逆序。外部重复调用共享同一异步结果；同步自释放抛 `SCOPE_REENTRANT_DISPOSE`。'
          ),
          returns: t(
            'A promise of collected errors for `collect`, empty for other successful policies. Throw/first-error policies reject after release; the scope still reaches terminal.',
            '`collect` 返回所收集错误，其余成功策略返回空列表。抛错或首错策略在释放后拒绝，作用域仍进入终止状态。'
          ),
          example: scopeExample
        },
        '[Symbol.asyncDispose]': {
          summary: t(
            'Supports `await using` by awaiting the same asynchronous disposal and discarding its collected-error return value.',
            '支持 `await using`，等待同一异步释放流程并丢弃所收集错误的返回值。'
          ),
          returns: t(
            'A `Promise<void>` settling with disposal; thrown-policy failures still reject.',
            '随释放结算的 `Promise<void>`；抛错策略失败仍会拒绝。'
          ),
          example: `await using scope = createLifecycleScope()
scope.own({}, { force: () => undefined })`
        }
      }
    },
    ISyncLifecycleScope: {
      summary: t(
        'Synchronous resource owner returned by `createSyncLifecycleScope()`; every admitted callback must finish without a thenable.',
        '由 `createSyncLifecycleScope()` 返回的同步资源所有者；所有接纳回调必须不返回异步可等待值。'
      ),
      scenarios: [
        t(
          'Release synchronous graph nodes or local registrations deterministically on the caller stack.',
          '在调用方调用栈中确定性释放同步图节点或本地登记。'
        )
      ],
      example: syncScopeExample,
      members: {
        lifecycle: lifecycleMember,
        own: {
          ...ownMember,
          params: {
            ...ownMember.params,
            descriptor: t(
              'Caller-authored `ISyncReleaseDescriptor` with explicit `syncSafe: true` and entirely synchronous release callbacks.',
              '调用方编写的 `ISyncReleaseDescriptor`，显式声明 `syncSafe: true`，所有释放回调均同步结束。'
            )
          },
          returns: t(
            'The exact resource; absent sync declaration or async-owner resources throw `SCOPE_SYNC_VIOLATION`.',
            '原资源本身；缺少同步声明或资源属于异步所有者时抛 `SCOPE_SYNC_VIOLATION`。'
          ),
          example: syncScopeExample
        },
        release: {
          ...releaseMember,
          example: `const scope = createSyncLifecycleScope()
const resource = scope.own({}, { syncSafe: true, force: () => undefined })
console.log(scope.release(resource))
scope.dispose()`
        },
        close: { ...closeMember, example: syncScopeExample },
        dispose: {
          summary: t(
            'Synchronously closes and releases every registered resource, preserving priority and reverse-registration ties. Repeated completed calls return an empty list; a reentrant disposer call throws.',
            '同步关闭并释放全部登记资源，保留优先级与同级登记逆序。完成后的重复调用返回空列表；释放回调重入会抛错。'
          ),
          returns: t(
            'Collected errors for `collect`, otherwise an empty list or policy-selected throw. Terminal state is reached even when release fails.',
            '`collect` 返回所收集错误，否则为空列表或按策略抛错。即使释放失败也会进入终止状态。'
          ),
          example: syncScopeExample
        },
        '[Symbol.dispose]': {
          summary: t(
            'Supports `using` by completing synchronous disposal and discarding the collected-error return value.',
            '支持 `using`，完成同步释放并丢弃所收集错误的返回值。'
          ),
          returns: t(
            'All synchronous disposal has run; the selected throw policy can still throw.',
            '全部同步释放已执行；所选抛错策略仍可能抛出错误。'
          ),
          example: `using scope = createSyncLifecycleScope()
scope.own({}, { syncSafe: true, force: () => undefined })`
        }
      }
    },
    ILifecycleOwner: {
      summary: t(
        'Minimal resource handoff contract implemented by a permanent owner; provisional commits depend only on this inward boundary.',
        '永久所有者实现的最小资源转交契约；临时提交只依赖此内向边界。'
      ),
      scenarios: [
        t(
          'Accept setup resources without exposing the permanent owner’s disposal controls.',
          '接收初始化资源，同时不暴露永久所有者的释放控制。'
        )
      ],
      example: scopeExample,
      members: { own: ownMember }
    },
    IProvisionalScopeOptions: {
      summary: t(
        'Configuration connecting temporary setup work to an externally owned cancellation signal.',
        '把临时初始化工作关联到外部所有取消信号的配置。'
      ),
      members: {
        parentSignal: {
          summary: t(
            'An `IAbortSignal` from the parent operation; its abort reason is forwarded to this provisional signal but does not automatically choose rollback.',
            '来自父操作的 `IAbortSignal`；其中止原因转发到临时信号，但不会自动选择回滚。'
          ),
          default: t(
            'Omitted: no parent cancellation subscription is registered.',
            '省略时不登记父级取消订阅。'
          )
        }
      }
    },
    IProvisionalScope: {
      summary: t(
        'Temporary setup owner returned by `createProvisionalScope()`; commit and rollback are mutually exclusive ownership outcomes.',
        '由 `createProvisionalScope()` 返回的临时初始化所有者；提交与回滚是互斥的所有权结算结果。'
      ),
      scenarios: [
        t(
          'Allocate several setup resources and transfer only after setup succeeds; otherwise release the temporary resources.',
          '分配多个初始化资源，全部初始化成功后才转交，否则释放临时资源。'
        )
      ],
      example: provisionalExample,
      members: {
        signal: {
          summary: t(
            'Native signal owned by the provisional scope; parent abort is forwarded and either settlement aborts it with `PROVISIONAL_SETTLED`.',
            '临时作用域持有的原生信号；转发父级中止，提交或回滚均以 `PROVISIONAL_SETTLED` 中止它。'
          )
        },
        own: {
          ...ownMember,
          summary: t(
            'Registers a temporary resource while pending. Plan-mode admission deliberately ignores priority, while the permanent parent validates priority again on transfer.',
            '待结算期间登记临时资源。计划模式接纳刻意忽略优先级；转交时永久父级会再次校验优先级。'
          ),
          returns: t(
            'The exact resource; reuse after either settlement synchronously throws `PROVISIONAL_SETTLED`.',
            '原资源本身；任一结算完成后重复使用会同步抛 `PROVISIONAL_SETTLED`。'
          ),
          example: provisionalExample
        },
        commitTo: {
          summary: t(
            'Transfers resources in registration order to a permanent owner. Pair with `createLifecycleScope()`; on refusal, transferred resources remain with the parent and every leftover release is awaited before rejection.',
            '按登记顺序把资源转交永久所有者。搭配 `createLifecycleScope()`；拒绝接管时已转交资源留在父级，全部剩余资源释放完成后才拒绝。'
          ),
          params: {
            parent: t(
              'Existing `ILifecycleOwner` supplied by the caller, normally returned by `createLifecycleScope()`; it must still accept ownership.',
              '调用方提供的既有 `ILifecycleOwner`，通常来自 `createLifecycleScope()`；必须仍能接纳所有权。'
            )
          },
          returns: t(
            'A promise of complete transfer or compensated failure. A closed parent becomes `PROVISIONAL_PARENT_CLOSED` with original cause; reuse after settlement throws synchronously.',
            '转交完成或补偿后失败的异步结果。父级关闭时为带原始原因的 `PROVISIONAL_PARENT_CLOSED`；结算后重复调用同步抛错。'
          ),
          example: provisionalExample
        },
        rollback: {
          summary: t(
            'Chooses rollback and releases temporary resources in reverse registration order. Repeated rollback returns the same promise, including the compensation promise after failed commit.',
            '选择回滚并按登记逆序释放临时资源。重复回滚返回相同异步结果，包括提交失败后使用的补偿结果。'
          ),
          returns: t(
            'A shared `Promise<void>`; one release failure is rethrown unchanged and several aggregate. Rollback after successful commit returns a `PROVISIONAL_SETTLED` rejection.',
            '共享 `Promise<void>`；单个释放错误原样抛出，多个则聚合。成功提交后的回滚返回 `PROVISIONAL_SETTLED` 拒绝。'
          ),
          example: `const provisional = createProvisionalScope()
provisional.own({}, { force: () => undefined })
await provisional.rollback()`
        }
      }
    },
    ITerminalController: {
      summary: t(
        'Caller-driven survival-state controller returned by `createTerminalController()`; it manages state and waiting, not resources.',
        '由 `createTerminalController()` 返回、由调用方驱动的存续控制器；管理状态与等待，不管理资源。'
      ),
      scenarios: [
        t(
          'Publish one terminal promise while the owning component performs its own resource cleanup.',
          '所属组件自行清理资源，同时向外发布一个终止异步结果。'
        )
      ],
      example: `const terminal = createTerminalController()
const done = terminal.whenTerminal()
terminal.close()
terminal.forceTerminal()
await done`,
      members: {
        lifecycle: lifecycleMember,
        close: {
          summary: t(
            'Idempotently changes open to closing; it performs no cleanup and preserves terminal state.',
            '幂等地把开放改为关闭中；不执行清理，并保留已有终止状态。'
          ),
          returns: t(
            'Admission state is closing unless it was already terminal.',
            '除非原本已经终止，否则登记状态为关闭中。'
          ),
          example: `const terminal = createTerminalController()
terminal.close()
console.log(terminal.lifecycle)`
        },
        forceTerminal: {
          summary: t(
            'Idempotently marks terminal immediately and resolves all terminal waiters without running cleanup.',
            '立即且幂等地标记终止，唤醒全部终止等待方，但不运行资源清理。'
          ),
          returns: t(
            'Terminal state is published and its retained promise is resolved.',
            '终止状态已经发布，保留的异步结果已经完成。'
          ),
          example: `const terminal = createTerminalController()
const done = terminal.whenTerminal()
terminal.forceTerminal()
await done`
        },
        whenTerminal: {
          summary: t(
            'Returns the retained terminal promise. Pair with `forceTerminal()` to publish actual completion after the owner finishes cleanup.',
            '返回保留的终止异步结果。搭配 `forceTerminal()`，由所有者在清理完成后发布真正的完成状态。'
          ),
          returns: t(
            'The same `Promise<void>` on every call; it resolves once terminal is marked.',
            '每次调用返回同一个 `Promise<void>`；标记终止时完成一次。'
          ),
          example: `const terminal = createTerminalController()
const done = terminal.whenTerminal()
terminal.forceTerminal()
await done`
        }
      }
    },
    IReleaseDescriptor: {
      summary: t(
        'Caller-authored resource-release contract shared by scopes and transactions; callbacks express domain teardown while lifecycle owns order and error collection.',
        '作用域和事务共享的调用方资源释放契约；回调表达领域清理，本包负责排序和错误收集。'
      ),
      example: scopeExample,
      members: descriptorMembers
    },
    ISyncReleaseDescriptor: {
      summary: t(
        'Release descriptor accepted only when explicit `syncSafe: true` promises synchronous callbacks; inherited release semantics remain unchanged.',
        '仅在显式 `syncSafe: true` 承诺同步回调时接纳的释放描述器；继承释放语义保持不变。'
      ),
      example: syncScopeExample,
      members: {
        ...descriptorMembers,
        syncSafe: {
          ...descriptorMembers.syncSafe!,
          summary: t(
            'Required literal true promising every release callback finishes synchronously; thenables violate the synchronous scope contract.',
            '必填字面量真值，承诺每个释放回调同步完成；异步可等待值违反同步作用域契约。'
          ),
          values: {
            true: t(
              'Explicitly opts this descriptor into synchronous ownership admission.',
              '显式允许此描述器被同步所有权入口接纳。'
            )
          }
        }
      }
    },
    IReleaseContext: {
      summary: t(
        'Execution context delivered by lifecycle to graceful, force and custom callbacks, or supplied by a direct descriptor caller.',
        '本包传给优雅、强制和自定义回调的执行上下文，也可由直接执行描述器的调用方提供。'
      ),
      example: scopeExample,
      members: {
        signal: {
          summary: t(
            'Release cancellation signal from the owner: closing scopes provide an aborted signal, generic transactions mirror an optional input or use an inert signal.',
            '所有者提供的释放取消信号：关闭作用域提供已中止信号，普通事务镜像可选输入，否则使用不触发的信号。'
          )
        },
        deadlineAt: {
          ...deadlineOption,
          summary: t(
            'One shared absolute graceful deadline supplied by the transaction or scope; undefined means no shared deadline.',
            '事务或作用域提供的共享优雅释放绝对截止时刻；空值表示没有共享截止时刻。'
          )
        },
        scheduler: schedulerOption,
        report: {
          ...reportOption,
          summary: t(
            'Diagnostic sink delivered by the owner. Call synchronously with a failure; its returned value is ignored, and scope/transaction reporters contain throws and rejections.',
            '所有者传入的诊断接收方。同步传入错误，不使用返回值；作用域与事务的上报器会隔离抛错和拒绝。'
          )
        },
        disposer: {
          summary: t(
            'Owner-bound `IDisposerContext` from the asynchronous scope, used to reject self-joining release after callback suspension.',
            '异步作用域提供的所有者绑定 `IDisposerContext`，用于拒绝回调挂起后等待自身释放。'
          ),
          default: t(
            'Omitted for a generic transaction without an owning scope.',
            '普通事务没有所属作用域时省略。'
          )
        }
      }
    },
    IDisposerContext: {
      summary: t(
        'Immutable scope-owned self-join rejection capability supplied through a release context; it is not a disposal promise.',
        '通过释放上下文传入、由作用域持有的不可变自等待拒绝能力，不是释放异步结果。'
      ),
      scenarios: [
        t(
          'Reject a disposer’s attempt to wait for its own owner even after asynchronous suspension.',
          '释放回调异步挂起后仍可拒绝其等待自身所有者。'
        )
      ],
      example: `const scope = createLifecycleScope()
scope.own({}, { force: (context) => { console.log(Boolean(context.disposer)) } })
await scope.dispose()`,
      members: {
        join: {
          summary: t(
            'Always rejects joining the same owner’s disposal, including after suspension or after terminal state.',
            '始终拒绝等待同一所有者的释放，包括异步挂起后或已经终止的情况。'
          ),
          returns: t(
            'Never returns: synchronously throws `SCOPE_REENTRANT_DISPOSE`.',
            '不会返回：同步抛 `SCOPE_REENTRANT_DISPOSE`。'
          ),
          example: `const scope = createLifecycleScope({ errorPolicy: 'collect' })
scope.own({}, { force: (context) => context.disposer?.join() })
console.log(await scope.dispose())`
        }
      }
    },
    IDisposer: {
      summary: t(
        'A synchronous idempotent unregister function, such as the lease release returned by `retain()`; ownership of calling it belongs to the recipient.',
        '同步且幂等的取消登记函数，例如 `retain()` 返回的租约释放函数；接收者负责调用它。'
      ),
      example: `const tracker = createStringLeaseRegistry()
const release = tracker.retain('connection')
release()
release()`,
      members: {}
    },
    ICollectedError: {
      summary: t(
        'Original failure attributed to an item source chosen by the caller or a transaction-internal boundary label.',
        '带项目来源标签的原始失败；标签由调用方或事务内部边界指定。'
      ),
      members: {
        source: {
          summary: t(
            'Item label supplied to the transaction, ledger or collector; scope registrations use generated numeric strings.',
            '传给事务、账本或收集器的项目标签；作用域登记使用生成的数字字符串。'
          )
        },
        error: {
          summary: t(
            'Original thrown or rejected value, preserved rather than replaced by a text-only summary.',
            '保留的原始抛出或拒绝值，不会替换成只有文本的摘要。'
          )
        }
      }
    },
    IGenerationControllerOptions: {
      summary: t(
        'Caller configuration for parent cancellation, generation timeout scheduling and release diagnostics.',
        '调用方提供的父级取消、世代超时排程和释放诊断配置。'
      ),
      members: {
        parentSignal: {
          summary: t(
            'An `IAbortSignal` from the parent owner; cancellation invalidates the active token. Non-undefined reasons retain identity; undefined is normalized to the host-native AbortError. Parent cleanup failures go to `report` once.',
            '来自父级所有者的 `IAbortSignal`；取消使有效令牌失效。非空缺原因保留身份，`undefined` 由宿主规整为原生中止错误；父级清理失败只交给 `report` 一次。'
          ),
          default: t(
            'Omitted: generations do not subscribe to an external parent.',
            '省略时世代不订阅外部父级信号。'
          )
        },
        scheduler: schedulerOption,
        onSuperseded: {
          summary: t(
            'Synchronous `(info) => void` diagnostic called before releasing a stale adopted result. The supplied `ILifecycleError` has `GENERATION_SUPERSEDED`; its return is ignored, synchronous throws and asynchronous rejections go to the existing `report` boundary. Reporter failures reach the shared utils host exception queue without changing adoption.',
            '同步 `(info) => void` 诊断回调，在释放过期结果前调用。传入的 `ILifecycleError` 带 `GENERATION_SUPERSEDED`；不使用返回值，同步抛错与异步拒绝进入既有 `report` 通道；上报器失败进入工具包共享宿主异常队列，不改变接纳结果。'
          ),
          default: t(
            'Omitted: discarded adoption produces no superseded diagnostic callback.',
            '省略时舍弃过期结果不会触发此诊断回调。'
          ),
          params: {
            info: t(
              'Diagnostic `ILifecycleError` created by the stale adoption operation.',
              '过期结果接纳操作创建的诊断 `ILifecycleError`。'
            )
          },
          returns: t(
            'No value is consumed; accidental asynchronous rejection is observed through `report`.',
            '不使用返回值；意外的异步拒绝通过 `report` 观察。'
          ),
          example: `const controller = createGenerationController({ onSuperseded: (info) => console.log(info.code) })
const old = controller.begin()
controller.begin()
controller.adopt(old.token, {}, () => undefined)
controller.dispose()`
        },
        report: {
          ...reportOption,
          summary: t(
            'Final synchronous diagnostic sink for stale-result release failures without a per-call reporter and asynchronous timeout cleanup failures. Receives `error`; throws and rejections are contained.',
            '过期结果释放缺少每次调用上报器时，以及异步超时清理失败时的最终同步诊断回调。接收 `error`，抛错和拒绝被隔离。'
          ),
          default: t(
            'Omitted: these last-boundary failures have no reporting sink.',
            '省略时这些最终边界错误没有上报接收方。'
          )
        }
      }
    },
    IGenerationController: {
      summary: t(
        'Single-active-generation controller returned by `createGenerationController()`; stale results never regain ownership by matching a numeric counter alone.',
        '由 `createGenerationController()` 返回的单有效世代控制器；过期结果不能只凭数字相同重新取得有效身份。'
      ),
      scenarios: [
        t(
          'Replace requests and safely release results that finish after a newer request starts.',
          '替换请求，并安全释放在新请求开始后才完成的旧结果。'
        )
      ],
      example: generationExample,
      members: {
        generation: {
          summary: t(
            'Monotonically advanced counter for begins, supersedes and first disposal; it is diagnostic, while token identity decides currency.',
            '每次启动、主动替换和首次释放推进的编号；编号用于诊断，是否当前有效取决于令牌身份。'
          )
        },
        disposed: {
          summary: t(
            'Whether disposal has permanently closed this controller; a disposed controller cannot begin another generation.',
            '控制器是否已被永久释放关闭；已释放控制器不能再次启动世代。'
          )
        },
        begin: {
          summary: t(
            'Invalidates the previous token and aborts its signal before creating a new request. Pair with `adopt()` or `isCurrent()` when accepting the eventual result.',
            '先使旧令牌失效并中止旧信号，再创建新请求。搭配 `adopt()` 或 `isCurrent()` 判断最终结果能否接纳。'
          ),
          params: {
            options: t(
              'Optional object with `timeoutMs`: finite nonnegative per-generation milliseconds. Omitted timeout means no timer; a supplied invalid value throws `INVALID_OPTION` before replacing the old generation.',
              '可选对象中的 `timeoutMs` 为有限非负的每世代毫秒预算。省略时不建定时器；不合法值在替换旧世代前抛 `INVALID_OPTION`。'
            )
          },
          returns: t(
            'An `IGenerationRequest` with a fresh token, captured generation and native signal. A disposed controller throws `GENERATION_DISPOSED`; cancellation cleanup may throw `GENERATION_CANCELLATION_FAILED`.',
            '带新令牌、固定世代编号和原生信号的 `IGenerationRequest`。已释放时抛 `GENERATION_DISPOSED`，取消清理可能抛 `GENERATION_CANCELLATION_FAILED`。'
          ),
          example: generationExample
        },
        isCurrent: {
          summary: t(
            'Checks exact active token identity and controller liveness without changing state or refreshing the timeout.',
            '检查有效令牌的精确身份和控制器存活状态，不修改状态，也不刷新超时预算。'
          ),
          params: {
            token: t(
              'Token returned by this controller’s `begin()` request, not a caller-created object or generation number.',
              '此控制器 `begin()` 请求返回的令牌，不能用自建对象或世代编号替代。'
            )
          },
          returns: t(
            'True only while this exact token remains active and the controller is not disposed.',
            '仅此精确令牌仍有效且控制器未释放时返回真值。'
          ),
          example: generationExample
        },
        complete: {
          summary: t(
            'Invalidates a matching token and cleans its timer and parent subscription without aborting the completed request’s signal.',
            '使匹配令牌失效并清理定时器和父级订阅，不中止已经完成请求的信号。'
          ),
          params: {
            token: t(
              'Exact token returned by the request created through this controller’s `begin()`.',
              '此控制器通过 `begin()` 创建的请求所返回的精确令牌。'
            )
          },
          returns: t(
            'True after completing the active token, false for stale/disposed tokens. Cleanup failure may throw after invalidation.',
            '完成有效令牌后为真，过期或已释放令牌为假。令牌先失效，之后清理失败可能抛错。'
          ),
          example: generationExample
        },
        supersede: {
          summary: t(
            'Invalidates and aborts the active generation without permanently disposing the controller; the caller may begin fresh work later.',
            '使当前世代失效并中止，但不永久释放控制器；调用方以后仍可启动全新工作。'
          ),
          params: {
            reason: t(
              'Optional caller-issued cancellation value forwarded unchanged to the active signal; omitted uses native abort semantics.',
              '调用方提供的可选取消原因，原样转发给有效信号；省略时采用原生中止语义。'
            )
          },
          returns: t(
            'The current token is invalid and its owned timer/listener are released; cleanup failure can throw. A disposed controller does nothing.',
            '当前令牌失效，所属定时器和监听已清理；清理失败可抛错。已释放控制器不执行动作。'
          ),
          example: `const controller = createGenerationController()
controller.begin()
controller.supersede('replaced')
controller.begin()
controller.dispose()`
        },
        adopt: {
          summary: t(
            'Accepts a result only for the current token. Pair with `begin()`; stale values are released immediately, with asynchronous release rejection observed independently of newer work.',
            '仅为当前令牌接纳结果。搭配 `begin()`；过期值立即释放，并独立观察异步释放拒绝，不影响更新工作。'
          ),
          params: {
            token: t(
              'Token returned in the original `begin()` request that produced this result.',
              '产生此结果的原始 `begin()` 请求返回的令牌。'
            ),
            value: t(
              'Result produced by caller-owned asynchronous work, passed unchanged to the stale-release callback.',
              '调用方异步工作产生的结果，原样传给过期释放回调。'
            ),
            release: t(
              'Caller-authored `(value) => void | PromiseLike<void>` that releases only a stale result. The value is this adoption input; throws/rejections go to the selected release-error reporter.',
              '调用方编写的 `(value) => void | PromiseLike<void>`，仅释放过期结果。参数就是本次传入值；抛错或拒绝转给所选释放错误上报器。'
            ),
            onReleaseError: t(
              'Optional synchronous `(error) => void` receiving the release failure; omitted uses the controller reporter. Return ignored; throws and rejections are contained.',
              '可选同步 `(error) => void` 接收释放错误；省略时使用控制器上报器。不使用返回值，抛错和拒绝被隔离。'
            )
          },
          returns: t(
            'True when the caller keeps the current result, false when stale release was attempted; false does not wait for asynchronous release.',
            '当前结果留给调用方则为真，已尝试释放过期结果则为假；假值不等待异步释放完成。'
          ),
          example: generationExample
        },
        dispose: {
          summary: t(
            'Permanently prevents new generations and invalidates the active token before releasing cancellation resources; repeated calls do nothing.',
            '永久禁止新世代，并在释放取消资源前使当前令牌失效；重复调用不执行动作。'
          ),
          params: {
            reason: t(
              'Optional caller-issued abort reason forwarded to the active request; omitted follows native abort semantics.',
              '调用方指定的可选中止原因，转发给当前请求；省略时采用原生中止语义。'
            )
          },
          returns: t(
            'The controller is disposed and its active request aborted; cancellation cleanup failure can throw after state convergence.',
            '控制器已释放，当前请求已中止；状态先收敛，取消清理失败仍可能抛错。'
          ),
          example: generationExample
        }
      }
    },
    IGenerationRequest: {
      summary: t(
        'Request data returned by `begin()`; retain the exact token with its corresponding async work, rather than reading a later controller counter.',
        '`begin()` 返回的请求数据；应把精确令牌与对应异步工作保存在一起，不读取控制器之后的编号代替。'
      ),
      example: generationExample,
      members: {
        generation: {
          summary: t(
            'Counter captured at this request’s admission; later controller transitions do not change it.',
            '此请求接纳时捕获的编号；控制器后续变化不会修改它。'
          )
        },
        token: {
          summary: t(
            'Fresh object identity issued by `begin()`; use with this controller’s current/adopt/complete methods.',
            '由 `begin()` 签发的全新对象身份；用于此控制器的有效检查、接纳和完成方法。'
          )
        },
        signal: {
          summary: t(
            'Native abort signal for this request, materialized lazily; supersede, timeout, parent abort or disposal invalidates it.',
            '此请求延迟创建的原生中止信号；替换、超时、父级中止或释放会使其失效。'
          )
        }
      }
    },
    IGenerationToken: {
      summary: t(
        'Opaque object identity issued by `begin()`; only the issuing controller can recognize the active token, and numeric generation equality is insufficient.',
        '由 `begin()` 签发的不透明对象身份；只有签发控制器能识别有效令牌，单纯世代编号相等并不足够。'
      ),
      example: generationExample,
      members: {}
    },
    IQuiescenceTracker: {
      summary: t(
        'Per-key lease counter returned by the object tracker; callers own key identity and lease-return responsibility.',
        '对象跟踪器返回的按键租约计数器；调用方负责键身份和租约归还。'
      ),
      scenarios: [
        t(
          'Seal a resource identity and wait until every previously admitted user releases it.',
          '封闭资源身份，等待此前接纳的全部使用方归还租约。'
        )
      ],
      example: leaseExample,
      members: leaseMembers
    },
    ILeaseRegistry: {
      summary: t(
        'Lease-named alias of `IQuiescenceTracker`, returned by string or object registry factories with identical admission and waiting semantics.',
        '`IQuiescenceTracker` 的租约命名别名，由字符串或对象工厂返回，保持相同接纳和等待语义。'
      ),
      scenarios: [
        t(
          'Track callers of a domain resource by explicit leases without exposing polling-based completion.',
          '以显式租约跟踪领域资源的使用方，避免通过轮询判断完成。'
        )
      ],
      example: leaseExample,
      members: leaseMembers
    },
    IPendingTracker: {
      summary: t(
        'Promise-only in-flight tracker returned by `createPendingTracker()`; settlement changes the count without altering caller promise identity.',
        '由 `createPendingTracker()` 返回、只暴露异步任务的跟踪器；结算改变计数，但不改变调用方异步结果身份。'
      ),
      scenarios: [
        t(
          'Drain all started work before final shutdown while preserving each task’s own result handling.',
          '最终关闭前排空全部已启动工作，同时保留各任务自身的结果处理。'
        )
      ],
      example: `const tracker = createPendingTracker()
const promise = Promise.resolve(1)
console.log(tracker.track(promise) === promise)
await tracker.drain()`,
      members: {
        track: {
          summary: t(
            'Registers a promise and automatically removes it after fulfillment or rejection; each registration counts separately.',
            '登记异步结果，并在成功或拒绝后自动移除；每次登记都单独计数。'
          ),
          params: {
            promise: t(
              'Existing caller-owned native `Promise<T>` for an in-flight operation; caller still handles its rejection.',
              '调用方持有的正在执行的原生 `Promise<T>`；调用方仍负责处理它的拒绝。'
            )
          },
          returns: t(
            'The exact original promise unchanged; tracking attaches observation without changing its outcome.',
            '原样返回同一个异步结果；跟踪只附加观察，不改变结果。'
          ),
          example: `const tracker = createPendingTracker()
const promise = Promise.resolve(1)
console.log(tracker.track(promise) === promise)
await tracker.drain()`
        },
        drain: {
          summary: t(
            'Waits until the live count is zero, rechecking after every wait so work added during draining is not missed.',
            '等待实时计数归零，每次等待后复查，因此不会漏掉排空期间新增的工作。'
          ),
          returns: t(
            'A `Promise<void>` fulfilled at observed quiescence; tracked task failures do not reject this wait.',
            '观察到全部空闲时完成的 `Promise<void>`；被跟踪任务失败不会使此等待拒绝。'
          ),
          example: `const tracker = createPendingTracker()
tracker.track(Promise.resolve())
await tracker.drain()`
        },
        size: {
          summary: t(
            'Current number of registered unsettled promises, including repeated registrations of one promise.',
            '当前已登记且尚未结算的异步结果数量，包括同一结果的重复登记。'
          )
        }
      }
    },
    IMutationQueueOptions: {
      summary: t(
        'Admission and diagnostics configuration for serial mutations; no option imposes a running-task timeout.',
        '串行变更的接纳和诊断配置；所有选项均不限制已运行任务的执行时长。'
      ),
      members: {
        queueAdmissionTimeoutMs: {
          summary: t(
            'Per-waiting-task admission budget: a number rejects and removes an overdue task, false disables timers, and undefined permits diagnostics without rejection.',
            '每个排队任务的接纳预算：数字使超时任务被拒绝并移除，假值关闭定时器，空值允许诊断但不拒绝。'
          ),
          default: t(
            '`undefined`: diagnose only and never reject for admission delay.',
            '`undefined`：只诊断，不因接纳等待而拒绝。'
          ),
          values: {
            false: t(
              'Disable rejection and diagnostic timers for queued admission.',
              '关闭排队接纳的拒绝定时器与诊断定时器。'
            )
          }
        },
        admissionDiagnosticMs: {
          summary: t(
            'Diagnostic delay used only when admission timeout is undefined and a diagnostic callback exists; false disables the diagnostic timer.',
            '仅在接纳超时为空且存在诊断回调时使用的诊断延迟；假值关闭诊断定时器。'
          ),
          default: t(
            '`1000` milliseconds: emit one diagnostic while a task remains queued.',
            '`1000` 毫秒：任务仍在排队时发送一次诊断。'
          ),
          values: {
            false: t(
              'Disable diagnostic scheduling while retaining unlimited admission waiting.',
              '关闭诊断排程，同时保留不限制时长的接纳等待。'
            )
          }
        },
        onAdmissionDiagnostic: {
          summary: t(
            'Synchronous `(info) => void` notification with caller-issued `info.owner` and elapsed `info.waitedMs` from the scheduler clock. The return is ignored; synchronous throws and accidental async rejections are contained.',
            '同步 `(info) => void` 通知，包含调用方指定的 `info.owner` 和调度器时钟测得的 `info.waitedMs`。不使用返回值；同步抛错和意外异步拒绝均被隔离。'
          ),
          default: t(
            'Omitted: no diagnostic callback or diagnostic-only timer is installed.',
            '省略时不安装诊断回调，也不创建仅用于诊断的定时器。'
          ),
          params: {
            info: t(
              'Queue-issued record containing the submitted owner label and observed wait duration in milliseconds.',
              '队列提供的记录，包含提交时的所有者标签与观察到的毫秒等待时长。'
            )
          },
          returns: t(
            'No value is consumed and callback failure does not change queue results.',
            '不使用返回值，回调失败不改变队列结果。'
          ),
          example: `const queue = createMutationQueue({ onAdmissionDiagnostic: (info) => console.log(info.owner, info.waitedMs) })
await queue.enqueue(() => 1, { owner: 'settings' })`
        },
        scheduler: schedulerOption
      }
    },
    IEnqueueOptions: {
      summary: t(
        'Per-submission owner identity and optional override of the queue’s admission timeout policy.',
        '每次提交的所有者身份和可选队列接纳超时策略覆盖配置。'
      ),
      members: {
        owner: {
          summary: t(
            'Caller-issued stable label for one mutation owner; matching the currently running label rejects the successor with `QUEUE_SELF_DEPENDENCY`.',
            '调用方签发的稳定变更所有者标签；与运行中标签相同的后继以 `QUEUE_SELF_DEPENDENCY` 拒绝。'
          ),
          default: t(
            'Omitted: no owner-based self-dependency detection is possible.',
            '省略时无法执行基于所有者的自依赖检测。'
          )
        },
        queueAdmissionTimeoutMs: {
          summary: t(
            'Overrides admission waiting for this task with a millisecond budget or false; the override never interrupts a running task.',
            '以毫秒预算或假值覆盖此任务的接纳等待策略；覆盖不会中断已运行任务。'
          ),
          default: t(
            'Omitted: inherit the queue’s admission policy.',
            '省略时继承队列的接纳策略。'
          ),
          values: {
            false: t(
              'Disable both admission timeout and diagnostics for this task.',
              '对本次任务同时关闭接纳超时与诊断定时器。'
            )
          }
        }
      }
    },
    IMutationQueue: {
      summary: t(
        'Single-flight FIFO executor returned by `createMutationQueue()`; callers retain responsibility for external cancellation and queue lifetime.',
        '由 `createMutationQueue()` 返回的单任务先入先出执行器；调用方仍负责外部取消和队列生命周期。'
      ),
      scenarios: [
        t(
          'Serialize configuration changes whose order must match submission while retaining independent task results.',
          '串行执行必须保持提交顺序的配置变更，同时保留各任务独立结果。'
        )
      ],
      example: queueExample,
      members: {
        enqueue: {
          summary: t(
            'Submits one task to run after all earlier admitted tasks settle. Never await a queued successor from inside the running task: different or absent owner labels cannot detect that deadlock.',
            '提交一个任务，在此前已接纳任务全部结算后运行。运行任务内部不可等待队列中的后继；不同或缺失所有者标签无法检测此死锁。'
          ),
          params: {
            task: t(
              'Caller-authored no-argument callback returning a value or thenable. Synchronous throws and rejections reject only this submission; the next task still runs.',
              '调用方编写的无参数回调，返回值或异步可等待值。同步抛错与拒绝只影响本次提交，后续任务仍继续。'
            ),
            options: t(
              'Optional `IEnqueueOptions` chosen by the caller; owner defaults to absent and admission policy inherits the queue.',
              '调用方选择的可选 `IEnqueueOptions`；所有者默认为缺失，接纳策略继承队列。'
            )
          },
          returns: t(
            'A fresh `Promise<T>` for this task. Admission timeout rejects with `QUEUE_ADMISSION_TIMEOUT`; matching running-owner submission rejects with `QUEUE_SELF_DEPENDENCY`.',
            '此任务全新的 `Promise<T>`。接纳超时以 `QUEUE_ADMISSION_TIMEOUT` 拒绝，相同运行所有者以 `QUEUE_SELF_DEPENDENCY` 拒绝。'
          ),
          example: queueExample
        },
        size: {
          summary: t(
            'Number of queued tasks plus the currently running task; removed timed-out tasks no longer contribute.',
            '排队任务数加当前运行任务数；已经超时移除的任务不再计入。'
          )
        }
      }
    },
    IAbortController: {
      summary: t(
        'Structural view of the host-native controller returned by `createAbortController()`; the controller and signal belong to the constructing caller.',
        '`createAbortController()` 返回的宿主原生控制器结构视图；控制器与信号属于构造它的调用方。'
      ),
      scenarios: [
        t(
          'Issue a native cancellation signal to work owned by the same caller.',
          '为同一调用方负责的工作签发原生取消信号。'
        )
      ],
      example: abortExample,
      members: {
        signal: {
          summary: t(
            'Native `INativeAbortSignal` created by this controller; pass it to cancellation-aware operations or listener registration.',
            '此控制器创建的原生 `INativeAbortSignal`；传给支持取消的操作或监听登记。'
          )
        },
        abort: {
          summary: t(
            'Aborts the native signal once with the caller’s reason; subsequent aborts preserve the original native reason.',
            '以调用方原因中止原生信号一次；后续中止保留原生首次原因。'
          ),
          params: {
            reason: t(
              'Optional caller-issued reason; omission uses the host-native default abort reason.',
              '调用方指定的可选原因；省略时使用宿主原生默认中止原因。'
            )
          },
          returns: t(
            'The signal is synchronously marked aborted and registered native listeners have been dispatched.',
            '信号同步标记为已中止，已登记的原生监听者已经派发。'
          ),
          example: abortExample
        }
      }
    },
    IObservedAbortFailureSink: {
      summary: t(
        'Synchronous operation-owned error callback used by `observeAbortSubscription()`. It receives raw callback, reason-access or removal errors, returns nothing, and must not return asynchronous work.',
        '`observeAbortSubscription()` 使用的同步操作所有错误回调。接收原始业务回调、原因访问或移除错误，返回空值，不应返回异步工作。'
      ),
      example: abortExample,
      members: {}
    },
    IObservedAbortSubscription: {
      summary: t(
        'Listener-ownership handle returned by `observeAbortSubscription()`; release it explicitly when cancellation no longer needs observation.',
        '`observeAbortSubscription()` 返回的监听所有权句柄；不再需要观察取消时应显式释放。'
      ),
      scenarios: [
        t(
          'Retain explicit listener cleanup while handling callback failures outside native event dispatch.',
          '持有显式监听清理，同时在原生事件派发之外处理回调错误。'
        )
      ],
      example: abortExample,
      members: {
        unsubscribe: {
          summary: t(
            'Idempotently attempts removal through the captured listener method; removal failures are retained and sent to the operation sink.',
            '通过捕获的监听方法幂等尝试移除；移除失败会保留并传给操作错误接收方。'
          ),
          returns: t(
            'Removal has been attempted without throwing removal errors through native dispatch.',
            '已经尝试移除，不会把移除错误抛入原生事件派发。'
          ),
          example: abortExample
        },
        retryRegistrationCleanup: {
          summary: t(
            'Retries removal after a synchronous registration callback or a prior removal failure, covering hosts that store a listener after invoking it.',
            '同步登记回调或此前移除失败后重试移除，处理宿主先调用再存储监听者的情况。'
          ),
          returns: t(
            'A necessary additional removal attempt has run; failures remain in the handle and reach its sink.',
            '必要的附加移除尝试已经执行；失败仍保留在句柄并传给接收方。'
          ),
          example: `const controller = createAbortController()
const subscription = observeAbortSubscription(controller.signal, () => undefined, console.error)
subscription.retryRegistrationCleanup()
subscription.unsubscribe()`
        },
        failures: {
          summary: t(
            'Live readonly view of listener-removal failures in observation order; callback and reason-getter failures are delivered to the sink rather than appended here.',
            '按观察顺序排列的监听移除错误只读实时视图；业务回调与原因访问错误传给接收方，不追加到此列表。'
          )
        }
      }
    },
    IDisposeTransactionMode: {
      summary: t(
        'Caller-selected union deciding whether descriptors supply numeric priorities or the input sequence itself is authoritative.',
        '调用方选择的联合模式，决定由描述器提供数字优先级，还是直接以输入顺序为权威。'
      ),
      example: transactionExample,
      members: {
        kind: {
          summary: t(
            'Required mode from `DisposeTransactionKind`: order performs stable descending-priority sorting, while plan never reads priority.',
            '来自 `DisposeTransactionKind` 的必填模式：排序模式稳定地按优先级降序，计划模式不读取优先级。'
          ),
          values: { enum: 'DisposeTransactionKind' }
        }
      }
    },
    IDisposeTransactionOptions: {
      summary: t(
        'Per-transaction failure policy and shared release context forwarded unchanged to each run’s items.',
        '每个事务的失败策略和共享释放上下文，传给每次运行的全部项目。'
      ),
      members: {
        errorPolicy: errorPolicyOption,
        report: reportOption,
        deadlineAt: deadlineOption,
        scheduler: schedulerOption,
        signal: {
          summary: t(
            'Caller-owned `IAbortSignal` mirrored into a private per-run native signal; running the transaction never aborts the input controller.',
            '调用方持有的 `IAbortSignal`，镜像到每次运行的私有原生信号；事务不会中止输入控制器。'
          ),
          default: t(
            'Omitted: every item receives an inert non-aborting signal.',
            '省略时每个项目收到不会中止的固定信号。'
          )
        },
        disposer: {
          summary: t(
            'Owner-bound `IDisposerContext` supplied by an owning scope; generic callers normally omit this capability.',
            '所属作用域提供的所有者绑定 `IDisposerContext`；普通调用方通常省略此能力。'
          ),
          default: t(
            'Omitted: no scope self-join capability is placed in the context.',
            '省略时上下文不包含作用域自等待能力。'
          )
        },
        pending: {
          summary: t(
            'Caller-owned object with async no-argument `drain()` invoked after all release items; fulfillment means pending work drained, and rejection becomes a transaction-pending failure.',
            '调用方持有的对象，其无参数异步 `drain()` 在全部释放项目后调用；完成表示未结工作已排空，拒绝会成为事务排空错误。'
          ),
          default: t(
            'Omitted: no final pending-work drain is run.',
            '省略时不执行最后的未结工作排空。'
          )
        },
        'pending.drain': {
          summary: t(
            'Caller-provided no-argument callback invoked after all release items; return a Promise<void> that settles when pending work drains. Synchronous throws or rejection become transaction-pending failures.',
            '调用方提供的无参数回调，在全部释放项目后调用；返回未结工作排空时结算的完成承诺，同步抛错或拒绝会成为事务排空失败。'
          )
        }
      }
    },
    IDisposeTransaction: {
      summary: t(
        'Reusable sequential release executor returned by `createDisposeTransaction()`; a new collector and release context are created for every run.',
        '`createDisposeTransaction()` 返回的可复用顺序释放执行器；每次运行创建新的收集器与释放上下文。'
      ),
      scenarios: [
        t(
          'Release a caller-supplied resource plan completely before applying its selected error outcome.',
          '先完整执行调用方提供的资源释放计划，再应用选择的错误交付方式。'
        )
      ],
      example: transactionExample,
      members: {
        mode: {
          summary: t(
            'Ordering mode chosen by the caller at construction; keep this object stable across runs.',
            '调用方构造时选择的顺序模式；多次运行期间应保持此对象稳定。'
          )
        },
        run: {
          summary: t(
            'Admits descriptors before the first callback, then releases every valid item sequentially under the fixed mode and drains optional pending work.',
            '首次回调前接纳描述器，再按固定模式顺序释放全部有效项目，最后排空可选未结工作。'
          ),
          params: {
            items: t(
              'Caller-provided readonly `IDisposeItem` list; each source labels its errors, and plan mode treats the sequence as authoritative.',
              '调用方提供的只读 `IDisposeItem` 列表；各来源标注对应错误，计划模式以列表顺序为权威。'
            )
          },
          returns: t(
            'A promise of `ICollectedError` entries for collect policy, otherwise empty or policy-selected rejection. An individual failure does not prevent later admitted items.',
            '`collect` 策略返回 `ICollectedError` 列表，否则为空或按策略拒绝。单个失败不阻止后续已接纳项目。'
          ),
          example: transactionExample
        }
      }
    },
    IDisposeItem: {
      summary: t(
        'One caller-defined error-attribution label and release descriptor in a transaction plan; the resource itself stays captured by its callback.',
        '事务计划中的调用方错误归因标签与释放描述器；资源自身由其回调捕获。'
      ),
      members: {
        source: {
          summary: t(
            'Caller-issued item label retained on each collected failure; it is not the error’s package source marker.',
            '调用方签发的项目标签，保留在各收集错误上；并非错误的包来源标记。'
          )
        },
        descriptor: {
          summary: t(
            'Explicit `IReleaseDescriptor` supplied by the caller and admitted before execution begins.',
            '调用方提供的显式 `IReleaseDescriptor`，在执行开始前接纳。'
          )
        }
      }
    },
    ICleanupResult: {
      summary: t(
        'Incremental cleanup observation returned by lifecycle ledgers or domain adapters; errors in later continuations do not repeat earlier snapshots.',
        '本包账本或领域适配器返回的增量清理观察；后续链的错误不重复先前快照。'
      ),
      scenarios: [
        t(
          'Merge an immediate cleanup snapshot with later physical completion without duplicating failures.',
          '合并立即清理快照与后续物理完成结果，避免重复统计失败。'
        )
      ],
      example: ledgerExample,
      members: {
        cleanupErrors: {
          summary: t(
            'Failures already observed at this result’s boundary; generic callers choose the error representation.',
            '此结果边界已经观察到的失败；泛型调用方选择错误表达方式。'
          )
        },
        physicalCompletion: {
          summary: t(
            'Optional promise of later cleanup errors only; follow it until a result has no continuation, or use `mergeCleanupResults()`.',
            '仅包含后续清理错误的可选异步结果；沿链等待到没有后续结果，或使用 `mergeCleanupResults()`。'
          ),
          default: t(
            'Omitted: cleanup has no outstanding physical continuation.',
            '省略时清理不存在尚未完成的物理后续链。'
          )
        }
      }
    },
    ISyncStartedDisposalOutcome: {
      summary: t(
        'Immutable ledger seal result containing errors already observed and a mandatory stable promise of only later physical-completion errors.',
        '不可变账本封闭结果，包含已观察错误，以及必填且稳定的后续物理完成错误异步结果。'
      ),
      example: ledgerExample,
      members: {
        cleanupErrors: {
          summary: t(
            'Frozen `ICollectedError` snapshot containing failures known when the ledger was sealed.',
            '账本封闭时已知失败组成的冻结 `ICollectedError` 快照。'
          )
        },
        physicalCompletion: {
          summary: t(
            'Always-present stable completion promise, including empty plans; contains only failures observed after the seal snapshot.',
            '即使空计划也始终提供的稳定完成异步结果；仅包含封闭快照之后观察到的失败。'
          )
        }
      }
    },
    ISyncStartedDisposalLedger: {
      summary: t(
        'Synchronous-start asynchronous-completion ledger returned by `createSyncStartedDisposalLedger()`; it owns admission and raw failure observation, not release order.',
        '`createSyncStartedDisposalLedger()` 返回的同步启动异步完成账本；负责接纳和原始错误观察，不负责释放排序。'
      ),
      scenarios: [
        t(
          'Start every teardown on the current stack and retain a truthful completion boundary for asynchronous releases.',
          '在当前调用栈启动全部清理，并为异步释放保留真实完成边界。'
        )
      ],
      example: ledgerExample,
      members: {
        lifecycle: lifecycleMember,
        pending: {
          summary: t(
            'Number of accepted thenables not yet settled; synchronous callbacks never contribute to this count.',
            '已经接纳但尚未结算的异步可等待值数量；同步回调不会计入。'
          )
        },
        start: {
          summary: t(
            'Invokes one callback immediately on the caller stack and observes any thenable once. Pair with `seal()` to end admission and obtain its complete error observation.',
            '立即在调用方栈调用一个回调，并单次观察其异步可等待值。搭配 `seal()` 结束接纳并取得完整错误观察。'
          ),
          params: {
            source: t(
              'Caller-issued string label copied into each failure of this item.',
              '调用方签发的字符串标签，复制到此项目的各个失败中。'
            ),
            callback: t(
              'Caller-authored no-argument callback returning any value. A thenable is observed; synchronous throws and rejection are collected rather than thrown from `start()`.',
              '调用方编写的无参数回调，可返回任意值。异步可等待值会被观察；同步抛错和拒绝被收集，不从 `start()` 抛出。'
            )
          },
          returns: t(
            'The item has started; async work may still be pending. Invalid input throws `INVALID_OPTION`, sealed admission throws `SCOPE_CLOSED`, and reentry throws `SCOPE_REENTRANT_OWN`.',
            '项目已启动，异步工作仍可能未结。无效输入抛 `INVALID_OPTION`，封闭后登记抛 `SCOPE_CLOSED`，重入抛 `SCOPE_REENTRANT_OWN`。'
          ),
          example: ledgerExample
        },
        seal: {
          summary: t(
            'Closes admission and returns the immutable outcome snapshot with its physical-completion continuation. Repeated sealing returns the same object.',
            '关闭接纳并返回不可变结果快照及物理完成后续链。重复封闭返回同一个对象。'
          ),
          returns: t(
            'An `ISyncStartedDisposalOutcome`; the ledger becomes terminal once every accepted thenable settles. Active callback reentry throws `SCOPE_REENTRANT_OWN`.',
            '一个 `ISyncStartedDisposalOutcome`；全部接纳的异步可等待值结算后账本终止。当前回调重入抛 `SCOPE_REENTRANT_OWN`。'
          ),
          example: ledgerExample
        },
        whenTerminal: {
          summary: t(
            'Waits for sealed physical completion without returning errors. Pair with `seal()` first; an unsealed ledger remains open even after all current work settles.',
            '等待封闭后的物理完成，但不返回错误。搭配 `seal()` 先封闭；未封闭账本即使当前工作已结算仍保持开放。'
          ),
          returns: t(
            'A `Promise<void>` resolving after seal and zero pending work; obtain failures from the seal outcome.',
            '封闭且未结工作归零后完成的 `Promise<void>`；错误从封闭结果取得。'
          ),
          example: ledgerExample
        }
      }
    },
    IErrorCollector: {
      summary: t(
        'Policy-bound failure recorder returned by `createErrorCollector()`; the owner must call finalize after completing release attempts.',
        '`createErrorCollector()` 返回、绑定策略的错误记录器；所有者在释放尝试完成后负责结算。'
      ),
      scenarios: [
        t(
          'Preserve raw release errors while choosing report, collection, aggregate throw or legacy first-error delivery.',
          '保留原始释放错误，同时选择上报、收集、聚合抛错或历史首错交付。'
        )
      ],
      example: `const collector = createErrorCollector('collect', undefined)
collector.add('connection', new Error('closed'))
console.log(collector.finalize('cleanup failed'))`,
      members: {
        policy: {
          summary: t(
            'Failure-delivery policy selected by the caller when constructing this collector.',
            '构造此收集器时调用方选择的失败交付策略。'
          ),
          values: { enum: 'LifecycleErrorPolicy' }
        },
        add: {
          summary: t(
            'Records a labeled failure, or immediately reports it for report policy. First-error policy retains the first and reports later failures.',
            '记录带标签的失败，或在上报策略下立即上报。首错策略保留首个错误并上报后续失败。'
          ),
          params: {
            source: t(
              'Caller-issued item identity retained on collect-policy entries.',
              '调用方签发的项目身份，保留在收集策略的条目中。'
            ),
            error: t(
              'Original thrown or rejected value captured by the release owner.',
              '释放所有者捕获的原始抛出值或拒绝值。'
            )
          },
          returns: t(
            'The failure is recorded or reported; reporter throws and rejections are contained.',
            '错误已被记录或上报；上报回调抛错与拒绝被隔离。'
          ),
          example: `const collector = createErrorCollector('collect', undefined)
collector.add('connection', new Error('closed'))
console.log(collector.finalize('cleanup failed'))`
        },
        finalize: {
          summary: t(
            'Applies the chosen failure-delivery outcome without clearing entries. A single failure keeps its normalized identity; unclassified native errors receive `SCOPE_DISPOSAL_FAILED` and primitive failures remain on cause. Several throw-policy failures aggregate.',
            '应用所选失败交付方式，不清空条目。单错保留规整后的身份；未分类原生错误附 `SCOPE_DISPOSAL_FAILED`，原始值失败保留在原因。抛错策略多错聚合。'
          ),
          params: {
            message: t(
              'Caller-selected stable aggregate message used only when several failures are thrown together.',
              '调用方选择的稳定聚合提示，仅在多个失败一起抛出时使用。'
            )
          },
          returns: t(
            'Collected entries for collect, otherwise an empty list or policy-selected throw. First-error policy throws the exact first error.',
            '收集策略返回条目，否则为空或按策略抛错。首错策略抛出精确的首个错误。'
          ),
          example: `const collector = createErrorCollector('collect', undefined)
console.log(collector.finalize('cleanup failed'))`
        }
      }
    },
    ILifecycleError: {
      summary: t(
        'Native `Error` carrying lifecycle identity and traceable metadata. If diagnostic message/stack getters fail during normalization, the original thrown value remains cause and getter failures remain secondary errors; they never replace the primary.',
        '携带本包身份与可追溯元数据的原生错误。规整时若消息或堆栈读取器失败，原抛出值仍保存在原因，读取器失败作为次要错误，不会替换主因。'
      ),
      scenarios: [
        t(
          'Inspect semantic boundary identity while retaining the original primary cause and secondary cleanup failures.',
          '检查边界语义身份，同时保留原始主原因和次要清理失败。'
        )
      ],
      example: `const scope = createLifecycleScope()
scope.close()
try {
  scope.own({}, { force: () => undefined })
} catch (error) {
  console.error(error)
}`,
      members: {
        source: {
          summary: t(
            'Package identity assigned by lifecycle error construction; equals `LIFECYCLE_SOURCE`.',
            '本包错误构造分配的包身份，等于 `LIFECYCLE_SOURCE`。'
          )
        },
        code: {
          summary: t(
            'Semantic boundary code chosen by the owner, normally from `LifecycleErrorCode`; interpret together with source.',
            '所有者选择的边界语义码，通常来自 `LifecycleErrorCode`；应与来源共同解释。'
          )
        },
        phase: {
          summary: t(
            'Optional caller-selected operation phase explaining where the failure crossed a boundary.',
            '调用方可选指定的操作阶段，解释失败穿过边界的位置。'
          )
        },
        detail: {
          summary: t(
            'Optional readonly context record supplied by the owner, such as a field label or timing attribution.',
            '所有者提供的可选只读上下文记录，例如字段标签或计时归因。'
          )
        },
        cause: {
          summary: t(
            'Optional original primary thrown value retained for identity-based inspection and causal tracing.',
            '可选保留的原始主抛出值，用于身份检查和原因追溯。'
          )
        },
        errors: {
          summary: t(
            'Frozen non-enumerable secondary failure list retained in occurrence order without replacing the primary cause.',
            '按发生顺序保留的冻结不可枚举次要错误列表，不替换主原因。'
          )
        }
      }
    },
    ILifecycleState: {
      summary: t(
        'Survival-state value union from `LifecycleState`, used for container admission and irreversible terminal completion.',
        '来自 `LifecycleState` 的存续状态值联合，用于容器接纳和不可逆终止完成。'
      ),
      members: {}
    },
    IErrorPolicy: {
      summary: t(
        'Release-failure outcome union from `LifecycleErrorPolicy`, consumed by owners, transactions and error collectors.',
        '来自 `LifecycleErrorPolicy` 的释放失败交付联合，供所有者、事务和错误收集器使用。'
      ),
      members: {}
    },
    IDisposeTransactionKind: {
      summary: t(
        'Value union from `DisposeTransactionKind`, identifying priority-order or authoritative-plan execution.',
        '来自 `DisposeTransactionKind` 的值联合，标识优先级排序或权威计划执行。'
      ),
      members: {}
    },
    ILifecycleErrorCode: {
      summary: t(
        'Public semantic code string union from `LifecycleErrorCode`; code meaning requires lifecycle package source identity.',
        '来自 `LifecycleErrorCode` 的公开语义码字符串联合；解释错误码必须同时确认本包来源身份。'
      ),
      members: {}
    },
    ILifecycleErrorText: {
      summary: t(
        'Public diagnostic string union from `LifecycleErrorText`; use code identity rather than text matching for control flow.',
        '来自 `LifecycleErrorText` 的公开诊断字符串联合；控制流程应使用错误码身份而非文本匹配。'
      ),
      members: {}
    }
  },
  enums: {
    LifecycleState: {
      summary: t(
        'Resource-container survival states observed through owner lifecycle properties.',
        '通过所有者生命周期属性观察到的资源容器存续状态。'
      ),
      values: {
        open: t(
          'Accept resources or work; no close transition has occurred yet.',
          '允许接纳资源或工作，尚未发生关闭转换。'
        ),
        closing: t(
          'Reject new ownership while cleanup may still be pending.',
          '拒绝新增所有权，但清理工作仍可能尚未结束。'
        ),
        terminal: t(
          'Irreversibly finished; no future registration or restart is allowed.',
          '已经不可逆地完成，不再允许登记或重新启动。'
        )
      }
    },
    LifecycleErrorPolicy: {
      summary: t(
        'Release-error outcomes selected through scope, transaction or collector policy.',
        '通过作用域、事务或收集器策略选择的释放错误交付方式。'
      ),
      values: {
        throw: t(
          'Attempt every release, then throw one original error or a coded aggregate for several.',
          '尝试全部释放后，原样抛单错，多个错误则带码聚合抛出。'
        ),
        collect: t(
          'Return every labeled original failure after all release attempts complete.',
          '全部释放尝试完成后，返回带标签的所有原始错误。'
        ),
        report: t(
          'Report each failure and return an empty list; owners require a reporter.',
          '逐个上报失败并返回空列表；所有者要求提供上报回调。'
        ),
        firstError: t(
          'Retain and throw the first original failure, report later ones; intended for legacy first-error migration.',
          '保留并抛出原始首错，上报后续错误；用于历史首错语义迁移。'
        )
      }
    },
    DisposeTransactionKind: {
      summary: t(
        'Mutually exclusive execution modes selected when creating a release transaction.',
        '创建释放事务时选择的互斥执行模式。'
      ),
      values: {
        order: t(
          'Stably sort descending finite priorities; equal priorities preserve the caller’s sequence.',
          '按有限优先级稳定降序排序；相同优先级保留调用方顺序。'
        ),
        plan: t(
          'Execute exactly the supplied plan and never read descriptor priority.',
          '完全按输入计划执行，不读取描述器优先级。'
        )
      }
    },
    LifecycleErrorCode: {
      summary: t(
        'Stable lifecycle codes used by package failures, cancellation reasons and diagnostics.',
        '用于本包失败、取消原因和诊断的稳定生命周期错误码。'
      ),
      values: errorCodeValues
    },
    LifecycleErrorText: {
      summary: t(
        'Stable lifecycle diagnostic messages keyed by their owning failure or cancellation scenario.',
        '按所属失败或取消场景命名的稳定生命周期诊断文本。'
      ),
      values: errorTextValues
    }
  },
  enhancers: {}
}
