import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createMemoryTestStore } from './helpers/memory.ts'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { StorageStageKind, type ICodecStageObserver } from '@migaia/storage-contract'
import { persistUnit } from '../src/index.ts'
import { persist } from '../src/light-index.ts'

describe('versioned persistence', () => {
  it('snapshots contiguous steps and upgrades without automatically writing the archive', async () => {
    /** The real backend remains the archive authority throughout hydration. */
    const storage = await createMemoryTestStore()
    /** Reading an old archive alone must leave these bytes unchanged. */
    const original = JSON.stringify({ version: 0, state: { count: 1 } })
    await storage.set('steps', original)
    /** The Store supplies the actual restoration and write subscription. */
    const store = createStore({ count: 0 })
    /** Ordered calls expose the exact version context rather than merely the final state. */
    const calls: number[] = []
    /** Callbacks are captured when the attachment creates its shared plan. */
    const migrations = {
      1: (previous: unknown) => {
        calls.push(1)
        return { count: (previous as { count: number }).count + 1 }
      },
      2: (previous: unknown) => {
        calls.push(2)
        return { count: (previous as { count: number }).count + 1 }
      }
    }
    /** This handle borrows both the Store and archive backend. */
    const handle = persist(store, { key: 'steps', storage, version: 2, migrations })
    migrations[1] = () => ({ count: 99 })
    await handle.ready
    expect(calls).toEqual([1, 2])
    expect(store.count).toBe(3)
    expect(await storage.get('steps')).toBe(original)
    await handle.disposeAsync()
    store.$dispose()
    await storage.dispose()
  })

  it('rejects gaps and mixed reset descriptors before starting storage reads', async () => {
    /** Invalid configuration must fail before the backend is called. */
    const storage = await createMemoryTestStore()
    /** Calls count the existing public backend boundary. */
    let reads = 0
    storage.get = async () => {
      reads++
      return null
    }
    /** No subscription should be retained by either rejected attachment. */
    const store = createStore({ count: 0 })
    for (const migrations of [
      { 1: () => ({}), 3: () => ({}) },
      { reset: () => ({}), 1: () => ({}) }
    ]) {
      expect(() =>
        persist(store, { key: 'invalid', storage, version: 3, migrations } as never)
      ).toThrowError(
        expect.objectContaining({
          source: 'store.persist',
          code: 'INVALID_OPTION',
          cause: expect.objectContaining({ source: 'storage.contract' })
        })
      )
    }
    expect(reads).toBe(0)
    store.$dispose()
  })

  it('keeps a failed step on the contract cause chain and never writes', async () => {
    /** A real archived old version enters the shared migration executor. */
    const storage = await createMemoryTestStore()
    await storage.set('failure', '{"version":0,"state":{"count":1}}')
    /** The step's original native failure must survive by identity. */
    const primary = new Error('step failed')
    /** Rejected hydration must not restore this live value. */
    const store = createStore({ count: 0 })
    /** The actual readiness and flush promises expose the same contract error. */
    const handle = persist(store, {
      key: 'failure',
      storage,
      version: 1,
      migrations: {
        1: () => {
          throw primary
        }
      }
    })
    await expect(handle.ready).rejects.toMatchObject({
      source: 'storage.contract',
      code: 'MIGRATION_FAILED',
      cause: primary
    })
    store.count = 2
    await expect(handle.flush()).rejects.toBe(handle.hydrationError.value)
    expect(await storage.get('failure')).toBe('{"version":0,"state":{"count":1}}')
    await handle.disposeAsync()
    store.$dispose()
    await storage.dispose()
  })

  it('reports observer failures without waiting or changing codec success', async () => {
    /** This archive triggers one decode and the explicit flush triggers one encode. */
    const storage = await createMemoryTestStore()
    await storage.set('observed', '{"version":0,"state":{"count":2}}')
    /** Reports retain each original observer failure. */
    const reports: unknown[] = []
    /** Ordered event names prove one conversion boundary per actual codec call. */
    const events: string[] = []
    /** A before callback may never settle; persistence must still proceed. */
    const pending = new Promise<void>(() => {})
    /** The immutable metadata contains no business value. */
    const observer: ICodecStageObserver = {
      kind: StorageStageKind.codec,
      forTransaction: () => observer,
      beforeDecode: (...args) => {
        events.push(`before:${args.join(':')}`)
        return pending
      },
      afterDecode: () => {
        events.push('after:decode')
        throw new Error('after decode')
      },
      beforeEncode: () => {
        events.push('before:encode')
        // oxlint-disable-next-line unicorn/no-thenable -- exercise an observer's failing then getter.
        return Object.defineProperty({}, 'then', {
          get() {
            throw new Error('then failed')
          }
        }) as PromiseLike<void>
      },
      afterEncode: () => {
        events.push('after:encode')
        return Promise.reject(new Error('after encode'))
      },
      report: (error) => {
        reports.push(error)
        return undefined
      }
    }
    /** The real Store restoration must succeed despite the first observer failure. */
    const store = createStore({ count: 0 })
    /** This attachment owns no observer registry or borrowed backend resource. */
    const handle = persist(store, { key: 'observed', storage, codecStages: observer })
    await handle.ready
    await handle.flush()
    await Promise.resolve()
    expect(store.count).toBe(2)
    expect(events).toEqual([
      'before:persist.decode:collections-json@1',
      'after:decode',
      'before:encode',
      'after:encode'
    ])
    expect(reports).toHaveLength(3)
    await handle.disposeAsync()
    store.$dispose()
    await storage.dispose()
  })

  it('rejects nonportable state before the backend receives a write', async () => {
    /** Storage calls provide the externally observable failure boundary. */
    const storage = await createMemoryTestStore()
    /** Count actual backend writes, including unintended disposal writes. */
    let writes = 0
    storage.set = async () => {
      writes++
    }
    /** NaN is reachable through the ordinary Store API. */
    const store = createStore({ count: NaN })
    /** Initial hydration misses and leaves the invalid live state available to flush. */
    const handle = persist(store, { key: 'invalid-value', storage })
    await handle.ready
    await expect(handle.flush()).rejects.toMatchObject({ code: 'ENCODE_FAILED' })
    await handle.disposeAsync()
    expect(writes).toBe(0)
    store.$dispose()
    await storage.dispose()
  })

  it('contains observer metadata and callback getter failures at their owning boundary', async () => {
    /** Both conversion directions use the actual persistence facade and archive backend. */
    const storage = await createMemoryTestStore()
    await storage.set('getter', '{"version":0,"state":{"count":2}}')
    /** Equal initial state avoids application writes during this observer-specific case. */
    const store = createStore({ count: 2 })
    /** Failed metadata access must be normalized before attachment starts. */
    const metadataFailure = new Error('kind getter failed')
    /** Native getter identity must survive on the existing configuration error. */
    const badObserver: ICodecStageObserver = {
      get kind(): typeof StorageStageKind.codec {
        throw metadataFailure
      },
      forTransaction: () => badObserver,
      report: () => undefined
    }
    expect(() => persist(store, { key: 'getter', storage, codecStages: badObserver })).toThrowError(
      expect.objectContaining({
        source: 'store.persist',
        code: 'INVALID_OPTION',
        cause: metadataFailure
      })
    )
    /** Callback lookup failures are observations and cannot prevent actual encoding/decoding. */
    const beforeFailure = new Error('before getter failed')
    /** The successful decoder still reaches its after observation lookup. */
    const afterFailure = new Error('after getter failed')
    /** The original failures reach one existing report channel in actual operation order. */
    const reports: unknown[] = []
    /** Accessor-backed ports are a supported readonly structural observer shape. */
    const observer: ICodecStageObserver = {
      kind: StorageStageKind.codec,
      forTransaction: () => observer,
      get beforeEncode(): ICodecStageObserver['beforeEncode'] {
        throw beforeFailure
      },
      get afterDecode(): ICodecStageObserver['afterDecode'] {
        throw afterFailure
      },
      report: (error) => {
        reports.push(error)
        return undefined
      }
    }
    /** Both readiness and flush must retain their normal successful results. */
    const handle = persist(store, { key: 'getter', storage, codecStages: observer })
    await handle.ready
    await handle.flush()
    expect(reports).toEqual([afterFailure, beforeFailure])
    expect(await storage.get('getter')).toBe('{"version":0,"state":{"count":2}}')
    await handle.disposeAsync()
    store.$dispose()
    await storage.dispose()
  })

  it('caches separate asynchronous disposal promises over one cleanup', async () => {
    /** A minimal existing unit boundary isolates attachment ownership from any state package. */
    const runtime = createRuntime()
    /** The archive backend remains borrowed and callable after cleanup. */
    const storage = await createMemoryTestStore()
    /** Cleanup failure must remain on the explicit rejection and the observer report. */
    const primary = new Error('unsubscribe failed')
    /** Cleanup count proves all public entry points share the same work. */
    let cleanups = 0
    /** The observer's existing reporter is the handle's cleanup reporting boundary. */
    const reports: unknown[] = []
    /** No codec callbacks are needed for this resource-specific observation. */
    const observer: ICodecStageObserver = {
      kind: StorageStageKind.codec,
      forTransaction: () => observer,
      report: (error) => {
        reports.push(error)
        return undefined
      }
    }
    /** The unit releases only the subscription created for this attachment. */
    const handle = persistUnit(
      {
        snapshot: () => ({}),
        restore: () => {},
        subscribe: () => () => {
          cleanups++
          throw primary
        }
      },
      { key: 'dispose', runtime, storage, codecStages: observer }
    )
    await handle.ready
    expect(() => handle.dispose()).toThrow(primary)
    /** Explicit disposal retains a failure from the same prior synchronous cleanup. */
    const explicit = handle.disposeAsync()
    /** Symbol disposal reports once and completes independently. */
    const symbolic = handle[asyncDisposeKey]()
    expect(handle.disposeAsync()).toBe(explicit)
    expect(handle[asyncDisposeKey]()).toBe(symbolic)
    expect(symbolic).not.toBe(explicit)
    await expect(explicit).rejects.toBe(primary)
    await expect(symbolic).resolves.toBeUndefined()
    expect(reports).toEqual([primary])
    expect(cleanups).toBe(1)
    expect(await storage.get('dispose')).toBeNull()
    await storage.dispose()
  })
})
