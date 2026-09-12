import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findApiGuide, findOptionTranslation } from '../app/api-guides.js'
import { findGuideJourney } from '../app/guide-journeys.js'
import { parseSelectedLibrary, replaceOwnedEntries } from '../scripts/generate/signatures.js'

/** Root directory used for all website-owned contract observations. */
const websiteRoot = fileURLToPath(new URL('../', import.meta.url))
/** Website manifest declaring the direct dependency and script universe. */
const manifest = JSON.parse(readFileSync(join(websiteRoot, 'package.json'), 'utf8'))
/** Lockfile text used to distinguish root dependencies from framework internals. */
const lockfile = readFileSync(join(websiteRoot, 'bun.lock'), 'utf8')
/** Generated API contract used by configuration-documentation acceptance. */
const generatedApiManifest = JSON.parse(
  readFileSync(join(websiteRoot, 'src/generated/manifests/apis.json'), 'utf8')
)
/** Typed subset of generated API facts required by documentation acceptance. */
const generatedApis = generatedApiManifest.apis as Array<{
  id: string
  library: string
  module: string
  symbols: Array<{
    name: string
    kind: string
    configuration: Array<{
      name: string
      type: string
      description: string
      descriptionEn?: string
      descriptionZh?: string
    }>
  }>
}>

test('SITE-T-SIGNATURES-DIRECT-ENTRY validates bounded writer selection before generation', () => {
  assert.equal(parseSelectedLibrary([]), null)
  assert.equal(parseSelectedLibrary(['--library', 'plugin-host']), 'plugin-host')
  assert.throws(() => parseSelectedLibrary(['--library']))
  assert.throws(() => parseSelectedLibrary(['--library', 'unknown']))
})

test('SITE-T-SIGNATURES-DIRECT-ENTRY preserves unselected order through shrink, equal, and grow', () => {
  const previous = [
    { library: 'utils', id: 'before' },
    { library: 'plugin-host', id: 'old-a' },
    { library: 'web-rpc', id: 'middle' },
    { library: 'plugin-host', id: 'old-b' },
    { library: 'logger', id: 'after' }
  ]
  const ownsPluginHost = (entry: unknown) =>
    (entry as { readonly library?: unknown }).library === 'plugin-host'
  for (const replacement of [
    [{ library: 'plugin-host', id: 'new-a' }],
    [
      { library: 'plugin-host', id: 'new-a' },
      { library: 'plugin-host', id: 'new-b' }
    ],
    [
      { library: 'plugin-host', id: 'new-a' },
      { library: 'plugin-host', id: 'new-b' },
      { library: 'plugin-host', id: 'new-c' }
    ]
  ]) {
    const merged = replaceOwnedEntries(previous, replacement, ownsPluginHost, 'plugin-host rows') as Array<{
      readonly library: string
      readonly id: string
    }>
    assert.deepEqual(
      merged.filter((entry) => entry.library !== 'plugin-host').map((entry) => entry.id),
      ['before', 'middle', 'after']
    )
    assert.deepEqual(
      merged.filter(ownsPluginHost).map((entry) => entry.id),
      replacement.map((entry) => entry.id)
    )
  }
})

function fileURLToPath(url: URL): string {
  return decodeURIComponent(url.pathname)
}

function packagePath(name: string, fromDirectory: string): string | undefined {
  let directory = resolve(fromDirectory)
  while (directory !== parse(directory).root) {
    const candidate = join(directory, 'node_modules', ...name.split('/'), 'package.json')
    if (existsSync(candidate)) return candidate
    directory = dirname(directory)
  }
  const candidate = join(directory, 'node_modules', ...name.split('/'), 'package.json')
  return existsSync(candidate) ? candidate : undefined
}

test('SITE-T-A01 assigns route, transform, and diagnostics to one selected chain', () => {
  assert.equal(manifest.dependencies['react-router'], '8.3.1')
  assert.equal(manifest.devDependencies['@react-router/dev'], '8.3.1')
  assert.equal(manifest.devDependencies['@vitejs/plugin-react'], '6.1.0')
  assert.equal(manifest.devDependencies['oxc-transform-react'], '0.147.0')
  assert.equal(manifest.devDependencies.typescript, '7.0.2')
  assert.match(
    readFileSync(join(websiteRoot, 'vite.config.ts'), 'utf8'),
    /react\(\{ compiler: true \}\)/
  )
  assert.match(
    readFileSync(join(websiteRoot, 'vite.config.ts'), 'utf8'),
    /filter\([\s\S]*?!\/refresh\|preamble\//
  )
  assert.match(readFileSync(join(websiteRoot, 'react-router.config.ts'), 'utf8'), /ssr: false/)
})

test('SITE-T-A19 excludes forbidden direct dependencies while retaining TypeScript 7', () => {
  const directNames = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
  assert.deepEqual(
    directNames.filter((name) => /^(?:@astrojs|astro|@babel|babel|@swc|swc)$/i.test(name)),
    []
  )
  assert.equal(manifest.devDependencies.typescript, '7.0.2')
})

test('SITE-T-A20 contains Babel utilities only below the React Router framework closure', () => {
  const queue = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).flatMap(
    ([name]) => {
      const packageJson = packagePath(name, websiteRoot)
      return packageJson ? [{ name, packageJson, ancestors: [name] }] : []
    }
  )
  const visited = new Set<string>()
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current.packageJson)) continue
    visited.add(current.packageJson)
    const packageManifest = JSON.parse(readFileSync(current.packageJson, 'utf8'))
    const dependencies = Object.keys({
      ...packageManifest.dependencies,
      ...packageManifest.optionalDependencies
    })
    for (const dependency of dependencies) {
      const dependencyJson = packagePath(dependency, dirname(current.packageJson))
      if (dependencyJson) {
        queue.push({
          name: dependency,
          packageJson: dependencyJson,
          ancestors: [...current.ancestors, dependency]
        })
      }
    }
    if (/^(?:@babel\/|babel(?:-|$))/i.test(current.name)) {
      assert.ok(
        current.ancestors.includes('@react-router/dev'),
        `${current.name} escaped the @react-router/dev closure`
      )
    }
  }
  const routerRecord = lockfile.match(/"@react-router\/dev": \["@react-router\/dev@8\.3\.1"[^\n]+/)
  assert.ok(routerRecord)
  assert.match(routerRecord[0], /"@babel\/core"/)
  assert.doesNotMatch(lockfile.split('"packages":')[0], /@babel|babel-dead-code-elimination/)
})

test('SITE-T-A21 config and scripts select Oxc without a fallback compiler', () => {
  const configFiles = [
    'vite.config.ts',
    'react-router.config.ts',
    'tsconfig.json',
    'tsconfig.test.json'
  ]
  const configText = configFiles
    .map((file) => readFileSync(join(websiteRoot, file), 'utf8'))
    .join('\n')
  const scriptText = JSON.stringify(manifest.scripts)
  assert.match(configText, /compiler: true/)
  assert.doesNotMatch(`${configText}\n${scriptText}`, /(?:babel|swc)/i)
})

test('SITE-T-A22 production output includes the Oxc compiler runtime artifact', () => {
  const assetsDirectory = join(websiteRoot, 'build/client/assets')
  const outputManifest = readdirSync(assetsDirectory).find((name) => /^manifest-.*\.js$/.test(name))
  assert.ok(outputManifest, 'run the production build before the output contract test')
  assert.match(readFileSync(join(assetsDirectory, outputManifest), 'utf8'), /compiler-runtime/)
})

test('SITE-T-A23 compiler packages are direct website dependencies and resolve locally', () => {
  for (const name of ['@react-router/dev', 'react-router', 'vite', 'typescript']) {
    const packageJson = packagePath(name, websiteRoot)
    assert.ok(packageJson)
    assert.ok(manifest.dependencies[name] ?? manifest.devDependencies[name])
  }
})

test('SITE-T-A24 generated projections contain no volatile metadata', () => {
  const generatedFiles = ['signatures', 'error-codes'].flatMap((directory) => {
    const names =
      directory === 'signatures'
        ? [
            'utils',
            'event-subscriber',
            'lifecycle',
            'middleware-pipeline',
            'reactive',
            'serialize',
            'storage-contract',
            'plugin-host',
            'resource',
            'web-rpc',
            'logger',
            'storage-web'
          ]
        : ['middleware-pipeline', 'plugin-host', 'logger']
    return names.map((name) => join(websiteRoot, 'src/generated', directory, `${name}.json`))
  })
  const manifestFiles = ['content', 'libraries', 'apis', 'routes', 'relationships'].map((name) =>
    join(websiteRoot, 'src/generated/manifests', `${name}.json`)
  )
  for (const file of [...generatedFiles, ...manifestFiles]) {
    const content = readFileSync(file, 'utf8')
    assert.doesNotMatch(content, /"(?:generatedAt|timestamp|buildTime)"\s*:/i)
    assert.equal(content.endsWith('\n'), true)
  }

  const contentManifest = JSON.parse(readFileSync(manifestFiles[0], 'utf8'))
  const libraryManifest = JSON.parse(readFileSync(manifestFiles[1], 'utf8'))
  const apiManifest = JSON.parse(readFileSync(manifestFiles[2], 'utf8'))
  const routeManifest = JSON.parse(readFileSync(manifestFiles[3], 'utf8'))
  const relationshipManifest = JSON.parse(readFileSync(manifestFiles[4], 'utf8'))
  assert.equal(contentManifest.version, 1)
  assert.equal(libraryManifest.version, 1)
  assert.equal(apiManifest.version, 1)
  assert.equal(routeManifest.version, 1)
  assert.equal(relationshipManifest.version, 1)
  assert.equal(libraryManifest.libraries.length, 27)
  assert.equal(
    libraryManifest.libraries.some((library: { readonly slug: string }) => library.slug === 'docs'),
    false
  )
  assert.ok(apiManifest.apis.length > 0)
  const symbols: Array<{
    name: string
    kind: string
    fragment: string
    identity: string
    signature: string
    declarationLine: number
    parameterDetails: readonly { name: string; type: string; optional: boolean }[]
    source: string
    purpose: string
    core: string
    advanced: string
    parameters: readonly string[]
    returns: string
    errors: readonly string[]
    lifecycleConcurrency: string
    examples: readonly string[]
    whenToUse: string
    notUse: string
    exportPath: string
    sections: readonly { id: string; title: string; content: string; example?: string }[]
    api: string
  }> = apiManifest.apis.flatMap(
    (api: {
      id: string
      symbols: readonly {
        name: string
        kind: string
        fragment: string
        identity: string
        signature: string
        declarationLine: number
        parameterDetails: readonly { name: string; type: string; optional: boolean }[]
        source: string
        purpose: string
        core: string
        advanced: string
        parameters: readonly string[]
        returns: string
        errors: readonly string[]
        lifecycleConcurrency: string
        examples: readonly string[]
        whenToUse: string
        notUse: string
        sections: readonly { id: string; title: string; content: string; example?: string }[]
      }[]
    }) => api.symbols.map((symbol) => ({ ...symbol, api: api.id }))
  )
  assert.ok(symbols.length > 0)
  assert.equal(
    new Set(symbols.map((symbol) => `${symbol.api}#${symbol.fragment}`)).size,
    symbols.length
  )
  assert.equal(new Set(symbols.map((symbol) => symbol.identity)).size, symbols.length)
  assert.equal(new Set(symbols.map((symbol) => symbol.fragment)).size, symbols.length)
  assert.ok(
    symbols.every((symbol) => symbol.signature.length > 0 && symbol.source.startsWith('packages/'))
  )
  assert.ok(
    symbols.every(
      (symbol) =>
        symbol.purpose.length > 0 &&
        symbol.core.length > 0 &&
        symbol.advanced.length > 0 &&
        symbol.parameters.length > 0 &&
        symbol.returns.length > 0 &&
        symbol.errors.length > 0 &&
        symbol.lifecycleConcurrency.length > 0 &&
        symbol.whenToUse.length > 0 &&
        symbol.notUse.length > 0 &&
        symbol.sections.length === 6 &&
        symbol.sections.map((section) => section.id).join(',') ===
          'introduction,getting-started,when-to-use,quick-implementation,core-usage,advanced-usage'
    )
  )
  for (const symbol of symbols) {
    assert.doesNotMatch(symbol.purpose, /Declaration:| · [a-f0-9]{8}/)
    assert.doesNotMatch(JSON.stringify(symbol.sections), /{} as |source-backed .* example/i)
  }
  for (const symbol of symbols) {
    const required = symbol.parameterDetails.filter((parameter) => !parameter.optional)
    const declarationCount = symbol.signature.split(`function ${symbol.name}`).length - 1
    if (
      required.length === 0 ||
      symbol.examples.length === 0 ||
      declarationCount > 1 ||
      !['function', 'class'].includes(symbol.kind)
    )
      continue
    const example = symbol.examples[0] ?? ''
    assert.match(
      example,
      symbol.kind === 'class'
        ? new RegExp(`new ${symbol.name}[\\s\\S]{0,200}?\\(`)
        : new RegExp(`${symbol.name}(?:<[^>]+>)?\\s*\\([\\s\\S]+?\\)`),
      `required-argument ${symbol.kind} example is zero-argument: ${symbol.name}`
    )
  }
  const overloadExpectations = [
    ['event-subscriber:index', 'createEventChannel'],
    ['event-subscriber:index', 'createEventHub'],
    ['lifecycle:scheduler', 'resolveSchedulerOption']
  ] as const
  for (const [apiId, name] of overloadExpectations) {
    const api = apiManifest.apis.find((candidate: { id: string }) => candidate.id === apiId)
    const symbol = api?.symbols.find((candidate: { name: string }) => candidate.name === name)
    assert.ok(symbol, `missing overload regression symbol ${apiId}#${name}`)
    assert.ok(
      Array.isArray(symbol?.overloadSignatures) && symbol.overloadSignatures.length > 1,
      `overloads were not grouped for ${apiId}#${name}`
    )
    assert.equal(
      new Set(symbol?.overloadSignatures ?? []).size,
      symbol?.overloadSignatures.length,
      `duplicate overload signature for ${apiId}#${name}`
    )
    assert.equal(
      api?.symbols.filter((candidate: { name: string }) => candidate.name === name).length,
      1,
      `multiple canonical owners for overload set ${apiId}#${name}`
    )
  }
  assert.ok(contentManifest.entries.length > 0)
  assert.ok(routeManifest.entries.length >= contentManifest.entries.length)
  assert.ok(relationshipManifest.edges.length >= contentManifest.entries.length * 2)
  assert.ok(routeManifest.entries.every((entry: { path: string }) => !entry.path.includes('*')))

  const edgeKeys = new Set(
    relationshipManifest.edges.map(
      (edge: { from: string; to: string; type: string }) =>
        `${edge.from}\u0000${edge.to}\u0000${edge.type}`
    )
  )
  const owners = new Map(symbols.map((symbol) => [symbol.identity, symbol]))
  for (const api of generatedApiManifest.apis) {
    for (const alias of api.aliases) {
      const owner = owners.get(alias.identity)
      assert.ok(owner, `alias has no canonical owner: ${api.id}#${alias.name}`)
      assert.equal(owner?.exportPath, alias.ownerExportPath)
      assert.equal(alias.ownerFragment, owner?.fragment)
      assert.equal('fragment' in alias, false)
    }
  }
  for (const edge of relationshipManifest.edges.filter(
    (candidate: { type: string }) =>
      candidate.type.endsWith('-api') ||
      candidate.type.endsWith('-guide') ||
      candidate.type.endsWith('-architecture')
  )) {
    const reverseType = edge.type.split('-').reverse().join('-')
    assert.ok(
      edgeKeys.has(`${edge.to}\u0000${edge.from}\u0000${reverseType}`),
      `missing reverse edge: ${edge.type}`
    )
  }
  for (const edge of relationshipManifest.edges.filter(
    (candidate: { type: string }) => candidate.type === 'symbol-alias'
  )) {
    assert.ok(
      edgeKeys.has(`${edge.to}\u0000${edge.from}\u0000alias-symbol`),
      `missing reverse alias edge: ${edge.from} -> ${edge.to}`
    )
  }
})

test('SITE-T-CONFIG-DOCS gives every public configuration field a readable contract', () => {
  let configuredApiCount = 0
  let configurationFieldCount = 0
  for (const api of generatedApis) {
    for (const symbol of api.symbols) {
      if (symbol.kind === 'type' || symbol.kind === 'interface') continue
      if (symbol.configuration.length > 0) configuredApiCount += 1
      for (const field of symbol.configuration) {
        configurationFieldCount += 1
        assert.ok(field.name.length > 0, `${api.id}#${symbol.name} has an unnamed option`)
        assert.ok(field.type.length > 0, `${api.id}#${symbol.name}.${field.name} has no type`)
        const description =
          field.description ||
          findApiGuide(api.library, api.module, symbol.name, 'en')?.options.find(
            (option) => option.name === field.name
          )?.description
        assert.ok(
          description?.trim().length,
          `${api.id}#${symbol.name}.${field.name} has no purpose or usage guidance`
        )
        assert.ok(
          !field.name.startsWith('__'),
          `${api.id}#${symbol.name}.${field.name} exposes an internal nominal field`
        )
      }
    }
  }
  assert.equal(configuredApiCount, 97)
  assert.equal(configurationFieldCount, 357)

  const pluginHost = generatedApis
    .find((api) => api.id === 'plugin-host:structural')
    ?.symbols.find((symbol) => symbol.name === 'PluginHost')
  assert.ok(pluginHost)
  assert.ok(pluginHost.configuration.some((field) => field.name === 'execution.mutationTimeoutMs'))
  assert.ok(pluginHost.configuration.some((field) => field.name === 'pipeline.mode'))
  assert.ok(!pluginHost.configuration.some((field) => field.name === 'mode'))

  const endpoint = generatedApis
    .find((api) => api.id === 'web-rpc:index')
    ?.symbols.find((symbol) => symbol.name === 'createEndpoint')
  assert.ok(endpoint)
  assert.ok(endpoint.configuration.some((field) => field.name === 'replay.maxEntries'))
  assert.ok(endpoint.configuration.some((field) => field.name === 'construction.signal'))
})

test('SITE-T-WEB-RPC-GUIDES gives every runtime export an explicit bilingual decision guide', () => {
  const runtimeSymbols = generatedApis
    .filter((api) => api.library === 'web-rpc')
    .flatMap((api) =>
      api.symbols
        .filter((symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface')
        .map((symbol) => ({ api, symbol }))
    )

  assert.equal(runtimeSymbols.length, 59)
  for (const { api, symbol } of runtimeSymbols)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide(api.library, api.module, symbol.name, locale)
      assert.ok(guide, `${api.id}#${symbol.name} has no ${locale} decision guide`)
      assert.ok(guide.purpose.trim().length >= 40)
      assert.ok(guide.scenarios.length >= 1)
      assert.ok(guide.avoidWhen.length >= 2)
      for (const statement of [...guide.scenarios, ...guide.avoidWhen])
        assert.ok(statement.trim().length >= 12)
    }
})

test('SITE-T-WEB-RPC-TRANSPORTS gives every public adapter a bilingual runnable tutorial', () => {
  const transports = [
    ['memory-transport', 'createMemoryTransportPair'],
    ['window-transport', 'createWindowMessageTransport'],
    ['browser-message-port-transport', 'createBrowserMessagePortTransport'],
    ['node-message-port-transport', 'createNodeMessagePortTransport'],
    ['web-worker-transport', 'createWebWorkerTransport'],
    ['shared-worker-transport', 'createSharedWorkerTransport'],
    ['service-worker-transport', 'createServiceWorkerTransport'],
    ['broadcast-channel-transport', 'createBroadcastChannelTransport'],
    ['rtc-data-channel-transport', 'createRtcDataChannelTransport'],
    ['web-transport-datagram-transport', 'createWebTransportDatagramTransport']
  ] as const

  for (const locale of ['en', 'zh'] as const) {
    const journey = findGuideJourney('web-rpc', 'transports-and-security', locale)
    assert.ok(journey)
    const completeGuideCode = journey.document.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.type === 'code')
      .map((block) => block.code)
      .join('\n')
    assert.doesNotMatch(completeGuideCode, /createClientEndpoint/u)
    assert.doesNotMatch(completeGuideCode, /createProviderEndpoint/u)
    for (const [sectionId, factory] of transports) {
      const section = journey.document.sections.find((candidate) => candidate.id === sectionId)
      assert.ok(section, `${locale} transport guide misses ${sectionId}`)
      const code = section.blocks
        .filter((block) => block.type === 'code')
        .map((block) => block.code)
        .join('\n')
      assert.match(code, new RegExp(`\\b${factory}\\b`, 'u'))
      assert.match(code, /createEndpoint/u, `${locale} ${sectionId} has no direct endpoint example`)
      assert.ok(section.blocks.some((block) => block.type === 'paragraph'))
      assert.ok(section.blocks.some((block) => block.type === 'list'))
    }
    for (const sectionId of [
      'memory-transport',
      'window-transport',
      'web-worker-transport',
      'shared-worker-transport',
      'broadcast-channel-transport'
    ]) {
      const section = journey.document.sections.find((candidate) => candidate.id === sectionId)
      assert.ok(section)
      const code = section.blocks
        .filter((block) => block.type === 'code')
        .map((block) => block.code)
        .join('\n')
      assert.match(code, /createEndpoint/u)
      assert.match(code, /\.provide\(/u)
      assert.match(code, /\.send</u)
    }
    for (const sectionId of [
      'browser-message-port-transport',
      'node-message-port-transport',
      'service-worker-transport',
      'rtc-data-channel-transport',
      'web-transport-datagram-transport'
    ]) {
      const section = journey.document.sections.find((candidate) => candidate.id === sectionId)
      assert.ok(section)
      const code = section.blocks
        .filter((block) => block.type === 'code')
        .map((block) => block.code)
        .join('\n')
      assert.match(code, /\.provide\(/u)
      assert.match(code, /\.send(?:<|\()/u)
    }
    for (const sectionId of [
      'browser-message-port-transport',
      'node-message-port-transport',
      'shared-worker-transport',
      'service-worker-transport',
      'broadcast-channel-transport',
      'rtc-data-channel-transport',
      'web-transport-datagram-transport'
    ]) {
      const tutorial = journey.document.sections.find((candidate) => candidate.id === sectionId)
      assert.ok(tutorial)
      assert.ok(tutorial.blocks.filter((block) => block.type === 'paragraph').length >= 2)
      assert.ok(tutorial.blocks.some((block) => block.type === 'table'))
      assert.ok(
        tutorial.blocks.filter((block) => block.type === 'list').flatMap((block) => block.items)
          .length >= 8
      )
    }
  }
})

test('SITE-T-UTILS-GUIDES gives every runtime export an explicit bilingual decision guide', () => {
  const runtimeSymbols = generatedApis
    .filter((api) => api.library === 'utils')
    .flatMap((api) =>
      api.symbols
        .filter((symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface')
        .map((symbol) => ({ api, symbol }))
    )

  assert.equal(runtimeSymbols.length, 73)
  for (const { api, symbol } of runtimeSymbols)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide(api.library, api.module, symbol.name, locale)
      assert.ok(guide, `${api.id}#${symbol.name} has no ${locale} decision guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.purpose.trim().length >= 40)
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
      for (const statement of [...guide.scenarios, ...guide.avoidWhen])
        assert.ok(statement.trim().length >= 12)
    }
})

test('SITE-T-UTILS-COLLECTOR publishes a bilingual API and task guide', () => {
  const collectorApi = generatedApis
    .filter((api) => api.library === 'utils')
    .flatMap((api) => api.symbols.map((symbol) => ({ api, symbol })))
    .find(({ symbol }) => symbol.name === 'collect')
  assert.ok(collectorApi)
  assert.equal(collectorApi.api.module, 'index')

  for (const locale of ['en', 'zh'] as const) {
    const guide = findApiGuide('utils', 'index', 'collect', locale)
    assert.ok(guide?.quickStart?.includes('collect(users)'))

    const journey = findGuideJourney('utils', 'collector', locale)
    assert.ok(journey)
    const blocks = journey.document.sections.flatMap((section) => section.blocks)
    const code = blocks
      .filter((block) => block.type === 'code')
      .map((block) => block.code)
      .join('\n')
    assert.match(code, /import \{ collect \} from '@migaia\/utils'/u)
    assert.match(code, /\.fieldBy\(/u)
    assert.match(code, /\.distinctBy\(/u)
    assert.match(code, /\.skip\(/u)
    assert.match(code, /\.take\(/u)
    assert.ok(blocks.some((block) => block.type === 'table'))
    assert.ok(
      blocks.filter((block) => block.type === 'list').flatMap((block) => block.items).length >= 8
    )
  }
})

test('SITE-T-CONFIG-LOCALE gives every runtime option a Chinese explanation', () => {
  for (const api of generatedApis)
    for (const symbol of api.symbols) {
      if (symbol.kind === 'type' || symbol.kind === 'interface') continue
      for (const field of symbol.configuration)
        assert.ok(
          field.descriptionZh ||
            findOptionTranslation(api.library, api.module, symbol.name, field.name, 'zh') ||
            findApiGuide(api.library, api.module, symbol.name, 'zh')?.options.find(
              (option) => option.name === field.name
            )?.description,
          `${api.id}#${symbol.name}.${field.name} has no Chinese explanation`
        )
    }
})

test('SITE-T-CONFIG-LOCALE closes both locales for every runtime option', () => {
  for (const api of generatedApis) {
    for (const symbol of api.symbols) {
      if (symbol.kind === 'type' || symbol.kind === 'interface') continue
      for (const locale of ['en', 'zh'] as const) {
        const guide = findApiGuide(api.library, api.module, symbol.name, locale)
        for (const field of symbol.configuration)
          assert.ok(
            guide?.options.some((option) => option.name === field.name && option.description) ||
              (locale === 'en' ? field.descriptionEn : field.descriptionZh) ||
              findOptionTranslation(api.library, api.module, symbol.name, field.name, locale),
            `${api.id}#${symbol.name}.${field.name} has no ${locale} explanation`
          )
      }
    }
  }
})

test('SITE-T-EXAMPLES keeps maintained runtime examples and rejects generated casts', () => {
  let maintainedExampleCount = 0
  for (const api of generatedApis) {
    for (const symbol of api.symbols as Array<
      (typeof api.symbols)[number] & { examples: string[] }
    >) {
      for (const example of symbol.examples ?? []) {
        maintainedExampleCount += 1
        assert.doesNotMatch(example, /\{\}\s+as\s+I[A-Za-z]/)
        assert.doesNotMatch(example, /start with the smallest valid input/i)
      }
    }
  }
  assert.ok(maintainedExampleCount >= 400)

  const channel = generatedApis
    .find((api) => api.id === 'event-subscriber:index')
    ?.symbols.find((symbol) => symbol.name === 'createEventChannel') as
    | { examples: string[] }
    | undefined
  assert.ok(channel)
  assert.match(channel.examples[0] ?? '', /createEventChannel<[^>]+>\(\)/)
  assert.match(channel.examples[0] ?? '', /\.subscribe\(/)
  assert.match(channel.examples[0] ?? '', /\.publish\(/)
})

test('SITE-T-EVENT-GUIDES gives every event-subscriber function a bilingual task guide', () => {
  const apis = generatedApis.filter(
    (candidate) =>
      candidate.id === 'event-subscriber:index' || candidate.id === 'event-subscriber:subscriber'
  )
  assert.equal(apis.length, 2)
  const functions = apis.flatMap((api) =>
    api.symbols.filter((symbol) => /^[a-z]/.test(symbol.name)).map((symbol) => ({ api, symbol }))
  )
  assert.equal(functions.length, 14)
  for (const { api, symbol } of functions)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide(api.library, api.module, symbol.name, locale)
      assert.ok(guide, `${api.id}#${symbol.name} has no maintained ${locale} guide`)
      assert.ok(guide.quickStart, `${api.id}#${symbol.name} has no maintained ${locale} example`)
      assert.ok(guide.scenarios.length > 0)
      assert.ok(guide.avoidWhen.length > 0)
    }
})

test('SITE-T-LIFECYCLE-GUIDES protects the primary ownership and sequencing paths', () => {
  const primaryApis = [
    ['scope', 'createLifecycleScope'],
    ['generation', 'createGenerationController'],
    ['index', 'createMutationQueue'],
    ['index', 'createSyncLifecycleScope'],
    ['index', 'createLifecycleUnit'],
    ['index', 'createProvisionalScope'],
    ['index', 'boundedWait'],
    ['index', 'createTerminalController']
  ] as const
  for (const [moduleName, symbolName] of primaryApis)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('lifecycle', moduleName, symbolName, locale)
      assert.ok(guide, `lifecycle:${moduleName}#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart)
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
    }
  for (const [moduleName, symbolName] of primaryApis.slice(0, 3))
    for (const locale of ['en', 'zh'] as const)
      assert.ok(findApiGuide('lifecycle', moduleName, symbolName, locale)!.options.length >= 3)
})

test('SITE-T-LIFECYCLE-COMPOSITION documents release, quiescence, time, and cancellation axes', () => {
  const compositionApis = [
    ['disposal', 'createDisposeTransaction'],
    ['disposal', 'executeReleaseDescriptor'],
    ['quiescence', 'createPendingTracker'],
    ['quiescence', 'createQuiescenceTracker'],
    ['scheduler', 'createManualScheduler'],
    ['abort', 'createAbortController']
  ] as const
  for (const [moduleName, symbolName] of compositionApis)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('lifecycle', moduleName, symbolName, locale)
      assert.ok(guide, `lifecycle:${moduleName}#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart)
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
    }
})

test('SITE-T-LIFECYCLE-INFRA documents advanced containment and lease primitives', () => {
  const infrastructureApis = [
    ['abort', 'observeAbortSubscription'],
    ['disposal', 'createSyncStartedDisposalLedger'],
    ['errors', 'containAsyncRejection'],
    ['errors', 'createErrorCollector'],
    ['quiescence', 'createStringQuiescenceTracker'],
    ['quiescence', 'createObjectLeaseRegistry'],
    ['quiescence', 'createStringLeaseRegistry'],
    ['scheduler', 'snapshotScheduler']
  ] as const
  for (const [moduleName, symbolName] of infrastructureApis)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('lifecycle', moduleName, symbolName, locale)
      assert.ok(guide, `lifecycle:${moduleName}#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart)
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
    }
})

test('SITE-T-LIFECYCLE-COVERAGE gives every public lifecycle function a bilingual guide', () => {
  const lifecycleApis = generatedApis.filter((api) => api.library === 'lifecycle')
  const functions = lifecycleApis.flatMap((api) =>
    api.symbols.filter((symbol) => /^[a-z]/.test(symbol.name)).map((symbol) => ({ api, symbol }))
  )
  assert.equal(functions.length, 33)
  for (const { api, symbol } of functions)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide(api.library, api.module, symbol.name, locale)
      assert.ok(guide, `${api.id}#${symbol.name} has no maintained ${locale} guide`)
      assert.ok(guide.quickStart, `${api.id}#${symbol.name} has no maintained ${locale} example`)
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
    }
})

test('SITE-T-RESOURCE-GUIDE documents its complete constructor and ownership contract', () => {
  /** Public constructor fields that readers must be able to configure deliberately. */
  const expectedOptions = [
    'debugName',
    'ttl',
    'autoStart',
    'staleWhileRevalidate',
    'retry',
    'retryDelay',
    'keepAlive',
    'initialSnapshot',
    'scheduler'
  ]
  for (const locale of ['en', 'zh'] as const) {
    const guide = findApiGuide('resource', 'index', 'Resource', locale)
    assert.ok(guide, `resource:index#Resource has no maintained ${locale} guide`)
    assert.ok(guide.quickStart?.includes('new Resource('))
    assert.ok(guide.quickStart?.includes('user.dispose()'))
    assert.ok(guide.scenarios.length >= 3)
    assert.ok(guide.avoidWhen.length >= 3)
    assert.deepEqual(
      guide.options.map((option) => option.name),
      expectedOptions
    )
    for (const option of guide.options) {
      assert.ok(option.description.trim(), `Resource.${option.name} has no ${locale} purpose`)
      assert.ok(option.defaultValue?.trim(), `Resource.${option.name} has no ${locale} default`)
      assert.ok(option.type?.trim(), `Resource.${option.name} has no ${locale} type`)
      assert.ok(option.whenToUse.trim(), `Resource.${option.name} has no ${locale} decision`)
      assert.ok(option.example?.trim(), `Resource.${option.name} has no ${locale} example`)
    }
  }
})

test('SITE-T-LOGGER-RUNTIME-GUIDE documents host replacement and restoration', () => {
  /** Host capability fields that a runtime replacement must explain explicitly. */
  const expectedOptions = [
    'process',
    'createAbortController',
    'randomUUID',
    'defer',
    'write',
    'console',
    'fetch'
  ]
  for (const locale of ['en', 'zh'] as const) {
    const guide = findApiGuide('logger', 'index', 'setLoggerRuntimeManager', locale)
    assert.ok(guide, `logger:index#setLoggerRuntimeManager has no ${locale} guide`)
    assert.ok(guide.quickStart?.includes('try {'))
    assert.ok(guide.quickStart?.includes('finally {'))
    assert.ok(guide.quickStart?.includes('restore()'))
    assert.ok(guide.purpose.includes(locale === 'zh' ? '幂等' : 'idempotent'))
    assert.deepEqual(
      guide.options.map((option) => option.name),
      expectedOptions
    )
    for (const option of guide.options) {
      assert.ok(option.description.trim())
      assert.ok(option.defaultValue?.trim())
      assert.ok(option.type?.trim())
      assert.ok(option.whenToUse.trim())
      assert.ok(option.example?.trim())
    }
  }
})

test('SITE-T-LOGGER-PRIMARY-GUIDES documents the Logger and every user-facing plugin', () => {
  const targets = [
    ['index', 'Logger'],
    ['index', 'getLoggerRuntimeManager'],
    ['plugins', 'batch'],
    ['plugins', 'color'],
    ['plugins', 'http'],
    ['plugins', 'level'],
    ['plugins', 'process'],
    ['plugins', 'reasoning'],
    ['plugins', 'uuid']
  ] as const

  for (const [moduleName, symbolName] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('logger', moduleName, symbolName, locale)
      assert.ok(guide, `logger:${moduleName}#${symbolName} has no ${locale} primary guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.purpose.trim().length >= 40)
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
    }
})

test('SITE-T-PLUGIN-HOST-COVERAGE gives both public classes bilingual decision guides', () => {
  /** Runtime and failure classes that form the Plugin Host entry boundary. */
  const targets = ['PluginHost', 'PluginHostError'] as const
  for (const symbolName of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('plugin-host', 'index', symbolName, locale)
      assert.ok(guide, `plugin-host:index#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
    }

  for (const locale of ['en', 'zh'] as const) {
    const errorGuide = findApiGuide('plugin-host', 'index', 'PluginHostError', locale)
    assert.deepEqual(
      errorGuide?.options.map((option) => option.name),
      ['code', 'message', 'options.cause', 'options.detail']
    )
    assert.ok(errorGuide?.purpose.includes('cause'))
    assert.ok(errorGuide?.purpose.includes('detail'))
  }
})

test('SITE-T-TRAY-COVERAGE separates static composition from managed Host mutation', () => {
  /** Tray entry points and the option fields each one owns. */
  const targets = [
    [
      'index',
      'createTray',
      [
        'entries',
        'entries[].key',
        'entries[].kind',
        'entries[].requires',
        'entries[].readiness',
        'entries[].start'
      ]
    ],
    [
      'host',
      'createHost',
      [
        'create',
        'plugins',
        'mutationAdmissionMs',
        'quiescenceMs',
        'shutdown',
        'shutdown.mode',
        'report'
      ]
    ]
  ] as const
  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('tray', moduleName, symbolName, locale)
      assert.ok(guide, `tray:${moduleName}#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-CAPABILITY-COVERAGE separates gates, static graphs, dynamic graphs, and topology', () => {
  /** Capability callable entry points and the configuration each one owns. */
  const targets = [
    ['index', 'createCapabilityHost', ['flags', 'onError']],
    ['index', 'snapshotGraphReadiness', []],
    ['graph', 'createCapabilityGraph', ['onError']],
    [
      'graph-dynamic',
      'createDynamicCapabilityGraph',
      ['report', 'mutationAdmissionMs', 'startBatch', 'releaseBatch', 'releaseBinding']
    ],
    ['graph-topology', 'buildCapabilityTopology', []]
  ] as const
  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('capability', moduleName, symbolName, locale)
      assert.ok(guide, `capability:${moduleName}#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-MIDDLEWARE-API-COVERAGE keeps every runner and supported adapter distinct', () => {
  /** Middleware entry points and the configuration owned by each runner. */
  const targets = [
    ['runSyncMiddleware', ['signal']],
    [
      'runAsyncMiddleware',
      ['onViolation', 'assertActive', 'combineStageAndDownstreamError', 'signal']
    ],
    ['runGeneratorMiddleware', ['signal']],
    ['runAsyncGeneratorMiddleware', ['signal']],
    ['adaptSyncStageToAsync', []],
    ['adaptSyncStageToGenerator', []],
    ['adaptGeneratorStageToAsyncGenerator', []],
    ['adaptSyncStageToAsyncGenerator', []]
  ] as const
  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('middleware-pipeline', 'index', symbolName, locale)
      assert.ok(guide, `middleware-pipeline:index#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-WASM-API-COVERAGE documents every initialization, arena, and conversion entry', () => {
  const targets = [
    'initSync',
    'alloc_bytes',
    'ptr_of',
    'byte_len_of',
    'dealloc_bytes',
    'ConversionResult',
    'json_to_msgpack',
    'msgpack_to_json'
  ] as const
  for (const symbolName of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('wasm', 'index', symbolName, locale)
      assert.ok(guide, `wasm:index#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(guide.options, [])
    }
})

test('SITE-T-STORE-SHARED-API-COVERAGE separates shared values, arrays, and error factories', () => {
  const targets = [
    ['sharedInt32', ['runtime', 'initialValue', 'buffer']],
    ['SharedInt32Signal', ['runtime', 'initialValue', 'buffer']],
    ['sharedInt32Array', ['runtime', 'length', 'buffer', 'initialValues']],
    ['SharedInt32Array', ['runtime', 'length', 'buffer', 'initialValues']],
    ['createStoreSharedError', ['code', 'message', 'options.cause']],
    ['createStoreSharedRangeError', ['code', 'message', 'options.cause']]
  ] as const
  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-shared', 'index', symbolName, locale)
      assert.ok(guide, `store-shared:index#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-DEVTOOLS-API-COVERAGE explains sessions, graph projections, and errors', () => {
  const targets = [
    [
      'createStoreDevTools',
      [
        'store',
        'options.maxHistory',
        'options.maxTrace',
        'options.captureRuntimeTrace',
        'options.now',
        'options.clone'
      ]
    ],
    ['getDependencyTree', ['observer', 'maxDepth']],
    ['getObserverTree', ['observable', 'maxDepth']],
    ['createStoreDevtoolsError', ['code', 'message', 'options.cause']],
    ['createStoreDevtoolsRangeError', ['code', 'message']],
    ['createStoreDevtoolsAggregateError', ['code', 'errors', 'message']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-devtools', 'index', symbolName, locale)
      assert.ok(guide, `store-devtools:index#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-WORKER-COMPUTE-COVERAGE separates client, provider, and Resource ownership', () => {
  const targets = [
    [
      'WorkerAdapter',
      [
        'port',
        'options.clientId',
        'options.timeoutMs',
        'request.options.signal',
        'request.options.transfer'
      ]
    ],
    ['createWorkerHandler', ['compute', 'postMessage', 'options.timeoutMs']],
    [
      'workerComputed',
      ['adapter', 'selectInput', 'options.runtime', 'options.transfer', 'options.resource']
    ]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-worker', 'index', symbolName, locale)
      assert.ok(guide, `store-worker:index#${symbolName} has no ${locale} compute guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-WORKER-SERIALIZE-COVERAGE explains streams, byte ownership, and cleanup', () => {
  const targets = [
    [
      'serialize',
      'workerParser',
      ['worker', 'type', 'terminateOnDispose', 'ownership', 'clientId']
    ],
    [
      'serialize',
      'workerPlugin',
      ['worker', 'type', 'terminateOnDispose', 'ownership', 'clientId']
    ],
    ['serialize', 'createSerializeWorkerHandler', ['parser', 'post']],
    ['serialize', 'encodeWorkerValue', ['value']],
    ['serialize', 'decodeWorkerValue', ['value']],
    ['serialize', 'transferablesOf', ['chunk', 'ownership']],
    ['index', 'createStoreWorkerError', ['code', 'message', 'options.cause']],
    ['index', 'createStoreWorkerAggregateError', ['code', 'errors', 'message']]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-worker', moduleName, symbolName, locale)
      assert.ok(guide, `store-worker:${moduleName}#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-WASM-FIELD-COVERAGE separates readiness, scalar, bucket, and record semantics', () => {
  const targets = [
    ['ensureWasm', []],
    ['number', []],
    ['boolean', []],
    ['string', ['maxBytes']],
    ['array', ['item', 'length', 'granularity']],
    ['record', ['shape']],
    ['createStoreWasmError', ['code', 'message', 'options.cause']],
    ['createStoreWasmRangeError', ['code', 'message']],
    ['createStoreWasmTypeError', ['code', 'message', 'options.cause']],
    ['createStoreWasmAggregateError', ['code', 'errors', 'message']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-wasm', 'index', symbolName, locale)
      assert.ok(guide, `store-wasm:index#${symbolName} has no ${locale} field guide`)
      assert.ok(guide.quickStart?.trim())
      const minimumScenarios = symbolName.startsWith('createStoreWasm') ? 2 : 3
      assert.ok(guide.scenarios.length >= minimumScenarios)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-SSR-API-COVERAGE explains request isolation, hydration, transport, and trust', () => {
  const targets = [
    [
      'SSRRequestScope',
      [
        'runtime',
        'runtimeOptions',
        'register options.owned',
        'awaitResources timeoutMs',
        'dehydrateAsync onResourceError'
      ]
    ],
    ['createSSRRequestScope', ['runtime', 'runtimeOptions']],
    ['serializeSSRState', ['state']],
    ['serializeTrustedSSRState', ['state']],
    ['deserializeSSRState', ['serialized']],
    ['createSSRStateScript', ['state', 'elementId']],
    ['readSSRStateFromDocument', ['elementId', 'documentValue']],
    ['createSSRStateScriptWith', ['codecs', 'elementId', 'signal']],
    ['readSSRStateFromDocumentWith', ['codecs', 'elementId', 'document', 'signal']],
    ['assertSSRState', ['value']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-ssr', 'index', symbolName, locale)
      assert.ok(guide, `store-ssr:index#${symbolName} has no ${locale} API guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-LIGHT-API-COVERAGE separates Store creation, brands, and Resource ownership', () => {
  const creationOptions = ['shape', 'runtime', 'debugName', 'warnAsyncActions', 'mutationPolicy']
  const targets = [
    ['createStore', creationOptions],
    ['createStoreSync', creationOptions],
    ['createAsyncStore', creationOptions],
    ['createLegacyStore', creationOptions],
    ['storeReady', ['store']],
    ['raw', ['value']],
    ['isRaw', ['value']],
    ['isFieldBuilder', ['value']],
    ['createStoreResource', ['factory', 'keepAliveMs', 'dispose', 'onError', 'onTerminal']],
    ['createStoreResourceScope', []],
    ['createStoreLightError', ['code', 'message', 'options.cause']],
    ['createStoreLightRangeError', ['code', 'message']],
    ['createStoreLightTypeError', ['code', 'message', 'options.cause']],
    ['createStoreLightAggregateError', ['code', 'errors', 'message']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-light', 'index', symbolName, locale)
      assert.ok(guide, `store-light:index#${symbolName} has no ${locale} API guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-KEYED-ATOM-CORE documents definition identity, preview safety, and Store scope', () => {
  const targets = [
    ['atom-definition', 'atomDef', ['init', 'debugLabel']],
    ['atom-definition', 'atomDefFactory', ['create', 'debugLabel']],
    ['atom-definition', 'previewSafeAtomDefFactory', ['create', 'debugLabel']],
    ['atom-definition', 'derivedDef', ['read', 'debugLabel', 'equals']],
    ['atom-definition', 'writableDef', ['read', 'write', 'debugLabel', 'equals']],
    ['atom-store', 'createAtomStore', ['runtime']],
    ['atom-store', 'defaultAtomStore', ['runtime']]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-keyed', moduleName, symbolName, locale)
      assert.ok(guide, `store-keyed:${moduleName}#${symbolName} has no ${locale} API guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-KEYED-COMPOSITION documents family bounds, optics, and split ownership', () => {
  const targets = [
    ['familyDef', ['initial', 'maxSize', 'debugLabel']],
    ['derivedFamilyDef', ['read', 'maxSize', 'debugLabel']],
    ['selectDef', ['source', 'select', 'equals']],
    ['opticDef', ['source', 'optic']],
    ['focusDef', ['source', 'path']],
    ['splitDef', ['source', 'keyOf']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-keyed', 'index', symbolName, locale)
      assert.ok(guide, `store-keyed:index#${symbolName} has no ${locale} composition guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-KEYED-PROTOCOL documents brands, cross-runtime access, and immutable paths', () => {
  const targets = [
    ['atom-definition', 'isAtomDefinition', ['value']],
    ['atom-definition', 'assertNotThenable', ['value', 'context']],
    ['reactive-atom', 'atomGetter', ['runtime']],
    ['reactive-atom', 'atomSetter', ['runtime']],
    ['index', 'readOpticPath', ['value', 'path', 'label']],
    ['index', 'writeOpticPath', ['value', 'path', 'next', 'label']]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-keyed', moduleName, symbolName, locale)
      assert.ok(guide, `store-keyed:${moduleName}#${symbolName} has no ${locale} protocol guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-KEYED-HELPERS documents keyed lookup, transforms, and cache cleanup', () => {
  const targets = [
    ['findKeyIndex', ['items', 'keyOf', 'key']],
    ['computeUniqueKeys', ['items', 'keyOf', 'label']],
    ['requireKeyIndex', ['items', 'keyOf', 'key', 'label']],
    ['shallowArrayEquals', ['left', 'right']],
    ['spliceInsert', ['list', 'item', 'index']],
    ['filterOutKey', ['list', 'keyOf', 'key']],
    ['replaceAtIndex', ['list', 'index', 'value']],
    ['KeyedSplitCache', ['of key/create', 'prune isLive', 'prune shouldEvict', 'prune onEvict']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-keyed', 'index', symbolName, locale)
      assert.ok(guide, `store-keyed:index#${symbolName} has no ${locale} helper guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-KEYED-ERRORS documents native error identity and traceability', () => {
  const targets = [
    ['createStoreKeyedError', ['code', 'message', 'options.cause']],
    ['createStoreKeyedRangeError', ['code', 'message', 'options.cause']],
    ['createStoreKeyedTypeError', ['code', 'message', 'options.cause']],
    ['createStoreKeyedAggregateError', ['code', 'errors', 'message']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-keyed', 'index', symbolName, locale)
      assert.ok(guide, `store-keyed:index#${symbolName} has no ${locale} error guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-KEYED-CONSTANTS explains discriminators without fake configuration', () => {
  for (const symbolName of ['AtomKind', 'STORE_KEYED_SOURCE'] as const)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-keyed', 'index', symbolName, locale)
      assert.ok(guide, `store-keyed:index#${symbolName} has no ${locale} constant guide`)
      assert.ok(guide.purpose.trim())
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(guide.options, [])
    }
})

test('SITE-T-STORE-INDEXED-COLLECTIONS documents factories, classes, and ownership', () => {
  const targets = [
    'observableObject',
    'ObservableObject',
    'observableArray',
    'ObservableArray',
    'observableMap',
    'ObservableMap',
    'observableSet',
    'ObservableSet'
  ] as const

  for (const symbolName of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-indexed', 'index', symbolName, locale)
      assert.ok(guide, `store-indexed:index#${symbolName} has no ${locale} collection guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        ['initial', 'options.mutationGuard', 'options.debugName', 'runtime']
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-INDEXED-DIAGNOSTICS documents constants and native error identity', () => {
  const targets = [
    ['IndexedOperation', []],
    ['STORE_INDEXED_SOURCE', []],
    ['createStoreIndexedError', ['code', 'message', 'options.cause']],
    ['createStoreIndexedRangeError', ['code', 'message']],
    ['createStoreIndexedTypeError', ['code', 'message', 'options.cause']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-indexed', 'index', symbolName, locale)
      assert.ok(guide, `store-indexed:index#${symbolName} has no ${locale} diagnostic guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-MIDDLEWARE-POLICY-CLONE separates mutation admission and snapshot guarantees', () => {
  const targets = [
    ['index', 'createMutationPolicy', ['mode']],
    ['index', 'MutationPolicy', ['mode']],
    ['tolerant-clone', 'immutableSnapshotClone', ['value']],
    ['tolerant-clone', 'opaqueReferenceClone', ['value']],
    ['tolerant-clone', 'diagnosticClone', ['value']],
    ['tolerant-clone', 'ClonePolicy', []],
    ['tolerant-clone', 'tolerantClone', ['value']]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-middleware', moduleName, symbolName, locale)
      assert.ok(guide, `store-middleware:${moduleName}#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-MIDDLEWARE-HOST documents binding, plugins, DevTools, and every Host control', () => {
  const hostOptions = [
    'execution.mutationTimeoutMs',
    'execution.pipelineDrainTimeoutMs',
    'runtime',
    'getState',
    'applyState',
    'mutationPolicy',
    'pipeline.mode',
    'diagnostic',
    'scheduler',
    'queueAdmissionTimeoutMs',
    'queueAdmissionDiagnosticMs',
    'disposeStepTimeoutMs'
  ]
  const targets = [
    ['createStoreMiddlewareHost', hostOptions],
    ['StoreMiddlewareHost', hostOptions],
    [
      'bindStoreMiddleware',
      [
        'store',
        'options.execution',
        'options.mutationPolicy',
        'options.actionPrefix',
        'options.clone'
      ]
    ],
    ['middlewarePlugin', ['name', 'middleware']],
    ['loggerMiddleware', ['sink']],
    ['createReduxDevToolsAdapter', ['connection']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-middleware', 'index', symbolName, locale)
      assert.ok(guide, `store-middleware:index#${symbolName} has no ${locale} Host guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-MIDDLEWARE-DIAGNOSTICS documents event domains and cleanup traceability', () => {
  const targets = [
    ['MiddlewareEventType', []],
    ['MiddlewareEventPhase', []],
    ['MiddlewareCommandType', []],
    ['STORE_MIDDLEWARE_SOURCE', []],
    ['createStoreMiddlewareError', ['code', 'message', 'options.cause']],
    ['createStoreMiddlewareAggregateError', ['code', 'errors', 'message']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-middleware', 'index', symbolName, locale)
      assert.ok(guide, `store-middleware:index#${symbolName} has no ${locale} diagnostic guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-PERSIST-CORE documents lifecycle, codec routing, and every core option', () => {
  const targets = [
    [
      'persistUnit',
      [
        'unit',
        'options.key',
        'options.runtime',
        'options.storage',
        'options.codec',
        'options.version',
        'options.migrate',
        'options.partialize',
        'options.merge',
        'options.debounceMs'
      ]
    ],
    ['defaultJsonCodec', []],
    ['writeEnvelope', ['storage', 'key', 'codec', 'value', 'ctx.signal']],
    ['readEnvelope', ['storage', 'key', 'codec', 'ctx.signal']],
    ['removeEnvelope', ['storage', 'key', 'ctx.signal']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-persist', 'index', symbolName, locale)
      assert.ok(guide, `store-persist:index#${symbolName} has no ${locale} core guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-PERSIST-BOUNDARIES documents envelopes, states, and traceable errors', () => {
  const targets = [
    ['assertEnvelope', ['value', 'key']],
    ['PersistEnvelopeError', ['message']],
    ['PersistState', []],
    ['PersistCodecOutput', []],
    ['STORE_PERSIST_SOURCE', []],
    ['createStorePersistError', ['code', 'message', 'options.cause']],
    ['createStorePersistAbortError', ['code', 'message', 'cause']],
    ['createStorePersistTypeError', ['code', 'message', 'options.cause']],
    ['createStorePersistAggregateError', ['code', 'errors', 'message']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-persist', 'index', symbolName, locale)
      assert.ok(guide, `store-persist:index#${symbolName} has no ${locale} boundary guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-PERSIST-ADAPTERS separates flat, collection, keyed, and family ownership', () => {
  const targets = [
    [
      'light',
      'persist',
      [
        'store',
        'options.key',
        'options.storage',
        'options.codec',
        'options.version',
        'options.migrate',
        'options.partialize',
        'options.debounceMs'
      ]
    ],
    [
      'indexed',
      'persistCollection',
      [
        'collection',
        'options.key',
        'options.storage',
        'options.codec',
        'options.version',
        'options.migrate',
        'options.partialize',
        'options.merge',
        'options.debounceMs'
      ]
    ],
    [
      'keyed',
      'persistKeyed',
      [
        'atomStore',
        'def',
        'id',
        'options.namespace',
        'options.storage',
        'options.codec',
        'options.version',
        'options.debounceMs',
        'options.partialize',
        'options.merge'
      ]
    ],
    ['keyed', 'clearFamily', ['storage', 'namespace']]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-persist', moduleName, symbolName, locale)
      assert.ok(guide, `store-persist:${moduleName}#${symbolName} has no ${locale} adapter guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-REACT-HOOKS separates selectors, nodes, atoms, resources, and Provider definitions', () => {
  const targets = [
    ['useTracked', ['read', 'isEqual', 'runtime']],
    ['useSignal', ['s']],
    ['useStore', ['store', 'selector', 'isEqual']],
    ['useResource', ['res']],
    ['useResourceValue', ['resource']],
    ['useStoreResource', ['resource']],
    ['useNodeValue', ['node', 'runtime', 'enabled']],
    ['useAtomValue', ['atom']],
    ['useSetAtom', ['atom']],
    ['useAtom', ['atom']],
    ['useAsyncAtomValue', ['atom']],
    ['useAtomDefinition', ['definition']],
    ['useSetAtomDefinition', ['definition']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-react', 'index', symbolName, locale)
      assert.ok(guide, `store-react:index#${symbolName} has no ${locale} hook guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-REACT-PROVIDER documents Registry ownership, injection, and every Provider control', () => {
  const targets = [
    [
      'StoreProvider',
      [
        'children',
        'registry',
        'runtime',
        'disposeOnUnmount',
        'config.features.wasm',
        'config.features.experimental',
        'config.ready',
        'config.fallback',
        'config.defaults.warnAsyncActions'
      ]
    ],
    ['createStoreToken', ['debugName']],
    ['createStoreRegistry', ['runtime']],
    [
      'StoreRegistry',
      [
        'runtime',
        'register(token, value, options.owned)',
        'replace(token, value, options.owned)',
        'remove(token, disposeOwned)',
        'retain(disposeOnRelease)',
        'dispose / disposeAsync'
      ]
    ],
    ['useStoreRegistry', []],
    ['useStoreRuntime', []],
    ['useStoreFromProvider', ['token']],
    ['useProvidedStore', ['token', 'selector', 'isEqual']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-react', 'index', symbolName, locale)
      assert.ok(guide, `store-react:index#${symbolName} has no ${locale} Provider guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORE-REACT-CONFIG-ERRORS documents feature admission, readiness, and traceability', () => {
  const targets = [
    [
      'normalizeStoreConfig',
      ['config.features', 'config.ready', 'config.fallback', 'config.defaults', 'barrierScope']
    ],
    ['readStoreFeature', ['config', 'path']],
    ['assertStoreFeature', ['config', 'path', 'apiName']],
    ['useStoreConfig', []],
    ['useStoreFeature', ['path']],
    ['useAssertStoreFeature', ['path', 'apiName']],
    ['StoreProviderState', []],
    ['STORE_REACT_SOURCE', []],
    ['createStoreReactError', ['code', 'message', 'options.cause']],
    ['createStoreReactAggregateError', ['code', 'errors', 'message']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-react', 'index', symbolName, locale)
      assert.ok(guide, `store-react:index#${symbolName} has no ${locale} config/error guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORAGE-CONTRACT-CAPABILITIES documents boundary admission and capability composition', () => {
  const targets = [
    ['snapshotStorageCapabilities', ['value']],
    ['isStorageCapabilities', ['value']],
    ['snapshotKeyValueStoreDetailed', ['store']],
    ['snapshotKeyValueStore', ['store']],
    ['snapshotRecordStore', ['store']],
    ['isKeyValueStore', ['store']],
    ['asRecordStore', ['store']],
    ['isRecordStore', ['store']],
    ['asSecondaryIndexRecordStore', ['store']],
    ['isSecondaryIndexRecordStore', ['store']],
    ['asChangeFeedStore', ['store']],
    ['isChangeFeedStore', ['store']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('storage-contract', 'index', symbolName, locale)
      assert.ok(guide, `storage-contract:index#${symbolName} has no ${locale} capability guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORAGE-CONTRACT-INPUTS documents keys, operation context, and transactions', () => {
  const targets = [
    [
      'snapshotOperationContext',
      ['ctx.signal', 'ctx.timeoutMs', 'ctx.pageSize', 'ctx.conflictPolicy']
    ],
    ['assertOperationContext', ['ctx']],
    ['snapshotSyncWriteOptions', ['options.conflictPolicy']],
    ['assertSyncWriteOptions', ['options']],
    ['assertStringStorageKey', ['value', 'backend', 'label']],
    ['assertStorageKey', ['value', 'backend', 'label']],
    ['snapshotStorageKey', ['value', 'backend', 'label']],
    ['compareStorageKeys', ['a', 'b']],
    ['KEY_DOMAIN_LIMITS', []],
    ['assertTransactionCallback', ['run', 'backend']],
    ['readTransactionConflictPolicy', ['options.conflictPolicy', 'backend']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('storage-contract', 'index', symbolName, locale)
      assert.ok(guide, `storage-contract:index#${symbolName} has no ${locale} input guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORAGE-CONTRACT-CODECS-ERRORS documents wire identity, policy, and traceability', () => {
  const targets = [
    ['snapshotCodec', ['codec']],
    ['assertCodec', ['codec']],
    ['collectionsJsonCodec', []],
    ['COLLECTIONS_JSON_CODEC_NAME', []],
    ['ConflictPolicy', []],
    ['StorageContractConflictPolicy', []],
    ['intrinsicConstructorName', ['value']],
    ['STORAGE_CONTRACT_SOURCE', []],
    [
      'StorageContractError',
      ['code', 'details.backend', 'details.key', 'details.cause', 'message']
    ],
    ['isStorageContractError', ['value']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('storage-contract', 'index', symbolName, locale)
      assert.ok(guide, `storage-contract:index#${symbolName} has no ${locale} codec/error guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-SERIALIZE-FORMATS-BASE64 documents protocol constants, guards, and text transport', () => {
  const targets = [
    ['index', 'SerializeChunkKind', []],
    ['index', 'SerializeCleanupKind', []],
    ['index', 'SerializeCleanupPolicy', []],
    ['index', 'SerializeOutput', []],
    ['index', 'SerializePhase', []],
    ['index', 'SerializePluginType', []],
    ['core', 'assertSerializeType', ['type']],
    ['core', 'SERIALIZE_TYPE_PATTERN', []],
    ['core', 'isChunkShape', ['value']],
    ['core', 'bytesToBase64', ['bytes']],
    ['core', 'base64ToBytes', ['text']],
    ['core', 'streamBase64Chunks', ['bytes']]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('serialize', moduleName, symbolName, locale)
      assert.ok(guide, `serialize:${moduleName}#${symbolName} has no ${locale} format guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-SERIALIZE-STREAM-REGISTRY documents backpressure, collection, and lifecycle', () => {
  const targets = [
    [
      'core',
      'sliceByFrameBudget',
      [
        'items',
        'scheduler',
        'targetMs',
        'minItems',
        'maxItems',
        'initialItems',
        'yieldTo',
        'signal'
      ]
    ],
    [
      'core',
      'encodeStream',
      [
        'registry',
        'items',
        'type',
        'context',
        'maxInFlight',
        'scheduler',
        'targetMs',
        'minItems',
        'maxItems',
        'initialItems',
        'yieldTo',
        'signal'
      ]
    ],
    ['core', 'decodeStream', ['registry', 'chunks', 'type', 'context', 'signal']],
    ['core', 'collectStream', ['chunks', 'encoder', 'signal', 'empty', 'context']],
    ['registry', 'chunkToText', ['chunk', 'decoder']],
    ['registry', 'chunkToBytes', ['chunk', 'encoder']],
    [
      'registry',
      'createSerializeRegistry',
      [
        'plugins',
        'scheduler',
        'encoder',
        'decoder',
        'cleanup.policy',
        'cleanup.report',
        'onDrainTimeout',
        'report'
      ]
    ]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('serialize', moduleName, symbolName, locale)
      assert.ok(guide, `serialize:${moduleName}#${symbolName} has no ${locale} stream guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-SERIALIZE-PLUGINS-ERRORS documents JSON configuration and native error identity', () => {
  const targets = [
    ['plugins', 'jsonParser', ['replacer', 'reviver', 'space', 'decoder']],
    ['plugins', 'jsonPlugin', ['replacer', 'reviver', 'space', 'decoder']],
    ['core', 'SERIALIZE_SOURCE', []],
    ['core', 'tagSerializeError', ['error', 'code', 'context']],
    [
      'core',
      'createSerializeError',
      ['code', 'message', 'options.cause', 'options.context', 'options.errors']
    ],
    ['core', 'createSerializeTypeError', ['code', 'message', 'options.cause', 'options.context']],
    ['core', 'createSerializeRangeError', ['code', 'message', 'options.cause', 'options.context']],
    [
      'core',
      'SerializeCodecError',
      [
        'message',
        'details.code',
        'details.type',
        'details.phase',
        'details.chunkIndex',
        'details.bytesConsumed',
        'details.context',
        'details.source',
        'details.cause'
      ]
    ]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('serialize', moduleName, symbolName, locale)
      assert.ok(guide, `serialize:${moduleName}#${symbolName} has no ${locale} plugin/error guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORAGE-WEB-BACKENDS documents durability, capability, and every constructor option', () => {
  const targets = [
    ['memory', 'memoryStorageHost', []],
      ['local-storage', 'localStorageHost', ['storage']],
      ['session-storage', 'sessionStorageHost', ['storage']],
      ['cookies', 'cookiesHost', ['namespace', 'namespaceCodec', 'scope', 'document']],
    [
      'indexed-db',
      'indexedDbHost',
      [
        'dbName',
        'kvStoreName',
        'bytesStoreName',
        'recordsStoreName',
        'cleanupLegacyRecords',
        'factory',
        'keyRange'
      ]
    ]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('storage-web', moduleName, symbolName, locale)
      assert.ok(guide, `storage-web:${moduleName}#${symbolName} has no ${locale} backend guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORAGE-WEB-CODECS-SCHEMA documents selection, validation, and migration contracts', () => {
  const targets = [
    ['serialize', 'jsonCodec', []],
    ['serialize', 'binaryCodec', []],
    ['serialize', 'structuredCodec', []],
    ['serialize', 'selectCodec', ['codec', 'capabilities', 'onDiagnostic']],
    ['schema', 'fromStandardSchema', ['schema']],
    ['schema', 'passthrough', []],
    ['schema', 'runMigrations', ['value', 'fromVersion', 'toVersion', 'migrations', 'signal']]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('storage-web', moduleName, symbolName, locale)
      assert.ok(
        guide,
        `storage-web:${moduleName}#${symbolName} has no ${locale} codec/schema guide`
      )
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORAGE-WEB-ENTITY documents repository composition and every definition option', () => {
  const expectedOptions = [
    'name',
    'key',
    'schema',
    'codec',
    'version',
    'migrations',
    'validateOnRead',
    'onDiagnostic',
    'defaultOrderBy',
    'indexes'
  ]

  for (const locale of ['en', 'zh'] as const) {
    const guide = findApiGuide('storage-web', 'entity', 'defineEntity', locale)
    assert.ok(guide, `storage-web:entity#defineEntity has no ${locale} entity guide`)
    assert.ok(guide.quickStart?.includes('.connect('))
    assert.ok(guide.quickStart?.includes('.put('))
    assert.ok(guide.scenarios.length >= 4)
    assert.ok(guide.avoidWhen.length >= 4)
    assert.deepEqual(
      guide.options.map((option) => option.name),
      expectedOptions
    )
    for (const option of guide.options) {
      assert.ok(option.description.trim())
      assert.ok(option.defaultValue?.trim())
      assert.ok(option.type?.trim())
      assert.ok(option.whenToUse.trim())
      assert.ok(option.example?.trim())
    }
  }
})

test('SITE-T-STORAGE-WEB-HOST documents authority, topology, installation, and lifecycle options', () => {
  const targets = [
    ['assertStorageBackendId', ['id']],
    ['createStorageHost', ['plugins', 'installTimeoutMs', 'scheduler', 'report']],
    ['StorageHostFacade', ['installTimeoutMs', 'scheduler', 'report']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('storage-web', 'host', symbolName, locale)
      assert.ok(guide, `storage-web:host#${symbolName} has no ${locale} Host guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORAGE-WEB-BOUNDARIES documents internal names, metadata, namespace, and errors', () => {
  const targets = [
    ['host', 'pluginNameFromBackendId', ['id']],
    ['host', 'reactiveAdapterNameFromBackendId', ['id']],
    ['host', 'STORAGE_LIVE_QUERY_SERVICE_NAME', []],
    ['index', 'lengthPrefixedNamespaceCodec', []],
    ['index', 'STORAGE_WEB_SOURCE', []],
    ['index', 'StorageErrorText', []],
    ['index', 'StorageError', ['code', 'details', 'message', 'stage']]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('storage-web', moduleName, symbolName, locale)
      assert.ok(guide, `storage-web:${moduleName}#${symbolName} has no ${locale} boundary guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORAGE-WEB-PLUGINS documents non-reactive factories and custom reactive adapters', () => {
  const targets = [
    ['plugins-memory', 'memoryBackendPlugin', ['id']],
      ['plugins-local-storage', 'localStorageBackendPlugin', ['storage']],
      ['plugins-session-storage', 'sessionStorageBackendPlugin', ['storage']],
      ['plugins-cookies', 'cookieBackendPlugin', ['namespace', 'namespaceCodec', 'scope', 'document']],
    [
      'plugins-indexed-db',
      'indexedDbBackendPlugin',
      [
        'id',
        'dbName',
        'kvStoreName',
        'bytesStoreName',
        'recordsStoreName',
        'cleanupLegacyRecords',
        'factory',
        'keyRange'
      ]
    ],
    [
      'reactive-adapter',
      'defineReactiveAdapterFeature',
      ['backendKind', 'mode', 'pollIntervalMs', 'visibility', 'subscribe']
    ]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('storage-web', moduleName, symbolName, locale)
      assert.ok(guide, `storage-web:${moduleName}#${symbolName} has no ${locale} plugin guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-STORAGE-WEB-REACTIVE-PLUGINS documents honest visibility and every factory option', () => {
  const targets = [
    ['plugins-reactive-memory', 'memoryReactive', ['id']],
      ['plugins-reactive-local-storage', 'localStorageReactive', ['storage']],
      ['plugins-reactive-session-storage', 'sessionStorageReactive', ['storage']],
      ['plugins-reactive-cookies', 'cookiesReactive', ['namespace', 'namespaceCodec', 'scope', 'document']],
    [
      'plugins-reactive-indexed-db',
      'indexedDbReactive',
      [
        'id',
        'dbName',
        'kvStoreName',
        'bytesStoreName',
        'recordsStoreName',
        'cleanupLegacyRecords',
        'factory',
        'keyRange'
      ]
    ]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('storage-web', moduleName, symbolName, locale)
      assert.ok(guide, `storage-web:${moduleName}#${symbolName} has no ${locale} reactive guide`)
      assert.ok(guide.quickStart?.includes('liveQuery'))
      assert.ok(guide.scenarios.length >= 3)
      assert.ok(guide.avoidWhen.length >= 3)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim())
        assert.ok(option.defaultValue?.trim())
        assert.ok(option.type?.trim())
        assert.ok(option.whenToUse.trim())
        assert.ok(option.example?.trim())
      }
    }
})

test('SITE-T-REACTIVE-GUIDES documents the primary graph path and every public option', () => {
  const targets = [
    ['reactive', 'Signal', ['debugName']],
    ['reactive', 'Computed', ['equals', 'keepAlive', 'debugName']],
    ['reactive', 'Effect', ['debugName']],
    [
      'runtime',
      'createRuntime',
      ['adapter', 'onError', 'onTrace', 'maxFlushPasses', 'scheduleIdle']
    ],
    ['runtime', 'Runtime', ['adapter', 'onError', 'onTrace', 'maxFlushPasses', 'scheduleIdle']],
    ['index', 'defaultRuntime', []]
  ] as const

  for (const [moduleName, symbolName, expectedOptions] of targets) {
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('reactive', moduleName, symbolName, locale)
      assert.ok(guide, `missing ${locale} reactive guide: ${moduleName}#${symbolName}`)
      assert.ok(guide.quickStart?.trim(), `missing ${locale} quick start: ${symbolName}`)
      assert.ok(guide.scenarios.length > 0, `missing ${locale} scenarios: ${symbolName}`)
      assert.ok(guide.avoidWhen.length > 0, `missing ${locale} avoid guidance: ${symbolName}`)
      assert.deepEqual(
        guide.options.map((option) => option.name),
        expectedOptions,
        `incomplete ${locale} option guide: ${symbolName}`
      )
      for (const option of guide.options) {
        assert.ok(option.description.trim(), `${symbolName}.${option.name} has no purpose`)
        assert.ok(option.defaultValue?.trim(), `${symbolName}.${option.name} has no default`)
        assert.ok(option.whenToUse.trim(), `${symbolName}.${option.name} has no decision guidance`)
        assert.ok(option.example?.trim(), `${symbolName}.${option.name} has no example`)
      }
    }
  }
})
