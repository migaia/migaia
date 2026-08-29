import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

/** Stable messages keep root test-tooling failures searchable across package consumers. */
const provenanceErrorText = {
  invalidRecord: 'retained semantic record is invalid',
  sourceMissing: 'retained semantic record has no source-map source',
  sourceEscape: 'retained semantic source escapes package root',
  duplicate: 'retained semantic identity has multiple copies',
  mismatch: 'retained semantic provenance differs',
  sourceMapInvalid: 'retained source map is invalid',
  ownerUnknown: 'retained semantic owner is unknown',
  sourceAmbiguous: 'retained emitted module maps to conflicting source sets'
}

/**
 * Extracts source-map sources without trusting source-map names as package ownership. A missing,
 * malformed, or non-array `sources` field is rejected before any retained record is accepted.
 *
 * @param {unknown} sourceMap Parsed source-map JSON
 * @returns {readonly string[]} Raw source-map source names
 */
export function sourceMapSources(sourceMap) {
  if (
    sourceMap === null ||
    typeof sourceMap !== 'object' ||
    !Array.isArray(sourceMap.sources) ||
    sourceMap.sources.some((source) => typeof source !== 'string' || !source)
  )
    throw new TypeError(provenanceErrorText.sourceMapInvalid)
  return [...sourceMap.sources]
}

/** Resolves real source-map entries relative to the emitted sourcemap location. */
export function resolveSourceMapSources(sourceMap, emittedFile) {
  const sources = sourceMapSources(sourceMap)
  if (typeof emittedFile !== 'string' || !emittedFile)
    throw new TypeError(provenanceErrorText.sourceMapInvalid)
  const sourceRoot = typeof sourceMap.sourceRoot === 'string' ? sourceMap.sourceRoot : ''
  return sources.map((source) =>
    isAbsolute(source) ? source : resolve(dirname(emittedFile), sourceRoot, source)
  )
}

/**
 * Validates and canonicalizes one source-map path within its owning package. Symlink resolution is
 * part of the boundary so an apparently relative source cannot escape.
 *
 * @param {string} packageRoot Owning package root
 * @param {string} sourcePath Source-map path, relative or absolute
 * @returns {string} Package-relative POSIX source path
 */
function normalizeSourcePath(packageRoot, sourcePath, allowMissing) {
  if (typeof packageRoot !== 'string' || typeof sourcePath !== 'string' || !sourcePath)
    throw new TypeError(provenanceErrorText.invalidRecord)
  const root = realpathSync(packageRoot)
  const lexicalRelative = relative(root, resolve(root, sourcePath))
  if (!lexicalRelative || lexicalRelative.startsWith('..') || isAbsolute(lexicalRelative))
    throw new TypeError(provenanceErrorText.sourceEscape)
  let candidate
  try {
    candidate = realpathSync(resolve(root, sourcePath))
  } catch {
    if (!allowMissing) throw new TypeError(provenanceErrorText.sourceMissing)
    return lexicalRelative.split('/').join('/')
  }
  const packageRelative = relative(root, candidate)
  if (!packageRelative || packageRelative.startsWith('..') || isAbsolute(packageRelative))
    throw new TypeError(provenanceErrorText.sourceEscape)
  return packageRelative.split('/').join('/')
}

/**
 * Builds one semantic identity from package ownership, source-map provenance, and emitted role.
 * Emitted filenames and content hashes are intentionally excluded so hash-only renames stay
 * stable.
 *
 * @param {Readonly<{
 *   packageName: string
 *   packageRoot: string
 *   sourcePaths: readonly string[]
 *   emittedRole: string
 * }>} record
 *   Retained module provenance
 * @returns {string} Stable semantic module identifier
 */
export function semanticModuleId(record) {
  if (
    record === null ||
    typeof record !== 'object' ||
    typeof record.packageName !== 'string' ||
    !record.packageName ||
    typeof record.emittedRole !== 'string' ||
    !record.emittedRole ||
    !Array.isArray(record.sourcePaths) ||
    record.sourcePaths.length === 0
  )
    throw new TypeError(provenanceErrorText.invalidRecord)
  const sourcePaths = [...new Set(record.sourcePaths)]
    .sort()
    .map((sourcePath) =>
      normalizeSourcePath(record.packageRoot, sourcePath, record.sourceMapBacked === true)
    )
  if (sourcePaths.length === 0) throw new TypeError(provenanceErrorText.sourceMissing)
  return `${record.packageName}|${record.emittedRole}|${sourcePaths.join(',')}`
}

/**
 * Normalizes retained module records and rejects duplicate or incomplete ownership evidence.
 *
 * @param {Iterable<
 *   Readonly<{
 *     packageName: string
 *     packageRoot: string
 *     sourcePaths: readonly string[]
 *     emittedRole: string
 *     originalBytes: number
 *     renderedBytes: number
 *     copies?: number
 *   }>
 * >} records
 *   Raw retained records
 * @returns {readonly object[]} Stable semantic records
 */
export function normalizeSemanticModules(records) {
  const normalized = new Map()
  for (const record of records) {
    if (
      record === null ||
      typeof record !== 'object' ||
      !Number.isInteger(record.originalBytes) ||
      record.originalBytes < 0 ||
      !Number.isInteger(record.renderedBytes) ||
      record.renderedBytes < 0
    )
      throw new TypeError(provenanceErrorText.invalidRecord)
    const normalizedSourcePaths = [...new Set(record.sourcePaths)]
      .sort()
      .map((sourcePath) => normalizeSourcePath(record.packageRoot, sourcePath))
    const semanticId = `${record.packageName}|${record.emittedRole}|${normalizedSourcePaths.join(',')}`
    const copies = record.copies ?? 1
    if (!Number.isInteger(copies) || copies !== 1)
      throw new TypeError(provenanceErrorText.duplicate)
    if (normalized.has(semanticId)) throw new TypeError(provenanceErrorText.duplicate)
    normalized.set(semanticId, {
      semanticId,
      packageName: record.packageName,
      emittedRole: record.emittedRole,
      sourcePaths: normalizedSourcePaths,
      originalBytes: record.originalBytes,
      renderedBytes: record.renderedBytes,
      copies
    })
  }
  return [...normalized.values()].sort((left, right) =>
    left.semanticId.localeCompare(right.semanticId)
  )
}

/**
 * Normalizes an emitted graph against an explicit package-owner map. Unknown owners, conflicting
 * source sets, and missing source-map provenance fail closed instead of being folded by basename.
 *
 * @param {Iterable<
 *   Readonly<{
 *     packageName: string
 *     packageRoot: string
 *     sourcePaths: readonly string[]
 *     emittedRole: string
 *     originalBytes: number
 *     renderedBytes: number
 *     emittedPath?: string
 *     copies?: number
 *   }>
 * >} records
 *   Raw emitted records
 * @param {ReadonlyMap<string, string> | Readonly<Record<string, string>>} knownOwners Approved
 *   package roots
 * @returns {readonly object[]} Stable retained records
 */
export function normalizeOwnedSemanticModules(records, knownOwners) {
  const owners =
    knownOwners instanceof Map ? knownOwners : new Map(Object.entries(knownOwners ?? {}))
  const observed = []
  for (const record of records) {
    const approvedRoot = owners.get(record.packageName)
    if (
      typeof record.packageName !== 'string' ||
      typeof record.packageRoot !== 'string' ||
      typeof approvedRoot !== 'string' ||
      !owners.has(record.packageName) ||
      realpathSync(record.packageRoot) !== realpathSync(approvedRoot)
    )
      throw new TypeError(provenanceErrorText.ownerUnknown)
    if (!Array.isArray(record.sourcePaths) || record.sourcePaths.length === 0)
      throw new TypeError(provenanceErrorText.sourceMissing)
    if (typeof record.emittedPath !== 'string' || !record.emittedPath)
      throw new TypeError(provenanceErrorText.sourceMapInvalid)
    observed.push(record)
  }
  const byEmitted = new Map()
  for (const record of observed) {
    const sourceSet = JSON.stringify([...new Set(record.sourcePaths)].sort())
    const emittedId = `${record.packageName}|${record.emittedRole}|${record.emittedPath}`
    const previous = byEmitted.get(emittedId)
    if (previous !== undefined && previous !== sourceSet)
      throw new TypeError(provenanceErrorText.sourceAmbiguous)
    byEmitted.set(emittedId, sourceSet)
  }
  return normalizeSemanticModules(observed)
}

/**
 * Compares semantic provenance and byte budgets while ignoring emitted hash-named filenames.
 *
 * @param {Iterable<object>} expected Reviewed semantic records
 * @param {Iterable<object>} observed Fresh semantic records
 * @returns {void}
 */
export function assertSemanticModuleEvidence(expected, observed) {
  const expectedJson = JSON.stringify([...expected].sort(compareSemanticRecords))
  const observedJson = JSON.stringify([...observed].sort(compareSemanticRecords))
  if (expectedJson !== observedJson) throw new TypeError(provenanceErrorText.mismatch)
}

/**
 * Sorts normalized records by their stable semantic identity.
 *
 * @param {object} left First record
 * @param {object} right Second record
 * @returns {number} Lexicographic order
 */
function compareSemanticRecords(left, right) {
  return String(left.semanticId).localeCompare(String(right.semanticId))
}

/** Ensures a package root is present before source-map normalization is attempted. */
export const hasPackageRoot = (packageRoot) => existsSync(packageRoot)
