import { storageProbe } from '@migaia/storage-host/plugins/probe'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createClientPool } from 'redis'
import { createOrgId, createStorageHost } from '@migaia/storage-host'
import { walkErrorCauses } from '@migaia/utils/error'
import { deferred, sleep } from '@migaia/utils/promise'
import { redisBackendPlugin, type IRedisDriver } from '../src/index.js'
import { nodeRedisDriver } from '../src/adapters/node-redis.js'
import { createRedisLayout } from '../src/layout.js'

/** These finite native lifecycle cases own only fresh namespaces and borrowed genuine clients. */
for (const service of ['MIGAIA_REDIS_URL', 'MIGAIA_VALKEY_URL'] as const) {
  const url = process.env[service]
  describe.skipIf(!url)(service + ' native lifecycle', () => {
    const pool = createClientPool({ url }, { maximum: 8 }),
      driver = nodeRedisDriver(pool),
      prefixes: string[] = []
    const connect = async () => {
      if (!pool.isOpen) await pool.connect()
    }
    const prefix = () => {
      const value = crypto.randomUUID()
      prefixes.push(value)
      return value
    }
    afterAll(async () => {
      if (!pool.isOpen) return
      for (const value of prefixes) {
        const tag = createRedisLayout(value, crypto.randomUUID()).tag
        let cursor = '0'
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
      }
      await pool.close()
    })
    it('rejects a pre-EXEC abort without sending a batch or leaving its isolated lease', async () => {
      await connect()
      let executions = 0
      const observed: IRedisDriver = {
          ...driver,
          withConnection: (run) =>
            driver.withConnection((connection) =>
              run({
                ...connection,
                exec: (commands) => {
                  executions++
                  return connection.exec(commands)
                }
              })
            )
        },
        host = await createStorageHost({
          plugins: [
            storageProbe(),
            redisBackendPlugin({ driver: observed, prefix: prefix() })
          ] as const
        }),
        controller = new AbortController()
      try {
        await expect(
          host.backend('redis').transaction(
            async (scope) => {
              await scope.set('aborted', 'never')
              controller.abort(new Error('before native commit'))
            },
            { signal: controller.signal }
          )
        ).rejects.toMatchObject({ code: 'ABORTED' })
        expect(executions).toBe(0)
        expect(await host.backend('redis').get('aborted')).toBeNull()
        expect(await pool.execute((client) => client.ping())).toBe('PONG')
      } finally {
        await host.dispose()
      }
    })
    it('drains one admitted transaction before closing and keeps the root client borrowed', async () => {
      await connect()
      const value = prefix(),
        org = createOrgId(),
        entered = deferred<void>(),
        resume = deferred<void>(),
        host = await createStorageHost({
          org,
          plugins: [storageProbe(), redisBackendPlugin({ driver, prefix: value })] as const
        }),
        store = host.backend('redis')
      let closed = false
      try {
        const pending = store.transaction(async (scope) => {
          await scope.set('accepted', 'committed')
          entered.resolve()
          await resume.promise
        })
        await entered.promise
        const disposal = store.dispose().then(() => {
          closed = true
        })
        expect(closed).toBe(false)
        await expect(
          Promise.resolve().then(() => store.set('late', 'never'))
        ).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
        resume.resolve()
        await pending
        await disposal
        const raw = await driver.command([
          'GET',
          createRedisLayout(value, org).value('text', 'accepted')
        ])
        expect(typeof raw).toBe('string')
        expect(await pool.execute((client) => client.ping())).toBe('PONG')
      } finally {
        resume.resolve()
        await host.dispose()
      }
    })
    it('uses Redis time and preserves a successor lock when the first lease expires', async () => {
      await connect()
      const value = prefix(),
        org = createOrgId(),
        entered = deferred<void>(),
        resume = deferred<void>(),
        held = deferred<void>(),
        release = deferred<void>(),
        a = await createStorageHost({
          org,
          plugins: [
            storageProbe(),
            redisBackendPlugin({ driver, prefix: value, maxLockMs: 100 })
          ] as const
        }),
        b = await createStorageHost({
          org,
          plugins: [
            storageProbe(),
            redisBackendPlugin({ driver, prefix: value, maxLockMs: 1000 })
          ] as const
        })
      let lost = 0,
        inspected = 0
      a.extensions.observe('onLockLost', () => {
        lost++
      })
      b.extensions.observe('beforeLockInspect', () => {
        inspected++
      })
      let second: Promise<void> | undefined
      const first = a
        .backend('redis')
        .tx()
        .lock({ channel: 'text', key: 'lease' })
        .run(async (scope) => {
          await scope.set('lease', 'never')
          entered.resolve()
          await resume.promise
        })
      const failure = first.catch((cause) => cause as unknown)
      await entered.promise
      const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() - 86400000)
      try {
        await sleep(150)
        second = b
          .backend('redis')
          .tx()
          .lock({ channel: 'text', key: 'lease' })
          .run(async () => {
            held.resolve()
            await release.promise
          })
        await held.promise
        resume.resolve()
        expect(await failure).toMatchObject({ code: 'LOCK_LOST' })
        expect(lost).toBe(1)
        expect(await b.backend('redis').get('lease')).toBeNull()
        expect(await b.backend('redis').inspectLocks()).toHaveLength(1)
        expect(inspected).toBe(1)
      } finally {
        clock.mockRestore()
        resume.resolve()
        release.resolve()
        await failure
        await second
        await a.dispose()
        await b.dispose()
      }
    })
    it('shares cleanup once across rejecting main and reporting symbolic promises', async () => {
      await connect()
      const failure = new RangeError('native subscription cleanup'),
        diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      let closes = 0
      const observed: IRedisDriver = {
          ...driver,
          subscribe: async (channel, listener) => {
            const original = await driver.subscribe(channel, listener)
            return {
              ...original,
              dispose: async () => {
                closes++
                await original.dispose()
                throw failure
              }
            }
          }
        },
        host = await createStorageHost({
          plugins: [
            storageProbe(),
            redisBackendPlugin({ driver: observed, prefix: prefix() })
          ] as const
        }),
        store = host.backend('redis')
      try {
        const main = store.dispose(),
          symbolic = store[Symbol.asyncDispose]()
        expect(store.dispose()).toBe(main)
        expect(store[Symbol.asyncDispose]()).toBe(symbolic)
        expect(symbolic).not.toBe(main)
        const cause = await main.catch((cause) => cause as unknown)
        expect(walkErrorCauses(cause).includes(failure)).toBe(true)
        await expect(symbolic).resolves.toBeUndefined()
        expect(closes).toBe(1)
        expect(diagnostics.mock.calls).toHaveLength(1)
        expect(await pool.execute((client) => client.ping())).toBe('PONG')
      } finally {
        const close = await host.dispose().then(
          () => undefined,
          (cause) => cause as unknown
        )
        if (close !== undefined) expect(walkErrorCauses(close).includes(failure)).toBe(true)
        diagnostics.mockRestore()
      }
    })
  })
}
