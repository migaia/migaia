import { postgresBackendPlugin, type IPgDriver } from '@migaia/storage-plugin-postgres'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createClientPool } from 'redis'
import {
  createStorageHost,
  createOrgId,
  definePlugin,
  memoryBackendPlugin
} from '@migaia/storage-host'
import { durableChangeFeed } from '@migaia/storage-contract'
import { deferred } from '@migaia/utils/promise'
import { redisChangeStreamFeature } from '../src/features/change-stream.js'
import { redisBackendPlugin } from '../src/index.js'
import { nodeRedisDriver } from '../src/adapters/node-redis.js'
import { redisStreamsFeature } from '../src/features/streams.js'
import { redisPubSubFeature } from '../src/features/pubsub.js'
import { redisSortedSetsFeature } from '../src/features/sorted-sets.js'
import { redisRateLimitFeature } from '../src/features/rate-limit.js'
import { createRedisLayout } from '../src/layout.js'

/** All native feature fixtures use fresh same-slot namespaces on actual services. */
for (const url of [
  process.env.MIGAIA_REDIS_URL,
  process.env.MIGAIA_VALKEY_URL,
  process.env.MIGAIA_REDIS_STACK_URL
]) {
  describe.skipIf(!url)('native Features', () => {
    const pool = createClientPool({ url }, { maximum: 8 }),
      driver = nodeRedisDriver(pool)
    afterAll(async () => {
      if (pool.isOpen) await pool.close()
    })
    it('forwards one symbolic subscription close without entering explicit disposal', async () => {
      if (!pool.isOpen) await pool.connect()
      const entries: { explicit: number; symbolic: number }[] = []
      /** Transparent counters observe the real original driver's two disposal entries. */
      const observed: typeof driver = {
        ...driver,
        subscribe: async (channel, listener) => {
          const original = await driver.subscribe(channel, listener),
            count = { explicit: 0, symbolic: 0 }
          entries.push(count)
          return {
            dispose: () => {
              count.explicit++
              return original.dispose()
            },
            [Symbol.asyncDispose]: () => {
              count.symbolic++
              return original[Symbol.asyncDispose]()
            }
          }
        }
      }
      const host = await createStorageHost({
        plugins: [
          redisBackendPlugin(
            { driver: observed, prefix: crypto.randomUUID() },
            { pubsub: redisPubSubFeature() }
          )
        ] as const
      })
      try {
        const resource = await host
            .backend('redis')
            .api.pubsub.subscribe('symbolic-close', () => undefined),
          count = entries.at(-1)!
        const closed = resource[Symbol.asyncDispose]()
        expect(count.symbolic).toBe(1)
        expect(count.explicit).toBe(0)
        expect(resource[Symbol.asyncDispose]()).toBe(closed)
        await closed
        expect(count.symbolic).toBe(2)
        expect(count.explicit).toBe(0)
      } finally {
        await host.dispose()
      }
    })
    it('drops historical native business keys without selecting their Features after reopening', async () => {
      if (!pool.isOpen) await pool.connect()
      const prefix = crypto.randomUUID(),
        a = createOrgId(),
        b = createOrgId(),
        layoutA = createRedisLayout(prefix, a),
        layoutB = createRedisLayout(prefix, b)
      const host = await createStorageHost({
        plugins: [
          redisBackendPlugin(
            { driver, prefix },
            {
              streams: redisStreamsFeature(),
              sorted: redisSortedSetsFeature(),
              rate: redisRateLimitFeature({ limit: 3, windowMs: 60000 }),
              history: redisChangeStreamFeature({ maxLen: 1000 })
            }
          )
        ] as const
      })
      try {
        for (const org of [a, b]) {
          const store = host.org(org).backend('redis')
          await store.api.streams.add('jobs', { body: new Uint8Array([1]) })
          await store.api.sortedSets.add('scores', [{ member: 'one', score: 1 }])
          await store.api.rateLimit.consume('quota')
          await store.set('standard', 'history')
        }
        for (const layout of [layoutA, layoutB])
          for (const [channel, name] of [
            ['streams', 'jobs'],
            ['sorted', 'scores'],
            ['rate', 'quota']
          ] as const)
            expect(await driver.command(['EXISTS', layout.feature(channel, name)])).toBe(1)
        await driver.command(['SET', layoutA.tag + ':caller:keep', 'unmanaged'])
        await driver.command([
          'SET',
          layoutA.feature('streams', ['not-a-feature-name']),
          'unmanaged'
        ])
        const length = await driver.command(['XLEN', layoutA.durableChanges])
        await host.dispose()
        const reopened = await createStorageHost({
          plugins: [redisBackendPlugin({ driver, prefix })] as const
        })
        try {
          await reopened.dropOrg(a)
        } finally {
          await reopened.dispose()
        }
        for (const [channel, name] of [
          ['streams', 'jobs'],
          ['sorted', 'scores'],
          ['rate', 'quota']
        ] as const) {
          expect(await driver.command(['EXISTS', layoutA.feature(channel, name)])).toBe(0)
          expect(await driver.command(['EXISTS', layoutB.feature(channel, name)])).toBe(1)
        }
        expect(await driver.command(['GET', layoutA.tag + ':caller:keep'])).toBe('unmanaged')
        expect(
          await driver.command(['GET', layoutA.feature('streams', ['not-a-feature-name'])])
        ).toBe('unmanaged')
        expect(await driver.command(['XLEN', layoutA.durableChanges])).toBe(length)
      } finally {
        await host.dispose()
        let cursor = '0'
        do {
          const reply = (await driver.command([
            'SCAN',
            cursor,
            'MATCH',
            layoutA.tag + ':*',
            'COUNT',
            '256'
          ])) as [string, string[]]
          cursor = reply[0]
          if (reply[1].length) await driver.command(['DEL', ...reply[1]])
        } while (cursor !== '0')
      }
    })
    it('runs real streams, group claim/ack, PubSub, UTF16 sorted ties and atomic fixed windows', async () => {
      if (!pool.isOpen) await pool.connect()
      const commands: import('../src/hooks.js').IRedisCommandHookPayload[] = [],
        counts = new Map<string, number>(),
        stage = definePlugin('observe', (core) => ({
          install() {
            core.onDispose(
              core.hooks.on('onRedisCommand', (payload) => {
                commands.push(payload)
              })
            )
            core.useAsyncPipeline(async (input, next) => {
              counts.set(input.operation, (counts.get(input.operation) ?? 0) + 1)
              await next(input)
            })
            return {}
          }
        })),
        prefix = crypto.randomUUID(),
        host = await createStorageHost({
          plugins: [
            stage,
            redisBackendPlugin(
              { driver, prefix },
              {
                streams: redisStreamsFeature(),
                pubsub: redisPubSubFeature(),
                sorted: redisSortedSetsFeature(),
                rate: redisRateLimitFeature({ limit: 3, windowMs: 10000 }),
                history: redisChangeStreamFeature({ maxLen: 1000 })
              }
            )
          ] as const
        }),
        store = host.backend('redis'),
        api = store.api
      try {
        const id = await api.streams.add('jobs', { body: new Uint8Array([255, 0, 128]) })
        expect(counts.get('streams.add')).toBe(1)
        expect(commands.filter((payload) => payload.command === 'XADD')).toHaveLength(1)
        expect(
          commands.every(
            (payload) =>
              payload.backend === 'redis' &&
              typeof payload.orgId === 'string' &&
              Object.keys(payload).length === 5
          )
        ).toBe(true)
        expect(await api.streams.range('jobs')).toEqual([
          { id, fields: { body: new Uint8Array([255, 0, 128]) } }
        ])
        expect(commands.at(-1)?.command).toBe('XRANGE')
        await api.streams.createGroup('jobs', 'workers')
        await api.streams.createGroup('jobs', 'workers')
        expect(
          (await api.streams.readGroup('jobs', { group: 'workers', consumer: 'a' })).map(
            (row) => row.id
          )
        ).toEqual([id])
        const claim = await api.streams.autoClaim('jobs', {
          group: 'workers',
          consumer: 'b',
          minIdleMs: 0
        })
        expect(claim.entries.map((row) => row.id)).toEqual([id])
        expect(claim.deletedIds).toEqual([])
        expect(await api.streams.ack('jobs', 'workers', [id])).toBe(1)
        expect(commands.map((entry) => entry.command)).toEqual(
          expect.arrayContaining(['XGROUP', 'XREADGROUP', 'XAUTOCLAIM', 'XACK'])
        )
        await expect(
          api.streams.readGroup(
            'jobs',
            { group: 'workers', consumer: 'blocked', blockMs: 5000 },
            { timeoutMs: 10 }
          )
        ).rejects.toMatchObject({ code: 'ABORTED' })
        let receive!: (value: Uint8Array) => void
        const received = new Promise<Uint8Array>((resolve) => {
            receive = resolve
          }),
          subscription = await api.pubsub.subscribe('channel', (value) => receive(value))
        expect(await api.pubsub.publish('channel', new Uint8Array([128, 255]))).toBe(1)
        expect(await received).toEqual(new Uint8Array([128, 255]))
        expect(subscription.dispose()).toBe(subscription.dispose())
        await subscription.dispose()
        expect(await api.pubsub.publish('channel', new Uint8Array())).toBe(0)
        expect(commands.map((entry) => entry.command)).toEqual(
          expect.arrayContaining(['SUBSCRIBE', 'PUBLISH'])
        )
        expect(
          await api.sortedSets.add('scores', [
            { member: '\ue000', score: 1 },
            { member: '\ud800', score: 1 },
            { member: 'a', score: 1 }
          ])
        ).toBe(3)
        expect((await api.sortedSets.top('scores')).map((row) => row.member)).toEqual([
          'a',
          '\ud800',
          '\ue000'
        ])
        expect(await api.sortedSets.rank('scores', '\ud800')).toBe(1)
        expect(await api.sortedSets.rank('scores', 'missing')).toBeUndefined()
        expect(commands.map((entry) => entry.command)).toEqual(
          expect.arrayContaining(['ZADD', 'ZRANGE', 'ZRANK'])
        )
        commands.length = 0
        const results = await Promise.all(
          Array.from({ length: 4 }, () => api.rateLimit.consume('quota'))
        )
        expect(results.filter((row) => row.allowed)).toHaveLength(3)
        expect((await api.rateLimit.consume('quota')).remaining).toBe(0)
        expect(commands.filter((entry) => entry.command === 'EVAL')).toHaveLength(5)
        commands.length = 0
        const feed = store.use(durableChangeFeed)
        await store.set('history', 'first')
        const initial = await feed.readChanges()
        expect(initial.changes).toHaveLength(1)
        expect(counts.get('changes.read')).toBe(1)
        expect(commands.map((entry) => entry.command)).toContain('XRANGE')
        const org = createOrgId(),
          peer = host.org(org).backend('redis')
        expect(peer.has(durableChangeFeed)).toBe(true)
        await peer.set('history', 'other')
        const scoped = await peer.use(durableChangeFeed).readChanges()
        expect(scoped.changes).toHaveLength(1)
        expect(scoped.changes[0]?.orgId).toBe(org)
        expect((await feed.readChanges()).changes).toHaveLength(2)
        const delivery = deferred<string>()
        const tail = await feed.tailChanges({
          from: 'now',
          onChange: (change) => {
            delivery.resolve(change.cursor)
          }
        })
        await store.set('history', 'second')
        const delivered = await delivery.promise
        expect(
          (await feed.readChanges({ after: initial.cursor })).changes.some(
            (change) => change.cursor === delivered
          )
        ).toBe(true)
        expect(tail.dispose()).toBe(tail.dispose())
        await tail.dispose()
        expect(commands.map((entry) => entry.command)).toEqual(
          expect.arrayContaining(['XREVRANGE', 'XREAD'])
        )
        const failed = deferred<void>(),
          callbackFailure = new RangeError('fixture tail callback'),
          observerFailure = new Error('fixture error observer'),
          diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const rejecting = await feed.tailChanges({
          from: 'now',
          onChange: async () => {
            throw callbackFailure
          },
          onError: async () => {
            failed.resolve()
            throw observerFailure
          }
        })
        try {
          await store.set('history', 'retryable delivery')
          await failed.promise
          await new Promise<void>((resolve) => setImmediate(resolve))
          expect(
            diagnostics.mock.calls.filter((args) => args.includes(callbackFailure))
          ).toHaveLength(1)
          expect(
            diagnostics.mock.calls.filter((args) => args.includes(observerFailure))
          ).toHaveLength(1)
          expect((await feed.readChanges({ after: delivered })).changes).toHaveLength(1)
        } finally {
          await rejecting.dispose()
          diagnostics.mockRestore()
        }
        await driver.command([
          'XTRIM',
          createRedisLayout(prefix, org).durableChanges,
          'MAXLEN',
          '1'
        ])
        await expect(feed.readChanges({ after: initial.cursor })).rejects.toMatchObject({
          code: 'CHANGE_CURSOR_EXPIRED'
        })
        const keyEvent = deferred<Uint8Array>(),
          keyspace = await api.pubsub.keyspace(0, 'set', (key) => {
            if (
              new TextDecoder()
                .decode(key)
                .startsWith(createRedisLayout(prefix, crypto.randomUUID()).tag + ':t:')
            )
              keyEvent.resolve(key)
          })
        await store.set('keyspace-event', 'seen')
        expect(
          new TextDecoder()
            .decode(await keyEvent.promise)
            .startsWith(createRedisLayout(prefix, crypto.randomUUID()).tag + ':t:')
        ).toBe(true)
        await keyspace.dispose()
        await store.remove('keyspace-event')
      } finally {
        await host.dispose()
        const tag = createRedisLayout(prefix, crypto.randomUUID()).tag
        let cursor = '0'
        do {
          const result = (await driver.command([
            'SCAN',
            cursor,
            'MATCH',
            tag + ':*',
            'COUNT',
            '100'
          ])) as [string, string[]]
          cursor = result[0]
          if (result[1].length) await driver.command(['DEL', ...result[1]])
        } while (cursor !== '0')
      }
      expect(await pool.execute((client) => client.ping())).toBe('PONG')
    })
  })
}

/** Runtime admission also rejects a deliberately type-erased wrong backend before native access. */
it('rejects native Features on a memory backend', async () => {
  const failure = await createStorageHost({
    plugins: [memoryBackendPlugin({}, { streams: redisStreamsFeature() as never })] as const
  }).then(
    () => undefined,
    (error) => error as unknown
  )
  expect(failure).toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
  const chain: unknown[] = [failure],
    codes: unknown[] = []
  for (let index = 0; index < chain.length && index < 16; index++) {
    const error = chain[index]
    if (!(error instanceof Error)) continue
    codes.push(Reflect.get(error, 'code'))
    if (error.cause !== undefined) chain.push(error.cause)
    if (error instanceof AggregateError) chain.push(...error.errors)
  }
  expect(codes).toContain('BACKEND_KIND_MISMATCH')
})

/**
 * A type-erased wrong Feature fails at the real PostgreSQL installation boundary before any native
 * access.
 */
it('rejects a Redis Stream Feature on PostgreSQL before driver access', async () => {
  let nativeCalls = 0
  const driver: IPgDriver = {
    async query() {
      nativeCalls++
      return { rows: [], rowCount: 0 }
    },
    async connect() {
      nativeCalls++
      throw new Error('Wrong Feature must be rejected before PostgreSQL acquisition')
    }
  }
  const failure = await createStorageHost({
    plugins: [
      postgresBackendPlugin({ driver }, { streams: redisStreamsFeature() as never })
    ] as const
  }).then(
    () => undefined,
    (error) => error as unknown
  )
  expect(failure).toMatchObject({ code: 'BACKEND_INSTALL_FAILED' })
  const chain: unknown[] = [failure],
    codes: unknown[] = []
  for (let index = 0; index < chain.length && index < 16; index++) {
    const error = chain[index]
    if (!(error instanceof Error)) continue
    codes.push(Reflect.get(error, 'code'))
    if (error.cause !== undefined) chain.push(error.cause)
    if (error instanceof AggregateError) chain.push(...error.errors)
  }
  expect(codes).toContain('BACKEND_KIND_MISMATCH')
  expect(nativeCalls).toBe(0)
})
