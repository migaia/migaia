import { isAbsolute, relative, resolve } from 'node:path'
import { realpathSync } from 'node:fs'

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
  /** Marker constrains first-party package normalization to the reviewed namespace. */
  const packageMarker = '/node_modules/@migaia/'
  /** Last marker handles pnpm's nested virtual-store paths. */
  const packageIndex = moduleId.lastIndexOf(packageMarker)
  if (packageIndex >= 0) {
    /** Scoped package-relative identity begins after the nearest node_modules segment. */
    const packageRelativeId = moduleId.slice(packageIndex + '/node_modules/'.length)
    /** Scope and package segment identify the package before any module path. */
    const [scope, packageSegment] = packageRelativeId.split('/')
    /** Exact scoped package name indexes the preauthorized root map. */
    const packageName = `${scope}/${packageSegment}`
    /** Authorization is supplied by the strict lock/root/content verifier. */
    const approvedPackage = installedPackages.get(packageName)
    if (approvedPackage === undefined) return `unapproved-package:${moduleId}`
    /** Raw package root is canonicalized separately from the requested module. */
    const rawPackageRoot = moduleId.slice(
      0,
      packageIndex + '/node_modules/'.length + packageName.length
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
    return `${packageName}/${packageModule}`
  }
  /** Generic dependency marker keeps unreviewed third-party modules observable. */
  const dependencyMarker = '/node_modules/'
  /** Last generic marker avoids collapsing nested dependency identities. */
  const dependencyIndex = moduleId.lastIndexOf(dependencyMarker)
  if (dependencyIndex >= 0)
    return `package:${moduleId.slice(dependencyIndex + dependencyMarker.length)}`
  return `path:${moduleId}`
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
