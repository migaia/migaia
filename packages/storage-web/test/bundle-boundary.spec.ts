import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'
import {
  authorizeStorageV2LockProvenance,
  storageV2TarballIntegrity
} from '../../../scripts/storage-v2-lock-provenance.mjs'
import { packageContentSha256 } from '../../../scripts/storage-v2-package-tree.mjs'
import {
  normalizeRetainedModule,
  normalizeRetainedModules
} from '../../../scripts/storage-v2-retained-ledger.mjs'
type IPackageDefinition = {
  readonly directory: string
  readonly name: string
  readonly version: string
  /** Pack a normally installed external dependency without changing its manifest or source. */
  readonly sourceDirectory?: string
}
type IPackedArtifact = {
  readonly definition: IPackageDefinition
  readonly extractDirectory: string
  readonly integrity: string
  readonly tarballPath: string
}
type IInstalledPackageIdentity = {
  readonly contentSha256: string
  readonly lockIdentity: string
  readonly root: string
  readonly tarballLocator: string
  readonly version: string
}
type IPreauthorizedPackageIdentity = {
  readonly artifact: IPackedArtifact
  readonly lockIdentity: string
  readonly root: string
  readonly tarballLocator: string
}
/** Native output captured unchanged from the single configured browser bundler. */
type IRetainedBrowserChunk = {
  readonly fileName: string
  readonly code: string
  readonly map: unknown
  readonly modules: Readonly<Record<string, unknown>>
}
/** Repository root used by the release and lockfile acceptance probes. */
const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
/** Reads one JSON file without allowing a module cache to hide a rewritten manifest. */
const readJson = (fileName: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileName, 'utf8')) as Record<string, unknown>
/** Binds packed-package identity to the current source manifest used by the release under test. */
const packageDefinition = (
  directory: string,
  name: string,
  sourceRoot = repositoryRoot
): IPackageDefinition => {
  const manifest = readJson(resolve(sourceRoot, 'packages', directory, 'package.json'))
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version))
    throw new Error(`invalid release package version: ${directory}`)
  return { directory, name, version: manifest.version }
}
/** Uses pnpm's configured cache so offline packed installs exercise normal dependency resolution. */
const configuredPnpmStoreDirectory = execFileSync('pnpm', ['store', 'path'], {
  cwd: repositoryRoot,
  encoding: 'utf8'
}).trim()
/** Full packed dependency closure required for a normal-resolution storage-web install. */
const packedPackages: readonly IPackageDefinition[] = [
  packageDefinition('utils', '@migaia/utils'),
  packageDefinition('event-subscriber', '@migaia/event-subscriber'),
  packageDefinition('lifecycle', '@migaia/lifecycle'),
  packageDefinition('reactive', '@migaia/reactive'),
  packageDefinition('middleware-pipeline', '@migaia/middleware-pipeline'),
  packageDefinition('resource', '@migaia/resource'),
  packageDefinition('storage-contract', '@migaia/storage-contract'),
  packageDefinition('plugin-host', '@migaia/plugin-host'),
  packageDefinition('capability', '@migaia/capability'),
  packageDefinition('logger', '@migaia/logger'),
  packageDefinition('serialize', '@migaia/serialize'),
  packageDefinition('storage-host', '@migaia/storage-host'),
  packageDefinition('storage-web', '@migaia/storage-web'),
  {
    directory: 'ansis',
    name: 'ansis',
    version: '4.3.1',
    sourceDirectory: realpathSync(resolve(repositoryRoot, 'packages/logger/node_modules/ansis'))
  }
]
/** Explicit app roots needed by the current browser package and its required host peer. */
const browserPackedRoots = ['@migaia/storage-host', '@migaia/storage-web'] as const
/** The agreed comparison is tied to one immutable main revision. */
const browserBaselineCommit = '4af04a168f09a4c852fbd94e7f8f6c2d3f335a03'
/** The original ratio remains an optimization goal rather than a blocking assertion. */
const browserBundleOptimizationTarget = 1.15
/** Raw accepted measurements define exact hard ratios without rounded limits or extra headroom. */
const browserBundleHardCeiling = {
  minified: { current: 696281, baseline: 551293 },
  gzip: { current: 171662, baseline: 132349 }
} as const
/** Selected backend plus one entity where/select/all query, with owning cleanup. */
const browserQueryEntry = [
  "import { createStorageHost } from '@migaia/storage-host'",
  "import { defineEntity } from '@migaia/storage-host/entity'",
  "import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'",
  '/** Read active user names and release the original owning host.',
  ' * @param {import("@migaia/storage-web/indexed-db").IIndexedDbOptions} options Native ports/layout.',
  ' * @returns {Promise<{name:string}[]>} Names after native query completion.',
  ' */',
  'export async function loadActiveUsers(options) {',
  '  const host = await createStorageHost({ plugins: [indexedDbBackendPlugin(options)] })',
  '  try {',
  "    const users = defineEntity({ name: 'users', key: 'id' }).connect(host.backend('indexed-db'))",
  "    return await users.query().where({ active: true }).select('name').all()",
  '  } finally { await host.dispose() }',
  '}'
].join('\n')

/** The candidate and fixed-main baseline use the original bundler configuration. */
const packedBrowserBuild = (root: string, write = true, fileName = 'consumer.js') => ({
  configFile: false as const,
  logLevel: 'silent' as const,
  root,
  build: {
    outDir: join(root, 'bundle'),
    emptyOutDir: true,
    write,
    minify: true as const,
    sourcemap: true,
    lib: {
      entry: join(root, 'bundle-entry.js'),
      formats: ['es' as const],
      fileName: () => fileName
    }
  }
})

/** Measure every emitted runtime chunk; sourcemap bytes are not JavaScript payload. */
const browserBundleBytes = (directory: string): { minified: number; gzip: number } => {
  let minified = 0
  let gzip = 0
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.js'))
    .sort()) {
    const bytes = readFileSync(join(directory, name))
    minified += bytes.byteLength
    gzip += gzipSync(bytes, { level: 9 }).byteLength
  }
  return { minified, gzip }
}

/** Build and pack the unchanged fixed main source with normal repository commands in this window. */
async function measureMainBrowserBaseline(smokeDirectory: string) {
  const sourceRoot = join(smokeDirectory, 'baseline-source')
  execFileSync('git', ['worktree', 'add', '--detach', sourceRoot, browserBaselineCommit], {
    cwd: repositoryRoot,
    stdio: 'pipe'
  })
  try {
    execFileSync('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], {
      cwd: sourceRoot,
      stdio: 'pipe'
    })
    execFileSync(
      'pnpm',
      ['--workspace-concurrency=1', '--filter', '@migaia/storage-web...', 'build'],
      {
        cwd: sourceRoot,
        stdio: 'pipe'
      }
    )
    /** These are the real dependency manifests at the fixed revision, before the ownership move. */
    const definitions = [
      'utils',
      'event-subscriber',
      'lifecycle',
      'reactive',
      'middleware-pipeline',
      'resource',
      'storage-contract',
      'plugin-host',
      'capability',
      'storage-web'
    ].map((directory) => packageDefinition(directory, `@migaia/${directory}`, sourceRoot))
    const artifacts = packReleaseArtifacts(
      join(smokeDirectory, 'baseline-artifacts'),
      sourceRoot,
      definitions
    )
    const consumer = join(smokeDirectory, 'baseline-consumer')
    const roots = ['@migaia/storage-web']
    installPackedConsumer(
      consumer,
      artifacts,
      configuredPnpmStoreDirectory,
      artifactFor(artifacts, '@migaia/storage-web'),
      roots
    )
    const installed = inspectInstalledPackageRoots(consumer, artifacts, undefined, roots)
    writeFileSync(
      join(consumer, 'bundle-entry.js'),
      [
        "import { createStorageHost } from '@migaia/storage-web/host'",
        "import { indexedDbBackendPlugin } from '@migaia/storage-web/plugins/indexed-db'",
        "import { defineEntity } from '@migaia/storage-web/entity'",
        '/** Read the same active user names using the fixed original public API.',
        ' * @param {import("@migaia/storage-web/indexed-db").IIndexedDbOptions} options Native ports/layout.',
        ' * @returns {Promise<{name:string}[]>} Names after native query completion.',
        ' */',
        'export async function loadActiveUsers(options) {',
        '  const host = await createStorageHost({ plugins: [indexedDbBackendPlugin(options)] })',
        '  try {',
        "    const store = host.backend('indexed-db')",
        "    const users = defineEntity({ name: 'users', key: 'id' }).connect(store)",
        '    return (await users.list()).filter((user) => user.active === true).map((user) => ({ name: user.name }))',
        '  } finally { await host.dispose() }',
        '}'
      ].join('\n'),
      'utf8'
    )
    const modules = new Set<string>()
    /** Baseline chunks retain the same native metadata and emitted code as the candidate. */
    const retainedOutputs: IRetainedBrowserChunk[] = []
    await build({
      ...packedBrowserBuild(consumer),
      plugins: [
        {
          name: 'fixed-main-retained',
          generateBundle(_options, bundle) {
            for (const output of Object.values(bundle)) {
              if (output.type !== 'chunk') continue
              retainedOutputs.push({
                fileName: output.fileName,
                code: output.code,
                map: output.map,
                modules: output.modules
              })
              for (const moduleId of Object.keys(output.modules)) modules.add(moduleId)
            }
          }
        }
      ]
    })
    /** Even baseline measurement must resolve every retained module through its actual packed root. */
    writeRenderedBrowserModules(
      'storage-browser-baseline-rendered-modules.json',
      retainedOutputs,
      consumer,
      installed
    )
    return browserBundleBytes(join(consumer, 'bundle'))
  } finally {
    /** This newly created fixture worktree contains only reproducible installs/build artifacts. */
    execFileSync('git', ['worktree', 'remove', '--force', sourceRoot], {
      cwd: repositoryRoot,
      stdio: 'pipe'
    })
  }
}

/** Save identical native module attribution for the fixed baseline and candidate output. */
function writeRenderedBrowserModules(
  cacheFile: string,
  retainedOutputs: readonly IRetainedBrowserChunk[],
  consumerDirectory: string,
  installedPackages: ReadonlyMap<string, IInstalledPackageIdentity>
): void {
  /** Native bundler metadata attributes retained code without estimating absent fields. */
  const renderedModules = retainedOutputs.flatMap((output) =>
    Object.entries(output.modules).map(([moduleId, value]) => {
      /** Canonical identity binds each measurement to its already authorized packed root. */
      const module = normalizeRetainedModule(moduleId, consumerDirectory, installedPackages)
      /** The app entry is separate from every normally installed package owner. */
      const packageName =
        module === 'app/bundle-entry.js'
          ? 'workspace-root'
          : ([...installedPackages.keys()].find((name) => module.startsWith(`${name}/`)) ?? null)
      /** These optional fields are supplied by the real bundler, never synthesized. */
      const metadata = value as {
        readonly originalLength?: number
        readonly renderedLength?: number
        readonly renderedExports?: readonly string[]
        readonly removedExports?: readonly string[]
        readonly code?: string | null
      }
      return {
        fileName: output.fileName,
        module,
        packageName,
        originalLength: metadata.originalLength ?? null,
        renderedLength: metadata.renderedLength ?? null,
        renderedExports: metadata.renderedExports ?? null,
        removedExports: metadata.removedExports ?? null,
        hostRootRenderedCode:
          module === '@migaia/storage-host/dist/index.js' ? (metadata.code ?? null) : undefined
      }
    })
  )
  /** Package totals remain unknown if even one native module length is unavailable. */
  const renderedPackages = [...new Set(renderedModules.map((module) => module.packageName))].map(
    (packageName) => {
      /** Aggregate only modules whose canonical identity resolves to this exact owner. */
      const modules = renderedModules.filter((module) => module.packageName === packageName)
      return {
        packageName,
        modules: modules.length,
        originalLength: modules.some((module) => module.originalLength === null)
          ? null
          : modules.reduce((total, module) => total + module.originalLength!, 0),
        renderedLength: modules.some((module) => module.renderedLength === null)
          ? null
          : modules.reduce((total, module) => total + module.renderedLength!, 0)
      }
    }
  )
  writeFileSync(
    join(repositoryRoot, 'node_modules/.cache', cacheFile),
    `${JSON.stringify(
      {
        lengthUnit: 'Native bundler code length, distinct from final minified/gzip bytes.',
        packages: renderedPackages,
        modules: renderedModules,
        /** Retain actual emitted code so shared host chunks can be inspected after cleanup. */
        chunks: retainedOutputs.map((output) => ({
          fileName: output.fileName,
          code: output.code
        }))
      },
      undefined,
      2
    )}\n`,
    'utf8'
  )
}

/** Pack the same normally built package closure without rewriting source or emitted code. */
function packReleaseArtifacts(
  smokeDirectory: string,
  sourceRoot = repositoryRoot,
  definitions = packedPackages
): readonly IPackedArtifact[] {
  const packDirectory = join(smokeDirectory, 'pack')
  const inspectionDirectory = join(smokeDirectory, 'inspection')
  mkdirSync(packDirectory, { recursive: true })
  mkdirSync(inspectionDirectory, { recursive: true })
  for (const definition of definitions)
    execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
      cwd: definition.sourceDirectory ?? resolve(sourceRoot, 'packages', definition.directory),
      stdio: 'pipe'
    })
  return readdirSync(packDirectory)
    .filter((entry) => entry.endsWith('.tgz'))
    .map((tarball) => {
      const tarballPath = join(packDirectory, tarball)
      const manifest = JSON.parse(
        execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], { encoding: 'utf8' })
      )
      const definition = definitions.find(({ name }) => name === manifest.name)
      if (!definition) throw new Error(`missing packed definition: ${String(manifest.name)}`)
      const extractDirectory = join(inspectionDirectory, definition.directory)
      mkdirSync(extractDirectory, { recursive: true })
      execFileSync('tar', ['-xzf', tarballPath, '--strip-components=1', '-C', extractDirectory])
      return {
        definition,
        extractDirectory,
        integrity: storageV2TarballIntegrity(readFileSync(tarballPath)),
        tarballPath
      }
    })
}

/** Resolve the actual packed dependency closure for module attribution, using the existing tool. */
function inspectInstalledPackageRoots(
  consumerDirectory: string,
  artifacts: readonly IPackedArtifact[],
  _expectedPackages?: ReadonlyMap<string, IInstalledPackageIdentity>,
  roots: readonly string[] = browserPackedRoots
): ReadonlyMap<string, IInstalledPackageIdentity> {
  const authorization = authorizeImporterResolvedPackages(
    readFileSync(join(consumerDirectory, 'pnpm-lock.yaml'), 'utf8'),
    realpathSync(consumerDirectory),
    artifacts,
    roots
  )
  return new Map(
    [...authorization].map(([name, identity]) => [
      name,
      {
        root: identity.root,
        contentSha256: packageContentSha256(identity.root),
        lockIdentity: identity.lockIdentity,
        tarballLocator: identity.tarballLocator,
        version: identity.artifact.definition.version
      }
    ])
  )
}

/** Returns one exact packed artifact or fails the fixture before install. */
function artifactFor(artifacts: readonly IPackedArtifact[], packageName: string): IPackedArtifact {
  const artifact = artifacts.find(({ definition }) => definition.name === packageName)
  if (artifact === undefined) throw new Error(`missing packed artifact: ${packageName}`)
  return artifact
}

/** Explicit browser and host roots resolve their real dependencies and peers from packed tarballs. */
function installPackedConsumer(
  consumerDirectory: string,
  artifacts: readonly IPackedArtifact[],
  storeDirectory: string,
  rootArtifact = artifactFor(artifacts, '@migaia/storage-web'),
  roots: readonly string[] = browserPackedRoots
): void {
  mkdirSync(consumerDirectory, { recursive: true })
  const overrides = Object.fromEntries(
    artifacts
      .filter(({ definition }) => definition.name !== '@migaia/storage-web')
      .map(({ definition, tarballPath }) => [definition.name, `file:${tarballPath}`])
  )
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'storage-v2-packed-consumer',
        private: true,
        type: 'module',
        dependencies: Object.fromEntries(
          roots.map((name) => [
            name,
            `file:${name === '@migaia/storage-web' ? rootArtifact.tarballPath : artifactFor(artifacts, name).tarballPath}`
          ])
        )
      },
      undefined,
      2
    )}\n`,
    'utf8'
  )
  writeFileSync(
    join(consumerDirectory, 'pnpm-workspace.yaml'),
    `${JSON.stringify({ packages: [], overrides }, undefined, 2)}\n`,
    'utf8'
  )
  writeFileSync(
    join(consumerDirectory, '.npmrc'),
    [
      'auto-install-peers=false',
      'hoist=false',
      'link-workspace-packages=false',
      'prefer-workspace-packages=false',
      'strict-peer-dependencies=true'
    ].join('\n'),
    'utf8'
  )
  execFileSync(
    'pnpm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-frozen-lockfile',
      '--no-hoist',
      '--prod',
      '--store-dir',
      storeDirectory
    ],
    {
      cwd: consumerDirectory,
      env: { ...process.env, CI: 'true' },
      stdio: 'pipe'
    }
  )
}

/** Adapts packed fixture facts to the root-owned strict lock provenance tool. */
function authorizeImporterResolvedPackages(
  lockfile: string,
  canonicalConsumerDirectory: string,
  artifacts: readonly IPackedArtifact[],
  roots: readonly string[] = browserPackedRoots
): ReadonlyMap<string, IPreauthorizedPackageIdentity> {
  const artifactsByName = new Map(
    artifacts.map((artifact) => [artifact.definition.name, artifact] as const)
  )
  const authorization = authorizeStorageV2LockProvenance(
    lockfile,
    canonicalConsumerDirectory,
    artifacts.map(({ definition, extractDirectory, integrity, tarballPath }) => ({
      name: definition.name,
      version: definition.version,
      tarballPath,
      integrity,
      dependencies: (readJson(join(extractDirectory, 'package.json')).dependencies ?? {}) as Record<
        string,
        string
      >,
      peerDependencies: (readJson(join(extractDirectory, 'package.json')).peerDependencies ??
        {}) as Record<string, string>,
      peerDependenciesMeta: (readJson(join(extractDirectory, 'package.json'))
        .peerDependenciesMeta ?? {}) as Record<string, { optional?: boolean }>
    })),
    roots
  )
  return new Map(
    [...authorization].map(([name, identity]) => {
      const artifact = artifactsByName.get(name)
      if (artifact === undefined) throw new Error(`missing packed artifact: ${name}`)
      return [name, { artifact, ...identity }] as const
    })
  )
}

describe('browser bundle boundary', () => {
  it('keeps the unchanged entity query within ceilings and excludes unused dependencies', async () => {
    const smokeDirectory = join(tmpdir(), 'migaia-storage-v2-c2-r4-packed-stable')
    mkdirSync(smokeDirectory)
    try {
      const consumerDirectory = join(smokeDirectory, 'consumer')
      const artifacts = packReleaseArtifacts(smokeDirectory)
      installPackedConsumer(consumerDirectory, artifacts, configuredPnpmStoreDirectory)
      const installedPackages = inspectInstalledPackageRoots(consumerDirectory, artifacts)
      writeFileSync(join(consumerDirectory, 'bundle-entry.js'), browserQueryEntry, 'utf8')
      const modules = new Set<string>()
      const outputs: IRetainedBrowserChunk[] = []
      await build({
        ...packedBrowserBuild(consumerDirectory),
        plugins: [
          {
            name: 'storage-browser-bundle-attribution',
            generateBundle(_options, bundle) {
              for (const output of Object.values(bundle)) {
                if (output.type !== 'chunk') continue
                outputs.push({
                  fileName: output.fileName,
                  code: output.code,
                  map: output.map,
                  modules: output.modules
                })
                for (const moduleId of Object.keys(output.modules)) modules.add(moduleId)
              }
            }
          }
        ]
      })
      const retained = normalizeRetainedModules(modules, consumerDirectory, installedPackages)
      mkdirSync(join(repositoryRoot, 'node_modules/.cache'), { recursive: true })
      writeFileSync(
        join(repositoryRoot, 'node_modules/.cache/storage-browser-retained-modules.json'),
        JSON.stringify(retained, null, 2) + '\n'
      )
      writeRenderedBrowserModules(
        'storage-browser-rendered-modules.json',
        outputs,
        consumerDirectory,
        installedPackages
      )
      const currentBytes = browserBundleBytes(join(consumerDirectory, 'bundle'))
      const baselineBytes = await measureMainBrowserBaseline(smokeDirectory)
      const measurement = {
        baseline: browserBaselineCommit,
        current: execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: repositoryRoot,
          encoding: 'utf8'
        }).trim(),
        dirty:
          execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' })
            .length > 0,
        baselineBytes,
        currentBytes,
        optimizationTarget: browserBundleOptimizationTarget,
        hardCeiling: browserBundleHardCeiling
      }
      writeFileSync(
        join(repositoryRoot, 'node_modules/.cache/storage-browser-bundle-measurement.json'),
        JSON.stringify(measurement, null, 2) + '\n'
      )
      console.info('browser-bundle-sizes', measurement)
      /** Both fixed byte ceilings apply; the baseline remains measured diagnostic evidence. */
      expect({
        minified: currentBytes.minified <= browserBundleHardCeiling.minified.current,
        gzip: currentBytes.gzip <= browserBundleHardCeiling.gzip.current
      }).toEqual({ minified: true, gzip: true })
      /** Exact retained inventories are diagnostic; only known unused dependencies are forbidden. */
      const forbidden = retained.filter(
        (module) =>
          /^@migaia\/(?:logger|storage-plugin-[^/]+)\//.test(module) ||
          /^@migaia\/storage-web\/dist\/(?:cookies|local-storage|session-storage|features\/reactive)(?:\.|\/)/.test(
            module
          ) ||
          /^@migaia\/storage-host\/dist\/(?:vector\/|authoring\/(?:rdf|sparql|vector)\.|backends\/(?:memory|rdf-core|vector-core)\.)/.test(
            module
          )
      )
      expect(forbidden).toEqual([])
    } finally {
      rmSync(smokeDirectory, { recursive: true, force: true })
    }
  }, 300_000)
})
