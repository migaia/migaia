import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createSupportingContractGuide,
  findApiGuide,
  findOptionTranslation
} from '../app/api-guides.js'
import type { IApi } from '../app/content-contract.js'
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
const generatedApis = generatedApiManifest.apis as readonly IApi[]

test('validates bounded writer selection before generation', () => {
  assert.equal(parseSelectedLibrary([]), null)
  assert.equal(parseSelectedLibrary(['--library', 'plugin-host']), 'plugin-host')
  assert.throws(() => parseSelectedLibrary(['--library']))
  assert.throws(() => parseSelectedLibrary(['--library', 'unknown']))
})

test('preserves unselected order through shrink, equal, and grow', () => {
  const previous = [
    { library: 'utils', id: 'before' },
    { library: 'plugin-host', id: 'old-a' },
    { library: 'rpc', id: 'middle' },
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
    const merged = replaceOwnedEntries(
      previous,
      replacement,
      ownsPluginHost,
      'plugin-host rows'
    ) as Array<{
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

test('assigns route, transform, and diagnostics to one selected chain', () => {
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

test('excludes forbidden direct dependencies while retaining TypeScript 7', () => {
  const directNames = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
  assert.deepEqual(
    directNames.filter((name) => /^(?:@astrojs|astro|@babel|babel|@swc|swc)$/i.test(name)),
    []
  )
  assert.equal(manifest.devDependencies.typescript, '7.0.2')
})

test('contains Babel utilities only below the React Router framework closure', () => {
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

test('config and scripts select Oxc without a fallback compiler', () => {
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

test('production output includes the Oxc compiler runtime artifact', () => {
  const assetsDirectory = join(websiteRoot, 'build/client/assets')
  const outputManifest = readdirSync(assetsDirectory).find((name) => /^manifest-.*\.js$/.test(name))
  assert.ok(outputManifest, 'run the production build before the output contract test')
  assert.match(readFileSync(join(assetsDirectory, outputManifest), 'utf8'), /compiler-runtime/)
})

test('compiler packages are direct website dependencies and resolve locally', () => {
  for (const name of ['@react-router/dev', 'react-router', 'vite', 'typescript']) {
    const packageJson = packagePath(name, websiteRoot)
    assert.ok(packageJson)
    assert.ok(manifest.dependencies[name] ?? manifest.devDependencies[name])
  }
})

test('generated projections contain no volatile metadata', () => {
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
            'rpc-contract',
            'rpc-core',
            'rpc-process',
            'rpc-threads',
            'rpc-browser',
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
  /**
   * Five RPC runtime owners replace the former single package, adding exactly four libraries; the
   * separate rpc-pool package adds one more, and rpc-devtools adds the observation contracts.
   */
  assert.equal(libraryManifest.libraries.length, 33)
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
  /** 5c067227 preserves authored classifications; missing prose must not become invented guarantees. */
  assert.ok(
    symbols.every(
      (symbol) =>
        symbol.purpose.length > 0 &&
        symbol.core.length > 0 &&
        typeof symbol.advanced === 'string' &&
        symbol.parameters.length > 0 &&
        symbol.returns.length > 0 &&
        Array.isArray(symbol.errors) &&
        symbol.errors.every((error) => typeof error === 'string' && error.length > 0) &&
        typeof symbol.lifecycleConcurrency === 'string' &&
        typeof symbol.whenToUse === 'string' &&
        typeof symbol.notUse === 'string' &&
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

test('gives every public configuration field a readable contract', () => {
  for (const api of generatedApis) {
    for (const symbol of api.symbols) {
      if (symbol.kind === 'type' || symbol.kind === 'interface') continue
      for (const field of symbol.configuration) {
        assert.ok(field.name.length > 0, `${api.id}#${symbol.name} has an unnamed option`)
        assert.ok(field.type.length > 0, `${api.id}#${symbol.name}.${field.name} has no type`)
        /** Match the rendered option reference, including maintained fields outside the task guide. */
        const description =
          findOptionTranslation(api.library, api.module, symbol.name, field.name, 'en') ||
          findApiGuide(api.library, api.module, symbol.name, 'en')?.options.find(
            (option) => option.name === field.name
          )?.description ||
          field.descriptionEn ||
          field.description
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

  const pluginHost = generatedApis
    .find((api) => api.id === 'plugin-host:index')
    ?.symbols.find((symbol) => symbol.name === 'PluginHost')
  assert.ok(pluginHost)
  assert.ok(pluginHost.configuration.some((field) => field.name === 'execution.mutationTimeoutMs'))
  assert.ok(pluginHost.configuration.some((field) => field.name === 'pipeline.mode'))
  assert.ok(!pluginHost.configuration.some((field) => field.name === 'mode'))
})

test('gives every RPC runtime export an explicit bilingual decision guide', () => {
  const runtimeSymbols = generatedApis
    .filter((api) =>
      [
        'rpc-contract',
        'rpc-core',
        'rpc-process',
        'rpc-threads',
        'rpc-browser',
        'rpc-devtools'
      ].includes(api.library)
    )
    .flatMap((api) =>
      api.symbols
        .filter((symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface')
        .map((symbol) => ({ api, symbol }))
    )

  /**
   * Adapter extraction moved owner entries into the adapter packages; the adapter SDK then replaced
   * the low-level adapter exports with defineMessageAdapter / defineByteAdapter and an
   * internal-advanced entry, and the short-source helpers added isProcessChild / isThreadChild.
   * Browser Peer adds createBrowserPeer and its package error source/code catalog at the root.
   * Probe adds 16 runtime exports including current-stage readers and the existing reporter
   * aliases. The generator excludes the internal-advanced entry, including carrierSizeBytes.
   * Devtools retains its nine canonical runtime symbols. The contract entry's error-code/source
   * re-exports are alias-only and are not counted twice.
   */
  /**
   * The coroutine change removes createCoroutineHost while keeping the createCoroutinePlugin
   * export.
   */
  /** The canonical defaultRpcReporter adds one runtime export to the reviewed RPC surface. */
  /** Removing four Bridge exports and adding one Process binding yields net minus three. */
  /**
   * API audits 649eee7e/99b92efe/4c88a2c5 retire eleven runtime entries. The two RuntimeEventName
   * re-exports are aliases; 5c067227 also projects the wire-error JSON default and
   * identifyRpcBoundaryFailure as canonical entries: 334 - 13 + 2 = 323.
   */
  assert.equal(runtimeSymbols.length, 323)
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

test('gives every public adapter a bilingual runnable tutorial', () => {
  /** Each adapter retains its Core overview section, public API owner and maintained example. */
  const transports = [
    [
      'memory-transport',
      'rpc-core',
      'adapters/memory',
      'createMemoryTransportPair',
      'getting-started'
    ],
    [
      'window-transport',
      'rpc-browser',
      'adapters/window',
      'createWindowMessageTransport',
      'peers-and-window'
    ],
    [
      'browser-message-port-transport',
      'rpc-core',
      'adapters/message-port',
      'createBrowserMessagePortTransport',
      null
    ],
    [
      'node-message-port-transport',
      'rpc-core',
      'adapters/message-port',
      'createNodeMessagePortTransport',
      'transports-and-security'
    ],
    ['web-worker-transport', 'rpc-core', 'adapters/web-worker', 'createWebWorkerTransport', null],
    [
      'shared-worker-transport',
      'rpc-browser',
      'adapters/shared-worker',
      'createSharedWorkerTransport',
      'shared-workers'
    ],
    [
      'service-worker-transport',
      'rpc-browser',
      'adapters/service-worker',
      'createServiceWorkerTransport',
      'broadcast-and-service-workers'
    ],
    [
      'broadcast-channel-transport',
      'rpc-browser',
      'adapters/broadcast-channel',
      'createBroadcastChannelTransport',
      'broadcast-and-service-workers'
    ],
    [
      'rtc-data-channel-transport',
      'rpc-browser',
      'adapters/rtc-data-channel',
      'createRtcDataChannelTransport',
      'rtc-data-channels'
    ],
    [
      'web-transport-datagram-transport',
      'rpc-browser',
      'adapters/web-transport',
      'createWebTransportDatagramTransport',
      'web-transport-datagrams'
    ]
  ] as const

  for (const locale of ['en', 'zh'] as const) {
    /** Core keeps an overview for all ten APIs, with one complete real Node-port call. */
    const journey = findGuideJourney('rpc-core', 'transports-and-security', locale)
    assert.ok(journey)
    /** The request/provider example may use the actual narrower public factory entries. */
    const nodeSection = journey.document.sections.find(
      (section) => section.id === 'node-message-port-transport'
    )
    assert.ok(nodeSection)
    /** Real stock RPC must retain host construction, method registration, typed call and cleanup. */
    const nodeCode = nodeSection.blocks
      .flatMap((block) => (block.type === 'code' && block.language === 'ts' ? [block.code] : []))
      .join('\n')
    assert.match(nodeCode, /new MessageChannel\(/u)
    assert.match(nodeCode, /createNodeMessagePortTransport/u)
    assert.match(nodeCode, /from '@migaia\/rpc-core\/client'/u)
    assert.match(nodeCode, /from '@migaia\/rpc-core\/provider'/u)
    assert.match(nodeCode, /context\.success\(7\)/u)
    assert.match(nodeCode, /\.provide\(/u)
    assert.match(nodeCode, /\.send<number>/u)
    assert.match(nodeCode, /await client\.dispose\(\)/u)
    assert.match(nodeCode, /await provider\.dispose\(\)/u)
    assert.match(nodeCode, /port1\.close\(\)/u)
    assert.match(nodeCode, /port2\.close\(\)/u)

    for (const [sectionId, owner, module, factory, topic] of transports) {
      /** Every original section still explains and links the actual public factory. */
      const section = journey.document.sections.find((candidate) => candidate.id === sectionId)
      assert.ok(section, `${locale} transport guide misses ${sectionId}`)
      /** Paragraph/list/table prose contains the canonical API link rather than an invented owner. */
      const prose = section.blocks
        .flatMap((block) =>
          block.type === 'paragraph'
            ? [block.text]
            : block.type === 'list'
              ? block.items
              : block.type === 'table'
                ? block.rows.flat()
                : []
        )
        .join('\n')
      /** The generated public manifest protects actual ownership and symbol existence. */
      const api = generatedApis.find(
        (candidate) =>
          candidate.library === owner &&
          candidate.module === module &&
          candidate.symbols.some((symbol) => symbol.name === factory && symbol.kind !== 'type')
      )
      assert.ok(api, `${owner}/${module} does not export ${factory}`)
      /** Link to the actual API page, including the six Browser-owned adapters. */
      const apiPath = `/${locale}/docs/${owner}/api/${module}/${factory}`
      assert.ok(prose.includes(`](${apiPath})`), `${locale} ${sectionId} misses ${apiPath}`)
      assert.ok(section.blocks.some((block) => block.type === 'table'))
      /** Each referenced API retains a direct adapter/Endpoint installation and release example. */
      const apiGuide = findApiGuide(owner, module, factory, locale)
      assert.ok(apiGuide?.quickStart, `${locale} ${factory} has no API example`)
      assert.match(apiGuide.quickStart, new RegExp(`\\b${factory}\\b`, 'u'))
      assert.match(apiGuide.quickStart, /createEndpoint/u)
      assert.match(apiGuide.quickStart, /\.provide\(/u)
      assert.match(apiGuide.quickStart, /\.dispose\(\)/u)
      if (topic === null) continue

      /** Complete business examples live on their actual owner task page, not ten inline scenes. */
      const ownerJourney = findGuideJourney(owner, topic, locale)
      assert.ok(ownerJourney, `${locale} ${owner}/${topic} has no business example`)
      /** Preserve the real host input and public messaging behavior of that task. */
      const ownerCode = ownerJourney.document.sections
        .flatMap((candidate) => candidate.blocks)
        .flatMap((block) => (block.type === 'code' && block.language === 'ts' ? [block.code] : []))
        .join('\n')
      assert.ok(ownerCode.trim(), `${locale} ${owner}/${topic} has no TypeScript example`)
      assert.match(ownerCode, /\.send(?:<|\()|\.request\(|\.subscribe\(/u)
      if (factory === 'createSharedWorkerTransport') {
        assert.match(ownerCode, /new SharedWorker\(/u)
        assert.match(ownerCode, /createBrowserPeer/u)
      } else if (factory === 'createRtcDataChannelTransport') {
        assert.match(ownerCode, /new RTCPeerConnection\(/u)
        assert.match(ownerCode, /createBrowserPeer/u)
      } else {
        assert.match(ownerCode, new RegExp(`\\b${factory}\\b`, 'u'))
      }
      if (owner !== 'rpc-core' || topic !== 'transports-and-security') {
        /** An overview link must reach the actual task example instead of stopping at declarations. */
        const taskPath = `/${locale}/docs/${owner}/${topic}`
        assert.ok(prose.includes(`](${taskPath})`), `${locale} ${sectionId} misses ${taskPath}`)
      }
    }
  }
})

test('gives every utils runtime export an explicit bilingual decision guide', () => {
  const runtimeSymbols = generatedApis
    .filter((api) => api.library === 'utils')
    .flatMap((api) =>
      api.symbols
        .filter((symbol) => symbol.kind !== 'type' && symbol.kind !== 'interface')
        .map((symbol) => ({ api, symbol }))
    )

  assert.ok(runtimeSymbols.length > 0, 'expected public utils runtime exports')
  for (const { api, symbol } of runtimeSymbols)
    for (const locale of ['en', 'zh'] as const) {
      const guide =
        findApiGuide(api.library, api.module, symbol.name, locale) ??
        createSupportingContractGuide(api.library, symbol, locale)
      assert.ok(guide, `${api.id}#${symbol.name} has no ${locale} decision guide`)
      assert.ok(guide.quickStart?.trim())
      assert.ok(guide.purpose.trim().length >= 40)
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
      for (const statement of [...guide.scenarios, ...guide.avoidWhen])
        assert.ok(statement.trim().length >= 12)
    }
})

test('publishes a bilingual API and task guide', () => {
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
  }
})

test('gives every runtime option a Chinese explanation', () => {
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

test('closes both locales for every runtime option', () => {
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

test('keeps maintained runtime examples and rejects generated casts', () => {
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

test('gives every event-subscriber function a bilingual task guide', () => {
  const apis = generatedApis.filter(
    (candidate) =>
      candidate.id === 'event-subscriber:index' || candidate.id === 'event-subscriber:subscriber'
  )
  assert.equal(apis.length, 2)
  const functions = apis.flatMap((api) =>
    api.symbols.filter((symbol) => /^[a-z]/.test(symbol.name)).map((symbol) => ({ api, symbol }))
  )
  /** API audit e3a98b85 removed defineEventApiStyle in favor of the native event builders. */
  assert.equal(functions.length, 13)
  for (const { api, symbol } of functions)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide(api.library, api.module, symbol.name, locale)
      assert.ok(guide, `${api.id}#${symbol.name} has no maintained ${locale} guide`)
      assert.ok(guide.quickStart, `${api.id}#${symbol.name} has no maintained ${locale} example`)
      assert.ok(guide.scenarios.length > 0)
      assert.ok(guide.avoidWhen.length > 0)
    }
})

test('protects the primary ownership and sequencing paths', () => {
  const primaryApis = [
    ['scope', 'createLifecycleScope'],
    ['generation', 'createGenerationController'],
    ['index', 'createMutationQueue'],
    ['index', 'createSyncLifecycleScope'],
    ['index', 'abortableDelay'],
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

test('documents release, quiescence, time, and cancellation axes', () => {
  const compositionApis = [
    ['lifecycle', 'disposal', 'createDisposeTransaction'],
    ['lifecycle', 'disposal', 'executeReleaseDescriptor'],
    ['lifecycle', 'quiescence', 'createPendingTracker'],
    ['lifecycle', 'quiescence', 'createQuiescenceTracker'],
    ['utils', 'scheduler', 'createManualScheduler'],
    ['lifecycle', 'abort', 'createAbortController']
  ] as const
  for (const [library, moduleName, symbolName] of compositionApis)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide(library, moduleName, symbolName, locale)
      assert.ok(guide, `${library}:${moduleName}#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart)
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
    }
})

test('documents advanced containment and lease primitives', () => {
  const infrastructureApis = [
    ['abort', 'observeAbortSubscription'],
    ['disposal', 'createSyncStartedDisposalLedger'],
    ['errors', 'containAsyncRejection'],
    ['errors', 'createErrorCollector'],
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

test('gives every public lifecycle function a bilingual guide', () => {
  const lifecycleApis = generatedApis.filter((api) => api.library === 'lifecycle')
  const functions = lifecycleApis.flatMap((api) =>
    api.symbols.filter((symbol) => /^[a-z]/.test(symbol.name)).map((symbol) => ({ api, symbol }))
  )
  assert.ok(functions.length > 0, 'expected public lifecycle functions')
  for (const { api, symbol } of functions)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide(api.library, api.module, symbol.name, locale)
      assert.ok(guide, `${api.id}#${symbol.name} has no maintained ${locale} guide`)
      assert.ok(guide.quickStart, `${api.id}#${symbol.name} has no maintained ${locale} example`)
      assert.ok(guide.scenarios.length >= 2)
      assert.ok(guide.avoidWhen.length >= 2)
    }
})

test('documents its complete constructor and ownership contract', () => {
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

test('documents host replacement and restoration', () => {
  /** Host capability fields that a runtime replacement must explain explicitly. */
  const expectedOptions = [
    'process',
    'createAbortController',
    'randomUUID',
    'defer',
    'write',
    'console',
    'fs',
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

test('documents the Logger and every user-facing plugin', () => {
  const targets = [
    ['index', 'Logger'],
    ['index', 'getLoggerRuntimeManager'],
    ['plugins', 'batch'],
    ['plugins', 'color'],
    ['plugins/file', 'file'],
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

test('gives both public classes bilingual decision guides', () => {
  /** Runtime and failure classes that form the Plugin Host entry boundary. */
  const targets = ['PluginHost', 'PluginHostError'] as const
  for (const symbolName of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('plugin-host', 'index', symbolName, locale)
      assert.ok(guide, `plugin-host:index#${symbolName} has no ${locale} guide`)
      assert.ok(guide.quickStart)
      assert.ok(guide.quickStart.trim())
      assert.ok(
        guide.scenarios.some((scenario) => scenario.trim()),
        `${symbolName}: when to use`
      )
      assert.ok(
        guide.avoidWhen.some((boundary) => boundary.trim()),
        `${symbolName}: when to avoid`
      )
      assert.match(guide.quickStart, /await host\.dispose\(\)/)
      if (symbolName === 'PluginHost') {
        assert.match(guide.quickStart, /createPluginDomainCore/)
        assert.match(guide.quickStart, /const \[greeting\] = await host\.use\(greetingPlugin\)/)
        assert.match(guide.quickStart, /greeting\.extensions\.greet\('Ada'\)/)
        assert.match(guide.quickStart, /await host\.unUse\('greeting'\)/)
      } else {
        assert.match(guide.quickStart, /error\.code !== PluginHostErrorCode\.pluginInstallFailed/)
        assert.match(guide.quickStart, /console\.assert\(error\.cause === unavailable\)/)
      }
    }

  for (const locale of ['en', 'zh'] as const) {
    const errorGuide = findApiGuide('plugin-host', 'index', 'PluginHostError', locale)
    assert.deepEqual(
      errorGuide?.options.map((option) => option.name),
      ['code', 'message', 'options.cause', 'options.detail']
    )
    assert.ok(errorGuide?.purpose.includes('cause'))
    assert.ok(
      errorGuide?.options.find((option) => option.name === 'options.detail')?.description.trim()
    )
  }
})

test('separates static composition from managed Host mutation', () => {
  /** Tray entry points and the option fields each one owns. */
  const targets = [
    [
      'index',
      'createTrayGraph',
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

test('separates gates, static graphs, dynamic graphs, and topology', () => {
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

test('documents the canonical runner and supported adaptation boundary', () => {
  /**
   * Commit ac5ed837 removed the eight public run/adapt helpers; createPipeline owns run() and
   * lift().
   */
  const targets = [
    [
      'createPipeline',
      ['mode', 'onViolation', 'assertActive', 'signal', 'signals', 'combineStageAndDownstreamError']
    ]
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

test('documents every initialization, arena, and conversion entry', () => {
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

test('separates shared values, arrays, and error factories', () => {
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

test('explains sessions, graph projections, and errors', () => {
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

test('separates client, provider, and Resource ownership', () => {
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

test('explains streams, byte ownership, and cleanup', () => {
  /** API audit a384c4d3 keeps only serialize/worker public; wire-value helpers are internal. */
  const targets = [
    [
      'serialize/worker',
      'workerParser',
      ['worker', 'type', 'terminateOnDispose', 'ownership', 'clientId']
    ],
    [
      'serialize/worker',
      'workerPlugin',
      ['worker', 'type', 'terminateOnDispose', 'ownership', 'clientId']
    ],
    ['serialize/worker', 'createSerializeWorkerHandler', ['parser', 'post']],
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

test('separates readiness, scalar, bucket, and record semantics', () => {
  /** The array(length, granularity) function stores f64 values; it has no item-builder parameter. */
  const targets = [
    ['ensureWasm', []],
    ['number', []],
    ['boolean', []],
    ['string', ['maxBytes']],
    ['array', ['length', 'granularity']],
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

test('explains request isolation, hydration, transport, and trust', () => {
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

test('separates Store creation, brands, and Resource ownership', () => {
  const creationOptions = ['shape', 'runtime', 'debugName', 'warnAsyncActions', 'mutationPolicy']
  const targets = [
    ['createStore', creationOptions],
    ['createAsyncStore', creationOptions],
    ['storeReady', ['store']],
    ['raw', ['value']],
    ['isRaw', ['value']],
    ['isFieldBuilder', ['value']],
    [
      'createStoreResource',
      ['factory', 'runtime', 'scheduler', 'keepAliveMs', 'dispose', 'onError', 'onTerminal']
    ],
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

test('documents definition identity, preview safety, and Store scope', () => {
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

test('documents family bounds, optics, and split ownership', () => {
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

test('documents brands, cross-runtime access, and immutable paths', () => {
  const targets = [
    ['atom-definition', 'isAtomDefinition', ['value']],
    ['atom-definition', 'assertNotThenable', ['value', 'context']],
    ['reactive-atom', 'atomGetter', ['runtime']],
    ['reactive-atom', 'atomSetter', ['runtime']],
    ['optics', 'readOpticPath', ['value', 'path', 'label']],
    ['optics', 'writeOpticPath', ['value', 'path', 'next', 'label']]
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

test('documents keyed lookup, transforms, and cache cleanup', () => {
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
      const guide = findApiGuide('store-keyed', 'optics', symbolName, locale)
      assert.ok(guide, `store-keyed:optics#${symbolName} has no ${locale} helper guide`)
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

test('documents native error identity and traceability', () => {
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

test('explains discriminators without fake configuration', () => {
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

test('documents classes and ownership', () => {
  /** API audit 87ed84be removed lowercase observableObject/Array/Map/Set factories. */
  const targets = ['ObservableObject', 'ObservableArray', 'ObservableMap', 'ObservableSet'] as const

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

test('documents constants and native error identity', () => {
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

test('separates mutation admission and snapshot guarantees', () => {
  /** API audit 7f681bd4 removed tolerantClone; callers choose an explicit clone policy. */
  const targets = [
    ['index', 'createMutationPolicy', ['mode']],
    ['index', 'MutationPolicy', ['mode']],
    ['tolerant-clone', 'immutableSnapshotClone', ['value']],
    ['tolerant-clone', 'opaqueReferenceClone', ['value']],
    ['tolerant-clone', 'diagnosticClone', ['value']],
    ['tolerant-clone', 'ClonePolicy', []]
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

test('documents binding, plugins, DevTools, and every Host control', () => {
  /** API audit 7f681bd4 removed middlewarePlugin; install native plugins through the Host. */
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
    ['loggerMiddleware', ['sink']],
    ['createReduxDevToolsAdapter', ['connection']]
  ] as const

  for (const [symbolName, expectedOptions] of targets)
    for (const locale of ['en', 'zh'] as const) {
      const guide = findApiGuide('store-middleware', 'index', symbolName, locale)
      if (symbolName === 'StoreMiddlewareHost') {
        assert.equal(guide, undefined, 'Internal Host classes must not regain a public API guide')
        continue
      }
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

test('documents event domains and cleanup traceability', () => {
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

test('documents lifecycle, codec routing, and every core option', () => {
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
        'options.debounceMs',
        'options.maxWaitMs',
        'options.scheduler'
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

test('documents envelopes, states, and traceable errors', () => {
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

test('separates flat, collection, keyed, and family ownership', () => {
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
        'options.debounceMs',
        'options.maxWaitMs',
        'options.scheduler'
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
        'options.debounceMs',
        'options.maxWaitMs',
        'options.scheduler'
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
        'options.maxWaitMs',
        'options.scheduler',
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

test('separates selectors, nodes, atoms, resources, and Provider definitions', () => {
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

test('documents Registry ownership, injection, and every Provider control', () => {
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

test('documents feature admission, readiness, and traceability', () => {
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

test('documents boundary admission and capability composition', () => {
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

test('documents keys, operation context, and transactions', () => {
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

test('documents wire identity, policy, and traceability', () => {
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

test('documents protocol constants, guards, and text transport', () => {
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

test('documents backpressure, collection, and lifecycle', () => {
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

test('documents JSON configuration and native error identity', () => {
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

test('documents durability, capability, and every constructor option', () => {
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

test('documents selection, validation, and migration contracts', () => {
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

test('documents repository composition and every definition option', () => {
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

test('documents authority, topology, installation, and lifecycle options', () => {
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

test('documents public namespace and errors while keeping Host helpers private', () => {
  /** Commit 8e6e59ed removed these Host implementation helpers from public exports. */
  const privateHostEntries = [
    'pluginNameFromBackendId',
    'reactiveAdapterNameFromBackendId',
    'STORAGE_LIVE_QUERY_SERVICE_NAME'
  ] as const

  for (const symbolName of privateHostEntries)
    assert.equal(
      generatedApis.some(
        (api) =>
          api.library === 'storage-web' &&
          [...api.symbols, ...api.aliases].some((symbol) => symbol.name === symbolName)
      ),
      false,
      `storage-web exposes internal Host entry ${symbolName}`
    )

  /** Public root entries retain their complete bilingual guide requirements. */
  const targets = [
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

test('documents non-reactive factories and custom reactive adapters', () => {
  /**
   * Commit c8d24f68 made custom reactive features store-owned; the definition no longer takes
   * backendKind.
   */
  const targets = [
    ['plugins-memory', 'memoryBackendPlugin', ['id']],
    ['plugins-local-storage', 'localStorageBackendPlugin', ['storage']],
    ['plugins-session-storage', 'sessionStorageBackendPlugin', ['storage']],
    [
      'plugins-cookies',
      'cookieBackendPlugin',
      ['namespace', 'namespaceCodec', 'scope', 'document']
    ],
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
      ['mode', 'pollIntervalMs', 'visibility', 'subscribe']
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

test('documents honest visibility and every factory option', () => {
  const targets = [
    ['plugins-reactive-memory', 'memoryReactive', ['id']],
    ['plugins-reactive-local-storage', 'localStorageReactive', ['storage']],
    ['plugins-reactive-session-storage', 'sessionStorageReactive', ['storage']],
    [
      'plugins-reactive-cookies',
      'cookiesReactive',
      ['namespace', 'namespaceCodec', 'scope', 'document']
    ],
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

test('documents the primary graph path and every public option', () => {
  const targets = [
    ['index', 'IReactiveSignal', ['debugName']],
    ['index', 'IReactiveComputed', ['equals', 'keepAlive', 'debugName']],
    ['index', 'IReactiveEffect', ['debugName']],
    [
      'index',
      'createRuntime',
      ['adapter', 'onError', 'onTrace', 'maxFlushPasses', 'scheduleIdle', 'schedulerStrategy']
    ],
    [
      'index',
      'IRuntime',
      ['adapter', 'onError', 'onTrace', 'maxFlushPasses', 'scheduleIdle', 'schedulerStrategy']
    ],
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
