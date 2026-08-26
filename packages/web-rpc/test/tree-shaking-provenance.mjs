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

const repositoryRoot = resolve(packageDirectory, '../..')
process.chdir(repositoryRoot)
const authorizationPath = resolve(
  packageDirectory,
  'test/fixtures/tree-shaking/baseline-authorization.json'
)
const authorityPath = resolve(
  packageDirectory,
  'test/fixtures/tree-shaking/baseline-authority.json'
)

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
const retainedInputs = [...moduleEntries.keys()]
  .sort()
  .map((module) => hashInput(module, 'retained-module'))
const lockfilePath = resolve(repositoryRoot, 'pnpm-lock.yaml')
const packageManifestPath = resolve(packageDirectory, 'package.json')
const rootManifestPath = resolve(repositoryRoot, 'package.json')
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
const tools = {
  node: process.version,
  pnpm: execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
  vite: packageVersion('vite'),
  rolldown: packageVersion('rolldown'),
  esbuild: packageVersion('esbuild'),
  typescript: packageVersion('typescript'),
  vitest: packageVersion('vitest'),
  platform: process.platform,
  arch: process.arch,
  zlib: process.versions.zlib,
  openssl: process.versions.openssl
}
const resolvedBuildOptions = resolvedConfig
const outputOptions = {
  formats: ['es'],
  sourcemap: false,
  minify: false,
  write: false
}
const emitted = {
  moduleCount: retainedModules.length,
  rawBytes: Buffer.byteLength(code),
  gzipBytes: gzipSync(code).byteLength,
  bundleSha256: sha256(Buffer.from(code, 'utf8')),
  modules: retainedModules
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
const oldTuple = { moduleCount: 53, rawBytes: 250129, gzipBytes: 61171 }
const authorizationError = validateAuthorization(report.approval, report.subject, {
  oldTuple,
  newTuple: report.tuple,
  authority: existsSync(authorityPath) ? JSON.parse(readFileSync(authorityPath, 'utf8')) : undefined
})
console.log(JSON.stringify(report, null, 2))
if (authorizationError || report.approval.status !== 'approved') process.exitCode = 2
