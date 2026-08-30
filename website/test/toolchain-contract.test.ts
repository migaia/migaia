import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

/** Root directory used for all website-owned contract observations. */
const websiteRoot = fileURLToPath(new URL('../', import.meta.url))
/** Website manifest declaring the direct dependency and script universe. */
const manifest = JSON.parse(readFileSync(join(websiteRoot, 'package.json'), 'utf8'))
/** Lockfile text used to distinguish root dependencies from framework internals. */
const lockfile = readFileSync(join(websiteRoot, 'bun.lock'), 'utf8')

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

test('SITE-T-A23 installed compiler packages are physically website-owned', () => {
  for (const name of ['@react-router/dev', 'react-router', 'vite', 'typescript']) {
    const packageJson = packagePath(name, websiteRoot)
    assert.ok(packageJson)
    assert.ok(realpathSync(packageJson).startsWith(`${websiteRoot}node_modules/`))
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
        symbol.examples.length > 0 &&
        symbol.whenToUse.length > 0 &&
        symbol.notUse.length > 0 &&
        symbol.sections.length === 6 &&
        symbol.sections.map((section) => section.id).join(',') ===
          'introduction,getting-started,when-to-use,quick-implementation,core-usage,advanced-usage'
    )
  )
  for (const field of ['purpose', 'core', 'advanced', 'whenToUse', 'notUse'] as const) {
    assert.equal(
      new Set(symbols.map((symbol) => symbol[field])).size,
      symbols.length,
      `generic ${field} template reused across symbols`
    )
  }
  const normalizeSemantic = (value: string) =>
    value
      .replace(/Source declaration: [^ .]+:\d+\.?/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  for (const field of ['purpose', 'core', 'whenToUse', 'notUse'] as const) {
    const normalized = new Map<string, string>()
    for (const symbol of symbols) {
      const semantic = normalizeSemantic(symbol[field])
      const previous = normalized.get(semantic)
      assert.ok(
        !previous || previous === symbol.identity,
        `unrelated symbols share normalized ${field} semantics: ${previous} and ${symbol.identity}`
      )
      normalized.set(semantic, symbol.identity)
    }
  }
  for (const symbol of symbols) {
    const required = symbol.parameterDetails.filter((parameter) => !parameter.optional)
    if (required.length === 0 || !['function', 'class'].includes(symbol.kind)) continue
    const example = symbol.examples[0] ?? ''
    assert.match(
      example.split('\n').at(-1) ?? '',
      symbol.kind === 'class'
        ? new RegExp(`new ${symbol.name}\\(.+\\)`)
        : new RegExp(`${symbol.name}\\(.+\\)`),
      `required-argument ${symbol.kind} example is zero-argument: ${symbol.name}`
    )
  }
  const overloadExpectations = [
    ['event-subscriber:index', 'createCanonicalChannel'],
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
  for (const api of apiManifest.apis) {
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
