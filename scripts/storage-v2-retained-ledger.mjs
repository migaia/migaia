import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { parseSync } from 'oxc-parser'

/**
 * Parsed entry references belong to one admitted immutable package snapshot. Weak keys release the
 * cache with its package record; each same-stem entry is read and parsed only once per snapshot.
 *
 * @type {WeakMap<object, Map<string, ReadonlySet<string>>>}
 */
const entryImportsByPackage = new WeakMap()

/**
 * Converts one raw bundler module ID only after proving its installed package root. Non-package,
 * qualified, virtual, unresolved, foreign, and escaped IDs retain distinct labels.
 *
 * @param {string} moduleId Raw bundler module identity
 * @param {string} consumerDirectory Fresh consumer root
 * @param {ReadonlyMap<string, { readonly root: string }>} installedPackages Admitted package roots
 * @returns {string} Stable retained-module identity
 */
export function normalizeRetainedModule(moduleId, consumerDirectory, installedPackages) {
  /** Canonical app entry is the only non-package identity admitted as the consumer source. */
  const entry = resolve(realpathSync(consumerDirectory), 'bundle-entry.js')
  if (moduleId === entry) return 'app/bundle-entry.js'
  if (moduleId.startsWith('\0')) return `virtual:${moduleId.slice(1)}`
  if (moduleId.includes('?') || moduleId.includes('#')) return `qualified:${moduleId}`
  /** Nearest dependency boundary identifies scoped and unscoped packages without trusting names. */
  const packageMarker = '/node_modules/'
  /** Last marker handles pnpm's nested virtual-store paths. */
  const packageIndex = moduleId.lastIndexOf(packageMarker)
  if (packageIndex >= 0) {
    /** Package-relative identity begins after the nearest node_modules segment. */
    const packageRelativeId = moduleId.slice(packageIndex + packageMarker.length)
    /** Scope and package segment identify the package before any module path. */
    const [scopeOrName, packageSegment] = packageRelativeId.split('/')
    /** Exact package name indexes the roots already authorized from packed content and SRI. */
    const packageName = scopeOrName.startsWith('@')
      ? `${scopeOrName}/${packageSegment}`
      : scopeOrName
    /** Authorization is supplied by the strict lock/root/content verifier. */
    const approvedPackage = installedPackages.get(packageName)
    if (approvedPackage === undefined)
      return packageName.startsWith('@migaia/')
        ? `unapproved-package:${moduleId}`
        : `package:${packageRelativeId}`
    /** Raw package root is canonicalized separately from the requested module. */
    const rawPackageRoot = moduleId.slice(
      0,
      packageIndex + packageMarker.length + packageName.length
    )
    /** Canonical package root rejects aliases to another installed tree. */
    let canonicalPackageRoot
    /** Canonical module path rejects dangling and escaping symlinks. */
    let canonicalModule
    try {
      canonicalPackageRoot = realpathSync(rawPackageRoot)
      canonicalModule = realpathSync(moduleId)
    } catch {
      return `unresolved-package:${moduleId}`
    }
    if (canonicalPackageRoot !== approvedPackage.root) return `foreign-package:${moduleId}`
    /** Relative module path must remain inside the exact authorized package root. */
    const packageModule = relative(approvedPackage.root, canonicalModule)
    if (packageModule === '' || packageModule.startsWith('..') || isAbsolute(packageModule))
      return `escaped-package:${moduleId}`
    /** Only source-map or declared-entry evidence can identify a generated chunk suffix. */
    const stablePackageModule = normalizePackageChunk(
      packageModule,
      canonicalModule,
      approvedPackage
    )
    return `${packageName}/${stablePackageModule}`
  }
  return `path:${moduleId}`
}

/**
 * Distinguishes a generated chunk from a semantic module name using admitted package files. The
 * suffix shape selects candidates only; missing or inconclusive metadata preserves the raw name.
 *
 * @param {string} packageModule Exact package-relative module path
 * @param {string} canonicalModule Exact canonical module filename
 * @param {{ readonly root: string }} approvedPackage Admitted immutable package snapshot
 * @returns {string} Original semantic path or proven stable chunk identity
 */
function normalizePackageChunk(packageModule, canonicalModule, approvedPackage) {
  /** The former suffix pattern is only a candidate shape, never proof that a suffix is a hash. */
  const candidate = /^(dist\/[^/]+)-[A-Za-z0-9_-]{8}\.js$/.exec(packageModule)
  if (!candidate) return packageModule
  if (existsSync(resolve(approvedPackage.root, packageModule.replace(/\.js$/, '.d.ts'))))
    return packageModule
  /** Source-map ownership must match this exact emitted file before source names are evidence. */
  const sourceMap = readChunkSourceMap(canonicalModule)
  if (!sourceMap) return packageModule
  /** A source with the complete emitted stem proves the suffix is part of its semantic name. */
  const completeStem = basename(packageModule, '.js')
  /** A source matching the stem before the suffix proves this is its generated output variant. */
  const chunkStem = basename(candidate[1])
  /** Scan all sources so a complete semantic name always takes precedence over a shorter stem. */
  let generatedSource = false
  for (const source of sourceMap.sources) {
    /** Paths are source-map metadata; packed packages need not include their original src tree. */
    const sourceStem = basename(source, extname(source))
    if (sourceStem === completeStem) return packageModule
    if (sourceStem === chunkStem) generatedSource = true
  }
  if (
    generatedSource ||
    readStableEntryImports(approvedPackage, `${candidate[1]}.js`).has(canonicalModule)
  )
    return `${candidate[1]}-[chunk].js`
  return packageModule
}

/**
 * Reads source identities only from the map naming this exact emitted module. Missing, malformed,
 * or mismatched maps provide no normalization authority and leave the original module distinct.
 *
 * @param {string} canonicalModule Exact admitted JavaScript module filename
 * @returns {{ readonly sources: readonly string[] } | undefined} Proven source-map identities
 */
function readChunkSourceMap(canonicalModule) {
  try {
    /** Bundler metadata is read without requiring unpublished source files to exist on disk. */
    const sourceMap = JSON.parse(readFileSync(`${canonicalModule}.map`, 'utf8'))
    if (sourceMap?.file !== basename(canonicalModule) || !Array.isArray(sourceMap.sources))
      return undefined
    for (const source of sourceMap.sources) if (typeof source !== 'string') return undefined
    return { sources: sourceMap.sources }
  } catch {
    // An unproven candidate retains its raw identity for the unchanged exact-set gate.
    return undefined
  }
}

/**
 * Resolves actual static imports from a same-stem declared entry. This proves multi-source chunks
 * such as utils scheduler helpers without mistaking comments or string payloads for imports.
 *
 * @param {{ readonly root: string }} approvedPackage Owner of the immutable installed snapshot
 * @param {string} entryModule Same-stem package-relative JavaScript entry
 * @returns {ReadonlySet<string>} Exact filenames referenced by a successfully parsed typed entry
 */
function readStableEntryImports(approvedPackage, entryModule) {
  /** Per-package entries share their original parsed reference set across candidate chunks. */
  let byEntry = entryImportsByPackage.get(approvedPackage)
  if (!byEntry) entryImportsByPackage.set(approvedPackage, (byEntry = new Map()))
  /** Empty cached sets also record missing or unproven entries without repeated parsing. */
  const cached = byEntry.get(entryModule)
  if (cached) return cached
  /** Only this function populates the cached set; callers receive read-only reference authority. */
  const references = new Set()
  byEntry.set(entryModule, references)
  if (!existsSync(resolve(approvedPackage.root, entryModule.replace(/\.js$/, '.d.ts'))))
    return references
  /** A matching declaration establishes the stable module whose real imports are inspected. */
  const entryPath = resolve(approvedPackage.root, entryModule)
  try {
    /** Existing parser metadata identifies static imports without filename or source-text guesses. */
    const parsed = parseSync(entryPath, readFileSync(entryPath, 'utf8'))
    if (parsed.errors.length > 0) return references
    for (const imported of parsed.module.staticImports)
      if (imported.moduleRequest.value.startsWith('.'))
        references.add(resolve(dirname(entryPath), imported.moduleRequest.value))
  } catch {
    // Unavailable or invalid entry metadata cannot authorize normalization.
    return references
  }
  return references
}

/**
 * Normalizes raw IDs while rejecting two distinct modules that claim one stable identity.
 *
 * @param {Iterable<string>} moduleIds Raw bundler module IDs
 * @param {string} consumerDirectory Fresh consumer root
 * @param {ReadonlyMap<string, { readonly root: string }>} installedPackages Admitted roots
 * @returns {readonly string[]} Normalized identities in first-observed order
 * @throws {Error} When distinct raw IDs collide after normalization
 */
export function normalizeRetainedModules(moduleIds, consumerDirectory, installedPackages) {
  /** Reverse ledger proves normalized identities are one-to-one with raw IDs. */
  const rawByNormalized = new Map()
  for (const moduleId of moduleIds) {
    /** Stable identity remains untrusted until collision and exact-set checks pass. */
    const normalized = normalizeRetainedModule(moduleId, consumerDirectory, installedPackages)
    /** Existing raw ID reveals a many-to-one normalization collision. */
    const previous = rawByNormalized.get(normalized)
    if (previous !== undefined && previous !== moduleId)
      throw new Error(`retained module identity collision: ${normalized}: ${previous}, ${moduleId}`)
    rawByNormalized.set(normalized, moduleId)
  }
  return [...rawByNormalized.keys()]
}

/**
 * Requires exact retained-module equality, rejecting every missing or additional implementation.
 *
 * @param {Iterable<string>} modules Observed normalized module identities
 * @param {Iterable<string>} expectedModules Reviewed retained-module inventory
 * @returns {void}
 * @throws {Error} When the observed and expected sets differ
 */
export function assertExactRetainedModules(modules, expectedModules) {
  /** Expected set is supplied by the thin feature fixture's frozen inventory. */
  const expected = new Set(expectedModules)
  /** Observed set prevents duplicate reporting while exact normalization handles collisions. */
  const observed = new Set(modules)
  /** Unexpected identities take priority because they prove retained sibling code. */
  const unexpected = [...observed].filter((moduleId) => !expected.has(moduleId)).sort()
  /** Missing identities are reported only after no unexpected implementation remains. */
  const missing = [...expected].filter((moduleId) => !observed.has(moduleId)).sort()
  if (unexpected.length > 0) throw new Error(`unexpected retained module: ${unexpected.join(', ')}`)
  if (missing.length > 0) throw new Error(`missing retained module: ${missing.join(', ')}`)
}
