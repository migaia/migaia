import { describe, expect, it } from 'vitest'
import { createClientPool } from 'redis'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { durableChangeFeed, type IDurableStorageChange } from '@migaia/storage-contract'
import { deferred } from '@migaia/utils/promise'
import { redisBackendPlugin } from '../src/index.js'
import { nodeRedisDriver } from '../src/adapters/node-redis.js'
import { redisChangeStreamFeature } from '../src/features/change-stream.js'
import { createRedisLayout } from '../src/layout.js'

/** Explicit default-org projections remain scoped, even though the root observes the shared Stream. */
for (const url of [
  process.env.MIGAIA_REDIS_URL,
  process.env.MIGAIA_VALKEY_URL,
  process.env.MIGAIA_REDIS_STACK_URL
]) {
  describe.skipIf(!url)('organization feed ownership', () => {
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
