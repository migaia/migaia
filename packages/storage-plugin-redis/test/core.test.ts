import { afterAll, describe, expect, it, vi } from 'vitest'
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { counter, kv, records, ttl } from '@migaia/storage-contract'
import { redisBackendPlugin } from '../src/index.js'
import { nodeRedisDriver } from '../src/adapters/node-redis.js'

/** Native fixtures own their clients and a unique namespace; no unrelated key is modified. */
for (const url of [process.env.MIGAIA_REDIS_URL, process.env.MIGAIA_VALKEY_URL]) {
  describe.skipIf(!url)('native core', () => {
    const pool = createClientPool({ url }, { maximum: 8 }),
      driver = nodeRedisDriver(pool)
    afterAll(async () => {
      if (pool.isOpen) await pool.close()
    })
    it('preserves channels, drafts, native TTL, counters, ordered prefixes and callback failure', async () => {
      await pool.connect()
      const host = await createStorageHost({
          plugins: [redisBackendPlugin({ driver, prefix: crypto.randomUUID() })] as const
        }),
        store = host.backend('redis')
      try {
        await store.set('text', '\0\ud800')
        expect(await store.get('text')).toBe('\0\ud800')
        await store.setBytes('bytes', new Uint8Array([255, 0, 128]))
        expect(await store.getBytes('bytes')).toEqual(new Uint8Array([255, 0, 128]))
        await store.putRecord({ value: 3 }, ['record', 1])
        expect(await store.getRecord(['record', 1])).toEqual({ value: 3 })
        await store.use(kv).setMany([
          { key: 'group:a', value: '1' },
          { key: 'group:b', value: '2' }
        ])
        expect(await store.use(kv).getMany(['group:a', 'missing', 'group:a'])).toEqual([
          '1',
          undefined,
          '1'
        ])
        expect(await store.use(kv).removeByPrefix('group:')).toBe(2)
        expect(await store.use(counter).increment('counter')).toBe(1)
        await store.use(ttl).expire({ channel: 'text', key: 'counter' }, 10000)
        await store.set('counter', '2')
        expect(await store.use(ttl).remaining({ channel: 'text', key: 'counter' })).toBeGreaterThan(
          0
        )
        expect(await store.use(ttl).persist({ channel: 'text', key: 'counter' })).toBe(true)
        expect(await store.use(ttl).remaining({ channel: 'text', key: 'counter' })).toBeUndefined()
        await store.transaction(async (scope) => {
          await scope.set('tx', 'committed')
          await scope.putRecord({ value: 4 }, ['record', 2])
          expect(await scope.get('tx')).toBe('committed')
          await scope.putRecord({ group: 'draft', rank: 2 }, ['new', 2])
          await scope.putRecord({ group: 'draft', rank: 1 }, ['new', 1])
          expect(
            await scope.use(records).query<{ group: string }>().where({ group: 'draft' }).count()
          ).toBe(2)
          expect(
            await scope.use(records).query<{ group: string }>().where({ group: 'draft' }).delete()
          ).toBe(2)
          await scope.set('draft:a', 'one')
          await scope.set('draft:b', 'two')
          expect(await scope.removeByPrefix('draft:')).toBe(2)
          expect(await scope.get('draft:a')).toBeNull()
        })
        expect(await store.get('tx')).toBe('committed')
        const failure = new RangeError('fixture callback')
        await expect(
          store.transaction(async (scope) => {
            await scope.set('rolled-back', 'value')
            throw failure
          })
        ).rejects.toBe(failure)
        expect(Reflect.get(failure, 'code')).toBe('TRANSACTION_FAILED')
        expect(await store.get('rolled-back')).toBeNull()
        expect(await store.use(records).query<{ value: number }>().count()).toBe(2)
        const orgId = crypto.randomUUID(),
          peer = host.org(orgId).backend('redis')
        await peer.set('text', 'other organization')
        await peer.putRecord({ value: 9 }, ['record', 1])
        expect(await store.get('text')).toBe('\0\ud800')
        expect(await peer.get('text')).toBe('other organization')
        expect(await peer.getRecord(['record', 1])).toEqual({ value: 9 })
        await peer.clearAll()
        expect(await peer.get('text')).toBeNull()
        expect(await store.get('text')).toBe('\0\ud800')
        const rejection = new RangeError('fixture late listener'),
          diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const off = store.subscribeChanges(async () => {
          await Promise.resolve()
          throw rejection
        })
        try {
          await store.set('observed', 'committed')
          await new Promise<void>((resolve) => setImmediate(resolve))
          expect(await store.get('observed')).toBe('committed')
          expect(diagnostic.mock.calls.filter((args) => args.includes(rejection))).toHaveLength(1)
        } finally {
          off()
          diagnostic.mockRestore()
        }
      } finally {
        await store.clearAll()
        await host.dispose()
      }
      expect(await pool.execute((client) => client.ping())).toBe('PONG')
    })
  })
}
