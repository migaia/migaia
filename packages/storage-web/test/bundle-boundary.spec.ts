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
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'
import {
  authorizeStorageV2LockProvenance,
  createStorageV2LockHostiles,
  storageV2PinnedPnpmVersion,
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
/** Repository root used by the release and lockfile acceptance probes. */
const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')
/** Exact package-manager version whose virtual-store naming algorithm is reproduced below. */
const pinnedPnpmVersion = storageV2PinnedPnpmVersion
/** Uses pnpm's configured cache so offline packed installs exercise normal dependency resolution. */
const configuredPnpmStoreDirectory = execFileSync('pnpm', ['store', 'path'], {
  cwd: repositoryRoot,
  encoding: 'utf8'
}).trim()
/** Pnpm 11.20.0 default persisted in the fresh consumer's `.modules.yaml`. */
const pnpmVirtualStoreDirMaxLength = storageV2VirtualStoreDirMaxLength
/** D18 foundation order and exact versions authorized for the C2-R4 rehearsal. */
const releasePackages: readonly IPackageDefinition[] = [
  { directory: 'utils', name: '@migaia/utils', version: '0.0.2' },
  { directory: 'event-subscriber', name: '@migaia/event-subscriber', version: '0.0.3' },
  { directory: 'lifecycle', name: '@migaia/lifecycle', version: '0.0.2' },
  { directory: 'reactive', name: '@migaia/reactive', version: '0.0.2' },
  { directory: 'storage-contract', name: '@migaia/storage-contract', version: '0.0.2' },
  { directory: 'storage-web', name: '@migaia/storage-web', version: '0.0.3' }
]
/** Full packed dependency closure required for a normal-resolution storage-web install. */
const packedPackages: readonly IPackageDefinition[] = [
  { directory: 'utils', name: '@migaia/utils', version: '0.0.2' },
  { directory: 'event-subscriber', name: '@migaia/event-subscriber', version: '0.0.3' },
  { directory: 'lifecycle', name: '@migaia/lifecycle', version: '0.0.2' },
  { directory: 'reactive', name: '@migaia/reactive', version: '0.0.2' },
  { directory: 'middleware-pipeline', name: '@migaia/middleware-pipeline', version: '0.0.2' },
  { directory: 'resource', name: '@migaia/resource', version: '0.0.2' },
  { directory: 'storage-contract', name: '@migaia/storage-contract', version: '0.0.2' },
  { directory: 'plugin-host', name: '@migaia/plugin-host', version: '0.0.5' },
  { directory: 'capability', name: '@migaia/capability', version: '0.0.1' },
  { directory: 'storage-web', name: '@migaia/storage-web', version: '0.0.3' }
]
/** Exact memory-only retained graph after package-manager installation of the packed root. */
const expectedRetainedModules = [
  '@migaia/event-subscriber/dist/index.js',
  '@migaia/lifecycle/dist/error-code.js',
  '@migaia/lifecycle/dist/errors.js',
  '@migaia/lifecycle/dist/quiescence-tracker.js',
  '@migaia/storage-contract/dist/index.js',
  '@migaia/storage-web/dist/constants-dsZodWbf.js',
  '@migaia/storage-web/dist/errors-QY7pE_Oy.js',
  '@migaia/storage-web/dist/key-Cp7wL7rA.js',
  '@migaia/storage-web/dist/memory-BKFpDiCE.js',
  '@migaia/storage-web/dist/operation-DeSu1sk5.js',
  '@migaia/storage-web/dist/operation-reporter-CxbWTNcw.js',
  '@migaia/storage-web/dist/query-DPXXsCtN.js',
  '@migaia/storage-web/dist/reactive-controller-B5Zxko2x.js',
  '@migaia/storage-web/dist/transaction-Bi-i3iMi.js',
  '@migaia/utils/dist/bytes.js',
  '@migaia/utils/dist/error-text-Cw8rxmXe.js',
  '@migaia/utils/dist/error.js',
  '@migaia/utils/dist/object-path.js',
  '@migaia/utils/dist/promise.js',
  'app/bundle-entry.js'
] as const
/** Binds the reviewed retained inventory to the root-owned exact-set tool. */
const assertExactRetainedModules = (modules: Iterable<string>): void =>
  assertExactRetainedModuleSet(modules, expectedRetainedModules)
/** Reads one JSON file without allowing a module cache to hide a rewritten manifest. */
const readJson = (fileName: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileName, 'utf8')) as Record<string, unknown>

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
      const packageMatch = normalized.match(/^(@migaia\/[^/]+)\/(.+)$/)
      const packageName = packageMatch?.[1] ?? 'workspace-root'
      const packageRoot =
        packageName === 'workspace-root'
          ? consumerDirectory
          : installedPackages.get(packageName)?.root
      if (!packageRoot) throw new Error(`unknown packed sourcemap owner: ${moduleId}`)
      owners.set(packageName, packageRoot)
      const sourcePath = packageName === 'workspace-root' ? 'bundle-entry.js' : packageMatch![2]
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
describe('SWV2-T58 C2-R4 host and release boundary', () => {
  it('pins D18 order, private manifests, exact exports, lock edges, and fail-closed capabilities', () => {
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

  it('installs the packed root as the sole app dependency and proves exact retained modules', async () => {
    const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-storage-v2-c2-r4-packed-'))
    try {
      const consumerDirectory = join(smokeDirectory, 'consumer')
      const artifacts = packReleaseArtifacts(smokeDirectory)
      installPackedConsumer(consumerDirectory, artifacts, configuredPnpmStoreDirectory)
      const consumerManifest = readJson(join(consumerDirectory, 'package.json'))
      expect(consumerManifest.dependencies).toEqual({
        '@migaia/storage-web': `file:${artifactFor(artifacts, '@migaia/storage-web').tarballPath}`
      })
      expect(readdirSync(join(consumerDirectory, 'node_modules', '@migaia'))).toEqual([
        'storage-web'
      ])
      assertPreInspectionArtifactProvenanceHostiles(consumerDirectory, artifacts)
      assertImporterRootedLockHostiles(consumerDirectory, artifacts)
      const installedPackages = inspectInstalledPackageRoots(consumerDirectory, artifacts)
      assertInstalledArtifactProvenanceHostiles(consumerDirectory, artifacts, installedPackages)
      writeFileSync(
        join(consumerDirectory, 'native-esm.mjs'),
        [
          "import { memoryStorage } from '@migaia/storage-web/memory'",
          "const routes = ['/local-storage', '/session-storage', '/cookies', '/indexed-db', '/host', '/plugins/memory', '/plugins/local-storage', '/plugins/session-storage', '/plugins/cookies', '/plugins/indexed-db', '/plugins/reactive', '/plugins/reactive/memory', '/plugins/reactive/local-storage', '/plugins/reactive/session-storage', '/plugins/reactive/cookies', '/plugins/reactive/indexed-db', '/reactive-adapter', '/entity', '/schema', '/serialize']",
          'await Promise.all(routes.map((route) => import(`@migaia/storage-web${route}`)))',
          'const storage = memoryStorage()',
          "if (storage.capabilities.secondaryIndexes !== false) throw new Error('secondary index capability promoted')",
          'await storage.dispose()'
        ].join('\n'),
        'utf8'
      )
      execFileSync(process.execPath, ['native-esm.mjs'], {
        cwd: consumerDirectory,
        stdio: 'pipe'
      })

      const bundleEntry = join(consumerDirectory, 'bundle-entry.js')
      const bundleDirectory = join(consumerDirectory, 'bundle')
      writeFileSync(
        bundleEntry,
        "import { memoryStorage } from '@migaia/storage-web/memory'; const storage = memoryStorage(); export const accepted = storage.capabilities.secondaryIndexes === false; await storage.dispose();\n",
        'utf8'
      )
      const retainedModuleIds = new Set<string>()
      const retainedOutputs: {
        readonly fileName: string
        readonly map: unknown
        readonly modules: Readonly<Record<string, unknown>>
      }[] = []
      await build({
        configFile: false,
        logLevel: 'silent',
        root: consumerDirectory,
        plugins: [
          {
            name: 'storage-v2-retained-module-ledger',
            generateBundle(_options, bundle) {
              for (const output of Object.values(bundle)) {
                if (output.type !== 'chunk') continue
                if (!output.map) throw new Error('packed retained chunk is missing its sourcemap')
                retainedOutputs.push({
                  fileName: output.fileName,
                  map: output.map,
                  modules: output.modules
                })
                for (const moduleId of Object.keys(output.modules)) retainedModuleIds.add(moduleId)
              }
            }
          }
        ],
        build: {
          outDir: bundleDirectory,
          emptyOutDir: true,
          minify: false,
          sourcemap: true,
          lib: { entry: bundleEntry, formats: ['es'], fileName: () => 'consumer.js' }
        }
      })
      assertExactRetainedModules(
        normalizeRetainedModules(retainedModuleIds, consumerDirectory, installedPackages)
      )
      const semanticRetained = normalizeSemanticRetainedGraph(
        retainedOutputs,
        consumerDirectory,
        installedPackages
      )
      const renamedOutput = await build({
        configFile: false,
        logLevel: 'silent',
        root: consumerDirectory,
        build: {
          write: false,
          minify: false,
          sourcemap: true,
          lib: { entry: bundleEntry, formats: ['es'], fileName: () => 'consumer-[hash].js' }
        }
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
      const bundle = readFileSync(join(bundleDirectory, 'consumer.js'), 'utf8')
      expect(bundle).not.toMatch(/(?:from\s*|import\()['"]@migaia\//)
      expect(bundle).not.toContain('indexedDB')
      expect(bundle).not.toContain('document.cookie')
      expect(bundle).not.toContain('localStorage')
      execFileSync(process.execPath, [join(bundleDirectory, 'consumer.js')], {
        cwd: consumerDirectory,
        stdio: 'pipe'
      })
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
        artifacts.filter(({ definition }) => definition.name !== '@migaia/event-subscriber'),
        configuredPnpmStoreDirectory,
        malformedArtifact
      )
      const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', "await import('@migaia/storage-web/memory')"],
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
function packReleaseArtifacts(smokeDirectory: string): readonly IPackedArtifact[] {
  const packDirectory = join(smokeDirectory, 'pack')
  const inspectionDirectory = join(smokeDirectory, 'inspection')
  mkdirSync(packDirectory, { recursive: true })
  mkdirSync(inspectionDirectory, { recursive: true })
  for (const definition of packedPackages) {
    const packageDirectory = resolve(repositoryRoot, 'packages', definition.directory)
    execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
      cwd: packageDirectory,
      stdio: 'pipe'
    })
  }

  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
  expect(tarballs).toHaveLength(packedPackages.length)
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
    const definition = packedPackages.find(({ name }) => name === packedManifest.name)
    expect(definition, String(packedManifest.name)).toBeDefined()
    expect(packedManifest.version).toBe(definition!.version)
    const extractDirectory = join(inspectionDirectory, definition!.directory)
    mkdirSync(extractDirectory, { recursive: true })
    execFileSync('tar', ['-xzf', tarballPath, '--strip-components=1', '-C', extractDirectory])

    const exports = packedManifest.exports as Record<
      string,
      { readonly types: string; readonly default: string }
    >
    for (const [exportName, targets] of Object.entries(exports)) {
      expect(
        hasPackedTarget(extractDirectory, targets.types),
        `${tarball}:${exportName}:types`
      ).toBe(true)
      expect(
        hasPackedTarget(extractDirectory, targets.default),
        `${tarball}:${exportName}:default`
      ).toBe(true)
    }
    const dependencies = (packedManifest.dependencies ?? {}) as Record<string, string>
    for (const dependency of packedPackages) {
      if (!(dependency.name in dependencies)) continue
      expect(dependencies[dependency.name], `${tarball}:${dependency.name}`).toBe(
        `^${dependency.version}`
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

/** Installs one packed storage-web dependency while pnpm resolves all transitives from tarballs. */
function installPackedConsumer(
  consumerDirectory: string,
  artifacts: readonly IPackedArtifact[],
  storeDirectory: string,
  rootArtifact = artifactFor(artifacts, '@migaia/storage-web')
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
        packageManager: `pnpm@${pinnedPnpmVersion}`,
        dependencies: { '@migaia/storage-web': `file:${rootArtifact.tarballPath}` }
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
  expect(execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()).toBe(pinnedPnpmVersion)
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

/** Verifies lock locators and installed links before authorizing package roots. */
function inspectInstalledPackageRoots(
  consumerDirectory: string,
  artifacts: readonly IPackedArtifact[],
  expectedPackages?: ReadonlyMap<string, IInstalledPackageIdentity>
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
    artifacts
  )
  expect(preauthorizedPackages.size).toBe(packedPackages.length)

  const directStorageWeb = join(consumerDirectory, 'node_modules', '@migaia', 'storage-web')
  const expectedStorageWebRoot = preauthorizedPackages.get('@migaia/storage-web')?.root
  expect(expectedStorageWebRoot).toBeDefined()
  expect(realpathSync(directStorageWeb), '@migaia/storage-web direct link').toBe(
    expectedStorageWebRoot
  )
  const installedScope = resolve(expectedStorageWebRoot!, '..')
  expect(readdirSync(installedScope).sort()).toEqual(
    packedPackages
      .filter(({ directory }) => directory !== 'middleware-pipeline')
      .map(({ name }) => name.slice('@migaia/'.length))
      .sort()
  )

  const installedPackages = new Map<string, IInstalledPackageIdentity>()
  for (const {
    artifact,
    lockIdentity,
    root: expectedRoot,
    tarballLocator
  } of preauthorizedPackages.values()) {
    const { definition } = artifact
    const installedLink =
      definition.name === '@migaia/storage-web'
        ? directStorageWeb
        : join(installedScope, definition.directory)
    const installedPackageRoots = inspectVirtualStorePackageRoots(
      consumerDirectory,
      definition.name
    )
    const installedRoot =
      definition.directory === 'middleware-pipeline'
        ? installedPackageRoots[0]
        : realpathSync(installedLink)
    if (installedRoot === undefined) throw new Error(`missing installed root: ${definition.name}`)
    expect(installedRoot, `${definition.name} pre-authorized virtual-store root`).toBe(expectedRoot)
    if (definition.directory !== 'middleware-pipeline') {
      const installedLinkTarget = readlinkSync(installedLink)
      expect(
        realpathSync(resolve(dirname(installedLink), installedLinkTarget)),
        `${definition.name} link target`
      ).toBe(expectedRoot)
    }
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
  expect(installedPackages.size).toBe(packedPackages.length)
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
  artifacts: readonly IPackedArtifact[]
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
      >
    }))
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
if [ "\${1-}" != @utils ] || [ "\${2-}" != release:publish ]; then exit 90; fi
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
if [ "\${1-}" = rev-parse ] && [ "\${2-}" = --abbrev-ref ]; then printf 'fixture\\n'; exit 0; fi
if [ "\${1-}" = rev-parse ]; then exit 1; fi
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
