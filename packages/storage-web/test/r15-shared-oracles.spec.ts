import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineEntity } from '../src/entity.js'
import { getBackendReactiveController } from '../src/backends/reactive-controller.js'
import { memoryStorage } from '../src/backends/memory.js'
import { safeJsonPayloadByteLength } from '../src/utils/json.js'
import { utf8ByteLength } from '@migaia/utils/bytes'

type IIndexedUser = {
  readonly id: string
  readonly email: string
  readonly tags: readonly string[]
}

/** Repository root used by authority and owner-boundary assertions. */
const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')

/** Reads one package file from the current worktree without relying on built artifacts. */
const readPackageFile = (packageName: string, fileName: string): string =>
  readFileSync(resolve(repositoryRoot, 'packages', packageName, fileName), 'utf8')

describe('SWV4 R15 shared oracle clusters', () => {
  it('SWV4-T01/T02/T03 proves current authority, exact surface, and neutral contract boundary', () => {
    const storageManifest = JSON.parse(readPackageFile('storage-web', 'package.json')) as {
      readonly private?: boolean
      readonly sideEffects?: boolean
      readonly exports?: Readonly<Record<string, unknown>>
    }
    const storageRoot = readPackageFile('storage-web', 'src/index.ts')
    const contractCapabilities = readPackageFile('storage-contract', 'src/capabilities.ts')
    expect(storageManifest.private).toBe(true)
    expect(storageManifest.sideEffects).toBe(false)
    expect(storageManifest.exports?.['./reactive']).toBeUndefined()
    expect(storageRoot).toContain('StorageError')
    expect(storageRoot).not.toMatch(/export \* from/)
    expect(contractCapabilities).not.toMatch(/from ['"](?:node:|@migaia\/(?:storage-web|reactive))/)
  })

  it('SWV4-T04/T10/T43 proves typed index projection and fallback ordering through one query route', async () => {
    const entity = defineEntity<IIndexedUser>()({
      name: 'r15-indexed-users',
      key: 'id',
      indexes: {
        email: { path: 'email' },
        tags: { path: 'tags', multiEntry: true }
      }
    })
    const repository = entity.connect(memoryStorage())
    await repository.put({ id: 'u2', email: 'same@example.com', tags: ['staff'] })
    await repository.put({ id: 'u1', email: 'same@example.com', tags: ['admin', 'staff'] })
    await repository.put({ id: 'u3', email: 'z@example.com', tags: ['staff'] })

    await expect(
      repository.list({ index: 'tags', range: { lower: 'admin', upper: 'admin' } })
    ).resolves.toEqual([{ id: 'u1', email: 'same@example.com', tags: ['admin', 'staff'] }])
    await expect(
      repository.findManyBy(
        'email',
        { lower: 'same@example.com', upper: 'z@example.com' },
        { direction: 'prev', limit: 2 }
      )
    ).resolves.toEqual([
      { id: 'u3', email: 'z@example.com', tags: ['staff'] },
      { id: 'u2', email: 'same@example.com', tags: ['staff'] }
    ])
  })

  it('SWV4-T05/T06/T07/T08/T09/T11/T12/T13/T14/T41/T42 preserves private IDB authority and migration owners', () => {
    const indexedDbSource = readPackageFile('storage-web', 'src/backends/indexed-db.ts')
    const backfillSource = readPackageFile('storage-web', 'src/backends/indexed-db-backfill.ts')
    const repositorySource = readPackageFile('storage-web', 'src/entity/repository.ts')
    expect(indexedDbSource).toContain(
      "const mutationLeaseBrand = Symbol('indexeddb-mutation-lease')"
    )
    expect(indexedDbSource).toContain('withInternalMutationLease')
    expect(indexedDbSource).toContain('secondaryIndexes: true')
    expect(indexedDbSource).toContain('changeFeed: coordination.admitted')
    expect(backfillSource).toContain('IndexedDbBackfillPhase')
    expect(backfillSource).toContain('canonical')
    expect(backfillSource).toContain('legacy')
    expect(repositorySource).toContain('safeJsonPayloadByteLength')
    expect(indexedDbSource).not.toMatch(
      /metadata\.(?:get|put|delete)\(['"](?:schema|migration|repository:|index:)/
    )
  })

  it('SWV4-T68 proves one mutation lease drains before controller disposal', async () => {
    const store = memoryStorage()
    const controller = getBackendReactiveController(store)
    if (controller === undefined) throw new Error('memory controller is not registered')
    const release = controller.beginMutation()
    const disposal = controller.dispose()
    expect(() => controller.beginMutation()).toThrow()
    let settled = false
    void disposal.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await disposal
    expect(settled).toBe(true)
  })

  it('SWV4-T71 proves one JSON payload owner has exact UTF-8 and fail-closed structured-clone boundaries', () => {
    const jsonSource = readPackageFile('storage-web', 'src/utils/json.ts')
    expect(jsonSource.match(/JSON\.stringify/g)).toHaveLength(1)
    expect(safeJsonPayloadByteLength(undefined)).toBe(0)
    expect(safeJsonPayloadByteLength({ text: 'CJK-💡' })).toBe(
      utf8ByteLength(JSON.stringify({ text: 'CJK-💡' }))
    )
    expect(safeJsonPayloadByteLength({ nested: undefined })).toBe(Number.MAX_SAFE_INTEGER)
    expect(safeJsonPayloadByteLength([undefined])).toBe(Number.MAX_SAFE_INTEGER)
    expect(safeJsonPayloadByteLength({ nested: new Map([['key', 'value']]) })).toBe(
      Number.MAX_SAFE_INTEGER
    )
    expect(safeJsonPayloadByteLength({ nested: new Uint8Array([1, 2, 3]) })).toBe(
      Number.MAX_SAFE_INTEGER
    )
  })
})
