/** Original registration admission rejects explicit removal before cleanup or publication changes. */
import { expect, it, vi } from 'vitest'
import {
  defineFeature,
  definePlugin,
  getPluginRuntimeIntegration,
  PluginHost,
  PluginHostError,
  PluginHostErrorCode
} from '../src/index.js'
import { createView, openComposition } from '../src/composition-entry.js'

it('rejects ordinary removal atomically, permits cold retry, and never vetoes full Host disposal', async () => {
  /** Only domain state changes the original synchronous removal decision. */
  const state = { allowed: false }
  /** An attempted removal must not invoke cleanup before domain admission succeeds. */
  const beforeRelease = vi.fn()
  /** The native owner retains its original final disposer. */
  const dispose = vi.fn()
  /** The predicate is captured during actual native installation, never by a fabricated core. */
  const allowed = vi.fn(() => state.allowed)
  /** All mutations use the existing Host FIFO and canonical installation. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** This real registration exposes an ordinary callable whose continued identity proves liveness. */
  const plugin = definePlugin({
    name: 'guarded',
    install(core) {
      getPluginRuntimeIntegration(core).allowRemovalWhen(allowed)
      return { read: () => 42 }
    },
    beforeRelease,
    dispose
  })
  /** Native handles retain their original generation throughout the rejected mutation. */
  const [handle] = await host.use(plugin)
  await expect(host.unUse('guarded')).rejects.toBeInstanceOf(PluginHostError)
  expect(handle.extensions.read()).toBe(42)
  expect(beforeRelease).not.toHaveBeenCalled()
  expect(dispose).not.toHaveBeenCalled()
  state.allowed = true
  await expect(host.unUse('guarded')).resolves.toMatchObject({ ok: true })
  expect(beforeRelease).toHaveBeenCalledOnce()
  expect(dispose).toHaveBeenCalledOnce()
  /** A later independent registration still cannot veto terminal Host cleanup. */
  state.allowed = false
  await host.use(plugin)
  allowed.mockClear()
  await host.dispose()
  expect(allowed).not.toHaveBeenCalled()
  expect(dispose).toHaveBeenCalledTimes(2)
})

it('preflights every cascade release before the first dependent or provider cleanup', async () => {
  /** A live provider makes this entire native cascade inadmissible. */
  const allowed = vi.fn(() => false)
  /** All cleanup attempts share this observable original callback. */
  const cleanup = vi.fn()
  /** The existing native Feature graph supplies the real two-registration release plan. */
  const service = defineFeature(() => ({ value: 1 }))
  /** No additional dependency relation is introduced by removal admission itself. */
  const provider = definePlugin({
    name: 'provider',
    features: { service },
    install(core) {
      getPluginRuntimeIntegration(core).allowRemovalWhen(allowed)
      return { providerRead: () => 1 }
    },
    beforeRelease: cleanup,
    dispose: cleanup
  })
  /** The existing provider dependency makes this dependent the first ordinary cascade release. */
  const borrowed = defineFeature((_core, dependencies) => dependencies.service, {
    service: provider.getFeature('service')
  })
  /** Its original callable must remain published if a later planned provider refuses removal. */
  const dependent = definePlugin({
    name: 'dependent',
    features: { borrowed },
    install: (core) => ({ dependentRead: () => core.features.borrowed.value }),
    beforeRelease: cleanup,
    dispose: cleanup
  })
  /** Native FIFO owns the entire cascade as one mutation. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Both exact original generations must stay readable after the rejected plan. */
  const [first, second] = await host.use(provider, dependent)
  await expect(host.unUse('provider', { policy: 'cascade' })).rejects.toMatchObject({
    source: 'plugin.host',
    code: PluginHostErrorCode.lifecycleMutation
  })
  expect(first.extensions.providerRead()).toBe(1)
  expect(second.extensions.dependentRead()).toBe(1)
  expect(cleanup).not.toHaveBeenCalled()
  expect(allowed).toHaveBeenCalledOnce()
  await host.dispose()
})

it('keeps prepared removal uncommitted when a later receipt refuses and allows the same batch to retry', async () => {
  /** Domain state may become cold after preparation, without replacing its exact registration. */
  const state = { allowed: false }
  /** Prepared rejection must run no physical cleanup for either original receipt. */
  const cleanup = vi.fn()
  /** Both admissions use the existing managed composition entry. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** The original composition facade owns all receipts and their single commit boundary. */
  const composition = openComposition(host)
  /** The first unguarded registration must not be revoked before a later check fails. */
  const first = composition.createPluginAdmission(
    definePlugin({
      name: 'first',
      install: () => ({ firstValue: 'first' }),
      dispose: cleanup
    })
  )
  /** Only the original installing core can capture the second receipt's predicate. */
  const second = composition.createPluginAdmission(
    definePlugin({
      name: 'second',
      install(core) {
        getPluginRuntimeIntegration(core).allowRemovalWhen(() => state.allowed)
        return { secondValue: 'second' }
      },
      dispose: cleanup
    })
  )
  /** Real managed slots retain their native publication ordering. */
  const firstSlot = composition.createDataOrderSlot('first')
  /** The independent second slot keeps its own original registration identity. */
  const secondSlot = composition.createDataOrderSlot('second')
  /** Preparation installs both original definitions before their one public commit. */
  const admissions = await composition.prepareAdmissions([
    { admission: first, slot: firstSlot },
    { admission: second, slot: secondSlot }
  ])
  /** Opaque receipts, rather than names or invented handles, authorize the removal batch. */
  const receipts = composition.commitPreparedAdmissions(admissions)
  /** The same original prepared capability must remain usable after its preflight rejection. */
  const removal = composition.prepareUnUseBatch(receipts)
  await expect(composition.commitPreparedUnUseBatch(removal, {})).rejects.toMatchObject({
    source: 'plugin.host',
    code: PluginHostErrorCode.lifecycleMutation
  })
  expect(createView(receipts[0]!).extensions).toMatchObject({ firstValue: 'first' })
  expect(createView(receipts[1]!).extensions).toMatchObject({ secondValue: 'second' })
  expect(cleanup).not.toHaveBeenCalled()
  state.allowed = true
  await expect(composition.commitPreparedUnUseBatch(removal, {})).resolves.toMatchObject({
    committed: true,
    ok: true
  })
  expect(cleanup).toHaveBeenCalledTimes(2)
  await host.dispose()
})

it('rejects a replacement before candidate install when an original dependent cannot restart', async () => {
  /** This original native Feature relation already determines replacement restart behavior. */
  const service = defineFeature(() => ({ value: 1 }))
  /** Cleanup must remain absent if the original dependency closure cannot be removed. */
  const cleanup = vi.fn()
  /** The previous provider deliberately has no own guard so its dependent must be checked too. */
  const provider = definePlugin({
    name: 'provider',
    features: { service },
    install: () => ({ providerRead: () => 1 }),
    dispose: cleanup
  })
  /** The ordinary dependency is the existing planner's sole source of restart membership. */
  const borrowed = defineFeature((_core, dependencies) => dependencies.service, {
    service: provider.getFeature('service')
  })
  /** A live dependent refuses replacement before any candidate setup or publication can occur. */
  const dependent = definePlugin({
    name: 'dependent',
    features: { borrowed },
    install(core) {
      getPluginRuntimeIntegration(core).allowRemovalWhen(() => false)
      return { dependentRead: () => core.features.borrowed.value }
    },
    dispose: cleanup
  })
  /** Candidate setup is a real native lifecycle hook that must remain untouched. */
  const install = vi.fn(() => ({ providerRead: () => 2 }))
  /** Exact old handles remain live after an inadmissible replacement. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Both original registration identities remain published throughout preflight rejection. */
  const [first, second] = await host.use(provider, dependent)
  await expect(
    host.replace(
      'provider',
      definePlugin({
        name: 'provider',
        features: { service: defineFeature(() => ({ value: 2 })) },
        install
      })
    )
  ).rejects.toMatchObject({ source: 'plugin.host', code: PluginHostErrorCode.lifecycleMutation })
  expect(install).not.toHaveBeenCalled()
  expect(cleanup).not.toHaveBeenCalled()
  expect(first.extensions.providerRead()).toBe(1)
  expect(second.extensions.dependentRead()).toBe(1)
  await host.dispose()
})

it('never invokes removal admission during failed candidate rollback', async () => {
  /** Native failed installation must preserve this exact original primary cause. */
  const original = new Error('candidate install failed')
  /** Failed candidates still release their resources despite a false domain predicate. */
  const allowed = vi.fn(() => false)
  /** Only original failed-candidate cleanup is counted. */
  const cleanup = vi.fn()
  /** The surviving provider is a genuine committed registration. */
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  /** Rejected replacement cannot replace this exact original callable. */
  const [previous] = await host.use(
    definePlugin({ name: 'provider', install: () => ({ read: () => 1 }) })
  )
  await expect(
    host.replace(
      'provider',
      definePlugin({
        name: 'provider',
        install(core) {
          getPluginRuntimeIntegration(core).allowRemovalWhen(allowed)
          core.onDispose(cleanup)
          throw original
        }
      })
    )
  ).rejects.toMatchObject({ cause: original })
  expect(allowed).not.toHaveBeenCalled()
  expect(cleanup).toHaveBeenCalledOnce()
  expect(previous.extensions.read()).toBe(1)
  await host.dispose()
})
