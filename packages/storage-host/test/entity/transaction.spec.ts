import { entityQueryFeature } from '../../src/entity/query-feature.js'
import { entityUniqueFeature } from '../../src/entity/unique-feature.js'
import { entityMigrationFeature } from '../../src/entity/migration-feature.js'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.js'
import { entityKeysetFeature } from '../../src/entity/keyset.js'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { subscribeToAbort, readAbortReason } from '../../src/authoring/backend.js'
import { walkErrorCauses } from '@migaia/utils/error'
import { readTransactionOperationContext } from '../../src/authoring/transaction.js'
import { createStorageHost } from '../../src/index.js'
import { memoryBackendPlugin } from '../../src/plugins/memory.js'
import { defineEntity } from '../../src/entity.js'
import { memoryBackend } from '../helpers/memory.js'

/** Real unique records share one namespace and one native transaction owner. */
type IUser = { id: string; email: string; score: number }
const users = defineEntity<IUser>()({
  features: [
    entityQueryFeature(),
    entityUniqueFeature(),
    entityMigrationFeature(),
    entityIndexesFeature(),
    entityKeysetFeature()
  ],
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
      const repo = defineEntity<{ id: string }>({
        features: [
          entityQueryFeature(),
          entityUniqueFeature(),
          entityMigrationFeature(),
          entityIndexesFeature(),
          entityKeysetFeature()
        ],
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
      }).connect(store)
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
    const store = await memoryBackend()
    const first = users.connect(store)
    const second = defineEntity<{ id: string; name: string }>({
      features: [
        entityQueryFeature(),
        entityUniqueFeature(),
        entityMigrationFeature(),
        entityIndexesFeature(),
        entityKeysetFeature()
      ],
      name: 'teams',
      key: 'id'
    }).connect(store)
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
    const store = await memoryBackend()
    const repo = users.connect(store)
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
    const repo = defineEntity<{ id: string }>({
      features: [
        entityQueryFeature(),
        entityUniqueFeature(),
        entityMigrationFeature(),
        entityIndexesFeature(),
        entityKeysetFeature()
      ],
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
    }).connect(store)
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
    await using host = await createStorageHost({
      plugins: [memoryBackendPlugin({ id: 'left' }), memoryBackendPlugin({ id: 'right' })]
    })
    const repo = users.connect(host.backend('left'))
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
    const repo = users.connect(await memoryBackend())
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
