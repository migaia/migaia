import { afterAll, describe, expect, it } from 'vitest'
import { createClientPool } from 'redis'
import Redis from 'ioredis'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { vector, ttl, durableChangeFeed, kv, records, counter } from '@migaia/storage-contract'
import { runConformance } from '@migaia/storage-contract/conformance'
import { redisBackendPlugin, type IRedisConnection, type IRedisDriver } from '../src/index.ts'
import { sleep } from '@migaia/utils/promise'
import { rediSearchVectorFeature } from '../src/features/search.ts'
import { redisChangeStreamFeature } from '../src/features/change-stream.ts'
import { nodeRedisDriver } from '../src/adapters/node-redis.ts'
import { ioredisDriver } from '../src/adapters/ioredis.ts'
import { createRedisLayout } from '../src/layout.ts'
import { vectorNames } from '../src/vector-protocol.ts'

/** Every native vector fixture owns its complete namespace and only cleans those physical keys. */
for (const service of ['MIGAIA_REDIS_URL', 'MIGAIA_REDIS_STACK_URL'] as const)
  for (const adapter of ['node', 'ioredis'] as const) {
    const url = process.env[service]
    describe.skipIf(!url)(service + ' RediSearch ' + adapter, () => {
      const pool = createClientPool({ url }, { maximum: 8 }),
        client = new Redis(url!, { lazyConnect: true }),
        driver = adapter === 'node' ? nodeRedisDriver(pool) : ioredisDriver(client),
        hosts: { dispose(): Promise<void> }[] = [],
        namespaces: string[] = []
      let connected = false
      const create = async (
        observe?: (commands: Parameters<IRedisConnection['exec']>[0]) => void,
        observeCommand?: (args: readonly (string | Uint8Array)[]) => void
      ) => {
        if (!connected) {
          if (adapter === 'node') await pool.connect()
          else await client.connect()
          connected = true
        }
        const selected: IRedisDriver = {
          ...driver,
          withConnection: (run) =>
            driver.withConnection((connection) =>
              run({
                ...connection,
                command: (args) => {
                  observeCommand?.(args)
                  return connection.command(args)
                },
                ...(connection.binaryCommand
                  ? {
                      binaryCommand: (args: readonly (string | Uint8Array)[]) => {
                        observeCommand?.(args)
                        return connection.binaryCommand!(args)
                      }
                    }
                  : {}),
                exec: (commands) => {
                  observe?.(commands)
                  return connection.exec(commands)
                }
              })
            )
        }
        const prefix = crypto.randomUUID(),
          host = await createStorageHost({
            plugins: [
              redisBackendPlugin(
                { driver: selected, prefix },
                {
                  vector: rediSearchVectorFeature(),
                  durable: redisChangeStreamFeature({ maxLen: 1000 })
                }
              )
            ] as const
          })
        hosts.push(host)
        namespaces.push(prefix)
        return { host, store: host.backend('redis'), prefix }
      }
      afterAll(async () => {
        for (const host of hosts) await host.dispose()
        if (connected)
          for (const prefix of namespaces) {
            const tag = createRedisLayout(prefix, crypto.randomUUID()).tag,
              indexes = (await driver.command(['FT._LIST'])) as string[]
            for (const index of indexes)
              if (index.startsWith(tag + ':vi:')) await driver.command(['FT.DROPINDEX', index])
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
        if (pool.isOpen) await pool.close()
        if (client.status !== 'end') client.disconnect()
      })
      it('ranks native FLOAT32 fields, filters before KNN, preserves org/TTL and counts committed deletes', async () => {
        /** Observe commands from the actual borrowed driver without replacing native execution. */
        const nativeCommands: (readonly (string | Uint8Array)[])[] = []
        const { host, store, prefix } = await create(undefined, (args) =>
            nativeCommands.push([...args])
          ),
          collection = store.use(vector).collection<{ tag: string; number: number }>('items', {
            dimensions: 2,
            metric: 'cosine'
          }),
          org = createOrgId(),
          peer = host.org(org).backend('redis'),
          other = peer.use(vector).collection<{ tag: string; number: number }>('items')
        await collection.upsert([
          { id: 'a', vector: [1, 0], payload: { tag: 'a', number: 1 } },
          { id: 'b', vector: [0.8, 0.2], payload: { tag: 'b', number: 2 } },
          { id: '\ud800', vector: [0, 1], payload: { tag: 'b', number: 3 } }
        ])
        await other.upsert([{ id: 'foreign', vector: [1, 0], payload: { tag: 'a', number: 100 } }])
        expect(
          (await collection.near([1, 0], { exact: true }).topK(3).all()).map((hit) => hit.id)
        ).toEqual(['a', 'b', '\ud800'])
        expect(
          (
            await collection
              .near([1, 0])
              .where({ tag: 'b', number: { gte: 2 } })
              .topK(1)
              .all()
          ).map((hit) => hit.id)
        ).toEqual(['b'])
        /** Correct rows alone do not prove native ranking; the same call must issue KNN to Search. */
        const searches = nativeCommands.filter((command) => command[0] === 'FT.SEARCH')
        expect(searches).toHaveLength(2)
        expect(searches.every((command) => String(command[2]).includes('KNN'))).toBe(true)
        expect(
          searches.every((command) => command.includes('PARAMS') && command.includes('DIALECT'))
        ).toBe(true)
        expect(
          await collection
            .near([1, 0])
            .where({ tag: { contains: 'b' } })
            .topK(1)
            .all()
        ).toEqual([])
        await expect(
          collection
            .near([1, 0])
            .where({ tag: { contains: 'b' } })
            .requirePushdown()
            .topK(1)
            .all()
        ).rejects.toMatchObject({ code: 'QUERY_NOT_PUSHABLE' })
        expect((await collection.similarTo('a').topK(1).all()).map((hit) => hit.id)).toEqual(['b'])
        expect(
          (
            await collection
              .recommend({ positive: ['a'] })
              .topK(1)
              .all()
          ).map((hit) => hit.id)
        ).toEqual(['b'])
        const target = { channel: 'vector', collection: 'items', id: 'a' } as const
        expect(await store.use(ttl).expire(target, 20000)).toBe(true)
        await collection.upsert([{ id: 'a', vector: [1, 0], payload: { tag: 'a', number: 4 } }])
        expect(await store.use(ttl).remaining(target)).toBeGreaterThan(10000)
        await store.transaction(async (scope) => {
          expect(await scope.use(ttl).persist(target)).toBe(true)
          expect(await scope.use(ttl).remaining(target)).toBeUndefined()
        })
        const layout = createRedisLayout(
            prefix,
            (await store.use(durableChangeFeed).readChanges()).changes[0]!.orgId!
          ),
          names = vectorNames(layout, 'items')
        expect(await driver.command(['PTTL', names.point('a')])).toBe(-1)
        expect(await driver.command(['HGET', names.point('a'), 'expiry'])).toBe('0')
        expect(() => collection.deleteWhere({ tag: { contains: 'b' } })).toThrowError(
          expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
        )
        expect(await collection.deleteWhere({ tag: 'b' }, { count: 'scroll' })).toBe(2)
        expect((await other.near([1, 0]).topK(3).all()).map((hit) => hit.id)).toEqual(['foreign'])
        await host.dropOrg(org)
        expect(await other.near([1, 0]).topK(3).all()).toEqual([])
        expect((await collection.near([1, 0]).topK(3).all()).map((hit) => hit.id)).toEqual(['a'])
        const hits = await collection.near([1, 0]).topK(1).withVector().all()
        expect(hits[0]?.vector).toEqual([1, 0])
        expect(await collection.search([1, 0], { k: 0 })).toEqual([])
        expect((await collection.near([1, 0]).where({}).topK(1).all())[0]?.id).toBe('a')
        expect(await collection.deleteWhere({})).toBe(1)
      }, 30000)
      it('preserves long IDs and keeps oversized scalar conditions outside native TAG comparisons', async () => {
        let commands = 0
        const { store } = await create(undefined, () => commands++),
          collection = store.use(vector).collection<{ scalar: string }>('long-values', {
            dimensions: 2,
            metric: 'cosine'
          }),
          first = 'shared'.repeat(1000) + 'a',
          second = 'shared'.repeat(1000) + 'b',
          scalar = 'value'.repeat(600)
        await collection.upsert([
          { id: first, vector: [1, 0], payload: { scalar } },
          { id: second, vector: [0.9, 0.1], payload: { scalar } }
        ])
        expect((await collection.similarTo(first).topK(1).all()).map((hit) => hit.id)).toEqual([
          second
        ])
        expect(
          (
            await collection
              .recommend({ positive: [first] })
              .topK(1)
              .all()
          ).map((hit) => hit.id)
        ).toEqual([second])
        const query = collection.near([1, 0]).where({ scalar }).topK(1)
        expect((await query.all())[0]).toMatchObject({ id: first, payload: { scalar } })
        const before = commands
        await expect(query.requirePushdown().all()).rejects.toMatchObject({
          code: 'QUERY_NOT_PUSHABLE'
        })
        expect(() => collection.deleteWhere({ scalar })).toThrowError(
          expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
        )
        await expect(
          collection.search([1, 0], { k: 1, filter: { field: 'scalar', eq: scalar } })
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
        expect(commands).toBe(before)
      })
      it('ranks only after the index background scan finishes, so fresh points are never missed', async () => {
        if (!connected) await create()
        /** Unrelated keys make the scans started by FT.CREATE and FT.ALTER last several seconds. */
        const filler = 'vector-scan-filler:' + crypto.randomUUID()
        for (let offset = 0; offset < 100000; offset += 5000)
          await driver.withConnection((connection) =>
            connection.exec(
              Array.from({ length: 5000 }, (_, index) => [
                'SET',
                filler + ':' + (offset + index),
                'x'
              ])
            )
          )
        /** Each FT.SEARCH records whether its index was still scanning when the query was sent. */
        const scanning: string[] = []
        const observed: IRedisDriver = {
          ...driver,
          withConnection: (run) =>
            driver.withConnection((connection) =>
              run({
                ...connection,
                binaryCommand: async (args) => {
                  if (args[0] === 'FT.SEARCH') {
                    const info = (await driver.command(['FT.INFO', String(args[1])])) as unknown
                    scanning.push(
                      String(
                        Array.isArray(info)
                          ? info[info.indexOf('indexing') + 1]
                          : (info as Record<string, unknown>).indexing
                      )
                    )
                  }
                  return connection.binaryCommand!(args)
                }
              })
            )
        }
        const prefix = crypto.randomUUID()
        const host = await createStorageHost({
          plugins: [
            redisBackendPlugin({ driver: observed, prefix }, { vector: rediSearchVectorFeature() })
          ] as const
        })
        hosts.push(host)
        namespaces.push(prefix)
        try {
          const collection = host
            .backend('redis')
            .use(vector)
            .collection<{ group: string }>('fresh-scan', { dimensions: 2, metric: 'dot' })
          await collection.upsert([
            { id: 'a', vector: [4, 1], payload: { group: 'one' } },
            { id: 'b', vector: [3, 2], payload: { group: 'two' } },
            { id: 'c', vector: [2, 3], payload: { group: 'one' } },
            { id: 'd', vector: [1, 4], payload: { group: 'two' } }
          ])
          const hits = await collection.near([1, 0], { exact: true }).topK(4).all()
          expect(hits.map((hit) => hit.id)).toEqual(['a', 'b', 'c', 'd'])
          expect(scanning).toEqual(['0'])
        } finally {
          let cursor = '0'
          do {
            const reply = (await driver.command([
              'SCAN',
              cursor,
              'MATCH',
              filler + ':*',
              'COUNT',
              '5000'
            ])) as [string, string[]]
            cursor = reply[0]
            if (reply[1].length) await driver.command(['DEL', ...reply[1]])
          } while (cursor !== '0')
        }
      }, 120000)
      it('disables the server query timeout on every search so results are never silently truncated', async () => {
        if (!connected) await create()
        /** Every FT.SEARCH argument list sent by near and deleteWhere is recorded. */
        const searches: string[][] = []
        const record = (args: readonly (string | Uint8Array)[]) => {
          if (args[0] === 'FT.SEARCH') searches.push(args.map((arg) => String(arg)))
        }
        const observed: IRedisDriver = {
          ...driver,
          withConnection: (run) =>
            driver.withConnection((connection) =>
              run({
                ...connection,
                command: (args) => {
                  record(args)
                  return connection.command(args)
                },
                binaryCommand: (args) => {
                  record(args)
                  return connection.binaryCommand!(args)
                }
              })
            )
        }
        const prefix = crypto.randomUUID()
        const host = await createStorageHost({
          plugins: [
            redisBackendPlugin({ driver: observed, prefix }, { vector: rediSearchVectorFeature() })
          ] as const
        })
        hosts.push(host)
        namespaces.push(prefix)
        const collection = host
          .backend('redis')
          .use(vector)
          .collection<{ group: string }>('no-timeout', { dimensions: 2, metric: 'dot' })
        await collection.upsert([
          { id: 'a', vector: [1, 0], payload: { group: 'one' } },
          { id: 'b', vector: [0, 1], payload: { group: 'two' } }
        ])
        expect((await collection.near([1, 0]).topK(2).all()).map((hit) => hit.id)).toEqual([
          'a',
          'b'
        ])
        expect(await collection.deleteWhere({ group: 'two' })).toBe(1)
        expect(searches.length).toBeGreaterThanOrEqual(2)
        for (const args of searches) {
          const index = args.indexOf('TIMEOUT')
          expect(index).toBeGreaterThan(0)
          expect(args[index + 1]).toBe('0')
        }
      })
      it('keeps the absolute HASH deadline and native ranking projection in one EXEC', async () => {
        const batches: Parameters<IRedisConnection['exec']>[0][] = [],
          { host, store, prefix } = await create((commands) => batches.push(commands)),
          collection = store
            .use(vector)
            .collection('deadlines', { dimensions: 2, metric: 'euclid' })
        await collection.upsert(
          ['extend', 'persist', 'control', 'overwrite'].map((id) => ({
            id,
            vector: [1, 0],
            payload: { selected: true }
          })),
          { ttlMs: 1200 }
        )
        const target = (id: string) => ({ channel: 'vector', collection: 'deadlines', id }) as const
        await store.use(ttl).expire(target('extend'), 3000)
        await store.use(ttl).persist(target('persist'))
        await collection.upsert([{ id: 'overwrite', vector: [1, 0], payload: { selected: true } }])
        const changes = await store.use(durableChangeFeed).readChanges(),
          layout = createRedisLayout(prefix, changes.changes[0]!.orgId!),
          names = vectorNames(layout, 'deadlines')
        const expiry = Number(await driver.command(['HGET', names.point('extend'), 'expiry']))
        expect(await driver.command(['PEXPIRETIME', names.point('extend')])).toBe(expiry)
        expect(await driver.command(['PTTL', names.point('persist')])).toBe(-1)
        expect(await driver.command(['HGET', names.point('persist'), 'expiry'])).toBe('0')
        expect(
          batches.some((commands) =>
            commands.some(
              (command) =>
                command[0] === 'HSET' &&
                command.includes('approximate') &&
                command.includes('exact')
            )
          )
        ).toBe(true)
        expect(
          batches.some(
            (commands) =>
              commands.some((command) => command[0] === 'HSET' && command.includes('expiry')) &&
              commands.some((command) => command[0] === 'PEXPIREAT')
          )
        ).toBe(true)
        expect(
          batches.some(
            (commands) =>
              commands.some((command) => command[0] === 'HSET' && command.includes('expiry')) &&
              commands.some((command) => command[0] === 'PERSIST')
          )
        ).toBe(true)
        await sleep(1500)
        expect(
          (await collection.near([0, 0], { exact: true }).topK(10).all())
            .map((hit) => hit.id)
            .sort()
        ).toEqual(['extend', 'persist'])
        expect(
          (await collection.near([0, 0], { exact: true }).topK(1).all())[0]?.score
        ).toBeCloseTo(-1)
        await sleep(1700)
        expect(
          (await collection.near([0, 0], { exact: true }).topK(10).all()).map((hit) => hit.id)
        ).toEqual(['persist'])
        const dot = store.use(vector).collection('dot', { dimensions: 2, metric: 'dot' })
        await dot.upsert([{ id: 'native-dot', vector: [2, 0] }])
        expect((await dot.near([3, 0], { exact: true }).topK(1).all())[0]?.score).toBeCloseTo(6)
        const locking = store.tx().lock({ channel: 'vector', collection: 'dot', id: 'native-dot' })
        await locking.run(async (scope) => {
          expect(
            await scope
              .use(ttl)
              .expire({ channel: 'vector', collection: 'dot', id: 'native-dot' }, 10000)
          ).toBe(true)
        })
        await host.dispose()
      }, 15000)
      it('drops historical org HASHes after reopening without Search or a binary port', async () => {
        const { host, prefix } = await create(),
          a = createOrgId(),
          b = createOrgId(),
          name = 'reopened',
          collectionA = host
            .org(a)
            .backend('redis')
            .use(vector)
            .collection(name, { dimensions: 2, metric: 'dot' }),
          collectionB = host.org(b).backend('redis').use(vector).collection(name)
        await collectionA.upsert([{ id: 'same', vector: [1, 0], payload: { org: 'a' } }])
        await collectionB.upsert([{ id: 'same', vector: [0, 1], payload: { org: 'b' } }])
        await host.dispose()
        const layout = createRedisLayout(prefix, a),
          pointA = layout.vectorPoint(name, 'same'),
          pointB = createRedisLayout(prefix, b).vectorPoint(name, 'same'),
          calls: string[] = []
        let replayed = false,
          nulls = 0
        const borrowed: IRedisDriver = {
          ...driver,
          command: (args) => {
            calls.push(args[0]!)
            return driver.command(args)
          },
          withConnection: (run) =>
            driver.withConnection((connection) =>
              run({
                getClient: () => connection.getClient(),
                command: (args) => {
                  calls.push(args[0]!)
                  return connection.command(args)
                },
                exec: async (commands) => {
                  if (
                    !replayed &&
                    commands.some((command) => command[0] === 'DEL' && command[1] === pointA)
                  ) {
                    replayed = true
                    await driver.command([
                      'HSET',
                      layout.revisions,
                      'unrelated-native-revision',
                      '1'
                    ])
                  }
                  const result = await connection.exec(commands)
                  if (result === null) nulls++
                  return result
                }
              })
            )
        }
        const reopened = await createStorageHost({
          plugins: [redisBackendPlugin({ driver: borrowed, prefix })] as const
        })
        hosts.push(reopened)
        expect(reopened.backend('redis').has(vector)).toBe(false)
        await reopened.dropOrg(a)
        expect(nulls).toBe(1)
        expect(await driver.command(['EXISTS', pointA])).toBe(0)
        expect(await driver.command(['EXISTS', pointB])).toBe(1)
        expect(await driver.command(['FT._LIST'])).toContain(layout.vectorIndex(name))
        expect(calls.some((command) => command.startsWith('FT.'))).toBe(false)
        expect(calls).not.toContain('HGETALL')
      })
      runConformance(
        { describe, it, expect },
        {
          name: 'native vector/TTL selected ' + adapter,
          create: async () => (await create()).store,
          capabilities: [kv, records, counter, durableChangeFeed, vector, ttl],
          features: {
            batch: true,
            syncRead: false,
            binary: true,
            records: true,
            transactions: true,
            iteration: true,
            secondaryIndexes: false,
            changeFeed: true,
            maxValueBytes: undefined,
            opaqueEntries: false
          }
        }
      )
    })
  }

/** Optional vector admission cannot make base Redis or Valkey pretend to have a native module. */
for (const url of [process.env.MIGAIA_VALKEY_URL]) {
  it.skipIf(!url)(
    'defers all native detection until explicit detect and rejects the absent module',
    async () => {
      const pool = createClientPool({ url }, { maximum: 4 })
      await pool.connect()
      const original = nodeRedisDriver(pool),
        calls: string[] = [],
        driver: IRedisDriver = {
          ...original,
          command: (args) => {
            calls.push(args[0]!)
            return original.command(args)
          },
          withConnection: (run) =>
            original.withConnection((connection) =>
              run({
                ...connection,
                command: (args) => {
                  calls.push(args[0]!)
                  return connection.command(args)
                }
              })
            )
        },
        host = await createStorageHost({
          autoDetect: false,
          plugins: [
            redisBackendPlugin(
              { driver, prefix: crypto.randomUUID() },
              { search: rediSearchVectorFeature() }
            )
          ] as const
        })
      try {
        expect(calls).toEqual([])
        const collection = host
          .backend('redis')
          .use(vector)
          .collection('docs', { dimensions: 1, metric: 'dot' })
        await expect(collection.upsert([{ id: 'a', vector: [1] }])).rejects.toMatchObject({
          code: 'UNSUPPORTED_CAPABILITY'
        })
        expect(calls).toEqual([])
        await expect(host.detect()).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
        expect(calls).toContain('FT._LIST')
        expect(calls).not.toContain('FT.CREATE')
        expect(calls).not.toContain('EXEC')
      } finally {
        await host.dispose()
        await pool.close()
      }
    }
  )
}

it.skipIf(!process.env.MIGAIA_REDIS_STACK_URL)(
  'rejects a selected vector Feature without a genuine binary connection port',
  async () => {
    const pool = createClientPool({ url: process.env.MIGAIA_REDIS_STACK_URL }, { maximum: 4 })
    await pool.connect()
    const original = nodeRedisDriver(pool),
      driver: IRedisDriver = {
        ...original,
        withConnection: (run) =>
          original.withConnection((connection) =>
            run({
              getClient: () => connection.getClient(),
              command: (args) => connection.command(args),
              exec: (commands) => connection.exec(commands)
            })
          )
      }
    try {
      await expect(
        createStorageHost({
          plugins: [
            redisBackendPlugin(
              { driver, prefix: crypto.randomUUID() },
              { search: rediSearchVectorFeature() }
            )
          ] as const
        })
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    } finally {
      await pool.close()
    }
  }
)
