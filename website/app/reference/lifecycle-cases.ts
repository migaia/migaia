import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Scope error routing is identical across async and sync release, with explicit descriptors. */
const scopeOptionsExample = (
  sync: boolean,
  collect = false
): string => `import { create${sync ? 'Sync' : ''}LifecycleScope } from '@migaia/lifecycle'
const reported: unknown[] = []
const failure = new Error('release failed')
const scope = create${sync ? 'Sync' : ''}LifecycleScope({ errorPolicy: '${collect ? 'collect' : 'report'}', report: (error) => { reported.push(error) } })
scope.own({}, { syncSafe: true, force: () => { throw failure } })
const errors = ${sync ? '' : 'await '}scope.dispose()
console.log(reported.includes(failure), errors.length)`

/** Every option example uses public entries and keeps its timing clock local. */
export const lifecycleOptionExamples = {
  scopeReport: scopeOptionsExample(false),
  syncReport: scopeOptionsExample(true),
  syncCollect: scopeOptionsExample(true, true),
  deadline: `import { createLifecycleScope } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing'
const scheduler = createManualScheduler()
const scope = createLifecycleScope({ scheduler, deadlineAt: scheduler.now() + 100 })
scope.own({}, { force: (context) => { console.log(context.deadlineAt, context.scheduler?.now()) } })
await scope.dispose()`,
  provisionalAbort: `import { createProvisionalScope } from '@migaia/lifecycle'
const parent = new AbortController()
let active = true
const temporary = createProvisionalScope({ parentSignal: parent.signal })
temporary.own({}, { force: () => { active = false } })
parent.abort(new Error('setup cancelled'))
console.log(temporary.signal.aborted, active)
await temporary.rollback()
console.log(active)`,
  provisionalCommit: `import { createLifecycleScope, createProvisionalScope } from '@migaia/lifecycle'
const parent = new AbortController()
const permanent = createLifecycleScope()
const temporary = createProvisionalScope({ parentSignal: parent.signal })
let released = 0
temporary.own({}, { force: () => { released++ } })
await temporary.commitTo(permanent)
console.log(released)
await permanent.dispose()
console.log(released)`,
  generationCancel: `import { createGenerationController } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing'
const scheduler = createManualScheduler()
const parent = new AbortController()
const controller = createGenerationController({ scheduler, parentSignal: parent.signal })
const timed = controller.begin({ timeoutMs: 10 })
scheduler.advance(11)
console.log(timed.signal.aborted, controller.isCurrent(timed.token))
const next = controller.begin()
parent.abort(new Error('page closed'))
console.log(next.signal.aborted, controller.isCurrent(next.token))
controller.dispose()`,
  superseded: `import { createGenerationController } from '@migaia/lifecycle'
const codes: string[] = []
const failures: unknown[] = []
const controller = createGenerationController({
  onSuperseded: (info) => { codes.push(info.code) },
  report: (error) => { failures.push(error) }
})
const old = controller.begin()
controller.begin()
console.log(controller.adopt(old.token, {}, () => { throw new Error('stale release failed') }))
console.log(codes, (failures[0] as Error).message)
controller.dispose()`,
  queueTimeout: `import { createMutationQueue } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing'
const scheduler = createManualScheduler()
const release = Promise.withResolvers<void>()
const queue = createMutationQueue({ queueAdmissionTimeoutMs: 10, scheduler })
const running = queue.enqueue(() => release.promise)
const waiting = queue.enqueue(() => 'saved').catch((error: unknown) => error)
scheduler.advance(11)
console.log((await waiting as { code?: string }).code)
release.resolve()
await running`,
  queueDiagnostic: `import { createMutationQueue } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing'
const scheduler = createManualScheduler()
const release = Promise.withResolvers<void>()
const seen: unknown[] = []
const queue = createMutationQueue({
  admissionDiagnosticMs: 10, scheduler,
  onAdmissionDiagnostic: (info) => { seen.push([info.owner, info.waitedMs]) }
})
const running = queue.enqueue(() => release.promise, { owner: 'first' })
const waiting = queue.enqueue(() => 'saved', { owner: 'settings' })
scheduler.advance(11)
release.resolve()
await Promise.all([running, waiting])
console.log(seen)`,
  transactionErrors: `import { createDisposeTransaction } from '@migaia/lifecycle'
const reported: unknown[] = []
const failure = new Error('close failed')
const transaction = createDisposeTransaction({ kind: 'plan' }, {
  errorPolicy: 'report', report: (error) => { reported.push(error) }
})
const errors = await transaction.run([{ source: 'connection', descriptor: { force: () => { throw failure } } }])
console.log(reported.includes(failure), errors.length)`,
  transactionClock: `import { createDisposeTransaction } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing'
const scheduler = createManualScheduler()
const caller = new AbortController()
const transaction = createDisposeTransaction({ kind: 'plan' }, {
  scheduler, deadlineAt: scheduler.now() + 100, signal: caller.signal
})
await transaction.run([{ source: 'connection', descriptor: { force: (context) => {
  console.log(context.deadlineAt, context.signal.aborted)
} } }])
console.log(caller.signal.aborted)`,
  transactionDrain: `import { createLifecycleScope, createDisposeTransaction } from '@migaia/lifecycle'
const scope = createLifecycleScope()
const order: string[] = []
scope.own({}, { force: async (ownerContext) => {
  const transaction = createDisposeTransaction({ kind: 'plan' }, {
    disposer: ownerContext.disposer,
    pending: { drain: async () => { order.push('drain') } }
  })
  await transaction.run([{ source: 'inner', descriptor: { force: (context) => {
    console.log(context.disposer === ownerContext.disposer)
    order.push('release')
  } } }])
} })
await scope.dispose()
console.log(order)`,
  boundedTimeout: `import { boundedWait } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing'
const scheduler = createManualScheduler()
const task = Promise.withResolvers<void>()
const waiting = boundedWait(task.promise, scheduler.now() + 10, { scheduler })
scheduler.advance(10)
console.log(await waiting)
task.resolve()`,
  boundedCleanup: `import { boundedWait } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing'
import type { IScheduler } from '@migaia/utils/scheduler'
const clock = createManualScheduler()
const cleanup = new Error('timer cleanup failed')
const scheduler: IScheduler = { ...clock, schedule: (task, delay) => {
  const scheduled = clock.schedule(task, delay)
  return { ...scheduled, cancel: () => { scheduled.cancel(); throw cleanup } }
} }
const failures: unknown[] = []
console.log(await boundedWait(Promise.resolve(), 100, {
  scheduler, reportCleanup: (error) => { failures.push(error) }
}))
console.log(failures[0] === cleanup)`,
  scheduler: `import { resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
const selected = resolveSchedulerOption({ scheduler: createManualScheduler() })
console.log(selected?.now())`,
  schedulerFallback: `import { resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler } from '@migaia/utils/scheduler'
const selected = resolveSchedulerOption({ scheduler: undefined }, systemScheduler)
console.log(selected === systemScheduler)`
}

/** Common release policy scenarios remain specific to each public factory. */
const releaseCases = (sync: boolean): readonly IOptionCaseDoc[] => [
  {
    title: t('Report cleanup failures without throwing', '上报清理失败而不抛出'),
    problem: t(
      'Cleanup must attempt every resource while sending failures to monitoring. Choose report and supply its required reporter. The default throw policy instead throws after release; collect returns failures, and firstError throws the first while reporting later ones.',
      '清理需要尝试每个资源，同时向监控交付失败。选择 report 并提供必需的上报器。默认 throw 在释放后抛错；collect 返回失败，firstError 抛出首错并上报后续错误。'
    ),
    example: sync ? lifecycleOptionExamples.syncReport : lifecycleOptionExamples.scopeReport,
    result: t(
      'Prints true 0; the original failure was reported and none are returned.',
      '输出 true 0；原始失败已上报，返回列表为空。'
    ),
    covers: ['errorPolicy', 'report']
  },
  sync
    ? {
        title: t('Inspect synchronous cleanup failures', '检查同步清理失败'),
        problem: t(
          'A caller wants to inspect release failures itself. collect returns them instead of using the reporter or throwing after disposal.',
          '调用方希望自行检查释放失败。collect 返回这些失败，不调用上报器，也不在释放后抛错。'
        ),
        example: lifecycleOptionExamples.syncCollect,
        result: t(
          'Prints false 1; the caller receives one failure without reporting.',
          '输出 false 1；调用方取得一个失败，没有上报。'
        ),
        covers: ['errorPolicy', 'report']
      }
    : {
        title: t('Share one release clock and deadline', '共享释放时钟和截止时刻'),
        problem: t(
          'Several releases need one absolute deadline rather than a fresh budget per item. Use deadlineAt from the same scheduler clock. Omission has no shared deadline and uses the system scheduler.',
          '多个释放需要共用绝对截止时刻，而非每项重新计算预算。deadlineAt 必须来自同一个 scheduler 时钟。省略时没有共享截止时刻，并使用系统调度器。'
        ),
        example: lifecycleOptionExamples.deadline,
        result: t(
          'The release callback prints the shared deadline 100 and current time 0.',
          '释放回调输出共享截止时刻 100 和当前时间 0。'
        ),
        covers: ['deadlineAt', 'scheduler']
      }
]

/** Related timing, cancellation and error-routing fields form complete configuration stories. */
export const lifecycleOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  scope: releaseCases(false),
  syncScope: releaseCases(true),
  provisional: [
    {
      title: t('Cancel temporary setup, then roll it back', '取消临时初始化后执行回滚'),
      problem: t(
        'Parent cancellation must reach setup work, but cancellation alone does not choose rollback. parentSignal forwards the reason; the caller must still roll back owned resources. Without it, no parent signal is observed.',
        '父级取消需要传给初始化工作，但取消本身不会选择回滚。parentSignal 转发原因；调用方仍需回滚已持有资源。不设置则不观察父级信号。'
      ),
      example: lifecycleOptionExamples.provisionalAbort,
      result: t(
        'Prints true true before rollback, then false after resource release.',
        '回滚前输出 true true，资源释放后输出 false。'
      ),
      covers: ['parentSignal']
    },
    {
      title: t('Commit cancellable setup to its permanent owner', '把可取消初始化转交永久所有者'),
      problem: t(
        'Successful setup transfers its resources to a long-lived owner. The provisional parent signal is detached at settlement; permanent cleanup is now the target scope responsibility.',
        '初始化成功后，把资源转交长期所有者。临时父级信号在结算时解除订阅；永久清理由目标作用域负责。'
      ),
      example: lifecycleOptionExamples.provisionalCommit,
      result: t(
        'Prints 0 after transfer, then 1 when the permanent scope releases it.',
        '转交后输出 0，永久作用域释放时输出 1。'
      ),
      covers: ['parentSignal']
    }
  ],
  generation: [
    {
      title: t('Cancel generations by time or parent', '按时间或父级信号取消代次'),
      problem: t(
        'A page request should become stale after its deadline or page closure. scheduler controls generation timeouts; parentSignal invalidates the current token. Defaults use the system clock and no parent subscription.',
        '页面请求应在截止期限或页面关闭后失效。scheduler 控制代次超时；parentSignal 使当前令牌失效。默认使用系统时钟，不订阅父级信号。'
      ),
      example: lifecycleOptionExamples.generationCancel,
      result: t(
        'Both deadline and parent cancellation print true false: aborted and no longer current.',
        '截止期限和父级取消均输出 true false：已中止且不再是当前代次。'
      ),
      covers: ['scheduler', 'parentSignal']
    },
    {
      title: t('Observe discarded results and failed release', '观察舍弃结果及释放失败'),
      problem: t(
        'A late result must be released instead of adopted. onSuperseded observes the discard; report receives a failing stale-result release when no per-call reporter is supplied. Omission drops those diagnostics.',
        '晚到结果必须释放，不能接纳。onSuperseded 观察舍弃；没有逐次上报器时，report 接收过期结果释放失败。省略时丢弃这些诊断。'
      ),
      example: lifecycleOptionExamples.superseded,
      result: t(
        'Prints false, GENERATION_SUPERSEDED and stale release failed.',
        '接纳结果为 false，诊断码为 GENERATION_SUPERSEDED，并报告 stale release failed。'
      ),
      covers: ['onSuperseded', 'report']
    }
  ],
  queue: [
    {
      title: t('Reject overdue waiting work', '拒绝等待过期的工作'),
      problem: t(
        'A save is queued behind a running task. A numeric queueAdmissionTimeoutMs removes it when its admission wait expires. The default only diagnoses; false disables timers. Already running work is unaffected.',
        '保存操作排在运行中任务之后。数值 queueAdmissionTimeoutMs 在接纳等待过期时移除它。默认仅诊断；false 关闭定时器。运行中的工作不受影响。'
      ),
      example: lifecycleOptionExamples.queueTimeout,
      result: t(
        'Prints QUEUE_ADMISSION_TIMEOUT; releasing the first task finishes it normally.',
        '输出 QUEUE_ADMISSION_TIMEOUT；放行首个任务后，它正常完成。'
      ),
      covers: ['queueAdmissionTimeoutMs', 'scheduler']
    },
    {
      title: t('Warn about waiting without rejecting', '提示等待而不拒绝'),
      problem: t(
        'A settings save may wait, but should remain queued. admissionDiagnosticMs changes the default 1000 ms warning threshold; onAdmissionDiagnostic receives owner and waitedMs. Without a callback no diagnostic-only timer is installed.',
        '设置保存可以等待，但应保留在队列中。admissionDiagnosticMs 修改默认 1000 毫秒提示阈值；onAdmissionDiagnostic 接收 owner 和 waitedMs。不设回调则不安装仅用于诊断的定时器。'
      ),
      example: lifecycleOptionExamples.queueDiagnostic,
      result: t(
        "Prints [['settings', 10]]; the save still completes.",
        "输出 [['settings', 10]]；保存仍然完成。"
      ),
      covers: ['admissionDiagnosticMs', 'onAdmissionDiagnostic', 'scheduler']
    }
  ],
  transaction: [
    {
      title: t('Report all transaction release failures', '上报事务释放失败'),
      problem: t(
        'A transaction must finish every release and report failures rather than throw. errorPolicy report requires report; the default throw policy throws after all items.',
        '事务需要完成每项释放并上报失败，不直接抛错。errorPolicy report 必须提供 report；默认 throw 在全部项目结束后抛错。'
      ),
      example: lifecycleOptionExamples.transactionErrors,
      result: t(
        'Prints true 0: the original failure was reported, with no returned failures.',
        '输出 true 0：原始失败已上报，返回失败列表为空。'
      ),
      covers: ['errorPolicy', 'report']
    },
    {
      title: t('Forward the caller signal and shared deadline', '转发调用者信号和共享截止时刻'),
      problem: t(
        'Release callbacks need the caller cancellation source and the same absolute deadline. The transaction mirrors signal without aborting the caller controller. Omitted signal stays inert; omitted deadlineAt gives no shared deadline.',
        '释放回调需要调用者取消来源和统一的绝对截止时刻。事务镜像 signal，不会中止调用者控制器。省略信号时保持静止；省略 deadlineAt 时没有共享截止时刻。'
      ),
      example: lifecycleOptionExamples.transactionClock,
      result: t(
        'Prints 100 false, then false for the caller signal.',
        '输出 100 false，然后输出调用者信号的 false。'
      ),
      covers: ['signal', 'deadlineAt', 'scheduler']
    },
    {
      title: t('Drain work after owner-bound releases', '在绑定所有者的释放后排空工作'),
      problem: t(
        'A scope-owned transaction must retain its supplied disposer capability and drain work started by releases. Forward context.disposer; generic callers omit it. pending.drain runs last and is skipped when pending is absent.',
        '作用域持有的事务需要保留已有 disposer 能力，并排空释放期间启动的工作。转发 context.disposer；普通调用方省略它。pending.drain 最后执行，省略 pending 时跳过。'
      ),
      example: lifecycleOptionExamples.transactionDrain,
      result: t(
        "Prints true and ['release', 'drain']; the exact owner capability is forwarded.",
        "输出 true 和 ['release', 'drain']；原所有者能力被原样转发。"
      ),
      covers: ['disposer', 'pending', 'pending.drain']
    }
  ],
  bounded: [
    {
      title: t('Observe an absolute deadline without cancellation', '观察绝对截止期限而不取消任务'),
      problem: t(
        'A caller stops waiting after ten clock units, but still owns the task. Use the same scheduler to produce the deadline and drive the wait. Without scheduler, the helper uses the system clock.',
        '调用方在十个时钟单位后停止等待，但仍持有任务。使用同一个 scheduler 产生截止时刻并驱动等待。不设置则使用系统时钟。'
      ),
      example: lifecycleOptionExamples.boundedTimeout,
      result: t(
        'Prints false at the deadline; the task can still resolve afterwards.',
        '截止时刻输出 false；任务之后仍可完成。'
      ),
      covers: ['scheduler']
    },
    {
      title: t(
        'Report timer cleanup without changing the winner',
        '上报定时器清理而不改变胜出结果'
      ),
      problem: t(
        'A timer cancellation can fail after the task has already won. reportCleanup receives that failure while retaining the task result. Without it, cleanup failure rejects the wait.',
        '任务已经胜出后，定时器取消仍可能失败。reportCleanup 接收该失败，并保留任务结果。不设置时，清理失败会拒绝等待。'
      ),
      example: lifecycleOptionExamples.boundedCleanup,
      result: t(
        'Prints true true: the task won and the original cleanup error was reported.',
        '输出 true true：任务胜出，原清理错误已上报。'
      ),
      covers: ['scheduler', 'reportCleanup']
    }
  ],
  scheduler: [
    {
      title: t('Select a local clock', '选择局部时钟'),
      problem: t(
        'A component needs deterministic timers without replacing global clocks. Supply scheduler to select and validate that implementation.',
        '组件需要确定的定时器，但不替换全局时钟。传入 scheduler 可选择并校验该实现。'
      ),
      example: lifecycleOptionExamples.scheduler,
      result: t('Prints the manual clock initial time 0.', '输出手动时钟初始时间 0。'),
      covers: ['scheduler']
    },
    {
      title: t('Use an explicit fallback', '使用显式后备实现'),
      problem: t(
        'Optional application configuration may omit scheduler. Pass a fallback to retain that exact object; without either the result is undefined.',
        '应用可选配置可能省略 scheduler。传入后备值会保留该对象；两者都没有则返回 undefined。'
      ),
      example: lifecycleOptionExamples.schedulerFallback,
      result: t('Prints true; the fallback object is preserved.', '输出 true；保留后备对象。'),
      covers: ['scheduler']
    }
  ]
}

/**
 * Problems each lifecycle API solves, told as a situation, a runnable fix and the observed output.
 * Every example was run with Node 24 against the built packages and its printed output is quoted in
 * `result`.
 */
export const lifecycleCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createLifecycleScope: [
    {
      title: t('Clean up everything when a page closes', '离开页面时一起清理连接、订阅和计时器'),
      problem: t(
        'A subscription is missed when leaving the page, and after the user comes back every message is handled twice.\n\nCleanup functions scattered across a page need a matching line elsewhere for every new resource, which is easy to miss, and the release order is hand-written too.\n\nRegister each resource where it is created and call `dispose()` once when leaving. Release runs in reverse registration order, so the subscription that depends on the connection goes first.',
        '离开页面时漏掉了一个订阅，用户回到页面后，每条消息都被处理了两次。\n\n清理函数散落在页面各处，每加一个资源就要在别处记得加一行清理，很容易漏掉；释放顺序也全靠手写。\n\n在创建资源的地方把它登记到作用域，离开时只调用一次 `dispose()`。释放顺序与登记顺序相反，依赖连接的订阅会先于连接释放。'
      ),
      example: {
        en: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

function openChatPage(messages: EventTarget) {
  const page = createLifecycleScope()

  page.own('connection', { force: () => console.log('connection closed') })

  const onMessage = () => console.log('message received')
  messages.addEventListener('message', onMessage)
  page.own(onMessage, {
    force: () => {
      messages.removeEventListener('message', onMessage)
      console.log('message subscription removed')
    }
  })

  const timer = setInterval(() => console.log('heartbeat'), 60_000)
  page.own(timer, {
    force: () => {
      clearInterval(timer)
      console.log('heartbeat timer cleared')
    }
  })
  return page
}

const messages = new EventTarget()
const page = openChatPage(messages)
messages.dispatchEvent(new Event('message'))
await page.dispose() // the page closes
messages.dispatchEvent(new Event('message')) // prints nothing now`,
        zh: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

function openChatPage(messages: EventTarget) {
  const page = createLifecycleScope()

  page.own('connection', { force: () => console.log('断开连接') })

  const onMessage = () => console.log('收到消息')
  messages.addEventListener('message', onMessage)
  page.own(onMessage, {
    force: () => {
      messages.removeEventListener('message', onMessage)
      console.log('取消订阅消息')
    }
  })

  const timer = setInterval(() => console.log('心跳'), 60_000)
  page.own(timer, {
    force: () => {
      clearInterval(timer)
      console.log('清除心跳计时器')
    }
  })
  return page
}

const messages = new EventTarget()
const page = openChatPage(messages)
messages.dispatchEvent(new Event('message'))
await page.dispose() // 离开页面
messages.dispatchEvent(new Event('message')) // 不会再打印`
      },
      result: t(
        'Prints `message received`, then `heartbeat timer cleared`, `message subscription removed`, `connection closed`.\n\nThe second message prints nothing, and `own()` after `dispose()` throws `SCOPE_TERMINAL`, so the scope is never silently revived.',
        '输出 `收到消息`，然后依次是 `清除心跳计时器`、`取消订阅消息`、`断开连接`。\n\n第二条消息不会再打印；`dispose()` 之后再调用 `own()` 会抛出 `SCOPE_TERMINAL`，作用域不会被悄悄复活。'
      )
    },
    {
      title: t('One cleanup fails, the rest still run', '一项清理失败，其余照常释放'),
      problem: t(
        'Closing a cache file throws, the socket after it is never closed, and the original error is lost.\n\nIn a hand-written `finally`, a close that throws skips every close after it, and a later error can hide the original one.\n\nA scope attempts every release first and throws afterwards: one failure is thrown as the original error with `source` and `code` added, several become an `AggregateError`.',
        '关闭缓存文件时抛了错，后面的 socket 没有关，最初的错误也找不到了。\n\n手写的 `finally` 里，一个关闭操作抛错，后面的关闭都不会执行，最初的错误也可能被后来的错误盖掉。\n\n作用域会先把每个资源都尝试释放，结束后再抛出：一个失败时抛出原始错误本身，只多了 `source` 和 `code`；多个失败时合成 `AggregateError`。'
      ),
      example: {
        en: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

const page = createLifecycleScope()
page.own('socket', { force: () => console.log('socket closed') })
page.own('cache', {
  force: () => {
    throw new Error('cache file is locked')
  }
})
page.own('timer', { force: () => console.log('timer cleared') })

try {
  await page.dispose()
} catch (error) {
  const failure = error as Error & { code?: string }
  console.log('dispose() failed:', failure.message, \`(\${failure.code})\`)
}
console.log('scope state:', page.lifecycle)`,
        zh: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

const page = createLifecycleScope()
page.own('socket', { force: () => console.log('关闭 socket') })
page.own('cache', {
  force: () => {
    throw new Error('缓存文件被占用')
  }
})
page.own('timer', { force: () => console.log('清除计时器') })

try {
  await page.dispose()
} catch (error) {
  const failure = error as Error & { code?: string }
  console.log('dispose() 失败:', failure.message, \`(\${failure.code})\`)
}
console.log('作用域状态:', page.lifecycle)`
      },
      result: t(
        "Prints `timer cleared`, `socket closed`, then `dispose() failed: cache file is locked (SCOPE_DISPOSAL_FAILED)` and `scope state: terminal`.\n\nThe failure did not stop the other releases, and the original error was kept. Use `errorPolicy: 'collect'` to receive failures as an array, or `'report'` to send them to a logger.",
        "依次输出 `清除计时器`、`关闭 socket`，然后是 `dispose() 失败: 缓存文件被占用 (SCOPE_DISPOSAL_FAILED)` 和 `作用域状态: terminal`。\n\n失败没有阻断其他释放，原始错误也保留了下来。用 `errorPolicy: 'collect'` 可以把失败作为数组拿回来，用 `'report'` 交给日志函数。"
      )
    },
    {
      title: t(
        'A resource will not close: gracefully first, then by force',
        '资源关不掉时，先优雅、再强制'
      ),
      problem: t(
        'At shutdown a message consumer should finish the messages it holds, but it hangs, and the whole shutdown hangs with it.\n\nHand-written shutdown usually has one way to close: wait for a graceful close, possibly forever, or disconnect by force and drop the messages in hand.\n\nGive the descriptor both `graceful` and `force`: the scope waits up to `gracefulTimeoutMs` for `graceful`, then stops waiting and calls `force`, which must always complete.',
        '停机时消息消费者应该先处理完手头的消息，但它卡住了，整个停机也跟着卡住。\n\n手写停机通常只有一种关闭方式：要么一直等优雅关闭，可能永远等下去；要么直接强制断开，丢掉手头的消息。\n\n给释放说明同时提供 `graceful` 和 `force`：作用域最多等 `gracefulTimeoutMs`，超时后不再等待 `graceful`，改为调用一定能完成的 `force`。'
      ),
      example: {
        en: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
app.own('message-consumer', {
  // First ask the consumer to finish the messages it holds; it does not finish within 100 ms.
  graceful: () => new Promise((resolve) => setTimeout(resolve, 1_000).unref()),
  gracefulTimeoutMs: 100,
  // After the graceful attempt times out, disconnect by force.
  force: () => console.log('message consumer disconnected by force')
})
const started = performance.now()
await app.dispose()
console.log(\`shutdown took about \${Math.round((performance.now() - started) / 100) * 100} ms\`)`,
        zh: `import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
app.own('message-consumer', {
  // 先请求消费者处理完手头的消息；它在 100 毫秒内没完成。
  graceful: () => new Promise((resolve) => setTimeout(resolve, 1_000).unref()),
  gracefulTimeoutMs: 100,
  // 优雅关闭超时后，强制断开。
  force: () => console.log('强制断开消息消费者')
})
const started = performance.now()
await app.dispose()
console.log(\`停机用时约 \${Math.round((performance.now() - started) / 100) * 100} 毫秒\`)`
      },
      result: t(
        'Prints `message consumer disconnected by force`, then `shutdown took about 100 ms`.\n\nThe timed-out `graceful` is not cancelled, only no longer awaited; shutdown time now has an upper bound.',
        '输出 `强制断开消息消费者`，然后是 `停机用时约 100 毫秒`。\n\n超时的 `graceful` 不会被取消，只是不再被等待；停机时间有了上限。'
      )
    }
  ],
  createPendingTracker: [
    {
      title: t('Let in-flight requests finish before shutting down', '停机前等进行中的请求完成'),
      problem: t(
        'During a deploy a request that is writing to the database is cut off, and the client gets a 502.\n\nHand-written code that exits on SIGTERM does not know how many requests are still in progress; waiting for them means keeping a counter by hand and handling the cases where it goes wrong.\n\nRegister every request with `track()`, and on shutdown wait for `drain()` with a deadline, then close the connection pool.',
        '发布新版本时，正在写数据库的请求被砍断，客户端收到 502。\n\n收到 SIGTERM 就退出的手写代码不知道还有多少请求在处理中；想等它们，又得自己维护计数并处理计数出错的情况。\n\n用 `track()` 登记每个请求，停机时带截止时间等待 `drain()`，然后再关闭连接池。'
      ),
      example: {
        en: `import { createServer } from 'node:http'
import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()

// Registered first, released last: the database pool closes at the end.
app.own('db-pool', { force: () => console.log('3. database pool closed') })

const server = createServer((request, response) => {
  // Every request is registered as work in flight; handling takes 200 ms.
  void inFlight.track(
    new Promise<void>((resolve) =>
      setTimeout(() => {
        response.end('order saved')
        resolve()
      }, 200)
    )
  )
})
app.own(server, {
  force: async () => {
    server.close() // stop accepting new connections
    console.log('1. stopped accepting requests, waiting for in-flight ones')
    const finished = await boundedWait(inFlight.drain(), performance.now() + 5_000)
    console.log(finished ? '2. all in-flight requests finished' : '2. timed out, closing anyway')
    server.closeAllConnections() // drop remaining idle keep-alive connections
  }
})
server.listen(0)

// In a real service: process.once('SIGTERM', () => void app.dispose())
const { port } = server.address() as { port: number }
const order = fetch(\`http://localhost:\${port}/orders\`, { method: 'POST' }).then((r) => r.text())
await new Promise((resolve) => setTimeout(resolve, 50)) // shut down while the request is in progress
await app.dispose()
console.log('client received:', await order)`,
        zh: `import { createServer } from 'node:http'
import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()

// 先登记的后释放：数据库连接池最后关闭。
app.own('db-pool', { force: () => console.log('3. 关闭数据库连接池') })

const server = createServer((request, response) => {
  // 每个请求都登记为“进行中的工作”，处理需要 200 毫秒。
  void inFlight.track(
    new Promise<void>((resolve) =>
      setTimeout(() => {
        response.end('订单已保存')
        resolve()
      }, 200)
    )
  )
})
app.own(server, {
  force: async () => {
    server.close() // 不再接受新连接
    console.log('1. 停止接收新请求，等待进行中的请求')
    const finished = await boundedWait(inFlight.drain(), performance.now() + 5_000)
    console.log(finished ? '2. 进行中的请求都已完成' : '2. 等待超时，继续关闭')
    server.closeAllConnections() // 断开剩下的空闲长连接
  }
})
server.listen(0)

// 真实服务里写成：process.once('SIGTERM', () => void app.dispose())
const { port } = server.address() as { port: number }
const order = fetch(\`http://localhost:\${port}/orders\`, { method: 'POST' }).then((r) => r.text())
await new Promise((resolve) => setTimeout(resolve, 50)) // 请求处理到一半时开始停机
await app.dispose()
console.log('客户端收到:', await order)`
      },
      result: t(
        'Prints steps 1, 2 and 3 in order, then `client received: order saved`.\n\nThe request in progress when shutdown began still completed, and the pool closed only after it.',
        '依次输出第 1、2、3 步，然后是 `客户端收到: 订单已保存`。\n\n停机开始时正在处理的请求依然完成了，连接池在它之后才关闭。'
      )
    }
  ],
  boundedWait: [
    {
      title: t('Never let one stuck request hang the shutdown', '不让一个卡住的请求挂住整个停机'),
      problem: t(
        'An export request needs 10 seconds, but the platform kills the process 30 seconds after SIGTERM, before the later shutdown steps get to run.\n\nA hand-written `await drain()` has no deadline, so one stuck request can hold up the whole shutdown; adding a deadline with `Promise.race` easily leaves timers behind.\n\n`boundedWait` returns `false` at the deadline so shutdown continues; it does not cancel the request, it just stops waiting. The deadline is on the `performance.now()` clock, not `Date.now()`.',
        '一个导出请求需要 10 秒，而平台在 SIGTERM 之后 30 秒就会强制结束进程，后面的停机步骤还没来得及执行。\n\n手写的 `await drain()` 没有时限，一个卡住的请求就能拖住整个停机；用 `Promise.race` 加时限又容易留下没清理的计时器。\n\n`boundedWait` 到截止时间返回 `false`，停机流程继续往下走；它不会取消那个请求，只是不再等它。截止时间使用 `performance.now()` 的时间轴，不是 `Date.now()`。'
      ),
      example: {
        en: `import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()
app.own('db-pool', { force: () => console.log('database pool closed') })
app.own('http', {
  force: async () => {
    const finished = await boundedWait(inFlight.drain(), performance.now() + 300)
    console.log(finished ? 'all in-flight requests finished' : \`\${inFlight.size} request(s) still running, closing anyway\`)
  }
})

// An export request that takes 10 seconds. unref() keeps it from holding the example process open.
void inFlight.track(new Promise((resolve) => setTimeout(resolve, 10_000).unref()))
await app.dispose()`,
        zh: `import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()
app.own('db-pool', { force: () => console.log('关闭数据库连接池') })
app.own('http', {
  force: async () => {
    const finished = await boundedWait(inFlight.drain(), performance.now() + 300)
    console.log(finished ? '进行中的请求都已完成' : \`还有 \${inFlight.size} 个请求没完成，继续关闭\`)
  }
})

// 一个需要 10 秒的导出请求。unref() 让它不阻止示例进程退出。
void inFlight.track(new Promise((resolve) => setTimeout(resolve, 10_000).unref()))
await app.dispose()`
      },
      result: t(
        'Prints `1 request(s) still running, closing anyway`, then `database pool closed`, about 300 ms after shutdown began.\n\nWaiting now has an upper bound, and the later shutdown steps run on time.',
        '停机开始约 300 毫秒后输出 `还有 1 个请求没完成，继续关闭`，然后是 `关闭数据库连接池`。\n\n等待有了上限，后面的停机步骤按时执行。'
      )
    }
  ],
  createGenerationController: [
    {
      title: t('Show only the latest search result', '搜索框只显示最新一次请求的结果'),
      problem: t(
        'The user types "a" and then "ab"; the slow answer for "a" arrives last and overwrites the newer result.\n\nHand-written code writes each result as it arrives, so whichever answers last wins; preventing that means keeping request numbers by hand and comparing them at every exit.\n\nCall `begin()` before each request: it makes the previous request stale and aborts its signal. Before using a result, check `isCurrent(token)`.',
        '用户输入 “a” 又输入 “ab”，“a” 的慢响应最后到达，把新结果覆盖了。\n\n手写时每个请求返回后都直接写结果，谁最后返回谁就赢；要防止覆盖，得自己维护请求编号并在每个出口比较。\n\n每次请求前调用 `begin()`：它会让上一次请求过期并取消它的信号。使用结果之前，先用 `isCurrent(token)` 确认它仍是最新的。'
      ),
      example: {
        en: `import { createGenerationController } from '@migaia/lifecycle/generation'

// A fake search API: shorter keywords match more and answer more slowly.
const search = (keyword: string, signal: AbortSignal) =>
  new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => resolve([\`results for \${keyword}\`]), keyword.length === 1 ? 300 : 100)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })

const requests = createGenerationController()
let shown: string[] = []

async function onInput(keyword: string) {
  const request = requests.begin() // a newer input makes the previous request stale and aborts it
  try {
    const results = await search(keyword, request.signal)
    if (requests.isCurrent(request.token)) shown = results
  } catch (error) {
    if (!requests.isCurrent(request.token)) return // replaced by newer input; ignore
    throw error
  }
}

// The user types "a" and immediately "ab".
await Promise.all([onInput('a'), onInput('ab')])
console.log('page shows:', shown)`,
        zh: `import { createGenerationController } from '@migaia/lifecycle/generation'

// 模拟搜索接口：越短的关键词结果越多，返回得越慢。
const search = (keyword: string, signal: AbortSignal) =>
  new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => resolve([\`\${keyword} 的结果\`]), keyword.length === 1 ? 300 : 100)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })

const requests = createGenerationController()
let shown: string[] = []

async function onInput(keyword: string) {
  const request = requests.begin() // 新的输入会让上一次请求过期，并取消它
  try {
    const results = await search(keyword, request.signal)
    if (requests.isCurrent(request.token)) shown = results
  } catch (error) {
    if (!requests.isCurrent(request.token)) return // 被新输入取代，忽略
    throw error
  }
}

// 用户快速输入 “a”，紧接着输入 “ab”。
await Promise.all([onInput('a'), onInput('ab')])
console.log('页面显示:', shown)`
      },
      result: t(
        'Prints `page shows: [ \'results for ab\' ]`.\n\nThe request for "a" was aborted as soon as "ab" began, so its answer never reached the page.',
        "输出 `页面显示: [ 'ab 的结果' ]`。\n\n“ab” 开始时 “a” 的请求就被取消了，它的结果不会出现在页面上。"
      )
    }
  ],
  createProvisionalScope: [
    {
      title: t(
        'Reclaim what was created when setup fails halfway',
        '初始化到一半失败时，回收已经创建的资源'
      ),
      problem: t(
        "Installing a plugin connects a database and opens a cache, then step three fails and the first two stay open.\n\nHand-written setup must remember to reclaim everything created so far at every failing step; with enough steps the cleanup is longer than the setup, and easy to get wrong.\n\nRegister each step's resource in a provisional scope: `commitTo(app)` hands everything over on success, and `rollback()` releases it in reverse order on failure.",
        '安装插件时连上了数据库、打开了缓存，第三步却失败了，前两个资源一直开着。\n\n手写的初始化要在每一步失败时记得回收之前的所有资源，步骤一多，回收代码就比初始化代码还长，而且很容易漏。\n\n把每一步创建的资源先登记到临时作用域：成功时用 `commitTo(app)` 整体交给应用，失败时用 `rollback()` 按相反顺序回收。'
      ),
      example: {
        en: `import { createProvisionalScope } from '@migaia/lifecycle'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()

// Installing a plugin takes three steps: connect the database, open the cache, register routes.
async function installPlugin(failAtStep3: boolean) {
  const setup = createProvisionalScope()
  try {
    setup.own('db', { force: () => console.log('  reclaimed: database disconnected') })
    setup.own('cache', { force: () => console.log('  reclaimed: cache closed') })
    if (failAtStep3) throw new Error('route conflict')
    await setup.commitTo(app) // all steps succeeded: hand everything to the app scope
    console.log('plugin installed')
  } catch (error) {
    await setup.rollback() // a step failed: release what was created, in reverse order
    console.log('install failed:', (error as Error).message)
  }
}

await installPlugin(true)
await installPlugin(false)
console.log('app shutting down:')
await app.dispose()`,
        zh: `import { createProvisionalScope } from '@migaia/lifecycle'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()

// 安装插件分三步：连数据库、开缓存、注册路由。
async function installPlugin(failAtStep3: boolean) {
  const setup = createProvisionalScope()
  try {
    setup.own('db', { force: () => console.log('  回收：断开数据库') })
    setup.own('cache', { force: () => console.log('  回收：关闭缓存') })
    if (failAtStep3) throw new Error('路由冲突')
    await setup.commitTo(app) // 全部成功：整体交给应用作用域
    console.log('插件已安装')
  } catch (error) {
    await setup.rollback() // 失败：已经创建的资源按相反顺序回收
    console.log('安装失败:', (error as Error).message)
  }
}

await installPlugin(true)
await installPlugin(false)
console.log('应用关闭：')
await app.dispose()`
      },
      result: t(
        'The failed install reclaims the cache and then the database before printing `install failed: route conflict`.\n\nThe successful one prints `plugin installed`, and its resources are released with the app scope at shutdown.',
        '失败的那次先回收缓存、再回收数据库，然后输出 `安装失败: 路由冲突`。\n\n成功的那次输出 `插件已安装`，它的资源在应用关闭时随应用作用域一起释放。'
      )
    }
  ],
  createMutationQueue: [
    {
      title: t('Keep autosaves in submission order', '自动保存按提交顺序落地'),
      problem: t(
        'Two autosaves are sent almost at once, and the slower, older one lands last and overwrites newer content.\n\nHand-written autosave sends each request right away, so the network decides the order they reach the server, not the order they were submitted.\n\nA mutation queue runs one task at a time, so the second save starts only after the first has finished.',
        '两次自动保存几乎同时发出，较慢的旧请求最后到达，把新内容覆盖掉了。\n\n手写的自动保存每次都直接发请求，到达服务器的顺序由网络决定，不由提交顺序决定。\n\n变更队列一次只执行一个任务，第二次保存要等第一次完成后才开始。'
      ),
      example: {
        en: `import { createMutationQueue } from '@migaia/lifecycle'

// A fake server: the first save is slower than the second.
let stored = ''
const save = (text: string, delayMs: number) =>
  new Promise<void>((resolve) =>
    setTimeout(() => {
      stored = text
      resolve()
    }, delayMs)
  )

// Sent concurrently: the slow old version arrives last and overwrites the new one.
await Promise.all([save('draft v1', 100), save('draft v2', 10)])
console.log('without a queue the server keeps:', stored)

// Through a mutation queue: the later save waits for the earlier one.
const queue = createMutationQueue()
await Promise.all([
  queue.enqueue(() => save('draft v1', 100)),
  queue.enqueue(() => save('draft v2', 10))
])
console.log('with a queue the server keeps:', stored)`,
        zh: `import { createMutationQueue } from '@migaia/lifecycle'

// 模拟服务器：第一次保存的请求比第二次慢。
let stored = ''
const save = (text: string, delayMs: number) =>
  new Promise<void>((resolve) =>
    setTimeout(() => {
      stored = text
      resolve()
    }, delayMs)
  )

// 直接并发发送：慢的旧版本最后到达，覆盖了新版本。
await Promise.all([save('草稿 v1', 100), save('草稿 v2', 10)])
console.log('不排队时服务器保存的是:', stored)

// 交给变更队列：后一次保存等前一次完成后才开始。
const queue = createMutationQueue()
await Promise.all([
  queue.enqueue(() => save('草稿 v1', 100)),
  queue.enqueue(() => save('草稿 v2', 10))
])
console.log('排队后服务器保存的是:', stored)`
      },
      result: t(
        'Prints `without a queue the server keeps: draft v1`, then `with a queue the server keeps: draft v2`.\n\nWith the queue, the final content on the server is the last one submitted.',
        '输出 `不排队时服务器保存的是: 草稿 v1`，然后是 `排队后服务器保存的是: 草稿 v2`。\n\n排队之后，服务器上的最终内容就是最后一次提交的内容。'
      )
    }
  ]
}
