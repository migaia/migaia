import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

/** Keeps each localized explanation beside one complete public-entry example. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Complete option examples exercise the Store host rather than a generic PluginHost. */
export const storeMiddlewareOptionExamples = {
  state: `import { createRuntime } from '@migaia/reactive'
import { createStoreMiddlewareHost, createMutationPolicy, createReduxDevToolsAdapter, type IReduxDevToolsMessage } from '@migaia/store-middleware'
let state = { count: 0 }
const runtime = createRuntime()
const mutationPolicy = createMutationPolicy('actions-only')
const host = createStoreMiddlewareHost({
  identity: { name: 'cart' },
  execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 },
  pipeline: { mode: 'sync' },
  runtime, mutationPolicy,
  getState: () => state,
  applyState: (next) => { state = next }
})
let receive: (message: IReduxDevToolsMessage) => void = () => {}
await host.connectDevTools(createReduxDevToolsAdapter({
  init: (_state: typeof state) => {},
  send: (_action: unknown, _state: typeof state) => {},
  subscribe: (listener) => { receive = listener; return () => {} }
}, runtime))
receive({ type: 'DISPATCH', payload: { type: 'JUMP_TO_STATE' }, state: '{"count":3}' })
console.log(host.identity.name, host.pipelineMode, state.count)
await host.dispose()`,
  queue: `import { createRuntime } from '@migaia/reactive'
import { createManualScheduler } from '@migaia/utils/testing'
import { createStoreMiddlewareHost } from '@migaia/store-middleware'
const scheduler = createManualScheduler()
const host = createStoreMiddlewareHost({
  runtime: createRuntime(), getState: () => ({ count: 0 }),
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  queueAdmissionTimeoutMs: 20, scheduler
})
await host.use({ name: 'cart', install: () => ({ ready: true }) })
console.log(host.identity.name, host.pipelineMode)
await host.dispose()`,
  diagnostic: `import { createRuntime } from '@migaia/reactive'
import { createManualScheduler } from '@migaia/utils/testing'
import { createStoreMiddlewareHost } from '@migaia/store-middleware'
const scheduler = createManualScheduler()
const failures: string[] = []
const host = createStoreMiddlewareHost({
  runtime: createRuntime(), getState: () => ({ count: 0 }),
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  queueAdmissionDiagnosticMs: 10, scheduler,
  diagnostic: () => { throw new Error('diagnostic unavailable') },
  onDiagnosticFailure: (error) => { failures.push((error as Error).message) }
})
let late = () => {}
host.usePipeline((event, next) => { late = () => { next(event) } })
host.recordState('cart/update', { count: 0 }, { count: 1 })
late()
console.log(failures)
await host.dispose()`,
  cleanup: `import { createRuntime } from '@migaia/reactive'
import { createManualScheduler } from '@migaia/utils/testing'
import { createStoreMiddlewareHost } from '@migaia/store-middleware'
const scheduler = createManualScheduler()
const started = Promise.withResolvers<void>()
const release = Promise.withResolvers<void>()
const host = createStoreMiddlewareHost({
  runtime: createRuntime(), getState: () => ({ count: 0 }),
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  disposeStepTimeoutMs: 10, scheduler
})
await host.use({ name: 'slow', install: () => ({}), dispose: () => {
  started.resolve(); return release.promise
} })
const closing = host.dispose()
await started.promise
scheduler.advance(11)
const result = await closing
console.log(result.cleanupComplete)
release.resolve()
await result.physicalCompletion`,
  binding: `import { createStore } from '@migaia/store-light'
import { bindStoreMiddleware, createMutationPolicy } from '@migaia/store-middleware'
const mutationPolicy = createMutationPolicy('actions-only')
const store = createStore({ count: 0 }, { mutationPolicy })
const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 },
  mutationPolicy
})
host.runAction('cart/set', () => { store.count = 2 })
console.log(store.count)
await host.dispose()
store.$dispose()`,
  capture: `import { createStore } from '@migaia/store-light'
import { bindStoreMiddleware, loggerMiddleware } from '@migaia/store-middleware'
const store = createStore({ count: 0, email: 'ada@example.com' })
const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  actionPrefix: 'cart/',
  clone: (state) => ({ ...structuredClone(state), email: '[redacted]' })
})
const names: string[] = []
let captured: unknown
await host.use(loggerMiddleware((event, state) => {
  captured = state
  if (event.type === 'action' && event.phase === 'end') names.push(event.name)
}))
store.$runtime.runTracedAction('other/save', () => {})
store.$runtime.runTracedAction('cart/save', () => {})
console.log(names, (captured as { email: unknown }).email, store.email)
await host.dispose()
store.$dispose()`
}

/** Related option fields stay together in small, observable Store workflows. */
export const storeMiddlewareOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  host: [
    {
      title: t('Connect application state', '接入应用状态'),
      problem: t(
        'A custom state source needs a host for reads and DevTools replacements. runtime and getState are required; applyState enables replacements. Give diagnostics a name and share the mutation policy with guarded consumers. Store pipelines always run synchronously.',
        '自定义状态来源需要宿主提供读取和 DevTools 状态替换。runtime 与 getState 必填；applyState 启用替换。为诊断命名，并与受保护的使用者共享写入策略。存储流水线始终同步运行。'
      ),
      example: storeMiddlewareOptionExamples.state,
      result: t(
        'Prints cart sync 3; the replacement reaches the application state.',
        '输出 cart sync 3；替换值已写入应用状态。'
      ),
      covers: [
        'runtime',
        'getState',
        'applyState',
        'mutationPolicy',
        'identity',
        'identity.name',
        'execution',
        'execution.mutationTimeoutMs',
        'execution.pipelineDrainTimeoutMs',
        'pipeline',
        'pipeline.mode'
      ]
    },
    {
      title: t('Set an admission budget for interactive changes', '为交互式变更设置接纳预算'),
      problem: t(
        'An interactive host should reject a queued change that waits longer than 20 ms. Without queueAdmissionTimeoutMs, waiting is unlimited. This configures that budget and installs one immediately available plugin; it does not interrupt an install that already started.',
        '交互式宿主需要拒绝排队超过 20 毫秒的变更。不设置 queueAdmissionTimeoutMs 时，等待没有上限。这里配置预算并安装一个可以立即开始的插件；预算不会中断已经开始的安装。'
      ),
      example: storeMiddlewareOptionExamples.queue,
      result: t(
        'Prints DEFAULT sync; the immediately admitted plugin installs successfully. No queue timeout occurs in this run.',
        '输出 DEFAULT sync；立即接纳的插件安装成功。本次运行没有发生排队超时。'
      ),
      covers: ['queueAdmissionTimeoutMs', 'scheduler']
    },
    {
      title: t('Keep a failing diagnostic sink observable', '观察诊断接收方自身的失败'),
      problem: t(
        'The diagnostic channel receives late next() calls and long queue waits. queueAdmissionDiagnosticMs changes the wait-warning threshold from 1000 ms to 10 ms without rejecting queued work. onDiagnosticFailure receives a failing diagnostic callback. This example triggers that same channel with a late next() call.',
        '诊断通道接收迟到的 next() 调用和长时间排队提示。queueAdmissionDiagnosticMs 把等待提示阈值从 1000 毫秒改为 10 毫秒，不拒绝排队工作。onDiagnosticFailure 接收诊断回调自身的失败。这里用迟到的 next() 调用触发同一通道。'
      ),
      example: storeMiddlewareOptionExamples.diagnostic,
      result: t(
        "Prints ['diagnostic unavailable']; failure of the diagnostic callback reaches the configured receiver.",
        "输出 ['diagnostic unavailable']；诊断回调的失败交给配置的接收方。"
      ),
      covers: ['queueAdmissionDiagnosticMs', 'diagnostic', 'onDiagnosticFailure', 'scheduler']
    },
    {
      title: t('Bound one slow cleanup step', '限制单个慢速清理步骤'),
      problem: t(
        'A plugin disposer may keep waiting after its screen closes. disposeStepTimeoutMs limits the ordinary cleanup wait; the default is 5000 ms and false removes the limit. The underlying Promise remains owned until it settles.',
        '页面关闭后，插件释放函数可能仍在等待。disposeStepTimeoutMs 限制普通清理等待；默认为 5000 毫秒，false 关闭限制。底层 Promise 仍被持有，直到它结算。'
      ),
      example: storeMiddlewareOptionExamples.cleanup,
      result: t(
        'Prints false while physical cleanup is pending; resolving release finishes physicalCompletion.',
        '物理清理未完成时输出 false；放行后 physicalCompletion 完成。'
      ),
      covers: ['disposeStepTimeoutMs', 'scheduler']
    }
  ],
  binding: [
    {
      title: t('Share a strict Store policy', '共享严格的 Store 策略'),
      problem: t(
        'A Store guarded by actions-only must use the exact same mutation policy as its binding. Otherwise host.runAction does not grant that Store permission. Required execution budgets bound plugin changes and draining.',
        '采用 actions-only 守卫的 Store 必须与绑定使用同一个写入策略对象。否则 host.runAction 不会授予该 Store 写入许可。必填执行预算限制插件变更和排空。'
      ),
      example: storeMiddlewareOptionExamples.binding,
      result: t(
        'Prints 2; the shared policy permits this action.',
        '输出 2；共享策略允许这次动作。'
      ),
      covers: [
        'execution',
        'execution.mutationTimeoutMs',
        'execution.pipelineDrainTimeoutMs',
        'mutationPolicy'
      ]
    },
    {
      title: t('Filter actions and redact snapshots', '筛选动作并脱敏快照'),
      problem: t(
        'A support panel needs cart actions and snapshots without email addresses. Without actionPrefix, all runtime actions are forwarded; default cloning does not redact. clone changes diagnostic snapshots, while actionPrefix filters action names only.',
        '支持面板需要购物车动作和隐藏邮箱的快照。不设 actionPrefix 时转发全部运行时动作；默认克隆不会脱敏。clone 修改诊断快照，actionPrefix 只筛选动作名。'
      ),
      example: storeMiddlewareOptionExamples.capture,
      result: t(
        "Prints ['cart/save'], [redacted], and the live ada@example.com address.",
        "输出 ['cart/save']、[redacted] 和存活存储中的 ada@example.com。"
      ),
      covers: ['actionPrefix', 'clone']
    }
  ]
}

/** Store-domain middleware tasks with explicit ownership and deterministic output. */
export const storeMiddlewareCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  bindStoreMiddleware: [
    {
      title: t('Observe a Store and detach without disposing it', '观察 Store 并在解绑后继续使用'),
      problem: t(
        'A diagnostics panel needs action and state events from an existing Store. Closing the panel must stop those observations while leaving application state usable.\n\nWrapping an already traced Store action in another action adds duplicate action boundaries. Treating the binding as the Store owner also makes panel cleanup destroy live state.\n\nbindStoreMiddleware forwards the Store’s own traces and state notifications. Install store-light directly, use loggerMiddleware to collect event types, flush the Store Runtime, and dispose the binding separately.',
        '诊断面板需要观察已有 Store 的动作与状态事件；关闭面板应停止观察，同时让应用状态继续可用。\n\n把已经发出追踪事件的 Store 动作再包进一层动作，会增加重复边界；把绑定当作 Store 所有者，又会让面板清理销毁应用状态。\n\n`bindStoreMiddleware` 转发 Store 自身的动作追踪与状态通知；直接安装 `@migaia/store-light`，用 `loggerMiddleware` 收集事件类型，刷新 Store 运行时后，独立释放绑定。'
      ),
      example: t(
        "import { createStore } from '@migaia/store-light'\nimport { bindStoreMiddleware, loggerMiddleware } from '@migaia/store-middleware'\nconst events: string[] = []\nconst store = createStore({ count: 0, increment() { this.count += 1 } })\nconst host = bindStoreMiddleware(store, { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })\nawait host.use(loggerMiddleware((event) => { events.push(event.type) }))\nstore.increment()\nstore.$runtime.flush()\nconsole.log(events.filter((type) => type === 'action').length, events.includes('state'), store.count)\nawait host.dispose()\nevents.length = 0\nstore.increment()\nstore.$runtime.flush()\nconsole.log(events.length, store.count)\nawait store.$dispose()",
        "import { createStore } from '@migaia/store-light'\nimport { bindStoreMiddleware, loggerMiddleware } from '@migaia/store-middleware'\nconst events: string[] = []\nconst store = createStore({ count: 0, increment() { this.count += 1 } })\nconst host = bindStoreMiddleware(store, { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })\nawait host.use(loggerMiddleware((event) => { events.push(event.type) }))\nstore.increment()\nstore.$runtime.flush()\nconsole.log(events.filter((type) => type === 'action').length, events.includes('state'), store.count)\nawait host.dispose()\nevents.length = 0\nstore.increment()\nstore.$runtime.flush()\nconsole.log(events.length, store.count)\nawait store.$dispose()"
      ),
      result: t(
        'Prints `2 true 1` and `0 2`. The first action produces two action events and a state event; after binding disposal, another action changes the Store without reaching the old middleware.\n\nExecution budgets are required; false explicitly removes each deadline. The binding borrows Store and Runtime. Its default diagnostic clone is best effort and may retain unsupported subtrees by reference.',
        '逐行输出 `2 true 1`、`0 2`；首次动作产生两条动作事件及状态事件，绑定释放后，另一次动作仍改变 Store，却不再进入原中间件。\n\n执行预算必填，`false` 显式取消对应截止时间；绑定只借用 Store 和运行时，默认诊断克隆尽力复制，不支持的子树仍可能按引用共享。'
      )
    },
    {
      title: t(
        'Share one strict policy between a Store and its host',
        '让 Store 与宿主共享同一严格策略'
      ),
      problem: t(
        'A component must not assign state directly, while both a Store method and a host-managed action need permission to update that same state.\n\nCreating two actions-only policies gives each its own action depth. Entering the host policy cannot authorize writes guarded by a different Store policy.\n\nCreate one actions-only policy and pass the same object to createStore and bindStoreMiddleware. Install store-light directly; the Store enforces the guard and host.runAction enters that shared scope.',
        '组件不能直接赋值，但 Store 方法与宿主管理的动作都需要修改同一状态。\n\n分别创建两个 `actions-only` 策略会产生两套动作深度；进入宿主策略的作用域，不能替另一个 Store 策略授权写入。\n\n创建一份 `actions-only` 策略，把同一对象交给 `createStore` 与 `bindStoreMiddleware`；直接安装 `@migaia/store-light`，由 Store 执行守卫，`host.runAction` 进入共享作用域。'
      ),
      example: t(
        "import { createStore } from '@migaia/store-light'\nimport { bindStoreMiddleware, createMutationPolicy } from '@migaia/store-middleware'\n\nconst policy = createMutationPolicy('actions-only')\nconst store = createStore({ count: 0, increment() { this.count += 1 } }, { mutationPolicy: policy })\nconst host = bindStoreMiddleware(store, {\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  mutationPolicy: policy\n})\ntry {\n  try {\n    store.count = 1\n  } catch (error) {\n    if (!(error instanceof Error) || !('code' in error)) throw error\n    console.log(error.code)\n  }\n  host.runAction('set', () => { store.count = 2 })\n  console.log(host.mutationPolicy === policy, store.count)\n  store.increment()\n  console.log(store.count)\n} finally {\n  await host.dispose()\n  await store.$dispose()\n}",
        "import { createStore } from '@migaia/store-light'\nimport { bindStoreMiddleware, createMutationPolicy } from '@migaia/store-middleware'\n\nconst policy = createMutationPolicy('actions-only')\nconst store = createStore({ count: 0, increment() { this.count += 1 } }, { mutationPolicy: policy })\nconst host = bindStoreMiddleware(store, {\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  mutationPolicy: policy\n})\ntry {\n  try {\n    store.count = 1\n  } catch (error) {\n    if (!(error instanceof Error) || !('code' in error)) throw error\n    console.log(error.code)\n  }\n  host.runAction('set', () => { store.count = 2 })\n  console.log(host.mutationPolicy === policy, store.count)\n  store.increment()\n  console.log(store.count)\n} finally {\n  await host.dispose()\n  await store.$dispose()\n}"
      ),
      result: t(
        'Prints `ACTION_SCOPE_REQUIRED`, `true 2`, and `3`. Direct assignment is rejected, the host exposes the identical policy and can write inside its action, and the Store’s own action remains usable.\n\nThe default policy mode is off. A policy checks permission; it is not a transaction and cannot undo user side effects. Scope covers only synchronous execution, so reenter it around writes after await.',
        '逐行输出 `ACTION_SCOPE_REQUIRED`、`true 2`、`3`；直接赋值被拒绝，宿主持有同一个策略且能在动作内写入，Store 自身动作仍可使用。\n\n策略模式默认 `off`；它检查写入许可，不是事务，也不会撤销用户副作用，作用域只覆盖同步执行，`await` 后的写入须重新进入作用域。'
      )
    }
  ],
  createStoreMiddlewareHost: [
    {
      title: t(
        'Keep a diagnostic sink failure separate from a business failure',
        '区分诊断接收器失败与业务失败'
      ),
      problem: t(
        'A logging sink fails during action observation. The application must still run its business function, while a real business exception must reach the caller.\n\nCalling a diagnostic sink directly on the business path lets a logging outage abort the action. Swallowing every exception instead hides genuine business failure and can imply rollback that never occurred.\n\ncreateStoreMiddlewareHost isolates runAction observation and reports failures to the supplied Runtime. Install reactive directly; onError collects diagnostics, while the business callback still returns or throws.',
        '日志接收器在观察动作时失败；应用仍须执行业务函数，而真正的业务异常必须交给调用者。\n\n在业务路径上直接调用诊断接收器，会让日志故障中断动作；反过来吞掉所有异常，又会掩盖真实业务失败，还可能让人误以为状态已经回滚。\n\n`createStoreMiddlewareHost` 隔离 `runAction` 的观察事件，并向传入运行时报告失败；直接安装 `@migaia/reactive`，本例用 `onError` 收集诊断，业务回调仍正常返回或抛错。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { createStoreMiddlewareHost, loggerMiddleware } from '@migaia/store-middleware'\n\nconst reports: unknown[] = []\nconst runtime = createRuntime({ onError: (error) => { reports.push(error) } })\nconst state = { count: 0 }\nconst diagnostic = new Error('diagnostic sink failed')\nconst business = new Error('business operation failed')\nconst host = createStoreMiddlewareHost({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  runtime,\n  getState: () => state\n})\ntry {\n  await host.use(loggerMiddleware(() => { throw diagnostic }))\n  const result = host.runAction('save', () => { state.count = 1; return 42 })\n  console.log(result, state.count, reports.length)\n  try {\n    host.runAction('fail', () => { state.count = 2; throw business })\n  } catch (error) {\n    console.log(error === business, state.count, reports.length)\n  }\n} finally {\n  await host.dispose()\n}",
        "import { createRuntime } from '@migaia/reactive'\nimport { createStoreMiddlewareHost, loggerMiddleware } from '@migaia/store-middleware'\n\nconst reports: unknown[] = []\nconst runtime = createRuntime({ onError: (error) => { reports.push(error) } })\nconst state = { count: 0 }\nconst diagnostic = new Error('诊断接收器失败')\nconst business = new Error('业务操作失败')\nconst host = createStoreMiddlewareHost({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  runtime,\n  getState: () => state\n})\ntry {\n  await host.use(loggerMiddleware(() => { throw diagnostic }))\n  const result = host.runAction('save', () => { state.count = 1; return 42 })\n  console.log(result, state.count, reports.length)\n  try {\n    host.runAction('fail', () => { state.count = 2; throw business })\n  } catch (error) {\n    console.log(error === business, state.count, reports.length)\n  }\n} finally {\n  await host.dispose()\n}"
      ),
      result: t(
        'Prints `42 1 2` and `true 2 4`. The successful business result survives two diagnostic reports; the failed action throws the same business Error and leaves its prior assignment applied.\n\nrunAction and recordState/recordError isolate observation failures; public emit can throw pipeline failures. runAction batches synchronously and does not roll back writes or wait for a returned Promise.',
        '逐行输出 `42 1 2`、`true 2 4`；成功业务结果不受两次诊断报告影响，失败动作交付原业务错误，失败前的赋值仍已生效。\n\n`runAction`、`recordState/recordError` 隔离观察失败，公开 `emit` 则可能抛出流水线错误；`runAction` 同步批处理，不回滚写入，也不等待返回的 Promise。'
      )
    },
    {
      title: t(
        'Release bindings in reverse order and retain cleanup failures',
        '逆序释放绑定并保留清理失败'
      ),
      problem: t(
        'A panel owns two binding cleanups and a plugin resource. One binding cleanup fails, but the remaining binding and plugin must still be released.\n\nStopping on the first cleanup exception leaves later resources behind. Independent dispose calls can also repeat cleanup unless they share one terminal operation.\n\nAttach synchronous binding disposers to createStoreMiddlewareHost and register plugin cleanup through core.onDispose. Install reactive directly; host.dispose runs bindings in reverse order before delegated plugin cleanup.',
        '面板拥有两项绑定清理和一个插件资源；其中一项绑定清理失败，另一项绑定与插件仍须释放。\n\n遇到第一个清理异常就停止，会遗留后续资源；多个调用者各自启动释放，也可能重复执行同一清理。\n\n把同步绑定清理交给 `createStoreMiddlewareHost.attachBindingDisposer`，插件清理通过 `core.onDispose` 登记；直接安装 `@migaia/reactive`，`host.dispose` 先逆序执行绑定清理，再委托插件清理。'
      ),
      example: t(
        "import { createRuntime } from '@migaia/reactive'\nimport { createStoreMiddlewareHost, type IStoreMiddlewarePlugin } from '@migaia/store-middleware'\n\ntype IState = { count: number }\nconst order: string[] = []\nconst original = new Error('binding cleanup failed')\nconst host = createStoreMiddlewareHost({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  runtime: createRuntime(),\n  getState: () => ({ count: 0 })\n})\nhost.attachBindingDisposer(() => { order.push('first') })\nhost.attachBindingDisposer(() => { order.push('second'); throw original })\nconst plugin: IStoreMiddlewarePlugin<IState> = {\n  name: 'owned',\n  install: (core) => {\n    core.onDispose(() => { order.push('plugin') })\n    return {}\n  }\n}\nawait host.use(plugin)\nconst first = host.dispose()\nconst second = host.dispose()\nconsole.log(first === second)\nconst result = await first\nconsole.log(JSON.stringify(order))\nconsole.log(result.cleanupComplete, result.cleanupErrors.length, result.cleanupErrors[0] === original)",
        "import { createRuntime } from '@migaia/reactive'\nimport { createStoreMiddlewareHost, type IStoreMiddlewarePlugin } from '@migaia/store-middleware'\n\ntype IState = { count: number }\nconst order: string[] = []\nconst original = new Error('绑定清理失败')\nconst host = createStoreMiddlewareHost({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  runtime: createRuntime(),\n  getState: () => ({ count: 0 })\n})\nhost.attachBindingDisposer(() => { order.push('一号') })\nhost.attachBindingDisposer(() => { order.push('二号'); throw original })\nconst plugin: IStoreMiddlewarePlugin<IState> = {\n  name: 'owned',\n  install: (core) => {\n    core.onDispose(() => { order.push('插件') })\n    return {}\n  }\n}\nawait host.use(plugin)\nconst first = host.dispose()\nconst second = host.dispose()\nconsole.log(first === second)\nconst result = await first\nconsole.log(JSON.stringify(order))\nconsole.log(result.cleanupComplete, result.cleanupErrors.length, result.cleanupErrors[0] === original)"
      ),
      result: t(
        'Prints `true`, `["second","first","plugin"]`, and `true 1 true`. Calls share one disposal Promise, cleanup proceeds in the shown order, and the original failure remains in cleanupErrors.\n\ncleanupComplete describes completed delegated cleanup, not an empty error list; settled binding failures are still recorded. Binding disposers here are synchronous; this does not claim every plugin hook is serial.',
        '逐行输出 `true`、`["二号","一号","插件"]`、`true 1 true`；释放调用共享同一个 Promise，清理按输出顺序继续执行，原始失败保留在 `cleanupErrors`。\n\n`cleanupComplete` 表示委托清理已完成，不等于错误列表为空，已完成的绑定清理失败仍会记录；此处绑定清理函数是同步函数，不据此推断所有插件钩子都串行执行。'
      )
    }
  ],
  MutationPolicy: [
    {
      title: t('Reenter the action scope after an await', '在 await 后重新进入动作作用域'),
      problem: t(
        'An asynchronous flow starts inside an allowed action, awaits another step, then attempts a protected write. The later continuation must not inherit a permission scope that has already returned.\n\nKeeping one global action flag open until a Promise settles authorizes unrelated work in the meantime. Treating a synchronous guard as an async transaction also hides where permission ends.\n\nMutationPolicy.runInAction increments depth only while invoking its callback and restores it in finally. Check insideAction before and after returning, await the rejection, then explicitly reenter for a synchronous write.',
        '异步流程从获准动作开始，等待下一步后再尝试受保护写入；后续执行不应继承已经返回的同步许可作用域。\n\n一直把全局动作标记留到 Promise 完成，会让期间的无关工作也得到授权；把同步守卫当作异步事务，又会隐藏许可真正结束的位置。\n\n`MutationPolicy.runInAction` 只在调用回调期间增加深度，并在 `finally` 恢复；比较返回前后的 `insideAction`，等待失败后，再显式进入一次同步写入作用域。'
      ),
      example: t(
        "import { MutationPolicy } from '@migaia/store-middleware'\n\nconst policy = new MutationPolicy('actions-only')\nlet insideBeforeAwait = false\nconst pending = policy.runInAction(async () => {\n  insideBeforeAwait = policy.insideAction\n  await Promise.resolve()\n  policy.assertMutationAllowed('deferred write')\n})\nconsole.log(insideBeforeAwait, policy.insideAction)\ntry {\n  await pending\n} catch (error) {\n  if (!(error instanceof Error) || !('code' in error)) throw error\n  console.log(error.code, policy.insideAction)\n}\npolicy.runInAction(() => { policy.assertMutationAllowed('synchronous write') })\nconsole.log('reentered')",
        "import { MutationPolicy } from '@migaia/store-middleware'\n\nconst policy = new MutationPolicy('actions-only')\nlet insideBeforeAwait = false\nconst pending = policy.runInAction(async () => {\n  insideBeforeAwait = policy.insideAction\n  await Promise.resolve()\n  policy.assertMutationAllowed('deferred write')\n})\nconsole.log(insideBeforeAwait, policy.insideAction)\ntry {\n  await pending\n} catch (error) {\n  if (!(error instanceof Error) || !('code' in error)) throw error\n  console.log(error.code, policy.insideAction)\n}\npolicy.runInAction(() => { policy.assertMutationAllowed('synchronous write') })\nconsole.log('已重新进入')"
      ),
      result: t(
        'Prints `true false`, `ACTION_SCOPE_REQUIRED false`, and `reentered`. The async callback begins inside the scope, its continuation is denied after await, and explicit reentry succeeds.\n\nMode defaults to off; this example chooses actions-only. runInAction returns the callback result immediately, supports nested synchronous scopes, and does not await or automatically catch later Promise rejection.',
        '逐行输出 `true false`、`ACTION_SCOPE_REQUIRED false`、`已重新进入`；异步回调开始时在作用域内，`await` 后的执行被拒绝，显式重新进入后检查通过。\n\n模式默认 `off`，本例选择 `actions-only`；`runInAction` 立即返回回调结果，支持同步嵌套，不等待也不自动捕获稍后的 Promise 拒绝。'
      )
    }
  ],
  ClonePolicy: [
    {
      title: t(
        'Choose strict independence or explicit reference sharing',
        '明确选择独立副本或引用共享'
      ),
      problem: t(
        'Audit history needs independent nested data, while diagnostics may need to keep a callback that cannot be cloned. The caller must choose which guarantee matters.\n\nA generic fallback clone can silently return live references when history expected isolation. Calling a result immutable can also wrongly imply that the returned object is frozen.\n\nClonePolicy.immutable requires an independent supported data graph, opaque returns the same reference, and diagnostic copies what it can. The strict path rejects accessors without running their getters.',
        '审计历史需要独立的嵌套数据，诊断却可能需要保留无法克隆的回调；调用者必须明确选择需要哪种保证。\n\n含糊的回退克隆可能在历史记录要求隔离时，悄悄返回实时引用；把结果称作不可变，还可能让人误以为返回对象已经冻结。\n\n`ClonePolicy.immutable` 要求支持的数据图得到独立副本，`opaque` 返回原引用，`diagnostic` 尽力复制；严格路径在执行访问器 getter 前就拒绝该输入。'
      ),
      example: t(
        "import { ClonePolicy } from '@migaia/store-middleware/tolerant-clone'\n\nconst source = { nested: { count: 1 } }\nconst independent = ClonePolicy.immutable(source)\nconst same = ClonePolicy.opaque(source)\nsource.nested.count = 2\nconsole.log(independent.nested.count, same.nested.count, independent === source, same === source)\nlet reads = 0\nconst accessor = Object.defineProperty({}, 'value', {\n  enumerable: true,\n  get: () => { reads += 1; return 1 }\n})\ntry {\n  ClonePolicy.immutable(accessor)\n} catch (error) {\n  if (!(error instanceof Error) || !('code' in error)) throw error\n  console.log(error.code, reads)\n}\nconst callback = () => 1\nconst candidate = { nested: { count: 1 }, callback }\nconst diagnostic = ClonePolicy.diagnostic(candidate)\ncandidate.nested.count = 9\nconsole.log(diagnostic.nested.count, diagnostic.callback === callback)\nconsole.log(Object.isFrozen(independent))",
        "import { ClonePolicy } from '@migaia/store-middleware/tolerant-clone'\n\nconst source = { nested: { count: 1 } }\nconst independent = ClonePolicy.immutable(source)\nconst same = ClonePolicy.opaque(source)\nsource.nested.count = 2\nconsole.log(independent.nested.count, same.nested.count, independent === source, same === source)\nlet reads = 0\nconst accessor = Object.defineProperty({}, 'value', {\n  enumerable: true,\n  get: () => { reads += 1; return 1 }\n})\ntry {\n  ClonePolicy.immutable(accessor)\n} catch (error) {\n  if (!(error instanceof Error) || !('code' in error)) throw error\n  console.log(error.code, reads)\n}\nconst callback = () => 1\nconst candidate = { nested: { count: 1 }, callback }\nconst diagnostic = ClonePolicy.diagnostic(candidate)\ncandidate.nested.count = 9\nconsole.log(diagnostic.nested.count, diagnostic.callback === callback)\nconsole.log(Object.isFrozen(independent))"
      ),
      result: t(
        'Prints `1 2 false true`, `CLONE_UNSUPPORTED 0`, `1 true`, and `false`. The strict copy is independent, opaque aliases, the getter is not run, and diagnostic copies nested data while retaining the callback.\n\nIndependent does not mean frozen. immutable may throw ENV_UNSUPPORTED without structuredClone or CLONE_UNSUPPORTED for rejected data; diagnostic may share unsupported subtrees, while opaque always shares the original value.',
        '逐行输出 `1 2 false true`、`CLONE_UNSUPPORTED 0`、`1 true`、`false`；严格副本独立，不透明策略共享引用，getter 没被执行，诊断策略复制嵌套数据并保留回调身份。\n\n独立不等于冻结；缺少 `structuredClone` 时严格策略可能抛 `ENV_UNSUPPORTED`，不支持的数据可能抛 `CLONE_UNSUPPORTED`，诊断策略仍可能共享不支持的子树，不透明策略始终返回原值。'
      )
    }
  ]
}
