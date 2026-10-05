import { expect, it } from 'vitest'
import {
  defineHost,
  definePlugin,
  getPluginRuntimeIntegration,
  type IPluginRuntimeSharedSlot
} from '../src/index.js'

/** Fixture reads remain on the canonical slot, with no test-created registry or index. */
type IQueryFixture = Readonly<{ values(): readonly object[]; registered(): readonly object[] }>

it('[A41/A42] registered cold metadata survives ready withdrawal and retires with its registration', async () => {
  /** The actual frozen Host controls publication, rollback and final slot retirement. */
  const host = defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** One exact family permits two legitimate registrations to share their original slot. */
  const family = Object.freeze({})
  /** The facade is the original owner-created shared object, never an application-shaped Host. */
  let facade!: IQueryFixture
  /** This exact receipt can leave without unregistering the owning runtime Plugin. */
  let withdraw: () => void = () => undefined
  /** The registration stores one safe metadata object, rather than every retired native handle. */
  const metadata = Object.freeze({ name: 'query-member' })
  /** Accessing the missing port is guarded so the baseline reaches a semantic assertion. */
  const registered = (slot: IPluginRuntimeSharedSlot<IQueryFixture>): readonly object[] => {
    const read = Reflect.get(slot, 'registered') as (() => readonly object[]) | undefined
    return read?.() ?? []
  }
  try {
    await host.use(
      definePlugin({
        name: 'query-member',
        install(core) {
          /** Canonical integration accepts only the real install core and its existing registration. */
          const slot = getPluginRuntimeIntegration(core).acquireSharedSlot<IQueryFixture>(
            'runtimeQuery',
            family,
            (owner) => ({
              values: () => owner.values(),
              registered: () => registered(owner)
            })
          )
          /** The new cold port annotates the existing reservation before its atomic commit. */
          const register = Reflect.get(slot, 'register') as ((value: object) => void) | undefined
          register?.(metadata)
          withdraw = slot.contribute(Object.freeze({ value: 42 }), 'ready-member')
          facade = slot.facade
          return {}
        }
      })
    )
    expect(facade.values()).toEqual([{ value: 42 }])
    withdraw()
    expect(facade.values()).toEqual([])
    expect(facade.registered(), '[A41] all registered includes non-ready native owner').toEqual([
      metadata
    ])
    await host.unUse('query-member')
    expect(facade.registered()).toEqual([])
  } finally {
    await host.dispose()
  }
})
