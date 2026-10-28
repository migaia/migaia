import { afterAll, describe, expect, it } from 'vitest'
import { Redis } from 'ioredis'
import { createClientPool } from 'redis'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { deferred } from '@migaia/utils/promise'
import { ConcurrencyPolicy } from '@migaia/storage-host/sdk'
import { redisBackendPlugin, type IRedisDriver } from '../src/index.ts'
import { nodeRedisDriver } from '../src/adapters/node-redis.ts'
import { ioredisDriver } from '../src/adapters/ioredis.ts'
import { createRedisLayout, encodeRedisValue } from '../src/layout.ts'

/** Independent genuine adapters contend only on fresh fixture keys. */
for (const url of [process.env.MIGAIA_REDIS_URL, process.env.MIGAIA_VALKEY_URL])
  describe.skipIf(!url)('native transaction outcomes', () => {
    const pool = createClientPool({ url }, { maximum: 8 }),
      client = new Redis(url ?? '', { lazyConnect: true })
    afterAll(async () => {
      if (pool.isOpen) await pool.close()
      if (client.status !== 'wait' && client.status !== 'end') await client.quit()
    })
    it('pages a transaction draft in the same order and content a committed read returns', async () => {
      await pool.connect()
      const prefix = crypto.randomUUID(),
        host = await createStorageHost({
          plugins: [redisBackendPlugin({ driver: nodeRedisDriver(pool), prefix })] as const
        })
      try {
        const store = host.backend('redis')
        /** 200 committed rows, then a draft that adds 100 interleaved keys and drops 20 rows. */
        for (let index = 0; index < 200; index++)
          await store.putRecord({ index }, 'k' + String(index).padStart(3, '0'))
        const collect = async (iterator: AsyncIterable<readonly [unknown, unknown]>) => {
          const rows: [unknown, unknown][] = []
          for await (const [key, value] of iterator) rows.push([key, value])
          return rows
        }
        const drafted = await store.transaction(async (scope) => {
          for (let index = 0; index < 100; index++)
            await scope.putRecord({ added: index }, 'k' + String(index * 2).padStart(3, '0') + 'x')
          for (let index = 0; index < 20; index++)
            await scope.deleteRecord('k' + String(index * 10).padStart(3, '0'))
          return collect(scope.iterateRecords() as never)
        })
        const committed = await collect(store.iterateRecords() as never)
        expect(drafted).toHaveLength(280)
        expect(drafted).toEqual(committed)
        expect(new Set(drafted.map(([key]) => String(key))).size).toBe(280)
      } finally {
        await host.dispose()
      }
    })
    it('retries real WATCH conflicts for two independent fifty-increment clients', async () => {
      await pool.connect()
      await client.connect()
      let conflicts = 0
      const original = nodeRedisDriver(pool),
        counted: IRedisDriver = {
          ...original,
          withConnection: (run) =>
            original.withConnection((connection) =>
              run({
                ...connection,
                async exec(commands) {
                  const result = await connection.exec(commands)
                  if (result === null) conflicts++
                  return result
                }
              })
            )
        },
        prefix = crypto.randomUUID(),
        policy = ConcurrencyPolicy.optimistic({ retries: 200, backoffMs: 1 }),
        first = await createStorageHost({
          plugins: [redisBackendPlugin({ driver: counted, prefix, concurrency: policy })] as const
        }),
        second = await createStorageHost({
          plugins: [
            redisBackendPlugin({ driver: ioredisDriver(client), prefix, concurrency: policy })
          ] as const
        })
      try {
        const a = first.backend('redis'),
          b = second.backend('redis')
        await a.putRecord({ count: 0 }, 'shared')
        await Promise.all(
          [a, b].map(async (store) => {
            for (let index = 0; index < 50; index++)
              await store.transaction(async (scope) => {
                const value = (await scope.getRecord('shared')) as { count: number }
                await scope.putRecord({ count: value.count + 1 }, 'shared')
              })
          })
        )
        expect(await a.getRecord('shared')).toEqual({ count: 100 })
        expect(conflicts).toBeGreaterThan(0)
      } finally {
        await first.backend('redis').clearAll()
        await Promise.all([first.dispose(), second.dispose()])
      }
    })
    it('rechecks implicit native locks after an unrelated genuine WATCH abort', async () => {
      const original = nodeRedisDriver(pool),
        prefix = crypto.randomUUID(),
        org = createOrgId(),
        layout = createRedisLayout(prefix, org),
        acquired = deferred<void>(),
        release = deferred<void>()
      let holder: Promise<void> | undefined,
        executions = 0,
        nulls = 0
      const other = await createStorageHost({
        org,
        plugins: [redisBackendPlugin({ driver: original, prefix })] as const
      })
      const guarded: IRedisDriver = {
        ...original,
        withConnection: (run) =>
          original.withConnection((connection) =>
            run({
              ...connection,
              async exec(commands) {
                executions++
                if (executions === 1)
                  await original.command(['HSET', layout.revisions, 'fixture-unrelated', '1'])
                const result = await connection.exec(commands)
                if (result === null) {
                  nulls++
                  holder = other
                    .backend('redis')
                    .tx()
                    .lock({ channel: 'text', key: 'guarded' })
                    .run(async () => {
                      acquired.resolve()
                      await release.promise
                    })
                  await acquired.promise
                }
                return result
              }
            })
          )
      }
      const host = await createStorageHost({
        org,
        plugins: [
          redisBackendPlugin({
            driver: guarded,
            prefix,
            concurrency: ConcurrencyPolicy.optimistic({ retries: 0 })
          })
        ] as const
      })
      try {
        await expect(host.backend('redis').set('guarded', 'must not pass')).rejects.toMatchObject({
          code: 'LOCK_REJECTED'
        })
        expect(nulls).toBe(1)
        expect(executions).toBe(1)
        expect(await other.backend('redis').get('guarded')).toBeNull()
      } finally {
        release.resolve()
        await holder
        await other.backend('redis').clearAll()
        await Promise.all([host.dispose(), other.dispose()])
      }
    })
    it('keeps a fail-policy related WATCH conflict distinct from lock rejection', async () => {
      if (!pool.isOpen) await pool.connect()
      const prefix = crypto.randomUUID(),
        org = createOrgId(),
        native = nodeRedisDriver(pool)
      const first = await createStorageHost({
          org,
          plugins: [redisBackendPlugin({ driver: native, prefix })] as const
        }),
        second = await createStorageHost({
          org,
          plugins: [redisBackendPlugin({ driver: native, prefix })] as const
        })
      try {
        const a = first.backend('redis'),
          b = second.backend('redis')
        await a.putRecord({ count: 1 }, 'conflict')
        await expect(
          a.transaction(
            async (scope) => {
              await scope.getRecord('conflict')
              await b.putRecord({ count: 2 }, 'conflict')
              await scope.putRecord({ count: 3 }, 'conflict')
            },
            { concurrency: ConcurrencyPolicy.fail() }
          )
        ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
        expect(await a.getRecord('conflict')).toEqual({ count: 2 })
        /** Native clients can replace this fixture's value without publishing a host revision. */
        const layout = createRedisLayout(prefix, org),
          physical = layout.value('record', 'conflict'),
          revisionField = layout.revision('record', 'conflict'),
          revision = await native.command(['HGET', layout.revisions, revisionField])
        expect(await native.command(['GET', physical])).toBe(
          encodeRedisValue('record', { count: 2 })
        )
        await expect(
          a.transaction(
            async (scope) => {
              expect(await scope.getRecord('conflict')).toEqual({ count: 2 })
              await native.command(['SET', physical, encodeRedisValue('record', { count: 4 })])
              expect(await native.command(['HGET', layout.revisions, revisionField])).toBe(revision)
              await scope.putRecord({ count: 5 }, 'conflict')
            },
            { concurrency: ConcurrencyPolicy.fail() }
          )
        ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
        expect(await a.getRecord('conflict')).toEqual({ count: 4 })
      } finally {
        await first.backend('redis').clearAll()
        await first.dispose()
        await second.dispose()
      }
    })
    it('drains an executed but unconfirmed reply, seals further writes and preserves reads', async () => {
      const original = nodeRedisDriver(pool),
        prefix = crypto.randomUUID(),
        failure = new RangeError('fixture lost EXEC reply')
      let executions = 0
      const injected: IRedisDriver = {
          ...original,
          withConnection: (run) =>
            original.withConnection((connection) =>
              run({
                ...connection,
                async exec(commands) {
                  executions++
                  await connection.exec(commands)
                  throw failure
                }
              })
            )
        },
        host = await createStorageHost({
          plugins: [redisBackendPlugin({ driver: injected, prefix })] as const
        }),
        store = host.backend('redis')
      try {
        await expect(store.set('unknown', 'committed')).rejects.toBe(failure)
        expect(Reflect.get(failure, 'code')).toBe('REDIS_FAILED')
        expect(await store.get('unknown')).toBe('committed')
        expect(() => store.set('never', 'sent')).toThrow(failure)
        expect(executions).toBe(1)
      } finally {
        await host.dispose()
        const tag = createRedisLayout(prefix, crypto.randomUUID()).tag
        let cursor = '0'
        do {
          const result = (await original.command([
            'SCAN',
            cursor,
            'MATCH',
            tag + ':*',
            'COUNT',
            '100'
          ])) as [string, string[]]
          cursor = result[0]
          if (result[1].length) await original.command(['DEL', ...result[1]])
        } while (cursor !== '0')
      }
    })
  })
