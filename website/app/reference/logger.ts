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
  IText,
  ITypeDoc
} from './contract.js'

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
      'Context path such as `["api", "users"]`.',
      '条目所属的上下文路径，例如 `["api", "users"]`。'
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
        'Entry tag such as `info` or `audit`; `level()` filters standard level tags.',
        '日志条目的标签，例如 `info` 或 `audit`；`level()` 只过滤标准级别标签。'
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
        '`{ tag, message, args?, meta?, data?, context?, error?, time? }`; `context` defaults to the `context` option.',
        '`{ tag, message, args?, meta?, data?, context?, error?, time? }`；`context` 默认取构造选项中的 `context`。'
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
      'Waits for deferred tasks, async sink results, `onFlush` callbacks, batches and forwarded loggers. Concurrent calls share one Promise; a stuck Promise is abandoned after about 3 seconds and reported with `LIFECYCLE_DEADLINE`.',
      '等待延后任务、异步 sink 结果、`onFlush` 回调、批处理以及转发目标全部完成。并发调用共享同一个 Promise；卡住的 Promise 约 3 秒后放弃等待，并以 `LIFECYCLE_DEADLINE` 上报。'
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
      'Closes the logger: runs shutdown handlers, flushes, then uninstalls all plugins. Reentrant and concurrent calls share the same Promise. Afterwards logs are silently ignored and the logger cannot be reopened.',
      '关闭 logger：执行收尾函数、刷新输出，再卸载全部插件。重入和并发调用共享同一个 Promise。之后的日志会被静默忽略，logger 不能重新启用。'
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
        `Logs with tag \`${name}\` when \`${name}\` is not below the current level and every filter passes. A string first argument becomes the message (with \`%s\` placeholders); otherwise all arguments go to \`args\`.`,
        `以 \`${name}\` 标签记录日志（${zh}），前提是 \`${name}\` 不低于当前级别且所有过滤器都放行。第一个参数是字符串时作为消息（支持 \`%s\` 占位符）；否则全部参数放入 \`args\`。`
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
      'A function that removes this filter; calling it again does nothing.',
      '移除该过滤器的函数；重复调用没有效果。'
    ),
    example: `const removeHealth = log.addFilter((entry) => !entry.message.includes('/health'))`
  },
  removeFilter: {
    call: '(filter)',
    summary: t(
      'Removes a filter previously added (by `addFilter()` or the `filters` option).',
      '移除之前添加的过滤器（来自 `addFilter()` 或 `filters` 选项）。'
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

/** Reference of `@migaia/logger`. */
export const loggerReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Core entry point. Start from `new Logger({ execution, plugins })`: the core only builds entries, runs the pipeline, calls sinks and drains on `flush()` / `shutdown()`. Levels, console output, batching and uploads come from plugins in `@migaia/logger/plugins`.',
        '核心入口。从 `new Logger({ execution, plugins })` 开始：核心只负责构造日志条目、执行管线、调用 sink，并在 `flush()` / `shutdown()` 时排空。级别、控制台输出、攒批与上报都来自 `@migaia/logger/plugins` 中的插件。'
      ),
      example: loggerExample
    },
    plugins: {
      summary: t(
        'Built-in plugins: `level()` adds `info()` / `warn()` / ... and filters; `color()` prints to the console; `batch()` groups entries for other plugins; `http()` uploads; `process()` flushes on exit; `reasoning()` streams model output; `uuid()` labels entries. Create a new plugin object for each logger.',
        '内置插件：`level()` 增加 `info()` / `warn()` 等方法与过滤器；`color()` 输出到控制台；`batch()` 为其它插件提供攒批；`http()` 上报；`process()` 在退出前刷新；`reasoning()` 流式输出模型内容；`uuid()` 给条目编号。每个 logger 都要创建新的插件对象。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { batch, color, http, level } from '@migaia/logger/plugins'

${create}
  plugins: [level({ level: 'info' }), color(), batch(), http({ url: 'https://logs.example/v1/entries' })]
})`
    },
    'plugins/file': {
      summary: t(
        'The `file()` plugin, imported only from this subpath. It appends entries as JSON lines to a file through batches. In Node it uses `node:fs/promises`; elsewhere `runtimeManager.fs` must be injected.',
        '`file()` 插件，只能从这个子路径导入。它按批把日志条目以 JSON 行的形式追加到文件。在 Node 中使用 `node:fs/promises`；其它环境必须注入 `runtimeManager.fs`。'
      ),
      example: `import { Logger } from '@migaia/logger'
import { file } from '@migaia/logger/plugins/file'

${create}
  plugins: [file({ path: 'logs/app.jsonl' })]
})`
    }
  },
  symbols: {
    Logger: {
      role: 'factory',
      purpose: t(
        'Creates a logger. Plugins in `plugins` are installed synchronously in array order; a plugin whose install returns a Promise makes the constructor throw (install those later with `use()`). The methods of installed plugins appear on the instance with full types.',
        '创建一个 logger。`plugins` 中的插件按数组顺序同步安装；安装过程返回 Promise 的插件会让构造函数抛错（这类插件请在构造后用 `use()` 安装）。已安装插件的方法会出现在实例上，并带有完整类型。'
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
      example: loggerExample,
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
        'Plugin that adds `debug()` / `info()` / `warn()` / `error()` / `fatal()`, a minimum level and filters. Without it a logger only has `log(tag, message)`.',
        '增加 `debug()` / `info()` / `warn()` / `error()` / `fatal()`、最低级别与过滤器的插件。没有它时 logger 只有通用的 `log(tag, message)` 方法。'
      ),
      params: {
        config: t('Optional; see `ILevelPluginConfig`.', '可选配置，见 `ILevelPluginConfig`。')
      },
      returns: t('A plugin object for one logger.', '只能安装到一个 logger 上的插件对象。'),
      options: 'ILevelPluginConfig',
      example: `import { Logger } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'

${create}
  plugins: [level({ level: 'info' })]
})
log.warn('cache miss for %s', key)`
    },
    color: {
      role: 'enhancer',
      purpose: t(
        'Prints readable lines or JSON with optional ANSI colors, using captured runtimeManager.console in preference to write. To capture output replace that console or supply a pure write manager without console. It offers paint/dim to reasoning().',
        '把日志输出为可读文本或结构化格式，可选终端颜色；优先使用捕获的管理器控制台，捕获输出应替换控制台或提供不含控制台的纯写入管理器；另向流式插件提供着色能力。'
      ),
      params: {
        config: t('Optional; see `IColorPluginConfig`.', '可选配置，见 `IColorPluginConfig`。')
      },
      returns: t('A plugin object for one logger.', '只能安装到一个 logger 上的插件对象。'),
      options: 'IColorPluginConfig',
      example: `import { Logger } from '@migaia/logger'
import { level, color } from '@migaia/logger/plugins'

${create}
  plugins: [level(), color({ format: 'pretty', colorMessage: 'head' })]
})`
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
      members: coreMembers
    },
    ILoggerPluginCore: {
      summary: t(
        'The `core` a plugin receives in `install(core)`: the logger core without `use` / `unUse`, plus `onDispose()` for cleanup.',
        '插件在 `install(core)` 中收到的 `core`：去掉 `use` / `unUse` 的 logger 核心，外加用于清理的 `onDispose()`。'
      ),
      members: coreMembers
    },
    ILoggerConfig: {
      summary: t(
        'The `config` store of a logger instance, addressed by plugin name.',
        'logger 实例上的 `config` 配置仓库，按插件名称寻址。'
      ),
      members: {
        get: {
          summary: t(
            'Reads a nested value of one plugin configuration; reading a whole plugin root is invalid. The result is a shallow copy; nested objects are shared.',
            '读取某个插件配置中的嵌套值；不能直接读取插件的根配置。返回浅拷贝，嵌套对象仍是共享引用。'
          ),
          params: {
            path: t(
              '`<pluginName>.<key>` or `<pluginName>.[index].<key>`, e.g. `level.level`.',
              '`<插件名>.<键>` 或 `<插件名>.[下标].<键>`，例如 `level.level`。'
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
            'Shallow-merges a patch into one plugin configuration and commits it.',
            '把补丁浅合并到某个插件的配置中并提交。'
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
            'Required deadlines: `mutationTimeoutMs` for plugin install/uninstall and `pipelineDrainTimeoutMs` for pipeline drain; `false` means no deadline.',
            '必填的截止设置：`mutationTimeoutMs` 用于插件安装与卸载，`pipelineDrainTimeoutMs` 用于管线排空；`false` 表示不设截止时间。'
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
            'Plugins installed synchronously in array order; their methods appear on the instance.',
            '按数组顺序同步安装的插件；它们的方法会出现在实例上。'
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
      example: `const lines: string[] = []
${create}
  runtimeManager: { ...getLoggerRuntimeManager(), write: (text) => lines.push(text) },
  plugins: [color({ format: 'json' })]
})`,
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
            'Console used by `color()` for pretty output and by failure reporting.',
            '`color()` 可读输出与失败上报使用的控制台对象。'
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
        ...logEntryMembers,
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
          summary: t(
            'Minimum level written; lower levels are dropped. Tags that are not level names always pass.',
            '会被输出的最低级别，更低的级别被丢弃；不是级别名称的标签总是放行。'
          ),
          default: t('`debug`: everything passes.', '`debug`：全部放行。'),
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
        'Methods a logger gains from `level()`.',
        'logger 安装 `level()` 插件后获得的分级记录方法。'
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
          summary: t('Whether ANSI colors are used.', '控制台输出是否使用 ANSI 颜色。'),
          default: t('`auto`.', '`auto`：根据环境自动决定。'),
          values: { enum: 'LoggerColorMode' }
        },
        format: {
          summary: t('Output format of each entry.', '每条日志在控制台中的输出格式。'),
          default: t('`auto`.', '`auto`：根据环境自动选择。'),
          values: {
            auto: t(
              '`LOG_FORMAT` if set; otherwise `pretty` in CI or a terminal, `json` when stdout is redirected.',
              '设置了 `LOG_FORMAT` 时按它；否则在 CI 或终端中为 `pretty`，stdout 被重定向时为 `json`。'
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
          summary: t(
            'Paint function per tag, for custom tags such as `audit`; unknown tags stay uncolored.',
            '按标签指定染色函数，用于 `audit` 等自定义标签；未映射的标签不上色。'
          ),
          default: t('Built-in colors for the five levels.', '五个级别使用内置颜色。')
        }
      }
    },
    IBatchPluginConfig: {
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
            'Maximum time of one request; on timeout it is aborted and handled like a network error.',
            '单次请求的最长时间；超时会中止请求并按网络错误处理。'
          ),
          default: t('`10000`.', '默认值为 `10000` 毫秒。')
        },
        batch: {
          summary: t(
            'Upload queue settings. An earlier or same-batch Feature provider supplies shared batching regardless of input order. Without a provider, this option still creates a bounded local queue forced to maxSize:1 and asyncOutput:false; other queue bounds apply.',
            '本次上传队列设置；已安装或同批的功能提供者按依赖绑定，不受输入顺序限制。没有提供者时此选项仍创建本地有界队列，强制单条大小及同步输出，其余队列边界仍适用。'
          ),
          default: t('Not set: the `batch()` defaults.', '不设置：使用 `batch()` 的默认设置。')
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
        fileSinkUnavailable: t(
          '`FILE_SINK_UNAVAILABLE`: `file()` has no injected `fs` and no Node default.',
          '`FILE_SINK_UNAVAILABLE`：`file()` 既没有注入的 `fs`，也没有 Node 默认能力。'
        )
      }
    }
  },
  enhancers: {
    level: {
      kind: 'plugin',
      target: 'Logger',
      summary: t(
        'After installation the logger has `debug()`, `info()`, `warn()`, `error()`, `fatal()`, `setLevel()`, `addFilter()` and `removeFilter()`, and a pipeline stage that drops entries below the level or rejected by a filter.',
        '安装后 logger 拥有 `debug()`、`info()`、`warn()`、`error()`、`fatal()`、`setLevel()`、`addFilter()`、`removeFilter()`，并增加一个管线阶段，丢弃低于级别或被过滤器拒绝的条目。'
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
        'Signals and crashes drain then shut down; captureCrashes controls fatal logging only, while crashes still exit(1). beforeExit flushes without initiating shutdown. The adapter adds no methods.',
        '信号与崩溃先排空再关闭，崩溃开关仅控制致命日志，崩溃仍以退出码一结束；`beforeExit` 刷新但不主动关闭，适配器不增加方法。'
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
