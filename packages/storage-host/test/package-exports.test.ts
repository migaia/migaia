import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
/** The repository baseline remains the existing owner of runtime export expectations. */
const baseline = JSON.parse(
  readFileSync(
    new URL('../../../scripts/fixtures/public-exports.baseline.json', import.meta.url),
    'utf8'
  )
) as { packages: Record<string, Record<string, string[]>> }
describe('storage host package exports', () => {
  it('loads the pure MMR scorer from the SDK entry and not from the root', async () => {
    /** Real dist resolution verifies the neutral entry and the root's protected boundary. */
    const runtime = await import('@migaia/storage-host/sdk')
    expect(Object.keys(runtime).sort()).toEqual(
      [...baseline.packages['@migaia/storage-host']!['./sdk']!].sort()
    )
    expect(runtime.mmr).toBeTypeOf('function')
    expect(await import('@migaia/storage-host')).not.toHaveProperty('mmr')
    expect(
      runtime.mmr({ lambda: 1 })(
        {
          origin: { kind: 'near', vector: [1] },
          hits: [{ id: 'one', score: 1, vector: [1] }]
        },
        { signal: new AbortController().signal }
      )
    ).toEqual([1])
  })
  it('exposes only the private log factory through its dedicated journal entry', async () => {
    const runtime = await import('@migaia/storage-host/plugins/journal')
    expect(Object.keys(runtime)).toEqual(
      baseline.packages['@migaia/storage-host']!['./plugins/journal']
    )
    expect(await import('@migaia/storage-host')).not.toHaveProperty('storageLogStore')
  })
  it('loads only finite backend functions from the SDK entry', async () => {
    /** Real package resolution proves controller authority remains on the original core. */
    const runtime = await import('@migaia/storage-host/sdk')
    expect(Object.keys(runtime).sort()).toEqual(
      [...baseline.packages['@migaia/storage-host']!['./sdk']!].sort()
    )
    /**
     * The controller factory joined the SDK from its former subpath; lookup and lock ports stay
     * private.
     */
    expect(runtime.createBackendChangeController).toBeTypeOf('function')
    expect(runtime).not.toHaveProperty('getBackendChangeController')
    expect(runtime).not.toHaveProperty('createBackendKeyLockPort')
    expect(runtime.observeStorageBatch).toBeTypeOf('function')
    expect(runtime.createBackendJournalNamespace).toBeTypeOf('function')
    const image = runtime.encodeStorageJournalImage(true, { nullable: null })
    expect(runtime.decodeStorageJournalImage(image)).toEqual({
      present: true,
      value: { nullable: null }
    })
    expect(runtime.encodeStorageJournalImage(false)).toEqual({ present: false })
    const bytes = runtime.encodeStorageJournalImage(true, new Uint8Array([1, 2]), true)
    expect(runtime.decodeStorageJournalImage(bytes, true)).toEqual({
      present: true,
      value: new Uint8Array([1, 2])
    })
    const head = runtime.storageJournalLockKey('native', runtime.StorageJournalLock.head)
    const resource = runtime.storageJournalLockKey('native', runtime.StorageJournalLock.resource)
    expect(head.channel).toBe('text')
    expect(head).not.toEqual(resource)
    expect(() => runtime.storageJournalLockKey('', runtime.StorageJournalLock.head)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(runtime.asyncDisposeKey).toBe((await import('@migaia/plugin-host')).asyncDisposeKey)
  })
  it('publishes shared vector snapshots and query synthesis through the SDK entry', async () => {
    /** Actual package resolution excludes private memory scoring, filtering and ranking. */
    const runtime = await import('@migaia/storage-host/sdk')
    expect(Object.keys(runtime).sort()).toEqual(
      [...baseline.packages['@migaia/storage-host']!['./sdk']!].sort()
    )
    expect(
      runtime.recommendStorageVector(
        [
          [2, 0],
          [0, 2]
        ],
        [[1, 0]]
      )
    ).toEqual([0, 1])
  })
  it('loads the actual neutral package root with the declared public runtime surface', async () => {
    /** Dynamic self-import exercises the built package entry rather than an internal source alias. */
    const runtime = await import('@migaia/storage-host')
    expect(Object.keys(runtime).sort()).toEqual(baseline.packages['@migaia/storage-host']!['.'])
    /** The error domain and code table now come from storage-contract, not from this root. */
    expect(runtime).not.toHaveProperty('StorageErrorCode')
    expect((await import('@migaia/storage-contract/error-code')).STORAGE_HOST_ERROR_SOURCE).toBe(
      'storage.host'
    )
    await using host = await runtime.createStorageHost()
    expect(host.backends().size).toBe(0)
  })
  it('loads schema and codec adapters through the actual neutral entity entry', async () => {
    /** Package resolution proves adapters do not require a browser or Web package entry. */
    const runtime = await import('@migaia/storage-host/entity')
    expect(Object.keys(runtime).sort()).toEqual(
      baseline.packages['@migaia/storage-host']!['./entity']
    )
    expect(runtime.jsonCodec.name).toBe('json@1')
    expect(runtime.REPOSITORY_KEY_PREFIX).toBe('__storage_web_entity_v2__')
    expect(runtime.repositoryMigrationKey('users')).toBe('repository:users:migration')
    await expect(runtime.jsonCodec.encode({ ready: true })).resolves.toBe('{"ready":true}')
  })
})
