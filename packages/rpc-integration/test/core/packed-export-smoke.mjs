/**
 * Exercise actual RPC archives through public entries; native acquisition uses the installed
 * coroutine owner.
 */
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
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { orderStringKeys } from '@migaia/utils/string'

const integrationDirectory = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const repositoryRoot = resolve(integrationDirectory, '../..')
/** All final lockstep artifacts are installed without an umbrella package. */
const rpcOwners = [
  'rpc-contract',
  'rpc-host',
  'rpc-plugin-process',
  'rpc-plugin-thread',
  'rpc-plugin-browser',
  'rpc-plugin-coroutines',
  'rpc-plugin-pool',
  'rpc-plugin-devtools'
]
/** Direct consumers are real archives, with Contract supplied by the same application peer. */
const contractConsumers = ['tray', 'store-worker']
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-rpc-packed-'))
const extractDirectory = join(smokeDirectory, 'extract')
const consumerDirectory = join(smokeDirectory, 'consumer')
const packageDependencies = [
  'capability',
  'event-subscriber',
  'lifecycle',
  'middleware-pipeline',
  'plugin-host',
  'serialize',
  'supervision',
  'utils'
]
/** Resolve every declared public path from the final real packed manifests. */
const publicSubpaths = rpcOwners.flatMap((owner) => {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, 'packages', owner, 'package.json'), 'utf8')
  )
  return Object.keys(manifest.exports).map((subpath) => `${manifest.name}${subpath.slice(1)}`)
})
/** Retired Core aliases still fail as unexported subpaths of an actually installed owner. */
const obsoleteSubpaths = [
  './browser',
  './memory',
  './message-port',
  './web-worker',
  './wire',
  './middleware/protocol',
  './middleware/chunk',
  './composed',
  './client',
  './provider',
  './full',
  './features/outbound',
  './features/one-way',
  './features/provider',
  './features/discovery',
  './features/control',
  './adapters/message-port',
  './adapters/web-worker',
  './internal/chunk-attachment',
  './plugin',
  './probe',
  './features/auth',
  './features/chunk',
  './features/typegen'
]
/**
 * Packs rpc, resolves it from a clean consumer directory, and checks both every declared public
 * subpath and the removed legacy adapter paths.
 */
async function main() {
  try {
    mkdirSync(extractDirectory, { recursive: true })
    mkdirSync(consumerDirectory, { recursive: true })
    const dependencyDirectory = join(extractDirectory, 'node_modules', '@migaia')
    const consumerDependencyDirectory = join(consumerDirectory, 'node_modules', '@migaia')
    mkdirSync(dependencyDirectory, { recursive: true })
    mkdirSync(consumerDependencyDirectory, { recursive: true })
    for (const owner of [...packageDependencies, ...rpcOwners, ...contractConsumers]) {
      installPackedDependency(dependencyDirectory, owner)
      symlinkSync(join(dependencyDirectory, owner), join(consumerDependencyDirectory, owner), 'dir')
    }
    const packedPackages = Object.fromEntries(
      rpcOwners.map((owner) => [owner, join(dependencyDirectory, owner)])
    )
    /** Consumer roots resolve only packages extracted from actual packed artifacts. */
    const packedConsumers = Object.fromEntries(
      contractConsumers.map((owner) => [owner, join(dependencyDirectory, owner)])
    )
    const packedPackage = packedPackages['rpc-host']
    assertPackedContractSurface(packedPackages, packedConsumers)
    console.log('CHECK A46-contract-entry PASS')
    assertPackedOwnerManifests(packedPackages)
    assertPackedContractIdentity({ ...packedPackages, ...packedConsumers })
    console.log('CHECK shared-contract-resolution PASS')
    console.log('CHECK five-packed-artifacts PASS')
    assertIdentityObserverDeclarationsHidden(packedPackage)
    console.log('CHECK identity-observer-hidden PASS')
    assertPackedCoreRuntimeHidden(consumerDirectory)
    console.log('CHECK composed-runtime-hidden PASS')
    assertPackedLegacyEnvelopeRejection(consumerDirectory)
    console.log('CHECK legacy-envelope-rejection PASS')
    await assertPackedSelectiveBrowserImport(
      consumerDirectory,
      packedPackage,
      packedPackages['rpc-contract']
    )
    console.log('CHECK selective-browser PASS')
    const consumerModule = join(consumerDirectory, 'smoke.mjs')
    const typeContract = join(consumerDirectory, 'type-contract.ts')
    const typeConfig = join(consumerDirectory, 'tsconfig.json')
    writeFileSync(
      typeContract,
      readFileSync(
        resolve(integrationDirectory, 'test/core/fixtures/packed/type-contract.ts'),
        'utf8'
      ),
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
        include: ['type-contract.ts', 'carrier-type-contract.ts']
      }),
      'utf8'
    )
    writeFileSync(
      join(consumerDirectory, 'carrier-type-contract.ts'),
      readFileSync(
        resolve(integrationDirectory, 'test/core/fixtures/packed/carrier-type-contract.ts'),
        'utf8'
      )
    )
    execFileSync('bun', ['check', '-p', typeConfig], {
      cwd: consumerDirectory,
      stdio: 'inherit'
    })
    console.log('CHECK type-contract-bun PASS')
    writeFileSync(consumerModule, createSmokeModule(), 'utf8')
    execFileSync(process.execPath, [consumerModule], { cwd: consumerDirectory, stdio: 'inherit' })
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
}

/** Removed private owners must be absent from the actual archive, not hidden by an export alias. */
function assertPackedCoreRuntimeHidden(consumerDirectory) {
  /** The real installed publication is the only filesystem being inspected. */
  const packed = join(consumerDirectory, 'node_modules/@migaia/rpc-host/dist')
  for (const retired of ['core', 'remote', 'runtime-adapter'])
    if (existsSync(join(packed, retired)))
      throw new Error('Packed RPC retained a retired owner directory: ' + retired)
}

/** Rejects three retired WebRPC semantic shapes through the packed rpc-contract normalizer. */
function assertPackedLegacyEnvelopeRejection(
  consumerDirectory,
  kinds = ['request', 'chunk', 'variation', 'jsonrpc']
) {
  const probe = join(consumerDirectory, 'legacy-envelope-probe.mjs')
  writeFileSync(
    probe,
    [
      "import { normalizeRpcFrame } from '@migaia/rpc-contract/protocol'",
      'const legacy = [',
      "  { kind: 'request', taskId: 'old-request', version: '1', data: null },",
      "  { kind: 'chunk', taskId: 'old-chunk', index: 0, total: 1, data: null },",
      "  { kind: 'variation', variation: 'abort', taskId: 'old-abort', senderId: 'a', targetId: 'b', data: null },",
      "  { jsonrpc: '2.0', id: 'old-jsonrpc', method: 'ping', params: null }",
      ']',
      "for (const value of legacy.filter((candidate) => process.argv[2] === (candidate.kind ?? 'jsonrpc'))) {",
      '  try { normalizeRpcFrame(value) } catch (error) {',
      "    if (error?.code === 'INVALID_ENVELOPE') continue",
      '    throw error',
      '  }',
      "  throw new Error('Legacy envelope unexpectedly normalized: ' + value.kind)",
      '}'
    ].join('\n'),
    'utf8'
  )
  for (const kind of kinds)
    execFileSync(process.execPath, [probe, kind], { cwd: consumerDirectory, stdio: 'pipe' })
}

/** Bundles one packed public import and executes its observable result in a fresh Chromium page. */
async function assertPackedSelectiveBrowserImport(
  consumerDirectory,
  packedPackage,
  packedContract
) {
  const browserEntry = join(consumerDirectory, 'selective-browser-entry.mjs')
  const browserBundle = join(consumerDirectory, 'selective-browser-bundle.js')
  const browserMetadata = join(consumerDirectory, 'selective-browser-metafile.json')
  writeFileSync(
    browserEntry,
    [
      "import { isRpcError } from '@migaia/rpc-host/contract'",
      "globalThis.__migaiaSelectiveImport = isRpcError({ code: 'SELECTIVE_BROWSER_PROBE' })"
    ].join('\n'),
    'utf8'
  )
  execFileSync(
    resolveEsbuildBinary(),
    [
      browserEntry,
      '--bundle',
      '--format=iife',
      '--platform=browser',
      '--log-level=warning',
      `--outfile=${browserBundle}`,
      `--metafile=${browserMetadata}`
    ],
    { cwd: consumerDirectory, stdio: 'inherit' }
  )
  const metadata = JSON.parse(readFileSync(browserMetadata, 'utf8'))
  const output = Object.entries(metadata.outputs).find(
    ([path]) => resolve(consumerDirectory, path) === browserBundle
  )?.[1]
  if (!output || typeof output !== 'object' || !('inputs' in output))
    throw new Error('Selective browser bundle has no esbuild output graph')
  const retainedInputs = Object.entries(output.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => resolve(consumerDirectory, path))
  /** The contract forwarding entry must not retain any Host execution in a selective bundle. */
  const hostDist = resolve(packedPackage, 'dist') + '/'
  const errorsDist = resolve(packedContract, 'dist/errors') + '/'
  if (!retainedInputs.some((path) => path.startsWith(errorsDist)))
    throw new Error('Selective browser bundle omitted canonical error behavior')
  if (retainedInputs.some((path) => path.startsWith(hostDist)))
    throw new Error('Selective error import retained Host execution')

  let browser
  let context
  try {
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext()
    const page = await context.newPage()
    await page.addScriptTag({ path: browserBundle })
    const result = await page.evaluate(() => globalThis.__migaiaSelectiveImport)
    if (result !== true) throw new Error('Selective packed browser import did not produce true')
  } finally {
    try {
      await context?.close()
    } finally {
      await browser?.close()
    }
  }
}

/** Resolves the already-installed esbuild binary without consulting a registry or network source. */
function resolveEsbuildBinary() {
  const packageStore = join(repositoryRoot, 'node_modules/.pnpm')
  const esbuildDirectory = readdirSync(packageStore).find((entry) => entry.startsWith('esbuild@'))
  const binary = esbuildDirectory
    ? join(packageStore, esbuildDirectory, 'node_modules/esbuild/bin/esbuild')
    : ''
  if (!binary || !existsSync(binary)) throw new Error('Installed esbuild binary is unavailable')
  return binary
}

/** Retired test observers have neither a shipped implementation nor a public entry. */
function assertIdentityObserverDeclarationsHidden(packedPackage) {
  if (existsSync(join(packedPackage, 'dist/core/internal/test-observer.d.ts')))
    throw new Error('Packed RPC retained a deleted identity-observer declaration')
  /** Only the archive's genuine export map is admitted; no private wildcard can bypass it. */
  const manifest = JSON.parse(readFileSync(join(packedPackage, 'package.json'), 'utf8'))
  if (
    Object.keys(manifest.exports).some(
      (path) => path.includes('test-observer') || path.includes('*')
    )
  )
    throw new Error('Packed RPC exposes a private identity-observer entry')
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
    ...publicSubpaths.map(
      (specifier) =>
        `{ const publicModule = await import('${specifier}'${specifier.startsWith('@migaia/rpc-contract/schema/') ? ", { with: { type: 'json' } }" : ''}); ${specifier.startsWith('@migaia/rpc-contract/schema/') ? "if (Object.keys(publicModule).length !== 1 || !('default' in publicModule)) throw new Error('Native wire-error schema must expose only its default JSON value');" : ''} if ('assertRpcModuleInstance' in publicModule) throw new Error('Private instance helper is publicly exported: ${specifier}'); process.stdout.write('SUBPATH ${specifier} ' + Object.keys(publicModule).length + '\\n'); }`
    ),
    "process.stdout.write('CHECK subpath-imports PASS\\n');"
  ].join('\n')
  const obsoleteImports = obsoleteSubpaths
    .map((subpath) => `await expectNotExported('@migaia/rpc-host${subpath.slice(1)}');`)
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

const obsoleteSpecifiers = new Set(${JSON.stringify(obsoleteSubpaths.map((subpath) => `@migaia/rpc-host${subpath.slice(1)}`))});

async function expectNotExported(specifier) {
  if (!obsoleteSpecifiers.has(specifier))
    throw new Error('Unexpected removed-subpath probe: ' + specifier);
  try {
    await import(specifier);
  } catch (error) {
    if (error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return;
    throw error;
  }
  throw new Error('Obsolete rpc subpath unexpectedly resolved: ' + specifier);
}

${publicImports}
${obsoleteImports}
process.stdout.write('CHECK obsolete-subpaths PASS\\n');
try {
  await import('@migaia/rpc');
  throw new Error('Retired umbrella package unexpectedly resolved');
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

const assert = (await import('node:assert/strict')).default;
try {
  await expectNotExported('@migaia/rpc-host/not-a-legacy-subpath');
  throw new Error('Unrelated import failure was accepted as a legacy subpath');
} catch (error) {
  if (error?.message !== 'Unexpected removed-subpath probe: @migaia/rpc-host/not-a-legacy-subpath')
    throw error;
}

const processExports = await import('@migaia/rpc-plugin-process');
const threadExports = await import('@migaia/rpc-plugin-thread');
for (const name of ['createProcessPeer', 'createProcessPlugin'])
  assert.equal(name in processExports, false, 'retired packed process factory: ' + name);
for (const name of ['createThreadPeer', 'createThreadPlugin'])
  assert.equal(name in threadExports, false, 'retired packed thread factory: ' + name);
assert.equal(typeof processExports.processPlugin, 'function', 'packed process plugin');
assert.equal(typeof threadExports.threadPlugin, 'function', 'packed thread plugin');
for (const name of ['createProcessHost', 'createServeProcessHost', 'createServeProcessPlugin', 'createThreadHost', 'createServeThreadHost', 'createServeThreadPlugin'])
  assert.equal(name in processExports || name in threadExports, false, 'retired factory absent: ' + name);
/** Only the real installed user root can establish the final public factory contract. */
const publicRoot = await import('@migaia/rpc-host');
/** Author SDK inspection is independent of the lower-level private kernel probes below. */
const publicSdk = await import('@migaia/rpc-host/sdk');
assert.equal(typeof publicRoot.createRpcHost, 'function', 'packed Host factory');
for (const name of ['createEndpoint', 'createFullEndpoint', 'createFullOneWayEndpoint', 'createRuntimeApiEndpoint'])
  assert.equal(name in publicRoot, false, 'retired packed Host factory: ' + name);
for (const name of ['createRuntimePeer', 'createManagedRuntimePeer', 'createRuntimePlugin', 'createRemoteHost', 'createRemotePlugin', 'serveRemoteHost', 'serveRemotePlugin', 'captureAdapterTask', 'assembleAdapterPlugin'])
  assert.equal(name in publicSdk, false, 'retired packed SDK factory: ' + name);
/** Cooperative transport construction must resolve from the real new package root. */
const coroutineExports = await import('@migaia/rpc-plugin-coroutines');
/** Existing Utils deferred owns the task's single wait until native cancellation. */
const { deferred } = await import('@migaia/utils/promise');
/** A once listener is released by its owning native task signal before child cleanup begins. */
function waitForTaskAbort(signal) {
  const waiting = deferred();
  if (signal.aborted) waiting.resolve();
  else signal.addEventListener('abort', () => waiting.resolve(), { once: true });
  return waiting.promise;
}
assert.equal(typeof coroutineExports.coroutinePlugin, 'function', 'packed coroutine plugin');
/** The task publishes its actual child Host after the same native message handshake. */
let resolveChild;
/** This receipt observes only the genuine child creation, without a second readiness owner. */
const childReady = new Promise((resolve) => { resolveChild = resolve; });
/** The public Host opens one genuine managed coroutine and owns its original cleanup. */
const packedHost = await publicRoot.createRpcHost({
  plugins: [coroutineExports.coroutinePlugin({
    spawn: async ({ connect, signal }) => {
      /** The opaque task connection is the exact child source issued by the transport owner. */
      const child = await publicRoot.createRpcHost({
        plugins: [coroutineExports.coroutinePlugin({ connectToParent: connect })],
        provide: { echo: (value) => value }
      });
      resolveChild(child);
      try {
        await waitForTaskAbort(signal);
      } finally { await child.close(); }
    }
  })]
});
await childReady;
try {
  assert.equal('request' in packedHost, false);
  assert.equal(await packedHost.coroutine.request('echo', 42), 42);
}
finally { await packedHost.close(); }
process.stdout.write('CHECK host-entry PASS\\n');

`
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

/**
 * A46 compares real packed forwarding identities and the consumer peer boundary.
 *
 * @param {Record<string, string>} packedPackages Extracted RPC package roots.
 * @param {Record<string, string>} packedConsumers Extracted tray and store-worker roots.
 * @returns {void} Throws when an archive retains a duplicate or old root contract path.
 */
function assertPackedContractSurface(packedPackages, packedConsumers) {
  /** One installed Contract version supplies both direct-consumer peer requirements. */
  const contractVersion = JSON.parse(
    readFileSync(join(packedPackages['rpc-contract'], 'package.json'), 'utf8')
  ).version
  for (const [owner, directory] of Object.entries(packedConsumers)) {
    /** Packing rewrites workspace peers to the actual package version. */
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (
      manifest.dependencies?.['@migaia/rpc-contract'] !== undefined ||
      manifest.peerDependencies?.['@migaia/rpc-contract'] !== contractVersion
    )
      throw new Error(`A46 packed consumer must borrow the exact Contract peer: ${owner}`)
  }
  /** The probe executes through Node's actual packed export-map and ESM module cache. */
  const probe = join(consumerDirectory, 'contract-entry-probe.mjs')
  writeFileSync(
    probe,
    `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as root from '@migaia/rpc-host';
import * as forwarding from '@migaia/rpc-host/contract';
import * as canonical from '@migaia/rpc-contract/errors';
import { normalizeRpcPortable } from '@migaia/rpc-contract/portable';
/** Nine runtime exports are a fixed compile-time contract, not a growing sorted collection. */
const expected = {
  RpcLifecycleError: canonical.RpcLifecycleError,
  RpcConstructionError: canonical.RpcConstructionError,
  RpcAbortError: canonical.RpcAbortError,
  isRpcError: canonical.isRpcError,
  isRpcErrorInstance: canonical.isRpcErrorInstance,
  isRpcRemoteError: canonical.isRpcRemoteError,
  isRpcTimeoutError: canonical.isRpcTimeoutError,
  RPC_CORE_ERROR_SOURCE: canonical.RPC_CORE_ERROR_SOURCE,
  normalizeRpcPortable
};
assert.equal(Object.keys(forwarding).length, Object.keys(expected).length);
for (const [name, identity] of Object.entries(expected)) {
  assert.equal(forwarding[name], identity, 'A46 canonical identity: ' + name);
  assert.equal(name in root, false, 'A46 retired root export: ' + name);
}
/** Values constructed through either publication retain the exact native class identity. */
const construction = new forwarding.RpcConstructionError('packed construction', undefined, []);
const abort = new forwarding.RpcAbortError();
assert.ok(construction instanceof canonical.RpcConstructionError);
assert.ok(new canonical.RpcConstructionError('canonical construction', undefined, []) instanceof forwarding.RpcConstructionError);
assert.ok(abort instanceof canonical.RpcAbortError);
assert.ok(new canonical.RpcAbortError() instanceof forwarding.RpcAbortError);
/** Consumer-relative resolution must retain the same canonical forwarding module and classes. */
const consumers = ${JSON.stringify(packedConsumers)};
for (const [owner, directory] of Object.entries(consumers)) {
  const require = createRequire(directory + '/package.json');
  const consumerForwarding = await import(pathToFileURL(require.resolve('@migaia/rpc-host/contract')).href);
  for (const [name, identity] of Object.entries(expected))
    assert.equal(consumerForwarding[name], identity, 'A46 consumer identity: ' + owner + '/' + name);
  assert.ok(construction instanceof consumerForwarding.RpcConstructionError);
  assert.ok(abort instanceof consumerForwarding.RpcAbortError);
}
console.log('CHECK A46-packed-identities PASS');
`,
    'utf8'
  )
  execFileSync(process.execPath, [probe], { cwd: consumerDirectory, stdio: 'inherit' })
}

/** Prove hosts and transports resolve the same application-owned Contract entry. */
function assertPackedContractIdentity(packedPackages) {
  /** Every real packed owner must resolve the same Contract entry from its own installation. */
  const contractEntry = createRequire(join(packedPackages['rpc-contract'], 'package.json')).resolve(
    '@migaia/rpc-contract'
  )
  for (const [owner, directory] of Object.entries(packedPackages)) {
    if (
      createRequire(join(directory, 'package.json')).resolve('@migaia/rpc-contract') !==
      contractEntry
    )
      throw new Error(`Packed owner resolves a duplicate Contract installation: ${owner}`)
  }
}

/** Assert the actual artifacts' names, exact lockstep peers and complete ordinary emitted entries. */
function assertPackedOwnerManifests(packedPackages) {
  const expectedPeers = {
    'rpc-contract': [],
    'rpc-host': ['@migaia/rpc-contract'],
    'rpc-plugin-process': ['@migaia/rpc-contract', '@migaia/rpc-host'],
    'rpc-plugin-thread': ['@migaia/rpc-contract', '@migaia/rpc-host'],
    'rpc-plugin-browser': ['@migaia/rpc-contract', '@migaia/rpc-host'],
    'rpc-plugin-coroutines': ['@migaia/rpc-contract', '@migaia/rpc-host'],
    'rpc-plugin-pool': ['@migaia/rpc-contract', '@migaia/rpc-host'],
    'rpc-plugin-devtools': ['@migaia/rpc-contract', '@migaia/rpc-host']
  }
  for (const [owner, directory] of Object.entries(packedPackages)) {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (
      manifest.name !== `@migaia/${owner}` ||
      manifest.version !==
        JSON.parse(readFileSync(join(repositoryRoot, 'packages/rpc-contract/package.json'), 'utf8'))
          .version ||
      manifest.private !== true
    )
      throw new Error(`Unexpected packed owner identity: ${owner}`)
    const rpcPeers = orderStringKeys(
      Object.keys(manifest.peerDependencies ?? {}).filter((peer) => peer.startsWith('@migaia/rpc-'))
    )
    /** Hosts and transports borrow the application's single exact Contract installation. */
    const rpcDependencies = orderStringKeys(
      Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@migaia/rpc-'))
    )
    if (
      JSON.stringify(rpcPeers) !== JSON.stringify(expectedPeers[owner]) ||
      JSON.stringify(rpcDependencies) !== JSON.stringify([])
    )
      throw new Error(`Packed dependency direction or required peers drifted: ${owner}`)
    for (const [peer, version] of [
      ...Object.entries(manifest.dependencies ?? {}),
      ...Object.entries(manifest.peerDependencies ?? {})
    ])
      if (peer.startsWith('@migaia/rpc-') && version !== manifest.version)
        throw new Error(`Packed RPC dependency is not exact lockstep: ${owner} ${peer}=${version}`)
    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      if (subpath.includes('/internal/') || subpath.includes('spi'))
        throw new Error(`Packed owner exposes a private entry: ${owner}${subpath}`)
      /** The public JSON schema resolves its own JSON type; every code entry has a declaration. */
      const targetFields =
        owner === 'rpc-contract' && subpath.startsWith('./schema/')
          ? ['default']
          : ['types', 'default']
      for (const field of targetFields)
        if (typeof entry[field] !== 'string' || !existsSync(join(directory, entry[field])))
          throw new Error(`Missing packed ${field} target: ${owner}${subpath}`)
    }
  }
}

main()
