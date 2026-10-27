import { storageProbe } from '@migaia/storage-host/plugins/probe'
import { afterAll, describe, expect, it } from 'vitest'
import { createClientPool } from 'redis'
import { createOrgId, createStorageHost, definePlugin } from '@migaia/storage-host'
import { kv, records, vector } from '@migaia/storage-contract'
import { snapshotConcurrencyLockKeys } from '@migaia/storage-host/authoring/concurrency'
import { redisBackendPlugin, type IRedisDriver } from '../src/index.js'
import { nodeRedisDriver } from '../src/adapters/node-redis.js'
import { RedisCommand, RedisText } from '../src/constants.js'
import { redisStreamsFeature } from '../src/features/streams.js'
import { redisSortedSetsFeature } from '../src/features/sorted-sets.js'
import { redisRateLimitFeature } from '../src/features/rate-limit.js'
import { redisPubSubFeature } from '../src/features/pubsub.js'
import { rediSearchVectorFeature } from '../src/features/search.js'
import { createRedisLayout } from '../src/layout.js'

/** Every physical renderer consumes the same original canonical namespace and org key owner. */
it('keeps default, empty, brace and Unicode namespaces in one exact nonempty native hash tag', () => {
  const tags = new Set<string>(),
    org = createOrgId(),
    identity = snapshotConcurrencyLockKeys([{ channel: 'text', key: 'point' }], RedisText.backend)
      .identities[0]!
  for (const prefix of ['migaia', '', '{}', '前缀\ud800{}']) {
    const layout = createRedisLayout(prefix, org)
    tags.add(layout.tag)
    expect(layout.tag).toMatch(/^\{[0-9a-f]+\}$/)
    const keys = [
      layout.value('text', 'point'),
      layout.value('bytes', 'point'),
      layout.value('record', ['point', 1]),
      layout.lock(identity),
      layout.vectorPoint('collection', 'point'),
      layout.vectorIndex('collection'),
      layout.feature('streams', 'jobs'),
      layout.feature('sorted', 'scores'),
      layout.feature('rate', 'quota'),
      layout.feature('pubsub', 'events'),
      layout.revisions,
      layout.durableChanges
    ]
    expect(keys.every((key) => key.slice(0, key.indexOf('}') + 1) === layout.tag)).toBe(true)
    expect(createRedisLayout(prefix, org).value('text', 'point')).toBe(
      layout.value('text', 'point')
    )
  }
  expect(tags.size).toBe(4)
})

/** Native command counts answer only the required batch/prefix and pipeline questions. */
for (const service of ['MIGAIA_REDIS_URL', 'MIGAIA_VALKEY_URL'] as const) {
  const url = process.env[service]
  describe.skipIf(!url)(service + ' native batches', () => {
    const pool = createClientPool({ url }, { maximum: 8 })
    afterAll(async () => {
      if (pool.isOpen) await pool.close()
    })
    it('uses exact default and unusual prefixes with only fresh-org native fixtures', async () => {
      if (!pool.isOpen) await pool.connect()
      const driver = nodeRedisDriver(pool)
      for (const prefix of [undefined, '', '{}', '域\ud800{}']) {
        const org = createOrgId(),
          layout = createRedisLayout(prefix ?? 'migaia', org),
          name = crypto.randomUUID()
        const host = await createStorageHost({
          plugins: [
            storageProbe(),
            redisBackendPlugin(
              { driver, prefix },
              {
                streams: redisStreamsFeature(),
                sorted: redisSortedSetsFeature(),
                rate: redisRateLimitFeature({ limit: 3, windowMs: 60000 }),
                pubsub: redisPubSubFeature()
              }
            )
          ] as const
        })
        let vectorIndex: string | undefined
        try {
          const store = host.org(org).backend('redis')
          await store.set('point', 'text')
          await store.setBytes('bytes', new Uint8Array([255]))
          await store.putRecord({ value: 1 }, ['point', 1])
          await store.api.streams.add(name, { body: new Uint8Array([1]) })
          await store.api.sortedSets.add(name, [{ member: 'one', score: 1 }])
          await store.api.rateLimit.consume(name)
          expect(await store.api.pubsub.publish(name, new Uint8Array([1]))).toBe(0)
          const physical = [
            layout.value('text', 'point'),
            layout.value('bytes', 'bytes'),
            layout.value('record', ['point', 1]),
            layout.feature('streams', name),
            layout.feature('sorted', name),
            layout.feature('rate', name)
          ]
          if (service === 'MIGAIA_REDIS_URL') {
            const search = await createStorageHost({
              plugins: [
                storageProbe(),
                redisBackendPlugin({ driver, prefix }, { search: rediSearchVectorFeature() })
              ] as const
            })
            try {
              await search
                .org(org)
                .backend('redis')
                .use(vector)
                .collection(name, { dimensions: 2, metric: 'dot' })
                .upsert([{ id: 'point', vector: [1, 2] }])
              vectorIndex = layout.vectorIndex(name)
              physical.push(layout.vectorPoint(name, 'point'))
            } finally {
              await search.dispose()
            }
          }
          expect(layout.tag).toMatch(/^\{[0-9a-f]+\}$/)
          for (const key of physical) {
            expect(key.startsWith(layout.tag + ':')).toBe(true)
            expect(await driver.command(['EXISTS', key])).toBe(1)
          }
          await host.dropOrg(org)
          for (const key of physical) expect(await driver.command(['EXISTS', key])).toBe(0)
        } finally {
          await host.dropOrg(org)
          await host.dispose()
          if (vectorIndex) await driver.command(['FT.DROPINDEX', vectorIndex])
        }
      }
    })
    it('preserves a recreated point while pruning an observed missing ordered member', async () => {
      if (!pool.isOpen) await pool.connect()
      const original = nodeRedisDriver(pool),
        prefix = crypto.randomUUID(),
        org = createOrgId(),
        layout = createRedisLayout(prefix, org),
        physical = layout.value('text', 'recreated'),
        writer = await createStorageHost({
          org,
          plugins: [storageProbe(), redisBackendPlugin({ driver: original, prefix })] as const
        })
      let recreate = false,
        prunes = 0
      const observed: IRedisDriver = {
        ...original,
        withConnection: (run) =>
          original.withConnection((connection) =>
            run({
              ...connection,
              command: async (args) => {
                const result = await connection.command(args)
                if (args[0] === RedisCommand.eval && args.includes(layout.index('text'))) prunes++
                if (
                  recreate &&
                  args[0] === RedisCommand.mget &&
                  args.includes(physical) &&
                  Array.isArray(result) &&
                  result.includes(null)
                ) {
                  recreate = false
                  await writer.backend('redis').set('recreated', 'new')
                }
                return result
              }
            })
          )
      }
      const reader = await createStorageHost({
        org,
        plugins: [storageProbe(), redisBackendPlugin({ driver: observed, prefix })] as const
      })
      try {
        await writer.backend('redis').set('recreated', 'old')
        await original.command([RedisCommand.del, physical])
        recreate = true
        expect(await reader.backend('redis').keys()).toEqual([])
        expect(prunes).toBe(1)
        expect(await reader.backend('redis').keys()).toEqual(['recreated'])
        expect(await reader.backend('redis').get('recreated')).toBe('new')
      } finally {
        await writer.backend('redis').clearAll()
        await reader.dispose()
        await writer.dispose()
      }
    })
    it('uses one MGET, one EXEC and one pipeline while rejecting invalid tails before I/O', async () => {
      if (!pool.isOpen) await pool.connect()
      const original = nodeRedisDriver(pool),
        commands: string[] = [],
        executions: (readonly (readonly (string | Uint8Array)[])[])[] = [],
        pipelines: string[] = [],
        hooks: string[] = [],
        reports: unknown[] = [],
        seen = new Set<string>(),
        failure = new Error('report-only before observer')
      const driver: IRedisDriver = {
        ...original,
        withConnection: (run) =>
          original.withConnection((connection) =>
            run({
              ...connection,
              command: (args) => {
                commands.push(args[0]!)
                return connection.command(args)
              },
              exec: (batch) => {
                executions.push(batch)
                return connection.exec(batch)
              }
            })
          )
      }
      const counting = definePlugin('batch-observer', (core) => ({
        install() {
          core.useAsyncPipeline((input, next) => {
            pipelines.push(input.operation)
            return next(input)
          })
          return {}
        }
      }))
      const host = await createStorageHost({
        plugins: [
          storageProbe(),
          redisBackendPlugin({ driver, prefix: crypto.randomUUID() }),
          counting
        ] as const,
        report: (cause) => {
          reports.push(cause)
        }
      })
      for (const hook of [
        'beforeTransaction',
        'beforeTxOperation',
        'beforeStorageOperation',
        'beforeCommit',
        'beforeLockAcquire',
        'beforeLockInspect'
      ] as const) {
        host.extensions.observe(hook, (payload) => {
          seen.add(hook)
          if (hook === 'beforeStorageOperation' && 'operation' in payload)
            hooks.push(String(payload.operation))
          throw failure
        })
        host.extensions.observe(hook, () => Promise.reject(failure))
      }
      const reset = () => {
        commands.length = 0
        executions.length = 0
        pipelines.length = 0
        hooks.length = 0
      }
      try {
        const store = host.backend('redis'),
          api = store.use(kv)
        reset()
        await api.setMany([
          { key: 'batch:a', value: 'one' },
          { key: 'batch:b', value: 'two' }
        ])
        expect(executions).toHaveLength(1)
        expect(executions[0]!.filter((command) => command[0] === 'SET')).toHaveLength(2)
        expect(pipelines).toEqual(['setMany'])
        expect(hooks).toEqual(['setMany'])
        reset()
        expect(await api.getMany(['batch:a', 'missing', 'batch:a'])).toEqual([
          'one',
          undefined,
          'one'
        ])
        expect(commands.filter((command) => command === 'MGET')).toHaveLength(1)
        expect(pipelines).toEqual(['getMany'])
        expect(hooks).toEqual(['getMany'])
        reset()
        await api.setMany([])
        expect(await api.getMany([])).toEqual([])
        expect(await api.removeMany([])).toBe(0)
        expect([commands, executions, pipelines, hooks]).toEqual([[], [], [], []])
        await expect(
          Promise.resolve().then(() =>
            api.setMany([
              { key: 'never', value: 'one' },
              { key: 'bad', value: 42 as never }
            ])
          )
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
        expect([commands, executions, pipelines, hooks]).toEqual([[], [], [], []])
        reset()
        expect(await api.removeByPrefix('batch:')).toBe(2)
        expect(commands).toContain('ZRANGEBYLEX')
        expect(commands).not.toContain('SCAN')
        expect(executions).toHaveLength(1)
        expect(pipelines).toEqual(['removeByPrefix'])
        expect(hooks).toEqual(['removeByPrefix'])
        await store
          .tx()
          .lock({ channel: 'text', key: 'locked' })
          .run(async (scope) => {
            await scope.set('locked', 'value')
            expect(await scope.get('locked')).toBe('value')
          })
        await store.inspectLocks()
        expect([...seen].sort()).toEqual(
          [
            'beforeCommit',
            'beforeLockAcquire',
            'beforeLockInspect',
            'beforeStorageOperation',
            'beforeTransaction',
            'beforeTxOperation'
          ].sort()
        )
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(reports.length).toBeGreaterThan(0)
        await store.putRecord({ value: 1 }, ['typed', 1])
        await store.putRecord({ value: 2 }, ['typed', 2])
        expect(await store.use(records).removeByPrefix(['typed'])).toBe(2)
        expect(await store.get('never')).toBeNull()
        await store.clearAll()
      } finally {
        await host.dispose()
      }
    })
  })
}
