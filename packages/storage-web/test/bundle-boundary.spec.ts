import { execFileSync, spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'
import {
  authorizeStorageV2LockProvenance,
  createStorageV2LockHostiles,
  storageV2TarballIntegrity,
  storageV2VirtualStoreDirMaxLength
} from '../../../scripts/storage-v2-lock-provenance.mjs'
import {
  inspectVirtualStorePackageRoots,
  packageContentSha256
} from '../../../scripts/storage-v2-package-tree.mjs'
import {
  assertExactRetainedModules as assertExactRetainedModuleSet,
  normalizeRetainedModule,
  normalizeRetainedModules
} from '../../../scripts/storage-v2-retained-ledger.mjs'
import {
  assertSemanticModuleEvidence,
  normalizeOwnedSemanticModules,
  sourceMapSources,
  resolveSourceMapSources
} from '../../../scripts/package-tree-shaking-provenance.mjs'
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
/** Pnpm default persisted in the fresh consumer's `.modules.yaml`. */
const pnpmVirtualStoreDirMaxLength = storageV2VirtualStoreDirMaxLength
/** Foundation order and source-manifest identities authorized for the lockfile rehearsal. */
const releasePackages: readonly IPackageDefinition[] = [
  packageDefinition('utils', '@migaia/utils'),
  packageDefinition('event-subscriber', '@migaia/event-subscriber'),
  packageDefinition('lifecycle', '@migaia/lifecycle'),
  packageDefinition('reactive', '@migaia/reactive'),
  packageDefinition('serialize', '@migaia/serialize'),
  packageDefinition('storage-contract', '@migaia/storage-contract'),
  packageDefinition('logger', '@migaia/logger'),
  packageDefinition('storage-host', '@migaia/storage-host'),
  packageDefinition('storage-web', '@migaia/storage-web')
]
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

/** One bundler configuration is shared by current, renamed-output proof and fixed-main builds. */
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
  expect(minified).toBeGreaterThan(0)
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
    execFileSync('pnpm', ['--filter', '@migaia/storage-web...', 'build'], {
      cwd: sourceRoot,
      stdio: 'pipe'
    })
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
    for (const normalized of normalizeRetainedModules(modules, consumer, installed))
      expect(normalized).toMatch(/^(?:app\/bundle-entry\.js|@migaia\/[^/]+\/.+)$/)
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

/** Exact host/entity and selected IndexedDB graph from the authorized packed consumer. */
const expectedRetainedModules = [
  '@migaia/capability/dist/graph/dependency.js',
  '@migaia/capability/dist/graph/error-code.js',
  '@migaia/capability/dist/graph/error-text.js',
  '@migaia/capability/dist/graph/errors.js',
  '@migaia/capability/dist/graph/topology-admission.js',
  '@migaia/capability/dist/graph/topology-index.js',
  '@migaia/capability/dist/graph/topology.js',
  '@migaia/event-subscriber/dist/channel-[chunk].js',
  '@migaia/event-subscriber/dist/index.js',
  '@migaia/lifecycle/dist/abort-factory.js',
  '@migaia/lifecycle/dist/abort.js',
  '@migaia/lifecycle/dist/abortable-delay.js',
  '@migaia/lifecycle/dist/bounded-wait.js',
  '@migaia/lifecycle/dist/dispose-transaction.js',
  '@migaia/lifecycle/dist/disposer-context.js',
  '@migaia/lifecycle/dist/error-[chunk].js',
  '@migaia/lifecycle/dist/error-code.js',
  '@migaia/lifecycle/dist/error-text.js',
  '@migaia/lifecycle/dist/errors.js',
  '@migaia/lifecycle/dist/generation-controller.js',
  '@migaia/lifecycle/dist/lifecycle-scope.js',
  '@migaia/lifecycle/dist/mutation-queue.js',
  '@migaia/lifecycle/dist/observed-subscription.js',
  '@migaia/lifecycle/dist/owned-entries.js',
  '@migaia/lifecycle/dist/provisional-scope.js',
  '@migaia/lifecycle/dist/quiescence-tracker.js',
  '@migaia/lifecycle/dist/scheduler.js',
  '@migaia/lifecycle/dist/state-constants.js',
  '@migaia/lifecycle/dist/terminal-controller.js',
  '@migaia/lifecycle/dist/types.js',
  '@migaia/middleware-pipeline/dist/index.js',
  '@migaia/plugin-host/dist/_virtual/_@oxc-project_runtime@0.139.0/helpers/esm/assertClassBrand.js',
  '@migaia/plugin-host/dist/_virtual/_@oxc-project_runtime@0.139.0/helpers/esm/checkPrivateRedeclaration.js',
  '@migaia/plugin-host/dist/_virtual/_@oxc-project_runtime@0.139.0/helpers/esm/classPrivateFieldGet2.js',
  '@migaia/plugin-host/dist/_virtual/_@oxc-project_runtime@0.139.0/helpers/esm/classPrivateFieldInitSpec.js',
  '@migaia/plugin-host/dist/_virtual/_@oxc-project_runtime@0.139.0/helpers/esm/classPrivateFieldSet2.js',
  '@migaia/plugin-host/dist/_virtual/_@oxc-project_runtime@0.139.0/helpers/esm/classPrivateMethodInitSpec.js',
  '@migaia/plugin-host/dist/_virtual/_@oxc-project_runtime@0.139.0/helpers/esm/defineProperty.js',
  '@migaia/plugin-host/dist/_virtual/_@oxc-project_runtime@0.139.0/helpers/esm/toPrimitive.js',
  '@migaia/plugin-host/dist/_virtual/_@oxc-project_runtime@0.139.0/helpers/esm/toPropertyKey.js',
  '@migaia/plugin-host/dist/_virtual/_@oxc-project_runtime@0.139.0/helpers/esm/typeof.js',
  '@migaia/plugin-host/dist/admission-runtime.js',
  '@migaia/plugin-host/dist/cleanup-runtime.js',
  '@migaia/plugin-host/dist/composition.js',
  '@migaia/plugin-host/dist/config-runtime.js',
  '@migaia/plugin-host/dist/config.js',
  '@migaia/plugin-host/dist/core-runtime.js',
  '@migaia/plugin-host/dist/core.js',
  '@migaia/plugin-host/dist/define-feature.js',
  '@migaia/plugin-host/dist/define-host.js',
  '@migaia/plugin-host/dist/define-plugin.js',
  '@migaia/plugin-host/dist/dependency-reader.js',
  '@migaia/plugin-host/dist/dependency-runtime.js',
  '@migaia/plugin-host/dist/diagnostic-report.js',
  '@migaia/plugin-host/dist/disposal.js',
  '@migaia/plugin-host/dist/enablement-runtime.js',
  '@migaia/plugin-host/dist/error-code.js',
  '@migaia/plugin-host/dist/error-text.js',
  '@migaia/plugin-host/dist/extension.js',
  '@migaia/plugin-host/dist/feature-runtime.js',
  '@migaia/plugin-host/dist/host-[chunk].js',
  '@migaia/plugin-host/dist/host-disposal-runtime.js',
  '@migaia/plugin-host/dist/host-options.js',
  '@migaia/plugin-host/dist/host-queue.js',
  '@migaia/plugin-host/dist/host-runtime.js',
  '@migaia/plugin-host/dist/host-state.js',
  '@migaia/plugin-host/dist/install-runtime.js',
  '@migaia/plugin-host/dist/invocation.js',
  '@migaia/plugin-host/dist/operation-runtime.js',
  '@migaia/plugin-host/dist/pipeline-runtime.js',
  '@migaia/plugin-host/dist/plugin-handle.js',
  '@migaia/plugin-host/dist/publication.js',
  '@migaia/plugin-host/dist/removal-runtime.js',
  '@migaia/plugin-host/dist/replace-runtime.js',
  '@migaia/plugin-host/dist/resume-runtime.js',
  '@migaia/plugin-host/dist/stage-lanes.js',
  '@migaia/plugin-host/dist/state-constants.js',
  '@migaia/plugin-host/dist/symbols.js',
  '@migaia/serialize/dist/base64.js',
  '@migaia/serialize/dist/codec-text.js',
  '@migaia/serialize/dist/codec.js',
  '@migaia/serialize/dist/codecs/json.js',
  '@migaia/serialize/dist/error-code.js',
  '@migaia/serialize/dist/errors.js',
  '@migaia/serialize/dist/internal/codec.js',
  '@migaia/serialize/dist/portable.js',
  '@migaia/storage-contract/dist/index.js',
  '@migaia/storage-host/dist/entity.js',
  '@migaia/storage-host/dist/index.js',
  '@migaia/storage-host/dist/json-[chunk].js',
  '@migaia/storage-host/dist/key-domain-[chunk].js',
  '@migaia/storage-host/dist/batch-observation-[chunk].js',
  '@migaia/storage-host/dist/ordered-record-index-[chunk].js',
  '@migaia/storage-web/dist/builtin-factory-[chunk].js',
  '@migaia/storage-web/dist/builtin-kinds-[chunk].js',
  '@migaia/storage-web/dist/constants-[chunk].js',
  '@migaia/storage-web/dist/errors-[chunk].js',
  '@migaia/storage-web/dist/indexed-db-[chunk].js',
  '@migaia/utils/dist/bytes.js',
  '@migaia/utils/dist/config-[chunk].js',
  '@migaia/utils/dist/error-[chunk].js',
  '@migaia/utils/dist/function.js',
  '@migaia/utils/dist/host-report-[chunk].js',
  '@migaia/utils/dist/object-path.js',
  '@migaia/utils/dist/object.js',
  '@migaia/utils/dist/promise.js',
  '@migaia/utils/dist/scheduler-[chunk].js',
  'app/bundle-entry.js'
] as const
/** Binds the reviewed retained inventory to the root-owned exact-set tool. */
const assertExactRetainedModules = (modules: Iterable<string>): void =>
  assertExactRetainedModuleSet(modules, expectedRetainedModules)
/** Converts a fresh packed graph into the shared source-owned semantic ledger. */
function normalizeSemanticRetainedGraph(
  outputs: readonly {
    readonly fileName: string
    readonly map: unknown
    readonly modules: Readonly<Record<string, unknown>>
  }[],
  consumerDirectory: string,
  installedPackages: ReadonlyMap<string, IInstalledPackageIdentity>
) {
  const entry = resolve(realpathSync(consumerDirectory), 'bundle-entry.js')
  const owners = new Map<string, string>([['workspace-root', consumerDirectory]])
  const records = []
  for (const output of outputs) {
    const sourceNames = sourceMapSources(output.map)
    const resolvedSources = resolveSourceMapSources(
      output.map,
      resolve(consumerDirectory, 'bundle', output.fileName)
    )
    const moduleIds = Object.keys(output.modules)
    expect(sourceNames).toHaveLength(moduleIds.length)
    expect(resolvedSources).toHaveLength(sourceNames.length)
    const emittedFile = resolve(consumerDirectory, 'bundle', output.fileName)
    const packageRecords = new Map<
      string,
      {
        readonly packageName: string
        readonly packageRoot: string
        readonly sourcePaths: string[]
        originalBytes: number
        renderedBytes: number
      }
    >()
    for (const [index, moduleId] of moduleIds.entries()) {
      const normalized =
        moduleId === entry
          ? 'workspace-root/bundle-entry.js'
          : normalizeRetainedModule(moduleId, consumerDirectory, installedPackages)
      /** Every retained dependency, including ansis, must belong to its already authorized root. */
      const packageName =
        moduleId === entry
          ? 'workspace-root'
          : [...installedPackages.keys()].find((name) => normalized.startsWith(`${name}/`))
      if (packageName === undefined) throw new Error(`unknown retained package owner: ${moduleId}`)
      const packageRoot =
        packageName === 'workspace-root'
          ? consumerDirectory
          : installedPackages.get(packageName)?.root
      if (!packageRoot) throw new Error(`unknown packed sourcemap owner: ${moduleId}`)
      owners.set(packageName, packageRoot)
      const sourcePath =
        packageName === 'workspace-root'
          ? 'bundle-entry.js'
          : relative(packageRoot, realpathSync(moduleId)).split('\\').join('/')
      const packageRecord = packageRecords.get(packageName) ?? {
        packageName,
        packageRoot,
        sourcePaths: [],
        originalBytes: 0,
        renderedBytes: 0
      }
      packageRecord.sourcePaths.push(sourcePath)
      packageRecord.originalBytes += Number(
        (output.modules[moduleId] as { originalLength?: number }).originalLength ?? 0
      )
      packageRecord.renderedBytes += Number(
        (output.modules[moduleId] as { renderedLength?: number }).renderedLength ?? 0
      )
      packageRecords.set(packageName, packageRecord)
      expect(resolvedSources[index]).toBeTypeOf('string')
    }
    for (const packageRecord of packageRecords.values())
      records.push({
        ...packageRecord,
        sourceMapBacked: true,
        emittedPath: emittedFile,
        emittedRole: packageRecord.packageName === 'workspace-root' ? 'entry' : 'runtime'
      })
  }
  return normalizeOwnedSemanticModules(records, owners)
}
describe('host and release boundary', () => {
  it('pins order, private manifests, exact exports, lock edges, and fail-closed capabilities', () => {
    const makefile = readFileSync(resolve(repositoryRoot, 'Makefile'), 'utf8')
    const releaseLine = makefile.match(/^RELEASE_PACKAGES := (.+)$/m)?.[1]
    expect(releaseLine).toBeDefined()
    const actualFoundationOrder = releaseLine!
      .split(' ')
      .filter((entry) => releasePackages.some(({ directory }) => directory === entry))
    expect(actualFoundationOrder).toEqual(releasePackages.map(({ directory }) => directory))

    const lockfile = readFileSync(resolve(repositoryRoot, 'pnpm-lock.yaml'), 'utf8')
    for (const definition of releasePackages) {
      const manifestPath = resolve(repositoryRoot, 'packages', definition.directory, 'package.json')
      const manifest = readJson(manifestPath)
      expect(manifest.name, definition.directory).toBe(definition.name)
      expect(manifest.version, definition.directory).toBe(definition.version)
      expect(manifest.private, definition.directory).toBe(true)
      expect(manifest.exports, definition.directory).toBeTypeOf('object')

      const importerMarker = `  packages/${definition.directory}:\n`
      const importerStart = lockfile.indexOf(importerMarker)
      expect(importerStart, `${definition.directory} lock importer`).toBeGreaterThanOrEqual(0)
      const nextImporter = lockfile.indexOf('\n  packages/', importerStart + importerMarker.length)
      const importer = lockfile.slice(
        importerStart,
        nextImporter === -1 ? lockfile.length : nextImporter
      )
      const dependencies = (manifest.dependencies ?? {}) as Record<string, string>
      for (const dependency of packedPackages) {
        if (dependencies[dependency.name] !== 'workspace:^') continue
        expect(importer, `${definition.directory} -> ${dependency.name}`).toContain(
          `specifier: workspace:^\n        version: link:../${dependency.directory}`
        )
      }
    }

    const indexedDbSource = readFileSync(
      resolve(repositoryRoot, 'packages/storage-web/src/backends/indexed-db.ts'),
      'utf8'
    )
    expect(indexedDbSource).toMatch(/secondaryIndexes:\s*true/)
    expect(indexedDbSource).toMatch(/changeFeed:\s*false/)
  })

  it('installs packed browser and host roots and proves exact retained modules', async () => {
    /**
     * Fixed-width region paths remain reproducible while create-only admission keeps installs
     * fresh.
     */
    const smokeDirectory = join(tmpdir(), 'migaia-storage-v2-c2-r4-packed-stable')
    mkdirSync(smokeDirectory)
    try {
      const consumerDirectory = join(smokeDirectory, 'consumer')
      const artifacts = packReleaseArtifacts(smokeDirectory)
      installPackedConsumer(consumerDirectory, artifacts, configuredPnpmStoreDirectory)
      const consumerManifest = readJson(join(consumerDirectory, 'package.json'))
      expect(consumerManifest.dependencies).toEqual({
        '@migaia/storage-web': `file:${artifactFor(artifacts, '@migaia/storage-web').tarballPath}`,
        '@migaia/storage-host': `file:${artifactFor(artifacts, '@migaia/storage-host').tarballPath}`
      })
      expect(readdirSync(join(consumerDirectory, 'node_modules', '@migaia'))).toEqual([
        'storage-host',
        'storage-web'
      ])
      assertPreInspectionArtifactProvenanceHostiles(consumerDirectory, artifacts)
      assertImporterRootedLockHostiles(consumerDirectory, artifacts)
      const installedPackages = inspectInstalledPackageRoots(consumerDirectory, artifacts)
      assertInstalledArtifactProvenanceHostiles(consumerDirectory, artifacts, installedPackages)
      writeFileSync(
        join(consumerDirectory, 'native-esm.mjs'),
        [
          "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'",
          "const routes = ['/local-storage', '/session-storage', '/cookies', '/indexed-db', '/plugins/local-storage', '/plugins/session-storage', '/plugins/cookies', '/plugins/indexed-db', '/features/reactive']",
          'await Promise.all(routes.map((route) => import(`@migaia/storage-web${route}`)))',
          "await import('@migaia/storage-host/entity')",
          'const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })',
          "if (host.backend('memory').capabilities.secondaryIndexes !== false) throw new Error('secondary index capability promoted')",
          'await host.dispose()'
        ].join('\n'),
        'utf8'
      )
      execFileSync(process.execPath, ['native-esm.mjs'], {
        cwd: consumerDirectory,
        stdio: 'pipe'
      })

      /** Browser entries expose installation recipes and opaque kinds, with no direct factories. */
      const backendExports = [
        [
          'local-storage',
          'localStorageBackendPlugin',
          'localStorageBackendKind',
          'localStorageHost'
        ],
        [
          'session-storage',
          'sessionStorageBackendPlugin',
          'sessionStorageBackendKind',
          'sessionStorageHost'
        ],
        ['cookies', 'cookieBackendPlugin', 'cookieBackendKind', 'cookiesHost'],
        ['indexed-db', 'indexedDbBackendPlugin', 'indexedDbBackendKind', 'indexedDbHost']
      ] as const
      for (const [subpath, plugin, kind, removed] of backendExports) {
        const currentImport = join(consumerDirectory, `current-${subpath}.mjs`)
        writeFileSync(
          currentImport,
          `import { ${plugin}, ${kind} } from '@migaia/storage-web/${subpath}'\n` +
            `if (typeof ${plugin} !== 'function' || typeof ${kind} !== 'object') throw new Error('missing backend definition')\n`,
          'utf8'
        )
        execFileSync(process.execPath, [currentImport], { cwd: consumerDirectory, stdio: 'pipe' })
        const declaration = readFileSync(
          join(
            consumerDirectory,
            'node_modules',
            '@migaia',
            'storage-web',
            'dist',
            `${subpath}.d.ts`
          ),
          'utf8'
        )
        expect(declaration).toContain(plugin)
        expect(declaration).toContain(kind)
        expect(declaration).not.toContain(removed)
        const oldImport = join(consumerDirectory, `removed-${subpath}.mjs`)
        writeFileSync(
          oldImport,
          `import { ${removed} } from '@migaia/storage-web/${subpath}'\n`,
          'utf8'
        )
        const result = spawnSync(process.execPath, [oldImport], {
          cwd: consumerDirectory,
          encoding: 'utf8'
        })
        expect(result.status, subpath).not.toBe(0)
        expect(result.stderr).toContain(`does not provide an export named '${removed}'`)
      }
      for (const subpath of [
        'memory',
        'host',
        'entity',
        'schema',
        'serialize',
        'reactive-adapter',
        'plugins/memory',
        'plugins/reactive',
        'plugins/reactive/memory',
        'plugins/reactive/local-storage',
        'plugins/reactive/session-storage',
        'plugins/reactive/cookies',
        'plugins/reactive/indexed-db'
      ]) {
        const result = spawnSync(
          process.execPath,
          ['--input-type=module', '--eval', `await import('@migaia/storage-web/${subpath}')`],
          { cwd: consumerDirectory, encoding: 'utf8' }
        )
        expect(result.status, subpath).not.toBe(0)
        expect(result.stderr).toContain('ERR_PACKAGE_PATH_NOT_EXPORTED')
      }

      const bundleEntry = join(consumerDirectory, 'bundle-entry.js')
      const bundleDirectory = join(consumerDirectory, 'bundle')
      writeFileSync(bundleEntry, browserQueryEntry, 'utf8')
      const retainedModuleIds = new Set<string>()
      const retainedOutputs: IRetainedBrowserChunk[] = []
      await build({
        ...packedBrowserBuild(consumerDirectory),
        plugins: [
          {
            name: 'storage-v2-retained-module-ledger',
            generateBundle(_options, bundle) {
              for (const output of Object.values(bundle)) {
                if (output.type !== 'chunk') continue
                if (!output.map) throw new Error('packed retained chunk is missing its sourcemap')
                retainedOutputs.push({
                  fileName: output.fileName,
                  code: output.code,
                  map: output.map,
                  modules: output.modules
                })
                for (const moduleId of Object.keys(output.modules)) retainedModuleIds.add(moduleId)
              }
            }
          }
        ]
      })
      /** Record the actual graph before the exact-set gate; reviewed expectations remain separate. */
      const retained = normalizeRetainedModules(
        retainedModuleIds,
        consumerDirectory,
        installedPackages
      )
      writeFileSync(
        join(repositoryRoot, 'node_modules/.cache/storage-browser-retained-modules.json'),
        `${JSON.stringify(retained, undefined, 2)}\n`,
        'utf8'
      )
      writeRenderedBrowserModules(
        'storage-browser-rendered-modules.json',
        retainedOutputs,
        consumerDirectory,
        installedPackages
      )
      /** Keep the exact-set failure while still recording required size and module attribution. */
      expect.soft(() => assertExactRetainedModules(retained)).not.toThrow()
      const semanticRetained = normalizeSemanticRetainedGraph(
        retainedOutputs,
        consumerDirectory,
        installedPackages
      )
      const renamedOutput = await build({
        ...packedBrowserBuild(consumerDirectory, false, 'consumer-[hash].js')
      })
      const renamedOutputs = (
        Array.isArray(renamedOutput) ? renamedOutput : [renamedOutput]
      ).flatMap((result) => {
        if (!('output' in result)) return []
        return result.output
          .filter(
            (output): output is typeof output & { type: 'chunk'; map: unknown } =>
              output.type === 'chunk' && !!output.map
          )
          .map((output) => ({
            fileName: output.fileName,
            map: output.map,
            modules: output.modules
          }))
      })
      assertSemanticModuleEvidence(
        semanticRetained,
        normalizeSemanticRetainedGraph(renamedOutputs, consumerDirectory, installedPackages)
      )
      const currentBytes = browserBundleBytes(bundleDirectory)
      const baselineBytes = await measureMainBrowserBaseline(smokeDirectory)
      /** Both compressed and minified limits apply independently to this same business query. */
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
        `${JSON.stringify(measurement, undefined, 2)}\n`,
        'utf8'
      )
      console.info('browser-bundle-sizes', measurement)
      /** Record both failed ceilings without suppressing the remaining original bundle checks. */
      expect
        .soft(currentBytes.minified * browserBundleHardCeiling.minified.baseline)
        .toBeLessThanOrEqual(browserBundleHardCeiling.minified.current * baselineBytes.minified)
      expect
        .soft(currentBytes.gzip * browserBundleHardCeiling.gzip.baseline)
        .toBeLessThanOrEqual(browserBundleHardCeiling.gzip.current * baselineBytes.gzip)
      const bundle = readFileSync(join(bundleDirectory, 'consumer.js'), 'utf8')
      expect(bundle).not.toMatch(/(?:from\s*|import\()['"]@migaia\//)
      expect(bundle).toContain('indexedDB')
      expect(bundle).not.toContain('document.cookie')
      expect(bundle).not.toContain('localStorage')
      execFileSync(process.execPath, [join(bundleDirectory, 'consumer.js')], {
        cwd: consumerDirectory,
        stdio: 'pipe'
      })
    } finally {
      rmSync(smokeDirectory, { recursive: true, force: true })
    }
  }, 300_000)

  it('rejects restored direct factories in isolated packed consumers', () => {
    const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-storage-entry-sensitivity-'))
    try {
      const artifacts = packReleaseArtifacts(smokeDirectory)
      const source = artifactFor(artifacts, '@migaia/storage-web')
      const runOracle = (name: string, artifact = source) => {
        const consumer = join(smokeDirectory, name)
        installPackedConsumer(consumer, artifacts, configuredPnpmStoreDirectory, artifact)
        return spawnSync(
          process.execPath,
          [
            '--input-type=module',
            '--eval',
            "import { localStorageHost } from '@migaia/storage-web/local-storage'; void localStorageHost"
          ],
          { cwd: consumer, encoding: 'utf8' }
        )
      }
      expect(runOracle('clean').status).not.toBe(0)
      const poisoned = createStorageWebMutationArtifact(
        smokeDirectory,
        source,
        'direct-factory',
        (directory) => {
          const entry = join(directory, 'dist', 'local-storage.js')
          writeFileSync(
            entry,
            readFileSync(entry, 'utf8') + '\nexport const localStorageHost = () => ({});\n',
            'utf8'
          )
        }
      )
      expect(runOracle('poisoned', poisoned).status).toBe(0)
      expect(runOracle('restored').status).not.toBe(0)
    } finally {
      rmSync(smokeDirectory, { recursive: true, force: true })
    }
  }, 120_000)

  it('fails native import when the packed root omits its event-subscriber dependency', () => {
    const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-storage-v2-c2-r4-phantom-'))
    try {
      const artifacts = packReleaseArtifacts(smokeDirectory)
      const malformedArtifact = createDependencyOmissionArtifact(
        smokeDirectory,
        artifactFor(artifacts, '@migaia/storage-web'),
        '@migaia/event-subscriber'
      )
      const consumerDirectory = join(smokeDirectory, 'consumer')
      installPackedConsumer(
        consumerDirectory,
        artifacts,
        configuredPnpmStoreDirectory,
        malformedArtifact
      )
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', "await import('@migaia/storage-web/indexed-db')"],
        { cwd: consumerDirectory, encoding: 'utf8' }
      )
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('ERR_MODULE_NOT_FOUND')
      expect(result.stderr).toContain('@migaia/event-subscriber')
      expect(
        existsSync(join(consumerDirectory, 'node_modules', '@migaia', 'event-subscriber'))
      ).toBe(false)
    } finally {
      rmSync(smokeDirectory, { recursive: true, force: true })
    }
  }, 120_000)

  it('rejects hostile raw module identities before exact retained-module comparison', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'migaia-storage-v2-retained-identity-'))
    try {
      const consumerDirectory = join(fixtureDirectory, 'consumer')
      const thirdPartyDirectory = join(fixtureDirectory, 'node_modules', 'hostile')
      const outsideDirectory = join(fixtureDirectory, 'outside')
      const approvedUtilsRoot = join(
        fixtureDirectory,
        'approved',
        'node_modules',
        '@migaia',
        'utils'
      )
      const alternateUtilsRoot = join(
        fixtureDirectory,
        'alternate',
        'node_modules',
        '@migaia',
        'utils'
      )
      const aliasedUtilsRoot = join(fixtureDirectory, 'alias', 'node_modules', '@migaia', 'utils')
      const unknownPackageRoot = join(
        fixtureDirectory,
        'unknown',
        'node_modules',
        '@migaia',
        'unknown'
      )
      mkdirSync(consumerDirectory, { recursive: true })
      mkdirSync(thirdPartyDirectory, { recursive: true })
      mkdirSync(outsideDirectory, { recursive: true })
      mkdirSync(join(approvedUtilsRoot, 'dist'), { recursive: true })
      mkdirSync(join(alternateUtilsRoot, 'dist'), { recursive: true })
      mkdirSync(resolve(aliasedUtilsRoot, '..'), { recursive: true })
      mkdirSync(join(unknownPackageRoot, 'dist'), { recursive: true })
      const entry = join(consumerDirectory, 'bundle-entry.js')
      const thirdPartyEntry = join(thirdPartyDirectory, 'bundle-entry.js')
      const outsideEntry = join(outsideDirectory, 'bundle-entry.js')
      const symlinkEntry = join(consumerDirectory, 'bundle-entry-alias.js')
      writeFileSync(entry, 'export const entry = true\n', 'utf8')
      writeFileSync(thirdPartyEntry, 'export const hostile = true\n', 'utf8')
      writeFileSync(outsideEntry, 'export const outside = true\n', 'utf8')
      const approvedUtilsModule = join(approvedUtilsRoot, 'dist', 'bytes.js')
      const alternateUtilsModule = join(alternateUtilsRoot, 'dist', 'bytes.js')
      const escapedUtilsModule = join(approvedUtilsRoot, 'dist', 'escaped.js')
      const unknownPackageModule = join(unknownPackageRoot, 'dist', 'index.js')
      writeFileSync(approvedUtilsModule, 'export const approved = true\n', 'utf8')
      writeFileSync(alternateUtilsModule, 'export const alternate = true\n', 'utf8')
      writeFileSync(unknownPackageModule, 'export const unknown = true\n', 'utf8')
      symlinkSync(alternateUtilsModule, escapedUtilsModule)
      symlinkSync(approvedUtilsRoot, aliasedUtilsRoot, 'dir')
      symlinkSync(entry, symlinkEntry)

      const canonicalEntry = resolve(realpathSync(consumerDirectory), 'bundle-entry.js')
      const installedPackages = new Map<string, IInstalledPackageIdentity>([
        [
          '@migaia/utils',
          {
            contentSha256: packageContentSha256(approvedUtilsRoot),
            lockIdentity: '@migaia/utils@file:/approved/migaia-utils.tgz',
            root: realpathSync(approvedUtilsRoot),
            tarballLocator: 'file:/approved/migaia-utils.tgz',
            version: '0.0.2'
          }
        ]
      ])
      const hostileIds = [
        thirdPartyEntry,
        outsideEntry,
        symlinkEntry,
        `${canonicalEntry}?raw`,
        `${canonicalEntry}#fragment`,
        '\0virtual:bundle-entry.js'
      ] as const
      expect(normalizeRetainedModule(canonicalEntry, consumerDirectory, installedPackages)).toBe(
        'app/bundle-entry.js'
      )
      for (const hostileId of hostileIds) {
        const normalized = normalizeRetainedModules(
          [canonicalEntry, hostileId],
          consumerDirectory,
          installedPackages
        )
        expect(normalized).toHaveLength(2)
        expect(normalized[0]).toBe('app/bundle-entry.js')
        expect(normalized[1]).not.toBe('app/bundle-entry.js')
        expect(() =>
          assertExactRetainedModules([...expectedRetainedModules, normalized[1]!])
        ).toThrow(`unexpected retained module: ${normalized[1]}`)
      }

      expect(
        normalizeRetainedModule(approvedUtilsModule, consumerDirectory, installedPackages)
      ).toBe('@migaia/utils/dist/bytes.js')
      const substitutedModule = normalizeRetainedModule(
        alternateUtilsModule,
        consumerDirectory,
        installedPackages
      )
      expect(substitutedModule).not.toBe('@migaia/utils/dist/bytes.js')
      expect(() =>
        assertExactRetainedModules(
          expectedRetainedModules.map((moduleId) =>
            moduleId === '@migaia/utils/dist/bytes.js' ? substitutedModule : moduleId
          )
        )
      ).toThrow(`unexpected retained module: ${substitutedModule}`)

      const duplicateRoots = normalizeRetainedModules(
        [approvedUtilsModule, alternateUtilsModule],
        consumerDirectory,
        installedPackages
      )
      expect(duplicateRoots).toHaveLength(2)
      expect(() =>
        assertExactRetainedModules([...expectedRetainedModules, duplicateRoots[1]!])
      ).toThrow(`unexpected retained module: ${duplicateRoots[1]}`)

      const unknownModule = normalizeRetainedModule(
        unknownPackageModule,
        consumerDirectory,
        installedPackages
      )
      expect(unknownModule).not.toBe('@migaia/unknown/dist/index.js')
      expect(() => assertExactRetainedModules([...expectedRetainedModules, unknownModule])).toThrow(
        `unexpected retained module: ${unknownModule}`
      )

      const escapedModule = normalizeRetainedModule(
        escapedUtilsModule,
        consumerDirectory,
        installedPackages
      )
      expect(escapedModule).not.toBe('@migaia/utils/dist/escaped.js')
      expect(() => assertExactRetainedModules([...expectedRetainedModules, escapedModule])).toThrow(
        `unexpected retained module: ${escapedModule}`
      )

      expect(() =>
        normalizeRetainedModules(
          [approvedUtilsModule, join(aliasedUtilsRoot, 'dist', 'bytes.js')],
          consumerDirectory,
          installedPackages
        )
      ).toThrow('retained module identity collision')
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true })
    }
  })

  it('restores the publish manifest byte-for-byte on success, failure, INT, and TERM', async () => {
    for (const mode of ['success', 'failure'] as const) {
      const fixture = createPublishFixture()
      try {
        const result = spawnSync('make', ['PACKAGE=utils', 'publish'], {
          cwd: fixture.directory,
          env: { ...process.env, PATH: fixture.path, STUB_MODE: mode },
          encoding: 'utf8'
        })
        expect(result.status === 0, `${mode}: ${result.stderr}`).toBe(mode === 'success')
        expect(readFileSync(fixture.manifestPath)).toEqual(fixture.originalManifest)
        expect(readFileSync(fixture.publishLog, 'utf8')).toBe('private-removed\n')
      } finally {
        rmSync(fixture.directory, { recursive: true, force: true })
      }
    }

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const fixture = createPublishFixture()
      try {
        const child = spawn('make', ['PACKAGE=utils', 'publish'], {
          cwd: fixture.directory,
          detached: true,
          env: {
            ...process.env,
            PATH: fixture.path,
            STUB_MODE: 'wait',
            STUB_READY: fixture.readyPath
          },
          stdio: 'ignore'
        })
        await waitForFile(fixture.readyPath, 10_000)
        process.kill(-child.pid!, signal)
        const result = await waitForExit(child, 10_000)
        expect(result.code === 0, `${signal}:${String(result.signal)}`).toBe(false)
        expect(readFileSync(fixture.manifestPath)).toEqual(fixture.originalManifest)
        expect(readFileSync(fixture.publishLog, 'utf8')).toBe('private-removed\n')
      } finally {
        rmSync(fixture.directory, { recursive: true, force: true })
      }
    }
  }, 60_000)
})

type IPublishFixture = {
  readonly directory: string
  readonly manifestPath: string
  readonly originalManifest: Buffer
  readonly path: string
  readonly publishLog: string
  readonly readyPath: string
}

/** Packs and inspects every foundation artifact without installing it into the consumer root. */
function packReleaseArtifacts(
  smokeDirectory: string,
  sourceRoot = repositoryRoot,
  definitions = packedPackages
): readonly IPackedArtifact[] {
  const packDirectory = join(smokeDirectory, 'pack')
  const inspectionDirectory = join(smokeDirectory, 'inspection')
  mkdirSync(packDirectory, { recursive: true })
  mkdirSync(inspectionDirectory, { recursive: true })
  for (const definition of definitions) {
    const packageDirectory =
      definition.sourceDirectory ?? resolve(sourceRoot, 'packages', definition.directory)
    execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
      cwd: packageDirectory,
      stdio: 'pipe'
    })
  }

  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
  expect(tarballs).toHaveLength(definitions.length)
  return tarballs.map((tarball): IPackedArtifact => {
    const tarballPath = join(packDirectory, tarball)
    const contents = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
      .trim()
      .split('\n')
    expect(contents).toContain('package/package.json')
    expect(contents.some((entry) => /^package\/(?:src|test|e2e)\//.test(entry))).toBe(false)

    const manifestText = execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
      encoding: 'utf8'
    })
    const packedManifest = JSON.parse(manifestText) as Record<string, unknown>
    const definition = definitions.find(({ name }) => name === packedManifest.name)
    expect(definition, String(packedManifest.name)).toBeDefined()
    expect(packedManifest.version).toBe(definition!.version)
    const extractDirectory = join(inspectionDirectory, definition!.directory)
    mkdirSync(extractDirectory, { recursive: true })
    execFileSync('tar', ['-xzf', tarballPath, '--strip-components=1', '-C', extractDirectory])

    const exports = packedManifest.exports as Record<string, Readonly<Record<string, string>>>
    for (const [exportName, targets] of Object.entries(exports)) {
      expect(
        hasPackedTarget(extractDirectory, targets.types),
        `${tarball}:${exportName}:types`
      ).toBe(true)
      for (const [condition, target] of Object.entries(targets)) {
        if (condition === 'types') continue
        expect(
          hasPackedTarget(extractDirectory, target),
          `${tarball}:${exportName}:${condition}`
        ).toBe(true)
      }
    }
    const dependencies = (packedManifest.dependencies ?? {}) as Record<string, string>
    for (const dependency of definitions) {
      if (!(dependency.name in dependencies)) continue
      expect(dependencies[dependency.name], `${tarball}:${dependency.name}`).toBe(
        dependency.name === 'ansis' ? dependency.version : `^${dependency.version}`
      )
    }
    return {
      definition: definition!,
      extractDirectory,
      integrity: storageV2TarballIntegrity(readFileSync(tarballPath)),
      tarballPath
    }
  })
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

/** Repackages storage-web after deleting one dependency to prove phantom resolution fails closed. */
function createDependencyOmissionArtifact(
  smokeDirectory: string,
  sourceArtifact: IPackedArtifact,
  omittedDependency: string
): IPackedArtifact {
  const malformedRoot = join(smokeDirectory, 'malformed')
  const malformedPackage = join(malformedRoot, 'package')
  const tarballPath = join(smokeDirectory, 'migaia-storage-web-missing-dependency.tgz')
  cpSync(sourceArtifact.extractDirectory, malformedPackage, { recursive: true })
  const manifestPath = join(malformedPackage, 'package.json')
  const manifest = readJson(manifestPath)
  const dependencies = { ...((manifest.dependencies ?? {}) as Record<string, string>) }
  delete dependencies[omittedDependency]
  writeFileSync(
    manifestPath,
    `${JSON.stringify({ ...manifest, dependencies }, undefined, 2)}\n`,
    'utf8'
  )
  execFileSync('tar', ['-czf', tarballPath, '-C', malformedRoot, 'package'])
  return {
    ...sourceArtifact,
    extractDirectory: malformedPackage,
    integrity: storageV2TarballIntegrity(readFileSync(tarballPath)),
    tarballPath
  }
}

/** Repackages a disposable Storage artifact after one isolated packed-runtime perturbation. */
function createStorageWebMutationArtifact(
  smokeDirectory: string,
  sourceArtifact: IPackedArtifact,
  name: string,
  mutate: (packageDirectory: string) => void
): IPackedArtifact {
  const mutationRoot = join(smokeDirectory, `ys20-${name}`)
  const packageDirectory = join(mutationRoot, 'package')
  const tarballPath = join(smokeDirectory, `migaia-storage-web-${name}.tgz`)
  cpSync(sourceArtifact.extractDirectory, packageDirectory, { recursive: true })
  mutate(packageDirectory)
  execFileSync('tar', ['-czf', tarballPath, '-C', mutationRoot, 'package'])
  return {
    ...sourceArtifact,
    extractDirectory: packageDirectory,
    integrity: storageV2TarballIntegrity(readFileSync(tarballPath)),
    tarballPath
  }
}

/** Verifies lock locators and installed links before authorizing package roots. */
function inspectInstalledPackageRoots(
  consumerDirectory: string,
  artifacts: readonly IPackedArtifact[],
  expectedPackages?: ReadonlyMap<string, IInstalledPackageIdentity>,
  roots: readonly string[] = browserPackedRoots
): ReadonlyMap<string, IInstalledPackageIdentity> {
  const generatedLockfile = readFileSync(join(consumerDirectory, 'pnpm-lock.yaml'), 'utf8')
  const canonicalConsumerDirectory = realpathSync(consumerDirectory)
  const modulesManifest = readJson(join(consumerDirectory, 'node_modules', '.modules.yaml'))
  expect(modulesManifest.virtualStoreDir, 'pnpm virtual-store location').toBe('.pnpm')
  expect(modulesManifest.virtualStoreDirMaxLength, 'pnpm virtual-store filename limit').toBe(
    pnpmVirtualStoreDirMaxLength
  )

  const preauthorizedPackages = authorizeImporterResolvedPackages(
    generatedLockfile,
    canonicalConsumerDirectory,
    artifacts,
    roots
  )
  expect(preauthorizedPackages.size).toBe(artifacts.length)

  for (const name of roots) {
    const direct = join(consumerDirectory, 'node_modules', ...name.split('/'))
    expect(realpathSync(direct), `${name} direct packed link`).toBe(
      preauthorizedPackages.get(name)?.root
    )
  }

  const installedPackages = new Map<string, IInstalledPackageIdentity>()
  for (const {
    artifact,
    lockIdentity,
    root: expectedRoot,
    tarballLocator
  } of preauthorizedPackages.values()) {
    const { definition } = artifact
    const installedPackageRoots = inspectVirtualStorePackageRoots(
      consumerDirectory,
      definition.name
    )
    const installedRoot = installedPackageRoots[0]
    if (installedRoot === undefined) throw new Error(`missing installed root: ${definition.name}`)
    expect(installedRoot, `${definition.name} pre-authorized virtual-store root`).toBe(expectedRoot)
    const manifest = readJson(join(installedRoot, 'package.json'))
    const packedContentSha256 = packageContentSha256(artifact.extractDirectory)
    const installedContentSha256 = packageContentSha256(installedRoot)
    expect(manifest.name, definition.name).toBe(definition.name)
    expect(manifest.version, definition.name).toBe(definition.version)
    expect(installedPackageRoots, `${definition.name} virtual-store roots`).toEqual([installedRoot])
    expect(installedContentSha256, `${definition.name} installed content`).toBe(packedContentSha256)
    const installedIdentity: IInstalledPackageIdentity = {
      contentSha256: installedContentSha256,
      lockIdentity,
      root: installedRoot,
      tarballLocator,
      version: definition.version
    }
    if (expectedPackages !== undefined)
      expect(installedIdentity, `${definition.name} fresh-install receipt`).toEqual(
        expectedPackages.get(definition.name)
      )
    installedPackages.set(definition.name, installedIdentity)
  }
  expect(installedPackages.size).toBe(artifacts.length)
  if (expectedPackages !== undefined)
    expect([...installedPackages.keys()].sort(), 'fresh-install receipt package set').toEqual(
      [...expectedPackages.keys()].sort()
    )
  return installedPackages
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

/** Proves copied roots and forged receipts fail before the first authoritative inspection. */
function assertPreInspectionArtifactProvenanceHostiles(
  consumerDirectory: string,
  artifacts: readonly IPackedArtifact[]
): void {
  const directStorageWeb = join(consumerDirectory, 'node_modules', '@migaia', 'storage-web')
  const installedScope = resolve(realpathSync(directStorageWeb), '..')
  const installedUtilsLink = join(installedScope, 'utils')
  const installedUtilsRoot = realpathSync(installedUtilsLink)
  const originalUtilsLinkTarget = readlinkSync(installedUtilsLink)
  const originalUtilsRootBackup = `${installedUtilsRoot}-pre-inspection`
  const forgedVirtualStoreEntry = join(
    consumerDirectory,
    'node_modules',
    '.pnpm',
    '@migaia+utils@file+forged-before-inspection'
  )
  const forgedUtilsRoot = join(forgedVirtualStoreEntry, 'node_modules', '@migaia', 'utils')
  mkdirSync(dirname(forgedUtilsRoot), { recursive: true })
  cpSync(installedUtilsRoot, forgedUtilsRoot, { recursive: true })
  try {
    rmSync(installedUtilsLink)
    renameSync(installedUtilsRoot, originalUtilsRootBackup)
    symlinkSync(relative(dirname(installedUtilsLink), forgedUtilsRoot), installedUtilsLink, 'dir')
    expect(() => inspectInstalledPackageRoots(consumerDirectory, artifacts)).toThrow()

    const utilsArtifact = artifactFor(artifacts, '@migaia/utils')
    const tarballLocator = `file:${relative(
      realpathSync(consumerDirectory),
      utilsArtifact.tarballPath
    )}`
    const forgedReceipt = new Map<string, IInstalledPackageIdentity>([
      [
        '@migaia/utils',
        {
          contentSha256: packageContentSha256(forgedUtilsRoot),
          lockIdentity: `@migaia/utils@${tarballLocator}`,
          root: realpathSync(forgedUtilsRoot),
          tarballLocator,
          version: utilsArtifact.definition.version
        }
      ]
    ])
    expect(() =>
      inspectInstalledPackageRoots(consumerDirectory, artifacts, forgedReceipt)
    ).toThrow()
  } finally {
    rmSync(installedUtilsLink)
    renameSync(originalUtilsRootBackup, installedUtilsRoot)
    symlinkSync(originalUtilsLinkTarget, installedUtilsLink, 'dir')
    rmSync(forgedVirtualStoreEntry, { recursive: true, force: true })
  }
}

/** Proves an orphan expected row cannot replace the root importer's resolved dependency edge. */
function assertImporterRootedLockHostiles(
  consumerDirectory: string,
  artifacts: readonly IPackedArtifact[]
): void {
  const lockfilePath = join(consumerDirectory, 'pnpm-lock.yaml')
  const originalLockfile = readFileSync(lockfilePath, 'utf8')
  const storageContractArtifact = artifactFor(artifacts, '@migaia/storage-contract')
  const storageContractIdentity = `@migaia/storage-contract@file:${relative(
    realpathSync(consumerDirectory),
    storageContractArtifact.tarballPath
  )}`
  const hostiles = createStorageV2LockHostiles(originalLockfile, {
    rootPackageName: '@migaia/storage-web',
    rootSpecifierReplacement: 'file:/forged/storage-web.tgz',
    rootVersionReplacement: 'file:../pack/forged-storage-web.tgz',
    transitiveIdentity: storageContractIdentity,
    transitiveDependencyName: '@migaia/utils',
    transitiveReplacement: 'file:../pack/forged-utils.tgz',
    integrity: artifactFor(artifacts, '@migaia/storage-web').integrity,
    swappedIntegrity: artifactFor(artifacts, '@migaia/utils').integrity
  })
  expect(hostiles).toHaveLength(15)
  try {
    for (const hostileLockfile of hostiles) {
      writeFileSync(lockfilePath, hostileLockfile, 'utf8')
      expect(() => inspectInstalledPackageRoots(consumerDirectory, artifacts)).toThrow()
    }
  } finally {
    writeFileSync(lockfilePath, originalLockfile, 'utf8')
  }
}

/** Proves copied roots, orphaned lock identities and installed-content drift fail admission. */
function assertInstalledArtifactProvenanceHostiles(
  consumerDirectory: string,
  artifacts: readonly IPackedArtifact[],
  installedPackages: ReadonlyMap<string, IInstalledPackageIdentity>
): void {
  const directStorageWeb = join(consumerDirectory, 'node_modules', '@migaia', 'storage-web')
  const installedScope = resolve(realpathSync(directStorageWeb), '..')
  const installedUtilsLink = join(installedScope, 'utils')
  const installedUtilsRoot = realpathSync(installedUtilsLink)
  const originalUtilsLinkTarget = readlinkSync(installedUtilsLink)
  const forgedVirtualStoreEntry = join(
    consumerDirectory,
    'node_modules',
    '.pnpm',
    '@migaia+utils@file+forged'
  )
  const forgedUtilsRoot = join(forgedVirtualStoreEntry, 'node_modules', '@migaia', 'utils')
  const originalUtilsRootBackup = `${installedUtilsRoot}-fresh-install-receipt`
  mkdirSync(dirname(forgedUtilsRoot), { recursive: true })
  cpSync(installedUtilsRoot, forgedUtilsRoot, { recursive: true })
  try {
    rmSync(installedUtilsLink)
    renameSync(installedUtilsRoot, originalUtilsRootBackup)
    symlinkSync(relative(dirname(installedUtilsLink), forgedUtilsRoot), installedUtilsLink, 'dir')
    expect(() =>
      inspectInstalledPackageRoots(consumerDirectory, artifacts, installedPackages)
    ).toThrow()
  } finally {
    rmSync(installedUtilsLink)
    renameSync(originalUtilsRootBackup, installedUtilsRoot)
    symlinkSync(originalUtilsLinkTarget, installedUtilsLink, 'dir')
    rmSync(forgedVirtualStoreEntry, { recursive: true, force: true })
  }

  const lockfilePath = join(consumerDirectory, 'pnpm-lock.yaml')
  const originalLockfile = readFileSync(lockfilePath, 'utf8')
  const utilsArtifact = artifactFor(artifacts, '@migaia/utils')
  const expectedLockIdentity = `@migaia/utils@file:${relative(
    realpathSync(consumerDirectory),
    utilsArtifact.tarballPath
  )}`
  const mismatchedLockIdentity = '@migaia/utils@file:../pack/orphaned-utils.tgz'
  expect(originalLockfile.split(expectedLockIdentity)).toHaveLength(3)
  try {
    writeFileSync(
      lockfilePath,
      originalLockfile.replace(expectedLockIdentity, mismatchedLockIdentity),
      'utf8'
    )
    expect(() =>
      inspectInstalledPackageRoots(consumerDirectory, artifacts, installedPackages)
    ).toThrow()
  } finally {
    writeFileSync(lockfilePath, originalLockfile, 'utf8')
  }

  const installedManifestPath = join(installedUtilsRoot, 'package.json')
  const originalInstalledManifest = readFileSync(installedManifestPath, 'utf8')
  try {
    const installedManifest = JSON.parse(originalInstalledManifest) as Record<string, unknown>
    writeFileSync(
      installedManifestPath,
      `${JSON.stringify({ ...installedManifest, provenanceProbe: true }, undefined, 2)}\n`,
      'utf8'
    )
    expect(() =>
      inspectInstalledPackageRoots(consumerDirectory, artifacts, installedPackages)
    ).toThrow()
  } finally {
    writeFileSync(installedManifestPath, originalInstalledManifest, 'utf8')
  }
}

/** Creates a network-free publish fixture whose tools expose manifest state and failure mode. */
function createPublishFixture(): IPublishFixture {
  const directory = mkdtempSync(join(tmpdir(), 'migaia-storage-v2-d18-'))
  const packageDirectory = join(directory, 'packages', 'utils')
  const binDirectory = join(directory, 'bin')
  const manifestPath = join(packageDirectory, 'package.json')
  const publishLog = join(directory, 'publish.log')
  const readyPath = join(directory, 'ready')
  mkdirSync(packageDirectory, { recursive: true })
  mkdirSync(binDirectory, { recursive: true })
  copyFileSync(resolve(repositoryRoot, 'Makefile'), join(directory, 'Makefile'))
  copyFileSync(resolve(repositoryRoot, 'packages/utils/package.json'), manifestPath)
  const originalManifest = readFileSync(manifestPath)

  const pnpmStub = join(binDirectory, 'pnpm')
  writeFileSync(
    pnpmStub,
    `#!/bin/sh
set -eu
if [ "\${1-}" = whoami ]; then exit 0; fi
if [ "\${1-}" != --filter ] || [ "\${2-}" != ./packages/utils ] || [ "\${3-}" != run ] || [ "\${4-}" != release:publish ]; then exit 90; fi
if grep -q '"private"[[:space:]]*:[[:space:]]*true' packages/utils/package.json; then exit 91; fi
printf 'private-removed\\n' > '${publishLog}'
case "\${STUB_MODE-}" in
  success) exit 0 ;;
  failure) exit 42 ;;
  wait)
    : > "\${STUB_READY}"
    trap 'exit 130' INT
    trap 'exit 143' TERM
    while :; do sleep 1; done
    ;;
  *) exit 92 ;;
esac
`,
    'utf8'
  )
  chmodSync(pnpmStub, 0o755)

  const gitStub = join(binDirectory, 'git')
  writeFileSync(
    gitStub,
    `#!/bin/sh
set -eu
if [ "\${1-}" = symbolic-ref ]; then printf 'main\\n'; exit 0; fi
if [ "\${1-}" = status ]; then exit 0; fi
if [ "\${1-}" = log ]; then printf 'fixture-release-commit\\n'; exit 0; fi
if [ "\${1-}" = show ]; then
  version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' packages/utils/package.json)
  printf 'chore(release): utils v%s\\n' "$version"
  exit 0
fi
if [ "\${1-}" = rev-parse ]; then exit 1; fi
if [ "\${1-}" = ls-remote ]; then exit 0; fi
exit 0
`,
    'utf8'
  )
  chmodSync(gitStub, 0o755)

  return {
    directory,
    manifestPath,
    originalManifest,
    path: `${binDirectory}:${process.env.PATH ?? ''}`,
    publishLog,
    readyPath
  }
}

/** Resolves both concrete and wildcard export targets inside one extracted tarball. */
function hasPackedTarget(packageDirectory: string, target: string): boolean {
  const relativeTarget = target.replace(/^\.\//, '')
  if (!relativeTarget.includes('*')) return existsSync(resolve(packageDirectory, relativeTarget))
  const [prefix, suffix] = relativeTarget.split('*') as [string, string]
  return readdirSync(packageDirectory, { recursive: true }).some((entry) => {
    const relativeEntry = String(entry)
    return relativeEntry.startsWith(prefix) && relativeEntry.endsWith(suffix)
  })
}

/** Waits for a child process to terminate and kills the isolated group if the fixture stalls. */
function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      try {
        process.kill(-child.pid!, 'SIGKILL')
      } catch {}
      rejectExit(new Error('publish fixture did not terminate'))
    }, timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolveExit({ code, signal })
    })
  })
}

/** Polls a local readiness file with a finite deadline before sending a signal. */
async function waitForFile(fileName: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(fileName)) {
    if (Date.now() >= deadline) throw new Error(`publish fixture never became ready: ${fileName}`)
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10))
  }
}
