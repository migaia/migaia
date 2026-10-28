import { describe, expect, it } from 'vitest'
import { createClientPool } from 'redis'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { durableChangeFeed, type IDurableStorageChange } from '@migaia/storage-contract'
import { deferred } from '@migaia/utils/promise'
import { redisBackendPlugin } from '../src/index.ts'
import { nodeRedisDriver } from '../src/adapters/node-redis.ts'
import { redisChangeStreamFeature } from '../src/features/change-stream.ts'
import { createRedisLayout, encodeRedisValue } from '../src/layout.ts'

/** Explicit default-org projections remain scoped, even though the root observes the shared Stream. */
for (const url of [
  process.env.MIGAIA_REDIS_URL,
  process.env.MIGAIA_VALKEY_URL,
  process.env.MIGAIA_REDIS_STACK_URL
]) {
  describe.skipIf(!url)('organization feed ownership', () => {
    it('retains a quiet org history while another org exceeds the stream length', async () => {
      const pool = createClientPool({ url }, { maximum: 8 }),
        prefix = crypto.randomUUID()
      await pool.connect()
      const driver = nodeRedisDriver(pool),
        host = await createStorageHost({
          plugins: [
            redisBackendPlugin(
              { driver, prefix },
              { history: redisChangeStreamFeature({ maxLen: 10 }) }
            )
          ] as const
        })
      try {
        const root = host.backend('redis'),
          quiet = host.org(createOrgId()).backend('redis'),
          busy = host.org(createOrgId()).backend('redis')
        await root.set('warm', 'up')
        await quiet.set('quiet', 'one')
        for (let index = 0; index < 300; index++) await busy.set('busy:' + index, 'value')
        const own = await quiet.use(durableChangeFeed).readChanges({ limit: 10 })
        expect(own.changes.map((change) => change.keys)).toEqual([['quiet']])
        const busyPage = await busy.use(durableChangeFeed).readChanges({ limit: 10 })
        expect(busyPage.changes).toHaveLength(10)
        expect(
          busyPage.changes.every((change) => change.orgId === busyPage.changes[0]!.orgId)
        ).toBe(true)
        const all = await root.use(durableChangeFeed).readChanges({ limit: 1000 })
        expect(all.changes.length).toBeLessThan(301)
        expect(all.changes.at(-1)?.keys).toEqual(['busy:299'])
      } finally {
        await host.dispose()
        let cursor = '0'
        const tag = createRedisLayout(prefix, crypto.randomUUID()).tag
        do {
          const reply = (await driver.command([
            'SCAN',
            cursor,
            'MATCH',
            tag + ':*',
            'COUNT',
            '256'
          ])) as [string, string[]]
          cursor = reply[0]
          if (reply[1].length) await driver.command(['DEL', ...reply[1]])
        } while (cursor !== '0')
        await pool.close()
      }
    })

    it('keeps default and two other orgs isolated in replay and confirmed tail delivery', async () => {
      const pool = createClientPool({ url }, { maximum: 8 }),
        prefix = crypto.randomUUID()
      await pool.connect()
      const driver = nodeRedisDriver(pool),
        host = await createStorageHost({
          plugins: [
            redisBackendPlugin(
              { driver, prefix },
              { history: redisChangeStreamFeature({ maxLen: 1000 }) }
            )
          ] as const
        }),
        root = host.backend('redis')
      try {
        await root.set('default', 'one')
        const initial = await root.use(durableChangeFeed).readChanges(),
          defaultOrg = initial.changes[0]!.orgId!,
          explicit = host.org(defaultOrg).backend('redis'),
          a = host.org(createOrgId()).backend('redis'),
          b = host.org(createOrgId()).backend('redis')
        expect(explicit.has(durableChangeFeed)).toBe(true)
        const received: IDurableStorageChange[] = [],
          delivered = deferred<void>(),
          tail = await explicit.use(durableChangeFeed).tailChanges({
            from: 'now',
            onChange: (change) => {
              received.push(change)
              if (change.keys?.includes('default-tail')) delivered.resolve()
            }
          })
        try {
          await a.set('foreign-a', 'two')
          await b.set('foreign-b', 'three')
          await root.set('default-tail', 'four')
          await delivered.promise
        } finally {
          await tail.dispose()
        }
        expect(received).toHaveLength(1)
        expect(received[0]?.orgId).toBe(defaultOrg)
        const all = await root.use(durableChangeFeed).readChanges()
        expect(all.changes).toHaveLength(4)
        const scoped = await explicit.use(durableChangeFeed).readChanges()
        expect(scoped.changes).toHaveLength(2)
        expect(scoped.changes.every((change) => change.orgId === defaultOrg)).toBe(true)
        expect((await a.use(durableChangeFeed).readChanges()).changes).toHaveLength(1)
        expect((await b.use(durableChangeFeed).readChanges()).changes).toHaveLength(1)
        await host.dispose()
        const writer = await createStorageHost({
          org: defaultOrg,
          plugins: [
            redisBackendPlugin(
              { driver, prefix },
              { history: redisChangeStreamFeature({ maxLen: 1000 }) }
            )
          ] as const
        })
        try {
          for (let index = 0; index < 5; index++)
            await writer.backend('redis').set('offline:' + index, 'new')
        } finally {
          await writer.dispose()
        }
        await driver.command([
          'SET',
          createRedisLayout(prefix, defaultOrg).value('text', 'native-only'),
          encodeRedisValue('text', 'external')
        ])
        const reopened = await createStorageHost({
          org: defaultOrg,
          plugins: [
            redisBackendPlugin(
              { driver, prefix },
              { history: redisChangeStreamFeature({ maxLen: 1000 }) }
            )
          ] as const
        })
        try {
          const replay = await reopened
            .backend('redis')
            .use(durableChangeFeed)
            .readChanges({ after: all.cursor })
          expect(replay.changes).toHaveLength(5)
          expect(replay.changes.flatMap((change) => change.keys ?? [])).toEqual(
            Array.from({ length: 5 }, (_, index) => 'offline:' + index)
          )
        } finally {
          await reopened.dispose()
        }
        expect(await pool.execute((client) => client.ping())).toBe('PONG')
      } finally {
        await host.dispose()
        let cursor = '0'
        const tag = createRedisLayout(prefix, crypto.randomUUID()).tag
        do {
          const reply = (await driver.command([
            'SCAN',
            cursor,
            'MATCH',
            tag + ':*',
            'COUNT',
            '256'
          ])) as [string, string[]]
          cursor = reply[0]
          if (reply[1].length) await driver.command(['DEL', ...reply[1]])
        } while (cursor !== '0')
        await pool.close()
      }
    })
  })
}
