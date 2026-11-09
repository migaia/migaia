import { describe, expect, it } from 'vitest'
import { PluginHost, definePlugin, type IPluginHostCore } from '@migaia/plugin-host'
import { defineFeature, featuresModule } from '@migaia/plugin-host/features'
import { featureDependenciesModule } from '@migaia/plugin-host/feature-dependencies'
import { walkErrorCauses } from '@migaia/utils/error'
import { createHost } from '../src/host/index.ts'

/** Managed mutation and drain deadlines remain explicit public construction inputs. */
const settings = {
  mutationAdmissionMs: 1000,
  quiescenceMs: 1000,
  shutdown: { mode: 'bounded' }
} as const

/** Count callbacks on genuine native definitions installed by the public managed Host seam. */
class InstallProbe {
  /** Public plugin name supplies the real registration identity. */
  readonly name: string
  /** Shared timeline observes actual acquisition and cleanup order. */
  readonly events: string[]
  /** Optional primary failure is thrown after native cleanup registration. */
  readonly failure: Error | undefined
  /** Native async-capable setup calls. */
  setups = 0
  /** Actual native install calls. */
  installs = 0
  /** Actual Feature factory executions. */
  factories = 0
  /** Business effects through original guarded extensions. */
  reads = 0
  /** Cleanup is counted independently of logical result publication. */
  disposals = 0
  /** Capture explicit fixture state; no separate generation or resource engine is introduced. */
  constructor(name: string, events: string[], failure?: Error) {
    this.name = name
    this.events = events
    this.failure = failure
  }
  /** Native setup remains independently observable. */
  setup(): void {
    this.setups += 1
  }
  /** Register genuine native cleanup before returning or throwing. */
  install(core: Pick<IPluginHostCore, 'onDispose'>) {
    this.installs += 1
    this.events.push(`install:${this.name}`)
    core.onDispose(() => this.dispose())
    if (this.failure) throw this.failure
    return { read: () => this.read() }
  }
  /** Feature outputs are real runtime values, not fabricated tokens. */
  factory() {
    this.factories += 1
    return { value: 1 }
  }
  /** Count admitted business calls separately from stale attempts. */
  read(): number {
    this.reads += 1
    return this.reads
  }
  /** Native rollback and final disposal share this original cleanup receipt. */
  dispose(): void {
    this.disposals += 1
    this.events.push(`dispose:${this.name}`)
  }
}
/** The supported create factory returns a genuine native Host with explicit selected modules. */
function native(withDependencies: boolean) {
  return new PluginHost<Record<string, never>>({
    modules: withDependencies ? [featuresModule, featureDependenciesModule] : [featuresModule],
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
}
/** Preserve the exact original definition while selecting only the tested Feature roots. */
function plugin(probe: InstallProbe) {
  return definePlugin({
    name: probe.name,
    setup: () => probe.setup(),
    install: (core) => probe.install(core)
  })
}
/** Read a callable from the actual public managed extension projection. */
function callable(view: object): () => number {
  /** Reflection observes the public projection; it never manufactures an authority-bearing handle. */
  const value = Reflect.get(view, 'read')
  expect(typeof value).toBe('function')
  return value as () => number
}
/** Partial startup rollback retains both cleanup order and the exact original primary. */
async function partialRollback(): Promise<void> {
  /** The same trace receives callbacks from the two actual native installations. */
  const events: string[] = []
  /** Original producer failure survives the native/managed boundary. */
  const original = new Error('second managed installation failed')
  /** Both plugins acquire cleanup before the second fails. */
  const first = new InstallProbe('first', events),
    second = new InstallProbe('second', events, original)
  /** Failed public creation is observed without replacing its emitted error. */
  let failure: unknown
  try {
    await createHost({
      ...settings,
      create: () => native(true),
      plugins: [plugin(first), plugin(second)]
    })
  } catch (error) {
    failure = error
    recordMatrixFailure(error)
  }
  expect(walkErrorCauses(failure)).toContain(original)
  expect(events).toEqual(['install:first', 'install:second', 'dispose:second', 'dispose:first'])
  expect([
    first.setups,
    second.setups,
    first.installs,
    second.installs,
    first.disposals,
    second.disposals
  ]).toEqual([1, 1, 1, 1, 1, 1])
}
/** Managed late use invokes one original setup/install and publishes the resulting projection. */
async function lateUse(): Promise<void> {
  /** Startup installation makes this genuinely late admission rather than initial configuration. */
  const first = new InstallProbe('first', []),
    late = new InstallProbe('late', [])
  /** Public managed constructor owns the actual concrete Host. */
  const host = await createHost({
    ...settings,
    create: () => native(true),
    plugins: [plugin(first)]
  })
  try {
    expect(callable(host.extensions)()).toBe(1)
    await host.unUse(first.name)
    /** Existing public use returns its native managed mutation observation. */
    const result = await host.use(plugin(late))
    expect(result).toMatchObject({ ok: true, committed: true })
    expect(callable(host.extensions)()).toBe(1)
    expect([late.setups, late.installs, late.reads]).toEqual([1, 1, 1])
  } finally {
    await host.dispose()
  }
  expect([first.disposals, late.disposals]).toEqual([1, 1])
}
/** Saved public views retain the removed registration rather than following future publication. */
async function staleCallables(): Promise<void> {
  /** Native acquisition remains independent of public cached extension references. */
  const probe = new InstallProbe('removed', [])
  /** Public managed seam owns the original installation and removal. */
  const host = await createHost({
    ...settings,
    create: () => native(true),
    plugins: [plugin(probe)]
  })
  try {
    /** Save both the actual projection and its detached guarded callable. */
    const view = host.extensions
    /** Detached reference is captured before logical revocation. */
    const saved = callable(view)
    expect(saved()).toBe(1)
    expect(await host.unUse(probe.name)).toMatchObject({ ok: true, committed: true })
    expect(() => {
      try {
        return saved()
      } catch (error) {
        recordMatrixFailure(error)
        throw error
      }
    }).toThrowError(expect.objectContaining({ code: 'REGISTRATION_REVOKED' }))
    expect(() => {
      try {
        return callable(view)()
      } catch (error) {
        recordMatrixFailure(error)
        throw error
      }
    }).toThrowError(expect.objectContaining({ code: 'REGISTRATION_REVOKED' }))
    expect([probe.reads, probe.disposals]).toEqual([1, 1])
  } finally {
    await host.dispose()
  }
}
/** The public concrete-Host factory provides real module-present and module-absent counterparts. */
async function dependencyTransitions(): Promise<void> {
  /** Separate owners prevent failed negative admission from contributing positive counts. */
  const missing = new InstallProbe('missing', []),
    admitted = new InstallProbe('admitted', [])
  /** Negative closure contains genuine original native dependency identities. */
  const negativeFirst = defineFeature(() => missing.factory())
  /** Required local Feature edge claims the dependency-planning module. */
  const negativeSecond = defineFeature(() => missing.factory(), { previous: negativeFirst })
  /**
   * No supported authority is manufactured: only the existing public create callback selects
   * modules.
   */
  const negative = definePlugin({
    name: missing.name,
    features: { first: negativeFirst, second: negativeSecond },
    setup: () => missing.setup(),
    install: (core) => missing.install(core)
  })
  /** Original negative diagnostic is retained for classification. */
  let failure: unknown
  try {
    await createHost({ ...settings, create: () => native(false), plugins: [negative] })
  } catch (error) {
    failure = error
    recordMatrixFailure(error)
  }
  expect(walkErrorCauses(failure).some(hasMissingModule)).toBe(true)
  expect([missing.setups, missing.installs, missing.factories]).toEqual([0, 0, 0])
  /** Positive counterpart preserves the same dependency shape on its real supported module set. */
  const first = defineFeature(() => admitted.factory())
  /** Exact identity is reused by the dependent Feature. */
  const second = defineFeature(() => admitted.factory(), { previous: first })
  /** Native setup/install remain observable through the public managed seam. */
  const definition = definePlugin({
    name: admitted.name,
    features: { first, second },
    setup: () => admitted.setup(),
    install: (core) => admitted.install(core)
  })
  /** The actual native Host owns the resulting managed graph. */
  const host = await createHost({ ...settings, create: () => native(true), plugins: [definition] })
  try {
    expect([admitted.setups, admitted.installs, admitted.factories]).toEqual([1, 1, 2])
    await host.unUse(admitted.name)
    expect(await host.use(definition)).toMatchObject({ ok: true })
    expect([admitted.setups, admitted.installs, admitted.factories, admitted.disposals]).toEqual([
      2, 2, 4, 1
    ])
  } finally {
    await host.dispose()
  }
  expect(admitted.disposals).toBe(2)
}
/** Match the existing native admission code anywhere on its retained original chain. */
function hasMissingModule(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'HOST_MODULE_MISSING'
  )
}
/** Register named cases without a closure-owned lifecycle component. */
function registerLifecycleCases(): void {
  it('rolls back partial public creation in reverse acquired order', partialRollback)
  it('admits late use after an earlier public callable ran', lateUse)
  it('rejects saved views and callables after exact removal', staleCallables)
  it('counts native dependency transitions with and without its module', dependencyTransitions)
}
describe('managed Host modular lifecycle', registerLifecycleCases)

/** Expected fixture failures retain complete classification; messages contain only fixture data. */
function recordMatrixFailure(error: unknown): void {
  for (const value of walkErrorCauses(error)) {
    if (value === undefined) continue
    /** Classification observes the original error without replacing it or changing its identity. */
    const failure = value as Error & { source?: string; code?: string; reason?: string }
    console.info(
      JSON.stringify({
        source: failure?.source ?? null,
        code: failure?.code ?? null,
        name: failure?.name ?? typeof value,
        reason: failure?.reason ?? null,
        message: failure?.message ?? String(value)
      })
    )
  }
}
