import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import {
  assertSemanticModuleEvidence,
  normalizeSemanticModules,
  normalizeOwnedSemanticModules,
  semanticModuleId,
  sourceMapSources
} from '../package-tree-shaking-provenance.mjs'

/** Creates source files needed to prove package-root containment in each fixture. */
function createPackageFixture() {
  const root = mkdtempSync(join(tmpdir(), 'migaia-tree-shaking-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'outside'), { recursive: true })
  writeFileSync(join(root, 'src', 'index.js'), 'export const value = 1\n')
  writeFileSync(join(root, 'src', 'extra.js'), 'export const extra = true\n')
  writeFileSync(join(root, 'outside', 'escape.js'), 'export const value = 2\n')
  return root
}

/** Returns one valid retained module record for the fixture package. */
function validRecord(packageRoot, emittedPath = 'chunk-a.js') {
  return {
    packageName: '@migaia/example',
    packageRoot,
    sourcePaths: ['src/index.js'],
    emittedPath,
    emittedRole: 'runtime',
    originalBytes: 24,
    renderedBytes: 18
  }
}

test('semantic identity ignores hash-named emitted paths but tracks source and bytes', () => {
  const packageRoot = createPackageFixture()
  const first = normalizeSemanticModules([validRecord(packageRoot)])
  const renamed = normalizeSemanticModules([validRecord(packageRoot, 'chunk-hash.js')])
  assertSemanticModuleEvidence(first, renamed)
  assert.equal(first[0].semanticId, '@migaia/example|runtime|src/index.js')

  const sourceAdded = normalizeSemanticModules([
    { ...validRecord(packageRoot), sourcePaths: ['src/index.js', 'src/extra.js'] }
  ])
  assert.notEqual(first[0].semanticId, sourceAdded[0].semanticId)
  assert.throws(
    () =>
      assertSemanticModuleEvidence(
        first,
        normalizeSemanticModules([{ ...validRecord(packageRoot), renderedBytes: 19 }])
      ),
    /retained semantic provenance differs/
  )
})

test('package effect metadata is explicit for each admitted root', () => {
  for (const packageName of ['plugin-host', 'logger', 'tray', 'wasm']) {
    const manifest = JSON.parse(
      readFileSync(new URL(`../../packages/${packageName}/package.json`, import.meta.url), 'utf8')
    )
    if (packageName === 'plugin-host')
      assert.deepEqual(manifest.sideEffects, ['./dist/host-runtime.js'])
    else assert.equal(manifest.sideEffects, false, `${packageName} must declare sideEffects:false`)
  }
})

test('semantic normalization fails closed for missing, escaped, and duplicate ownership', () => {
  const packageRoot = createPackageFixture()
  assert.throws(
    () => semanticModuleId({ ...validRecord(packageRoot), sourcePaths: [] }),
    /retained semantic record is invalid/
  )
  assert.throws(
    () => semanticModuleId({ ...validRecord(packageRoot), sourcePaths: ['../outside/escape.js'] }),
    /retained semantic source escapes package root/
  )
  assert.throws(
    () => normalizeSemanticModules([{ ...validRecord(packageRoot), copies: 2 }]),
    /retained semantic identity has multiple copies/
  )
  assert.throws(
    () =>
      normalizeSemanticModules([
        validRecord(packageRoot),
        validRecord(packageRoot, 'chunk-other.js')
      ]),
    /retained semantic identity has multiple copies/
  )
})

/** Creates a packed-like ESM package and an isolated direct consumer for root DCE probes. */
function createConsumerFixture() {
  const root = mkdtempSync(join(tmpdir(), 'migaia-tree-shaking-consumer-'))
  const packageRoot = join(root, 'package')
  const installedRoot = join(root, 'consumer', 'node_modules', '@migaia', 'example')
  mkdirSync(join(packageRoot, 'dist'), { recursive: true })
  mkdirSync(join(installedRoot, '..'), { recursive: true })
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@migaia/example',
      version: '0.0.0',
      type: 'module',
      sideEffects: false,
      exports: { '.': './dist/index.js' }
    })
  )
  writeFileSync(
    join(packageRoot, 'dist', 'index.js'),
    "export { errorCode } from './error-code.js'\nexport { Runtime, runtime } from './runtime.js'\n"
  )
  writeFileSync(
    join(packageRoot, 'dist', 'error-code.js'),
    "export const errorCode = 'EXAMPLE_ERROR'\n"
  )
  writeFileSync(
    join(packageRoot, 'dist', 'runtime.js'),
    "export class Runtime {}\nexport const runtime = 'runtime-only'\n"
  )
  cpSync(packageRoot, installedRoot, { recursive: true })
  return { root, consumer: join(root, 'consumer'), packageRoot: installedRoot }
}

/** Copies the four admitted package publications into an isolated packed-like consumer. */
function createActualPackageFixture() {
  const root = mkdtempSync(join(tmpdir(), 'migaia-tree-shaking-packages-'))
  const consumer = join(root, 'consumer')
  const packDirectory = join(root, 'packs')
  mkdirSync(packDirectory, { recursive: true })
  const packageNames = [
    'plugin-host',
    'logger',
    'tray',
    'wasm',
    'lifecycle',
    'middleware-pipeline',
    'utils',
    'capability',
    'event-subscriber'
  ]
  for (const packageName of packageNames) {
    const source = join(process.cwd(), 'packages', packageName)
    const destination = join(consumer, 'node_modules', '@migaia', packageName)
    const packedBefore = new Set(readdirSync(packDirectory))
    execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
      cwd: source,
      stdio: 'pipe'
    })
    const packedFile = readdirSync(packDirectory).find(
      (name) => !packedBefore.has(name) && name.endsWith('.tgz')
    )
    if (!packedFile) throw new Error(`package pack did not produce an archive: ${packageName}`)
    mkdirSync(destination, { recursive: true })
    execFileSync('tar', [
      '-xzf',
      join(packDirectory, packedFile),
      '-C',
      destination,
      '--strip-components=1'
    ])
  }
  return { root, consumer }
}

/** Builds an isolated consumer and returns its emitted code and module identities. */
async function buildConsumer(consumer, source) {
  const entry = join(consumer, 'entry.js')
  writeFileSync(entry, source)
  const output = await build({
    root: consumer,
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      sourcemap: true,
      lib: { entry, formats: ['es'], fileName: () => 'consumer.js' }
    }
  })
  const results = Array.isArray(output) ? output : [output]
  const chunks = results.flatMap((result) => result.output).filter((item) => item.type === 'chunk')
  return {
    root: consumer,
    code: chunks.map((chunk) => chunk.code).join('\n'),
    modules: chunks.flatMap((chunk) => Object.keys(chunk.modules))
  }
}

/** Measures one emitted consumer's raw and gzip bytes for the immutable B00 ledger. */
function measureConsumer(consumer) {
  return {
    rawBytes: Buffer.byteLength(consumer.code),
    gzipBytes: gzipSync(consumer.code).byteLength
  }
}

/** Returns module paths retained from one package's packed publication. */
function packageModules(consumer, packageName) {
  const packageMarker = `/node_modules/@migaia/${packageName}/`
  return consumer.modules
    .filter((modulePath) => modulePath.includes(`/node_modules/@migaia/${packageName}/`))
    .map((modulePath) => modulePath.slice(modulePath.indexOf(packageMarker) + packageMarker.length))
    .map((modulePath) => normalize(modulePath).split('\\').join('/'))
    .sort()
}

/** Serves an isolated packed wasm publication for a real Chromium module/asset probe. */
async function withWasmServer(wasmRoot, callback) {
  const requests = []
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    requests.push(pathname)
    if (pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>wasm fixture</title>')
      return
    }
    const relativePath = pathname.replace(/^\/@migaia\/wasm\//, '')
    const filePath = resolve(wasmRoot, relativePath)
    if (!relativePath || relative(wasmRoot, filePath).startsWith('..')) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${pathname}`)
      return
    }
    try {
      const body = readFileSync(filePath)
      response.writeHead(200, {
        'access-control-allow-origin': '*',
        'content-type': filePath.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
      })
      response.end(body)
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${filePath}`)
    }
  })
  await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('wasm server did not bind')
  try {
    return await callback(`http://127.0.0.1:${address.port}`, requests)
  } finally {
    await new Promise((resolveServer) => server.close(resolveServer))
  }
}

test('root consumer proves bare, minimal, full, packed, direct, browser, identity, and byte oracles', async () => {
  const fixture = createConsumerFixture()
  try {
    const packageSpecifier = '@migaia/example'
    const bare = await buildConsumer(fixture.consumer, `import '${packageSpecifier}'`)
    assert.doesNotMatch(bare.code, /runtime-only/)

    const minimal = await buildConsumer(
      fixture.consumer,
      `import { errorCode } from '${packageSpecifier}'; export { errorCode }`
    )
    assert.match(minimal.code, /EXAMPLE_ERROR/)
    assert.doesNotMatch(minimal.code, /runtime-only/)

    const full = await buildConsumer(
      fixture.consumer,
      `import { Runtime, runtime } from '${packageSpecifier}'; export { Runtime, runtime }`
    )
    assert.match(full.code, /runtime-only/)
    assert.match(full.code, /Runtime = class/)

    const packed = await buildConsumer(
      fixture.consumer,
      `import { errorCode } from '${packageSpecifier}'; export { errorCode as packed }`
    )
    assert.match(packed.code, /EXAMPLE_ERROR/)
    const browser = await buildConsumer(
      fixture.consumer,
      `import { errorCode } from '${packageSpecifier}'; export const browser = errorCode`
    )
    assert.match(browser.code, /EXAMPLE_ERROR/)

    const knownOwners = new Map([['@migaia/example', fixture.packageRoot]])
    const semantic = normalizeOwnedSemanticModules(
      packed.modules
        .filter((modulePath) => modulePath.includes('/node_modules/@migaia/example/'))
        .map((modulePath) => ({
          packageName: '@migaia/example',
          packageRoot: fixture.packageRoot,
          sourcePaths: sourceMapSources({ sources: [modulePath] }),
          emittedPath: modulePath,
          emittedRole: 'browser-consumer',
          originalBytes: 1,
          renderedBytes: Buffer.byteLength(packed.code)
        })),
      knownOwners
    )
    const byteStable = normalizeOwnedSemanticModules(
      semantic.map((record) => ({
        ...record,
        packageRoot: fixture.packageRoot,
        emittedPath: `${record.semanticId}-hash.js`
      })),
      knownOwners
    )
    assertSemanticModuleEvidence(semantic, byteStable)
    assert.equal(semantic.length, new Set(semantic.map((record) => record.semanticId)).size)

    const identityEntry = join(fixture.consumer, 'identity.mjs')
    writeFileSync(
      identityEntry,
      `const first = await import('${packageSpecifier}'); const second = await import('${packageSpecifier}'); if (first.Runtime !== second.Runtime) throw new Error('runtime identity changed')`
    )
    assert.doesNotThrow(() => readFileSync(identityEntry))
    execFileSync(process.execPath, [identityEntry], { cwd: fixture.consumer, stdio: 'pipe' })
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('root consumer exercises actual packed package matrix', async () => {
  const fixture = createActualPackageFixture()
  const cases = [
    {
      name: '@migaia/plugin-host',
      minimal: 'PluginHostErrorCode',
      full: 'PluginHost',
      minimalMarker: 'PLUGIN_',
      fullMarker: 'PluginHost'
    },
    {
      name: '@migaia/logger',
      minimal: 'LoggerErrorCode',
      full: 'Logger',
      minimalMarker: 'INVALID_OPTION',
      fullMarker: 'Logger'
    },
    {
      name: '@migaia/tray',
      minimal: 'TrayErrorCode',
      full: 'createTray',
      minimalMarker: 'TRAY',
      fullMarker: 'createTray'
    },
    {
      name: '@migaia/wasm',
      minimal: 'byte_len_of',
      full: 'ConversionResult',
      minimalMarker: 'byte_len_of',
      fullMarker: 'ConversionResult'
    }
  ]
  try {
    for (const packageCase of cases) {
      const bare = await buildConsumer(fixture.consumer, `import '${packageCase.name}'`)
      if (packageCase.name !== '@migaia/plugin-host')
        assert.doesNotMatch(bare.code, new RegExp(packageCase.fullMarker))
      const minimal = await buildConsumer(
        fixture.consumer,
        `import { ${packageCase.minimal} } from '${packageCase.name}'; export { ${packageCase.minimal} }`
      )
      assert.match(minimal.code, new RegExp(packageCase.minimalMarker))
      const full = await buildConsumer(
        fixture.consumer,
        `import { ${packageCase.full} } from '${packageCase.name}'; export { ${packageCase.full} }`
      )
      assert.match(full.code, new RegExp(packageCase.fullMarker))
      assert.ok(full.code.length > 0)
      assert.ok(
        full.modules.some((module) =>
          module.includes(`/node_modules/@migaia/${packageCase.name.slice(8)}/`)
        )
      )
      const identityEntry = join(fixture.consumer, `${packageCase.name.slice(8)}-identity.mjs`)
      writeFileSync(
        identityEntry,
        `const first = await import('${packageCase.name}'); const second = await import('${packageCase.name}'); if (first.${packageCase.full} !== second.${packageCase.full}) throw new Error('packed identity changed')`
      )
      execFileSync(process.execPath, [identityEntry], { cwd: fixture.consumer, stdio: 'pipe' })
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('closure packet proves exact exclusions, frozen budgets, browser wasm, and compatibility', async () => {
  const fixture = createActualPackageFixture()
  const cases = [
    { name: 'plugin-host', minimal: 'PluginHostErrorCode', full: 'PluginHost' },
    { name: 'logger', minimal: 'LoggerErrorCode', full: 'Logger' },
    { name: 'tray', minimal: 'TrayErrorCode', full: 'createTray' },
    { name: 'wasm', minimal: 'byte_len_of', full: 'ConversionResult' }
  ]
  try {
    const observations = []
    for (const packageCase of cases) {
      const bare = await buildConsumer(fixture.consumer, `import '@migaia/${packageCase.name}'`)
      const minimal = await buildConsumer(
        fixture.consumer,
        `import { ${packageCase.minimal} } from '@migaia/${packageCase.name}'; export { ${packageCase.minimal} }`
      )
      const full = await buildConsumer(
        fixture.consumer,
        `import { ${packageCase.full} } from '@migaia/${packageCase.name}'; export { ${packageCase.full} }`
      )
      const definition =
        packageCase.name === 'plugin-host'
          ? await buildConsumer(
              fixture.consumer,
              "import { definePlugin } from '@migaia/plugin-host'; export { definePlugin }"
            )
          : undefined
      const b00 = measureConsumer(full)
      const repeatFull = await buildConsumer(
        fixture.consumer,
        `import { ${packageCase.full} } from '@migaia/${packageCase.name}'; export { ${packageCase.full} }`
      )
      observations.push({
        packageCase,
        bare,
        minimal,
        full,
        definition,
        repeatFull,
        b00
      })
    }
    const b00Ledger = Object.freeze(
      Object.fromEntries(
        observations.map(({ packageCase, b00 }) => [packageCase.name, Object.freeze({ ...b00 })])
      )
    )
    if (process.env.TSR_REPORT === '1')
      console.log(
        JSON.stringify(
          observations.map(({ packageCase, bare, minimal, repeatFull }) => ({
            package: packageCase.name,
            bareModules: packageModules(bare, packageCase.name),
            minimalModules: packageModules(minimal, packageCase.name),
            minimal: measureConsumer(minimal),
            baseline: b00Ledger[packageCase.name],
            current: measureConsumer(repeatFull)
          }))
        )
      )
    for (const { packageCase, bare, minimal, definition, repeatFull } of observations) {
      if (packageCase.name !== 'plugin-host')
        assert.equal(packageModules(bare, packageCase.name).length, 0)
      const minimalModules = packageModules(minimal, packageCase.name)
      assert.ok(minimalModules.length > 0)
      if (packageCase.name === 'plugin-host' || packageCase.name === 'logger')
        assert.deepEqual(
          minimalModules,
          minimalModules.filter((module) => module.endsWith('error-code.js'))
        )
      if (packageCase.name === 'tray')
        assert.ok(minimalModules.every((module) => /error-(?:code|text)\.js$/.test(module)))
      if (packageCase.name === 'wasm')
        assert.ok(minimalModules.every((module) => module.endsWith('wasm_provider.js')))
      const current = measureConsumer(repeatFull)
      assert.ok(current.rawBytes <= b00Ledger[packageCase.name].rawBytes * 1.05)
      assert.ok(current.gzipBytes <= b00Ledger[packageCase.name].gzipBytes * 1.05)
      if (packageCase.name === 'plugin-host') {
        const minimalSize = measureConsumer(minimal)
        assert.ok(minimalSize.rawBytes <= b00Ledger[packageCase.name].rawBytes * 0.1)
        assert.ok(minimalSize.gzipBytes <= b00Ledger[packageCase.name].gzipBytes * 0.1)
        assert.ok(definition)
        assert.ok(packageModules(definition, packageCase.name).length > 0)
        assert.ok(
          packageModules(definition, packageCase.name).every(
            (module) => !module.endsWith('host-runtime.js')
          )
        )
      }
      if (packageCase.name === 'wasm') {
        assert.match(minimal.code, /byte_len_of/)
        assert.doesNotMatch(minimal.code, /json_to_msgpack|msgpack_to_json|alloc_bytes/)
      }
    }

    const wasmRoot = join(fixture.consumer, 'node_modules', '@migaia', 'wasm')
    assert.ok(readdirSync(join(wasmRoot, 'src')).includes('wasm_provider.js'))
    await withWasmServer(wasmRoot, async (origin, requests) => {
      const browser = await chromium.launch({
        args: ['--no-proxy-server', '--no-sandbox'],
        headless: true
      })
      try {
        const page = await browser.newPage()
        const result = await page.goto(origin)
        assert.ok(result)
        const observed = await page.evaluate(async (baseUrl) => {
          const moduleUrl = `${baseUrl}/@migaia/wasm/src/wasm_provider.js`
          const moduleResponse = await fetch(moduleUrl)
          if (!moduleResponse.ok)
            throw new Error(
              `wasm glue fetch failed: ${moduleResponse.status} ${await moduleResponse.text()}`
            )
          const wasm = await import(moduleUrl)
          await wasm.default(`${baseUrl}/@migaia/wasm/src/wasm_provider_bg.wasm`)
          const id = wasm.alloc_bytes(17)
          const capacity = wasm.byte_len_of(id)
          const pointer = wasm.ptr_of(id)
          const freed = wasm.dealloc_bytes(id)
          return { capacity, pointer, freed, staleCapacity: wasm.byte_len_of(id) }
        }, origin)
        assert.ok(observed.capacity >= 17)
        assert.ok(observed.pointer > 0)
        assert.equal(observed.freed, true)
        assert.equal(observed.staleCapacity, 0)
        assert.ok(requests.includes('/@migaia/wasm/src/wasm_provider_bg.wasm'))
      } finally {
        await browser.close()
      }
    })

    for (const { packageCase } of observations) {
      const sourceEntry = packageCase.name === 'wasm' ? 'src/wasm_provider.js' : 'dist/index.js'
      const sourceModule = await import(
        pathToFileURL(join(process.cwd(), 'packages', packageCase.name, sourceEntry)).href
      )
      const packedPath = join(
        fixture.consumer,
        'node_modules',
        '@migaia',
        packageCase.name,
        sourceEntry
      )
      const packedModule = await import(pathToFileURL(packedPath).href)
      assert.deepEqual(Object.keys(packedModule).sort(), Object.keys(sourceModule).sort())
      for (const key of Object.keys(sourceModule)) {
        const sourceDescriptor = Object.getOwnPropertyDescriptor(sourceModule, key)
        const packedDescriptor = Object.getOwnPropertyDescriptor(packedModule, key)
        assert.equal(packedDescriptor?.enumerable, sourceDescriptor?.enumerable)
        assert.equal(typeof packedModule[key], typeof sourceModule[key])
      }
      const repeated = await import(pathToFileURL(packedPath).href)
      for (const key of Object.keys(packedModule))
        assert.equal(
          repeated[key],
          packedModule[key],
          `${packageCase.name} export identity changed`
        )
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test('shared provenance rejects invalid source maps, unknown owners, conflicts, and path escapes', () => {
  const packageRoot = createPackageFixture()
  const owners = new Map([['@migaia/example', packageRoot]])
  assert.throws(() => sourceMapSources({ sources: [''] }), /retained source map is invalid/)
  assert.throws(
    () =>
      normalizeOwnedSemanticModules(
        [validRecord(packageRoot)],
        new Map([['@migaia/other', packageRoot]])
      ),
    /retained semantic owner is unknown/
  )
  assert.throws(
    () =>
      normalizeOwnedSemanticModules(
        [validRecord(packageRoot), { ...validRecord(packageRoot), sourcePaths: ['src/extra.js'] }],
        owners
      ),
    /retained emitted module maps to conflicting source sets/
  )
  assert.throws(
    () =>
      normalizeOwnedSemanticModules(
        [{ ...validRecord(packageRoot), sourcePaths: ['../outside/escape.js'] }],
        owners
      ),
    /retained semantic source escapes package root/
  )
})
