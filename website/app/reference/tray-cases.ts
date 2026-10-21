import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

/** Localized option stories share complete public-entry programs. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Managed operations borrow one explicitly constructed PluginHost. */
const managedOptionsSetup = `import { PluginHost, definePlugin } from '@migaia/plugin-host'
import { createHost } from '@migaia/tray/host'
class AppHost extends PluginHost<Record<string, never>, string> {}`

/** Both registry and child option chapters can run this same real Thread entry. */
const registryOptionsExample = (
  customRouting: boolean
): string => `import { isMainThread } from 'node:worker_threads'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createTray, defineTrayHost, defineRoutingPolicy, serveTrayHost } from '@migaia/tray'
import { defineProbe } from '@migaia/rpc-core/probe'
const firstReady = defineRoutingPolicy('firstReady', (candidates) => candidates[0]!.id)
const agent = defineTrayHost({
  name: 'agent', runtime: 'thread', entry: new URL(import.meta.url),
  routing: [firstReady] as const,
  plugins: () => [definePlugin({ name: 'node', features: {
    svc: defineFeature(() => ({ echo: (value: string) => value }))
  }, install: () => ({}) })] as const,
  exposes: ['node.svc'] as const
})
const probe = defineProbe({ stages: ['peer'], emit: () => {} })
const report = (error: unknown) => { console.error(error) }
if (!isMainThread) {
  await serveTrayHost(agent, { probe, report })
} else {
  const tray = createTray({ hosts: [agent] as const, routing: [firstReady] as const, probe, report })
  try {
    const instance = await tray.spawn('agent', { id: 'one' })
    console.log(await ${customRouting ? 'tray.routing.firstReady(agent)' : 'instance'}.request('node.svc.echo', '${customRouting ? 'routed' : 'hello'}'))
  } finally {
    await tray.dispose()
  }
}`

/** Managed shutdown examples resolve every held cleanup before their process exits. */
const hostOptionsExample = (bounded: boolean): string => `${managedOptionsSetup}
const release = Promise.withResolvers<void>()
const started = Promise.withResolvers<void>()
const host = await createHost({
  create: () => new AppHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }),
  plugins: [definePlugin({ name: 'counter', install: () => ({ count: 1 }), dispose: () => {
    started.resolve(); ${bounded ? 'return release.promise' : 'return undefined'}
  } })] as const,
  mutationAdmissionMs: 1000,
  quiescenceMs: ${bounded ? '0' : '1000'},
  shutdown: { mode: '${bounded ? 'bounded' : 'strict-drain'}' },
  report: (error) => { console.error(error) }
})
console.log(host.readyPlugins)
const closing = host.dispose()
await started.promise
const result = await closing
console.log(result.cleanupComplete)
release.resolve()
await result.physicalCompletion`

/** Loading and replacement use local artifacts, never network access or a private loader path. */
const loadOptionsExample = (replace: boolean): string => `${managedOptionsSetup}
import { defineLoader, loadIntoHost } from '@migaia/tray/loader'
import { defineAdapter } from '@migaia/tray/adapter'
const host = await createHost({
  create: () => new AppHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }),
  plugins: [], mutationAdmissionMs: 1000, quiescenceMs: 1000, shutdown: { mode: 'strict-drain' }
})
let releases = 0
const loader = defineLoader({ load: (value: number) => ({ value, release: { force: () => { releases++ } } }) })
const adapter = defineAdapter({ adapt: (value: number) => ({ name: 'answer' as const, install: () => ({ answer: () => value }) }) })
const caller = new AbortController()
try {
  ${replace ? "await loadIntoHost({ host, source: 42, loader, adapter, mutation: 'use', timeoutMs: false })" : ''}
  const result = await loadIntoHost({
    host, source: ${replace ? '7' : '42'}, loader, adapter, mutation: '${replace ? 'replace' : 'use'}',
    timeoutMs: ${replace ? 'false' : '5000'}, signal: caller.signal,
    report: (error) => { console.error(error) }
  })
  if (result.ok) {
    const extensions = result.view.extensions as { answer(): number }
    console.log(extensions.answer(), result.operation, releases)
  }
} finally {
  await host.dispose()
}`

/** Runtime shutdown controls callback waiting and never takes ownership of its managed Host. */
const runtimeOptionsExample = (bounded: boolean): string => `${managedOptionsSetup}
import { createRuntime } from '@migaia/tray/runtime'
const host = await createHost({
  create: () => new AppHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }),
  plugins: [{ name: 'billing', install: () => ({ double: (value: number) => value * 2 }) }] as const,
  mutationAdmissionMs: 1000, quiescenceMs: 1000, shutdown: { mode: 'strict-drain' }
})
const runtime = createRuntime(host, {
  shutdown: { mode: '${bounded ? 'bounded' : 'strict-drain'}' },
  report: (error) => { console.error(error) }
})
const release = Promise.withResolvers<void>()
try {
  const running = runtime.run('billing', { timeoutMs: false }, async ({ extensions }) => {
    await release.promise
    return extensions.double(21)
  })
  const closing = runtime.dispose()
  ${bounded ? 'console.log((await closing).cleanupComplete)' : ''}
  release.resolve()
  ${bounded ? '' : 'console.log((await closing).cleanupComplete)'}
  console.log(await running, host.state)
} finally {
  release.resolve()
  await runtime.dispose()
  await host.dispose()
}`

/** Own field examples reuse the complete scenario that demonstrates their setting. */
export const trayOptionExamples = {
  registry: registryOptionsExample(false),
  routing: registryOptionsExample(true),
  hostStrict: hostOptionsExample(false),
  hostBounded: hostOptionsExample(true),
  load: loadOptionsExample(false),
  replace: loadOptionsExample(true),
  runtimeStrict: runtimeOptionsExample(false),
  runtimeBounded: runtimeOptionsExample(true)
}

/** Related ownership and waiting fields stay in one observable configuration workflow. */
export const trayOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  registry: [
    {
      title: t('Register and observe a Thread host', '登记并观察线程宿主'),
      problem: t(
        'A parent must register host definitions before spawning them. hosts selects those definitions; probe observes connections on each side and report receives background failures. Omitted probes do not observe; the default reporter is console.error.',
        '父端必须先登记宿主定义，再创建实例。hosts 选择定义；两端的 probe 观察连接，report 接收后台失败。省略探针则不观察；默认上报器为 console.error。'
      ),
      example: trayOptionExamples.registry,
      result: t(
        'A real Thread serves the request and prints hello; registry disposal asks the child to exit.',
        '真实线程处理请求并输出 hello；注册表释放时要求子端退出。'
      ),
      covers: ['hosts', 'probe', 'report', 'routing']
    },
    {
      title: t('Choose a shared routing policy', '选择共享路由策略'),
      problem: t(
        'A service needs a deterministic first-ready policy. Register the exact defineRoutingPolicy result in routing and the host tuple. Without custom registration, only built-ins and declared host policies are available.',
        '服务需要确定的首个就绪实例策略。把 defineRoutingPolicy 的原对象登记到 routing 和宿主元组中。不额外登记时，只能使用内置策略和宿主声明的策略。'
      ),
      example: trayOptionExamples.routing,
      result: t(
        'The custom routing namespace dispatches to the ready Thread and prints routed.',
        '自定义路由命名空间向就绪线程派发并输出 routed。'
      ),
      covers: ['hosts', 'routing', 'probe', 'report']
    }
  ],
  serve: [
    {
      title: t('Observe a child connection', '观察子端连接'),
      problem: t(
        'A child entry must attach probes when it starts serving, rather than after requests have begun. Supply probe to serveTrayHost; omitted probes collect no child observations. report handles serving diagnostics.',
        '子端入口需要在开始服务时挂接探针，而非请求开始后再挂接。向 serveTrayHost 提供 probe；省略时不收集子端观察。report 处理服务诊断。'
      ),
      example: trayOptionExamples.registry,
      result: t(
        'The complete parent/child program prints hello and closes the child after cleanup.',
        '完整父子程序输出 hello，并在清理后关闭子端。'
      ),
      covers: ['probe', 'report']
    },
    {
      title: t('Keep serving diagnostics with routed calls', '为路由调用保留服务诊断'),
      problem: t(
        'Routing still uses an ordinary child connection. Its report callback observes background serving failures and defaults to console.error; a business request keeps its own success or failure.',
        '路由仍使用普通子端连接。report 回调观察后台服务失败，默认使用 console.error；业务请求保留自身的成功或失败结果。'
      ),
      example: trayOptionExamples.routing,
      result: t(
        'Prints routed from the actual child; the configured diagnostic receiver remains attached until exit.',
        '实际子端输出 routed；配置的诊断接收方保持到退出。'
      ),
      covers: ['probe', 'report']
    }
  ],
  host: [
    {
      title: t('Construct and strictly release a managed host', '构造并严格释放托管宿主'),
      problem: t(
        'A managed host needs one canonical PluginHost and its initial definitions. create constructs that owner; plugins selects definitions. mutationAdmissionMs and quiescenceMs are required budgets. strict-drain waits for real release; report receives lifecycle diagnostics.',
        '托管宿主需要唯一的规范 PluginHost 和初始定义。create 构造所有者，plugins 选择定义。mutationAdmissionMs 与 quiescenceMs 是必填预算。strict-drain 等待真正释放；report 接收生命周期诊断。'
      ),
      example: trayOptionExamples.hostStrict,
      result: t(
        "Prints ['counter'] then true; cleanup finishes before disposal returns.",
        "输出 ['counter'] 和 true；释放返回前已完成清理。"
      ),
      covers: [
        'create',
        'plugins',
        'mutationAdmissionMs',
        'quiescenceMs',
        'shutdown',
        'shutdown.mode',
        'report'
      ]
    },
    {
      title: t('Return while slow plugin cleanup continues', '慢速插件清理期间先返回'),
      problem: t(
        'A closing screen cannot wait indefinitely for plugin cleanup. bounded uses quiescenceMs before returning a logical result; unfinished work remains observable through physicalCompletion. strict-drain would wait instead.',
        '页面关闭不能无限等待插件清理。bounded 按 quiescenceMs 等待后返回逻辑结果；未完成工作仍通过 physicalCompletion 可观察。strict-drain 则继续等待。'
      ),
      example: trayOptionExamples.hostBounded,
      result: t(
        'Prints false while cleanup waits, then awaits physicalCompletion after releasing the gate.',
        '清理等待时输出 false，放行后等待 physicalCompletion 完成。'
      ),
      covers: [
        'create',
        'plugins',
        'mutationAdmissionMs',
        'quiescenceMs',
        'shutdown',
        'shutdown.mode',
        'report'
      ]
    }
  ],
  loader: [
    {
      title: t('Load a local artifact into a host', '把局部制品加载到宿主'),
      problem: t(
        'Loading needs a source, a loader that owns the artifact, an adapter that creates a compatible plugin, and the receiving host. mutation use adds a definition; timeoutMs is required. signal is cooperative and report receives secondary failures.',
        '加载需要来源、持有制品的 loader、创建兼容插件的 adapter，以及接收宿主。mutation use 新增定义；timeoutMs 必填。signal 采用合作式取消，report 接收次要失败。'
      ),
      example: trayOptionExamples.load,
      result: t(
        'Prints 42 use 0; the committed generation owns the artifact until host cleanup.',
        '输出 42 use 0；提交后的代次持有制品，直到宿主清理。'
      ),
      covers: ['host', 'source', 'loader', 'adapter', 'mutation', 'timeoutMs', 'signal', 'report']
    },
    {
      title: t('Replace a loaded plugin generation', '替换已加载的插件代次'),
      problem: t(
        'An updated artifact must replace the same-name definition. mutation replace performs that operation rather than adding a duplicate. timeoutMs false removes the loading deadline; report observes secondary cleanup failure without changing the primary outcome.',
        '更新后的制品需要替换同名定义。mutation replace 执行替换，避免新增重复定义。timeoutMs false 关闭加载截止期限；report 观察次要清理失败，不改变主结果。'
      ),
      example: trayOptionExamples.replace,
      result: t(
        'Prints 7 replace 1; the prior artifact has been released once.',
        '输出 7 replace 1；先前制品已释放一次。'
      ),
      covers: ['host', 'source', 'loader', 'adapter', 'mutation', 'timeoutMs', 'signal', 'report']
    }
  ],
  runtime: [
    {
      title: t('Wait for every runtime callback', '等待全部运行器回调'),
      problem: t(
        'A runtime shutdown must wait for callback settlement when released resources are still in use. strict-drain is the default. report receives runtime diagnostics and is absent by default; disposing the runtime never disposes its host.',
        '运行器关闭时，仍在使用的资源需要等待回调结算。默认 strict-drain 会等待。report 接收运行器诊断，默认没有接收方；释放运行器不会释放宿主。'
      ),
      example: trayOptionExamples.runtimeStrict,
      result: t(
        'Prints true, then 42 active; callback work settled and the host remains active.',
        '输出 true，以及 42 active；回调已结算，宿主仍存活。'
      ),
      covers: ['shutdown', 'shutdown.mode', 'report']
    },
    {
      title: t('Close runtime admission before callbacks finish', '在回调结束前关闭运行接纳'),
      problem: t(
        'A runtime may need to return without waiting for callbacks that ignore cancellation. bounded returns a cleanup snapshot immediately. It does not stop those callbacks, which must still settle before the host is released.',
        '运行器可能需要先返回，而不等待忽略取消的回调。bounded 立即返回清理快照，不会停止这些回调；释放宿主前仍需让它们结算。'
      ),
      example: trayOptionExamples.runtimeBounded,
      result: t(
        'Prints false, then 42 active after the callback is released.',
        '先输出 false，放行回调后输出 42 active。'
      ),
      covers: ['shutdown', 'shutdown.mode', 'report']
    }
  ]
}

/** Complete Node examples use real local Graphs and managed PluginHosts. */
export const trayCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  createTrayGraph: [
    {
      title: {
        en: 'Start dependencies before consumers and release them last',
        zh: '先启动依赖，再按反序释放服务'
      },
      problem: {
        en: "An application starts a service before its configuration is available, or tears down configuration while the service still uses it.\n\nArray order and scattered finally blocks do not describe dependencies; changing registration order can change which resource survives a failure.\n\nDeclare the service's config key in requires. createTrayGraph does not start during construction; ready starts dependencies first and dispose releases consumers before providers.",
        zh: '应用启动服务时配置还没准备好，退出时又可能先释放服务仍在使用的配置。\n\n只靠数组顺序与分散的 finally 无法表达依赖；调整登记顺序，就可能改变启动和释放的先后。\n\n在服务的 requires 中声明配置键。createTrayGraph 构造时不启动，ready 先启动依赖，dispose 先释放使用者，再释放提供者。'
      },
      example: {
        en: "import { createTrayGraph, type ITrayKey } from '@migaia/tray'\n\nconst config = 'config' as ITrayKey\nconst service = 'service' as ITrayKey\nconst events: string[] = []\nconst tray = createTrayGraph([\n  {\n    key: service,\n    kind: 'service',\n    requires: [config],\n    start: (context) => {\n      events.push('start:service')\n      return {\n        value: context.get<number>(config) * 2,\n        release: () => {\n          events.push('release:service')\n        }\n      }\n    }\n  },\n  {\n    key: config,\n    kind: 'value',\n    start: () => {\n      events.push('start:config')\n      return {\n        value: 21,\n        release: () => {\n          events.push('release:config')\n        }\n      }\n    }\n  }\n])\nconsole.log('before:', tray.state, events.length)\nawait tray.ready()\nconsole.log('value:', tray.get<number>(service))\nawait tray.dispose()\nconsole.log(events.join(','))\nconsole.log('after:', tray.state)",
        zh: "import { createTrayGraph, type ITrayKey } from '@migaia/tray'\n\nconst config = 'config' as ITrayKey\nconst service = 'service' as ITrayKey\nconst events: string[] = []\nconst tray = createTrayGraph([\n  {\n    key: service,\n    kind: 'service',\n    requires: [config],\n    start: (context) => {\n      events.push('start:service')\n      return {\n        value: context.get<number>(config) * 2,\n        release: () => {\n          events.push('release:service')\n        }\n      }\n    }\n  },\n  {\n    key: config,\n    kind: 'value',\n    start: () => {\n      events.push('start:config')\n      return {\n        value: 21,\n        release: () => {\n          events.push('release:config')\n        }\n      }\n    }\n  }\n])\nconsole.log('启动前：', tray.state, events.length)\nawait tray.ready()\nconsole.log('值：', tray.get<number>(service))\nawait tray.dispose()\nconsole.log(events.join(','))\nconsole.log('之后：', tray.state)"
      },
      result: {
        en: 'Output: before: open 0; value: 42; start:config,start:service,release:service,release:config; after: terminal.\n\nThe dependency starts first despite being listed second, and is released last. These are same-realm resources with explicit release callbacks; this example does not demonstrate Worker or process isolation.',
        zh: '依次输出：启动前： open 0；值： 42；start:config,start:service,release:service,release:config；之后： terminal。\n\n配置虽然排在数组第二项，仍先启动、后释放。本例是同一运行环境内、带显式 release 回调的资源组合，不证明 Worker 或进程隔离。'
      }
    },
    {
      title: {
        en: 'Retry a blocked readiness gate without retrying a failed gate',
        zh: '仅重试暂时阻塞的就绪门'
      },
      problem: {
        en: 'A service cannot start until an external provider becomes ready, but a temporary block should not be treated as a permanently failed startup.\n\nPolling a captured blocked object keeps reading old facts, while retrying every rejected Promise can rerun a failure the provider has declared final.\n\nReturn current snapshots from the readiness getter and call ready again after a blocked result. A failed snapshot is final and retains its rejected Promise.',
        zh: '外部提供者尚未就绪时服务不能启动，但暂时阻塞不应被当成永远无法恢复的启动失败。\n\n一直读取同一份 blocked 快照会看到旧事实；无差别重试所有拒绝，又可能反复执行提供者已经判定失败的操作。\n\n用 readiness getter 返回当前快照，blocked 后显式再次调用 ready；failed 是最终结果，会保留原来的拒绝 Promise。'
      },
      example: {
        en: "import { createTrayGraph, type ITrayKey, type IGraphReadinessSnapshot } from '@migaia/tray'\n\nconst key = 'search' as ITrayKey\nconst waiting = new Error('provider not ready')\nlet snapshot: IGraphReadinessSnapshot = { state: 'blocked', error: waiting }\nlet starts = 0\nconst tray = createTrayGraph([\n  {\n    key,\n    kind: 'service',\n    get readiness() {\n      return snapshot\n    },\n    start: () => {\n      starts += 1\n      return { value: 42, release: () => undefined }\n    }\n  }\n])\ntry {\n  await tray.ready()\n} catch (error) {\n  console.log('blocked:', error === waiting, starts)\n}\nsnapshot = { state: 'ready', error: undefined }\nawait tray.ready()\nconsole.log('retry:', tray.state, starts, tray.get<number>(key))\nawait tray.dispose()\n\nconst failure = new Error('provider failed')\nconst failed = createTrayGraph([\n  {\n    key,\n    kind: 'service',\n    readiness: { state: 'failed', error: failure },\n    start: () => ({ value: 0, release: () => undefined })\n  }\n])\nconst first = failed.ready()\nconsole.log('cached:', first === failed.ready())\ntry {\n  await first\n} catch (error) {\n  console.log('cause:', error === failure)\n}\nawait failed.dispose()",
        zh: "import { createTrayGraph, type ITrayKey, type IGraphReadinessSnapshot } from '@migaia/tray'\n\nconst key = 'search' as ITrayKey\nconst waiting = new Error('提供者尚未就绪')\nlet snapshot: IGraphReadinessSnapshot = { state: 'blocked', error: waiting }\nlet starts = 0\nconst tray = createTrayGraph([\n  {\n    key,\n    kind: 'service',\n    get readiness() {\n      return snapshot\n    },\n    start: () => {\n      starts += 1\n      return { value: 42, release: () => undefined }\n    }\n  }\n])\ntry {\n  await tray.ready()\n} catch (error) {\n  console.log('阻塞：', error === waiting, starts)\n}\nsnapshot = { state: 'ready', error: undefined }\nawait tray.ready()\nconsole.log('重试：', tray.state, starts, tray.get<number>(key))\nawait tray.dispose()\n\nconst failure = new Error('提供者失败')\nconst failed = createTrayGraph([\n  {\n    key,\n    kind: 'service',\n    readiness: { state: 'failed', error: failure },\n    start: () => ({ value: 0, release: () => undefined })\n  }\n])\nconst first = failed.ready()\nconsole.log('缓存：', first === failed.ready())\ntry {\n  await first\n} catch (error) {\n  console.log('原因：', error === failure)\n}\nawait failed.dispose()"
      },
      result: {
        en: 'Output: blocked: true 0; retry: ready 1 42; cached: true; cause: true.\n\nBlocked readiness starts nothing and can be sampled again explicitly. Failed readiness keeps one Promise and the original error. No timer polls the provider, and disposal prevents later retries.',
        zh: '依次输出：阻塞： true 0；重试： ready 1 42；缓存： true；原因： true。\n\nblocked 时没有启动服务，显式重试才重新采样；failed 保留同一个 Promise 与原错误。这里没有后台轮询，释放后也不能再次启动。'
      }
    }
  ],
  createHost: [
    {
      title: {
        en: 'Keep a dependent plugin blocked until its provider is installed',
        zh: '等待提供者安装后再启用依赖插件'
      },
      problem: {
        en: 'A plugin arrives before its required provider. Installing it immediately exposes a half-ready feature; discarding it forces the caller to reconstruct the dependency chain later.\n\nA list of plugin names cannot distinguish a registered definition from an installed, ready plugin or explain which consumer must stop when a provider leaves.\n\nDeclare the dependency with a Feature reference. createHost retains the blocked consumer; use installs the provider and reconciles its consumers, while unUse blocks them again.',
        zh: '插件先于必需的提供者到达，立即安装会暴露未就绪能力；直接丢弃，又迫使调用方稍后重新拼装依赖链。\n\n只保存插件名称列表，无法区分已登记定义与已安装的就绪插件，也无法决定提供者移除时哪些使用者必须停下。\n\n通过 Feature 引用声明依赖。createHost 保留 blocked 使用者，use 安装提供者后恢复依赖链，unUse 移除提供者时再次阻塞使用者。'
      },
      example: {
        en: "import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'\nimport { createHost } from '@migaia/tray/host'\n\nclass AppHost extends PluginHost<Record<string, never>, string> {}\nconst create = () =>\n  new AppHost({\n    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }\n  })\nconst events: string[] = []\nconst provider = definePlugin({\n  name: 'config',\n  features: { value: defineFeature(() => ({ base: '/api' })) },\n  install: () => {\n    events.push('config')\n    return {}\n  }\n})\nconst consumer = definePlugin({\n  name: 'screen',\n  features: {\n    value: defineFeature(() => ({}), { config: provider.getFeature('value') })\n  },\n  install: () => {\n    events.push('screen')\n    return {}\n  }\n})\nconst host = await createHost({\n  create,\n  plugins: [consumer] as const,\n  mutationAdmissionMs: 1000,\n  quiescenceMs: 1000,\n  shutdown: { mode: 'strict-drain' }\n})\ntry {\n  console.log('before:', host.pluginState('screen'), events.length)\n  const installed = await host.use(provider)\n  console.log('after:', installed.ok, host.pluginState('screen'))\n  console.log(events.join(','))\n  const removed = await host.unUse('config')\n  console.log('removed:', removed.ok, host.pluginState('screen'))\n} finally {\n  await host.dispose()\n}",
        zh: "import { PluginHost, defineFeature, definePlugin } from '@migaia/plugin-host'\nimport { createHost } from '@migaia/tray/host'\n\nclass AppHost extends PluginHost<Record<string, never>, string> {}\nconst create = () =>\n  new AppHost({\n    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }\n  })\nconst events: string[] = []\nconst provider = definePlugin({\n  name: 'config',\n  features: { value: defineFeature(() => ({ base: '/api' })) },\n  install: () => {\n    events.push('config')\n    return {}\n  }\n})\nconst consumer = definePlugin({\n  name: 'screen',\n  features: {\n    value: defineFeature(() => ({}), { config: provider.getFeature('value') })\n  },\n  install: () => {\n    events.push('screen')\n    return {}\n  }\n})\nconst host = await createHost({\n  create,\n  plugins: [consumer] as const,\n  mutationAdmissionMs: 1000,\n  quiescenceMs: 1000,\n  shutdown: { mode: 'strict-drain' }\n})\ntry {\n  console.log('启动前：', host.pluginState('screen'), events.length)\n  const installed = await host.use(provider)\n  console.log('之后：', installed.ok, host.pluginState('screen'))\n  console.log(events.join(','))\n  const removed = await host.unUse('config')\n  console.log('移除后：', removed.ok, host.pluginState('screen'))\n} finally {\n  await host.dispose()\n}"
      },
      result: {
        en: 'Output: before: blocked 0; after: true ready; config,screen; removed: true blocked.\n\nThe blocked consumer was not installed early; the provider installs first when it arrives. Required dependencies come from Feature references. This is one local managed PluginHost, not a native-host launch.',
        zh: '依次输出：启动前： blocked 0；之后： true ready；config,screen；移除后： true blocked。\n\n阻塞中的使用者没有提前安装，提供者到达后先安装再恢复使用者。必需依赖来自 Feature 引用；本例管理一个本地 PluginHost，不证明原生宿主启动。'
      }
    }
  ],
  loadIntoHost: [
    {
      title: {
        en: 'Transfer loaded artifact cleanup only when admission commits',
        zh: '提交成功后才交接加载制品的清理责任'
      },
      problem: {
        en: 'Loading a plugin also acquires a resource. If conversion fails, that resource must be released; after a successful install it must stay alive until that exact plugin is removed.\n\nSplitting load, conversion and installation across independent try/finally blocks can free a committed resource early or leak an uncommitted one.\n\nUse defineLoader and defineAdapter with loadIntoHost. The transaction owns the provisional artifact, rolls it back on conversion failure, and transfers custody on a committed mutation.',
        zh: '加载插件时还取得了资源：转换失败时必须释放，安装成功后又必须保留到对应插件移除。\n\n把加载、转换和安装分散到独立的 try/finally，容易提前释放已提交资源，或遗漏尚未提交的资源。\n\n通过 defineLoader、defineAdapter 与 loadIntoHost 串起事务。提交前的制品由事务暂管，转换失败会回滚，mutation 提交后才交给对应插件代次。'
      },
      example: {
        en: "import { PluginHost } from '@migaia/plugin-host'\nimport { createHost } from '@migaia/tray/host'\nimport { defineLoader, loadIntoHost } from '@migaia/tray/loader'\nimport { defineAdapter } from '@migaia/tray/adapter'\n\nclass AppHost extends PluginHost<Record<string, never>, string> {}\nconst create = () =>\n  new AppHost({\n    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }\n  })\nconst host = await createHost({\n  create,\n  plugins: [],\n  mutationAdmissionMs: 1000,\n  quiescenceMs: 1000,\n  shutdown: { mode: 'strict-drain' }\n})\nlet releases = 0\nconst loader = defineLoader({\n  load: (source: number) => ({\n    value: source,\n    release: {\n      force: () => {\n        releases += 1\n      }\n    }\n  })\n})\nconst adapter = defineAdapter({\n  adapt: (value: number) => ({\n    name: 'answer' as const,\n    install: () => ({ answer: () => value })\n  })\n})\ntry {\n  const result = await loadIntoHost({\n    host,\n    source: 42,\n    loader,\n    adapter,\n    mutation: 'use',\n    timeoutMs: false\n  })\n  console.log('committed:', result.ok, result.committed, releases)\n  if (result.ok) console.log('value:', result.view.extensions.answer())\n  await host.unUse('answer')\n  console.log('released:', releases)\n  const primary = new TypeError('artifact rejected')\n  try {\n    await loadIntoHost({\n      host,\n      source: 7,\n      loader,\n      adapter: defineAdapter({\n        adapt: () => {\n          throw primary\n        }\n      }),\n      mutation: 'use',\n      timeoutMs: false\n    })\n  } catch (error) {\n    console.log(\n      'rolled back:',\n      error === primary,\n      (error as Error & { code?: string }).code,\n      releases\n    )\n  }\n} finally {\n  await host.dispose()\n}",
        zh: "import { PluginHost } from '@migaia/plugin-host'\nimport { createHost } from '@migaia/tray/host'\nimport { defineLoader, loadIntoHost } from '@migaia/tray/loader'\nimport { defineAdapter } from '@migaia/tray/adapter'\n\nclass AppHost extends PluginHost<Record<string, never>, string> {}\nconst create = () =>\n  new AppHost({\n    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }\n  })\nconst host = await createHost({\n  create,\n  plugins: [],\n  mutationAdmissionMs: 1000,\n  quiescenceMs: 1000,\n  shutdown: { mode: 'strict-drain' }\n})\nlet releases = 0\nconst loader = defineLoader({\n  load: (source: number) => ({\n    value: source,\n    release: {\n      force: () => {\n        releases += 1\n      }\n    }\n  })\n})\nconst adapter = defineAdapter({\n  adapt: (value: number) => ({\n    name: 'answer' as const,\n    install: () => ({ answer: () => value })\n  })\n})\ntry {\n  const result = await loadIntoHost({\n    host,\n    source: 42,\n    loader,\n    adapter,\n    mutation: 'use',\n    timeoutMs: false\n  })\n  console.log('已提交：', result.ok, result.committed, releases)\n  if (result.ok) console.log('值：', result.view.extensions.answer())\n  await host.unUse('answer')\n  console.log('已释放：', releases)\n  const primary = new TypeError('制品转换失败')\n  try {\n    await loadIntoHost({\n      host,\n      source: 7,\n      loader,\n      adapter: defineAdapter({\n        adapt: () => {\n          throw primary\n        }\n      }),\n      mutation: 'use',\n      timeoutMs: false\n    })\n  } catch (error) {\n    console.log('已回滚：', error === primary, (error as Error & { code?: string }).code, releases)\n  }\n} finally {\n  await host.dispose()\n}"
      },
      result: {
        en: 'Output: committed: true true 0; value: 42; released: 1; rolled back: true ADAPTER_EXECUTION_FAILED 2.\n\nSuccess retains the artifact until unUse, while adapter failure releases its artifact and preserves the TypeError. Custody follows committed, not merely ok; cleanup can be deferred by active work or fail separately.',
        zh: '依次输出：已提交： true true 0；值： 42；已释放： 1；已回滚： true ADAPTER_EXECUTION_FAILED 2。\n\n成功后资源保留到 unUse，转换失败则释放本次资源并保留原 TypeError。清理责任取决于 committed，不能只看 ok；实际工作未结束或清理自身失败时，还需观察后续清理结果。'
      }
    }
  ],
  createRuntime: [
    {
      title: {
        en: 'Keep a cancelled callback alive until it really settles',
        zh: '取消后仍等待回调实际结束'
      },
      problem: {
        en: 'A caller cancels a task while its callback is still using plugin extensions. Reporting it as finished immediately lets cleanup run against resources the callback still holds.\n\nPromise races only stop waiting; they do not stop same-realm user code or prove it has released its resources.\n\nRun through createRuntime with a caller signal. The callback receives a cooperative signal, and its generation remains leased until the callback settles; this example releases a Promise gate explicitly.',
        zh: '调用方取消任务时，回调可能仍在使用插件能力；若立即宣告完成，清理就会碰到回调仍持有的资源。\n\nPromise 竞速只能停止等待，不能终止同一运行环境里的用户代码，也无法证明它已经释放资源。\n\n通过 createRuntime 运行并传入调用者 signal。回调收到合作式取消信号，但所属插件代次仍保留到回调完成；本例显式打开 Promise 门，让工作正常结束。'
      },
      example: {
        en: "import { PluginHost } from '@migaia/plugin-host'\nimport { createHost } from '@migaia/tray/host'\nimport { createRuntime } from '@migaia/tray/runtime'\n\nclass AppHost extends PluginHost<Record<string, never>, string> {}\nconst create = () =>\n  new AppHost({\n    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }\n  })\nconst host = await createHost({\n  create,\n  plugins: [\n    { name: 'billing', install: () => ({ double: (value: number) => value * 2 }) }\n  ] as const,\n  mutationAdmissionMs: 1000,\n  quiescenceMs: 1000,\n  shutdown: { mode: 'strict-drain' }\n})\nconst runtime = createRuntime(host)\nconst caller = new AbortController()\nconst reason = new Error('caller cancelled')\nlet finish!: () => void\nconst gate = new Promise<void>((resolve) => {\n  finish = resolve\n})\nlet observed: { readonly aborted: boolean; readonly reason: unknown } | undefined\ntry {\n  const run = runtime.run(\n    'billing',\n    { signal: caller.signal, timeoutMs: false },\n    async ({ signal, extensions }) => {\n      observed = signal\n      console.log('value:', extensions.double(21))\n      await gate\n      return 'settled'\n    }\n  )\n  caller.abort(reason)\n  console.log('aborted:', observed?.aborted, observed?.reason === reason, runtime.activeRuns)\n  finish()\n  console.log('result:', await run, runtime.activeRuns)\n  await runtime.dispose()\n  console.log('host:', host.state)\n} finally {\n  finish()\n  await runtime.dispose()\n  await host.dispose()\n}",
        zh: "import { PluginHost } from '@migaia/plugin-host'\nimport { createHost } from '@migaia/tray/host'\nimport { createRuntime } from '@migaia/tray/runtime'\n\nclass AppHost extends PluginHost<Record<string, never>, string> {}\nconst create = () =>\n  new AppHost({\n    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }\n  })\nconst host = await createHost({\n  create,\n  plugins: [\n    { name: 'billing', install: () => ({ double: (value: number) => value * 2 }) }\n  ] as const,\n  mutationAdmissionMs: 1000,\n  quiescenceMs: 1000,\n  shutdown: { mode: 'strict-drain' }\n})\nconst runtime = createRuntime(host)\nconst caller = new AbortController()\nconst reason = new Error('调用方取消')\nlet finish!: () => void\nconst gate = new Promise<void>((resolve) => {\n  finish = resolve\n})\nlet observed: { readonly aborted: boolean; readonly reason: unknown } | undefined\ntry {\n  const run = runtime.run(\n    'billing',\n    { signal: caller.signal, timeoutMs: false },\n    async ({ signal, extensions }) => {\n      observed = signal\n      console.log('值：', extensions.double(21))\n      await gate\n      return '已完成'\n    }\n  )\n  caller.abort(reason)\n  console.log('已取消：', observed?.aborted, observed?.reason === reason, runtime.activeRuns)\n  finish()\n  console.log('结果：', await run, runtime.activeRuns)\n  await runtime.dispose()\n  console.log('宿主：', host.state)\n} finally {\n  finish()\n  await runtime.dispose()\n  await host.dispose()\n}"
      },
      result: {
        en: 'Output: value: 42; aborted: true true 1; result: settled 0; host: active.\n\nCancellation preserves the reason and leaves one active run until actual settlement. A callback may still return successfully. Runtime disposal does not dispose its borrowed Host; deadlines also signal cancellation rather than preempting code.',
        zh: '依次输出：值： 42；已取消： true true 1；结果： 已完成 0；宿主： active。\n\n取消保留原始原因，在回调实际完成前仍有一个活动运行；回调仍可成功返回。Runtime 释放不负责关闭借用的 Host，截止时间同样只发出取消信号，不会抢占用户代码。'
      }
    },
    {
      title: {
        en: 'Remove the current plugin after its callback releases the lease',
        zh: '回调结束后再卸载当前插件'
      },
      problem: {
        en: "A one-shot plugin wants to remove itself after returning a result. Waiting for ordinary removal inside its own callback can wait on the callback's own generation lease.\n\nCapturing the raw Host bypasses the current generation capability, while treating a mutation receipt as an ordinary Promise hides when cleanup may safely start.\n\nReturn self.unUse's ticket from the callback, then await ticket.completion outside run. Runtime releases the callback lease before submitting that exact-generation mutation.",
        zh: '一次性插件返回结果后想卸载自己；若在回调内部等待普通卸载，卸载可能又在等待该回调释放自身代次。\n\n捕获原始 Host 会绕开当前代次能力；把变更回执当成普通 Promise，也会模糊何时才能安全开始清理。\n\n在回调中返回 self.unUse() 的 ticket，等 run 完成后再读取 ticket.completion。Runtime 先释放回调占用的代次，再提交对应代次的变更。'
      },
      example: {
        en: "import { PluginHost, type IPluginHostCore } from '@migaia/plugin-host'\nimport { createHost } from '@migaia/tray/host'\nimport { createRuntime } from '@migaia/tray/runtime'\n\nclass AppHost extends PluginHost<Record<string, never>, string> {}\nconst create = () =>\n  new AppHost({\n    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }\n  })\nlet releases = 0\nconst host = await createHost({\n  create,\n  plugins: [\n    {\n      name: 'oneShot',\n      install: (core: IPluginHostCore<string>) => {\n        core.onDispose(() => {\n          releases += 1\n        })\n        return { answer: () => 42 }\n      }\n    }\n  ] as const,\n  mutationAdmissionMs: 1000,\n  quiescenceMs: 1000,\n  shutdown: { mode: 'strict-drain' }\n})\nconst runtime = createRuntime(host)\ntry {\n  const ticket = await runtime.run('oneShot', { timeoutMs: false }, ({ self, extensions }) => {\n    console.log('value:', extensions.answer())\n    return self.unUse()\n  })\n  console.log('ticket:', 'then' in ticket, runtime.activeRuns)\n  await ticket.completion\n  console.log('removed:', host.plugins.includes('oneShot'), releases)\n} finally {\n  await runtime.dispose()\n  await host.dispose()\n}",
        zh: "import { PluginHost, type IPluginHostCore } from '@migaia/plugin-host'\nimport { createHost } from '@migaia/tray/host'\nimport { createRuntime } from '@migaia/tray/runtime'\n\nclass AppHost extends PluginHost<Record<string, never>, string> {}\nconst create = () =>\n  new AppHost({\n    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }\n  })\nlet releases = 0\nconst host = await createHost({\n  create,\n  plugins: [\n    {\n      name: 'oneShot',\n      install: (core: IPluginHostCore<string>) => {\n        core.onDispose(() => {\n          releases += 1\n        })\n        return { answer: () => 42 }\n      }\n    }\n  ] as const,\n  mutationAdmissionMs: 1000,\n  quiescenceMs: 1000,\n  shutdown: { mode: 'strict-drain' }\n})\nconst runtime = createRuntime(host)\ntry {\n  const ticket = await runtime.run('oneShot', { timeoutMs: false }, ({ self, extensions }) => {\n    console.log('值：', extensions.answer())\n    return self.unUse()\n  })\n  console.log('凭据：', 'then' in ticket, runtime.activeRuns)\n  await ticket.completion\n  console.log('移除后：', host.plugins.includes('oneShot'), releases)\n} finally {\n  await runtime.dispose()\n  await host.dispose()\n}"
      },
      result: {
        en: 'Output: value: 42; ticket: false 0; removed: false 1.\n\nThe ticket is not thenable, and its outer completion observes one plugin cleanup after the callback ends. Reading completion inside that callback rejects RUNTIME_CONTRACT_INVALID. Runtime and Host still need separate disposal.',
        zh: '依次输出：值： 42；凭据： false 0；移除后： false 1。\n\n回执不是类 Promise 对象，外层 completion 在回调结束后观察到一次插件清理。在该回调内部读取 completion 会以 RUNTIME_CONTRACT_INVALID 拒绝；Runtime 和 Host 仍需分别释放。'
      }
    }
  ]
}
