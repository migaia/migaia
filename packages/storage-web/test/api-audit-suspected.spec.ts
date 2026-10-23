import { describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { createRuntime } from '@migaia/reactive'
import { createIndexedDbTestStore } from './helpers/installed-backends.js'
import { defineEntity } from '@migaia/storage-host/entity'
import { createReactiveServiceFixture } from './helpers/reactive-service.js'

/** A complete injected IDB factory delays only delivery of its real open-success event. */
class DelayedFactory extends IDBFactory {
  /** Observe delivery through the public simulated host, independently of the storage operation. */
  delivered = false
  /** Keep normal upgrade/error events while making the operation cross its requested deadline. */
  override open(name: string, version?: number): IDBOpenDBRequest {
    /** The native simulated request retains its complete public surface and database. */
    const request = super.open(name, version)
    /** Storage's handler needs no event payload; retain it until the simulated host delivers it. */
    let success: (() => void) | null = null
    Object.defineProperty(request, 'onsuccess', {
      configurable: true,
      get: () =>
        success === null
          ? null
          : () =>
              setTimeout(() => {
                this.delivered = true
                success!()
              }, 30),
      set: (value: (() => void) | null) => {
        success = value
      }
    })
    return request
  }
}

describe('storage-web confirmed audit suspicions', () => {
  it('identifies the owned backfill aggregate and retains both original failures', async () => {
    /** Real simulation owns all transactions and backend admission. */
    const store = await createIndexedDbTestStore({
      factory: new IDBFactory(),
      keyRange: IDBKeyRange,
      dbName: 'audit-double-failure'
    })
    /** Fail only the two public object-store writes involved in this supported error path. */
    const primary = new Error('checkpoint write failed')
    /** The secondary cannot replace or hide the primary. */
    const secondary = new Error('readiness write failed')
    /** Preserve the exact built-in receiver semantics for unaffected object-store writes. */
    const originalPut = IDBObjectStore.prototype.put
    try {
      await defineEntity<{ id: string; value: string }>({ name: 'audit-double', key: 'id' })
        .connect(store)
        .put({ id: 'row', value: 'saved' })
      IDBObjectStore.prototype.put = function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        /** Inspect only the public persistence payload to choose the two host faults. */
        const state = value as {
          lastBatchReceipt?: unknown
          lease?: unknown
          readiness?: { status?: unknown }
        } | null
        if (
          state?.lastBatchReceipt !== undefined &&
          state.lease === undefined &&
          state.readiness?.status !== 'failed'
        )
          throw primary
        if (state?.readiness?.status === 'failed') throw secondary
        return Reflect.apply(originalPut, this, key === undefined ? [value] : [value, key])
      }
      /** An ordinary indexed read drives the real repository backfill path. */
      const repo = defineEntity<{ id: string; value: string }>()({
        name: 'audit-double',
        key: 'id',
        indexes: { byValue: { path: 'value' } },
        onDiagnostic: () => {}
      }).connect(store)
      await expect(
        repo.query().index('byValue', { lower: 'saved', upper: 'saved' }).all()
      ).rejects.toMatchObject({
        source: '@migaia/storage-host',
        code: 'INDEX_BACKFILL_FAILED',
        cause: primary,
        errors: [primary, secondary]
      })
    } finally {
      IDBObjectStore.prototype.put = originalPut
      await store.dispose()
    }
  })

  it('ensureRecordIndexes obeys its deadline while reopening after versionchange', async () => {
    /** Opening crosses 2ms while preserving the real factory/database implementation. */
    const factory = new DelayedFactory()
    /** Preparation remains owned by the backend after the caller stops waiting. */
    const store = await createIndexedDbTestStore({
      factory,
      keyRange: IDBKeyRange,
      dbName: 'audit-deadline'
    })
    /** A native version transition closes the installed store's original connection. */
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('audit-deadline')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    /** Reopening after the upgrade exercises the original lazy recovery path under this deadline. */
    const version = connection.version + 1
    connection.close()
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('audit-deadline', version)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    factory.delivered = false
    try {
      await expect(
        store.ensureRecordIndexes(
          'scope',
          [{ name: 'value', unique: false, multiEntry: false, revision: 1 }],
          { timeoutMs: 2 }
        )
      ).rejects.toMatchObject({ source: '@migaia/storage-contract', code: 'ABORTED' })
      expect(factory.delivered).toBe(false)
    } finally {
      await store.dispose()
    }
  })

  it('index iteration applies one deadline across buffered yields', async () => {
    /** Real IDB transactions and backfill create the sidecar rows consumed by the public iterator. */
    const store = await createIndexedDbTestStore({
      factory: new IDBFactory(),
      keyRange: IDBKeyRange,
      dbName: 'audit-iterator-deadline'
    })
    try {
      /** The normal repository is the only producer of index projection rows. */
      const repo = defineEntity<{ id: string; value: string }>()({
        name: 'audit-iterator',
        key: 'id',
        indexes: { byValue: { path: 'value' } },
        onDiagnostic: () => {}
      }).connect(store)
      await repo.put({ id: 'first', value: 'a' })
      await repo.put({ id: 'second', value: 'b' })
      await repo.migrate()
      await repo.query().index('byValue').all()
      /** Acquire the ordinary public handle for the exact same declared index set. */
      const handle = await store.ensureRecordIndexes('audit-iterator', [
        { name: 'byValue', unique: false, multiEntry: false, revision: 1 }
      ])
      /** Timeout belongs to the whole iterator, including time between consumer reads. */
      const cursor = store.iterateRecordIndex({ handle, index: 'byValue' }, { timeoutMs: 50 })
      expect((await cursor.next()).done).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 70))
      await expect(cursor.next()).rejects.toMatchObject({
        source: '@migaia/storage-contract',
        code: 'ABORTED'
      })
    } finally {
      await store.dispose()
    }
  })

  it('coarse push invalidation refreshes scoped queries without fabricating a change', async () => {
    /** The installed public feature supplies exactly one source callback. */
    let invalidate!: () => void
    /** The application source can detect a change without knowing a storage payload. */
    let value = 'before'
    /** Count actual requests, not private invalidation bookkeeping. */
    let calls = 0
    /** The original service borrows an actual Feature-owned store and controller. */
    const { host, store, controller, service } = await createReactiveServiceFixture({
      id: 'audit-coarse',
      attach: false
    })
    const adapter = service.registerAdapter({
      backendId: 'audit-coarse',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: (context) => {
        invalidate = () => context.onChange()
        return () => {}
      },
      report: () => {}
    })
    adapter.startSource()
    /** Unknown changes must invalidate even when a known change would be filtered out. */
    const query = service.createQuery({
      backendId: 'audit-coarse',
      runtime: createRuntime(),
      scope: 'scoped',
      matches: () => false,
      query() {
        calls += 1
        return value
      }
    })
    try {
      await query.ready
      value = 'after'
      invalidate()
      await vi.waitFor(() => expect(query.state.value).toMatchObject({ value: 'after' }), {
        timeout: 250,
        interval: 5
      })
      expect(calls).toBe(2)
    } finally {
      await query.dispose()
      await host.dispose()
    }
  })
})
