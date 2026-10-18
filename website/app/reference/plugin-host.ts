/**
 * Reference documentation of `@migaia/plugin-host`. Rules: `app/reference/contract.ts`. Verified
 * against `packages/plugin-host/src` (typing.ts, core.ts, composition-entry.ts, plugin-handle.ts,
 * cleanup-runtime.ts, state-constants.ts, error-code.ts) and USEGUIDE on 2026-10-18.
 */
import type { IEnhancerDoc, ILibraryReference, IMemberDoc, IText } from './contract.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Construction options used in every example. */
const execution = 'execution: { mutationTimeoutMs: 5000, pipelineDrainTimeoutMs: 5000 }'

/** Common registration ownership for all pipeline methods of each receiving surface. */
const stageLifetime = {
  host: t(
    'Host stages stay until the host is disposed; registering while a pipeline runs throws PIPELINE_EXECUTING.',
    '宿主登记的步骤保留到宿主释放；管线运行期间登记新步骤会抛 PIPELINE_EXECUTING。'
  ),
  core: t(
    'Plugin stage registration is allowed only during install; later registration throws RESOURCE_OUTSIDE_INSTALL, and uninstall removes the registered stages.',
    '插件只能在 install 期间登记步骤，之后登记会抛 RESOURCE_OUTSIDE_INSTALL；卸载插件会移除它登记的步骤。'
  )
} as const

/** Shared stage-registration member docs (host and plugin core). */
const stageMembers = (receiver: 'host' | 'core'): Readonly<Record<string, IMemberDoc>> => {
  return {
    usePipeline: {
      summary: t(
        `Adds a synchronous stage \`(value, next) => void\` to the host pipeline. It is lifted to the host mode, so it works in every mode.`,
        `向宿主 pipeline 添加同步步骤 \`(value, next) => void\`。它会被提升到宿主模式，因此任何模式都可用。`
      ),
      params: {
        stage: t(
          'Sync stage; call `next(value)` to continue, omit it to stop the value.',
          '同步步骤；调用 `next(value)` 继续，不调用则拦截该值。'
        )
      },
      returns: t(
        `The ${receiver} itself, so calls can be chained.`,
        receiver === 'host' ? '宿主本身，可以链式调用。' : '插件 core 本身，可以链式调用。'
      ),
      example:
        receiver === 'host'
          ? `host.usePipeline((value, next) => next(value.trim()))`
          : `core.usePipeline((entry, next) => next({ ...entry, tag: 'audit' }))`
    },
    useAsyncPipeline: {
      summary: t(
        `Adds an onion-style async stage; only valid when the host mode is \`async\`, otherwise \`PIPELINE_MODE_MISMATCH\`.`,
        `添加洋葱模型的异步步骤；只有宿主模式为 \`async\` 时可用，否则抛 \`PIPELINE_MODE_MISMATCH\`。`
      ),
      params: {
        stage: t(
          '`async (value, next) => { await next(value) }`; code after `await next()` runs after downstream.',
          '`async (value, next) => { await next(value) }`；`await next()` 之后的代码在下游完成后执行。'
        )
      },
      returns: t(
        `The ${receiver} itself.`,
        receiver === 'host' ? '宿主本身，可以链式调用。' : '插件 core 本身，可以链式调用。'
      ),
      example: `${receiver}.useAsyncPipeline(async (request, next) => {
  const started = Date.now()
  await next(request)
  console.log('耗时', Date.now() - started)
})`
    },
    useGeneratorPipeline: {
      summary: t(
        `Adds a generator stage; valid in \`generator\` and \`async-generator\` modes.`,
        `添加生成器步骤；\`generator\` 与 \`async-generator\` 模式可用。`
      ),
      params: {
        stage: t(
          '`function* (value)`; return a value or a `GENERATOR_*` signal.',
          '`function* (value)`；返回新值或某个 `GENERATOR_*` 信号。'
        )
      },
      returns: t(
        `The ${receiver} itself.`,
        receiver === 'host' ? '宿主本身，可以链式调用。' : '插件 core 本身，可以链式调用。'
      ),
      example: `${receiver}.useGeneratorPipeline(function* (event) {
  if (event.level === 'debug') return GENERATOR_HALT
  return event
})`
    },
    useAsyncGeneratorPipeline: {
      summary: t(
        `Adds an async generator stage; only valid in \`async-generator\` mode.`,
        `添加异步生成器步骤；只有 \`async-generator\` 模式可用。`
      ),
      params: {
        stage: t(
          '`async function* (value)`; drained completely before the next stage.',
          '`async function* (value)`；完整执行完才进入下一个步骤。'
        )
      },
      returns: t(
        `The ${receiver} itself.`,
        receiver === 'host' ? '宿主本身，可以链式调用。' : '插件 core 本身，可以链式调用。'
      ),
      example: `${receiver}.useAsyncGeneratorPipeline(async function* (value) {
  return await enrich(value)
})`
    }
  }
}

/** Member docs of the base host API, shared by the class and the `defineHost()` handle. */
const hostMembers: Readonly<Record<string, IMemberDoc>> = {
  identity: {
    summary: t(
      'Immutable host identity `{ name, id }`: `name` from the `identity` option, `id` unique per host; used in errors and diagnostics.',
      '不可变的宿主身份 `{ name, id }`：`name` 来自 `identity` 选项，`id` 每个宿主唯一；用于错误和诊断信息。'
    )
  },
  plugin: {
    summary: t(
      'Enable/disable controls: `plugin.disable(name)` hides a plugin (extensions, Features, stages) without releasing resources, `plugin.enable(name)` restores it in place, `plugin.disabled()` lists disabled names.',
      '启用/禁用控制：`plugin.disable(name)` 隐藏某个插件（extension、Feature、步骤），但不释放资源；`plugin.enable(name)` 原位恢复；`plugin.disabled()` 列出已禁用的插件名。'
    )
  },
  pipelineMode: {
    summary: t(
      'Pipeline mode fixed at construction: `sync`, `async`, `generator` or `async-generator`.',
      '构造时固定的 pipeline 模式：`sync`、`async`、`generator` 或 `async-generator`，决定可注册的步骤类型。'
    )
  },
  revision: {
    summary: t(
      'Counter of committed installation, removal, replacement, configuration, enablement, stage-registration and terminal changes. Composition owners compare revision to detect stale snapshots; it remains readable after disposal.',
      '已提交安装、卸载、替换、配置、启停、步骤登记及终态变更的计数；组合方据此识别过期快照，释放后仍可读取。'
    )
  },
  config: {
    summary: t(
      'Per-plugin configuration store. `config.get("plugin.key")` reads a frozen snapshot (unknown paths return `undefined`); `config.update(name, recipe)` merges a patch copy-on-write and commits only after the plugin `update` hook succeeds.',
      '按插件划分的配置仓库。`config.get("plugin.key")` 读取冻结快照（路径不存在返回 `undefined`）；`config.update(name, recipe)` 以写时复制合并补丁，插件的 `update` 钩子成功后才提交。'
    )
  },
  useSync: {
    summary: t(
      'Installs synchronously and returns handles in input order. A declared setup immediately throws SETUP_REQUIRES_ASYNC_INSTALL. A thenable install result rejects as PLUGIN_INSTALL_FAILED with INSTALL_RESULT_THENABLE on cause; its later rejection is reported through the diagnostic third argument, not inserted retroactively into the immediate cause chain.',
      '同步安装并按输入顺序返回句柄；声明准备钩子时立即抛 `SETUP_REQUIRES_ASYNC_INSTALL`。安装返回异步值时抛 `PLUGIN_INSTALL_FAILED`，原因含 `INSTALL_RESULT_THENABLE`；之后的实际拒绝由诊断第三参数报告，不会补入即时原因链。'
    ),
    params: {
      plugins: t('Plugin definitions with synchronous install.', '安装过程完全同步的插件定义。')
    },
    returns: t('The handle tuple in input order.', '与输入顺序一致的插件句柄元组。'),
    whenToUse: t(
      'Building a host that must be usable right after construction.',
      '宿主构造完成后必须立刻可用时使用。'
    ),
    example: `const [level] = host.useSync(levelPlugin)`
  },
  use: {
    summary: t(
      'Installs one or more plugins as one batch, in Feature dependency order (argument order does not matter). Either every plugin is published or the batch is rolled back in reverse order.',
      '把一个或多个插件作为一批安装，按 Feature 依赖顺序执行（与参数顺序无关）。要么全部发布，要么按相反顺序整批回滚。'
    ),
    params: {
      plugins: t(
        'Definitions from `definePlugin()` or plugin factories such as `level()`. Names must be unique and must not contain `.`.',
        '`definePlugin()` 的结果或 `level()` 这类插件工厂的返回值。名称必须唯一且不能包含 `.`。'
      )
    },
    returns: t(
      'A Promise of the handle tuple in input order. Install failures reject with `PLUGIN_INSTALL_FAILED` (original error on `cause`, `detail.failedName`); missing providers throw `PREREQUISITE_*` directly.',
      '按输入顺序给出句柄元组的 Promise。安装失败以 `PLUGIN_INSTALL_FAILED` reject（原错误在 `cause`，失败插件名在 `detail.failedName`）；缺少依赖时直接抛 `PREREQUISITE_*`。'
    ),
    whenToUse: t(
      'Plugins with async `setup` or `install`, or plugins added at runtime.',
      '含异步 `setup`/`install` 的插件，或运行期追加的插件。'
    ),
    example: `const [cache, api] = await host.use(cachePlugin, apiPlugin)
await api.extensions.fetchUser('u1')`
  },
  unUse: {
    summary: t(
      'Removes a plugin: runs its `beforeRelease`, waits for running pipelines, withdraws extensions, Features and stages, then runs its disposers and releases resources in reverse order.',
      '卸载插件：先执行 `beforeRelease`，等待正在运行的 pipeline 结束，撤下 extension、Feature 与步骤，再执行插件清理并按逆序释放资源。'
    ),
    params: {
      name: t('Name of the installed plugin.', '已安装插件的名称。'),
      options: t(
        '`policy`: what happens to plugins that require it (`reject` default, `cascade`, `suspend`); `dryRun: true` returns the plan without changing anything.',
        '`policy`：依赖它的插件如何处理（默认 `reject`，可选 `cascade`、`suspend`）；`dryRun: true` 只返回计划、不做任何修改。'
      )
    },
    returns: t(
      '{ ok: true, affected }, or { ok: false, errors, affected } after cleanup failure or PIPELINE_DRAIN_TIMEOUT. Ordinary unUse continues bounded cleanup after a drain timeout, records/reports that failure and adds no physicalCompletion protocol. dryRun:true returns IPluginDependencyPlan.',
      '成功返回 `{ ok: true, affected }`；清理失败或 `PIPELINE_DRAIN_TIMEOUT` 返回 `{ ok: false, errors, affected }`。普通卸载排空超时后仍继续有界清理，收集并报告失败，不提供物理完成协议；仅预演时返回依赖计划。'
    ),
    example: `const plan = await host.unUse('cache', { policy: 'cascade', dryRun: true })
console.log(plan.order)
const result = await host.unUse('cache', { policy: 'cascade' })
if (!result.ok) console.error(result.errors)`
  },
  activate: {
    summary: t(
      'Installs a plugin that was registered with `activation: "lazy"`, first activating any lazy providers it requires. Concurrent calls share one Promise; a failure leaves it registered so it can be retried.',
      '安装以 `activation: "lazy"` 登记的插件，并先激活它必需的惰性 provider。并发调用共享同一个 Promise；失败后插件保持登记状态，可以再次尝试。'
    ),
    params: { name: t('Name of the lazy plugin.', '惰性插件的名称。') },
    returns: t(
      'The handle of the activated plugin; the original install error on failure.',
      '激活后的插件句柄；失败时原样抛出安装错误。'
    ),
    whenToUse: t(
      'Defer expensive plugins until the first request needs them.',
      '把昂贵的插件推迟到第一次真正需要时再安装。'
    ),
    example: `const search = await host.activate('search')
search.extensions.query('migaia')`
  },
  replace: {
    summary: t(
      'Hot-swaps a plugin: installs `next` first (the old one keeps serving if that fails), then rebinds dependents that implement `onDependencyReplaced` and restarts the others; the old generation is disposed after its running pipelines drain.',
      '热替换插件：先安装 `next`（失败则旧实现继续服务），再让实现了 `onDependencyReplaced` 的依赖者换绑、其余依赖者重启；旧实现等它参与的 pipeline 运行结束后才释放。'
    ),
    params: {
      name: t('Name of the installed plugin.', '已安装插件的名称。'),
      next: t(
        'New definition with the same name (otherwise `REPLACE_NAME_MISMATCH`).',
        '同名的新定义（名称不同抛 `REPLACE_NAME_MISMATCH`）。'
      )
    },
    returns: t(
      'The handle of the new generation. Old extracted extension functions throw `REGISTRATION_REVOKED`; a failed dependent restart throws `DEPENDENT_RESTART_FAILED` after the replacement took effect.',
      '新实现的句柄。之前取出的旧 extension 函数调用会抛 `REGISTRATION_REVOKED`；依赖者重启失败时，替换已生效，同时抛 `DEPENDENT_RESTART_FAILED`。'
    ),
    example: `await host.replace('transport', transportPlugin({ url: nextUrl }))`
  },
  runPipeline: {
    summary: t(
      'Runs `value` through host and plugin stages and calls `done` with the final value. Only the holder of a `defineHost()` handle can call it (subclasses use the protected method), so the domain decides when the pipeline runs.',
      '让 `value` 依次经过宿主与插件的步骤，再以最终值调用 `done`。只有 `defineHost()` 句柄的持有者能调用（子类使用受保护的同名方法），由领域代码决定何时运行 pipeline。'
    ),
    params: {
      value: t('Input value.', '输入 pipeline 的值。'),
      done: t(
        'Final callback; not called when a stage stops the value.',
        '终点回调；某个步骤拦截该值时不会调用。'
      )
    },
    returns: t(
      '`void` in sync modes, a Promise in async modes; host disposal aborts the run with `HOST_DISPOSING`.',
      '同步模式返回 `void`，异步模式返回 Promise；宿主释放时运行以 `HOST_DISPOSING` 中止。'
    ),
    example: `await handle.runPipeline('  hello  ', (value) => console.log(value)) // hello`
  },
  dispose: {
    summary: t(
      'Closes permanently: stops new changes, drains pipelines and releases plugins with dependents first. The completion Promise is published before callbacks or abort listeners run; concurrent or reentrant disposal shares it, so cleanup middleware runs once. The lifecycle abort reason and later admission failure can be distinct instances with the same source/code.',
      '永久关闭宿主，停止新变更、排空管线并按依赖者优先释放插件。回调与中止监听前即发布完成承诺，并发或重入释放共享它，清理中间件仅运行一次；生命周期取消原因与后续准入错误可为同来源及错误码的不同实例。'
    ),
    returns: t(
      'An `IPluginHostDisposalResult`: `cleanupErrors` lists cleanup failures; `cleanupComplete: false` means some cleanup is still running, observe `physicalCompletion`.',
      '`IPluginHostDisposalResult`：`cleanupErrors` 列出清理失败；`cleanupComplete: false` 表示仍有清理在进行，需要继续等待 `physicalCompletion`。'
    ),
    example: `const result = await host.dispose()
if (!result.cleanupComplete) await result.physicalCompletion`
  },
  ...stageMembers('host')
}

/** Docs of the plugin definition fields and hooks, shared by `IPlugin` and the constraint types. */
const pluginMembers: Readonly<Record<string, IMemberDoc>> = {
  name: {
    summary: t(
      'Unique plugin name within a host. It addresses the plugin in `unUse`, `replace`, `config.get("name.key")` and Feature references, so it must not contain `.`.',
      '插件在宿主内的唯一名称。`unUse`、`replace`、`config.get("name.key")` 和 Feature 引用都用它定位插件，因此不能包含 `.`。'
    )
  },
  config: {
    summary: t(
      'Initial configuration. The host deep-copies and freezes it at install; read it with `core.config.get()` and change it with `host.config.update(name, recipe)`. Only plain data is accepted (`INVALID_CONFIG_VALUE`, `CONFIG_CYCLE_REJECTED`).',
      '初始配置。宿主在安装时深拷贝并冻结它；插件用 `core.config.get()` 读取，应用用 `host.config.update(name, recipe)` 修改。只接受普通数据（否则抛 `INVALID_CONFIG_VALUE`、`CONFIG_CYCLE_REJECTED`）。'
    )
  },
  features: {
    summary: t(
      'Features this plugin provides (defined with `defineFeature()`) and Features it consumes (references from `provider.getFeature(name)`). The host installs providers first and injects outputs as `core.features.<name>`.',
      '本插件提供的 Feature（用 `defineFeature()` 定义）以及消费的 Feature（来自 `provider.getFeature(name)` 的引用）。宿主先安装 provider，再把输出注入为 `core.features.<name>`。'
    )
  },
  activation: {
    summary: t(
      'When the plugin installs: `eager` installs during `use()`; `lazy` only registers it and installs on `host.activate(name)` or when an eager plugin requires it.',
      '插件何时安装：`eager` 在 `use()` 时安装；`lazy` 只登记，等到 `host.activate(name)` 或某个立即安装的插件需要它时才安装。'
    ),
    default: t('`eager`: installed by `use()`.', '`eager`：在 `use()` 时立即安装。'),
    values: {
      eager: t('Install immediately in `use()`.', '在 `use()` 中立即安装。'),
      lazy: t(
        'Register only; install on first `activate()` or when required.',
        '只登记；第一次 `activate()` 或被需要时才安装。'
      )
    }
  },
  update: {
    summary: t(
      'Called by `host.config.update(name, recipe)` with the candidate configuration `next` (read-only). Returning normally commits `next`; throwing or rejecting keeps the old configuration.',
      '`host.config.update(name, recipe)` 时调用，参数 `next` 是只读的候选配置。正常返回则提交 `next`；抛错或 reject 则保留旧配置。'
    ),
    example: `update: (next, core) => {
  if (typeof next.url !== 'string') throw new TypeError('url 必须是字符串')
  socket.reconnect(next.url)
}`
  },
  onEnable: {
    summary: t(
      'Notification after the plugin becomes reachable: once after install, then after every real `enable`. Failures are only reported through `diagnostic`.',
      '插件变为可用后的通知：安装成功后一次，之后每次真正被启用时一次。失败只经 `diagnostic` 上报，不会回滚。'
    ),
    example: `onEnable: () => console.log('插件已启用')`
  },
  onDisable: {
    summary: t(
      'Notification after the plugin was disabled (resources are kept). Failures are only reported.',
      '插件被禁用后的通知（资源仍保留）。失败只上报，不会回滚。'
    ),
    example: `onDisable: () => timer.pause()`
  },
  onDependencyReplaced: {
    summary: t(
      'Called on a dependent when a provider it requires was replaced with `host.replace()`. Rebinding to the new `outputs` here avoids a restart; without this hook (or when it throws) the dependent is restarted.',
      '当它所依赖的 provider 被 `host.replace()` 替换时，在依赖者上调用。在这里换绑到新的 `outputs` 可避免重启；没有这个钩子（或钩子抛错）时依赖者会被重启。'
    ),
    example: `onDependencyReplaced: (provider, outputs) => {
  formatter = outputs.format as IFormat
}`
  },
  dispose: {
    summary: t(
      'Plugin-level cleanup run on removal or host disposal, after `beforeRelease` and before resources registered with `onDispose` are released. Bounded by `disposeStepTimeoutMs`.',
      '卸载插件或释放宿主时执行的插件级清理，在 `beforeRelease` 之后、`onDispose` 登记的资源释放之前执行，受 `disposeStepTimeoutMs` 限制。'
    ),
    example: `dispose: async () => {
  await connection.close()
}`
  },
  beforeRelease: {
    summary: t(
      'Called once before an installed generation is released, while it can still serve calls; use it to flush or hand off work. `context.signal`, `deadlineAt` and `remainingMs()` describe the time budget. Failures are collected and release continues.',
      '在已安装的这一代被释放之前调用一次，此时它仍可处理调用；适合在这里刷新缓冲或交接工作。`context.signal`、`deadlineAt`、`remainingMs()` 描述剩余时间预算。失败会被收集，释放照常继续。'
    ),
    example: `beforeRelease: async (context) => {
  await queue.flush({ signal: context.signal })
}`
  }
}

/** Scenarios and example of the host instance. */
const hostScenarios = [
  t(
    'A library (logger, store, RPC peer) extends `PluginHost` so users add optional plugins instead of more constructor options.',
    '库（logger、store、RPC peer）继承 `PluginHost`，让使用者通过可选插件扩展，而不是不断增加构造参数。'
  ),
  t(
    'An application composes cache, auth and telemetry as plugins that share capabilities through Features and are removed with full cleanup.',
    '应用把缓存、鉴权、遥测组合为插件，通过 Feature 共享能力，并在卸载时完整清理。'
  )
]
const hostExample = {
  en: `import { definePlugin, PluginHost } from '@migaia/plugin-host'

type ICore = { emit(text: string): void }
class Host extends PluginHost<ICore, string> {
  protected createPluginDomainCore(): ICore {
    return { emit: (text) => console.log(text) }
  }
}

const host = new Host({ ${execution} })
// A bare host only manages plugins; capabilities arrive with plugins.
const shout = definePlugin<ICore, { shout(text: string): void }>('shout', (core) => ({
  install: () => ({ shout: (text: string) => core.emit(text.toUpperCase()) })
}))
const [handle] = await host.use(shout)
handle.extensions.shout('ready') // READY

const { token } = await host.plugin.disable('shout') // hidden, resources kept
await token.enable()
await host.unUse('shout') // released
await host.dispose()`,
  zh: `import { definePlugin, PluginHost } from '@migaia/plugin-host'

type ICore = { emit(text: string): void }
class Host extends PluginHost<ICore, string> {
  protected createPluginDomainCore(): ICore {
    return { emit: (text) => console.log(text) }
  }
}

const host = new Host({ ${execution} })
// 空宿主只能管理插件，具体能力由插件提供
const shout = definePlugin<ICore, { shout(text: string): void }>('shout', (core) => ({
  install: () => ({ shout: (text: string) => core.emit(text.toUpperCase()) })
}))
const [handle] = await host.use(shout)
handle.extensions.shout('ready') // READY

const { token } = await host.plugin.disable('shout') // 隐藏，但资源保留
await token.enable()
await host.unUse('shout') // 卸载并释放资源
await host.dispose()`
}

/** Enhancer guide of `definePlugin`. */
const definePluginEnhancer: IEnhancerDoc = {
  kind: 'plugin',
  target: 'PluginHost',
  summary: t(
    'A plugin definition does nothing until installed. After `host.use(plugin)` the host gains: the object returned by `install` (and `expose`) on `handle.extensions` (derived hosts such as Logger also put these methods on the host itself); the pipeline stages the plugin registered; its Features for other plugins; its configuration under `host.config`; and cleanup of every resource it registered when it is removed.',
    '插件定义在安装前不产生任何效果。`host.use(plugin)` 之后宿主获得：`install`（及 `expose`）返回的对象，位于 `handle.extensions`（Logger 等派生宿主还会把这些方法挂到宿主自身）；插件登记的 pipeline 步骤；供其它插件使用的 Feature；`host.config` 下的插件配置；以及卸载时自动释放它登记的全部资源。'
  ),
  install: `import { definePlugin, PluginHost } from '@migaia/plugin-host'

const host = new PluginHost<Record<string, never>>({ ${execution} })
const greet = definePlugin({
  name: 'greet',
  config: { greeting: 'hello' },
  install: (core) => ({ greet: (name: string) => \`\${core.config.get().greeting}, \${name}\` })
})
const [handle] = await host.use(greet)`,
  grants: [
    {
      signature: 'handle.extensions.<name>(...)',
      summary: t(
        'Every enumerable own data property returned by install becomes a typed handle capability only when configurable:true. Frozen extension records are rejected; non-enumerable fields are ignored with diagnostics.',
        '`install()` 返回的自有可枚举数据属性还须允许重配置才可成为句柄能力；冻结扩展对象会被拒绝，不可枚举字段经诊断后忽略。'
      ),
      returns: t(
        'What the plugin function returns. After removal access throws `PLUGIN_NOT_INSTALLED`; an extracted function of a replaced generation throws `REGISTRATION_REVOKED`.',
        '插件函数自身的返回值。卸载后访问抛 `PLUGIN_NOT_INSTALLED`；被替换的旧实现中取出的函数调用抛 `REGISTRATION_REVOKED`。'
      ),
      example: `handle.extensions.greet('Ada') // 'hello, Ada'`
    },
    {
      signature: 'host.config.get(path) / host.config.update(name, recipe)',
      summary: t(
        'The plugin `config` becomes readable and updatable through the host; `update` runs the plugin `update(next, core)` hook and commits only on success.',
        '插件的 `config` 可通过宿主读取和更新；`update` 会执行插件的 `update(next, core)` 钩子，成功后才提交。'
      ),
      params: {
        path: t(
          '`plugin` or `plugin.key` (also `plugin.[index]`).',
          '`plugin` 或 `plugin.key`（也支持 `plugin.[下标]`）。'
        ),
        recipe: t(
          'Synchronous `(previous) => patch` returning a plain object.',
          '同步函数 `(previous) => patch`，返回普通对象。'
        )
      },
      example: `host.config.get('greet.greeting') // 'hello'
await host.config.update('greet', () => ({ greeting: 'hi' }))`
    },
    {
      signature: 'handle.getFeature(name)',
      summary: t(
        'Reads the output of a Feature the plugin declared in `features`; other plugins depend on it through `plugin.getFeature(name)` references.',
        '读取插件在 `features` 中声明的 Feature 输出；其它插件通过 `plugin.getFeature(name)` 引用来依赖它。'
      ),
      example: `const format = formatterHandle.getFeature('format')`
    },
    {
      signature: 'host.plugin.disable(name) / host.unUse(name) / host.replace(name, next)',
      summary: t(
        'Lifecycle control over the installed plugin: hide it without releasing, remove it with cleanup, or hot-swap it.',
        '对已安装插件的生命周期控制：不释放地隐藏、带清理地卸载，或热替换。'
      ),
      example: `await host.replace('greet', definePlugin({ name: 'greet', install: () => ({ greet: () => '你好' }) }))`
    }
  ],
  behaviors: [
    t(
      'Stages registered with `core.usePipeline*` join every later host pipeline run in first-registration order.',
      '通过 `core.usePipeline*` 登记的步骤会加入之后每次宿主 pipeline 运行，按首次登记顺序执行。'
    ),
    t(
      'Resources registered with `core.onDispose` or `context.onDispose` are released in reverse order when the plugin is removed or the host is disposed.',
      '通过 `core.onDispose` 或 `context.onDispose` 登记的资源，在插件卸载或宿主释放时按相反顺序释放。'
    )
  ],
  scenarios: [
    t(
      'Package an optional capability (colored output, remote sink, cache) that users install only when needed.',
      '把可选能力（彩色输出、远程上报、缓存）打包成插件，使用者按需安装。'
    ),
    t(
      'Open a connection in async `setup`, publish typed methods in `install`, and let removal close it.',
      '在异步 `setup` 中建立连接，在 `install` 中发布类型化方法，卸载时自动关闭连接。'
    )
  ],
  example: {
    en: `import { definePlugin, PluginHost } from '@migaia/plugin-host'

const host = new PluginHost<Record<string, never>, string>({ ${execution} })
const counter = definePlugin({
  name: 'counter',
  config: { step: 1 },
  setup: async (context) => {
    const store = new Map<string, number>()
    context.onDispose(() => store.clear())
    return { store }
  },
  install: (core, { store }) => {
    core.usePipeline((value, next) => {
      store.set(value, (store.get(value) ?? 0) + core.config.get().step)
      next(value)
    })
    return { count: (key: string) => store.get(key) ?? 0 }
  }
})
const [handle] = await host.use(counter)
await host.config.update('counter', () => ({ step: 2 }))
console.log(handle.extensions.count('page'))
await host.unUse('counter') // stage removed, store cleared
await host.dispose()`,
    zh: `import { definePlugin, PluginHost } from '@migaia/plugin-host'

const host = new PluginHost<Record<string, never>, string>({ ${execution} })
const counter = definePlugin({
  name: 'counter',
  config: { step: 1 },
  setup: async (context) => {
    const store = new Map<string, number>()
    context.onDispose(() => store.clear())
    return { store }
  },
  install: (core, { store }) => {
    core.usePipeline((value, next) => {
      store.set(value, (store.get(value) ?? 0) + core.config.get().step)
      next(value)
    })
    return { count: (key: string) => store.get(key) ?? 0 }
  }
})
const [handle] = await host.use(counter)
await host.config.update('counter', () => ({ step: 2 }))
console.log(handle.extensions.count('page'))
await host.unUse('counter') // 步骤被移除，store 被清空
await host.dispose()`
  }
}

/** Enhancer guide of `defineFeature`. */
const defineFeatureEnhancer: IEnhancerDoc = {
  kind: 'feature',
  target: 'IPlugin',
  summary: t(
    'A Feature is a capability one plugin provides to other plugins, not to application code. Declared in a provider `features` record, consumers reference it with `provider.getFeature(name)`; the host then installs providers first, injects the output as `core.features.<name>`, and refuses to remove or disable a provider that is still required.',
    'Feature 是一个插件提供给其它插件（而不是业务代码）的能力。在 provider 的 `features` 中声明后，消费者用 `provider.getFeature(name)` 引用它；宿主会先安装 provider，把输出注入为 `core.features.<name>`，并拒绝卸载或禁用仍被依赖的 provider。'
  ),
  install: `import { defineFeature, definePlugin } from '@migaia/plugin-host'

const format = defineFeature((core: { featureExpose: { format(text: string): string } }) => ({
  format: core.featureExpose.format
}))
const formatter = definePlugin({
  name: 'formatter',
  features: { format },
  featureExpose: () => ({ format: (text: string) => \`[app] \${text}\` }),
  install: () => ({})
})`,
  grants: [
    {
      signature: 'core.features.<name>',
      summary: t(
        'Inside a consumer plugin, the provider Feature output is available during install and afterwards.',
        '在消费者插件中，安装期间以及之后都可以使用 provider 的 Feature 输出。'
      ),
      example: `const writer = definePlugin(
  'writer',
  (core) => ({ install: () => ({ log: (text: string) => console.log(core.features.format.format(text)) }) }),
  { format: defineFeature((_core, deps) => deps.format, { format: formatter.getFeature('format') }) }
)`
    },
    {
      signature: 'readPluginDependencies(plugin)',
      summary: t(
        'Reads the `{ provider, required }` list derived from Feature references without running any hook.',
        '读取由 Feature 引用推导出的 `{ provider, required }` 列表，不执行任何钩子。'
      ),
      example: `readPluginDependencies(writer) // [{ provider: 'formatter', required: true }]`
    }
  ],
  behaviors: [
    t(
      '`host.use(consumer, provider)` installs in dependency order; a cycle throws `DEPENDENCY_CYCLE`.',
      '`host.use(consumer, provider)` 按依赖顺序安装；形成环时抛 `DEPENDENCY_CYCLE`。'
    ),
    t(
      'Removing or disabling a required provider is rejected (`DEPENDENCY_BLOCKED`) unless `policy` is `cascade` or `suspend`; installing a consumer without its provider throws `PREREQUISITE_MISSING`.',
      '卸载或禁用仍被必需的 provider 会被拒绝（`DEPENDENCY_BLOCKED`），除非 `policy` 为 `cascade` 或 `suspend`；缺少 provider 时安装消费者抛 `PREREQUISITE_MISSING`。'
    ),
    t(
      '`host.replace(provider)` rebinds consumers with `onDependencyReplaced` and restarts the others.',
      '`host.replace(provider)` 会让实现了 `onDependencyReplaced` 的消费者换绑，其余消费者重启。'
    )
  ],
  scenarios: [
    t(
      'A `batch` plugin shares its scheduler with `http` and `file` sinks.',
      '`batch` 插件把调度器共享给 `http`、`file` 等输出插件，而不是每个各建一个计时器。'
    ),
    t(
      'A storage backend provides a reactive adapter Feature consumed by a live-query plugin.',
      '存储后端插件提供响应式适配 Feature，由实时查询插件使用。'
    )
  ],
  example: {
    en: `import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'

const clock = defineFeature((core: { featureExpose: { now(): number } }) => ({ now: core.featureExpose.now }))
const clockPlugin = definePlugin({
  name: 'clock',
  features: { clock },
  featureExpose: () => ({ now: () => Date.now() }),
  install: () => ({})
})
const stamp = definePlugin(
  'stamp',
  (core) => ({ install: () => ({ stamp: (text: string) => \`\${core.features.time.now()} \${text}\` }) }),
  { time: defineFeature((_core, deps) => deps.clock, { clock: clockPlugin.getFeature('clock') }) }
)
const host = new PluginHost<Record<string, never>>({ ${execution} })
const [stamped] = await host.use(stamp, clockPlugin) // clock installs first
console.log(stamped.extensions.stamp('ready'))
await host.unUse('clock', { policy: 'cascade' }) // also removes stamp
await host.dispose()`,
    zh: `import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'

const clock = defineFeature((core: { featureExpose: { now(): number } }) => ({ now: core.featureExpose.now }))
const clockPlugin = definePlugin({
  name: 'clock',
  features: { clock },
  featureExpose: () => ({ now: () => Date.now() }),
  install: () => ({})
})
const stamp = definePlugin(
  'stamp',
  (core) => ({ install: () => ({ stamp: (text: string) => \`\${core.features.time.now()} \${text}\` }) }),
  { time: defineFeature((_core, deps) => deps.clock, { clock: clockPlugin.getFeature('clock') }) }
)
const host = new PluginHost<Record<string, never>>({ ${execution} })
const [stamped] = await host.use(stamp, clockPlugin) // clock 会先安装
console.log(stamped.extensions.stamp('ready'))
await host.unUse('clock', { policy: 'cascade' }) // 连同 stamp 一起卸载
await host.dispose()`
  }
}

/** Short type doc helper for type-only aliases. */
const alias = (en: string, zh: string) => ({ summary: t(en, zh), members: {} })

/** Reference of `@migaia/plugin-host`. */
export const pluginHostReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Main entry point. Create a host by subclassing `PluginHost` or with `defineHost()`; define plugins with `definePlugin()` and cross-plugin capabilities with `defineFeature()`. Also exports error codes, status constants and disposal diagnostics.',
        '主入口。通过继承 `PluginHost` 或调用 `defineHost()` 创建宿主；用 `definePlugin()` 定义插件，用 `defineFeature()` 定义插件之间共享的能力。这里还导出错误码、状态常量和清理诊断工具。'
      ),
      example: `import { definePlugin, PluginHost } from '@migaia/plugin-host'

const host = new PluginHost<Record<string, never>>({ ${execution} })
const [hello] = await host.use(definePlugin('hello', () => ({ install: () => ({ hi: () => 'hi' }) })))
console.log(hello.extensions.hi())`
    },
    composition: {
      summary: t(
        'Protocol for one owner that composes hosts (such as `@migaia/tray`): batched install with prepare/commit, exact registration receipts, ordering slots and extension-only views. Ordinary applications keep using `use()` / `unUse()` and do not need this entry point.',
        '供组合宿主的唯一所有者（如 `@migaia/tray`）使用的协议：先准备再提交的批量安装、精确的注册凭证、排序槽位以及只含扩展的视图。普通应用继续使用 `use()` / `unUse()`，不需要这个入口。'
      ),
      example: `import { isManagedHost, openComposition } from '@migaia/plugin-host/composition'

if (isManagedHost(host)) console.log(openComposition(host).revision)`
    }
  },
  symbols: {
    PluginHost: {
      role: 'factory',
      purpose: t(
        'Base class of a plugin-capable host. A new host only manages plugins (install, remove, disable, replace, configure, dispose) and pipeline stages; every domain capability arrives through plugins. Subclasses provide the domain core plugins receive by overriding `createPluginDomainCore()`.',
        '可插件化宿主的基类。新建的宿主只负责管理插件（安装、卸载、禁用、替换、配置、释放）和 pipeline 步骤；所有领域能力都由插件提供。子类通过重写 `createPluginDomainCore()` 提供插件在安装时拿到的领域 core。'
      ),
      params: {
        options: t(
          'Required IPluginHostOptions, including explicit mutation and pipeline-drain execution budgets; optional identity, pipeline and diagnostics configure this Host only.',
          '必填宿主选项，包含显式变更与管线排空执行预算；可选身份、管线与诊断仅配置当前宿主。'
        )
      },
      returns: t(
        'A new empty PluginHost instance; install plugins to obtain domain capabilities and await dispose() when its lifetime ends. Invalid configuration throws before the instance is published.',
        '返回新的空插件宿主实例；安装插件后取得领域能力，生命周期结束时应等待释放方法；非法配置在实例发布前抛错。'
      ),
      options: 'IPluginHostOptions',
      example: hostExample,
      scenarios: hostScenarios,
      avoid: [
        t(
          'There are only one or two fixed extension points that never change at runtime: plain options or function composition are simpler.',
          '扩展点只有一两个且运行期不变：直接用普通参数或函数组合更简单。'
        )
      ]
    },
    defineHost: {
      role: 'factory',
      purpose: t(
        'Creates one frozen managed handle without subclassing. TPublicSurface, the optional fourth generic, adds domain-owned surface descriptors before freezing; accessors stay live and fluent pipeline registration returns the same handle with its domain members and issued identity. Canonical Host keys take precedence. Domain core and disposal callbacks remain options.',
        '无需继承即可创建同一个冻结托管句柄。可选第四泛型 `TPublicSurface` 在冻结前加入领域自有属性描述符，访问器保持实时；管线链式登记返回含领域成员及已签发身份的原句柄。规范宿主键优先，领域内核与释放回调仍以选项传入。'
      ),
      params: {
        options: t(
          'Host options plus the domain hooks; see the options table.',
          '宿主选项与领域钩子，见选项表。'
        )
      },
      returns: t(
        'One canonical frozen IHostHandle carrying TPublicSurface (empty by default). Surface option/descriptor reads happen before Runtime acquisition; unclassified read failures carry CALLBACK_FAILED with the original error retained.',
        '返回携带 `TPublicSurface` 的规范冻结句柄，领域表面默认空。运行时获取前捕获表面选项及自有描述符；读取未分类失败附 `CALLBACK_FAILED` 并保留原错。'
      ),
      options: 'IDefineHostOptions',
      example: `import { defineHost } from '@migaia/plugin-host'

const surface = { ping: () => 'pong' }
const host = defineHost<{ send(text: string): void }, string, readonly [], typeof surface>({
  host: { ${execution} },
  surface,
  domainCore: () => ({ send: (text) => console.log('send', text) })
})
const same = host.usePipeline((value, next) => next(value.trim()))
console.log(same === host, same.ping())
await host.runPipeline('  hello  ', (value) => console.log(value)) // hello
await host.dispose()`
    },
    definePlugin: {
      role: 'enhancer',
      purpose: t(
        'Defines a plugin without installing it. Function form `definePlugin(name, (core) => ({ install, expose, featureExpose }), features?)` builds a fresh descriptor per install; object form `definePlugin({ name, config, setup, install, features, update, dispose, ... })` also declares configuration and lifecycle hooks. Nothing runs until `host.use(plugin)`.',
        '定义插件但不安装。函数形式 `definePlugin(name, (core) => ({ install, expose, featureExpose }), features?)` 每次安装都生成新的描述；对象形式 `definePlugin({ name, config, setup, install, features, update, dispose, ... })` 还可声明配置和生命周期钩子。在 `host.use(plugin)` 之前不会执行任何代码。'
      ),
      params: {
        name: t('Plugin name (function form).', '插件名称（函数形式）。'),
        descriptorFactory: t(
          'Function form: receives the install core and returns `{ install, expose?, featureExpose? }` for one installation.',
          '函数形式：接收安装时的 core，返回本次安装的 `{ install, expose?, featureExpose? }`。'
        ),
        featureRecord: t(
          'Function form: Features this plugin provides or consumes.',
          '函数形式：本插件提供或消费的 Feature。'
        ),
        definition: t('Object form: the whole plugin definition.', '对象形式：完整的插件定义对象。')
      },
      returns: t(
        'A plugin definition (`IDefinedPluginConstraint`) with `name`, the declared fields, and `getFeature(name)` for consumers. Invalid fields throw `INVALID_OPTION`; retired fields such as `shared` throw `PLUGIN_DEFINITION_INVALID`.',
        '插件定义（`IDefinedPluginConstraint`），带有 `name`、声明的字段，以及供消费者使用的 `getFeature(name)`。字段不合法抛 `INVALID_OPTION`；已退役的字段（如 `shared`）抛 `PLUGIN_DEFINITION_INVALID`。'
      ),
      example: `import { definePlugin } from '@migaia/plugin-host'

const health = definePlugin('health', () => ({ install: () => ({ check: () => ({ ok: true }) }) }))
const prefix = definePlugin({
  name: 'prefix',
  config: { prefix: '[app]' },
  install: (core) => ({ format: (text: string) => \`\${core.config.get().prefix} \${text}\` })
})`
    },
    defineFeature: {
      role: 'enhancer',
      purpose: t(
        'Defines a Feature: a capability one plugin provides to other plugins. The factory receives the provider core (with `featureExpose`) and the outputs of the Features it depends on, and returns the Feature output.',
        '定义 Feature：一个插件提供给其它插件的能力。工厂函数收到 provider 的 core（含 `featureExpose`）以及它所依赖的 Feature 输出，返回该 Feature 的输出。'
      ),
      params: {
        factory: t(
          '`(core, dependencies) => output`.',
          '工厂函数 `(core, dependencies) => output`。'
        ),
        dependencies: t(
          'Feature references this Feature needs, e.g. `{ clock: clockPlugin.getFeature("clock") }`.',
          '该 Feature 依赖的 Feature 引用，例如 `{ clock: clockPlugin.getFeature("clock") }`。'
        ),
        descriptor: t(
          'Object form `{ factory, dependencies }`.',
          '对象形式 `{ factory, dependencies }`。'
        )
      },
      returns: t(
        'An `IFeature` to put in a plugin `features` record.',
        '一个 `IFeature`，放进插件的 `features` 中使用。'
      ),
      example: `const format = defineFeature((core: { featureExpose: { format(text: string): string } }) => ({
  format: core.featureExpose.format
}))`
    },
    asyncDisposeKey: {
      role: 'constant',
      purpose: t(
        'The key for asynchronous disposal: the native `Symbol.asyncDispose` when the runtime has it, otherwise a package fallback symbol. Use it as the method name of async resources passed to `core.onDispose()`.',
        '异步释放所用的键：运行时支持时就是原生 `Symbol.asyncDispose`，否则是本包提供的替代 symbol。把它作为异步资源的方法名，再交给 `core.onDispose()`。'
      ),
      example: `core.onDispose({ [asyncDisposeKey]: async () => await pool.end() })`
    },
    getPluginRuntimeIntegration: {
      role: 'operation',
      purpose: t(
        'For runtime adapter plugins (RPC families): returns the integration port of the exact core a host minted for this install, giving host identity, Feature reads and shared extension slots. Any other object throws `PLUGIN_DEFINITION_INVALID`.',
        '供运行时适配插件（RPC 系列）使用：返回宿主为本次安装生成的那个 core 的集成端口，提供宿主身份、Feature 读取和共享扩展槽位。传入其它对象抛 `PLUGIN_DEFINITION_INVALID`。'
      ),
      params: {
        core: t(
          'The `core` passed to `install()`.',
          '插件 `install()` 收到的那个 `core` 对象本身。'
        )
      },
      returns: t(
        'An `IPluginRuntimeIntegration`.',
        '一个运行时集成端口 `IPluginRuntimeIntegration`。'
      ),
      example: `install: (core) => {
  const integration = getPluginRuntimeIntegration(core)
  console.log(integration.identity.name)
  return {}
}`
    },
    isDefinedPlugin: {
      role: 'operation',
      purpose: t(
        'Tells whether a value is a plugin definition created by `definePlugin()` in this package copy.',
        '判断某个值是否是本包（同一份副本）的 `definePlugin()` 创建的插件定义。'
      ),
      params: { value: t('Any value.', '要检查的任意值。') },
      returns: t(
        '`true` for definitions from `definePlugin()`.',
        '由 `definePlugin()` 创建的定义返回 `true`。'
      ),
      example: `if (!isDefinedPlugin(candidate)) throw new TypeError('不是插件定义')`
    },
    isPluginHandleCurrent: {
      role: 'operation',
      purpose: t(
        'Tells whether a handle still refers to the registration it was created for. Disabled and suspended registrations count as current; removed, replaced or disposed ones do not.',
        '判断某个句柄是否仍指向创建它时的那次注册。被禁用或挂起的注册仍算有效；已卸载、被替换或宿主已释放则无效。'
      ),
      params: {
        handle: t(
          'A handle returned by `use()` / `activate()` / `replace()`.',
          '`use()` / `activate()` / `replace()` 返回的句柄。'
        )
      },
      returns: t(
        '`true` while the handle names the same registration.',
        '句柄仍指向同一次注册时返回 `true`。'
      ),
      example: `if (!isPluginHandleCurrent(handle)) handle = (await host.use(plugin))[0]`
    },
    PluginHostDisposalNodeKind: {
      role: 'constant',
      purpose: t(
        'Kinds of cleanup error nodes reported by `readPluginHostDisposalProvenance()`: `host-error` (an error created by the host), `aggregate` (several failures combined) and `disposer-wrapper` (a wrapper around a failing disposer).',
        '`readPluginHostDisposalProvenance()` 报告的清理错误节点种类：`host-error`（宿主创建的错误）、`aggregate`（多个失败的汇总）和 `disposer-wrapper`（包裹某个失败清理函数的错误）。'
      ),
      example: `const provenance = readPluginHostDisposalProvenance(error)
if (provenance?.kind === PluginHostDisposalNodeKind.aggregate) console.log('汇总错误')`
    },
    PluginHostError: {
      role: 'error',
      params: {
        code: t(
          'Stable IPluginHostErrorCode selected from PluginHostErrorCode for the actual Host failure.',
          '从本包错误码表选择、对应实际宿主失败的稳定错误码。'
        ),
        message: t(
          'Caller-authored concrete diagnostic text passed to the native Error constructor.',
          '调用方编写、传给原生错误构造器的具体诊断文本。'
        )
      },
      returns: t(
        'A PluginHostError carrying the package source, selected code, original cause and optional detail. Construction returns the error without throwing it.',
        '返回携带本包来源、所选错误码、原始原因与可选诊断详情的宿主错误；构造本身不主动抛出该错误。'
      ),
      optionDocs: {
        detail: {
          summary: t(
            'Structured diagnostics supplied by the error creator, retained separately from the original `cause`.',
            '错误创建方提供的结构化诊断信息，与原始错误 `cause` 分开保存。'
          ),
          default: t(
            'Not set: no structured detail is attached.',
            '不设置：错误不附带结构化诊断信息。'
          )
        }
      },
      purpose: t(
        'Host state/protocol error class, also used for invalid configuration data (INVALID_CONFIG_VALUE) and cycles (CONFIG_CYCLE_REJECTED). Ordinary name/path/stage/extension/domain-core/resource validation uses native TypeError/INVALID_OPTION; retired definition fields use TypeError/PLUGIN_DEFINITION_INVALID. Branch on source/code and native type; cause and detail retain originals and structured context.',
        '宿主状态及协议错误类，也用于非法配置值与配置循环。普通名称、路径、步骤、扩展、领域内核及资源校验用原生 `TypeError/INVALID_OPTION`，退役定义字段用 `TypeError/PLUGIN_DEFINITION_INVALID`。按来源、错误码与原生类型判断，原因与诊断详情保留原错及上下文。'
      ),
      example: `try {
  await host.use(broken)
} catch (error) {
  if (error instanceof PluginHostError && error.code === 'PLUGIN_INSTALL_FAILED') console.error(error.detail?.failedName, error.cause)
}`
    },
    ERROR_TEXT: {
      role: 'constant',
      purpose: t(
        'Canonical English error text and message factories exported by the root entry. Downstream diagnostic adapters can reuse stable Host wording; error handling still branches on source/code rather than comparing message text.',
        '根入口导出的规范英文错误文案及消息工厂，下游诊断适配可复用稳定宿主措辞；错误处理仍按来源及错误码分类，不比较消息文本。'
      ),
      example: `import { ERROR_TEXT } from '@migaia/plugin-host'
console.log(ERROR_TEXT.HOST_DISPOSED)`
    },
    PluginHostErrorCode: {
      role: 'error',
      purpose: t(
        'The 44 Host error and diagnostic codes. Host protocol and configuration-domain failures use PluginHostError; input/definition validation preserves native TypeError. CALLBACK_FAILED classifies otherwise unowned callback or surface-descriptor failures while preserving writable native identity, immutable/non-Error cause and existing foreign ownership. Diagnostic-only codes reach diagnostic instead of being thrown.',
        '宿主共四十四个错误及诊断码；协议与配置域使用宿主错误，输入及定义校验保留原生类型。`CALLBACK_FAILED` 分类未归属回调或表面描述符失败，可写原生对象保持身份，不可修改或非错误值保留在原因上，外包身份不改写；仅诊断的码经回调报告。'
      ),
      example: `if ((error as { code?: string }).code === PluginHostErrorCode.prerequisiteMissing) await host.use(provider)`
    },
    PluginHostRegistrationLifecycle: {
      role: 'constant',
      purpose: t(
        'Phases of one registration used to guard plugin-owned resources: `idle`, `install` (resources may be registered) and `dispose`.',
        '单次注册的生命周期阶段，用于守护插件拥有的资源：`idle`、`install`（此时可以登记资源）和 `dispose`。'
      ),
      example: `console.log(PluginHostRegistrationLifecycle.install) // 'install'`
    },
    PluginHostStatus: {
      role: 'constant',
      purpose: t(
        'Lifecycle status of a host: `active` (accepts changes), `closing` (disposal started) and `disposed` (terminal).',
        '宿主的生命周期状态：`active`（可接受变更）、`closing`（已开始释放）和 `disposed`（终态）。'
      ),
      example: `console.log(PluginHostStatus.closing) // 'closing'`
    },
    readPluginDependencies: {
      role: 'operation',
      purpose: t(
        'Reads which providers a plugin depends on, from its Feature references, without running setup, install or Feature factories. Providers appear in first-reference order; a provider referenced both required and optional is `required: true`.',
        '根据插件的 Feature 引用读出它依赖哪些 provider，不会执行 setup、install 或 Feature 工厂。provider 按第一次引用的顺序排列；同时被必需和可选引用的 provider 记为 `required: true`。'
      ),
      params: {
        plugin: t(
          'A definition, a raw descriptor, or a composition admission.',
          '插件定义、原始描述对象，或 composition 的准入快照。'
        )
      },
      returns: t(
        'A read-only `{ provider, required }[]`.',
        '只读的 `{ provider, required }[]` 列表。'
      ),
      example: `readPluginDependencies(writer) // [{ provider: 'formatter', required: true }]`
    },
    readPluginHostDisposalProvenance: {
      role: 'operation',
      purpose: t(
        'For logs and audits: reads how a cleanup error was produced (kind and phase) if this package copy produced it; unknown errors return `undefined`. Do not use it instead of `source` / `code` / `cause` handling.',
        '用于日志和审计：如果清理错误由本包（同一份副本）产生，读出它的来源种类和阶段；未知错误返回 `undefined`。不要用它代替按 `source` / `code` / `cause` 的错误处理。'
      ),
      params: {
        value: t(
          'An error from `cleanupErrors` or `errors`.',
          '来自 `cleanupErrors` 或 `errors` 的错误。'
        )
      },
      returns: t(
        '`{ kind, phase? }`, or `undefined`.',
        '`{ kind, phase? }`，无法识别时为 `undefined`。'
      ),
      example: `for (const error of result.cleanupErrors) console.log(readPluginHostDisposalProvenance(error))`
    },
    createView: {
      role: 'operation',
      purpose: t(
        'Returns an extension-only view of one registration token. Repeated calls return the same function references; the view keeps working while the plugin is disabled and is revoked when it is removed.',
        '返回某个注册凭证的只含扩展的视图。多次调用返回同一组函数引用；插件被禁用时视图仍可使用，插件卸载后视图失效。'
      ),
      params: {
        token: t(
          'Registration token (receipt) from `commitPreparedAdmissions()`.',
          '`commitPreparedAdmissions()` 返回的注册凭证。'
        )
      },
      returns: t(
        '`{ extensions }` of that registration; foreign or revoked tokens throw.',
        '该注册的 `{ extensions }`；来自其它宿主或已撤销的凭证会抛错。'
      ),
      example: `const view = createView(receipt)
view.extensions.query('migaia')`
    },
    inspectFeatures: {
      role: 'operation',
      purpose: t(
        'Lists a Feature record and every Feature it transitively depends on, in dependency order, without running factories. Composition owners use it to plan installs.',
        '列出一组 Feature 及其传递依赖的全部 Feature（按依赖顺序），不执行任何工厂函数。组合方用它规划安装顺序。'
      ),
      params: { roots: t('A plugin `features` record.', '插件的 `features` 记录。') },
      returns: t('`{ roots, ordered }`.', '包含 `roots` 与按依赖顺序排列的 `ordered`。'),
      example: `const { ordered } = inspectFeatures(writer.features ?? {})`
    },
    isManagedHost: {
      role: 'operation',
      purpose: t(
        'Tells whether a value is a host constructed by this package copy. Prefer it to `instanceof`, which fails across package copies and for `defineHost()` handles.',
        '判断某个值是否为本包（同一份副本）构造的宿主。优先使用它而不是 `instanceof`，后者在多份包副本和 `defineHost()` 句柄上会失效。'
      ),
      params: { target: t('Any value.', '要检查的任意值。') },
      returns: t('`true` for hosts of this package copy.', '本包构造的宿主返回 `true`。'),
      example: `if (isManagedHost(target)) openComposition(target)`
    },
    openComposition: {
      role: 'operation',
      purpose: t(
        'Opens the composition port of a managed host for its single composition owner. Other values throw `COMPOSITION_TARGET_UNMANAGED`.',
        '为唯一的组合所有者打开托管宿主的组合端口。传入其它值抛 `COMPOSITION_TARGET_UNMANAGED`。'
      ),
      params: { target: t('A host built by this package.', '由本包构造的宿主。') },
      returns: t(
        'An `IPluginHostCompositionIntegration`.',
        '一个组合端口 `IPluginHostCompositionIntegration`。'
      ),
      example: `const port = openComposition(host)
const admission = port.createPluginAdmission(plugin)`
    }
  },
  types: {
    PluginHost: {
      summary: t(
        `A plugin-capable host. Its own API manages plugins and stages; domain capabilities come from the plugins installed into it. ${stageLifetime.host.en}`,
        `可插件化的宿主。它自身的 API 负责管理插件和步骤；领域能力来自安装进来的插件。 ${stageLifetime.host.zh}`
      ),
      scenarios: hostScenarios,
      example: hostExample,
      members: hostMembers
    },
    IHostHandle: {
      summary: t(
        `Canonical frozen handle returned by defineHost<TDomainCore, TValue, TInstalled, TPublicSurface>. The fourth generic defaults to an empty public surface. Domain members, live accessors and issued identity belong to this same handle; fluent use*Pipeline returns it unchanged. ${stageLifetime.host.en}`,
        `函数宿主返回的规范冻结句柄；第四泛型为默认空的领域公开表面，领域成员、实时访问器及已签发身份同属原句柄，管线链式方法返回原对象。 ${stageLifetime.host.zh}`
      ),
      scenarios: [
        t(
          'A function-style library adds plugin support without a class hierarchy.',
          '函数式风格的库在不引入类继承的情况下获得插件能力。'
        )
      ],
      example: `const host = defineHost<Record<string, never>, string>({ host: { ${execution} } })
host.usePipeline((value, next) => next(value.toUpperCase()))
await host.runPipeline('ok', (value) => console.log(value)) // OK
await host.dispose()`,
      members: hostMembers
    },
    IPluginHostOptions: {
      summary: t(
        'Options of a host (`new PluginHost(options)` and `defineHost({ host })`).',
        '宿主的构造选项，用于 `new PluginHost(options)` 以及 `defineHost({ host })`。'
      ),
      members: {
        identity: {
          summary: t(
            'Readable host name `{ name }`; a unique id is added by the runtime.',
            '宿主的可读名称 `{ name }`；运行时会另外分配唯一 id。'
          ),
          default: t(
            'Not set: the host is unnamed and identified only by its id.',
            '不设置：宿主没有名称，只用 id 区分。'
          )
        },
        'identity.name': {
          summary: t(
            'Readable host name used in errors and diagnostics.',
            '宿主的可读名称，出现在错误与诊断信息中。'
          ),
          default: t(
            'Not set: diagnostics use the generated id instead of a readable name.',
            '省略可读名称时，诊断信息使用运行时分配的 id。'
          )
        },
        'execution.mutationTimeoutMs': {
          summary: t(
            'Mutation budget for installation/setup and update hooks; expiry aborts the operation and rolls back with MUTATION_EXECUTION_TIMEOUT. Removal hooks and disposers instead use disposeStepTimeoutMs, while pipeline draining uses its separate budget. false disables this mutation deadline.',
            '安装、准备及更新钩子的变更预算；到期取消操作并以 `MUTATION_EXECUTION_TIMEOUT` 回滚。卸载钩子及释放步骤另用 `disposeStepTimeoutMs`，管线排空使用独立预算；传 `false` 关闭变更期限。'
          )
        },
        'execution.pipelineDrainTimeoutMs': {
          summary: t(
            'Maximum time to wait for running pipelines before removal or replacement continues; `false` waits until none are running.',
            '卸载或替换前等待正在运行的 pipeline 结束的最长时间；传 `false` 表示一直等到全部结束。'
          )
        },
        execution: {
          summary: t(
            'Required execution budgets: mutationTimeoutMs bounds setup/install/update; pipelineDrainTimeoutMs bounds pipeline draining and is a shared managed-removal cleanup deadline. Ordinary removal steps use disposeStepTimeoutMs. false disables the corresponding deadline.',
            '必填执行预算：变更时限约束准备、安装及更新，排空时限约束管线且作为托管卸载共享清理期限；普通卸载步骤用独立步骤时限，传 `false` 关闭对应期限。'
          )
        },
        pipeline: {
          summary: t(
            'Pipeline mode `{ mode }`; fixed after construction.',
            'pipeline 模式配置 `{ mode }`，决定步骤的形状与执行方式，构造后不能更改。'
          ),
          default: t('`{ mode: "sync" }`.', '`{ mode: "sync" }`，同步模式。')
        },
        diagnostic: {
          summary: t(
            'Receives notable events that are not errors (`PIPELINE_NEXT_LATE`, `EXTENSION_NON_ENUMERABLE_IGNORED`, rollback failures, queue waits) as `(message, code?, error?)`. Its own failures never affect the host.',
            '接收值得关注但不构成错误的事件（`PIPELINE_NEXT_LATE`、`EXTENSION_NON_ENUMERABLE_IGNORED`、回滚失败、排队等待等），参数为 `(message, code?, error?)`。它自身出错不会影响宿主。'
          ),
          default: t('Not set: diagnostics are dropped.', '不设置：诊断信息被丢弃。')
        },
        onDiagnosticFailure: {
          summary: t(
            'Receives the error when `diagnostic` itself throws or rejects.',
            '`diagnostic` 自身抛错或 reject 时，接收那个错误。'
          ),
          default: t(
            'Not set: the failure goes to `globalThis.reportError` when it exists.',
            '不设置：交给 `globalThis.reportError`（如果存在）。'
          )
        },
        scheduler: {
          summary: t(
            'Clock and timers for queue and disposal timeouts; inject a manual scheduler in tests.',
            '队列与清理超时使用的时钟和计时器；测试中可注入手动调度器。'
          ),
          default: t('The system scheduler.', '系统调度器 `systemScheduler`。')
        },
        queueAdmissionTimeoutMs: {
          summary: t(
            'How long a change may wait in the FIFO queue. A number rejects waiting work with `MUTATION_QUEUE_TIMEOUT` (running work is not interrupted); `false` disables queue timers and diagnostics.',
            '变更在先进先出队列中最多等待多久。传数值时，等待超时的工作以 `MUTATION_QUEUE_TIMEOUT` 被拒绝（正在执行的工作不受影响）；传 `false` 关闭所有排队计时与诊断。'
          ),
          default: t(
            'Not set: long waits are only reported through `diagnostic`, never rejected.',
            '不设置：等待过久只经 `diagnostic` 提示，永远不会被拒绝。'
          )
        },
        queueAdmissionDiagnosticMs: {
          summary: t(
            'Wait time after which a queued change is reported through `diagnostic` (only when `queueAdmissionTimeoutMs` is not set); `false` disables it.',
            '变更排队超过多久后经 `diagnostic` 提示（仅在未设置 `queueAdmissionTimeoutMs` 时生效）；`false` 关闭。'
          ),
          default: t('`1000` milliseconds.', '`1000` 毫秒：排队超过 1 秒时提示一次。')
        },
        disposeStepTimeoutMs: {
          summary: t(
            'Maximum wait for one cleanup step (a stage disposer, a plugin `dispose`, a resource). A timed-out step is recorded as `DISPOSE_STEP_TIMEOUT` and cleanup continues; `false` waits forever.',
            '单个清理步骤（步骤清理函数、插件 `dispose`、资源释放）的最长等待时间。超时的步骤记为 `DISPOSE_STEP_TIMEOUT` 并继续后续清理；`false` 表示一直等待。'
          ),
          default: t('`5000` milliseconds per step.', '每个步骤 `5000` 毫秒。')
        }
      }
    },
    IDefineHostOptions: {
      summary: t(
        'Options of `defineHost()`.',
        '`defineHost()` 的选项：宿主选项加上替代子类重写的领域钩子。'
      ),
      members: {
        host: {
          summary: t(
            'The same options a `PluginHost` constructor takes.',
            '与 `PluginHost` 构造函数相同的宿主选项。'
          )
        },
        surface: {
          summary: t(
            'Domain public members installed on the canonical handle using own descriptors captured once before Runtime creation. Accessors stay live; canonical Host keys, including identity, remain reserved and take precedence. TPublicSurface defaults to an empty object.',
            '运行时创建前单次捕获领域表面的自有描述符，安装到规范句柄；访问器保持实时，包含身份在内的宿主规范键保留且优先，领域表面泛型默认空对象。'
          ),
          default: t(
            'Absent: the handle has no additional domain public members.',
            '省略时句柄不增加领域公开成员。'
          )
        },
        domainCore: {
          summary: t(
            'Creates the domain core each plugin install receives; replaces `createPluginDomainCore()`.',
            '为每次插件安装创建领域 core，替代子类的 `createPluginDomainCore()`。'
          ),
          default: t(
            'Not set: plugins receive an empty domain core.',
            '不设置：插件收到空的领域 core。'
          )
        },
        translateDisposalError: {
          summary: t(
            'Maps host disposal errors to a domain error type.',
            '把宿主释放过程中的错误转换为领域错误类型。'
          ),
          default: t('Not set: errors are kept as they are.', '不设置：错误保持原样。')
        },
        dispose: {
          summary: t(
            'Wraps disposal: call next exactly once. Completion is published before middleware runs, so reentrant calls share it and middleware runs once. Unclassified callback failures receive CALLBACK_FAILED; native identity or original cause remains reachable.',
            '包装释放时须恰好调用一次 `next`；中间件执行前发布完成对象，重入调用共享它且中间件仅执行一次。未分类回调失败附 `CALLBACK_FAILED`，原生身份或原始原因可追溯。'
          ),
          default: t('Not set: plain host disposal.', '不设置：直接执行宿主释放。')
        }
      }
    },
    IPlugin: {
      summary: t(
        'Shape of a plugin definition: name, configuration, Features, activation mode and lifecycle hooks.',
        '插件定义的结构：名称、配置、Feature、激活方式和生命周期钩子。'
      ),
      members: pluginMembers
    },
    IPluginConstraint: {
      summary: t(
        'Structural constraint every installable plugin satisfies.',
        '每个可安装插件都满足的结构约束，供泛型参数使用。'
      ),
      members: {
        ...pluginMembers,
        setup: {
          summary: t(
            'Optional setup-branch callback receiving `IPluginSetupContext`; its value or thenable supplies setup output to later hooks, and failure rolls back registration.',
            '可选初始化分支回调，接收 `IPluginSetupContext`；返回值或异步结果传给后续钩子，失败则回滚注册。'
          ),
          params: {
            context: t(
              'Setup context supplied by the host, including the operation signal and provisional resource ownership.',
              '宿主提供的初始化上下文，包含操作信号和临时资源所有权。'
            )
          },
          returns: t(
            'Setup output, optionally asynchronous, retained for feature exposure and install.',
            '初始化输出，可为异步结果，保留给特性暴露与安装阶段。'
          ),
          example: `const plugin = definePlugin({ name: 'session', setup: () => ({ value: 1 }), install: (_core, output) => ({ read: () => output.value }) })
await host.use(plugin)`
        },
        featureExpose: {
          summary: t(
            'Value or callback publishing this plugin’s Feature input surface. A callback receives the host core and optional setup output; return the exposure object synchronously.',
            '发布此插件特性输入表面的值或回调。回调接收宿主核心及可选初始化输出，应同步返回暴露对象。'
          ),
          params: {
            core: t(
              'Host-supplied lifecycle core for this registration.',
              '宿主为此次注册提供的生命周期核心。'
            ),
            setupOutput: t(
              'Output returned by this plugin’s setup hook, absent for the plain hook branch.',
              '此插件初始化钩子返回的输出；普通钩子分支不提供。'
            )
          },
          returns: t(
            'Synchronous Feature exposure object used by dependent Features.',
            '依赖特性使用的同步特性暴露对象。'
          ),
          example: `const plugin = definePlugin({ name: 'clock', featureExpose: { now: () => Date.now() }, install: () => ({}) })
await host.use(plugin)`
        },
        install: {
          summary: t(
            'Required installation callback receiving the registration core and optional setup output. Its returned extension object is published only after the installation batch commits.',
            '必填安装回调，接收注册核心与可选初始化输出。返回的扩展对象仅在安装批次提交后发布。'
          ),
          params: {
            core: t(
              'Host-provided hook core with lifecycle registration and resolved Feature outputs.',
              '宿主提供的钩子核心，包含生命周期登记和已解析特性输出。'
            ),
            setupOutput: t(
              'Value returned by setup when using the setup branch, otherwise absent.',
              '使用初始化分支时由初始化返回的值，否则缺失。'
            )
          },
          returns: t(
            'Extension record or thenable of it; throw or rejection rolls back the installation batch.',
            '扩展记录或其异步结果；抛错或拒绝会回滚安装批次。'
          ),
          example: `const plugin = definePlugin({ name: 'answer', install: () => ({ value: () => 42 }) })
await host.use(plugin)`
        }
      }
    },
    IDefinedPluginConstraint: {
      summary: t(
        'The definition returned by `definePlugin()`: every `IPlugin` field plus `getFeature(name)` for consumers that depend on this plugin.',
        '`definePlugin()` 返回的插件定义：具备 `IPlugin` 的全部字段，另外提供 `getFeature(name)` 供依赖它的消费者使用。'
      ),
      scenarios: [
        t(
          'Pass it to `host.use()` (or a host `plugins` option) to install.',
          '交给 `host.use()`（或宿主的 `plugins` 选项）进行安装。'
        ),
        t(
          'Reference one of its Features from another plugin with `getFeature()`.',
          '在另一个插件中用 `getFeature()` 引用它的某个 Feature。'
        )
      ],
      example: {
        en: `const formatter = definePlugin({
  name: 'formatter',
  config: { prefix: '[app]' },
  activation: 'lazy',
  features: { format },
  featureExpose: (core) => ({ format: (text: string) => \`\${core.config.get().prefix} \${text}\` }),
  install: () => ({}),
  update: (next) => console.log('prefix ->', next.prefix),
  beforeRelease: async () => console.log('releasing'),
  dispose: () => console.log('disposed')
})
const ref = formatter.getFeature('format') // reference for consumers
await host.use(formatter)
await host.activate('formatter') // lazy: installs now`,
        zh: `const formatter = definePlugin({
  name: 'formatter',
  config: { prefix: '[app]' },
  activation: 'lazy',
  features: { format },
  featureExpose: (core) => ({ format: (text: string) => \`\${core.config.get().prefix} \${text}\` }),
  install: () => ({}),
  update: (next) => console.log('前缀改为', next.prefix),
  beforeRelease: async () => console.log('即将释放'),
  dispose: () => console.log('已释放')
})
const ref = formatter.getFeature('format') // 供消费者使用的引用
await host.use(formatter)
await host.activate('formatter') // 惰性插件：此时才安装`
      },
      members: {
        ...pluginMembers,
        getFeature: {
          summary: t(
            'Creates a reference to one Feature this plugin declares, for use in another plugin `defineFeature(factory, { name: reference })`. The reference makes this plugin a provider the consumer depends on.',
            '创建一个指向本插件所声明 Feature 的引用，供其它插件在 `defineFeature(factory, { name: reference })` 中使用。引用使本插件成为消费者依赖的 provider。'
          ),
          params: {
            name: t(
              'Name of a Feature in this plugin `features` record.',
              '本插件 `features` 中某个 Feature 的名称。'
            ),
            options: t(
              '`{ optional: true }` makes the dependency optional: the consumer installs even without this provider.',
              '`{ optional: true }` 把依赖设为可选：没有该 provider 时消费者也能安装。'
            )
          },
          returns: t(
            'An `IFeatureReference` (provider name, feature name, optional flag). Unknown names throw `FEATURE_NOT_DECLARED`.',
            '一个 `IFeatureReference`（包含 provider 名称、Feature 名称、是否可选）。名称不存在时抛 `FEATURE_NOT_DECLARED`。'
          ),
          example: `const consumerFormat = defineFeature((_core, deps) => deps.format, {
  format: formatter.getFeature('format')
})`
        }
      }
    },
    IPluginHandle: {
      summary: t(
        'Handle of one installed plugin, returned by `host.use()` (one per plugin, in input order), `activate()` and `replace()`. It is addressed by plugin name, so after `replace()` the same handle reaches the new registration; reading it after removal throws.',
        '某个已安装插件的句柄，由 `host.use()`（每个插件一个，顺序与传入一致）、`activate()`、`replace()` 返回。句柄按插件名称寻址，所以 `replace()` 之后同一个句柄指向新的注册；插件被移除后再读取会抛错。'
      ),
      scenarios: [
        t(
          'Call the API a plugin added (`handle.extensions`) with full types after `await host.use(plugin)`.',
          '`await host.use(plugin)` 之后通过 `handle.extensions` 调用插件新增的 API，并保有完整类型。'
        ),
        t(
          'Read a Feature output that another plugin declared, or change one plugin configuration at runtime.',
          '读取某个插件声明的 Feature 输出，或在运行时修改单个插件的配置。'
        )
      ],
      example: {
        en: `const [levelHandle] = await logger.use(level({ level: 'info' }))
levelHandle.extensions.warn('disk almost full')
await levelHandle.config.update((previous) => ({ ...previous, level: 'debug' }))
console.log(levelHandle.name) // 'level'`,
        zh: `const [levelHandle] = await logger.use(level({ level: 'info' }))
levelHandle.extensions.warn('磁盘空间不足')
await levelHandle.config.update((previous) => ({ ...previous, level: 'debug' }))
console.log(levelHandle.name) // 'level'`
      },
      members: {
        name: {
          summary: t(
            'Name of the plugin this handle addresses: the `name` field of the plugin definition passed to `use()`.',
            '该句柄指向的插件名称，即传给 `use()` 的插件定义上的 `name` 字段。'
          )
        },
        extensions: {
          summary: t(
            'The API object the plugin `install` (and `expose`) returned, with full types. Reading it throws `PLUGIN_NOT_INSTALLED` after removal, `PLUGIN_DISABLED` while disabled and `PLUGIN_SUSPENDED` while suspended.',
            '插件 `install`（及 `expose`）返回的 API 对象，带完整类型。插件被移除后读取抛 `PLUGIN_NOT_INSTALLED`，被禁用时抛 `PLUGIN_DISABLED`，被暂停时抛 `PLUGIN_SUSPENDED`。'
          )
        },
        getFeature: {
          summary: t(
            'Reads the current output object of one Feature that the plugin declares in its `features` field. The plugin must be installed and enabled.',
            '读取该插件在 `features` 字段中声明的某个 Feature 的当前输出对象。插件必须处于已安装且已启用的状态。'
          ),
          params: {
            name: t(
              'A key of the `features` object given to `definePlugin()` for this plugin (for example `color` for a plugin whose definition has `features: { color: colorFeature }`).',
              '该插件在 `definePlugin()` 时给出的 `features` 对象中的键（例如定义里写了 `features: { color: colorFeature }`，这里就传 `color`）。'
            )
          },
          returns: t(
            'The Feature output object, the same object other plugins receive as a dependency. An undeclared name throws `FEATURE_NOT_DECLARED`; a removed or disabled plugin throws `PLUGIN_NOT_INSTALLED` / `PLUGIN_DISABLED`.',
            'Feature 的输出对象，与其它插件作为依赖收到的是同一个对象。名称未声明时抛 `FEATURE_NOT_DECLARED`；插件已移除或已禁用时抛 `PLUGIN_NOT_INSTALLED` / `PLUGIN_DISABLED`。'
          ),
          example: `const [colorHandle] = await logger.use(color())
const { paint } = colorHandle.getFeature('color') as { paint: (tag: string, text: string) => string }
console.log(paint('info', 'ready'))`
        },
        config: {
          summary: t(
            'Configuration access limited to this plugin: `get()` reads the committed configuration, `update(recipe)` changes it. See `IPluginHandleConfig`.',
            '只作用于该插件的配置访问：`get()` 读取已提交的配置，`update(recipe)` 修改配置。详见 `IPluginHandleConfig`。'
          )
        }
      }
    },
    IPluginHandleConfig: {
      summary: t(
        'The `config` object of a plugin handle; reads and writes only the configuration of that one plugin.',
        '插件句柄上的 `config` 对象；只读写这一个插件的配置。'
      ),
      members: {
        get: {
          summary: t(
            'Reads the committed, frozen configuration of the plugin (the object given to the plugin factory, merged with later updates).',
            '读取该插件已提交、已冻结的配置（即传给插件工厂函数的配置，合并了之后的更新）。'
          ),
          returns: t(
            'The frozen configuration snapshot; do not modify it.',
            '冻结的配置快照，不要修改它。'
          ),
          example: `const { level } = levelHandle.config.get()`
        },
        update: {
          summary: t(
            'Computes a patch from the current configuration, merges it shallowly, runs the plugin `update` hook, and commits only if the hook succeeds.',
            '根据当前配置计算补丁并浅合并，执行插件的 `update` 钩子，钩子成功后才提交。'
          ),
          params: {
            recipe: t(
              'Synchronous `(previous) => patch`; `previous` is the configuration returned by `get()`, the patch holds only the changed keys.',
              '同步函数 `(previous) => patch`；`previous` 是 `get()` 返回的当前配置，补丁只需包含要修改的键。'
            )
          },
          returns: t(
            'Resolves after the commit; rejects and keeps the old configuration when the hook fails.',
            '提交后 resolve；钩子失败时 reject，并保留旧配置。'
          ),
          example: `await levelHandle.config.update(() => ({ level: 'warn' }))`
        }
      }
    },
    IPluginHostConfigFor: {
      summary: t('The `host.config` store.', '`host.config` 配置仓库，按插件名读取与更新配置。'),
      members: {
        get: {
          summary: t(
            'Reads a configuration value by path; unknown plugins or paths return `undefined`.',
            '按路径读取配置值；插件或路径不存在时返回 `undefined`。'
          ),
          params: {
            path: t(
              '`plugin`, `plugin.key` or `plugin.[index].key`.',
              '读取路径：`plugin`、`plugin.key` 或 `plugin.[下标].key`。'
            )
          },
          returns: t('A frozen value, or `undefined`.', '冻结的值，或 `undefined`。')
        },
        update: {
          summary: t(
            'Merges a patch into one plugin configuration; unknown plugins throw `PLUGIN_NOT_INSTALLED`.',
            '把补丁合并进某个插件的配置；插件不存在时抛 `PLUGIN_NOT_INSTALLED`。'
          ),
          params: {
            name: t('Plugin name.', '要更新配置的插件名。'),
            recipe: t(
              '`(previous) => patch`, synchronous, returning a plain object.',
              '同步函数 `(previous) => patch`，返回普通对象。'
            )
          },
          returns: t(
            'Resolves after commit; the old configuration stays when the plugin `update` hook fails.',
            '提交后 resolve；插件的 `update` 钩子失败时保留旧配置。'
          )
        }
      }
    },
    IPluginEnablement: {
      summary: t(
        'The `host.plugin` controls. Disabling is not removal: the registration and its resources stay, only reachability changes.',
        '`host.plugin` 启用/禁用控制。禁用不是卸载：注册和资源都保留，只改变是否可用。'
      ),
      members: {
        disable: {
          summary: t(
            'Hides a plugin extensions, Features and stages.',
            '隐藏某个插件的 extension、Feature 和步骤。'
          ),
          params: {
            name: t('Plugin name.', '要禁用的插件名。'),
            options: t(
              'Same `policy` / `dryRun` options as `unUse`.',
              '与 `unUse` 相同的 `policy` / `dryRun` 选项。'
            )
          },
          returns: t(
            '`{ token }` to restore exactly this disable, or a plan for `dryRun: true`.',
            '`{ token }`，用于精确撤销这次禁用；`dryRun: true` 时返回计划。'
          )
        },
        enable: {
          summary: t(
            'Re-enables a disabled plugin at its original stage position.',
            '在原步骤位置重新启用已禁用的插件。'
          ),
          params: { name: t('Plugin name.', '要启用的插件名。') },
          returns: t(
            'Resolves when enabled; a still-disabled provider throws `PREREQUISITE_DISABLED`.',
            '启用后 resolve；它依赖的 provider 仍被禁用时抛 `PREREQUISITE_DISABLED`。'
          )
        },
        disabled: {
          summary: t('Lists the names of disabled plugins.', '列出当前被禁用的插件名。'),
          returns: t('A read-only snapshot array.', '只读的快照数组。')
        }
      }
    },
    IPluginDisableToken: {
      summary: t(
        'Exact restore token returned by `host.plugin.disable()`.',
        '`host.plugin.disable()` 返回的精确恢复令牌，用它撤销这一次禁用。'
      ),
      members: {
        name: { summary: t('Name of the disabled plugin.', '这次被禁用的插件的名称。') },
        enable: {
          summary: t(
            'Restores the whole disabled set; nothing is enabled if a provider is still unavailable.',
            '恢复整组被禁用的插件；有 provider 仍不可用时一个都不启用。'
          ),
          returns: t('Resolves when restored.', '恢复完成后 resolve。')
        }
      }
    },
    IPluginHostCore: {
      summary: t(
        `The \`core\` a plugin receives in \`install(core)\` and \`update(next, core)\`: the host domain core plus its own configuration, operation context, resource registration and stage registration. It never contains \`use\`, \`unUse\` or \`dispose\`. ${stageLifetime.core.en}`,
        `插件在 \`install(core)\`、\`update(next, core)\` 中收到的 \`core\`：宿主领域 core，加上自身配置、操作上下文、资源登记与步骤登记。它不包含 \`use\`、\`unUse\`、\`dispose\`。 ${stageLifetime.core.zh}`
      ),
      members: {
        config: {
          summary: t(
            '`get()` returns this plugin committed, frozen configuration.',
            '`get()` 返回本插件已提交、已冻结的配置。'
          )
        },
        operation: {
          summary: t(
            'Current operation: `signal` and absolute `deadlineAt`.',
            '当前操作的 `signal` 与绝对截止时间 `deadlineAt`。'
          )
        },
        lifecycle: {
          summary: t(
            'Registration lifecycle; its `signal` aborts when this registration ends.',
            '注册生命周期；其 `signal` 在本次注册结束时中止。'
          )
        },
        onDispose: {
          summary: t(
            'Transfers a resource to the registration during install, for reverse-order cleanup. Outside this core window RESOURCE_OUTSIDE_INSTALL rejects without taking ownership or releasing it; the caller retains ownership. Only a late setup-context onDispose attempts release before rejecting.',
            '安装期间接管资源并在卸载时逆序释放。普通内核窗口外以 `RESOURCE_OUTSIDE_INSTALL` 拒绝，既不接管也不释放，资源仍归调用者；只有迟到的准备上下文登记会先尝试释放再拒绝。'
          ),
          params: {
            resource: t('Cleanup function or disposable object.', '清理函数或可释放对象。')
          },
          returns: t(
            'Nothing; the resource is now owned by the registration.',
            '无返回值；资源此后归本次注册所有。'
          )
        },
        ...stageMembers('core')
      }
    },
    IPluginHostCoreFor: alias(
      `IPluginHostCore for a given host, used in plugin typings. ${stageLifetime.core.en}`,
      `针对特定宿主的 IPluginHostCore，用于插件的类型标注。${stageLifetime.core.zh}`
    ),
    IPluginLifecycleCore: {
      summary: t(
        'The part of the core that hooks receive: configuration, operation and lifecycle.',
        '钩子收到的那部分 core：配置、操作上下文与生命周期。'
      ),
      members: {
        config: {
          summary: t(
            '`get()` returns the committed configuration.',
            '`get()` 返回本插件已提交、已冻结的配置。'
          )
        },
        operation: {
          summary: t('Current operation signal and deadline.', '当前操作的信号与截止时间。')
        },
        lifecycle: { summary: t('Registration lifecycle signal.', '本次注册的生命周期信号。') }
      }
    },
    IPluginLifecycleConfig: {
      summary: t('Configuration reader of a plugin core.', '插件 core 上的配置读取器，只能读取。'),
      members: {
        get: {
          summary: t('Reads the committed, frozen configuration.', '读取已提交、已冻结的配置。'),
          returns: t('The configuration snapshot.', '配置快照对象。')
        }
      }
    },
    IPluginOperationContext: {
      summary: t('Time budget of the current hook.', '当前钩子的时间预算，用于协作取消。'),
      members: {
        signal: {
          summary: t(
            'Aborts when the operation deadline passes or the host closes.',
            '操作超时或宿主关闭时中止。'
          )
        },
        deadlineAt: {
          summary: t(
            'Absolute deadline in scheduler time, or `undefined` without limit.',
            '以调度器时间表示的绝对截止时间；不限时为 `undefined`。'
          )
        }
      }
    },
    IPluginRegistrationContext: {
      summary: t(
        'Lifecycle of one registration, passed to `onEnable` / `onDisable`.',
        '单次注册的生命周期，会传给 `onEnable` / `onDisable`。'
      ),
      members: {
        signal: {
          summary: t(
            'Aborts when the registration is released.',
            '本次注册被释放时中止，可用于停止后台工作。'
          )
        }
      }
    },
    IPluginSetupContext: {
      summary: t(
        'Context of the async `setup(context)` hook, run before Features and `install`.',
        '异步 `setup(context)` 钩子的上下文，在 Feature 与 `install` 之前执行。'
      ),
      members: {
        config: {
          summary: t('`get()` reads the plugin configuration.', '`get()` 读取本插件当前的配置。')
        },
        operation: {
          summary: t(
            '`signal`, `deadlineAt` and `now()` of this install attempt.',
            '本次安装尝试的取消信号 `signal`、截止时间 `deadlineAt` 与时钟 `now()`。'
          )
        },
        lifecycle: { summary: t('Registration lifecycle signal.', '本次注册的生命周期信号。') },
        onDispose: {
          summary: t(
            'Hands a resource to the install transaction; it is released on failure or removal.',
            '把资源交给本次安装事务；安装失败或插件卸载时释放。'
          ),
          params: {
            resource: t('Cleanup function or disposable object.', '清理函数或可释放对象。')
          },
          returns: t(
            'Nothing; after the attempt closed it releases the resource and throws `RESOURCE_OUTSIDE_INSTALL`.',
            '无返回值；安装尝试结束后再调用会先释放资源再抛 `RESOURCE_OUTSIDE_INSTALL`。'
          )
        }
      }
    },
    IPluginSetupOperation: {
      summary: t('Operation context of `setup`.', '`setup` 钩子的操作上下文，用于控制超时与取消。'),
      members: {
        signal: { summary: t('Aborts on deadline or host disposal.', '超时或宿主释放时中止。') },
        deadlineAt: {
          summary: t('Absolute deadline, or `undefined`.', '绝对截止时间；不限时为 `undefined`。')
        },
        now: {
          summary: t('Reads the host scheduler clock.', '读取宿主调度器的当前时间。'),
          returns: t('Current time in scheduler milliseconds.', '以调度器毫秒表示的当前时间。')
        }
      }
    },
    IPluginBeforeReleaseContext: {
      summary: t(
        'Context of `beforeRelease`.',
        '`beforeRelease` 钩子的上下文，描述剩余的释放时间。'
      ),
      members: {
        signal: {
          summary: t(
            'Lifecycle signal of the generation being released.',
            '正在释放的这一代的生命周期信号。'
          )
        },
        deadlineAt: {
          summary: t(
            'When the step budget ends, or `undefined`.',
            '步骤预算结束的时间；不限时为 `undefined`。'
          )
        },
        remainingMs: {
          summary: t('Milliseconds left before the deadline.', '距离截止时间还剩多少毫秒。'),
          returns: t(
            'Remaining milliseconds, or `undefined` without a deadline.',
            '剩余毫秒数；不限时为 `undefined`。'
          )
        }
      }
    },
    IPluginDisposalContext: {
      summary: t(
        'Context passed to a plugin `dispose`.',
        '传给插件 `dispose` 的上下文，描述释放的时间预算。'
      ),
      members: {
        signal: {
          summary: t(
            'Registration lifecycle signal, aborted at logical revocation before disposal; it is not a per-step timeout signal.',
            '注册生命周期信号，在清理前逻辑撤销时即中止，并非单个步骤的超时信号。'
          )
        },
        deadlineAt: {
          summary: t(
            'Absolute cleanup deadline when present; this context value is not the separate per-step disposal budget.',
            '存在时表示清理绝对截止时刻，不等同于独立的单个释放步骤预算。'
          )
        }
      }
    },
    IPluginFeatureCore: {
      summary: t(
        'Plugin-hook core for reading declared Feature outputs and featureExpose. It is not the Feature factory first argument: factories receive only IFeatureCore.featureExpose and receive dependency outputs as their second argument.',
        '插件钩子读取已声明功能输出及自身暴露值的内核；它不是功能工厂的第一参数。工厂只收到 `IFeatureCore.featureExpose`，依赖输出来自第二参数。'
      ),
      members: {
        features: {
          summary: t(
            'Outputs of the Features this plugin declares.',
            '本插件在 `features` 中声明的各个 Feature 的输出。'
          )
        },
        featureExpose: {
          summary: t(
            'Values from the plugin `featureExpose` hook.',
            '插件 `featureExpose` 钩子提供给 Feature 工厂的值。'
          )
        }
      }
    },
    IPluginFeatureOptions: {
      summary: t(
        'Feature-related fields of a plugin definition.',
        '插件定义中与 Feature 相关的字段。'
      ),
      members: {
        features: {
          summary: t('Features provided or consumed.', '本插件提供或消费的 Feature 组成的记录。')
        },
        featureExpose: {
          summary: t(
            'Values (or a function of the core) that provided Feature factories read as `core.featureExpose`.',
            '提供给 Feature 工厂的值（或根据 core 计算它的函数），工厂通过 `core.featureExpose` 读取。'
          )
        }
      }
    },
    IFeatureCore: {
      summary: t(
        'Core received by a provider Feature factory.',
        'provider 的 Feature 工厂收到的 core，从中读取 `featureExpose` 提供的值。'
      ),
      members: {
        featureExpose: {
          summary: t(
            'Values exposed by the provider through `featureExpose`.',
            'provider 插件通过 `featureExpose` 钩子暴露给 Feature 工厂的值。'
          )
        }
      }
    },
    IFeatureReference: {
      summary: t(
        'A reference to a provider Feature created by `getFeature()`.',
        '由 `getFeature()` 创建的、指向 provider 某个 Feature 的引用。'
      ),
      members: {
        plugin: {
          summary: t(
            'Name of the provider plugin of the Feature.',
            '提供这个 Feature 的那个 provider 插件的名称。'
          )
        },
        feature: {
          summary: t(
            'Feature name within the provider.',
            '所引用的 Feature 在 provider 插件 `features` 中的名称。'
          )
        },
        optional: { summary: t('Whether the dependency is optional.', '该依赖是否为可选依赖。') }
      }
    },
    IFeatureInspection: {
      summary: t(
        'Result of `inspectFeatures()`.',
        '`inspectFeatures()` 的结果，按依赖顺序列出 Feature。'
      ),
      scenarios: [
        t(
          'Inspect a trusted Feature graph before installation without constructing its outputs or creating registration state.',
          '在安装前查看可信 Feature 图的依赖顺序，不构造 Feature 输出，也不创建注册状态。'
        )
      ],
      example: `import { defineFeature, inspectFeatures } from '@migaia/plugin-host'

const clock = defineFeature(() => ({ now: () => Date.now() }))
const inspection = inspectFeatures({ clock })
console.log(inspection.roots.clock === clock)
console.log(inspection.ordered.length)`,
      members: {
        roots: {
          summary: t(
            'The Feature record that was inspected.',
            '传给 `inspectFeatures()` 作为起点的那组 Feature 记录。'
          )
        },
        ordered: {
          summary: t(
            'Every reachable Feature in dependency order.',
            '可达的全部 Feature，按依赖顺序排列。'
          )
        }
      }
    },
    IHostDomainCoreRequest: {
      summary: t(
        'Argument of `defineHost({ domainCore })`: which install the core is for.',
        '`defineHost({ domainCore })` 的参数：说明本次 core 是为哪次安装创建的。'
      ),
      members: {
        pluginName: {
          summary: t(
            'Name of the plugin being installed.',
            '本次正在安装、需要这个 core 的插件名称。'
          )
        },
        batchIndex: {
          summary: t('Position of the plugin in its install batch.', '该插件在本批安装中的位置。')
        },
        batch: { summary: t('Opaque identity of the install batch.', '本批安装的不透明标识。') }
      }
    },
    IHostCoreConstructionRequest: {
      summary: t(
        'Information passed when a host builds a plugin core.',
        '宿主构建插件 core 时传入的信息。'
      ),
      members: {
        pluginName: {
          summary: t(
            'Name of the plugin being installed.',
            '本次正在安装、需要这个 core 的插件名称。'
          )
        },
        batch: { summary: t('Opaque identity of the install batch.', '本批安装的不透明标识。') }
      }
    },
    IPipelineConfig: {
      summary: t('Pipeline option of a host.', '宿主的 pipeline 选项，目前只包含执行模式。'),
      members: {
        mode: {
          summary: t(
            'Pipeline mode; invalid values throw `INVALID_PIPELINE_MODE`.',
            '宿主 pipeline 的执行模式；传入非法值时构造会抛 `INVALID_PIPELINE_MODE`。'
          ),
          default: t('`sync`.', '`sync`，同步模式。')
        }
      }
    },
    IPluginDependency: {
      scenarios: [
        t(
          'Show which providers must be installed before a plugin.',
          '在安装前列出某个插件需要先安装哪些 provider。'
        )
      ],
      example: `for (const dependency of readPluginDependencies(writer))
  console.log(dependency.provider, dependency.required ? '必需' : '可选')`,
      summary: t(
        'One entry of `readPluginDependencies()`.',
        '`readPluginDependencies()` 结果中的一项，描述一个依赖的 provider。'
      ),
      members: {
        provider: {
          summary: t(
            'Name of the provider plugin depended on.',
            '被依赖的那个 provider 插件的名称。'
          )
        },
        required: {
          summary: t(
            '`true` when at least one reference is required.',
            '至少有一个必需引用时为 `true`。'
          )
        }
      }
    },
    IPluginDependencyMutationOptions: {
      summary: t(
        'Options of `unUse()` and `plugin.disable()` for plugins that others depend on.',
        '`unUse()` 与 `plugin.disable()` 在插件被依赖时的处理选项。'
      ),
      members: {
        policy: {
          summary: t(
            'What happens to plugins that require the target.',
            '依赖目标插件的那些插件如何处理。'
          ),
          default: t(
            '`reject`: refuse with `DEPENDENCY_BLOCKED` listing `detail.blockedBy`.',
            '`reject`：以 `DEPENDENCY_BLOCKED` 拒绝，`detail.blockedBy` 列出依赖者。'
          ),
          values: {
            reject: t('Refuse while required dependents exist.', '存在必需依赖者时拒绝操作。'),
            cascade: t(
              'Also disable or remove every transitive required dependent.',
              '连同所有传递的必需依赖者一起禁用或卸载。'
            ),
            suspend: t(
              'Keep dependents installed but suspended (`PLUGIN_SUSPENDED`) until the provider returns.',
              '保留依赖者但将其挂起（访问抛 `PLUGIN_SUSPENDED`），直到 provider 恢复。'
            )
          }
        },
        dryRun: {
          summary: t('Return the plan without changing anything.', '只返回计划，不做任何修改。'),
          default: t('`false`: perform the change.', '`false`：真正执行修改。')
        }
      }
    },
    IPluginDependencyPlan: {
      summary: t(
        'Plan of a dependency-aware removal or disable.',
        '依赖感知的卸载或禁用计划，`dryRun` 时返回，执行后也作为 `affected` 返回。'
      ),
      members: {
        policy: { summary: t('Policy the plan was made with.', '生成该计划所用的策略。') },
        order: { summary: t('Plugin names in processing order.', '按处理顺序排列的插件名。') },
        steps: {
          summary: t(
            'Action per plugin (remove, disable, suspend).',
            '每个插件对应的动作（卸载、禁用、挂起）。'
          )
        },
        edges: {
          summary: t(
            'Provider/consumer edges considered.',
            '计划中考虑的 provider 与消费者依赖边。'
          )
        }
      }
    },
    IPluginRemoval: {
      summary: t(
        'Logical removal result from `unUse()`, preserving the dependency plan and any contained cleanup failures.',
        '`unUse()` 返回的逻辑卸载结果，保留依赖计划与被隔离的清理失败。'
      ),
      members: {
        ok: {
          summary: t(
            'True when removal completed without contained cleanup failures; false keeps those failures in errors.',
            '卸载没有被隔离的清理失败时为真；假值在错误列表保留这些失败。'
          ),
          values: {
            true: t(
              'The planned logical removal and cleanup succeeded.',
              '计划中的逻辑卸载与清理均已成功。'
            ),
            false: t(
              'Logical removal is reported with contained cleanup failures.',
              '逻辑卸载结果包含被隔离的清理失败。'
            )
          }
        },
        affected: {
          summary: t(
            'Dependency plan produced by this removal, including ordered plugin actions and considered edges.',
            '本次卸载产生的依赖计划，包含有序插件动作和考虑过的依赖边。'
          )
        },
        errors: {
          summary: t(
            'Original cleanup failure values present only in the unsuccessful branch, without discarding the removal plan.',
            '仅失败分支提供的原始清理错误值；仍保留对应卸载计划。'
          )
        }
      }
    },
    IPluginHostDisposalResult: {
      summary: t('Result of `host.dispose()`.', '`host.dispose()` 的结果，说明清理是否完成。'),
      members: {
        logicalTerminal: {
          summary: t(
            'Always `true`: the host no longer accepts work.',
            '固定为 `true`：宿主已不再接受任何工作。'
          )
        },
        cleanupComplete: {
          summary: t(
            '`false` when some cleanup is still running; wait for `physicalCompletion`.',
            '仍有清理在进行时为 `false`；需继续等待 `physicalCompletion`。'
          )
        }
      }
    },
    IPluginHostPhysicalCleanupResult: alias(
      'Result of physical cleanup that continued after a bounded wait.',
      '有时限等待之后继续进行的物理清理的结果。'
    ),
    IPluginInstallFailureDetail: {
      summary: t(
        '`detail` of a `PLUGIN_INSTALL_FAILED` error.',
        '`PLUGIN_INSTALL_FAILED` 错误上的 `detail`，说明哪个插件失败以及回滚情况。'
      ),
      members: {
        failedName: {
          summary: t('Name of the plugin whose install failed.', '本批中安装失败的那个插件的名称。')
        },
        rollbackErrors: {
          summary: t(
            'Errors from rolling back the batch, in rollback order.',
            '回滚本批安装时产生的错误，按回滚顺序排列。'
          )
        },
        completion: {
          summary: t(
            'For `useSync()`: resolves with the final detail once async rollback finished.',
            '仅 `useSync()`：异步回滚完成后以最终的 detail resolve。'
          )
        }
      }
    },
    IPluginHostIdentity: {
      summary: t(
        'Identity of a host, shown in errors and diagnostics.',
        '宿主身份，出现在错误与诊断信息中。'
      ),
      members: {
        name: {
          summary: t(
            'Readable name from the `identity` option.',
            '来自构造选项 `identity` 的可读名称。'
          )
        },
        id: { summary: t('Unique id assigned by the runtime.', '运行时分配的唯一标识。') }
      }
    },
    IPluginHostDisposalProvenance: {
      scenarios: [
        t(
          'Tag cleanup errors in logs with how they were produced.',
          '在日志中为清理错误标注它们的产生方式。'
        )
      ],
      example: `const result = await host.dispose()
for (const error of result.cleanupErrors) logger.warn(readPluginHostDisposalProvenance(error)?.kind, error)`,
      summary: t(
        'Result of `readPluginHostDisposalProvenance()`.',
        '`readPluginHostDisposalProvenance()` 的结果，描述清理错误的来源。'
      ),
      members: {
        kind: {
          summary: t(
            'A `PluginHostDisposalNodeKind` value.',
            '错误节点的种类，取值见 `PluginHostDisposalNodeKind`。'
          )
        },
        phase: {
          summary: t(
            'Cleanup phase that produced the error, if known.',
            '产生该错误的清理阶段（已知时）。'
          )
        }
      }
    },
    IPluginRuntimeIntegration: {
      summary: t(
        'Integration port returned by `getPluginRuntimeIntegration(core)` for runtime adapter plugins.',
        '`getPluginRuntimeIntegration(core)` 为运行时适配插件返回的集成端口。'
      ),
      scenarios: [
        t(
          'RPC plugins share one `host.thread` / `host.process` exit across several connections.',
          'RPC 插件在多个连接之间共享同一个 `host.thread` / `host.process` 出口。'
        )
      ],
      example: `install: (core) => {
  const integration = getPluginRuntimeIntegration(core)
  const slot = integration.acquireSharedSlot('thread', family, (slot) => createExit(slot))
  slot.register({ name: 'worker' })
  return {}
}`,
      members: {
        identity: {
          summary: t(
            'Identity `{ name, id }` of the host.',
            '本 core 所属的那个宿主的身份 `{ name, id }`。'
          )
        },
        nodeId: {
          summary: t(
            'Runtime node id shared by every adapter on this host.',
            '本宿主上所有适配器共享的运行时节点 id。'
          )
        },
        matchesHost: {
          summary: t(
            'Tells whether a host object is the host this core belongs to; grants no mutation right.',
            '判断某个宿主对象是否就是本 core 所属的宿主；不授予任何修改权限。'
          ),
          params: { host: t('Host object to compare.', '要比较的宿主对象。') },
          returns: t('`true` for the owning host.', '是所属宿主时返回 `true`。'),
          example: `if (!integration.matchesHost(target)) throw new Error('不是同一个宿主')`
        },
        assertCurrent: {
          summary: t(
            'Throws when the host or this registration is no longer active.',
            '宿主或本次注册已不再有效时抛错。'
          ),
          returns: t('Nothing when current.', '仍有效时无返回值。'),
          example: `integration.assertCurrent()`
        },
        readSharedExtension: {
          summary: t(
            'Reads an already committed shared extension by key.',
            '按键读取已经提交的共享扩展。'
          ),
          params: {
            key: t('Shared extension key, e.g. `thread`.', '共享扩展的键，例如 `thread`。')
          },
          returns: t(
            'The facade object, or `undefined`.',
            '共享门面对象；不存在时为 `undefined`。'
          ),
          example: `const exit = integration.readSharedExtension('thread')`
        },
        acquireSharedSlot: {
          summary: t(
            'Joins (or creates) a shared extension slot so several plugins publish one host member.',
            '加入（或创建）共享扩展槽位，让多个插件共同发布同一个宿主成员。'
          ),
          params: {
            key: t('Host member name of the shared extension.', '共享扩展在宿主上的成员名。'),
            family: t(
              'Identity of the plugin family allowed to share the slot.',
              '允许共享该槽位的插件家族标识。'
            ),
            create: t('Builds the facade the first time.', '第一次创建槽位时构建门面对象的函数。')
          },
          returns: t('An `IPluginRuntimeSharedSlot`.', '一个共享槽位 `IPluginRuntimeSharedSlot`。'),
          example: `const slot = integration.acquireSharedSlot('process', family, (slot) => createExit(slot))`
        },
        readFeatureOutputs: {
          summary: t(
            'Captures the Feature inventory of a plugin; availability is checked on every read.',
            '获取某个插件的 Feature 清单；每次读取时都会重新检查可用性。'
          ),
          params: { name: t('Plugin name.', '插件名称。') },
          returns: t(
            'An `IPluginRuntimeFeatureSnapshot`.',
            '一个 Feature 快照 `IPluginRuntimeFeatureSnapshot`。'
          ),
          example: `const outputs = integration.readFeatureOutputs('worker').readCurrent('svc')`
        }
      }
    },
    IPluginRuntimeSharedSlot: {
      summary: t(
        'One shared extension slot of a host, returned by `getPluginRuntimeIntegration(core).acquireSharedSlot(key, family, create)`. Several adapter plugins of the same family (for example several RPC transports) publish into one slot, and the host exposes one shared facade for all of them under `key`.',
        '宿主上的一个共享扩展槽位，由 `getPluginRuntimeIntegration(core).acquireSharedSlot(key, family, create)` 返回。同一家族的多个适配插件（例如多个 RPC 传输插件）都向这个槽位发布内容，宿主在 `key` 下只暴露一个共享外观对象。'
      ),
      scenarios: [
        t(
          'Several transport plugins register their peers, and one facade on the host finds a peer by instance id.',
          '多个传输插件分别登记自己的连接端，宿主上的同一个外观对象按实例 id 找到其中某一个。'
        )
      ],
      example: {
        en: `const integration = getPluginRuntimeIntegration(core)
const slot = integration.acquireSharedSlot(peersKey, peerFamily, (view) => ({
  // the facade every plugin of the family shares
  find: (id: string) => view.find(id)
}))
const withdraw = slot.contribute(peer, 'peer-a')
// later, when this peer closes:
withdraw()`,
        zh: `const integration = getPluginRuntimeIntegration(core)
const slot = integration.acquireSharedSlot(peersKey, peerFamily, (view) => ({
  // 同一家族所有插件共享的外观对象
  find: (id: string) => view.find(id)
}))
const withdraw = slot.contribute(peer, 'peer-a')
// 之后这个连接端关闭时：
withdraw()`
      },
      members: {
        facade: {
          summary: t(
            'The shared facade built once by the `create` callback of the first plugin that acquired the slot; later plugins of the family receive the same object.',
            '由第一个获取该槽位的插件通过 `create` 回调构建一次的共享外观对象；同一家族后来的插件拿到的是同一个对象。'
          )
        },
        find: {
          summary: t(
            'Finds one ready contribution. An instance id given to `contribute()` is matched first, then a registration (plugin) name.',
            '查找一个已就绪的贡献值。优先按 `contribute()` 时给出的实例 id 匹配，其次按登记（插件）名称匹配。'
          ),
          params: {
            target: t(
              "An instance id passed to `contribute(value, instanceId)` by some plugin, or that plugin's name.",
              '某个插件调用 `contribute(value, instanceId)` 时给出的实例 id，或该插件的名称。'
            )
          },
          returns: t(
            'The contributed value; `undefined` when nothing matches or its plugin is not active (suspended, removed), `null` when several contributions share the target.',
            '贡献的值；没有匹配或其插件未处于激活状态（已暂停、已移除）时为 `undefined`，多个贡献共用同一目标时为 `null`。'
          ),
          example: `const peer = slot.find('peer-a')
if (peer === null) throw new Error('实例 id 重复')`
        },
        values: {
          summary: t(
            'Lists the values of every current contribution of the slot, in contribution order.',
            '按贡献顺序列出该槽位当前所有贡献的值。'
          ),
          returns: t(
            'A new read-only array; empty once the slot is retired.',
            '新的只读数组；槽位停用后为空数组。'
          ),
          example: `for (const peer of slot.values()) peer.close()`
        },
        registered: {
          summary: t(
            'Lists the metadata objects that committed registrations passed to `register()`, including suspended or not yet ready plugins.',
            '列出已提交的登记通过 `register()` 留下的元数据对象，包括已暂停或尚未就绪的插件。'
          ),
          returns: t('A new read-only array of metadata objects.', '新的只读元数据对象数组。'),
          example: `const transports = slot.registered().map((meta) => meta.kind)`
        },
        register: {
          summary: t(
            "Attaches one metadata object to the current plugin's registration; it becomes visible through `registered()` only when the install commits, and disappears if the install rolls back.",
            '为当前插件的登记附加一个元数据对象；只有安装提交后它才会出现在 `registered()` 中，安装回滚则不会出现。'
          ),
          params: {
            value: t(
              'Metadata object describing this plugin in the family.',
              '描述本插件在家族中身份的元数据对象。'
            ),
            onCommit: t(
              'Optional; called once after the install committed.',
              '可选，安装提交后调用一次的回调。'
            )
          },
          returns: t(
            'Nothing; the metadata is published with the install commit.',
            '无返回值；元数据随安装提交一起发布。'
          ),
          example: `slot.register({ kind: 'websocket' }, () => console.log('已提交'))`
        },
        contribute: {
          summary: t(
            'Publishes one ready value under an instance id. During install it is staged and published only if the install commits; after commit it is published at once. Throws `REGISTRATION_REVOKED` once the slot is retired.',
            '以实例 id 发布一个已就绪的值。安装过程中先暂存，安装提交后才发布；提交之后调用则立即发布。槽位停用后调用抛 `REGISTRATION_REVOKED`。'
          ),
          params: {
            value: t('Object to publish.', '要发布的对象。'),
            instanceId: t(
              'Non-empty id chosen by the contributing plugin (for example a connection or peer id it generated); consumers pass the same id to `find()`.',
              '由发布贡献的插件自行指定的非空 id（例如它生成的连接 id 或对端 id）；使用方把同一个 id 传给 `find()`。'
            )
          },
          returns: t(
            'A withdraw function that removes only this contribution; calling it again does nothing.',
            '撤回函数，只移除这一项贡献；重复调用没有效果。'
          ),
          example: `const withdraw = slot.contribute(peer, peer.id)
peer.onClose(withdraw)`
        }
      }
    },
    IPluginRuntimeFeatureSnapshot: {
      summary: t(
        'Feature inventory of one plugin, returned by `getPluginRuntimeIntegration(core).readFeatureOutputs(pluginName)`. It captures every Feature output of that plugin once and can later check that they are still current.',
        '某个插件的 Feature 清单，由 `getPluginRuntimeIntegration(core).readFeatureOutputs(pluginName)` 返回。它一次性捕获该插件的全部 Feature 输出，之后可以检查这些输出是否仍是当前值。'
      ),
      scenarios: [
        t(
          'A runtime adapter reads the outputs of a provider plugin during install and, before each later use, confirms the provider was not replaced.',
          '运行时适配插件在安装时读取提供方插件的输出，之后每次使用前确认提供方没有被替换。'
        )
      ],
      example: `const inventory = getPluginRuntimeIntegration(core).readFeatureOutputs('rpc')
const transport = inventory.outputs.transport
// 之后每次使用前：
inventory.assertCurrent('transport')`,
      members: {
        outputs: {
          summary: t(
            'Frozen record of every Feature output of the plugin at read time, keyed by Feature name.',
            '读取时该插件全部 Feature 输出组成的冻结记录，以 Feature 名称为键。'
          )
        },
        assertCurrent: {
          summary: t(
            'Checks that the plugin registration is still the one read and that the named output is still the same object; otherwise throws `REGISTRATION_REVOKED`.',
            '检查该插件的注册仍是读取时那一个、且指定输出仍是同一个对象；否则抛 `REGISTRATION_REVOKED`。'
          ),
          params: {
            feature: t(
              'A key of `outputs`, i.e. a Feature name declared by the plugin.',
              '`outputs` 中的键，即该插件声明的 Feature 名称。'
            )
          },
          returns: t('Nothing when the output is still current.', '输出仍是当前值时无返回值。'),
          example: `inventory.assertCurrent('transport')`
        },
        readCurrent: {
          summary: t(
            'Reads the current output of a Feature again, after checking that the reading core is still current; use it when the provider may have been replaced.',
            '先确认发起读取的插件核心仍然有效，再重新读取某个 Feature 的当前输出；适用于提供方可能已被替换的场景。'
          ),
          params: {
            feature: t(
              'A key of `outputs`, i.e. a Feature name declared by the plugin.',
              '`outputs` 中的键，即该插件声明的 Feature 名称。'
            )
          },
          returns: t('The current Feature output object.', '该 Feature 当前的输出对象。'),
          example: `const transport = inventory.readCurrent('transport')`
        }
      }
    },
    PluginHostError: {
      summary: t('Error class for host state and protocol errors.', '宿主状态与协议错误的错误类。'),
      scenarios: [
        t(
          'Catch install failures and read the original error and failed plugin.',
          '捕获安装失败，读取原始错误和失败的插件名。'
        )
      ],
      example: {
        en: `try {
  await host.use(broken)
} catch (error) {
  if (error instanceof PluginHostError && error.code === 'PLUGIN_INSTALL_FAILED') {
    console.error(error.detail?.failedName, error.cause)
  }
}`,
        zh: `try {
  await host.use(broken)
} catch (error) {
  if (error instanceof PluginHostError && error.code === 'PLUGIN_INSTALL_FAILED') {
    console.error('失败插件', error.detail?.failedName, '原因', error.cause)
  }
}`
      },
      members: {
        source: {
          summary: t(
            'Always `@migaia/plugin-host`.',
            '固定为 `@migaia/plugin-host`，用来确认错误来源。'
          )
        },
        code: {
          summary: t(
            'A `PluginHostErrorCode` value; branch on it.',
            '错误码，取值见 `PluginHostErrorCode`，请按它分支处理。'
          )
        },
        detail: {
          summary: t(
            'Structured data for some codes, e.g. `failedName`, `blockedBy`, `dependents`.',
            '部分错误码附带的结构化信息，如 `failedName`、`blockedBy`、`dependents`。'
          )
        }
      }
    },
    IPluginHostCompositionIntegration: {
      summary: t(
        'Composition port of a managed host (from `openComposition()`), for its single owner such as Tray: prepare and commit installs as a batch, remove exact registrations, keep ordering slots.',
        '托管宿主的组合端口（由 `openComposition()` 返回），供唯一的组合所有者（如 Tray）使用：批量准备并提交安装、按精确注册卸载、保留排序槽位。'
      ),
      scenarios: [
        t(
          'Tray installs a batch of plugins atomically and removes them by exact receipt.',
          'Tray 以原子方式安装一批插件，并按精确凭证卸载它们。'
        )
      ],
      example: {
        en: `const port = openComposition(host)
const slot = port.createDataOrderSlot('search')
const prepared = await port.prepareAdmissions([{ admission: port.createPluginAdmission(search), slot }])
let receipts
try {
  receipts = port.commitPreparedAdmissions(prepared)
} catch {
  await port.discardPreparedAdmissions(prepared) // revision changed meanwhile
}
const removal = port.prepareUnUseBatch(receipts ?? [])
await port.commitPreparedUnUseBatch(removal, {})`,
        zh: `const port = openComposition(host)
const slot = port.createDataOrderSlot('search')
const prepared = await port.prepareAdmissions([{ admission: port.createPluginAdmission(search), slot }])
let receipts
try {
  receipts = port.commitPreparedAdmissions(prepared)
} catch {
  await port.discardPreparedAdmissions(prepared) // 期间修订号变化，丢弃这批
}
const removal = port.prepareUnUseBatch(receipts ?? [])
await port.commitPreparedUnUseBatch(removal, {})`
      },
      members: {
        revision: {
          summary: t(
            'Current Host revision, including configuration, enablement, stage and terminal commits as well as install/remove/replace. Preparation based on an older revision cannot commit.',
            '当前宿主修订号，除安装、卸载、替换外也含配置、启停、步骤及终态提交；旧修订准备不能提交。'
          )
        },
        getCurrentSnapshot: {
          summary: t('Reads the current extensions and configuration.', '读取当前的扩展与配置。'),
          returns: t(
            'An `IPluginHostCompositionSnapshot`.',
            '一个组合快照 `IPluginHostCompositionSnapshot`。'
          ),
          example: `const { extensions } = port.getCurrentSnapshot()`
        },
        createPluginAdmission: {
          summary: t(
            'Snapshots a plugin definition for later preparation.',
            '为插件定义拍摄快照，供之后准备安装使用。'
          ),
          params: { plugin: t('Plugin definition.', '插件定义。') },
          returns: t('An opaque `IPluginAdmission`.', '不透明的准入快照 `IPluginAdmission`。'),
          example: `const admission = port.createPluginAdmission(search)`
        },
        createDataOrderSlot: {
          summary: t(
            'Reserves an ordering position for a plugin definition name.',
            '为某个插件定义名称预留排序位置。'
          ),
          params: { name: t('Plugin name.', '插件名称。') },
          returns: t(
            'An opaque `IPluginDataOrderSlot`; reuse it for replacements.',
            '不透明的排序槽位；替换时应复用它。'
          ),
          example: `const slot = port.createDataOrderSlot('search')`
        },
        prepareAdmissions: {
          summary: t(
            'Runs async setup for a batch without making anything visible yet.',
            '为一批插件执行异步准备，但暂不对外可见。'
          ),
          params: {
            requestsInPublicationOrder: t(
              'Admissions with their ordering slots.',
              '带排序槽位的准入快照列表。'
            )
          },
          returns: t('An opaque prepared batch.', '不透明的已准备批次。'),
          example: `const prepared = await port.prepareAdmissions([{ admission, slot }])`
        },
        commitPreparedAdmissions: {
          summary: t(
            'Publishes a prepared batch synchronously; refused when the revision changed meanwhile.',
            '同步发布已准备的批次；期间修订号变化时拒绝提交。'
          ),
          params: {
            prepared: t('Batch from `prepareAdmissions()`.', '`prepareAdmissions()` 返回的批次。')
          },
          returns: t('One registration receipt per plugin.', '每个插件一张注册凭证。'),
          example: `const [receipt] = port.commitPreparedAdmissions(prepared)`
        },
        discardPreparedAdmissions: {
          summary: t('Rolls back a prepared batch exactly once.', '恰好一次地回滚已准备的批次。'),
          params: { prepared: t('Batch to discard.', '要丢弃的批次。') },
          returns: t('Physical cleanup result.', '物理清理的结果。'),
          example: `await port.discardPreparedAdmissions(prepared)`
        },
        retireDataOrderSlot: {
          summary: t(
            'Retires an ordering slot when its definition is really deleted.',
            '当定义被真正删除时退役对应的排序槽位。'
          ),
          params: { slot: t('Slot to retire.', '要退役的排序槽位。') },
          returns: t('Nothing.', '无返回值；该槽位之后不能再使用。'),
          example: `port.retireDataOrderSlot(slot)`
        },
        prepareUnUseBatch: {
          summary: t(
            'Binds a removal batch to exact registration receipts.',
            '把一批卸载绑定到精确的注册凭证上。'
          ),
          params: {
            receiptsInCleanupOrder: t('Receipts in cleanup order.', '按清理顺序排列的注册凭证。')
          },
          returns: t('An opaque prepared removal batch.', '不透明的已准备卸载批次。'),
          example: `const removal = port.prepareUnUseBatch([receipt])`
        },
        commitPreparedUnUseBatch: {
          summary: t(
            'Rechecks exact registration identity before committing revocation, then waits for beforeCleanup and pipeline draining before cleanup. A registration replaced or removed after preparation rejects PLUGIN_NOT_INSTALLED without cleaning that stale generation twice.',
            '提交撤销前复核精确注册身份，再等待清理屏障及管线后释放；准备后已替换或卸载的旧代以 `PLUGIN_NOT_INSTALLED` 拒绝，不重复清理旧代。'
          ),
          params: {
            prepared: t('Batch from `prepareUnUseBatch()`.', '`prepareUnUseBatch()` 返回的批次。'),
            options: t(
              '`beforeCleanup` fence Promise.',
              '`beforeCleanup` 屏障，宿主等它完成后才清理。'
            )
          },
          returns: t(
            'An `IPluginBatchRemovalResult`.',
            '一个批量卸载结果 `IPluginBatchRemovalResult`。'
          ),
          example: `const result = await port.commitPreparedUnUseBatch(removal, { beforeCleanup: drained })`
        }
      }
    },
    IPluginHostCompositionSnapshot: {
      summary: t(
        'Snapshot from `getCurrentSnapshot()`.',
        '`getCurrentSnapshot()` 返回的宿主当前扩展与配置快照。'
      ),
      members: {
        extensions: {
          summary: t('Current extensions of the host.', '宿主当前对外发布的全部扩展。')
        },
        config: { summary: t('Configuration store at snapshot time.', '快照时刻宿主的配置仓库。') }
      }
    },
    IPluginBatchRemovalOptions: {
      summary: t(
        'Options of `commitPreparedUnUseBatch()`.',
        '`commitPreparedUnUseBatch()` 的选项，用于控制物理清理开始的时机。'
      ),
      members: {
        beforeCleanup: {
          summary: t(
            'Promise the host waits for before physical cleanup starts.',
            '宿主在物理清理开始前等待的 Promise。'
          ),
          default: t(
            'Not set: cleanup starts once pipelines drained.',
            '不设置：pipeline 排空后立即开始清理。'
          )
        }
      }
    },
    IPluginBatchRemovalResult: {
      summary: t('Result of a batch removal.', '批量卸载的结果，包含每个注册的清理情况。'),
      members: {
        ok: {
          summary: t('`false` when any cleanup failed.', '只要有任何清理步骤失败就为 `false`。')
        },
        committed: {
          summary: t(
            'Always `true`: the removal took effect.',
            '固定为 `true`：卸载已经生效，不会再回滚。'
          )
        },
        snapshot: {
          summary: t('View of the host after removal.', '卸载完成后宿主的扩展与配置视图。')
        },
        leaves: { summary: t('Result per removed registration.', '每个被卸载注册的结果。') },
        cleanupComplete: {
          summary: t('`false` while physical cleanup continues.', '物理清理仍在进行时为 `false`。')
        }
      }
    },
    IPluginBatchRemovalLeaf: {
      summary: t('Result of one removed registration.', '单个被卸载注册的结果。'),
      members: {
        receipt: {
          summary: t('Receipt of the removed registration.', '被卸载的那次注册所对应的凭证。')
        },
        name: { summary: t('Name of the removed plugin.', '本次被卸载的插件的名称。') },
        cleanupComplete: { summary: t('Whether its cleanup finished.', '它的清理是否已经完成。') }
      }
    },
    IPluginAdmissionRequest: {
      summary: t(
        'One entry passed to `prepareAdmissions()`.',
        '传给 `prepareAdmissions()` 的一项：准入快照及其排序槽位。'
      ),
      members: {
        admission: {
          summary: t(
            'Admission from `createPluginAdmission()`.',
            '由 `createPluginAdmission()` 生成的插件准入快照。'
          )
        },
        slot: {
          summary: t(
            'Ordering slot from `createDataOrderSlot()`.',
            '由 `createDataOrderSlot()` 生成、决定步骤顺序的排序槽位。'
          )
        }
      }
    },
    IRegistrationView: {
      scenarios: [
        t(
          'Give a runtime task access to one plugin extensions only, without the host.',
          '让某个运行任务只能访问一个插件的扩展，而拿不到宿主本身。'
        )
      ],
      example: `const view = createView(receipt)
await view.extensions.query('migaia')`,
      summary: t(
        'Extension-only view from `createView()`.',
        '`createView()` 返回的只含扩展的视图。'
      ),
      members: {
        extensions: {
          summary: t('Extensions of exactly that registration.', '只属于该次注册的扩展对象。')
        }
      }
    },
    IRegistrationToken: alias(
      'Opaque, unforgeable token of one registration.',
      '某次注册的不透明、不可伪造的凭证。'
    ),
    IPluginAdmission: alias(
      'Opaque admission snapshot of a plugin definition.',
      '插件定义的不透明准入快照。'
    ),
    IPluginDataOrderSlot: alias(
      'Opaque ordering position owned by the host.',
      '宿主拥有的不透明排序位置。'
    ),
    IPluginPreparedAdmissions: alias('Opaque prepared install batch.', '不透明的已准备安装批次。'),
    IPluginPreparedRemovalBatch: alias(
      'Opaque prepared removal batch.',
      '不透明的已准备卸载批次。'
    ),
    IExcludePluginByName: alias(
      'Type helper that removes a plugin from a tuple by name.',
      '按名称从插件元组中移除某个插件的类型工具。'
    ),
    IExtractPluginConfig: alias(
      'Type helper that reads the configuration type of a plugin.',
      '读取插件配置类型的类型工具。'
    ),
    IExtractPluginExt: alias(
      'Type helper that reads the extension type of a plugin.',
      '读取插件扩展类型的类型工具。'
    ),
    IMergePluginExts: alias(
      'Type helper that merges the extension types of several plugins.',
      '合并多个插件扩展类型的类型工具。'
    ),
    IFeature: alias(
      'A Feature definition created by `defineFeature()`.',
      '由 `defineFeature()` 创建的 Feature 定义，放进插件的 `features` 中使用。'
    ),
    IFeatureDependency: alias(
      'One Feature dependency: either a reference to another plugin provider or a local IFeature definition from the same plugin. The factory receives its resolved output in the dependencies argument.',
      '单个功能依赖，可为其它插件提供者的引用，也可为同一插件内的 `IFeature` 定义；工厂从依赖参数取得解析后的输出。'
    ),
    IFeatureDependencyRecord: alias(
      'Record of named Feature dependencies.',
      '具名 Feature 依赖组成的记录，即 `defineFeature` 的第二个参数。'
    ),
    IFeatureFactory: alias(
      'Feature factory `(core, dependencies) => output`.',
      'Feature 工厂函数 `(core, dependencies) => output`，返回该 Feature 的输出对象。'
    ),
    IFeatureOutput: alias('Output type of a Feature.', '某个 Feature 工厂返回的输出对象的类型。'),
    IFeatureOutputs: alias(
      'Outputs of a Feature record, keyed by name.',
      '按名称排列的一组 Feature 输出。'
    ),
    IFeatureRecord: alias(
      'Record of named Features.',
      '具名 Feature 组成的记录，即插件定义中的 `features` 字段。'
    ),
    IFeatureRecordRequiredExpose: alias(
      'Type helper: what `featureExpose` must provide for a Feature record.',
      '类型工具：一组 Feature 要求 `featureExpose` 提供的内容。'
    ),
    IFeatureRequiredExpose: alias(
      'Type helper: what `featureExpose` must provide for one Feature.',
      '类型工具：单个 Feature 要求 `featureExpose` 提供的内容。'
    ),
    IPluginAwaitable: alias(
      'Hook result accepting a direct value or any valid PromiseLike, including native Promise. Lifecycle observation assimilates a valid thenable once rather than invoking its then method repeatedly.',
      '钩子结果接受直接值或任意合法 `PromiseLike`，包含原生承诺；生命周期观察只同化一次合法异步值，不会反复调用其异步方法。'
    ),
    IPluginConfig: alias(
      'Plain-data configuration record of a plugin.',
      '插件的普通数据配置对象。'
    ),
    IPluginConstraintTuple: alias(
      'Type helper that checks a plugin tuple against a host.',
      '检查插件元组能否安装到某宿主的类型工具。'
    ),
    IPluginDisposer: alias(
      'A cleanup function returning void or PromiseLike<void>; disposable objects belong to IPluginResource instead.',
      '返回空值或异步空值的清理函数；可释放对象属于 `IPluginResource`，不属于此函数别名。'
    ),
    IPluginFeatureName: alias(
      'Names of the Features a plugin declares.',
      '某个插件所声明的 Feature 名称集合。'
    ),
    IPluginFeatureOutput: alias(
      'Output type of one named Feature of a plugin.',
      '插件某个具名 Feature 的输出类型。'
    ),
    IPluginHandleTuple: alias(
      'Tuple of handles returned by `use()`, in input order.',
      '`use()` 返回的句柄元组，顺序与输入一致。'
    ),
    IPluginHostCoreTypeInfo: alias(
      'Type information of a host core.',
      '宿主 core 的类型信息，供类型推导使用。'
    ),
    IPluginHostDiagnostic: alias(
      'Type of the `diagnostic` option `(message, code?, error?) => void`.',
      '`diagnostic` 选项回调的函数类型 `(message, code?, error?) => void`，用于接收诊断信息。'
    ),
    IPluginHostDisposalNodeKind: alias(
      'Union of `PluginHostDisposalNodeKind` values.',
      '`PluginHostDisposalNodeKind` 全部取值组成的联合类型。'
    ),
    IPluginHostErrorCode: alias(
      'Union of `PluginHostErrorCode` values.',
      '`PluginHostErrorCode` 全部错误码组成的联合类型。'
    ),
    IPluginHostErrorDetail: alias(
      'Default `detail` type of `PluginHostError`.',
      '`PluginHostError` 默认的 `detail` 结构化信息类型。'
    ),
    IPluginHostInstalledPlugins: alias(
      'Type helper listing the plugins installed on a host type.',
      '列出某个宿主类型已安装插件的类型工具。'
    ),
    IPluginHostRegistrationLifecycle: alias(
      'Union of `PluginHostRegistrationLifecycle` values.',
      '`PluginHostRegistrationLifecycle` 全部取值组成的联合类型。'
    ),
    IPluginHostRuntimeExtensions: alias(
      'Members added to a host by runtime adapter plugins (such as `thread`, `process`).',
      '运行时适配插件加到宿主上的成员（如 `thread`、`process`）。'
    ),
    IPluginHostStatus: alias(
      'Union of `PluginHostStatus` values.',
      '`PluginHostStatus` 全部取值组成的联合类型。'
    ),
    IPluginInstaller: alias(
      'Signature of a plugin `install` hook.',
      '插件 `install` 钩子的函数类型，返回扩展对象。'
    ),
    IPluginResource: alias(
      'What `onDispose()` accepts: a function or disposable object.',
      '`onDispose()` 接受的值：函数或可释放对象。'
    ),
    IPluginSetup: alias(
      'Signature of a plugin `setup` hook.',
      '插件 `setup` 钩子的函数类型，可异步准备资源。'
    )
  },
  enums: {
    PluginHostDisposalNodeKind: {
      summary: t(
        'Kinds of structured error nodes emitted by trusted disposal producers for provenance-aware inspection.',
        '可信释放生产者生成的结构化错误节点种类，用于按来源溯源检查。'
      ),
      values: {
        hostError: t(
          'A PluginHost-produced error node; inspect its lifecycle phase and retained failure chain.',
          '插件宿主生成的错误节点；检查其生命周期阶段与保留的错误链。'
        ),
        aggregate: t(
          'An aggregate node containing several original cleanup failures in its errors list.',
          '聚合节点，通过错误列表保留多个原始清理失败。'
        ),
        disposerWrapper: t(
          'A producer-owned disposer wrapper retaining the disposer’s primary failure and provenance.',
          '生产者持有的释放器包装，保留释放器的主错误与来源信息。'
        )
      }
    },
    PluginHostErrorCode: {
      summary: t(
        'Codes of host errors and diagnostics (`error.code`).',
        '宿主错误与诊断信息上的 `error.code` 取值。'
      ),
      values: {
        hostDisposed: t(
          '`HOST_DISPOSED`: the host finished disposal; create a new host.',
          '`HOST_DISPOSED`：宿主已释放完成，需要创建新宿主。'
        ),
        hostDisposing: t(
          '`HOST_DISPOSING`: disposal started; no new change can start.',
          '`HOST_DISPOSING`：宿主正在释放，不能开始新的变更。'
        ),
        pluginDuplicate: t(
          '`PLUGIN_DUPLICATE`: the plugin is installed, or a batch repeats a name.',
          '`PLUGIN_DUPLICATE`：插件已安装，或同一批中出现重复名称。'
        ),
        pluginNotInstalled: t(
          '`PLUGIN_NOT_INSTALLED`: no plugin of that name (`unUse`, `config.update`, handle access).',
          '`PLUGIN_NOT_INSTALLED`：找不到该名称的插件（`unUse`、`config.update` 或句柄访问）。'
        ),
        pluginDisabled: t(
          '`PLUGIN_DISABLED`: the plugin is disabled; enable it first.',
          '`PLUGIN_DISABLED`：插件已被禁用，需先启用再访问。'
        ),
        pluginSuspended: t(
          '`PLUGIN_SUSPENDED`: suspended because a required provider is unavailable.',
          '`PLUGIN_SUSPENDED`：因必需的 provider 不可用而被挂起。'
        ),
        pluginNotActivated: t(
          '`PLUGIN_NOT_ACTIVATED`: a lazy plugin was used before `activate()`.',
          '`PLUGIN_NOT_ACTIVATED`：惰性插件在 `activate()` 之前被使用。'
        ),
        featureNotDeclared: t(
          '`FEATURE_NOT_DECLARED`: `getFeature(name)` asked for an undeclared Feature.',
          '`FEATURE_NOT_DECLARED`：`getFeature(name)` 请求了该插件 `features` 中没有声明的 Feature 名称。'
        ),
        prerequisiteMissing: t(
          '`PREREQUISITE_MISSING`: a required provider was never installed.',
          '`PREREQUISITE_MISSING`：安装消费者时，它必需的 provider 插件从未安装过，需要先安装 provider。'
        ),
        dependencyCycle: t(
          '`DEPENDENCY_CYCLE`: Feature references form a cycle; nothing was installed.',
          '`DEPENDENCY_CYCLE`：Feature 引用形成了环，本批没有安装任何插件。'
        ),
        dependencyBlocked: t(
          '`DEPENDENCY_BLOCKED`: required dependents block removal or disabling; see `detail.blockedBy`.',
          '`DEPENDENCY_BLOCKED`：仍有必需依赖者阻止卸载或禁用，见 `detail.blockedBy`。'
        ),
        replaceNameMismatch: t(
          '`REPLACE_NAME_MISMATCH`: `replace(name, next)` got a different plugin name.',
          '`REPLACE_NAME_MISMATCH`：`replace(name, next)` 中 `next` 的插件名称与 `name` 不一致，替换被拒绝。'
        ),
        dependentRestartFailed: t(
          '`DEPENDENT_RESTART_FAILED`: the replacement took effect but restarting dependents failed.',
          '`DEPENDENT_RESTART_FAILED`：替换已生效，但重启依赖者失败，它们保持卸载状态。'
        ),
        pluginDefinitionInvalid: t(
          '`PLUGIN_DEFINITION_INVALID`: the definition uses retired or unsupported fields.',
          '`PLUGIN_DEFINITION_INVALID`：插件定义使用了已退役或不支持的字段。'
        ),
        pluginInstallFailed: t(
          '`PLUGIN_INSTALL_FAILED`: install failed; the original error is on `cause`.',
          '`PLUGIN_INSTALL_FAILED`：插件安装失败，原始错误在 `cause` 上。'
        ),
        setupRequiresAsyncInstall: t(
          '`SETUP_REQUIRES_ASYNC_INSTALL`: `useSync()` met a plugin with `setup`; use `use()`.',
          '`SETUP_REQUIRES_ASYNC_INSTALL`：`useSync()` 遇到了声明 `setup` 的插件，应改用 `use()`。'
        ),
        pluginDisposeFailed: t(
          '`PLUGIN_DISPOSE_FAILED`: `beforeRelease` or a cleanup step failed; cleanup continued.',
          '`PLUGIN_DISPOSE_FAILED`：`beforeRelease` 或某个清理步骤失败，清理仍继续进行。'
        ),
        extensionDuplicate: t(
          '`EXTENSION_DUPLICATE`: an extension key clashes with an existing member.',
          '`EXTENSION_DUPLICATE`：扩展的键与已有成员冲突。'
        ),
        extensionObjectPrototype: t(
          '`EXTENSION_OBJECT_PROTOTYPE`: an extension key clashes with `Object.prototype` (e.g. `toString`).',
          '`EXTENSION_OBJECT_PROTOTYPE`：扩展的键与 `Object.prototype` 成员冲突（如 `toString`）。'
        ),
        extensionReserved: t(
          'EXTENSION_RESERVED: a key belongs to the canonical Host protocol, including config/use/dispose, then or disposal symbols. This check precedes duplicate detection; other occupied extension keys use EXTENSION_DUPLICATE. Install failures retain the validation error on cause.',
          '`EXTENSION_RESERVED`：键属于规范宿主协议，包括 `config/use/dispose`、`then` 及释放符号；保留检查优先于重复检查，其它已占扩展键才用重复错误，安装包装仍以原因保留校验错。'
        ),
        prerequisiteDisabled: t(
          '`PREREQUISITE_DISABLED`: a required provider is disabled; enable it and retry.',
          '`PREREQUISITE_DISABLED`：必需的 provider 被禁用，启用后重试。'
        ),
        prerequisiteRemoved: t(
          '`PREREQUISITE_REMOVED`: a required provider was removed; install it again.',
          '`PREREQUISITE_REMOVED`：必需的 provider 已被卸载，需重新安装。'
        ),
        resourceOutsideInstall: t(
          '`RESOURCE_OUTSIDE_INSTALL`: a resource or stage was registered outside the allowed hook.',
          '`RESOURCE_OUTSIDE_INSTALL`：在允许的钩子之外登记了资源或步骤。'
        ),
        lifecycleMutation: t(
          '`LIFECYCLE_MUTATION`: a hook (or a waiting setup/beforeRelease) tried to change the host.',
          '`LIFECYCLE_MUTATION`：钩子内部（或 setup/beforeRelease 等待期间）试图修改宿主。'
        ),
        invalidPipelineMode: t(
          '`INVALID_PIPELINE_MODE`: the constructor got an invalid pipeline mode.',
          '`INVALID_PIPELINE_MODE`：构造时传入了非法的 pipeline 模式。'
        ),
        pipelineModeMismatch: t(
          '`PIPELINE_MODE_MISMATCH`: a stage cannot be lifted to the host mode.',
          '`PIPELINE_MODE_MISMATCH`：某个步骤无法提升到宿主的模式。'
        ),
        pipelineNextDuplicate: t(
          '`PIPELINE_NEXT_DUPLICATE`: `next()` was called twice in one stage.',
          '`PIPELINE_NEXT_DUPLICATE`：同一个步骤中两次调用了 `next()`。'
        ),
        pipelineNextLate: t(
          '`PIPELINE_NEXT_LATE` (diagnostic): `next()` was called after the stage returned and was ignored.',
          '`PIPELINE_NEXT_LATE`（诊断）：步骤返回后才调用 `next()`，该调用被忽略。'
        ),
        pipelineExecuting: t(
          '`PIPELINE_EXECUTING`: a stage was registered while a pipeline was running.',
          '`PIPELINE_EXECUTING`：在 pipeline 运行期间登记了新步骤。'
        ),
        pipelineFailed: t(
          '`PIPELINE_FAILED`: in async mode a stage and its downstream both failed.',
          '`PIPELINE_FAILED`：异步模式下步骤与其下游同时失败，以 `AggregateError` 汇总。'
        ),
        pluginInstallRollbackFailed: t(
          '`PLUGIN_INSTALL_ROLLBACK_FAILED` (diagnostic): rolling back a failed install also failed.',
          '`PLUGIN_INSTALL_ROLLBACK_FAILED`（诊断）：回滚失败的安装时也出错了。'
        ),
        extensionNonEnumerableIgnored: t(
          '`EXTENSION_NON_ENUMERABLE_IGNORED` (diagnostic): non-enumerable install keys were ignored.',
          '`EXTENSION_NON_ENUMERABLE_IGNORED`（诊断）：`install` 返回值上的不可枚举键被忽略。'
        ),
        mutationQueueTimeout: t(
          '`MUTATION_QUEUE_TIMEOUT`: a change waited longer than `queueAdmissionTimeoutMs` and was dropped.',
          '`MUTATION_QUEUE_TIMEOUT`：某个变更排队超过 `queueAdmissionTimeoutMs`，已被放弃执行。'
        ),
        disposeStepTimeout: t(
          '`DISPOSE_STEP_TIMEOUT`: one cleanup step exceeded `disposeStepTimeoutMs`; cleanup continued.',
          '`DISPOSE_STEP_TIMEOUT`：某个清理步骤超过 `disposeStepTimeoutMs`，清理继续进行。'
        ),
        invalidOption: t(
          '`INVALID_OPTION` (on `TypeError`): an argument or option has an invalid shape.',
          '`INVALID_OPTION`（出现在 `TypeError` 上）：参数或选项格式不合法。'
        ),
        invalidConfigValue: t(
          '`INVALID_CONFIG_VALUE`: configuration contains unsupported values (symbols, class instances).',
          '`INVALID_CONFIG_VALUE`：配置中含有不支持的值（symbol、类实例等）。'
        ),
        configCycleRejected: t(
          '`CONFIG_CYCLE_REJECTED`: configuration contains a reference cycle.',
          '`CONFIG_CYCLE_REJECTED`：配置对象中存在循环引用，宿主无法复制并冻结它。'
        ),
        mutationExecutionTimeout: t(
          '`MUTATION_EXECUTION_TIMEOUT`: a running hook exceeded `mutationTimeoutMs`; the change was rolled back.',
          '`MUTATION_EXECUTION_TIMEOUT`：正在执行的钩子超过 `mutationTimeoutMs`，本次变更被回滚。'
        ),
        registrationRevoked: t(
          '`REGISTRATION_REVOKED`: an extracted extension function belongs to a removed or replaced registration.',
          '`REGISTRATION_REVOKED`：取出的扩展函数所属的注册已被卸载或替换。'
        ),
        installResultThenable: t(
          '`INSTALL_RESULT_THENABLE`: the `install` result has a `then` key and would be mistaken for a Promise.',
          '`INSTALL_RESULT_THENABLE`：`install` 返回值带有 `then` 键，会被误当作 Promise。'
        ),
        pipelineDrainTimeout: t(
          'PIPELINE_DRAIN_TIMEOUT: pipelines did not drain in budget. Ordinary unUse continues bounded cleanup, reports through diagnostic, and returns ok:false with the error in errors; it does not acquire the Host disposal physicalCompletion protocol.',
          '`PIPELINE_DRAIN_TIMEOUT`：管线未在预算内排空；普通卸载仍继续有界清理，经诊断报告并返回含错误的失败结果，不提供宿主释放的物理完成协议。'
        ),
        callbackFailed: t(
          'CALLBACK_FAILED: an unclassified configuration recipe/update, functional disposal middleware, or domain-surface option/descriptor read failed. Writable native errors keep identity and stack; immutable or non-Error values remain on cause, and complete foreign identities are preserved.',
          '`CALLBACK_FAILED`：配置变更、函数宿主释放中间件或领域表面选项及描述符读取发生未分类失败；可写原生对象保持身份及堆栈，不可修改或非错误值保留在原因上，完整外包身份不改写。'
        ),
        cleanupIncomplete: t(
          '`CLEANUP_INCOMPLETE`: disposal committed but cleanup failed or is still running.',
          '`CLEANUP_INCOMPLETE`：释放已提交，但清理出错或仍在进行。'
        ),
        compositionTargetUnmanaged: t(
          '`COMPOSITION_TARGET_UNMANAGED`: `openComposition()` got a value that is not a managed host.',
          '`COMPOSITION_TARGET_UNMANAGED`：`openComposition()` 收到的不是本包构造的托管宿主，可先用 `isManagedHost()` 判断。'
        )
      }
    },
    PluginHostRegistrationLifecycle: {
      summary: t('Phases of one registration.', '单次注册的生命周期阶段。'),
      values: {
        idle: t('`idle`: no install or disposal is running.', '`idle`：当前没有进行安装或释放。'),
        install: t(
          '`install`: install is running; resources and stages may be registered.',
          '`install`：正在安装，此时可以登记资源和步骤。'
        ),
        dispose: t(
          '`dispose`: the registration is being released.',
          '`dispose`：该注册正在被释放，不能再登记新资源。'
        )
      }
    },
    PluginHostStatus: {
      summary: t('Lifecycle status of a host.', '宿主的生命周期状态，决定是否还能接受变更。'),
      values: {
        active: t(
          '`active`: accepts installs, removals and config updates.',
          '`active`：可以接受安装、卸载和配置更新。'
        ),
        closing: t(
          '`closing`: disposal started; new changes are refused.',
          '`closing`：已开始释放，新的变更会被拒绝。'
        ),
        disposed: t(
          'disposed is terminal for work admission and protected capabilities. Identity, revision, plugin.disabled() and the composition revision remain readable for diagnostics.',
          '`disposed` 为工作准入及受保护能力的终态；身份、修订号、已禁用名称列表及组合修订号仍可读取以供诊断。'
        )
      }
    }
  },
  enhancers: {
    definePlugin: definePluginEnhancer,
    defineFeature: defineFeatureEnhancer
  }
}
