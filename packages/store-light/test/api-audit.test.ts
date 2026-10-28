import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import {
  createAsyncStore,
  createStore,
  createStoreResource,
  FIELD_BUILDER,
  StoreFieldMode,
  isRaw,
  isFieldBuilder
} from '../src/index.ts'

describe('store-light audit regressions', () => {
  it.each(['sync', 'async'] as const)(
    'reports %s late field cleanup after initialization fails',
    async (mode) => {
      /** Observe the exact errors delivered to the actual owning Runtime. */
      const reports: unknown[] = []
      /** No private runtime brand or ownership registration is fabricated. */
      const runtime = createRuntime({
        onError: (error) => {
          reports.push(error)
        }
      })
      /** The initialization failure is independent of the late field's cleanup failure. */
      const primary = new Error('initialization failed')
      /** Both disposer forms must retain this same native error object in diagnostics. */
      const cleanup = new Error('late field cleanup failed')
      /** Hold one complete supported field until the failed store is already terminal. */
      let release!: (field: { disposed: boolean; dispose(): void | Promise<void> }) => void
      /** The field's real creation Promise stays in flight after its sibling fails. */
      const late = new Promise<{ disposed: boolean; dispose(): void | Promise<void> }>(
        (resolve) => {
          release = resolve
        }
      )
      /** Count actual calls rather than substituting a mocked scope result. */
      let disposed = 0
      /** The public factory admits both explicit asynchronous builders. */
      const pending = createAsyncStore(
        {
          failed: {
            [FIELD_BUILDER]: true as const,
            mode: StoreFieldMode.async,
            create: async () => {
              throw primary
            }
          },
          late: { [FIELD_BUILDER]: true as const, mode: StoreFieldMode.async, create: () => late }
        },
        { runtime }
      )
      await expect(pending).rejects.toBe(primary)
      release({
        disposed: false,
        dispose() {
          this.disposed = true
          disposed += 1
          if (mode === 'async') return Promise.reject(cleanup)
          throw cleanup
        }
      })
      await vi.waitFor(() => expect(reports).toContain(cleanup), { timeout: 200, interval: 5 })
      expect(disposed).toBe(1)
    }
  )
  it.each(['sync', 'async'] as const)(
    'classifies %s initialization failures without replacing native errors',
    async (mode) => {
      /** The builder owns the original stack and message. */
      const primary = new Error('field initialization failed')
      /** Both public creation paths must identify this same reachable native failure. */
      const build = () => {
        throw primary
      }
      if (mode === 'sync') {
        expect(() =>
          createStore({
            field: { [FIELD_BUILDER]: true, mode: StoreFieldMode.sync, create: build }
          })
        ).toThrow(primary)
      } else {
        await expect(
          createAsyncStore({
            field: {
              [FIELD_BUILDER]: true,
              mode: StoreFieldMode.async,
              create: async () => build()
            }
          })
        ).rejects.toBe(primary)
      }
      expect(primary).toMatchObject({
        source: 'store.light',
        code: 'INITIALIZATION_FAILED'
      })
    }
  )

  it('preserves a frozen initialization failure through the coded cause', async () => {
    /** Frozen native failures cannot accept identity properties. */
    const primary = Object.freeze(new Error('frozen field failure'))
    await expect(
      createAsyncStore({
        field: {
          [FIELD_BUILDER]: true,
          mode: StoreFieldMode.async,
          create: async () => {
            throw primary
          }
        }
      })
    ).rejects.toMatchObject({
      source: 'store.light',
      code: 'INITIALIZATION_FAILED',
      cause: primary
    })
  })

  it.each(['retain', 'capture'] as const)(
    'rejects %s of an evicted actual version',
    async (operation) => {
      /** The actual public snapshot identifies the formerly live value. */
      const value = {}
      /** Eviction must physically release the value before the old version is tested. */
      const dispose = vi.fn()
      /** Zero TTL makes last-owner release deterministic without waiting for a timer. */
      const resource = createStoreResource(() => value, { keepAliveMs: 0, dispose })
      /** Keep the loaded value alive until the snapshot has been captured. */
      const release = resource.retainResource()
      await vi.waitFor(() => expect(() => resource.readSnapshot()).not.toThrow(), {
        timeout: 200,
        interval: 5
      })
      /** This is a genuine library-issued version/token, not a forged ID. */
      const snapshot = resource.readSnapshot()
      release()
      await vi.waitFor(() => expect(dispose).toHaveBeenCalledExactlyOnceWith(value), {
        timeout: 200,
        interval: 5
      })
      try {
        expect(() =>
          operation === 'retain'
            ? resource.retainVersion(snapshot.token)
            : resource.commitCapture(resource.captureVersion(snapshot.version))
        ).toThrow(expect.objectContaining({ source: 'store.light', code: 'UNKNOWN_VERSION' }))
      } finally {
        resource.forceDispose()
        await resource.whenTerminal()
      }
    }
  )

  it('shares the completion Promise with a synchronous reentrant disposer', async () => {
    /** The store is fully initialized before any owned disposer runs. */
    const store = createStore({ value: 1 })
    /** Capture the actual nested result without replacing the lifecycle owner. */
    let nested: Promise<void> | undefined
    /** Only one physical disposal may run. */
    const dispose = vi.fn(() => {
      nested = store.$dispose()
      void nested.catch(() => {})
    })
    store.$own({ disposed: false, dispose })
    /** The outer Promise must already be published when disposal reenters. */
    const outer = store.$dispose()
    await outer
    expect(nested).toBe(outer)
    expect(store.$dispose()).toBe(outer)
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it.each([isRaw, isFieldBuilder])(
    'contains revoked unknown inputs in the public guard',
    (guard) => {
      /** A real revoked native Proxy cannot reveal even its brand. */
      const revoked = Proxy.revocable({}, {})
      revoked.revoke()
      expect(guard(revoked.proxy)).toBe(false)
    }
  )

  it('rolls back a constructed field when an input key conflicts with the store API', async () => {
    /** An ordinary public builder owns a real disposable field. */
    const dispose = vi.fn()
    expect(() =>
      createStore({
        field: {
          [FIELD_BUILDER]: true,
          mode: StoreFieldMode.sync,
          create: (): { disposed: boolean; dispose(): void } => ({ disposed: false, dispose })
        },
        $snapshot: 1
      })
    ).toThrow(expect.objectContaining({ source: 'store.light', code: 'INVALID_OPTION' }))
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledTimes(1), { timeout: 200, interval: 5 })
  })
  it('rejects a pre-discriminant builder before starting its creation', async () => {
    /** The retired shape must not start extension I/O through the async entry. */
    const create = vi.fn(async () => ({ disposed: false, dispose() {} }))
    await expect(
      createAsyncStore({ field: { [FIELD_BUILDER]: true, create } as never })
    ).rejects.toMatchObject({ source: 'store.light', code: 'INVALID_OPTION' })
    expect(create).not.toHaveBeenCalled()
  })
})
