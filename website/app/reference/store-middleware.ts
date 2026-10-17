/**
 * Reference for `@migaia/store-middleware`, checked against package source and README 2026-10-17.
 * Source differences: the host composes plugin-host defineHost rather than inheriting PluginHost.
 * Public emit can propagate pipeline failures; runAction/recordState/recordError use isolated
 * emission. runAction and MutationPolicy scopes cover only synchronous callback execution. Object
 * spread snapshots the inherited revision getter at host construction; it is not a live revision
 * counter on the returned Store handle. Diagnostic clone may preserve uncloneable subtree
 * references, so the README claim of a newly independent snapshot on every binding read is too
 * strong. Invalid Redux state JSON is ignored.
 */
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'
import { pluginHostReference } from './plugin-host.js'

/** Builds localized prose without a fallback language. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Documents a field and its omission policy where applicable. */
const f = (en: string, zh: string, defaultEn?: string, defaultZh?: string): IMemberDoc => ({
  summary: t(en, zh),
  ...(defaultEn !== undefined && defaultZh !== undefined
    ? { default: t(defaultEn, defaultZh) }
    : {})
})

/** A host composition example owns its state and releases the delegated plugin lifecycle. */
const hostExample = `import { createRuntime } from '@migaia/reactive'
import { createStoreMiddlewareHost, middlewarePlugin, loggerMiddleware } from '@migaia/store-middleware'

let state = { count: 0 }
const host = createStoreMiddlewareHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtime: createRuntime(),
  getState: () => state,
  applyState: (next) => { state = next }
})
await host.use(middlewarePlugin('audit', (event, context, next) => {
  next()
  console.log(event.type, context.getState())
}), loggerMiddleware())
host.runAction('increment', () => { state = { count: state.count + 1 } })
host.recordState('updated', { count: 0 }, state)
console.log(state, host.mutationPolicy.insideAction)
const result = await host.dispose()
if (!result.cleanupComplete) await result.physicalCompletion`

/** Binding and Store must share the exact same strict mutation policy object. */
const bindingExample = `import { createStore } from '@migaia/store-light'
import { bindStoreMiddleware, createMutationPolicy, loggerMiddleware } from '@migaia/store-middleware'

const mutationPolicy = createMutationPolicy('actions-only')
const store = createStore({ count: 0, increment() { this.count++ } }, { mutationPolicy })
const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  mutationPolicy
})
await host.use(loggerMiddleware())
store.increment()
host.runAction('set', () => { store.count = 2 })
console.log(host.store.$plain())
await host.dispose()
await store.$dispose()`

/** Policy checks are synchronous and nest without leaking action depth on throw. */
const policyExample = `import { createMutationPolicy } from '@migaia/store-middleware'

const policy = createMutationPolicy('actions-only')
const value = policy.runInAction(() => {
  policy.assertMutationAllowed('settings.theme')
  console.log(policy.insideAction)
  return 42
})
console.log(value, policy.insideAction)`

/** A local extension-shaped connection demonstrates real message conversion without an extension. */
const adapterExample = `import { createRuntime } from '@migaia/reactive'
import { createReduxDevToolsAdapter, createStoreMiddlewareHost, type IReduxDevToolsMessage } from '@migaia/store-middleware'

let state = { count: 0 }
let receive: (message: IReduxDevToolsMessage) => void = () => {}
const adapter = createReduxDevToolsAdapter({
  init: (value: typeof state) => console.log(value),
  send: (action: unknown, value: typeof state) => console.log(action, value),
  subscribe: (listener) => { receive = listener; return () => { receive = () => {} } }
})
const host = createStoreMiddlewareHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtime: createRuntime(), getState: () => state, applyState: (next) => { state = next }
})
await host.connectDevTools(adapter)
receive({ type: 'DISPATCH', payload: { type: 'JUMP_TO_STATE' }, state: '{"count":3}' })
console.log(state)
await host.dispose()`

/** Snapshot choices expose their exact aliasing behavior. */
const cloneExample = `import { ClonePolicy, diagnosticClone, tolerantClone } from '@migaia/store-middleware/tolerant-clone'

const source = { nested: { count: 1 } }
const independent = ClonePolicy.immutable(source)
const same = ClonePolicy.opaque(source)
const diagnostic = ClonePolicy.diagnostic({ nested: source.nested, callback: () => 1 })
console.log(independent !== source, same === source, diagnostic.nested !== source.nested)
console.log(tolerantClone === diagnosticClone)`

/** Inherited methods use a real store event host rather than an unrelated generic example. */
const hostWith = (
  body: string
): string => `import { createRuntime, ReactiveErrorPhase } from '@migaia/reactive'
import { createStoreMiddlewareHost, loggerMiddleware, MiddlewareEventType } from '@migaia/store-middleware'

const host = createStoreMiddlewareHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtime: createRuntime(), getState: () => ({ count: 0 })
})
${body}
await host.dispose()`

/** Exact plugin-host examples for inherited operations that remain meaningful in sync mode. */
const inheritedExamples: Readonly<Record<string, string>> = {
  useSync: hostWith('const [plugin] = host.useSync(loggerMiddleware())\nconsole.log(plugin)'),
  use: hostWith('const [plugin] = await host.use(loggerMiddleware())\nconsole.log(plugin)'),
  unUse: hostWith(
    "await host.use(loggerMiddleware())\nconsole.log(await host.unUse('store-logger'))"
  ),
  activate: hostWith(
    "await host.use({ ...loggerMiddleware(), activation: 'lazy' })\nconsole.log(await host.activate('store-logger'))"
  ),
  replace: hostWith(
    "await host.use(loggerMiddleware())\nconsole.log(await host.replace('store-logger', loggerMiddleware((event) => console.log(event.type))))"
  ),
  runPipeline: hostWith(
    "host.runPipeline({ type: MiddlewareEventType.state, name: 'snapshot', timestamp: Date.now(), previous: { count: 0 }, next: { count: 1 } }, (event) => console.log(event.name))"
  ),
  dispose: hostWith('const result = await host.dispose()\nconsole.log(result.cleanupErrors)'),
  usePipeline: hostWith(
    "host.usePipeline((event, next) => { console.log(event.type); next(event) })\nhost.recordState('snapshot', { count: 0 }, { count: 1 })"
  ),
  useAsyncPipeline: hostWith(
    'try { host.useAsyncPipeline(async (event, next) => { await next(event) }) } catch (error) { console.error(error) }'
  ),
  useGeneratorPipeline: hostWith(
    'try { host.useGeneratorPipeline(function* (event) { return event }) } catch (error) { console.error(error) }'
  ),
  useAsyncGeneratorPipeline: hostWith(
    'try { host.useAsyncGeneratorPipeline(async function* (event) { return event }) } catch (error) { console.error(error) }'
  )
}

/** Shared external ownership remains canonical; only mode and examples are specialized here. */
const inheritedHostMembers: Readonly<Record<string, IMemberDoc>> = Object.fromEntries(
  Object.entries(pluginHostReference.types.IHostHandle!.members).map(([name, doc]) => [
    name,
    {
      ...doc,
      ...(inheritedExamples[name] ? { example: inheritedExamples[name] } : {}),
      ...(name === 'revision'
        ? {
            summary: t(
              'Revision snapshot copied from the underlying host at Store handle construction; later plugin commits do not refresh this number.',
              '存储句柄构造时从底层宿主复制的版本快照，后续插件提交不会刷新此数字。'
            )
          }
        : {}),
      ...(name === 'pipelineMode'
        ? {
            summary: t(
              'Always sync: store event host construction overrides any supplied pipeline mode.',
              '固定为同步模式，存储事件宿主构造会覆盖提供的任何流水线模式。'
            )
          }
        : {}),
      ...(['useAsyncPipeline', 'useGeneratorPipeline', 'useAsyncGeneratorPipeline'].includes(name)
        ? {
            summary: t(
              'Inherited host API whose required mode is unavailable here because store event hosts always use sync. Calling it rejects with the external PluginHost PIPELINE_MODE_MISMATCH contract.',
              '继承的宿主接口所需模式在此不可用，因为存储事件宿主始终同步，调用按外包流水线模式不匹配契约拒绝。'
            )
          }
        : {})
    }
  ])
)

/** Mutation guard methods are shared by the local class and externally reexported policy types. */
const policyMembers: Readonly<Record<string, IMemberDoc>> = {
  insideAction: f(
    'Whether synchronous nested action depth is currently greater than zero.',
    '同步嵌套动作深度当前是否大于零。'
  ),
  assertMutationAllowed: {
    summary: t(
      'Checks current action depth only when mode is actions-only. It is a guard called by a Store, not a subscription or automatic instrumentation hook.',
      '仅动作限定模式下检查当前动作深度，它是存储调用的守卫，不是订阅或自动插桩钩子。'
    ),
    params: {
      operation: t(
        'Optional caller diagnostic label, default mutation, describing the blocked write.',
        '可选调用者诊断标签，默认 `mutation`，描述被阻止写入。'
      )
    },
    returns: t(
      'No result on admission; actions-only outside action scope throws ACTION_SCOPE_REQUIRED. Off always admits supported writes.',
      '接纳时无返回值，动作限定模式在动作外抛 `ACTION_SCOPE_REQUIRED`，关闭约束模式接纳支持的写入。'
    ),
    example: policyExample
  },
  runInAction: {
    summary: t(
      'Raises action depth for synchronous fn execution, supports nesting, and restores depth in finally even on throw. Async continuations run after scope exit.',
      '同步执行回调时增加动作深度，支持嵌套，抛错也在收尾恢复深度，异步后续执行发生于作用域退出后。'
    ),
    params: {
      fn: t(
        'Synchronous no-argument callback supplied by the caller; return any T, or throw the original business failure.',
        '调用者提供的同步无参数回调，返回任意结果或抛出原业务失败。'
      )
    },
    returns: t(
      'Exact fn result or original throw. Returned promises are not awaited and do not extend the action scope.',
      '返回精确回调结果或原抛错，返回的承诺不被等待，也不延长动作作用域。'
    ),
    example: policyExample
  }
}

/** Domain event fields describe variant presence instead of inventing unavailable values. */
const eventMembers: Readonly<Record<string, IMemberDoc>> = {
  type: {
    summary: t(
      'Discriminates action trace, state observation or diagnostic error; generated by host domain methods or the Store binding.',
      '区分动作追踪、状态观察或诊断错误，由宿主领域方法或存储绑定生成。'
    ),
    values: { enum: 'MiddlewareEventType' }
  },
  phase: {
    summary: t(
      'Action uses start/end/error; diagnostic error events instead carry a caller diagnostic phase string.',
      '动作使用开始、结束或失败阶段，诊断错误事件则携带调用者诊断阶段字符串。'
    )
  },
  name: f(
    'Application action or state-event name, supplied to runAction/recordState or forwarded from the original Runtime trace.',
    '应用动作或状态事件名称，传给领域方法或从原运行时追踪转发。'
  ),
  timestamp: f(
    'Wall-clock milliseconds from Date.now for host-generated events, or original Runtime trace timestamp when forwarded.',
    '宿主生成事件的墙上时钟毫秒值，转发时保留原运行时追踪时间戳。'
  ),
  durationMs: f(
    'Elapsed synchronous action duration on end/error variants, measured with performance.now where available and otherwise Date.now.',
    '结束或失败变体的同步动作耗时，有性能时钟则使用，否则使用墙上时钟。'
  ),
  error: f(
    'Original thrown business or diagnostic value, kept by identity on action-error or diagnostic-error variants.',
    '动作失败或诊断错误变体的原始抛出值，按身份保留。'
  ),
  previous: f(
    'Caller-supplied previous state snapshot; binding snapshot independence depends on the selected clone policy.',
    '调用者提供的前状态快照，绑定快照是否独立取决于所选复制策略。'
  ),
  next: f(
    'Caller-supplied next state snapshot, or one produced by binding after Store change.',
    '调用者提供的后状态快照，或绑定在存储变更后产生的快照。'
  ),
  metadata: f(
    'Optional caller-owned diagnostic record retained without deep copy.',
    '可选调用者诊断记录，不经深复制而保留。',
    'Omitted when no metadata is supplied.',
    '调用者不提供元数据时省略。'
  )
}

/** Host-level domain methods; inherited mutation and cleanup APIs remain plugin-host-owned. */
const domainMembers: Readonly<Record<string, IMemberDoc>> = {
  runtime: f(
    'External IRuntime supplied at construction or obtained from the bound Store.',
    '构造时提供或从绑定存储取得的外包运行时。'
  ),
  mutationPolicy: f(
    'Exact caller policy object or a newly created off policy; share the same policy with the Store when enforcing actions-only writes.',
    '调用者精确策略对象或新建无约束策略，执行动作限定写入时须与存储共享同一策略。'
  ),
  getState: {
    summary: t(
      'Synchronously asks the caller-owned getter for the current state snapshot.',
      '同步调用调用者拥有的读取器获取当前状态快照。'
    ),
    returns: t(
      'Current S; getter failures propagate and snapshot independence follows the caller clone policy.',
      '返回当前状态，读取器失败传播，快照独立性按调用者复制策略决定。'
    ),
    example: hostExample
  },
  applyState: {
    summary: t(
      'Synchronously delegates a state replacement to the caller-provided capability; does not implement storage itself.',
      '同步委托调用者提供的能力替换状态，自身不实现状态存储。'
    ),
    params: {
      state: t(
        'Replacement S supplied by a normalized jump/reset command or a domain caller.',
        '规范跳转或重置命令及领域调用者提供的替代状态。'
      )
    },
    returns: t(
      'No result; missing applyState throws DEVTOOLS_CAPABILITY and caller failures propagate.',
      '无返回值，缺少应用状态能力抛 `DEVTOOLS_CAPABILITY`，调用者失败传播。'
    ),
    example: adapterExample
  },
  reportError: {
    summary: t(
      'Routes an original observation failure to the Runtime reporter with its supplied phase.',
      '把原始观察失败及给定阶段转交运行时报告器。'
    ),
    params: {
      error: t(
        'Original failure supplied by a plugin or domain caller.',
        '插件或领域调用者提供的原始失败。'
      ),
      phase: t(
        'Runtime diagnostic phase chosen by the caller for this failure.',
        '调用者为当前失败选择的运行时诊断阶段。'
      )
    },
    returns: t(
      'No result; reporter containment belongs to the supplied Runtime.',
      '无返回值，报告器隔离归提供的运行时拥有。'
    ),
    example: hostWith(
      "await host.use({ name: 'report', install: (core) => { core.reportError(new Error('observer failed'), ReactiveErrorPhase.traceListener); return {} } })"
    )
  },
  emit: {
    summary: t(
      'Synchronously runs an event through the host pipeline. Missing continuation reports MIDDLEWARE_NOT_CHAINED; other pipeline failures may propagate from this public method.',
      '同步把事件送入宿主流水线，缺少继续调用报告 `MIDDLEWARE_NOT_CHAINED`，其他流水线失败可从公开方法传播。'
    ),
    params: {
      event: t(
        'IMiddlewareEvent from host domain methods, Store trace binding or explicit caller construction using the event constants.',
        '宿主领域方法、存储追踪绑定或调用者用事件常量显式构造的事件。'
      )
    },
    returns: t(
      'No result after synchronous delivery; this is the direct emission boundary rather than isolated business-action observation.',
      '同步交付后无返回值，此处为直接发射边界，业务动作观察使用隔离发射。'
    ),
    example: hostWith(
      "host.emit({ type: MiddlewareEventType.state, name: 'snapshot', timestamp: Date.now(), previous: { count: 0 }, next: { count: 1 } })"
    )
  },
  runAction: {
    summary: t(
      'Emits isolated start, runs fn inside mutation policy and Runtime batch, then emits isolated end or error. Synchronous business throws are rethrown unchanged; observer failures are reported.',
      '隔离发射开始，在变更策略及运行时批处理中执行回调，再隔离发射结束或失败，同步业务抛错原样重抛，观察失败被报告。'
    ),
    params: {
      name: t(
        'Application-selected action label propagated to all three action phases.',
        '应用选择、传播给动作各阶段的标签。'
      ),
      fn: t(
        'Synchronous no-argument business callback; return T or throw. Promises are returned without awaiting, so async continuations and rejections are outside action scope.',
        '同步无参数业务回调，返回值或抛错，承诺直接返回且不等待，因此异步后续及拒绝不在动作作用域内。'
      ),
      metadata: t(
        'Optional caller diagnostic record; defaults to absent and retains its reference.',
        '可选调用者诊断记录，默认省略且保留引用。'
      )
    },
    returns: t(
      'Exact fn return or original synchronous throw; action duration covers synchronous execution only.',
      '返回精确回调结果或原同步抛错，动作耗时仅覆盖同步执行。'
    ),
    example: hostExample
  },
  recordState: {
    summary: t(
      'Emits an isolated state observation without changing Store state. Middleware failures are reported rather than reaching the business caller.',
      '隔离发射状态观察而不修改存储状态，中间件失败被报告而不传给业务调用者。'
    ),
    params: {
      name: t('Application-selected state observation label.', '应用选择的状态观察标签。'),
      previous: t(
        'Previous snapshot owned by the caller or binding clone policy.',
        '调用者或绑定复制策略拥有的前快照。'
      ),
      next: t(
        'Next snapshot owned by the caller or binding clone policy.',
        '调用者或绑定复制策略拥有的后快照。'
      ),
      metadata: t(
        'Optional diagnostic record, absent by default and retained by reference.',
        '可选诊断记录，默认省略并按引用保留。'
      )
    },
    returns: t(
      'No result after isolated observation; state application is a separate capability.',
      '隔离观察后无返回值，状态应用属于另一个能力。'
    ),
    example: hostExample
  },
  recordError: {
    summary: t(
      'Emits one isolated diagnostic-error event. Reentrant calls while handling an error report directly to Runtime without starting another middleware pipeline.',
      '隔离发射一次诊断错误事件，处理错误期间重入时直接报告运行时，不启动另一轮中间件流水线。'
    ),
    params: {
      phase: t(
        'Caller diagnostic phase identifying the failed subsystem or operation.',
        '调用者标识失败子系统或操作的诊断阶段。'
      ),
      error: t(
        'Original diagnostic failure value retained by identity.',
        '按身份保留的原始诊断失败值。'
      ),
      metadata: t(
        'Optional caller metadata; defaults to absent and is not cloned.',
        '可选调用者元数据，默认省略且不复制。'
      )
    },
    returns: t(
      'No result; observation failures are routed to Runtime.',
      '无返回值，观察失败转交运行时。'
    ),
    example: hostWith("host.recordError('observer', new Error('failed'))")
  },
  connectDevTools: {
    summary: t(
      'Installs a plugin that initializes an adapter, sends events after downstream completion and subscribes to normalized commands. Pair with createReduxDevToolsAdapter when using a Redux extension-shaped connection.',
      '安装初始化适配器、在下游完成后发送事件并订阅规范命令的插件，使用扩展形状连接时搭配 `createReduxDevToolsAdapter`。'
    ),
    params: {
      adapter: t(
        'IDevToolsAdapter from createReduxDevToolsAdapter or caller implementation; init/send are required and subscribe is optional.',
        '来自扩展适配工厂或调用者实现的适配器，初始化及发送必填，订阅可选。'
      ),
      name: t(
        'Optional unique plugin name chosen by the application; defaults to store-devtools.',
        '应用选择的可选唯一插件名，默认 `store-devtools`。'
      )
    },
    returns: t(
      'Promise<void> after plugin installation. Invalid adapter uses INVALID_OPTION; install failures retain plugin-host semantics; jump/reset without applyState uses DEVTOOLS_CAPABILITY.',
      '插件安装后兑现空承诺，非法适配器使用 `INVALID_OPTION`，安装失败保留插件宿主语义，缺少应用状态能力的跳转或重置使用 `DEVTOOLS_CAPABILITY`。'
    ),
    example: adapterExample
  },
  attachBindingDisposer: {
    summary: t(
      'Registers one synchronous cleanup function to run in reverse order before delegated plugin-host disposal.',
      '登记一个同步清理函数，在委托插件宿主销毁前按逆序执行。'
    ),
    params: {
      disposer: t(
        'Caller-owned IDisposer accepting no arguments and returning nothing; throws are collected into structured disposal cleanupErrors.',
        '调用者拥有的无参数无返回值清理函数，抛错收集到结构化销毁错误列表。'
      )
    },
    returns: t(
      'No result; the host retains this cleanup until disposal.',
      '无返回值，宿主保留此清理直到销毁。'
    ),
    example: hostWith("host.attachBindingDisposer(() => console.log('released'))")
  },
  dispose: {
    ...inheritedHostMembers.dispose!,
    summary: t(
      'Stops host admission, runs binding disposers in reverse order, then delegates plugin lifecycle cleanup. Every disposer is attempted and binding errors precede plugin errors.',
      '停止宿主接纳，逆序执行绑定清理，再委托插件生命周期清理，尝试全部清理且绑定错误排在插件错误前。'
    ),
    returns: t(
      'Shared Promise<IPluginHostDisposalResult> with logicalTerminal, cleanupComplete and cleanupErrors. Binding throws are reported in this result; unfinished physical cleanup remains reachable through physicalCompletion.',
      '返回共享结构化销毁承诺，含逻辑终态、清理完成及错误列表，绑定抛错记录在结果，未完成物理清理可经物理完成承诺追踪。'
    ),
    example: hostExample
  }
}

/** Store handles expose only local methods actually copied into the returned handle. */
const hostDomainMembers: Readonly<Record<string, IMemberDoc>> = Object.fromEntries(
  Object.entries(domainMembers).filter(
    ([name]) => !['runtime', 'getState', 'applyState', 'reportError'].includes(name)
  )
)

/** Common event documentation selects only members actually present on each variant. */
const eventType = (summary: IText, keys: readonly string[], action = false) => ({
  summary,
  example: hostExample,
  members: Object.fromEntries(
    keys.map((key) => [
      key,
      key === 'phase' && action
        ? { ...eventMembers[key]!, values: { enum: 'MiddlewareEventPhase' } }
        : eventMembers[key]!
    ])
  )
})

/** Event and command enums express domain values rather than errors. */
const eventValues = {
  action: t(
    'A synchronous action trace with start, end or error phase.',
    '具有开始、结束或失败阶段的同步动作追踪。'
  ),
  state: t(
    'An observed previous/next state pair; the event itself does not apply a state mutation.',
    '观察到的前后状态对，事件自身不应用状态变更。'
  ),
  error: t(
    'A diagnostic failure event with a caller phase and original error.',
    '携带调用者阶段及原始错误的诊断失败事件。'
  )
}
/** Action phase semantics are independent from diagnostic error phase strings. */
const phaseValues = {
  start: t(
    'Emitted before synchronous business callback execution.',
    '在同步业务回调执行前发射的阶段。'
  ),
  end: t(
    'Emitted after synchronous callback return, including its synchronous duration.',
    '同步回调返回后发射并记录同步耗时的阶段。'
  ),
  error: t(
    'Emitted after synchronous callback throw, retaining original error and elapsed duration.',
    '同步回调抛错后发射，保留原错误及耗时。'
  )
}
/** DevTools state commands are normalized before the host sees them. */
const commandValues = {
  commit: t(
    'Reinitialize the adapter with current state without applying replacement state.',
    '以当前状态重新初始化适配器，不应用替代状态。'
  ),
  jump: t(
    'Apply a supplied historical state inside a host action.',
    '在宿主动作内应用提供的历史状态。'
  ),
  reset: t('Apply a supplied reset state inside a host action.', '在宿主动作内应用提供的重置状态。')
}
/** Package error categories retain their original failure ownership. */
const errorValues = {
  invalidOption: t(
    'Host construction options or a DevTools adapter fail supported shape admission.',
    '宿主构造选项或诊断适配器不符合支持的形状接纳。'
  ),
  middlewareNotChained: t(
    'A middleware omits continuation; reported to Runtime without undoing an already completed business write.',
    '中间件未继续，向运行时报告但不撤销已完成业务写入。'
  ),
  actionScopeRequired: t(
    'Actions-only mutation guard detects a direct write outside synchronous action scope.',
    '动作限定变更守卫检测到同步动作作用域外的直接写入。'
  ),
  cloneUnsupported: t(
    'Independent immutable cloning cannot preserve a supported input subtree; inspect original cause or choose an aliasing policy.',
    '独立不可变复制无法保留输入子树，需要检查原原因或选择允许共享的策略。'
  ),
  devtoolsCapability: t(
    'A jump or reset needs applyState but the host was created without it.',
    '跳转或重置需要应用状态能力，但宿主构造未提供。'
  ),
  envUnsupported: t(
    'Immutable cloning requires a missing host structuredClone capability.',
    '不可变复制要求的宿主结构化复制能力缺失。'
  ),
  cleanupFailed: t(
    'Binding startup rollback cleanup failed; aggregate errors retain primary failure first.',
    '绑定启动回滚清理失败，聚合错误首位保留主失败。'
  )
}

/** Full reference; imported plugin lifecycle and Store implementation remain canonical owners. */
export const storeMiddlewareReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Store observation and mutation policy composed with plugin-host lifecycle. Start with bindStoreMiddleware for an existing Store or createStoreMiddlewareHost for a custom state owner; install middleware with host.use.',
        '将存储观察及变更策略与插件宿主生命周期组合，已有存储从绑定开始，自定义状态拥有者从创建宿主开始，经宿主安装接口安装中间件。'
      ),
      example: bindingExample
    },
    'tolerant-clone': {
      summary: t(
        'Explicit snapshot strategies: immutable copies independently or throws, opaque preserves identity, diagnostic copies where possible and may alias unsupported subtrees. Start from ClonePolicy; tolerantClone is a deprecated diagnostic alias.',
        '显式快照策略：不可变复制要求独立否则抛错，不透明保留身份，诊断尽力复制且可共享不支持子树，从策略集合开始，宽容复制为旧诊断别名。'
      ),
      example: cloneExample
    }
  },
  symbols: {
    createMutationPolicy: {
      role: 'factory',
      purpose: t(
        'Creates a synchronous nestable mutation guard. To enforce Store writes, supply the same object to createStore and bindStoreMiddleware; a separate policy object cannot see another policy action depth.',
        '创建同步可嵌套变更守卫，约束存储写入时搭配 `bindStoreMiddleware` 并向存储工厂提供同一对象，独立策略对象无法读取彼此动作深度。'
      ),
      params: {
        mode: t(
          'off admits writes; actions-only requires nonzero synchronous action depth. Optional default is off.',
          '关闭约束值接纳写入，动作限定值要求同步动作深度非零，默认关闭约束。'
        )
      },
      returns: t(
        'MutationPolicy instance with insideAction, assertMutationAllowed and runInAction; no disposal is required.',
        '返回含动作内标记、写入检查及动作执行的策略实例，无需销毁。'
      ),
      example: bindingExample
    },
    MutationPolicy: {
      role: 'factory',
      purpose: t(
        'Class behind createMutationPolicy. Constructor accepts optional off or actions-only mode, default off; nested synchronous action depth is restored in finally and never extends across awaited continuations.',
        '变更策略工厂背后的类，构造接收可选无约束或动作限定模式，默认无约束，嵌套同步动作深度在收尾恢复，不跨等待后的继续执行。'
      ),
      params: {
        mode: t(
          'Optional IMutationPolicyMode; off is the default and actions-only enables action depth checks.',
          '可选变更策略模式，默认无约束，动作限定启用深度检查。'
        )
      },
      returns: t(
        'New MutationPolicy with independent synchronous action depth, initially zero; no resource cleanup is required and the caller must share this exact guard with protected stores.',
        '返回独立持有初始零同步动作深度的新策略，无需资源清理，调用者须向受保护状态容器共享此精确守卫。'
      ),
      example: policyExample
    },
    createStoreMiddlewareHost: {
      role: 'factory',
      purpose: t(
        'Composes a frozen store event host through external defineHost, not class inheritance. The caller owns state access and optional application; this host owns plugin lifecycle and binding cleanup. Pipeline mode is always sync.',
        '经外包宿主组合创建冻结存储事件句柄，调用者拥有状态访问及可选应用，当前宿主拥有插件生命周期与绑定清理，流水线始终同步。'
      ),
      options: 'IStoreMiddlewareHostOptions',
      returns: t(
        'IStoreMiddlewareHost with domain and inherited host members; dispose returns structured cleanup results. Invalid host options use INVALID_OPTION and delegated lifecycle failures retain plugin-host identity.',
        '返回带领域及继承宿主成员的句柄，销毁返回结构化清理结果，非法宿主选项使用 `INVALID_OPTION`，委托生命周期失败保留插件宿主身份。'
      ),
      example: hostExample
    },
    bindStoreMiddleware: {
      role: 'factory',
      purpose: t(
        'Binds state subscriptions and Runtime action traces from an existing Store into a new host. Pair with createMutationPolicy when strict writes are required, passing the exact same object to Store construction and this binding. Disposal detaches observers without disposing the Store.',
        '把已有存储状态订阅及运行时动作追踪绑定到新宿主，严格写入时搭配 `createMutationPolicy` 并向存储构造与绑定传同一对象，销毁只分离观察者而不销毁存储。'
      ),
      params: {
        store: t(
          'Existing IReactiveStore from @migaia/store-light createStore; its runtime, plain snapshots, hydrate and subscriptions are reused.',
          '由轻量存储工厂创建的已有响应存储，复用其运行时、普通快照、灌入及订阅能力。'
        )
      },
      options: 'IStoreMiddlewareBindingOptions',
      returns: t(
        'Frozen IStoreMiddlewareBinding with original store reference. Partial subscription failure rolls back; secondary rollback failures produce CLEANUP_FAILED aggregate with original primary first.',
        '返回含原存储引用的冻结绑定，部分订阅失败会回滚，次要回滚失败产生主失败在首位的 `CLEANUP_FAILED` 聚合错误。'
      ),
      example: bindingExample
    },
    middlewarePlugin: {
      role: 'enhancer',
      purpose: t(
        'Adapts a legacy synchronous (event, context, next) middleware to a plugin-host plugin. Pair with createStoreMiddlewareHost and install via use; omitting next stops downstream event delivery without reversing Store state.',
        '把旧式同步事件、上下文及继续回调适配为插件，搭配 `createStoreMiddlewareHost` 并经安装接口使用，省略继续回调停止下游事件交付而不反转存储状态。'
      ),
      params: {
        name: t(
          'Unique plugin name selected by the application for host registration and later removal.',
          '应用为宿主注册及后续移除选择的唯一插件名称。'
        ),
        middleware: t(
          'Synchronous callback receiving IMiddlewareEvent, runtime/getState context and a no-argument next callback. Call next() to continue; no result is used, async work is not awaited, and throws follow host pipeline handling.',
          '同步回调接收领域事件、运行时及读取状态上下文、无参数继续函数，调用继续函数交付下游，不使用结果或等待异步工作，抛错按宿主流水线处理。'
        )
      },
      returns: t(
        'IStoreMiddlewarePlugin descriptor with no added extension methods; installed behavior observes or filters the event pipeline.',
        '返回不新增扩展方法的插件描述，安装行为为观察或筛选事件流水线。'
      ),
      example: hostExample
    },
    loggerMiddleware: {
      role: 'enhancer',
      purpose: t(
        'Creates the store-logger plugin, which continues downstream first then calls its sink with the event and current state. Pair with createStoreMiddlewareHost and install using use; creating a descriptor alone produces no logs.',
        '创建固定名称日志插件，先继续下游再把事件及当前状态交给接收端，搭配 `createStoreMiddlewareHost` 安装，单独创建描述不产生日志。'
      ),
      params: {
        sink: t(
          'Optional synchronous (event, state) callback; event is the delivered middleware event and state is core.getState() after downstream. Defaults to console.log with the stable prefix; no return is used or awaited and throws follow pipeline handling.',
          '可选同步事件及状态回调，事件为已交付领域事件，状态为下游完成后的当前快照，默认带稳定前缀写控制台，不使用或等待返回值，抛错按流水线处理。'
        )
      },
      returns: t(
        'IStoreMiddlewarePlugin named store-logger, affecting existing pipeline behavior without adding methods.',
        '返回固定名称存储日志插件，仅改变已有流水线行为，不增加方法。'
      ),
      example: hostExample
    },
    createReduxDevToolsAdapter: {
      role: 'factory',
      purpose: t(
        'Wraps an existing extension-shaped connection as a domain adapter. Converts DISPATCH COMMIT to commit, JUMP_TO_STATE/JUMP_TO_ACTION/ROLLBACK to jump, and RESET to reset; invalid or missing state JSON is ignored. Pair with createStoreMiddlewareHost through connectDevTools.',
        '把已有扩展形状连接包装为领域适配器，提交转提交，状态跳转、动作跳转及回滚转跳转，重置转重置，非法或缺少状态文本被忽略，搭配 `createStoreMiddlewareHost` 的连接诊断方法使用。'
      ),
      params: {
        connection: t(
          'Caller-owned IReduxDevToolsConnection with synchronous init/send and subscribe returning a disposer; this adapter never opens or closes a browser extension connection.',
          '调用者拥有的扩展连接，包含同步初始化、发送及返回清理函数的订阅，适配器不会打开或关闭浏览器扩展连接。'
        )
      },
      returns: t(
        'IDevToolsAdapter forwarding initialization and event labels; its subscription disposer comes from the original connection.',
        '返回转发初始化及事件标签的领域适配器，订阅清理函数来自原连接。'
      ),
      example: adapterExample
    },
    immutableSnapshotClone: {
      role: 'operation',
      purpose: t(
        'Returns a truly independent snapshot through the shared immutableSnapshot owner or throws explicitly. Missing host structuredClone maps to ENV_UNSUPPORTED; unsupported cloning maps to CLONE_UNSUPPORTED with the original cause.',
        '通过共享不可变快照拥有者返回真正独立快照，否则显式抛错，缺少宿主结构化复制映射为 `ENV_UNSUPPORTED`，不支持复制映射为 `CLONE_UNSUPPORTED` 并保留原因。'
      ),
      params: {
        value: t(
          'Caller-owned value requiring independent snapshot storage.',
          '调用者拥有、要求独立快照存储的值。'
        )
      },
      returns: t(
        'Independent T or a coded native Error; never silently substitutes an aliased subtree for required independence.',
        '返回独立值或带码原生错误，不把要求独立的子树静默替换为共享引用。'
      ),
      example: cloneExample
    },
    opaqueReferenceClone: {
      role: 'operation',
      purpose: t(
        'Explicitly opts out of copying and returns the original value through the shared identitySnapshot implementation. This is appropriate only when the caller accepts live aliasing.',
        '显式退出复制，经共享身份快照实现返回原值，仅适合调用者接受存活共享引用的场景。'
      ),
      params: {
        value: t(
          'Caller value whose original reference should be retained.',
          '需要保留原始引用的调用者值。'
        )
      },
      returns: t(
        'Exactly the input value and identity; subsequent mutation can affect every holder.',
        '返回精确输入值及身份，后续修改可影响所有持有者。'
      ),
      example: cloneExample
    },
    diagnosticClone: {
      role: 'operation',
      purpose: t(
        'Uses structuredDiagnosticSnapshot for best-effort diagnostics: prefer native cloning, otherwise recurse through cloneable arrays and records while retaining unsupported subtrees by reference. It does not promise full independence.',
        '通过共享诊断快照尽力复制，优先原生复制，否则递归复制可复制数组及记录，对不支持子树保留引用，不承诺完整独立性。'
      ),
      params: {
        value: t(
          'Caller state or diagnostic value to snapshot without rejecting merely because a subtree is uncloneable.',
          '需要诊断快照的调用者状态或值，不因子树不可复制而拒绝。'
        )
      },
      returns: t(
        'Best-effort T with cloneable parts copied and unsupported references retained; ordinary uncloneable content does not throw.',
        '返回可复制部分已复制、不支持引用保留的尽力值，普通不可复制内容不抛错。'
      ),
      example: cloneExample
    },
    tolerantClone: {
      role: 'operation',
      purpose: t(
        'Deprecated alias of the exact diagnosticClone function object; call it with one value for the same best-effort result, and migrate callers to the explicit policy name.',
        '精确指向诊断复制函数对象的旧别名，单值调用取得相同尽力结果，调用者应改用显式策略名称。'
      ),
      params: {
        value: t(
          'Caller value forwarded unchanged to diagnosticClone.',
          '原样转交诊断复制实现的调用者值。'
        )
      },
      returns: t(
        'Same best-effort snapshot semantics as diagnosticClone; no additional wrapper or policy is applied.',
        '返回与诊断复制相同的尽力快照，不增加包装或策略。'
      ),
      example: cloneExample
    },
    ClonePolicy: {
      role: 'constant',
      purpose: t(
        'Groups three existing operation functions: immutable(value) requires independence or throws, opaque(value) returns identical input, diagnostic(value) permits unsupported subtree aliases. These are executable functions rather than mode strings.',
        '组合三个已有操作函数，不可变函数要求独立否则抛错，不透明函数原样返回，诊断函数允许不支持子树共享，成员是可调用函数而非模式字符串。'
      ),
      example: cloneExample
    },
    createStoreMiddlewareError: {
      role: 'operation',
      purpose: t(
        'Constructs a native Error tagged with STORE_MIDDLEWARE_SOURCE and the chosen code, retaining stack and optional original cause without replacing native error behavior.',
        '构造带规范中间件来源及所选码的原生错误，保留堆栈与可选原始原因，不替换原生错误行为。'
      ),
      params: {
        code: t(
          'Semantic code selected from StoreMiddlewareErrorCode.',
          '从规范中间件错误表选择的语义码。'
        ),
        message: t(
          'Caller-owned diagnostic message describing the concrete failure.',
          '调用者拥有、描述具体失败的诊断消息。'
        )
      },
      optionDocs: {
        cause: f(
          'Original caller-supplied thrown value retained by native cause identity.',
          '调用者提供的原始抛出值，经原生原因属性按身份保留。',
          'Omitted; no supplied cause is attached.',
          '默认省略，不附提供的原因。'
        )
      },
      returns: t(
        'Tagged native Error for the caller to return or throw.',
        '返回供调用者返回或抛出的带码原生错误。'
      ),
      example: `import { createStoreMiddlewareError, StoreMiddlewareErrorCode } from '@migaia/store-middleware'
console.log(createStoreMiddlewareError(StoreMiddlewareErrorCode.invalidOption, 'invalid options'))`
    },
    createStoreMiddlewareAggregateError: {
      role: 'operation',
      purpose: t(
        'Constructs a tagged native AggregateError retaining every original cleanup failure in errors; it does not replace member failures or assign a separate cause.',
        '构造带码原生聚合错误，经列表保留所有原始清理失败，不替换成员失败或另设原因。'
      ),
      params: {
        code: t(
          'Code from StoreMiddlewareErrorCode, typically cleanupFailed for binding rollback.',
          '规范中间件错误码，绑定回滚通常选择清理失败码。'
        ),
        errors: t(
          'Readonly caller list of original failures; put the original primary first when adding rollback failures.',
          '调用者只读原始失败列表，新增回滚失败时把原主失败放在首位。'
        ),
        message: t(
          'Caller-owned diagnostic text for the aggregate failure.',
          '调用者拥有的聚合失败诊断文本。'
        )
      },
      returns: t(
        'Native AggregateError with original failure values reachable through errors.',
        '返回原始失败值经错误列表可达的原生聚合错误。'
      ),
      example: `import { createStoreMiddlewareAggregateError, StoreMiddlewareErrorCode } from '@migaia/store-middleware'
console.log(createStoreMiddlewareAggregateError(StoreMiddlewareErrorCode.cleanupFailed, [new Error('cleanup')], 'binding failed'))`
    },
    STORE_MIDDLEWARE_SOURCE: {
      role: 'error',
      purpose: t(
        'Canonical @migaia/store-middleware error source. Combine with StoreMiddlewareErrorCode when classifying failures; plugin-host and Runtime errors keep their external ownership.',
        '规范中间件错误来源，与语义错误表一起分类失败，插件宿主及运行时错误保留外包归属。'
      ),
      example: `import { STORE_MIDDLEWARE_SOURCE } from '@migaia/store-middleware'
console.log(STORE_MIDDLEWARE_SOURCE)`
    },
    StoreMiddlewareErrorCode: {
      role: 'error',
      purpose: t(
        'Stable package codes for invalid host input, action guards, missing pipeline continuation, cloning capabilities, DevTools application and binding cleanup.',
        '非法宿主输入、动作守卫、流水线未继续、复制能力、诊断状态应用及绑定清理的稳定包错误码。'
      ),
      example: `import { StoreMiddlewareErrorCode } from '@migaia/store-middleware'
console.log(StoreMiddlewareErrorCode.actionScopeRequired)`
    },
    MiddlewareEventType: {
      role: 'constant',
      purpose: t(
        'Canonical action, state and error domain event discriminants emitted by Store hosts and bindings; use them for plugin event selection.',
        '存储宿主及绑定发射的规范动作、状态及错误领域判别值，供插件选择事件。'
      ),
      example: hostExample
    },
    MiddlewareEventPhase: {
      role: 'constant',
      purpose: t(
        'Canonical synchronous action phases start, end and error; diagnostic error events use separate caller phase strings.',
        '规范同步动作开始、结束及失败阶段，诊断错误事件另用调用者阶段字符串。'
      ),
      example: hostExample
    },
    MiddlewareCommandType: {
      role: 'constant',
      purpose: t(
        'Normalized DevTools commands commit, jump and reset; the adapter maps extension messages to these values before host state application.',
        '规范诊断提交、跳转及重置命令，适配器在宿主状态应用前把扩展消息转换为这些值。'
      ),
      example: adapterExample
    }
  },
  types: {
    MutationPolicy: {
      summary: t(
        'Caller-owned synchronous mutation guard from its class or factory. No resource disposal is needed; strict Store bindings must reuse this same object.',
        '由类或工厂产生的调用者同步变更守卫，无需资源销毁，严格存储绑定必须复用同一对象。'
      ),
      scenarios: [
        t(
          'Reject direct Store writes while admitting synchronous methods or explicit host actions.',
          '拒绝直接存储写入，同时允许同步方法或显式宿主动作。'
        )
      ],
      example: bindingExample,
      members: policyMembers
    },
    IMutationGuard: {
      summary: t(
        'External structural guard reexported from @migaia/store-light; a Store invokes assertMutationAllowed before supported writes.',
        '从轻量存储包重导出的外部结构化守卫，存储在支持的写入前调用检查。'
      ),
      example: bindingExample,
      members: { assertMutationAllowed: policyMembers.assertMutationAllowed! }
    },
    IMutationPolicy: {
      summary: t(
        'External Store guard plus runInAction callback scope, reexported without redefining its ownership in the light Store package.',
        '外包存储守卫加动作执行回调作用域，重导出且不改写轻量存储包拥有的契约。'
      ),
      example: bindingExample,
      members: {
        assertMutationAllowed: policyMembers.assertMutationAllowed!,
        runInAction: policyMembers.runInAction!
      }
    },
    IMutationPolicyMode: {
      summary: t(
        'Mode union: off admits mutation without action checks; actions-only requires positive synchronous nesting depth and rejects outside writes.',
        '模式联合：无约束接纳变更而不检查动作，动作限定要求同步嵌套深度为正并拒绝作用域外写入。'
      ),
      example: policyExample,
      members: {}
    },
    IMiddlewareActionEvent: eventType(
      t(
        'Action trace discriminated by start/end/error; start lacks duration and original error, end adds duration, error adds both duration and the original thrown value.',
        '按开始、结束及失败区分的动作追踪，开始无耗时及错误，结束增加耗时，失败再增加原抛出值。'
      ),
      ['type', 'phase', 'name', 'timestamp', 'durationMs', 'error', 'metadata'],
      true
    ),
    IMiddlewareStateEvent: eventType(
      t(
        'State observation with caller-owned previous/next snapshots; emitting it never applies the state itself.',
        '包含调用者前后快照的状态观察，发射事件本身不应用状态。'
      ),
      ['type', 'name', 'timestamp', 'previous', 'next', 'metadata']
    ),
    IMiddlewareErrorEvent: eventType(
      t(
        'Diagnostic error event with caller phase and original failure, separate from an action-error phase.',
        '包含调用者阶段及原始失败的诊断错误事件，与动作失败阶段分开。'
      ),
      ['type', 'phase', 'timestamp', 'error', 'metadata']
    ),
    IMiddlewareEvent: eventType(
      t(
        'Union of action, state and diagnostic-error domain events; inspect type then the relevant variant fields rather than assuming every event contains state or duration.',
        '动作、状态及诊断错误领域事件联合，先检查类型再读取相应变体字段，不能假定每个事件都有状态或耗时。'
      ),
      ['type', 'phase', 'name', 'timestamp', 'durationMs', 'error', 'previous', 'next', 'metadata'],
      true
    ),
    IMiddlewareContext: {
      summary: t(
        'Legacy middleware callback context issued by middlewarePlugin; new code can use the canonical plugin core instead.',
        '由旧式中间件适配插件签发的回调上下文，新代码可直接使用规范插件核心。'
      ),
      example: hostExample,
      members: {
        runtime: domainMembers.runtime!,
        getState: {
          ...domainMembers.getState!,
          summary: t(
            'Synchronous zero-argument state callback supplied from the host core; failures propagate to pipeline handling.',
            '由宿主核心提供的同步无参数状态回调，失败传播到流水线处理。'
          )
        }
      }
    },
    IStoreMiddleware: {
      summary: t(
        'Legacy synchronous callback receiving event, runtime/getState context and no-argument next. Call next() to continue; no return or async result is consumed, and callback failure follows the invoking host boundary.',
        '旧式同步回调，接收事件、运行时及读取状态上下文、无参数继续函数，调用继续函数才交付下游，不消费返回或异步结果，失败按调用宿主边界处理。'
      ),
      example: hostExample,
      members: {}
    },
    IStoreMiddlewareCore: {
      summary: t(
        'Store-specific plugin core issued at install time, combined with external IPluginHostCore; runtime/state/error capabilities stay owned by the state host.',
        '安装时签发并与外包插件宿主核心组合的存储专属插件核心，运行时、状态及错误能力归状态宿主拥有。'
      ),
      example: hostExample,
      members: {
        runtime: domainMembers.runtime!,
        getState: domainMembers.getState!,
        applyState: domainMembers.applyState!,
        reportError: domainMembers.reportError!
      }
    },
    IStoreMiddlewarePlugin: {
      summary: t(
        'External IPlugin specialized with Store core and IMiddlewareEvent. Name/install/dependencies/setup/dispose/config semantics belong to @migaia/plugin-host; install receives the store core plus plugin pipeline/lifecycle capabilities and returns the external plugin install result.',
        '外包插件契约的存储核心及领域事件特化，命名、安装、依赖、设置、销毁及配置语义归插件宿主包，安装接收存储核心及插件流水线生命周期能力并返回外包安装结果。'
      ),
      example: hostExample,
      members: {}
    },
    IStoreMiddlewareHost: {
      summary: t(
        'Frozen defineHost-composed store event handle; local domain methods coexist with the canonical [IHostHandle](/en/docs/plugin-host/api/IHostHandle) from `@migaia/plugin-host`. Pipeline mode is fixed sync.',
        '经宿主组合产生的冻结存储事件句柄，本地领域方法与 `@migaia/plugin-host` 的规范 [IHostHandle](/zh/docs/plugin-host/api/IHostHandle) 共存，继承其安装、移除、配置、流水线及销毁控制，模式固定同步。'
      ),
      scenarios: [
        t(
          'Observe a custom state owner without binding a light Store, while retaining canonical plugin lifecycle.',
          '在不绑定轻量存储时观察自定义状态拥有者，并保留规范插件生命周期。'
        )
      ],
      example: hostExample,
      members: { ...inheritedHostMembers, ...hostDomainMembers }
    },
    IStoreMiddlewareBinding: {
      summary: t(
        'New frozen host handle returned by bindStoreMiddleware, carrying all host capabilities plus the original light Store reference. Releasing this binding leaves the Store alive.',
        '绑定工厂返回的新冻结宿主句柄，包含全部宿主能力及原轻量存储引用，释放绑定不销毁存储。'
      ),
      scenarios: [
        t(
          'Observe Store updates and action traces and detach them together during application cleanup.',
          '观察存储更新及动作追踪，并在应用清理时一起分离。'
        )
      ],
      example: bindingExample,
      members: {
        ...inheritedHostMembers,
        ...hostDomainMembers,
        store: f(
          'Exact IReactiveStore originally supplied to bindStoreMiddleware; lifecycle ownership remains with the caller.',
          '绑定时提供的精确响应存储，生命周期所有权仍归调用者。'
        )
      }
    },
    IStoreMiddlewareHostOptions: {
      summary: t(
        'External IPluginHostOptions plus Store state capabilities; execution budgets remain required and the pipeline mode is forced sync during option snapshotting.',
        '外包插件宿主选项加存储状态能力，执行预算仍必填，选项快照期间流水线强制同步。'
      ),
      example: hostExample,
      members: {
        ...pluginHostReference.types.IPluginHostOptions!.members,
        runtime: domainMembers.runtime!,
        getState: {
          ...domainMembers.getState!,
          summary: t(
            'Required synchronous zero-argument getter invoked when plugins or adapters need state. Return S; throws propagate through the invoking API.',
            '插件或适配器需要状态时调用的必填同步无参数读取器，返回状态，抛错经调用接口传播。'
          )
        },
        applyState: {
          ...domainMembers.applyState!,
          summary: t(
            'Optional synchronous callback receiving a replacement state from jump/reset. Return nothing; callback throws propagate through command delivery.',
            '可选同步回调，接收跳转或重置替代状态，无需返回值，抛错经命令交付传播。'
          ),
          default: t(
            'Absent; applying a DevTools state command throws DEVTOOLS_CAPABILITY.',
            '默认省略，应用诊断状态命令时抛能力缺失错误。'
          )
        },
        mutationPolicy: {
          ...domainMembers.mutationPolicy!,
          default: t('A new off MutationPolicy instance.', '默认新建无约束变更策略实例。')
        },
        pipeline: {
          summary: t(
            'External pipeline options are accepted but mode is overwritten with sync before host construction.',
            '接受外包流水线选项，但宿主构造前会把模式覆盖为同步。'
          ),
          default: t(
            'A sync pipeline is installed even when this option is omitted.',
            '默认即安装同步流水线。'
          )
        },
        'pipeline.mode': {
          summary: t(
            'Always overwritten with sync by the Store host constructor.',
            '始终被存储宿主构造函数覆盖为同步。'
          ),
          default: t(
            'sync, regardless of caller omission or another supplied mode.',
            '默认同步，省略或提供其他模式都不改变它。'
          ),
          values: {
            sync: t(
              'Store middleware executes synchronously; async and generator stage registration is unavailable.',
              '存储中间件同步执行，不可注册异步或生成器阶段。'
            )
          }
        }
      }
    },
    IStoreMiddlewareBindingOptions: {
      summary: t(
        'Required external execution budgets plus optional policy sharing, action-prefix filtering and snapshot cloning for a Store binding.',
        '存储绑定的必填外包执行预算及可选策略共享、动作前缀筛选及快照复制。'
      ),
      example: bindingExample,
      members: {
        execution: pluginHostReference.types.IPluginHostOptions!.members.execution!,
        'execution.mutationTimeoutMs':
          pluginHostReference.types.IPluginHostOptions!.members['execution.mutationTimeoutMs']!,
        'execution.pipelineDrainTimeoutMs':
          pluginHostReference.types.IPluginHostOptions!.members[
            'execution.pipelineDrainTimeoutMs'
          ]!,
        mutationPolicy: {
          ...domainMembers.mutationPolicy!,
          default: t(
            'A new off policy; strict binding must explicitly share the Store policy.',
            '默认新建无约束策略，严格绑定必须显式共享存储策略。'
          )
        },
        actionPrefix: f(
          'Application string prefix for forwarded Runtime action names; state subscriptions are not filtered by it.',
          '转发运行时动作名使用的应用字符串前缀，不用于筛选状态订阅。',
          'No prefix filter; all action traces are forwarded.',
          '默认无前缀筛选，转发全部动作追踪。'
        ),
        clone: {
          summary: t(
            'Synchronous callback receiving the Store plain record on initial capture, reads and state changes. Return a snapshot record; throw aborts that capture and no async result is awaited.',
            '同步接收初始捕获、读取及状态变更时的存储普通记录，返回快照记录，抛错终止该次捕获，不等待异步结果。'
          ),
          params: {
            state: t(
              'Fresh plain record supplied by store.$plain().',
              '存储普通快照方法提供的新普通记录。'
            )
          },
          returns: t(
            'Record snapshot; independence depends on this chosen clone implementation.',
            '返回记录快照，独立性取决于选定复制实现。'
          ),
          default: t(
            'ClonePolicy.diagnostic, with unsupported subtree references retained when necessary.',
            '默认诊断复制策略，必要时保留不支持子树引用。'
          ),
          example: bindingExample
        }
      }
    },
    IDevToolsCommand: {
      summary: t(
        'Normalized adapter command union: commit has no replacement state, while jump and reset carry the supplied state to apply inside an action.',
        '规范适配命令联合，提交没有替代状态，跳转及重置携带需在动作内应用的状态。'
      ),
      example: adapterExample,
      members: {
        type: {
          summary: t(
            'Normalized command from the adapter, selecting reinitialization or state application.',
            '来自适配器、用于选择重新初始化或状态应用的规范命令。'
          ),
          values: { enum: 'MiddlewareCommandType' }
        },
        state: f(
          'Replacement S only on jump/reset, parsed by the Redux adapter or supplied by a custom adapter.',
          '仅跳转或重置包含的替代状态，由扩展适配器解析或自定义适配器提供。'
        )
      }
    },
    IDevToolsAdapter: {
      summary: t(
        'Caller-owned domain adapter consumed by connectDevTools; has synchronous initialization/event forwarding and optional normalized command subscription.',
        '诊断连接方法消费的调用者领域适配器，包含同步初始化及事件转发、可选规范命令订阅。'
      ),
      scenarios: [
        t(
          'Connect a custom panel or extension-shaped connection to the same Store event host.',
          '把自定义面板或扩展形状连接接入同一存储事件宿主。'
        )
      ],
      example: adapterExample,
      members: {
        init: {
          summary: t(
            'Initializes or commits current state in the external diagnostic target.',
            '在外部诊断目标初始化或提交当前状态。'
          ),
          params: {
            state: t(
              'Current S supplied by host getState at installation or commit.',
              '宿主在安装或提交时读取的当前状态。'
            )
          },
          returns: t(
            'No result; throws follow plugin installation or command callback handling.',
            '无返回值，抛错按插件安装或命令回调处理。'
          ),
          example: adapterExample
        },
        send: {
          summary: t(
            'Sends one event and current state after downstream middleware completes.',
            '下游中间件完成后发送一个事件及当前状态。'
          ),
          params: {
            event: t(
              'Delivered host domain event, retaining original error and metadata references.',
              '已交付宿主领域事件，保留原错误及元数据引用。'
            ),
            state: t(
              'Current snapshot read after downstream event processing.',
              '下游事件处理后读取的当前快照。'
            )
          },
          returns: t(
            'No result is awaited; throws follow the invoking emission boundary.',
            '不等待返回结果，抛错按调用发射边界处理。'
          ),
          example: adapterExample
        },
        subscribe: {
          summary: t(
            'Optional synchronous registration of a normalized command listener; the host registers its returned cleanup with plugin disposal.',
            '可选同步登记规范命令监听者，宿主把返回清理交给插件销毁。'
          ),
          params: {
            listener: t(
              'Synchronous command callback receiving commit, jump or reset from the adapter; no result is used, and command failures follow the connection delivery path.',
              '接收适配器提交、跳转或重置命令的同步回调，不使用结果，命令失败按连接交付路径处理。'
            )
          },
          returns: t(
            'External no-argument IDisposer removing the command subscription.',
            '返回移除命令订阅的外包无参数清理函数。'
          ),
          default: t(
            'Absent; the host installs a no-op cleanup and receives no commands.',
            '默认省略，宿主登记空清理且不接收命令。'
          ),
          example: adapterExample
        }
      }
    },
    IReduxDevToolsConnection: {
      summary: t(
        'Caller-provided structural extension connection; this package adapts its messages and labels without acquiring the browser extension itself.',
        '调用者提供的结构化扩展连接，当前包适配消息及标签，不接纳浏览器扩展本体。'
      ),
      example: adapterExample,
      members: {
        init: {
          summary: t(
            'Connection callback receiving current state at adapter initialization or commit.',
            '适配初始化或提交时接收当前状态的连接回调。'
          ),
          params: {
            state: t(
              'Current state supplied by the host domain getter.',
              '宿主领域读取器提供的当前状态。'
            )
          },
          returns: t(
            'No result; connection failure propagates to its invoking adapter call.',
            '无返回值，连接失败传播到调用适配接口。'
          ),
          example: adapterExample
        },
        send: {
          summary: t(
            'Connection callback receiving an action object containing a stable label and original event, plus current state.',
            '接收含稳定标签及原事件的动作对象和当前状态的连接回调。'
          ),
          params: {
            action: t(
              'Adapter-created { type, event }; action labels include name:phase, state name or error:phase.',
              '适配器创建的类型及事件对象，动作标签包含名称与阶段、状态名或错误阶段。'
            ),
            state: t(
              'Current host snapshot supplied after downstream processing.',
              '下游处理后提供的当前宿主快照。'
            )
          },
          returns: t(
            'No result; original connection throws propagate.',
            '无返回值，原连接抛错传播。'
          ),
          example: adapterExample
        },
        subscribe: {
          summary: t(
            'Registers a synchronous raw extension-message callback and returns connection-owned cleanup.',
            '登记同步原扩展消息回调并返回连接拥有的清理。'
          ),
          params: {
            listener: t(
              'Synchronous callback receiving IReduxDevToolsMessage from the connection; the adapter ignores unrelated messages or malformed state JSON and does not await return values.',
              '接收连接原始消息的同步回调，适配器忽略无关消息或损坏状态文本，不等待返回值。'
            )
          },
          returns: t(
            'No-argument IDisposer supplied by the connection to remove its listener.',
            '返回连接提供、用于移除监听者的无参数清理函数。'
          ),
          example: adapterExample
        }
      }
    },
    IReduxDevToolsMessage: {
      summary: t(
        'Optional raw extension fields; only DISPATCH with supported payload commands is handled, and stateful commands require parseable JSON state.',
        '可选原扩展字段，仅处理调度消息中的支持命令，有状态命令要求可解析状态文本。'
      ),
      example: adapterExample,
      members: {
        type: f(
          'Raw message discriminator; DISPATCH is handled and all other strings are ignored.',
          '原消息判别字段，调度值会被处理，其他字符串忽略。',
          'Absent, causing the message to be ignored.',
          '默认省略，消息因此被忽略。'
        ),
        payload: f(
          'Optional nested command selector; unknown or missing command types are ignored.',
          '可选嵌套命令选择器，未知或缺失命令种类忽略。',
          'Absent; no normalized command is emitted.',
          '默认省略，不产生规范命令。'
        ),
        'payload.type': {
          summary: t(
            'COMMIT reinitializes, JUMP_TO_STATE/JUMP_TO_ACTION/ROLLBACK become jump, RESET becomes reset; other strings are ignored.',
            '提交重新初始化，状态跳转、动作跳转及回滚变为跳转，重置变为重置，其他字符串忽略。'
          ),
          default: t('Absent; no normalized command is emitted.', '默认省略，不产生规范命令。'),
          values: {
            COMMIT: commandValues.commit,
            JUMP_TO_STATE: commandValues.jump,
            JUMP_TO_ACTION: commandValues.jump,
            ROLLBACK: commandValues.jump,
            RESET: commandValues.reset
          }
        },
        state: f(
          'JSON state text supplied by the extension; parse failure is ignored and valid parsed S is passed to jump/reset.',
          '扩展提供的状态文本，解析失败被忽略，有效解析状态转给跳转或重置。',
          'Absent; stateful commands are ignored while commit still works.',
          '默认省略，有状态命令忽略，提交仍可执行。'
        )
      }
    },
    IClonePolicyMode: {
      summary: t(
        'Snapshot choice union: immutable requires independent cloning or throw, opaque preserves the original reference, diagnostic permits unsupported subtree aliases.',
        '快照选择联合，不可变要求独立复制否则抛错，不透明保留原引用，诊断允许不支持子树共享。'
      ),
      example: cloneExample,
      members: {}
    },
    IMiddlewareEventType: {
      summary: t(
        'Value union of canonical action, state and error domain event discriminants.',
        '规范动作、状态及错误领域事件判别值联合。'
      ),
      example: hostExample,
      members: {}
    },
    IMiddlewareEventPhase: {
      summary: t(
        'Value union of synchronous action start, end and error phases; diagnostic phases remain caller-defined strings.',
        '同步动作开始、结束及失败阶段值联合，诊断阶段仍为调用者自定字符串。'
      ),
      example: hostExample,
      members: {}
    },
    IMiddlewareCommandType: {
      summary: t(
        'Value union of normalized commit, jump and reset diagnostic commands.',
        '规范提交、跳转及重置诊断命令的值联合。'
      ),
      example: adapterExample,
      members: {}
    },
    IStoreMiddlewareErrorCode: {
      summary: t(
        'Value union of StoreMiddlewareErrorCode, classified together with STORE_MIDDLEWARE_SOURCE while retaining original causes.',
        '与规范中间件来源一起分类、并保留原始原因的语义错误码值联合。'
      ),
      example: hostExample,
      members: {}
    }
  },
  enums: {
    MiddlewareEventType: {
      summary: t(
        'Domain event families observed by middleware and adapters.',
        '中间件及适配器观察的领域事件分类。'
      ),
      values: eventValues
    },
    MiddlewareEventPhase: {
      summary: t(
        'Synchronous action phases, including original callback failure.',
        '包含原回调失败的同步动作阶段。'
      ),
      values: phaseValues
    },
    MiddlewareCommandType: {
      summary: t(
        'Normalized state-control commands consumed by a connected host.',
        '已连接宿主消费的规范状态控制命令。'
      ),
      values: commandValues
    },
    StoreMiddlewareErrorCode: {
      summary: t(
        'Package-owned input, policy, pipeline, clone and binding failure classifications.',
        '包拥有的输入、策略、流水线、复制及绑定失败分类。'
      ),
      values: errorValues
    }
  },
  enhancers: {
    middlewarePlugin: {
      kind: 'middleware',
      target: 'IStoreMiddlewareHost',
      summary: t(
        'Installed using host.use, it inserts the caller legacy stage into the existing synchronous event pipeline. It adds behavior rather than new methods.',
        '经宿主安装后把调用者旧式阶段放入已有同步事件流水线，增加行为而非新方法。'
      ),
      install: hostExample,
      grants: [],
      behaviors: [
        t(
          'next() delivers the same event downstream; omission filters only observations and is reported as MIDDLEWARE_NOT_CHAINED.',
          '继续调用交付相同事件到下游，省略仅筛选观察并以未继续错误报告。'
        )
      ],
      scenarios: [
        t(
          'Migrate a synchronous audit or observation callback onto the canonical plugin lifecycle.',
          '把同步审计或观察回调迁移到规范插件生命周期。'
        )
      ],
      example: hostExample
    },
    loggerMiddleware: {
      kind: 'middleware',
      target: 'IStoreMiddlewareHost',
      summary: t(
        'Installed using host.use, the fixed store-logger plugin logs each event after downstream processing, without adding extension methods.',
        '经宿主安装后，固定名称日志插件在下游处理后记录每个事件，不新增扩展方法。'
      ),
      install: hostExample,
      grants: [],
      behaviors: [
        t(
          'The sink receives the delivered event and latest core state; its throw follows the caller emission isolation policy.',
          '接收端取得已交付事件及最新核心状态，抛错按调用者发射隔离策略处理。'
        )
      ],
      scenarios: [
        t(
          'Observe state and action diagnostics through an existing synchronous log sink.',
          '经已有同步日志接收端观察状态及动作诊断。'
        )
      ],
      example: hostExample
    }
  }
}
