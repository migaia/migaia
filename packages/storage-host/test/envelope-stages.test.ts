import { describe, expect, it, vi } from 'vitest'
import {
  assertVersionedEnvelope,
  createMigrationPlan,
  migrateEnvelope,
  migrateEnvelopeSync
} from '@migaia/storage-contract'
import {
  createStorageHost,
  definePlugin,
  defineStorageBackendKind,
  type IStoragePluginCore,
  type IStorageHookMap
} from '../src/index.js'
import { catalog } from './helpers/catalog.js'

/** Actual backend identity binds observations without replacing the migration or store owner. */
const kind = defineStorageBackendKind<ReturnType<typeof catalog>['store'], Map<string, string>>()(
  'catalog'
)

/** Construct one original store for public host-stage factory calls. */
function plugin() {
  /** The actual store and native map are acquired only by the install hook. */
  let state!: ReturnType<typeof catalog>
  /** A named descriptor retains the backend's exact public store type. */
  const descriptor = (core: IStoragePluginCore) => ({
    kind,
    featureExpose: () => ({ getClient: () => state.client }),
    capabilityInstaller: (_store: ReturnType<typeof catalog>['store']) => state.installer,
    install: () => {
      state = catalog(core)
      core.registerStore(state.store)
      return {}
    }
  })
  return definePlugin('catalog', descriptor)
}

describe('envelope observation binding', () => {
  it('borrows the original sync and async migration observer with immutable operation metadata', async () => {
    await using host = await createStorageHost({ plugins: [plugin()] })
    /** Metadata changes after binding must never affect concurrent recovery observations. */
    const metadata = { operation: 'recover', targetVersion: 1 }
    /** One binding borrows real envelope boundaries without retaining envelope state. */
    const stages = host.envelopeStages(host.backend('catalog'), metadata)
    metadata.operation = 'changed'
    metadata.targetVersion = 99
    /** Fixed observation names preserve the real migration order. */
    const order: string[] = []
    /** Capture original host payloads to prove no archive value escapes. */
    const received: Array<
      IStorageHookMap['beforeEnvelopeCheck'] | IStorageHookMap['beforeMigrationStep']
    > = []
    host.hooks.on('beforeEnvelopeCheck', (payload) => {
      order.push('check')
      received.push(payload)
    })
    host.hooks.on('afterEnvelopeCheck', () => order.push('checked'))
    host.hooks.on('beforeMigrationStep', (payload) => {
      order.push('before')
      received.push(payload)
    })
    host.hooks.on('afterMigrationStep', () => order.push('after'))
    host.hooks.on('afterMigrate', () => order.push('migrated'))
    /** The sole canonical plan executes both original entry points. */
    const plan = createMigrationPlan({ version: 1, steps: { 1: (value) => Number(value) + 1 } })
    stages.beforeEnvelopeCheck()
    /** Only the original validator reads the archive. */
    const envelope = assertVersionedEnvelope({ version: 0, state: 41 })
    stages.afterEnvelopeCheck(envelope.version)
    expect(migrateEnvelopeSync(plan, envelope, { observe: stages.observe })).toBe(42)
    expect(await migrateEnvelope(plan, envelope, { observe: stages.observe })).toBe(42)
    stages.afterMigrate(1, 'steps', 1, 0)
    expect(order).toEqual(['check', 'checked', 'before', 'after', 'before', 'after', 'migrated'])
    expect(received[0]).toEqual({
      backendId: 'catalog',
      backend: 'catalog',
      orgId: '00000000-0000-0000-0000-000000000000',
      operation: 'recover',
      targetVersion: 1
    })
    expect(received[1]).toEqual({
      backendId: 'catalog',
      backend: 'catalog',
      orgId: '00000000-0000-0000-0000-000000000000',
      operation: 'recover',
      fromVersion: 0,
      toVersion: 1
    })
  })

  it('reports observer failure without changing migration and preserves an unknown rejected version', async () => {
    /** The original listener failure must reach the existing host reporter once. */
    const original = new Error('migration listener failed')
    /** Reporting remains observational and never becomes a migration failure. */
    const report = vi.fn()
    await using host = await createStorageHost({ plugins: [plugin()], report })
    /** A preconstructed port observes later registration and cancellation on the shared hub. */
    const stages = host.envelopeStages(host.backend('catalog'), {
      operation: 'read',
      targetVersion: 1
    })
    /** The original plan owns state recovery and executes each step exactly once. */
    const step = vi.fn((state: unknown) => state)
    /** Listener failure is unrelated to the original migration result. */
    const off = host.hooks.on('beforeMigrationStep', () => {
      throw original
    })
    /** Keep version absence distinct from an actual version zero. */
    const rejected = vi.fn()
    host.hooks.on('onVersionRejected', rejected)
    /** Explicit reset-free migration uses the actual contract observer entry. */
    const plan = createMigrationPlan({ version: 1, steps: { 1: step } })
    expect(
      await migrateEnvelope(plan, { version: 0, state: 41 }, { observe: stages.observe })
    ).toBe(41)
    off()
    stages.onVersionRejected(undefined, 'ENVELOPE_INVALID')
    expect(step).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledExactlyOnceWith(original)
    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({ version: undefined, code: 'ENVELOPE_INVALID' })
    )
    expect(() =>
      host.envelopeStages({ ...host.backend('catalog') }, { operation: 'read', targetVersion: 1 })
    ).toThrowError(expect.objectContaining({ code: 'BACKEND_PLUGIN_INVALID' }))
  })
})
