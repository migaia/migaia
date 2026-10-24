import { Logger } from '@migaia/logger'
import { binlog, wal, undoLog, memoryLogStore } from '@migaia/logger/plugins/durable'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Pool } from 'pg'
import { createClientPool } from 'redis'
import { describe, expect, it } from 'vitest'
import {
  createStorageHost,
  memoryBackendPlugin,
  definePlugin,
  createOrgId
} from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
import { redisBackendPlugin, type IRedisDriver } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
import { redisChangeStreamFeature } from '@migaia/storage-plugin-redis/features/change-stream'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgvectorFeature } from '@migaia/storage-plugin-postgres/features/pgvector'
import { rediSearchVectorFeature } from '@migaia/storage-plugin-redis/features/search'
import { qdrantBackendPlugin, type IQdrantHttp } from '@migaia/storage-plugin-qdrant'
import { fetchHttp } from '@migaia/storage-plugin-qdrant/http'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { cachePlugin } from '../src/index.js'
import { vector, type IStorageChange, type IVectorCollection } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/authoring/concurrency'

/** Required service fixtures are injected by the repository's sole native-service launcher. */
const redisUrl = process.env.MIGAIA_REDIS_URL,
  pgUrl = process.env.MIGAIA_PG_URL
if (!redisUrl || !pgUrl) throw new Error('Native cache checks require the storage service launcher')
/** Native tail notifications are asynchronous; bounded polling observes business state only. */
async function until(predicate: () => Promise<boolean>) {
  for (let step = 0; step < 100; step++) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Native cache notification did not settle')
}

/** One portable business function leaves exact ranking and deletion to each original engine. */
async function vectorApplication(collection: IVectorCollection<{ kind: string }>) {
  const points = [
    { id: 'first', vector: [4, 0], payload: { kind: 'keep' } },
    { id: 'second', vector: [3, 0], payload: { kind: 'remove' } },
    { id: 'third', vector: [2, 0], payload: { kind: 'remove' } },
    { id: 'fourth', vector: [1, 0], payload: { kind: 'keep' } }
  ]
  await collection.upsert(points)
  const hits = await collection.near([1, 0], { exact: true }).topK(3).all()
  const counts: number[] = []
  for (const count of [undefined, 'precount', 'scroll'] as const) {
    counts.push(await collection.deleteWhere({ kind: 'remove' }, count ? { count } : undefined))
    expect(
      (await collection.near([1, 0], { exact: true }).topK(4).all()).map((hit) => hit.id)
    ).toEqual(['first', 'fourth'])
    await collection.upsert(points.slice(1, 3))
  }
  await collection.delete(points.map((point) => point.id))
  return { hits, counts }
}

/** One unchanged vector workflow distinguishes the default organization and two borrowed views. */
async function vectorOrganizationApplication(
  collections: readonly IVectorCollection<{ kind: string }>[],
  drop: () => Promise<void>
) {
  /** Payload markers expose cross-organization visibility even though IDs and vectors are identical. */
  const markers = ['default', 'one', 'two']
  for (const [index, collection] of collections.entries())
    await collection.upsert([{ id: 'same', vector: [1, 0], payload: { kind: markers[index]! } }])
  /** The same exact query runs before and after deleting only the middle organization. */
  const read = async () => {
    const values: (string | null)[] = []
    for (const collection of collections) {
      const hits = await collection.near([1, 0], { exact: true }).topK(1).all()
      values.push(hits[0]?.payload?.kind ?? null)
    }
    return values
  }
  const before = await read()
  await drop()
  return { before, after: await read() }
}

describe('native borrowed cache tiers', () => {
  it('shares one binlog, WAL and undo logger across Memory, SQLite and PostgreSQL', async () => {
    const pg = new Pool({ connectionString: pgUrl }),
      connection = nodeSqliteDriver(':memory:'),
      changes = memoryLogStore(),
      intents = memoryLogStore(),
      images = memoryLogStore(),
      logger = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        runtimeManager: {
          randomUUID: () => crypto.randomUUID(),
          defer: (task: () => void) => queueMicrotask(task),
          write: () => undefined
        },
        plugins: [binlog({ store: changes }), wal({ store: intents }), undoLog({ store: images })]
      }),
      host = await createStorageHost({
        plugins: [
          memoryBackendPlugin(),
          sqliteBackendPlugin({ driver: connection }),
          postgresBackendPlugin({
            driver: pgDriver(pg),
            prefix: 'shared_log_' + crypto.randomUUID().slice(0, 8)
          })
        ] as const,
        journal: { logger, namespace: 'shared-business', binlogValues: true }
      }),
      stores = [host.backend('memory'), host.backend('sqlite'), host.backend('postgres')]
    try {
      for (const store of stores) await store.set('same', 'before')
      const transactions: string[] = []
      for (const store of stores) {
        await store.transaction(async (scope) => {
          await scope.set('same', 'intermediate')
          await scope.set('same', 'after')
        })
        const record = (await logger.binlog.read(await logger.binlog.lastSeq()))[0]!,
          payload = record.payload as { txId: string; changes: unknown[] }
        expect(payload.changes).toHaveLength(2)
        expect(await logger.undo.get(payload.txId)).toHaveLength(1)
        transactions.push(payload.txId)
      }
      for (const [index, store] of stores.entries()) {
        expect(await store.get('same')).toBe('after')
        await store.undo(transactions[index]!)
        expect(await store.get('same')).toBe('before')
        const failure = new RangeError('shared logger rollback')
        await expect(
          store.transaction(async (scope) => {
            await scope.set('same', 'rolled-back')
            throw failure
          })
        ).rejects.toMatchObject({ cause: failure })
        expect(await store.get('same')).toBe('before')
      }
      const merged = await logger.binlog.read(1)
      expect(merged.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
      for (const [index, id] of ['memory', 'sqlite', 'postgres'].entries())
        expect(
          merged
            .filter(
              (entry) =>
                (entry.payload as { target: { backendInstanceId: string } }).target
                  .backendInstanceId === id
            )
            .map((entry) => entry.seq)
        ).toEqual([index + 1, index + 4, index + 7])
      expect(await logger.wal.pending()).toEqual([])
    } finally {
      await host.dispose()
      await logger.shutdown('manual')
      await connection.dispose()
      await pg.end()
    }
  })

  it('runs the same exact vector ranking and counted deletion on four native engines', async () => {
    const stackUrl = process.env.MIGAIA_REDIS_STACK_URL,
      qdrantUrl = process.env.MIGAIA_QDRANT_URL
    if (!stackUrl || !qdrantUrl)
      throw new Error('Vector checks require the storage service launcher')
    const pool = createClientPool({ url: stackUrl }, { maximum: 8 }),
      pg = new Pool({ connectionString: pgUrl }),
      native = fetchHttp(qdrantUrl),
      created: string[] = [],
      prefix = 'integrated_' + crypto.randomUUID().slice(0, 8),
      http: IQdrantHttp = {
        ...native,
        async createCollection(...args) {
          const result = await native.createCollection(...args)
          created.push(args[0])
          return result
        }
      }
    await pool.connect()
    /** An explicit configured default is also addressable through the original organization view. */
    const defaultOrg = createOrgId()
    const host = await createStorageHost({
      org: defaultOrg,
      plugins: [
        memoryBackendPlugin(),
        postgresBackendPlugin({ driver: pgDriver(pg), prefix }, { vector: pgvectorFeature() }),
        redisBackendPlugin(
          { driver: nodeRedisDriver(pool), prefix },
          { search: rediSearchVectorFeature() }
        ),
        qdrantBackendPlugin({ url: qdrantUrl, http, collectionPrefix: prefix })
      ] as const
    })
    try {
      await host.detect()
      const apis = [
        host.backend('memory').use(vector),
        host.backend('postgres').use(vector),
        host.backend('redis').use(vector),
        host.backend('qdrant').use(vector)
      ]
      for (const api of apis) {
        const result = await vectorApplication(
          api.collection<{ kind: string }>('same-business', { dimensions: 2, metric: 'dot' })
        )
        expect(result.hits.map((hit) => hit.id)).toEqual(['first', 'second', 'third'])
        expect(result.hits.map((hit) => hit.payload)).toEqual([
          { kind: 'keep' },
          { kind: 'remove' },
          { kind: 'remove' }
        ])
        result.hits.forEach((hit, index) => expect(hit.score).toBeCloseTo(4 - index, 5))
        expect(result.counts).toEqual([2, 2, 2])
      }
      /** Resolve each concrete public token before combining heterogeneous backend implementations. */
      const organizationSources = [
        (org: ReturnType<typeof createOrgId>) => host.org(org).backend('memory').use(vector),
        (org: ReturnType<typeof createOrgId>) => host.org(org).backend('postgres').use(vector),
        (org: ReturnType<typeof createOrgId>) => host.org(org).backend('redis').use(vector),
        (org: ReturnType<typeof createOrgId>) => host.org(org).backend('qdrant').use(vector)
      ]
      for (const source of organizationSources) {
        /** Each engine receives the same default/two-organization function and logical collection. */
        const one = createOrgId(),
          two = createOrgId(),
          apis = [source(defaultOrg), source(one), source(two)]
        expect(
          await vectorOrganizationApplication(
            apis.map((api) =>
              api.collection<{ kind: string }>('org-business', {
                dimensions: 2,
                metric: 'dot'
              })
            ),
            () => host.dropOrg(one)
          )
        ).toEqual({ before: ['default', 'one', 'two'], after: ['default', null, 'two'] })
      }
    } finally {
      await host.dispose()
      for (const name of created) await native.deleteCollection(name)
      await pool.close()
      await pg.end()
    }
  })

  it('shares one Redis source load across independent Node processes that both miss', async () => {
    const prefix = 'cache_process_' + crypto.randomUUID().replaceAll('-', ''),
      pool = createClientPool({ url: redisUrl }, { maximum: 8 })
    await pool.connect()
    const host = await createStorageHost({
      plugins: [redisBackendPlugin({ id: 'redis', driver: nodeRedisDriver(pool), prefix })]
    })
    await host.detect()
    try {
      const execute = promisify(execFile)
      const results = await Promise.all(
        [0, 1].map(() =>
          execute('rtk', ['proxy', 'node', 'test/stampede.mts', prefix], {
            env: process.env,
            timeout: 15000
          })
        )
      )
      for (const result of results)
        expect(JSON.parse(result.stdout.trim().split('\n').at(-1)!)).toEqual({
          value: 'shared-native-source'
        })
      expect(Number(await pool.sendCommand(['GET', prefix + ':reads']))).toBeGreaterThanOrEqual(2)
      expect(await pool.sendCommand(['GET', prefix + ':loads'])).toBe('1')
      expect(await host.backend('redis').get('cache:cache:same')).toContain('shared-native-source')
      const configured = await host.use(
        cachePlugin({
          propagate: false,
          tiers: [{ backend: 'redis', ttlMs: 10000 }],
          stampedeLock: { backend: 'redis', timeoutMs: 20 }
        })
      )
      await configured.detect()
      let entered!: () => void,
        release!: () => void,
        loads = 0
      const began = new Promise<void>((resolve) => {
          entered = resolve
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve
        })
      const holder = host
        .backend('redis')
        .tx()
        .lock(lockKey.text('cache:cache:timeout'))
        .run(async () => {
          entered()
          await gate
        })
      await began
      try {
        await expect(
          configured.backend('cache').getOrLoad('timeout', async () => {
            loads++
            return 'wrong'
          })
        ).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' })
        expect(loads).toBe(0)
        expect(await host.backend('redis').get('cache:cache:timeout')).toBeNull()
      } finally {
        release()
        await holder
      }
      const native = nodeRedisDriver(pool)
      let executions = 0,
        aborted = 0,
        replayLoads = 0
      const counted: IRedisDriver = {
        ...native,
        withConnection: (run) =>
          native.withConnection((connection) =>
            run({
              ...connection,
              async exec(commands) {
                if (++executions === 1)
                  await host.backend('redis').set('unrelated-replay', 'outside-commit')
                const result = await connection.exec(commands)
                if (result === null) aborted++
                return result
              }
            })
          )
      }
      const replayBase = await createStorageHost({
        plugins: [
          memoryBackendPlugin({ id: 'memory' }),
          redisBackendPlugin({ id: 'redis', driver: counted, prefix })
        ]
      })
      const replay = await replayBase.use(
        cachePlugin({
          propagate: false,
          tiers: [
            { backend: 'memory', ttlMs: 10000 },
            { backend: 'redis', ttlMs: 10000 }
          ],
          stampedeLock: { backend: 'redis' }
        })
      )
      await replay.detect()
      try {
        expect(
          await replay.backend('cache').getOrLoad('replayed', async () => {
            replayLoads++
            return 'consistent-after-watch-abort'
          })
        ).toBe('consistent-after-watch-abort')
        expect(aborted).toBe(1)
        expect(replayLoads).toBeGreaterThanOrEqual(1)
        expect(replayLoads).toBeLessThanOrEqual(2)
        expect(JSON.parse((await replay.backend('memory').get('cache:cache:replayed'))!).d).toBe(
          JSON.parse((await replay.backend('redis').get('cache:cache:replayed'))!).d
        )
      } finally {
        await replay.dispose()
      }
    } finally {
      await host.backend('redis').clearAll()
      await pool.sendCommand(['DEL', prefix + ':reads', prefix + ':loads'])
      await host.dispose()
      await pool.close()
    }
  }, 20000)
  it('combines Memory, SQLite, Redis and PostgreSQL through actual public entries', async () => {
    const pool = createClientPool({ url: redisUrl }, { maximum: 8 }),
      pg = new Pool({ connectionString: pgUrl })
    await pool.connect()
    const prefix = 'cache_native_' + crypto.randomUUID().replaceAll('-', '')
    const base = await createStorageHost({
      plugins: [
        memoryBackendPlugin({ id: 'memory' }),
        sqliteBackendPlugin({ id: 'sqlite', driver: nodeSqliteDriver(':memory:') }),
        sqliteBackendPlugin({ id: 'tail', driver: nodeSqliteDriver(':memory:') }),
        redisBackendPlugin({ id: 'redis', driver: nodeRedisDriver(pool), prefix }),
        postgresBackendPlugin({ id: 'postgres', driver: pgDriver(pg), prefix })
      ]
    })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        tiers: [
          { backend: 'memory', ttlMs: 10000 },
          { backend: 'sqlite' },
          { backend: 'redis', ttlMs: 10000 },
          { backend: 'postgres' }
        ],
        maxAgeMs: 10000
      })
    )
    await host.detect()
    try {
      const cache = host.backend('cache')
      expect(await cache.getOrLoad('answer', async () => ({ value: 'native' }))).toEqual({
        value: 'native'
      })
      for (const id of ['memory', 'sqlite', 'redis', 'postgres'] as const)
        expect(await host.backend(id).get('cache:cache:answer')).toContain('native')
      await host.backend('memory').remove('cache:cache:answer')
      await host.backend('sqlite').remove('cache:cache:answer')
      expect(await cache.getOrLoad('answer', async () => 'wrong')).toEqual({ value: 'native' })
      expect(await host.backend('memory').get('cache:cache:answer')).toBe(
        await host.backend('redis').get('cache:cache:answer')
      )
      const values = await cache.getOrLoadMany(
        ['x', 'y'],
        async (keys) => new Map(keys.map((key) => [key, 'batch:' + key]))
      )
      expect(values).toEqual(
        new Map([
          ['x', 'batch:x'],
          ['y', 'batch:y']
        ])
      )
      const configured = await host.use(
        cachePlugin({
          id: 'back',
          prefix: 'own-back:',
          writeBackIntervalMs: 10000,
          tiers: [
            { backend: 'memory', ttlMs: 10000 },
            { backend: 'redis', ttlMs: 10000 },
            { backend: 'sqlite', ttlMs: 10000, write: 'back' },
            { backend: 'tail', ttlMs: 10000 }
          ]
        })
      )
      await configured.detect()
      const back = configured.backend('back')
      const notifications: IStorageChange[] = []
      const off = host.backend('redis').subscribeChanges((change) => {
        notifications.push(change)
      })
      await back.set('self-notification', 'preserved-pending')
      await until(async () =>
        notifications.some(
          (change) =>
            change.channel === 'value' && change.keys?.includes('own-back:self-notification')
        )
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
      await back.flush()
      expect(await host.backend('sqlite').get('own-back:self-notification')).toContain(
        'preserved-pending'
      )
      off()
      await back.clearAll()
      const org = host.org(crypto.randomUUID()).backend('cache')
      await org.set('answer', 'isolated')
      expect(await cache.get('answer')).toBeNull()
      expect(await org.get('answer')).toBe('isolated')
      await org.clearAll()
      await cache.clearAll()
    } finally {
      await host.dispose()
      await pool.close()
      await pg.end()
    }
  })
  it('invalidates an upper native SQLite copy and resumes from its persisted Redis cursor', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cache-feed-')),
      path = join(directory, 'upper.sqlite')
    const pool = createClientPool({ url: redisUrl }, { maximum: 8 })
    await pool.connect()
    const prefix = 'cache_feed_' + crypto.randomUUID().replaceAll('-', ''),
      driver = nodeRedisDriver(pool),
      reports: unknown[] = []
    let failNextDelete = false,
      failedDeletes = 0
    const failure = new RangeError('native invalidation failed')
    const observer = definePlugin('invalidation-observer', (core) => ({
      install() {
        core.useAsyncPipeline((input, next) => {
          if (failNextDelete && input.backendId === 'upper' && input.operation === 'remove') {
            failNextDelete = false
            failedDeletes++
            throw failure
          }
          return next(input)
        })
        return {}
      }
    }))
    const open = async () => {
      const base = await createStorageHost({
        report: (error) => {
          reports.push(error)
        },
        plugins: [
          sqliteBackendPlugin({ id: 'upper', driver: nodeSqliteDriver(path) }),
          redisBackendPlugin(
            { id: 'lower', driver, prefix },
            { history: redisChangeStreamFeature({ maxLen: 1000 }) }
          ),
          observer
        ]
      })
      const host = await base.use(
        cachePlugin({
          tiers: [
            { backend: 'upper', ttlMs: 10000 },
            { backend: 'lower', ttlMs: 10000 }
          ]
        })
      )
      await host.detect()
      return host
    }
    let host = await open()
    const peer = await createStorageHost({
      plugins: [
        redisBackendPlugin(
          { id: 'lower', driver, prefix },
          { history: redisChangeStreamFeature({ maxLen: 1000 }) }
        )
      ]
    })
    await peer.detect()
    try {
      await host.backend('cache').set('a', 'initial')
      await until(
        async () => (await host.backend('upper').get('cache:cache:$cache.cursor')) !== null
      )
      await host.backend('cache').get('a')
      const raw = JSON.parse((await peer.backend('lower').get('cache:cache:a'))!)
      await peer
        .backend('lower')
        .set('cache:cache:a', JSON.stringify({ ...raw, d: 'external', w: Date.now() }))
      await until(async () => (await host.backend('upper').get('cache:cache:a')) === null)
      expect(await host.backend('cache').get('a')).toBe('external')
      await until(
        async () => (await host.backend('upper').get('cache:cache:$cache.cursor')) !== null
      )
      const offline = ['offline-1', 'offline-2', 'offline-3', 'offline-4']
      const beforeOffline = await host.backend('upper').get('cache:cache:$cache.cursor')
      for (const key of offline) await host.backend('cache').set(key, 'before-stop')
      await until(
        async () => (await host.backend('upper').get('cache:cache:$cache.cursor')) !== beforeOffline
      )
      for (const key of offline) {
        expect(await host.backend('cache').get(key)).toBe('before-stop')
        expect(await host.backend('upper').get('cache:cache:' + key)).not.toBeNull()
      }
      await host.dispose()
      await peer
        .backend('lower')
        .set('cache:cache:a', JSON.stringify({ ...raw, d: 'while-stopped', w: Date.now() }))
      for (const key of offline) {
        const entry = JSON.parse((await peer.backend('lower').get('cache:cache:' + key))!)
        await peer
          .backend('lower')
          .set(
            'cache:cache:' + key,
            JSON.stringify({ ...entry, d: 'after-stop:' + key, w: Date.now() })
          )
      }
      host = await open()
      await until(async () => (await host.backend('upper').get('cache:cache:a')) === null)
      for (const key of offline) {
        await until(async () => (await host.backend('upper').get('cache:cache:' + key)) === null)
        expect(await host.backend('cache').get(key)).toBe('after-stop:' + key)
        await host.backend('cache').remove(key)
      }
      expect(await host.backend('cache').get('a')).toBe('while-stopped')
      await host.backend('cache').set('missing-cursor', 'stale-upper')
      await until(
        async () => (await host.backend('upper').get('cache:cache:$cache.cursor')) !== null
      )
      await host.backend('upper').remove('cache:cache:$cache.cursor')
      await host.dispose()
      const missingRaw = JSON.parse(
        (await peer.backend('lower').get('cache:cache:missing-cursor'))!
      )
      await peer
        .backend('lower')
        .set(
          'cache:cache:missing-cursor',
          JSON.stringify({ ...missingRaw, d: 'after-cursor-loss', w: Date.now() })
        )
      host = await open()
      await until(
        async () => (await host.backend('upper').get('cache:cache:missing-cursor')) === null
      )
      expect(await host.backend('cache').get('missing-cursor')).toBe('after-cursor-loss')
      await host.backend('cache').remove('missing-cursor')
      const orgId = crypto.randomUUID(),
        orgCache = host.org(orgId).backend('cache')
      await orgCache.set('a', 'org-only')
      const orgRaw = JSON.parse((await peer.org(orgId).backend('lower').get('cache:cache:a'))!)
      await peer
        .org(orgId)
        .backend('lower')
        .set('cache:cache:a', JSON.stringify({ ...orgRaw, d: 'org-updated', w: Date.now() }))
      await until(
        async () => (await host.org(orgId).backend('upper').get('cache:cache:a')) === null
      )
      expect(await orgCache.get('a')).toBe('org-updated')
      expect(await host.backend('cache').get('a')).toBe('while-stopped')
      await new Promise((resolve) => setTimeout(resolve, 10))
      const beforeFailedCursor = await host.backend('upper').get('cache:cache:$cache.cursor')
      expect(await host.backend('cache').keys()).toEqual(['a'])
      expect(() => host.backend('cache').set('$cache.cursor', 'caller data')).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
      expect(await host.backend('upper').get('cache:cache:$cache.cursor')).toBe(beforeFailedCursor)
      failNextDelete = true
      await peer
        .backend('lower')
        .set('cache:cache:a', JSON.stringify({ ...raw, d: 'delete-failed', w: Date.now() }))
      await until(async () => failedDeletes === 1)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(await host.backend('upper').get('cache:cache:$cache.cursor')).toBe(beforeFailedCursor)
      expect(await host.backend('upper').get('cache:cache:a')).not.toBeNull()
      await peer.backend('lower').set('outside-cache', 'next native batch')
      await until(async () => (await host.backend('upper').get('cache:cache:a')) === null)
      expect(await host.backend('cache').get('a')).toBe('delete-failed')
      expect(reports.length).toBeGreaterThan(0)
      await orgCache.clearAll()
      await host.backend('cache').clearAll()
      await peer.backend('lower').clearAll()
    } finally {
      await host.dispose()
      await peer.dispose()
      await pool.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it('resets stale upper data when a persisted native cursor expires', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cache-expired-feed-')),
      path = join(directory, 'upper.sqlite')
    const pool = createClientPool({ url: redisUrl }, { maximum: 8 })
    await pool.connect()
    const prefix = 'cache_expired_' + crypto.randomUUID().replaceAll('-', ''),
      driver = nodeRedisDriver(pool),
      reports: unknown[] = []
    const open = async () => {
      const base = await createStorageHost({
        report: (error) => {
          reports.push(error)
        },
        plugins: [
          sqliteBackendPlugin({ id: 'upper', driver: nodeSqliteDriver(path) }),
          redisBackendPlugin(
            { id: 'lower', driver, prefix },
            { history: redisChangeStreamFeature({ maxLen: 1 }) }
          )
        ]
      })
      const host = await base.use(
        cachePlugin({
          tiers: [
            { backend: 'upper', ttlMs: 10000 },
            { backend: 'lower', ttlMs: 10000 }
          ]
        })
      )
      await host.detect()
      return host
    }
    let host = await open()
    const peer = await createStorageHost({
      plugins: [
        redisBackendPlugin(
          { id: 'lower', driver, prefix },
          { history: redisChangeStreamFeature({ maxLen: 1 }) }
        )
      ]
    })
    await peer.detect()
    try {
      await host.backend('cache').set('a', 'original')
      await until(
        async () => (await host.backend('upper').get('cache:cache:$cache.cursor')) !== null
      )
      await host.backend('cache').get('a')
      const cursor = await host.backend('upper').get('cache:cache:$cache.cursor')
      expect(cursor).not.toBeNull()
      const raw = JSON.parse((await peer.backend('lower').get('cache:cache:a'))!)
      await host.dispose()
      for (let index = 0; index < 120; index++)
        await peer
          .backend('lower')
          .set('cache:cache:a', JSON.stringify({ ...raw, d: 'replacement', w: Date.now() }))
      host = await open()
      await until(async () => (await host.backend('upper').get('cache:cache:a')) === null)
      expect(await host.backend('cache').get('a')).toBe('replacement')
      expect(
        reports.some(
          (error) =>
            error instanceof Error && Reflect.get(error, 'code') === 'CHANGE_CURSOR_EXPIRED'
        )
      ).toBe(true)
      await peer
        .backend('lower')
        .set('cache:cache:a', JSON.stringify({ ...raw, d: 'continued', w: Date.now() }))
      await until(async () => (await host.backend('upper').get('cache:cache:a')) === null)
      expect(await host.backend('cache').get('a')).toBe('continued')
      await host.backend('cache').clearAll()
      await peer.backend('lower').clearAll()
    } finally {
      await host.dispose()
      await peer.dispose()
      await pool.close()
      await rm(directory, { recursive: true, force: true })
    }
  }, 20000)
})
