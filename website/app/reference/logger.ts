/**
 * Reference documentation of `@migaia/logger`. Rules: `app/reference/contract.ts`. Verified against
 * `packages/logger/src` (log.ts, typing.ts, runtime-manager.ts, state-constants.ts, error-code.ts,
 * plugins/*.ts), README and USEGUIDE on 2026-10-18. Runtime shutdown drains final structured
 * entries before plugin disposal; raw output stops at shutdown admission. Native error references
 * remain local while HTTP/color JSON use the canonical bounded error-chain projection.
 */
import type {
  ICode,
  IGrantDoc,
  ILibraryReference,
  IMemberDoc,
  IOptionCaseDoc,
  IText,
  ITypeDoc
} from './contract.js'
import { loggerCases } from './logger-cases.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Canonical shared fields of ILogEntry. */
const logEntryMembers: Readonly<Record<string, IMemberDoc>> = {
  id: {
    summary: t(
      'Entry id `log_<n>`, increasing within the process.',
      '条目 id，格式为 `log_<n>`，在进程内递增。'
    )
  },
  tag: {
    summary: t(
      'Tag given to `log()` / `dispatchRaw()` or by a plugin (`info`, `thinking`).',
      '由 `log()` / `dispatchRaw()` 或插件给出的标签（如 `info`、`thinking`）。'
    )
  },
  time: {
    summary: t(
      'Creation time; a replacement entry must keep a `Date` of the current realm.',
      '创建时间；替换条目时必须保留当前 realm 的 `Date`。'
    )
  },
  message: {
    summary: t('Message text of the entry.', '日志的消息文本，可包含 `%s` 占位符。')
  },
  args: { summary: t('Extra values passed after the message.', '消息之后传入的附加值。') },
  meta: {
    summary: t(
      'Structured metadata given to `dispatchRaw()`.',
      '通过 `dispatchRaw()` 传入的结构化元数据。'
    )
  },
  context: {
    summary: t(
      'Context path such as ["api", "users"]; when dispatchRaw omits it, the entry copies ctx.path, whose constructor default is [].',
      '条目所属路径，例如 `["api", "users"]`；`dispatchRaw` 省略时复制 `ctx.path`，构造路径默认 `[]`。'
    )
  },
  error: {
    summary: t(
      'Local projection of an Error argument, retaining its original native object; HTTP/color JSON serialize a bounded chain instead of raw. See IErrorInfo.',
      '`Error` 参数的本地投影，保留原生对象；网络与颜色插件的结构化输出改用有界错误链而不发送原对象，见 `IErrorInfo`。'
    )
  },
  data: {
    summary: t(
      'Plugin data area: uuid writes uuid and reasoning sets silent so console skips the entry. A forwarded sink copy also contains display-only topicChain; the internal cycle-detection symbol remains hidden.',
      '插件数据区：`uuid()` 写入 `uuid`，`reasoning()` 设置 `silent: true` 使控制台跳过。转发后的输出端副本含仅供展示的 `topicChain`，内部循环检测符号不外泄。'
    )
  }
}

/** Short type doc for function and union aliases. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })

/** Turns member docs into grant docs shown on an enhancer page. */
const grantsOf = (
  receiver: string,
  members: Readonly<Record<string, IMemberDoc & { call: string }>>
): IGrantDoc[] =>
  Object.entries(members).map(([name, { call, ...doc }]) => ({
    ...doc,
    signature: `${receiver}.${name}${call}`
  }))

/** Strips the call form used for grants so the same docs serve a type surface. */
const membersOf = (
  members: Readonly<Record<string, IMemberDoc & { call: string }>>
): Record<string, IMemberDoc> =>
  Object.fromEntries(Object.entries(members).map(([name, { call: _call, ...doc }]) => [name, doc]))

/** Minimal construction used by every example; `execution` is required. */
const create = `const log = new Logger({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },`

/** Logger construction example shared by the class symbol and its instance surface. */
const loggerExample: ICode = {
  en: `import { Logger } from '@migaia/logger'
import { color, level } from '@migaia/logger/plugins'

${create}
  context: ['api'],
  plugins: [level({ level: 'info' }), color({ format: 'pretty' })]
})

const stop = log.onFailure(({ source, error }) => console.error(source, error))
log.info('server listening on %d', 3000) // added by level()
log.dispatchRaw({ tag: 'audit', message: 'user created', meta: { userId: 'u1' } })
await log.flush() // wait until outputs finished
stop()
await log.shutdown('manual')`,
  zh: `import { Logger } from '@migaia/logger'
import { color, level } from '@migaia/logger/plugins'

${create}
  context: ['api'],
  plugins: [level({ level: 'info' }), color({ format: 'pretty' })]
})

const stop = log.onFailure(({ source, error }) => console.error(source, error))
log.info('server listening on %d', 3000) // 由 level() 提供
log.dispatchRaw({ tag: 'audit', message: 'user created', meta: { userId: 'u1' } })
await log.flush() // 等待所有输出完成
stop()
await log.shutdown('manual')`
}

/** Scenarios of a logger instance. */
const loggerScenarios = [
  t(
    'One logging API across Node, Bun, Deno, browsers and workers, with only the plugins each environment needs.',
    '在 Node、Bun、Deno、浏览器和 Worker 中使用同一套日志接口，每个环境只安装需要的插件。'
  ),
  t(
    'Production pipelines that batch and upload entries, and must not lose them on exit (`flush()`, `shutdown()`).',
    '需要攒批上报日志、并且退出时不能丢日志的生产链路（`flush()`、`shutdown()`）。'
  ),
  t(
    'Forwarding one logger into another (`extends()`), for example a module logger into an audit logger.',
    '把一个 logger 转发到另一个 logger（`extends()`），例如把模块日志转发给审计日志。'
  )
]

/** Text of a returned removal function. */
const offReturns = t(
  'A function that removes only this registration; calling it again does nothing.',
  '只移除本次登记的函数；重复调用没有效果。'
)

/** Docs of `ILogDispatchOptions` used as the `options` parameter. */
const dispatchOptionsParam = t(
  'Optional `{ asyncOutput }`: `true` schedules the output with `defer()` so the call returns before any sink runs; default `false`.',
  '可选的 `{ asyncOutput }`：为 `true` 时通过 `defer()` 调度输出，调用会在任何 sink 执行前返回；默认 `false`。'
)

/** Members of the logger surface (`ILoggerCore` plus the application `config` facade). */
const coreMembers: Readonly<Record<string, IMemberDoc>> = {
  config: {
    summary: t(
      'Configuration store of the installed plugins. On a logger it is `ILoggerConfig` (`get(path)`, `update(name, recipe)`); inside a plugin `install(core)` it is a reader of that plugin configuration only (`get()`).',
      '已安装插件的配置仓库。在 logger 实例上是 `ILoggerConfig`（`get(path)`、`update(name, recipe)`）；在插件的 `install(core)` 中只能读取该插件自己的配置（`get()`）。'
    )
  },
  ctx: {
    summary: t(
      'Frozen context of this logger: `id`, application `options`, default context `path`, `topic`, `createdAt` and `env`.',
      '该 logger 冻结的上下文：`id`、应用 `options`、默认上下文 `path`、`topic`、`createdAt` 与 `env`。'
    )
  },
  scheduler: {
    summary: t(
      'Clock and timers used by `flush()`, `shutdown()` and batch deadlines; the `scheduler` option or `systemScheduler`.',
      '`flush()`、`shutdown()` 与批处理截止时间使用的时钟和计时器；来自 `scheduler` 选项，默认为 `systemScheduler`。'
    )
  },
  runtimeManager: {
    summary: t(
      'Host capabilities (stdout, UUID, scheduling, fetch, fs) captured at construction from the `runtimeManager` option or `getLoggerRuntimeManager()`; plugins use the same object.',
      '构造时从 `runtimeManager` 选项或 `getLoggerRuntimeManager()` 捕获的宿主能力（stdout、UUID、调度、fetch、fs）；插件使用同一个对象。'
    )
  },
  log: {
    summary: t(
      'Console-style entry point: builds an entry with this tag and message and dispatches it through pipeline, hooks and sinks. A trailing object stays an argument; it is not turned into `meta`. Never throws for sink failures.',
      '控制台风格的入口：用该标签和消息构造日志条目，并依次经过管线、钩子与 sink。最后一个对象参数仍是普通参数，不会变成 `meta`。sink 失败不会从这里抛出。'
    ),
    params: {
      tag: t(
        'Entry tag such as `info` or `audit`; the level() threshold applies only to the five standard levels, while its filters apply to every tag.',
        '日志条目的标签，例如 `info` 或 `audit`；`level()` 的级别门槛仅约束五个标准级别，过滤函数仍约束所有标签。'
      ),
      message: t(
        'Message text; `%s`, `%d`, `%o` placeholders are left for the console sink.',
        '消息文本；`%s`、`%d`、`%o` 占位符交给控制台 sink 处理。'
      ),
      args: t(
        'Extra values stored in `entry.args` in order.',
        '按顺序保存到 `entry.args` 的附加值。'
      )
    },
    returns: t(
      'No value. Shutdown handlers can still enqueue final structured entries; calls are ignored after draining closes dispatch admission.',
      '无返回值；关闭回调期间仍接收最终结构化日志，排空结束并撤销准入后才忽略后续调用。'
    ),
    example: `log.log('info', 'user %s logged in', userId)`
  },
  dispatchRaw: {
    summary: t(
      'Dispatches an entry with explicit fields (`meta`, `data`, `context`, `error`, `time`) for structured or audit logs.',
      '用显式字段（`meta`、`data`、`context`、`error`、`time`）分发日志条目，适合结构化日志或审计日志。'
    ),
    params: {
      input: t(
        'Required tag and message, plus optional args (default []), meta (undefined), data ({}), context (constructor context), error (first Error argument projected to name/message/stack/raw, otherwise undefined) and time (current Date). The core assigns id; callers cannot supply it. Metadata/data keys such as orderId and route are application-defined. Containers are copied, nested application values stay shared.',
        '`tag` 与 `message` 必填；可选 `args` 默认 `[]`，`meta` 默认 `undefined`，`data` 默认 `{}`，`context` 默认构造路径，`error` 默认取首个 Error 参数的名称、消息、堆栈及原对象投影，未找到时为 `undefined`，`time` 默认当前日期。`id` 由核心分配，调用者不能提供；`orderId`、`route` 等键由应用定义，容器会复制，嵌套业务值仍共享。'
      ),
      options: dispatchOptionsParam
    },
    returns: t('Nothing; failures go to `onFailure()`.', '无返回值；失败交给 `onFailure()`。'),
    example: `log.dispatchRaw({ tag: 'audit', message: 'role changed', meta: { userId }, context: ['admin'] })`
  },
  raw: {
    summary: t(
      'Writes text straight to stdout (or `console.log` without `process`), skipping pipeline and sinks; used for streaming output. Ignored once shutdown starts.',
      '把文本直接写到 stdout（没有 `process` 时用 `console.log`），跳过管线和 sink；用于流式输出。关闭流程开始后忽略。'
    ),
    params: {
      text: t(
        'Text passed unchanged to runtimeManager.write. A host stdout writer can preserve no-newline output; the default console.log fallback without process adds its own newline.',
        '原样传给 `runtimeManager.write` 的文本；宿主标准输出写入可保留不换行效果，无进程宿主的默认 `console.log` 回退会自行换行。'
      ),
      options: dispatchOptionsParam
    },
    returns: t('Nothing.', '无返回值；文本已写出或已排入调度。'),
    example: `log.raw('progress: 42%\\r')`
  },
  usePipeline: {
    summary: t(
      'Registers a synchronous stage (entry, next, context?) => void in every pipeline mode. PluginHost lifts it into the selected mode; call next(entry) to continue or omit next to drop the entry.',
      '所有管线模式均可注册同步阶段 `(entry, next, context?) => void`，功能宿主把它提升至所选模式；调用 `next(entry)` 继续，不调用则丢弃条目。'
    ),
    params: {
      stage: t('The stage function; call `next` at most once.', '阶段函数；`next` 最多调用一次。')
    },
    returns: t(
      'The same logger for chaining; synchronous registration works in all modes. Other stage registration methods follow the mode compatibility matrix.',
      '返回同一个日志实例以便链式调用，同步注册适用于全部模式，其余阶段注册按模式兼容矩阵准入。'
    ),
    example: `log.usePipeline((entry, next) => {
  if (entry.meta?.secret) return
  next(entry)
})`
  },
  useAsyncPipeline: {
    summary: t(
      'Registers an async onion-style stage (mode `async` only): code after `await next(entry)` runs once the downstream finished.',
      '注册异步洋葱式阶段（仅 `async` 模式）：`await next(entry)` 之后的代码在下游全部完成后执行。'
    ),
    params: {
      stage: t('`async (entry, next) => void`.', '异步阶段函数 `async (entry, next) => void`。')
    },
    returns: t(
      'The same logger; other modes reject it at type level and at runtime.',
      '同一个 logger；其它模式在类型层面和运行时都会拒绝。'
    ),
    example: `log.useAsyncPipeline(async (entry, next) => {
  await next({ ...entry, data: { ...entry.data, region: await lookupRegion() } })
})`
  },
  useGeneratorPipeline: {
    summary: t(
      'Registers a generator stage (modes `generator` and `async-generator`).',
      '注册生成器阶段（`generator` 与 `async-generator` 模式可用）。'
    ),
    params: {
      stage: t(
        'Generator (entry, context?), with optional pipeline context as the second argument, never next. Return a payload or GENERATOR_CONTINUE after yielding to continue; an implicit undefined return halts.',
        '生成器 `(entry, context?)`，第二参数是可选管线上下文而非继续函数；返回载荷，或产出后返回 `GENERATOR_CONTINUE` 才继续，隐式空返回会终止。'
      )
    },
    returns: t('The same logger, for chaining.', '同一个 logger，可链式调用。'),
    example: `import { GENERATOR_CONTINUE } from '@migaia/middleware-pipeline'
log.useGeneratorPipeline(function* (entry, context) {
  if (context?.signal.aborted) return
  yield entry
  return GENERATOR_CONTINUE
})`
  },
  useAsyncGeneratorPipeline: {
    summary: t(
      'Registers an async generator stage (mode `async-generator` only); each stage runs to its final value before the next.',
      '注册异步生成器阶段（仅 `async-generator` 模式）；每个阶段得到最终值后才进入下一个阶段。'
    ),
    params: {
      stage: t(
        'Async generator (entry, context?) with optional context as the second argument. Yield stores a candidate; return payload or GENERATOR_CONTINUE to continue. The logger explicitly delegates stage registration to its functional Host.',
        '异步生成器 `(entry, context?)` 的第二参数为可选上下文；产出只保存候选值，返回载荷或 `GENERATOR_CONTINUE` 才继续。日志实例显式委派功能宿主登记阶段。'
      )
    },
    returns: t('The same logger, for chaining.', '同一个 logger，可链式调用。'),
    example: `import { GENERATOR_CONTINUE } from '@migaia/middleware-pipeline'
log.useAsyncGeneratorPipeline(async function* (entry, context) {
  if (context?.signal.aborted) return
  yield await Promise.resolve(entry)
  return GENERATOR_CONTINUE
})`
  },
  useSink: {
    summary: t(
      'Registers an output that receives every entry passing the pipeline. Each sink gets its own shallow copy; a returned Promise is awaited by `flush()`; a throw goes to `onFailure()` with source `sink`.',
      '注册一个输出端，接收所有通过管线的条目。每个 sink 拿到各自的浅拷贝；返回的 Promise 会被 `flush()` 等待；抛错交给 `onFailure()`，来源为 `sink`。'
    ),
    params: {
      sink: t('`(entry) => void | Promise<void>`.', '输出函数 `(entry) => void | Promise<void>`。')
    },
    returns: offReturns,
    example: `const stopSink = log.useSink((entry) => { auditQueue.push(entry) })`
  },
  hook: {
    summary: t(
      'Registers a hook under a name: built-in `before`, `after`, `before:<tag>`, `after:<tag>`, or a name a plugin fires. Hooks receive the live entry and may change it.',
      '按名称登记钩子：内置名称为 `before`、`after`、`before:<tag>`、`after:<tag>`，也可以是插件自己触发的名称。钩子拿到的是活的条目，可以修改它。'
    ),
    params: {
      name: t('Hook name.', '钩子名称，例如 `before:error`。'),
      fn: t(
        '`(entry) => void | Promise<void>`; a returned Promise is awaited by `flush()`.',
        '`(entry) => void | Promise<void>`；返回的 Promise 会被 `flush()` 等待。'
      )
    },
    returns: t(
      'An idempotent off callback removing only this registration; registering the same function again creates an independent subscription.',
      '幂等取消函数，只释放本次登记；同一函数再次登记仍是互不影响的独立订阅。'
    ),
    example: `log.hook('before:error', (entry) => {
  entry.data.alert = true
})`
  },
  fireHook: {
    summary: t(
      'Runs every hook registered under `name` with the given entry now.',
      '立即用给定条目执行该名称下登记的全部钩子。'
    ),
    params: {
      name: t('Hook name to fire.', '要触发的钩子名称。'),
      entry: t(
        'An entry, usually received in a sink or stage.',
        '一个日志条目，通常来自 sink 或管线阶段。'
      )
    },
    returns: t(
      'Nothing; hook failures go to `onFailure()`.',
      '无返回值；钩子失败交给 `onFailure()`。'
    ),
    example: `log.fireHook('after:audit', entry)`
  },
  onFailure: {
    summary: t(
      'Observes failures of sinks, hooks, pipeline, deferred tasks, flush, forwarding and shutdown. Logging calls never throw them, so register this in production. If the terminal runtime reporter throws, rejects or has a throwing then getter, the existing Utils host exception queue exposes that failure without recursion or changing the business result.',
      '观察 sink、钩子、管线、延后任务、flush、转发与关闭过程中的失败。日志调用本身不会抛出这些失败，生产环境应当登记它。终端运行时报告器自身抛错、拒绝或读取异步方法失败时，由现有工具库宿主异常队列暴露，不递归报告，也不改变业务结果。'
    ),
    params: {
      fn: t(
        '`({ source, error }) => void`; see `ILogFailure`.',
        '`({ source, error }) => void`，参数说明见 `ILogFailure`。'
      )
    },
    returns: offReturns,
    example: `log.onFailure(({ source, error }) => metrics.increment('logger_failure', { source }))`
  },
  defer: {
    summary: t(
      'Runs a task after the current synchronous stack through the runtime manager; `flush()` and `shutdown()` wait for it.',
      '通过运行时管理器把任务安排到当前同步调用栈之后执行；`flush()` 与 `shutdown()` 会等待它。'
    ),
    params: {
      task: t('`() => void | Promise<void>`.', '要延后执行的任务 `() => void | Promise<void>`。')
    },
    returns: t(
      'Nothing; the task is scheduled, not awaited.',
      '无返回值；任务已安排，但不会等待它完成。'
    ),
    example: `log.defer(() => upload(buffer.splice(0)))`
  },
  onFlush: {
    summary: t(
      'Registers a callback that empties a buffer on every `flush()`.',
      '登记一个在每次 `flush()` 时清空缓冲区的回调。'
    ),
    params: { fn: t('`() => void | Promise<void>`.', '回调函数 `() => void | Promise<void>`。') },
    returns: offReturns,
    example: `log.onFlush(() => writer.drain())`
  },
  flush: {
    summary: t(
      'Public flush() takes no argument. It waits for tracked deferred tasks, async sink results, onFlush callbacks, batches and forwarded loggers within a 3000 ms scheduler budget. Concurrent pending calls share one Promise; hitting the deadline reports LIFECYCLE_DEADLINE without aborting underlying work or proving delivery.',
      '公开 `flush()` 不接收参数，在日志调度器的 `3000` 毫秒预算内等待已追踪的延后任务、异步输出、刷新回调、批处理及转发目标；尚未完成的并发调用共享同一 Promise，截止时报告 `LIFECYCLE_DEADLINE`，不会中止底层工作，也不证明日志已送达。'
    ),
    returns: t(
      'Resolves when the known work finished or the budget ran out.',
      '已知工作完成或等待预算耗尽后 resolve。'
    ),
    example: `await log.flush()`
  },
  onShutdown: {
    summary: t(
      'Registers a cleanup handler run at the start of `shutdown()`; it may still write final logs.',
      '登记在 `shutdown()` 开始时执行的收尾函数；它仍然可以写最后的日志。'
    ),
    params: {
      fn: t(
        '`(reason) => void | Promise<void>`; `reason` is the value passed to `shutdown()`.',
        '`(reason) => void | Promise<void>`；`reason` 是传给 `shutdown()` 的值。'
      )
    },
    returns: offReturns,
    example: `log.onShutdown((reason) => log.log('info', 'stopping: %s', reason))`
  },
  shutdown: {
    summary: t(
      'Closes the logger: shutdown handlers and flush share a 3000 ms waiting budget, then Host disposal uses execution budgets separately. Handlers can enqueue final structured logs while raw output is closed. Reentrant and later calls share one terminal Promise; completed shutdown ignores new logs and cannot reopen.',
      '关闭日志器：收尾回调与排空共享 `3000` 毫秒等待预算，之后 Host 释放另用 `execution` 预算；回调仍可写最终结构化日志，此时原始文本输出已关闭。重入及后续调用共享同一终结 Promise，关闭完成后忽略新日志，不能重新启用。'
    ),
    params: {
      reason: t(
        'Why it closes: `manual` from application code; `signal`, `uncaughtException`, `unhandledRejection` are passed by `process()`.',
        '关闭原因：应用代码传 `manual`；`signal`、`uncaughtException`、`unhandledRejection` 由 `process()` 插件传入。'
      )
    },
    returns: t(
      'An `IPluginHostDisposalResult` from `@migaia/plugin-host`; `cleanupErrors` lists plugin cleanup failures. A clock failure rejects this same published completion after attempting Host cleanup, retaining primary and cleanup causes. Persistent clock failure can also defeat the Host budget; cleanup or receipt success does not promise remote delivery.',
      '来自 `@migaia/plugin-host` 的 `IPluginHostDisposalResult`；`cleanupErrors` 列出插件清理失败。时钟失败仍先尝试宿主清理，再拒绝同一已发布完成对象，主因与清理失败均可追溯。持续时钟失败仍可能使宿主预算失败；清理或回执成功不保证远端送达。'
    ),
    example: `const result = await log.shutdown('manual')
if (result.cleanupErrors.length) console.error(result.cleanupErrors)`
  },
  dispose: {
    summary: t(
      'Same as `shutdown("manual")`.',
      '等同于 `shutdown("manual")`，用于统一的释放流程。'
    ),
    returns: t('The disposal result of `shutdown()`.', '`shutdown()` 的释放结果。'),
    example: `await log.dispose()`
  },
  use: {
    summary: t(
      'Installs plugins after construction (also async ones), through the same checks as constructor plugins. Each call must use new plugin objects.',
      '在构造之后安装插件（包括异步安装的插件），检查规则与构造时一致。每次都要传入新创建的插件对象。'
    ),
    params: {
      plugins: t(
        'Plugin objects created by factories such as `level()` or `http(config)`.',
        '由 `level()`、`http(config)` 等工厂函数创建的插件对象。'
      )
    },
    returns: t(
      'A tuple of plugin handles in input order; `handle.extensions` holds the API the plugin added.',
      '按传入顺序排列的插件句柄元组；`handle.extensions` 中是插件新增的 API。'
    ),
    example: `const [levelHandle] = await log.use(level({ level: 'warn' }))
levelHandle.extensions.warn('disk almost full')`
  },
  unUse: {
    summary: t(
      'Uninstalls a plugin by name and releases what it registered (stages, sinks, hooks, flush and shutdown callbacks).',
      '按名称卸载插件，并释放它登记的内容（管线阶段、sink、钩子、flush 与关闭回调）。'
    ),
    params: {
      name: t(
        'Plugin name, such as `LEVEL_PLUGIN_NAME` (`level`).',
        '插件名称，例如 `LEVEL_PLUGIN_NAME`（即 `level`）。'
      )
    },
    returns: t('Resolves after the plugin is removed.', '插件移除完成后 resolve。'),
    example: `await log.unUse(LEVEL_PLUGIN_NAME)`
  },
  extends: {
    summary: t(
      'Forwards every entry, after this logger processed it, through the whole pipeline and sinks of each target (their level filters apply). Self or cyclic forwarding throws `EXTENDS_SELF` / `EXTENDS_CYCLE`.',
      '把本 logger 处理过的每个条目，再完整地经过每个目标 logger 的管线和 sink（目标自己的级别过滤同样生效）。转发给自己或形成环路时抛 `EXTENDS_SELF` / `EXTENDS_CYCLE`。'
    ),
    params: {
      others: t(
        'Target loggers created by `new Logger()`.',
        '由 `new Logger()` 创建的目标 logger。'
      )
    },
    returns: t('This logger, for chaining.', '本 logger，可链式调用。'),
    example: `import { Logger } from '@migaia/logger'
import { color } from '@migaia/logger/plugins'
const source = new Logger({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }, topic: 'source' })
const target = new Logger({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }, topic: 'target', plugins: [color({ format: 'json', color: 'never' })] })
target.useSink((entry) => { console.log(entry.data.topicChain) })
source.extends(target)
source.log('info', 'forwarded')
await source.flush()
await source.shutdown('manual')
await target.shutdown('manual')`
  },
  unextend: {
    summary: t(
      'Removes forwarding edges to the given loggers; the targets are not closed.',
      '移除到指定 logger 的转发关系；目标 logger 不会被关闭。'
    ),
    params: {
      others: t('Loggers previously passed to `extends()`.', '之前传给 `extends()` 的 logger。')
    },
    returns: t(
      '`true` when at least one edge was removed.',
      '至少移除了一条转发关系时返回 `true`。'
    ),
    example: `apiLog.unextend(auditLog) // true`
  },
  onDispose: {
    summary: t(
      'Inside a plugin `install(core)` only: registers a cleanup run when the plugin is uninstalled.',
      '只能在插件的 `install(core)` 中调用：登记插件卸载时执行的清理。'
    ),
    params: {
      resource: t(
        'A disposer function or an object with `dispose()`.',
        '清理函数，或带 `dispose()` 的对象。'
      )
    },
    returns: t('Nothing; the cleanup is registered.', '无返回值；清理已登记。'),
    example: `core.onDispose(core.useSink(writeEntry))`
  }
}

/** Member docs of `ILoggerCore`: it installs plugins (`use` / `unUse`) but has no `onDispose`. */
const loggerCoreMembers: Readonly<Record<string, IMemberDoc>> = Object.fromEntries(
  Object.entries(coreMembers).filter(([name]) => name !== 'onDispose')
)

/** Member docs of the plugin `core` (`ILoggerPluginCore`): `onDispose` instead of `use` / `unUse`. */
const pluginCoreMembers: Readonly<Record<string, IMemberDoc>> = Object.fromEntries(
  Object.entries(coreMembers).filter(([name]) => name !== 'use' && name !== 'unUse')
)

/** Output rules and argument interpretation explained once per owning level-method surface. */
const levelMessageArguments = t(
  'Entries from debug(), info(), warn(), error() and fatal() reach output only when their level meets the configured minimum and every installed filter accepts them. Entries below the minimum or rejected by any filter are discarded. For all five methods, a string first argument becomes the message, while remaining arguments are kept for output. For example, info("Order %s", orderId) keeps the placeholder and orderId for the output handler. If the first argument is not a string, the message is empty and every argument is retained in the args array.',
  'debug()、info()、warn()、error() 和 fatal() 创建的条目，只有级别达到设置的最低要求、且所有过滤函数都接受时，才会输出。级别过低或被任一过滤函数拒绝的条目会被丢弃。这五个方法都把第一个字符串参数作为消息，后续参数保留给输出处理。例如 info("Order %s", orderId) 会保留占位符与 orderId，交给输出端处理。首个参数不是字符串时，消息为空，所有参数都保存在日志条目的 args 数组中。'
)

/** Methods added by `level()`, with their call forms. */
const levelExt: Readonly<Record<string, IMemberDoc & { call: string }>> = Object.fromEntries(
  (
    [
      ['debug', '调试细节，生产环境通常被过滤'],
      ['info', '常规运行信息'],
      ['warn', '需要关注但不影响运行的情况'],
      ['error', '操作失败'],
      ['fatal', '无法继续运行的严重失败']
    ] as const
  ).map(([name, zh]) => [
    name,
    {
      call: '(message, ...args)',
      summary: t(
        `Creates a log entry tagged \`${name}\`.`,
        `创建带 \`${name}\` 标签的日志条目（${zh}）。`
      ),
      params: {
        args: t(
          'Message text followed by extra values, as with `console`.',
          '消息文本及其后的附加值，用法与 `console` 相同。'
        )
      },
      returns: t(
        'Nothing; filtered entries are dropped silently.',
        '无返回值；被过滤的条目会被静默丢弃。'
      ),
      example: `log.${name}('order %s processed', orderId)`
    }
  ])
)

/** All methods `level()` adds. */
const levelMembers: Readonly<Record<string, IMemberDoc & { call: string }>> = {
  ...levelExt,
  setLevel: {
    call: '(level)',
    summary: t(
      'Changes the minimum level at runtime; tags that are not level names are never filtered by level.',
      '在运行时修改最低级别；不是级别名称的标签不受级别过滤。'
    ),
    params: {
      level: t(
        'New minimum level: `debug`, `info`, `warn`, `error` or `fatal`.',
        '新的最低级别，取 `debug`、`info`、`warn`、`error`、`fatal` 之一。'
      )
    },
    returns: t(
      'Nothing; the next entry uses the new level.',
      '无返回值；下一条日志开始使用新级别。'
    ),
    example: `log.setLevel('debug')`
  },
  addFilter: {
    call: '(filter)',
    summary: t(
      'Adds a filter; an entry is kept only if every filter returns `true`.',
      '添加一个过滤器；只有所有过滤器都返回 `true` 的条目才会保留。'
    ),
    params: { filter: t('`(entry) => boolean`.', '过滤函数 `(entry) => boolean`。') },
    returns: t(
      'Idempotent removal function; removes every occurrence of this filter function identity, including duplicates.',
      '幂等移除函数，按同一过滤函数身份删除所有匹配项，包括重复登记。'
    ),
    example: `const removeHealth = log.addFilter((entry) => !entry.message.includes('/health'))`
  },
  removeFilter: {
    call: '(filter)',
    summary: t(
      'Removes every matching function identity, whether added by addFilter or the filters option.',
      '按函数身份移除所有匹配项，包括 `addFilter` 或构造 `filters` 添加的项。'
    ),
    params: { filter: t('The same function object that was added.', '之前添加的同一个函数对象。') },
    returns: t('Nothing; unknown filters are ignored.', '无返回值；未添加过的过滤器会被忽略。'),
    example: `log.removeFilter(healthFilter)`
  }
}

/** Methods added by `reasoning()`. */
const reasoningMembers: Readonly<Record<string, IMemberDoc & { call: string }>> = {
  startThinking: {
    call: '(label?)',
    summary: t(
      'Starts a thinking section: ends an open response section, then writes the label to stdout.',
      '开始思考段落：先结束尚未结束的回答段落，再把标签写到 stdout。'
    ),
    params: {
      label: t(
        'Label text; defaults to `labels.thinking`, then `Thinking...`.',
        '标签文本；默认取 `labels.thinking`，再退回 `Thinking...`。'
      )
    },
    returns: t('Nothing; the phase is now `thinking`.', '无返回值；当前阶段变为 `thinking`。'),
    example: `log.startThinking()`
  },
  thinking: {
    call: '(delta)',
    summary: t(
      'Writes one chunk of thinking text immediately (dimmed when `color()` is installed) and buffers it; starts the section if needed.',
      '立即写出一段思考文本（安装了 `color()` 时会变暗显示）并缓存起来；必要时自动开始思考段落。'
    ),
    params: {
      delta: t(
        'A token or text chunk received from the model stream.',
        '从模型流中收到的一个 token 或文本片段。'
      )
    },
    returns: t('Nothing; the chunk is written without newline.', '无返回值；片段已写出，不换行。'),
    example: `for await (const chunk of stream.reasoning) log.thinking(chunk)`
  },
  endThinking: {
    call: '()',
    summary: t(
      'Ends the thinking section and dispatches one entry with tag `thinking`, the full text and `data.silent = true` (console skips it, other sinks store it).',
      '结束思考段落，并分发一条标签为 `thinking`、包含完整文本且 `data.silent = true` 的条目（控制台跳过，其它 sink 会保存）。'
    ),
    returns: t('Nothing; the phase is back to `idle`.', '无返回值；阶段回到 `idle`。'),
    example: `log.endThinking()`
  },
  startResponse: {
    call: '(label?)',
    summary: t(
      'Starts a response section: ends an open thinking section, then writes the label if one is set.',
      '开始回答段落：先结束尚未结束的思考段落，设置了标签时再写出标签。'
    ),
    params: {
      label: t(
        'Label text; defaults to `labels.response`; none is written when both are absent.',
        '标签文本；默认取 `labels.response`；两者都没有时不写标签。'
      )
    },
    returns: t('Nothing; the phase is now `responding`.', '无返回值；当前阶段变为 `responding`。'),
    example: `log.startResponse('Answer')`
  },
  response: {
    call: '(delta)',
    summary: t(
      'Writes one chunk of answer text immediately and buffers it; starts the section if needed.',
      '立即写出一段回答文本并缓存；必要时自动开始回答段落。'
    ),
    params: {
      delta: t(
        'A token or text chunk received from the model stream.',
        '从模型流中收到的一个 token 或文本片段。'
      )
    },
    returns: t('Nothing; the chunk is written without newline.', '无返回值；片段已写出，不换行。'),
    example: `for await (const chunk of stream.text) log.response(chunk)`
  },
  endResponse: {
    call: '()',
    summary: t(
      'Ends the response section and dispatches one silent `response` entry with the full text.',
      '结束回答段落，并分发一条包含完整文本的静默 `response` 条目。'
    ),
    returns: t('Nothing; the phase is back to `idle`.', '无返回值；阶段回到 `idle`。'),
    example: `log.endResponse()`
  }
}

/** Fields of `IBatchPluginConfig`, reused by `http.batch` and `file.batch`. */
const batchFields: Readonly<Record<string, IMemberDoc>> = {
  maxSize: {
    summary: t(
      'Sends a batch as soon as it holds this many entries.',
      '批次中的条目达到该数量时立即发送。'
    ),
    default: t('`20`.', '默认值为 `20` 条。')
  },
  maxWaitMs: {
    summary: t(
      'Sends a non-empty batch at most this many milliseconds after its first entry arrived.',
      '批次第一条进入后，最多等待这么多毫秒就发送。'
    ),
    default: t('`2000`.', '默认值为 `2000` 毫秒。')
  },
  maxConcurrentBatches: {
    summary: t(
      'How many batch callbacks may run at once; a positive safe integer.',
      '同时执行的批次回调数量，必须是正的安全整数。'
    ),
    default: t(
      '`1`: batches are delivered one after another, in order.',
      '`1`：批次按顺序逐个交付。'
    )
  },
  maxPendingBatches: {
    summary: t(
      'Limit of queued plus running batches. When full, the oldest queued batch is dropped and `BATCH_OVERFLOW` (with the dropped count) is reported to `onFailure()`.',
      '排队与执行中批次的总上限。满载时丢弃最早排队的批次，并向 `onFailure()` 上报带丢弃数量的 `BATCH_OVERFLOW`。'
    ),
    default: t('`1024`.', '默认值为 `1024` 个批次。')
  },
  flushTimeoutMs: {
    summary: t(
      'Time budget of one batch drain during `flush()` and uninstall; entries still waiting afterwards are reported as not delivered.',
      '一次 `flush()` 或卸载时批次排空的时间预算；超时后仍在等待的条目会被报告为未交付。'
    ),
    default: t('`3000`.', '默认值为 `3000` 毫秒。')
  },
  asyncOutput: {
    summary: t(
      'Runs a size-triggered batch callback through `defer()` instead of inside the logging call.',
      '因数量触发的批次回调通过 `defer()` 执行，而不是在日志调用中同步执行。'
    ),
    default: t('`true`.', '`true`：异步执行；定时触发的批次本来就是异步的。')
  }
}

/** Prefixes batch field docs with a parent key (`batch.maxSize`). */
const nested = (
  prefix: string,
  fields: Readonly<Record<string, IMemberDoc>>,
  keys: readonly string[]
) => Object.fromEntries(keys.map((key) => [`${prefix}.${key}`, fields[key] as IMemberDoc]))

/** Application logging scenarios; execution setup belongs to the application. */
const loggerPluginOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  ILevelPluginConfig: [
    {
      title: t('Keep actionable checkout events', '保留结算服务需要处理的日志'),
      problem: t(
        'A checkout service produces noisy debug messages and health checks. A warn threshold keeps operational failures; a filter also drops health checks with custom tags.',
        '结算服务会产生大量调试消息与健康检查。warn 门槛保留需要处理的失败，过滤器再移除使用自定义标签的健康检查。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [level({ level: 'warn', filters: [(entry) => !entry.context.includes('health')] })]
})
log.useSink(sendToSupportPanel)
log.debug('Connection opened')
log.warn('Payment retry scheduled')
log.dispatchRaw({ tag: 'audit', message: 'Health check', context: ['health'] })
log.log('audit', 'Order saved')
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'The support panel receives the payment warning and order audit, without debug or health-check noise.',
        '支持面板收到支付警告和订单审计，不再混入调试消息与健康检查。'
      ),
      covers: ['level', 'filters']
    },
    {
      title: t('Defer logs from an input handler', '延后输入回调中的日志输出'),
      problem: t(
        'A document editor should finish its input handler before running log sinks. asyncOutput schedules the level-method dispatch through the application runtime manager.',
        '文档编辑器需要先完成输入回调，再运行日志输出端。asyncOutput 通过应用运行时管理器安排级别方法的分发。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [level({ asyncOutput: true })]
})
log.useSink(sendToSupportPanel)
onDocumentChanged(() => {
  log.info('Document changed')
  renderUnsavedMarker()
})
onEditorClosed(() => log.shutdown('manual'))`,
      result: t(
        'The input handler returns before its log is dispatched to the support panel.',
        '输入回调先返回，日志随后再分发给支持面板。'
      ),
      covers: ['asyncOutput']
    }
  ],
  IColorPluginConfig: [
    {
      title: t('Write plain audit lines to a terminal', '在终端输出不带色码的审计文本'),
      problem: t(
        'An operator copies audit lines into a ticket. Explicit pretty output keeps them readable, while color: never avoids terminal escape sequences in the copied text.',
        '操作人员需要把审计日志复制到工单。显式 pretty 格式保留可读文本，color: never 避免复制时带入终端控制序列。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { color } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [color({ format: 'pretty', color: 'never' })]
})
log.log('audit', 'Order saved')
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'The terminal shows a readable audit line without built-in ANSI colors.',
        '终端显示可读的审计文本，不带内置 ANSI 色码。'
      ),
      covers: ['format', 'color']
    },
    {
      title: t('Highlight audit actions in a compact console', '在紧凑控制台突出审计操作'),
      problem: t(
        'An audit console already shows time beside each row. Hide the repeated timestamp and use the application paint function for the custom audit tag and message head.',
        '审计控制台已经在每行旁显示时间。关闭重复时间戳，并用应用的染色函数处理自定义审计标签与消息开头。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { color } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [color({
    format: 'pretty',
    timestamp: false,
    colorMessage: 'head',
    colorMap: { audit: highlightAudit }
  })]
})
log.log('audit', 'Order saved')
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'The console uses the application audit style without adding a second timestamp.',
        '控制台使用应用的审计样式，不再添加第二个时间戳。'
      ),
      covers: ['timestamp', 'colorMessage', 'colorMap']
    }
  ],
  IBatchPluginConfig: [
    {
      title: t('Send low-volume audit batches promptly', '及时发送低流量审计批次'),
      problem: t(
        'A small audit stream should not wait for the default twenty entries or two seconds. The shared batch feature supplies a queue with a smaller size and wait.',
        '低流量审计不应等待默认二十条或两秒。共享批处理能力提供较小批次与等待时间的队列。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { batch, type IBatchShared } from '@migaia/logger/plugins'

const log = new Logger(applicationLoggerOptions)
const [handle] = await log.use(batch({ maxSize: 2, maxWaitMs: 100 }))
const { createBatcher } = handle!.getFeature('batch') as IBatchShared
const queue = createBatcher<IAuditEvent>({}, sendAuditBatch)
queue.push({ action: 'opened' })
queue.push({ action: 'saved' })
await queue.flush()
await log.shutdown('manual')`,
      result: t(
        'The two audit events are delivered together; a partial batch waits at most 100 ms.',
        '两条审计事件一起交付；未满批次最多等待 100 毫秒。'
      ),
      covers: ['maxSize', 'maxWaitMs']
    },
    {
      title: t('Bound delivery to a slow audit sink', '限制慢审计输出端的交付负担'),
      problem: t(
        'An audit sink can send two batches at once but should not accumulate an unlimited backlog. Separate bounds limit active and waiting batches; the flush timeout limits shutdown waiting.',
        '审计输出端可以同时发送两个批次，却不能无限积压。独立上限限制活动与等待批次，排空时限限制关闭等待。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { batch, type IBatchShared } from '@migaia/logger/plugins'

const log = new Logger(applicationLoggerOptions)
const [handle] = await log.use(batch({
  maxConcurrentBatches: 2,
  maxPendingBatches: 8,
  flushTimeoutMs: 1000,
  asyncOutput: false
}))
const { createBatcher } = handle!.getFeature('batch') as IBatchShared
const queue = createBatcher<IAuditEvent>({}, sendAuditBatch)
queue.push({ action: 'saved' })
await queue.flush()
await log.shutdown('manual')`,
      result: t(
        'Delivery stays within the selected queue limits; a drain timeout does not cancel a running sink.',
        '交付遵守所选队列上限，排空超时不会取消正在执行的输出端。'
      ),
      covers: ['maxConcurrentBatches', 'maxPendingBatches', 'flushTimeoutMs', 'asyncOutput']
    }
  ],
  IHttpPluginConfig: [
    {
      title: t('Send authenticated checkout audit batches', '批量发送经过认证的结算审计'),
      problem: t(
        'The collector needs the current session token and an application label. Installing a batch provider lets HTTP combine nearby audit entries instead of sending a request for each entry.',
        '采集器需要当前会话令牌与应用标识。安装批处理提供者后，HTTP 可合并相邻审计条目，不必每条日志发送一次请求。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { batch, http } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [batch(), http({
    url: logCollectorUrl,
    authToken: session.logToken,
    headers: { 'X-App': 'checkout' },
    batch: { maxSize: 20, maxWaitMs: 500 }
  })]
})
log.log('audit', 'Checkout opened')
log.log('audit', 'Order saved')
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'The collector receives checkout audit entries with the bearer token and application header.',
        '采集器收到结算审计条目，同时收到 Bearer 令牌和应用请求头。'
      ),
      covers: ['url', 'authToken', 'headers', 'batch', 'batch.maxSize', 'batch.maxWaitMs']
    },
    {
      title: t('Bound queued collector uploads', '限制采集器上传积压'),
      problem: t(
        'A slow collector should not make upload work grow without bounds. Configure the HTTP batch queue separately from its destination and authentication settings.',
        '采集器变慢时，上传任务不能无限增长。HTTP 批处理队列的限制与目标地址、认证配置分别设置。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { batch, http } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [batch(), http({
    url: logCollectorUrl,
    batch: {
      maxConcurrentBatches: 1,
      maxPendingBatches: 8,
      asyncOutput: false
    }
  })]
})
log.log('audit', 'Order saved')
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'Only one upload batch runs at a time and at most eight batches wait for delivery.',
        '同一时间只运行一个上传批次，最多八个批次等待交付。'
      ),
      covers: ['batch.maxConcurrentBatches', 'batch.maxPendingBatches', 'batch.asyncOutput']
    },
    {
      title: t('Limit waits after collector throttling', '限制采集器限流后的等待'),
      problem: t(
        'The collector can respond with 429 and Retry-After. Limit extra attempts and the server-requested delay; a per-request timeout asks cooperative fetch implementations to abort slow attempts.',
        '采集器可能返回 429 与 Retry-After。限制额外尝试次数及服务端要求的等待；单请求时限要求配合信号的 fetch 中止缓慢请求。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { http } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [http({
    url: logCollectorUrl,
    retries: 1,
    requestTimeoutMs: 2000,
    maxRetryAfterMs: 1000
  })]
})
log.log('audit', 'Order saved')
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'A throttled upload gets at most one additional attempt, with Retry-After capped at one second.',
        '限流上传最多额外尝试一次，Retry-After 等待最多一秒。'
      ),
      covers: ['retries', 'requestTimeoutMs', 'maxRetryAfterMs']
    }
  ],
  IProcessPluginConfig: [
    {
      title: t('Keep crash logs during service shutdown', '服务关闭期间保留崩溃日志'),
      problem: t(
        'A service needs fatal crash entries and five seconds to drain its logs. The process plugin owns the relevant listeners and releases them at logger shutdown.',
        '服务需要记录致命崩溃，并留五秒排空日志。进程插件持有相关监听器，日志器关闭时释放。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { process } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [process({ captureCrashes: true, shutdownTimeoutMs: 5000 })]
})
await runService(log)
await log.shutdown('manual')`,
      result: t(
        'Crashes enter the logger shutdown path; manual shutdown drains output and releases process listeners.',
        '崩溃进入日志器关闭流程；手动关闭会排空输出并释放进程监听器。'
      ),
      covers: ['captureCrashes', 'shutdownTimeoutMs']
    },
    {
      title: t('Drain final CLI output before exit', '退出命令行前排空最终日志'),
      problem: t(
        'A CLI can call process.exit while its async sink still holds a final entry. Interception defers the native exit until the logger has attempted to drain.',
        '命令行可能在异步输出端仍持有最终日志时调用 process.exit。拦截后延后原生退出，先尝试排空日志。'
      ),
      example: `import nodeProcess from 'node:process'
import { Logger } from '@migaia/logger'
import { process } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [process({ interceptProcessExit: true })]
})
log.useSink(writeCommandLog)
log.log('info', 'Export finished')
nodeProcess.exit(0)`,
      result: t(
        'The final export entry can drain before the native process exits.',
        '最终导出日志可在原生进程退出前完成排空。'
      ),
      covers: ['interceptProcessExit']
    }
  ],
  IReasoningPluginConfig: [
    {
      title: t('Label streaming progress and answers', '为流式进度与回答命名'),
      problem: t(
        'A terminal assistant needs separate headings for work in progress and its answer. The default answer has no heading; labels supplies both names.',
        '终端助手需要分别标识处理进度与回答。默认回答没有标题；labels 可为两个阶段命名。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { reasoning } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [reasoning({ labels: { thinking: 'Planning', response: 'Answer' } })]
})
log.thinking('Checking document sections')
log.endThinking()
log.response('The document is ready')
log.endResponse()
await log.shutdown('manual')`,
      result: t(
        'The stream shows Planning and Answer headings; completed text also reaches normal sinks.',
        '流中显示 Planning 和 Answer 标题，完成的文本也会交给普通输出端。'
      ),
      covers: ['labels', 'labels.thinking', 'labels.response']
    },
    {
      title: t('Defer streaming writes from the UI callback', '延后界面回调中的流式写入'),
      problem: t(
        'A UI callback should finish before writing streaming text. asyncOutput schedules raw chunks and completed entries through the application manager instead of writing inline.',
        '界面回调需要在写流式文本之前结束。asyncOutput 通过应用管理器安排原始片段与完成条目，而不在调用中直接写入。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { reasoning } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [reasoning({ asyncOutput: true })]
})
onAnswerChunk((text) => {
  log.response(text)
  updateAnswerProgress()
})
onAnswerComplete(() => log.endResponse())
onAssistantClosed(() => log.shutdown('manual'))`,
      result: t(
        'Answer chunks are written after their UI callback, and ending the phase publishes the completed text.',
        '回答片段在界面回调之后写入，结束阶段会发布完整文本。'
      ),
      covers: ['asyncOutput']
    }
  ],
  IUuidPluginConfig: [
    {
      title: t('Show a support correlation id', '显示支持排查用的关联编号'),
      problem: t(
        'An operator must find the same audit entry in the console and collector. display includes its generated UUID in rendered output, while sinks retain data.uuid.',
        '操作人员需要在控制台与采集器中找到同一条审计日志。display 将生成的 UUID 加入展示，输出端仍保留 data.uuid。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { color, uuid } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [uuid({ display: true }), color({ format: 'pretty' })]
})
log.useSink(sendToCollector)
log.log('audit', 'Order saved')
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'The console shows an entry id that support can use to find the collector record.',
        '控制台显示条目编号，支持人员可据此查找采集器记录。'
      ),
      covers: ['display']
    },
    {
      title: t('Keep the terminal compact but retain correlation', '保持终端紧凑并保留关联信息'),
      problem: t(
        'The collector still needs ids, but terminal readers do not need one on every line. display: false hides the rendered id without dropping data.uuid.',
        '采集器仍需要编号，终端读者却不必每行都看到。display: false 隐藏展示编号，同时保留 data.uuid。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { color, uuid } from '@migaia/logger/plugins'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [uuid({ display: false }), color({ format: 'pretty' })]
})
log.useSink(sendToCollector)
log.log('audit', 'Order saved')
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'Terminal lines omit the display id while collector entries retain their UUID.',
        '终端文本省略展示编号，采集器条目仍保留 UUID。'
      ),
      covers: ['display']
    }
  ],
  IFilePluginConfig: [
    {
      title: t('Batch writes to a local audit file', '批量写入本地审计文件'),
      problem: t(
        'A desktop application saves audit entries locally. The file plugin can own a small batch queue without a separate shared batch provider.',
        '桌面应用在本地保存审计条目。文件插件可独立持有小批处理队列，无需额外共享批处理提供者。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { file } from '@migaia/logger/plugins/file'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [file({ path: auditFilePath, batch: { maxSize: 20, maxWaitMs: 500 } })]
})
log.log('audit', 'Document opened')
log.log('audit', 'Document saved')
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'The selected audit file receives the entries in batches, and shutdown drains pending writes.',
        '所选审计文件成批收到条目，关闭时排空待写内容。'
      ),
      covers: ['path', 'batch', 'batch.maxSize', 'batch.maxWaitMs']
    },
    {
      title: t('Bound a slow file writer backlog', '限制慢文件写入器的积压'),
      problem: t(
        'A slow disk should not leave unlimited batches waiting. Bound active and queued batches, and limit how long the logger waits for a drain.',
        '磁盘变慢时，不应让批次无限等待。限制活动与排队批次，并限制日志器等待排空的时间。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { file } from '@migaia/logger/plugins/file'

const log = new Logger({
  ...applicationLoggerOptions,
  plugins: [file({
    path: auditFilePath,
    batch: {
      maxConcurrentBatches: 1,
      maxPendingBatches: 8,
      flushTimeoutMs: 1000,
      asyncOutput: false
    }
  })]
})
log.log('audit', 'Document saved')
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'Only one batch writes at a time, with at most eight waiting batches and a one-second flush budget.',
        '同一时间只写一个批次，最多八个批次排队，排空预算为一秒。'
      ),
      covers: [
        'batch.maxConcurrentBatches',
        'batch.maxPendingBatches',
        'batch.flushTimeoutMs',
        'batch.asyncOutput'
      ]
    },
    {
      title: t('Rotate after a large batch', '大批次写入后轮转文件'),
      problem: t(
        'The application already supplies fileRuntimeManager.fs.rotate. Rotation compares the current batch size, not cumulative file size, so choose limits for the batches being appended.',
        '应用已经提供 fileRuntimeManager.fs.rotate。轮转比较当前批次大小，而非累计文件大小，因此应按追加批次选择上限。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { file } from '@migaia/logger/plugins/file'

const log = new Logger({
  ...applicationLoggerOptions,
  runtimeManager: fileRuntimeManager,
  plugins: [file({
    path: auditFilePath,
    batch: { maxSize: 100 },
    rotate: { maxBytes: 1_000_000, maxEntries: 100 }
  })]
})
await writeAuditEntries(log)
await log.flush()
await log.shutdown('manual')`,
      result: t(
        'A batch meeting either threshold is appended and then passed to the application rotation capability.',
        '批次达到任一上限时先追加，再调用应用提供的轮转能力。'
      ),
      covers: ['rotate', 'rotate.maxBytes', 'rotate.maxEntries']
    }
  ]
}

/** Reference of `@migaia/logger`. */

/** Durable resource and plugin methods share the maintained public examples below. */
const durableStoreMembers: Readonly<Record<string, IMemberDoc>> = {
  append: {
    summary: t(
      'Atomically commit a batch and create pending states; empty batches allocate no sequences. Inputs are captured immediately.',
      '原子提交一批并创建 pending 状态；空批不分配序号，输入立即快照。'
    )
  },
  read: {
    summary: t(
      'Read ascending retained snapshots from an inclusive sequence and an explicit nonnegative limit.',
      '从包含边界的序号读取保留记录的升序快照，limit 为非负安全整数。'
    )
  },
  lastSeq: {
    summary: t(
      'Read the committed high watermark, preserved after complete truncation.',
      '读取已提交高水位，全部截断后仍保留。'
    )
  },
  onAppend: {
    summary: t(
      'Observe one frozen {lastSeq,count} notice per nonempty real commit; return an idempotent cancellation function.',
      '每次非空真实提交只观察一次冻结的 {lastSeq,count}；返回幂等取消函数。'
    )
  },
  truncate: {
    summary: t(
      'Delete only seq < beforeSeq without reusing committed sequences.',
      '只删除 seq < beforeSeq 的前缀，不复用已提交序号。'
    )
  },
  setState: {
    summary: t(
      'Only pending may advance to done or aborted; terminal and missing records reject WAL_RECORD_INVALID.',
      '只允许 pending 进入 done 或 aborted；已结束或不存在的记录拒绝 WAL_RECORD_INVALID。'
    )
  },
  states: {
    summary: t(
      'Return pending sequence numbers in creation order, excluding terminal history.',
      '按创建顺序返回 pending 序号，不扫描已结束历史。'
    )
  },
  dispose: {
    summary: t(
      'Close admission, drain accepted work, and return one cached explicit cleanup Promise; failure rejects.',
      '停止准入、排空已接纳工作，返回缓存的显式清理 Promise；失败拒绝。'
    )
  },
  '[Symbol.asyncDispose]': {
    summary: t(
      'Share the same cleanup using a separate cached Promise that reports failure and resolves.',
      '共享同一次清理，以另一个缓存 Promise 报告失败后成功。'
    )
  }
}
const durableBinlogMembers: Readonly<Record<string, IMemberDoc & { call: string }>> = {
  ready: {
    call: '()',
    summary: t(
      'Await this installation initialization; call it before opening a native transaction.',
      '等待本次安装初始化；必须在打开原生事务前调用。'
    )
  },
  whenIdle: {
    call: '()',
    summary: t(
      'Wait for accepted FIFO work, including actual port append completion; external listeners and transaction terminal state are not awaited.',
      '等待已接纳 FIFO 工作和端口实际追加完成；不等待外部 listener 或事务终态。'
    )
  },
  append: {
    call: '(kind, payload, options?)',
    summary: t(
      'Append one kind/payload and return its sequence; transaction options return a provisional sequence immediately.',
      '追加一条 kind/payload 并返回序号；携带事务选项时立即发起并返回暂定序号。'
    )
  },
  appendBatch: {
    call: '(records, options?)',
    summary: t(
      'Commit all records or none and return their sequences; transaction ports retain their original owner.',
      '整批全有或全无并返回序号；事务端口保留原拥有者。'
    )
  },
  read: {
    call: '(fromSeq, options?)',
    summary: t(
      'Read from an inclusive sequence with options.limit defaulting to 100.',
      '从包含边界的序号读取；options.limit 默认 100。'
    )
  },
  subscribe: {
    call: '(fromSeq, listener)',
    summary: t(
      'Follow history and live commits through one cursor. Slow callbacks do not block append or other subscribers.',
      '以一个游标追历史与后续提交；慢回调不阻塞追加和其它订阅。'
    )
  },
  lastSeq: {
    call: '()',
    summary: t(
      'Read the committed high watermark, preserved after complete truncation.',
      '读取已提交高水位，全部截断后仍保留。'
    )
  },
  truncate: {
    call: '(beforeSeq)',
    summary: t(
      'Delete only seq < beforeSeq without reusing committed sequences.',
      '只删除 seq < beforeSeq 的前缀，不复用已提交序号。'
    )
  }
}
const durableWalMembers: Readonly<Record<string, IMemberDoc & { call: string }>> = {
  ready: {
    call: '()',
    summary: t(
      'Await this installation initialization; call it before opening a native transaction.',
      '等待本次安装初始化；必须在打开原生事务前调用。'
    )
  },
  whenIdle: {
    call: '()',
    summary: t(
      'Wait for accepted FIFO work, including actual port append completion; external listeners and transaction terminal state are not awaited.',
      '等待已接纳 FIFO 工作和端口实际追加完成；不等待外部 listener 或事务终态。'
    )
  },
  begin: {
    call: '(kind, payload)',
    summary: t(
      'Commit pending intent before returning its sequence.',
      '提交 pending 意图后才返回序号。'
    )
  },
  complete: {
    call: '(seq)',
    summary: t(
      'Persist pending to done in the same serial operation.',
      '在同一串行操作内将 pending 持久改为 done。'
    )
  },
  abort: {
    call: '(seq)',
    summary: t(
      'Persist pending to aborted; terminal records cannot reopen.',
      '将 pending 持久改为 aborted；终态不能重开。'
    )
  },
  pending: {
    call: '()',
    summary: t(
      'Read all pending committed records in sequence order.',
      '按序号读取全部已提交 pending 记录。'
    )
  }
}
const durableUndoMembers: Readonly<Record<string, IMemberDoc & { call: string }>> = {
  ready: {
    call: '()',
    summary: t(
      'Await this installation initialization; call it before opening a native transaction.',
      '等待本次安装初始化；必须在打开原生事务前调用。'
    )
  },
  whenIdle: {
    call: '()',
    summary: t(
      'Wait for accepted FIFO work, including actual port append completion; external listeners and transaction terminal state are not awaited.',
      '等待已接纳 FIFO 工作和端口实际追加完成；不等待外部 listener 或事务终态。'
    )
  },
  record: {
    call: '(txId, images, options?)',
    summary: t(
      'Store target/before/after images for one active txId; optional transaction ports start in the current stack.',
      '为唯一活跃 txId 保存 target/before/after 镜像；可选事务端口在当前栈启动。'
    )
  },
  get: {
    call: '(txId)',
    summary: t(
      'Read independent active images or undefined; uncommitted images remain invisible.',
      '读取活跃镜像的独立快照或 undefined；未提交镜像不可见。'
    )
  },
  list: {
    call: '(options?)',
    summary: t(
      'List newest time first, seq descending for ties; default limit 100 and inclusive sinceTime.',
      '按时间降序、相同时间按序号降序；limit 默认 100，sinceTime 包含边界。'
    )
  },
  forget: {
    call: '(txId)',
    summary: t(
      'Persist done before removing active images; missing ids succeed and forgotten ids can be reused.',
      '先持久写 done 再移除镜像；不存在时幂等成功，遗忘后可复用 id。'
    )
  }
}

export const loggerReference: ILibraryReference = {
  modules: {
    'plugins/durable': {
      summary: t(
        'Ordered binlog, write-ahead intent, and undo image plugins with caller-owned stores.',
        '有序 binlog、写前意图与 undo 镜像插件；store 由调用方创建并释放。'
      ),
      example:
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}"
    },
    'plugins/durable/file': {
      summary: t(
        'Local SQLite log resources using node:sqlite in Node/Deno or bun:sqlite in Bun. Keep the separate entry out of browser code.',
        '本地 SQLite 日志资源：Node/Deno 使用 node:sqlite，Bun 使用 bun:sqlite。浏览器代码使用独立的中立入口。'
      ),
      example:
        "import { fileLogStore } from '@migaia/logger/plugins/durable/file'\n\nawait using store = await fileLogStore('./orders.sqlite')\nawait store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconsole.log(await store.lastSeq())"
    },
    index: {
      summary: t(
        'Core entry point. Start from `new Logger({ execution, plugins })`: the core only builds entries, runs the pipeline, calls sinks and drains on `flush()` / `shutdown()`. Levels, console output, batching and uploads come from plugins in `@migaia/logger/plugins`.',
        '核心入口。从 `new Logger({ execution, plugins })` 开始：核心只负责构造日志条目、执行管线、调用 sink，并在 `flush()` / `shutdown()` 时排空。级别、控制台输出、攒批与上报都来自 `@migaia/logger/plugins` 中的插件。'
      ),
      example: loggerExample
    },
    plugins: {
      summary: t(
        'Use this entry to add logging methods and output behavior to a `Logger` created from the root entry. Import built-in plugin factories from `@migaia/logger/plugins`; the root exports the logger itself rather than these factories.\n\nStart with `level()` for methods such as `info()` and level filtering, then `color()` for console output. Create a fresh plugin instance for each logger; file output has its own `@migaia/logger/plugins/file` entry.',
        '需要给根入口创建的 `Logger` 增加日志方法与输出方式时，使用此入口。内置插件工厂从 `@migaia/logger/plugins` 导入；根入口导出日志器本身，不导出这些工厂。\n\n先用 `level()` 添加 `info()` 等方法与级别筛选，再用 `color()` 输出到控制台。每个日志器都应创建新的插件实例；文件输出使用独立的 `@migaia/logger/plugins/file` 入口。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { batch, color, http, level } from '@migaia/logger/plugins'

${create}
  plugins: [level({ level: 'info' }), color(), batch(), http({ url: 'https://logs.example/v1/entries' })]
})`
    },
    'plugins/file': {
      summary: t(
        'Use this entry when logs must be appended to a file as one JSON object per line. The `file()` factory is exported only from `@migaia/logger/plugins/file`, separately from both the root logger and the general plugin entry.\n\nInstall `file({ path })` on your logger to write to that path. The host-aware export uses `node:fs/promises` as a fallback in Node-compatible runtimes; browser delivery requires an injected `runtimeManager.fs` append implementation.',
        '日志需要追加到文件，并让每行保存一个 `JSON` 对象时，使用此入口。`file()` 工厂只从 `@migaia/logger/plugins/file` 导出，独立于根入口的日志器和通用插件入口。\n\n给日志器安装 `file({ path })`，即可向指定路径追加日志。非浏览器版本优先使用注入的文件接口，未注入时使用 `node:fs/promises`；浏览器版本必须注入实现追加写入的 `runtimeManager.fs`。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { file } from '@migaia/logger/plugins/file'

${create}
  plugins: [file({ path: 'logs/app.jsonl' })]
})`
    }
  },
  symbols: {
    memoryLogStore: {
      role: 'factory',
      purpose: t(
        'Create a process-local atomic log; the creator owns disposal.',
        '创建进程内原子日志；创建者拥有释放权。'
      ),
      returns: t(
        'Caller-owned resource or synchronous logger plugin; await ready before a native transaction.',
        '调用方资源或同步 logger 插件；原生事务前等待 ready。'
      ),
      example:
        "import { memoryLogStore } from '@migaia/logger/plugins/durable'\nimport type { ILogStore } from '@migaia/logger/plugins/durable'\n\nconst delegate = memoryLogStore()\n// A custom implementation must preserve this single owner's atomic commit and notices.\nconst custom: ILogStore = {\n  append: records => delegate.append(records),\n  read: (fromSeq, limit) => delegate.read(fromSeq, limit),\n  lastSeq: () => delegate.lastSeq(),\n  onAppend: listener => delegate.onAppend(listener),\n  truncate: beforeSeq => delegate.truncate(beforeSeq),\n  setState: (seq, state) => delegate.setState(seq, state),\n  states: filter => delegate.states(filter),\n  dispose: () => delegate.dispose(),\n  [Symbol.asyncDispose]: () => delegate[Symbol.asyncDispose]()\n}\nawait custom.append([{ kind: 'custom', payload: null }])\nawait custom.dispose()",
      cases: loggerCases.memoryLogStore
    },
    fileLogStore: {
      role: 'factory',
      purpose: t(
        'Open builtin SQLite with a retained exclusive lock and native durable commits.',
        '打开内置 SQLite，以连接排他锁和原生事务持久提交。'
      ),
      returns: t(
        'Caller-owned resource or synchronous logger plugin; await ready before a native transaction.',
        '调用方资源或同步 logger 插件；原生事务前等待 ready。'
      ),
      example:
        "import { fileLogStore } from '@migaia/logger/plugins/durable/file'\n\nawait using store = await fileLogStore('./orders.sqlite')\nawait store.append([{ kind: 'order.created', payload: { id: 'o1' } }])\nconsole.log(await store.lastSeq())",
      cases: loggerCases.fileLogStore
    },
    binlog: {
      role: 'factory',
      purpose: t(
        'Install ordered append/read/subscribe methods; initialize once and borrow the original store.',
        '安装有序追加、读取与订阅方法；共享一次准备并借用原 store。'
      ),
      returns: t(
        'Caller-owned resource or synchronous logger plugin; await ready before a native transaction.',
        '调用方资源或同步 logger 插件；原生事务前等待 ready。'
      ),
      example:
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}",
      cases: loggerCases.binlog
    },
    wal: {
      role: 'factory',
      purpose: t(
        'Install durable pending intent and forward-only complete/abort methods.',
        '安装持久 pending 意图及只前进的 complete/abort 方法。'
      ),
      returns: t(
        'Caller-owned resource or synchronous logger plugin; await ready before a native transaction.',
        '调用方资源或同步 logger 插件；原生事务前等待 ready。'
      ),
      example:
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}",
      cases: loggerCases.wal
    },
    undoLog: {
      role: 'factory',
      purpose: t(
        'Install undo image storage; business undo and conflict checks remain the consumer responsibility.',
        '安装 undo 镜像存储；业务撤销和冲突检查仍由消费方负责。'
      ),
      returns: t(
        'Caller-owned resource or synchronous logger plugin; await ready before a native transaction.',
        '调用方资源或同步 logger 插件；原生事务前等待 ready。'
      ),
      example:
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}",
      cases: loggerCases.undoLog
    },
    Logger: {
      role: 'factory',
      purpose: t(
        'Creates a logger with no built-in sink or level methods. Constructor plugins install synchronously in Feature dependency order; a Promise-returning install rejects construction, so install asynchronous plugins later with use(). Static plugin extensions appear on the returned instance with their types.',
        '创建日志器，核心不自带输出端或级别方法；构造插件按功能依赖顺序同步安装，返回 Promise 的安装会使构造失败，异步插件应在构造后用 `use()` 安装。静态插件扩展会带着类型出现在返回实例上。'
      ),
      params: {
        options: t(
          'Construction options; see `ILoggerOptions` (`execution` is required).',
          '构造选项，见 `ILoggerOptions`（`execution` 必填）。'
        )
      },
      returns: t(
        'A logger instance; invalid options throw `INVALID_OPTION`, a failing plugin rolls back the plugins installed before it and rethrows.',
        '一个 logger 实例；选项不合法时抛 `INVALID_OPTION`，某个插件安装失败时会回滚它之前已安装的插件并重新抛出。'
      ),
      options: 'ILoggerOptions',
      exampleIntro: loggerCases.Logger![0]!.problem,
      example: loggerCases.Logger![0]!.example,
      exampleResult: loggerCases.Logger![0]!.result,
      cases: loggerCases.Logger,
      scenarios: loggerScenarios,
      avoid: [
        t(
          'Sharing one plugin object between loggers: create a new one per logger (`level()` twice), otherwise their state is mixed.',
          '在多个 logger 之间共用同一个插件对象：每个 logger 都要重新创建（调用两次 `level()`），否则内部状态会串在一起。'
        )
      ]
    },
    getLoggerRuntimeManager: {
      role: 'operation',
      purpose: t(
        'Returns the runtime manager that new loggers capture when no `runtimeManager` option is given: the last one set by `setLoggerRuntimeManager()` or the default built from globals.',
        '返回新建 logger 在未提供 `runtimeManager` 选项时捕获的运行时管理器：最近一次通过 `setLoggerRuntimeManager()` 设置的，或基于全局对象构建的默认值。'
      ),
      returns: t(
        'The same manager object (not a copy); do not modify it.',
        '同一个管理器对象（不是副本）；不要修改它。'
      ),
      example: `const manager = getLoggerRuntimeManager()
if (!manager.fetch) console.warn('no fetch')`
    },
    setLoggerRuntimeManager: {
      role: 'operation',
      purpose: t(
        'Sets the default runtime manager for loggers created afterwards (existing loggers keep theirs). Calls nest; restoring undoes them last-in first-out.',
        '为之后创建的 logger 设置默认运行时管理器（已存在的 logger 保持原样）。可嵌套调用，恢复时按后进先出撤销。'
      ),
      params: {
        manager: t(
          'A complete `ILoggerRuntimeManager`: `randomUUID`, `defer` and `write` are required, the rest optional.',
          '完整的 `ILoggerRuntimeManager`：`randomUUID`、`defer`、`write` 必填，其余可选。'
        )
      },
      returns: t(
        'An idempotent restore function. Final restoration reuses the exact default manager object captured by this module, so getLoggerRuntimeManager() returns the original object identity.',
        '幂等恢复函数；最后一次恢复复用本模块最初捕获的默认管理器，`getLoggerRuntimeManager()` 返回原对象身份。'
      ),
      example: `import { Logger, getLoggerRuntimeManager, setLoggerRuntimeManager } from '@migaia/logger'
import { color } from '@migaia/logger/plugins'
const previous = getLoggerRuntimeManager()
const lines: string[] = []
const restore = setLoggerRuntimeManager({
  randomUUID: () => crypto.randomUUID(),
  defer: (task) => queueMicrotask(task),
  write: (text) => { lines.push(text) }
})
try {
  const log = new Logger({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }, plugins: [color({ format: 'json', color: 'never' })] })
  log.log('info', 'captured without a console capability')
  await log.shutdown('manual')
} finally {
  restore()
}
console.log(getLoggerRuntimeManager() === previous, lines)`
    },
    LOGGER_SOURCE: {
      role: 'constant',
      purpose: t(
        'The `source` value (`@migaia/logger`) on every error of this package; compare it with `error.source` before branching on `error.code`.',
        '本包每个错误上的 `source` 值（`@migaia/logger`）；先与 `error.source` 比对确认来源，再按 `error.code` 分支处理。'
      ),
      example: `if (error.source === LOGGER_SOURCE && error.code === LoggerErrorCode.batchOverflow) alertOps()`
    },
    LoggerColorMode: {
      role: 'constant',
      purpose: t(
        'Allowed values of the `color` option of `color()`: `auto`, `always`, `never`.',
        '`color()` 插件 `color` 选项的全部取值，决定控制台输出是否带颜色：`auto`、`always`、`never`。'
      ),
      example: `color({ color: LoggerColorMode.never })`
    },
    LoggerErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of the stable error codes of this package; values are the strings on `error.code`.',
        '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      ),
      example: `log.onFailure(({ error }) => {
  if ((error as { code?: string }).code === LoggerErrorCode.deliveryFailed) retryLater()
})`
    },
    LoggerLevel: {
      role: 'constant',
      purpose: t(
        'The five level names used by `level()`, from lowest to highest.',
        '`level()` 插件使用的五个级别名称，从低到高排列，用于设置最低输出级别。'
      ),
      example: `level({ level: LoggerLevel.warn })`
    },
    LoggerReasoningPhase: {
      role: 'constant',
      purpose: t(
        'Phases of the `reasoning()` stream: `idle`, `thinking`, `responding`.',
        '`reasoning()` 流式输出当前所处的阶段，决定新片段写入哪个段落：`idle`、`thinking`、`responding`。'
      ),
      example: `console.log(LoggerReasoningPhase.thinking) // 'thinking'`
    },
    LoggerStatus: {
      role: 'constant',
      purpose: t(
        'Lifecycle phases a logger goes through: `active`, `flushing` during `flush()`, `shutting-down`, `closed`. The instance does not expose its current phase; the constant names the states behind `flush()` and `shutdown()` behaviour.',
        'logger 经历的生命周期阶段：`active`、`flush()` 期间的 `flushing`、`shutting-down`、`closed`。实例不公开当前阶段；该常量用于说明 `flush()` 与 `shutdown()` 行为背后的状态。'
      ),
      example: `console.log(LoggerStatus.shuttingDown) // 'shutting-down'`
    },
    level: {
      role: 'enhancer',
      purpose: t(
        'Adds debug/info/warn/error/fatal methods, a standard-level threshold and filters for every tag. setLevel changes the live threshold; built-in level captures configuration during installation, so config.update alone does not reconfigure that threshold or its filters. The example supplies both required Logger execution budgets as false (no Host deadline), installs this plugin, and registers a memory sink.',
        '增加五种级别方法、标准级别门槛与面向所有标签的过滤器；`setLevel` 修改活动门槛。内置插件在安装时捕获配置，单独 `config.update` 不会重配门槛或过滤列表；本例为 Logger 两项必填 `execution` 预算设 `false`（无 Host 时限），安装插件并登记内存输出端。'
      ),
      params: {
        config: t(
          'Optional ILevelPluginConfig, defaults to {}.',
          '可选 `ILevelPluginConfig`，默认 `{}`。'
        )
      },
      returns: t('A plugin object for one logger.', '只能安装到一个 logger 上的插件对象。'),
      options: 'ILevelPluginConfig',
      exampleIntro: loggerCases.level![0]!.problem,
      example: loggerCases.level![0]!.example,
      exampleResult: loggerCases.level![0]!.result,
      cases: loggerCases.level
    },
    color: {
      role: 'enhancer',
      purpose: t(
        'Prints pretty lines or JSON using the captured runtimeManager.console before falling back to write. JSON rendering projects bounded source/code/name/message/stack/cause/errors and excludes the local raw Error reference. It adds no logger methods and provides paint/dim to reasoning().\n\nThe example supplies required Logger execution.mutationTimeoutMs and execution.pipelineDrainTimeoutMs as false (no Host deadline), context as the entry path (default []), and plugins (default []). runtimeManager defaults to the current manager; this example borrows its randomUUID, defer and write capabilities, replacing only console.log/warn/error with variadic void callbacks that capture the rendered string.',
        '将日志渲染为可读文本或 JSON，优先使用已捕获的 `runtimeManager.console`，缺失时才使用 `write`。JSON 采用有界错误链投影，保留来源、错误码、名称、消息、堆栈、原因与聚合分支，不含本地 `raw` 错误引用；插件不添加日志方法，并向 `reasoning()` 提供着色能力。\n\n本例为 Logger 必填的 `execution.mutationTimeoutMs` 与 `execution.pipelineDrainTimeoutMs` 设 `false`（无 Host 时限），`context` 提供条目路径（默认 `[]`），`plugins` 默认 `[]`。`runtimeManager` 默认捕获当前管理器，本例沿用其 `randomUUID`、`defer`、`write`，仅替换 `console.log`、`warn`、`error` 为接收任意参数、返回空值的函数，将渲染文本收进内存。'
      ),
      params: {
        config: t(
          'Optional IColorPluginConfig, defaults to {}.',
          '可选 `IColorPluginConfig`，默认 `{}`。'
        )
      },
      returns: t('A plugin object for one logger.', '只能安装到一个 logger 上的插件对象。'),
      options: 'IColorPluginConfig',
      exampleIntro: loggerCases.color![0]!.problem,
      example: loggerCases.color![0]!.example,
      exampleResult: loggerCases.color![0]!.result,
      cases: loggerCases.color
    },
    batch: {
      role: 'enhancer',
      purpose: t(
        'Plugin adding no logger methods; it provides batching for HTTP and file consumers. Same-batch plugins are sorted by Feature dependencies, independent of array order; a provider installed in a later use call does not retroactively rebind consumers.',
        '不增加日志方法的插件，为上传及文件消费者提供攒批能力；同批插件按功能依赖排序而非输入顺序，跨调用迟到安装的提供者不会追溯重绑。'
      ),
      params: {
        config: t(
          'Optional default batch settings; see `IBatchPluginConfig`.',
          '可选的默认攒批设置，见 `IBatchPluginConfig`。'
        )
      },
      returns: t('A plugin object for one logger.', '只能安装到一个 logger 上的插件对象。'),
      options: 'IBatchPluginConfig',
      example: `import { Logger } from '@migaia/logger'
import { batch, http } from '@migaia/logger/plugins'

${create}
  plugins: [batch({ maxSize: 50, maxWaitMs: 1000 }), http({ url: endpoint })]
})`
    },
    http: {
      role: 'enhancer',
      purpose: t(
        'Sends POST { entries } JSON with retries, timeout and Retry-After. A batch provider installed earlier or in the same dependency-sorted batch enables shared batching. Without it, http.batch creates a bounded local queue forced to maxSize:1 and asyncOutput:false; no batch option uses a direct per-entry sink.',
        '以结构化请求上传条目，提供重试、超时及重试响应头处理；已安装或同批的攒批提供者可启用共享队列。无提供者时显式队列设置仍创建有界单条同步队列，省略设置才直接逐条发送。'
      ),
      params: {
        config: t(
          'Required; see `IHttpPluginConfig` (`url` is required).',
          '必填配置，见 `IHttpPluginConfig`（`url` 必填）。'
        )
      },
      returns: t(
        'A plugin object; invalid `retries` throw `INVALID_RETRY_COUNT`.',
        '插件对象；`retries` 不合法时抛 `INVALID_RETRY_COUNT`。'
      ),
      options: 'IHttpPluginConfig',
      example: `import { Logger } from '@migaia/logger'
import { batch, http } from '@migaia/logger/plugins'

${create}
  plugins: [batch(), http({ url: 'https://logs.example/v1/entries', authToken: token, retries: 3 })]
})`
    },
    process: {
      role: 'enhancer',
      purpose: t(
        'Node/Bun process adapter: SIGINT/SIGTERM and crashes trigger drain and shutdown; crashes exit with code 1 even when captureCrashes is false. beforeExit flushes without initiating shutdown. Without a captured process capability it does nothing.',
        '进程适配器在退出信号与崩溃时排空并关闭；即使关闭崩溃日志，崩溃仍以退出码一结束。`beforeExit` 仅刷新，不主动关闭；没有捕获的进程能力时为空操作。'
      ),
      params: {
        config: t('Optional; see `IProcessPluginConfig`.', '可选配置，见 `IProcessPluginConfig`。')
      },
      returns: t('A plugin object for one logger.', '只能安装到一个 logger 上的插件对象。'),
      options: 'IProcessPluginConfig',
      example: `import { Logger } from '@migaia/logger'
import { level, color, process } from '@migaia/logger/plugins'

${create}
  plugins: [level(), color(), process({ shutdownTimeoutMs: 5000 })]
})`
    },
    reasoning: {
      role: 'enhancer',
      purpose: t(
        'Plugin that adds streaming methods for model output (`startThinking`, `thinking`, `endThinking`, `startResponse`, `response`, `endResponse`). Chunks go straight to stdout; each finished section is also logged as one silent entry.',
        '为模型输出增加流式方法（`startThinking`、`thinking`、`endThinking`、`startResponse`、`response`、`endResponse`）的插件。文本片段直接写到 stdout；每个结束的段落还会记录为一条静默条目。'
      ),
      params: {
        config: t(
          'Optional; see `IReasoningPluginConfig`.',
          '可选配置，见 `IReasoningPluginConfig`。'
        )
      },
      returns: t('A plugin object for one logger.', '只能安装到一个 logger 上的插件对象。'),
      options: 'IReasoningPluginConfig',
      example: `import { Logger } from '@migaia/logger'
import { color, reasoning } from '@migaia/logger/plugins'

${create}
  plugins: [color(), reasoning({ labels: { response: 'Answer' } })]
})
log.thinking('checking the cache')
log.response('42')
log.endResponse()`
    },
    uuid: {
      role: 'enhancer',
      purpose: t(
        'Plugin that writes a random UUID to `entry.data.uuid` of every entry passing the pipeline, so entries can be correlated across systems.',
        '为每个通过管线的条目在 `entry.data.uuid` 中写入随机 UUID 的插件，便于在不同系统之间关联日志。'
      ),
      params: {
        config: t('Optional; see `IUuidPluginConfig`.', '可选配置，见 `IUuidPluginConfig`。')
      },
      returns: t('A plugin object for one logger.', '只能安装到一个 logger 上的插件对象。'),
      options: 'IUuidPluginConfig',
      example: `import { Logger } from '@migaia/logger'
import { color, uuid } from '@migaia/logger/plugins'

${create}
  plugins: [uuid({ display: true }), color()]
})`
    },
    file: {
      role: 'enhancer',
      purpose: t(
        'Plugin that appends entries to a file as JSON lines, one batch per append, and can ask the injected `fs` to rotate the file. Write failures go to `onFailure()`.',
        '把日志条目以 JSON 行追加写入文件的插件，每批追加一次，并可要求注入的 `fs` 轮转文件。写入失败交给 `onFailure()`。'
      ),
      params: {
        config: t(
          'Required; see `IFilePluginConfig` (`path` is required).',
          '必填配置，见 `IFilePluginConfig`（`path` 必填）。'
        )
      },
      returns: t(
        'A plugin object; an empty `path` or invalid `rotate` limits throw `INVALID_OPTION`.',
        '插件对象；`path` 为空或 `rotate` 上限不合法时抛 `INVALID_OPTION`。'
      ),
      options: 'IFilePluginConfig',
      example: `import { Logger } from '@migaia/logger'
import { file } from '@migaia/logger/plugins/file'

${create}
  plugins: [file({ path: 'logs/app.jsonl', batch: { maxSize: 100 } })]
})`
    },
    ANSIS_PLUGIN_NAME: {
      role: 'constant',
      purpose: t(
        'Registered name of the `color()` plugin (`ansis`); pass it to `unUse()` or `config.get()`.',
        '`color()` 插件的注册名称（`ansis`）；可传给 `unUse()` 或 `config.get()`，避免在代码中散写插件名称字符串。'
      ),
      example: `await log.unUse(ANSIS_PLUGIN_NAME)`
    },
    BATCH_PLUGIN_NAME: {
      role: 'constant',
      purpose: t(
        'Registered name of the `batch()` plugin (`batch`); pass it to `unUse()` or `config.get()`.',
        '`batch()` 插件的注册名称（`batch`）；可传给 `unUse()` 或 `config.get()`，避免在代码中散写插件名称字符串。'
      ),
      example: `log.config.get(\`\${BATCH_PLUGIN_NAME}.maxSize\`)`
    },
    HTTP_PLUGIN_NAME: {
      role: 'constant',
      purpose: t(
        'Registered name of the `http()` plugin (`http`); pass it to `unUse()` or `config.update()`.',
        '`http()` 插件的注册名称（`http`）；可传给 `unUse()` 或 `config.update()`，避免在代码中散写插件名称字符串。'
      ),
      example: `await log.config.update(HTTP_PLUGIN_NAME, () => ({ retries: 5 }))`
    },
    LEVEL_PLUGIN_NAME: {
      role: 'constant',
      purpose: t(
        'Registered name of the `level()` plugin (`level`); pass it to `unUse()` or `config.get()`.',
        '`level()` 插件的注册名称（`level`）；可传给 `unUse()` 或 `config.get()`，避免在代码中散写插件名称字符串。'
      ),
      example: `log.config.get(\`\${LEVEL_PLUGIN_NAME}.level\`)`
    },
    PROCESS_PLUGIN_NAME: {
      role: 'constant',
      purpose: t(
        'Registered name of the `process()` plugin (`process`); pass it to `unUse()`.',
        '`process()` 插件的注册名称（`process`）；可传给 `unUse()`，避免在代码中散写插件名称字符串。'
      ),
      example: `await log.unUse(PROCESS_PLUGIN_NAME)`
    },
    REASONING_PLUGIN_NAME: {
      role: 'constant',
      purpose: t(
        'Registered name of the `reasoning()` plugin (`reasoning`); pass it to `unUse()`.',
        '`reasoning()` 插件的注册名称（`reasoning`）；可传给 `unUse()`，避免在代码中散写插件名称字符串。'
      ),
      example: `await log.unUse(REASONING_PLUGIN_NAME)`
    },
    UUID_PLUGIN_NAME: {
      role: 'constant',
      purpose: t(
        'Registered name of the `uuid()` plugin (`uuid`); pass it to `unUse()` or `config.update()`.',
        '`uuid()` 插件的注册名称（`uuid`）；可传给 `unUse()` 或 `config.update()`，避免在代码中散写插件名称字符串。'
      ),
      example: `await log.config.update(UUID_PLUGIN_NAME, () => ({ display: true }))`
    },
    FILE_PLUGIN_NAME: {
      role: 'constant',
      purpose: t(
        'Registered name of the `file()` plugin (`file`); pass it to `unUse()` or `config.get()`.',
        '`file()` 插件的注册名称（`file`）；可传给 `unUse()` 或 `config.get()`，避免在代码中散写插件名称字符串。'
      ),
      example: `log.config.get(\`\${FILE_PLUGIN_NAME}.path\`)`
    }
  },
  types: {
    ILogPayload: alias(
      'Plain JSON output data with independent snapshots.',
      '独立快照的普通 JSON 输出数据。'
    ),
    ILogPayloadInput: alias(
      'Structural input admission retaining named shapes and readonly tuples.',
      '保留命名对象和 readonly 元组的结构输入准入。'
    ),
    ILogRecordInput: alias(
      'A caller kind and payload before sequence/time assignment.',
      '分配序号与时间前的调用方 kind/payload。'
    ),
    ILogBatchInput: alias(
      'Per-record static JSON admission without losing tuple positions.',
      '逐条静态 JSON 准入，不丢失元组位置。'
    ),
    ILogRecord: alias(
      'Committed sequence, nondecreasing time, kind, and payload snapshot.',
      '已提交序号、非递减时间、kind 与载荷快照。'
    ),
    ILogObservation: alias(
      'Fixed identity statistics without payload or native resources.',
      '固定身份统计，不包含载荷或原生资源。'
    ),
    ILogObserver: alias(
      'Synchronous observation; asynchronous rejection is only reported.',
      '同步观察；异步拒绝只报告而不等待。'
    ),
    ILogAppendNotice: alias(
      'Frozen lastSeq/count of one actual nonempty append commit.',
      '一次真实非空追加提交的冻结 lastSeq/count。'
    ),
    IUndoImage: alias(
      'JSON target and before/after images; null is legitimate.',
      'JSON target 与 before/after 镜像；null 是合法值。'
    ),
    ILogStore: {
      summary: t(
        'Durable logger contract with explicit ownership and initialization.',
        '具有明确资源归属与准备顺序的持久日志契约。'
      ),
      members: durableStoreMembers
    },
    IBinlogExt: {
      summary: t(
        'Durable logger contract with explicit ownership and initialization.',
        '具有明确资源归属与准备顺序的持久日志契约。'
      ),
      members: {
        binlog: {
          summary: t(
            'Installed ordered log API; unavailable without the binlog plugin.',
            '安装后的有序日志 API；未安装 binlog 时不存在。'
          )
        }
      }
    },
    IWalExt: {
      summary: t(
        'Durable logger contract with explicit ownership and initialization.',
        '具有明确资源归属与准备顺序的持久日志契约。'
      ),
      members: { wal: { summary: t('Installed persistent intent API.', '安装后的持久意图 API。') } }
    },
    IUndoLogExt: {
      summary: t(
        'Durable logger contract with explicit ownership and initialization.',
        '具有明确资源归属与准备顺序的持久日志契约。'
      ),
      members: {
        undo: {
          summary: t(
            'Installed active image API; no business rollback authority.',
            '安装后的活跃镜像 API；不拥有业务回滚权。'
          )
        }
      }
    },
    IDurablePluginOptions: {
      summary: t(
        'Durable logger contract with explicit ownership and initialization.',
        '具有明确资源归属与准备顺序的持久日志契约。'
      ),
      members: {
        store: {
          summary: t(
            'The original caller-owned ILogStore; one installed plugin per object. It never enters plugin config.',
            '调用方拥有的原 ILogStore；同一对象只能安装一个插件，不进入插件 config。'
          )
        },
        observe: {
          summary: t(
            'Optional synchronous statistics observer; thrown, getter, and async failures only report.',
            '可选同步统计观察者；同步抛错、then 读取失败和异步拒绝只报告。'
          )
        }
      }
    },
    IBinlogOptions: {
      summary: t(
        'Durable logger contract with explicit ownership and initialization.',
        '具有明确资源归属与准备顺序的持久日志契约。'
      ),
      members: {
        store: {
          summary: t(
            'The original caller-owned ILogStore; one installed plugin per object. It never enters plugin config.',
            '调用方拥有的原 ILogStore；同一对象只能安装一个插件，不进入插件 config。'
          )
        },
        observe: {
          summary: t(
            'Optional synchronous statistics observer; thrown, getter, and async failures only report.',
            '可选同步统计观察者；同步抛错、then 读取失败和异步拒绝只报告。'
          )
        },
        echo: {
          summary: t(
            'Default false; true emits kind plus seq/time metadata without payload.',
            '默认 false；true 输出 kind 与 seq/time 元数据，不输出 payload。'
          )
        }
      }
    },
    ILogStoreOptions: {
      summary: t(
        'Durable logger contract with explicit ownership and initialization.',
        '具有明确资源归属与准备顺序的持久日志契约。'
      ),
      members: {
        observe: {
          summary: t(
            'Optional synchronous statistics observer; thrown, getter, and async failures only report.',
            '可选同步统计观察者；同步抛错、then 读取失败和异步拒绝只报告。'
          )
        },
        report: {
          summary: t(
            'Optional standalone store failure reporter; reporter failures use the original logger terminal channel.',
            '可选独立 store 失败报告器；报告器失败走原 logger 终端通道。'
          )
        }
      }
    },
    ILogAppendOptions: {
      summary: t(
        'Durable logger contract with explicit ownership and initialization.',
        '具有明确资源归属与准备顺序的持久日志契约。'
      ),
      members: {
        transaction: {
          summary: t(
            'Existing owner-created append port; prepare logger plugins before opening its native transaction.',
            '由原拥有者创建的追加端口；先准备 logger 插件再打开原生事务。'
          )
        }
      }
    },
    ILogAppendPort: {
      summary: t(
        'Durable logger contract with explicit ownership and initialization.',
        '具有明确资源归属与准备顺序的持久日志契约。'
      ),
      members: {
        store: {
          summary: t(
            'Exact resource identity bound by the original owner, not write authority itself.',
            '原拥有者绑定的精确资源身份；此字段本身不授予写权限。'
          )
        },
        append: {
          summary: t(
            'Immediately append within the current native transaction; return provisional sequences.',
            '立即在当前原生事务追加，返回暂定序号。'
          )
        },
        onCommit: {
          summary: t(
            'Register one actual commit effect and return its cancellation function.',
            '登记真实提交观察并返回取消函数。'
          )
        },
        onRollback: {
          summary: t(
            'Register one actual rollback effect and return its cancellation function.',
            '登记真实回滚观察并返回取消函数。'
          )
        }
      }
    },
    Logger: {
      surface: 'ILoggerCore',
      summary: t(
        'A logger instance: the core members below plus the methods of the installed plugins (for example `info()` after `level()`).',
        '一个 logger 实例：拥有下列核心成员，外加已安装插件的方法（例如安装 `level()` 后的 `info()`）。'
      ),
      scenarios: loggerScenarios,
      example: loggerExample,
      members: coreMembers
    },
    ILoggerCore: {
      summary: t(
        'Core capabilities of a logger, also passed to plugins as `core` in `install(core)` (without `use` / `unUse`).',
        'logger 的核心能力；插件在 `install(core)` 中拿到的 `core` 也是它（但没有 `use` / `unUse`）。'
      ),
      scenarios: loggerScenarios,
      example: loggerExample,
      members: loggerCoreMembers
    },
    ILoggerPluginCore: {
      summary: t(
        'The `core` a plugin receives in `install(core)`: the logger core without `use` / `unUse`, plus `onDispose()` for cleanup.',
        '插件在 `install(core)` 中收到的 `core`：去掉 `use` / `unUse` 的 logger 核心，外加用于清理的 `onDispose()`。'
      ),
      members: pluginCoreMembers
    },
    ILoggerConfig: {
      summary: t(
        'The `config` store of a logger instance, addressed by plugin name.',
        'logger 实例上的 `config` 配置仓库，按插件名称寻址。'
      ),
      members: {
        get: {
          summary: t(
            'Reads one committed plugin configuration or a nested value through the Host config facade. Object and array snapshots are recursively frozen; Logger adds no copy or root-name restriction.',
            '通过 Host 配置接口读取某个插件的完整已提交配置或嵌套值；对象与数组快照递归冻结，Logger 不额外拷贝，也不禁止读取插件根配置。'
          ),
          params: {
            path: t(
              'A plugin name for its whole configuration, or a nested path such as level.level or plugin.[index].key.',
              '用插件名读取完整配置，或使用 `level.level`、`plugin.[index].key` 等嵌套路径。'
            )
          },
          returns: t(
            'The stored value, or undefined when omitted. Consumption-time defaults are not filled into this snapshot: omitted HTTP retries reads undefined even though sending uses 2.',
            '返回存储值，省略时为 `undefined`；消费时默认值不会写回快照，因此省略上传重试数时读取为空，而实际发送采用二次重试。'
          ),
          example: `const storedRetries = log.config.get('http.retries')
console.log(storedRetries ?? 2)`
        },
        update: {
          summary: t(
            'Shallow-merges a patch, runs an optional plugin update hook, then commits the Host-owned snapshot. A plugin that captures config at install time needs its explicit runtime methods for behavior changes; use setLevel for the built-in level threshold.',
            '浅合并补丁，运行可选插件更新钩子，再提交 Host 拥有的快照；安装时捕获配置的插件，须使用明确的运行时方法改变行为，内置级别门槛使用 `setLevel`。'
          ),
          params: {
            name: t(
              'Plugin name, such as `HTTP_PLUGIN_NAME`.',
              '插件名称，例如 `HTTP_PLUGIN_NAME`。'
            ),
            recipe: t(
              '`(previous) => patch`, synchronous; `previous` is the current configuration.',
              '同步函数 `(previous) => patch`；`previous` 是当前配置。'
            )
          },
          returns: t(
            'Resolves after commit; rejects and keeps the old configuration on failure.',
            '提交后 resolve；失败时 reject，并保留旧配置。'
          ),
          example: `await log.config.update('level', () => ({ level: 'warn' }))`
        }
      }
    },
    ILoggerPluginConfig: {
      summary: t(
        'The `core.config` a plugin sees: it can only read its own configuration.',
        '插件看到的 `core.config`：只能读取插件自己的配置。'
      ),
      members: {
        get: {
          summary: t(
            'Returns the committed configuration of the calling plugin.',
            '返回调用方插件已提交的配置。'
          ),
          returns: t('The frozen configuration object of this plugin.', '该插件冻结的配置对象。'),
          example: `const config = core.config.get<IMyPluginConfig>()`
        }
      }
    },
    ILoggerContext: {
      summary: t(
        'Frozen context of a logger, read from `log.ctx` or `core.ctx`.',
        'logger 的冻结上下文，通过 `log.ctx` 或 `core.ctx` 读取。'
      ),
      members: {
        id: {
          summary: t(
            'Stable id generated at construction with `runtimeManager.randomUUID()`; `extends()` detects cycles with it.',
            '构造时通过 `runtimeManager.randomUUID()` 生成的稳定 id；`extends()` 用它检测环路。'
          )
        },
        options: {
          summary: t(
            'The frozen `options` given to `new Logger()`, readable by every plugin.',
            '传给 `new Logger()` 的 `options`，已冻结，所有插件都可读取。'
          )
        },
        path: {
          summary: t(
            'Default `context` of entries, from the `context` option.',
            '日志条目的默认上下文路径，来自 `context` 选项。'
          )
        },
        topic: {
          summary: t(
            'The `topic` option, shown in the forwarding chain of `extends()`.',
            '`topic` 选项的值，在 `extends()` 的转发链中展示。'
          )
        },
        createdAt: {
          summary: t(
            'Time at which the logger was constructed.',
            '该 logger 实例被构造出来的时间。'
          )
        },
        env: {
          summary: t(
            'Environment detected at construction: `isTTY` and `isCI`.',
            '构造时检测到的运行环境：`isTTY` 与 `isCI`。'
          )
        }
      }
    },
    ILoggerEnv: {
      summary: t(
        'Environment flags read once from `runtimeManager.process`.',
        '从 `runtimeManager.process` 读取一次的环境标志。'
      ),
      members: {
        isTTY: {
          summary: t('`true` when stdout is a terminal.', '标准输出连接到交互终端时为 `true`。')
        },
        isCI: {
          summary: t(
            '`true` when the `CI` environment variable is set.',
            '设置了 `CI` 环境变量（持续集成环境）时为 `true`。'
          )
        }
      }
    },
    ILoggerOptions: {
      summary: t(
        'Options of `new Logger()`.',
        '`new Logger()` 的构造选项：执行预算、上下文、钩子、插件与管线模式。'
      ),
      members: {
        execution: {
          summary: t(
            'Required object containing mutationTimeoutMs and pipelineDrainTimeoutMs. Each field is a finite nonnegative millisecond number or false; neither has a default. These Host budgets are distinct from the logger 3000 ms flush/shutdown-handler waiting budget.',
            '必填对象，含 `mutationTimeoutMs` 与 `pipelineDrainTimeoutMs`，两字段都没有默认值，须为有限非负毫秒数或 `false`；这些 Host 预算不同于日志排空与关闭回调的 `3000` 毫秒等待预算。'
          )
        },
        'execution.mutationTimeoutMs': {
          summary: t(
            'Required plugin install/uninstall mutation budget in finite nonnegative milliseconds; false explicitly disables its deadline.',
            '必填插件安装与卸载变更预算，使用有限非负毫秒数；`false` 显式取消该截止时间。'
          )
        },
        'execution.pipelineDrainTimeoutMs': {
          summary: t(
            'Required Host pipeline drain budget in finite nonnegative milliseconds; false explicitly disables its deadline.',
            '必填 Host 管线排空预算，使用有限非负毫秒数；`false` 显式取消该截止时间。'
          )
        },
        runtimeManager: {
          summary: t(
            'Host capabilities this logger uses (stdout, UUID, scheduling, fetch, fs).',
            '该 logger 使用的宿主能力（stdout、UUID、调度、fetch、fs）。'
          ),
          default: t(
            'The manager returned by `getLoggerRuntimeManager()` at construction.',
            '构造时 `getLoggerRuntimeManager()` 返回的管理器。'
          )
        },
        context: {
          summary: t(
            'Default context path of entries that do not pass `context`.',
            '未显式传入 `context` 的日志条目使用的默认上下文路径。'
          ),
          default: t('`[]`: no context.', '`[]`：没有上下文。')
        },
        topic: {
          summary: t(
            'Name of this logger in the forwarding chain shown by `extends()`.',
            '该 logger 在 `extends()` 转发链中显示的名称。'
          ),
          default: t('`""`: not shown.', '`""`：不显示。')
        },
        on: {
          summary: t(
            'Hooks registered at construction, same as calling `hook(name, fn)` for each key.',
            '构造时登记的钩子，等同于对每个键调用一次 `hook(name, fn)`。'
          ),
          default: t('`{}`: no hooks.', '`{}`：不登记钩子。')
        },
        plugins: {
          summary: t(
            'Plugins installed synchronously in Feature dependency order within this batch; their static extensions appear on the instance.',
            '本批插件按功能依赖顺序同步安装，静态扩展会出现在返回实例上。'
          ),
          default: t('`[]`: a bare core with `log()` only.', '`[]`：只有 `log()` 的空核心。')
        },
        options: {
          summary: t(
            'Application settings frozen and exposed to plugins as `core.ctx.options`.',
            '冻结后通过 `core.ctx.options` 提供给插件读取的应用配置。'
          ),
          default: t('`{}`.', '`{}`：没有应用配置。')
        },
        pipeline: {
          summary: t(
            'Pipeline settings; `mode` is fixed at construction.',
            '管线设置；其中 `mode` 在构造后不可更改。'
          ),
          default: t('`{ mode: "sync" }`.', '`{ mode: "sync" }`：同步管线。')
        },
        'pipeline.mode': {
          summary: t(
            'How pipeline stages run; it decides which `use*Pipeline` method is accepted.',
            '管线阶段的执行方式；它决定接受哪个 `use*Pipeline` 方法。'
          ),
          default: t('`sync`.', '`sync`：同步扁平管线。'),
          values: {
            sync: t(
              'Stages run one after another synchronously; register with `usePipeline`.',
              '阶段同步依次执行；用 `usePipeline` 注册。'
            ),
            async: t(
              'Onion model: `await next()` waits for the downstream; register with `useAsyncPipeline`.',
              '洋葱模型：`await next()` 会等待下游完成；用 `useAsyncPipeline` 注册。'
            ),
            generator: t(
              'Generator stages; register with `useGeneratorPipeline`.',
              '生成器阶段；用 `useGeneratorPipeline` 注册。'
            ),
            'async-generator': t(
              'Async generator stages, each awaited to its final value; register with `useAsyncGeneratorPipeline`.',
              '异步生成器阶段，逐个等待到最终值；用 `useAsyncGeneratorPipeline` 注册。'
            )
          }
        },
        scheduler: {
          summary: t(
            'Clock and timers for flush, shutdown and batch deadlines; inject a manual scheduler in tests.',
            'flush、shutdown 与批处理截止时间使用的时钟和计时器；测试时可注入手动调度器。'
          ),
          default: t(
            '`systemScheduler` from `@migaia/utils/scheduler`.',
            '`@migaia/utils/scheduler` 的 `systemScheduler`。'
          )
        }
      }
    },
    ILoggerRuntimeManager: {
      summary: t(
        'Host capabilities a logger uses instead of touching globals: stdout, scheduling, UUIDs and the optional process, console, fetch, fs and abort controllers. Read with `getLoggerRuntimeManager()`, replace with `setLoggerRuntimeManager()` or the `runtimeManager` option.',
        'logger 使用的宿主能力，用来代替直接访问全局对象：stdout、调度、UUID，以及可选的 process、console、fetch、fs 和中止控制器。用 `getLoggerRuntimeManager()` 读取，用 `setLoggerRuntimeManager()` 或 `runtimeManager` 选项替换。'
      ),
      scenarios: [
        t(
          'Capture output in tests instead of writing to stdout.',
          '在测试中捕获输出，而不是写到 stdout。'
        ),
        t(
          'Run the `file()` plugin in a browser or a mini-program by injecting `fs`.',
          '通过注入 `fs`，在浏览器或小程序中使用 `file()` 插件。'
        )
      ],
      example: loggerCases.color![0]!.example,
      members: {
        process: {
          summary: t(
            'Node-like `process` (env, stdout, events, exit); absent in browsers.',
            '类似 Node 的 `process`（环境变量、stdout、事件、退出）；浏览器中不存在。'
          )
        },
        fs: {
          summary: t(
            'Optional file capability `{ append, rotate? }` used by `file()`; absent by default.',
            '供 `file()` 使用的可选文件能力 `{ append, rotate? }`；默认不存在。'
          )
        },
        createAbortController: {
          summary: t(
            'Optional factory for abort controllers used by `http()`; native `AbortController` when absent.',
            '供 `http()` 使用的可选中止控制器工厂；不存在时使用原生 `AbortController`。'
          )
        },
        randomUUID: {
          summary: t(
            'Returns a unique id; used for `ctx.id` and `uuid()`.',
            '返回一个唯一 id；用于 `ctx.id` 与 `uuid()` 插件。'
          ),
          returns: t('A unique string.', '唯一的字符串标识。'),
          example: `manager.randomUUID()`
        },
        defer: {
          summary: t(
            'Runs a task after the current stack (default: `setImmediate`, `setTimeout(0)` or a microtask).',
            '在当前调用栈之后执行任务（默认依次尝试 `setImmediate`、`setTimeout(0)`、微任务）。'
          ),
          params: { task: t('Work to run later.', '稍后执行的工作。') },
          returns: t('Nothing; the task is scheduled.', '无返回值；任务已安排。'),
          example: `manager.defer(() => flushQueue())`
        },
        write: {
          summary: t(
            'Writes raw text (default: `process.stdout.write` or `console.log`).',
            '写出原始文本（默认使用 `process.stdout.write` 或 `console.log`）。'
          ),
          params: { text: t('Text to write as is.', '原样写出的文本。') },
          returns: t('Nothing; the text is written.', '无返回值；文本已写出。'),
          example: `manager.write('ready\\n')`
        },
        console: {
          summary: t(
            'Optional console.log/warn/error callbacks used by color for both pretty and JSON output and by failure reporting. Each accepts variadic unknown values and returns void. Without console, the renderer falls back to write.',
            '可选的 `console.log`、`warn`、`error` 回调，供颜色插件的可读与 JSON 输出及失败报告使用；各接收任意多个未知值，返回空值，未提供控制台时渲染器改用 `write`。'
          )
        },
        fetch: {
          summary: t(
            'HTTP transport used by `http()`; missing it makes `http()` fail with `TRANSPORT_UNAVAILABLE`.',
            '`http()` 使用的 HTTP 传输函数；缺失时 `http()` 以 `TRANSPORT_UNAVAILABLE` 失败。'
          )
        }
      }
    },
    ILoggerProcess: {
      summary: t(
        'The part of Node `process` a logger needs; provided by `runtimeManager.process`.',
        'logger 需要的那部分 Node `process` 能力；由 `runtimeManager.process` 提供。'
      ),
      members: {
        env: {
          summary: t(
            'Environment variables (`CI`, `NO_COLOR`, `FORCE_COLOR`, `LOG_FORMAT`).',
            'logger 会读取的进程环境变量（`CI`、`NO_COLOR`、`FORCE_COLOR`、`LOG_FORMAT`）。'
          )
        },
        stdout: {
          summary: t(
            'Output stream with `write()` and `isTTY`.',
            '带 `write()` 方法与 `isTTY` 标志的标准输出流。'
          )
        },
        on: {
          summary: t(
            'Registers a process event listener (used by `process()`).',
            '登记进程事件监听（由 `process()` 插件使用）。'
          ),
          params: {
            event: t('Event name such as `SIGTERM`.', '事件名称，例如 `SIGTERM`。'),
            listener: t('Event listener.', '事件触发时调用的监听函数。')
          },
          returns: t('Whatever the host returns; ignored.', '宿主返回的任意值；会被忽略。'),
          example: `runtime.process?.on('SIGTERM', onTerm)`
        },
        removeListener: {
          summary: t(
            'Removes a listener registered with `on()`.',
            '移除之前用 `on()` 登记的监听。'
          ),
          params: {
            event: t('Event name used with `on()`.', '登记时使用的事件名称。'),
            listener: t('The same listener function.', '登记时的同一个监听函数。')
          },
          returns: t('Whatever the host returns; ignored.', '宿主返回的任意值；会被忽略。'),
          example: `runtime.process?.removeListener('SIGTERM', onTerm)`
        },
        exit: {
          summary: t(
            'Ends the process with a code; `process()` calls it after the shutdown drain.',
            '以退出码结束进程；`process()` 在关闭排空后调用它。'
          )
        }
      }
    },
    ILogEntry: {
      summary: t(
        'One log entry as stages, hooks and sinks see it.',
        '管线阶段、钩子与 sink 看到的一条日志条目。'
      ),
      members: logEntryMembers
    },
    IErrorInfo: {
      summary: t(
        'Local error projection on entry.error with native raw identity for console/custom sinks. HTTP and color JSON use the shared bounded source/code/name/message/stack/cause/errors projection without raw; unclassified business errors use diagnostic unknown/UNKNOWN placeholders.',
        '保存在 `entry.error` 上的本地错误投影，供控制台及自定义输出使用原生对象。上传与颜色插件结构化输出使用共享有界链，保留来源、错误码、名称、消息、堆栈及原因和聚合分支，不含 `raw`；未分类业务错误使用诊断占位 `unknown/UNKNOWN`。'
      ),
      members: {
        name: {
          summary: t('Error name such as `TypeError`.', '原生错误对象的名称，例如 `TypeError`。')
        },
        message: {
          summary: t('Message text of the original error.', '原始错误对象上的 message 文本。')
        },
        stack: { summary: t('Stack text, when available.', '调用栈文本（可获得时才有）。') },
        raw: {
          summary: t(
            'The exact original Error for local inspection. Generic JSON may serialize enumerable own custom properties even though built-in native fields are usually non-enumerable. Built-in HTTP/color JSON deliberately omit raw and project the full bounded chain.',
            '供本地检查的原始错误对象。普通序列化仍可能输出可枚举自有字段，原生内置字段通常不可枚举；内置上传与颜色插件结构化输出明确省略 `raw` 并投影完整有界链。'
          )
        }
      }
    },
    IRawEntryInput: {
      summary: t(
        'Input of `dispatchRaw()`: `tag` and `message` are required, the other entry fields optional.',
        '`dispatchRaw()` 的输入：`tag` 与 `message` 必填，其它条目字段可选。'
      ),
      members: {
        // `dispatchRaw()` assigns the entry id itself, so the input type omits `id`.
        ...Object.fromEntries(Object.entries(logEntryMembers).filter(([name]) => name !== 'id')),
        tag: {
          summary: t(
            'Tag of the entry, such as `audit`.',
            '日志条目的标签，例如 `audit` 或 `info`。'
          )
        },
        message: { summary: t('Message text of the entry.', '该日志条目要记录的消息文本。') }
      }
    },
    ILogDispatchOptions: {
      summary: t(
        'Options of `dispatchRaw()` and `raw()`.',
        '`dispatchRaw()` 与 `raw()` 共用的输出调度选项。'
      ),
      members: {
        asyncOutput: {
          summary: t(
            'Schedule the output with `defer()` instead of writing during the call.',
            '通过 `defer()` 调度输出，而不是在调用过程中直接写出。'
          ),
          default: t('`false`.', '`false`：在调用中同步输出。')
        }
      }
    },
    ILogFailure: {
      summary: t(
        'Argument of `onFailure()` callbacks.',
        '`onFailure()` 回调收到的失败信息：来源与错误。'
      ),
      members: {
        source: {
          summary: t('Which stage of the logger failed.', '失败发生在 logger 的哪个环节。'),
          values: {
            defer: t('A task given to `defer()` threw.', '交给 `defer()` 的任务抛错。'),
            hook: t('A hook threw or rejected.', '某个钩子抛错或 reject。'),
            sink: t(
              'A sink threw or rejected (console, upload, file).',
              '某个 sink 抛错或 reject（控制台、上报、文件）。'
            ),
            pipeline: t(
              'A stage threw or returned an invalid entry.',
              '某个管线阶段抛错或返回了无效条目。'
            ),
            flush: t(
              'An `onFlush` callback failed or the flush deadline passed.',
              '某个 `onFlush` 回调失败或超过了刷新截止时间。'
            ),
            forward: t(
              'Forwarding to an `extends()` target failed.',
              '转发给 `extends()` 目标时失败。'
            ),
            shutdown: t('A shutdown handler or plugin cleanup failed.', '收尾函数或插件清理失败。')
          }
        },
        error: {
          summary: t(
            'The thrown value, often with a `LoggerErrorCode`.',
            '抛出的值，通常带有 `LoggerErrorCode` 错误码。'
          )
        }
      }
    },
    ILogFailureHook: alias(
      'Callback type of `onFailure()`: `(failure) => void`.',
      '`onFailure()` 登记的失败观察回调类型 `(failure) => void`。'
    ),
    ILogFilter: alias(
      'Filter type of `level()`: `(entry) => boolean`, `false` drops the entry.',
      '`level()` 的过滤器类型 `(entry) => boolean`，返回 `false` 丢弃条目。'
    ),
    ILogHookFn: alias(
      'Hook type: `(entry) => void | Promise<void>`.',
      '由 `hook()` 登记的钩子函数类型 `(entry) => void | Promise<void>`。'
    ),
    ISink: alias(
      'Sink type: `(entry) => void | Promise<void>`.',
      '`useSink()` 登记的输出端函数类型 `(entry) => void | Promise<void>`。'
    ),
    IFlusher: alias(
      'Callback type of `onFlush()`: `() => void | Promise<void>`.',
      '由 `onFlush()` 登记的缓冲区刷新回调类型 `() => void | Promise<void>`。'
    ),
    IShutdownHandler: alias(
      'Callback type of `onShutdown()`: `(reason) => void | Promise<void>`.',
      '由 `onShutdown()` 登记的收尾函数类型 `(reason) => void | Promise<void>`。'
    ),
    IShutdownReason: alias(
      'Reasons accepted by `shutdown()`: `signal`, `uncaughtException`, `unhandledRejection`, `manual`.',
      '调用 `shutdown()` 时可传入的关闭原因取值：`signal`、`uncaughtException`、`unhandledRejection`、`manual`。'
    ),
    IOff: alias(
      'Removal function returned by registrations; calling it twice does nothing.',
      '登记类方法返回的移除函数；重复调用没有效果。'
    ),
    IPipelineStage: alias(
      'Synchronous stage `(entry, next) => void`; skip `next` to drop the entry.',
      '同步管线阶段 `(entry, next) => void`；不调用 `next` 即丢弃条目。'
    ),
    IPaintFn: alias(
      'Painter `(tag, text) => string` from `color()`, colouring text like the given tag.',
      '`color()` 提供的染色函数 `(tag, text) => string`，按标签的颜色为文本上色。'
    ),
    IDimFn: alias(
      'Dimmer `(text) => string` from `color()`.',
      '`color()` 提供的变暗函数 `(text) => string`，用于弱化次要文本。'
    ),
    ILoggerPlugin: alias(
      'Type of a logger plugin object returned by `level()`, `http()` and custom plugin factories.',
      'logger 插件对象的类型，由 `level()`、`http()` 以及自定义插件工厂返回。'
    ),
    IStaticLoggerCtor: alias(
      'Constructor type of `Logger`; adds the methods of the given plugins to the instance type.',
      '`Logger` 的构造函数类型；会把传入插件的方法加入实例类型。'
    ),
    ILoggerColorMode: alias(
      'Union of `LoggerColorMode` values.',
      '`LoggerColorMode` 全部取值组成的联合类型。'
    ),
    ILoggerErrorCode: alias(
      'Union of `LoggerErrorCode` values.',
      '`LoggerErrorCode` 全部取值组成的联合类型。'
    ),
    ILoggerLevel: alias('Union of `LoggerLevel` values.', '`LoggerLevel` 全部取值组成的联合类型。'),
    ILoggerReasoningPhase: alias(
      'Union of `LoggerReasoningPhase` values.',
      '`LoggerReasoningPhase` 全部取值组成的联合类型。'
    ),
    ILoggerStatus: alias(
      'Union of `LoggerStatus` values.',
      '`LoggerStatus` 全部取值组成的联合类型。'
    ),
    IOutputFormat: alias(
      'Values of the `format` option of `color()`: `auto`, `pretty`, `json`.',
      '`color()` 插件 `format` 选项的取值，决定输出格式：`auto`、`pretty`、`json`。'
    ),
    ICreateBatcher: alias(
      'Type of `createBatcher(config, onBatch)` offered by `batch()`.',
      '`batch()` 通过 Feature 提供的 `createBatcher(config, onBatch)` 工厂函数的类型。'
    ),
    ILevelPluginConfig: {
      optionCases: loggerPluginOptionCases.ILevelPluginConfig!,
      summary: t(
        'Options of `level()`: minimum level, filters and output scheduling.',
        '`level()` 插件的选项：最低级别、过滤器与输出方式。'
      ),
      scenarios: [
        t(
          'Hide debug output in production while keeping warnings and errors.',
          '在生产环境隐藏调试输出，只保留警告和错误。'
        )
      ],
      example: `level({ level: 'warn', filters: [(entry) => !entry.context.includes('health')] })`,
      members: {
        level: {
          whenToUse: t(
            'Use warn for a production service and debug while diagnosing it. The ordered thresholds are debug, info, warn, error and fatal; each keeps that level and higher standard levels. Omission selects debug. Custom tags still pass through filters.',
            '生产服务可选 warn，排查问题时选 debug。门槛从低到高为 debug、info、warn、error、fatal；每个值保留本级及更高标准级别。省略时采用 debug，自定义标签仍经过过滤器。'
          ),
          example: loggerPluginOptionCases.ILevelPluginConfig![0]!.example,
          summary: t(
            'Minimum standard level; lower standard levels are dropped. Other tags bypass only the threshold and still pass through every filter. Captured at installation; change behavior with setLevel, not config.update alone.',
            '最低标准级别，更低标准级别会被丢弃；其他标签仅跳过门槛，仍经过所有过滤函数。安装时捕获此值，改变行为使用 `setLevel`，不能只提交 `config.update`。'
          ),
          default: t(
            '`debug`: all five standard levels meet the threshold.',
            '`debug`：五个标准级别均达到门槛。'
          ),
          values: { enum: 'LoggerLevel' }
        },
        filters: {
          summary: t(
            'Filters `(entry) => boolean`; an entry passes only if all return `true`.',
            '过滤函数 `(entry) => boolean`；只有全部返回 `true` 的条目才会通过。'
          ),
          default: t('`[]`: no filters.', '`[]`：没有过滤器。')
        },
        asyncOutput: {
          summary: t(
            'Schedule entries created by `info()` and the other level methods with `defer()`.',
            '让 `info()` 等级别方法产生的条目通过 `defer()` 调度输出。'
          ),
          default: t('`false`: output during the call.', '`false`：在调用中同步输出。')
        }
      }
    },
    ILevelPluginExt: {
      summary: t(
        `Describes the severity methods added when a Logger installs level(). Use them to record debug, info, warn, error and fatal entries; without the plugin these methods are absent. ${levelMessageArguments.en}`,
        `描述 Logger 安装 level() 插件后获得的分级记录方法，可按 debug、info、warn、error、fatal 五种级别记录日志。未安装此插件时，这些方法不存在。${levelMessageArguments.zh}`
      ),
      scenarios: [
        t(
          'Write levelled logs and change the level at runtime from an admin endpoint.',
          '写分级日志，并通过管理接口在运行时调整级别。'
        )
      ],
      example: `import { Logger } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'

${create}
  plugins: [level({ level: 'info' })]
})
log.info('started')
log.setLevel('debug')
const remove = log.addFilter((entry) => entry.tag !== 'debug' || entry.context.includes('db'))
remove()`,
      members: membersOf(levelMembers)
    },
    IColorPluginConfig: {
      optionCases: loggerPluginOptionCases.IColorPluginConfig!,
      summary: t(
        'Options of `color()`: colors, format, timestamp and highlighted parts.',
        '`color()` 插件的选项：颜色、格式、时间戳与染色范围。'
      ),
      scenarios: [
        t(
          'Readable colored lines in a terminal and JSON lines when stdout is collected by a container.',
          '在终端中输出带颜色的可读文本，在容器采集 stdout 时输出 JSON 行。'
        )
      ],
      example: `color({ color: 'auto', format: 'auto', timestamp: false, colorMessage: 'head' })`,
      members: {
        color: {
          whenToUse: t(
            'Use never when the output consumer cannot display ANSI sequences, or always when it can but lacks terminal detection. auto, the default, checks NO_COLOR, FORCE_COLOR, terminal status and CI. Custom colorMap functions still control their own output.',
            '输出端不能显示 ANSI 序列时选 never；能显示但不能检测终端时选 always。默认 auto 依次检查 NO_COLOR、FORCE_COLOR、终端状态和持续集成环境。自定义 colorMap 函数仍控制自己的输出。'
          ),
          example: loggerPluginOptionCases.IColorPluginConfig![0]!.example,
          summary: t('Whether ANSI colors are used.', '控制台输出是否使用 ANSI 颜色。'),
          default: t('`auto`.', '`auto`：根据环境自动决定。'),
          values: { enum: 'LoggerColorMode' }
        },
        format: {
          whenToUse: t(
            'Use json for a collector and pretty for a person reading the console. Default auto uses LOG_FORMAT when it is pretty or json; otherwise it chooses pretty in a terminal or CI and json elsewhere.',
            '日志采集器选 json，人工查看控制台选 pretty。默认 auto 会采用值为 pretty 或 json 的 LOG_FORMAT；否则在终端或持续集成环境选 pretty，其余环境选 json。'
          ),
          example: loggerPluginOptionCases.IColorPluginConfig![0]!.example,
          summary: t('Output format of each entry.', '每条日志在控制台中的输出格式。'),
          default: t('`auto`.', '`auto`：根据环境自动选择。'),
          values: {
            auto: t(
              'Uses LOG_FORMAT only when it is pretty or json; otherwise pretty in CI or a terminal, and json for other output.',
              '`LOG_FORMAT` 仅取 `pretty` 或 `json` 时生效；否则 CI 或终端使用 `pretty`，其余输出使用 `json`。'
            ),
            pretty: t(
              'One readable line: time, `[LEVEL]`, context, message and arguments.',
              '一行可读文本：时间、`[LEVEL]`、上下文、消息与参数。'
            ),
            json: t(
              'One JSON object per line, for log collectors.',
              '每行一个 JSON 对象，便于日志采集器处理。'
            )
          }
        },
        timestamp: {
          summary: t('Prefix pretty lines with the ISO time.', '在可读格式的每行前加上 ISO 时间。'),
          default: t('`true`.', '`true`：显示时间戳。')
        },
        colorMessage: {
          whenToUse: t(
            'Choose head to paint the message, tail for the last argument or an argument-free message, head-tail for both, or all for the message and primitive arguments. none, the default, paints only the tag. Objects and errors keep their native values.',
            'head 为消息上色；tail 为最后一个参数上色，没有参数时处理消息；head-tail 同时处理两者；all 处理消息和原始类型参数。默认 none 只处理标签。对象和错误保留原生值。'
          ),
          example: loggerPluginOptionCases.IColorPluginConfig![1]!.example,
          summary: t(
            'Which part of the message and arguments is colored like the tag.',
            '消息与参数中哪一部分按标签颜色上色。'
          ),
          default: t('`none`.', '`none`：消息与参数都不上色。'),
          values: {
            head: t('Color the message text.', '只为消息文本上色。'),
            tail: t(
              'Color the last argument (or the message when there are no arguments).',
              '为最后一个参数上色（没有参数时为消息上色）。'
            ),
            'head-tail': t(
              'Color the message and the last argument.',
              '为消息和最后一个参数上色。'
            ),
            all: t(
              'Color the message and every primitive argument.',
              '为消息和所有原始类型参数上色。'
            ),
            none: t('Color nothing but the tag.', '除标签外都不上色。')
          }
        },
        colorMap: {
          whenToUse: t(
            'Supply a tag-to-function map when custom audit or domain tags need distinctive output. Each function receives text and returns its painted form. Omission retains built-in colors for five standard levels; unmapped custom tags remain unchanged.',
            '自定义审计或业务标签需要不同显示方式时，提供从标签到函数的映射。每个函数接收文本，返回处理后的文本。省略时只保留五个标准级别的内置颜色，未映射的自定义标签保持原样。'
          ),
          example: loggerPluginOptionCases.IColorPluginConfig![1]!.example,
          summary: t(
            'Paint function per tag, for custom tags such as `audit`; unknown tags stay uncolored.',
            '按标签指定染色函数，用于 `audit` 等自定义标签；未映射的标签不上色。'
          ),
          default: t('Built-in colors for the five levels.', '五个级别使用内置颜色。')
        }
      }
    },
    IBatchPluginConfig: {
      optionCases: loggerPluginOptionCases.IBatchPluginConfig!,
      summary: t(
        'Options of `batch()` and of the `batch` field of `http()` and `file()`.',
        '`batch()` 以及 `http()`、`file()` 中 `batch` 字段的攒批选项。'
      ),
      scenarios: [
        t(
          'Send at most one upload request per second or per 50 entries.',
          '每秒或每 50 条日志最多发送一次上报请求。'
        )
      ],
      example: `batch({ maxSize: 50, maxWaitMs: 1000, maxPendingBatches: 100 })`,
      members: batchFields
    },
    IBatchShared: {
      summary: t(
        'What `batch()` offers to other plugins through its Feature: a batcher factory.',
        '`batch()` 通过其 Feature 提供给其它插件的能力：批处理器工厂。'
      ),
      scenarios: [
        t(
          'A custom upload plugin reuses the same batching rules as `http()`.',
          '自定义上报插件复用与 `http()` 相同的攒批规则。'
        )
      ],
      example: `const [batchHandle] = await log.use(batch())
const { createBatcher } = batchHandle.getFeature('batch') as IBatchShared
const batcher = createBatcher<ILogEntry>({ maxSize: 10 }, (entries) => send(entries))`,
      members: {
        createBatcher: {
          summary: t(
            'Creates a batcher with the given settings over the `batch()` defaults; it is flushed with the logger.',
            '在 `batch()` 默认设置基础上创建批处理器；它会随 logger 一起被刷新。'
          ),
          params: {
            config: t('Batch settings for this batcher.', '该批处理器的攒批设置。'),
            onBatch: t(
              '`(items) => void | Promise<void>` called with each batch.',
              '每个批次调用一次的 `(items) => void | Promise<void>`。'
            )
          },
          returns: t(
            'An `IBatcher` with `push()` and `flush()`.',
            '带 `push()` 与 `flush()` 的 `IBatcher`。'
          ),
          example: `const batcher = createBatcher({ maxSize: 10 }, send)`
        }
      }
    },
    IBatcher: {
      summary: t(
        'A batcher created by `createBatcher()`.',
        '由 `createBatcher()` 创建的批处理器，负责收集并成组交付。'
      ),
      scenarios: [
        t(
          'Collect entries in a custom sink and send them in groups.',
          '在自定义 sink 中收集条目并成组发送。'
        )
      ],
      example: `core.useSink((entry) => batcher.push(entry))
await batcher.flush()`,
      members: {
        push: {
          summary: t(
            'Adds one item; a full batch is handed to `onBatch`.',
            '加入一个元素；批次满时交给 `onBatch`。'
          ),
          params: {
            item: t(
              'Item to collect, usually an `ILogEntry`.',
              '要收集的元素，通常是 `ILogEntry`。'
            )
          },
          returns: t(
            'Nothing; overflow is reported as `BATCH_OVERFLOW`.',
            '无返回值；溢出以 `BATCH_OVERFLOW` 上报。'
          ),
          example: `batcher.push(entry)`
        },
        flush: {
          summary: t(
            'Sends the remaining items and waits for running batches.',
            '发送剩余元素，并等待正在执行的批次。'
          ),
          returns: t(
            'Resolves when drained or the `flushTimeoutMs` budget ran out.',
            '排空完成或 `flushTimeoutMs` 预算耗尽后 resolve。'
          ),
          example: `await batcher.flush()`
        }
      }
    },
    IHttpPluginConfig: {
      optionCases: loggerPluginOptionCases.IHttpPluginConfig!,
      summary: t(
        'Options of `http()`: endpoint, auth, retries, timeout and batching.',
        '`http()` 插件的选项：目标地址、认证、重试、超时与攒批。'
      ),
      scenarios: [
        t(
          'Upload logs to a collector with a bearer token and backoff on 429.',
          '使用 Bearer 令牌把日志上报到采集服务，并在 429 时退避。'
        )
      ],
      example: `http({ url: 'https://logs.example/v1/entries', authToken: token, retries: 3, batch: { maxSize: 100 } })`,
      members: {
        url: {
          summary: t(
            'Endpoint that receives the `POST { entries }` JSON requests.',
            '接收 `POST { entries }` JSON 请求的上报服务地址。'
          )
        },
        authToken: {
          summary: t(
            'Token issued by the log collector, sent as `Authorization: Bearer <token>`.',
            '由日志采集服务签发的令牌，以 `Authorization: Bearer <token>` 请求头发送。'
          ),
          default: t('Not set: no authorization header.', '不设置：不发送认证头。')
        },
        headers: {
          summary: t(
            'Extra request headers added to every upload request.',
            '附加到每个上报请求上的额外请求头。'
          ),
          default: t('`{}`.', '`{}`：没有额外请求头。')
        },
        retries: {
          summary: t(
            'Extra attempts after network errors, 429 and 5xx; other 4xx fail immediately. Waiting uses Retry-After or 200 ms × 2^attempt. Omitted config remains absent; the send path consumes retries ?? 2.',
            '网络错误、429 与 5xx 后的额外重试次数，其它客户端错误立即失败；等待采用重试响应头或指数退避。省略配置时快照保持缺省，发送路径用 `retries ?? 2` 取消费默认值。'
          ),
          default: t('`2`.', '默认值为 `2` 次。')
        },
        requestTimeoutMs: {
          summary: t(
            'Abort timer for one request when an AbortController is available. This is not an independent Promise race: fetch that ignores its signal may remain pending, and no controller means no request timer. An abort rejection is handled like a network error.',
            '有可用 AbortController 时为单次请求安排中止计时器；这不是独立的 Promise 竞速，`fetch` 忽略信号时仍可能不结算，没有控制器就不建立请求计时器；中止导致的拒绝按网络错误处理。'
          ),
          default: t('`10000`.', '默认值为 `10000` 毫秒。')
        },
        batch: {
          summary: t(
            'Upload queue settings. An earlier or same-batch Feature provider supplies shared batching regardless of input order. Without a provider, this option still creates a bounded local queue forced to maxSize:1 and asyncOutput:false; other queue bounds apply.',
            '本次上传队列设置；已安装或同批的功能提供者按依赖绑定，不受输入顺序限制。没有提供者时此选项仍创建本地有界队列，强制单条大小及同步输出，其余队列边界仍适用。'
          ),
          default: t(
            'With a shared batch provider: its defaults. Without one: direct per-entry delivery.',
            '有共享批处理提供者时使用其默认设置；没有时逐条直送。'
          )
        },
        ...nested('batch', batchFields, [
          'maxSize',
          'maxWaitMs',
          'maxConcurrentBatches',
          'maxPendingBatches',
          'asyncOutput'
        ]),
        maxRetryAfterMs: {
          summary: t(
            'Upper limit for a `Retry-After` wait; larger values are clamped.',
            '`Retry-After` 等待时间的上限；更大的值会被截断。'
          ),
          default: t('`30000`.', '默认值为 `30000` 毫秒。')
        }
      }
    },
    IProcessPluginConfig: {
      optionCases: loggerPluginOptionCases.IProcessPluginConfig!,
      summary: t(
        'Options of `process()`: crash capture, shutdown timeout and exit interception.',
        '`process()` 插件的选项：崩溃捕获、关闭超时与退出拦截。'
      ),
      scenarios: [
        t(
          'A CLI or server that must not lose logs on Ctrl+C, `SIGTERM` or a crash.',
          '在 Ctrl+C、`SIGTERM` 或崩溃时都不能丢日志的命令行工具或服务。'
        )
      ],
      example: `process({ captureCrashes: true, shutdownTimeoutMs: 5000 })`,
      members: {
        captureCrashes: {
          summary: t(
            'Controls only fatal logging for uncaughtException/unhandledRejection. Both crash events still trigger shutdown and exit(1) when false; beforeExit only flushes.',
            '仅控制未捕获异常与拒绝是否记录为致命日志；关闭此开关时两类崩溃仍触发关闭及退出码一，`beforeExit` 仅刷新。'
          ),
          default: t('`true`.', '`true`：捕获崩溃。')
        },
        shutdownTimeoutMs: {
          summary: t(
            'Longest drain on signal, crash or exit before the process exits anyway.',
            '收到信号、崩溃或退出时最多等待排空的时间，超时后仍会退出。'
          ),
          default: t('`3000`.', '默认值为 `3000` 毫秒。')
        },
        interceptProcessExit: {
          summary: t(
            'Make `process.exit()` flush first; this turns an immediate exit into an asynchronous one.',
            '让 `process.exit()` 先刷新日志；这会把立即退出变为异步退出。'
          ),
          default: t('`false`.', '`false`：不拦截进程的退出调用。')
        }
      }
    },
    IReasoningPluginConfig: {
      optionCases: loggerPluginOptionCases.IReasoningPluginConfig!,
      summary: t('Options of `reasoning()`.', '`reasoning()` 插件的选项：段落标签与输出方式。'),
      scenarios: [
        t(
          'Show model thinking and answers live in a terminal while storing the full text.',
          '在终端实时显示模型的思考与回答，同时保存完整文本。'
        )
      ],
      example: `reasoning({ labels: { thinking: 'Thinking', response: 'Answer' } })`,
      members: {
        labels: {
          summary: t('Labels written at the start of a section.', '每个段落开始时写出的标签。'),
          default: t(
            '`{ thinking: "Thinking..." }` and no response label.',
            '`{ thinking: "Thinking..." }`，回答段落没有标签。'
          )
        },
        'labels.thinking': {
          summary: t('Label of thinking sections.', '思考段落开始时写出的标签。'),
          default: t('`Thinking...`.', '默认标签为 `Thinking...`。')
        },
        'labels.response': {
          summary: t('Label of response sections.', '回答段落开始时写出的标签。'),
          default: t('Not set: no label.', '不设置：不写标签。')
        },
        asyncOutput: {
          summary: t(
            'Schedule chunks and the final entries with `defer()`.',
            '通过 `defer()` 调度片段输出与最终条目。'
          ),
          default: t('`false`.', '`false`：在调用中同步输出。')
        }
      }
    },
    IReasoningPluginExt: {
      summary: t(
        'Methods a logger gains from `reasoning()`.',
        'logger 安装 `reasoning()` 后获得的流式输出方法。'
      ),
      scenarios: [
        t(
          'Stream a chat completion with separate thinking and answer sections.',
          '以分开的思考段落与回答段落流式输出一次对话补全。'
        )
      ],
      example: `log.startThinking()
for await (const chunk of reasoningStream) log.thinking(chunk)
log.startResponse()
for await (const chunk of answerStream) log.response(chunk)
log.endResponse()`,
      members: membersOf(reasoningMembers)
    },
    IUuidPluginConfig: {
      optionCases: loggerPluginOptionCases.IUuidPluginConfig!,
      summary: t(
        'Options of `uuid()`: whether the UUID is shown in output.',
        '`uuid()` 插件的选项：是否在输出中显示 UUID。'
      ),
      scenarios: [
        t(
          'Search one entry across console, upload and file outputs by its id.',
          '用 id 在控制台、上报与文件输出中查找同一条日志。'
        )
      ],
      example: `uuid({ display: true })`,
      members: {
        display: {
          summary: t(
            'Show the UUID in `color()` output (pretty prefix or JSON `uuid` field). It is always stored in `entry.data.uuid`.',
            '在 `color()` 输出中显示 UUID（可读格式前缀或 JSON 的 `uuid` 字段）。它总会保存在 `entry.data.uuid` 中。'
          ),
          default: t('`false`.', '`false`：默认不显示。')
        }
      }
    },
    IFilePluginConfig: {
      optionCases: loggerPluginOptionCases.IFilePluginConfig!,
      summary: t(
        'Options of `file()`: file path, batching and rotation.',
        '`file()` 插件的选项：文件路径、攒批与轮转。'
      ),
      scenarios: [
        t(
          'Keep a local JSON-lines log that tools such as `jq` can read.',
          '保留一份本地 JSON 行日志，供 `jq` 等工具读取。'
        )
      ],
      example: `file({ path: 'logs/app.jsonl', batch: { maxSize: 100 }, rotate: { maxBytes: 1_000_000 } })`,
      members: {
        path: {
          summary: t(
            'File the JSON lines are appended to; must not be empty.',
            'JSON 行追加写入的文件路径，不能为空。'
          )
        },
        batch: {
          summary: t(
            'Batch settings; with `batch()` installed they are applied over its defaults.',
            '攒批设置；安装了 `batch()` 时在其默认设置基础上生效。'
          ),
          default: t(
            'Not set: the batch defaults (20 entries or 2 seconds).',
            '不设置：使用默认攒批设置（20 条或 2 秒）。'
          )
        },
        ...nested('batch', batchFields, [
          'maxSize',
          'maxWaitMs',
          'maxConcurrentBatches',
          'maxPendingBatches',
          'flushTimeoutMs',
          'asyncOutput'
        ]),
        rotate: {
          summary: t(
            'After appending a batch that reached a limit, call `runtimeManager.fs.rotate(path)`. The Node default `fs` has no `rotate`, so rotation needs an injected `fs`.',
            '追加的批次达到上限后调用 `runtimeManager.fs.rotate(path)`。Node 默认的 `fs` 没有 `rotate`，因此轮转需要注入 `fs`。'
          ),
          default: t('Not set: never rotate.', '不设置：从不轮转。')
        },
        'rotate.maxBytes': {
          summary: t(
            'Rotate when one batch is at least this many UTF-8 bytes; a positive safe integer.',
            '单个批次达到该 UTF-8 字节数时轮转；必须是正的安全整数。'
          ),
          default: t('Not set: no byte limit.', '不设置：没有字节数上限。')
        },
        'rotate.maxEntries': {
          summary: t(
            'Rotate when one batch holds at least this many entries; a positive safe integer.',
            '单个批次达到该条目数时轮转；必须是正的安全整数。'
          ),
          default: t('Not set: no entry limit.', '不设置：没有条目数上限。')
        }
      }
    }
  },
  enums: {
    LogRecordState: {
      summary: t('Pending advances only to a terminal state.', 'pending 只前进至终态。'),
      values: {
        pending: t('Committed intent remains active.', '已提交意图仍活跃。'),
        done: t('Completed; cannot reopen.', '已完成，不能重开。'),
        aborted: t('Aborted; cannot reopen.', '已中止，不能重开。')
      }
    },
    LogStage: {
      summary: t('Fixed observer-only durable statistics.', '固定名称的持久日志统计，仅供观察。'),
      values: {
        beforeLogOpen: t(
          'beforeLogOpen statistics; failures only report.',
          'beforeLogOpen 统计；失败只报告。'
        ),
        afterLogOpen: t(
          'afterLogOpen statistics; failures only report.',
          'afterLogOpen 统计；失败只报告。'
        ),
        onLogOpenError: t(
          'onLogOpenError statistics; failures only report.',
          'onLogOpenError 统计；失败只报告。'
        ),
        beforeLogOperation: t(
          'beforeLogOperation statistics; failures only report.',
          'beforeLogOperation 统计；失败只报告。'
        ),
        afterLogOperation: t(
          'afterLogOperation statistics; failures only report.',
          'afterLogOperation 统计；失败只报告。'
        ),
        onLogOperationError: t(
          'onLogOperationError statistics; failures only report.',
          'onLogOperationError 统计；失败只报告。'
        ),
        beforeLogClose: t(
          'beforeLogClose statistics; failures only report.',
          'beforeLogClose 统计；失败只报告。'
        ),
        afterLogClose: t(
          'afterLogClose statistics; failures only report.',
          'afterLogClose 统计；失败只报告。'
        ),
        onLogCloseError: t(
          'onLogCloseError statistics; failures only report.',
          'onLogCloseError 统计；失败只报告。'
        ),
        onAppend: t('onAppend statistics; failures only report.', 'onAppend 统计；失败只报告。'),
        onWalPending: t(
          'onWalPending statistics; failures only report.',
          'onWalPending 统计；失败只报告。'
        )
      }
    },
    LoggerLevel: {
      summary: t(
        'Level names of `level()`, lowest first.',
        '`level()` 插件使用的级别名称，从低到高排列。'
      ),
      values: {
        debug: t(
          '`debug`: diagnostic details, usually hidden in production.',
          '`debug`：诊断细节，生产环境通常隐藏。'
        ),
        info: t('`info`: normal operation events.', '`info`：正常运行过程中的事件。'),
        warn: t('`warn`: unexpected but handled situations.', '`warn`：意外但已经处理的情况。'),
        error: t('`error`: an operation failed.', '`error`：某个操作执行失败了，需要处理。'),
        fatal: t(
          '`fatal`: the program cannot continue; `process()` logs crashes with it.',
          '`fatal`：程序无法继续；`process()` 用它记录崩溃。'
        )
      }
    },
    LoggerColorMode: {
      summary: t(
        'Values of the `color` option of `color()`.',
        '`color()` 插件 `color` 选项的取值，决定是否输出颜色。'
      ),
      values: {
        auto: t(
          '`auto`: off with `NO_COLOR`, on with `FORCE_COLOR`, a terminal or `CI`, otherwise off.',
          '`auto`：有 `NO_COLOR` 时关闭；有 `FORCE_COLOR`、终端或 `CI` 时开启；否则关闭。'
        ),
        always: t(
          '`always`: always write ANSI colors.',
          '`always`：无论环境如何都输出 ANSI 颜色。'
        ),
        never: t('`never`: never write ANSI colors.', '`never`：无论环境如何都不输出 ANSI 颜色。')
      }
    },
    LoggerReasoningPhase: {
      summary: t('Phases of the `reasoning()` stream.', '`reasoning()` 流式输出当前所处的阶段。'),
      values: {
        idle: t('`idle`: no section is open.', '`idle`：当前没有任何打开的段落。'),
        thinking: t(
          '`thinking`: a thinking section is being written.',
          '`thinking`：正在写出思考段落的内容。'
        ),
        responding: t(
          '`responding`: an answer section is being written.',
          '`responding`：正在写出回答段落的内容。'
        )
      }
    },
    LoggerStatus: {
      summary: t('Lifecycle phases of a logger.', 'logger 实例经历的生命周期阶段。'),
      values: {
        active: t(
          '`active`: accepting and writing logs.',
          '`active`：正常接收日志并输出到各个 sink。'
        ),
        flushing: t(
          '`flushing`: a `flush()` is running; logs are still accepted.',
          '`flushing`：`flush()` 正在进行，此时仍然接收新日志。'
        ),
        shuttingDown: t(
          '`shutting-down`: `shutdown()` runs handlers, flushes and uninstalls.',
          '`shutting-down`：`shutdown()` 正在执行收尾、刷新与卸载。'
        ),
        closed: t(
          '`closed`: terminal; logs are ignored, create a new logger.',
          '`closed`：终态；日志被忽略，需要创建新的 logger。'
        )
      }
    },
    LoggerErrorCode: {
      summary: t(
        'Stable error codes of `@migaia/logger`.',
        '`@migaia/logger` 的稳定错误码及其触发场景。'
      ),
      values: {
        invalidOption: t(
          '`INVALID_OPTION`: an option is unreadable or invalid; fix it (`cause` keeps the getter error).',
          '`INVALID_OPTION`：选项不可读或不合法；需要修正（`cause` 保留读取错误）。'
        ),
        pipelineEntryInvalid: t(
          '`PIPELINE_ENTRY_INVALID`: a stage replaced the entry without a valid `Date`; the original entry is delivered.',
          '`PIPELINE_ENTRY_INVALID`：管线阶段替换的条目没有有效的 `Date`；改为交付原条目。'
        ),
        runtimeShuttingDown: t(
          '`RUNTIME_SHUTTING_DOWN`: `process()` or a logger was installed while the process is shutting down.',
          '`RUNTIME_SHUTTING_DOWN`：进程正在关闭时仍安装了 `process()` 或 logger。'
        ),
        pluginConfigConflict: t(
          '`PLUGIN_CONFIG_CONFLICT`: `process()` installed again with a different configuration.',
          '`PLUGIN_CONFIG_CONFLICT`：`process()` 以不同的配置再次被安装。'
        ),
        transportUnavailable: t(
          '`TRANSPORT_UNAVAILABLE`: `http()` found no `fetch`; inject one in the runtime manager.',
          '`TRANSPORT_UNAVAILABLE`：`http()` 找不到 `fetch`；需要在运行时管理器中注入。'
        ),
        serializeFailed: t(
          '`SERIALIZE_FAILED`: entries could not be turned into JSON; see `cause`.',
          '`SERIALIZE_FAILED`：日志条目无法转换为 JSON；原因见 `cause`。'
        ),
        deliveryFailed: t(
          '`DELIVERY_FAILED`: upload got a failure response or ran out of retries, or a file write failed.',
          '`DELIVERY_FAILED`：上报收到失败响应或重试耗尽，或文件写入失败。'
        ),
        invalidRetryCount: t(
          '`INVALID_RETRY_COUNT`: `retries` is not a finite non-negative integer.',
          '`INVALID_RETRY_COUNT`：重试次数 `retries` 不是有限的非负整数。'
        ),
        lifecycleDeadline: t(
          '`LIFECYCLE_DEADLINE`: flush or shutdown reached its deadline with work left; delivery is not guaranteed.',
          '`LIFECYCLE_DEADLINE`：刷新或关闭到达截止时间仍有未完成工作；不能保证全部送达。'
        ),
        processInstallRollbackFailed: t(
          '`PROCESS_INSTALL_ROLLBACK_FAILED`: `process()` install failed and removing its listeners failed too; read `errors`.',
          '`PROCESS_INSTALL_ROLLBACK_FAILED`：`process()` 安装失败，移除监听也失败；查看 `errors`。'
        ),
        pluginUninstallCleanupFailed: t(
          '`PLUGIN_UNINSTALL_CLEANUP_FAILED`: some cleanup of an uninstalled plugin failed; read `cause` / `errors`.',
          '`PLUGIN_UNINSTALL_CLEANUP_FAILED`：插件卸载时部分清理失败；查看 `cause` / `errors`。'
        ),
        pluginShutdownCleanupFailed: t(
          '`PLUGIN_SHUTDOWN_CLEANUP_FAILED`: cleanup during shutdown or exit failed; the primary error is kept.',
          '`PLUGIN_SHUTDOWN_CLEANUP_FAILED`：关闭或退出时的清理失败；主要错误仍被保留。'
        ),
        hookFailed: t(
          '`HOOK_FAILED`: an `onFailure` callback itself threw; reported to the console only, never thrown.',
          '`HOOK_FAILED`：`onFailure` 回调本身抛错；只报告到控制台，不会抛出。'
        ),
        extendsSelf: t(
          '`EXTENDS_SELF`: a logger was forwarded to itself.',
          '`EXTENDS_SELF`：logger 被设置为转发给它自己。'
        ),
        extendsCycle: t(
          '`EXTENDS_CYCLE`: a new `extends()` edge would form a cycle.',
          '`EXTENDS_CYCLE`：新增的 `extends()` 转发关系会形成环路。'
        ),
        batchOverflow: t(
          '`BATCH_OVERFLOW`: the pending batch limit was reached and the oldest queued batch was dropped.',
          '`BATCH_OVERFLOW`：达到排队批次上限，最早排队的批次被丢弃。'
        ),
        logPayloadInvalid: t(
          'LOG_PAYLOAD_INVALID: payload is outside plain JSON data',
          'LOG_PAYLOAD_INVALID：持久日志边界错误；修正输入或检查原始 cause。'
        ),
        logStoreLocked: t(
          'LOG_STORE_LOCKED: another SQLite connection owns the file lock',
          'LOG_STORE_LOCKED：持久日志边界错误；修正输入或检查原始 cause。'
        ),
        logStoreInUse: t(
          'LOG_STORE_IN_USE: another installed plugin borrows the object',
          'LOG_STORE_IN_USE：持久日志边界错误；修正输入或检查原始 cause。'
        ),
        logStoreUnavailable: t(
          'LOG_STORE_UNAVAILABLE: the runtime builtin SQLite is missing',
          'LOG_STORE_UNAVAILABLE：持久日志边界错误；修正输入或检查原始 cause。'
        ),
        logStoreIoFailed: t(
          'LOG_STORE_IO_FAILED: storage or cleanup failed; original cause remains reachable',
          'LOG_STORE_IO_FAILED：持久日志边界错误；修正输入或检查原始 cause。'
        ),
        logStoreCorrupt: t(
          'LOG_STORE_CORRUPT: committed metadata or owned undo data is inconsistent',
          'LOG_STORE_CORRUPT：持久日志边界错误；修正输入或检查原始 cause。'
        ),
        logSequenceExhausted: t(
          'LOG_SEQUENCE_EXHAUSTED: a sequence cannot be represented safely',
          'LOG_SEQUENCE_EXHAUSTED：持久日志边界错误；修正输入或检查原始 cause。'
        ),
        logSubscriptionTruncated: t(
          'LOG_SUBSCRIPTION_TRUNCATED: prefix truncation passed the subscription cursor',
          'LOG_SUBSCRIPTION_TRUNCATED：持久日志边界错误；修正输入或检查原始 cause。'
        ),
        walRecordInvalid: t(
          'WAL_RECORD_INVALID: a state target is missing or terminal',
          'WAL_RECORD_INVALID：持久日志边界错误；修正输入或检查原始 cause。'
        ),
        undoRecordExists: t(
          'UNDO_RECORD_EXISTS: an active undo transaction id already exists',
          'UNDO_RECORD_EXISTS：持久日志边界错误；修正输入或检查原始 cause。'
        ),
        fileSinkUnavailable: t(
          '`FILE_SINK_UNAVAILABLE`: `file()` has no injected `fs` and no Node default.',
          '`FILE_SINK_UNAVAILABLE`：`file()` 既没有注入的 `fs`，也没有 Node 默认能力。'
        )
      }
    }
  },
  enhancers: {
    binlog: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        'Ordered history/live log; it borrows a store and never disposes it.',
        '有序历史与后续日志；只借用 store，不负责关闭。'
      ),
      install:
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}",
      grants: grantsOf('log.binlog', durableBinlogMembers),
      scenarios: [
        t(
          'Keep durable records with caller-owned resources.',
          '\u4fdd\u7559\u6301\u4e45\u8bb0\u5f55\uff0c\u8d44\u6e90\u5f52\u8c03\u7528\u65b9\u6240\u6709\u3002'
        )
      ],
      example:
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}"
    },
    wal: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        'Durable pending intent with forward-only terminal states.',
        '持久 pending 意图与只前进的终态。'
      ),
      install:
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}",
      grants: grantsOf('log.wal', durableWalMembers),
      scenarios: [
        t(
          'Keep durable records with caller-owned resources.',
          '\u4fdd\u7559\u6301\u4e45\u8bb0\u5f55\uff0c\u8d44\u6e90\u5f52\u8c03\u7528\u65b9\u6240\u6709\u3002'
        )
      ],
      example:
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}"
    },
    undoLog: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        'Active undo image records; the caller owns business rollback.',
        '活跃 undo 镜像记录；业务回滚归调用方。'
      ),
      install:
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}",
      grants: grantsOf('log.undo', durableUndoMembers),
      scenarios: [
        t(
          'Keep durable records with caller-owned resources.',
          '\u4fdd\u7559\u6301\u4e45\u8bb0\u5f55\uff0c\u8d44\u6e90\u5f52\u8c03\u7528\u65b9\u6240\u6709\u3002'
        )
      ],
      example:
        "import { Logger } from '@migaia/logger'\nimport { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'\n\nawait using events = memoryLogStore()\nawait using intents = memoryLogStore()\nawait using images = memoryLogStore()\nconst log = new Logger({\n  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },\n  plugins: [binlog({ store: events }), wal({ store: intents }), undoLog({ store: images })]\n})\ntry {\n  await Promise.all([log.binlog.ready(), log.wal.ready(), log.undo.ready()])\n  const seq = await log.binlog.append('order.created', { id: 'o1' })\n  const off = log.binlog.subscribe(seq, record => console.log(record.seq))\n  const intent = await log.wal.begin('save-order', { id: 'o1' })\n  await log.undo.record('tx1', [{ target: 'o1', before: null, after: { total: 120 } }])\n  await log.wal.complete(intent)\n  console.log(await log.undo.get('tx1'))\n  await log.undo.forget('tx1')\n  off()\n} finally {\n  try { await log.shutdown('manual') }\n  finally { await Promise.all([log.binlog.whenIdle(), log.wal.whenIdle(), log.undo.whenIdle()]) }\n}"
    },
    level: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        `Installs severity-based logging. debug(), info(), warn(), error() and fatal() create entries with the corresponding level. setLevel() changes the minimum level; addFilter() and removeFilter() register and remove output filters. Without this plugin, use the core log() method. ${levelMessageArguments.en}`,
        `安装按严重程度分级的日志功能。debug()、info()、warn()、error() 和 fatal() 创建对应级别的日志。setLevel() 修改最低级别；addFilter() 与 removeFilter() 登记和移除输出过滤函数。未安装此插件时，使用核心 log() 方法记录。${levelMessageArguments.zh}`
      ),
      install: `import { Logger } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'

${create}
  plugins: [level({ level: 'info' })]
})`,
      grants: grantsOf('log', levelMembers),
      scenarios: [
        t('Level-based logging with runtime level changes.', '分级记录日志，并在运行时调整级别。')
      ],
      example: `import { Logger } from '@migaia/logger'
import { level, color } from '@migaia/logger/plugins'

${create}
  plugins: [level({ level: 'info' }), color()]
})
log.debug('hidden')
log.info('shown')
log.setLevel('debug')
await log.shutdown('manual')`
    },
    color: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        'After installation every entry is printed to the console (pretty or JSON, colored or not). Entries with `data.silent === true` are skipped. No methods are added; the `color` Feature offers `paint` and `dim`.',
        '安装后每条日志都会输出到控制台（可读或 JSON 格式，带或不带颜色）。`data.silent === true` 的条目会被跳过。不增加方法；`color` Feature 提供 `paint` 与 `dim`。'
      ),
      install: `import { Logger } from '@migaia/logger'
import { color } from '@migaia/logger/plugins'

${create}
  plugins: [color()]
})`,
      grants: [],
      behaviors: [
        t(
          'Adds a console sink; `error` / `fatal` go to `console.error`, `warn` to `console.warn`.',
          '增加一个控制台 sink；`error` / `fatal` 写到 `console.error`，`warn` 写到 `console.warn`。'
        ),
        t(
          'Lets `reasoning()` color its labels and dim thinking text.',
          '让 `reasoning()` 可以为标签上色、把思考文本变暗。'
        )
      ],
      scenarios: [
        t(
          'Human-readable development output and JSON lines in containers.',
          '开发时输出可读文本，在容器中输出 JSON 行。'
        )
      ],
      example: `import { Logger } from '@migaia/logger'
import { color } from '@migaia/logger/plugins'

${create}
  plugins: [color({ format: 'json' })]
})
log.log('info', 'ready')
await log.flush()`
    },
    batch: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        'After installation `http()` and `file()` installed later send entries in batches; it adds no logger methods. Its `batch` Feature offers `createBatcher()` to custom plugins.',
        '安装后，之后安装的 `http()` 与 `file()` 会按批发送日志；它不增加 logger 方法。它的 `batch` Feature 向自定义插件提供 `createBatcher()`。'
      ),
      install: `import { Logger } from '@migaia/logger'
import { batch, http } from '@migaia/logger/plugins'

${create}
  plugins: [batch({ maxSize: 50 }), http({ url: endpoint })]
})`,
      grants: [],
      behaviors: [
        t(
          'Batchers created through it are drained by `log.flush()` and on shutdown.',
          '通过它创建的批处理器会在 `log.flush()` 与关闭时被排空。'
        ),
        t(
          'A full queue drops the oldest batch and reports `BATCH_OVERFLOW` to `onFailure()`.',
          '队列满时丢弃最早的批次，并向 `onFailure()` 上报 `BATCH_OVERFLOW`。'
        )
      ],
      scenarios: [
        t(
          'Reduce upload requests from one per entry to one per batch.',
          '把上报请求从每条一个减少为每批一个。'
        )
      ],
      example: `import { Logger } from '@migaia/logger'
import { batch, http } from '@migaia/logger/plugins'

${create}
  plugins: [batch({ maxSize: 50, maxWaitMs: 1000 }), http({ url: endpoint })]
})
log.log('info', 'queued')
await log.flush()`
    },
    http: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        'Uploads JSON entries to url. Feature dependency sorting makes same-batch provider order irrelevant; a later provider installation does not rebind HTTP. No methods are added. Installation receipt confirms registration, not remote delivery; failures go to onFailure().',
        '安装后向地址上传结构化条目。同批提供者按功能依赖排序，跨调用迟到安装不会重绑。无需增加方法；安装回执只确认登记，不等于远端送达，失败交给 `onFailure()`。'
      ),
      install: `import { Logger } from '@migaia/logger'
import { batch, http } from '@migaia/logger/plugins'

${create}
  plugins: [batch(), http({ url: 'https://logs.example/v1/entries' })]
})`,
      grants: [],
      behaviors: [
        t(
          'Retries network errors, 429 and 5xx; honors `Retry-After` up to `maxRetryAfterMs`.',
          '对网络错误、429 与 5xx 重试；遵守 `Retry-After`，最长 `maxRetryAfterMs`。'
        ),
        t(
          'shutdown runs final-log handlers and drains before HTTP plugin disposal aborts remaining requests. The shared shutdown budget can expire; neither a plugin receipt nor cleanup completion guarantees delivery. Failures reach onFailure().',
          '`shutdown()` 先执行最终日志回调并排空，再在上传插件释放时中止剩余请求；共享预算可能耗尽，插件回执与清理完成均不保证远端送达，失败交给 `onFailure()`。'
        )
      ],
      scenarios: [t('Ship production logs to a log platform.', '把生产日志上报到日志平台。')],
      example: `import { Logger } from '@migaia/logger'
import { level, batch, http } from '@migaia/logger/plugins'

${create}
  plugins: [level({ level: 'info' }), batch(), http({ url: endpoint, authToken: token })]
})
log.onFailure(({ source, error }) => console.error(source, error))
log.info('order created')
await log.shutdown('manual')`
    },
    process: {
      kind: 'adapter',
      target: 'Logger',
      summary: t(
        'Connects process events to Logger cleanup without adding logger methods. SIGINT and SIGTERM start shutdown and wait up to shutdownTimeoutMs before requesting exit. Uncaught exceptions and unhandled Promise rejections use exit code 1 even when captureCrashes is false; that option only controls whether a fatal entry is logged first. beforeExit, emitted when the event loop is about to become idle, flushes accepted logs without starting shutdown.',
        '把进程事件接入 Logger 清理流程，不增加日志方法。收到 SIGINT 或 SIGTERM 时开始关闭，最多等待 shutdownTimeoutMs 后请求退出。未捕获异常和未处理的 Promise 拒绝始终使用退出码 1，即使 captureCrashes 为 false 也一样；该选项只决定是否先记录 fatal 级别日志。事件循环即将空闲时触发的 beforeExit 只刷新已接收日志，不开始关闭。'
      ),
      install: `import { Logger } from '@migaia/logger'
import { process } from '@migaia/logger/plugins'

${create}
  plugins: [process()]
})`,
      grants: [],
      behaviors: [
        t(
          'Listeners are registered once per process and shared by all loggers using `process()`; all must use the same configuration.',
          '监听在每个进程中只注册一次，由所有使用 `process()` 的 logger 共享；它们必须使用相同的配置。'
        ),
        t(
          'Without a `process` global the plugin does nothing.',
          '没有 `process` 全局对象时插件什么也不做。'
        )
      ],
      scenarios: [
        t(
          'Do not lose the last logs of a server stopped by its orchestrator.',
          '服务被编排系统停止时不丢失最后的日志。'
        )
      ],
      example: `import { Logger } from '@migaia/logger'
import { level, batch, http, process } from '@migaia/logger/plugins'

${create}
  plugins: [level(), batch(), http({ url: endpoint }), process({ shutdownTimeoutMs: 5000 })]
})`
    },
    reasoning: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        'After installation the logger has `startThinking()`, `thinking()`, `endThinking()`, `startResponse()`, `response()` and `endResponse()` for streaming model output.',
        '安装后 logger 拥有 `startThinking()`、`thinking()`、`endThinking()`、`startResponse()`、`response()`、`endResponse()`，用于边生成边显示模型的思考与回答内容。'
      ),
      install: `import { Logger } from '@migaia/logger'
import { color, reasoning } from '@migaia/logger/plugins'

${create}
  plugins: [color(), reasoning()]
})`,
      grants: grantsOf('log', reasoningMembers),
      behaviors: [
        t(
          'Each finished section is logged once as a silent entry, so uploads keep the full text without repeating it on the console.',
          '每个结束的段落会记录为一条静默条目，上报时保留完整文本，控制台不会重复显示。'
        )
      ],
      scenarios: [
        t(
          'Show a chat model thinking and answer live in a CLI.',
          '在命令行中实时显示对话模型的思考与回答。'
        )
      ],
      example: `import { Logger } from '@migaia/logger'
import { color, reasoning } from '@migaia/logger/plugins'

${create}
  plugins: [color(), reasoning({ labels: { response: 'Answer' } })]
})
log.startThinking()
log.thinking('looking up the order')
log.endThinking()
log.response('Your order ships today.')
log.endResponse()`
    },
    uuid: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        'After installation every entry gets `data.uuid` (from `runtimeManager.randomUUID()`) and `data.uuidDisplay`. No methods are added.',
        '安装后每条日志都会带上 `data.uuid`（来自 `runtimeManager.randomUUID()`）与 `data.uuidDisplay`。该插件不增加任何方法。'
      ),
      install: `import { Logger } from '@migaia/logger'
import { uuid } from '@migaia/logger/plugins'

${create}
  plugins: [uuid()]
})`,
      grants: [],
      behaviors: [
        t(
          'With `display: true`, `color()` shows the UUID in each line.',
          '设置 `display: true` 时，`color()` 会在每行中显示该 UUID。'
        )
      ],
      scenarios: [
        t(
          'Correlate one entry across console, upload and file outputs.',
          '在控制台、上报与文件输出之间关联同一条日志。'
        )
      ],
      example: `import { Logger } from '@migaia/logger'
import { color, uuid } from '@migaia/logger/plugins'

${create}
  plugins: [uuid({ display: true }), color()]
})
log.log('info', 'ready')`
    },
    file: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        'After installation every entry is appended to `path` as one JSON line, batch by batch, through `runtimeManager.fs` or the Node default. No methods are added; write failures reach `onFailure()` as `DELIVERY_FAILED`.',
        '安装后每条日志都会按批以一行 JSON 追加到 `path`，写入方式为 `runtimeManager.fs` 或 Node 默认能力。不增加方法；写入失败以 `DELIVERY_FAILED` 交给 `onFailure()`。'
      ),
      install: `import { Logger } from '@migaia/logger'
import { file } from '@migaia/logger/plugins/file'

${create}
  plugins: [file({ path: 'logs/app.jsonl' })]
})`,
      grants: [],
      behaviors: [
        t(
          'Installing without any `fs` capability fails; the install error carries `FILE_SINK_UNAVAILABLE` on `cause`.',
          '没有任何 `fs` 能力时安装失败；安装错误的 `cause` 上带有 `FILE_SINK_UNAVAILABLE`。'
        ),
        t(
          'Remaining entries are written on `flush()` and when the logger shuts down.',
          '剩余条目会在 `flush()` 以及 logger 关闭时写出。'
        )
      ],
      scenarios: [
        t(
          'Keep local JSON-lines logs on a server or desktop app.',
          '在服务器或桌面应用中保留本地 JSON 行日志。'
        )
      ],
      example: `import { Logger } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'
import { file } from '@migaia/logger/plugins/file'

${create}
  plugins: [level({ level: 'info' }), file({ path: 'logs/app.jsonl', batch: { maxSize: 100 } })]
})
log.info('job finished')
await log.shutdown('manual')`
    }
  }
}
