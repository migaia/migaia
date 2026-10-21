/**
 * Reference documentation of `@migaia/reactive`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/reactive/src` (runtime/types.ts, runtime/source.ts,
 * runtime/observer-binding.ts, error-code.ts) and USEGUIDE on 2026-10-17.
 */
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'
import { reactiveCases } from './reactive-cases.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Shared `runtime` parameter of extension functions. */
const runtimeParam = t(
  'A runtime created by `createRuntime()` (or `defaultRuntime`). Other objects throw `NOT_RUNTIME_OWNED`.',
  '由 `createRuntime()` 创建的 runtime（或 `defaultRuntime`）。其它对象会抛 `NOT_RUNTIME_OWNED`。'
)

/** Members every node shares: owner, label, disposal. */
const nodeBase: Readonly<Record<string, IMemberDoc>> = {
  runtime: {
    summary: t(
      'The runtime that created the node; only nodes of the same runtime can depend on each other.',
      '创建该节点的 runtime；只有同一个 runtime 的节点之间才能互相依赖。'
    )
  },
  debugName: {
    summary: t(
      'Label given at creation, shown in trace events and error messages; `undefined` when not set.',
      '创建时指定的标签，会出现在 trace 事件和错误信息中；未指定时为 `undefined`。'
    )
  },
  dispose: {
    summary: t(
      'Releases the node: removes its dependency edges and stops notifications. Calling it again does nothing.',
      '释放节点：断开它的依赖边并停止通知。重复调用没有效果。'
    ),
    returns: t(
      'Nothing; afterwards `disposed` is `true` and reading the node throws `NODE_DISPOSED`.',
      '无返回值；之后 `disposed` 为 `true`，再读取该节点会抛 `NODE_DISPOSED`。'
    ),
    example: `node.dispose()
console.log(node.disposed) // true`
  },
  disposed: {
    summary: t(
      '`true` after `dispose()`; a disposed node can no longer be read or written.',
      '调用 `dispose()` 后为 `true`；已释放的节点不能再读取或写入。'
    )
  }
}

/** Members of the runtime object. */
const runtimeMembers: Readonly<Record<string, IMemberDoc>> = {
  signal: {
    summary: t(
      'Creates a writable node. Reading `.value` inside a computed or an effect records a dependency; assigning a value that is not `Object.is`-equal advances its version and marks dependents dirty.',
      '创建可写节点。在 computed 或 effect 中读取 `.value` 会登记依赖；赋予与原值不 `Object.is` 相等的新值时，推进版本号并把下游标记为过期。'
    ),
    params: {
      value: t('Initial value.', '节点的初始值。'),
      options: t(
        '`debugName`: label used in trace events and errors.',
        '`debugName`：在 trace 事件和错误信息中显示的标签。'
      )
    },
    returns: t(
      'An `IReactiveSignal`; its owner should `dispose()` it when done.',
      '一个 `IReactiveSignal`；不再使用时由持有者调用 `dispose()`。'
    ),
    example: `const count = runtime.signal(0, { debugName: 'count' })
count.value += 1`
  },
  computed: {
    summary: t(
      'Creates a lazy, cached derived value. It computes on first read, recomputes only after a dependency changed, and when nobody observes it any more it suspends itself at idle time (unless `keepAlive`).',
      '创建惰性、带缓存的派生值。第一次读取时才计算，依赖变化后才重新计算；没有观察者时会在空闲时机自动挂起（除非设置 `keepAlive`）。'
    ),
    params: {
      fn: t(
        'Pure derivation; every node read inside becomes a dependency. It must not write signals.',
        '纯派生函数，其中读取的每个节点都成为依赖；不要在里面写 signal。'
      ),
      config: t(
        'Either an `equals(a, b)` function, or `{ equals, keepAlive, debugName }`. `equals` decides whether dependents see a change (default `Object.is`); `keepAlive: true` keeps the value warm without observers.',
        '可直接传 `equals(a, b)` 函数，或传 `{ equals, keepAlive, debugName }`。`equals` 决定下游是否感知变化（默认 `Object.is`）；`keepAlive: true` 表示没有观察者时也保持计算结果。'
      )
    },
    returns: t(
      'An `IReactiveComputed` whose `.value` is read-only.',
      '一个 `IReactiveComputed`，其 `.value` 只读。'
    ),
    whenToUse: t(
      'Any value that can be derived from other nodes. Use an effect only for side effects.',
      '凡是能由其它节点推导出来的值都用 computed；只有副作用才用 effect。'
    ),
    example: `const fullName = runtime.computed(() => \`\${first.value} \${last.value}\`)`
  },
  effect: {
    summary: t(
      'Creates a side effect that runs once immediately, records the nodes it reads, and runs again at the next flush after any of them changed. A function returned by `fn` is called before each rerun and on dispose.',
      '创建副作用：立即同步执行一次并登记读取到的节点，任一依赖变化后在下一次冲刷中再次执行。`fn` 返回的函数会在每次重新执行前以及释放时被调用。'
    ),
    params: {
      fn: t('Effect body; may return a cleanup function.', '副作用函数体，可以返回清理函数。'),
      options: t('`debugName`: label for traces.', '`debugName`：用于 trace 的标签。')
    },
    returns: t(
      'An `IReactiveEffect` handle; `dispose()` removes dependencies and runs the last cleanup.',
      '一个 `IReactiveEffect` 句柄；`dispose()` 断开依赖并执行最后一次清理。'
    ),
    example: `const stop = runtime.effect(() => {
  const id = setInterval(() => console.log(count.value), 1000)
  return () => clearInterval(id)
})
stop.dispose()`
  },
  batch: {
    summary: t(
      'Runs `fn` and merges every write inside it into one flush when the outermost `batch` returns, so effects never see a half-applied update. Nested calls only increase the depth.',
      '执行 `fn`，把其中的所有写入合并为最外层 `batch` 返回时的一次冲刷，副作用不会看到更新到一半的状态。嵌套调用只增加层数。'
    ),
    params: { fn: t('Code that writes several nodes.', '会写入多个节点的代码。') },
    returns: t(
      'What `fn` returns. If `fn` throws and the final flush also throws, both errors are kept (see `ACTION_FLUSH_FAILED`).',
      '`fn` 的返回值。若 `fn` 抛错且收尾冲刷也抛错，两个错误都会保留（见 `ACTION_FLUSH_FAILED`）。'
    ),
    example: `runtime.batch(() => {
  first.value = 'Ada'
  last.value = 'Lovelace'
}) // 副作用只执行一次`
  },
  untracked: {
    summary: t(
      'Runs `fn` with dependency tracking turned off: nodes read inside are not recorded as dependencies of the current computed or effect.',
      '关闭依赖收集后执行 `fn`：其中读取的节点不会登记为当前 computed 或 effect 的依赖。'
    ),
    params: { fn: t('Code whose reads must not subscribe.', '其中的读取不应建立订阅的代码。') },
    returns: t('What `fn` returns.', '`fn` 的返回值。'),
    whenToUse: t(
      'Read configuration or context inside an effect without rerunning when it changes. For one node, `node.peek()` is shorter.',
      '在 effect 中读取配置或上下文，且不希望它们变化时触发重新执行。只读一个节点时用 `node.peek()` 更简短。'
    ),
    example: `runtime.effect(() => {
  const user = currentUser.value
  const locale = runtime.untracked(() => settings.value.locale)
  render(user, locale)
})`
  },
  flush: {
    summary: t(
      'Runs the pending effects now, synchronously. Production code normally relies on the scheduler strategy (merged microtasks by default); tests, SSR and explicit commit points call it directly.',
      '立即同步执行待处理的副作用。生产代码通常依赖调度策略（默认合并到微任务）；测试、SSR 和需要明确提交点的代码直接调用它。'
    ),
    returns: t(
      '`completed` from the outermost call after the queue is empty; `deferred` when called from inside an effect (the outer flush continues). More than `maxFlushPasses` reruns of one effect throw `FLUSH_LOOP` and drop the rest of the queue.',
      '最外层调用在队列清空后返回 `completed`；在 effect 内部重入调用返回 `deferred`（由外层冲刷继续）。同一个 effect 在一次冲刷中执行次数超过 `maxFlushPasses` 时抛 `FLUSH_LOOP`，并丢弃剩余队列。'
    ),
    example: `count.value = 3
runtime.flush() // effect 立即执行`
  },
  runTracedAction: {
    summary: t(
      'Runs `fn` as one named action in the trace stream (start, end or error records). Without trace listeners it is the same as calling `fn()`.',
      '把 `fn` 作为一个具名 action 记录到 trace 事件流（开始、结束或出错记录）。没有 trace 监听者时与直接调用 `fn()` 相同。'
    ),
    params: {
      name: t(
        'Non-empty action name shown in devtools; otherwise `INVALID_OPTION`.',
        '在 devtools 中显示的非空 action 名，否则抛 `INVALID_OPTION`。'
      ),
      fn: t('The action body.', 'action 的函数体。')
    },
    returns: t(
      'What `fn` returns; an error of `fn` is rethrown after the error record.',
      '`fn` 的返回值；`fn` 抛错时先记录出错事件再原样抛出。'
    ),
    whenToUse: t(
      'Pair it with `subscribeTrace` (or the `onTrace` option): mark a user-level operation so devtools can group the node changes and effect runs it caused between its start and end records. Without a listener it adds no cost and records nothing.',
      '与 `subscribeTrace`（或 `onTrace` 选项）搭配使用：把一次用户级操作标成具名 action，devtools 就能把它开始与结束记录之间引起的节点变化和 effect 执行归到这次操作下。没有监听者时不产生开销，也不记录任何事件。'
    ),
    example: `// 先订阅 trace，否则 runTracedAction 不产生任何记录
const stop = runtime.subscribeTrace((event) => {
  if (event.type !== ReactiveTraceType.action) return
  if (event.phase === ReactiveTracePhase.start) console.log('开始', event.name)
  else console.log(event.phase, event.name, \`\${event.durationMs}ms\`)
})

runtime.runTracedAction('cart/add', () => {
  items.value = [...items.value, item]
})
// 输出：开始 cart/add，然后 end cart/add 0.1ms
stop()`
  },
  reportError: {
    summary: t(
      'Sends an error to the runtime diagnostic channel (`onError`, or the adapter `reportError`). Node references in `context` are replaced by descriptors before they reach callbacks.',
      '把错误送入 runtime 的诊断通道（`onError`，或适配器的 `reportError`）。`context` 中的节点对象在交给回调前会被替换为脱敏描述。'
    ),
    params: {
      error: t('The failure to report.', '要上报的失败。'),
      context: t(
        '`phase` (a `ReactiveErrorPhase` value) plus optional `observer` / `observable` node involved.',
        '`phase`（`ReactiveErrorPhase` 中的值），以及可选的相关 `observer` / `observable` 节点。'
      )
    },
    returns: t(
      'Nothing; reporting never throws into the caller.',
      '无返回值；上报过程不会向调用方抛错。'
    ),
    whenToUse: t(
      'Adapters and extensions that must swallow an error but keep it observable.',
      '适配层或扩展必须吞下错误、但仍需让它可被观察时使用。'
    ),
    example: `runtime.reportError(error, { phase: ReactiveErrorPhase.subscriptionListener })`
  },
  subscribeTrace: {
    summary: t(
      'Subscribes to read-only diagnostic events: node changes, dependency connect/disconnect, effect runs and traced actions. Nodes appear as `{ id, kind, debugName }` descriptors, not as objects.',
      '订阅只读诊断事件：节点变化、依赖连接与断开、副作用执行以及追踪的 action。事件中的节点是 `{ id, kind, debugName }` 描述，不是节点对象本身。'
    ),
    params: { listener: t('Receives each trace event.', '接收每个 trace 事件的函数。') },
    returns: t('A function that stops the subscription.', '停止订阅的函数。'),
    whenToUse: t(
      'Devtools, loggers and tests that need to see why the graph changed. Pair it with `runTracedAction` to group the events of one user operation under a name; subscribe after the runtime exists, or use the `onTrace` option to receive events from creation on.',
      'devtools、日志和测试需要看到依赖图为什么变化时使用。与 `runTracedAction` 搭配，可以把一次用户操作引起的事件归到一个名字下；runtime 创建后再订阅，若要从创建起接收事件，改用 `onTrace` 选项。'
    ),
    example: `const events: IRuntimeTraceEvent[] = []
const stop = runtime.subscribeTrace((event) => events.push(event))

// 用具名 action 包住一次操作，事件流中会出现 action start / end，中间是它引起的节点变化
runtime.runTracedAction('todo/toggle', () => {
  todo.value = { ...todo.value, done: !todo.value.done }
})
runtime.flush()

const actionEvents = events.filter((event) => event.type === ReactiveTraceType.action)
console.log(actionEvents.map((event) => event.phase)) // ['start', 'end']
stop() // 停止后不再收到事件；没有其他监听者时 runtime 不再产生 trace`
  }
}

/** Instance scenarios and example of the runtime. */
const runtimeScenarios = [
  t(
    'SSR creates one runtime per request so state never leaks between users.',
    'SSR 为每个请求创建一个 runtime，用户之间的状态互不泄漏。'
  ),
  t(
    'Each test owns a runtime and calls `flush()` for deterministic effect timing.',
    '每个测试用例拥有自己的 runtime，并调用 `flush()` 让副作用时机可预测。'
  ),
  t(
    'A store library builds collections and resources on `signal` / `computed` / `effect`.',
    'Store 类库在 `signal` / `computed` / `effect` 之上构建集合与资源。'
  )
]
const runtimeExample = {
  en: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({ onError: (error, context) => console.error(context.phase, error) })
const price = runtime.signal(10, { debugName: 'price' })
const quantity = runtime.signal(2, { debugName: 'quantity' })
const total = runtime.computed(() => price.value * quantity.value)
const log = runtime.effect(() => console.log('total', total.value)) // total 20

runtime.batch(() => {
  price.value = 12
  quantity.value = 3
}) // one rerun: total 36

log.dispose()
total.dispose()
quantity.dispose()
price.dispose()`,
  zh: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({ onError: (error, context) => console.error(context.phase, error) })
const price = runtime.signal(10, { debugName: 'price' })
const quantity = runtime.signal(2, { debugName: 'quantity' })
const total = runtime.computed(() => price.value * quantity.value)
const log = runtime.effect(() => console.log('合计', total.value)) // 合计 20

runtime.batch(() => {
  price.value = 12
  quantity.value = 3
}) // 只重新执行一次：合计 36

log.dispose()
total.dispose()
quantity.dispose()
price.dispose()`
}

/** Reference of `@migaia/reactive`. */
export const reactiveReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Main entry point for application code. `createRuntime()` returns an isolated runtime; create nodes through it with `runtime.signal()`, `runtime.computed()` and `runtime.effect()`. Also exports the shared `defaultRuntime`, error codes and trace constants.',
        '应用代码的主入口。`createRuntime()` 返回一个隔离的 runtime，再通过 `runtime.signal()`、`runtime.computed()`、`runtime.effect()` 创建节点。这里还导出共享的 `defaultRuntime`、错误码和 trace 常量。'
      ),
      example: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const count = runtime.signal(1)
const doubled = runtime.computed(() => count.value * 2)
runtime.effect(() => console.log(doubled.value)) // 2`
    },
    extension: {
      summary: t(
        'Connect external state or a framework adapter to Reactive so that reads become dependencies and changes can update consumers. Import this subpath for adapter building tools; use the root runtime APIs for ordinary application state.\n\nStart with `createFieldSource()` to track reads and publish changes to a value held outside Reactive. For frameworks that may discard a render, `createObserverBinding()` captures reads during rendering and installs subscriptions only when the render is committed.',
        '把外部状态或框架适配器接入响应式系统，让系统记录读取关系，并在值变化时更新使用者。编写适配器时选择此子路径；普通应用状态使用根入口的运行时接口即可。\n\n从 `createFieldSource()` 开始，为系统之外的值记录读取并发布变化。若框架可能丢弃一次渲染，使用 `createObserverBinding()` 在渲染时记录读取，到提交渲染结果时才建立订阅。'
      ),
      example: `import { createFieldSource } from '@migaia/reactive/extension'

const field = createFieldSource(runtime, 'wasm-counter')
field.track() // 在 computed/effect 中读取外部值前调用`
    }
  },
  symbols: {
    createRuntime: {
      role: 'factory',
      cases: reactiveCases.createRuntime,
      purpose: t(
        'Creates an isolated reactive runtime: its own dependency graph, version clock and scheduler. Nodes created by one runtime cannot be read by computed values or effects of another (`CROSS_RUNTIME`). Create one per SSR request, per test, or per worker instead of sharing `defaultRuntime`.',
        '创建一个隔离的响应式 runtime：拥有自己的依赖图、版本时钟和调度器。一个 runtime 创建的节点不能被另一个 runtime 的 computed 或 effect 读取（`CROSS_RUNTIME`）。SSR 每个请求、每个测试用例、每个 worker 都应各自创建，而不是共用 `defaultRuntime`。'
      ),
      params: {
        options: t(
          'Runtime options; all optional, see the options table.',
          'runtime 选项，全部可选，见选项表。'
        )
      },
      returns: t(
        'An `IRuntime`. Invalid options throw a `TypeError` or `RangeError` with code `INVALID_OPTION`.',
        '一个 `IRuntime`。选项不合法时抛带 `INVALID_OPTION` 码的 `TypeError` 或 `RangeError`。'
      ),
      options: 'IRuntimeOptions',
      example: runtimeExample,
      scenarios: runtimeScenarios,
      avoid: [
        t(
          'You only need local component state: use the framework state instead.',
          '只需要组件内部的局部状态：直接使用框架自带的状态即可。'
        )
      ]
    },
    defaultRuntime: {
      role: 'constant',
      cases: reactiveCases.defaultRuntime,
      purpose: t(
        'A process-wide runtime created when the module is imported. Convenient for scripts and single-page apps; SSR, tests and workers should call `createRuntime()` so their state stays isolated.',
        '模块导入时创建的进程级共享 runtime。适合脚本和单页应用；SSR、测试和 worker 应调用 `createRuntime()`，让各自状态互相隔离。'
      ),
      example: `import { defaultRuntime } from '@migaia/reactive'

const theme = defaultRuntime.signal('light')`
    },
    assertSingleRuntimeCopy: {
      role: 'operation',
      purpose: t(
        'Throws `COPY_CONFLICT` when more than one copy registered at a correctness boundary (duplicate installs, CDN copies, micro-frontends). A cold extension import need not register. Call it once at application start; the library never calls it by itself.',
        '多份本包副本进入正确性边界登记时（重复安装、CDN 副本、微前端各自打包）抛 `COPY_CONFLICT`；仅冷导入扩展入口不一定登记。在应用启动时调用一次；库自身不会主动调用它。'
      ),
      example: `import { assertSingleRuntimeCopy } from '@migaia/reactive'

assertSingleRuntimeCopy()`
    },
    REACTIVE_SOURCE: {
      role: 'error',
      purpose: t(
        'The `source` value on Reactive-owned errors (`@migaia/reactive`). Existing foreign source/code and non-Error control objects retain their identity. Compare `error.source` with it, then branch on `error.code`.',
        '响应式包自身错误所带的 `source` 值（`@migaia/reactive`）。已有外部错误身份与非错误控制对象保持不变。先比较 `error.source` 确认错误来自本包，再按 `error.code` 分支处理。'
      ),
      example: `if ((error as { source?: string }).source === REACTIVE_SOURCE) handle(error)`
    },
    ReactiveErrorCode: {
      role: 'error',
      purpose: t(
        'Every error code this package throws or reports. Branch on `error.code === ReactiveErrorCode.x` instead of the message text.',
        '本包抛出或上报的全部错误码。请用 `error.code === ReactiveErrorCode.x` 判断，不要依赖错误信息文本。'
      ),
      example: `try {
  node.value
} catch (error) {
  if ((error as { code?: string }).code === ReactiveErrorCode.nodeDisposed) console.warn('节点已释放')
}`
    },
    ReactiveTracePhase: {
      role: 'constant',
      purpose: t(
        'Phase field of trace events (`start`, `end`, `error`, `connect`, `disconnect`).',
        'trace 事件的 `phase` 字段取值（`start`、`end`、`error`、`connect`、`disconnect`），用来区分一次执行或一条依赖边处在哪个阶段。'
      ),
      example: `runtime.subscribeTrace((event) => {
  if ('phase' in event && event.phase === ReactiveTracePhase.error) console.error(event)
})`
    },
    ReactiveTraceReason: {
      role: 'constant',
      purpose: t(
        'Reason field of node-change and dependency trace events.',
        '节点变化事件与依赖事件的 `reason` 字段取值，说明变化或依赖调整的起因。'
      ),
      example: `if (event.type === ReactiveTraceType.observableChange && event.reason === ReactiveTraceReason.set) count += 1`
    },
    ReactiveTraceType: {
      role: 'constant',
      purpose: t(
        'Type field that tells trace event kinds apart.',
        '区分 trace 事件种类的 `type` 字段取值，订阅 trace 时先按它判断事件结构。'
      ),
      example: `if (event.type === ReactiveTraceType.observerRun) timings.push(event.durationMs)`
    },
    ReactiveErrorPhase: {
      role: 'constant',
      purpose: t(
        'Values of `context.phase` passed to `onError` / `reportError`, telling where a reported error happened.',
        '传给 `onError` / `reportError` 的 `context.phase` 取值，说明被上报的错误发生在哪个环节。'
      ),
      example: `createRuntime({
  onError: (error, context) => {
    if (context.phase === ReactiveErrorPhase.traceListener) console.warn('trace 监听器出错', error)
  }
})`
    },
    getDefaultRuntime: {
      role: 'operation',
      purpose: t(
        'Returns the shared default runtime, creating it on first call. It is the same object as `defaultRuntime`; adapters use it so that importing them does not create the runtime early.',
        '返回共享的默认 runtime，第一次调用时才创建。它与 `defaultRuntime` 是同一个对象；适配层用它避免在导入时就提前创建 runtime。'
      ),
      returns: t('The shared default `IRuntime`.', '共享的默认 `IRuntime`。'),
      example: `const runtime = getDefaultRuntime()`
    },
    assertOwnedBy: {
      role: 'operation',
      purpose: t(
        'Lenient ownership check: ordinary unregistered values pass; values owned by another runtime throw `CROSS_RUNTIME`. A foreign-copy brand is detected as `COPY_CONFLICT`, rather than treated as an unregistered value.',
        '宽松所有权检查：普通未登记值通过，属于另一运行时的值抛 `CROSS_RUNTIME`。具有外部副本品牌的值抛 `COPY_CONFLICT`，不会当作普通未登记值放行。'
      ),
      params: {
        value: t('Value to check.', '要检查的值。'),
        runtime: runtimeParam,
        what: t('Name of the value used in the error message.', '错误信息中用于指明该值的名称。')
      },
      example: `assertOwnedBy(node, runtime, 'cart-items')`
    },
    assertReactiveOwnedBy: {
      role: 'operation',
      purpose: t(
        'Strict ownership check used at graph boundaries: unregistered values throw `NOT_RUNTIME_OWNED`, values of another runtime throw `CROSS_RUNTIME`.',
        '在图边界使用的严格所有权检查：未登记的值抛 `NOT_RUNTIME_OWNED`，属于其它 runtime 的值抛 `CROSS_RUNTIME`。'
      ),
      params: {
        value: t('Node object to check.', '要检查的节点对象。'),
        runtime: runtimeParam,
        what: t('Name of the value used in the error message.', '错误信息中用于指明该值的名称。')
      },
      example: `assertReactiveOwnedBy(node, runtime, 'field')`
    },
    claimOwnership: {
      role: 'operation',
      purpose: t(
        'Registers `value` as owned by `runtime`. The first claim installs the existing cross-copy brand while the local WeakMap remains authoritative. Registering the same object to a different runtime throws `OWNERSHIP_CONFLICT`; foreign-copy lookup misses throw `COPY_CONFLICT`.',
        '把 `value` 登记为属于 `runtime`。首次登记安装既有跨副本品牌，本地弱映射仍是所有权权威。同一对象再登记到另一运行时抛 `OWNERSHIP_CONFLICT`；外部副本查询未命中本地登记时抛 `COPY_CONFLICT`。'
      ),
      params: { value: t('Object to register.', '要登记的对象。'), runtime: runtimeParam },
      example: `claimOwnership(collection, runtime)`
    },
    ownerOf: {
      role: 'operation',
      purpose: t(
        'Returns the runtime a value is registered to, or `undefined`.',
        '返回某个值登记所属的 runtime；从未登记过的值返回 `undefined`，以区分“不属于任何图”和“属于另一张图”。'
      ),
      params: { value: t('Any value to look up.', '要查询归属的任意值。') },
      returns: t(
        'The owning `IRuntime`, or `undefined` for values that belong to no graph.',
        '所属的 `IRuntime`；不属于任何图的值返回 `undefined`。'
      ),
      example: `if (ownerOf(node) !== runtime) throw new Error('不属于当前 runtime')`
    },
    createFieldSource: {
      role: 'factory',
      purpose: t(
        'Creates a controlled source for a value stored outside the graph (WASM memory, shared buffers). The caller gets `track`, `notify`, `commit` and `dispose` only; it cannot create one-sided edges, fake versions or notify another runtime.',
        '为保存在图之外的值（WASM 内存、共享缓冲区）创建受控数据源。调用方只拿到 `track`、`notify`、`commit`、`dispose`，无法建立单向依赖、伪造版本或通知其它 runtime。'
      ),
      params: {
        runtime: runtimeParam,
        debugName: t('Label for traces and errors.', '用于 trace 与错误信息的标签。')
      },
      returns: t('An `IRuntimeFieldSource`.', '一个受控数据源 `IRuntimeFieldSource`。'),
      example: `const field = createFieldSource(runtime, 'wasm-counter')
const read = () => {
  field.track()
  return memory.counter
}
const write = (next: number) => field.commit(() => (memory.counter = next))`
    },
    createObserverBinding: {
      role: 'factory',
      purpose: t(
        'Creates a binding for framework adapters that render concurrently: dependencies are captured during render without creating edges, and installed only at commit. A discarded render therefore leaves no subscription behind.',
        '为支持并发渲染的框架适配层创建绑定：渲染阶段只捕获依赖、不建立依赖边，提交阶段才真正安装。被丢弃的渲染因此不会留下订阅。'
      ),
      params: { runtime: runtimeParam },
      returns: t('An `IObserverBinding`.', '一个渲染/提交绑定 `IObserverBinding`。'),
      example: `const binding = createObserverBinding(runtime)
const stop = binding.observe(() => rerender())
const capture = binding.capture(() => doubled.value) // 渲染期
binding.commit(capture) // 提交期`
    },
    createSourceBinding: {
      role: 'factory',
      purpose: t(
        'Registers a new custom node that implements `IObservable` and returns its read-only version and subscriber views plus a source bound to that node. Already registered nodes throw `GRAPH_NODE_REGISTERED`.',
        '登记一个实现了 `IObservable` 的新自定义节点，返回它的只读版本号、订阅者视图，以及绑定到该节点的数据源操作。已登记过的节点会抛 `GRAPH_NODE_REGISTERED`。'
      ),
      params: {
        node: t('A fresh object implementing `IObservable`.', '新建的、实现 `IObservable` 的对象。')
      },
      returns: t('An `IRuntimeSourceBinding`.', '一个节点绑定 `IRuntimeSourceBinding`。'),
      example: `const binding = createSourceBinding(node)
binding.source.commit(() => store.set(next))`
    },
    createTrackedObserver: {
      role: 'factory',
      purpose: t(
        'Registers a new custom node that implements `IObserver` and returns the graph operations bound to it (tracked run, clear, suspend, revalidate). It does not create another effect; scheduling and resource ownership stay with the caller.',
        '登记一个实现了 `IObserver` 的新自定义节点，返回绑定到它的图操作（追踪执行、清除、挂起、重新验证）。它不会另建 effect；调度与资源归属仍由调用方负责。'
      ),
      params: {
        observer: t('A fresh object implementing `IObserver`.', '新建的、实现 `IObserver` 的对象。')
      },
      returns: t('An `ITrackedObserverBinding`.', '一个观察者绑定 `ITrackedObserverBinding`。'),
      example: `const tracked = createTrackedObserver(observer)
const value = tracked.runTracked(() => source.value)`
    },
    currentRuntimeVersion: {
      role: 'operation',
      purpose: t(
        'Reads the current value of the runtime version clock without exposing the clock itself.',
        '读取 runtime 版本时钟的当前值，但不暴露时钟对象本身。'
      ),
      params: { runtime: runtimeParam },
      returns: t('The current version number.', '当前版本号。'),
      example: `const before = currentRuntimeVersion(runtime)`
    },
    deferRuntimeCleanup: {
      role: 'operation',
      purpose: t(
        'Schedules a synchronous cleanup task on the runtime idle channel (`scheduleIdle`, microtask by default). A throwing task is reported through `reportError`, including tasks deferred through a custom tracked observer; cleanup uses the canonical runtime path.',
        '把同步清理任务排到 runtime 的空闲通道（`scheduleIdle`，默认是微任务）。任务抛错时通过 `reportError` 上报，含自定义追踪观察者延后执行的任务；清理复用规范运行时通路。'
      ),
      params: { runtime: runtimeParam, task: t('Cleanup to run later.', '稍后执行的清理任务。') },
      example: `deferRuntimeCleanup(runtime, () => cache.clear())`
    },
    internalRuntimeOf: {
      role: 'operation',
      purpose: t(
        'Returns the graph view of a runtime whose `signal()` and `computed()` also expose their node protocol (`IObservable` / `IObserver`). Throws `NOT_RUNTIME_OWNED` for other objects.',
        '返回 runtime 的图视图，其 `signal()`、`computed()` 创建的节点同时暴露节点协议（`IObservable` / `IObserver`）。传入其它对象时抛 `NOT_RUNTIME_OWNED`。'
      ),
      params: { runtime: runtimeParam },
      returns: t(
        'An `IInternalRuntime` view of the same runtime.',
        '同一个 runtime 的 `IInternalRuntime` 视图。'
      ),
      example: `const graph = internalRuntimeOf(runtime)
const node = graph.signal(0)
console.log(node.subs.size)`
    },
    invalidateObservable: {
      role: 'operation',
      purpose: t(
        'Disconnects every downstream observer of `observable` while keeping its upstream edges and cached value. Used when routing switches to another node; to release a node call its `dispose()`.',
        '断开 `observable` 的全部下游观察者，但保留它的上游依赖和缓存值。用于路由切换到另一个节点；要释放节点请调用它的 `dispose()`。'
      ),
      params: {
        runtime: runtimeParam,
        observable: t('Node whose dependents are dropped.', '要断开下游的节点。')
      },
      example: `invalidateObservable(runtime, oldAtom)`
    },
    isAnyRuntimeTracking: {
      role: 'operation',
      purpose: t(
        'Tells whether any runtime in the process is currently recording dependencies.',
        '查询当前进程中是否有任意一个 runtime 正处在依赖收集过程中。'
      ),
      returns: t(
        '`true` while a tracking frame is active in any runtime.',
        '任意 runtime 存在活跃的依赖收集时为 `true`。'
      ),
      example: `if (isAnyRuntimeTracking()) console.warn('不要在派生函数里执行副作用')`
    },
    isRuntimeTracking: {
      role: 'operation',
      purpose: t(
        'Tells whether `runtime` is currently recording dependencies.',
        '查询某个 runtime 当前是否正处在依赖收集过程中（computed 或 effect 求值期间）。'
      ),
      params: { runtime: runtimeParam },
      returns: t(
        '`true` inside a computed or effect evaluation of that runtime.',
        '处在该 runtime 的 computed 或 effect 求值过程中时为 `true`。'
      ),
      example: `if (isRuntimeTracking(runtime)) field.track()`
    }
  },
  types: {
    IRuntime: {
      summary: t(
        'One isolated reactive graph returned by `createRuntime()`. All nodes are created through it, and it owns batching, flushing and diagnostics.',
        '由 `createRuntime()` 返回的一张隔离的响应式图。所有节点都通过它创建，批量更新、冲刷和诊断也由它负责。'
      ),
      scenarios: runtimeScenarios,
      example: runtimeExample,
      members: runtimeMembers
    },
    IInternalRuntime: {
      summary: t(
        'Graph view of a runtime returned by `internalRuntimeOf()`: `signal()` and `computed()` return nodes that also expose `IObservable` / `IObserver`.',
        '`internalRuntimeOf()` 返回的 runtime 图视图：`signal()` 与 `computed()` 返回的节点同时暴露 `IObservable` / `IObserver`。'
      ),
      scenarios: [
        t(
          'Devtools that inspect subscribers and versions of nodes.',
          '需要查看节点订阅者与版本号的 devtools。'
        )
      ],
      example: `const graph = internalRuntimeOf(runtime)
const count = graph.signal(1)
const doubled = graph.computed(() => count.value * 2)
console.log(doubled.deps.size, count.version)`,
      members: {
        ...runtimeMembers,
        signal: {
          ...runtimeMembers.signal!,
          returns: t(
            'A signal that is also an `IObservable`.',
            '同时也是 `IObservable` 的 signal。'
          )
        },
        computed: {
          ...runtimeMembers.computed!,
          returns: t(
            'A computed value that is also an `IObservable` and an `IObserver`.',
            '同时也是 `IObservable` 与 `IObserver` 的 computed。'
          )
        }
      }
    },
    IRuntimeOptions: {
      summary: t(
        'Options of `createRuntime()`; all fields are optional and fixed at creation.',
        '`createRuntime()` 的选项；全部字段可选，在创建时确定。'
      ),
      optionCases: [
        {
          title: t('Control flush timing in tests', '在测试里掌控冲刷时机'),
          problem: t(
            'Effects normally run in a microtask, so a test has to `await` before it can assert, and timestamps differ on every run. Replacing `adapter.scheduleMicrotask` with a plain queue lets the test decide exactly when pending effects run, and fixed `now` / `timestamp` make trace output identical between runs. Entries you leave out keep their defaults.',
            'effect 默认在微任务里执行，测试只能先 `await` 再断言，而且每次运行的时间戳都不同。把 `adapter.scheduleMicrotask` 换成一个普通队列，测试就能自己决定待执行的 effect 什么时候运行；把 `now` / `timestamp` 固定下来，trace 输出每次都一样。没有传入的项继续使用默认实现。'
          ),
          example: {
            en: `import { createRuntime } from '@migaia/reactive'

const queue: (() => void)[] = []
const runtime = createRuntime({
  adapter: { scheduleMicrotask: (task) => queue.push(task), now: () => 0, timestamp: () => 0 }
})
const count = runtime.signal(0)
const seen: number[] = []
runtime.effect(() => {
  seen.push(count.value)
})

count.value = 1
console.log(seen) // [0] — the rerun is waiting in queue
queue.splice(0).forEach((task) => task())
console.log(seen) // [0, 1]`,
            zh: `import { createRuntime } from '@migaia/reactive'

const queue: (() => void)[] = []
const runtime = createRuntime({
  adapter: { scheduleMicrotask: (task) => queue.push(task), now: () => 0, timestamp: () => 0 }
})
const count = runtime.signal(0)
const seen: number[] = []
runtime.effect(() => {
  seen.push(count.value)
})

count.value = 1
console.log(seen) // [0]：重新执行还在队列里等待
queue.splice(0).forEach((task) => task())
console.log(seen) // [0, 1]`
          },
          result: t(
            'The effect reruns only when the test drains the queue, with no `await` and no timers.',
            'effect 只在测试清空队列时重新执行，不需要 `await`，也不需要计时器。'
          ),
          covers: ['adapter']
        },
        {
          title: t(
            'Render once per frame and stop feedback loops early',
            '每帧只渲染一次，并尽早拦住互相触发的循环'
          ),
          problem: t(
            "A drag handler can write a signal dozens of times between two frames. With `schedulerStrategy` handing `flush` to `requestAnimationFrame`, effects see only the last value of each frame. Two effects that write each other's input would loop forever; `maxFlushPasses` sets how many reruns one effect gets in a single flush before the runtime gives up, clears the queue and reports `FLUSH_LOOP` to `onError`.",
            '拖拽处理函数在两帧之间可能写同一个 signal 几十次。用 `schedulerStrategy` 把 `flush` 交给 `requestAnimationFrame`，effect 每帧只看到最后的值。两个 effect 互相写对方读取的值会无限循环；`maxFlushPasses` 规定一次冲刷里同一个 effect 最多重新执行几次，超过后 runtime 放弃这次冲刷、清空队列，并把 `FLUSH_LOOP` 交给 `onError`。'
          ),
          example: {
            en: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  schedulerStrategy: (flush) => requestAnimationFrame(flush),
  maxFlushPasses: 10,
  onError: (error, context) => console.error(context.phase, error)
})
const width = runtime.signal(100)
runtime.effect(() => resizePanel(width.value))
width.value = 200
width.value = 300 // next frame: resizePanel(300) runs once

const a = runtime.signal(0, { debugName: 'a' })
const b = runtime.signal(0, { debugName: 'b' })
runtime.effect(
  () => {
    b.value = a.value + 1
  },
  { debugName: 'syncB' }
)
runtime.effect(
  () => {
    a.value = b.value + 1
  },
  { debugName: 'syncA' }
)
// next frame: async-flush FLUSH_LOOP ... exceeded 10 flush passes`,
            zh: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  schedulerStrategy: (flush) => requestAnimationFrame(flush),
  maxFlushPasses: 10,
  onError: (error, context) => console.error(context.phase, error)
})
const width = runtime.signal(100)
runtime.effect(() => resizePanel(width.value))
width.value = 200
width.value = 300 // 下一帧：resizePanel(300) 只执行一次

const a = runtime.signal(0, { debugName: 'a' })
const b = runtime.signal(0, { debugName: 'b' })
runtime.effect(
  () => {
    b.value = a.value + 1
  },
  { debugName: 'syncB' }
)
runtime.effect(
  () => {
    a.value = b.value + 1
  },
  { debugName: 'syncA' }
)
// 下一帧：async-flush FLUSH_LOOP ... exceeded 10 flush passes`
          },
          result: t(
            'The panel resizes once per frame with the latest width, and the loop stops after 10 passes with an error that names the dropped effect instead of freezing the tab.',
            '面板每帧只按最新宽度调整一次；循环在 10 次后停下，报出的错误会写明被丢弃的 effect，而不是让标签页卡死。'
          ),
          covers: ['schedulerStrategy', 'maxFlushPasses']
        }
      ],
      members: {
        adapter: {
          summary: t(
            'Host capabilities: `scheduleMicrotask`, `now` (monotonic time), `timestamp` (epoch time) and `reportError`. Each missing entry falls back to the default.',
            '宿主能力注入：`scheduleMicrotask`、`now`（单调时间）、`timestamp`（纪元时间）和 `reportError`。缺少的每一项都使用默认实现。'
          ),
          default: t(
            '`queueMicrotask`, `performance.now()`, `Date.now()` and a reporter that does nothing.',
            '分别为 `queueMicrotask`、`performance.now()`、`Date.now()`，以及什么也不做的上报函数。'
          )
        },
        onError: {
          summary: t(
            'Receives errors that the runtime cannot throw to a caller (effect failures during an async flush, lifecycle hook failures, trace listener failures) with a `phase` context. Synchronous reporter failures and returned thenable rejections reach the shared utils host exception queue, without changing graph operations.',
            '接收 runtime 无法抛给调用方的错误（异步冲刷中的 effect 失败、生命周期钩子失败、trace 监听器失败），并附带 `phase` 上下文。上报器同步失败与返回的异步拒绝进入工具包共享宿主异常队列，不改变图操作结果。'
          ),
          default: t(
            'Not set: errors go to `adapter.reportError`.',
            '不设置：错误交给 `adapter.reportError`。'
          ),
          whenToUse: t(
            'Set it in every long-lived runtime. An automatic flush runs in a microtask, so a failing effect has no caller to throw to; without `onError` the default adapter drops the error and the page just stops updating. Read `context.phase` and `context.observer?.debugName` to see which effect failed.',
            '每个长期存在的 runtime 都应该设置。自动冲刷在微任务里执行，失败的 effect 没有调用方可以抛给；不设置 `onError` 时默认适配器直接丢掉错误，页面只是不再更新。读取 `context.phase` 和 `context.observer?.debugName` 就能知道是哪个 effect 失败。'
          ),
          example: {
            en: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  onError: (error, context) => {
    // context.phase: 'async-flush' for an automatic flush
    reportToMonitoring(error, { phase: context.phase, effect: context.observer?.debugName })
  }
})
const user = runtime.signal<{ name: string } | null>({ name: 'Ada' })
runtime.effect(() => render(user.value!.name), { debugName: 'renderUser' })
user.value = null // the effect throws in the next microtask; onError receives it`,
            zh: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  onError: (error, context) => {
    // 自动冲刷时 context.phase 是 'async-flush'
    reportToMonitoring(error, { phase: context.phase, effect: context.observer?.debugName })
  }
})
const user = runtime.signal<{ name: string } | null>({ name: 'Ada' })
runtime.effect(() => render(user.value!.name), { debugName: 'renderUser' })
user.value = null // effect 在下一个微任务里抛错，由 onError 接收`
          }
        },
        onTrace: {
          summary: t(
            'Receives every trace event from creation on, same as calling `subscribeTrace` immediately.',
            '从创建起接收全部 trace 事件，等同于创建后立即调用 `subscribeTrace`。'
          ),
          default: t(
            'Not set: no trace events are produced unless `subscribeTrace` is used.',
            '不设置：除非调用 `subscribeTrace`，否则不产生 trace 事件。'
          ),
          whenToUse: t(
            'Use it while diagnosing why an effect reruns too often, or to feed a devtools panel from the first node on. `subscribeTrace` called later misses the events of nodes created before it; `onTrace` sees them all. Each event names nodes by `debugName`, so give the nodes you care about a name.',
            '排查某个 effect 为什么重复执行，或者想让调试面板从第一个节点开始记录时使用。之后再调用 `subscribeTrace` 会漏掉它之前创建的节点的事件；`onTrace` 能全部收到。事件用 `debugName` 标识节点，所以给关心的节点起个名字。'
          ),
          example: {
            en: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  onTrace: (event) => {
    if (event.type === 'observable-change') console.log('changed', event.observable.debugName)
    if (event.type === 'observer-run' && event.phase === 'end')
      console.log('ran', event.observer.debugName, event.durationMs.toFixed(2), 'ms')
  }
})
const name = runtime.signal('Ada', { debugName: 'name' })
runtime.effect(
  () => {
    document.title = name.value
  },
  { debugName: 'title' }
)
// ran title 0.18 ms
name.value = 'Grace'
runtime.flush()
// changed name
// ran title 0.02 ms`,
            zh: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  onTrace: (event) => {
    if (event.type === 'observable-change') console.log('变化', event.observable.debugName)
    if (event.type === 'observer-run' && event.phase === 'end')
      console.log('执行', event.observer.debugName, event.durationMs.toFixed(2), 'ms')
  }
})
const name = runtime.signal('Ada', { debugName: 'name' })
runtime.effect(
  () => {
    document.title = name.value
  },
  { debugName: 'title' }
)
// 执行 title 0.18 ms
name.value = 'Grace'
runtime.flush()
// 变化 name
// 执行 title 0.02 ms`
          }
        },
        maxFlushPasses: {
          summary: t(
            'Maximum runs of one effect within one flush. Exceeding it is treated as a self-triggering loop: the queue is cleared and `FLUSH_LOOP` is thrown with the dropped node names. Must be a positive integer.',
            '一次冲刷中同一个 effect 最多执行的次数。超过即视为自我触发的死循环：清空队列，并抛出带被丢弃节点名称的 `FLUSH_LOOP`。必须是正整数。'
          ),
          default: t('`100` runs per effect per flush.', '每次冲刷中每个 effect 最多 `100` 次。')
        },
        scheduleIdle: {
          summary: t(
            'Schedules cleanup work, such as suspending computed values nobody observes. Use it to align cleanup with animation frames or idle callbacks.',
            '调度清理工作，例如挂起无人观察的 computed。可以用它把清理对齐到动画帧或空闲回调。'
          ),
          default: t(
            'Uses `adapter.scheduleMicrotask`.',
            '使用适配器的 `adapter.scheduleMicrotask` 微任务调度。'
          ),
          whenToUse: t(
            'Use it when many computed values lose their last observer at once, for example when a large list unmounts, and the cleanup should not compete with the next interaction. Passing `requestIdleCallback` moves that cleanup to idle time; reading the computed again before then simply keeps it alive.',
            '当很多 computed 同时失去最后一个观察者时使用，例如卸载一个很长的列表，而清理不应该和下一次交互抢时间。传入 `requestIdleCallback` 就把清理挪到浏览器空闲时；在那之前再次读取这个 computed，它就继续保持活跃。'
          ),
          example: {
            en: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  scheduleIdle: (task) => requestIdleCallback(() => task())
})
const rows = runtime.signal(loadRows())
const visible = runtime.computed(() => rows.value.filter((row) => row.visible))
const list = runtime.effect(() => renderList(visible.value))

list.dispose() // visible has no observer now; its suspension waits for idle time`,
            zh: `import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  scheduleIdle: (task) => requestIdleCallback(() => task())
})
const rows = runtime.signal(loadRows())
const visible = runtime.computed(() => rows.value.filter((row) => row.visible))
const list = runtime.effect(() => renderList(visible.value))

list.dispose() // visible 不再有观察者，它的挂起等到浏览器空闲时才执行`
          }
        },
        schedulerStrategy: {
          summary: t(
            'Decides when pending effects flush: receives a `flush` function and calls it when appropriate (for example in `requestAnimationFrame`). It must call synchronously or schedule; returning a thenable falls back to the safe default and reports `INVALID_OPTION`.',
            '决定待处理的副作用何时冲刷：接收 `flush` 函数，在合适的时机调用它（例如放进 `requestAnimationFrame`）。它必须同步调用或自行调度；返回 thenable 会退回安全的默认策略并上报 `INVALID_OPTION`。'
          ),
          default: t(
            'Merge all writes of the current task into one microtask flush.',
            '把当前任务中的写入合并到一次微任务冲刷。'
          )
        }
      }
    },
    IReactiveSignal: {
      summary: t(
        'A writable reactive node created by `runtime.signal()`: the only source of truth in the graph.',
        '由 `runtime.signal()` 创建的可写响应式节点，是图中唯一的真值来源。'
      ),
      scenarios: [
        t(
          'Hold application state (selected id, filters, form input) that computed values and effects follow.',
          '保存 computed 与 effect 跟随的应用状态（选中的 id、筛选条件、表单输入）。'
        )
      ],
      example: `const count = runtime.signal(0)
runtime.effect(() => console.log(count.value))
count.value += 1 // effect 重新执行，输出 1
console.log(count.version, count.observed) // 版本号推进，observed 为 true`,
      members: {
        ...nodeBase,
        value: {
          summary: t(
            'Current value. Reading it inside a computed or effect subscribes; assigning a value that is not `Object.is`-equal notifies dependents. Same-value writes do nothing.',
            '当前值。在 computed 或 effect 中读取会建立订阅；赋予与原值不 `Object.is` 相等的值会通知下游，写入相同值不产生任何效果。'
          )
        },
        peek: {
          summary: t('Reads the value without subscribing.', '读取当前值但不建立订阅。'),
          returns: t(
            'The current value; throws `NODE_DISPOSED` after dispose.',
            '当前值；节点释放后抛 `NODE_DISPOSED`。'
          ),
          example: `const snapshot = count.peek() // 不会让当前 effect 依赖 count`
        },
        observed: {
          summary: t(
            '`true` while the node is alive and at least one computed or effect depends on it.',
            '节点未释放且至少有一个 computed 或 effect 依赖它时为 `true`。'
          )
        },
        version: {
          summary: t(
            'Version number advanced by each effective write; useful for cheap change detection.',
            '每次有效写入都会推进的版本号，可用于低成本地判断是否变化。'
          )
        },
        addObservedHooks: {
          summary: t(
            'Registers callbacks for the first observer arriving (`onObserved`) and the last one leaving (`onUnobserved`). Several callers can register independently.',
            '登记首个观察者出现（`onObserved`）和最后一个观察者离开（`onUnobserved`）时的回调，多个调用方可以各自登记。'
          ),
          params: {
            hooks: t(
              '`onObserved` and/or `onUnobserved`.',
              '`onObserved` 和/或 `onUnobserved` 回调。'
            )
          },
          returns: t(
            'A function that removes only this registration group, even when another owner supplied the same callbacks. Several failing hooks are combined into `OBSERVER_FAILED`.',
            '只移除此登记组的函数；即使另一所有者传入相同回调，也不会受影响。多个回调同时失败时合并为 `OBSERVER_FAILED`。'
          ),
          whenToUse: t(
            'Start and stop expensive sources (sockets, polling) with demand.',
            '按需启动和停止昂贵的数据源（socket、轮询）。'
          ),
          example: `const remove = prices.addObservedHooks({
  onObserved: () => socket.subscribe('prices'),
  onUnobserved: () => socket.unsubscribe('prices')
})`
        }
      }
    },
    IReactiveComputed: {
      summary: t(
        'A lazy cached derived node created by `runtime.computed()`. Writes upstream only mark it dirty; it recomputes when read. Diamond dependencies recompute once per change.',
        '由 `runtime.computed()` 创建的惰性缓存派生节点。上游写入只把它标记为过期，读取时才重新计算；菱形依赖每次变化只重算一次。'
      ),
      scenarios: [
        t(
          'Derive totals, filtered lists or labels from signals without recomputing on every read.',
          '从信号派生合计、过滤后的列表或显示文本，读取时不会重复计算。'
        ),
        t(
          'Share one expensive derivation between several effects.',
          '让多个 effect 共享同一个开销较大的派生计算。'
        )
      ],
      example: `const price = runtime.signal(10)
const quantity = runtime.signal(2)
const total = runtime.computed(() => price.value * quantity.value)
console.log(total.value) // 20
quantity.value = 3
console.log(total.peek()) // 30
total.dispose()`,
      members: {
        ...nodeBase,
        value: {
          summary: t(
            'Current derived value; reading subscribes and recomputes when stale. A cycle throws `CIRCULAR_DEPENDENCY`.',
            '当前派生值；读取会建立订阅，过期时重新计算。出现循环依赖时抛 `CIRCULAR_DEPENDENCY`。'
          )
        },
        peek: {
          summary: t(
            'Reads (and recomputes if needed) without subscribing.',
            '读取（必要时重新计算）但不建立订阅。'
          ),
          returns: t(
            'The derived value; throws `NODE_DISPOSED` after dispose.',
            '派生值；节点释放后抛 `NODE_DISPOSED`。'
          ),
          example: `runtime.effect(() => console.log(count.value, total.peek())) // 只订阅 count`
        },
        observed: {
          summary: t(
            '`true` while at least one observer depends on it; an unobserved computed suspends at idle time.',
            '至少有一个观察者依赖它时为 `true`；无人观察的 computed 会在空闲时挂起。'
          )
        },
        version: {
          summary: t(
            'Advances when the derived value changes according to `equals`.',
            '派生值按 `equals` 判断发生变化时推进的版本号。'
          )
        }
      }
    },
    IReactiveEffect: {
      summary: t(
        'Handle of a running side effect created by `runtime.effect()`. The effect already ran once at creation; the handle only controls its lifetime.',
        '由 `runtime.effect()` 创建的运行中副作用的句柄。副作用在创建时已执行一次，句柄只负责控制它的生命周期。'
      ),
      scenarios: [
        t(
          'Render or log whenever the signals read inside change, and stop with `dispose()` when the view goes away.',
          '每当内部读取的信号变化时渲染或记录日志，视图销毁时用 `dispose()` 停止。'
        )
      ],
      example: `const name = runtime.signal('Ada')
const effect = runtime.effect(() => console.log(name.value)) // 立即输出 'Ada'
name.value = 'Grace'
runtime.flush() // 输出 'Grace' 后才释放
effect.dispose()
name.value = 'Linus' // 不再输出`,
      members: nodeBase
    },
    IDisposable: {
      summary: t(
        'Ownership contract shared by nodes and sources: `dispose()` is idempotent and `disposed` reports the state.',
        '节点与数据源共用的所有权约定：`dispose()` 可重复调用，`disposed` 反映释放状态。'
      ),
      members: { dispose: nodeBase.dispose!, disposed: nodeBase.disposed! }
    },
    IDisposer: {
      summary: t(
        'A cleanup function returned by effects and subscriptions.',
        'effect 和订阅返回的清理函数，调用后撤销对应的副作用。'
      ),
      members: {}
    },
    IComputedConfig: {
      summary: t(
        'Second argument of `runtime.computed()`: an `equals` function, or `{ equals, keepAlive, debugName }`.',
        '`runtime.computed()` 的第二个参数：`equals` 函数，或 `{ equals, keepAlive, debugName }` 对象。'
      ),
      members: {}
    },
    IReactiveNodeOptions: {
      summary: t(
        'Options of `signal()` and `effect()`.',
        '`signal()` 与 `effect()` 的选项，目前只有调试标签。'
      ),
      members: {
        debugName: {
          summary: t(
            'Label used in trace events and error messages.',
            '在 trace 事件和错误信息中显示的标签。'
          ),
          default: t(
            'Not set: the node shows only its numeric id.',
            '不设置：节点只以数字编号显示。'
          )
        }
      }
    },
    IFlushResult: {
      summary: t(
        'Result of `runtime.flush()`: `completed` (queue drained) or `deferred` (re-entrant call, outer flush continues).',
        '`runtime.flush()` 的结果：`completed`（队列已清空）或 `deferred`（重入调用，由外层冲刷继续）。'
      ),
      members: {}
    },
    ISchedulerStrategy: {
      summary: t(
        'Function that decides when to flush: it receives `flush` and calls it (now or later).',
        '决定何时冲刷的函数：它接收 `flush`，并在当下或稍后调用它。'
      ),
      members: {}
    },
    IRuntimeErrorContext: {
      summary: t(
        'Context passed with an error to `onError`.',
        '与错误一起传给 `onError` 的上下文信息。'
      ),
      members: {
        phase: {
          summary: t(
            'Where the error happened; a `ReactiveErrorPhase` value.',
            '错误发生的环节，取值见 `ReactiveErrorPhase`。'
          )
        },
        observer: {
          summary: t(
            'Descriptor `{ id, kind, debugName }` of the observer involved, if any.',
            '相关观察者的描述 `{ id, kind, debugName }`，可能不存在。'
          )
        },
        observable: {
          summary: t(
            'Descriptor of the node involved, if any.',
            '相关被观察节点的描述，可能不存在。'
          )
        }
      }
    },
    IRuntimeTraceEvent: {
      summary: t(
        'One trace event: node change, dependency connect/disconnect, effect run, or traced action. Nodes appear as descriptors.',
        '一条 trace 事件：节点变化、依赖连接/断开、副作用执行或追踪的 action。其中的节点以描述对象出现。'
      ),
      members: {
        type: {
          summary: t(
            'Event discriminant from `ReactiveTraceType`, selecting observable changes, dependency edges, observer execution or actions.',
            '来自 `ReactiveTraceType` 的事件判别值，选择可观察值变化、依赖边、观察者执行或动作。'
          ),
          values: { enum: 'ReactiveTraceType' }
        },
        timestamp: {
          summary: t(
            'Runtime-supplied event timestamp from the tracing clock; consumers do not construct this value.',
            '运行时从追踪时钟提供的事件时刻，不由消费者自行构造。'
          )
        },
        observable: {
          summary: t(
            'Runtime-issued node descriptor for the changed value or the dependency edge’s observable source.',
            '运行时提供的节点描述器，表示变化值或依赖边的被观察源。'
          )
        },
        reason: {
          summary: t(
            'Runtime-supplied cause of a value change or dependency transition; absent when that event carries no reason.',
            '运行时提供的值变化或依赖转换原因；事件未携带原因时缺失。'
          ),
          values: { enum: 'ReactiveTraceReason' }
        },
        phase: {
          summary: t(
            'Dependency connect/disconnect or execution start/end/error phase, interpreted together with the event type.',
            '依赖连接或断开阶段，或执行开始、结束、失败阶段；必须与事件类型一起解释。'
          ),
          values: { enum: 'ReactiveTracePhase' }
        },
        observer: {
          summary: t(
            'Runtime-issued descriptor identifying the observer at the dependency edge or execution event.',
            '运行时提供的描述器，标识依赖边或执行事件对应的观察者。'
          )
        },
        durationMs: {
          summary: t(
            'Optional measured execution duration in milliseconds, supplied by observer or action completion tracing.',
            '观察者或动作完成追踪提供的可选执行毫秒时长。'
          )
        },
        error: {
          summary: t(
            'Original execution failure on an error-phase observer or action event; successful phases omit it.',
            '观察者或动作错误阶段携带的原始执行失败；成功阶段不提供。'
          )
        },
        name: {
          summary: t(
            'Action name supplied by the caller to the runtime action API and retained on its trace events.',
            '调用方传给运行动作接口的名称，保留在对应追踪事件上。'
          )
        }
      }
    },
    IReactiveError: {
      summary: t(
        'Shape of errors thrown by this package: a native error with `source` and `code`.',
        '本包抛出的错误形状：带 `source` 和 `code` 字段的原生错误。'
      ),
      members: {
        source: {
          summary: t('Always `@migaia/reactive`.', '固定为 `@migaia/reactive`，用来确认错误来源。')
        },
        code: {
          summary: t(
            'One of `ReactiveErrorCode`.',
            '取值见 `ReactiveErrorCode`，按它分支处理错误。'
          )
        }
      }
    },
    IReactiveErrorCode: {
      summary: t(
        'Union of every `ReactiveErrorCode` value.',
        '`ReactiveErrorCode` 全部错误码组成的联合类型。'
      ),
      members: {}
    },
    ICapture: {
      summary: t(
        'Opaque token returned by `binding.capture()`: holds the read result and, privately, the dependencies read at render time.',
        '`binding.capture()` 返回的不透明令牌：保存读取结果，并在内部保存渲染期读到的依赖。'
      ),
      members: {
        result: {
          summary: t('The value returned by the read function.', '读取函数返回的值，供渲染使用。')
        }
      }
    },
    IObserverBinding: {
      summary: t(
        'Render/commit binding returned by `createObserverBinding()`. It owns one internal effect; the adapter can capture, observe, commit and retrack but cannot reach its dependencies.',
        '`createObserverBinding()` 返回的渲染/提交绑定。它内部持有一个 effect；适配层可以捕获、观察、提交和重新追踪，但接触不到它的依赖集合。'
      ),
      scenarios: [
        t(
          'A React adapter that must ignore discarded concurrent renders.',
          '需要忽略被丢弃的并发渲染的 React 适配层。'
        )
      ],
      example: `const binding = createObserverBinding(runtime)
const stop = binding.observe(() => forceRender())
const capture = binding.capture(() => doubled.value)
if (binding.commit(capture) === 'stale') forceRender()
stop()`,
      members: {
        capture: {
          summary: t(
            'Runs `read` with opaque capture and computed previews, without adding edges, advancing versions or scheduling work, including nested computed reads.',
            '通过不透明捕获与派生值预览执行 `read`，含嵌套派生读取；不建立依赖边、不推进版本、不排程工作。'
          ),
          params: { read: t('Render-time read function.', '渲染阶段的读取函数。') },
          returns: t('An `ICapture` token with `result`.', '带 `result` 的 `ICapture` 令牌。'),
          example: `const capture = binding.capture(() => user.value.name)`
        },
        observe: {
          summary: t(
            'Installs the internal effect that reruns when committed dependencies change. Calling it again while observed throws `BINDING_DUPLICATE`.',
            '安装内部 effect，已提交的依赖变化时它会重新执行。在已观察状态下再次调用抛 `BINDING_DUPLICATE`。'
          ),
          params: {
            fn: t(
              'The subscriber body (usually a rerender request).',
              '订阅者函数体，通常是请求重新渲染。'
            ),
            options: t('`debugName` for traces.', '用于 trace 显示的 `debugName` 标签。')
          },
          returns: t('An idempotent disposer.', '可重复调用的释放函数。'),
          example: `const stop = binding.observe(() => setTick((tick) => tick + 1))`
        },
        commit: {
          summary: t(
            'Recursively validates the evaluated capture tree, then lets the canonical tracker adopt its dependencies and preview cache. It does not rerun derivations or comparers.',
            '递归验证已求值的捕获树，再由规范追踪器接纳依赖图与预览缓存；不重新执行派生函数或比较器。'
          ),
          params: {
            capture: t(
              'Token from `capture()`; consumed when committed.',
              '`capture()` 返回的令牌，提交后即失效。'
            )
          },
          returns: t(
            '`committed` (edges installed), `stale` (a dependency changed since capture; read again) or `no-observer` (call `observe()` first; the token is kept).',
            '`committed`（依赖已安装）、`stale`（捕获后依赖已变化，需重新读取）或 `no-observer`（尚未调用 `observe()`，令牌保留可重试）。'
          ),
          example: `if (binding.commit(capture) === 'stale') rerender()`
        },
        retrack: {
          summary: t(
            'Forces the committed observer to rerun once.',
            '强制已提交的观察者重新执行一次。'
          ),
          returns: t(
            '`changed` or `unchanged` (whether its dependency set or recorded versions changed), or `no-observer`.',
            '`changed` 或 `unchanged`（依赖集合或记录版本是否变化），没有观察者时为 `no-observer`。'
          ),
          example: `binding.retrack()`
        }
      }
    },
    IObserverCommitResult: {
      summary: t(
        'Result of `binding.commit()`: `committed`, `stale` or `no-observer`.',
        '`binding.commit()` 的结果：`committed`（已安装）、`stale`（需重新读取）或 `no-observer`（尚无观察者）。'
      ),
      members: {}
    },
    IObserverRetrackResult: {
      summary: t(
        'Result of `binding.retrack()`: `changed`, `unchanged` or `no-observer`.',
        '`binding.retrack()` 的结果：`changed`（依赖集合或记录版本变化）、`unchanged`（未变）或 `no-observer`（尚无观察者）。'
      ),
      members: {}
    },
    IRuntimeFieldSource: {
      summary: t(
        'Controlled source returned by `createFieldSource()` for a value stored outside the graph.',
        '`createFieldSource()` 返回的受控数据源，用于保存在图之外的值。'
      ),
      scenarios: [
        t('A store field backed by WASM memory.', '由 WASM 内存支撑的 Store 字段。'),
        t(
          'A value in a `SharedArrayBuffer` updated by a worker.',
          '由 worker 更新的 `SharedArrayBuffer` 中的值。'
        )
      ],
      example: `const field = createFieldSource(runtime, 'counter')
const view = runtime.effect(() => {
  field.track()
  console.log(memory.counter)
})
field.commit(() => (memory.counter += 1)) // effect 重新执行
view.dispose()
field.dispose()`,
      members: {
        track: {
          summary: t(
            'Records this source as a dependency of the current computed or effect.',
            '把该数据源登记为当前 computed 或 effect 的依赖。'
          ),
          returns: t(
            'Nothing; after dispose it throws `NODE_DISPOSED`.',
            '无返回值；释放后调用抛 `NODE_DISPOSED`。'
          ),
          example: `field.track()`
        },
        notify: {
          summary: t(
            'Publishes a change that already happened outside the graph (advances the version and notifies dependents).',
            '发布一个已经在图外发生的变化（推进版本并通知下游）。'
          ),
          returns: t('Nothing; dependents are marked dirty.', '无返回值；下游被标记为过期。'),
          example: `memory.counter = 5
field.notify()`
        },
        commit: {
          summary: t(
            'Reserves a version, runs `write`, then publishes using the greater of the reservation and this source’s already-published version. Reentrant notify cannot roll the version backward; callback ordering stays unchanged.',
            '先预留版本、执行 `write`，再以预留值与此来源已发布版本的较大值发布；重入通知不会使版本回退，回调次序不变。'
          ),
          params: { write: t('Function that changes the external value.', '修改外部值的函数。') },
          returns: t('What `write` returns.', '`write` 的返回值。'),
          example: `field.commit(() => (memory.counter = 5))`
        },
        observed: {
          summary: t(
            '`true` while at least one observer depends on the source.',
            '至少有一个观察者依赖该数据源时为 `true`。'
          )
        },
        disposed: nodeBase.disposed!,
        dispose: nodeBase.dispose!
      }
    },
    IRuntimeSourceBinding: {
      summary: t(
        'Returned by `createSourceBinding()`: read-only version and subscriber views of a custom node plus a source bound to it.',
        '`createSourceBinding()` 的返回值：自定义节点的只读版本与订阅者视图，以及绑定到该节点的数据源操作。'
      ),
      scenarios: [
        t(
          'A custom atom type that participates in the graph.',
          '需要加入响应式图的自定义 atom 类型。'
        )
      ],
      example: `const binding = createSourceBinding(atom)
binding.source.track()
console.log(binding.version, binding.subs.size)`,
      members: {
        version: {
          summary: t(
            'Version of the node, advanced only by its source.',
            '节点的版本号，只会由它的数据源推进。'
          )
        },
        subs: {
          summary: t(
            'Live read-only set of observers depending on the node.',
            '依赖该节点的观察者集合（实时、只读）。'
          )
        },
        source: {
          summary: t(
            '`track` / `notify` / `commit` / `dispose` bound to this node.',
            '绑定到这个节点、不能改指其它节点的 `track` / `notify` / `commit` / `dispose` 操作。'
          )
        }
      }
    },
    ITrackedObserverBinding: {
      summary: t(
        'Returned by `createTrackedObserver()`: graph operations bound to one custom observer.',
        '`createTrackedObserver()` 的返回值：绑定到某个自定义观察者的图操作。'
      ),
      scenarios: [
        t(
          'A resource node that re-requests data when its inputs change.',
          '输入变化时重新请求数据的资源节点。'
        )
      ],
      example: `const tracked = createTrackedObserver(resource)
const input = tracked.runTracked(() => query.value)
if (tracked.hasStaleDependencies()) refetch()`,
      members: {
        deps: {
          summary: t(
            'Read-only set of nodes this observer currently depends on.',
            '该观察者当前依赖的节点集合（只读）。'
          )
        },
        depVersions: {
          summary: t(
            'Versions recorded during the last tracked run.',
            '最近一次追踪执行时记录的各依赖版本。'
          )
        },
        runTracked: {
          summary: t(
            'Runs `read` in this observer dependency frame, recording what it reads.',
            '在该观察者的依赖收集环境中执行 `read`，记录其中的读取。'
          ),
          params: { read: t('Synchronous read function.', '同步读取函数。') },
          returns: t(
            'What `read` returns; its errors propagate unchanged.',
            '`read` 的返回值；其错误原样抛出。'
          ),
          example: `const id = tracked.runTracked(() => userId.value)`
        },
        clear: {
          summary: t('Disconnects all dependencies of the observer.', '断开该观察者的全部依赖。'),
          returns: t(
            'Nothing; resources and requests remain the caller responsibility.',
            '无返回值；资源与请求仍由调用方管理。'
          ),
          example: `tracked.clear()`
        },
        suspend: {
          summary: t(
            'Removes reverse edges but keeps the version snapshot for later revalidation.',
            '移除反向依赖边，但保留版本快照以便之后重新验证。'
          ),
          returns: t(
            'Nothing; a suspended snapshot is retained only when dependencies existed. Empty dependencies leave `isSuspended()` false.',
            '无返回值；仅原本有依赖时保留挂起快照。空依赖不会使 `isSuspended()` 变为真。'
          ),
          example: `tracked.suspend()`
        },
        isSuspended: {
          summary: t(
            'Tells whether a suspended snapshot is retained.',
            '查询是否保留着挂起时的快照。'
          ),
          returns: t(
            '`true` exactly while a private suspended snapshot exists; failed revalidation may retain it until the next tracked run or clear.',
            '私有挂起快照存在时才为真；重新验证失败可保留快照，直到下一次追踪执行或清除。'
          ),
          example: `if (tracked.isSuspended()) tracked.revalidate()`
        },
        revalidate: {
          summary: t(
            'Compares the retained snapshot with current versions and reattaches unchanged dependencies.',
            '用当前版本对比保留的快照，并重新挂接未变化的依赖。'
          ),
          returns: t(
            '`true` when every dependency is unchanged (cache still valid).',
            '所有依赖都未变化（缓存仍有效）时返回 `true`。'
          ),
          example: `if (!tracked.revalidate()) recompute()`
        },
        hasStaleDependencies: {
          summary: t(
            'Pulls upstream nodes and tells whether any recorded version changed.',
            '拉取上游节点，并判断是否有已记录的版本发生了变化。'
          ),
          returns: t(
            '`true` when at least one dependency changed.',
            '至少有一个依赖变化时返回 `true`。'
          ),
          example: `if (tracked.hasStaleDependencies()) refetch()`
        },
        deferIdle: {
          summary: t(
            'Schedules work on the runtime idle channel.',
            '把工作排到 runtime 的空闲通道执行。'
          ),
          params: { task: t('Work to run later.', '稍后执行的工作。') },
          returns: t(
            'Nothing; failures go to `reportError`.',
            '无返回值；失败交给 `reportError`。'
          ),
          example: `tracked.deferIdle(() => tracked.clear())`
        }
      }
    },
    IObservable: {
      summary: t(
        'Node protocol for values in the graph. Custom nodes implement it and are registered with `createSourceBinding()`; `subs` and `version` are maintained by the runtime.',
        '图中值节点的协议。自定义节点实现它，并通过 `createSourceBinding()` 登记；`subs` 与 `version` 由 runtime 维护。'
      ),
      scenarios: [
        t(
          'Inspect who depends on a signal or computed (`subs`, `version`) while debugging.',
          '调试时查看哪些节点依赖某个 signal 或 computed（`subs`、`version`）。'
        ),
        t(
          'Write an adapter node for an external store and register it with `createSourceBinding()`.',
          '为外部数据仓库编写适配节点，并用 `createSourceBinding()` 登记。'
        )
      ],
      example: `import { internalRuntimeOf } from '@migaia/reactive/extension'

const graph = internalRuntimeOf(runtime)
const count = graph.signal(0)
runtime.effect(() => { void count.value })
console.log(count.subs.size, count.version) // 1 个订阅者与当前版本号`,
      members: {
        runtime: nodeBase.runtime!,
        debugName: nodeBase.debugName!,
        subs: {
          summary: t(
            'Observers depending on the node (maintained by the runtime).',
            '依赖该节点的观察者（由 runtime 维护）。'
          )
        },
        version: {
          summary: t('Version advanced by each published change.', '每次发布变化时推进的版本号。')
        },
        pull: {
          summary: t(
            'Optional: brings a lazy node up to date before it is read.',
            '可选：在读取前让惰性节点更新到最新。'
          ),
          returns: t(
            'Nothing; afterwards `version` is current.',
            '无返回值；之后 `version` 为最新。'
          ),
          example: `total.pull?.() // 由 runtime 在比较版本号之前调用`
        },
        isStale: {
          summary: t(
            'Optional: tells, without computing, whether the node needs recomputation.',
            '可选：不进行计算，只判断节点是否需要重新计算。'
          ),
          returns: t(
            '`true` when stale; must not throw or change the graph.',
            '需要重算时返回 `true`；不得抛错或修改图。'
          ),
          example: `if (total.isStale?.()) console.log('下次读取时会重新计算')`
        },
        onObserved: {
          summary: t(
            'Optional hook called when the first observer subscribes.',
            '可选钩子：第一个观察者订阅时调用。'
          ),
          returns: t('Nothing.', '无返回值；可在这里启动外部订阅。'),
          example: `onObserved() { this.stop = externalStore.subscribe(this.onStoreChange) }`
        },
        onUnobserved: {
          summary: t(
            'Optional hook called when the last observer leaves.',
            '可选钩子：最后一个观察者离开时调用。'
          ),
          returns: t('Nothing.', '无返回值；可在这里停止外部订阅。'),
          example: `onUnobserved() { this.stop?.() }`
        }
      }
    },
    IObserver: {
      summary: t(
        'Node protocol for consumers in the graph (computed values and effects implement it). Custom observers are registered with `createTrackedObserver()`.',
        '图中消费者的协议（computed 和 effect 都实现了它）。自定义观察者通过 `createTrackedObserver()` 登记。'
      ),
      scenarios: [
        t(
          'Build a custom consumer (such as `Resource` from `@migaia/resource`) that reruns when the values it read change.',
          '构建自定义消费者（例如 `@migaia/resource` 的 `Resource`），在其读取过的值变化时重新执行。'
        )
      ],
      example: `// @migaia/resource 的 Resource 实现了 IObserver：
const user = new Resource(({ signal }) => fetchUser(userId.value, { signal }), runtime)
console.log(user.deps.has(userId)) // true：userId 变化时 runtime 调用 user.markDirty()`,
      members: {
        runtime: nodeBase.runtime!,
        disposed: nodeBase.disposed!,
        debugName: nodeBase.debugName!,
        deps: { summary: t('Nodes this observer depends on.', '该观察者依赖的节点集合。') },
        depVersions: {
          summary: t(
            'Versions of the dependencies at the last run.',
            '上一次执行时各依赖的版本号。'
          )
        },
        markDirty: {
          summary: t(
            'Called by the runtime when a dependency changed.',
            '依赖变化时由 runtime 调用，通知观察者已过期。'
          ),
          returns: t(
            'Nothing; the observer should schedule its rerun.',
            '无返回值；观察者应安排自己重新执行。'
          ),
          example: `markDirty() { queueMicrotask(() => this.rerun()) }`
        },
        onDependencyDisconnected: {
          summary: t(
            'Called by the runtime when a dependency is disconnected by disposal or invalidation; an invalidated node can still be usable.',
            '依赖因释放或失效而断开时由运行时调用；失效节点仍可能继续使用。'
          ),
          params: {
            observable: t(
              'The disconnected dependency, which may still be usable after invalidation.',
              '被断开的依赖节点；失效后仍可能可用。'
            )
          },
          returns: t(
            'Nothing; rerun to reconnect or expose a disposal failure as appropriate.',
            '无返回值；重新执行以恢复连接，或按实际情况暴露释放失败。'
          ),
          example: `onDependencyDisconnected() {
  this.rerun() // 重新读取以恢复连接或暴露释放错误
}`
        }
      }
    }
  },
  enums: {
    ReactiveErrorCode: {
      summary: t(
        'Codes on errors thrown or reported by this package.',
        '本包抛出或上报的错误上的 `error.code`。'
      ),
      values: {
        callbackFailed: t(
          '`CALLBACK_FAILED`: an unclassified callback failure. Writable native errors retain identity; primitive or immutable failures remain on cause, including undefined. Valid external identities and non-Error object control values pass through unchanged, without then probing.',
          '`CALLBACK_FAILED`：未分类的回调失败。可修改的原生错误保留身份；原始值或不可修改失败通过原因保留，含空缺值。已有合法外部身份与非错误对象控制值原样通过，不在此探测异步入口。'
        ),
        nodeDisposed: t(
          '`NODE_DISPOSED`: a disposed signal, computed or source was read or written.',
          '`NODE_DISPOSED`：读取或写入了已释放的 signal、computed 或数据源。'
        ),
        circularDependency: t(
          '`CIRCULAR_DEPENDENCY`: a computed read itself while being computed.',
          '`CIRCULAR_DEPENDENCY`：computed 在计算过程中（直接或间接）读取了自己。'
        ),
        crossRuntime: t(
          '`CROSS_RUNTIME`: a node of one runtime was used by another runtime.',
          '`CROSS_RUNTIME`：一个 runtime 的节点被另一个 runtime 读取、订阅或校验。'
        ),
        notRuntimeOwned: t(
          '`NOT_RUNTIME_OWNED`: the object is not a runtime (or node) registered by this package.',
          '`NOT_RUNTIME_OWNED`：传入的对象不是本包登记的 runtime 或节点。'
        ),
        ownershipConflict: t(
          '`OWNERSHIP_CONFLICT`: one object was registered to two runtimes.',
          '`OWNERSHIP_CONFLICT`：同一个对象被登记到两个不同的 runtime。'
        ),
        copyConflict: t(
          '`COPY_CONFLICT`: multiple copies registered at a correctness boundary, or a foreign branded node crossed a local boundary. Cold imports alone need not register.',
          '`COPY_CONFLICT`：多份副本进入正确性边界登记，或带外部品牌的节点越过本地边界；仅冷导入不一定登记。'
        ),
        brandCorrupted: t(
          '`BRAND_CORRUPTED`: the cross-copy diagnostic marker has an unexpected shape.',
          '`BRAND_CORRUPTED`：跨副本诊断标记的形状不符合预期。'
        ),
        versionExhausted: t(
          '`VERSION_EXHAUSTED`: the version clock reached its upper limit.',
          '`VERSION_EXHAUSTED`：版本时钟达到上限后又申请新版本号。'
        ),
        flushLoop: t(
          '`FLUSH_LOOP`: one effect ran more than `maxFlushPasses` times in one flush.',
          '`FLUSH_LOOP`：一次冲刷中同一个 effect 执行次数超过 `maxFlushPasses`。'
        ),
        observerFailed: t(
          '`OBSERVER_FAILED`: several observers or hooks failed in one flush; an `AggregateError` holds them.',
          '`OBSERVER_FAILED`：一次冲刷中多个观察者或钩子失败，以 `AggregateError` 汇总。'
        ),
        actionFlushFailed: t(
          '`ACTION_FLUSH_FAILED`: a batch body and its final flush both failed.',
          '`ACTION_FLUSH_FAILED`：`batch` 的函数体与收尾冲刷同时失败，两个错误都被保留。'
        ),
        schedulerFailed: t(
          '`SCHEDULER_FAILED`: reserved code for scheduler strategy failures reported by adapters.',
          '`SCHEDULER_FAILED`：预留给适配层上报调度策略失败的错误码。'
        ),
        captureInvalid: t(
          '`CAPTURE_INVALID`: a capture token was already used, belongs elsewhere, or its observer is gone.',
          '`CAPTURE_INVALID`：捕获令牌已被使用、属于其它追踪器，或对应观察者已释放。'
        ),
        bindingDuplicate: t(
          '`BINDING_DUPLICATE`: `observe()` was called twice on one binding.',
          '`BINDING_DUPLICATE`：同一个绑定上重复调用了 `observe()`。'
        ),
        graphNodeRegistered: t(
          '`GRAPH_NODE_REGISTERED`: a source or observer binding targeted an already registered node.',
          '`GRAPH_NODE_REGISTERED`：数据源或观察者绑定指向了已登记的节点，需要新建节点。'
        ),
        internalsRegistered: t(
          '`INTERNALS_REGISTERED`: internal services were registered twice for one runtime.',
          '`INTERNALS_REGISTERED`：同一个 runtime 的内部服务被重复登记。'
        ),
        invalidOption: t(
          '`INVALID_OPTION`: a runtime option or argument has an invalid value.',
          '`INVALID_OPTION`：runtime 选项或参数取值不合法。'
        )
      }
    },
    ReactiveTracePhase: {
      summary: t(
        'Phase field of trace events.',
        'trace 事件的 `phase` 字段取值，说明事件所处的阶段。'
      ),
      values: {
        start: t(
          '`start`: an effect run or action began.',
          '`start`：一次副作用执行或 action 刚刚开始。'
        ),
        end: t(
          '`end`: it finished; `durationMs` is set.',
          '`end`：执行正常结束，事件带有耗时 `durationMs`。'
        ),
        error: t(
          '`error`: it failed; `error` is set.',
          '`error`：执行失败结束，事件带有失败原因 `error`。'
        ),
        connect: t(
          '`connect`: a dependency edge was added.',
          '`connect`：观察者与节点之间新增了一条依赖边。'
        ),
        disconnect: t(
          '`disconnect`: a dependency edge was removed.',
          '`disconnect`：观察者与节点之间的一条依赖边被移除。'
        )
      }
    },
    ReactiveTraceReason: {
      summary: t(
        'Reason field of trace events.',
        'trace 事件的 `reason` 字段取值，说明事件的起因。'
      ),
      values: {
        set: t(
          '`set`: a signal was assigned a new value.',
          '`set`：某个 signal 被赋予了一个不同的新值。'
        ),
        notify: t(
          '`notify`: a source published an external change.',
          '`notify`：数据源发布了一次外部变化。'
        ),
        retrack: t(
          '`retrack`: an edge changed because the observer reran.',
          '`retrack`：观察者重新执行导致依赖边变化。'
        ),
        invalidate: t(
          '`invalidate`: edges were removed by `invalidateObservable`.',
          '`invalidate`：依赖边因调用 `invalidateObservable` 而被移除。'
        ),
        dispose: t(
          '`dispose`: edges were removed because a node was disposed.',
          '`dispose`：节点被释放导致依赖边移除。'
        )
      }
    },
    ReactiveTraceType: {
      summary: t('Type field of trace events.', 'trace 事件的 `type` 字段取值，用来区分事件种类。'),
      values: {
        observableChange: t(
          '`observable-change`: a node value changed.',
          '`observable-change`：某个节点的值发生了变化。'
        ),
        dependency: t(
          '`dependency`: a dependency edge was connected or disconnected.',
          '`dependency`：观察者与节点之间的依赖边被连接或断开。'
        ),
        observerRun: t(
          '`observer-run`: an effect or computed ran.',
          '`observer-run`：某个 effect 或 computed 完整执行了一次。'
        ),
        action: t(
          '`action`: a `runTracedAction` call.',
          '`action`：一次通过 `runTracedAction` 记录的具名操作。'
        )
      }
    },
    ReactiveErrorPhase: {
      summary: t(
        'Values of `context.phase` passed to `onError`.',
        '传给 `onError` 的 `context.phase` 取值，说明错误发生的环节。'
      ),
      values: {
        asyncFlush: t(
          'An effect failed during a scheduled (asynchronous) flush.',
          '在调度执行的（异步）冲刷中，某个 effect 失败。'
        ),
        causeRead: t(
          'Reading the `cause` of a batch error failed.',
          '批处理收尾时读取业务错误的 `cause` 失败。'
        ),
        dependencyDisconnect: t(
          'A hook failed while a dependency was disconnected.',
          '断开依赖时某个钩子失败。'
        ),
        lifecycleHook: t(
          'An `onObserved` / `onUnobserved` hook failed.',
          '节点的 `onObserved` 或 `onUnobserved` 生命周期钩子执行失败。'
        ),
        ssrResource: t(
          'An SSR resource failed (reported by store adapters).',
          'SSR 资源失败（由 Store 适配层上报）。'
        ),
        subscriptionListener: t(
          'A subscription listener of an adapter failed.',
          '适配层的订阅监听器失败。'
        ),
        traceListener: t('A trace listener failed.', '某个 trace 监听器在处理事件时抛出了错误。')
      }
    }
  },
  enhancers: {}
}
