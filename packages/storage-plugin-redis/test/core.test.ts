import { afterAll, describe, expect, it, vi } from 'vitest'
import { createClientPool } from 'redis'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { counter, kv, records, ttl } from '@migaia/storage-contract'
import { redisBackendPlugin } from '../src/index.ts'
import { nodeRedisDriver } from '../src/adapters/node-redis.ts'

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
      /** Original native command and EXEC payload observations exclude a local value fallback. */
      const commands: string[] = [],
        queued: string[] = []
      /** Observe the actual batch before the genuine adapter executes it. */
      const observed: typeof driver = {
        ...driver,
        withConnection: (run) =>
          driver.withConnection((connection) =>
            run({
              ...connection,
              exec(batch) {
                queued.push(...batch.map((command) => String(command[0])))
                return connection.exec(batch)
              }
            })
          )
      }
      const host = await createStorageHost({
          plugins: [
            definePlugin('native-proof', (core) => ({
              install() {
                core.onDispose(
                  core.hooks.on('onRedisCommand', (event) => {
                    commands.push(event.command)
                  })
                )
                return {}
              }
            })),
            redisBackendPlugin({ driver: observed, prefix: crypto.randomUUID() })
          ] as const
        }),
        store = host.backend('redis')
      try {
        await store.set('text', '\0\ud800')
        expect(await store.get('text')).toBe('\0\ud800')
        expect(commands).toContain('GET')
        expect(queued).toContain('SET')
        await store.setBytes('bytes', new Uint8Array([255, 0, 128]))
        expect(await store.getBytes('bytes')).toEqual(new Uint8Array([255, 0, 128]))
        await store.putRecord({ value: 3 }, ['record', 1])
        expect(await store.getRecord(['record', 1])).toEqual({ value: 3 })
        expect(queued.filter((command) => command === 'SET')).toHaveLength(3)
        commands.length = 0
        queued.length = 0
        await store.use(kv).setMany([
          { key: 'group:a', value: '1' },
          { key: 'group:b', value: '2' }
        ])
        expect(queued.filter((command) => command === 'SET')).toHaveLength(2)
        commands.length = 0
        expect(await store.has('group:a')).toBe(true)
        expect(commands).toContain('GET')
        commands.length = 0
        expect(await store.keys()).toContain('group:a')
        expect(commands).toContain('ZRANGEBYLEX')
        queued.length = 0
        expect(await store.removeMany(['group:b', 'missing'])).toBe(1)
        expect(queued).toContain('DEL')
        await store.set('group:b', '2')
        queued.length = 0
        await store.remove('group:b')
        expect(queued).toContain('DEL')
        await store.set('group:b', '2')
        expect(await store.use(kv).getMany(['group:a', 'missing', 'group:a'])).toEqual([
          '1',
          undefined,
          '1'
        ])
        expect(await store.use(kv).removeByPrefix('group:')).toBe(2)
        commands.length = 0
        queued.length = 0
        expect(await store.use(counter).increment('counter')).toBe(1)
        expect(commands).toEqual(expect.arrayContaining(['WATCH', 'GET', 'EXEC']))
        expect(queued).toContain('SET')
        await store.use(ttl).expire({ channel: 'text', key: 'counter' }, 10000)
        await store.set('counter', '2')
        expect(await store.use(ttl).remaining({ channel: 'text', key: 'counter' })).toBeGreaterThan(
          0
        )
        expect(await store.use(ttl).persist({ channel: 'text', key: 'counter' })).toBe(true)
        expect(await store.use(ttl).remaining({ channel: 'text', key: 'counter' })).toBeUndefined()
        expect(commands).toContain('PTTL')
        expect(queued).toEqual(expect.arrayContaining(['PEXPIREAT', 'PERSIST']))
        commands.length = 0
        queued.length = 0
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
        expect(commands).toEqual(expect.arrayContaining(['WATCH', 'EXEC', 'ZRANGEBYLEX']))
        expect(queued).toEqual(expect.arrayContaining(['SET', 'DEL']))
        const failure = new RangeError('fixture callback')
        await expect(
          store.transaction(async (scope) => {
            await scope.set('rolled-back', 'value')
            throw failure
          })
        ).rejects.toBe(failure)
        expect(Reflect.get(failure, 'code')).toBe('TRANSACTION_FAILED')
        expect(await store.get('rolled-back')).toBeNull()
        commands.length = 0
        expect(await store.use(records).query<{ value: number }>().count()).toBe(2)
        expect(commands).toEqual(expect.arrayContaining(['ZRANGEBYLEX', 'MGET']))
        const orgId = crypto.randomUUID(),
          peer = host.org(orgId).backend('redis')
        await peer.set('text', 'other organization')
        await peer.putRecord({ value: 9 }, ['record', 1])
        expect(await store.get('text')).toBe('\0\ud800')
        expect(await peer.get('text')).toBe('other organization')
        expect(await peer.getRecord(['record', 1])).toEqual({ value: 9 })
        commands.length = 0
        queued.length = 0
        await peer.clearValues()
        expect(commands).toContain('ZRANGEBYLEX')
        expect(queued).toContain('DEL')
        expect(await peer.get('text')).toBeNull()
        commands.length = 0
        queued.length = 0
        await peer.clearAll()
        expect(commands).toContain('ZRANGEBYLEX')
        expect(queued).toContain('DEL')
        expect(await peer.getRecord(['record', 1])).toBeUndefined()
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
          expect(queued).toContain('PUBLISH')
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
