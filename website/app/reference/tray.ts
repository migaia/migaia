/**
 * Reference documentation of `@migaia/tray`. Rules: `app/reference/contract.ts`. Verified against
 * `packages/tray/src` (hosts/_, host/_, loader/_, adapter/_, runtime/*, tray.ts,
 * state-constants.ts, error-code.ts), README and USEGUIDE on 2026-10-17. Known discrepancy (not
 * changed here): `IRuntimeShutdownOptions.quiescenceMs` is declared, but `createRuntime()` does not
 * read it; only the managed host option `quiescenceMs` bounds waiting.
 */
import type { ICode, ILibraryReference, IMemberDoc, IText, ITypeDoc } from './contract.js'
import { capabilityReference } from './capability.js'
import { runtimeSharedTypes } from './rpc-runtime-shared.js'

/** Builds one bilingual text. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Short type doc for helper and union aliases. */
const alias = (en: string, zh: string): ITypeDoc => ({ summary: t(en, zh), members: {} })

/** Host definition used by the instance examples. */
const agentHost = `import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createTray, defineTrayHost } from '@migaia/tray'

const echo = defineFeature(() => ({ echo: (value: string) => value }))
const agent = defineTrayHost({
  name: 'agent',
  plugins: () => [definePlugin({ name: 'node', features: { svc: echo }, install: () => ({}) })] as const,
  exposes: ['node.svc']
})`

/** Registry example shared by `createTray` and `ITray`. */
const trayExample: ICode = {
  en: `${agentHost}

const tray = createTray({ hosts: [agent] })
try {
  const alice = await tray.spawn('agent', { id: 'alice' })
  console.log(await alice.request('node.svc.echo', 'hello')) // 'hello'
  const routed = tray.routing.roundRobin(agent)
  await routed.request('node.svc.echo', 'any ready instance')
  console.log(tray.list({ state: 'ready' }).length)
  await tray.restart('alice')
} finally {
  await tray.dispose()
}`,
  zh: `${agentHost}

const tray = createTray({ hosts: [agent] })
try {
  const alice = await tray.spawn('agent', { id: 'alice' })
  console.log(await alice.request('node.svc.echo', 'hello')) // 'hello'
  const routed = tray.routing.roundRobin(agent)
  await routed.request('node.svc.echo', 'any ready instance') // 任意一个就绪实例
  console.log(tray.list({ state: 'ready' }).length)
  await tray.restart('alice')
} finally {
  await tray.dispose()
}`
}

/** Static graph example shared by `createTrayGraph` and `ITrayGraph`. */
const graphExample = `import { createTrayGraph, type ITrayKey } from '@migaia/tray'

const configKey = 'config' as ITrayKey
const apiKey = 'api' as ITrayKey
const graph = createTrayGraph([
  { key: configKey, kind: 'value', start: () => ({ value: { baseUrl: '/api' }, release: () => undefined }) },
  {
    key: apiKey,
    kind: 'service',
    requires: [configKey],
    start: (context) => ({
      value: { baseUrl: context.get<{ baseUrl: string }>(configKey).baseUrl },
      release: () => undefined
    })
  }
])
await graph.ready()
console.log(graph.get<{ baseUrl: string }>(apiKey).baseUrl)
await graph.dispose()`

/** Managed host example shared by `createHost` and the managed `ITrayHost`. */
const managedExample: ICode = {
  en: `import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'

class AppHost extends PluginHost<Record<string, never>, string> {}
const provider = definePlugin({
  name: 'provider',
  features: { value: defineFeature(() => ({ value: 1 })) },
  install: () => ({ providerValue: 1 })
})

await using host = await createHost({
  create: () => new AppHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: 100 } }),
  plugins: [provider] as const,
  mutationAdmissionMs: 100,
  quiescenceMs: 100,
  shutdown: { mode: 'bounded' }
})
const result = await host.use(
  definePlugin({
    name: 'late',
    features: { value: defineFeature(() => ({}), { provider: provider.getFeature('value') }) },
    install: () => ({ late: true })
  })
)
if (result.ok) console.log(result.view.readyPlugins) // ['provider', 'late']
await host.unUse('provider') // 'late' becomes blocked`,
  zh: `import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'

class AppHost extends PluginHost<Record<string, never>, string> {}
const provider = definePlugin({
  name: 'provider',
  features: { value: defineFeature(() => ({ value: 1 })) },
  install: () => ({ providerValue: 1 })
})

await using host = await createHost({
  create: () => new AppHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: 100 } }),
  plugins: [provider] as const,
  mutationAdmissionMs: 100,
  quiescenceMs: 100,
  shutdown: { mode: 'bounded' }
})
const result = await host.use(
  definePlugin({
    name: 'late',
    features: { value: defineFeature(() => ({}), { provider: provider.getFeature('value') }) },
    install: () => ({ late: true })
  })
)
if (result.ok) console.log(result.view.readyPlugins) // ['provider', 'late']
await host.unUse('provider') // 'late' 变为 blocked`
}

/** Runtime example shared by `createRuntime` and `IRuntime`. */
const runtimeExample: ICode = {
  en: `import { createRuntime } from '@migaia/tray/runtime'

const result = await host.use(searchPlugin)
if (!result.ok) throw result.error
const runtime = createRuntime(result.view)
const hits = await runtime.run('search', { timeoutMs: 5000 }, async ({ extensions, signal }) =>
  extensions.search('tray', { signal })
)
const ticket = await runtime.run('search', { timeoutMs: false }, ({ self }) => self.unUse())
await ticket.completion // the plugin is removed after the callback settled
await runtime.dispose()`,
  zh: `import { createRuntime } from '@migaia/tray/runtime'

const result = await host.use(searchPlugin)
if (!result.ok) throw result.error
const runtime = createRuntime(result.view)
const hits = await runtime.run('search', { timeoutMs: 5000 }, async ({ extensions, signal }) =>
  extensions.search('tray', { signal })
)
const ticket = await runtime.run('search', { timeoutMs: false }, ({ self }) => self.unUse())
await ticket.completion // callback 结束后插件才被移除
await runtime.dispose()`
}

/** Loader example shared by the loader symbols. */
const loaderExample = `import { defineAdapter } from '@migaia/tray/adapter'
import { defineLoader, loadIntoHost } from '@migaia/tray/loader'

const moduleLoader = defineLoader<string, { plugin: unknown }>({
  load: async (url) => ({ value: await import(url), release: () => undefined })
})
const moduleAdapter = defineAdapter({ adapt: (artifact: { plugin: typeof searchPlugin }) => artifact.plugin })
const result = await loadIntoHost({
  host,
  source: './plugins/search.js',
  loader: moduleLoader,
  adapter: moduleAdapter,
  mutation: 'use',
  timeoutMs: 10_000
})
if (!result.ok) console.error(result.error)`

/** Fields shared by instance snapshots (`ITrayInstanceInfo` and its extensions). */
const infoMembers: Readonly<Record<string, IMemberDoc>> = {
  id: {
    summary: t(
      'Instance id given to `spawn(host, { id })`.',
      '调用 `spawn(host, { id })` 时由调用方给出的实例 id。'
    )
  },
  host: {
    summary: t('Name of the host definition the instance runs.', '该实例运行的 host 定义的名称。')
  },
  config: {
    summary: t(
      'Configuration of the current generation: the output of the host `config` validator, or the raw spawn input without one.',
      '当前 generation 的配置：host 的 `config` 校验函数的输出；没有校验函数时为 spawn 时传入的原始值。'
    )
  },
  generation: {
    summary: t(
      'Number of the current initialisation; it grows on every restart, replace or supervised restart.',
      '当前初始化的编号；每次 restart、replace 或监督重启都会递增。'
    )
  }
}

/** Fields of registry snapshots (`ITrayInstance`). */
const instanceMembers: Readonly<Record<string, IMemberDoc>> = {
  ...infoMembers,
  runtime: {
    summary: t(
      'How the instance runs: `coroutine`, `thread` or `process`.',
      '实例采用的运行方式：`coroutine`、`thread` 或 `process`。'
    ),
    values: { enum: 'TrayRuntime' }
  },
  state: {
    summary: t('Registry state of the instance.', '实例在注册表中的当前状态。'),
    values: { enum: 'TrayInstanceState' }
  },
  inFlight: {
    summary: t(
      'Business calls (`request`, `notify`, `stream`) sent to this admission and not finished; `leastInFlight` routing compares it.',
      '已发送给该实例且尚未结束的业务调用（`request`、`notify`、`stream`）数量；`leastInFlight` 路由按它比较。'
    )
  }
}

/** Host definition fields (`ITrayHostDefinition`, the DSL `ITrayHost`). */
const definitionMembers: Readonly<Record<string, IMemberDoc>> = {
  entry: {
    summary: t(
      'Required URL or nonempty entry string for thread and process hosts; coroutine hosts reject this field. The frozen definition stores its URL text for the runtime adapter.',
      '线程与进程宿主必填的网址或非空入口字符串；协程宿主拒绝此字段。冻结定义保留地址文本，交给运行时适配器。'
    ),
    default: t(
      'Absent for coroutine; required for thread and process runtimes.',
      '协程模式省略；线程和进程模式必须提供。'
    )
  },
  limits: {
    summary: t(
      'Thread-only resource limits containing optional positive heapBytes; process and coroutine hosts reject this field.',
      '仅线程可用的资源限制，包含可选正数堆字节上限；进程和协程宿主拒绝此字段。'
    ),
    default: t(
      'Omitted: no explicit thread heap limit is supplied to the adapter.',
      '省略时不向适配器提供显式线程堆上限。'
    )
  },
  sandbox: {
    summary: t(
      'Process-only caller-owned ITraySandbox whose wrap method transforms the launch command; Tray supplies no sandbox implementation.',
      '仅进程可用、由调用方持有的 `ITraySandbox`，其包装方法转换启动命令；本包不提供沙箱实现。'
    ),
    default: t(
      'Omitted: the process launch command is not sandbox-wrapped.',
      '省略时不为进程启动命令附加沙箱包装。'
    )
  },
  name: {
    summary: t(
      'Unique host name; `spawn(name, ...)` and `list({ host })` use it.',
      '唯一的 host 名称；`spawn(name, ...)` 与 `list({ host })` 都通过它引用该 host。'
    )
  },
  runtime: {
    summary: t('Where the instances of this host run.', '该 host 的实例运行在哪里，决定隔离程度。'),
    default: t('`coroutine`: in the parent event loop.', '`coroutine`：在父进程的事件循环中运行。'),
    values: { enum: 'TrayRuntime' }
  },
  config: {
    summary: t(
      'Validator `(input) => config` run on every initialisation; it receives the `config` given to `spawn()` / `replace()` and its output reaches `plugins(instance)`. Throw to reject.',
      '每次初始化时运行的校验函数 `(input) => config`；它收到 `spawn()` / `replace()` 传入的 `config`，输出交给 `plugins(instance)`。抛错表示拒绝。'
    ),
    default: t('Not set: the input is passed through unchecked.', '不设置：输入不经校验直接传递。')
  },
  plugins: {
    summary: t(
      'Factory `(instance, trayPlugin) => plugins` called on every initialisation. `instance` holds id, host, generation and config; `trayPlugin` is the plugin whose `tray` Feature gives `self()`, `to()`, `exit()`, `routing`, `publish()` and `subscribe()`.',
      '每次初始化时调用的工厂函数 `(instance, trayPlugin) => plugins`。`instance` 包含 id、host、generation 与 config；`trayPlugin` 的 `tray` Feature 提供 `self()`、`to()`、`exit()`、`routing`、`publish()` 与 `subscribe()`。'
    ),
    params: {
      instance: t(
        'Identity and validated config of this initialisation (`ITrayInstanceInfo`).',
        '本次初始化的身份与已校验配置（`ITrayInstanceInfo`）。'
      ),
      trayPlugin: t(
        'The client plugin; depend on it with `defineFeature(factory, { tray: trayPlugin.getFeature("tray") })`.',
        '客户端插件；通过 `defineFeature(factory, { tray: trayPlugin.getFeature("tray") })` 声明对它的依赖。'
      )
    },
    returns: t(
      'The plugin tuple installed into the instance host.',
      '要安装到该实例宿主中的插件元组。'
    ),
    example: `plugins: (instance, trayPlugin) => [
  definePlugin({
    name: 'worker',
    features: { jobs: defineFeature(({ tray }) => ({ whoami: () => tray.self().id }), { tray: trayPlugin.getFeature('tray') }) },
    install: () => ({})
  })
] as const`
  },
  exposes: {
    summary: t(
      'Feature paths `plugin.feature` that remote callers may use; methods are then called as `plugin.feature.method`.',
      '允许远程调用的 Feature 路径 `plugin.feature`；随后以 `plugin.feature.method` 调用其中的方法。'
    )
  },
  supervisor: {
    summary: t(
      'Restart policy and startup timeout of supervised instances; see `ITraySupervisorPolicy`.',
      '受监督实例的重启策略与启动超时，见 `ITraySupervisorPolicy`。'
    ),
    default: t(
      'Not set: the default policy of the runtime adapter.',
      '不设置：使用运行时适配层的默认策略。'
    )
  },
  routing: {
    summary: t(
      'Routing policies the instance plugins may call through `deps.tray.routing`; the parent also registers them.',
      '实例内插件可通过 `deps.tray.routing` 调用的路由策略；父端也会登记它们。'
    ),
    default: t(
      'Not set: only `roundRobin` and `leastInFlight`.',
      '不设置：只有内置的 `roundRobin` 与 `leastInFlight`。'
    )
  }
}

/** Entry kind docs. */
const entryKindValues = {
  value: t('`value`: plain data such as configuration.', '`value`：普通数据，例如应用配置。'),
  computed: t('`computed`: data derived from other entries.', '`computed`：由其它条目派生的数据。'),
  resource: t(
    '`resource`: something with a lifetime that `release` frees.',
    '`resource`：有生命周期、需由 `release` 释放的资源。'
  ),
  service: t(
    '`service`: an object other code calls, such as an API client.',
    '`service`：供其它代码调用的对象，例如 API 客户端。'
  )
}

/** Docs of the remote call methods (`ITrayRemote`, `ITrayRoutedRemote`). */
const remoteMethods = (routed: boolean): Readonly<Record<string, IMemberDoc>> => {
  /** Where the call goes, in each locale. */
  const target = routed
    ? t('a ready instance picked by the policy for this call', '由策略为本次调用选出的一个就绪实例')
    : t('this instance admission', '该实例当前的准入')
  return {
    request: {
      summary: t(
        `Calls an exposed method on ${target.en} and waits for its result. Not ready: \`TRAY_INSTANCE_NOT_READY\`; removed: \`TRAY_INSTANCE_UNKNOWN\`; target errors keep their own source and code.`,
        `在${target.zh}上调用公开的方法并等待结果。未就绪时抛 \`TRAY_INSTANCE_NOT_READY\`；已移除时抛 \`TRAY_INSTANCE_UNKNOWN\`；目标抛出的业务错误保留原有的 source 与 code。`
      ),
      params: {
        path: t(
          '`plugin.feature.method` of a Feature listed in the host `exposes`.',
          'host 的 `exposes` 中列出的 Feature 的 `plugin.feature.method` 路径。'
        ),
        args: t(
          '`(payload?, options?)`: one portable payload (omit for a zero-argument method; write `undefined` when passing options) and `ITrayCallOptions`.',
          '`(payload?, options?)`：一个可移植的参数（方法无参数时省略；需要传 options 时写 `undefined`），以及 `ITrayCallOptions`。'
        )
      },
      returns: t('The method result.', '目标方法的返回结果。'),
      example: `await remote.request('node.svc.echo', 'hello', { timeoutMs: 1000 })`
    },
    notify: {
      summary: t(
        `Sends a one-way call to ${target.en}; no result is returned.`,
        `向${target.zh}发送单向调用，不返回结果。`
      ),
      params: {
        path: t(
          '`plugin.feature.method` of an exposed Feature.',
          '已公开 Feature 的 `plugin.feature.method` 路径。'
        ),
        args: t(
          '`(payload?, options?)` as for `request`.',
          '`(payload?, options?)`，规则与 `request` 相同。'
        )
      },
      returns: t('Resolves once the call was sent.', '调用发送后 resolve。'),
      example: `await remote.notify('node.svc.log', 'started')`
    },
    stream: {
      summary: t(
        `Calls a method returning an iterable on ${target.en} and yields its items as they arrive.`,
        `在${target.zh}上调用返回可迭代对象的方法，并在元素到达时逐个产出。`
      ),
      params: {
        path: t(
          '`plugin.feature.method` of an exposed iterator method.',
          '已公开的迭代器方法的 `plugin.feature.method` 路径。'
        ),
        args: t(
          '`(payload?, options?)` as for `request`.',
          '`(payload?, options?)`，规则与 `request` 相同。'
        )
      },
      returns: t('An async iterator of the method items.', '方法元素的异步迭代器。'),
      example: `for await (const line of remote.stream('node.logs.tail', 100)) console.log(line)`
    }
  }
}

/** Members of the registry instance (`ITray`). */
const trayMembers: Readonly<Record<string, IMemberDoc>> = {
  routing: {
    summary: t(
      'Routing namespace: `tray.routing.roundRobin(host)` or `tray.routing("roundRobin", host)` returns a remote that picks a ready instance per call. Built-ins are `roundRobin` and `leastInFlight`; custom policies come from `createTray({ routing })` and host definitions.',
      '路由命名空间：`tray.routing.roundRobin(host)` 或 `tray.routing("roundRobin", host)` 返回一个每次调用都选择就绪实例的远程对象。内置策略为 `roundRobin` 与 `leastInFlight`；自定义策略来自 `createTray({ routing })` 和 host 定义。'
    )
  },
  publish: {
    summary: t(
      'Publishes a business topic from the parent to current subscribers, at most once each, with `meta.from = { parent: true }`. Not persisted; subscribers that are not ready miss it.',
      '从父端向当前订阅者发布业务主题，每个订阅最多收到一次，`meta.from` 为 `{ parent: true }`。不持久化；未就绪的订阅者会错过。'
    ),
    params: {
      topic: t(
        'Non-empty topic string; empty throws `TRAY_TOPIC_INVALID`.',
        '非空的主题字符串；为空时抛 `TRAY_TOPIC_INVALID`。'
      ),
      payload: t('Optional portable data.', '可选的可移植数据。')
    },
    returns: t(
      'Nothing; delivery failures are reported, never thrown.',
      '无返回值；投递失败只上报，不会抛出。'
    ),
    example: `tray.publish('config.changed', { version: 2 })`
  },
  subscribe: {
    summary: t('Subscribes the parent to a business topic.', '让父端订阅一个业务主题。'),
    params: {
      topic: t('Non-empty topic string.', '非空的主题字符串，例如 `jobs.done`。'),
      listener: t(
        '`(payload, meta) => void`; `meta.from` names the authenticated sender.',
        '`(payload, meta) => void`；`meta.from` 给出经过认证的发送方。'
      )
    },
    returns: t('A synchronous unsubscribe function.', '同步的取消订阅函数。'),
    example: `const stop = tray.subscribe('jobs.done', (payload, meta) => console.log(meta.from, payload))`
  },
  spawn: {
    summary: t(
      'Starts an instance of a registered host and waits until its plugins are installed and initialised (`ready`). A failed start removes the instance and rejects with `TRAY_INSTANCE_START_FAILED`.',
      '启动某个已登记 host 的实例，并等待其插件安装和初始化完成（`ready`）。启动失败时移除该实例，并以 `TRAY_INSTANCE_START_FAILED` reject。'
    ),
    params: {
      host: t(
        'Name of a host passed to `createTray({ hosts })`.',
        '传给 `createTray({ hosts })` 的某个 host 的名称。'
      ),
      options: t(
        '`{ id, config? }`: `id` is a new unique id chosen by the caller; `config` is portable input for the host validator (required when the validator output excludes `undefined`).',
        '`{ id, config? }`：`id` 由调用方指定，必须唯一；`config` 是交给 host 校验函数的可移植输入（校验函数输出不允许 `undefined` 时必填）。'
      )
    },
    returns: t('A typed remote bound to this admission.', '绑定到本次准入的类型化远程对象。'),
    example: `const alice = await tray.spawn('agent', { id: 'alice', config: { region: 'eu' } })`
  },
  instance: {
    summary: t(
      'Returns a remote for an existing instance without starting anything.',
      '为已存在的实例返回远程对象，不启动任何东西。'
    ),
    params: {
      host: t(
        'The same host definition object the instance was spawned from.',
        '该实例 spawn 时所用的同一个 host 定义对象。'
      ),
      id: t(
        'Id given to `spawn()`; unknown ids throw `TRAY_INSTANCE_UNKNOWN`.',
        '调用 `spawn()` 时给出的 id；未知 id 抛 `TRAY_INSTANCE_UNKNOWN`。'
      )
    },
    returns: t(
      'A typed remote; a different host throws `TRAY_HOST_MISMATCH`.',
      '类型化的远程对象；host 不匹配时抛 `TRAY_HOST_MISMATCH`。'
    ),
    example: `const alice = tray.instance(agent, 'alice')`
  },
  remove: {
    summary: t(
      'Stops an instance and deletes its registry record; old remotes then fail with `TRAY_INSTANCE_UNKNOWN`, even if the id is spawned again.',
      '停止实例并删除其注册记录；之后旧的远程对象一律以 `TRAY_INSTANCE_UNKNOWN` 失败，即使同一 id 再次 spawn 也不会恢复。'
    ),
    params: {
      id: t('Id given to `spawn()`.', '调用 `spawn()` 时给出的 id。'),
      options: t(
        '`{ graceMs }`: time for plugin cleanup inside the instance; default 5000.',
        '`{ graceMs }`：实例内插件清理的时间，默认 5000 毫秒。'
      )
    },
    returns: t('Resolves after removal.', '移除完成后 resolve。'),
    example: `await tray.remove('alice', { graceMs: 1000 })`
  },
  list: {
    summary: t(
      'Returns a frozen snapshot of the registered instances.',
      '返回已登记实例的冻结快照。'
    ),
    params: {
      filter: t(
        'Optional `{ host?, runtime?, state? }`; all given fields must match.',
        '可选的 `{ host?, runtime?, state? }`；给出的字段都必须匹配。'
      )
    },
    returns: t('A read-only array of `ITrayInstance`.', '只读的 `ITrayInstance` 数组。'),
    example: `tray.list({ host: 'agent', state: 'ready' })`
  },
  get: {
    summary: t(
      'Reads one instance with the connection details of the RPC layer.',
      '读取一个实例，并合并 RPC 层的连接详情。'
    ),
    params: { id: t('Id given to `spawn()`.', '调用 `spawn()` 时给出的实例 id。') },
    returns: t('An `ITrayInstanceDetail`.', '一个 `ITrayInstanceDetail` 详情对象。'),
    example: `const detail = await tray.get('alice')`
  },
  stop: {
    summary: t(
      'Stops an instance but keeps its record (state `stopped`); `restart()` can start it again. Operations on one instance run in call order.',
      '停止实例但保留其记录（状态为 `stopped`）；之后可用 `restart()` 再次启动。同一实例上的操作按调用顺序执行。'
    ),
    params: {
      id: t('Id given to `spawn()`.', '调用 `spawn()` 时给出的 id。'),
      options: t(
        '`{ graceMs }`: time for plugin cleanup; default 5000.',
        '`{ graceMs }`：插件清理的时间，默认 5000 毫秒。'
      )
    },
    returns: t('Resolves once stopped.', '实例停止后 resolve。'),
    example: `await tray.stop('alice')`
  },
  restart: {
    summary: t(
      'Starts a new generation of an instance with the same configuration.',
      '以相同配置启动实例的新一代（generation）。'
    ),
    params: { id: t('Id given to `spawn()`.', '调用 `spawn()` 时给出的 id。') },
    returns: t('The new `ITrayInstance` snapshot.', '新的 `ITrayInstance` 快照。'),
    example: `const next = await tray.restart('alice')
console.log(next.generation)`
  },
  replace: {
    summary: t(
      'Starts a new generation with a new configuration; the configuration is committed only if the new generation initialises.',
      '用新配置启动新一代实例；只有新一代初始化成功后才提交该配置。'
    ),
    params: {
      id: t('Id given to `spawn()`.', '调用 `spawn()` 时给出的 id。'),
      options: t(
        '`{ config }`: portable input for the host validator.',
        '`{ config }`：交给 host 校验函数的可移植输入。'
      )
    },
    returns: t('The new `ITrayInstance` snapshot.', '新的 `ITrayInstance` 快照。'),
    example: `await tray.replace('alice', { config: { region: 'us' } })`
  },
  on: {
    summary: t(
      'Observes one lifecycle event of all instances.',
      '观察所有实例的某一种生命周期事件。'
    ),
    params: {
      event: t(
        'A `TrayInstanceEvent` value such as `ready`.',
        '一个 `TrayInstanceEvent` 取值，例如 `ready`。'
      ),
      listener: t(
        'Receives a frozen `ITrayInstanceEventRecord`.',
        '接收冻结的 `ITrayInstanceEventRecord` 记录。'
      )
    },
    returns: t('An unsubscribe function.', '取消订阅的函数。'),
    example: `const off = tray.on('failed', (record) => console.error(record.id, record.error?.code))`
  },
  watch: {
    summary: t(
      'Iterates over lifecycle events; keeps at most the latest 100 unread records (not a persistent log).',
      '以迭代方式读取生命周期事件；最多保留最近 100 条未读记录（不是持久日志）。'
    ),
    params: {
      options: t(
        '`{ signal }` ends the iteration when it aborts.',
        '`{ signal }`：信号中止时结束迭代。'
      )
    },
    returns: t(
      'An async iterator of `ITrayInstanceEventRecord`.',
      '`ITrayInstanceEventRecord` 的异步迭代器。'
    ),
    example: `for await (const record of tray.watch({ signal })) console.log(record.event, record.id)`
  },
  dispose: {
    summary: t(
      'Removes every instance, then closes the registry; later calls fail with `TRAY_DISPOSED`. Concurrent calls share one Promise.',
      '移除所有实例，然后关闭注册表；之后的调用以 `TRAY_DISPOSED` 失败。并发调用共享同一个 Promise。'
    ),
    params: {
      options: t(
        '`{ graceMs }` for each instance cleanup; default 5000.',
        '`{ graceMs }`：每个实例的清理时间，默认 5000 毫秒。'
      )
    },
    returns: t('Resolves after everything stopped.', '全部停止后 resolve。'),
    example: `await tray.dispose()`
  }
}

/** Members of the managed host (`host:ITrayHost`). */
const managedMembers: Readonly<Record<string, IMemberDoc>> = {
  plugins: {
    summary: t(
      'Names of every admitted plugin definition, including blocked ones.',
      '所有已接纳插件定义的名称，包括被阻塞的。'
    )
  },
  readyPlugins: {
    summary: t(
      'Names of plugins installed and ready in the host.',
      '已在宿主中安装并就绪的插件名称。'
    )
  },
  state: {
    summary: t('Lifecycle state of the managed host.', '托管宿主的生命周期状态。'),
    values: { enum: 'TrayHostState' }
  },
  isActive: {
    summary: t('`true` while the state is `active`.', '托管宿主的状态为 `active` 时为 `true`。')
  },
  error: {
    summary: t(
      'The failure that moved the host to `failed`, otherwise `undefined`.',
      '使宿主进入 `failed` 的错误；否则为 `undefined`。'
    )
  },
  extensions: {
    summary: t('Merged APIs of the ready plugins, with types.', '已就绪插件合并后的 API，带类型。')
  },
  config: {
    summary: t(
      'Configuration store of the ready plugins (`get`, `update`).',
      '已就绪插件的配置仓库（`get`、`update`）。'
    )
  },
  pluginState: {
    summary: t(
      'Returns the graph state of one plugin: `registered`, `starting`, `ready`, `suspended`, `failed`, `blocked`, `rolled-back` or `released`; unknown names return `blocked`.',
      '返回某个插件在依赖图中的状态：`registered`、`starting`、`ready`、`suspended`、`failed`、`blocked`、`rolled-back` 或 `released`；未知名称返回 `blocked`。'
    ),
    params: { name: t('Plugin name.', '插件名称，即插件定义上的 `name`。') },
    returns: t('The state string.', '状态字符串。'),
    example: `if (host.pluginState('late') === 'blocked') console.log('waiting for provider')`
  },
  on: {
    summary: t(
      'Observes settled mutations and disposal events; see `ITrayHostEventMap`.',
      '观察已完成的变更与释放事件，见 `ITrayHostEventMap`。'
    ),
    params: {
      type: t(
        'Event name such as `registered` or `mutationFailed`.',
        '事件名称，例如 `registered` 或 `mutationFailed`。'
      ),
      listener: t(
        'Receives an event context whose `value` is the event payload.',
        '接收事件上下文，其 `value` 为事件载荷。'
      )
    },
    returns: t('An unsubscribe function.', '取消订阅的函数。'),
    example: `host.on('mutationFailed', ({ value }) => console.error(value.operation, value.name, value.error))`
  },
  use: {
    summary: t(
      'Adds a plugin definition. Missing required providers keep it `blocked` (not installed) until they appear.',
      '增加一个插件定义。缺少必需的提供方时，它保持 `blocked`（不安装），直到提供方出现。'
    ),
    params: {
      plugin: t(
        'A plugin from `definePlugin()` accepted by this host.',
        '由 `definePlugin()` 创建、被该宿主接受的插件。'
      )
    },
    returns: t(
      'A mutation result: `ok`, `committed`, `view` (the host with exact new types), `affected`, `cleanupComplete`, and `error` when `ok` is false.',
      '变更结果：`ok`、`committed`、`view`（带有精确新类型的宿主）、`affected`、`cleanupComplete`，`ok` 为 false 时还有 `error`。'
    ),
    example: `const result = await host.use(searchPlugin)
if (result.ok) result.view.extensions.search('tray')`
  },
  unUse: {
    summary: t(
      'Removes a plugin definition and blocks the plugins that require it.',
      '移除一个插件定义，并阻塞依赖它的插件。'
    ),
    params: {
      name: t(
        'Plugin name; unknown names give `{ ok: true, committed: false, removed: false }`.',
        '插件名称；未知名称返回 `{ ok: true, committed: false, removed: false }`。'
      )
    },
    returns: t(
      'A removal result with `removed`, `affected`, `view` and `cleanupComplete`.',
      '带 `removed`、`affected`、`view` 与 `cleanupComplete` 的移除结果。'
    ),
    example: `await host.unUse('provider')`
  },
  replace: {
    summary: t(
      'Replaces the current generation of a same-named plugin; on failure `committed` says whether the candidate already became current.',
      '替换同名插件的当前一代；失败时 `committed` 表示候选是否已经成为当前版本。'
    ),
    params: { plugin: t('New definition with the same `name`.', '同名的新插件定义。') },
    returns: t('A mutation result like `use()`.', '与 `use()` 相同形式的变更结果。'),
    example: `const result = await host.replace(searchPluginV2)`
  },
  dispose: {
    summary: t(
      'Ends the graph, removes the internal anchor and closes the host; concurrent calls share one Promise.',
      '终止依赖图、移除内部锚点并关闭宿主；并发调用共享同一个 Promise。'
    ),
    returns: t(
      'An `ITrayHostDisposalResult`; `cleanupComplete: false` means cleanup continues in `physicalCompletion`.',
      '一个 `ITrayHostDisposalResult`；`cleanupComplete: false` 表示清理仍在 `physicalCompletion` 中继续。'
    ),
    example: `const result = await host.dispose()
if (!result.cleanupComplete) await result.physicalCompletion`
  }
}

/** Reference of `@migaia/tray`. */
export const trayReference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Two layers. Static composition: `createTrayGraph(entries)` starts a fixed set of values, services and resources in dependency order and releases them in reverse. Instances: `defineTrayHost()` + `createTray({ hosts })` run full PluginHost instances as coroutines, Worker threads or child processes, with typed remote calls, routing and publish/subscribe.',
        '两层能力。静态组合：`createTrayGraph(entries)` 按依赖顺序启动一组固定的值、服务和资源，并按逆序释放。实例管理：`defineTrayHost()` + `createTray({ hosts })` 以协程、Worker 线程或子进程运行完整的 PluginHost 实例，并提供类型化远程调用、路由与发布订阅。'
      ),
      example: trayExample
    },
    host: {
      summary: t(
        'Managed PluginHost: `createHost({ create, plugins, ... })` wraps one host and installs plugins through a dependency graph, so a plugin whose required provider is missing stays `blocked` instead of failing, and `use` / `unUse` / `replace` return results with exact types.',
        '托管的 PluginHost：`createHost({ create, plugins, ... })` 包装一个宿主，并通过依赖图安装插件；缺少必需提供方的插件保持 `blocked` 而不是失败，`use` / `unUse` / `replace` 返回带精确类型的结果。'
      ),
      example: managedExample
    },
    loader: {
      summary: t(
        'Dynamic plugin loading: `defineLoader()` turns a source into an artifact with a release, and `loadIntoHost()` runs load → adapt → use/replace as one transaction that rolls back on failure.',
        '动态加载插件：`defineLoader()` 把来源转换为带释放函数的产物，`loadIntoHost()` 把“加载 → 适配 → use/replace”作为一个事务执行，失败时回滚。'
      ),
      example: loaderExample
    },
    adapter: {
      summary: t(
        'Artifact conversion: `defineAdapter({ adapt })` describes how a loaded artifact becomes a plugin definition; it owns no host, graph or cleanup.',
        '产物转换：`defineAdapter({ adapt })` 描述如何把已加载的产物转换为插件定义；它不拥有宿主、依赖图或清理职责。'
      ),
      example: `import { defineAdapter } from '@migaia/tray/adapter'

const adapter = defineAdapter({ adapt: (artifact: { plugin: typeof searchPlugin }) => artifact.plugin })`
    },
    runtime: {
      summary: t(
        'Plugin-scoped execution: `createRuntime(host)` runs callbacks against one ready plugin while holding its generation, with cancellation, deadlines and self-removal tickets.',
        '按插件执行任务：`createRuntime(host)` 在占用某个就绪插件当前一代的同时运行回调，支持取消、截止时间以及自我移除的票据。'
      ),
      example: runtimeExample
    }
  },
  symbols: {
    createTrayGraph: {
      role: 'factory',
      purpose: t(
        'Admits a complete, fixed array of entries (checks keys, kinds and dependencies) without starting anything. `ready()` then starts them in dependency order; `dispose()` releases them in reverse.',
        '接纳一个完整、固定的条目数组（检查 key、类型与依赖），但不启动任何条目。之后 `ready()` 按依赖顺序启动，`dispose()` 按逆序释放。'
      ),
      params: {
        entries: t(
          'Entry definitions; keys must be unique non-empty `ITrayKey` values and `requires` may only name keys in the same array.',
          '条目定义数组；key 必须是唯一且非空的 `ITrayKey`，`requires` 只能引用同一数组中的 key。'
        )
      },
      returns: t(
        'An `ITrayGraph`; invalid entries throw `TRAY_INVALID_ENTRY`, duplicate keys `TRAY_DUPLICATE_ENTRY`.',
        '一个 `ITrayGraph`；条目不合法时抛 `TRAY_INVALID_ENTRY`，key 重复时抛 `TRAY_DUPLICATE_ENTRY`。'
      ),
      example: graphExample,
      scenarios: [
        t(
          'Application composition root: config, database pool and API client started in order and closed in reverse.',
          '应用的组合根：配置、数据库连接池与 API 客户端按顺序启动、按逆序关闭。'
        )
      ],
      avoid: [
        t(
          'Sets that change at runtime: use the managed host (`@migaia/tray/host`) instead.',
          '运行时会变化的集合：请改用托管宿主（`@migaia/tray/host`）。'
        )
      ]
    },
    defineTrayHost: {
      role: 'factory',
      purpose: t(
        'Defines a host type that `createTray()` can run: its name, runtime, plugins factory, exposed Features and policies. Nothing runs at definition time; the result is frozen and identified by object identity.',
        '定义一种可由 `createTray()` 运行的 host：名称、运行方式、插件工厂、公开的 Feature 与策略。定义时不执行任何东西；结果被冻结，并以对象身份识别。'
      ),
      params: {
        definition: t(
          'Required `name`, `plugins(instance, trayPlugin)`, `exposes`; optional `runtime`, `entry` (thread/process), `config`, `supervisor`, `limits` (thread), `sandbox` (process), `routing`.',
          '必填 `name`、`plugins(instance, trayPlugin)`、`exposes`；可选 `runtime`、`entry`（thread/process）、`config`、`supervisor`、`limits`（thread）、`sandbox`（process）、`routing`。'
        )
      },
      returns: t(
        'A frozen host definition; invalid definitions throw `TRAY_HOST_INVALID`.',
        '冻结的 host 定义；定义不合法时抛 `TRAY_HOST_INVALID`。'
      ),
      example: `export const worker = defineTrayHost({
  name: 'worker',
  runtime: 'thread',
  entry: new URL('./worker.js', import.meta.url),
  plugins: () => [jobsPlugin] as const,
  exposes: ['jobs.queue'],
  supervisor: { restart: { mode: 'on-failure', maxRestarts: 3 } }
})`
    },
    createTray: {
      role: 'factory',
      optionDocs: {
        hosts: {
          summary: t(
            'Caller-selected definitions returned by `defineTrayHost()`, registered before instances can be spawned.',
            '调用方选择的 `defineTrayHost()` 定义列表；先注册后才能创建对应实例。'
          )
        },
        routing: {
          summary: t(
            'Additional shared policies returned by `defineRouting()`.',
            '由 `defineRouting()` 返回的附加共享路由策略。'
          ),
          default: t(
            'Omitted: only built-in routing policies are registered.',
            '省略时仅注册内置路由策略。'
          )
        },
        probe: {
          summary: t(
            'One or more RPC observation probes forwarded to instance connections.',
            '向实例连接转发的一个或多个远程调用观察探针。'
          ),
          default: t('Omitted: no observation probes are attached.', '省略时不挂接观察探针。')
        },
        report: {
          summary: t(
            'Synchronous diagnostic callback receiving background and listener failures.',
            '同步诊断回调，接收后台错误与监听失败。'
          ),
          default: t(
            '`console.error`: write diagnostics to the error console.',
            '`console.error`：向控制台错误通道输出诊断。'
          )
        }
      },
      purpose: t(
        'Creates the parent registry that spawns, routes, restarts and removes instances of the given host definitions.',
        '创建父端注册表，负责对给定 host 定义的实例执行 spawn、路由、重启与移除。'
      ),
      params: {
        options: t(
          '`{ hosts, routing?, probe?, report? }`: `hosts` are definitions from `defineTrayHost()`; `routing` adds shared policies; `probe` is one or more RPC probes; `report(error)` receives diagnostics (default `console.error`).',
          '`{ hosts, routing?, probe?, report? }`：`hosts` 是 `defineTrayHost()` 返回的定义；`routing` 增加共享路由策略；`probe` 是一个或多个 RPC 探针；`report(error)` 接收诊断（默认 `console.error`）。'
        )
      },
      returns: t('An `ITray` registry.', '一个 `ITray` 注册表实例。'),
      example: trayExample,
      scenarios: [
        t(
          'Run one agent per user as isolated instances and call them with typed paths.',
          '为每个用户运行一个隔离的 agent 实例，并通过类型化路径调用。'
        ),
        t(
          'Spread work over a pool of Worker threads with `leastInFlight` routing.',
          '用 `leastInFlight` 路由把任务分散到一组 Worker 线程。'
        )
      ]
    },
    serveTrayHost: {
      role: 'operation',
      optionDocs: {
        probe: {
          summary: t(
            'RPC probes passed to this child host connection.',
            '传给当前子宿主连接的远程调用探针。'
          ),
          default: t('Omitted: no probes are installed.', '省略时不安装观察探针。')
        },
        report: {
          summary: t(
            'Receives background failures from serving the child host.',
            '接收为子宿主提供服务期间出现的后台失败。'
          ),
          default: t(
            '`console.error`: report on the error console.',
            '`console.error`：向控制台错误通道上报。'
          )
        }
      },
      purpose: t(
        'Runs inside a Worker or child-process entry file: connects to the parent registry and serves the given thread/process host until the parent asks it to exit.',
        '在 Worker 或子进程的入口文件中运行：连接父端注册表，并为给定的 thread/process host 提供服务，直到父端要求退出。'
      ),
      params: {
        definition: t(
          'The same host definition module the parent imports.',
          '与父端导入的同一个 host 定义。'
        ),
        options: t(
          '`{ probe?, report? }` as in `createTray()`.',
          '`{ probe?, report? }`，含义与 `createTray()` 相同。'
        )
      },
      returns: t(
        'Resolves after the exit request and plugin cleanup, before the Worker or process ends.',
        '在退出请求与插件清理完成后、Worker 或进程结束前 resolve。'
      ),
      example: `import { serveTrayHost } from '@migaia/tray'
import { worker } from './hosts.js'

await serveTrayHost(worker)`
    },
    defineRoutingPolicy: {
      role: 'factory',
      purpose: t(
        'Defines a named routing policy whose `pick` chooses one ready instance per call. Register it with `createTray({ routing })` or a host `routing` tuple.',
        '定义一个命名路由策略，由 `pick` 为每次调用选出一个就绪实例。通过 `createTray({ routing })` 或 host 的 `routing` 元组登记。'
      ),
      params: {
        name: t(
          'Matches `^[a-z][A-Za-z0-9]*$`; not a built-in name.',
          '必须符合 `^[a-z][A-Za-z0-9]*$`，且不能是内置策略名。'
        ),
        pick: t(
          'Synchronous `(candidates, context) => id`: `candidates` are ready instance snapshots in spawn order, `context` is `{ host, sequence }`; return one candidate id.',
          '同步函数 `(candidates, context) => id`：`candidates` 是按 spawn 顺序排列的就绪实例快照，`context` 为 `{ host, sequence }`；返回其中一个候选的 id。'
        )
      },
      returns: t(
        'A frozen policy; invalid names or callbacks throw `TRAY_ROUTING_INVALID`.',
        '冻结的策略对象；名称或回调不合法时抛 `TRAY_ROUTING_INVALID`。'
      ),
      example: `const first = defineRoutingPolicy('first', (candidates) => candidates[0]!.id)
const tray = createTray({ hosts: [agent], routing: [first] })
await tray.routing.first(agent).request('node.svc.echo', 'hi')`
    },
    roundRobin: {
      role: 'constant',
      purpose: t(
        'Built-in policy that cycles through ready instances; one cursor is shared by both call forms.',
        '内置路由策略：依次轮流选择就绪实例；两种调用形式共享同一个游标。'
      ),
      example: `tray.routing.roundRobin(agent)`
    },
    leastInFlight: {
      role: 'constant',
      purpose: t(
        'Built-in policy that picks the ready instance with the fewest unfinished calls; spawn order breaks ties.',
        '内置路由策略：选择未完成调用最少的就绪实例；数量相同时按 spawn 顺序。'
      ),
      example: `tray.routing.leastInFlight(agent)`
    },
    TRAY_SOURCE: {
      role: 'constant',
      purpose: t(
        'The `source` value (`@migaia/tray`) on every error of this package; compare it before branching on `code`.',
        '本包每个错误上的 `source` 值（`@migaia/tray`）；先比对它确认错误来源，再按 `code` 分支处理。'
      ),
      example: `if (error.source === TRAY_SOURCE && error.code === TrayErrorCode.unavailable) await graph.ready()`
    },
    TrayErrorCode: {
      role: 'constant',
      purpose: t(
        'Table of the stable error codes of this package; values are the strings on `error.code`.',
        '本包稳定错误码的对照表；值就是错误对象 `error.code` 上的字符串。'
      ),
      example: `if (error.code === TrayErrorCode.instanceNotReady) await waitForReady()`
    },
    TrayInstanceEvent: {
      role: 'constant',
      purpose: t(
        'Lifecycle events observed with `tray.on()` and `tray.watch()`.',
        '可通过 `tray.on()` 与 `tray.watch()` 观察的实例生命周期事件名称，每次状态变化发布一条。'
      ),
      example: `tray.on(TrayInstanceEvent.failed, (record) => alert(record.id))`
    },
    TrayInstanceState: {
      role: 'constant',
      purpose: t(
        'Registry states of an instance, shown in `list()` and `get()`.',
        '实例在注册表中的状态取值，显示在 `list()` 与 `get()` 的结果中。'
      ),
      example: `tray.list({ state: TrayInstanceState.ready })`
    },
    TrayRuntime: {
      role: 'constant',
      purpose: t(
        'How a host runs its instances: `coroutine`, `thread` or `process`.',
        'host 运行其实例的方式，决定隔离程度与资源开销：`coroutine`、`thread` 或 `process`。'
      ),
      example: `defineTrayHost({ name: 'cpu', runtime: TrayRuntime.thread, entry: workerUrl, plugins: () => [] as const, exposes: [] })`
    },
    createHost: {
      role: 'factory',
      purpose: t(
        'Creates a managed host around one PluginHost built by `create()`. Plugins are admitted, ordered by their Feature dependencies and installed before the Promise resolves; failures roll back.',
        '围绕由 `create()` 构建的一个 PluginHost 创建托管宿主。插件在 Promise resolve 前完成接纳、按 Feature 依赖排序并安装；失败时回滚。'
      ),
      returns: t(
        'The managed `ITrayHost`; it supports `await using`. Failures throw an error whose `detail` gives the phase and cleanup state.',
        '托管的 `ITrayHost`，支持 `await using`。失败时抛出的错误带有 `detail`，说明失败阶段与清理状态。'
      ),
      options: 'ICreateHostOptions',
      example: managedExample,
      scenarios: [
        t(
          'Install and remove plugins at runtime while dependants wait as `blocked`.',
          '在运行时安装和移除插件，依赖方以 `blocked` 状态等待。'
        )
      ]
    },
    TrayHostState: {
      role: 'constant',
      purpose: t(
        'Lifecycle states of a managed host: `active`, `closing`, `terminal`, `failed`.',
        '托管宿主的生命周期状态，决定它能否继续接受插件变更：`active`、`closing`、`terminal`、`failed`。'
      ),
      example: `if (host.state === TrayHostState.active) await host.use(plugin)`
    },
    defineLoader: {
      role: 'factory',
      purpose: t(
        'Validates and freezes a loader `{ load(source, context) }` that returns `{ value, release }`; sync values, Promises and other thenables are accepted.',
        '校验并冻结一个加载器 `{ load(source, context) }`，它返回 `{ value, release }`；接受同步值、Promise 以及其它 thenable。'
      ),
      params: {
        loader: t(
          'Loader object `{ load }`; `context` gives `signal`, `deadlineAt` and `report`.',
          '加载器对象 `{ load }`；其 `context` 提供 `signal`、`deadlineAt` 与 `report`。'
        )
      },
      returns: t(
        'The frozen loader; an invalid shape throws `LOADER_CONTRACT_INVALID`.',
        '冻结的加载器；外形不合法时抛 `LOADER_CONTRACT_INVALID`。'
      ),
      example: loaderExample
    },
    loadIntoHost: {
      role: 'operation',
      purpose: t(
        'Runs load → adapt → `use` or `replace` as one transaction on a managed host. Before commit every failure releases the artifact; after commit the plugin generation owns its cleanup.',
        '在托管宿主上把“加载 → 适配 → `use` 或 `replace`”作为一个事务执行。提交前的任何失败都会释放产物；提交后由该插件的这一代负责清理。'
      ),
      returns: t(
        'The mutation result of `use` / `replace` (`ok`, `committed`, `view`).',
        '`use` / `replace` 的变更结果（`ok`、`committed`、`view`）。'
      ),
      options: 'ILoadIntoHostOptions',
      example: loaderExample
    },
    defineAdapter: {
      role: 'factory',
      purpose: t(
        'Validates and freezes an adapter `{ adapt(artifact, context) }` that turns a loaded artifact into a plugin definition for the host.',
        '校验并冻结一个适配器 `{ adapt(artifact, context) }`，它把已加载的产物转换为宿主可用的插件定义。'
      ),
      params: {
        adapter: t(
          'Adapter object `{ adapt }`; `context` gives `signal` and `deadlineAt`.',
          '适配器对象 `{ adapt }`；其 `context` 提供 `signal` 与 `deadlineAt`。'
        )
      },
      returns: t(
        'The frozen adapter; an invalid shape throws `ADAPTER_CONTRACT_INVALID`.',
        '冻结的适配器；外形不合法时抛 `ADAPTER_CONTRACT_INVALID`。'
      ),
      example: `const adapter = defineAdapter({ adapt: (artifact: { default: typeof plugin }) => artifact.default })`
    },
    createRuntime: {
      role: 'factory',
      purpose: t(
        'Creates a runtime bound to a managed host (or a mutation `view`) that runs callbacks against one ready plugin at a time.',
        '创建绑定到托管宿主（或变更结果 `view`）的运行器，每次针对一个就绪插件运行回调。'
      ),
      params: {
        host: t(
          'A managed host from `createHost()` or the `view` of a successful mutation result.',
          '由 `createHost()` 创建的托管宿主，或成功变更结果中的 `view`。'
        )
      },
      returns: t(
        'An `IRuntime`; a foreign host throws `RUNTIME_CONTRACT_INVALID`.',
        '一个 `IRuntime`；传入非托管宿主时抛 `RUNTIME_CONTRACT_INVALID`。'
      ),
      optionDocs: {
        shutdown: {
          summary: t(
            'Runtime-owned shutdown policy controlling whether disposal waits for every active callback; it never disposes the managed host.',
            '运行器自身的关闭策略，控制释放是否等待全部有效回调；不会释放托管宿主。'
          ),
          default: t(
            'Omitted: `{ mode: "strict-drain" }`, waiting for every active callback.',
            '省略时为 `{ mode: "strict-drain" }`，等待全部有效回调结束。'
          )
        },
        'shutdown.mode': {
          summary: t(
            'Whether runtime disposal returns after logical shutdown or waits for physical callback completion.',
            '运行器释放是在逻辑关闭后返回，还是继续等待回调物理完成。'
          ),
          values: {
            bounded: t(
              'Permit return while callbacks that ignore cancellation remain active.',
              '允许在忽略取消的回调仍运行时返回。'
            ),
            'strict-drain': t(
              'Wait for every tracked callback to settle before disposal resolves.',
              '等待全部被跟踪回调结算后再完成释放。'
            )
          }
        },
        'shutdown.quiescenceMs': {
          summary: t(
            'Declared shutdown budget field; the current runtime implementation does not read it.',
            '已声明的关闭预算字段；当前运行器实现不读取此值。'
          ),
          default: t(
            'Omitted: no effect, as this runtime does not consume the field.',
            '省略时没有影响，因为当前运行器不使用此字段。'
          )
        },
        report: {
          summary: t(
            'Optional synchronous `(error) => void` receiver for runtime diagnostics; the return value is ignored and synchronous throws are contained.',
            '接收运行器诊断的可选同步 `(error) => void`；不使用返回值，同步抛错会被隔离。'
          ),
          default: t(
            'Omitted: runtime diagnostics have no callback receiver.',
            '省略时运行器诊断没有回调接收方。'
          ),
          params: {
            error: t(
              'Original diagnostic error supplied by the runtime.',
              '运行器传入的原始诊断错误。'
            )
          },
          returns: t(
            'No result is consumed; provide a synchronous reporter.',
            '不使用结果；应提供同步上报器。'
          )
        }
      },
      example: runtimeExample,
      scenarios: [
        t(
          'Call a dynamically loaded plugin safely while it may be replaced.',
          '在插件可能被替换的情况下安全地调用动态加载的插件。'
        )
      ]
    }
  },
  types: {
    IGraphReadinessSnapshot: capabilityReference.types.IGraphReadinessSnapshot!,
    ITrayGraph: {
      summary: t(
        'A static composition returned by `createTrayGraph()`.',
        '`createTrayGraph()` 返回的静态依赖组合，负责启动与释放。'
      ),
      scenarios: [
        t(
          'Start an application in dependency order and close it in reverse at shutdown.',
          '按依赖顺序启动应用，关闭时按逆序释放。'
        )
      ],
      example: graphExample,
      members: {
        keys: {
          summary: t(
            'Frozen admitted keys in declaration order.',
            '按声明顺序排列、已冻结的已接纳 key。'
          )
        },
        state: {
          summary: t(
            '`open` before `ready()`; then the graph state; `failed` when a gate failed.',
            '调用 `ready()` 前为 `open`；之后为依赖图的状态；门控失败时为 `failed`。'
          )
        },
        error: {
          summary: t(
            'The current gate or graph error, unchanged.',
            '当前门控或依赖图的错误，保持原样不被替换。'
          )
        },
        ready: {
          summary: t(
            'Checks every `readiness` gate, then starts the entries in dependency order. A `blocked` gate can be retried by calling `ready()` again; other results are cached.',
            '先检查每个 `readiness` 门，再按依赖顺序启动条目。门为 `blocked` 时可以再次调用 `ready()` 重试；其它结果会被缓存。'
          ),
          returns: t(
            'Resolves when every entry is ready; rejects with the gate or start error.',
            '所有条目就绪后 resolve；以门控或启动错误 reject。'
          ),
          example: `await graph.ready()`
        },
        get: {
          summary: t('Reads the value of a ready entry.', '读取某个已就绪条目的值。'),
          params: {
            key: t(
              'An admitted `ITrayKey`, usually from your key constants.',
              '已接纳的 `ITrayKey`，通常来自应用自己定义的 key 常量。'
            )
          },
          returns: t(
            'The value; unknown keys throw `TRAY_UNKNOWN_ENTRY`, not ready throws `TRAY_UNAVAILABLE`.',
            '条目的值；未知 key 抛 `TRAY_UNKNOWN_ENTRY`，未就绪抛 `TRAY_UNAVAILABLE`。'
          ),
          example: `const api = graph.get<IApiClient>(AppKey.api)`
        },
        entryState: {
          summary: t('Returns the graph state of one entry.', '返回单个条目在依赖图中的状态。'),
          params: { key: t('An admitted `ITrayKey`.', '一个已接纳的 `ITrayKey`。') },
          returns: t(
            'The node state, such as `ready` or `failed`.',
            '节点状态，例如 `ready` 或 `failed`。'
          ),
          example: `graph.entryState(AppKey.api) // 'ready'`
        },
        dispose: {
          summary: t(
            'Stops admission and releases every entry in reverse dependency order; repeated calls share the result.',
            '停止接纳，并按依赖逆序释放所有条目；重复调用共享同一结果。'
          ),
          returns: t(
            'Resolves after release; release errors keep the original failure reachable.',
            '释放完成后 resolve；释放错误不会掩盖原始失败。'
          ),
          example: `await graph.dispose()`
        }
      }
    },
    ITrayEntryDefinition: {
      summary: t(
        'One entry of `createTrayGraph()`.',
        '传给 `createTrayGraph()` 的一个条目定义：key、依赖与启动方式。'
      ),
      members: {
        key: {
          summary: t(
            'Unique non-empty key; declare keys once in your own constants.',
            '唯一且非空的 key；在应用自己的常量中集中声明。'
          )
        },
        kind: {
          summary: t('Category used for diagnostics.', '用于诊断信息的条目类别。'),
          values: entryKindValues
        },
        requires: {
          summary: t(
            'Keys that must be ready first; `context.get()` may read only these.',
            '必须先就绪的 key；`context.get()` 只能读取这些。'
          ),
          default: t('`[]`: no dependencies.', '`[]`：没有依赖。')
        },
        readiness: {
          summary: t(
            'External gate `{ state: "ready" | "blocked" | "failed", error? }` checked by `ready()`; use a getter to supply fresh snapshots.',
            '由 `ready()` 检查的外部门 `{ state: "ready" | "blocked" | "failed", error? }`；需要新快照时使用 getter。'
          ),
          default: t('Not set: always ready.', '不设置：始终视为就绪。')
        },
        start: {
          summary: t(
            '`(context) => { value, release }`, called once the dependencies are ready.',
            '启动函数 `(context) => { value, release }`，在依赖全部就绪后调用。'
          ),
          params: {
            context: t(
              '`ITrayEntryContext` with `signal`, `get()` and `own()`.',
              '带 `signal`、`get()` 与 `own()` 的 `ITrayEntryContext`。'
            )
          },
          returns: t('The entry instance or a Promise of it.', '条目实例或其 Promise。')
        }
      }
    },
    ITrayEntryContext: {
      summary: t(
        'Context passed to `start()` of an entry.',
        '传给条目 `start()` 函数的上下文对象。'
      ),
      members: {
        signal: {
          summary: t(
            'Aborts when the graph closes; long work should observe it.',
            '依赖图关闭时中止；长时间运行的工作应观察它。'
          )
        },
        get: {
          summary: t(
            'Reads a ready dependency listed in `requires`.',
            '读取 `requires` 中列出的已就绪依赖。'
          ),
          params: { key: t('A key from `requires`.', '`requires` 中的某个 key。') },
          returns: t('The dependency value.', '依赖条目的值。'),
          example: `const config = context.get<IConfig>(AppKey.config)`
        },
        own: {
          summary: t(
            'Hands an extra resource to this entry so it is released with it.',
            '把额外资源交给当前条目，随条目一起释放。'
          ),
          params: {
            resource: t('The resource object.', '要托管的资源对象。'),
            descriptor: t(
              'Release descriptor from `@migaia/lifecycle` that frees it.',
              '负责释放它的 `@migaia/lifecycle` 释放描述。'
            )
          },
          returns: t('The same resource.', '同一个资源对象，便于继续使用。'),
          example: `const timer = context.own(setInterval(tick, 1000), () => clearInterval(timer))`
        }
      }
    },
    ITrayEntryInstance: {
      summary: t(
        'Result of `start()`: the value and how to release it.',
        '`start()` 的结果：值以及释放方式。'
      ),
      members: {
        value: {
          summary: t('The value `get(key)` returns.', '调用 `get(key)` 时返回给使用方的值。')
        },
        release: {
          summary: t(
            'Called once in reverse dependency order when the graph closes.',
            '依赖图关闭时按依赖逆序调用一次。'
          ),
          params: {
            context: t('Release context from the capability graph.', '能力图提供的释放上下文。')
          },
          returns: t('Nothing or a Promise.', '无返回值或一个 Promise。')
        }
      }
    },
    ITrayEntryKind: {
      summary: t('Union of entry categories.', '条目类别组成的联合类型，用于诊断。'),
      members: {
        value: { summary: entryKindValues.value },
        computed: { summary: entryKindValues.computed },
        resource: { summary: entryKindValues.resource },
        service: { summary: entryKindValues.service }
      }
    },
    ITrayKey: alias(
      'Branded non-empty string used as an entry key.',
      '带品牌标记的非空字符串，用作条目的 key。'
    ),
    ITrayState: alias(
      'State values of `ITrayGraph` (`open`, then the graph states).',
      '`ITrayGraph` 的状态取值类型（先为 `open`，之后为依赖图状态）。'
    ),
    ITrayErrorCode: alias(
      'Union of `TrayErrorCode` values.',
      '`TrayErrorCode` 全部取值组成的联合类型。'
    ),
    ITray: {
      summary: t(
        'The parent registry returned by `createTray()`.',
        '`createTray()` 返回的父端实例注册表。'
      ),
      scenarios: [
        t(
          'Spawn, restart and remove isolated agent instances.',
          '对隔离的 agent 实例执行 spawn、重启与移除。'
        ),
        t(
          'Route calls over a pool and broadcast business topics.',
          '在实例池中路由调用，并广播业务主题。'
        )
      ],
      example: trayExample,
      members: {
        ...trayMembers,
        '[Symbol.asyncDispose]': {
          summary: t(
            'Supports await using by forwarding to registry disposal, with the same retained disposal promise and default per-instance grace.',
            '支持异步自动释放，转发到注册表释放流程，保留相同释放结果与默认实例宽限期。'
          ),
          returns: t(
            'The same `Promise<void>` returned by dispose; cleanup failures retain that operation’s failure semantics.',
            '`dispose` 返回的相同 `Promise<void>`；清理失败保留该操作的失败语义。'
          ),
          example: `${agentHost}
await using tray = createTray({ hosts: [agent] })
await tray.spawn('agent', { id: 'alice' })`
        }
      }
    },
    'index:ITrayHost': {
      summary: t(
        'A host definition returned by `defineTrayHost()`.',
        '`defineTrayHost()` 返回的、已冻结的 host 定义，交给注册表使用。'
      ),
      scenarios: [
        t(
          'Share one definition module between the parent and the Worker or process entry.',
          '让父端与 Worker 或进程入口共享同一个定义模块。'
        )
      ],
      example: `export const worker = defineTrayHost({
  name: 'worker',
  runtime: 'thread',
  entry: new URL('./worker.js', import.meta.url),
  plugins: () => [] as const,
  exposes: []
})`,
      members: definitionMembers
    },
    ITrayHostDefinition: {
      summary: t(
        'Input of `defineTrayHost()`.',
        '`defineTrayHost()` 的输入：host 的名称、插件、公开路径与策略。'
      ),
      members: definitionMembers
    },
    IAnyTrayHost: {
      summary: t(
        'Any host definition, whatever its type parameters.',
        '任意 host 定义，不限定类型参数。'
      ),
      members: definitionMembers
    },
    ITrayRuntimeOptions: {
      summary: t(
        'Runtime-discriminated host options: coroutine has no launch fields, thread owns entry and heap limits, and process owns entry and an optional sandbox.',
        '按运行时判别的宿主选项：协程没有启动字段，线程持有入口和堆限制，进程持有入口与可选沙箱。'
      ),
      members: {
        runtime: definitionMembers.runtime!,
        entry: definitionMembers.entry!,
        limits: definitionMembers.limits!,
        sandbox: definitionMembers.sandbox!
      }
    },
    ITraySupervisorPolicy: {
      summary: t('Supervision policy of a host.', 'host 的监督策略：自动重启与启动超时。'),
      members: {
        restart: {
          summary: t(
            '`{ mode, maxRestarts, windowMs, initialDelayMs }`: `mode` is `never`, `on-failure` (restart after crashes) or `always` (also after clean exits); at most `maxRestarts` within `windowMs`, waiting `initialDelayMs` first.',
            '`{ mode, maxRestarts, windowMs, initialDelayMs }`：`mode` 为 `never`、`on-failure`（崩溃后重启）或 `always`（正常退出后也重启）；在 `windowMs` 内最多重启 `maxRestarts` 次，重启前先等待 `initialDelayMs`。'
          )
        },
        startupTimeoutMs: {
          summary: t(
            'Time an instance may take to become ready before startup counts as failed.',
            '实例变为就绪的最长时间，超时视为启动失败。'
          )
        }
      }
    },
    ITraySandbox: {
      summary: t(
        'External sandbox for process hosts; Tray ships none.',
        'process host 使用的外部沙箱；Tray 本身不提供实现。'
      ),
      members: {
        name: {
          summary: t('Name of the sandbox, shown in diagnostics.', '沙箱名称，显示在诊断信息中。')
        },
        wrap: {
          summary: t(
            'Rewrites the launch command synchronously, e.g. prefixing a sandbox binary.',
            '同步改写启动命令，例如在前面加上沙箱程序。'
          ),
          params: {
            command: t(
              'The original launch command (`ITrayLaunchCommand`).',
              '原始的启动命令 `ITrayLaunchCommand`。'
            )
          },
          returns: t(
            'The complete new command, keeping needed env and cwd.',
            '完整的新命令，需要保留所需的环境变量与工作目录。'
          ),
          example: `wrap: (command) => ({ ...command, command: 'firejail', args: [command.command, ...command.args] })`
        }
      }
    },
    ITrayLaunchCommand: {
      summary: t(
        'Child process launch command seen by `sandbox.wrap()`.',
        '`sandbox.wrap()` 看到的子进程启动命令。'
      ),
      members: {
        command: {
          summary: t('Executable to run, by path or name.', '要运行的可执行程序路径或名称。')
        },
        args: { summary: t('Command-line arguments in order.', '按顺序排列的命令行参数。') },
        cwd: { summary: t('Working directory, when set.', '工作目录（设置了时才有）。') },
        env: {
          summary: t(
            '`{ inherit, set }`: variable names to inherit and values to set.',
            '`{ inherit, set }`：要继承的变量名与要设置的值。'
          )
        }
      }
    },
    ITrayInstanceInfo: {
      summary: t(
        'Identity of one instance initialisation, passed to `plugins()` and returned by `self()`.',
        '一次实例初始化的身份信息，传给 `plugins()`，也由 `self()` 返回。'
      ),
      members: infoMembers
    },
    ITrayInstance: {
      summary: t('Frozen registry snapshot of one instance.', '注册表中某个实例的冻结快照。'),
      members: instanceMembers
    },
    ITrayInstanceDetail: {
      summary: t(
        '`ITrayInstance` plus RPC connection details, from `tray.get(id)`.',
        '`ITrayInstance` 加上 RPC 层的连接详情，由 `tray.get(id)` 返回。'
      ),
      members: { ...runtimeSharedTypes.IRuntimeConnectionDetail!.members, ...instanceMembers }
    },
    ITrayInstanceEventRecord: {
      summary: t(
        'Frozen record received by `on()` and `watch()`.',
        '`on()` 与 `watch()` 收到的冻结事件记录。'
      ),
      members: {
        ...instanceMembers,
        event: {
          summary: t('The lifecycle event that happened.', '本条记录对应的生命周期事件。'),
          values: { enum: 'TrayInstanceEvent' }
        },
        error: {
          summary: t(
            '`{ source, code }` of a failure, without the error object.',
            '失败的 `{ source, code }`，不包含错误对象本身。'
          )
        }
      }
    },
    ITraySpawnOptions: {
      summary: t('Options of `tray.spawn()`.', '`tray.spawn()` 的选项：新实例的 id 与配置。'),
      members: {
        id: {
          summary: t(
            'New instance id chosen by the caller; must be unused.',
            '由调用方指定的新实例 id，必须未被占用。'
          )
        }
      }
    },
    ITrayRemote: {
      summary: t(
        'Typed calls to one instance admission, from `spawn()`, `instance()` or `deps.tray.to()`.',
        '针对某个实例准入的类型化调用，来自 `spawn()`、`instance()` 或 `deps.tray.to()`。'
      ),
      scenarios: [
        t(
          'Talk to one specific instance, for example the agent of one user.',
          '与某个特定实例通信，例如某个用户专属的 agent。'
        ),
        t(
          'Cancel or time-limit a remote call with `ITrayCallOptions`.',
          '通过 `ITrayCallOptions` 取消远程调用或限制其时长。'
        )
      ],
      example: `const alice = await tray.spawn('agent', { id: 'alice' })
await alice.request('node.svc.echo', 'hello', { timeoutMs: 1000 })
await alice.notify('node.svc.echo', 'fire and forget')
const same = tray.instance(agent, 'alice')
console.log(same.id) // 'alice'`,
      members: {
        id: {
          summary: t('Id of the instance this remote is bound to.', '该远程对象绑定的实例 id。')
        },
        ...remoteMethods(false)
      }
    },
    ITrayRoutedRemote: {
      summary: t(
        'Remote returned by `tray.routing`; each call picks a ready instance.',
        '由 `tray.routing` 返回的远程对象；每次调用都会选择一个就绪实例。'
      ),
      members: {
        host: {
          summary: t(
            'Name of the host whose instances are candidates.',
            '其实例作为候选的 host 名称。'
          )
        },
        ...remoteMethods(true)
      }
    },
    ITrayCallOptions: {
      summary: t(
        'Third argument of `request` / `notify` / `stream`.',
        '`request` / `notify` / `stream` 的第三个参数：取消与超时。'
      ),
      members: {
        signal: {
          summary: t(
            'Cancels the call; the target receives the cancellation.',
            '取消本次调用；目标端会收到取消。'
          ),
          default: t('Not set: not cancellable.', '不设置：不可取消。')
        },
        timeoutMs: {
          summary: t(
            'Deadline of the call in milliseconds; the remaining time reaches the target.',
            '本次调用的截止时间（毫秒）；剩余时间会传给目标端。'
          ),
          default: t('Not set: no deadline.', '不设置：没有截止时间。')
        }
      }
    },
    ITrayClient: {
      summary: t(
        'The `tray` Feature available to plugins inside an instance.',
        '实例内插件通过依赖获得的 `tray` Feature。'
      ),
      members: {
        self: {
          summary: t(
            'Returns the identity of the current instance generation.',
            '返回当前实例这一代的身份信息。'
          ),
          returns: t('An `ITrayInstanceInfo`.', '一个 `ITrayInstanceInfo` 身份对象。'),
          example: `const { id, generation } = deps.tray.self()`
        },
        to: {
          summary: t(
            'Gets a remote to another instance through the parent.',
            '通过父端获取指向另一个实例的远程对象。'
          ),
          params: {
            host: t('The target host definition.', '目标实例所属的 host 定义。'),
            id: t('Target instance id given to `spawn()`.', '目标实例在 `spawn()` 时给出的 id。')
          },
          returns: t('A remote bound to the target admission.', '绑定到目标准入的远程对象。'),
          example: `const bob = await deps.tray.to(agent, 'bob')`
        },
        exit: {
          summary: t(
            'Ends the current instance; without error a clean exit, with error a crash. The first call decides.',
            '结束当前实例；不带错误为正常退出，带错误为崩溃。以第一次调用为准。'
          ),
          params: { error: t('Optional crash reason.', '可选的崩溃原因。') },
          returns: t(
            'Nothing; the instance shuts down after plugin cleanup.',
            '无返回值；实例会在插件清理后结束。'
          ),
          example: `deps.tray.exit(new Error('lost database'))`
        },
        routing: {
          summary: t(
            'Routing namespace inside the instance; declared policy names plus built-ins.',
            '实例内的路由命名空间：已声明的策略名加上内置策略。'
          )
        },
        publish: {
          summary: t(
            'Publishes a topic through the parent with authenticated `meta.from`.',
            '通过父端发布主题，`meta.from` 由父端认证。'
          ),
          params: {
            topic: t('Non-empty topic.', '非空的主题字符串。'),
            payload: t('Optional portable data.', '可选的可移植数据。')
          },
          returns: t('Resolves once handed to the parent.', '交给父端后 resolve。'),
          example: `await deps.tray.publish('jobs.done', { id: job.id })`
        },
        subscribe: {
          summary: t(
            'Subscribes inside the instance; the subscription ends with this generation.',
            '在实例内订阅主题；订阅随当前这一代结束。'
          ),
          params: {
            topic: t('Non-empty topic.', '非空的主题字符串。'),
            listener: t('`(payload, meta) => void`.', '监听函数 `(payload, meta) => void`。')
          },
          returns: t('An async, idempotent unsubscribe function.', '异步且幂等的取消订阅函数。'),
          example: `const stop = await deps.tray.subscribe('config.changed', reload)`
        }
      }
    },
    ITrayClientPlugin: alias(
      'Type of the `trayPlugin` argument of `plugins()`: a plugin exposing the `tray` Feature.',
      '`plugins()` 的 `trayPlugin` 参数类型：提供 `tray` Feature 的插件。'
    ),
    ITrayRoutingPolicy: {
      summary: t(
        'A routing policy from `defineRoutingPolicy()` or a built-in.',
        '由 `defineRoutingPolicy()` 创建或内置的路由策略。'
      ),
      scenarios: [
        t(
          'Prefer a specific instance, for example the one in the caller region.',
          '优先选择特定实例，例如与调用方同区域的实例。'
        )
      ],
      example: `const first = defineRoutingPolicy('first', (candidates) => candidates[0]!.id)`,
      members: {
        name: {
          summary: t(
            'Name used as `tray.routing.<name>`.',
            '在 `tray.routing.<name>` 中引用该策略的名称。'
          )
        }
      }
    },
    ITrayRoutingContext: {
      summary: t('Second argument of `pick`.', '`pick` 回调收到的第二个参数。'),
      members: {
        host: { summary: t('Name of the host being routed.', '本次路由选择所针对的 host 名称。') },
        sequence: {
          summary: t(
            'Number of earlier picks for this host and policy.',
            '该 host 与策略组合之前已选择的次数。'
          )
        }
      }
    },
    ITrayRouting: alias(
      'Type of `tray.routing`: callable `(name, host)` and members `.<name>(host)`.',
      '`tray.routing` 的类型：既可调用 `(name, host)`，也可用成员 `.<name>(host)`。'
    ),
    ITrayParentRoutingNames: alias(
      'Policy names available on the parent: built-ins, `createTray({ routing })` and host tuples.',
      '父端可用的策略名：内置策略、`createTray({ routing })` 与 host 元组中的策略。'
    ),
    ITrayTopicMeta: {
      summary: t(
        'Second argument of topic listeners.',
        '主题监听函数收到的第二个参数，说明发送方。'
      ),
      members: {
        from: {
          summary: t(
            'Sender authenticated by the parent: `{ id, host, generation }` for an instance, `{ parent: true }` for `tray.publish()`.',
            '由父端认证的发送方：实例发送时为 `{ id, host, generation }`，`tray.publish()` 发送时为 `{ parent: true }`。'
          )
        }
      }
    },
    ITrayPlugins: alias(
      'Plugin tuple returned by a host `plugins()` factory.',
      'host 的 `plugins()` 工厂返回的插件元组类型。'
    ),
    ITrayExposePath: alias(
      'Allowed `plugin.feature` paths for `exposes`.',
      '`exposes` 中允许填写的 `plugin.feature` 路径类型。'
    ),
    ITrayMethodPath: alias(
      'Callable `plugin.feature.method` paths of the exposed Features.',
      '已公开 Feature 中可调用的 `plugin.feature.method` 路径类型。'
    ),
    ITrayRuntime: alias('Union of `TrayRuntime` values.', '`TrayRuntime` 全部取值组成的联合类型。'),
    TrayInstanceEvent: alias(
      'Union of `TrayInstanceEvent` values.',
      '`TrayInstanceEvent` 全部取值组成的联合类型。'
    ),
    TrayInstanceState: alias(
      'Union of `TrayInstanceState` values.',
      '`TrayInstanceState` 全部取值组成的联合类型。'
    ),
    'host:ITrayHost': {
      summary: t(
        'A managed host returned by `createHost()`.',
        '`createHost()` 返回的托管插件宿主，通过依赖图管理插件。'
      ),
      scenarios: [
        t(
          'Load plugins at runtime; dependants stay `blocked` until providers arrive.',
          '运行时加载插件；依赖方在提供方到达前保持 `blocked`。'
        ),
        t(
          'Replace a plugin version without restarting the application.',
          '在不重启应用的情况下替换插件版本。'
        )
      ],
      example: managedExample,
      members: managedMembers
    },
    ITrayHostDynamic: {
      summary: t(
        'Conservative managed host view used when plugin names are not literal.',
        '插件名称不是字面量时使用的保守托管宿主视图。'
      ),
      members: managedMembers
    },
    ITrayResolvedHost: alias(
      'The managed host type with its ready plugins resolved exactly (up to 128 literal definitions).',
      '精确推导出就绪插件的托管宿主类型（最多 128 个字面量定义）。'
    ),
    ICreateHostOptions: {
      summary: t(
        'Options of `createHost()`.',
        '`createHost()` 的选项：宿主构造、初始插件、等待上限与关闭方式。'
      ),
      members: {
        create: {
          summary: t(
            'Builds the one PluginHost the managed host owns (a class instance or `defineHost()` handle).',
            '构建托管宿主所拥有的唯一 PluginHost（类实例或 `defineHost()` 句柄）。'
          )
        },
        plugins: {
          summary: t(
            'Initial plugin definitions, admitted and installed in order.',
            '初始插件定义，按顺序接纳并安装。'
          )
        },
        mutationAdmissionMs: {
          summary: t(
            'Longest wait for a queued mutation to start running.',
            '排队中的变更开始执行前的最长等待时间（毫秒）。'
          )
        },
        quiescenceMs: {
          summary: t(
            'Longest wait for physical plugin cleanup in `bounded` shutdown.',
            '`bounded` 关闭方式下等待插件物理清理的最长时间（毫秒）。'
          )
        },
        shutdown: {
          summary: t(
            '`{ mode }`: how `dispose()` waits.',
            '`{ mode }`：决定托管宿主 `dispose()` 的等待方式。'
          )
        },
        'shutdown.mode': {
          summary: t('Waiting strategy of disposal.', '托管宿主释放时采用的等待策略。'),
          values: {
            bounded: t(
              'Return after `quiescenceMs`; unfinished cleanup continues in `physicalCompletion`.',
              '等待 `quiescenceMs` 后返回；未完成的清理在 `physicalCompletion` 中继续。'
            ),
            'strict-drain': t(
              'Wait until every plugin release really completed.',
              '一直等到所有插件真正释放完成。'
            )
          }
        },
        report: {
          summary: t('Receives lifecycle and cleanup diagnostics.', '接收生命周期与清理诊断信息。'),
          default: t(
            'Not set: diagnostics are dropped after classification.',
            '不设置：诊断信息在分类后丢弃。'
          )
        }
      }
    },
    ITrayHostEventMap: {
      summary: t('Events of `host.on()` and their payloads.', '`host.on()` 可订阅的事件及其载荷。'),
      members: {
        use: { summary: t('A `use()` call has settled.', '某次 `use()` 调用已经执行完成。') },
        unUse: {
          summary: t('An `unUse()` call has settled.', '某次 `unUse()` 调用已经执行完成。')
        },
        replace: {
          summary: t('A `replace()` call has settled.', '某次 `replace()` 调用已经执行完成。')
        },
        registered: {
          summary: t('A plugin definition was registered.', '某个插件定义已登记到宿主中。')
        },
        removed: { summary: t('A plugin definition was removed.', '某个插件定义已从宿主中移除。') },
        replaced: { summary: t('A plugin definition was replaced.', '某个插件定义已被替换。') },
        mutationFailed: {
          summary: t(
            '`{ operation, name, error }` of a failed mutation.',
            '某次插件变更失败，载荷为 `{ operation, name, error }`。'
          )
        },
        disposing: {
          summary: t(
            'Disposal started (`state: "closing"`).',
            '托管宿主开始执行释放（`state: "closing"`）。'
          )
        },
        disposed: {
          summary: t(
            'Disposal finished (`state: "terminal"`, `cleanupComplete`).',
            '托管宿主已经全部完成释放（`state: "terminal"`、`cleanupComplete`）。'
          )
        }
      }
    },
    ITrayHostDisposalResult: {
      summary: t(
        'Result of the managed `host.dispose()`.',
        '托管宿主调用 `host.dispose()` 得到的释放结果。'
      ),
      members: {
        state: {
          summary: t(
            'Always `terminal`: the host has ended.',
            '固定为 `terminal`，表示宿主已终止。'
          )
        },
        termination: {
          summary: t('Which side ended the host.', '宿主是由哪一方终止的。'),
          values: {
            managed: t('`dispose()` of the managed host.', '托管宿主自身的 `dispose()`。'),
            'external-host': t(
              'The inner PluginHost was disposed directly.',
              '内部 PluginHost 被直接释放。'
            )
          }
        },
        cleanupComplete: {
          summary: t(
            '`false` while cleanup continues in `physicalCompletion`.',
            '清理仍在 `physicalCompletion` 中继续进行时为 `false`。'
          )
        },
        error: { summary: t('The disposal failure, if any.', '释放过程中的失败（如果有）。') }
      }
    },
    ITrayHostCreationError: {
      summary: t('Error thrown by `createHost()`.', '`createHost()` 抛出的错误，带失败详情。'),
      members: {
        detail: {
          summary: t('Phase and cleanup state of the failure.', '失败所在阶段与清理状态。')
        }
      }
    },
    ITrayHostCreationFailureDetail: {
      summary: t(
        '`detail` of a creation error.',
        '`createHost()` 创建失败时错误上的 `detail` 详情。'
      ),
      members: {
        phase: {
          summary: t('The phase in which creation failed.', '宿主创建在哪个阶段失败。'),
          values: {
            factory: t('`create()` threw.', '`create()` 抛错。'),
            admission: t('A plugin was rejected.', '某个插件未通过接纳检查。'),
            graph: t('The dependency graph could not be built.', '依赖图无法构建。'),
            setup: t('A plugin failed to install.', '某个插件安装失败。'),
            commit: t('Publishing the host failed.', '发布宿主时失败。')
          }
        },
        cleanupComplete: {
          summary: t('`false` while rollback continues.', '失败后的回滚仍在进行时为 `false`。')
        }
      }
    },
    ITrayPluginMutationObservation: {
      summary: t(
        'Fields of a `use` / `replace` result.',
        '`use` / `replace` 变更结果中的公共字段。'
      ),
      members: {
        operation: {
          summary: t('Which mutation was executed.', '本次执行的是哪一种变更。'),
          values: {
            use: t('`use()`.', '执行的是 `use()`。'),
            replace: t('`replace()`.', '执行的是 `replace()`。')
          }
        },
        name: { summary: t('Name of the changed plugin.', '本次变更所针对的插件名称。') },
        affected: { summary: t('Plugins whose state changed.', '状态因此改变的插件名称。') },
        topologyChanged: {
          summary: t('Whether dependency edges changed.', '依赖关系是否发生变化。')
        },
        view: {
          summary: t(
            'The host typed after this mutation; continue from it.',
            '本次变更之后带类型的宿主视图；之后从它继续操作。'
          )
        },
        cleanupComplete: {
          summary: t('`false` while cleanup continues.', '物理清理仍在继续进行时为 `false`。')
        }
      }
    },
    ITrayPluginRemovalObservation: {
      summary: t('Fields of an `unUse` result.', '`unUse` 移除结果中的公共字段。'),
      members: {
        name: { summary: t('Name of the removed plugin.', '本次被移除的插件名称。') },
        affected: {
          summary: t('Plugins blocked or removed as a consequence.', '因此被阻塞或移除的插件。')
        },
        view: { summary: t('The host typed after removal.', '移除之后带类型的宿主视图。') },
        cleanupComplete: {
          summary: t('`false` while cleanup continues.', '物理清理仍在继续进行时为 `false`。')
        }
      }
    },
    ITrayPluginMutationResult: {
      summary: t(
        'Use or replacement result combining the selected post-operation view with success and commit facts.',
        '安装或替换结果，结合操作后视图、成功状态和提交事实。'
      ),
      members: {
        ok: {
          summary: t(
            'True for successful committed mutation; false distinguishes failure through the committed field.',
            '变更成功提交时为真；假值需根据提交字段进一步区分失败阶段。'
          ),
          values: {
            true: t(
              'Mutation committed and completed without a returned primary error.',
              '变更已提交，且没有返回主错误。'
            ),
            false: t(
              'Mutation failed before or after commit; inspect committed and error.',
              '变更在提交前或后失败，应检查提交字段和错误。'
            )
          }
        },
        committed: {
          summary: t(
            'Whether the new topology was published; true with ok false means rollback to the previous view is no longer the result.',
            '新拓扑是否已经发布；已提交但失败时，返回结果不再是回滚后的旧视图。'
          ),
          values: {
            true: t(
              'The new topology is the committed state, including cleanup-failure outcomes.',
              '新拓扑已经成为提交状态，包括清理失败结果。'
            ),
            false: t(
              'The previous view remains authoritative because commit did not occur.',
              '没有发生提交，旧视图仍为权威状态。'
            )
          }
        },
        error: {
          summary: t(
            'Original operation Error present in unsuccessful branches, separate from incremental cleanup observations.',
            '仅失败分支提供的原始操作错误，与增量清理观察分开。'
          )
        }
      }
    },
    ITrayPluginRemovalResult: {
      summary: t(
        'Removal result distinguishing missing plugin, committed removal, precommit failure and cleanup failure after removal.',
        '卸载结果，区分插件缺失、已提交卸载、提交前失败和卸载后的清理失败。'
      ),
      members: {
        ok: {
          summary: t(
            'Whether the removal operation succeeded, including the successful no-op when the plugin was missing.',
            '卸载操作是否成功，包括目标插件不存在时的成功空操作。'
          ),
          values: {
            true: t(
              'Removal succeeded or the plugin was already absent.',
              '卸载成功，或目标插件原本就不存在。'
            ),
            false: t(
              'The operation returned a primary error before or after commit.',
              '操作在提交前或后返回了主错误。'
            )
          }
        },
        committed: {
          summary: t(
            'Whether logical removal was published; committed failures retain the new view while cleanup errors remain observable.',
            '逻辑卸载是否已发布；已提交的失败保留新视图，并继续暴露清理错误。'
          ),
          values: {
            true: t(
              'The logical removal was committed and the removed flag is true.',
              '逻辑卸载已经提交，已移除标志为真。'
            ),
            false: t(
              'No logical removal committed; the prior view remains current.',
              '没有提交逻辑卸载，旧视图保持有效。'
            )
          }
        },
        removed: {
          summary: t(
            'True exactly when a plugin was logically removed; false for missing-plugin no-op or precommit failure.',
            '仅插件已被逻辑移除时为真；插件缺失空操作或提交前失败时为假。'
          ),
          values: {
            true: t(
              'The target registration no longer belongs to the committed topology.',
              '目标登记已不属于提交后的有效拓扑。'
            ),
            false: t(
              'No registration was removed by this operation.',
              '此次操作没有移除任何目标登记。'
            )
          }
        },
        error: {
          summary: t(
            'Original primary Error supplied only for failed removal branches, without discarding the committed fact.',
            '仅失败卸载分支提供的原始主错误，不会丢弃提交事实。'
          )
        }
      }
    },
    ITrayPluginPhysicalCleanupResult: alias(
      'Cleanup observation (`cleanupErrors`, `physicalCompletion`).',
      '插件物理清理的观察结果（`cleanupErrors`、`physicalCompletion`）。'
    ),
    ITrayHostSource: alias(
      'PluginHost instance or `defineHost()` handle accepted by `create()`.',
      '`create()` 可以返回的 PluginHost 实例或 `defineHost()` 句柄。'
    ),
    ITrayHostState: alias(
      'Union of `TrayHostState` values.',
      '`TrayHostState` 全部取值组成的联合类型。'
    ),
    ITrayPluginConstraint: alias(
      'Plugin definitions accepted by a managed host.',
      '托管宿主接受的插件定义类型。'
    ),
    ITrayPluginCore: alias(
      'Core a plugin `install(core)` receives on a managed host.',
      '插件在托管宿主上的 `install(core)` 中收到的核心类型。'
    ),
    IUnsubscribe: alias(
      'Unsubscribe function returned by `host.on()`.',
      '调用 `host.on()` 返回的取消订阅函数。'
    ),
    IHostBaselinePlugins: alias(
      'Plugins installed by the inner host constructor.',
      '内部宿主构造时已安装的插件。'
    ),
    IPluginWithSynchronousShared: {
      summary: t(
        'Plugin with an optional synchronous `shared` factory.',
        '带可选同步 `shared` 工厂的插件。'
      ),
      members: {
        shared: {
          summary: t('Optional synchronous factory of shared values.', '可选的共享值同步工厂函数。')
        }
      }
    },
    ICanResolveReadyDefinitions: alias(
      'Whether exact ready-plugin types can be computed.',
      '能否精确推导就绪插件类型的判断类型。'
    ),
    IResolveReadyTrayPlugins: alias(
      'Exact ready plugin tuple, when computable.',
      '可计算时得到的精确就绪插件元组。'
    ),
    ILoader: {
      summary: t(
        'A loader from `defineLoader()`.',
        '`defineLoader()` 返回的已冻结加载器，供加载事务使用。'
      ),
      scenarios: [
        t(
          'Load plugin modules from URLs or a package registry at runtime.',
          '在运行时从 URL 或包仓库加载插件模块。'
        )
      ],
      example: loaderExample,
      members: {
        load: {
          summary: t(
            'Turns a source into `{ value, release }`.',
            '把来源加载并转换为产物 `{ value, release }`。'
          ),
          params: {
            source: t(
              'The `source` passed to `loadIntoHost()`.',
              '传给 `loadIntoHost()` 的 `source`。'
            ),
            context: t(
              '`signal`, `deadlineAt` and `report`.',
              '提供 `signal`、`deadlineAt` 与 `report` 的上下文。'
            )
          },
          returns: t('The loaded artifact or a Promise of it.', '已加载的产物或其 Promise。'),
          example: `load: async (url) => ({ value: await import(url), release: () => undefined })`
        }
      }
    },
    ILoaderContext: {
      summary: t(
        'Context passed to `load()`: cancellation, deadline and reporting.',
        '`load()` 收到的上下文：取消、截止时间与上报。'
      ),
      members: {
        signal: { summary: t('Aborts on cancellation or deadline.', '取消或到达截止时间时中止。') },
        deadlineAt: {
          summary: t(
            'Absolute deadline on `systemScheduler.now()`, or `undefined` without `timeoutMs`.',
            '基于 `systemScheduler.now()` 的绝对截止时间；未设置 `timeoutMs` 时为 `undefined`。'
          )
        },
        report: {
          summary: t(
            'Reports secondary failures without failing the load.',
            '上报次要失败，不会使加载失败。'
          )
        }
      }
    },
    ILoadedArtifact: {
      summary: t(
        'Result of `load()`: the artifact and how to release it.',
        '`load()` 的结果：产物及其释放方式。'
      ),
      members: {
        value: {
          summary: t('The artifact passed to the adapter.', '加载得到、随后交给适配器的产物。')
        },
        release: {
          summary: t('Release descriptor that frees the artifact.', '释放该产物的释放描述。')
        }
      }
    },
    ILoadIntoHostOptions: {
      summary: t(
        'Options of `loadIntoHost()`.',
        '`loadIntoHost()` 的选项：宿主、来源、加载器、适配器与变更方式。'
      ),
      members: {
        host: {
          summary: t(
            'Managed host (or mutation `view`) receiving the plugin.',
            '接收插件的托管宿主（或变更结果 `view`）。'
          )
        },
        source: {
          summary: t(
            'Input of `loader.load()`, e.g. a URL.',
            '交给 `loader.load()` 的输入，例如插件模块的 URL。'
          )
        },
        loader: {
          summary: t(
            'Loader from `defineLoader()`.',
            '由 `defineLoader()` 创建、负责取得产物的加载器。'
          )
        },
        adapter: {
          summary: t(
            'Adapter from `defineAdapter()`.',
            '由 `defineAdapter()` 创建、负责转换产物的适配器。'
          )
        },
        mutation: {
          summary: t('Whether to add or replace the plugin.', '是新增插件还是替换插件。'),
          values: {
            use: t('Add with `use()`.', '通过 `use()` 新增。'),
            replace: t('Replace with `replace()`.', '通过 `replace()` 替换。')
          }
        },
        signal: {
          summary: t('Cancels the transaction before commit.', '在提交之前取消整个加载事务。'),
          default: t('Not set: not cancellable.', '不设置：不可取消。')
        },
        timeoutMs: {
          summary: t(
            'Deadline of load and adapt, or `false` for none.',
            '加载与适配的截止时间；`false` 表示不设截止时间。'
          )
        },
        report: {
          summary: t('Receives secondary failures.', '接收次要失败（例如清理失败）。'),
          default: t('Not set: they are reported nowhere else.', '不设置：不会另行上报。')
        }
      }
    },
    ILoadIntoHostResult: {
      summary: t(
        'Managed `use` or `replace` outcome returned after loader custody transfers to the host.',
        '加载资源的保管权转交宿主后返回的安装或替换结果。'
      ),
      scenarios: [
        t(
          'Inspect commit facts before deciding whether loading may be retried.',
          '先检查提交事实，再决定是否可以重试加载。'
        )
      ],
      example: `const result = await loadIntoHost({ host, source, loader, adapter, mutation: 'use', timeoutMs: 5000 })
if (!result.ok) console.error(result.committed, result.error)
console.log(result.view, result.cleanupComplete)`,
      members: {
        ok: {
          summary: t(
            'Whether the managed mutation succeeded; inspect `committed` on failure.',
            '托管变更是否成功；失败时还需检查是否已经提交。'
          )
        },
        committed: {
          summary: t(
            'Whether the new topology was published, even if subsequent cleanup failed.',
            '新拓扑是否已发布；后续清理失败也可能已经提交。'
          )
        },
        error: {
          summary: t(
            'Original operation error in an unsuccessful outcome.',
            '失败结果中保留的原始操作错误。'
          )
        },
        operation: {
          summary: t(
            'Requested managed operation, `use` or `replace`.',
            '请求执行的托管操作，为安装或替换。'
          )
        },
        name: {
          summary: t(
            'Plugin name taken from the adapted definition.',
            '从适配后的插件定义取得的名称。'
          )
        },
        affected: {
          summary: t(
            'Names of registrations affected by the mutation.',
            '本次变更影响的登记名称列表。'
          )
        },
        topologyChanged: {
          summary: t(
            'Whether dependency topology changed during the operation.',
            '本次操作是否改变依赖拓扑。'
          )
        },
        view: {
          summary: t(
            'Typed host view authoritative after the returned outcome.',
            '本次结果确定后有效的带类型宿主视图。'
          )
        },
        cleanupComplete: {
          summary: t(
            'Whether physical cleanup has completed; false means it continues.',
            '物理清理是否已经完成；假值表示仍在继续。'
          )
        }
      }
    },
    IAdapter: {
      summary: t(
        'An adapter from `defineAdapter()`.',
        '`defineAdapter()` 返回的已冻结适配器，供加载事务使用。'
      ),
      scenarios: [
        t(
          'Accept modules that export plugins in different shapes.',
          '接受以不同形式导出插件的模块。'
        )
      ],
      example: `const adapter = defineAdapter({ adapt: (artifact: { default: typeof plugin }) => artifact.default })`,
      members: {
        adapt: {
          summary: t('Converts an artifact into a plugin definition.', '把产物转换为插件定义。'),
          params: {
            artifact: t('`value` returned by the loader.', '加载器返回的 `value`。'),
            context: t('`signal` and `deadlineAt`.', '提供 `signal` 与 `deadlineAt` 的上下文。')
          },
          returns: t('The plugin or a Promise of it.', '插件定义或其 Promise。'),
          example: `adapt: (artifact) => artifact.default`
        }
      }
    },
    IAdapterContext: {
      summary: t(
        'Context passed to `adapt()`: cancellation and deadline.',
        '`adapt()` 收到的上下文：取消与截止时间。'
      ),
      members: {
        signal: { summary: t('Aborts on cancellation or deadline.', '取消或到达截止时间时中止。') },
        deadlineAt: {
          summary: t(
            'Absolute deadline, or `undefined` without a timeout.',
            '绝对截止时间；没有超时设置时为 `undefined`。'
          )
        }
      }
    },
    IRuntime: {
      summary: t('A runtime from `createRuntime()`.', '`createRuntime()` 返回的插件任务运行器。'),
      scenarios: [
        t(
          'Call a plugin that may be replaced, without racing its removal.',
          '调用可能被替换的插件，而不会与其移除过程竞争。'
        )
      ],
      example: runtimeExample,
      members: {
        state: {
          summary: t('Lifecycle state of the runtime.', '运行器的生命周期状态。'),
          values: {
            active: t('Accepts new runs.', '接受新的运行请求。'),
            closing: t('`dispose()` started; no new runs.', '`dispose()` 已开始；不再接受新请求。'),
            terminal: t('Fully closed.', '已完全关闭。')
          }
        },
        activeRuns: { summary: t('Callbacks currently running.', '当前正在运行的回调数量。') },
        run: {
          summary: t(
            'Runs `execute` against the ready plugin `name`, holding its current generation until the callback settles. Cancellation and deadlines only abort the signal.',
            '针对就绪插件 `name` 运行 `execute`，在回调结束前一直占用它的当前一代。取消与截止时间只会中止信号。'
          ),
          params: {
            name: t('Name of a ready plugin.', '某个就绪插件的名称。'),
            options: t(
              '`{ signal?, timeoutMs }`; `timeoutMs` is required (`false` for none).',
              '`{ signal?, timeoutMs }`；`timeoutMs` 必填（`false` 表示不设）。'
            ),
            execute: t(
              'Callback `(context) => result`; `context` has `extensions`, `signal`, `deadlineAt`, `runId`, `plugin` and `self`.',
              '回调函数 `(context) => result`；`context` 包含 `extensions`、`signal`、`deadlineAt`、`runId`、`plugin` 与 `self`。'
            )
          },
          returns: t(
            'The callback result; failures use `RUNTIME_*` codes with the original on `cause`.',
            '回调的结果；失败使用 `RUNTIME_*` 错误码，原始错误在 `cause` 上。'
          ),
          example: `await runtime.run('search', { timeoutMs: 5000 }, ({ extensions }) => extensions.search('q'))`
        },
        dispose: {
          summary: t(
            'Stops new runs and aborts running signals, then waits according to the shutdown mode.',
            '停止接受新请求并中止运行中的信号，然后按关闭方式等待。'
          ),
          returns: t(
            '`{ state: "terminal", cleanupComplete }`.',
            '`{ state: "terminal", cleanupComplete }` 结果对象。'
          ),
          example: `await runtime.dispose()`
        }
      }
    },
    IRuntimeRunContext: {
      summary: t('Argument of a `run()` callback.', '`run()` 回调收到的上下文参数。'),
      members: {
        runId: { summary: t('Increasing id of this run.', '本次运行的递增编号，用于诊断。') },
        plugin: { summary: t('Name of the plugin being run.', '本次运行所针对的插件名称。') },
        extensions: {
          summary: t('API of that plugin generation, with types.', '该插件这一代的 API，带类型。')
        },
        signal: {
          summary: t(
            'Aborts on caller cancellation, deadline or runtime disposal.',
            '调用方取消、到达截止时间或运行器释放时中止。'
          )
        },
        deadlineAt: {
          summary: t(
            'Absolute deadline, or `undefined` with `timeoutMs: false`.',
            '本次运行的绝对截止时间；`timeoutMs: false` 时为 `undefined`。'
          )
        },
        self: {
          summary: t(
            'Self-mutation capability: `unUse()` / `replace(plugin)` tickets.',
            '针对当前插件的自我变更能力：`unUse()` / `replace(plugin)` 票据。'
          )
        }
      }
    },
    IRuntimeRunOptions: {
      summary: t('Second argument of `run()`.', '`run()` 的第二个参数：取消与截止时间。'),
      members: {
        signal: {
          summary: t(
            'Signal the caller aborts to cancel the run.',
            '调用方用于取消本次运行的信号。'
          ),
          default: t('Not set: not cancellable by the caller.', '不设置：调用方无法取消。')
        },
        timeoutMs: {
          summary: t(
            'Deadline in milliseconds, or `false` for none.',
            '截止时间（毫秒），`false` 表示不设。'
          )
        }
      }
    },
    IRuntimeSelfMutation: {
      summary: t(
        '`context.self`: mutations of the running plugin scheduled after the callback.',
        '`context.self`：在回调结束后执行的、针对当前插件的变更。'
      ),
      members: {
        unUse: {
          summary: t(
            'Schedules removal of this plugin generation after the callback settles.',
            '安排在回调结束后移除该插件的这一代。'
          ),
          returns: t(
            'A ticket; await `ticket.completion` outside the callback.',
            '一个票据；在回调之外等待 `ticket.completion`。'
          ),
          example: `return self.unUse()`
        },
        replace: {
          summary: t(
            'Schedules replacement of this plugin after the callback settles.',
            '安排在回调结束后替换该插件。'
          ),
          params: { plugin: t('New definition with the same name.', '同名的新插件定义。') },
          returns: t(
            'A ticket; awaiting it inside the callback throws `RUNTIME_CONTRACT_INVALID`.',
            '一个票据；在回调内部等待它会抛 `RUNTIME_CONTRACT_INVALID`。'
          ),
          example: `return self.replace(searchPluginV2)`
        }
      }
    },
    IRuntimeSelfMutationTicket: {
      summary: t(
        'Ticket returned by `self.unUse()` / `self.replace()`; not thenable.',
        '`self.unUse()` / `self.replace()` 返回的票据；它不是 thenable，需等待其 `completion`。'
      ),
      members: {
        completion: {
          summary: t(
            'Resolves after the callback settled and the host mutation finished.',
            '回调结束且宿主变更完成后 resolve。'
          )
        }
      }
    },
    IRuntimeShutdownOptions: {
      summary: t(
        '`shutdown` option of `createRuntime()`.',
        '`createRuntime()` 的 `shutdown` 选项：释放时的等待方式。'
      ),
      members: {
        mode: {
          summary: t(
            'How `dispose()` waits for running callbacks.',
            '`dispose()` 如何等待运行中的回调。'
          ),
          default: t('`strict-drain`.', '`strict-drain`：等待所有回调真正结束。'),
          values: {
            bounded: t('Return without waiting for every callback.', '不等待所有回调结束即返回。'),
            'strict-drain': t(
              'Wait until every running callback settled.',
              '一直等到所有运行中的回调结束。'
            )
          }
        },
        quiescenceMs: {
          summary: t(
            'Declared bound for `bounded` waiting; the current `createRuntime()` does not read it.',
            '为 `bounded` 等待声明的上限；当前的 `createRuntime()` 并未读取该字段。'
          ),
          default: t('Not set.', '不设置：不起作用。')
        }
      }
    },
    IRuntimeDisposalResult: {
      summary: t('Result of `runtime.dispose()`.', '运行器调用 `runtime.dispose()` 得到的结果。'),
      members: {
        state: {
          summary: t(
            'Always `terminal`: the runtime has ended.',
            '固定为 `terminal`，表示运行器已终止。'
          )
        },
        cleanupComplete: {
          summary: t(
            '`false` when callbacks are still running (`bounded`).',
            '仍有回调在运行时为 `false`（`bounded` 模式）。'
          )
        }
      }
    },
    IRuntimeExtensionsFor: alias(
      'Extension type of a ready plugin by name, used for `context.extensions`.',
      '按名称得到的就绪插件扩展类型，用于 `context.extensions`。'
    )
  },
  enums: {
    TrayRuntime: {
      summary: t('How a host runs its instances.', 'host 运行其实例的方式，决定隔离程度。'),
      values: {
        coroutine: t(
          '`coroutine`: in the parent event loop; light, stopping is cooperative.',
          '`coroutine`：在父进程事件循环中运行；开销小，停止依赖协作。'
        ),
        thread: t(
          '`thread`: a Worker isolate; needs `entry`, supports `limits.heapBytes`.',
          '`thread`：独立的 Worker 隔离环境；需要 `entry`，支持 `limits.heapBytes`。'
        ),
        process: t(
          '`process`: a child process; needs `entry`, supports `sandbox`.',
          '`process`：在独立子进程中运行；必须提供 `entry`，可选择外部 `sandbox`。'
        )
      }
    },
    TrayInstanceState: {
      summary: t('Registry states of an instance.', '实例在注册表中的状态。'),
      values: {
        starting: t(
          '`starting`: being spawned and initialised.',
          '`starting`：实例正在创建并执行插件初始化，尚未接收业务调用。'
        ),
        ready: t(
          '`ready`: initialisation completed and the instance accepts business calls.',
          '`ready`：初始化已经完成，实例可以接收业务调用。'
        ),
        restarting: t(
          '`restarting`: a new generation is starting.',
          '`restarting`：替换的新世代正在启动，尚未恢复就绪。'
        ),
        failed: t(
          '`failed`: start or run failed.',
          '`failed`：实例启动或运行失败，需检查对应错误。'
        ),
        stopped: t(
          '`stopped`: stopped by `stop()`; `restart()` can start it.',
          '`stopped`：实例已经停止但保留记录，可用 `restart()` 再次启动。'
        )
      }
    },
    TrayInstanceEvent: {
      summary: t(
        'Lifecycle events of instances.',
        '注册表发出的实例生命周期转换事件，供订阅方观察。'
      ),
      values: {
        spawned: t(
          '`spawned`: an instance was admitted.',
          '`spawned`：实例记录已被接纳，接下来进入初始化。'
        ),
        ready: t(
          '`ready`: an instance became ready.',
          '`ready`：实例初始化完成，现可接受业务调用。'
        ),
        restarting: t(
          '`restarting`: an instance restarts.',
          '`restarting`：实例开始重启，等待新世代恢复就绪。'
        ),
        failed: t(
          '`failed`: an instance failed; `error` has source and code.',
          '`failed`：实例启动或运行失败；`error` 携带来源与错误码。'
        ),
        stopped: t(
          '`stopped`: an instance stopped.',
          '`stopped`：实例已经停止，其注册记录仍保留。'
        ),
        removed: t(
          '`removed`: an instance record was deleted.',
          '`removed`：某个实例的记录已删除。'
        )
      }
    },
    TrayHostState: {
      summary: t('Lifecycle states of a managed host.', '托管宿主的生命周期状态。'),
      values: {
        active: t('`active`: accepts mutations.', '`active`：正常运行，可以接受插件变更。'),
        closing: t(
          '`closing`: `dispose()` is running.',
          '`closing`：`dispose()` 正在进行，不再接受变更。'
        ),
        terminal: t(
          '`terminal`: closed; create a new host.',
          '`terminal`：已关闭；需要创建新的宿主。'
        ),
        failed: t(
          '`failed`: an unrecoverable failure; see `error`.',
          '`failed`：发生了不可恢复的失败；查看 `error`。'
        )
      }
    },
    TrayErrorCode: {
      summary: t(
        'Stable error codes of `@migaia/tray`.',
        '`@migaia/tray` 的稳定错误码及其触发场景。'
      ),
      values: {
        hostUnavailable: t(
          '`TRAY_HOST_UNAVAILABLE`: routing found no ready instance; wait for one.',
          '`TRAY_HOST_UNAVAILABLE`：路由找不到就绪实例；需等待实例就绪。'
        ),
        routingUnknown: t(
          '`TRAY_ROUTING_UNKNOWN`: the policy name is not registered or declared.',
          '`TRAY_ROUTING_UNKNOWN`：策略名称未登记或未声明。'
        ),
        topicInvalid: t(
          '`TRAY_TOPIC_INVALID`: the topic is not a non-empty string.',
          '`TRAY_TOPIC_INVALID`：传入的主题不是非空字符串。'
        ),
        routingInvalid: t(
          '`TRAY_ROUTING_INVALID`: bad policy name, or `pick` threw or returned a non-candidate.',
          '`TRAY_ROUTING_INVALID`：策略名不合法，或 `pick` 抛错、返回了非候选 id。'
        ),
        hostInvalid: t(
          '`TRAY_HOST_INVALID`: the host definition or spawn options are invalid.',
          '`TRAY_HOST_INVALID`：host 定义或 spawn 选项不符合要求。'
        ),
        hostUnknown: t(
          '`TRAY_HOST_UNKNOWN`: `spawn()` names an unregistered host.',
          '`TRAY_HOST_UNKNOWN`：`spawn()` 使用了没有登记到注册表的 host。'
        ),
        hostMismatch: t(
          '`TRAY_HOST_MISMATCH`: `instance()` used a different host than the record.',
          '`TRAY_HOST_MISMATCH`：`instance()` 传入的 host 与实例记录不一致。'
        ),
        reservedName: t(
          '`TRAY_RESERVED_NAME`: `exposes` uses an internal plugin name.',
          '`TRAY_RESERVED_NAME`：`exposes` 使用了内部保留的插件名。'
        ),
        valueNotPortable: t(
          '`TRAY_VALUE_NOT_PORTABLE`: config or payload cannot cross realms.',
          '`TRAY_VALUE_NOT_PORTABLE`：配置或参数无法跨 realm 传输。'
        ),
        instanceDuplicate: t(
          '`TRAY_INSTANCE_DUPLICATE`: the id is already used.',
          '`TRAY_INSTANCE_DUPLICATE`：该实例 id 已被其它实例使用。'
        ),
        instanceUnknown: t(
          '`TRAY_INSTANCE_UNKNOWN`: no such instance, or it was removed.',
          '`TRAY_INSTANCE_UNKNOWN`：实例不存在或已被移除。'
        ),
        instanceNotReady: t(
          '`TRAY_INSTANCE_NOT_READY`: the instance is not ready.',
          '`TRAY_INSTANCE_NOT_READY`：目标实例当前还没有就绪。'
        ),
        instanceStartFailed: t(
          '`TRAY_INSTANCE_START_FAILED`: install or init failed; see `cause`.',
          '`TRAY_INSTANCE_START_FAILED`：安装或初始化失败；查看 `cause`。'
        ),
        pathNotExposed: t(
          '`TRAY_PATH_NOT_EXPOSED`: the path is outside `exposes`.',
          '`TRAY_PATH_NOT_EXPOSED`：调用的路径不在 `exposes` 声明的范围内。'
        ),
        childStateInvalid: t(
          '`TRAY_CHILD_STATE_INVALID`: the child was initialised twice or for another host.',
          '`TRAY_CHILD_STATE_INVALID`：子实例被重复初始化或初始化为其它 host。'
        ),
        disposed: t(
          '`TRAY_DISPOSED`: the registry is closing; create a new one.',
          '`TRAY_DISPOSED`：注册表正在关闭；需要创建新的注册表。'
        ),
        loaderContractInvalid: t(
          '`LOADER_CONTRACT_INVALID`: the loader or its result is malformed.',
          '`LOADER_CONTRACT_INVALID`：加载器或其结果的外形不合法。'
        ),
        loaderExecutionFailed: t(
          '`LOADER_EXECUTION_FAILED`: `load()` threw; see `cause`.',
          '`LOADER_EXECUTION_FAILED`：加载函数 `load()` 执行时抛错；原始错误见 `cause`。'
        ),
        adapterContractInvalid: t(
          '`ADAPTER_CONTRACT_INVALID`: the adapter or produced plugin is malformed.',
          '`ADAPTER_CONTRACT_INVALID`：适配器或其生成的插件外形不合法。'
        ),
        adapterExecutionFailed: t(
          '`ADAPTER_EXECUTION_FAILED`: `adapt()` threw; see `cause`.',
          '`ADAPTER_EXECUTION_FAILED`：适配函数 `adapt()` 执行时抛错；原始错误见 `cause`。'
        ),
        runtimeContractInvalid: t(
          '`RUNTIME_CONTRACT_INVALID`: bad host, name, options or callback for the runtime.',
          '`RUNTIME_CONTRACT_INVALID`：传给运行器的宿主、名称、选项或回调不合法。'
        ),
        runtimeDisposed: t(
          '`RUNTIME_DISPOSED`: `run()` after `dispose()`.',
          '`RUNTIME_DISPOSED`：运行器已释放，在 `dispose()` 之后仍调用了 `run()`。'
        ),
        runtimeExecutionFailed: t(
          '`RUNTIME_EXECUTION_FAILED`: the callback threw; see `cause`.',
          '`RUNTIME_EXECUTION_FAILED`：运行的回调函数抛错；原始错误见 `cause`。'
        ),
        runtimeAborted: t(
          '`RUNTIME_ABORTED`: cancelled or past the deadline.',
          '`RUNTIME_ABORTED`：被取消或超过截止时间。'
        ),
        artifactCleanupFailed: t(
          '`ARTIFACT_CLEANUP_FAILED`: releasing an artifact failed; see `cleanupErrors`.',
          '`ARTIFACT_CLEANUP_FAILED`：释放已加载的产物失败；查看 `cleanupErrors`。'
        ),
        invalidEntry: t(
          '`TRAY_INVALID_ENTRY`: an entry or start result breaks the contract.',
          '`TRAY_INVALID_ENTRY`：条目或其启动结果不符合契约。'
        ),
        duplicateEntry: t(
          '`TRAY_DUPLICATE_ENTRY`: a key appears twice.',
          '`TRAY_DUPLICATE_ENTRY`：同一个 key 在条目数组中出现了两次。'
        ),
        unknownEntry: t(
          '`TRAY_UNKNOWN_ENTRY`: the key was not admitted.',
          '`TRAY_UNKNOWN_ENTRY`：读取的 key 不在已接纳的条目中。'
        ),
        unavailable: t(
          '`TRAY_UNAVAILABLE`: not ready, gate failed or disposed.',
          '`TRAY_UNAVAILABLE`：未就绪、门控失败或已释放。'
        ),
        gateReadFailed: t(
          '`TRAY_GATE_READ_FAILED`: a readiness getter threw.',
          '`TRAY_GATE_READ_FAILED`：读取条目的 readiness 外部门时抛出了错误。'
        ),
        hostMutationBypass: t(
          '`HOST_MUTATION_BYPASS`: the inner host was changed directly, bypassing the managed host.',
          '`HOST_MUTATION_BYPASS`：绕过托管宿主直接修改了内部宿主。'
        )
      }
    }
  },
  enhancers: {}
}
