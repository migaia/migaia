/** Deterministic producer and scoped verifier for the tracked public export baseline. */
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { assertFresh as assertDistFresh } from './dist-stamp.mjs'

/** Repository root used by CLI commands and default library calls. */
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Stable failure identities for the public export generator. */
export const PublicExportsErrorCode = {
  /** A manifest names a concrete JavaScript target that has not been built. */
  targetMissing: 'PUBLIC_EXPORTS_TARGET_MISSING',
  /** A package outside the admitted scope differs from its tracked baseline. */
  drift: 'PUBLIC_EXPORTS_DRIFT',
  /** A scope names no package in the baseline or current public exports. */
  scopeUnknown: 'PUBLIC_EXPORTS_SCOPE_UNKNOWN',
  /** The CLI invocation has an unsupported mode or malformed scope. */
  usage: 'PUBLIC_EXPORTS_USAGE'
}

/** Stable CLI and error text is owned next to the generator's public modes. */
const PublicExportsText = {
  /**
   * Missing build targets require a build rather than a smaller baseline. @param {string} pkg
   * Package name. @param {string} subpath Export subpath.
   */
  targetMissing: (pkg, subpath) => `missing public export target: ${pkg} ${subpath}`,
  /** Drift outside a scope requires the integration write or a corrected scope. */
  drift: 'public exports differ outside the declared scope; run registry:write or correct --scope',
  /** Unknown package names cannot silently widen a child gate. @param {string} pkg Package name. */
  scopeUnknown: (pkg) => `unknown public export scope: ${pkg}`,
  /** The CLI states its writable and read-only entry points. */
  usage: 'usage: node scripts/public-exports.mjs --write | --check [--scope <package,...>]',
  /**
   * A strict check confirms the count of manifest-covered packages. @param {number} count Package
   * count.
   */
  match: (count) => `public exports match: ${count} packages`,
  /**
   * A write reports its package count without changing baseline semantics. @param {number} count
   * Package count.
   */
  written: (count) => `public exports written: ${count} packages`
}

/**
 * Attaches a script-owned semantic code to a native Error.
 *
 * @param {string} code Stable code.
 * @param {string} message Stable diagnostic.
 * @param {Record<string, unknown>} [details] Structured context.
 * @returns {Error & { code: string; packages?: string[] }} Coded error.
 */
const withCode = (code, message, details = {}) => {
  /** Native instance retains its own stack. */
  const error = new Error(message)
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  for (const [key, value] of Object.entries(details))
    Object.defineProperty(error, key, { value, enumerable: true })
  return /** @type {Error & { code: string; packages?: string[] }} */ (error)
}

/**
 * Compares UTF-16 code units independently of process locale.
 *
 * @param {string} left First value.
 * @param {string} right Second value.
 * @returns {number} Ordering indicator.
 */
const codeUnitCompare = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

/**
 * Traverses a manifest's export condition tree for target strings.
 *
 * @param {unknown} value Export condition tree.
 * @returns {string[]} Declared targets.
 */
const allTargets = (value) => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(allTargets)
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(allTargets)
}

/**
 * Selects the runtime ESM target with the existing baseline's condition priority.
 *
 * @param {unknown} value Export condition tree.
 * @returns {string | undefined} Runtime target when present.
 */
const runtimeTarget = (value) => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const candidate of value) {
      /** First condition with a runtime target wins. */
      const selected = runtimeTarget(candidate)
      if (selected !== undefined) return selected
    }
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  for (const condition of ['import', 'default', 'node', 'browser']) {
    /** Priority matches the previously tracked baseline collector. */
    const selected = runtimeTarget(/** @type {Record<string, unknown>} */ (value)[condition])
    if (selected !== undefined) return selected
  }
  return undefined
}

/**
 * Lists packages whose exports point into dist, regardless of local build presence.
 *
 * @param {string} [root] Repository root.
 * @returns {{
 *   packages: { packageRoot: string; manifest: Record<string, any> }[]
 *   excluded: string[]
 * }}
 *   Covered and excluded manifests.
 */
export const coveredPackages = (root = repositoryRoot) => {
  /** Covered manifests are imported only after freshness is asserted. */
  const packages = []
  /** Exporting packages without dist targets are reported for scope clarity. */
  const excluded = []
  for (const directory of readdirSync(join(root, 'packages'))) {
    /** Absolute package directory for manifest and output reads. */
    const packageRoot = join(root, 'packages', directory)
    /** A directory without a manifest is not a publishable package. */
    const manifestPath = join(packageRoot, 'package.json')
    if (!existsSync(manifestPath)) continue
    /** Manifest is the only source of package name and export targets. */
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!manifest.exports || typeof manifest.name !== 'string') continue
    if (allTargets(manifest.exports).some((target) => target.startsWith('./dist/')))
      packages.push({ packageRoot, manifest })
    else excluded.push(manifest.name)
  }
  packages.sort((left, right) => codeUnitCompare(left.manifest.name, right.manifest.name))
  excluded.sort(codeUnitCompare)
  return { packages, excluded }
}

/**
 * Imports every concrete runtime JavaScript export after a freshness check. Upstream stamp and
 * module failures propagate with their original object identity.
 *
 * @param {{ root?: string; assertFresh?: (directories: string[], root?: string) => void }} [options]
 *   Root and freshness override.
 * @returns {Promise<{ packages: Record<string, Record<string, string[]>> }>} Deterministically
 *   ordered export names.
 */
export const collectPublicExports = async ({
  root = repositoryRoot,
  assertFresh = assertDistFresh
} = {}) => {
  /** Covered manifests do not depend on the caller's local dist directory inventory. */
  const { packages: covered } = coveredPackages(root)
  assertFresh(
    covered.map(({ packageRoot }) => packageRoot),
    root
  )
  /**
   * @type {Record<string, Record<string, string[]>>} Exported package map follows manifest name
   *   order.
   */
  const packages = {}
  for (const { packageRoot, manifest } of covered) {
    /** A root-only export is normalized to the standard dot subpath. */
    const exportMap =
      typeof manifest.exports === 'string' || Array.isArray(manifest.exports)
        ? { '.': manifest.exports }
        : manifest.exports
    /** Concrete module paths are validated before importing any module from this package. */
    const targets = []
    for (const [subpath, conditions] of Object.entries(exportMap)) {
      if (subpath.includes('*')) continue
      for (const declared of allTargets(conditions)) {
        if (!declared.endsWith('.js') || declared.includes('*')) continue
        if (!existsSync(resolve(packageRoot, declared)))
          throw withCode(
            PublicExportsErrorCode.targetMissing,
            PublicExportsText.targetMissing(manifest.name, subpath)
          )
      }
      /** Runtime conditions choose the same target as the historical collector. */
      const target = runtimeTarget(conditions)
      if (target === undefined || !target.endsWith('.js')) continue
      /** Resolved target is used both for existence and ESM loading. */
      const modulePath = resolve(packageRoot, target)
      targets.push({ subpath, modulePath })
    }
    /** @type {Record<string, string[]>} Names preserve manifest subpath order. */
    const entries = {}
    for (const { subpath, modulePath } of targets) {
      /** Existing query suffix separates baseline imports from package runtime imports. */
      const module = await import(`${pathToFileURL(modulePath).href}?exports-baseline`)
      entries[subpath] = Object.keys(module).sort(codeUnitCompare)
    }
    packages[manifest.name] = entries
  }
  return { packages }
}

/**
 * Finds exact symbol additions and removals between two baseline-shaped values.
 *
 * @param {{ packages: Record<string, Record<string, string[]>> }} expected Tracked baseline.
 * @param {{ packages: Record<string, Record<string, string[]>> }} actual Current exports.
 * @returns {{ sign: '+' | '-'; pkg: string; subpath: string; name: string }[]} Code-unit ordered
 *   differences.
 */
export const diffPublicExports = (expected, actual) => {
  /**
   * One line is identified by package, subpath, and exported symbol.
   *
   * @param {{ packages: Record<string, Record<string, string[]>> }} value Baseline-shaped export
   *   map.
   * @returns {Map<string, { pkg: string; subpath: string; name: string }>} Symbol rows.
   */
  const flatten = (value) => {
    /** Identity-to-row map supports exact set subtraction. */
    const rows = new Map()
    for (const [pkg, subpaths] of Object.entries(value.packages))
      for (const [subpath, names] of Object.entries(subpaths))
        for (const name of names) rows.set(`${pkg}\0${subpath}\0${name}`, { pkg, subpath, name })
    return rows
  }
  /** Prior symbols become removals when absent from current exports. */
  const before = flatten(expected)
  /** Current symbols become additions when absent from the baseline. */
  const after = flatten(actual)
  /**
   * @type {{ sign: '+' | '-'; pkg: string; subpath: string; name: string }[]} Differences retain
   *   structured names for callers and CLI output.
   */
  const differences = []
  for (const [identity, row] of after)
    if (!before.has(identity)) differences.push({ sign: '+', ...row })
  for (const [identity, row] of before)
    if (!after.has(identity)) differences.push({ sign: '-', ...row })
  differences.sort(
    (left, right) =>
      codeUnitCompare(left.pkg, right.pkg) ||
      codeUnitCompare(left.subpath, right.subpath) ||
      codeUnitCompare(left.name, right.name) ||
      codeUnitCompare(left.sign, right.sign)
  )
  return differences
}

/**
 * Checks the tracked baseline, admitting differences only inside the named package scope. Never
 * writes the baseline; stamp and import failures preserve original identity.
 *
 * @param {{
 *   root?: string
 *   assertFresh?: (directories: string[], root?: string) => void
 *   scope?: string[]
 * }} [options]
 *   Root, freshness, and admitted package names.
 * @returns {Promise<{ sign: '+' | '-'; pkg: string; subpath: string; name: string }[]>} Admitted
 *   differences.
 */
export const checkPublicExports = async ({
  root = repositoryRoot,
  assertFresh = assertDistFresh,
  scope = []
} = {}) => {
  /** Tracked baseline is read once and never modified by a check. */
  const expected = JSON.parse(
    readFileSync(join(root, 'scripts/fixtures/public-exports.baseline.json'), 'utf8')
  )
  /** Current manifest graph and built modules are authoritative for actual exports. */
  const actual = await collectPublicExports({ root, assertFresh })
  /** Scope admission is validated against either side before differences are filtered. */
  const admitted = new Set(scope)
  for (const pkg of admitted)
    if (!(pkg in expected.packages) && !(pkg in actual.packages))
      throw withCode(PublicExportsErrorCode.scopeUnknown, PublicExportsText.scopeUnknown(pkg))
  /** Unadmitted packages must remain exactly equal to the tracked baseline. */
  const differences = diffPublicExports(expected, actual)
  /** Strict package equality also catches empty-package and empty-subpath drift. */
  const outside = [...new Set([...Object.keys(expected.packages), ...Object.keys(actual.packages)])]
    .filter(
      (pkg) =>
        !admitted.has(pkg) && !isDeepStrictEqual(expected.packages[pkg], actual.packages[pkg])
    )
    .sort(codeUnitCompare)
  if (outside.length)
    throw withCode(PublicExportsErrorCode.drift, PublicExportsText.drift, { packages: outside })
  return differences
}

/**
 * Atomically regenerates the tracked baseline from fresh built modules.
 *
 * @param {{ root?: string; assertFresh?: (directories: string[], root?: string) => void }} [options]
 *   Root and freshness override.
 * @returns {Promise<{ packages: Record<string, Record<string, string[]>> }>} Generated baseline.
 */
export const writePublicExports = async ({
  root = repositoryRoot,
  assertFresh = assertDistFresh
} = {}) => {
  /** Generation completes before a temporary file can replace the prior baseline. */
  const baseline = await collectPublicExports({ root, assertFresh })
  /** Same-directory temporary file makes replacement atomic. */
  const path = join(root, 'scripts/fixtures/public-exports.baseline.json')
  /** PID distinguishes concurrent integration writers. */
  const temporary = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(baseline, null, 2)}\n`)
    renameSync(temporary, path)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
  return baseline
}

/** Parses the CLI's exact mode and optional comma-separated scope. */
const main = async () => {
  /** CLI arguments are local to the two supported integration modes. */
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--write') {
    /** Write reports the number of covered packages. */
    const baseline = await writePublicExports()
    console.log(PublicExportsText.written(Object.keys(baseline.packages).length))
    return
  }
  if (
    args[0] === '--check' &&
    (args.length === 1 || (args.length === 3 && args[1] === '--scope'))
  ) {
    /** Explicit names are the only allowed check drift. */
    const scope = args.length === 3 ? args[2].split(',').filter(Boolean) : []
    if (args.length === 3 && !scope.length)
      throw withCode(PublicExportsErrorCode.usage, PublicExportsText.usage)
    /** A successful scoped check prints every admitted symbol difference. */
    const differences = await checkPublicExports({ scope })
    for (const { sign, pkg, subpath, name } of differences)
      console.log(`${sign} ${pkg} ${subpath} ${name}`)
    console.log(PublicExportsText.match(coveredPackages().packages.length))
    return
  }
  throw withCode(PublicExportsErrorCode.usage, PublicExportsText.usage)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(
      error instanceof Error
        ? `${'code' in error ? `${error.code}: ` : ''}${error.message}`
        : String(error)
    )
    process.exitCode = 1
  }
}
