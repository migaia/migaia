import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import {
  ttl,
  counter,
  kv,
  lockKey,
  ConcurrencyPolicy,
  type ITransactionTtlApi
} from '@migaia/storage-contract'
import { createStorageHost, memoryBackendPlugin, definePlugin } from '../../src/index.js'

/** Real native memory capabilities share their original host, clock and transaction owner. */
describe('memory TTL and counter capabilities', () => {
  it('expires the same physical rows through sync, async, scans and cross-channel replacement', async () => {
    /** One injected monotonic clock proves every native read observes the same deadline. */
    const scheduler = createManualScheduler()
    await using host = await createStorageHost({ scheduler, plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const deadlines = store.use(ttl)
    expect(store.has(ttl)).toBe(true)
    expect(store.has(counter)).toBe(true)
    expect(await deadlines.expire(lockKey.vector('collection', 'point'), 10)).toBe(false)
    await store.set('text', 'first')
    await store.setBytes('bytes', new Uint8Array([1]))
    await store.putRecord(undefined, ['record', 1])
    expect(await deadlines.expire(lockKey.text('text'), 10)).toBe(true)
    expect(await deadlines.expire(lockKey.bytes('bytes'), 10)).toBe(true)
    expect(await deadlines.expire(lockKey.record(['record', 1]), 10)).toBe(true)
    scheduler.advance(4)
    store.sync.set('text', 'second')
    expect(await deadlines.remaining(lockKey.text('text'))).toBe(6)
    scheduler.advance(6)
    expect(store.sync.get('text')).toBeNull()
    expect(await store.getBytes('bytes')).toBeNull()
    /** Consume the actual registered native iterator through its public protocol. */
    const rows: unknown[] = []
    for await (const row of store.iterateRecords()) rows.push(row)
    expect(rows).toEqual([])
    expect(store.sync.keys()).toEqual([])
    expect(await store.keys()).toEqual([])
    expect(await deadlines.expire(lockKey.record(['record', 1]), 10)).toBe(false)
    await store.putRecord({ alive: true }, 'text')
    expect(await deadlines.remaining(lockKey.record('text'))).toBeUndefined()
    expect(await deadlines.persist(lockKey.record('text'))).toBe(false)
    expect(await deadlines.expire(lockKey.record('text'), 5)).toBe(true)
    await store.set('text', 'replacement', { conflictPolicy: 'replace' })
    scheduler.advance(5)
    expect(await store.get('text')).toBe('replacement')
    expect(await deadlines.remaining(lockKey.text('text'))).toBeUndefined()
    expect(await deadlines.expire(lockKey.text('text'), 0)).toBe(true)
    expect(await store.get('text')).toBeNull()
    expect(await deadlines.persist(lockKey.text('text'))).toBe(false)
    await store.use(kv).setMany([{ key: ['typed', 1], value: 'typed', ttlMs: 2 }])
    expect(await deadlines.remaining(lockKey.text(['typed', 1]))).toBe(2)
    scheduler.advance(2)
    expect(
      await store.use(kv).getMany([
        ['typed', 1],
        ['typed', 1]
      ])
    ).toEqual([undefined, undefined])
    /** Expiry of one selected radix leaf cannot truncate later live transaction rows. */
    await store.putRecord({ id: 'expired' }, 'a')
    await store.putRecord({ id: 'alive' }, 'z')
    await deadlines.expire(lockKey.record('a'), 1)
    scheduler.advance(1)
    await store.transaction(async (scope) => {
      const rows: unknown[] = []
      for await (const row of scope.iterateRecords()) rows.push(row)
      expect(rows).toEqual([['z', { id: 'alive' }]])
    })
    await expect(
      store.use(kv).setMany([
        { key: 'untouched', value: 'first', ttlMs: 1 },
        { key: 'invalid', value: 'second', ttlMs: NaN }
      ])
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(await store.get('untouched')).toBeNull()
  })

  it('retains the first transaction value and rejects commit when its observed deadline expires', async () => {
    const scheduler = createManualScheduler()
    await using host = await createStorageHost({ scheduler, plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    await store.set('observed', 'old')
    await store.use(ttl).expire(lockKey.text('observed'), 5)
    await expect(
      store.transaction(
        async (scope) => {
          expect(await scope.get('observed')).toBe('old')
          scheduler.advance(5)
          expect(await scope.get('observed')).toBe('old')
          expect(await scope.use(ttl).remaining(lockKey.text('observed'))).toBe(0)
          await scope.set('rollback', 'never')
        },
        { concurrency: ConcurrencyPolicy.optimistic({ retries: 0 }) }
      )
    ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    expect(await store.get('observed')).toBeNull()
    expect(await store.get('rollback')).toBeNull()
    /** A saved projection never regains authority after its authentic view expires. */
    let saved: ITransactionTtlApi | undefined
    await store.transaction(async (scope) => {
      await scope.set('persisted', 'alive')
      saved = scope.use(ttl)
      expect(await saved.expire(lockKey.text('persisted'), 5)).toBe(true)
      expect(await saved.persist(lockKey.text('persisted'))).toBe(true)
      expect(await saved.persist(lockKey.text('persisted'))).toBe(false)
      expect(await saved.remaining(lockKey.text('persisted'))).toBeUndefined()
      await scope.setMany([{ key: 'immediate', value: 'absent', ttlMs: 0 }])
    })
    scheduler.advance(10)
    expect(await store.get('persisted')).toBe('alive')
    expect(await store.get('immediate')).toBeNull()
    await expect(saved!.remaining(lockKey.text('persisted'))).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED'
    })
  })

  it('increments atomically in the original root turn and uses only the current transaction draft', async () => {
    /** The existing pipeline records native endpoints without replacing their implementation. */
    const operations: string[] = []
    const observe = definePlugin('observe', (core) => ({
      install: () => {
        core.usePipeline((input, next) => {
          operations.push(input.operation)
          return next(input)
        })
        return {}
      }
    }))
    const scheduler = createManualScheduler()
    await using host = await createStorageHost({
      scheduler,
      plugins: [memoryBackendPlugin(), observe]
    })
    const store = host.backend('memory')
    expect(
      await Promise.all(Array.from({ length: 100 }, () => store.use(counter).increment('visits')))
    ).toEqual(Array.from({ length: 100 }, (_, index) => index + 1))
    expect(await store.get('visits')).toBe('100')
    await store.use(ttl).expire(lockKey.text('visits'), 10)
    expect(await store.use(counter).increment('visits', -1)).toBe(99)
    expect(await store.use(ttl).remaining(lockKey.text('visits'))).toBe(10)
    await store.set('malformed', '01')
    await expect(store.use(counter).increment('malformed')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(await store.get('malformed')).toBe('01')
    await store.set('overflow', String(Number.MAX_SAFE_INTEGER))
    await expect(store.use(counter).increment('overflow')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(await store.get('overflow')).toBe(String(Number.MAX_SAFE_INTEGER))
    operations.length = 0
    await store.transaction(async (scope) => {
      expect(await scope.use(counter).increment('draft', 2)).toBe(2)
      expect(await scope.get('draft')).toBe('2')
      expect(await scope.use(ttl).expire(lockKey.text('draft'), 4)).toBe(true)
      expect(await scope.use(counter).increment('draft', 3)).toBe(5)
    })
    expect(operations).toEqual([
      'transaction',
      'counter.increment',
      'get',
      'ttl.expire',
      'counter.increment'
    ])
    scheduler.advance(4)
    expect(await store.get('draft')).toBeNull()
    await expect(
      store.transaction(async (scope) => {
        await scope.use(counter).increment('rolled-back')
        await scope.use(counter).increment('malformed')
      })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(await store.get('rolled-back')).toBeNull()
  })
})
