import type { ICaseDoc, IOptionCaseDoc, IText } from './contract.js'

/** Localized option stories share complete public-entry programs. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Short application examples keep parent, child, host and artifact ownership separate. */
export const trayOptionExamples = {
  registry: `import { createTray } from '@migaia/tray'

const tray = createTray({
  hosts: [pricingHost] as const,
  probe: monitoringProbe,
  report: (error) => reportToMonitoring(error)
})
const pricing = await tray.spawn('pricing', { id: 'checkout' })
renderPrices(await pricing.request('pricing.api.fetchPrices', productIds))
onCheckoutClosed(() => tray.dispose())`,
  routing: `import { createTray, defineTrayHost, defineRoutingPolicy } from '@migaia/tray'

const firstReady = defineRoutingPolicy('firstReady', (candidates) => candidates[0]!.id)
const pricingHost = defineTrayHost({
  ...pricingHostDefinition,
  routing: [firstReady] as const
})
const tray = createTray({ hosts: [pricingHost] as const, routing: [firstReady] as const })
await tray.spawn('pricing', { id: 'checkout' })
const pricing = tray.routing.firstReady(pricingHost)
renderPrices(await pricing.request('pricing.api.fetchPrices', productIds))
onCheckoutClosed(() => tray.dispose())`,
  serveProbe: `import { serveTrayHost } from '@migaia/tray'

await serveTrayHost(pricingHost, {
  probe: monitoringProbe,
  report: (error) => reportToMonitoring(error)
})`,
  serveReport: `import { serveTrayHost } from '@migaia/tray'

await serveTrayHost(pricingHost, {
  report: (error) => reportChildFailure('pricing', error)
})`,
  hostStrict: `import { createHost } from '@migaia/tray/host'

const host = await createHost({
  create: () => createApplicationHost(),
  plugins: [pricingPlugin] as const,
  mutationAdmissionMs: 1000,
  quiescenceMs: 1000,
  shutdown: { mode: 'strict-drain' }
})
showPricingPanel(host)
onCheckoutClosed(async () => {
  await host.dispose()
  showCheckoutClosed()
})`,
  hostBounded: `import { createHost } from '@migaia/tray/host'

const host = await createHost({
  ...applicationManagedHostOptions,
  quiescenceMs: 500,
  shutdown: { mode: 'bounded' }
})
onCheckoutClosed(async () => {
  const result = await host.dispose()
  showCheckoutClosed(result.cleanupComplete)
  await result.physicalCompletion
})`,
  hostReport: `import { createHost } from '@migaia/tray/host'

const host = await createHost({
  ...applicationManagedHostOptions,
  report: (error) => reportToMonitoring(error)
})
onCheckoutClosed(() => host.dispose())`,
  load: `import { loadIntoHost } from '@migaia/tray/loader'

const result = await loadIntoHost({
  host: managedHost,
  source: pricingBundle,
  loader: bundleLoader,
  adapter: pricingAdapter,
  mutation: 'use',
  timeoutMs: 5000
})
if (result.ok) showLoadedPricing(result.view)`,
  replace: `import { loadIntoHost } from '@migaia/tray/loader'

const result = await loadIntoHost({
  ...pricingLoadOptions,
  source: updatedPricingBundle,
  mutation: 'replace',
  timeoutMs: false,
  report: (error) => reportToMonitoring(error)
})
if (result.ok) showLoadedPricing(result.view)`,
  loadCancel: `import { loadIntoHost } from '@migaia/tray/loader'

try {
  const result = await loadIntoHost({
    ...pricingLoadOptions,
    signal: requestSignal,
    report: (error) => reportToMonitoring(error)
  })
  if (result.ok) showLoadedPricing(result.view)
  else showPricingUnavailable(result.error)
} catch (error) {
  showPricingUnavailable(error)
}`,
  runtimeStrict: `import { createRuntime } from '@migaia/tray/runtime'

const runtime = createRuntime(managedHost, {
  shutdown: { mode: 'strict-drain' },
  report: (error) => reportToMonitoring(error)
})
onPriceRequested((ids) => runtime.run('pricing', { timeoutMs: 5000 }, async ({ extensions }) => {
  renderPrices(await extensions.fetchPrices(ids))
}))
onCheckoutClosed(async () => {
  await runtime.dispose()
  await managedHost.dispose()
})`,
  runtimeBounded: `import { createRuntime } from '@migaia/tray/runtime'

const runtime = createRuntime(managedHost, {
  shutdown: { mode: 'bounded' },
  report: (error) => reportToMonitoring(error)
})
onPriceRequested((ids) => runtime.run('pricing', { timeoutMs: 5000 }, async ({ extensions }) => {
  renderPrices(await extensions.fetchPrices(ids))
}))
onCheckoutClosed(async () => {
  const result = await runtime.dispose()
  showPricingStopped(result.cleanupComplete)
  await settlePriceRequests()
  await managedHost.dispose()
})`
}

/** Every option story describes one reader-visible checkout situation. */
export const trayOptionCases: Readonly<Record<string, readonly IOptionCaseDoc[]>> = {
  registry: [
    {
      title: t('Start the checkout price host', '启动结账页的价格宿主'),
      problem: t(
        'The checkout page needs a registered price service before it can spawn an instance. Attach connection observations and background-error reporting when creating the registry, so the support panel can follow its lifetime.',
        '结账页需要先登记价格服务，才能启动实例。创建注册表时接入连接观察与后台错误报告，让支持面板能跟随其生命周期。'
      ),
      example: trayOptionExamples.registry,
      result: t(
        'The checkout page displays prices from its registered service and releases the registry when it closes.',
        '结账页显示已登记服务提供的价格，关闭时释放注册表。'
      ),
      covers: ['hosts', 'probe', 'report']
    },
    {
      title: t('Send pricing requests to the first ready instance', '把价格请求发给首个就绪实例'),
      problem: t(
        'The application already has a pricing host definition and needs a shared first-ready policy. Register the exact policy on both that host and the parent registry before using its routing namespace.',
        '应用已经拥有价格宿主定义，需要共用首个就绪实例策略。在宿主和父注册表登记同一个策略，再通过路由命名空间调用。'
      ),
      example: trayOptionExamples.routing,
      result: t(
        'The checkout page receives prices through the first-ready route.',
        '结账页通过首个就绪实例路由取得价格。'
      ),
      covers: ['hosts', 'routing']
    }
  ],
  serve: [
    {
      title: t('Observe pricing in its child entry', '在子端入口观察价格服务'),
      problem: t(
        'The price worker starts serving before business requests arrive. Attach its existing monitoring probe at that entry so child-side activity and failures reach the application.',
        '价格工作程序在业务请求到达前开始服务。在该入口接入已有监控探针，让子端活动与失败进入应用。'
      ),
      example: trayOptionExamples.serveProbe,
      result: t(
        'The child serves the declared pricing host with monitoring attached from startup.',
        '子端从启动时就带着监控，服务已声明的价格宿主。'
      ),
      covers: ['probe', 'report']
    },
    {
      title: t('Name failures from the pricing worker', '标识价格工作程序的失败'),
      problem: t(
        'Several child services share one monitoring destination. Label this child\u2019s serving failures as pricing so operators can find the affected service without parsing a business response.',
        '多个子端服务共用监控出口。把当前子端的服务失败标为 pricing，让操作人员定位受影响服务，无需解析业务响应。'
      ),
      example: trayOptionExamples.serveReport,
      result: t(
        'Monitoring receives child failures with the application\u2019s pricing label.',
        '监控接收带应用 pricing 标签的子端失败。'
      ),
      covers: ['report']
    }
  ],
  host: [
    {
      title: t('Release checkout plugins before confirming close', '插件释放后再确认结账页关闭'),
      problem: t(
        'The checkout page owns a canonical PluginHost and pricing plugins. Construct them through one managed owner, bound mutation admission, and use strict draining when the close screen must wait for actual release.',
        '结账页拥有规范 PluginHost 及价格插件。通过一个托管所有者构造它们，限制变更接纳；关闭界面需要等待实际释放时使用严格排空。'
      ),
      example: trayOptionExamples.hostStrict,
      result: t(
        'The pricing panel is available after startup, and the closed screen appears after plugin cleanup.',
        '启动后价格面板可用，插件清理完成后才显示已关闭界面。'
      ),
      covers: [
        'create',
        'plugins',
        'mutationAdmissionMs',
        'quiescenceMs',
        'shutdown',
        'shutdown.mode'
      ]
    },
    {
      title: t('Show close progress while a plugin finishes', '插件收尾期间展示关闭进度'),
      problem: t(
        'A pricing plugin can need more than half a second to release its connection. Use bounded shutdown to show the logical close outcome, then keep waiting for physical completion.',
        '价格插件释放连接可能需要半秒以上。使用有界关闭先展示逻辑关闭结果，再继续等待物理完成。'
      ),
      example: trayOptionExamples.hostBounded,
      result: t(
        'The page can show incomplete cleanup after its wait budget and still observe final resource release.',
        '等待预算耗尽后页面可显示清理未完成，并继续观察资源最终释放。'
      ),
      covers: ['quiescenceMs', 'shutdown', 'shutdown.mode']
    }
  ],
  loader: [
    {
      title: t('Install a pricing bundle for this checkout', '为当前结账页安装价格包'),
      problem: t(
        'The application owns an artifact loader and a pricing adapter. Use them together to turn the selected bundle into a plugin, give the load five seconds, and publish its view only after admission commits.',
        '应用已有制品加载器及价格适配器。把选中的包转换成插件，给加载五秒时间，并在接纳提交后才展示其视图。'
      ),
      example: trayOptionExamples.load,
      result: t(
        'The checkout page uses the committed pricing generation; its owner retains the loaded artifact.',
        '结账页使用已提交的价格代次，其所有者保留加载制品。'
      ),
      covers: ['host', 'source', 'loader', 'adapter', 'mutation', 'timeoutMs']
    },
    {
      title: t('Switch checkout to an updated pricing bundle', '切换到更新后的价格包'),
      problem: t(
        'A new pricing bundle replaces the installed plugin with the same name. The application deliberately owns the wait without a load deadline, while monitoring keeps secondary release failures visible.',
        '新价格包需要替换已安装的同名插件。应用明确选择不设加载期限，并由监控保留次要释放失败。'
      ),
      example: trayOptionExamples.replace,
      result: t(
        'The checkout page receives the updated pricing view after replacement commits.',
        '替换提交后，结账页取得更新后的价格视图。'
      ),
      covers: ['source', 'mutation', 'timeoutMs', 'report']
    },
    {
      title: t('Stop bundle loading with the checkout request', '随结账请求停止包加载'),
      problem: t(
        'A checkout request can end while its pricing artifact is loading. Forward the request signal and report secondary cleanup failures, rather than leaving the caller waiting without an outcome.',
        '价格制品加载期间，结账请求可能结束。转交请求信号并上报次要清理失败，让调用方得到结果。'
      ),
      example: trayOptionExamples.loadCancel,
      result: t(
        'Successful loading opens the pricing view; cancellation or failure shows unavailable pricing.',
        '加载成功时打开价格视图，取消或失败时显示价格不可用。'
      ),
      covers: ['signal', 'report']
    }
  ],
  runtime: [
    {
      title: t('Finish price callbacks before releasing their host', '价格回调结束后再释放宿主'),
      problem: t(
        'Active price callbacks borrow exact plugin generations. Keep strict-drain when their results must settle before the checkout releases its managed host. Runtime disposal alone does not own that host.',
        '活动价格回调借用确切的插件代次。结账页需要等结果落定后才释放托管宿主时，使用严格排空。运行器本身不拥有该宿主。'
      ),
      example: trayOptionExamples.runtimeStrict,
      result: t(
        'Price callbacks finish before the checkout releases their managed host.',
        '价格回调结束后，结账页才释放它们使用的托管宿主。'
      ),
      covers: ['shutdown', 'shutdown.mode', 'report']
    },
    {
      title: t('Stop new prices while existing requests settle', '停止新计价并等待已有请求落定'),
      problem: t(
        'A closing checkout must stop admitting price callbacks immediately, even when existing callbacks ignore cancellation. Bounded disposal returns its snapshot; the application still waits for its tracked requests before releasing the borrowed host.',
        '结账页关闭时需要立即停止接纳计价回调，即使已有回调忽略取消。有界释放返回快照，应用仍须等待自己跟踪的请求，再释放借用宿主。'
      ),
      example: trayOptionExamples.runtimeBounded,
      result: t(
        'The page shows pricing stopped while tracked requests settle, then releases the host.',
        '页面先显示计价已停止，等已跟踪请求落定后再释放宿主。'
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
