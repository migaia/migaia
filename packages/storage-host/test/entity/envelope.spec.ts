import { entityHost } from '../helpers/memory.ts'
import { storageProbe } from '../../src/plugins/probe/index.ts'
import { entityQueryFeature } from '../../src/entity/query-feature.ts'
import { entityUniqueFeature } from '../../src/entity/unique-feature.ts'
import { entityMigrationFeature } from '../../src/entity/migration-feature.ts'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.ts'
import { entityKeysetFeature } from '../../src/entity/keyset.ts'
import { describe, expect, it } from 'vitest'
import type { IKeyValueStore } from '@migaia/storage-contract'
import {
  createStorageHost,
  definePlugin,
  defineFeature,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '../../src/index.ts'
import { defineEntityPlugin } from '../../src/entity.ts'
import { composeFlatKey } from '../../src/entity/key.ts'

/**
 * A frozen raw provider proves envelope hooks do not depend on a change controller or provider
 * patch.
 */
function rawPlugin(shared?: IKeyValueStore, marked = false, synchronous = false) {
  /** The original resource is acquired only in the actual install hook. */
  let store!: IKeyValueStore
  /** Open kind identity carries the raw native shape without a capability installer. */
  const kind = defineStorageBackendKind()('raw-entity')
  /** Named descriptors retain native store inference through the authoring boundary. */
  const descriptor = (core: IStoragePluginCore) => ({
    kind,
    featureExpose: () => ({ getClient: () => undefined }),
    install() {
      if (shared !== undefined) {
        store = shared
        core.registerStore(store)
        return {}
      }
      /** This native map belongs to one resource instance and clears only on its cleanup. */
      const values = new Map<string, string>()
      /** Both explicit cleanup entries borrow one idempotent native action. */
      const dispose = async () => {
        values.clear()
      }
      const native = {
        backend: 'raw-entity',
        capabilities: {
          syncRead: synchronous,
          binary: false,
          records: false,
          transactions: false,
          iteration: false,
          secondaryIndexes: false,
          changeFeed: false,
          opaqueEntries: false,
          maxValueBytes: undefined
        },
        sync: synchronous
          ? {
              get: (key: string) => values.get(key) ?? null,
              set: (key: string, value: string) => {
                values.set(key, value)
              },
              remove: (key: string) => {
                values.delete(key)
              },
              has: (key: string) => values.has(key),
              keys: () => [...values.keys()],
              clearValues: () => {
                values.clear()
              }
            }
          : undefined,
        get: async (key: string) => values.get(key) ?? null,
        set: async (key: string, value: string) => {
          values.set(key, value)
        },
        remove: async (key: string) => {
          values.delete(key)
        },
        has: async (key: string) => values.has(key),
        keys: async () => [...values.keys()],
        clearValues: dispose,
        clearAll: dispose,
        dispose,
        [Symbol.asyncDispose]: dispose
      }
      store = marked ? native : Object.freeze(native)
      core.registerStore(store)
      return {}
    }
  })
  if (marked) {
    const marker = defineFeature(kind, () => ({
      capabilities: [],
      api: { store: {}, transaction: {} },
      chain: {
        query: {
          mark<T>(this: T): T {
            return this
          }
        }
      }
    }))
    const factory = (core: IStoragePluginCore) => descriptor(core)
    return {
      plugin: definePlugin<'raw', typeof factory, { marker: typeof marker }>('raw', factory, {
        marker
      }),
      getStore: () => store
    }
  }
  return { plugin: definePlugin('raw', descriptor), getStore: () => store }
}

describe('entity envelopes through the shared plan owner', () => {
  it.each([false, true])(
    'rejects only unique writes on a raw backend lacking an atomic commit port before modification, sync=%s',
    async (synchronous) => {
      const fixture = rawPlugin(undefined, false, synchronous)
      await using host = await createStorageHost({ plugins: [fixture.plugin] })
      const store = fixture.getStore()

      /** Explicit entity plugin configuration is installed before requesting a repository. */
      const entity1EntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
        'entity-envelope-spec-ts-entity1-1',
        {
          features: {
            query: entityQueryFeature(),
            unique: entityUniqueFeature(),
            migration: entityMigrationFeature(),
            indexes: entityIndexesFeature(),
            keyset: entityKeysetFeature()
          },
          name: 'plain-raw',
          key: 'id'
        }
      )
      /** This actual storage host owns the entity installation for this test scope. */
      const entity1EntityPluginHost = await entityHost(entity1EntityPlugin)
      const plain = entity1EntityPluginHost.extensions[entity1EntityPlugin.id](store)
      await plain.put({ id: 'existing', email: 'one' })
      const before = await store.keys()
      let validations = 0

      /** Explicit entity plugin configuration is installed before requesting a repository. */
      const entity2EntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
        'entity-envelope-spec-ts-entity2-2',
        {
          features: {
            query: entityQueryFeature(),
            unique: entityUniqueFeature(),
            migration: entityMigrationFeature(),
            indexes: entityIndexesFeature(),
            keyset: entityKeysetFeature()
          },
          name: 'unique-raw',
          key: 'id',
          indexes: { email: { path: 'email', unique: true } },
          schema: {
            name: 'counted',
            async validate(value) {
              validations++
              return value as { id: string; email: string }
            }
          }
        }
      )
      /** This actual storage host owns the entity installation for this test scope. */
      const entity2EntityPluginHost = await entityHost(entity2EntityPlugin)
      const unique = entity2EntityPluginHost.extensions[entity2EntityPlugin.id](store)
      await expect(unique.put({ id: 'new', email: 'one' })).rejects.toMatchObject({
        source: 'storage.contract',
        code: 'UNSUPPORTED_CAPABILITY'
      })
      await expect(unique.migrate()).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
      expect(validations).toBe(0)
      expect(await store.keys()).toEqual(before)
      expect(await plain.get('existing')).toEqual({ id: 'existing', email: 'one' })
      expect(host.backend('raw')).toBe(store)
    }
  )

  it('rejects ambiguous query methods when one host sharing the same raw store has no selected methods', async () => {
    const firstRaw = rawPlugin(undefined, true)
    const first = await createStorageHost({ plugins: [firstRaw.plugin] })

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity3EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-envelope-spec-ts-entity3-3',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'shared-query',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity3EntityPluginHost = await entityHost(entity3EntityPlugin)
    const repo = entity3EntityPluginHost.extensions[entity3EntityPlugin.id](firstRaw.getStore())
    expect(repo.query()).toHaveProperty('mark')
    await using second = await createStorageHost({
      plugins: [rawPlugin(firstRaw.getStore()).plugin]
    })
    expect(() => repo.query()).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
    expect(second.backend('raw')).toBe(firstRaw.getStore())
    await first.dispose()
    expect(repo.query()).not.toHaveProperty('mark')
  })

  it('routes actual entity checks to each still-registered host sharing the same raw object', async () => {
    const firstRaw = rawPlugin()
    const seen: string[] = []
    const first = await createStorageHost({
      plugins: [
        storageProbe({
          beforeEnvelopeCheck: () => {
            seen.push('first')
          }
        }),
        firstRaw.plugin
      ]
    })
    const store = firstRaw.getStore()
    const secondRaw = rawPlugin(store)
    await using second = await createStorageHost({
      plugins: [
        storageProbe({
          beforeEnvelopeCheck: () => {
            seen.push('second')
          }
        }),
        secondRaw.plugin
      ]
    })
    expect(second.backend('raw')).toBe(store)

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity4EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-envelope-spec-ts-entity4-4',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'shared',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity4EntityPluginHost = await entityHost(entity4EntityPlugin)
    const repo = entity4EntityPluginHost.extensions[entity4EntityPlugin.id](store)
    await repo.put({ id: 'a' })
    expect(await repo.get('a')).toEqual({ id: 'a' })
    expect(seen).toEqual(['first', 'second'])
    await first.dispose()
    await repo.put({ id: 'b' })
    expect(await repo.get('b')).toEqual({ id: 'b' })
    expect(seen).toEqual(['first', 'second', 'second'])
  })

  it('observes actual recovery on a raw provider without a change controller', async () => {
    /** Hooks record the original plan's actual step order, not a second migration loop. */
    const order: string[] = []
    const raw = rawPlugin()
    await using host = await createStorageHost({
      plugins: [
        storageProbe({
          beforeEnvelopeCheck: () => {
            order.push('check')
          },
          afterEnvelopeCheck: () => {
            order.push('checked')
          },
          beforeMigrationStep: () => {
            order.push('step')
          },
          afterMigrationStep: () => {
            order.push('stepped')
          },
          afterMigrate: (event) => {
            expect(event.stepCount).toBe(1)
            order.push('migrated')
          }
        }),
        raw.plugin
      ]
    })
    const store = raw.getStore()
    expect(host.backend('raw')).toBe(store)
    await store.set(
      composeFlatKey('archives', 'a'),
      JSON.stringify({ version: 1, state: { id: 'a', count: 1 } })
    )

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity5EntityPlugin = defineEntityPlugin<{ id: string; count: number }>()(
      'entity-envelope-spec-ts-entity5-5',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'archives',
        key: 'id',
        version: 2,
        migrations: { 2: (value) => ({ ...(value as { id: string }), count: 2 }) }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity5EntityPluginHost = await entityHost(entity5EntityPlugin)
    const repo = entity5EntityPluginHost.extensions[entity5EntityPlugin.id](store)
    expect(await repo.get('a')).toEqual({ id: 'a', count: 2 })
    expect(order).toEqual(['check', 'checked', 'step', 'stepped', 'migrated'])
    await repo.put({ id: 'b', count: 3 })
    expect(JSON.parse((await store.get(composeFlatKey('archives', 'b')))!)).toEqual({
      version: 2,
      state: { id: 'b', count: 3 }
    })
  })

  it('preserves host error codes with the original contract error as first cause', async () => {
    const raw = rawPlugin()
    await using host = await createStorageHost({ plugins: [raw.plugin] })
    const store = raw.getStore()
    expect(host.backend('raw')).toBe(store)

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity6EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-envelope-spec-ts-entity6-6',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'invalid',
        key: 'id',
        version: 2
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity6EntityPluginHost = await entityHost(entity6EntityPlugin)
    const repo = entity6EntityPluginHost.extensions[entity6EntityPlugin.id](store)
    await store.set(
      composeFlatKey('invalid', 'old'),
      JSON.stringify({ __v: 2, data: { id: 'old' } })
    )
    await expect(repo.get('old')).rejects.toMatchObject({
      source: 'storage.host',
      code: 'DESERIALIZE_FAILED',
      cause: { source: 'storage.contract', code: 'ENVELOPE_INVALID' }
    })
    await store.set(
      composeFlatKey('invalid', 'future'),
      JSON.stringify({ version: 3, state: { id: 'future' } })
    )
    await expect(repo.get('future')).rejects.toMatchObject({
      source: 'storage.host',
      code: 'VERSION_UNSUPPORTED',
      cause: { source: 'storage.contract', code: 'VERSION_UNSUPPORTED' }
    })

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity7EntityPlugin = defineEntityPlugin<{ id: string }, null>()(
      'entity-envelope-spec-ts-entity7-7',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'null-state',
        key: 'id',
        schema: {
          name: 'null-state',
          validate: async (value) => value as { id: string },
          encode: async () => null
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity7EntityPluginHost = await entityHost(entity7EntityPlugin)
    const invalidWrite = entity7EntityPluginHost.extensions[entity7EntityPlugin.id](store)
    await expect(invalidWrite.put({ id: 'a' })).rejects.toMatchObject({
      source: 'storage.host',
      code: 'SERIALIZE_FAILED',
      cause: { source: 'storage.contract', code: 'ENVELOPE_INVALID' }
    })
    expect(await store.get(composeFlatKey('null-state', 'a'))).toBeNull()
  })

  it('retains the actual migration failure and its stage through the shared executor', async () => {
    const raw = rawPlugin()
    await using host = await createStorageHost({ plugins: [raw.plugin] })
    const store = raw.getStore()
    expect(host.backend('raw')).toBe(store)
    const original = new Error('actual migration failure')

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity8EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-envelope-spec-ts-entity8-8',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'broken',
        key: 'id',
        version: 2,
        migrations: {
          2: () => {
            throw original
          }
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity8EntityPluginHost = await entityHost(entity8EntityPlugin)
    const repo = entity8EntityPluginHost.extensions[entity8EntityPlugin.id](store)
    await store.set(
      composeFlatKey('broken', 'a'),
      JSON.stringify({ version: 1, state: { id: 'a' } })
    )
    await expect(repo.get('a')).rejects.toMatchObject({
      code: 'MIGRATION_FAILED',
      stage: 'migrate',
      cause: { source: 'storage.contract', code: 'MIGRATION_FAILED', cause: original }
    })
  })
})
