import { describe, expect, it } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { defineFeature } from '@migaia/plugin-host/features'
import { createStorageHost, definePlugin, type IStoragePluginCore } from '../src/index.ts'

/** Observe only callbacks accepted by the public storage authoring contract. */
class InstallProbe<const N extends string = string> {
  /** Acquisition and cleanup order comes from the original native owners. */
  readonly events: string[]
  /** Backend diagnostic id also owns ordinary plugin extension removal. */
  readonly name: N
  /** Optional original failure occurs after real cleanup acquisition. */
  readonly failure: Error | undefined
  /** Descriptor construction is distinct from setup, installation and Feature construction. */
  descriptors = 0
  /** Public install callback count. */
  installs = 0
  /** Native Feature factory count. */
  factories = 0
  /** Guarded extension business effects. */
  reads = 0
  /** Exact registered native cleanup count. */
  disposals = 0
  /** Capture concrete observation ownership without a parallel resource manager. */
  constructor(name: N, events: string[], failure?: Error) {
    this.name = name
    this.events = events
    this.failure = failure
  }
  /** The native descriptor receives the genuine storage installation core. */
  describe(core: Pick<IStoragePluginCore, 'onDispose'>) {
    this.descriptors += 1
    core.onDispose(() => this.dispose())
    return { install: () => this.install() }
  }
  /** Original install callback owns this business extension. */
  install() {
    this.installs += 1
    this.events.push(`install:${this.name}`)
    if (this.failure) throw this.failure
    return { read: () => this.read() }
  }
  /** Genuine native construction, including each reinstall generation. */
  factory() {
    this.factories += 1
    return { value: 1 }
  }
  /** Count only admitted public extension calls. */
  read(): number {
    this.reads += 1
    return this.reads
  }
  /** Native rollback/removal invokes the original registered cleanup. */
  dispose(): void {
    this.disposals += 1
    this.events.push(`dispose:${this.name}`)
  }
}
/** Ordinary storage plugins need no fabricated Store to expose public extensions. */
function plugin<const N extends string>(probe: InstallProbe<N>) {
  return definePlugin(probe.name, (core) => probe.describe(core))
}
/** Retain exact observed failures and their package classifications in test output. */
async function reject(promise: PromiseLike<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    for (const value of walkErrorCauses(error)) {
      /** These fixture messages contain only explicit test payloads. */
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
    return error
  }
  return expect.fail('expected public operation rejection')
}
/** Two acquired native registrations roll back in reverse order without leaked extensions. */
async function rollbackPartialInstall(): Promise<void> {
  /** Shared trace makes disposal order observable independently of failure classification. */
  const events: string[] = []
  /** Original producer error must remain reachable through the storage/native boundary. */
  const original = new Error('second storage install failed')
  /** Each plugin registers cleanup through its genuine storage core. */
  const first = new InstallProbe('first', events),
    second = new InstallProbe('second', events, original)
  /** The real public facade owns installation and projection. */
  const host = await createStorageHost()
  try {
    /** Failure remains the original cause in the native chain. */
    const failure = await reject(host.use(plugin(first), plugin(second)))
    expect(failure).toMatchObject({ source: 'storage.host', code: 'BACKEND_INSTALL_FAILED' })
    expect(walkErrorCauses(failure)).toContain(original)
    expect(events).toEqual(['install:first', 'install:second', 'dispose:second', 'dispose:first'])
    expect([first.descriptors, second.descriptors, first.installs, second.installs]).toEqual([
      1, 1, 1, 1
    ])
    expect(Object.keys(host.extensions)).toEqual([])
  } finally {
    await host.dispose()
  }
  expect([first.disposals, second.disposals]).toEqual([1, 1])
}
/** Storage retains supported late plugin installation after earlier real backend operations. */
async function lateUse(): Promise<void> {
  /** The public facade has completed its initialization before late admission. */
  const host = await createStorageHost()
  /** Earlier public installation provides the first business operation. */
  const first = new InstallProbe('first', []),
    late = new InstallProbe('late', [])
  try {
    /** Awaited projection widens the same real facade. */
    const started = await host.use(plugin(first))
    expect(started.extensions.read()).toBe(1)
    await started.unUse(first.name)
    /** Late plugin uses the existing public API, not a direct inner Host. */
    const extended = await host.use(plugin(late))
    expect(extended).toBe(host)
    expect(extended.extensions.read()).toBe(1)
    expect([late.descriptors, late.installs, late.reads]).toEqual([1, 1, 1])
  } finally {
    await host.dispose()
  }
  expect([first.disposals, late.disposals]).toEqual([1, 1])
}
/** Saved public extension projections and callables keep the exact removed native generation. */
async function staleExtensions(): Promise<void> {
  /** Ordinary extension plugin needs no backend Store or borrowed driver. */
  const probe = new InstallProbe('removed', [])
  /** Installation uses the actual facade and original native registration. */
  const host = await createStorageHost({ plugins: [plugin(probe)] })
  try {
    /** Snapshot is the real public extension projection, not a fabricated handle. */
    const view = host.extensions
    /** Detached callable is saved before logical removal. */
    const saved = view.read
    expect(saved()).toBe(1)
    await host.unUse(probe.name)
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
        return view.read()
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
/** The fixed storage module combination really constructs and reinstalls a dependent Feature graph. */
async function dependencyGenerations(): Promise<void> {
  /** Callbacks remain independent of the native dependency planner's own data. */
  const probe = new InstallProbe('dependency', [])
  /** Both genuine native Features remain in one original root closure. */
  const first = defineFeature(() => probe.factory())
  /** Exact native identity, not a structurally matching feature object, supplies the dependency. */
  const second = defineFeature(() => probe.factory(), { previous: first })
  /** Public storage authoring accepts plain native Features without backend-kind metadata. */
  const definition = definePlugin(probe.name, (core) => probe.describe(core), { first, second })
  /** The consumer constructor supplies its fixed real feature-dependency module. */
  const host = await createStorageHost()
  try {
    const installed = await host.use(definition)
    expect([probe.descriptors, probe.installs, probe.factories]).toEqual([1, 1, 2])
    await installed.unUse(probe.name)
    await host.use(definition)
    expect([probe.descriptors, probe.installs, probe.factories, probe.disposals]).toEqual([
      2, 2, 4, 1
    ])
  } finally {
    await host.dispose()
  }
  expect(probe.disposals).toBe(2)
}
/** Named module-level cases keep lifecycle fixtures out of nested callback components. */
function registerLifecycleCases(): void {
  it('rolls back partial native installation in reverse order', rollbackPartialInstall)
  it('retains supported late use after earlier public work', lateUse)
  it('rejects saved extension projections and callables after removal', staleExtensions)
  it(
    'constructs each dependent Feature once per original install generation',
    dependencyGenerations
  )
}
describe('storage host modular lifecycle', registerLifecycleCases)

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
