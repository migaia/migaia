import { PluginHostState } from '../src/host-state.js'
import { createDataOrderSlotState } from '../src/composition.js'
import { createQuiescenceTracker } from '@migaia/lifecycle'
import { describe, expect, it } from 'vitest'

import { PluginHostErrorCode } from '../src/error-code.js'
import { defineFeature, definePlugin } from '../src/index.js'
import { PluginHostRemovalRuntime } from '../src/removal-runtime.js'
import { createManualScheduler } from '@migaia/utils/testing'
import { type IExt, Host, FeatureHost, plugin } from './plugin-host-fixtures.js'

describe('PluginHost', () => {
  it('keeps the original construct error as primary and reports a rollback failure via diagnostic', async () => {
    const diagnostics: Array<{ message: string; code?: string }> = []
    const host = new Host({
      diagnostic: (message: string, code?: string) => diagnostics.push({ message, code })
    } as any)
    await expect(
      host.use(
        plugin('rollback-resource', (core) => {
          core.onDispose(() => {
            throw new Error('rollback dispose')
          })
          return {}
        }),
        plugin('rollback-failure', () => {
          throw new Error('install failure')
        })
      )
    ).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: expect.objectContaining({ message: expect.stringContaining('install failure') })
    })
    expect(
      diagnostics.some(
        (entry) =>
          entry.code === 'PLUGIN_INSTALL_ROLLBACK_FAILED' && /rollback dispose/.test(entry.message)
      )
    ).toBe(true)
  })

  it('cleans extensions when plugin dispose fails', async () => {
    const host = new Host()
    await host.use(
      plugin('extension', () => ({ marker: 'x' }), {
        dispose: () => {
          throw new Error('dispose')
        }
      })
    )
    const result = await host.unUse('extension')
    expect(result).toMatchObject({ ok: false, errors: expect.any(Array) })
  })

  it('revoked extension closure rejects a callable captured before unUse', async () => {
    const host = new Host()
    const [handle] = await host.use(plugin('revoked-closure', () => ({ read: () => 7 })))
    const read = (handle.extensions as { read: () => number }).read
    expect(read()).toBe(7)
    await host.unUse('revoked-closure')
    expect(() => read()).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.registrationRevoked })
    )
  })

  it('feature expose invalidation revokes a captured Feature output immediately after unUse', async () => {
    const feature = defineFeature<{ readonly read: () => number }>((core) => ({
      read: core.featureExpose.read as () => number
    }))
    let output!: { readonly read: () => number }
    const host = new FeatureHost()
    await host.use(
      definePlugin(
        'feature-invalidation',
        (core) => {
          return {
            featureExpose: () => ({ read: () => 7 }),
            install: () => {
              output = core.features.feature as { readonly read: () => number }
              return {}
            }
          }
        },
        { feature }
      )
    )
    expect(output.read()).toBe(7)
    await host.unUse('feature-invalidation')
    expect(() => output.read()).toThrow(
      expect.objectContaining({
        code: PluginHostErrorCode.registrationRevoked
      })
    )
  })

  it('feature expose invalidation is synchronous even when pending drain never settles', () => {
    /** A stalled drain distinguishes revocation from a later microtask. */
    const registration: any = {
      name: 'pending-feature',
      shared: [],
      extensions: [],
      stageEntries: new Map(),
      segments: new Map(),
      pipelineDisposers: [],
      pipelineOwnerKey: {},
      installed: true,
      lifecycle: 'install',
      featureExposeValid: true
    }
    /** Actual state and a held lease separate synchronous revocation from physical completion. */
    const state = new PluginHostState<IExt, number>()
    state.registrations.set(registration.name, registration)
    state.dependencyIndex().add({ id: registration.name, dependencies: [] })
    /** One physical user keeps its lease active through logical revocation. */
    const leases = createQuiescenceTracker<object>()
    /** Release the fixture lease after proving revocation did not wait for it. */
    const release = leases.retain(registration.pipelineOwnerKey)
    const runtime = new PluginHostRemovalRuntime({
      invokeHook: (invoke) => invoke(),
      state,
      pipelineLeases: leases,
      executionSignal: {} as any,
      cleanupRuntime: {} as any,
      scheduler: createManualScheduler(),
      disposeStepTimeoutMs: false,
      setHookRegistration: () => undefined,
      setBeforeReleaseRegistration: () => undefined,
      clearBeforeReleaseRegistrationIfOwner: () => undefined
    })
    runtime.revokeRegistration(registration)
    expect(registration.featureExposeValid).toBe(false)
    expect(leases.count(registration.pipelineOwnerKey)).toBe(1)
    release()
  })

  it('cause chain: captured Feature expose revocation keeps declared code and text', async () => {
    const feature = defineFeature<{ readonly read: () => number }>((core) => ({
      read: core.featureExpose.read as () => number
    }))
    let output!: { readonly read: () => number }
    const host = new FeatureHost()
    await host.use(
      definePlugin(
        'feature-revoked-cause-chain',
        (core) => ({
          featureExpose: () => ({ read: () => 7 }),
          install: () => {
            output = core.features.feature as { readonly read: () => number }
            return {}
          }
        }),
        { feature }
      )
    )
    await host.unUse('feature-revoked-cause-chain')
    expect(() => output.read()).toThrow(
      expect.objectContaining({
        code: PluginHostErrorCode.registrationRevoked
      })
    )
  })

  it('thenable install result: async path reports INSTALL_RESULT_THENABLE', async () => {
    // oxlint-disable-next-line unicorn/no-thenable -- contract requires an own then install result.
    const thenable = Object.defineProperty({}, 'then', {
      value: (resolve: (value: unknown) => void) => resolve({})
    })
    await expect(
      new FeatureHost().use(
        definePlugin('async-install-thenable', () => ({ install: () => thenable as never }))
      )
    ).rejects.toMatchObject({ cause: { code: 'INSTALL_RESULT_THENABLE' } })
  })

  it('thenable install result: sync path reports INSTALL_RESULT_THENABLE', () => {
    // oxlint-disable-next-line unicorn/no-thenable -- contract requires an own then install result.
    const thenable = Object.defineProperty({}, 'then', {
      value: (resolve: (value: unknown) => void) => resolve({})
    })
    const host = new FeatureHost()
    expect(() =>
      host.installSync([
        definePlugin('sync-install-thenable', () => ({ install: () => thenable as never }))
      ])
    ).toThrow(
      expect.objectContaining({
        cause: expect.objectContaining({ code: 'INSTALL_RESULT_THENABLE' })
      })
    )
  })

  it('feature expose invalidation precedes a never-settling owned resource cleanup timeout', async () => {
    const feature = defineFeature<{ readonly read: () => number }>((core) => ({
      read: core.featureExpose.read as () => number
    }))
    let output!: { readonly read: () => number }
    const scheduler = createManualScheduler()
    let entered!: () => void
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve
    })
    const host = new FeatureHost({ scheduler, disposeStepTimeoutMs: 10 } as any)
    await host.use(
      definePlugin(
        'feature-invalidation-complete',
        (core) => {
          return {
            featureExpose: () => ({ read: () => 7 }),
            install: () => {
              output = core.features.feature as { readonly read: () => number }
              core.onDispose(() => {
                entered()
                return new Promise<void>(() => {})
              })
              return {}
            }
          }
        },
        { feature }
      )
    )
    const removal = host.unUse('feature-invalidation-complete')
    await enteredGate
    expect(() => output.read()).toThrow(
      expect.objectContaining({
        code: PluginHostErrorCode.registrationRevoked
      })
    )
    scheduler.advance(10)
    await expect(removal).resolves.toMatchObject({ ok: false, errors: expect.any(Array) })
  })

  it('stage slot retention keeps exact ordinal and clears registration-owned references', () => {
    const host = {}
    const registration: any = {
      name: 'slot-reclaim',
      shared: [],
      extensions: [{ key: 'owned', descriptor: { value: () => undefined } }],
      stageEntries: new Map(),
      segments: new Map(),
      pipelineDisposers: [],
      pipelineOwnerKey: {},
      installed: true,
      lifecycle: 'install',
      featureExpose: {},
      featureOutputs: {},
      featureExposeValid: true
    }
    /** Canonical state owns both the retained definition slot and exact extension retirement. */
    const state = new PluginHostState<IExt, number>()
    const { state: stage } = createDataOrderSlotState(host, registration.name, 0n)
    const { stageSlots, registrations, extensionOwners } = state
    stageSlots.set(registration.name, stage)
    registrations.set(registration.name, registration)
    state.dependencyIndex().add({ id: registration.name, dependencies: [] })
    extensionOwners.set('owned', registration)
    const runtime = new PluginHostRemovalRuntime({
      invokeHook: (invoke) => invoke(),
      state,
      pipelineLeases: createQuiescenceTracker<object>(),
      executionSignal: {} as any,
      cleanupRuntime: {} as any,
      scheduler: createManualScheduler(),
      disposeStepTimeoutMs: false,
      setHookRegistration: () => undefined,
      setBeforeReleaseRegistration: () => undefined,
      clearBeforeReleaseRegistrationIfOwner: () => undefined
    })
    runtime.revokeRegistration(registration)
    expect(stage.retired).toBe(false)
    expect(stageSlots.get(registration.name)).toBe(stage)
    expect(registrations.has(registration.name)).toBe(false)
    expect(extensionOwners.has('owned')).toBe(false)
    expect(registration.extensions).toEqual([])
    expect(registration.featureExpose).toBeUndefined()
    expect(registration.featureOutputs).toBeUndefined()
  })
})
