import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import type { IStorageChange } from '@migaia/storage-contract'
import { createMemoryTestStore } from '../helpers/installed-backends.ts'
import { createIndexedDbTestStore } from '../helpers/installed-backends.ts'

/** Both exact backend factories expose the same public byte-channel deletion contract. */
const backends = [
  ['memory', () => createMemoryTestStore()],
  [
    'indexeddb',
    () =>
      createIndexedDbTestStore({
        factory: new IDBFactory(),
        keyRange: IDBKeyRange,
        dbName: 'byte-removal'
      })
  ]
] as const

describe.each(backends)('%s per-key byte deletion', (_backend, createStore) => {
  it('deletes only the target bytes, preserves sibling channels, and publishes one committed removal', async () => {
    /** This store owns all independent channels exercised by the public deletion operation. */
    const store = await createStore()
    /** Keep the target and its sibling distinct so accidental clearBytes routing is observable. */
    const target = 'target'
    /** Changes are recorded only after fixture setup so an absent removal has no hidden event. */
    const changes: IStorageChange[] = []
    try {
      await store.setBytes(target, new Uint8Array([1, 2]))
      await store.setBytes('sibling', new Uint8Array([3]))
      await store.set('text', 'retained')
      await store.putRecord({ retained: true }, 'record')
      store.subscribeChanges((change) => changes.push(change))
      await store.remove(target)
      await expect(store.getBytes(target)).resolves.toEqual(new Uint8Array([1, 2]))
      await store.removeBytes(target)
      await store.removeBytes(target)
      await expect(store.getBytes(target)).resolves.toBeNull()
      await expect(store.getBytes('sibling')).resolves.toEqual(new Uint8Array([3]))
      await expect(store.get('text')).resolves.toBe('retained')
      await expect(store.getRecord('record')).resolves.toEqual({ retained: true })
      expect(changes.map(({ channel, kind, keys }) => ({ channel, kind, keys }))).toEqual([
        { channel: 'bytes', kind: 'remove', keys: [target] }
      ])
    } finally {
      await store.dispose()
    }
  })

  it('does not remove text or records at a key with no byte entry', async () => {
    /** Missing byte membership must be checked in the byte channel, independently of other keys. */
    const store = await createStore()
    /** A no-op byte removal must not advertise a mutation to observers of either channel. */
    const changes: IStorageChange[] = []
    try {
      await store.set('text', 'retained')
      await store.putRecord({ retained: true }, 'record')
      store.subscribeChanges((change) => changes.push(change))
      await store.removeBytes('text')
      await store.removeBytes('record')
      await expect(store.get('text')).resolves.toBe('retained')
      await expect(store.getRecord('record')).resolves.toEqual({ retained: true })
      expect(changes).toEqual([])
    } finally {
      await store.dispose()
    }
  })

  it('preserves bytes and the original pre-abort cause, then rejects deletion after disposal', async () => {
    /** Lifecycle validation precedes the same public byte-only mutation on both exact backends. */
    const store = await createStore()
    /** Cancellation belongs to the caller and must remain reachable without replacing its identity. */
    const reason = new Error('cancel byte deletion')
    /** An already-aborted signal must prevent both storage mutation and feed publication. */
    const controller = new AbortController()
    /** Any event here would expose an aborted or disposed operation as committed. */
    const changes: IStorageChange[] = []
    try {
      await store.setBytes('target', new Uint8Array([1]))
      store.subscribeChanges((change) => changes.push(change))
      controller.abort(reason)
      /** Keep the actual rejected value so cause identity is checked rather than deep equality. */
      const failure = await store
        .removeBytes('target', { signal: controller.signal })
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({
        source: 'storage.contract',
        code: 'ABORTED'
      })
      expect((failure as Error).cause).toBe(reason)
      await expect(store.getBytes('target')).resolves.toEqual(new Uint8Array([1]))
      await store.dispose()
      await expect(store.removeBytes('target')).rejects.toMatchObject({
        source: 'storage.contract',
        code: 'STORE_DISPOSED'
      })
      expect(changes).toEqual([])
    } finally {
      await store.dispose()
    }
  })
})

it('rolls back an in-flight IndexedDB byte deletion without publishing a removal', async () => {
  /** A fresh real IndexedDB implementation supplies the native transaction rollback semantics. */
  const store = await createIndexedDbTestStore({
    factory: new IDBFactory(),
    keyRange: IDBKeyRange,
    dbName: 'byte-removal-abort'
  })
  /** Abort after admission but before native commit, following the existing record-delete fixture. */
  const controller = new AbortController()
  /** Only a committed membership change may reach this existing backend feed. */
  const changes: IStorageChange[] = []
  try {
    await store.setBytes('target', new Uint8Array([1]))
    store.subscribeChanges((change) => changes.push(change))
    /** Observe the original deletion Promise rather than introducing a separate abort race helper. */
    const pending = store.removeBytes('target', { signal: controller.signal })
    await Promise.resolve()
    controller.abort('cancel admitted byte deletion')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(store.getBytes('target')).resolves.toEqual(new Uint8Array([1]))
    expect(changes).toEqual([])
  } finally {
    await store.dispose()
  }
})

it('cancels a byte deletion before native admission without publishing a removal', async () => {
  /** Reopening the same native factory proves cancellation left the stored bytes unchanged. */
  const factory = new IDBFactory()
  /** Both handles address one existing physical database through the ordinary public factory. */
  const options = { factory, keyRange: IDBKeyRange, dbName: 'byte-removal-dispose' }
  /** This store owns the admission lease while asynchronous native preparation is pending. */
  const store = await createIndexedDbTestStore(options)
  /** An uncommitted deletion must not publish a membership change. */
  const changes: IStorageChange[] = []
  try {
    await store.setBytes('target', new Uint8Array([1]))
    store.subscribeChanges((change) => changes.push(change))
    /** Attach the result observer before closing so an erroneous late rejection is still observed. */
    const deleted = expect(store.removeBytes('target')).rejects.toMatchObject({
      code: 'ABORTED',
      cause: expect.objectContaining({ code: 'STORE_DISPOSED' })
    })
    /** Closing cancels this member before native admission and drains its original lease. */
    const closing = store.dispose()
    await deleted
    await closing
    expect(changes).toEqual([])
    /** The original instance is closed, so a fresh public handle verifies the unchanged contents. */
    const reopened = await createIndexedDbTestStore(options)
    try {
      await expect(reopened.getBytes('target')).resolves.toEqual(new Uint8Array([1]))
    } finally {
      await reopened.dispose()
    }
  } finally {
    await store.dispose()
  }
})
