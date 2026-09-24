/**
 * Build-output freshness for workspace packages.
 *
 * Every package export resolves to `dist/`, and no Vitest config aliases `@migaia/*` back to
 * `src/`, so any test that imports another workspace package — or reads a `dist/` path directly —
 * observes whatever build output happens to be on disk. Nothing previously proved that output
 * matched the current sources: a coverage baseline was once produced against a `dist/` built before
 * the final source change. This module closes that gap with two halves that must agree:
 *
 * - A build writes `dist/.input-digest.json` recording the digest of the sources it was built from;
 * - Every reader of `dist/` asserts that recorded digest equals the digest of the sources now on
 *   disk.
 *
 * A package's `dist/` depends only on its own sources: builds are `tsc` or Vite with workspace
 * dependencies kept external, so `dist/` holds bare `@migaia/*` imports rather than inlined copies.
 * Freshness of a consumer's view is therefore the freshness of every package in its dist closure.
 *
 * CLI (run from a package directory unless noted): node ../../scripts/dist-stamp.mjs clean remove
 * this package's dist/ before building node ../../scripts/dist-stamp.mjs write stamp this package's
 * freshly built dist/ node ../../scripts/dist-stamp.mjs assert assert this package's dist closure
 * is fresh node scripts/dist-stamp.mjs assert-all (repository root) assert every stampable package
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root; every package path and git query is resolved against it. */
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Stamp file name inside a package's build-output directory. */
export const STAMP_FILE = '.input-digest.json'

/**
 * Stamp format version. Readers reject any other value, so a future format change makes every old
 * stamp stale instead of being misread.
 */
export const STAMP_VERSION = 1

/**
 * Machine-readable codes attached to thrown errors. Callers (Vitest global setup, coverage custody)
 * branch on these rather than on message text.
 */
export const DistStampErrorCode = {
  /**
   * At least one package in the asserted set has no stamp or a stamp whose digest differs from its
   * current sources. The caller must rebuild the listed packages; the error's `packages` property
   * names each one with its reason (`unbuilt`, `unstamped` or `modified`).
   */
  stale: 'DIST_STALE',
  /**
   * `write` found no `dist/` after the build step, so there is no output to vouch for. The build
   * itself failed or wrote elsewhere; stamping nothing would make an empty output look fresh.
   */
  missingOutput: 'DIST_OUTPUT_MISSING',
  /** A CLI command was invoked outside a stampable workspace package, or with an unknown verb. */
  usage: 'DIST_STAMP_USAGE'
}

/**
 * Canonical message text for every thrown error. Kept beside the codes so a message never drifts
 * from the code a caller branches on.
 */
export const DIST_STAMP_TEXT = {
  /**
   * @param {readonly { name: string; reason: string }[]} entries
   * @returns {string}
   */
  stale: (entries) =>
    `workspace build output is stale for ${entries.map(({ name, reason }) => `${name} (${reason})`).join(', ')}; ` +
    `rebuild with: pnpm -r ${entries.map(({ name }) => `--filter ./packages/${name}`).join(' ')} run build`,
  /** @param {string} name @returns {string} */
  missingOutput: (name) => `package ${name} has no dist/ to stamp after its build step`,
  /** @param {string} detail @returns {string} */
  usage: (detail) => `dist-stamp: ${detail}`
}

/**
 * Attaches a code (and optional structured detail) without replacing the native error.
 *
 * @param {Error} error
 * @param {string} code
 * @param {Record<string, unknown>} [detail]
 * @returns {Error}
 */
const withCode = (error, code, detail = {}) => {
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  for (const [key, value] of Object.entries(detail))
    Object.defineProperty(error, key, { value, enumerable: true })
  return error
}

/**
 * Package-relative paths that never influence build output. Excluding them keeps a README or test
 * edit from forcing a rebuild; including anything uncertain only costs an extra build, never a
 * false "fresh".
 *
 * @param {string} path Package-relative, forward-slash path
 * @returns {boolean}
 */
const isBuildIrrelevant = (path) =>
  path.startsWith('test/') ||
  path.startsWith('e2e/') ||
  path.endsWith('.md') ||
  /^vitest\.config\.[cm]?[jt]s$/.test(path)

/**
 * Lists every workspace package directory under `packages/` that has a manifest.
 *
 * @param {string} [root]
 * @returns {Map<string, string>} Package directory name → absolute directory
 */
export const workspacePackages = (root = repositoryRoot) => {
  /** Directory name → absolute path for every manifest-bearing package. */
  const packages = new Map()
  for (const name of readdirSync(join(root, 'packages')).sort()) {
    const directory = join(root, 'packages', name)
    if (statSync(directory).isDirectory() && existsSync(join(directory, 'package.json')))
      packages.set(name, directory)
  }
  return packages
}

/**
 * Reads a package manifest.
 *
 * @param {string} directory
 * @returns {Record<string, any>}
 */
const readManifest = (directory) =>
  JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))

/**
 * Whether a package publishes build output under `dist/` that consumers resolve. Packages whose
 * exports point into `src/` (e.g. the wasm-pack package) have no dist to go stale.
 *
 * @param {string} directory
 * @returns {boolean}
 */
export const isStampable = (directory) => {
  const manifest = readManifest(directory)
  return (
    typeof manifest.scripts?.build === 'string' &&
    (JSON.stringify([manifest.main, manifest.exports]).includes('./dist/') ||
      manifest.name === '@migaia/wasm')
  )
}

/** Resolves the output directory stamped for a package. WASM-pack publishes directly from src/. */
export const outputDirectory = (directory) =>
  readManifest(directory).name === '@migaia/wasm' ? join(directory, 'src') : join(directory, 'dist')

/** Whether one package-relative file participates in the package's build-input digest. */
const isBuildInput = (directory, path) => {
  if (readManifest(directory).name === '@migaia/wasm') return path.startsWith('rust/')
  return !isBuildIrrelevant(path)
}

/**
 * Digests the build inputs of several packages with a single git query. Input set: tracked plus
 * untracked-but-not-ignored files under each package, minus build-irrelevant paths. `dist/` and
 * `node_modules/` are ignored by git and therefore never part of their own input.
 *
 * @param {readonly string[]} directories Absolute package directories
 * @param {string} [root]
 * @returns {Map<string, string>} Absolute directory → hex digest
 */
export const inputDigests = (directories, root = repositoryRoot) => {
  /** One git listing for all requested packages keeps closure assertions cheap. */
  const listed = execFileSync(
    'git',
    [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...directories.map((directory) => relative(root, directory))
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  )
    .split('\0')
    .filter(Boolean)
  /** Deduplicated because `--cached --others` can list a path twice around index edges. */
  const files = [...new Set(listed)].sort()
  /** Per-package running hashes, keyed by absolute directory. */
  const hashes = new Map(directories.map((directory) => [directory, createHash('sha256')]))
  for (const file of files) {
    const absolute = join(root, file)
    const owner = directories.find((directory) => absolute.startsWith(directory + sep))
    if (!owner) continue
    const path = relative(owner, absolute).split(sep).join('/')
    if (!isBuildInput(owner, path)) continue
    // A tracked file deleted in the worktree is simply absent from the input: its absence changes
    // the digest exactly as a content edit would.
    if (!existsSync(absolute)) continue
    const hash = hashes.get(owner)
    hash.update(path)
    hash.update('\0')
    hash.update(readFileSync(absolute))
    hash.update('\0')
  }
  return new Map([...hashes].map(([directory, hash]) => [directory, hash.digest('hex')]))
}

/**
 * Removes a package's `dist/` so a build cannot leave orphaned output from deleted sources.
 *
 * @param {string} directory
 * @returns {void}
 */
export const cleanDist = (directory) => {
  if (readManifest(directory).name !== '@migaia/wasm') {
    rmSync(join(directory, 'dist'), { recursive: true, force: true })
    return
  }
  for (const name of [
    'wasm_provider.js',
    'wasm_provider.d.ts',
    'wasm_provider_bg.wasm',
    'wasm_provider_bg.wasm.d.ts',
    STAMP_FILE
  ])
    rmSync(join(directory, 'src', name), { force: true })
}

/**
 * Stamps a freshly built `dist/` with the digest of the sources it was built from.
 *
 * @param {string} directory
 * @param {string} [root]
 * @returns {string} The recorded digest
 * @throws {Error} `DIST_OUTPUT_MISSING` when the build left no `dist/`
 */
export const writeStamp = (directory, root = repositoryRoot) => {
  const name = relative(join(root, 'packages'), directory)
  const output = outputDirectory(directory)
  if (!existsSync(output))
    throw withCode(new Error(DIST_STAMP_TEXT.missingOutput(name)), DistStampErrorCode.missingOutput)
  const digest = inputDigests([directory], root).get(directory)
  writeFileSync(
    join(output, STAMP_FILE),
    `${JSON.stringify({ version: STAMP_VERSION, package: name, digest }, null, 2)}\n`
  )
  return digest
}

/**
 * Classifies one package's build output against its current sources.
 *
 * @param {string} directory
 * @param {string} digest Current input digest
 * @returns {'fresh' | 'unbuilt' | 'unstamped' | 'modified'}
 */
const classify = (directory, digest) => {
  const output = outputDirectory(directory)
  if (!existsSync(output)) return 'unbuilt'
  const stampPath = join(output, STAMP_FILE)
  if (!existsSync(stampPath)) return 'unstamped'
  try {
    const stamp = JSON.parse(readFileSync(stampPath, 'utf8'))
    return stamp.version === STAMP_VERSION && stamp.digest === digest ? 'fresh' : 'modified'
  } catch {
    // An unreadable stamp vouches for nothing; reporting it as modified forces the rebuild.
    return 'modified'
  }
}

/**
 * Asserts that every listed package's `dist/` was built from its current sources. All stale
 * packages are reported together so one rebuild command fixes the run.
 *
 * @param {readonly string[]} directories Absolute package directories
 * @param {string} [root]
 * @returns {void}
 * @throws {Error} `DIST_STALE` with a `packages` property listing `{ name, reason }`
 */
export const assertFresh = (directories, root = repositoryRoot) => {
  const stampable = directories.filter((directory) => isStampable(directory))
  if (stampable.length === 0) return
  const digests = inputDigests(stampable, root)
  /** Packages whose build output does not match their sources, with the reason for each. */
  const stale = []
  for (const directory of stampable) {
    const reason = classify(directory, digests.get(directory))
    if (reason !== 'fresh')
      stale.push({ name: relative(join(root, 'packages'), directory), reason })
  }
  if (stale.length)
    throw withCode(new Error(DIST_STAMP_TEXT.stale(stale)), DistStampErrorCode.stale, {
      packages: Object.freeze(stale)
    })
}

/** Test-source references that read another package's built output by path. */
const NAMED_DIST_REFERENCE = /packages\/([a-z0-9-]+)\/dist\b/g
/** A path template over package names (e.g. `packages/${dir}/dist`) may read any package. */
const TEMPLATED_DIST_REFERENCE = /packages\/\$\{[^}]+\}\/dist\b/
/** A test reading its own package's build output (`../dist/…`, `'dist'`, `'dist/'`). */
const SELF_DIST_REFERENCE = /(?:\.\.\/)+dist\b|['"]dist['"/]/

/**
 * Workspace dependency names declared by a manifest.
 *
 * @param {Record<string, any>} manifest
 * @param {boolean} includeDev Whether devDependencies count (only for the package under test)
 * @returns {string[]} `@migaia/*` package names
 */
const workspaceDependencies = (manifest, includeDev) =>
  Object.keys({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
    ...(includeDev ? manifest.devDependencies : {})
  })

/**
 * Recursively collects files under a directory, skipping build output and installed modules.
 *
 * @param {string} directory
 * @returns {string[]}
 */
const listSourceFiles = (directory) => {
  if (!existsSync(directory)) return []
  /** Files found so far, depth-first. */
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listSourceFiles(path))
    else if (/\.(?:[cm]?[jt]sx?|json)$/.test(entry.name)) files.push(path)
  }
  return files
}

/**
 * Computes the set of packages whose `dist/` a package's tests can observe: its declared workspace
 * dependencies (including dev), every package its test sources read by `dist/` path, itself when
 * its tests read their own `dist/`, and the transitive runtime dependencies of all of those — a
 * loaded `dist/` imports its own dependencies' `dist/` in turn.
 *
 * @param {string} directory Absolute directory of the package under test
 * @param {string} [root]
 * @returns {string[]} Absolute package directories, sorted
 */
export const distClosure = (directory, root = repositoryRoot) => {
  const packages = workspacePackages(root)
  /** `@migaia/<dir>` → absolute directory, for resolving declared dependency names. */
  const byScopedName = new Map()
  for (const [name, packageDirectory] of packages) {
    const scoped = readManifest(packageDirectory).name
    if (typeof scoped === 'string') byScopedName.set(scoped, packageDirectory)
    byScopedName.set(`@migaia/${name}`, packageDirectory)
  }
  /** Directories still to expand, seeded from direct declarations and test references. */
  const pending = []
  const seed = (target) => {
    if (target) pending.push(target)
  }
  for (const dependency of workspaceDependencies(readManifest(directory), true))
    seed(byScopedName.get(dependency))
  for (const file of [
    ...listSourceFiles(join(directory, 'test')),
    ...listSourceFiles(join(directory, 'e2e'))
  ]) {
    const text = readFileSync(file, 'utf8')
    if (TEMPLATED_DIST_REFERENCE.test(text)) for (const target of packages.values()) seed(target)
    for (const [, name] of text.matchAll(NAMED_DIST_REFERENCE)) seed(packages.get(name))
    if (SELF_DIST_REFERENCE.test(text)) seed(directory)
  }
  /** Expanded closure; a package enters once and contributes its runtime dependencies. */
  const closure = new Set()
  while (pending.length) {
    const next = pending.pop()
    if (closure.has(next)) continue
    closure.add(next)
    for (const dependency of workspaceDependencies(readManifest(next), false))
      seed(byScopedName.get(dependency))
  }
  return [...closure].sort()
}

/**
 * Asserts the dist closure of one package; the Vitest global setup calls this before any test.
 *
 * @param {string} directory Absolute directory of the package under test
 * @param {string} [root]
 * @returns {void}
 */
export const assertClosureFresh = (directory, root = repositoryRoot) =>
  assertFresh(distClosure(directory, root), root)

/**
 * Asserts every stampable workspace package; coverage custody calls this around capture.
 *
 * @param {string} [root]
 * @returns {void}
 */
export const assertAllFresh = (root = repositoryRoot) =>
  assertFresh([...workspacePackages(root).values()], root)

/**
 * CLI entry. Package-scoped verbs act on the current directory, which must be a workspace package.
 *
 * @param {readonly string[]} argv
 * @returns {void}
 */
const main = (argv) => {
  const [verb] = argv
  if (verb === 'assert-all') return assertAllFresh()
  const directory = process.cwd()
  if (
    !existsSync(join(directory, 'package.json')) ||
    dirname(directory) !== join(repositoryRoot, 'packages')
  )
    throw withCode(
      new Error(DIST_STAMP_TEXT.usage(`run "${verb}" from a packages/<name> directory`)),
      DistStampErrorCode.usage
    )
  if (verb === 'clean') return cleanDist(directory)
  if (verb === 'write') return void writeStamp(directory)
  if (verb === 'assert') return assertClosureFresh(directory)
  throw withCode(
    new Error(
      DIST_STAMP_TEXT.usage(`unknown command "${verb}" (clean | write | assert | assert-all)`)
    ),
    DistStampErrorCode.usage
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`${error.code ?? 'ERROR'}: ${error.message}`)
    process.exit(1)
  }
}
