import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { records } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import {
  STORAGE_HOST_ERROR_SOURCE,
  StorageHostErrorCode
} from '@migaia/storage-contract/error-code'
import { memoryBackendKind, memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'
import { memoryChangeFeedFeature } from '@migaia/storage-host/features/memory-change-feed'
import { walkErrorCauses } from '@migaia/utils/error'
import { reactiveFeature } from '../../src/features/reactive.js'

/** Web consumers select the original neutral memory owners independently of browser adapters. */
describe('explicit memory owners used by web Features', () => {
  it('preserves basic storage while notification and iterator calls retain their distinct missing codes', async () => {
    /** This public host owns and releases the case's original backend. */
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    /** The certified backend view retains its actual native transaction owner. */
    const store = host.backend('memory')
    await store.set('key', 'value')
    expect(await store.get('key')).toBe('value')
    expect(store.capabilities.changeFeed).toBe(false)
    expect(() => store.subscribeChanges(() => undefined)).toThrow(
      expect.objectContaining({
        source: STORAGE_HOST_ERROR_SOURCE,
        code: StorageHostErrorCode.changeControllerNotAssembled
      })
    )
    expect(() => store.watch('key')).toThrow(
      expect.objectContaining({
        source: STORAGE_HOST_ERROR_SOURCE,
        code: StorageHostErrorCode.changeIteratorNotAssembled
      })
    )
  })

  it('drives web live queries with notifications alone without installing a change-feed iterator', async () => {
    /** This public host owns and releases the case's original backend. */
    await using host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          reactive: reactiveFeature(memoryBackendKind)
        })
      ]
    })
    /** The certified backend view retains its actual native transaction owner. */
    const store = host.backend('memory')
    await store.putRecord({ value: 'before' }, 'row')
    /** The original Resource subscribes directly to the selected notifications owner. */
    await using query = store
      .use(records)
      .query<{ value: string }>()
      .live({ runtime: createRuntime() })
    await query.ready
    expect(query.state.value.value).toEqual([{ value: 'before' }])
    await store.putRecord({ value: 'after' }, 'row')
    await vi.waitFor(() => expect(query.state.value.value).toEqual([{ value: 'after' }]))
    expect(store.capabilities.changeFeed).toBe(false)
    expect(() => store.watch('row')).toThrow(
      expect.objectContaining({
        source: STORAGE_HOST_ERROR_SOURCE,
        code: StorageHostErrorCode.changeIteratorNotAssembled
      })
    )
  })

  it('rejects a feed without its explicit notification producer during installation', async () => {
    /** Retain the original failure chain rather than replacing its package identity. */
    const failure = await createStorageHost({
      plugins: [memoryBackendPlugin(undefined, { changeFeed: memoryChangeFeedFeature() })]
    }).catch((error: unknown) => error)
    expect(walkErrorCauses(failure)).toContainEqual(
      expect.objectContaining({
        source: STORAGE_HOST_ERROR_SOURCE,
        code: StorageHostErrorCode.changeControllerNotAssembled
      })
    )
  })

  it('delivers selected committed keys only when notifications and feed are both selected', async () => {
    /** This public host owns and releases the case's original backend. */
    await using host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    /** The certified backend view retains its actual native transaction owner. */
    const store = host.backend('memory')
    expect(store.capabilities.changeFeed).toBe(true)
    /** The caller owns only this original key-filtered change iterator. */
    await using changes = store.watch('selected')
    /** Admit the pending advance before the real committed writes publish notifications. */
    const next = changes.next()
    await store.set('other', 'ignored')
    await store.set('selected', 'committed')
    expect((await next).value).toMatchObject({ channel: 'value', kind: 'put', keys: ['selected'] })
    expect(await store.get('selected')).toBe('committed')
    await changes.dispose()
    expect(await changes.next()).toMatchObject({ done: true })
  })
})
