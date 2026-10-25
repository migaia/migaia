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
import { libraryReferences } from '../app/reference/index.js'

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

test('storage-host entity guide connects the concrete IndexedDB backend', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('storage-host', 'entity', 'defineEntity', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.quickStart, /import \{ defineEntity \} from '@migaia\/storage-host\/entity'/)
    assert.match(
      guide.quickStart,
      /import \{ indexedDbBackendPlugin \} from '@migaia\/storage-web\/indexed-db'/
    )
    assert.match(guide.quickStart, /type IUser = \{ id: number; email: string \}/)
    assert.match(guide.quickStart, /defineEntity<IUser>/)
    assert.match(guide.quickStart, /users\.connect\(host\.backend\('indexed-db'\)\)/)
    assert.match(
      guide.quickStart,
      /indexedDbBackendPlugin\(\{ dbName: 'app' \}, \{ indexes: indexedDbIndexesFeature\(\) \}\)/
    )
    assert.match(
      guide.quickStart,
      /features: \[entityQueryFeature\(\), entityIndexesFeature\(\), entityUniqueFeature\(\)\]/
    )
    assert.match(guide.quickStart, /repository\.put\(/)
    assert.match(guide.quickStart, /await host\.dispose\(\)/)
    assert.doesNotMatch(guide.quickStart, /\buserSchema\b|\bmigrateUserV2\b|\bUser\b/)
  }
})

test('storage-host Feature example declares its target and consumes the installed API', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('storage-host', 'index', 'defineFeature', locale)
    assert.ok(guide?.quickStart)
    assert.match(
      guide.quickStart,
      /import \{ createStorageHost, defineFeature, memoryBackendKind, memoryBackendPlugin \}/
    )
    assert.match(guide.quickStart, /defineFeature\(memoryBackendKind,/)
    assert.match(guide.quickStart, /this\.store\.use\(kv\)\.keys\(\)/)
    assert.match(guide.quickStart, /memoryBackendPlugin\(\{ id: 'cache' \}, \{ metrics \}\)/)
    assert.match(guide.quickStart, /host\.backend\('cache'\)/)
    assert.match(guide.quickStart, /cache\.set\('user:1', 'Ada'\)/)
    assert.match(guide.quickStart, /cache\.api\.count\(\)/)
    assert.match(guide.quickStart, /featureExpose\.getBackendId\(\)/)
    assert.match(guide.quickStart, /finally \{\s+await host\.dispose\(\)/)
    assert.doesNotMatch(guide.quickStart, /\bsubscribe\s*:|\bonChange\s*[,}]/)
  }
})

test('storage-host Feature guide distinguishes declaration, installation and ownership', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('storage-host', 'index', 'defineFeature', locale)
    assert.ok(guide)
    assert.match(guide.purpose, locale === 'zh' ? /后端种类/ : /backend kind/)
    assert.match(guide.purpose, locale === 'zh' ? /第二参数/ : /second argument/)
    assert.match(
      guide.purpose,
      locale === 'zh' ? /仅定义特性不会取得存储/ : /defining it alone acquires no store/
    )
    assert.match(guide.scenarios.join(' '), /store\.api/)
    assert.match(
      guide.avoidWhen.join(' '),
      locale === 'zh' ? /单独安装后端插件/ : /install its backend plugin alone/
    )
  }
})

test('plugin-host definePlugin explains installation, handle configuration, Feature sharing, and cleanup', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('plugin-host', 'index', 'definePlugin', locale)
    assert.ok(guide?.quickStart)
    assert.match(
      guide.purpose,
      locale === 'zh' ? /definePlugin 只保存定义/ : /definePlugin stores the definition/
    )
    assert.match(
      guide.purpose,
      locale === 'zh' ? /host\.use 运行 install/ : /host\.use runs install/
    )
    assert.match(guide.quickStart, /const \[greeting\] = await host\.use\(greetingPlugin\)/)
    assert.match(guide.quickStart, /core\.config\.get\(\)\.prefix/)
    assert.match(guide.quickStart, /greeting\.extensions\.greet\('Ada'\)/)
    assert.match(
      guide.quickStart,
      /greeting\.config\.update\(\(\) => \(\{ prefix: 'Welcome' \}\)\)/
    )
    assert.match(guide.quickStart, /console\.assert\(message === 'Welcome, Ada'\)/)
    assert.match(guide.quickStart, /finally \{\s+await host\.dispose\(\)/)
    assert.doesNotMatch(
      guide.quickStart,
      /core\.getShared\(|\bshared:|\bview\.|\.\.\.|\bfetchConfig\b|\brun[A-Z]\w*\(\)/
    )
    assert.match(
      guide.options.find((option) => option.name === 'definition.install')?.whenToUse ?? '',
      /core\.onDispose/
    )

    /** The next task uses declared Feature dependencies instead of the removed shared API. */
    const featureExample = guide.examples?.find((example) => example.id === 'next-share-feature')
    assert.ok(featureExample, 'definePlugin must show how another plugin consumes a Feature')
    assert.match(featureExample.code, /formatterPlugin\.getFeature\('text'\)/)
    assert.match(featureExample.code, /\(_core, dependencies\) =>/)
    assert.match(featureExample.code, /dependencies\.formatter\.format\(value\)/)
    assert.match(
      featureExample.code,
      /const \[, writer\] = await host\.use\(formatterPlugin, writerPlugin\)/
    )
    assert.match(featureExample.code, /writer\.getFeature\('message'\)\.render\('ready'\)/)
    assert.match(featureExample.code, /console\.assert\(message === '\[app\] ready'\)/)
    assert.match(featureExample.code, /await host\.dispose\(\)/)
    assert.doesNotMatch(featureExample.code, /core\.getShared\(|\bshared:/)
  }
})

test('plugin-host defineFeature separates synchronous capability construction from Plugin installation', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('plugin-host', 'index', 'defineFeature', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.purpose, /featureExpose/)
    assert.match(
      guide.purpose,
      locale === 'zh'
        ? /第二个参数提供已声明的依赖输出/
        : /second argument contains declared dependency outputs/
    )
    assert.match(
      guide.purpose,
      locale === 'zh' ? /调用 defineFeature 本身不会运行它/ : /defining it does not run it/
    )
    assert.match(guide.quickStart, /defineFeature\(\s+\(_core, dependencies\) =>/)
    assert.match(guide.quickStart, /formatter: formatterPlugin\.getFeature\('text'\)/)
    assert.match(guide.quickStart, /dependencies\.formatter\.format\(value\)/)
    assert.match(
      guide.quickStart,
      /const \[, writer\] = await host\.use\(formatterPlugin, writerPlugin\)/
    )
    assert.match(guide.quickStart, /writer\.getFeature\('message'\)\.render\('ready'\)/)
    assert.match(guide.quickStart, /console\.assert\(message === '\[app\] ready'\)/)
    assert.match(guide.quickStart, /await host\.dispose\(\)/)
    assert.doesNotMatch(guide.quickStart, /core\.features\.|core\.getShared\(/)
    assert.match(
      guide.options.find((option) => option.name === 'factory')?.description ?? '',
      locale === 'zh' ? /同步返回能力对象/ : /Synchronous function that returns a capability object/
    )
    assert.match(guide.avoidWhen.join('\n'), /setup.*featureExpose/)
  }
})

test('plugin-host PluginHost teaches business core, handle consumption, Host removal, and cleanup', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('plugin-host', 'index', 'PluginHost', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.purpose, /createPluginDomainCore/)
    assert.match(
      guide.purpose,
      locale === 'zh' ? /use 返回句柄数组/ : /use returns an array of handles/
    )
    assert.match(
      guide.purpose,
      locale === 'zh' ? /Host 负责 Feature.*依赖排序/ : /Host orders Feature dependencies/
    )
    assert.match(guide.quickStart, /class AppHost extends PluginHost<IWriter>/)
    assert.match(guide.quickStart, /protected createPluginDomainCore\(\): IWriter/)
    assert.match(guide.quickStart, /const greetingPlugin = definePlugin/)
    assert.match(guide.quickStart, /core\.write\(message\)/)
    assert.match(guide.quickStart, /const \[greeting\] = await host\.use\(greetingPlugin\)/)
    assert.match(guide.quickStart, /greeting\.extensions\.greet\('Ada'\)/)
    assert.match(guide.quickStart, /console\.assert\(message === 'Hello, Ada'\)/)
    assert.match(guide.quickStart, /console\.assert\(messages\[0\] === message\)/)
    assert.match(guide.quickStart, /const removal = await host\.unUse\('greeting'\)/)
    assert.match(guide.quickStart, /console\.assert\(removal\.ok\)/)
    assert.match(guide.quickStart, /finally \{\s+await host\.dispose\(\)/)
    assert.doesNotMatch(guide.quickStart, /\bview\.|core\.getShared\(/)
    for (const capability of [
      'execution',
      'execution.mutationTimeoutMs',
      'execution.pipelineDrainTimeoutMs'
    ]) {
      assert.ok(
        guide.options.some((option) => option.name === capability),
        capability
      )
    }
    assert.match(guide.avoidWhen.join('\n'), /defineHost/)
    assert.match(guide.avoidWhen.join('\n'), /RPC.*PluginHost/)
    assert.doesNotMatch(guide.quickStart, /\bgreetingPlugin\b(?=[^]*const greetingPlugin)/)
  }
})

test('reactive Computed guide covers imports, lazy caching, dynamic dependencies, and lifecycle', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('reactive', 'index', 'IReactiveComputed', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.quickStart, /import \{ createRuntime \} from '@migaia\/reactive'/)
    assert.match(guide.quickStart, /const runtime = createRuntime\(\)/)
    assert.match(guide.quickStart, /let calculationCount = 0/)
    assert.match(guide.quickStart, /console\.log\(calculationCount\).*0/)
    assert.match(guide.quickStart, /freeShipping\.value = true/)
    assert.match(guide.quickStart, /checkoutTotal\.dispose\(\)/)

    const examples = guide.examples ?? []
    assert.ok(examples.some((example) => /signedIn\.value \?/.test(example.code)))
    assert.ok(examples.some((example) => /import \{ createRuntime \}/.test(example.code)))
    assert.ok(examples.some((example) => /runtime\.computed\(/.test(example.code)))
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

test('reactive Signal guide covers factory creation, update semantics, observation, and applications', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('reactive', 'index', 'IReactiveSignal', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.quickStart, /import \{ createRuntime \} from '@migaia\/reactive'/)
    assert.match(guide.quickStart, /runtime\.signal<string \| null>\(/)
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

test('createObserverBinding quick start keeps authored comments and host phases without generated filler', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('reactive', 'extension', 'createObserverBinding', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.quickStart, /^\s*\/\//m)
    assert.doesNotMatch(
      guide.quickStart,
      /本例对应的生产场景是|没有创建可供后续复用的实例|返回的本次实例|输出用于确认上一操作的结果。|Logs the result of the preceding operation\./
    )

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

test('class pages expose structured instance APIs and reactive publishes only its two controlled surfaces', () => {
  /** The generated website contract must follow the package's converged entry boundaries. */
  const reactiveApis = typedApiManifest.apis.filter((api) => api.library === 'reactive')
  assert.deepEqual(reactiveApis.map((api) => api.module).sort(), ['extension', 'index'])

  /** Application references expose node contracts and factories without internal constructors. */
  const root = reactiveApis.find((api) => api.module === 'index')
  assert.ok(root)
  for (const name of [
    'IReactiveSignal',
    'IReactiveComputed',
    'IReactiveEffect',
    'IRuntime',
    'createRuntime'
  ]) {
    assert.ok(
      root.symbols.some((symbol) => symbol.name === name),
      `Missing reactive root ${name}`
    )
  }

  /** Removed constructors must disappear from every public website API page. */
  const publicNames = new Set(
    reactiveApis.flatMap((api) => api.symbols.map((symbol) => symbol.name))
  )
  for (const name of [
    'Signal',
    'Computed',
    'Effect',
    'Runtime',
    'Scheduler',
    'DependencyTracker',
    'VersionClock'
  ]) {
    assert.equal(publicNames.has(name), false, `Internal constructor ${name} is still public`)
  }

  const classSymbols = typedApiManifest.apis.flatMap((api) =>
    api.symbols.filter((symbol) => symbol.kind === 'class')
  )
  assert.ok(classSymbols.length > 0, 'expected public class declarations')
  for (const symbol of classSymbols) {
    for (const member of symbol.members) {
      assert.ok(member.name.trim(), `${symbol.name} has an unnamed member`)
      assert.ok(
        member.signature.includes(member.name),
        `${symbol.name}.${member.name} has no signature`
      )
      assert.ok(member.returns.trim(), `${symbol.name}.${member.name} has no result type`)
      assert.ok(
        ['method', 'property', 'get', 'set'].includes(member.kind),
        `${symbol.name}.${member.name} has no public member kind`
      )
      assert.doesNotMatch(member.signature, /^(?:#|private\b|protected\b)/)
      for (const parameter of member.parameterDetails) {
        assert.ok(parameter.name.trim(), `${symbol.name}.${member.name} has an unnamed parameter`)
        assert.ok(
          parameter.type.trim(),
          `${symbol.name}.${member.name}.${parameter.name} has no type`
        )
      }
    }
  }
})

test('reactive Effect guide covers imports, handle lifecycle, factory API, and production cleanup', () => {
  for (const locale of ['zh', 'en'] as const) {
    const guide = findApiGuide('reactive', 'index', 'IReactiveEffect', locale)
    assert.ok(guide?.quickStart)
    assert.match(guide.quickStart, /import \{ createRuntime \} from '@migaia\/reactive'/)
    assert.match(guide.quickStart, /runtime\.effect\(\(\) =>/)
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

test('RPC canonical chunk Feature quick start defines actual dependencies and runtime inputs', () => {
  const guide = findApiGuide('rpc-core', 'stream', 'createCanonicalChunkFeature', 'zh')
  assert.ok(guide?.quickStart)
  assert.match(guide.quickStart, /createCanonicalChunkFeature/)
  assert.match(guide.quickStart, /createOutboundFeature\(chunks\)/)
  assert.match(guide.quickStart, /createProviderFeature\(outbound\)/)
  assert.match(
    guide.quickStart,
    /const \[clientTransport, serviceTransport\] = createMemoryTransportPair\(\)/
  )
  assert.match(
    guide.quickStart,
    /return \{ 'first-party-chunk': chunks, 'first-party-outbound': outbound, 'first-party-provider': provider \}/
  )
  assert.doesNotMatch(guide.quickStart, /chunk as|\bchunkFeature\b|\.\.\.config/)
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

test('lifecycle keeps retired unit loading out of the public API and guides', () => {
  const root = typedApiManifest.apis.find(
    (api) => api.library === 'lifecycle' && api.module === 'index'
  )
  assert.ok(root)
  assert.ok(!root.symbols.some((symbol) => symbol.name === 'createLifecycleUnit'))
  assert.equal(findApiGuide('lifecycle', 'index', 'createLifecycleUnit', 'zh'), undefined)
  assert.equal(findApiGuide('lifecycle', 'index', 'createLifecycleUnit', 'en'), undefined)
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

test('every browser backend guide installs and consumes its actual Host capability', () => {
  const plugins = [
    ['storage-host', 'index', 'memoryBackendPlugin', '@migaia/storage-host', 'cache'],
    [
      'storage-web',
      'local-storage',
      'localStorageBackendPlugin',
      '@migaia/storage-web/local-storage',
      'settings'
    ],
    [
      'storage-web',
      'session-storage',
      'sessionStorageBackendPlugin',
      '@migaia/storage-web/session-storage',
      'draft'
    ],
    ['storage-web', 'cookies', 'cookieBackendPlugin', '@migaia/storage-web/cookies', 'prefs'],
    [
      'storage-web',
      'indexed-db',
      'indexedDbBackendPlugin',
      '@migaia/storage-web/indexed-db',
      'records'
    ]
  ] as const
  for (const [library, module, plugin, importPath, backendId] of plugins) {
    const guide = findApiGuide(library, module, plugin, 'zh')
    assert.ok(guide?.quickStart, `${plugin} has no maintained quick start`)
    assert.match(
      guide.quickStart,
      /import \{[^}]*createStorageHost[^}]*\} from '@migaia\/storage-host'/
    )
    assert.ok(guide.quickStart.includes(importPath))
    assert.match(guide.quickStart, /await createStorageHost\(\{ plugins:/)
    assert.ok(guide.quickStart.includes(`${plugin}({ id: '${backendId}'`))
    assert.ok(guide.quickStart.includes(`host.backend('${backendId}')`))
    assert.match(guide.quickStart, /storage\.set\(/)
    assert.match(guide.quickStart, /storage\.get\(/)
    assert.match(guide.quickStart, /finally \{\s+await host\.dispose\(\)/)
    assert.ok(guide.options.some((option) => option.name === 'features'))
  }
  const cookie = findApiGuide('storage-web', 'cookies', 'cookieBackendPlugin', 'zh')
  assert.ok(cookie?.quickStart)
  assert.match(
    cookie.quickStart,
    /scope: \{ path: '\/', sameSite: 'lax', secure: location\.protocol === 'https:' \}/
  )
  assert.match(cookie.avoidWhen.join(' '), /HttpOnly/)
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
  assert.match(source, /defineFeature/)
  assert.match(source, /usePipeline \/ useAsyncPipeline/)
})

test('RPC canonical chunk route keeps the complete composition guide', () => {
  const guide = findApiGuide('rpc-core', 'stream', 'createCanonicalChunkFeature', 'zh')
  assert.ok(guide?.quickStart)
  assert.match(guide.purpose, /组合式 endpoint/)
  assert.match(guide.quickStart, /createMemoryTransportPair/)
  assert.match(guide.quickStart, /const service = await createComposedEndpoint/)
  assert.match(guide.quickStart, /service\.provide\('measure'/)
  assert.match(guide.quickStart, /const client = await createComposedEndpoint/)
  assert.match(guide.quickStart, /client\.send<number>/)
  assert.match(guide.quickStart, /Promise\.all\(\[client\.dispose\(\), service\.dispose\(\)\]\)/)
  assert.equal(
    guide.options.length,
    0,
    'the canonical dependency takes no old chunk-policy options'
  )
})

test('every RPC Feature explains actual dependencies, use, and composition cleanup', () => {
  for (const [module, feature, dependencies] of [
    ['features/outbound', 'createOutboundFeature', ['chunkCapability']],
    ['features/provider', 'createProviderFeature', ['outboundCapability']],
    ['features/discovery', 'createDiscoveryFeature', ['outboundCapability']],
    ['features/control', 'createControlFeature', ['outboundCapability', 'discoveryCapability']],
    ['stream', 'createCanonicalChunkFeature', []]
  ] as const) {
    const guide = findApiGuide('rpc-core', module, feature, 'zh')
    assert.ok(guide, feature)
    assert.ok(guide.purpose.length >= 100, `${feature}: purpose`)
    assert.ok(guide.scenarios.length >= 2, `${feature}: scenarios`)
    assert.ok(guide.avoidWhen.length >= 2, `${feature}: avoidWhen`)
    assert.deepEqual(
      guide.options.map((option) => option.name),
      dependencies,
      `${feature}: exact public dependencies`
    )
    assert.match(guide.quickStart ?? '', /createComposedEndpoint/)
    assert.match(guide.quickStart ?? '', /createMemoryTransportPair/)
    assert.match(guide.quickStart ?? '', /dispose\(\)/)
    assert.doesNotMatch(guide.quickStart ?? '', /\bchunkFeature\b|\.\.\.config/)
  }
})

test('every RPC middleware guide installs into a Host and consumes a real capability', () => {
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
    const guide = findApiGuide('rpc-core', 'index', middleware, 'zh')
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
        for (const [decision, entries] of [
          ['scenarios', guide.scenarios],
          ['avoid', guide.avoidWhen]
        ] as const) {
          assert.ok(
            entries.some((entry) => entry.trim()),
            `${symbol.name} ${locale} ${decision}`
          )
          assert.ok(
            entries.every((entry) => entry.trim()),
            `${symbol.name} ${locale} ${decision} contains an empty explanation`
          )
        }
        const prose = [guide.purpose, ...guide.scenarios, ...guide.avoidWhen].join(' ')
        assert.doesNotMatch(prose, forbiddenProse, `${symbol.name} ${locale} forbidden prose`)
      }
    }
  })

  test('every extracted configuration field has a useful reader-facing explanation', () => {
    for (const { api, symbol } of callableSymbols) {
      /**
       * Pages render a referenced symbol's fields from its maintained reference doc, and the
       * reference audit already requires every such field to be documented; only the remaining
       * symbols depend on the guide and extracted text checked here.
       */
      const reference = libraryReferences[api.library as keyof typeof libraryReferences]
      if (reference?.symbols[`${api.module}:${symbol.name}`] ?? reference?.symbols[symbol.name])
        continue
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
