import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { relative, resolve } from 'node:path'

/** Computes the canonical path-set hash sealed by the D47 ledger. */
export const hashCompleteStorageInversePaths = (paths) =>
  createHash('sha256')
    .update(`${[...paths].sort().join('\n')}\n`)
    .digest('hex')

/** Rejects a partial, additional, duplicated, or reordered inverse path set. */
export function verifyCompleteStorageInversePaths(expectedPaths, actualPaths) {
  if (new Set(actualPaths).size !== actualPaths.length)
    throw new Error('complete storage inverse paths must be unique')
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths))
    throw new Error('complete storage inverse path set mismatch')
}

/** Requires an object record while parsing the authoritative migration inputs. */
const requireRecord = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value
}

/** Requires an array while parsing the authoritative migration inputs. */
const requireArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

/** Requires a non-empty string while parsing the authoritative migration inputs. */
const requireString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

/** Reads the D43 base commit without recapturing or modifying the immutable snapshot. */
const readObservationBaseCommit = (repositoryRoot, observationSnapshot) => {
  /** First JSONL row is the immutable metadata authority. */
  const firstLine = readFileSync(resolve(repositoryRoot, observationSnapshot), 'utf8').split(
    '\n'
  )[0]
  /** Parsed metadata is validated before its commit is trusted. */
  const metadata = requireRecord(JSON.parse(firstLine), 'observation metadata')
  if (metadata.record !== 'metadata') throw new Error('observation metadata row missing')
  return requireString(metadata.baseCommit, 'observation baseCommit')
}

/** Derives the complete unique path set and compatibility edits from every migration unit. */
export function deriveCompleteStorageInversePlan(
  repositoryRoot,
  migrationUnitsArtifact,
  observationSnapshot
) {
  /** Migration-unit ledger is the sole inverse numerator. */
  const ledger = requireRecord(
    JSON.parse(readFileSync(resolve(repositoryRoot, migrationUnitsArtifact), 'utf8')),
    'migration unit ledger'
  )
  /** Every unit participates, including non-independently-rollbackable byte-brand work. */
  const units = requireArray(ledger.migrationUnits, 'migration units')
  /** Set permits reviewed shared release paths without counting them twice. */
  const pathSet = new Set()
  /** Compatibility edits are retained with their owning unit for exact diagnostics. */
  const edits = []
  for (const [unitIndex, unitValue] of units.entries()) {
    /** One unit contributes every semantic category to the complete inverse. */
    const unit = requireRecord(unitValue, `migration unit ${unitIndex}`)
    /** Stable unit ID identifies malformed compatibility edits. */
    const unitId = requireString(unit.id, `migration unit ${unitIndex} id`)
    /** Category values form the complete path denominator. */
    const categories = requireRecord(unit.categories, `${unitId} categories`)
    for (const [category, categoryValue] of Object.entries(categories))
      for (const [pathIndex, pathValue] of requireArray(
        categoryValue,
        `${unitId}.${category}`
      ).entries())
        pathSet.add(requireString(pathValue, `${unitId}.${category}[${pathIndex}]`))
    for (const [editIndex, editValue] of requireArray(
      unit.compatibilityEdits ?? [],
      `${unitId} compatibilityEdits`
    ).entries()) {
      /** Exact edit shape prevents a partial fallback from being silently ignored. */
      const edit = requireRecord(editValue, `${unitId} compatibility edit ${editIndex}`)
      edits.push({
        unitId,
        file: requireString(edit.file, `${unitId} compatibility edit file`),
        search: requireString(edit.search, `${unitId} compatibility edit search`),
        replacement: requireString(edit.replacement, `${unitId} compatibility edit replacement`)
      })
    }
  }
  /** Sorted paths are both the application order and the sealed equality representation. */
  const paths = [...pathSet].sort()
  for (const edit of edits)
    if (!pathSet.has(edit.file))
      throw new Error(`inverse compatibility edit is outside migration paths: ${edit.unitId}`)
  return {
    baseCommit: readObservationBaseCommit(repositoryRoot, observationSnapshot),
    paths,
    pathSetSha256: hashCompleteStorageInversePaths(paths),
    edits
  }
}

/** Reads one file from the immutable D43 base commit or reports an absent historical path. */
const readBaselineFile = (repositoryRoot, baseCommit, fileName) => {
  try {
    return execFileSync('git', ['show', `${baseCommit}:${fileName}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    return undefined
  }
}

/** Applies every reviewed exact-once compatibility edit for one restored path. */
const applyCompatibilityEdits = (source, fileName, edits) => {
  let result = source
  for (const edit of edits) {
    if (edit.file !== fileName) continue
    /** First match must exist exactly once to prevent a weakened or ambiguous inverse. */
    const first = result.indexOf(edit.search)
    if (first < 0 || result.indexOf(edit.search, first + edit.search.length) >= 0)
      throw new Error(`inverse compatibility edit must match once: ${edit.unitId}:${fileName}`)
    result = `${result.slice(0, first)}${edit.replacement}${result.slice(first + edit.search.length)}`
  }
  return result
}

/** Reads every workspace package name and directory from one isolated tree. */
const readTreePackages = (tree) => {
  /** Package map supplies inverse-tree targets for workspace dependency links. */
  const packages = new Map()
  for (const parentName of ['packages', 'apps']) {
    /** Workspace parent may be absent in a narrowed fixture. */
    const parent = resolve(tree, parentName)
    if (!existsSync(parent)) continue
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      /** Manifest establishes the workspace package identity. */
      const directory = resolve(parent, entry.name)
      /** Packages without manifests are not Node-resolution targets. */
      const manifestPath = resolve(directory, 'package.json')
      if (!existsSync(manifestPath)) continue
      /** Package name is the only key needed by the isolated resolver. */
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (typeof manifest.name === 'string') packages.set(manifest.name, directory)
    }
  }
  return packages
}

/** Links workspace packages inward and reuses only external dependencies from the source tree. */
const linkTreeDependencies = (repositoryRoot, tree) => {
  /** Root tools remain pinned to the already-installed workspace dependency tree. */
  symlinkSync(resolve(repositoryRoot, 'node_modules'), resolve(tree, 'node_modules'), 'dir')
  /** Every package receives inverse-local @migaia links. */
  const packages = readTreePackages(tree)
  for (const directory of packages.values()) {
    /** Scoped workspace directory owns all inverse-local package links. */
    const workspaceScope = resolve(directory, 'node_modules/@migaia')
    mkdirSync(workspaceScope, { recursive: true })
    for (const [packageName, targetDirectory] of packages) {
      if (!packageName.startsWith('@migaia/')) continue
      symlinkSync(targetDirectory, resolve(workspaceScope, packageName.slice(8)), 'dir')
    }
    /** Existing package-local links reveal external dependencies not exposed at root. */
    const sourceModules = resolve(directory.replace(tree, repositoryRoot), 'node_modules')
    if (!existsSync(sourceModules)) continue
    for (const dependency of readdirSync(sourceModules, { withFileTypes: true })) {
      if (dependency.name === '@migaia') continue
      /** Scoped external packages are linked one child at a time. */
      if (dependency.name.startsWith('@')) {
        const sourceScope = resolve(sourceModules, dependency.name)
        const targetScope = resolve(directory, 'node_modules', dependency.name)
        mkdirSync(targetScope, { recursive: true })
        for (const child of readdirSync(sourceScope)) {
          const target = resolve(targetScope, child)
          if (!existsSync(target))
            symlinkSync(realpathSync(resolve(sourceScope, child)), target, 'dir')
        }
        continue
      }
      /** Unscoped external dependency remains read-only through its installed real path. */
      const target = resolve(directory, 'node_modules', dependency.name)
      if (!existsSync(target))
        symlinkSync(realpathSync(resolve(sourceModules, dependency.name)), target, 'dir')
    }
  }
}

/** Copies the current tree and applies the complete storage inverse only inside that copy. */
export function materializeCompleteStorageInverse(repositoryRoot, plan) {
  /** Temporary inverse root is removed by the caller after gate execution. */
  const tree = mkdtempSync(resolve(tmpdir(), 'migai-d47-complete-inverse-'))
  try {
    cpSync(repositoryRoot, tree, {
      recursive: true,
      filter: (source) => {
        /** Generated, VCS, and dependency trees never contribute authored inverse bytes. */
        const path = relative(repositoryRoot, source).split('\\').join('/')
        return !(
          path === '.git' ||
          path.startsWith('.git/') ||
          path === 'node_modules' ||
          path.includes('/node_modules/') ||
          path === '.pnpm-store' ||
          path.startsWith('.pnpm-store/') ||
          path === 'graphify-out' ||
          path.startsWith('graphify-out/') ||
          path === 'coverage' ||
          path.includes('/dist/') ||
          path.endsWith('/dist') ||
          path.includes('/coverage/') ||
          path.endsWith('/coverage') ||
          path.includes('/target/') ||
          path.endsWith('/target') ||
          path.includes('/test-results/') ||
          path.includes('/playwright-report/')
        )
      }
    })
    /** Applied path list must remain the complete sealed denominator. */
    const appliedPaths = []
    for (const fileName of plan.paths) {
      /** Target is always repository-relative and therefore inside the isolated tree. */
      const target = resolve(tree, fileName)
      /** Historical absence means the complete inverse removes the Cycle 2-created path. */
      const baseline = readBaselineFile(repositoryRoot, plan.baseCommit, fileName)
      if (baseline === undefined) rmSync(target, { recursive: true, force: true })
      else {
        mkdirSync(resolve(target, '..'), { recursive: true })
        writeFileSync(target, applyCompatibilityEdits(baseline, fileName, plan.edits), 'utf8')
      }
      appliedPaths.push(fileName)
    }
    verifyCompleteStorageInversePaths(plan.paths, appliedPaths)
    linkTreeDependencies(repositoryRoot, tree)
    return tree
  } catch (error) {
    rmSync(tree, { recursive: true, force: true })
    throw error
  }
}

/** Ordered package builds ensure both trees execute against their own authored dependency graph. */
const d47BuildPackages = [
  'utils',
  'lifecycle',
  'reactive',
  'event-subscriber',
  'middleware-pipeline',
  'plugin-host',
  'capability',
  'resource',
  'serialize',
  'web-rpc'
]

/** Runs one build command and retains both bounded diagnostic streams. */
const runBuildCommand = (command, args, cwd, label) => {
  /** Spawn result is bounded so a broken inverse cannot hang the terminal audit. */
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true' },
    maxBuffer: 32 * 1024 * 1024,
    timeout: 180_000
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    /** TypeScript and Vite choose different streams for their primary diagnostics. */
    const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
    throw new Error(`${label} failed: ${diagnostic.slice(-1200)}`)
  }
}

/** Executes one sealed package build without allowing pnpm to repair the inverse lockfile. */
export function buildCompleteStorageInversePackage(tree, packageDirectory, binaryRoot) {
  /** Current or reverted manifest remains the authority for its exact build command. */
  const packageRoot = resolve(tree, 'packages', packageDirectory)
  /** Build script is restricted to the repository's existing Vite and TypeScript commands. */
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
  const buildScript = requireString(manifest.scripts?.build, `${packageDirectory} build script`)
  for (const [stepIndex, commandText] of buildScript.split(' && ').entries()) {
    /** Existing scripts use only whitespace-separated Vite/TypeScript CLI arguments. */
    const [binary, ...args] = commandText.split(/\s+/)
    if (!['vite', 'tsc'].includes(binary))
      throw new Error(`${packageDirectory} build command is not authorized: ${binary}`)
    runBuildCommand(
      resolve(binaryRoot, 'node_modules/.bin', binary),
      args,
      packageRoot,
      `D47 dependency build ${packageDirectory}:${stepIndex}`
    )
  }
}

/** Builds the finite owner dependency chain identically in current and inverse trees. */
export function buildCompleteStorageInverseDependencies(tree, binaryRoot) {
  for (const packageDirectory of d47BuildPackages)
    buildCompleteStorageInversePackage(tree, packageDirectory, binaryRoot)
}
