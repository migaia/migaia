import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Redis } from 'ioredis'
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { counter, kv, records, ttl } from '@migaia/storage-contract'
import { runConformance } from '@migaia/storage-contract/conformance'
import { redisBackendPlugin } from '../src/index.js'
import { nodeRedisDriver } from '../src/adapters/node-redis.js'
import { ioredisDriver } from '../src/adapters/ioredis.js'
import { createRedisLayout } from '../src/layout.js'
import { redisCapabilities } from '../src/types.js'

/** Each canonical case receives an empty namespace and only its own native keys are removed. */
for (const [service, url] of [
  ['redis', process.env.MIGAIA_REDIS_URL],
  ['valkey', process.env.MIGAIA_VALKEY_URL]
] as const) {
  for (const adapter of ['node', 'ioredis'] as const) {
    describe.skipIf(!url)(`${service} ${adapter}`, () => {
      const pool = createClientPool({ url }, { maximum: 8 }),
        client = new Redis(url ?? '', { lazyConnect: true }),
        driver = adapter === 'node' ? nodeRedisDriver(pool) : ioredisDriver(client)
      let tag: string | undefined, dispose: (() => Promise<void>) | undefined
      beforeAll(async () => {
        if (adapter === 'node') await pool.connect()
        else await client.connect()
      })
      afterEach(async () => {
        try {
          await dispose?.()
        } finally {
          if (tag) {
            let cursor = '0'
            do {
              const reply = (await driver.command([
                'SCAN',
                cursor,
                'MATCH',
                tag + ':*',
                'COUNT',
                '100'
              ])) as [string, string[]]
              cursor = reply[0]
              if (reply[1].length) await driver.command(['DEL', ...reply[1]])
            } while (cursor !== '0')
          }
          tag = undefined
          dispose = undefined
        }
      })
      afterAll(async () => {
        if (pool.isOpen) await pool.close()
        if (client.status !== 'wait' && client.status !== 'end') await client.quit()
      })
      runConformance(
        { describe, expect, it },
        {
          name: 'native standard storage',
          capabilities: [kv, records, ttl, counter],
          features: redisCapabilities,
          async create() {
            const prefix = crypto.randomUUID(),
              host = await createStorageHost({
                plugins: [redisBackendPlugin({ driver, prefix })] as const
              })
            tag = createRedisLayout(prefix, crypto.randomUUID()).tag
            dispose = () => host.dispose()
            return host.backend('redis')
          }
        }
      )
    })
  }
}
