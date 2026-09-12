import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  buildCanonicalRetainedGraph,
  input,
  packageDirectory,
  resolveCanonicalBuildConfig
} from './tree-shaking-canonical-build.mjs'
import {
  digestProvenanceSubject,
  sizeTuple,
  validateAuthorization
} from './tree-shaking-authorization.mjs'
import {
  normalizeOwnedSemanticModules,
  resolveSourceMapSources
} from '../../../scripts/package-tree-shaking-provenance.mjs'

const repositoryRoot = resolve(packageDirectory, '../..')
process.chdir(repositoryRoot)
const authorizationPath = resolve(
  packageDirectory,
  'test/fixtures/tree-shaking/current-delivery-approval.json'
)
const authorityPath = resolve(
  packageDirectory,
  'test/fixtures/tree-shaking/current-delivery-authority.json'
)

/** Returns the owning workspace package for a physical retained module. */
function ownerForModule(modulePath) {
  const packageMatch = modulePath.match(`${repositoryRoot}/packages/([^/]+)/(.+)$`)
  if (!packageMatch) return null
  const packageRoot = resolve(repositoryRoot, 'packages', packageMatch[1])
  const packageManifest = resolve(packageRoot, 'package.json')
  if (!existsSync(packageManifest)) return null
  const packageName = JSON.parse(readFileSync(packageManifest, 'utf8')).name
  if (typeof packageName !== 'string' || !packageName) return null
  return { packageName, packageRoot }
}

/** Hashes bytes with a stable algorithm for provenance comparison. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Returns a repository-relative path when an input belongs to this workspace. */
function displayPath(filePath) {
  return relative(repositoryRoot, filePath) || filePath
}

/** Reads one retained input and records its content identity and byte size. */
function hashInput(filePath, kind) {
  const bytes = readFileSync(filePath)
  return { path: displayPath(filePath), kind, bytes: bytes.byteLength, sha256: sha256(bytes) }
}

/** Reads a package version without resolving through a workspace alias. */
function packageVersion(packageName) {
  try {
    const directPath = resolve(repositoryRoot, 'node_modules', packageName, 'package.json')
    if (existsSync(directPath)) return JSON.parse(readFileSync(directPath, 'utf8')).version
    const storeEntry = readdirSync(resolve(repositoryRoot, 'node_modules/.pnpm')).find((entry) =>
      entry.startsWith(`${packageName}@`)
    )
    if (!storeEntry) return 'unavailable'
    return JSON.parse(
      readFileSync(
        resolve(
          repositoryRoot,
          'node_modules/.pnpm',
          storeEntry,
          'node_modules',
          packageName,
          'package.json'
        ),
        'utf8'
      )
    ).version
  } catch {
    return 'unavailable'
  }
}

/** Converts resolved Vite metadata to a complete JSON-safe snapshot. */
function serializeResolved(value, path = [], seen = new WeakMap()) {
  if (typeof value === 'function') return '[function]'
  if (typeof value === 'string') return value.replaceAll(repositoryRoot, '[repository-root]')
  if (value === null || typeof value !== 'object') return value
  const previousPath = seen.get(value)
  if (previousPath) return { '[reference]': previousPath }
  seen.set(value, path)
  if (Array.isArray(value))
    return value.map((entry, index) => serializeResolved(entry, [...path, index], seen))
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [
        key,
        path.length === 0 && key === 'webSocketToken'
          ? '[ephemeral:webSocketToken]'
          : serializeResolved(entry, [...path, key], seen)
      ])
  )
}

const output = await buildCanonicalRetainedGraph()
const resolvedConfig = serializeResolved(await resolveCanonicalBuildConfig())
const chunks = (Array.isArray(output) ? output : [output]).flatMap((result) => result.output)
const chunksWithCode = chunks.filter((item) => item.type === 'chunk')
const code = chunksWithCode.map((item) => item.code).join('\n')
const moduleEntries = new Map()
for (const item of chunksWithCode) {
  for (const [module, metadata] of Object.entries(item.modules)) {
    moduleEntries.set(module, {
      module: displayPath(module),
      renderedBytes: metadata.renderedLength ?? 0,
      renderedSha256: typeof metadata.code === 'string' ? sha256(metadata.code) : null,
      originalBytes: metadata.originalLength ?? 0,
      sourceSha256: existsSync(module) ? sha256(readFileSync(module)) : null
    })
  }
}
const retainedModules = [...moduleEntries.values()].sort((left, right) =>
  left.module.localeCompare(right.module)
)
const knownOwners = new Map()
const semanticRecords = []
for (const item of chunksWithCode) {
  if (!item.map) throw new TypeError('retained chunk is missing its emitted sourcemap')
  const emittedFile = resolve(packageDirectory, 'dist', item.fileName)
  const sourcesByOwner = new Map()
  for (const sourcePath of resolveSourceMapSources(item.map, emittedFile)) {
    const owner = ownerForModule(sourcePath)
    if (!owner) throw new TypeError(`retained sourcemap source has no package owner: ${sourcePath}`)
    knownOwners.set(owner.packageName, owner.packageRoot)
    const previous = sourcesByOwner.get(owner.packageName) ?? {
      packageName: owner.packageName,
      packageRoot: owner.packageRoot,
      sourcePaths: [],
      originalBytes: 0,
      renderedBytes: 0
    }
    previous.sourcePaths.push(sourcePath)
    const metadata = moduleEntries.get(sourcePath)
    previous.originalBytes += metadata?.originalBytes ?? 0
    previous.renderedBytes += metadata?.renderedBytes ?? 0
    sourcesByOwner.set(owner.packageName, previous)
  }
  for (const record of sourcesByOwner.values())
    semanticRecords.push({
      ...record,
      emittedPath: emittedFile,
      emittedRole: 'runtime'
    })
}
const semanticModules = normalizeOwnedSemanticModules(semanticRecords, knownOwners)
/** Rolldown's NUL-prefixed helpers are virtual modules, never readable provenance inputs. */
const retainedInputs = [...moduleEntries.keys()]
  .filter((module) => !module.startsWith('\0'))
  .sort()
  .map((module) => hashInput(module, 'retained-module'))
const lockfilePath = resolve(repositoryRoot, 'pnpm-lock.yaml')
const packageManifestPath = resolve(packageDirectory, 'package.json')
const rootManifestPath = resolve(repositoryRoot, 'package.json')
/** Root manifest owns the declared Node and pnpm toolchain contract. */
const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'))
const boundary = {
  fixture: hashInput(input, 'fixture'),
  lockfile: hashInput(lockfilePath, 'lockfile'),
  manifests: [
    hashInput(rootManifestPath, 'root-package-manifest'),
    hashInput(packageManifestPath, 'package-manifest')
  ],
  retainedInputs,
  retainedInputCount: retainedInputs.length
}
/** Exact Node version admitted by the repository manifest. */
const declaredNodeVersion = rootManifest.engines?.node
/** Exact pnpm version admitted by the repository package-manager field. */
const declaredPnpmVersion = rootManifest.packageManager?.match(/^pnpm@(.+)$/)?.[1]
/** Stable failure text for a Node runtime outside the declared toolchain. */
const nodeVersionMismatchText = 'runtime Node version differs from the repository contract'
/** Stable failure text for a pnpm runtime outside the declared toolchain. */
const pnpmVersionMismatchText = 'runtime pnpm version differs from the repository contract'
if (typeof declaredNodeVersion !== 'string' || process.version !== `v${declaredNodeVersion}`)
  throw new TypeError(nodeVersionMismatchText)
if (
  typeof declaredPnpmVersion !== 'string' ||
  execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim() !== declaredPnpmVersion
)
  throw new TypeError(pnpmVersionMismatchText)
const tools = {
  node: declaredNodeVersion,
  pnpm: declaredPnpmVersion,
  vite: packageVersion('vite'),
  rolldown: packageVersion('rolldown'),
  esbuild: packageVersion('esbuild'),
  typescript: packageVersion('typescript'),
  vitest: packageVersion('vitest')
}
const resolvedBuildOptions = {
  root: resolvedConfig.root,
  configFile: resolvedConfig.configFile,
  logLevel: resolvedConfig.logLevel,
  build: {
    write: resolvedConfig.build.write,
    sourcemap: resolvedConfig.build.sourcemap,
    minify: resolvedConfig.build.minify,
    rollupOptions: { input: resolvedConfig.build.rollupOptions.input }
  }
}
const outputOptions = {
  formats: ['es'],
  sourcemap: true,
  minify: false,
  write: false
}
const emitted = {
  moduleCount: retainedModules.length,
  rawBytes: Buffer.byteLength(code),
  gzipBytes: gzipSync(code).byteLength,
  bundleSha256: sha256(Buffer.from(code, 'utf8')),
  modules: retainedModules,
  semanticModules
}
const subject = { boundary, tools, resolvedBuildOptions, outputOptions, emitted }
const canonicalSubject = JSON.parse(JSON.stringify(subject))
const report = {
  schema: 'WRC-C-B11-provenance-v3',
  approval: existsSync(authorizationPath)
    ? JSON.parse(readFileSync(authorizationPath, 'utf8'))
    : { status: 'missing', approvalRecord: null },
  subject: { ...canonicalSubject, digest: digestProvenanceSubject(canonicalSubject) },
  tuple: sizeTuple(emitted)
}
const preMigrationPath = resolve(
  packageDirectory,
  'test/fixtures/tree-shaking/pre-migration-tree-shaking-baseline.json'
)
const preMigrationRoot = JSON.parse(readFileSync(preMigrationPath, 'utf8')).root
const oldTuple = {
  moduleCount: preMigrationRoot.moduleCount,
  rawBytes: preMigrationRoot.rawBytes,
  gzipBytes: preMigrationRoot.gzipBytes
}
const authorizationError = validateAuthorization(report.approval, report.subject, {
  oldTuple,
  newTuple: report.tuple,
  authority: existsSync(authorityPath) ? JSON.parse(readFileSync(authorityPath, 'utf8')) : undefined
})
console.log(JSON.stringify(report, null, 2))
if (authorizationError || report.approval.status !== 'approved') process.exitCode = 2
