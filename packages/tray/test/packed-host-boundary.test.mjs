import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, it } from 'vitest'

/** Tray package root used as the sole source of the packed artifacts. */
const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Repository root used only to reject accidental workspace resolution. */
const repositoryDirectory = resolve(packageDirectory, '../..')
/** Fresh disposable directory for every packed-consumer probe. */
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-tray-packed-'))

const packageSources = [
  ['tray', packageDirectory],
  ['capability', resolve(packageDirectory, '../capability')],
  ['plugin-host', resolve(packageDirectory, '../plugin-host')],
  ['event-subscriber', resolve(packageDirectory, '../event-subscriber')],
  ['lifecycle', resolve(packageDirectory, '../lifecycle')],
  ['middleware-pipeline', resolve(packageDirectory, '../middleware-pipeline')],
  ['utils', resolve(packageDirectory, '../utils')]
]

describe('TPD-T60 packed consumer boundary', () => {
  it('installs explicit local tarballs and resolves runtime plus declarations outside the workspace', () => {
    try {
      const consumerDirectory = installTarballs()
      runConsumerRuntime(consumerDirectory)
      runConsumerTypecheck(consumerDirectory)
    } finally {
      rmSync(smokeDirectory, { recursive: true, force: true })
    }
  }, 120_000)

  it('proves root and single-subpath packed consumers retain no forbidden sibling owners', async () => {
    try {
      const consumerDirectory = installTarballs()
      await runTreeShakingConsumers(consumerDirectory)
    } finally {
      rmSync(smokeDirectory, { recursive: true, force: true })
    }
  }, 120_000)
})

/** Packs each named workspace package to a recoverable temporary tarball. */
function pack(sourceDirectory, label) {
  const destination = join(smokeDirectory, 'tarballs', label)
  mkdirSync(destination, { recursive: true })
  execFileSync('pnpm', ['pack', '--pack-destination', destination], {
    cwd: sourceDirectory,
    stdio: 'inherit'
  })
  const tarballs = readdirSync(destination).filter((entry) => entry.endsWith('.tgz'))
  if (tarballs.length !== 1)
    throw new Error(`Expected one ${label} tarball, found ${tarballs.length}`)
  return join(destination, tarballs[0])
}

/** Installs only explicit local tarball paths with pnpm in an isolated consumer. */
function installTarballs() {
  const consumerDirectory = join(smokeDirectory, 'consumer')
  mkdirSync(consumerDirectory, { recursive: true })
  const producedTarballs = packageSources.map(([label, sourceDirectory]) =>
    pack(sourceDirectory, label)
  )
  const tarballs = rewriteDependencyRanges(producedTarballs)
  writeFileSync(join(consumerDirectory, 'package.json'), '{"type":"module"}\n', 'utf8')
  execFileSync(
    'pnpm',
    [
      'install',
      '--offline',
      '--ignore-workspace',
      '--no-lockfile',
      '--ignore-scripts',
      '--config.link-workspace-packages=false',
      ...tarballs
    ],
    { cwd: consumerDirectory, stdio: 'inherit' }
  )
  writeFileSync(
    join(consumerDirectory, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2022', 'ESNext.Disposable'],
        skipLibCheck: false,
        noEmit: true
      }
    }) + '\n',
    'utf8'
  )
  writeFileSync(
    join(consumerDirectory, 'tsconfig.static.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ES2024',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2024'],
        skipLibCheck: false,
        noEmit: true
      },
      files: ['static-types.ts']
    }) + '\n',
    'utf8'
  )
  writeFileSync(join(consumerDirectory, 'runtime.mjs'), runtimeSource(), 'utf8')
  writeFileSync(join(consumerDirectory, 'types.ts'), typeSource(), 'utf8')
  writeFileSync(join(consumerDirectory, 'static-types.ts'), staticTypeSource(), 'utf8')
  return consumerDirectory
}

/** Re-packs only in temporary storage with file dependencies, keeping pnpm fully offline. */
function rewriteDependencyRanges(producedTarballs) {
  const rewriteDirectory = join(smokeDirectory, 'rewritten')
  const offlineDirectory = join(smokeDirectory, 'offline-tarballs')
  const packages = new Map()
  for (const [index, [label]] of packageSources.entries()) {
    const extractionRoot = join(rewriteDirectory, label)
    const packageRoot = join(extractionRoot, 'package')
    mkdirSync(extractionRoot, { recursive: true })
    execFileSync('tar', ['-xzf', producedTarballs[index], '-C', extractionRoot])
    const manifestPath = join(packageRoot, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    packages.set(manifest.name, { label, packageRoot, manifest, index })
  }
  for (const [name, entry] of packages) {
    const destination = join(offlineDirectory, entry.label)
    mkdirSync(destination, { recursive: true })
    const dependencies = Object.fromEntries(
      Object.keys(entry.manifest.dependencies ?? {}).map((dependencyName) => {
        const dependency = packages.get(dependencyName)
        if (!dependency)
          throw new Error(`Missing local tarball dependency ${name} -> ${dependencyName}`)
        return [
          dependencyName,
          `file:${join(offlineDirectory, dependency.label, basename(producedTarballs[dependency.index]))}`
        ]
      })
    )
    writeFileSync(
      join(entry.packageRoot, 'package.json'),
      JSON.stringify({ ...entry.manifest, dependencies }) + '\n',
      'utf8'
    )
    execFileSync('pnpm', ['pack', '--pack-destination', destination], {
      cwd: entry.packageRoot,
      stdio: 'inherit'
    })
  }
  return packageSources.map(([label]) => {
    const destination = join(offlineDirectory, label)
    const tarballs = readdirSync(destination).filter((entry) => entry.endsWith('.tgz'))
    if (tarballs.length !== 1) throw new Error(`Expected rewritten ${label} tarball`)
    return join(destination, tarballs[0])
  })
}

/** Emits the runtime probe, including both await-using and explicit try/finally disposal. */
function runtimeSource() {
  return `import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginHost } from '@migaia/plugin-host'
import { createView } from '@migaia/plugin-host/composition'
import { createHost } from '@migaia/tray/host'
import { defineLoader, loadIntoHost } from '@migaia/tray/loader'
import { defineAdapter } from '@migaia/tray/adapter'
import { createRuntime } from '@migaia/tray/runtime'

const require = createRequire(import.meta.url)
const consumerDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = ${JSON.stringify(repositoryDirectory)}
const smokeDirectory = ${JSON.stringify(smokeDirectory)}
const resolvedHost = require.resolve('@migaia/tray/host')
if (!resolvedHost.includes('migaia-tray-packed-') || resolvedHost.startsWith(repositoryDirectory)) throw new Error('runtime resolved workspace source')
const trayDirectory = resolve(consumerDirectory, 'node_modules/@migaia/tray')
const manifest = JSON.parse(readFileSync(resolve(trayDirectory, 'package.json'), 'utf8'))
if (JSON.stringify(manifest).includes('workspace:')) throw new Error('workspace dependency leaked into install')
const declarations = resolve(trayDirectory, manifest.exports['./host'].types)
if (!existsSync(declarations) || declarations.startsWith(repositoryDirectory)) throw new Error('declarations resolved from workspace')
for (const dependency of ['capability', 'event-subscriber', 'lifecycle', 'plugin-host']) {
  const resolvedDependency = require.resolve('@migaia/' + dependency)
  if (resolvedDependency.startsWith(repositoryDirectory)) throw new Error('workspace dependency link resolved')
}
const create = () => new PluginHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
const options = { create, plugins: [{ name: 'packed', install: () => ({}) }], mutationAdmissionMs: 100, quiescenceMs: 100, shutdown: { mode: 'bounded' } }
await using managed = await createHost(options)
if (managed.pluginState('packed') !== 'ready') throw new Error('packed plugin was not ready')
const loaded = await loadIntoHost({
  host: managed,
  source: 'packed-source',
  loader: defineLoader({ load: (source) => ({ value: source, release: { force: () => undefined } }) }),
  adapter: defineAdapter({ adapt: (value) => ({ name: 'loaded', install: () => ({ value }) }) }),
  mutation: 'use',
  timeoutMs: false
})
if (!loaded.committed || managed.pluginState('loaded') !== 'ready') throw new Error('packed loader failed')
const runtime = createRuntime(managed)
const runtimeValue = await runtime.run('loaded', { timeoutMs: false }, ({ extensions }) => extensions.value)
if (runtimeValue !== 'packed-source') throw new Error('packed runtime failed')
await runtime.dispose()
if (createView === undefined) throw new Error('composition subpath failed')
let explicit
try {
  explicit = await createHost(options)
  if (explicit.pluginState('packed') !== 'ready') throw new Error('try-finally plugin was not ready')
} finally {
  await explicit?.dispose()
}
`
}

/** Emits a consumer-only declaration probe against the extracted public subpath. */
function typeSource() {
  return `import { PluginHost, type IPlugin } from '@migaia/plugin-host'
import { createView, type IRegistrationToken, type IRegistrationView } from '@migaia/plugin-host/composition'
import { defineLoader, loadIntoHost, type ILoader } from '@migaia/tray/loader'
import { defineAdapter, type IAdapter } from '@migaia/tray/adapter'
import { createRuntime, type IRuntime } from '@migaia/tray/runtime'
import {
  createHost,
  type ICanResolveReadyDefinitions,
  type ICreateHostOptions,
  type IHostBaselinePlugins,
  type IPluginWithSynchronousShared,
  type IResolveReadyTrayPlugins,
  type ITrayHost,
  type ITrayHostCreationError,
  type ITrayHostCreationFailureDetail,
  type ITrayHostDisposalResult,
  type ITrayHostDynamic,
  type ITrayHostEventMap,
  type ITrayHostState,
  type ITrayPluginConstraint,
  type ITrayPluginMutationObservation,
  type ITrayPluginMutationResult,
  type ITrayPluginPhysicalCleanupResult,
  type ITrayPluginRemovalObservation,
  type ITrayPluginRemovalResult,
  type ITrayResolvedHost,
  type IUnsubscribe
} from '@migaia/tray/host'

type ICore = Record<string, never>
class ConsumerHost extends PluginHost<ICore, string> {}
const plugin = { name: 'packed', install: (_core: ConsumerHost) => ({ packedExtension: true }) } satisfies IPlugin<ConsumerHost, { readonly packedExtension: boolean }>
const options = {
  create: () => new ConsumerHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }),
  plugins: [plugin] as const,
  mutationAdmissionMs: 100,
  quiescenceMs: 100,
  shutdown: { mode: 'bounded' as const }
} satisfies ICreateHostOptions<ConsumerHost, readonly [typeof plugin]>
const managed = await createHost<ConsumerHost, readonly [typeof plugin]>(options) as ITrayHost<ConsumerHost, readonly [typeof plugin], readonly [typeof plugin]>
const extension: boolean = managed.extensions.packedExtension
void extension
await using scoped = managed
scoped.extensions.packedExtension

type IPublicHostTypes = [
  ICanResolveReadyDefinitions<readonly [typeof plugin]>,
  ICreateHostOptions<ConsumerHost, readonly [typeof plugin]>,
  IHostBaselinePlugins<ConsumerHost>,
  IPluginWithSynchronousShared<typeof plugin>,
  IResolveReadyTrayPlugins<readonly [typeof plugin]>,
  ITrayHost<ConsumerHost, readonly [typeof plugin]>,
  ITrayHostCreationError,
  ITrayHostCreationFailureDetail,
  ITrayHostDisposalResult,
  ITrayHostDynamic<ConsumerHost>,
  ITrayHostEventMap,
  ITrayHostState,
  ITrayPluginConstraint<ConsumerHost>,
  ITrayPluginMutationObservation<unknown>,
  ITrayPluginMutationResult<unknown, unknown, unknown>,
  ITrayPluginPhysicalCleanupResult,
  ITrayPluginRemovalObservation<unknown>,
  ITrayPluginRemovalResult<unknown, unknown>,
  ITrayResolvedHost<ConsumerHost, readonly [typeof plugin]>,
  IUnsubscribe
]
declare const publicTypes: IPublicHostTypes
void publicTypes
void createView
void (undefined as unknown as IRegistrationToken)
void (undefined as unknown as IRegistrationView)
void (undefined as unknown as ILoader<unknown, unknown>)
void (undefined as unknown as IAdapter<unknown, ConsumerHost, typeof plugin>)
void (undefined as unknown as IRuntime<readonly [typeof plugin]>)
void defineLoader
void defineAdapter
void loadIntoHost
void createRuntime
`
}

/** Emits a root-only ES2024 probe with no explicit-resource-management lib dependency. */
function staticTypeSource() {
  return `import { createTray, type ITray, type ITrayKey } from '@migaia/tray'
const tray: ITray = createTray([])
const keys: readonly ITrayKey[] = tray.keys
void keys
`
}

/** Runs the extracted consumer without adding workspace paths to its resolver. */
function runConsumerRuntime(consumerDirectory) {
  execFileSync(process.execPath, ['runtime.mjs'], { cwd: consumerDirectory, stdio: 'inherit' })
}

/** Runs TypeScript from the repository's installed toolchain against only extracted declarations. */
function runConsumerTypecheck(consumerDirectory) {
  const compiler = resolve(packageDirectory, 'node_modules/.bin/tsc')
  execFileSync(compiler, ['-p', 'tsconfig.json'], { cwd: consumerDirectory, stdio: 'inherit' })
  execFileSync(compiler, ['-p', 'tsconfig.static.json'], {
    cwd: consumerDirectory,
    stdio: 'inherit'
  })
  if (relative(repositoryDirectory, consumerDirectory).startsWith('..') === false)
    throw new Error('consumer unexpectedly lives inside workspace')
}

/** Bundles four isolated packed consumers and checks the retained owner boundary for each. */
async function runTreeShakingConsumers(consumerDirectory) {
  const consumers = [
    {
      name: 'root-only',
      source: "import { createTray } from '@migaia/tray'\nexport default createTray([])\n",
      forbidden: ['defineLoader', 'defineAdapter', 'createRuntime', 'loadIntoHost']
    },
    {
      name: 'loader-only',
      source: "import { defineLoader } from '@migaia/tray/loader'\nexport default defineLoader\n",
      forbidden: ['defineAdapter', 'createRuntime', 'createTray']
    },
    {
      name: 'adapter-only',
      source:
        "import { defineAdapter } from '@migaia/tray/adapter'\nexport default defineAdapter\n",
      forbidden: ['defineLoader', 'createRuntime', 'createTray']
    },
    {
      name: 'runtime-only',
      source:
        "import { createRuntime } from '@migaia/tray/runtime'\nexport default createRuntime\n",
      forbidden: [
        'defineLoader',
        'defineAdapter',
        'loadIntoHost',
        'createTray',
        'createDynamicCapabilityGraph'
      ]
    }
  ]
  for (const consumer of consumers) {
    const entry = join(consumerDirectory, `${consumer.name}.js`)
    const outputDirectory = join(consumerDirectory, `bundle-${consumer.name}`)
    writeFileSync(entry, consumer.source, 'utf8')
    await build({
      root: consumerDirectory,
      configFile: false,
      logLevel: 'silent',
      build: {
        emptyOutDir: true,
        outDir: outputDirectory,
        lib: { entry, formats: ['es'], fileName: 'consumer' },
        rollupOptions: { external: [] }
      }
    })
    const bundle = readdirSync(outputDirectory)
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(join(outputDirectory, file), 'utf8'))
      .join('\n')
    for (const forbidden of consumer.forbidden) {
      if (bundle.includes(forbidden))
        throw new Error(`${consumer.name} bundle retained forbidden owner ${forbidden}`)
    }
  }
}
