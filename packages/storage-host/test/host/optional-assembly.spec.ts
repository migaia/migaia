import { expect, it } from 'vitest'
import {
  createStorageHost,
  memoryBackendPlugin,
  STORAGE_HOST_SOURCE,
  StorageErrorCode
} from '../../src/index.js'
import { storageLogStore, storageJournalPlugin } from '../../src/journal.js'
import { memoryNotificationsFeature } from '../../src/features/memory-notifications.js'
import { memoryChangeFeedFeature } from '../../src/features/memory-change-feed.js'

it('keeps base reads and writes usable while rejecting missing optional assemblies', async () => {
  await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
  const store = host.backend('memory')
  await store.set('key', 'value')
  expect(await store.get('key')).toBe('value')
  expect(store.capabilities.changeFeed).toBe(false)
  expect(() => store.watch('all')).toThrowError(
    expect.objectContaining({
      source: STORAGE_HOST_SOURCE,
      code: StorageErrorCode.changeIteratorNotAssembled
    })
  )
  expect(() => store.subscribeChanges(() => {})).toThrowError(
    expect.objectContaining({
      source: STORAGE_HOST_SOURCE,
      code: StorageErrorCode.changeControllerNotAssembled
    })
  )
  await expect(storageLogStore(host, 'memory', { prefix: 'missing' })).rejects.toMatchObject({
    source: STORAGE_HOST_SOURCE,
    code: StorageErrorCode.journalNotAssembled
  })
})

it('selects notification and iterator roots independently in the original backend lifetime', async () => {
  await using host = await createStorageHost({
    plugins: [memoryBackendPlugin(undefined, { notifications: memoryNotificationsFeature() })]
  })
  const store = host.backend('memory')
  const changes: unknown[] = []
  const release = store.subscribeChanges((change) => changes.push(change))
  await store.set('key', 'value')
  release()
  expect(changes).toHaveLength(1)
  expect(store.capabilities.changeFeed).toBe(false)
  expect(() => store.watch('all')).toThrowError(
    expect.objectContaining({ code: StorageErrorCode.changeIteratorNotAssembled })
  )
})

it('opens private logs only through the selected native journal plugin', async () => {
  await using host = await createStorageHost({
    plugins: [
      storageJournalPlugin(),
      memoryBackendPlugin(undefined, {
        notifications: memoryNotificationsFeature(),
        changeFeed: memoryChangeFeedFeature()
      })
    ]
  })
  await using log = await storageLogStore(host, 'memory', { prefix: 'explicit' })
  await log.append([{ kind: 'created', payload: { id: 'one' } }])
  expect(await log.lastSeq()).toBe(1)
  expect(host.backend('memory').capabilities.changeFeed).toBe(true)
})

it('accepts journal configuration only once, in the first install batch', async () => {
  /** Rejection happens before any organization initializes, so the initializer never runs. */
  const unused = () => {
    throw new Error('journal initializer must not run')
  }
  await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
  await expect(
    host.use(storageJournalPlugin(unused), memoryBackendPlugin({ id: 'late' }))
  ).rejects.toMatchObject({
    code: StorageErrorCode.backendInstallFailed,
    cause: { code: StorageErrorCode.invalidConfig }
  })
  expect(host.hasBackend('late')).toBe(false)
  await expect(
    createStorageHost({
      // @ts-expect-error Two journal plugins share one plugin id, which the types already reject.
      plugins: [storageJournalPlugin(unused), storageJournalPlugin(unused), memoryBackendPlugin()]
    })
  ).rejects.toMatchObject({ cause: { code: StorageErrorCode.invalidConfig } })
})
