import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = resolve(packageDirectory, '../..')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'migaia-web-rpc-two-copy-'))
const dependencies = ['capability', 'event-subscriber', 'lifecycle', 'plugin-host', 'utils']

/** Creates one minimal transport whose counters prove rejected composition did not reach Host. */
function transportSource() {
  return `
export function createTransport() {
  const state = { subscribe: 0, send: 0, close: 0 }
  return {
    state,
    transport: {
      platform: 'Memory',
      ownership: 'borrowed',
      send() { state.send += 1 },
      subscribe() { state.subscribe += 1; return () => {} },
      close() { state.close += 1 }
    }
  }
}
`
}

/** Runs the cross-package public-only authority probe in an isolated consumer directory. */
function probeSource() {
  return `
const a = await import('web-rpc-a')
const b = await import('web-rpc-b')
const aCore = await import('web-rpc-a/core')
const bCore = await import('web-rpc-b/core')
const aProvider = (await import('web-rpc-a/features/provider')).provider()
const bProvider = (await import('web-rpc-b/features/provider')).provider()
const { createTransport } = await import('./transport.mjs')

function config(root, id, transport) {
  return { id, transport, middlewares: [root.connect({ transport })] }
}

const cross = createTransport()
let crossError
try {
  await bCore.createComposedEndpoint(config(b, 'packed-cross-copy', cross.transport), [aProvider])
} catch (error) {
  crossError = error
}
if (!(crossError instanceof Error) ||
    crossError.name !== 'WebRpcError' ||
    crossError.source !== '@migaia/web-rpc' ||
    crossError.code !== 'INVALID_CONFIG' ||
    !(crossError.cause instanceof TypeError) ||
    typeof crossError.cause.message !== 'string')
  throw new Error('copy B did not fail closed on copy A provider authority')
if (cross.state.subscribe !== 0 || cross.state.send !== 0 || cross.state.close !== 0)
  throw new Error('cross-copy rejection mutated transport/Host state')

const aResources = createTransport()
const bResources = createTransport()
const aEndpoint = await aCore.createComposedEndpoint(
  config(a, 'packed-copy-a', aResources.transport),
  [aProvider]
)
const bEndpoint = await bCore.createComposedEndpoint(
  config(b, 'packed-copy-b', bResources.transport),
  [bProvider]
)
if (typeof aEndpoint.provide !== 'function' || typeof bEndpoint.provide !== 'function')
  throw new Error('each physical package copy rejected its own canonical provider')
const aDispose = aEndpoint.dispose()
const bDispose = bEndpoint.dispose()
if (aEndpoint.dispose() !== aDispose || bEndpoint.dispose() !== bDispose)
  throw new Error('physical copy disposal Promise identity changed')
await Promise.all([aDispose, bDispose])
`
}

/** Packs two physical copies, runs the public-only cross-instance probe, and always removes them. */
function main() {
  try {
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
    process.stdout.write('packed two-copy provider authority probe passed\n')
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

main()
