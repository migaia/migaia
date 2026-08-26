import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

type IRollbackConsumer = {
  readonly id: string
  readonly requires: readonly string[]
}

type IRollbackUnit = {
  readonly id: string
  readonly rollback: boolean
  readonly provides: readonly string[]
  readonly consumers: readonly IRollbackConsumer[]
  readonly exports: readonly string[]
  readonly dependencies: readonly string[]
  readonly tests: readonly string[]
  readonly assets: readonly string[]
  readonly files: readonly string[]
  readonly compatibilityEdits?: readonly {
    readonly file: string
    readonly search: string
    readonly replacement: string
  }[]
}

type IRetiredArtifact = {
  readonly id: 'cycle1-callable-fact-ledger'
  readonly path: string
  readonly disposition: 'deleted'
  readonly evidence: string
}

type IRollbackFixture = {
  readonly schemaVersion: number
  readonly retiredArtifacts: readonly IRetiredArtifact[]
  readonly baseline: {
    readonly baseCommit: string
  }
  readonly sharedProviders: readonly string[]
  readonly capabilityFlags: Readonly<Record<string, boolean>>
  readonly v1Gates: readonly {
    readonly packageName: string
    readonly script: string
    readonly requires: readonly string[]
  }[]
  readonly directGates: readonly {
    readonly packageName: string
    readonly script: string
    readonly kind: 'package-script' | 'vitest'
    readonly requires: readonly string[]
  }[]
  readonly migrationUnits: readonly IRollbackUnit[]
}

type IRollbackMapFixture = Omit<IRollbackFixture, 'baseline' | 'migrationUnits'>

type IRollbackLedgerUnit = Omit<IRollbackUnit, 'files'> & {
  readonly categories: Readonly<Record<string, readonly string[]>>
}

type IRollbackUnitLedger = {
  readonly observationSnapshot: string
  readonly migrationUnits: readonly IRollbackLedgerUnit[]
}

type IObservationTombstone = {
  readonly record: 'path'
  readonly path: string
  readonly contentSha256: string
  readonly postCaptureDisposition?: 'deleted'
}

type IRollbackState = {
  readonly providers: ReadonlySet<string>
  readonly consumers: readonly IRollbackConsumer[]
  readonly exports: ReadonlySet<string>
  readonly dependencies: ReadonlySet<string>
  readonly tests: ReadonlySet<string>
  readonly capabilityFlags: Readonly<Record<string, boolean>>
  readonly v1Gates: readonly { readonly packageName: string; readonly script: string }[]
}

/** Reads the narrowed rollback map and the C2-R3 migration-unit ledger. */
const readFixture = (): IRollbackFixture => {
  const shared = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        '..',
        '..',
        'event-subscriber/test/fixtures/storage-v2-b00-capability-map.json'
      ),
      'utf8'
    )
  ) as IRollbackMapFixture
  const ledger = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, 'fixtures/storage-v2-c2-migration-units.json'),
      'utf8'
    )
  ) as IRollbackUnitLedger
  const metadata = readFileSync(resolve(repositoryRoot, ledger.observationSnapshot), 'utf8')
    .split('\n', 1)
    .map((line) => JSON.parse(line) as { readonly baseCommit: string })[0]!
  return {
    ...shared,
    baseline: { baseCommit: metadata.baseCommit },
    migrationUnits: ledger.migrationUnits.map((unit) => ({
      ...unit,
      files: [...new Set(Object.values(unit.categories).flat())]
    }))
  }
}

/** Reads only deleted-path evidence from the formatter-clean Cycle 2 observation. */
const readObservationTombstones = (): readonly IObservationTombstone[] =>
  readFileSync(
    resolve(import.meta.dirname, 'fixtures/storage-v2-c2-observation-snapshot.jsonl'),
    'utf8'
  )
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as Partial<IObservationTombstone>)
    .filter(
      (record): record is IObservationTombstone =>
        record.record === 'path' &&
        typeof record.path === 'string' &&
        typeof record.contentSha256 === 'string'
    )

/** Returns only units that have a real inverse-patch rehearsal contract. */
const rollbackUnits = (fixture: IRollbackFixture): readonly IRollbackUnit[] =>
  fixture.migrationUnits.filter((unit) => unit.rollback)

/** Checkout root used to materialize and reverse each real B00 migration file set. */
const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')

/** Exact unit IDs that T52 must physically rehearse. */
const expectedRollbackUnitIds = ['abort-timeout', 'event-fanout', 'live-ownership'] as const

/** Complete normalized projection rows consumed by T52 from the C2-R3 ledger. */
const expectedRollbackProjectionRows = [
  'abort-timeout\0assets\0["storage.operation-signal-adapter","utils.abort-timeout-signal-runtime","utils.promise-packed-smoke"]',
  'abort-timeout\0compatibilityEdits\0[]',
  'abort-timeout\0consumers\0[{"id":"storage.operation-signal-adapter","requires":["utils.abort-timeout-signal"]}]',
  'abort-timeout\0dependencies\0[]',
  'abort-timeout\0exports\0["@migaia/utils.createAbortTimeoutSignal"]',
  'abort-timeout\0provides\0["utils.abort-timeout-signal"]',
  'abort-timeout\0rollback\0true',
  'abort-timeout\0tests\0["SWV2-T47","SWV2-T48","SWV2-T49"]',
  'byte-brand\0assets\0["storage-web.byte-brand-browser","utils.byte-brand-runtime"]',
  'byte-brand\0compatibilityEdits\0[]',
  'byte-brand\0consumers\0[]',
  'byte-brand\0dependencies\0[]',
  'byte-brand\0exports\0["@migaia/utils.isArrayBuffer","@migaia/utils.isUint8Array"]',
  'byte-brand\0provides\0["utils.byte-brand"]',
  'byte-brand\0rollback\0false',
  'byte-brand\0tests\0["SWV2-T55","SWV2-T56","SWV2-T57","SWV2-T58"]',
  'event-fanout\0assets\0["event.dispatch-policy-contract","event.queued-runtime","storage.queued-feed-adapters"]',
  'event-fanout\0compatibilityEdits\0[{"file":"packages/storage-web/src/backends/indexed-db.ts","search":"  iteration: true,\\n  maxValueBytes: undefined,","replacement":"  iteration: true,\\n  secondaryIndexes: false,\\n  changeFeed: false,\\n  maxValueBytes: undefined,"},{"file":"packages/storage-web/src/backends/memory.ts","search":"  iteration: true,\\n  maxValueBytes: undefined,","replacement":"  iteration: true,\\n  secondaryIndexes: false,\\n  changeFeed: false,\\n  maxValueBytes: undefined,"}]',
  'event-fanout\0consumers\0[{"id":"storage.indexed-db.queued-feed","requires":["event.dispatch-policy"]},{"id":"storage.memory.queued-feed","requires":["event.dispatch-policy"]}]',
  'event-fanout\0dependencies\0[]',
  'event-fanout\0exports\0["@migaia/event-subscriber.EventDispatchPolicy"]',
  'event-fanout\0provides\0["event.dispatch-policy"]',
  'event-fanout\0rollback\0true',
  'event-fanout\0tests\0["SWV2-T45","SWV2-T46","SWV2-T53"]',
  'live-ownership\0assets\0["storage.lifecycle-build-external","storage.lifecycle-dependency-edge","storage.live-ownership-model"]',
  'live-ownership\0compatibilityEdits\0[]',
  'live-ownership\0consumers\0[{"id":"storage.live-ownership-blueprint","requires":["event.channel","lifecycle.generation","lifecycle.sync-scope","reactive.scheduler","reactive.signal"]}]',
  'live-ownership\0dependencies\0["@migaia/storage-web -> @migaia/lifecycle"]',
  'live-ownership\0exports\0[]',
  'live-ownership\0provides\0["storage.live-ownership-blueprint"]',
  'live-ownership\0rollback\0true',
  'live-ownership\0tests\0["SWV2-T50"]'
].sort()

/** Normalizes every mutable ledger field that controls T52 participation or removal. */
const rollbackProjectionRows = (units: readonly IRollbackUnit[]): readonly string[] =>
  units
    .flatMap((unit) => {
      const consumers = unit.consumers
        .map((consumer) => ({ id: consumer.id, requires: [...consumer.requires].sort() }))
        .sort((left, right) => left.id.localeCompare(right.id))
      const compatibilityEdits = [...(unit.compatibilityEdits ?? [])].sort((left, right) =>
        `${left.file}\0${left.search}\0${left.replacement}`.localeCompare(
          `${right.file}\0${right.search}\0${right.replacement}`
        )
      )
      return [
        `${unit.id}\0rollback\0${String(unit.rollback)}`,
        `${unit.id}\0provides\0${JSON.stringify([...unit.provides].sort())}`,
        `${unit.id}\0consumers\0${JSON.stringify(consumers)}`,
        `${unit.id}\0exports\0${JSON.stringify([...unit.exports].sort())}`,
        `${unit.id}\0dependencies\0${JSON.stringify([...unit.dependencies].sort())}`,
        `${unit.id}\0tests\0${JSON.stringify([...unit.tests].sort())}`,
        `${unit.id}\0assets\0${JSON.stringify([...unit.assets].sort())}`,
        `${unit.id}\0compatibilityEdits\0${JSON.stringify(compatibilityEdits)}`
      ]
    })
    .sort()

/** Reads one file from the immutable baseline named by the shared executable inventory. */
const readBaselineFile = (fixture: IRollbackFixture, fileName: string): string | undefined => {
  try {
    return execFileSync('git', ['show', `${fixture.baseline.baseCommit}:${fileName}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch {
    return undefined
  }
}

/** Applies reviewed additive-contract edits after restoring one unit's exact HEAD baseline. */
const applyCompatibilityEdits = (unit: IRollbackUnit, fileName: string, source: string): string => {
  let result = source
  for (const edit of unit.compatibilityEdits ?? []) {
    if (edit.file !== fileName) continue
    const first = result.indexOf(edit.search)
    if (first < 0 || result.indexOf(edit.search, first + edit.search.length) >= 0)
      throw new Error(`rollback compatibility edit must match once: ${unit.id}:${fileName}`)
    result = `${result.slice(0, first)}${edit.replacement}${result.slice(first + edit.search.length)}`
  }
  return result
}

/** Reads workspace package manifests from a complete rollback tree for static orphan checks. */
const readTreeManifests = (
  tree: string
): ReadonlyMap<
  string,
  { readonly directory: string; readonly manifest: Record<string, unknown> }
> => {
  const manifests = new Map<
    string,
    { readonly directory: string; readonly manifest: Record<string, unknown> }
  >()
  for (const parentName of ['packages', 'apps']) {
    const parent = join(tree, parentName)
    if (!existsSync(parent)) continue
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const directory = join(parent, entry.name)
      const manifestPath = join(directory, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
      if (typeof manifest.name === 'string') manifests.set(manifest.name, { directory, manifest })
    }
  }
  return manifests
}

/** Recursively returns source-like files in one package without reading generated output. */
const readTreeSources = (directory: string): readonly string[] => {
  const files: string[] = []
  const visit = (current: string): void => {
    if (!existsSync(current)) return
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name)
      if (entry.isDirectory()) visit(entryPath)
      else if (/\.(?:ts|tsx|js|mjs|mts)$/.test(entry.name)) files.push(entryPath)
    }
  }
  visit(directory)
  return files
}

/** Extracts workspace package imports for orphan and manifest dependency validation. */
const readWorkspaceImports = (source: string): readonly string[] => {
  const imports: string[] = []
  const pattern = /(?:from\s*|import\s*)['"](@migaia\/[^/'"]+)/g
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source))
    imports.push(match[1] ?? '')
  return imports
}

/** Validates manifests, workspace dependency declarations, and fail-closed storage capabilities. */
const validateRepositoryShape = (tree: string, unitContext: string): void => {
  const manifests = readTreeManifests(tree)
  for (const { manifest } of manifests.values()) expect(manifest.private).toBe(true)
  for (const { directory, manifest } of manifests.values()) {
    const dependencies = new Set([
      ...Object.keys((manifest.dependencies ?? {}) as Record<string, unknown>),
      ...Object.keys((manifest.devDependencies ?? {}) as Record<string, unknown>),
      ...Object.keys((manifest.peerDependencies ?? {}) as Record<string, unknown>)
    ])
    for (const file of readTreeSources(join(directory, 'src'))) {
      for (const importedPackage of readWorkspaceImports(readFileSync(file, 'utf8'))) {
        if (importedPackage === manifest.name) continue
        expect(
          manifests.has(importedPackage),
          `${manifest.name} imported unknown ${importedPackage}`
        ).toBe(true)
        expect(
          dependencies.has(importedPackage),
          `${unitContext}:${manifest.name}:${relative(tree, file)} missing ${importedPackage}`
        ).toBe(true)
      }
    }
  }
  const storageWeb = manifests.get('@migaia/storage-web')
  expect(storageWeb).toBeDefined()
  const storageSources = readTreeSources(join(storageWeb!.directory, 'src'))
  const storageText = storageSources.map((file) => readFileSync(file, 'utf8')).join('\n')
  expect(storageText).not.toMatch(/secondaryIndexes\s*:\s*true/)
  expect(
    readFileSync(join(storageWeb!.directory, 'src/backends/indexed-db.ts'), 'utf8')
  ).not.toMatch(/changeFeed\s*:\s*true/)
}

/** Rejects remaining source imports of a removed owner after a real unit rollback. */
const validateRemovedOwnerOrphans = (tree: string, unit: IRollbackUnit): void => {
  const removedPackages =
    unit.id === 'event-fanout' ? new Set(['packages/event-subscriber']) : new Set<string>()
  const manifests = readTreeManifests(tree)
  for (const { directory } of manifests.values()) {
    for (const file of readTreeSources(join(directory, 'src'))) {
      const source = readFileSync(file, 'utf8')
      for (const importedPackage of readWorkspaceImports(source)) {
        const importedManifest = manifests.get(importedPackage)
        if (importedManifest === undefined) continue
        const importedRelative = relative(tree, importedManifest.directory)
        if (removedPackages.has(importedRelative)) {
          const fileRelative = relative(tree, file)
          expect(unit.files, `${fileRelative} -> ${importedPackage}`).toContain(fileRelative)
        }
      }
    }
  }
}

/** Restores unrelated direct consumers while retaining the current storage integration baseline. */
const restoreDirectConsumerBaseline = (fixture: IRollbackFixture, tree: string): void => {
  const unitFiles = new Set(fixture.migrationUnits.flatMap((unit) => unit.files))
  const directConsumerRoots = ['packages/store-light/', 'packages/web-rpc/']
  const trackedFiles = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', fixture.baseline.baseCommit],
    { cwd: repositoryRoot, encoding: 'utf8' }
  )
    .split('\n')
    .filter((fileName) => directConsumerRoots.some((root) => fileName.startsWith(root)))
  for (const fileName of trackedFiles) {
    if (unitFiles.has(fileName)) continue
    const source = readBaselineFile(fixture, fileName)
    if (source === undefined) throw new Error(`baseline file missing: ${fileName}`)
    const target = resolve(tree, fileName)
    mkdirSync(resolve(target, '..'), { recursive: true })
    writeFileSync(target, source)
  }
  const untrackedFiles = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
    .split('\n')
    .filter((fileName) => directConsumerRoots.some((root) => fileName.startsWith(root)))
  for (const fileName of untrackedFiles)
    if (!unitFiles.has(fileName)) rmSync(resolve(tree, fileName), { recursive: true, force: true })
}

/** Applies the exact baseline inverse for one unit inside an isolated stable tree. */
const materializeRealRollback = (fixture: IRollbackFixture, unit: IRollbackUnit): string => {
  const tree = mkdtempSync(resolve(tmpdir(), 'migai-b00-rollback-'))
  cpSync(repositoryRoot, tree, {
    recursive: true,
    filter: (source) => {
      const relativePath = relative(repositoryRoot, source)
      return (
        !relativePath.startsWith('.git') &&
        !relativePath.startsWith('node_modules') &&
        !relativePath.endsWith('/node_modules') &&
        !relativePath.startsWith('graphify-out') &&
        !relativePath.includes('/node_modules/') &&
        !relativePath.includes('/dist/') &&
        !relativePath.includes('/coverage/')
      )
    }
  })
  restoreDirectConsumerBaseline(fixture, tree)
  symlinkSync(resolve(repositoryRoot, 'node_modules'), resolve(tree, 'node_modules'), 'dir')
  const rollbackManifests = readTreeManifests(tree)
  for (const { directory } of rollbackManifests.values()) {
    const scopeDirectory = resolve(directory, 'node_modules/@migaia')
    mkdirSync(scopeDirectory, { recursive: true })
    for (const [packageName, packageInfo] of rollbackManifests) {
      if (!packageName.startsWith('@migaia/')) continue
      const target = resolve(scopeDirectory, packageName.slice('@migaia/'.length))
      symlinkSync(packageInfo.directory, target, 'dir')
    }
    const sourceNodeModules = resolve(directory.replace(tree, repositoryRoot), 'node_modules')
    const targetNodeModules = resolve(directory, 'node_modules')
    if (existsSync(sourceNodeModules)) {
      for (const dependency of readdirSync(sourceNodeModules, { withFileTypes: true })) {
        if (dependency.name.startsWith('@')) continue
        const target = resolve(targetNodeModules, dependency.name)
        if (existsSync(target)) continue
        mkdirSync(resolve(target, '..'), { recursive: true })
        symlinkSync(realpathSync(resolve(sourceNodeModules, dependency.name)), target, 'dir')
      }
    }
  }
  for (const fileName of unit.files) {
    const currentPath = resolve(repositoryRoot, fileName)
    const targetPath = resolve(tree, fileName)
    if (!existsSync(currentPath)) throw new Error(`ledger file missing: ${fileName}`)
    mkdirSync(resolve(targetPath, '..'), { recursive: true })
    writeFileSync(targetPath, readFileSync(currentPath))
    const baseline = readBaselineFile(fixture, fileName)
    if (baseline === undefined) unlinkSync(targetPath)
    else writeFileSync(targetPath, applyCompatibilityEdits(unit, fileName, baseline))
  }
  for (const parentName of ['packages', 'apps']) {
    const parent = resolve(tree, parentName)
    if (!existsSync(parent)) continue
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifestPath = resolve(parent, entry.name, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
      if (manifest.private !== true) {
        manifest.private = true
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      }
    }
  }
  return tree
}

/** Runs repository-shape, export, dependency, and fail-closed gates against the rollback tree. */
const validateRealRollbackTree = (
  fixture: IRollbackFixture,
  unit: IRollbackUnit,
  tree: string
): readonly string[] => {
  const executedGates: string[] = []
  for (const fileName of unit.files) {
    const baseline = readBaselineFile(fixture, fileName)
    const rollbackPath = resolve(tree, fileName)
    if (baseline === undefined) expect(existsSync(rollbackPath), fileName).toBe(false)
    else if (fileName.endsWith('package.json')) {
      const expected = JSON.parse(applyCompatibilityEdits(unit, fileName, baseline)) as Record<
        string,
        unknown
      >
      const actual = JSON.parse(readFileSync(rollbackPath, 'utf8')) as Record<string, unknown>
      delete actual.private
      delete expected.private
      expect(actual, fileName).toEqual(expected)
    } else
      expect(readFileSync(rollbackPath, 'utf8'), fileName).toBe(
        applyCompatibilityEdits(unit, fileName, baseline)
      )
  }
  for (const packageName of [
    '@migaia/utils',
    '@migaia/lifecycle',
    '@migaia/reactive',
    '@migaia/event-subscriber',
    '@migaia/middleware-pipeline',
    '@migaia/plugin-host',
    '@migaia/capability',
    '@migaia/storage-contract'
  ])
    execFileSync('pnpm', ['--dir', tree, '--filter', packageName, 'run', 'build'], {
      cwd: tree,
      env: { ...process.env, CI: 'true' },
      stdio: 'pipe',
      timeout: 20_000
    })
  for (const gate of fixture.v1Gates) {
    expect(gate.script, `${unit.id}:${gate.packageName}`).toMatch(/^test\//)
    expect(
      existsSync(resolve(tree, 'packages/storage-web', gate.script)),
      `${unit.id}:${gate.script}`
    ).toBe(true)
    execFileSync(
      'pnpm',
      ['--dir', tree, '--filter', gate.packageName, 'exec', 'vitest', 'run', gate.script],
      {
        cwd: tree,
        env: { ...process.env, CI: 'true' },
        stdio: 'pipe',
        timeout: 30_000
      }
    )
    executedGates.push(`v1:${gate.packageName}:${gate.script}`)
  }
  for (const gate of fixture.directGates) {
    /** Runs one direct-consumer gate inside isolated rollback tree. */
    try {
      if (gate.kind === 'vitest') {
        const packageDirectory = readTreeManifests(tree).get(gate.packageName)?.directory
        expect(packageDirectory, `${unit.id}:${gate.packageName}`).toBeDefined()
        if (packageDirectory === undefined)
          throw new Error(`rollback consumer package missing: ${gate.packageName}`)
        expect(
          existsSync(resolve(packageDirectory, gate.script)),
          `${unit.id}:${gate.packageName}:${gate.script}`
        ).toBe(true)
      }
      const command =
        gate.kind === 'vitest'
          ? ['--dir', tree, '--filter', gate.packageName, 'exec', 'vitest', 'run', gate.script]
          : ['--dir', tree, '--filter', gate.packageName, 'run', gate.script]
      execFileSync('pnpm', command, {
        cwd: tree,
        env: { ...process.env, CI: 'true' },
        stdio: 'pipe',
        timeout: 20_000
      })
      executedGates.push(`direct:${gate.kind}:${gate.packageName}:${gate.script}`)
    } catch (error) {
      const failure = error as {
        readonly stderr?: Buffer | string
        readonly stdout?: Buffer | string
      }
      const output = [failure.stdout, failure.stderr]
        .map((value) => (typeof value === 'string' ? value : (value?.toString() ?? '')))
        .join('\n')
      throw new Error(
        `rollback gate failed ${unit.id}:${gate.packageName}:${gate.script}: ${output.slice(-1200)}`
      )
    }
  }
  for (const [flag, value] of Object.entries(fixture.capabilityFlags))
    if (flag.endsWith('.secondaryIndexes') || flag === 'indexed-db.changeFeed')
      expect(value, `capability promoted during ${unit.id}:${flag}`).toBe(false)
  for (const retained of rollbackUnits(fixture).filter((candidate) => candidate.id !== unit.id))
    for (const consumer of retained.consumers)
      for (const requirement of consumer.requires)
        expect(unit.provides.includes(requirement), `${consumer.id}:${requirement}`).toBe(false)
  validateRepositoryShape(tree, unit.id)
  validateRemovedOwnerOrphans(tree, unit)
  return executedGates
}

/** Rejects shared assets and incomplete rollback ownership before a rehearsal can run. */
const validateFixture = (fixture: IRollbackFixture): void => {
  expect(fixture.schemaVersion).toBe(7)
  /** Retired callable-ledger descriptor that stays separate from rollback inputs. */
  const retiredLedger = fixture.retiredArtifacts.find(
    (artifact) => artifact.id === 'cycle1-callable-fact-ledger'
  )
  expect(retiredLedger?.disposition).toBe('deleted')
  expect(retiredLedger?.evidence).toBe(
    'packages/storage-web/test/fixtures/storage-v2-c2-observation-snapshot.jsonl'
  )
  /** Retired callable-ledger path that must remain evidence, never rollback input. */
  const retiredLedgerPath = retiredLedger!.path
  /** Captured deletion row proving the retired artifact existed at observation time. */
  const retiredLedgerTombstone = readObservationTombstones().find(
    (row) => row.path === retiredLedgerPath
  )
  expect(
    fixture.migrationUnits.flatMap((unit) => unit.files),
    'retired ledger must stay outside rollback materialization'
  ).not.toContain(retiredLedgerPath)
  expect(existsSync(resolve(repositoryRoot, retiredLedgerPath))).toBe(false)
  expect(retiredLedgerTombstone?.postCaptureDisposition).toBe('deleted')
  expect(retiredLedgerTombstone?.contentSha256).toMatch(/^[0-9a-f]{64}$/)
  const unitIds = new Set<string>()
  const assets = new Map<string, string>()
  const providers = new Set(fixture.sharedProviders)
  for (const unit of rollbackUnits(fixture)) {
    if (unitIds.has(unit.id)) throw new Error(`duplicate rollback unit: ${unit.id}`)
    unitIds.add(unit.id)
    for (const provider of unit.provides) {
      if (providers.has(provider)) throw new Error(`duplicate provider: ${provider}`)
      providers.add(provider)
    }
    for (const asset of unit.assets) {
      const owner = assets.get(asset)
      if (owner !== undefined)
        throw new Error(`shared rollback asset ${asset}: ${owner}/${unit.id}`)
      assets.set(asset, unit.id)
    }
  }
  const gateKeys = fixture.v1Gates.map((gate) => `${gate.packageName}:${gate.script}`)
  if (new Set(gateKeys).size !== gateKeys.length) throw new Error('duplicate V1 gate')
  const directGateKeys = fixture.directGates.map(
    (gate) => `${gate.kind}:${gate.packageName}:${gate.script}`
  )
  if (new Set(directGateKeys).size !== directGateKeys.length)
    throw new Error('duplicate direct-consumer gate')
  for (const [flag, value] of Object.entries(fixture.capabilityFlags))
    if (value && (flag.endsWith('.secondaryIndexes') || flag === 'indexed-db.changeFeed'))
      throw new Error(`capability must remain fail-closed: ${flag}`)
  expect(
    rollbackUnits(fixture)
      .map((unit) => unit.id)
      .sort()
  ).toEqual(expectedRollbackUnitIds)
  expect(rollbackProjectionRows(fixture.migrationUnits)).toEqual(expectedRollbackProjectionRows)
}

/** Materializes the full migration graph before selecting one independently reversible unit. */
const materialize = (fixture: IRollbackFixture): IRollbackState => ({
  providers: new Set([
    ...fixture.sharedProviders,
    ...rollbackUnits(fixture).flatMap((unit) => unit.provides)
  ]),
  consumers: rollbackUnits(fixture).flatMap((unit) => unit.consumers),
  exports: new Set(rollbackUnits(fixture).flatMap((unit) => unit.exports)),
  dependencies: new Set(rollbackUnits(fixture).flatMap((unit) => unit.dependencies)),
  tests: new Set(rollbackUnits(fixture).flatMap((unit) => unit.tests)),
  capabilityFlags: { ...fixture.capabilityFlags },
  v1Gates: [...fixture.v1Gates]
})

/** Removes exactly one unit's owned surface and leaves every other migration unit untouched. */
const rollbackUnit = (fixture: IRollbackFixture, unitId: string): IRollbackState => {
  const removed = rollbackUnits(fixture).find((unit) => unit.id === unitId)
  if (removed === undefined) throw new Error(`unknown rollback unit: ${unitId}`)
  const retainedUnits = rollbackUnits(fixture).filter((unit) => unit.id !== unitId)
  return {
    providers: new Set([
      ...fixture.sharedProviders,
      ...retainedUnits.flatMap((unit) => unit.provides)
    ]),
    consumers: retainedUnits.flatMap((unit) => unit.consumers),
    exports: new Set(retainedUnits.flatMap((unit) => unit.exports)),
    dependencies: new Set(retainedUnits.flatMap((unit) => unit.dependencies)),
    tests: new Set(retainedUnits.flatMap((unit) => unit.tests)),
    capabilityFlags: { ...fixture.capabilityFlags },
    v1Gates: [...fixture.v1Gates]
  }
}

/** Ensures no retained adapter references a removed provider and no delivery gate drifted. */
const validateState = (fixture: IRollbackFixture, state: IRollbackState): void => {
  for (const consumer of state.consumers)
    for (const provider of consumer.requires)
      if (!state.providers.has(provider))
        throw new Error(`orphan provider edge: ${consumer.id} -> ${provider}`)
  expect(state.capabilityFlags).toEqual(fixture.capabilityFlags)
  expect(state.v1Gates).toEqual(fixture.v1Gates)
  for (const [flag, value] of Object.entries(state.capabilityFlags))
    if (value && (flag.endsWith('.secondaryIndexes') || flag === 'indexed-db.changeFeed'))
      throw new Error(`capability promoted during rollback: ${flag}`)
}

describe('SWV2-T52 independent migration rollback rehearsal', () => {
  it('rolls back event, abort-timeout, and live ownership independently', () => {
    const fixture = readFixture()
    validateFixture(fixture)
    const full = materialize(fixture)
    validateState(fixture, full)
    const executedRehearsalIds: string[] = []

    for (const removed of rollbackUnits(fixture)) {
      const state = rollbackUnit(fixture, removed.id)
      validateState(fixture, state)
      for (const provider of removed.provides) expect(state.providers.has(provider)).toBe(false)
      for (const exported of removed.exports) expect(state.exports.has(exported)).toBe(false)
      for (const dependency of removed.dependencies)
        expect(state.dependencies.has(dependency)).toBe(false)
      for (const test of removed.tests) expect(state.tests.has(test)).toBe(false)
      for (const retained of rollbackUnits(fixture).filter((unit) => unit.id !== removed.id)) {
        for (const provider of retained.provides) expect(state.providers.has(provider)).toBe(true)
        for (const test of retained.tests) expect(state.tests.has(test)).toBe(true)
      }

      const tree = materializeRealRollback(fixture, removed)
      try {
        const executedGates = validateRealRollbackTree(fixture, removed, tree)
        expect(executedGates, `${removed.id}:executed rollback gates`).toEqual([
          ...fixture.v1Gates.map((gate) => `v1:${gate.packageName}:${gate.script}`),
          ...fixture.directGates.map(
            (gate) => `direct:${gate.kind}:${gate.packageName}:${gate.script}`
          )
        ])
        executedRehearsalIds.push(removed.id)
      } finally {
        rmSync(tree, { recursive: true, force: true })
      }
    }
    expect(executedRehearsalIds.sort()).toEqual(expectedRollbackUnitIds)
  }, 120_000)

  it('rejects an orphan cross-unit edge, shared rollback asset, and capability promotion', () => {
    const fixture = readFixture()
    const orphanFixture: IRollbackFixture = {
      ...fixture,
      migrationUnits: fixture.migrationUnits.map((unit) =>
        unit.id === 'abort-timeout'
          ? {
              ...unit,
              consumers: [
                ...unit.consumers,
                { id: 'abort-hidden-event-coupling', requires: ['event.dispatch-policy'] }
              ]
            }
          : unit
      )
    }
    expect(() => validateState(orphanFixture, rollbackUnit(orphanFixture, 'event-fanout'))).toThrow(
      'orphan provider edge'
    )

    const sharedAssetFixture: IRollbackFixture = {
      ...fixture,
      migrationUnits: fixture.migrationUnits.map((unit, index) =>
        index === 1
          ? { ...unit, assets: [...unit.assets, fixture.migrationUnits[0]?.assets[0] ?? ''] }
          : unit
      )
    }
    expect(() => validateFixture(sharedAssetFixture)).toThrow('shared rollback asset')

    const promotedFixture: IRollbackFixture = {
      ...fixture,
      capabilityFlags: { ...fixture.capabilityFlags, 'indexed-db.secondaryIndexes': true }
    }
    expect(() => validateFixture(promotedFixture)).toThrow('capability must remain fail-closed')

    const omittedLiveRollback: IRollbackFixture = {
      ...fixture,
      migrationUnits: fixture.migrationUnits.map((unit) =>
        unit.id === 'live-ownership' ? { ...unit, rollback: false } : unit
      )
    }
    expect(() => validateFixture(omittedLiveRollback)).toThrow()

    const orphanTree = mkdtempSync(resolve(tmpdir(), 'migai-b00-orphan-'))
    try {
      const ownerPath = resolve(orphanTree, 'packages/event-subscriber/src/index.ts')
      mkdirSync(resolve(ownerPath, '..'), { recursive: true })
      writeFileSync(ownerPath, 'export const owner = true', 'utf8')
      const consumerPath = resolve(orphanTree, 'packages/storage-web/src/adapter.ts')
      mkdirSync(resolve(consumerPath, '..'), { recursive: true })
      writeFileSync(consumerPath, 'import { owner } from "@migaia/event-subscriber"', 'utf8')
      const validateOrphan = (): void => {
        if (
          readFileSync(consumerPath, 'utf8').includes('@migaia/event-subscriber') &&
          !existsSync(ownerPath)
        )
          throw new Error('orphan provider edge')
      }
      expect(() => validateOrphan()).not.toThrow()
      unlinkSync(ownerPath)
      expect(() => validateOrphan()).toThrow('orphan provider edge')
    } finally {
      rmSync(orphanTree, { recursive: true, force: true })
    }
  })

  it('rejects omission of a real additive-contract coupling through an executable gate', () => {
    const fixture = readFixture()
    const eventUnit = rollbackUnits(fixture).find((unit) => unit.id === 'event-fanout')
    expect(eventUnit).toBeDefined()
    if (eventUnit === undefined) return
    const brokenUnit: IRollbackUnit = {
      ...eventUnit,
      compatibilityEdits: eventUnit.compatibilityEdits?.filter(
        (edit) => edit.file !== 'packages/storage-web/src/backends/memory.ts'
      )
    }
    const tree = materializeRealRollback(fixture, brokenUnit)
    try {
      expect(() => validateRealRollbackTree(fixture, brokenUnit, tree)).toThrow(
        'rollback gate failed event-fanout:@migaia/storage-web:typecheck'
      )
    } finally {
      rmSync(tree, { recursive: true, force: true })
    }
  }, 60_000)
})
