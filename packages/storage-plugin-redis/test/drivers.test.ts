import { describe, expect, it } from 'vitest'
import { Redis } from 'ioredis'
import { createClientPool } from 'redis'
import { ioredisDriver } from '../src/adapters/ioredis.js'
import { nodeRedisDriver } from '../src/adapters/node-redis.js'
import { redisExecCause } from '../src/constants.js'
import type { IRedisDriver } from '../src/driver.js'

/** Each selected service must be supplied by the repository's service launcher. */
const services = [
  ['Redis', process.env.MIGAIA_REDIS_URL],
  ['Valkey', process.env.MIGAIA_VALKEY_URL],
  ['Redis Stack', process.env.MIGAIA_REDIS_STACK_URL]
] as const

/** Real commands prove WATCH, partial execution and the original native subscription path. */
async function exercise(driver: IRedisDriver, key: string): Promise<void> {
  const channel = key + ':channel',
    value = Promise.withResolvers<string>()
  try {
    const business = new RangeError('callback failed'),
      stack = business.stack
    await expect(
      driver.withConnection(async () => {
        throw business
      })
    ).rejects.toBe(business)
    expect(business).toMatchObject({ source: 'storage.backend.redis', code: 'TRANSACTION_FAILED' })
    expect(business.stack).toBe(stack)
    expect(await driver.command(['SET', key, 'before'])).toBe('OK')
    await driver.withConnection(async (connection) => {
      await connection.command(['WATCH', key])
      await driver.command(['SET', key, 'concurrent'])
      expect(await connection.exec([['SET', key, 'stale']])).toBeNull()
    })
    expect(String(await driver.command(['GET', key]))).toBe('concurrent')
    await driver.withConnection(async (connection) => {
      const entries = await connection.exec([
        ['SET', key, 'not-an-integer'],
        ['INCR', key]
      ])
      expect(entries).toHaveLength(2)
      expect(entries?.[0]).toEqual({ ok: true, value: 'OK' })
      const failed = entries?.[1]
      expect(failed?.ok).toBe(false)
      if (failed?.ok === false) {
        expect(failed.error).toBeInstanceOf(Error)
        expect(failed.error.message).toMatch(/integer/)
        const native = Reflect.get(entries!, redisExecCause) as unknown
        if (native instanceof Error) {
          expect(Reflect.get(native, 'replies')[1]).toBe(failed.error)
          expect(Reflect.get(native, 'errorIndexes')).toEqual([1])
        }
      }
      await expect(
        connection.exec([
          ['SET', key, 'invalid-write'],
          ['SET', key, 3 as never]
        ])
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      expect(String(await connection.command(['GET', key]))).toBe('not-an-integer')
      expect(await connection.exec([])).toEqual([])
      const binary = connection.binaryCommand
      expect(binary).toBeTypeOf('function')
      expect(await binary!(['SET', key, new Uint8Array([97, 0, 98])])).toBeTruthy()
      expect(
        await connection.exec([['SET', key, new Uint8Array([98, 121, 116, 101, 115])]])
      ).toEqual([{ ok: true, value: 'OK' }])
      expect(String(await connection.command(['GET', key]))).toBe('bytes')
    })
    let callbacks = 0
    const resource = await driver.subscribe(channel, (message) => {
      callbacks++
      value.resolve(message)
    })
    try {
      expect(await driver.command(['PUBLISH', channel, 'payload'])).toBe(1)
      expect(await value.promise).toBe('payload')
      const disposal = resource.dispose()
      expect(resource.dispose()).toBe(disposal)
      const symbolic = resource[Symbol.asyncDispose]()
      expect(resource[Symbol.asyncDispose]()).toBe(symbolic)
      await disposal
      await symbolic
      expect(await driver.command(['PUBLISH', channel, 'after-close'])).toBe(0)
      expect(callbacks).toBe(1)
    } finally {
      await resource.dispose()
    }
  } finally {
    await driver.command(['DEL', key])
  }
}

for (const [name, url] of services)
  describe(name, () => {
    if (!url) throw new Error('Real Redis service URL is required')
    it('ioredis retains native execution evidence and the borrowed root', async () => {
      const client = new Redis(url, { lazyConnect: true }),
        key = 'driver-test:' + crypto.randomUUID()
      await client.connect()
      const options = client.options,
        driver = ioredisDriver(client)
      try {
        await exercise(driver, key)
        expect(client.options).toBe(options)
        expect(await client.ping()).toBe('PONG')
      } finally {
        await client.quit()
      }
    })
    it('node-redis retains native execution evidence and the borrowed pool', async () => {
      const pool = createClientPool({ url }, { minimum: 1, maximum: 3 }),
        key = 'driver-test:' + crypto.randomUUID()
      await pool.connect()
      try {
        await exercise(nodeRedisDriver(pool), key)
        expect(await pool.sendCommand(['PING'])).toBe('PONG')
      } finally {
        await pool.close()
      }
    })
  })

it('node-redis keeps the real single connection lease until the callback settles', async () => {
  const pool = createClientPool({ url: process.env.MIGAIA_REDIS_URL }, { minimum: 1, maximum: 1 }),
    started = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>()
  await pool.connect()
  try {
    const driver = nodeRedisDriver(pool),
      held = driver.withConnection(async (connection) => {
        expect(await connection.command(['PING'])).toBe('PONG')
        started.resolve()
        await release.promise
        return 'finished'
      })
    await started.promise
    let completed = false
    const queued = driver.command(['PING']).then((reply) => {
      completed = true
      return reply
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    release.resolve()
    expect(await held).toBe('finished')
    expect(await queued).toBe('PONG')
  } finally {
    release.resolve()
    await pool.close()
  }
})
