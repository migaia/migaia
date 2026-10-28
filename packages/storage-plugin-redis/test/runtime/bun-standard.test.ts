import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { RedisClient } from 'bun'
import { createStorageHost } from '@migaia/storage-host'
import { counter, kv, records, ttl, durableChangeFeed } from '@migaia/storage-contract'
import { runConformance, type IConformanceHarness } from '@migaia/storage-contract/conformance'
import { redisBackendPlugin } from '../../src/index.ts'
import { bunRedisDriver } from '../../src/adapters/bun.ts'
import { createRedisLayout } from '../../src/layout.ts'
import { redisCapabilities } from '../../src/types.ts'
import { redisChangeStreamFeature } from '../../src/features/change-stream.ts'

/** Bun declares async matchers as void; the bridge awaits its actual native assertions. */
const harness: IConformanceHarness = {
  describe: (name, run) =>
    describe(name, async () => {
      await run()
    }),
  it: (name, run) =>
    it(name, async () => {
      await run()
    }),
  expect: (actual) => {
    const match = expect<unknown>(actual)
    return {
      toBe: (expected: unknown) => match.toBe(expected),
      toEqual: (expected: unknown) => match.toEqual(expected),
      toBeNull: () => match.toBeNull(),
      toBeUndefined: () => match.toBeUndefined(),
      toBeDefined: () => match.toBeDefined(),
      toThrow: (expected?: string | RegExp) => match.toThrow(expected),
      toMatchObject: (expected: object) => match.toMatchObject(expected),
      resolves: {
        toBe: async (expected: unknown) => {
          await match.resolves.toBe(expected)
        },
        toEqual: async (expected: unknown) => {
          await match.resolves.toEqual(expected)
        },
        toBeNull: async () => {
          await match.resolves.toBeNull()
        },
        toBeUndefined: async () => {
          await match.resolves.toBeUndefined()
        },
        toBeDefined: async () => {
          await match.resolves.toBeDefined()
        },
        toThrow: async (expected?: string | RegExp) => {
          await match.resolves.toThrow(expected)
        },
        toMatchObject: async (expected: object) => {
          await match.resolves.toMatchObject(expected)
        }
      },
      rejects: {
        toBe: async (expected: unknown) => {
          await match.rejects.toBe(expected)
        },
        toEqual: async (expected: unknown) => {
          await match.rejects.toEqual(expected)
        },
        toBeNull: async () => {
          await match.rejects.toBeNull()
        },
        toBeUndefined: async () => {
          await match.rejects.toBeUndefined()
        },
        toBeDefined: async () => {
          await match.rejects.toBeDefined()
        },
        toThrow: async (expected?: string | RegExp) => {
          await match.rejects.toThrow(expected)
        },
        toMatchObject: async (expected: object) => {
          await match.rejects.toMatchObject(expected)
        }
      }
    }
  }
}

/** Each canonical case receives an empty namespace and only its own native keys are removed. */
for (const [service, url] of [
  ['redis', process.env.MIGAIA_REDIS_URL],
  ['valkey', process.env.MIGAIA_VALKEY_URL],
  ['stack', process.env.MIGAIA_REDIS_STACK_URL]
] as const) {
  if (!url) throw new Error('Real Redis service URL is required')
  describe(`${service} Bun built-in`, () => {
    const client = new RedisClient(url),
      driver = bunRedisDriver(client)
    let tag: string | undefined, dispose: (() => Promise<void>) | undefined
    beforeAll(async () => {
      await client.connect()
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
      client.close()
    })
    runConformance(harness, {
      name: 'native standard storage',
      capabilities: [kv, records, ttl, counter, durableChangeFeed],
      features: redisCapabilities,
      async create() {
        const prefix = crypto.randomUUID(),
          host = await createStorageHost({
            plugins: [
              redisBackendPlugin(
                { driver, prefix },
                { history: redisChangeStreamFeature({ maxLen: 1000 }) }
              )
            ] as const
          })
        tag = createRedisLayout(prefix, crypto.randomUUID()).tag
        dispose = () => host.dispose()
        return host.backend('redis')
      }
    })
  })
}
