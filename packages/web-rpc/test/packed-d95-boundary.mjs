import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = resolve(packageDirectory, '../..')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'migaia-web-rpc-d95-two-copy-'))
const dependencies = [
  'capability',
  'event-subscriber',
  'lifecycle',
  'plugin-host',
  'rpc-contract',
  'serialize',
  'utils'
]
const T222 = 'T222'
const T230 = 'T230'

/** Creates a borrowed transport whose subscription count proves rejected composition is inert. */
function transportSource() {
  return `
export function createTransport() {
  const state = { subscribe: 0, close: 0 }
  return {
    state,
    transport: {
      platform: 'Memory',
      ownership: 'borrowed',
      send() {},
      subscribe() { state.subscribe += 1; return () => { state.subscribe -= 1 } },
      close() { state.close += 1 }
    }
  }
}
`
}

/** Exercises same-copy acceptance and cross-copy fail-closed module-token admission. */
function probeSource() {
  return `
const aCore = await import('web-rpc-a/core')
const bCore = await import('web-rpc-b/core')
const aRoot = await import('web-rpc-a')
const bRoot = await import('web-rpc-b')
const aOutbound = (await import('web-rpc-a/features/outbound')).outbound
const aDiscovery = (await import('web-rpc-a/features/discovery')).discovery
const aControl = (await import('web-rpc-a/features/control')).control
const bOutbound = (await import('web-rpc-b/features/outbound')).outbound
const bDiscovery = (await import('web-rpc-b/features/discovery')).discovery
const bControl = (await import('web-rpc-b/features/control')).control
const { createTransport } = await import('./transport.mjs')

let privateD95ImportSucceeded = false
try {
  await import('web-rpc-a/internal/outbound-attachment')
  privateD95ImportSucceeded = true
} catch {}
if (privateD95ImportSucceeded)
  throw new Error('[${T230}] packed package exposed a removed D95 deep-import path')

function config(id, transport, connect) {
  return { id, transport, middlewares: [connect({ transport })] }
}

const cross = createTransport()
let crossError
try {
  await bCore.createComposedEndpoint(
    config('r73-cross-copy', cross.transport, bRoot.connect),
    [aOutbound(), aDiscovery(), aControl()]
  )
} catch (error) {
  crossError = error
}
if (!(crossError instanceof Error) ||
    crossError.name !== 'WebRpcError' ||
    crossError.source !== '@migaia/web-rpc' ||
    crossError.code !== 'INVALID_CONFIG')
  throw new Error('copy B accepted copy A feature tokens')
if (cross.state.subscribe !== 0 || cross.state.close !== 0)
  throw new Error('cross-copy feature rejection mutated transport state')

const aResources = createTransport()
const bResources = createTransport()
  const aEndpoint = await aCore.createComposedEndpoint(
    config('r73-copy-a', aResources.transport, aRoot.connect),
  [aOutbound(), aDiscovery(), aControl()]
  )
  const bEndpoint = await bCore.createComposedEndpoint(
    config('r73-copy-b', bResources.transport, bRoot.connect),
  [bOutbound(), bDiscovery(), bControl()]
)
if (!aEndpoint.discovery || !bEndpoint.discovery)
  throw new Error('same-copy discovery/control surface was not installed')
const aDispose = aEndpoint.dispose()
const bDispose = bEndpoint.dispose()
if (aEndpoint.dispose() !== aDispose || bEndpoint.dispose() !== bDispose)
  throw new Error('same-copy D95 disposal Promise identity changed')
await Promise.all([aDispose, bDispose])
`
}

/** Checks the extracted package's source-to-dist ledger without importing private bridge paths. */
function assertPackedLedger(copyRoot) {
  const packageRoot = join(copyRoot, 'package')
  if (readdirSync(packageRoot).includes('src'))
    throw new Error(`${T222} packed package unexpectedly contains source files`)
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const featureNames = ['provider', 'discovery', 'control', 'canonical-chunk']
  for (const featureName of featureNames) {
    const runtime = readFileSync(join(packageRoot, 'dist', 'features', `${featureName}.js`), 'utf8')
    const declaration = readFileSync(
      join(packageRoot, 'dist', 'features', `${featureName}.d.ts`),
      'utf8'
    )
    if (runtime.includes('outboundCompatibility'))
      throw new Error(`packed ${featureName} retained the removed D95 claim`)
    if (declaration.includes('outboundCompatibility'))
      throw new Error(`packed ${featureName} declaration leaked the D95 key`)
  }
  const forbiddenExports = Object.keys(packageJson.exports).filter((key) =>
    key.startsWith('./internal/')
  )
  if (forbiddenExports.length > 0)
    throw new Error(`${T222} packed package exported forbidden internal paths: ${forbiddenExports}`)
  const forbiddenPublicSymbols = [
    'createOutboundCompatibilityPort',
    'isOutboundCompatibilityPort',
    'normalizeOutboundCompatibilityPort',
    'IWebRpcOutboundCompatibilityPort'
  ]
  for (const [exportName, exportTarget] of Object.entries(packageJson.exports)) {
    if (exportName.startsWith('./internal/')) continue
    const targets =
      typeof exportTarget === 'string' ? [exportTarget] : Object.values(exportTarget ?? {})
    for (const target of targets) {
      if (typeof target !== 'string' || !target.startsWith('./dist/')) continue
      const publicText = readFileSync(join(packageRoot, target.slice(2)), 'utf8')
      for (const symbol of forbiddenPublicSymbols)
        if (publicText.includes(symbol))
          throw new Error(`${T222} public entry ${exportName} leaked ${symbol}`)
    }
  }
  process.stdout.write(`[${T222}] packed D95 ledger passed for ${copyRoot}\n`)
}

/** Packs two physical copies, runs the public-only D95 boundary probe, and removes temporary data. */
function main() {
  try {
    process.stdout.write(`[${T222}] packed source-dist-export ledger begin\n`)
    const packDirectory = join(temporaryRoot, 'pack')
    const copyRoot = join(temporaryRoot, 'copies')
    const consumerDirectory = join(temporaryRoot, 'consumer')
    const tarballDirectory = join(packDirectory, 'web-rpc')
    mkdirSync(tarballDirectory, { recursive: true })
    mkdirSync(copyRoot, { recursive: true })
    mkdirSync(join(consumerDirectory, 'node_modules'), { recursive: true })
    execFileSync('pnpm', ['pack', '--pack-destination', tarballDirectory], {
      cwd: packageDirectory,
      stdio: 'inherit'
    })
    const tarballs = readdirSync(tarballDirectory).filter((entry) => entry.endsWith('.tgz'))
    if (tarballs.length !== 1) throw new Error('expected one web-rpc tarball')
    const tarball = join(tarballDirectory, tarballs[0])
    for (const copyName of ['copy-a', 'copy-b']) {
      const destination = join(copyRoot, copyName)
      mkdirSync(destination, { recursive: true })
      execFileSync('tar', ['-xzf', tarball, '-C', destination])
      assertPackedLedger(destination)
    }
    const dependencyRoot = join(temporaryRoot, 'node_modules', '@migaia')
    mkdirSync(dependencyRoot, { recursive: true })
    for (const dependency of dependencies)
      symlinkSync(
        resolve(repositoryRoot, `packages/${dependency}`),
        join(dependencyRoot, dependency)
      )
    const consumerModules = join(consumerDirectory, 'node_modules')
    symlinkSync(join(copyRoot, 'copy-a', 'package'), join(consumerModules, 'web-rpc-a'))
    symlinkSync(join(copyRoot, 'copy-b', 'package'), join(consumerModules, 'web-rpc-b'))
    writeFileSync(join(consumerDirectory, 'transport.mjs'), transportSource(), 'utf8')
    writeFileSync(join(consumerDirectory, 'probe.mjs'), probeSource(), 'utf8')
    execFileSync(process.execPath, [join(consumerDirectory, 'probe.mjs')], {
      cwd: consumerDirectory,
      stdio: 'inherit'
    })
    process.stdout.write('packed two-copy D95 boundary probe passed\n')
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

main()
