import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { build } from 'vite'

/** Repository root supplies the exact package graph to each isolated runtime candidate. */
const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..', '..')
/** Storage source is copied so the fault is never applied to the shared worktree. */
const storageSourceDirectory = resolve(repositoryRoot, 'packages/storage-host/src')
/** This symbol represents the removed compiler/metadata execution branch in a poisoned candidate. */
const legacyExecutionSymbol = 'migaia.storage-host.legacy-execution'
/** Exact retained wrapper instruction replaced only in the disposable poisoned source copy. */
const nativeDefinitionRead = 'const definition = readStorageNativePluginDefinition(plugin)'

const RetainedEntryCase = {
  backendRegistration: 'backend-registration',
  featureMaterialization: 'feature-materialization',
  partialInstallRollback: 'partial-install-rollback',
  aliasedLegacyEntry: 'aliased-legacy-entry'
} as const

type IRetainedEntryCase = (typeof RetainedEntryCase)[keyof typeof RetainedEntryCase]

/** Builds one real retained entry scenario without giving the production package a test seam. */
const entrySourceFor = (entryCase: IRetainedEntryCase): string => {
  const scenario = {
    [RetainedEntryCase.backendRegistration]: `
const plugin = definePlugin('legacy-registration', (core) => ({
  kind,
  install: () => { core.registerStore(createStore()); return {} }
}))
const host = await createStorageHost({ plugins: [plugin] })
if (host.backend('legacy-registration') === undefined) throw new Error('legacy runtime backend registration missing')
await host.dispose()`,
    [RetainedEntryCase.featureMaterialization]: `
const token = defineStorageCapability<{ read(): string }>()('retained-feature')
const feature = defineFeature(memoryBackendKind, () => ({
  capabilities: [implement(token, { read: () => 'capability' })],
  chain: { tx: { marker<T>(this: T): T { return this } } },
  api: { store: { async marker() { return this.store } }, transaction: {} }
}))
const host = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'legacy-feature' }, { feature })]
})
const store = host.backend('legacy-feature')
if (store.use(token).read() !== 'capability') throw new Error('retained Feature capability missing')
const builder = store.tx()
if (builder.marker() !== builder) throw new Error('retained Feature chain missing')
if (await store.api.marker() !== store) throw new Error('retained Feature API missing')
await host.dispose()`,
    [RetainedEntryCase.partialInstallRollback]: `
const firstStore = createStore()
let firstDisposeCount = 0
const disposeFirstStore = firstStore.dispose
Object.defineProperty(firstStore, 'dispose', {
  value: async () => { firstDisposeCount += 1; return disposeFirstStore() }
})
const originalInstallFailure = new Error('legacy runtime intentional rollback')
const first = definePlugin('legacy-rollback-first', (core) => ({
  kind,
  install: () => { core.registerStore(firstStore); return {} }
}))
const failed = definePlugin('legacy-rollback-failed', () => ({
  install: () => { throw originalInstallFailure }
}))
let rollbackFailure: unknown
try { await createStorageHost({ plugins: [first, failed] }) } catch (error) { rollbackFailure = error }
if (rollbackFailure === undefined) throw new Error('legacy runtime rollback unexpectedly installed')
let cause: unknown = rollbackFailure
let originalFailureReachable = false
for (let depth = 0; depth < 8 && cause instanceof Error; depth += 1) {
  if (cause === originalInstallFailure) originalFailureReachable = true
  cause = cause.cause
}
if (!originalFailureReachable) throw new Error('legacy runtime rollback lost original failure')
if (firstDisposeCount !== 1) throw new Error('legacy runtime rollback did not dispose first Store once')
`,
    [RetainedEntryCase.aliasedLegacyEntry]: `
const aliasedDefinePlugin = definePlugin
const plugin = aliasedDefinePlugin('legacy-alias', (core) => ({
  kind,
  install: () => { core.registerStore(createStore()); return {} }
}))
const host = await createStorageHost({ plugins: [plugin] })
if (host.backend('legacy-alias') === undefined) throw new Error('legacy runtime aliased entry missing')
await host.dispose()`
  } as const satisfies Record<IRetainedEntryCase, string>
  return scenario[entryCase]
}

/**
 * Runs the real retained Host plus native Feature entry from an isolated native-only or poisoned
 * copy.
 */
const runRetainedEntryCandidate = async (
  entryCase: IRetainedEntryCase,
  poisonLegacyBranch: boolean
): Promise<{ readonly status: number; readonly output: string }> => {
  const candidateDirectory = mkdtempSync(join(tmpdir(), 'migaia-storage-host-retained-'))
  try {
    const sourceDirectory = join(candidateDirectory, 'src')
    const outputDirectory = join(candidateDirectory, 'out')
    const hostPath = join(sourceDirectory, 'storage-host.ts')
    cpSync(storageSourceDirectory, sourceDirectory, { recursive: true })
    symlinkSync(
      resolve(repositoryRoot, 'packages/storage-host/node_modules'),
      join(candidateDirectory, 'node_modules'),
      'dir'
    )
    if (poisonLegacyBranch) {
      const source = readFileSync(hostPath, 'utf8')
      if (!source.includes(nativeDefinitionRead))
        throw new Error('legacy runtime retained definition read moved')
      writeFileSync(
        hostPath,
        source.replace(
          nativeDefinitionRead,
          `const legacyExecution = (globalThis as Record<PropertyKey, unknown>)[Symbol.for('${legacyExecutionSymbol}')]
        if (typeof legacyExecution === 'function') legacyExecution()
        ${nativeDefinitionRead}`
        ),
        'utf8'
      )
    }
    const entryPath = join(candidateDirectory, 'entry.ts')
    writeFileSync(
      entryPath,
      `const legacyTrace: string[] = []
globalThis[Symbol.for('${legacyExecutionSymbol}')] = () => { legacyTrace.push('${entryCase}') }
import {
  createStorageHost, definePlugin, defineFeature, defineStorageBackendKind,
  memoryBackendKind, memoryBackendPlugin
} from './src/index.js'
import { defineStorageCapability, implement } from '@migaia/storage-contract'
const kind = defineStorageBackendKind()('retained')
/** Each candidate supplies a legal raw resource through the actual installation entry. */
const createStore = () => ({
  backend: 'retained',
  capabilities: {
    syncRead: false, binary: false, records: false, transactions: false, iteration: false,
    secondaryIndexes: false, changeFeed: false, maxValueBytes: undefined, opaqueEntries: false
  },
  dispose: async () => {},
  [Symbol.asyncDispose]: async () => {}
})
${entrySourceFor(entryCase)}
if (legacyTrace.length !== 0) throw new Error('FORBIDDEN_LEGACY_EXECUTION:${entryCase}')
`,
      'utf8'
    )
    await build({
      configFile: false,
      logLevel: 'silent',
      root: candidateDirectory,
      build: {
        emptyOutDir: true,
        outDir: outputDirectory,
        lib: {
          entry: entryPath,
          formats: ['es'],
          fileName: () => 'entry.js'
        },
        rollupOptions: {
          external: (id) => id.startsWith('@migaia/')
        }
      }
    })
    try {
      execFileSync(process.execPath, [join(outputDirectory, 'entry.js')], {
        cwd: candidateDirectory,
        encoding: 'utf8',
        stdio: 'pipe'
      })
      return { status: 0, output: '' }
    } catch (error) {
      const result = error as {
        readonly status?: number
        readonly stderr?: string
        readonly stdout?: string
      }
      return {
        status: result.status ?? 1,
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`
      }
    }
  } finally {
    rmSync(candidateDirectory, { recursive: true, force: true })
  }
}

/** Requires the same retained entry to prove clean, poisoned, and restored runtime behavior. */
const expectRetainedEntrySensitivity = async (entryCase: IRetainedEntryCase): Promise<void> => {
  const clean = await runRetainedEntryCandidate(entryCase, false)
  expect(clean, entryCase).toEqual({ status: 0, output: '' })

  const poisoned = await runRetainedEntryCandidate(entryCase, true)
  expect(poisoned.status, entryCase).not.toBe(0)
  expect(poisoned.output, entryCase).toContain(`FORBIDDEN_LEGACY_EXECUTION:${entryCase}`)

  const restored = await runRetainedEntryCandidate(entryCase, false)
  expect(restored, entryCase).toEqual({ status: 0, output: '' })
}

/** Exercises retained public Host/backend wrappers against a poisoned removed-authority branch. */
describe('retained Storage runtime authority', () => {
  it(
    'proves backend registration sensitivity',
    () => expectRetainedEntrySensitivity(RetainedEntryCase.backendRegistration),
    120_000
  )

  it(
    'proves native Feature materialization sensitivity',
    () => expectRetainedEntrySensitivity(RetainedEntryCase.featureMaterialization),
    120_000
  )

  it(
    'proves partial-install rollback sensitivity',
    () => expectRetainedEntrySensitivity(RetainedEntryCase.partialInstallRollback),
    120_000
  )

  it(
    'proves aliased retained-entry sensitivity',
    () => expectRetainedEntrySensitivity(RetainedEntryCase.aliasedLegacyEntry),
    120_000
  )
})
