import { entityHost } from '../helpers/memory.ts'
import { entityQueryFeature } from '../../src/entity/query-feature.ts'
import { entityUniqueFeature } from '../../src/entity/unique-feature.ts'
import { entityMigrationFeature } from '../../src/entity/migration-feature.ts'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.ts'
import { entityKeysetFeature } from '../../src/entity/keyset.ts'
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { defineEntityPlugin } from '../../src/entity.ts'
import { memoryBackend } from '../helpers/memory.ts'

/** Shared domain keeps each assertion about backend-neutral unique ownership. */
type IUser = { id: string; email: string }

/** Every factory uses the real public backend plus existing complete isolated host ports. */
const factories = [{ name: 'memory', create: memoryBackend }] as const

/** Both independently connected repositories use the same public definition. */
const usersEntityPlugin = defineEntityPlugin<IUser>()('entity-unique-spec-ts-users-1', {
  features: {
    query: entityQueryFeature(),
    unique: entityUniqueFeature(),
    migration: entityMigrationFeature(),
    indexes: entityIndexesFeature(),
    keyset: entityKeysetFeature()
  },
  name: 'unique-users',
  key: 'id',
  indexes: { byEmail: { path: 'email', unique: true } },
  onDiagnostic: () => {}
})

describe('authoritative fallback unique writes', () => {
  it.each(factories.slice(0, 2))(
    '$name classifies a failing unique projection without losing its original error',
    async ({ create }) => {
      /**
       * Projection callbacks are newly exercised by fallback writes and share the extension
       * boundary.
       */
      const original = new Error('unique selector failed')
      /** Use the real backend with an ordinary public throwing selector. */
      const store = await create()
      try {
        /** The definition must remain valid even when evaluating a particular value fails. */

        /** Explicit entity plugin configuration is installed before requesting a repository. */
        const entity2EntityPlugin = defineEntityPlugin<IUser>()('entity-unique-spec-ts-entity2-2', {
          features: {
            query: entityQueryFeature(),
            unique: entityUniqueFeature(),
            migration: entityMigrationFeature(),
            indexes: entityIndexesFeature(),
            keyset: entityKeysetFeature()
          },
          name: 'failed-projection',
          key: 'id',
          onDiagnostic: () => {},
          indexes: {
            byEmail: {
              unique: true,
              revision: 1,
              select: () => {
                throw original
              }
            }
          }
        })
        /** This actual storage host owns the entity installation for this test scope. */
        const entity2EntityPluginHost = await entityHost(entity2EntityPlugin)
        const repo = entity2EntityPluginHost.extensions[entity2EntityPlugin.id](store)
        await expect(repo.put({ id: 'row', email: 'same' })).rejects.toMatchObject({
          source: 'storage.host',
          code: 'EXTENSION_FAILED',
          operation: 'entity.index.project',
          cause: original
        })
        expect(await repo.get('row')).toBeUndefined()
      } finally {
        await store.dispose()
      }
    }
  )

  it.each(factories)(
    '$name rejects another owner, permits self replacement, and frees deleted values',
    async ({ create }) => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      /** The tested store advertises no native secondary index and must keep its ordinary API. */
      const store = await create()
      try {
        /** Distinct repository instances cannot maintain separate uniqueness authorities. */
        const first = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
        /** Reconnect through the actual public definition rather than sharing private state. */
        const second = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
        await first.put({ id: 'a', email: 'same' })
        await expect(second.put({ id: 'b', email: 'same' })).rejects.toMatchObject({
          source: 'storage.host',
          code: 'INDEX_UNIQUE_CONFLICT'
        })
        await expect(first.put({ id: 'a', email: 'same' })).resolves.toBe('a')
        expect(await second.get('b')).toBeUndefined()
        await first.remove('a')
        await expect(second.put({ id: 'b', email: 'same' })).resolves.toBe('b')
      } finally {
        await store.dispose()
      }
    }
  )

  it('checks the final transaction draft, with rollback on duplicate owners', async () => {
    /** This actual storage host owns the entity installation for this test scope. */
    const usersEntityPluginHost = await entityHost(usersEntityPlugin)

    /** Memory's real transaction performs rollback and revision checks. */
    const store = await memoryBackend()
    /** A public repository batch may temporarily draft a duplicate before removing its old owner. */
    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
    try {
      await repo.put({ id: 'a', email: 'same' })
      await expect(
        repo.batch(async (tx) => {
          await tx.put({ id: 'b', email: 'new' })
          await tx.put({ id: 'c', email: 'new' })
        })
      ).rejects.toMatchObject({ code: 'INDEX_UNIQUE_CONFLICT' })
      expect(await repo.get('b')).toBeUndefined()
      expect(await repo.get('c')).toBeUndefined()
      await repo.batch(async (tx) => {
        await tx.put({ id: 'b', email: 'same' })
        await tx.remove('a')
      })
      expect(await repo.findBy('byEmail', 'same')).toEqual({ id: 'b', email: 'same' })
    } finally {
      await store.dispose()
    }
  })

  it('uses the record transaction to reject a concurrent phantom owner', async () => {
    /** This actual storage host owns the entity installation for this test scope. */
    const usersEntityPluginHost = await entityHost(usersEntityPlugin)

    /** Hold two genuine public transactions after their callbacks, before the existing commit. */
    const store = await memoryBackend()
    /** Preserve the normal implementation and all of its revision/rollback semantics. */
    const transaction = store.transaction
    /** Release both transactions only after both complete their uniqueness read sets. */
    let release!: () => void
    /** Synchronizes the supported public transaction callbacks without private state changes. */
    const ready = new Promise<void>((resolve) => {
      release = resolve
    })
    /** Counts completed public callbacks, rather than mocking commit results. */
    let callbacks = 0
    store.transaction = (run, ctx) =>
      transaction(async (tx) => {
        /** The callback has drafted its complete candidate write and validation. */
        const result = await run(tx)
        callbacks += 1
        if (callbacks === 2) release()
        await ready
        return result
      }, ctx)
    try {
      /** Two different owners compete through independent public repository instances. */
      const results = await Promise.allSettled([
        usersEntityPluginHost.extensions[usersEntityPlugin.id](store).put({
          id: 'a',
          email: 'same'
        }),
        usersEntityPluginHost.extensions[usersEntityPlugin.id](store).put({
          id: 'b',
          email: 'same'
        })
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({
        reason: { source: 'storage.contract', code: 'WRITE_CONFLICT' }
      })
    } finally {
      release()
      await store.dispose()
    }
  })

  it('rejects a migration collision without invoking each written migration twice', async () => {
    /** Normal v1 writes predate the new unique declaration. */
    const store = await memoryBackend()
    /** Count user migration work independently of schema and projection reads. */
    let migrations = 0
    try {
      /** Seed valid historical values through the public repository. */

      /** Explicit entity plugin configuration is installed before requesting a repository. */
      const entity3EntityPlugin = defineEntityPlugin<IUser>()('entity-unique-spec-ts-entity3-3', {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'migration-unique',
        key: 'id'
      })
      /** This actual storage host owns the entity installation for this test scope. */
      const entity3EntityPluginHost = await entityHost(entity3EntityPlugin)
      const old = entity3EntityPluginHost.extensions[entity3EntityPlugin.id](store)
      await old.put({ id: 'a', email: 'same' })
      await old.put({ id: 'b', email: 'SAME' })
      /** The migration would create two owners of one normalized index value. */

      /** Explicit entity plugin configuration is installed before requesting a repository. */
      const entity4EntityPlugin = defineEntityPlugin<IUser>()('entity-unique-spec-ts-entity4-4', {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'migration-unique',
        key: 'id',
        version: 2,
        migrations: {
          2: async (value) => {
            migrations += 1
            return { ...(value as IUser), email: (value as IUser).email.toLowerCase() }
          }
        },
        indexes: { byEmail: { path: 'email', unique: true } },
        onDiagnostic: () => {}
      })
      /** This actual storage host owns the entity installation for this test scope. */
      const entity4EntityPluginHost = await entityHost(entity4EntityPlugin)
      const upgraded = entity4EntityPluginHost.extensions[entity4EntityPlugin.id](store)
      await expect(upgraded.migrate({ batchSize: 2 })).rejects.toMatchObject({
        code: 'INDEX_UNIQUE_CONFLICT'
      })
      expect(migrations).toBe(2)
      expect(await old.get('b')).toEqual({ id: 'b', email: 'SAME' })
    } finally {
      await store.dispose()
    }
  })
})
