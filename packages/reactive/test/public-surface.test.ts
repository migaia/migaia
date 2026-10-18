import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as publicApi from '../src/index.js'
import type { IRuntime } from '../src/index.js'

describe('public-surface convergence', () => {
  it('REX-T1 A1 exposes only application and controlled extension entries', async () => {
    /** Published entry names form the supported import boundary. */
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(Object.keys(manifest.exports)).toEqual(['.', './extension'])
    for (const name of [
      'Signal',
      'Computed',
      'Effect',
      'ReactiveErrorText',
      'ReactiveDependencyKind'
    ]) {
      expect(publicApi).not.toHaveProperty(name)
    }
    expect(publicApi.assertSingleRuntimeCopy).toBeTypeOf('function')
    /** Extension entry exposes controlled graph participation without mutable runtime services. */
    const extension = await import('../src/entry/extension.js')
    for (const name of [
      'currentRuntimeVersion',
      'claimOwnership',
      'createFieldSource',
      'createSourceBinding',
      'createTrackedObserver',
      'invalidateObservable',
      'createObserverBinding',
      'internalRuntimeOf'
    ]) {
      expect(extension).toHaveProperty(name, expect.any(Function))
    }
    /** No public entry returns the kernel's mutable service objects or bookkeeping writers. */
    for (const name of [
      'internalsOf',
      'registerInternals',
      'mutableSubs',
      'mutableDeps',
      'tracker',
      'scheduler',
      'clock'
    ]) {
      expect(extension).not.toHaveProperty(name)
    }
  })

  it('A2 keeps versions and observation hooks while hiding graph methods', () => {
    /** Isolated runtime owns every node exercised by this public contract. */
    const runtime = publicApi.createRuntime()
    /** Public source records writable state without exposing graph bookkeeping. */
    const signal = runtime.signal(1)
    /** Public derived value retains its version while hiding pull and preview operations. */
    const computed = runtime.computed(() => signal.value * 2)
    /** Observation callback records the first committed subscriber. */
    const onObserved = vi.fn()
    /** Removal token releases only the registered lifecycle callback. */
    const removeHooks = signal.addObservedHooks({ onObserved })
    /** Version before a write proves source updates advance the existing clock. */
    const previousVersion = signal.version
    /** One subscription observes both public source and derived value. */
    const effect = runtime.effect(() => {
      void computed.value
    })
    expect(onObserved).toHaveBeenCalledTimes(1)
    signal.value = 2
    runtime.flush()
    expect(signal.version).toBeGreaterThan(previousVersion)
    expect(computed.version).toBeGreaterThan(previousVersion)
    // @ts-expect-error Graph observer methods are absent from the public signal view.
    void signal.markDirty
    // @ts-expect-error Pulling caches belongs to the implementation boundary.
    void computed.pull
    // @ts-expect-error Speculative cache reads belong to the implementation boundary.
    void computed.preview
    effect.dispose()
    removeHooks()
  })

  it('A3 returns an effect object with idempotent disposal', () => {
    /** Effect cleanup proves repeated disposal consumes the callback once. */
    const cleanup = vi.fn()
    /** Isolated runtime keeps cleanup state local to this case. */
    const runtime = publicApi.createRuntime()
    /** Public effect handle shares the existing node lifecycle. */
    const effect = runtime.effect(() => cleanup)
    expect(typeof effect).toBe('object')
    expect(effect.disposed).toBe(false)
    effect.dispose()
    effect.dispose()
    expect(effect.disposed).toBe(true)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('A4 admits scheduling at construction and reads versions through extension', async () => {
    /** Captured flush permits assertions before and after the selected strategy runs work. */
    let flush: (() => void) | undefined
    /** Strategy records constructor-selected scheduling without flushing immediately. */
    const schedulerStrategy = vi.fn((task: () => void) => {
      flush = task
    })
    /** Runtime selects one strategy before allocating its scheduler. */
    const runtime = publicApi.createRuntime({ schedulerStrategy })
    /** Source write schedules the subscribed effect once. */
    const signal = runtime.signal(1)
    /** Effect body records values visible before and after the captured flush. */
    const run = vi.fn(() => {
      void signal.value
    })
    /** Effect lifecycle is released after all constructor contracts are checked. */
    const effect = runtime.effect(run)
    signal.value = 2
    expect(schedulerStrategy).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
    flush?.()
    expect(run).toHaveBeenCalledTimes(2)
    expect('setSchedulerStrategy' in runtime).toBe(false)
    expect('currentVersion' in runtime).toBe(false)
    expect(() => publicApi.createRuntime({ schedulerStrategy: 1 as never })).toThrow(TypeError)
    expect(() => publicApi.createRuntime({ schedulerStrategy: 1 as never })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION', source: '@migaia/reactive' })
    )
    /** Read-only clock query rejects objects without registered runtime ownership. */
    const { currentRuntimeVersion } = await import('../src/entry/extension.js')
    /** Baseline clock value distinguishes a later source write. */
    const previousVersion = currentRuntimeVersion(runtime)
    signal.value = 3
    expect(currentRuntimeVersion(runtime)).toBeGreaterThan(previousVersion)
    expect(() => currentRuntimeVersion({} as IRuntime)).toThrow(
      expect.objectContaining({ code: 'NOT_RUNTIME_OWNED', source: '@migaia/reactive' })
    )
    effect.dispose()
  })
})
