import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import apiManifest from '../src/generated/manifests/apis.json'
import {
  createSupportingContractGuide,
  findApiGuide,
  findOptionTranslation
} from '../app/api-guides.js'
import { isCallableApiSymbol, resolveDocsSelection, type IApi } from '../app/content-contract.js'
import { findGuideJourney } from '../app/guide-journeys.js'

/**
 * Reader-hostile generator text or unexplained implementation jargon forbidden in maintained
 * guides.
 */
const forbiddenProse =
  /first-party runtime surface|plain message transport|request\/response semantics|not-applicable|No documented errors are declared|No additional advanced behavior is declared|part of this module's public (?:function|class) contract/iu

/** Generated manifest interpreted through the public website projection contract. */
const typedApiManifest = apiManifest as unknown as { readonly apis: readonly IApi[] }

/** Resource package overview must remain a real teaching document rather than a scaffold. */
const resourceOverview = readFileSync(
  new URL('../src/content/zh/packages/resource/overview.mdx', import.meta.url),
  'utf8'
)

/** Returns every public operation that readers can invoke or construct. */
const callableSymbols = typedApiManifest.apis.flatMap((api) =>
  api.symbols.filter((symbol) => isCallableApiSymbol(symbol)).map((symbol) => ({ api, symbol }))
)

test('nested public modules use longest-prefix routing before resolving the symbol', () => {
  /** Minimal route inventory covers both a parent and a deeper public module. */
  const apis = [
    { module: 'index' },
    { module: 'plugins' },
    { module: 'plugins/reactive' },
    { module: 'features/chunk' }
  ] as unknown as readonly IApi[]

  assert.deepEqual(resolveDocsSelection(['features', 'chunk', 'chunk'], apis), {
    moduleName: 'features/chunk',
    symbolPath: 'chunk'
  })
  assert.deepEqual(resolveDocsSelection(['plugins', 'reactive', 'observe'], apis), {
    moduleName: 'plugins/reactive',
    symbolPath: 'observe'
  })
  assert.deepEqual(resolveDocsSelection(['createRootApi'], apis), {
    moduleName: 'index',
    symbolPath: 'createRootApi'
  })
})

test('resource overview teaches capabilities, production use, and lifecycle boundaries', () => {
  for (const capability of [
    'generation',
    'staleWhileRevalidate',
    'retryDelay',
    'dehydrate()',
    'hydrate()',
    'cancel()',
    'dispose()',
    'keepAlive'
  ]) {
    assert.match(resourceOverview, new RegExp(capability.replace(/[()]/g, '\\$&')))
  }
  assert.match(resourceOverview, /new Resource<IUser>/)
  assert.match(resourceOverview, /fetch\(`\/api\/users\/\$\{id\}`/)
  assert.match(resourceOverview, /const id = userId\.value/)
  assert.match(resourceOverview, /userId\.value = 'user-2'/)
  assert.doesNotMatch(resourceOverview, /场景 1|核心设计原则和使用哲学|相比其他方案的优势/)
})

test('storage-web defineEntity imports its concrete IndexedDB backend', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('storage-web', 'entity', 'defineEntity', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.quickStart, /import \{ indexedDbHost \} from '@migaia\/storage-web\/indexed-db'/)
    assert.match(guide.quickStart, /type IUser = \{ id: number; email: string \}/)
    assert.match(guide.quickStart, /defineEntity<IUser>/)
    assert.match(guide.quickStart, /users\.connect\(indexedDbHost\(\{ dbName: 'app' \}\)\)/)
    assert.doesNotMatch(guide.quickStart, /\buserSchema\b|\bmigrateUserV2\b|\bUser\b/)
  }
})

test('storage-web feature example defines every custom backend prerequisite', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('storage-web', 'host', 'defineStorageBackendFeature', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.quickStart, /import \{ memoryStorageHost \}/)
    assert.match(guide.quickStart, /defineStorageBackendKind<ICacheStore>\(\)\('cache'\)/)
    assert.match(guide.quickStart, /const cacheKind =/)
    assert.match(guide.quickStart, /mode: 'polling'/)
    assert.match(guide.quickStart, /const cachePlugin = defineStorageBackendPlugin/)
    assert.match(guide.quickStart, /features: \[reactive\] as const/)
    assert.doesNotMatch(guide.quickStart, /\bsubscribe\s*:|\bonChange\s*[,}]/)
  }
})

test('storage-web feature guide explains the Host effect in plain language', () => {
  const guide = findApiGuide('storage-web', 'host', 'defineStorageBackendFeature', 'zh')
  assert.ok(guide)
  assert.match(guide.purpose, /给 Storage Host 定义一项可选能力/)
  assert.match(guide.purpose, /不会创建 Host、不会打开数据库，也不会启用任何能力/)
  assert.match(guide.purpose, /Feature 和 Plugin 不是一回事/)
  assert.match(guide.purpose, /Plugin 才是 Host 真正安装和卸载的完整后端包/)
  assert.match(guide.purpose, /零项、一项或多项 Feature/)
  assert.match(guide.purpose, /裸 Host 只有安装插件、查找已安装后端和统一释放资源等基础管理能力/)
  assert.match(guide.purpose, /没有任何可用的后端 Feature/)
  assert.match(
    guide.purpose,
    /安装一个携带 reactive Feature 的后端 Plugin 之前，不能使用 liveQuery/
  )
  assert.match(guide.purpose, /Feature 绑定的是 backend kind（后端种类），不是某个特定的 Plugin ID/)
  assert.match(guide.purpose, /任何使用同一个 backendKind 创建的 Plugin 都可以携带它/)
  assert.match(guide.purpose, /Host 会为这个已安装后端单独接入一份该能力/)
  assert.match(guide.purpose, /defineStorageBackendPlugin\(\{ features: \[\.\.\.\] \}\)/)
  assert.match(guide.purpose, /createStorageHost\(\) 或 host\.use\(\).*能力才会对这个后端生效/)
  assert.match(guide.scenarios.join('\n'), /让安装它的 Storage Host 多获得一项能力/)
  assert.match(guide.avoidWhen.join('\n'), /直接创建并使用后端即可/)
  assert.doesNotMatch(guide.purpose, /^创建只绑定到一个 backend kind/)
})

test('plugin-host definePlugin explains core, shared, extension, Host use, and cleanup', () => {
  const guide = findApiGuide('plugin-host', 'defined', 'definePlugin', 'zh')
  assert.ok(guide?.quickStart)
  assert.match(guide.purpose, /core = 插件可以使用的宿主能力/)
  assert.match(guide.purpose, /shared = 插件之间复用的能力/)
  assert.match(guide.purpose, /extension = 业务代码从宿主上调用的能力/)
  assert.match(guide.quickStart, /core\.config\.get\(\)/)
  assert.match(guide.quickStart, /core\.onDispose\(/)
  assert.doesNotMatch(guide.quickStart, /core\.getShared\(|productReader|loadProduct/)
  assert.match(guide.quickStart, /app\.config\.update\('product-cache'/)
  assert.match(guide.quickStart, /await app\.dispose\(\)/)
  assert.doesNotMatch(guide.quickStart, /\.\.\.|\bfetchConfig\b|\brun[A-Z]\w*\(\)/)
  const shortForm = guide.examples?.find((example) => example.id === 'short-form')
  assert.ok(shortForm, 'definePlugin must document its name + descriptor factory form')
  assert.match(shortForm.title, /definePlugin\(name, descriptorFactory\)/)
  assert.match(shortForm.description, /config、shared、update、metadata.*disposer/)
  assert.match(shortForm.code, /definePlugin<IAppCore, \{ greet\(name: string\): string \}>\(/)
  assert.match(shortForm.code, /'greeting',\n  \(core\) => \(\{/)
  assert.match(shortForm.code, /app\.extensions\.greet\('Migaia'\)/)
  assert.match(shortForm.code, /await app\.dispose\(\)/)
  const shared = guide.examples?.find((example) => example.id === 'shared-collaboration')
  assert.ok(shared, 'definePlugin must isolate shared collaboration in its own example')
  assert.match(shared.code, /shared: \(\) => \(\{ readProduct:/)
  assert.match(shared.code, /core\.getShared\('readProduct'\)/)
  assert.match(shared.code, /plugins: \[cacheProvider, productReader\] as const/)
  assert.match(shared.code, /app\.extensions\.loadProduct\('sku-42'\)/)
  assert.deepEqual(
    guide.examples?.map((example) => example.id),
    ['short-form', 'shared-collaboration']
  )
})

test('plugin-host defineFeature separates synchronous capability construction from Plugin installation', () => {
  const guide = findApiGuide('plugin-host', 'index', 'defineFeature', 'zh')
  assert.ok(guide?.quickStart)
  assert.match(guide.purpose, /不会创建 Host、安装 Plugin、启动资源或发布方法/)
  assert.match(guide.purpose, /异步工作和清理必须放在 Plugin 的 install hook 中/)
  assert.match(guide.quickStart, /defineFeature\(\(core: IFeatureCore<\{ readCount\(\): number \}>\) =>/)
  assert.match(guide.quickStart, /core\.features\.metrics\.read\(\)/)
  assert.match(guide.quickStart, /definePlugin\('counter'/)
})

test('plugin-host PluginHost documents its complete runtime and composition surface', () => {
  const guide = findApiGuide('plugin-host', 'index', 'PluginHost', 'zh')
  assert.ok(guide?.quickStart)
  for (const capability of [
    '原子安装',
    '不可变且可撤销的 view',
    'extension',
    'shared',
    '四种 pipeline',
    'mutation 串行队列',
    '物理清理',
    '两阶段 admission/removal'
  ]) {
    assert.match(guide.purpose, new RegExp(capability))
  }
  assert.match(guide.quickStart, /const greetingPlugin = definePlugin/)
  assert.match(guide.quickStart, /await host\.use\(greetingPlugin\)/)
  assert.match(guide.quickStart, /view\.extensions\.greet\('Migaia'\)/)
  assert.match(guide.quickStart, /view\.getShared\('formatGreeting'\)/)
  assert.match(guide.quickStart, /view\.config\.update\('greeting'/)
  assert.match(guide.quickStart, /await host\.publish\('order-created'\)/)
  assert.match(guide.quickStart, /host\.getCurrentView\(\)/)
  assert.match(guide.quickStart, /current\.unUse\('greeting'\)/)
  assert.match(guide.quickStart, /await host\.dispose\(\)/)
  const reference = guide.options.map((option) => option.name).join(' ')
  for (const capability of [
    'createPluginDomainCore',
    'use(...plugins)',
    'getCurrentView',
    'extensions',
    'config.update',
    'usePipeline',
    'runPipeline',
    'unUse',
    'revision',
    'dispose',
    'composition API',
    'useSync'
  ]) {
    assert.match(reference, new RegExp(capability.replace(/[().]/g, '\\$&')))
  }
  assert.doesNotMatch(guide.quickStart, /\bgreetingPlugin\b(?=[^]*const greetingPlugin)/)
})

test('reactive Computed guide covers imports, lazy caching, dynamic dependencies, and lifecycle', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('reactive', 'reactive', 'Computed', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.quickStart, /import \{ createRuntime \} from '@migaia\/reactive'/)
    assert.match(guide.quickStart, /const runtime = createRuntime\(\)/)
    assert.match(guide.quickStart, /let calculationCount = 0/)
    assert.match(guide.quickStart, /console\.log\(calculationCount\).*0/)
    assert.match(guide.quickStart, /freeShipping\.value = true/)
    assert.match(guide.quickStart, /checkoutTotal\.dispose\(\)/)

    const examples = guide.examples ?? []
    assert.ok(examples.some((example) => /signedIn\.value \?/.test(example.code)))
    assert.ok(examples.some((example) => /import \{ Computed, createRuntime \}/.test(example.code)))
    assert.ok(examples.some((example) => /new Computed\(/.test(example.code)))
    assert.ok(examples.some((example) => /fullName\.peek\(\)/.test(example.code)))
    assert.ok(examples.some((example) => /fullName\.disposed/.test(example.code)))

    const reference = [
      guide.purpose,
      ...guide.scenarios,
      ...guide.avoidWhen,
      ...guide.options.flatMap((option) => [option.name, option.description, option.whenToUse])
    ].join('\n')
    for (const capability of ['缓存', '依赖', 'peek', 'dispose', 'equals', 'keepAlive']) {
      if (locale === 'zh') assert.match(reference, new RegExp(capability))
    }
    for (const scenario of ['购物车', '数据表', '权限']) {
      if (locale === 'zh') assert.match(reference, new RegExp(scenario))
    }
  }
})

test('reactive Signal guide covers direct construction, update semantics, observation, and applications', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('reactive', 'reactive', 'Signal', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.quickStart, /import \{ Signal, createRuntime \} from '@migaia\/reactive'/)
    assert.match(guide.quickStart, /new Signal<string \| null>\(/)
    assert.match(guide.quickStart, /selectedProductId\.version/)
    assert.match(guide.quickStart, /runtime\.flush\(\)/)
    assert.match(guide.quickStart, /selectedProductId\.dispose\(\)/)
    assert.match(guide.quickStart, /selectedProductId\.disposed/)

    const examples = guide.examples ?? []
    assert.ok(examples.some((example) => /runtime\.signal\(/.test(example.code)))
    assert.ok(examples.some((example) => /addObservedHooks\(/.test(example.code)))
    assert.ok(examples.some((example) => /stockPrice\.peek\(\)/.test(example.code)))
    assert.ok(examples.some((example) => /stockPrice\.observed/.test(example.code)))

    const reference = [
      guide.purpose,
      ...guide.scenarios,
      ...guide.avoidWhen,
      ...guide.options.flatMap((option) => [option.name, option.description, option.whenToUse])
    ].join('\n')
    for (const capability of [
      'Object.is',
      'version',
      'peek',
      'observed',
      'addObservedHooks',
      'dispose'
    ]) {
      assert.match(reference, new RegExp(capability.replace('.', '\\.')))
    }
    if (locale === 'zh') {
      for (const scenario of ['表单字段', '连接状态', '缓存单元']) {
        assert.match(reference, new RegExp(scenario))
      }
    }
  }
})

test('createObserverBinding quick start explains every executable line and host phase', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('reactive', 'runtime', 'createObserverBinding', locale)
    assert.ok(guide?.quickStart)
    const lines = guide.quickStart
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    for (const [index, line] of lines.entries()) {
      if (line.startsWith('//')) continue
      assert.ok(
        index > 0 && lines[index - 1]?.startsWith('//'),
        `Expected an explanatory comment immediately before: ${line}`
      )
    }

    assert.match(guide.quickStart, /binding\.capture\(\(\) => value\.value\)/)
    assert.match(guide.quickStart, /capture\.result/)
    assert.match(guide.quickStart, /binding\.observe\(/)
    assert.match(guide.quickStart, /const commitResult = binding\.commit\(capture\)/)
    assert.match(guide.quickStart, /commitResult === 'stale'/)
    assert.match(guide.quickStart, /binding\.retrack\(\)/)
    assert.match(guide.quickStart, /stop\(\)/)
    assert.match(guide.quickStart, /value\.dispose\(\)/)
  }
})

test('class pages expose structured instance APIs and Scheduler documents its operations', () => {
  const scheduler = typedApiManifest.apis
    .find((api) => api.library === 'reactive' && api.module === 'runtime')
    ?.symbols.find((symbol) => symbol.name === 'Scheduler')
  assert.ok(scheduler)

  const members = new Map(scheduler.members.map((member) => [member.name, member]))
  for (const name of [
    'batchDepth',
    'setStrategy',
    'enqueue',
    'dequeue',
    'requestFlush',
    'flush',
    'runBatched',
    'runDeferred'
  ]) {
    assert.ok(members.has(name), `Missing Scheduler.${name}`)
  }

  assert.deepEqual(members.get('enqueue')?.parameterDetails, [
    { name: 'item', type: 'IFlushable', optional: false }
  ])
  assert.equal(members.get('enqueue')?.returns, 'void')
  assert.match(members.get('enqueue')?.description ?? '', /待冲刷队列/)
  assert.match(members.get('requestFlush')?.description ?? '', /重复调用是安全的/)
  assert.equal(members.get('flush')?.returns, 'IFlushResult')
  assert.match(members.get('flush')?.description ?? '', /重入返回 `deferred`/)

  const classSymbols = typedApiManifest.apis.flatMap((api) =>
    api.symbols.filter((symbol) => symbol.kind === 'class')
  )
  assert.ok(classSymbols.filter((symbol) => symbol.members.length > 0).length >= 35)
  assert.ok(classSymbols.flatMap((symbol) => symbol.members).length >= 290)
})

test('reactive Effect guide covers imports, direct lifecycle, convenience API, and production cleanup', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('reactive', 'reactive', 'Effect', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.quickStart, /import \{ Effect, createRuntime \} from '@migaia\/reactive'/)
    assert.match(guide.quickStart, /new Effect\(\(\) =>/)
    assert.match(guide.quickStart, /new EventSource\(/)
    assert.match(guide.quickStart, /return \(\) => events\.close\(\)/)
    assert.match(guide.quickStart, /runtime\.flush\(\)/)
    assert.match(guide.quickStart, /roomConnection\.dispose\(\)/)
    assert.match(guide.quickStart, /roomConnection\.disposed/)

    const examples = guide.examples ?? []
    assert.ok(examples.some((example) => /runtime\.effect\(/.test(example.code)))
    assert.ok(examples.some((example) => /new AbortController\(\)/.test(example.code)))
    assert.ok(examples.some((example) => /return \(\) => controller\.abort\(\)/.test(example.code)))

    const reference = [
      guide.purpose,
      ...guide.scenarios,
      ...guide.avoidWhen,
      ...guide.options.flatMap((option) => [option.name, option.description, option.whenToUse])
    ].join('\n')
    for (const capability of ['runtime.effect', 'cleanup', 'dispose', 'flush']) {
      assert.match(reference, new RegExp(capability.replace('.', '\\.')))
    }
  }
})

test('WebRPC chunk feature quick start defines every renamed function and runtime input', () => {
  const guide = findApiGuide('web-rpc', 'features/chunk', 'chunk', 'zh')
  assert.ok(guide?.quickStart)
  assert.match(guide.quickStart, /chunk as configureChunk/)
  assert.match(guide.quickStart, /chunk as selectChunkFrames/)
  assert.match(
    guide.quickStart,
    /const \[clientTransport, serviceTransport\] = createMemoryTransportPair\(\)/
  )
  assert.match(guide.quickStart, /\[(?:outbound|provider)\(\), selectChunkFrames\(\)\] as const/)
  assert.doesNotMatch(guide.quickStart, /\bchunkFeature\b|\.\.\.config/)
})

test('lifecycle boundedWait explains a complete production shutdown flow', () => {
  const guide = findApiGuide('lifecycle', 'index', 'boundedWait', 'zh')
  assert.ok(guide?.quickStart)
  assert.match(guide.purpose, /生产服务收到停机信号/)
  assert.match(guide.purpose, /任务先完成时返回 true；时间先到时返回 false/)
  assert.match(guide.quickStart, /type IAuditBuffer/)
  assert.match(guide.quickStart, /auditBuffer\.stopAcceptingEvents\(\)/)
  assert.match(guide.quickStart, /const flushTask = auditBuffer\.flush\(\)/)
  assert.match(guide.quickStart, /const shutdownDeadlineAt = Date\.now\(\) \+ 2_000/)
  assert.match(guide.quickStart, /boundedWait\(flushTask, shutdownDeadlineAt\)/)
  assert.match(guide.quickStart, /logger\.warn/)
  assert.doesNotMatch(guide.quickStart, /systemScheduler|boundedWait\(flush\(\)/)
})

test('lifecycle createLifecycleUnit defines its production configuration loader', () => {
  const guide = findApiGuide('lifecycle', 'index', 'createLifecycleUnit', 'zh')
  assert.ok(guide?.quickStart)
  assert.match(guide.purpose, /旧结果覆盖新结果/)
  assert.match(guide.quickStart, /async function requestRuntimeConfig/)
  assert.match(guide.quickStart, /fetch\('\/api\/runtime-config'/)
  assert.match(guide.quickStart, /runtimeConfig\.start\(requestRuntimeConfig\)/)
  assert.match(guide.quickStart, /runtimeConfig\.restart\(requestRuntimeConfig\)/)
  assert.match(guide.quickStart, /runtimeConfig\.state === 'loaded'/)
  assert.doesNotMatch(guide.quickStart, /fetchConfig|logger\./)
})

test('logger setLoggerRuntimeManager runs a complete scoped logging scenario', () => {
  const guide = findApiGuide('logger', 'index', 'setLoggerRuntimeManager', 'zh')
  assert.ok(guide?.quickStart)
  assert.match(guide.purpose, /测试可以借此捕获每一行实际输出/)
  assert.match(guide.quickStart, /const capturedLines: string\[\] = \[\]/)
  assert.match(guide.quickStart, /const logger = new Logger/)
  assert.match(guide.quickStart, /logger\.log\('info', 'checkout completed'\)/)
  assert.match(guide.quickStart, /await logger\.flush\(\)/)
  assert.match(guide.quickStart, /await logger\.shutdown\('manual'\)/)
  assert.match(guide.quickStart, /restoreRuntime\(\)/)
  assert.doesNotMatch(guide.quickStart, /runLoggerScenario/)
})

test('every Logger plugin explains and demonstrates the capability added to its Host', () => {
  for (const plugin of ['batch', 'color', 'http', 'level', 'process', 'reasoning', 'uuid']) {
    const guide = findApiGuide('logger', 'plugins', plugin, 'zh')
    assert.ok(guide?.quickStart, `${plugin} must have a maintained quick start`)
    assert.match(guide.purpose, /安装后|安装到/, `${plugin} must name the Host capability`)
    assert.match(guide.purpose, /Logger 宿主|宿主/, `${plugin} must identify the capability owner`)
    assert.match(
      guide.quickStart,
      /const logger = new Logger/,
      `${plugin} must install into a Host`
    )
    assert.match(guide.quickStart, /logger\./, `${plugin} must demonstrate Host consumption`)
    assert.match(
      guide.quickStart,
      /await logger\.flush\(\)/,
      `${plugin} must demonstrate completion`
    )
    assert.match(
      guide.quickStart,
      /await logger\.shutdown\('manual'\)/,
      `${plugin} must demonstrate cleanup`
    )
    assert.doesNotMatch(guide.quickStart, /\brun[A-Z]\w*\(\)|\.\.\./)
  }
})

test('every storage-web backend plugin demonstrates the capability added to its Host', () => {
  const plugins = [
    ['plugins/memory', 'memoryBackendPlugin', 'memory', 'cache'],
    ['plugins/local-storage', 'localStorageBackendPlugin', 'local-storage', 'settings'],
    ['plugins/session-storage', 'sessionStorageBackendPlugin', 'session-storage', 'draft'],
    ['plugins/cookies', 'cookieBackendPlugin', 'cookies', 'prefs'],
    ['plugins/indexed-db', 'indexedDbBackendPlugin', 'indexed-db', 'records']
  ] as const

  for (const [moduleName, pluginName, importPath, backendId] of plugins) {
    const guide = findApiGuide('storage-web', moduleName, pluginName, 'zh')
    assert.ok(guide?.quickStart, `${pluginName} must have a maintained quick start`)
    assert.match(guide.purpose, /use\(\)/, `${pluginName} must explain installation`)
    assert.match(guide.purpose, /Host/, `${pluginName} must identify the capability owner`)
    assert.match(
      guide.quickStart,
      /import \{ createStorageHost \} from '@migaia\/storage-web\/host'/,
      `${pluginName} must show the Host import`
    )
    assert.match(
      guide.quickStart,
      new RegExp(`import \\{ ${pluginName} \\} from '@migaia/storage-web/plugins/${importPath}'`),
      `${pluginName} must show its plugin import`
    )
    assert.match(guide.quickStart, /await createStorageHost\(\)/, `${pluginName}: create Host`)
    assert.match(
      guide.quickStart,
      new RegExp(`host\\.hasBackend\\('${backendId}'\\)`),
      `${pluginName}: installation baseline`
    )
    assert.match(
      guide.quickStart,
      new RegExp(`await host\\.use\\(\\s*${pluginName}\\(`),
      `${pluginName}: install into Host`
    )
    assert.match(
      guide.quickStart,
      new RegExp(`appStorage\\.hasBackend\\('${backendId}'\\)`),
      `${pluginName}: published capability`
    )
    assert.match(
      guide.quickStart,
      new RegExp(`appStorage\\.hasReactiveBackend\\('${backendId}'\\)`),
      `${pluginName}: non-reactive boundary`
    )
    assert.match(
      guide.quickStart,
      new RegExp(`appStorage\\.backend\\('${backendId}'\\)`),
      `${pluginName}: consume capability`
    )
    assert.match(guide.quickStart, /\.set\(/, `${pluginName}: real write`)
    assert.match(guide.quickStart, /\.get\(/, `${pluginName}: real read`)
    assert.match(guide.quickStart, /await appStorage\.dispose\(\)/, `${pluginName}: cleanup`)
  }

  const cookieGuide = findApiGuide('storage-web', 'plugins/cookies', 'cookieBackendPlugin', 'zh')
  assert.ok(cookieGuide?.quickStart)
  assert.match(
    cookieGuide.quickStart,
    /scope: \{ path: '\/', sameSite: 'lax', secure: location\.protocol === 'https:' \}/
  )
  assert.match(cookieGuide.quickStart, /await prefs\.remove\('theme'\)/)
  assert.match(cookieGuide.purpose, /HttpOnly/)
})

test('Logger custom plugin guide covers extension, Host use, async completion, and cleanup', () => {
  const guide = findGuideJourney('logger', 'custom-plugin', 'zh')
  assert.ok(guide)
  const source = JSON.stringify(guide)
  for (const contract of [
    'ILoggerPlugin',
    'ILoggerPluginCore',
    'core.config.get',
    'core.useSink',
    'core.onDispose',
    'core.dispatchRaw',
    'logger.audit',
    'await logger.flush()',
    "await logger.shutdown('manual')"
  ])
    assert.ok(source.includes(contract), `custom Logger plugin guide misses ${contract}`)
  assert.match(source, /shared \+ getShared/)
  assert.match(source, /usePipeline \/ useAsyncPipeline/)
})

test('WebRPC flattened chunk route keeps the complete Host composition guide', () => {
  const guide = findApiGuide('web-rpc', 'index', 'chunk', 'zh')
  assert.ok(guide?.quickStart)
  assert.match(guide.purpose, /组合式 endpoint/)
  assert.match(guide.quickStart, /createMemoryTransportPair/)
  assert.match(guide.quickStart, /const service = await createComposedEndpoint/)
  assert.match(guide.quickStart, /service\.provide\('measure'/)
  assert.match(guide.quickStart, /const client = await createComposedEndpoint/)
  assert.match(guide.quickStart, /client\.send<number>/)
  assert.match(guide.quickStart, /Promise\.all\(\[client\.dispose\(\), service\.dispose\(\)\]\)/)
  assert.ok(guide.options.length >= 10)
  assert.deepEqual(
    guide.examples?.map((example) => example.id),
    ['preset', 'iframe', 'tabs', 'worker']
  )
  assert.match(guide.examples?.[0]?.description ?? '', /createEndpoint.*createComposedEndpoint/)
  assert.match(guide.examples?.[0]?.code ?? '', /const service = await createEndpoint/)
  assert.match(guide.examples?.[1]?.code ?? '', /createWindowMessageTransport/)
  assert.match(guide.examples?.[1]?.code ?? '', /targetOrigin: location\.origin/)
  assert.match(guide.examples?.[2]?.code ?? '', /createBroadcastChannelTransport/)
  assert.match(guide.examples?.[3]?.code ?? '', /createWebWorkerTransport/)
})

test('every WebRPC feature explains Host composition, real use, cleanup, and configuration', () => {
  for (const feature of ['outbound', 'provider', 'discovery', 'control', 'chunk']) {
    const guide = findApiGuide('web-rpc', `features/${feature}`, feature, 'zh')
    assert.ok(guide, feature)
    assert.ok(guide.purpose.length >= 100, `${feature}: purpose`)
    assert.ok(guide.scenarios.length >= 2, `${feature}: scenarios`)
    assert.ok(guide.avoidWhen.length >= 2, `${feature}: avoidWhen`)
    assert.ok(guide.options.length >= 4, `${feature}: options`)
    assert.match(guide.quickStart ?? '', /createComposedEndpoint/)
    assert.match(guide.quickStart ?? '', /createMemoryTransportPair/)
    assert.match(guide.quickStart ?? '', /dispose\(\)/)
    assert.doesNotMatch(guide.quickStart ?? '', /\bchunkFeature\b|\.\.\.config/)
  }
})

test('every WebRPC middleware guide installs into a Host and consumes a real capability', () => {
  for (const middleware of [
    'connect',
    'contract',
    'protocol',
    'authentication',
    'timeout',
    'ping',
    'abort',
    'hooks',
    'uuid'
  ]) {
    const guide = findApiGuide('web-rpc', 'index', middleware, 'zh')
    assert.ok(guide?.quickStart, middleware)
    assert.match(guide.purpose, /安装到 Host 后/, `${middleware}: Host effect`)
    assert.match(guide.quickStart, /createMemoryTransportPair/, `${middleware}: transport`)
    assert.match(guide.quickStart, /const service = await createEndpoint/, `${middleware}: service`)
    assert.match(guide.quickStart, /service\.provide\('findProduct'/, `${middleware}: provider`)
    assert.match(guide.quickStart, /const client = await createEndpoint/, `${middleware}: client`)
    assert.match(
      guide.quickStart,
      /client\.send<\{ id: string; available: boolean \}>/,
      `${middleware}: operation`
    )
    assert.match(
      guide.quickStart,
      /client\.dispose\(\), service\.dispose\(\)/,
      `${middleware}: cleanup`
    )
    assert.doesNotMatch(
      guide.quickStart,
      /const middleware =|\bsumInput\b|\bsumOutput\b|\breportHookFailure\b/,
      `${middleware}: unexplained placeholder`
    )
  }
})

describe('site-wide task guide quality', () => {
  test('every callable API has complete independent Chinese and English guidance', () => {
    for (const { api, symbol } of callableSymbols) {
      for (const locale of ['zh', 'en'] as const) {
        const guide = findApiGuide(api.library, api.module, symbol.name, locale)
        assert.ok(guide, `${api.library}/${api.module}/${symbol.name} ${locale}`)
        if (!guide) continue
        assert.ok(
          guide.purpose.trim().length >= 30,
          `${symbol.name} ${locale} purpose is too short`
        )
        assert.ok(guide.quickStart?.trim(), `${symbol.name} ${locale} Quick Start`)
        assert.ok(guide.scenarios.length >= 2, `${symbol.name} ${locale} scenarios`)
        assert.ok(guide.avoidWhen.length >= 2, `${symbol.name} ${locale} avoid`)
        const prose = [guide.purpose, ...guide.scenarios, ...guide.avoidWhen].join(' ')
        assert.doesNotMatch(prose, forbiddenProse, `${symbol.name} ${locale} forbidden prose`)
      }
    }
  })

  test('every extracted configuration field has a useful reader-facing explanation', () => {
    for (const { api, symbol } of callableSymbols) {
      for (const field of symbol.configuration) {
        for (const locale of ['zh', 'en'] as const) {
          const guide = findApiGuide(api.library, api.module, symbol.name, locale)
          const option = guide?.options.find((candidate) => candidate.name === field.name)
          const description =
            option?.description ??
            findOptionTranslation(api.library, api.module, symbol.name, field.name, locale) ??
            (locale === 'zh' ? field.descriptionZh : field.descriptionEn) ??
            field.description
          assert.ok(
            description.trim().length >= 20,
            `${api.library}/${api.module}/${symbol.name}.${field.name} ${locale}`
          )
          assert.doesNotMatch(description, forbiddenProse)
        }
      }
    }
  })

  test('every supporting constant has a bilingual reference path', () => {
    for (const api of typedApiManifest.apis) {
      for (const symbol of api.symbols.filter(
        (candidate) => candidate.kind === 'const' && !isCallableApiSymbol(candidate)
      )) {
        for (const locale of ['zh', 'en'] as const) {
          const guide =
            findApiGuide(api.library, api.module, symbol.name, locale) ??
            createSupportingContractGuide(api.library, symbol, locale)
          assert.ok(guide, `${api.library}/${api.module}/${symbol.name} ${locale}`)
          assert.ok(guide.quickStart?.trim(), `${symbol.name} ${locale} reference example`)
          assert.ok(guide.scenarios.length >= 2, `${symbol.name} ${locale} scenarios`)
          assert.ok(guide.avoidWhen.length >= 2, `${symbol.name} ${locale} avoid`)
          assert.doesNotMatch(
            [guide.purpose, ...guide.scenarios, ...guide.avoidWhen].join(' '),
            forbiddenProse
          )
        }
      }
    }
  })
})
