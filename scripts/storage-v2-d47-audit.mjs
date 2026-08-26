import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import {
  buildCompleteStorageInverseDependencies,
  buildCompleteStorageInversePackage,
  deriveCompleteStorageInversePlan,
  materializeCompleteStorageInverse,
  verifyCompleteStorageInversePaths
} from './storage-v2-complete-inverse.mjs'

/** Exact deferred IDs authorized by the normative D47 replan. */
const expectedDeferredIds = ['SWV2-DEF01', 'SWV2-DEF02']

/** Final gates that remain blocked while any D47 candidate is red. */
const expectedBlockedGates = ['B00-B', 'repository SHIP', 'capability promotion']

/** Exact default-script equivalents that preserve package semantics under Vitest JSON reporting. */
const expectedGateExecutions = new Map([
  [
    '@migaia/lifecycle',
    {
      packageDirectory: 'packages/lifecycle',
      expectedTestScript: 'pnpm run build && vitest run',
      preCommands: [['pnpm', '--filter', '@migaia/lifecycle', 'build']],
      vitestArguments: ['run']
    }
  ],
  [
    '@migaia/store-worker',
    {
      packageDirectory: 'packages/store-worker',
      expectedTestScript: 'vitest run test',
      preCommands: [],
      vitestArguments: ['run', 'test']
    }
  ],
  [
    '@migaia/web-rpc',
    {
      packageDirectory: 'packages/web-rpc',
      expectedTestScript: 'vitest run test --coverage',
      preCommands: [],
      vitestArguments: ['run', 'test', '--coverage']
    }
  ]
])

/** Terminal escape matcher built without embedding a control character in source. */
const ansiPattern = new RegExp(`${String.fromCodePoint(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')

/** Removes terminal coloring so assertion and summary parsing is deterministic. */
const stripAnsi = (value) => value.replaceAll(ansiPattern, '')

/** Computes the exact byte hash used by the D43 observation snapshot. */
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

/** Reads one JSON artifact without a module cache or implicit coercion. */
const readJson = (fileName) => JSON.parse(readFileSync(fileName, 'utf8'))

/** Requires a non-empty string at an exact ledger location. */
const requireString = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
  return value
}

/** Requires an array without filtering malformed members away. */
const requireArray = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

/** Requires an object record distinct from arrays and null. */
const requireRecord = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value
}

/** Rejects duplicate values instead of allowing a Set to hide ledger ambiguity. */
const requireUnique = (values, label) => {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`)
}

/** Loads exact path hashes from the immutable canonical D43 JSONL snapshot. */
const readSnapshotHashes = (snapshotPath) => {
  /** Parsed path facts keyed without discarding duplicate rows. */
  const pathRows = readFileSync(snapshotPath, 'utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter(({ record }) => record === 'path')
  /** Exact path list detects duplicate immutable facts before map construction. */
  const paths = pathRows.map(({ path }) => requireString(path, 'snapshot path'))
  requireUnique(paths, 'snapshot paths')
  return new Map(
    pathRows.map(({ path, contentSha256 }) => [
      path,
      requireString(contentSha256, `${path} snapshot hash`)
    ])
  )
}

/** Source extensions admitted by the bounded causal import resolver. */
const sourceExtensions = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.json']

/** Returns the first existing regular file represented by one source-like path. */
const resolveSourceFile = (absolutePath) => {
  /** Explicit JavaScript specifiers resolve to TypeScript sources under bundler semantics. */
  const extension = extname(absolutePath)
  /** Ordered candidates preserve the repository's `.js` source-specifier convention. */
  const candidates = [absolutePath]
  if (extension === '.js' || extension === '.mjs') {
    const stem = absolutePath.slice(0, -extension.length)
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`)
  } else if (extension.length === 0) {
    for (const candidateExtension of sourceExtensions)
      candidates.push(`${absolutePath}${candidateExtension}`)
    for (const candidateExtension of sourceExtensions)
      candidates.push(resolve(absolutePath, `index${candidateExtension}`))
  }
  for (const candidate of candidates)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  return undefined
}

/** Converts one absolute repository file to a slash-stable relative identity. */
const repositoryRelativePath = (repositoryRoot, absolutePath) => {
  /** Platform-relative path is normalized before path-boundary checks. */
  const repositoryPath = relative(repositoryRoot, absolutePath)
  if (repositoryPath === '..' || repositoryPath.startsWith(`..${sep}`))
    throw new Error(`D47 causal path escapes repository: ${absolutePath}`)
  return repositoryPath.split(sep).join('/')
}

/** Selects one runtime export target without treating declaration-only types as execution. */
const runtimeExportTarget = (value) => {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  for (const condition of ['default', 'import', 'browser', 'node']) {
    const target = runtimeExportTarget(value[condition])
    if (target !== undefined) return target
  }
  return undefined
}

/** Reads workspace package names and runtime export maps for causal package imports. */
const readWorkspacePackageMap = (repositoryRoot) => {
  /** Package facts are finite because migai owns one first-level packages directory. */
  const packages = new Map()
  const packagesRoot = resolve(repositoryRoot, 'packages')
  for (const directoryName of readdirSync(packagesRoot)) {
    const packageDirectory = resolve(packagesRoot, directoryName)
    const manifestPath = resolve(packageDirectory, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = readJson(manifestPath)
    if (typeof manifest.name === 'string')
      packages.set(manifest.name, { packageDirectory, manifestPath, exports: manifest.exports })
  }
  return packages
}

/** Resolves one workspace export target back to its authored source file. */
const resolveWorkspaceImport = (specifier, packageMap) => {
  /** Scoped package identity occupies the first two path segments. */
  const segments = specifier.split('/')
  const packageName = segments.slice(0, 2).join('/')
  const packageFact = packageMap.get(packageName)
  if (packageFact === undefined) return []
  /** Subpaths use package-exports keys while root imports use `.`. */
  const exportKey = segments.length === 2 ? '.' : `./${segments.slice(2).join('/')}`
  const exportsValue = packageFact.exports
  const exportValue =
    typeof exportsValue === 'object' && exportsValue !== null && !Array.isArray(exportsValue)
      ? exportsValue[exportKey]
      : exportKey === '.'
        ? exportsValue
        : undefined
  const target = runtimeExportTarget(exportValue)
  if (target === undefined) throw new Error(`D47 cannot resolve workspace export ${specifier}`)
  /** Published `dist` targets map deterministically to their owning source module. */
  const sourceTarget = target.replace(/^\.\/dist\//, './src/')
  const sourceFile = resolveSourceFile(resolve(packageFact.packageDirectory, sourceTarget))
  if (sourceFile === undefined) throw new Error(`D47 workspace export source missing: ${specifier}`)
  return [packageFact.manifestPath, sourceFile]
}

/** Determines whether an import declaration contributes only erased type information. */
const isTypeOnlyImport = (node) => {
  const clause = node.importClause
  if (clause?.isTypeOnly === true) return true
  if (clause?.name !== undefined || clause?.namedBindings === undefined) return false
  return (
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  )
}

/** Extracts bounded runtime module specifiers and existing relative file literals. */
const sourceDependencies = (sourceFile) => {
  /** TypeScript's parser avoids comment/string confusion without doing value-flow analysis. */
  const document = ts.createSourceFile(
    sourceFile,
    readFileSync(sourceFile, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  /** Module specifiers preserve runtime dependency direction. */
  const moduleSpecifiers = new Set()
  /** Relative file literals cover direct JSON/SDD/script inputs used by reviewed tests. */
  const relativeFiles = new Set()
  /** AST visitor deliberately admits only syntax-local facts. */
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      !isTypeOnlyImport(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      moduleSpecifiers.add(node.moduleSpecifier.text)
    else if (
      ts.isExportDeclaration(node) &&
      node.isTypeOnly !== true &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      moduleSpecifiers.add(node.moduleSpecifier.text)
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      moduleSpecifiers.add(node.arguments[0].text)
    if (ts.isStringLiteralLike(node) && node.text.startsWith('.')) {
      const file = resolveSourceFile(resolve(dirname(sourceFile), node.text))
      if (file !== undefined) relativeFiles.add(file)
    }
    ts.forEachChild(node, visit)
  }
  visit(document)
  return { moduleSpecifiers: [...moduleSpecifiers], relativeFiles: [...relativeFiles] }
}

/**
 * Derives one complete bounded importer closure from reviewed test roots.
 *
 * @param {string} repositoryRoot Canonical repository root
 * @param {string} packageDirectory Package-relative execution root
 * @param {readonly string[]} causalRoots Reviewed failed test roots
 * @returns {readonly string[]} Sorted repository-relative causal files
 */
export function deriveD47CausalClosure(repositoryRoot, packageDirectory, causalRoots) {
  /** Workspace package exports are resolved inward to their authored sources. */
  const packageMap = readWorkspacePackageMap(repositoryRoot)
  /** Package execution metadata participates in every assertion from that package. */
  const executionRoot = resolve(repositoryRoot, packageDirectory)
  /** Initial roots include the failed tests plus package-owned runtime configuration. */
  const queue = causalRoots.map((path) => resolve(repositoryRoot, path))
  for (const metadataName of [
    'package.json',
    'tsconfig.json',
    'tsconfig.test.json',
    'vite.config.ts',
    'vitest.config.ts'
  ]) {
    const metadataPath = resolve(executionRoot, metadataName)
    if (existsSync(metadataPath) && statSync(metadataPath).isFile()) queue.push(metadataPath)
  }
  /** Visited absolute files make recursion deterministic and cycle-safe. */
  const visited = new Set()
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined || visited.has(current)) continue
    const resolvedCurrent = resolveSourceFile(current)
    if (resolvedCurrent === undefined) throw new Error(`D47 causal root missing: ${current}`)
    const relativeCurrent = repositoryRelativePath(repositoryRoot, resolvedCurrent)
    if (relativeCurrent.startsWith('node_modules/')) continue
    visited.add(resolvedCurrent)
    if (!['.ts', '.tsx', '.mts', '.mjs', '.js'].includes(extname(resolvedCurrent))) continue
    const dependencies = sourceDependencies(resolvedCurrent)
    queue.push(...dependencies.relativeFiles)
    for (const specifier of dependencies.moduleSpecifiers) {
      if (specifier.startsWith('.')) {
        const dependency = resolveSourceFile(resolve(dirname(resolvedCurrent), specifier))
        if (dependency === undefined)
          throw new Error(`D47 relative import missing: ${relativeCurrent} -> ${specifier}`)
        queue.push(dependency)
      } else if (specifier.startsWith('@migaia/'))
        queue.push(...resolveWorkspaceImport(specifier, packageMap))
    }
  }
  return [...visited]
    .map((path) => repositoryRelativePath(repositoryRoot, path))
    .sort((left, right) => left.localeCompare(right))
}

/** Reads every Cycle 2 semantic migration path from the authoritative T54 unit ledger. */
const readMigrationChangedPaths = (repositoryRoot, migrationUnitsArtifact) => {
  /** Migration-unit categories are the only accepted changed-path denominator. */
  const migrationLedger = requireRecord(
    readJson(resolve(repositoryRoot, migrationUnitsArtifact)),
    'migration unit ledger'
  )
  const migrationUnits = requireArray(migrationLedger.migrationUnits, 'migration units')
  const paths = []
  for (const [unitIndex, unitValue] of migrationUnits.entries()) {
    const unit = requireRecord(unitValue, `migration unit ${unitIndex}`)
    const categories = requireRecord(unit.categories, `${unit.id} categories`)
    for (const [category, categoryPathsValue] of Object.entries(categories)) {
      const categoryPaths = requireArray(categoryPathsValue, `${unit.id}.${category}`)
      for (const [pathIndex, path] of categoryPaths.entries())
        paths.push(requireString(path, `${unit.id}.${category}[${pathIndex}]`))
    }
  }
  return new Set(paths)
}

/** Parses the sealed one-row-per-file causal closure artifact. */
const readCausalClosureArtifact = (artifactPath) => {
  /** JSONL avoids a formatter-expanded artifact that would breach D45's line breaker. */
  const rows = readFileSync(artifactPath, 'utf8')
    .trimEnd()
    .split('\n')
    .map((line, index) => {
      try {
        return requireRecord(JSON.parse(line), `causal closure row ${index}`)
      } catch (error) {
        throw new Error(`causal closure row ${index} is malformed`, { cause: error })
      }
    })
  if (rows.length === 0) throw new Error('causal closure artifact is empty')
  const metadata = rows[0]
  if (
    JSON.stringify(Object.keys(metadata).sort()) !==
      JSON.stringify(['record', 'schemaVersion'].sort()) ||
    metadata.record !== 'metadata' ||
    metadata.schemaVersion !== 1
  )
    throw new Error('causal closure metadata mismatch')
  /** Remaining rows must be exact package/path/hash facts. */
  const files = rows.slice(1).map((row, index) => {
    if (
      JSON.stringify(Object.keys(row).sort()) !==
        JSON.stringify(['currentSha256', 'package', 'path', 'record', 'snapshotSha256'].sort()) ||
      row.record !== 'file'
    )
      throw new Error(`causal closure file row ${index} keys mismatch`)
    return {
      package: requireString(row.package, `causal closure row ${index} package`),
      path: requireString(row.path, `causal closure row ${index} path`),
      snapshotSha256:
        row.snapshotSha256 === null
          ? null
          : requireString(row.snapshotSha256, `causal closure row ${index} snapshotSha256`),
      currentSha256: requireString(row.currentSha256, `causal closure row ${index} currentSha256`)
    }
  })
  requireUnique(
    files.map(({ package: packageName, path }) => `${packageName}\0${path}`),
    'causal closure package paths'
  )
  return files
}

/** Builds deterministic closure rows for every candidate package gate. */
const deriveCausalClosureRows = (ledger, repositoryRoot) => {
  /** D43 hashes classify closure files without inventing historical outcomes. */
  const snapshotHashes = readSnapshotHashes(
    resolve(repositoryRoot, requireString(ledger.observationSnapshot, 'observationSnapshot'))
  )
  /** Each package gate owns one union closure for all of its deferred assertions. */
  const rows = []
  for (const candidate of requireArray(ledger.deferredCandidates, 'deferredCandidates'))
    for (const gate of requireArray(candidate.gates, `${candidate.id} gates`)) {
      const packageName = requireString(gate.package, 'causal gate package')
      const packageDirectory = requireString(
        gate.packageDirectory,
        `${packageName} packageDirectory`
      )
      const roots = requireArray(gate.causalRoots, `${packageName} causalRoots`).map(
        (root, index) => requireString(root, `${packageName} causal root ${index}`)
      )
      for (const path of deriveD47CausalClosure(repositoryRoot, packageDirectory, roots)) {
        const currentSha256 = sha256(readFileSync(resolve(repositoryRoot, path)))
        rows.push({
          record: 'file',
          package: packageName,
          path,
          snapshotSha256: snapshotHashes.get(path) ?? null,
          currentSha256
        })
      }
    }
  return rows
}

/**
 * Fails closed unless the sealed closure exactly equals the derived closure, then returns every
 * real migration intersection for the mandatory complete-inverse differential.
 *
 * @param {readonly unknown[]} declaredRows Sealed package/path/hash rows
 * @param {readonly unknown[]} derivedRows Fresh importer-derived package/path/hash rows
 * @param {ReadonlySet<string>} migrationChangedPaths Authoritative Cycle 2 changed paths
 * @returns {readonly string[]} Sorted package/path intersection identities
 */
export function verifyD47CausalClosure(declaredRows, derivedRows, migrationChangedPaths) {
  /** Exact row equality prevents closure pruning or injection before intersections are classified. */
  if (JSON.stringify(declaredRows) !== JSON.stringify(derivedRows))
    throw new Error('D47 causal closure is incomplete or contains injected files')
  /** Intersections remain explicit inputs to the inverse differential, never exclusions. */
  const intersections = []
  for (const [rowIndex, rowValue] of declaredRows.entries()) {
    const row = requireRecord(rowValue, `D47 causal closure row ${rowIndex}`)
    const path = requireString(row.path, `D47 causal closure row ${rowIndex} path`)
    const packageName = requireString(row.package, `D47 causal closure row ${rowIndex} package`)
    if (migrationChangedPaths.has(path)) intersections.push(`${packageName}\0${path}`)
  }
  return intersections.sort()
}

/** Writes a deterministic closure artifact only when explicitly invoked by the maintainer. */
const writeCausalClosureArtifact = (ledger, repositoryRoot) => {
  const artifactPath = resolve(
    repositoryRoot,
    requireString(ledger.causalClosureArtifact, 'causalClosureArtifact')
  )
  const rows = [
    { record: 'metadata', schemaVersion: 1 },
    ...deriveCausalClosureRows(ledger, repositoryRoot)
  ]
  writeFileSync(artifactPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`)
  process.stdout.write(
    `SWV2-D47 CLOSURE-WRITTEN files=${rows.length - 1} sha256=${sha256(readFileSync(artifactPath))}\n`
  )
}

/** Normalizes repository-local stack paths before hashing one structured failure block. */
const normalizeFailureMessage = (message, repositoryRoot) =>
  stripAnsi(message)
    .replaceAll('\\', '/')
    .replaceAll(repositoryRoot.replaceAll('\\', '/'), '<repository>')
    .replaceAll('\r', '')

/** Produces the exact structured identity used for duplicate/missing assertion checks. */
const assertionIdentity = (testFile, ancestorTitles, title) =>
  JSON.stringify([testFile, ancestorTitles, title])

/**
 * Parses exact failed assertions from Vitest's JSON reporter without reading free-text logs.
 *
 * @param {string} output Vitest JSON reporter stdout
 * @param {string} repositoryRoot Canonical repository root used for stable stack normalization
 * @returns {{
 *   readonly assertions: readonly {
 *     readonly testFile: string
 *     readonly ancestorTitles: readonly string[]
 *     readonly title: string
 *     readonly failureMessageSha256: string
 *   }[]
 *   readonly summary: { readonly failed: number; readonly passed: number; readonly total: number }
 * }}
 *   Structured assertion evidence
 */
export function parseD47VitestJson(output, repositoryRoot) {
  /** Whole-document JSON parsing rejects unrelated setup-log injection around the report. */
  let report
  try {
    report = requireRecord(JSON.parse(output), 'Vitest JSON report')
  } catch (error) {
    throw new Error('Vitest JSON report is malformed', { cause: error })
  }
  /** Reporter counts are required integers and remain the same-snapshot authority. */
  const summary = {
    failed: report.numFailedTests,
    passed: report.numPassedTests,
    total: report.numTotalTests
  }
  for (const [field, value] of Object.entries(summary))
    if (!Number.isInteger(value) || value < 0)
      throw new Error(`Vitest JSON ${field} count is invalid`)
  if (summary.failed + summary.passed > summary.total)
    throw new Error('Vitest JSON assertion counts exceed total')
  if (report.success !== false) throw new Error('Vitest JSON classified gate must remain red')

  /** Failed assertions are bound to one exact file, ancestor list, title, and failure block. */
  const assertions = []
  const identities = []
  const testResults = requireArray(report.testResults, 'Vitest JSON testResults')
  for (const [resultIndex, resultValue] of testResults.entries()) {
    const result = requireRecord(resultValue, `Vitest JSON testResults[${resultIndex}]`)
    const absoluteTestFile = requireString(result.name, `Vitest JSON result ${resultIndex} name`)
    const testFile = repositoryRelativePath(repositoryRoot, absoluteTestFile)
    const assertionResults = requireArray(
      result.assertionResults,
      `Vitest JSON ${testFile} assertionResults`
    )
    const failedAssertions = assertionResults.filter(
      (assertion) => requireRecord(assertion, `${testFile} assertion`).status === 'failed'
    )
    if (result.status === 'failed' && failedAssertions.length === 0)
      throw new Error(`Vitest JSON suite-level failure is not deferrable: ${testFile}`)
    if (typeof result.message === 'string' && result.message.length > 0)
      throw new Error(`Vitest JSON suite message is not deferrable: ${testFile}`)
    for (const [assertionIndex, assertionValue] of failedAssertions.entries()) {
      const assertion = requireRecord(
        assertionValue,
        `${testFile} failed assertion ${assertionIndex}`
      )
      const ancestorTitles = requireArray(
        assertion.ancestorTitles,
        `${testFile} assertion ancestorTitles`
      ).map((title, titleIndex) => requireString(title, `${testFile} ancestor title ${titleIndex}`))
      const title = requireString(assertion.title, `${testFile} assertion title`)
      const failureMessages = requireArray(
        assertion.failureMessages,
        `${testFile} failureMessages`
      ).map((message, messageIndex) =>
        requireString(message, `${testFile} failure message ${messageIndex}`)
      )
      if (failureMessages.length === 0)
        throw new Error(`Vitest JSON failed assertion lacks a failure block: ${testFile}`)
      identities.push(assertionIdentity(testFile, ancestorTitles, title))
      assertions.push({
        testFile,
        ancestorTitles,
        title,
        failureMessageSha256: sha256(
          failureMessages
            .map((message) => normalizeFailureMessage(message, repositoryRoot))
            .join('\n---failure-message---\n')
        )
      })
    }
  }
  requireUnique(identities, 'Vitest JSON failed assertion identities')
  if (assertions.length !== summary.failed)
    throw new Error('Vitest JSON failed assertion count mismatch')
  return { assertions, summary }
}

/**
 * Validates the D47 ledger against immutable D43 facts and current protected file bytes.
 *
 * @param {unknown} value Parsed ledger candidate
 * @param {string} repositoryRoot Canonical repository root
 * @returns {void}
 */
export function validateD47Ledger(value, repositoryRoot) {
  /** Root ledger shape remains closed by explicit exact-key comparison. */
  const ledger = requireRecord(value, 'D47 ledger')
  const expectedRootKeys = [
    'blocksUntilOwnerGreen',
    'causalClosureArtifact',
    'causalClosureSha256',
    'completeStorageInverse',
    'deferredCandidates',
    'migrationUnitsArtifact',
    'observationSnapshot',
    'protectedFiles',
    'schemaVersion',
    'scope'
  ]
  if (JSON.stringify(Object.keys(ledger).sort()) !== JSON.stringify(expectedRootKeys))
    throw new Error('D47 ledger root keys mismatch')
  if (ledger.schemaVersion !== 3) throw new Error('D47 ledger schemaVersion must be 3')
  if (ledger.scope !== 'C2-R5/B00-A classification only') throw new Error('D47 scope mismatch')
  if (JSON.stringify(ledger.blocksUntilOwnerGreen) !== JSON.stringify(expectedBlockedGates))
    throw new Error('D47 blocked gate set mismatch')

  /** D43 path facts prove each deferred assertion existed before Cycle 2 technical patches. */
  const snapshotRelativePath = requireString(ledger.observationSnapshot, 'observationSnapshot')
  const snapshotHashes = readSnapshotHashes(resolve(repositoryRoot, snapshotRelativePath))
  /** The sealed closure is re-derived before any candidate can be classified external. */
  const causalClosureArtifact = requireString(ledger.causalClosureArtifact, 'causalClosureArtifact')
  const causalClosurePath = resolve(repositoryRoot, causalClosureArtifact)
  const causalClosureHash = requireString(ledger.causalClosureSha256, 'causalClosureSha256')
  if (sha256(readFileSync(causalClosurePath)) !== causalClosureHash)
    throw new Error('D47 causal closure artifact hash mismatch')
  const causalClosureRows = readCausalClosureArtifact(causalClosurePath)
  const migrationChangedPaths = readMigrationChangedPaths(
    repositoryRoot,
    requireString(ledger.migrationUnitsArtifact, 'migrationUnitsArtifact')
  )
  /** Complete inverse metadata seals every unique T54 migration path and the D43 base commit. */
  const inversePlan = deriveCompleteStorageInversePlan(
    repositoryRoot,
    ledger.migrationUnitsArtifact,
    snapshotRelativePath
  )
  const inverseFact = requireRecord(ledger.completeStorageInverse, 'completeStorageInverse')
  if (
    JSON.stringify(Object.keys(inverseFact).sort()) !==
    JSON.stringify(['baseCommit', 'pathCount', 'pathSetSha256'].sort())
  )
    throw new Error('completeStorageInverse keys mismatch')
  if (inverseFact.baseCommit !== inversePlan.baseCommit)
    throw new Error('complete storage inverse base commit mismatch')
  if (inverseFact.pathCount !== inversePlan.paths.length)
    throw new Error('complete storage inverse path count mismatch')
  if (inverseFact.pathSetSha256 !== inversePlan.pathSetSha256)
    throw new Error('complete storage inverse path hash mismatch')
  verifyCompleteStorageInversePaths([...migrationChangedPaths].sort(), inversePlan.paths)
  for (const row of causalClosureRows) {
    if ((snapshotHashes.get(row.path) ?? null) !== row.snapshotSha256)
      throw new Error(`${row.package} causal closure D43 hash mismatch: ${row.path}`)
    if (sha256(readFileSync(resolve(repositoryRoot, row.path))) !== row.currentSha256)
      throw new Error(`${row.package} causal closure current hash drift: ${row.path}`)
  }
  const derivedClosureRows = deriveCausalClosureRows(ledger, repositoryRoot).map(
    ({ package: packageName, path, snapshotSha256, currentSha256 }) => ({
      package: packageName,
      path,
      snapshotSha256,
      currentSha256
    })
  )
  /** Protected source/root/doc bytes prove Round 18 does not create the external failures. */
  const protectedFiles = requireArray(ledger.protectedFiles, 'protectedFiles')
  const protectedPaths = protectedFiles.map((entry, index) =>
    requireString(
      requireRecord(entry, `protectedFiles[${index}]`).path,
      `protectedFiles[${index}].path`
    )
  )
  requireUnique(protectedPaths, 'protected file paths')
  for (const [index, valueEntry] of protectedFiles.entries()) {
    /** Protected file fact allows exactly one immutable comparison authority. */
    const entry = requireRecord(valueEntry, `protectedFiles[${index}]`)
    const keys = Object.keys(entry).sort()
    const snapshotBacked = 'snapshotSha256' in entry
    const expectedKeys = snapshotBacked
      ? ['path', 'snapshotSha256']
      : ['path', 'round18BaselineSha256']
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys))
      throw new Error(`${entry.path} protected file keys mismatch`)
    const expectedHash = requireString(
      snapshotBacked ? entry.snapshotSha256 : entry.round18BaselineSha256,
      `${entry.path} protected hash`
    )
    if (snapshotBacked && snapshotHashes.get(entry.path) !== expectedHash)
      throw new Error(`${entry.path} protected snapshot mismatch`)
    const currentHash = sha256(readFileSync(resolve(repositoryRoot, entry.path)))
    if (currentHash !== expectedHash) throw new Error(`${entry.path} protected file drift`)
  }

  /** Deferred candidates remain finite and cannot silently become accepted or green. */
  const candidates = requireArray(ledger.deferredCandidates, 'deferredCandidates')
  const candidateIds = candidates.map((candidate, index) =>
    requireString(
      requireRecord(candidate, `deferredCandidates[${index}]`).id,
      `candidate ${index} id`
    )
  )
  if (JSON.stringify(candidateIds) !== JSON.stringify(expectedDeferredIds))
    throw new Error('D47 deferred candidate set mismatch')

  /** Assertion IDs and exact failure headings are globally unique across owners. */
  const assertionIds = []
  const failureKeys = []
  for (const [candidateIndex, candidateValue] of candidates.entries()) {
    const candidate = requireRecord(candidateValue, `candidate ${candidateIndex}`)
    const expectedCandidateKeys = [
      'gates',
      'id',
      'owner',
      'ownerSdd',
      'ownerSddMarker',
      'revalidateOn',
      'status'
    ]
    if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(expectedCandidateKeys))
      throw new Error(`${candidate.id} candidate keys mismatch`)
    if (candidate.status !== 'existing-external-defect-candidate')
      throw new Error(`${candidate.id} cannot be classified green`)
    requireString(candidate.owner, `${candidate.id} owner`)
    const ownerSdd = requireString(candidate.ownerSdd, `${candidate.id} ownerSdd`)
    const ownerMarker = requireString(candidate.ownerSddMarker, `${candidate.id} ownerSddMarker`)
    if (!readFileSync(resolve(repositoryRoot, ownerSdd), 'utf8').includes(ownerMarker))
      throw new Error(`${candidate.id} owner SDD marker drift`)
    const triggers = requireArray(candidate.revalidateOn, `${candidate.id} revalidateOn`).map(
      (trigger, index) => requireString(trigger, `${candidate.id} trigger ${index}`)
    )
    if (!triggers.includes('before B00-B')) throw new Error(`${candidate.id} lacks B00-B trigger`)
    const gates = requireArray(candidate.gates, `${candidate.id} gates`)
    if (gates.length === 0) throw new Error(`${candidate.id} has no default gate`)
    for (const [gateIndex, gateValue] of gates.entries()) {
      const gate = requireRecord(gateValue, `${candidate.id} gate ${gateIndex}`)
      const packageName = requireString(gate.package, `${candidate.id} gate package`)
      const expectedExecution = expectedGateExecutions.get(packageName)
      if (expectedExecution === undefined) throw new Error(`${packageName} gate is not authorized`)
      const expectedGateKeys = [
        'assertions',
        'causalRoots',
        'expectedSummary',
        'expectedTestScript',
        'package',
        'packageDirectory',
        'preCommands',
        'vitestArguments'
      ]
      if (JSON.stringify(Object.keys(gate).sort()) !== JSON.stringify(expectedGateKeys))
        throw new Error(`${packageName} gate keys mismatch`)
      for (const executionKey of [
        'packageDirectory',
        'expectedTestScript',
        'preCommands',
        'vitestArguments'
      ])
        if (JSON.stringify(gate[executionKey]) !== JSON.stringify(expectedExecution[executionKey]))
          throw new Error(`${packageName} ${executionKey} drift`)
      const manifest = readJson(resolve(repositoryRoot, gate.packageDirectory, 'package.json'))
      if (manifest.scripts?.test !== gate.expectedTestScript)
        throw new Error(`${packageName} default test script drift`)
      const summary = requireRecord(gate.expectedSummary, `${packageName} expectedSummary`)
      for (const field of ['failed', 'passed', 'total'])
        if (!Number.isInteger(summary[field]) || summary[field] < 0)
          throw new Error(`${packageName} expectedSummary.${field} must be non-negative integer`)
      if (summary.failed + summary.passed !== summary.total)
        throw new Error(`${packageName} expectedSummary total mismatch`)
      const assertions = requireArray(gate.assertions, `${packageName} assertions`)
      if (assertions.length !== summary.failed)
        throw new Error(`${packageName} assertion count must equal failed count`)
      for (const [assertionIndex, assertionValue] of assertions.entries()) {
        const assertion = requireRecord(
          assertionValue,
          `${packageName} assertion ${assertionIndex}`
        )
        const expectedAssertionKeys = [
          'ancestorTitles',
          'currentSha256',
          'failureMessageSha256',
          'id',
          'snapshotSha256',
          'testFile',
          'title'
        ]
        if (JSON.stringify(Object.keys(assertion).sort()) !== JSON.stringify(expectedAssertionKeys))
          throw new Error(`${packageName} assertion keys mismatch`)
        assertionIds.push(requireString(assertion.id, `${packageName} assertion id`))
        const testFile = requireString(assertion.testFile, `${assertion.id} testFile`)
        const ancestorTitles = requireArray(
          assertion.ancestorTitles,
          `${assertion.id} ancestorTitles`
        ).map((title, index) => requireString(title, `${assertion.id} ancestor title ${index}`))
        const title = requireString(assertion.title, `${assertion.id} title`)
        failureKeys.push(assertionIdentity(testFile, ancestorTitles, title))
        requireString(assertion.failureMessageSha256, `${assertion.id} failureMessageSha256`)
        const expectedHash = requireString(
          assertion.snapshotSha256,
          `${assertion.id} snapshotSha256`
        )
        if (snapshotHashes.get(testFile) !== expectedHash)
          throw new Error(`${assertion.id} D43 snapshot hash mismatch`)
        const currentHash = requireString(assertion.currentSha256, `${assertion.id} currentSha256`)
        if (sha256(readFileSync(resolve(repositoryRoot, testFile))) !== currentHash)
          throw new Error(`${assertion.id} current assertion hash drift`)
      }
      const causalRoots = requireArray(gate.causalRoots, `${packageName} causalRoots`).map(
        (root, index) => requireString(root, `${packageName} causal root ${index}`)
      )
      const assertionRoots = [...new Set(assertions.map((assertion) => assertion.testFile))].sort()
      if (JSON.stringify([...causalRoots].sort()) !== JSON.stringify(assertionRoots))
        throw new Error(`${packageName} causal roots must equal failed assertion files`)
    }
  }
  requireUnique(assertionIds, 'D47 assertion IDs')
  requireUnique(failureKeys, 'D47 failure keys')
  /** Real intersections are retained for the required inverse differential, never pruned. */
  verifyD47CausalClosure(causalClosureRows, derivedClosureRows, migrationChangedPaths)
}

/**
 * Fails closed unless one package JSON report exactly matches its structured D47 ledger.
 *
 * @param {unknown} gateValue One gate row from the validated ledger
 * @param {string} output Vitest JSON reporter stdout
 * @param {string} repositoryRoot Canonical repository root
 * @returns {void}
 */
export function verifyD47GateOutput(gateValue, output, repositoryRoot) {
  const gate = requireRecord(gateValue, 'D47 gate')
  const packageName = requireString(gate.package, 'D47 gate package')
  const parsed = parseD47VitestJson(output, repositoryRoot)
  const assertions = requireArray(gate.assertions, `${packageName} assertions`)
  const expectedFailures = assertions
    .map((assertion) => ({
      testFile: assertion.testFile,
      ancestorTitles: assertion.ancestorTitles,
      title: assertion.title,
      failureMessageSha256: assertion.failureMessageSha256
    }))
    .sort((left, right) =>
      assertionIdentity(left.testFile, left.ancestorTitles, left.title).localeCompare(
        assertionIdentity(right.testFile, right.ancestorTitles, right.title)
      )
    )
  const actualFailures = [...parsed.assertions].sort((left, right) =>
    assertionIdentity(left.testFile, left.ancestorTitles, left.title).localeCompare(
      assertionIdentity(right.testFile, right.ancestorTitles, right.title)
    )
  )
  if (
    JSON.stringify(
      actualFailures.map(({ testFile, ancestorTitles, title }) => ({
        testFile,
        ancestorTitles,
        title
      }))
    ) !==
    JSON.stringify(
      expectedFailures.map(({ testFile, ancestorTitles, title }) => ({
        testFile,
        ancestorTitles,
        title
      }))
    )
  )
    throw new Error(`${packageName} default gate assertion drift`)
  if (JSON.stringify(parsed.summary) !== JSON.stringify(gate.expectedSummary))
    throw new Error(`${packageName} default gate count drift`)
  for (let index = 0; index < expectedFailures.length; index += 1)
    if (
      actualFailures[index]?.failureMessageSha256 !== expectedFailures[index]?.failureMessageSha256
    )
      throw new Error(`${packageName} structured failure block drift`)
}

/** Canonicalizes a complete failed-assertion set without relying on reporter ordering. */
const canonicalFailureSet = (parsed) =>
  [...parsed.assertions].sort((left, right) =>
    assertionIdentity(left.testFile, left.ancestorTitles, left.title).localeCompare(
      assertionIdentity(right.testFile, right.ancestorTitles, right.title)
    )
  )

/**
 * Requires exact current-versus-complete-inverse failed assertion identity, hash, and set equality.
 *
 * @param {ReturnType<typeof parseD47VitestJson>} current Current-worktree report
 * @param {ReturnType<typeof parseD47VitestJson>} reverted Complete-storage-inverse report
 * @param {string} packageName Owner package used for exact diagnostics
 * @returns {void}
 */
export function verifyD47InverseDifferential(current, reverted, packageName) {
  /** Failed totals must agree before individual rows are compared. */
  if (current.summary.failed !== reverted.summary.failed)
    throw new Error(`${packageName} inverse differential failure count drift`)
  /** Sorted complete sets expose omitted and added failures symmetrically. */
  const currentFailures = canonicalFailureSet(current)
  const revertedFailures = canonicalFailureSet(reverted)
  const identities = (failures) =>
    failures.map(({ testFile, ancestorTitles, title }) => ({ testFile, ancestorTitles, title }))
  if (JSON.stringify(identities(currentFailures)) !== JSON.stringify(identities(revertedFailures)))
    throw new Error(`${packageName} inverse differential failure identity set drift`)
  for (let index = 0; index < currentFailures.length; index += 1)
    if (
      currentFailures[index]?.failureMessageSha256 !== revertedFailures[index]?.failureMessageSha256
    )
      throw new Error(`${packageName} inverse differential failure hash drift`)
}

/** Runs all exact owner gates in one tree and returns their complete structured reports. */
const runD47GateReports = (tree, gates, binaryRoot) => {
  /** Reports remain keyed by package because the finite ledger has one gate per owner package. */
  const reports = new Map()
  for (const gate of gates) {
    for (const [stepIndex, step] of gate.preCommands.entries()) {
      const [command, ...args] = step
      /** Only the validated lifecycle pnpm-build shape is admitted, then executed without install. */
      if (
        command !== 'pnpm' ||
        JSON.stringify(args) !== JSON.stringify(['--filter', gate.package, 'build'])
      )
        throw new Error(`${gate.package} pre-command ${stepIndex} is not executable`)
      buildCompleteStorageInversePackage(tree, gate.packageDirectory.split('/').at(-1), binaryRoot)
    }
    /** JSON reporter emits the only evidence admitted by the structured parser. */
    const result = spawnSync(
      resolve(binaryRoot, 'node_modules/.bin/vitest'),
      [...gate.vitestArguments, '--reporter=json'],
      {
        cwd: resolve(tree, gate.packageDirectory),
        encoding: 'utf8',
        env: { ...process.env, CI: 'true' },
        maxBuffer: 32 * 1024 * 1024,
        timeout: 180_000
      }
    )
    if (result.error !== undefined) throw result.error
    if (result.status !== 1) throw new Error(`${gate.package} expected classified red exit 1`)
    reports.set(gate.package, {
      output: result.stdout ?? '',
      parsed: parseD47VitestJson(result.stdout ?? '', tree)
    })
  }
  return reports
}

/** Runs the ordered current-worktree D47 default-gate classification. */
function runD47Audit() {
  /** Tool location fixes the repository root without trusting caller cwd. */
  const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  /** Ledger is read on every invocation so edited facts cannot hide in module cache. */
  const ledgerPath = resolve(repositoryRoot, 'scripts/storage-v2-d47-ledger.json')
  const ledger = readJson(ledgerPath)
  validateD47Ledger(ledger, repositoryRoot)
  /** Complete inverse plan is independently re-derived from T54 and D43 authorities. */
  const inversePlan = deriveCompleteStorageInversePlan(
    repositoryRoot,
    ledger.migrationUnitsArtifact,
    ledger.observationSnapshot
  )
  /** Ordered gates run in both trees before any candidate is admitted. */
  const gates = ledger.deferredCandidates.flatMap(({ gates }) => gates)
  /** Temporary tree is always cleaned even when an expected blocker fails closed. */
  const inverseTree = materializeCompleteStorageInverse(repositoryRoot, inversePlan)
  try {
    buildCompleteStorageInverseDependencies(repositoryRoot, repositoryRoot)
    const currentReports = runD47GateReports(repositoryRoot, gates, repositoryRoot)
    buildCompleteStorageInverseDependencies(inverseTree, repositoryRoot)
    const revertedReports = runD47GateReports(inverseTree, gates, repositoryRoot)
    for (const gate of gates) {
      /** Package report must exist on both sides of the same default-gate differential. */
      const current = currentReports.get(gate.package)
      const reverted = revertedReports.get(gate.package)
      if (current === undefined || reverted === undefined)
        throw new Error(`${gate.package} inverse differential report missing`)
      verifyD47InverseDifferential(current.parsed, reverted.parsed, gate.package)
      verifyD47GateOutput(gate, current.output, repositoryRoot)
      process.stdout.write(
        `SWV2-D47 CLASSIFIED package=${gate.package} failed=${gate.expectedSummary.failed} passed=${gate.expectedSummary.passed} inversePaths=${inversePlan.paths.length} status=deferred-external\n`
      )
    }
  } finally {
    rmSync(inverseTree, { recursive: true, force: true })
  }
  validateD47Ledger(ledger, repositoryRoot)
  const assertions = gates.reduce((count, gate) => count + gate.assertions.length, 0)
  process.stdout.write(
    `SWV2-D47 PASS candidates=${ledger.deferredCandidates.length} gates=${gates.length} assertions=${assertions} blocks=B00-B,SHIP,capability-promotion\n`
  )
}

/** Direct execution is the only path that runs external owner default gates. */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write-closure') {
    const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
    const ledger = readJson(resolve(repositoryRoot, 'scripts/storage-v2-d47-ledger.json'))
    writeCausalClosureArtifact(ledger, repositoryRoot)
  } else runD47Audit()
}
