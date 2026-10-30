import { entityHost } from '../helpers/memory.ts'
import { entityQueryFeature } from '../../src/entity/query-feature.ts'
import { entityUniqueFeature } from '../../src/entity/unique-feature.ts'
import { entityMigrationFeature } from '../../src/entity/migration-feature.ts'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.ts'
import { entityKeysetFeature } from '../../src/entity/keyset.ts'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { subscribeToAbort, readAbortReason } from '../../src/authoring/backend.ts'
import { walkErrorCauses } from '@migaia/utils/error'
import { readTransactionOperationContext } from '../../src/authoring/transaction.ts'
import { createStorageHost } from '../../src/index.ts'
import { memoryBackendPlugin } from '../../src/plugins/memory.ts'
import { defineEntityPlugin } from '../../src/entity.ts'
import { memoryBackend } from '../helpers/memory.ts'

/** Real unique records share one namespace and one native transaction owner. */
type IUser = { id: string; email: string; score: number }
const usersEntityPlugin = defineEntityPlugin<IUser>()('entity-transaction-spec-ts-users-1', {
  features: {
    query: entityQueryFeature(),
    unique: entityUniqueFeature(),
    migration: entityMigrationFeature(),
    indexes: entityIndexesFeature(),
    keyset: entityKeysetFeature()
  },
  name: 'users',
  key: 'id',
  indexes: { email: { path: 'email', unique: true } },
  onDiagnostic: () => {}
})

describe('entity composition through original transaction views', () => {
  it.each([false, true])(
    'forwards the original transaction signal through asynchronous entity extensions: %s',
    async (bound) => {
      await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
      const store = host.backend('memory')
      /** The caller owns cancellation; the backend's existing budget supplies the borrowed signal. */
      const controller = new AbortController()
      const entered = deferred<void>()
      const reason = new Error('cancel entity preparation')
      const report = vi.fn()
      let expected: unknown
      let observed: unknown

      /** Explicit entity plugin configuration is installed before requesting a repository. */
      const entity2EntityPlugin = defineEntityPlugin<{ id: string }>()(
        'entity-transaction-spec-ts-entity2-2',
        {
          features: {
            query: entityQueryFeature(),
            unique: entityUniqueFeature(),
            migration: entityMigrationFeature(),
            indexes: entityIndexesFeature(),
            keyset: entityKeysetFeature()
          },
          name: 'cancel-preparation',
          key: 'id',
          schema: {
            name: 'cooperative',
            async validate(value, context) {
              observed = context?.signal
              /** A cooperative extension settles only when the actual transaction budget cancels. */
              const cancelled = deferred<void>()
              const off = subscribeToAbort(context?.signal, () => cancelled.resolve(), report)
              entered.resolve()
              await cancelled.promise
              off()
              throw readAbortReason(context?.signal)
            }
          }
        }
      )
      /** This actual storage host owns the entity installation for this test scope. */
      const entity2EntityPluginHost = await entityHost(entity2EntityPlugin)
      const repo = entity2EntityPluginHost.extensions[entity2EntityPlugin.id](store)
      const pending = bound
        ? store.transaction(
            (scope) => {
              expected = readTransactionOperationContext(scope)?.signal
              return repo.in(scope).put({ id: 'a' })
            },
            { signal: controller.signal }
          )
        : repo.put({ id: 'a' }, { signal: controller.signal })
      await entered.promise
      expect(observed).toBeDefined()
      if (bound) expect(observed).toBe(expected)
      controller.abort(reason)
      const failure = await pending.catch((cause) => cause)
      expect(failure).toMatchObject({ code: 'ABORTED' })
      expect(walkErrorCauses(failure)).toContain(reason)
      expect(await store.getRecord(repo.lockKey('a').key)).toBeUndefined()
      expect(report).not.toHaveBeenCalled()
    }
  )

  it('composes repositories with all native channels and reads actual draft cursors', async () => {
    /** This actual storage host owns the entity installation for this test scope. */
    const usersEntityPluginHost = await entityHost(usersEntityPlugin)

    const store = await memoryBackend()
    const first = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity3EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'entity-transaction-spec-ts-entity3-3',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'teams',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity3EntityPluginHost = await entityHost(entity3EntityPlugin)
    const second = entity3EntityPluginHost.extensions[entity3EntityPlugin.id](store)
    await store
      .tx()
      .lock(first.lockKey('a'))
      .run(async (scope) => {
        await first.in(scope).put({ id: 'a', email: 'one', score: 1 })
        await second.in(scope).put({ id: 'a', name: 'team' })
        await scope.set('status', 'ready')
        await scope.setBytes('receipt', new Uint8Array([1]))
        expect(await first.in(scope).list()).toEqual([{ id: 'a', email: 'one', score: 1 }])
        expect(await second.in(scope).get('a')).toEqual({ id: 'a', name: 'team' })
      })
    expect(await first.get('a')).toEqual({ id: 'a', email: 'one', score: 1 })
    expect(await store.get('status')).toBe('ready')
    expect(await store.getBytes('receipt')).toEqual(new Uint8Array([1]))
  })

  it('checks one final unique state across repeated bindings and permits swaps', async () => {
    /** This actual storage host owns the entity installation for this test scope. */
    const usersEntityPluginHost = await entityHost(usersEntityPlugin)

    const store = await memoryBackend()
    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
    await repo.put({ id: 'a', email: 'one', score: 1 })
    await repo.put({ id: 'b', email: 'two', score: 2 })
    await store.transaction(async (scope) => {
      await repo.in(scope).put({ id: 'a', email: 'two', score: 3 })
      await repo.in(scope).put({ id: 'b', email: 'one', score: 4 })
      expect(
        await repo.in(scope).list({ orderBy: (left, right) => right.score - left.score, limit: 1 })
      ).toEqual([{ id: 'b', email: 'one', score: 4 }])
    })
    expect(await repo.findBy('email', 'one')).toEqual({ id: 'b', email: 'one', score: 4 })
    await expect(
      repo.batch(async (scope) => {
        await scope.put({ id: 'c', email: 'new', score: 5 })
        await scope.put({ id: 'd', email: 'new', score: 6 })
      })
    ).rejects.toMatchObject({ code: 'INDEX_UNIQUE_CONFLICT' })
    expect(await repo.get('c')).toBeUndefined()
    expect(await repo.get('d')).toBeUndefined()
  })

  it('admits whole asynchronous schema operations before callback completion', async () => {
    const store = await memoryBackend()
    const entered = deferred<void>()
    const ready = deferred<void>()

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity4EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-transaction-spec-ts-entity4-4',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'delayed',
        key: 'id',
        schema: {
          name: 'delayed',
          async validate(value) {
            entered.resolve()
            await ready.promise
            return value as { id: string }
          }
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity4EntityPluginHost = await entityHost(entity4EntityPlugin)
    const repo = entity4EntityPluginHost.extensions[entity4EntityPlugin.id](store)
    let accepted: Promise<unknown> | undefined
    const pending = store.transaction((scope) => {
      accepted = repo.in(scope).put({ id: 'later' })
    })
    await entered.promise
    ready.resolve()
    await Promise.all([pending, accepted])
    expect(await repo.get('later')).toEqual({ id: 'later' })
  })

  it('rejects foreign binding synchronously and preserves expired bound data errors', async () => {
    /** This actual storage host owns the entity installation for this test scope. */
    const usersEntityPluginHost = await entityHost(usersEntityPlugin)

    await using host = await createStorageHost({
      plugins: [memoryBackendPlugin({ id: 'left' }), memoryBackendPlugin({ id: 'right' })]
    })
    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](host.backend('left'))
    await host.backend('right').transaction((scope) => {
      expect(() => repo.in(scope)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    })
    let bound!: ReturnType<typeof repo.in>
    await host.backend('left').transaction((scope) => {
      bound = repo.in(scope)
    })
    await expect(bound.get('none')).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  })

  it('uses one real iterator resource for bounded domain ordering and explicit disposal', async () => {
    /** This actual storage host owns the entity installation for this test scope. */
    const usersEntityPluginHost = await entityHost(usersEntityPlugin)

    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await memoryBackend())
    for (const [id, score] of [
      ['a', 3],
      ['b', 1],
      ['c', 2]
    ] as const)
      await repo.put({ id, email: id, score })
    const iterator = repo.stream({ orderBy: (left, right) => left.score - right.score, limit: 2 })
    expect((await iterator.next()).value).toEqual({ id: 'b', email: 'b', score: 1 })
    const closing = iterator.dispose()
    expect(iterator.dispose()).toBe(closing)
    const symbolic = iterator[Symbol.asyncDispose]()
    expect(symbolic).not.toBe(closing)
    await Promise.all([closing, symbolic])
    expect(await iterator.next()).toMatchObject({ done: true })
  })
})
