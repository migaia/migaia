import { entityTestFeatures } from './helpers/entity-features.ts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defineEntityPlugin } from '@migaia/storage-host/entity'
import { createMemoryTestStore } from './helpers/installed-backends.ts'
import { createReactiveServiceFixture } from './helpers/reactive-service.ts'
import { safeJsonPayloadByteLength } from '@migaia/storage-host/sdk'
import { utf8ByteLength } from '@migaia/utils/bytes'

type IIndexedUser = {
  readonly id: string
  readonly email: string
  readonly tags: readonly string[]
}

/** Repository root resolves the package manifest used by the release-surface assertion. */
const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..')

/** Reads one package file from the current worktree without relying on built artifacts. */
const readPackageFile = (packageName: string, fileName: string): string =>
  readFileSync(resolve(repositoryRoot, 'packages', packageName, fileName), 'utf8')

describe('shared oracle clusters', () => {
  it('declares the private browser package release surface', () => {
    const storageManifest = JSON.parse(
      readPackageFile('storage-plugin-browser', 'package.json')
    ) as {
      readonly private?: boolean
      readonly sideEffects?: boolean
      readonly exports?: Readonly<Record<string, unknown>>
    }
    expect(storageManifest.private).toBe(true)
    expect(storageManifest.sideEffects).toBe(false)
    expect(storageManifest.exports?.['./reactive']).toBeUndefined()
  })

  it('proves typed index projection and fallback ordering through one query route', async () => {
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entityEntityPlugin = defineEntityPlugin<IIndexedUser>()('shared-oracles-spec-ts-39', {
      features: entityTestFeatures,
      name: 'indexed-users',
      key: 'id',
      indexes: {
        email: { path: 'email' },
        tags: { path: 'tags', multiEntry: true }
      }
    })
    const { host: entityEntityPluginBackendHost, store: entityEntityPluginBackendStore } =
      await createMemoryTestStore({}, true)
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost = await entityEntityPluginBackendHost.use(entityEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repository = entityEntityPluginHost.extensions[entityEntityPlugin.id](
      entityEntityPluginBackendStore
    )
    await repository.put({ id: 'u2', email: 'same@example.com', tags: ['staff'] })
    await repository.put({ id: 'u1', email: 'same@example.com', tags: ['admin', 'staff'] })
    await repository.put({ id: 'u3', email: 'z@example.com', tags: ['staff'] })

    await expect(
      repository.list({ index: 'tags', range: { lower: 'admin', upper: 'admin' } })
    ).resolves.toEqual([{ id: 'u1', email: 'same@example.com', tags: ['admin', 'staff'] }])
    await expect(
      repository.list({
        index: 'email',
        range: { lower: 'same@example.com', upper: 'z@example.com' },
        direction: 'prev',
        limit: 2
      })
    ).resolves.toEqual([
      { id: 'u3', email: 'z@example.com', tags: ['staff'] },
      { id: 'u2', email: 'same@example.com', tags: ['staff'] }
    ])
  })

  it('proves one mutation lease drains before controller disposal', async () => {
    const { controller, host } = await createReactiveServiceFixture({ id: 'shared-lease' })
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
    await host.dispose()
  })

  it('proves one JSON payload owner has exact UTF-8 and fail-closed structured-clone boundaries', () => {
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
