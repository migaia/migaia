import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = resolve(packageDirectory, '../..')
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-web-rpc-packed-'))
const extractDirectory = join(smokeDirectory, 'extract')
const consumerDirectory = join(smokeDirectory, 'consumer')
const packageDependencies = [
  'capability',
  'event-subscriber',
  'lifecycle',
  'middleware-pipeline',
  'plugin-host',
  'utils'
]
const publicSubpaths = [
  './core',
  './client',
  './provider',
  './full',
  './features/outbound',
  './features/provider',
  './features/discovery',
  './features/control',
  './features/chunk',
  './protocol-constants',
  './adapters/window',
  './adapters/message-port',
  './adapters/web-worker',
  './adapters/broadcast-channel',
  './adapters/memory',
  './adapters/shared-worker',
  './adapters/service-worker',
  './adapters/rtc-data-channel',
  './adapters/web-transport'
]
const obsoleteSubpaths = ['./memory', './message-port', './web-worker']

/**
 * Packs web-rpc, resolves it from a clean consumer directory, and checks both every declared public
 * subpath and the removed legacy adapter paths.
 */
function main() {
  try {
    mkdirSync(extractDirectory, { recursive: true })
    execFileSync('tar', ['-xzf', pack(), '-C', extractDirectory])
    const packedPackage = join(extractDirectory, 'package')
    assertIdentityObserverDeclarationsHidden(packedPackage)
    const dependencyDirectory = join(extractDirectory, 'node_modules', '@migaia')
    const consumerDependencyDirectory = join(consumerDirectory, 'node_modules', '@migaia')
    mkdirSync(dependencyDirectory, { recursive: true })
    mkdirSync(consumerDependencyDirectory, { recursive: true })
    symlinkSync(packedPackage, join(consumerDependencyDirectory, 'web-rpc'), 'dir')
    for (const dependency of packageDependencies) {
      installPackedDependency(dependencyDirectory, dependency)
      symlinkSync(
        join(dependencyDirectory, dependency),
        join(consumerDependencyDirectory, dependency),
        'dir'
      )
    }
    const consumerModule = join(consumerDirectory, 'smoke.mjs')
    const typeContract = join(consumerDirectory, 'type-contract.ts')
    const typeConfig = join(consumerDirectory, 'tsconfig.json')
    writeFileSync(
      typeContract,
      readFileSync(resolve(packageDirectory, 'test/fixtures/packed/type-contract.ts'), 'utf8'),
      'utf8'
    )
    writeFileSync(
      typeConfig,
      JSON.stringify({
        compilerOptions: {
          module: 'esnext',
          moduleResolution: 'bundler',
          target: 'es2023',
          strict: true,
          skipLibCheck: true,
          noEmit: true
        },
        include: ['type-contract.ts']
      }),
      'utf8'
    )
    execFileSync(resolve(repositoryRoot, 'node_modules/.bin/tsc'), ['-p', typeConfig], {
      cwd: consumerDirectory,
      stdio: 'inherit'
    })
    writeFileSync(consumerModule, createSmokeModule(), 'utf8')
    execFileSync(process.execPath, [consumerModule], { cwd: consumerDirectory, stdio: 'inherit' })
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
}

/** Rejects packed declaration or export-map leakage of package-test identity observers. */
function assertIdentityObserverDeclarationsHidden(packedPackage) {
  const declaration = readFileSync(join(packedPackage, 'dist/internal/test-observer.d.ts'), 'utf8')
  const packageJson = JSON.parse(readFileSync(join(packedPackage, 'package.json'), 'utf8'))
  const forbiddenNames = [
    'registerInboundIdentityReleaseObservation',
    'recordInboundIdentityRelease',
    'readInboundIdentityReleaseObservation'
  ]
  if (forbiddenNames.some((name) => declaration.includes(name)))
    throw new Error('Packed identity observer declaration leaked a callable')
  if (Object.hasOwn(packageJson.exports, './internal/test-observer'))
    throw new Error('Packed identity observer internal subpath is exported')
}

/** Packs each runtime dependency and installs only its extracted tarball in the isolated consumer. */
function installPackedDependency(dependencyDirectory, dependency) {
  const packageDirectory = resolve(repositoryRoot, `packages/${dependency}`)
  const packagePath = packDependency(packageDirectory, dependency)
  const extractionDirectory = join(smokeDirectory, `extract-${dependency}`)
  mkdirSync(extractionDirectory, { recursive: true })
  execFileSync('tar', ['-xzf', packagePath, '-C', extractionDirectory])
  renameSync(join(extractionDirectory, 'package'), join(dependencyDirectory, dependency))
}

/** Creates the consumer module used to force Node's package export-map resolution. */
function createSmokeModule() {
  const publicImports = [
    "await import('@migaia/web-rpc');",
    ...publicSubpaths.map((subpath) => `await import('@migaia/web-rpc${subpath.slice(1)}');`)
  ].join('\n')
  const obsoleteImports = obsoleteSubpaths
    .map((subpath) => `await expectNotExported('@migaia/web-rpc${subpath.slice(1)}');`)
    .join('\n')
  return `
const capabilityTopology = await import('@migaia/capability/graph/topology');
if (typeof capabilityTopology.buildCapabilityTopology !== 'function')
  throw new Error('Packed capability topology export missing');
const packedTopology = capabilityTopology.buildCapabilityTopology(
  [{ id: 'packed-topology', dependencies: [], ordinal: 0 }],
  () => { throw new Error('Unexpected unknown provider'); },
  () => { throw new Error('Unexpected cycle'); },
  () => { throw new Error('Unexpected invalid topology'); }
);
if (packedTopology.ordered[0]?.id !== 'packed-topology')
  throw new Error('Packed capability topology execution failed');

async function expectNotExported(specifier) {
  try {
    await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return;
    throw error;
  }
  throw new Error('Legacy web-rpc subpath unexpectedly resolved: ' + specifier);
}

${publicImports}
${obsoleteImports}

const root = await import('@migaia/web-rpc');
const clientPreset = await import('@migaia/web-rpc/client');
const providerPreset = await import('@migaia/web-rpc/provider');
const memory = await import('@migaia/web-rpc/adapters/memory');
const [clientTransport] = memory.createMemoryTransportPair();
const [providerTransport] = memory.createMemoryTransportPair();
const [fullTransport] = memory.createMemoryTransportPair();
const middleware = root.connect();
try {
  await root.createEndpoint({
    id: 'packed-legacy-shape',
    transport: clientTransport,
    middlewares: [{ name: 'legacy', install() {} }]
  });
  throw new Error('Packed legacy middleware shape was accepted');
} catch (error) {
  if (error?.code !== 'INVALID_CONFIG') throw error;
}
const client = await clientPreset.createClientEndpoint({
  id: 'packed-client',
  transport: clientTransport,
  middlewares: [middleware]
});
const provider = await providerPreset.createProviderEndpoint({
  id: 'packed-provider',
  transport: providerTransport,
  middlewares: [middleware]
});
const full = await root.createEndpoint({
  id: 'packed-full',
  transport: fullTransport,
  middlewares: [middleware]
});
const core = await import('@migaia/web-rpc/core');
const providerFeature = await import('@migaia/web-rpc/features/provider');
const discoveryFeature = await import('@migaia/web-rpc/features/discovery');
const tuple = await core.createComposedEndpoint(
  { id: 'packed-public-tuple', transport: fullTransport, middlewares: [middleware] },
  [providerFeature.provider(), discoveryFeature.discovery()]
);
if (typeof client.send !== 'function' || typeof provider.provide !== 'function')
  throw new Error('Packed selected preset surface missing runtime capability');
if (
  typeof full.send !== 'function' ||
  typeof full.provide !== 'function' ||
  typeof full.connect !== 'object' ||
  typeof full.discovery !== 'object'
)
  throw new Error('Packed full surface does not match its declared capabilities');
if ('connect' in provider || 'discovery' in provider)
  throw new Error('Packed provider surface leaked unselected capabilities');
const tupleKeys = Object.keys(tuple).sort().join(',');
if (tupleKeys !== 'connect,discovery,dispatch,dispatchAll,dispose,hooks,on,provide,send,sendAll')
  throw new Error('Packed public tuple runtime keys do not match its selected capabilities: ' + tupleKeys);
await client.dispose();
await provider.dispose();
await full.dispose();
await tuple.dispose();
`
}

/** Packs the current package and returns the generated tarball path. */
function pack() {
  const packDirectory = join(smokeDirectory, 'pack')
  mkdirSync(packDirectory, { recursive: true })
  execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
    cwd: packageDirectory,
    stdio: 'inherit'
  })
  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
  if (tarballs.length !== 1 || !existsSync(join(packDirectory, tarballs[0]))) {
    throw new Error(`Expected exactly one web-rpc tarball, found ${tarballs.length}`)
  }
  return join(packDirectory, tarballs[0])
}

/** Creates an isolated tarball for one workspace runtime dependency. */
function packDependency(packageDirectory, dependency) {
  const packDirectory = join(smokeDirectory, `pack-${dependency}`)
  mkdirSync(packDirectory, { recursive: true })
  execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
    cwd: packageDirectory,
    stdio: 'inherit'
  })
  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
  if (tarballs.length !== 1 || !existsSync(join(packDirectory, tarballs[0]))) {
    throw new Error(`Expected exactly one ${dependency} tarball, found ${tarballs.length}`)
  }
  return join(packDirectory, tarballs[0])
}

main()
