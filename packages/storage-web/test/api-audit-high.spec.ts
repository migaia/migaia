import { describe, expect, it } from 'vitest'
import { memoryStorageHost } from '../src/memory.js'
import { defineEntity } from '../src/entity.js'

describe('storage-web audit high severity regressions', () => {
  it('notifies replacement observers only after the destination exists', async () => {
    /** Real memory storage owns both channels and post-commit notifications. */
    const store = memoryStorageHost()
    await store.putRecord({ before: true }, 'key')
    /** Capture the read initiated synchronously inside the removal callback. */
    let observedBytes: Promise<Uint8Array | null> | undefined
    /** An ordinary reentrant value write must see the already-committed byte owner. */
    let rejected: unknown
    /** The public observer exercises supported synchronous reentrancy. */
    const stop = store.subscribeChanges((change) => {
      if (change.channel !== 'record' || change.kind !== 'remove') return
      observedBytes = store.getBytes('key')
      try {
        store.sync.set('key', 'listener')
      } catch (cause) {
        rejected = cause
      }
    })
    try {
      await store.setBytes('key', new Uint8Array([7]), { conflictPolicy: 'replace' })
      await expect(observedBytes).resolves.toEqual(new Uint8Array([7]))
      expect(rejected).toMatchObject({ code: 'DUPLICATE_KEY' })
      expect(await store.get('key')).toBeNull()
      expect(await store.getBytes('key')).toEqual(new Uint8Array([7]))
    } finally {
      stop()
      await store.dispose()
    }
  })

  it('migration preserves an update committed after the scan', async () => {
    /** Real repositories share one transaction-capable backend. */
    const store = memoryStorageHost()
    /** Gate only the first scanned old value through the supported asynchronous schema. */
    let releaseRead!: () => void
    /** Announce the scan before committing the competing update. */
    let announceRead!: () => void
    /** The scan waits while the normal public put completes. */
    const blocked = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    /** The test never depends on a timer or private transaction state. */
    const reached = new Promise<void>((resolve) => {
      announceRead = resolve
    })
    /** Pause just once; the transaction may legitimately rematerialize current data. */
    let intercepted = false
    try {
      /** Initial v1 data is eligible for migration. */
      const old = defineEntity<{ id: string; value: string }>({
        name: 'audit-race',
        key: 'id'
      }).connect(store)
      await old.put({ id: 'row', value: 'old' })
      /** The complete v2 graph is valid independently of the race. */
      const upgraded = defineEntity<{ id: string; value: string }>({
        name: 'audit-race',
        key: 'id',
        version: 2,
        migrations: { 2: async (value) => value },
        schema: {
          name: 'audit-gated-schema',
          async validate(value) {
            /** The schema's validated domain value controls only the public gate. */
            const row = value as { id: string; value: string }
            if (row.value === 'old' && !intercepted) {
              intercepted = true
              announceRead()
              await blocked
            }
            return row
          }
        }
      }).connect(store)
      /** Migration captures old data before the competing write. */
      const migrating = upgraded.migrate({ batchSize: 1 })
      await reached
      await upgraded.put({ id: 'row', value: 'new' })
      releaseRead()
      expect(await migrating).toMatchObject({ migrated: 0, alreadyCurrent: 1 })
      expect(await upgraded.get('row')).toEqual({ id: 'row', value: 'new' })
    } finally {
      releaseRead()
      await store.dispose()
    }
  })

  it('fallback rejects a second owner of a unique index value', async () => {
    /** A backend without a native sidecar still has declared entity write constraints. */
    const store = memoryStorageHost()
    try {
      /** Both writes use the public curried index definition and ordinary repository. */
      const users = defineEntity<{ id: string; email: string }>()({
        name: 'audit-unique',
        key: 'id',
        indexes: { byEmail: { path: 'email', unique: true } },
        onDiagnostic: () => {}
      }).connect(store)
      await users.put({ id: 'first', email: 'same' })
      await expect(users.put({ id: 'second', email: 'same' })).rejects.toMatchObject({
        source: '@migaia/storage-web',
        code: 'INDEX_UNIQUE_CONFLICT'
      })
      expect(
        (await users.findManyBy('byEmail', { lower: 'same', upper: 'same' })).map((row) => row.id)
      ).toEqual(['first'])
    } finally {
      await store.dispose()
    }
  })
})
