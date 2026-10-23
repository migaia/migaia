import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, onTestFinished, vi } from 'vitest'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { deferred } from '@migaia/utils/promise'
import {
  kv,
  records,
  sqlFragment,
  lockKey,
  ConcurrencyPolicy,
  compareStorageKeys,
  type IStorageKey
} from '@migaia/storage-contract'
import { sqliteBackendPlugin, type ISqliteValue } from '../src/index.js'
import { nodeSqliteDriver } from '../src/node.js'

/** Each case owns its actual file and disposes host before the borrowed native connection. */
async function installed(options: { wal?: boolean; memory?: boolean; native?: string[] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-'))
  const path = options.memory ? ':memory:' : join(directory, 'data.sqlite')
  const connection = nodeSqliteDriver(path)
  /** Existing injected-driver calls expose actual native execution even when prepare is cached. */
  const driver = options.native
    ? {
        exec: (text: string) => {
          options.native!.push(text)
          connection.exec(text)
        },
        prepare: (text: string) => {
          const statement = connection.prepare(text)
          return {
            run: (...values: readonly ISqliteValue[]) => {
              options.native!.push(text)
              return statement.run(...values)
            },
            get: (...values: readonly ISqliteValue[]) => {
              options.native!.push(text)
              return statement.get(...values)
            },
            all: (...values: readonly ISqliteValue[]) => {
              options.native!.push(text)
              return statement.all(...values)
            }
          }
        }
      }
    : connection
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver, wal: options.wal })] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  return { store: host.backend('sqlite'), host, connection, path }
}

describe('native SQLite installation', () => {
  it('runs native root and scoped batches with canonical keys and one count observation', async () => {
    /** Actual hook payloads prove that one public batch never expands into per-key operations. */
    const observations: Array<{ operation: string; count?: number }> = []
    /** Pipeline entry counts distinguish native batches from loops over public single methods. */
    const operations: string[] = []
    /** Caller ownership survives both failed batch validation and host release. */
    const connection = nodeSqliteDriver(':memory:')
    /** One existing host execution stage observes the actual native endpoints. */
    const execution = definePlugin('batch-execution', (core) => ({
      install() {
        core.usePipeline((context, next) => {
          operations.push(context.operation)
          return next(context)
        })
        return {}
      }
    }))
    /** Hooks receive only the canonical operation/count identity, never the batch values. */
    const host = await createStorageHost({
      hooks: {
        afterStorageOperation: (payload) => {
          observations.push({ operation: payload.operation, count: payload.count })
        }
      },
      plugins: [execution, sqliteBackendPlugin({ driver: connection })] as const
    })
    onTestFinished(async () => {
      await host.dispose()
      await connection.dispose()
    })
    /** Strict standard admission must publish all eleven methods before any business I/O. */
    const store = host.backend('sqlite')
    /** Equal tuples and signed zero retain the contract owner's canonical identity. */
    const keys: IStorageKey[] = [['batch', 1], -0, ['batch', 1], 'missing']
    await store.use(kv).setMany([
      { key: keys[0]!, value: 'tuple' },
      { key: 0, value: 'zero' }
    ])
    expect(await store.use(kv).getMany(keys)).toEqual(['tuple', 'zero', 'tuple', undefined])
    expect(operations).toEqual(['setMany', 'getMany'])
    expect(observations).toEqual([
      { operation: 'setMany', count: 2 },
      { operation: 'getMany', count: 4 }
    ])
    /** Empty admitted calls do not open a native transaction, pipeline, or hook. */
    const native = vi.spyOn(connection, 'prepare')
    operations.length = 0
    observations.length = 0
    expect(await store.use(kv).getMany([])).toEqual([])
    await store.use(kv).setMany([])
    expect(await store.use(kv).removeMany([])).toBe(0)
    expect(native).not.toHaveBeenCalled()
    expect(operations).toEqual([])
    expect(observations).toEqual([])
    /** Duplicate structural writes reject before the first native request or partial mutation. */
    await expect(
      store.use(kv).setMany([
        { key: ['duplicate', 1], value: 'first' },
        { key: ['duplicate', 1], value: 'second' }
      ])
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(native).not.toHaveBeenCalled()
    expect(await store.use(kv).getMany([['duplicate', 1]])).toEqual([undefined])
    /** Removal counts distinct physical rows and preserves caller key order for reads. */
    expect(await store.use(kv).removeMany([0, -0, ['absent']])).toBe(1)
    expect(await store.use(kv).removeByPrefix(['batch'])).toBe(1)
    /** Scope batches use the original native transaction and expire with that original owner. */
    let expired!: Parameters<Parameters<typeof store.transaction>[0]>[0]
    await store.transaction(async (tx) => {
      expired = tx
      await tx.use(kv).setMany([{ key: ['scoped', 1], value: 'draft' }])
      expect(
        await tx.use(kv).getMany([
          ['scoped', 1],
          ['scoped', 1]
        ])
      ).toEqual(['draft', 'draft'])
      expect(
        await tx.use(kv).removeMany([
          ['scoped', 1],
          ['scoped', 1]
        ])
      ).toBe(1)
      await tx.setMany([{ key: ['kept', 1], value: 'committed', ttlMs: 0.5 }])
    })
    await expect(expired.getMany([])).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    /** Mid-batch native failure rolls back preceding writes and preserves the original cause. */
    await store.putRecord({ other: true }, 'conflicting')
    await expect(
      store.use(kv).setMany([
        { key: 'must-rollback', value: 'first' },
        { key: 'conflicting', value: 'second' }
      ])
    ).rejects.toMatchObject({ code: 'DUPLICATE_KEY' })
    expect(await store.get('must-rollback')).toBeNull()
  })

  it('chunks native IN batches in one snapshot and rejects absent lock channels before I/O', async () => {
    /** More than one native parameter chunk exercises the real builtin statement path. */
    const native: string[] = []
    const { store } = await installed({ memory: true, native })
    /** Canonical tuple keys exercise physical text encoding without adding string-only aliases. */
    const entries = Array.from({ length: 1005 }, (_, index) => ({
      key: ['chunk', index],
      value: String(index)
    }))
    await store.use(kv).setMany(entries)
    native.length = 0
    expect(await store.use(kv).getMany(entries.map(({ key }) => key))).toEqual(
      entries.map(({ value }) => value)
    )
    expect(native[0]).toBe('BEGIN DEFERRED')
    expect(native.at(-1)).toBe('COMMIT')
    expect(native.filter((text) => text.startsWith('SELECT key,value'))).toHaveLength(2)
    expect(
      await store.use(kv).removeMany([
        ['chunk', 0],
        ['chunk', 0],
        ['chunk', 1]
      ])
    ).toBe(2)
    await store.use(kv).setMany(entries.slice(0, 2))
    await store.transaction(async (tx) => {
      expect(await tx.getMany(entries.map(({ key }) => key))).toEqual(
        entries.map(({ value }) => value)
      )
      expect(await tx.removeMany(entries.map(({ key }) => key))).toBe(1005)
    })
    expect(await store.use(kv).removeByPrefix(['chunk'])).toBe(0)
    /** Unsupported domains never use an absent .key field or touch the physical connection. */
    native.length = 0
    await expect(
      store
        .tx()
        .lock(lockKey.vector('collection', 'point'))
        .run(() => undefined)
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    await expect(
      store
        .tx()
        .lock(
          lockKey.rdf({
            subject: { termType: 'NamedNode', value: 'urn:test:subject' },
            predicate: { termType: 'NamedNode', value: 'urn:test:predicate' },
            object: { termType: 'NamedNode', value: 'urn:test:object' },
            graph: { termType: 'DefaultGraph' }
          })
        )
        .run(() => undefined)
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(native).toEqual([])
  })

  it('rejects null root write contexts before native admission', async () => {
    /** The real installed backend retains its original native and mutation owners. */
    const { store, host, connection } = await installed({ memory: true })
    /** Invalid context capture must finish before the first native statement is prepared. */
    const native = vi.spyOn(connection, 'prepare')
    await expect(store.set('null-context', 'must-not-write', null as never)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(native).not.toHaveBeenCalled()
    expect(await store.get('null-context')).toBeNull()
    await store.set('null-context', 'valid')
    expect(await store.get('null-context')).toBe('valid')
    await host.dispose()
  })

  it('uses the actual host, three channels, sync and metadata with atomic replacement', async () => {
    const { store } = await installed()
    await store.set('text', 'a\u0000\ud800')
    expect(store.sync.get('text')).toBe('a\u0000\ud800')
    expect(store.sync.keys()).toEqual(['text'])
    const bytes = new Uint8Array([1, 2])
    await store.setBytes('bytes', bytes)
    bytes[0] = 9
    expect(await store.getBytes('bytes')).toEqual(new Uint8Array([1, 2]))
    await store.putRecord({ nested: new Map([['key', new Set([1, 2])]]) }, [1, 'record'])
    expect(await store.getRecord([1, 'record'])).toEqual({
      nested: new Map([['key', new Set([1, 2])]])
    })
    await store.metadata.set('\ud800\u0000', { keep: true })
    await expect(store.setBytes('text', new Uint8Array([5]))).rejects.toMatchObject({
      source: '@migaia/storage-plugin-sqlite',
      code: 'DUPLICATE_KEY'
    })
    await store.setBytes('text', new Uint8Array([5]), { conflictPolicy: 'replace' })
    expect(await store.get('text')).toBeNull()
    expect(await store.getBytes('text')).toEqual(new Uint8Array([5]))
    await store.clearAll()
    expect(await store.getBytes('text')).toBeNull()
    expect(await store.getRecord([1, 'record'])).toBeUndefined()
    expect(await store.metadata.get('\ud800\u0000')).toEqual({ keep: true })
    expect(store.use(kv).sync).toBe(store.sync)
  })

  it('commits and rolls back SQL and all channels on the same native connection', async () => {
    const { store } = await installed()
    await store.sql`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT)`.run()
    const primary = new Error('rollback marker')
    await expect(
      store.transaction(async (tx) => {
        await tx.sql`INSERT INTO users(id,name) VALUES(${1},${'Alice'})`.run()
        await tx.set('count', '1')
        await tx.setBytes('binary', new Uint8Array([1]))
        await tx.putRecord({ id: 1 }, 1)
        throw primary
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: primary })
    expect(await store.sql`SELECT * FROM users`.all()).toEqual([])
    expect(await store.get('count')).toBeNull()
    const marker = { value: 1 }
    expect(
      await store.transaction(async (tx) => {
        await tx.sql`INSERT INTO users VALUES(${1},${'Alice'})`.run()
        await tx.set('count', '1')
        return marker
      })
    ).toBe(marker)
    expect(await store.sql`SELECT name FROM users`.get()).toMatchObject({ name: 'Alice' })
    expect(await store.get('count')).toBe('1')
    await store.metadata.set('private', { version: 1 })
    await store.transaction(async (tx) => {
      await expect(store.metadata.set('private', { version: 2 })).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED'
      })
      await expect(store.metadata.delete('private')).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED'
      })
      await tx.set('after-metadata-rejection', 'committed')
    })
    expect(await store.metadata.get('private')).toEqual({ version: 1 })
    expect(await store.get('after-metadata-rejection')).toBe('committed')
    await store.metadata.delete('private')
    expect(await store.metadata.get('private')).toBeUndefined()
  })

  it('locks caught operation and SQL scanner failures into the original transaction owner', async () => {
    const { store } = await installed()
    let expired!: Parameters<Parameters<typeof store.transaction>[0]>[0]
    await store.transaction(async (tx) => {
      expired = tx
      await tx.set('ok', '1')
    })
    await expect(expired.set('late', '2')).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    await expect(
      store.transaction(async (tx) => {
        await tx.set('sentinel', '1')
        await tx.sql`COMMIT`.run().catch(() => undefined)
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: { code: 'INVALID_ARGUMENT' } })
    expect(await store.get('sentinel')).toBeNull()
    await expect(
      store.transaction(async (tx) => {
        await tx.set('validation-sentinel', '1')
        await tx.putRecord({}, NaN).catch(() => undefined)
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: { code: 'INVALID_KEY' } })
    expect(await store.get('validation-sentinel')).toBeNull()
    await expect(
      store.transaction(async (tx) => {
        await tx.set('batch-sentinel', '1')
        await tx
          .setMany([
            { key: ['duplicate'], value: 'a' },
            { key: ['duplicate'], value: 'b' }
          ])
          .catch(() => undefined)
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: { code: 'INVALID_ARGUMENT' } })
    expect(await store.get('batch-sentinel')).toBeNull()
  })

  it('keeps canonical key order and real query/transaction capability projections', async () => {
    const { store } = await installed({ memory: true })
    const keys: IStorageKey[] = [
      2,
      -2,
      0.5,
      new Date(0),
      '\ue000',
      '\ud800\udc00',
      new Uint8Array([0, 255]).buffer,
      [1, 'a'],
      [1]
    ]
    for (const [index, key] of keys.entries()) await store.putRecord({ index }, key)
    const actual: IStorageKey[] = []
    for await (const [key] of store.iterateRecords()) actual.push(key)
    expect(actual).toEqual(keys.toSorted(compareStorageKeys))
    expect(
      await store
        .use(records)
        .query<{ index: number }>()
        .where('index', 'gte', 2)
        .select('index')
        .all()
    ).toHaveLength(keys.length - 2)
    await store.transaction(async (tx) => {
      await tx.use(kv).setMany([
        { key: ['cache', 1], value: 'a' },
        { key: ['cache', 2], value: 'b' }
      ])
      expect(
        await tx.use(kv).getMany([['cache', 2], ['absent'], ['cache', 1], ['cache', 2]])
      ).toEqual(['b', undefined, 'a', 'b'])
      expect(await tx.use(kv).removeByPrefix(['cache'])).toBe(2)
      expect(
        await tx.use(records).query<{ index: number }>().where('index', 'eq', 1).all()
      ).toHaveLength(1)
    })
  })

  it('preserves exact integers, injection-safe shared SQL and recoverable journal modes', async () => {
    const { store, connection } = await installed()
    expect(await store.sql`PRAGMA journal_mode`.get()).toMatchObject({ journal_mode: 'wal' })
    await store.sql`CREATE TABLE ${sqlFragment.id('a"b')}(value INTEGER,payload TEXT)`.run()
    await store.sql`INSERT INTO ${sqlFragment.id('a"b')} VALUES(${9007199254740993n},${"x'); DROP TABLE users; --"})`.run()
    expect(await store.sql`SELECT * FROM ${sqlFragment.id('a"b')}`.get()).toMatchObject({
      value: 9007199254740993n,
      payload: "x'); DROP TABLE users; --"
    })
    await expect(store.sql`PRAGMA main.'journal_mode'(OFF)`.run()).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    await store.dispose()
    expect(connection.prepare('SELECT 1 AS n').get()).toMatchObject({ n: 1 })
    const memory = nodeSqliteDriver(':memory:')
    try {
      await expect(
        createStorageHost({
          plugins: [sqliteBackendPlugin({ driver: memory, wal: true })] as const
        })
      ).rejects.toBeDefined()
      expect(memory.prepare('SELECT 1 AS n').get()).toMatchObject({ n: 1 })
    } finally {
      await memory.dispose()
    }
  })

  it('reports actual logical contention while preserving active native ownership', async () => {
    const { store } = await installed({ memory: true })
    let enter!: () => void
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = store
      .tx()
      .lock(lockKey.text('shared'))
      .run(async (tx) => {
        enter()
        await released
        await tx.set('shared', 'one')
      })
    await entered
    await expect(
      store
        .tx()
        .lock(lockKey.text('shared'))
        .concurrency(ConcurrencyPolicy.fail())
        .run(() => undefined)
    ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
    await expect(store.get('shared')).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    release()
    await first
    expect(await store.get('shared')).toBe('one')
  })

  it.each([true, false])(
    'separates same-key conflict from native physical waiting with wal=%s',
    async (wal) => {
      const { store, path } = await installed({ wal })
      const connection = nodeSqliteDriver(path)
      const other = await createStorageHost({
        plugins: [sqliteBackendPlugin({ driver: connection, wal })] as const
      })
      onTestFinished(async () => {
        await other.dispose()
        await connection.dispose()
      })
      const second = other.backend('sqlite')
      let pipelineCalls = 0
      await other.use(
        definePlugin('redirect', (core) => ({
          install() {
            core.usePipeline((request, next) => {
              if (
                request.operation === 'set' &&
                (request.input as { key?: unknown }).key === 'redirect'
              ) {
                pipelineCalls++
                return next({ ...request, input: { key: 'shared', value: 'redirected' } })
              }
              return next(request)
            })
            return {}
          }
        }))
      )
      let enter!: () => void
      const entered = new Promise<void>((resolve) => {
        enter = resolve
      })
      let release!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      const first = store
        .tx()
        .lock(lockKey.text('shared'))
        .run(async (tx) => {
          await tx.set('shared', 'one')
          enter()
          await released
        })
      await entered
      expect(await second.inspectLocks()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: { channel: 'text', key: 'shared' }, expired: false })
        ])
      )
      await expect(
        second
          .tx()
          .lock(lockKey.text('shared'))
          .concurrency(ConcurrencyPolicy.fail())
          .run(() => undefined)
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      expect(() => second.sync.set('shared', 'blocked')).toThrowError(
        expect.objectContaining({ code: 'LOCK_REJECTED' })
      )
      const reads = { lock: 0, concurrency: 0, signal: 0, timeoutMs: 0, conflictPolicy: 0 }
      const options = {
        get lock() {
          reads.lock++
          return [lockKey.record('caller')]
        },
        get concurrency() {
          reads.concurrency++
          return ConcurrencyPolicy.fail()
        },
        get signal() {
          reads.signal++
          return undefined
        },
        get timeoutMs() {
          reads.timeoutMs++
          return undefined
        },
        get conflictPolicy() {
          reads.conflictPolicy++
          return 'replace' as const
        }
      }
      await expect(second.set('redirect', 'input', options)).rejects.toMatchObject({
        code: 'LOCK_REJECTED'
      })
      expect(pipelineCalls).toBe(1)
      expect(reads).toEqual({ lock: 1, concurrency: 1, signal: 1, timeoutMs: 1, conflictPolicy: 1 })
      await expect(
        second.set('shared', 'optimistic', {
          concurrency: ConcurrencyPolicy.optimistic({ retries: 0 })
        })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      await expect(
        second.clearValues({ concurrency: ConcurrencyPolicy.fail() })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      let rootCommitted = false
      const root = second
        .set('root-different', 'root', { concurrency: ConcurrencyPolicy.fail() })
        .then(() => {
          rootCommitted = true
        })
      let ran = false
      const different = second
        .tx()
        .lock(lockKey.text('different'))
        .concurrency(ConcurrencyPolicy.fail())
        .run(async (tx) => {
          ran = true
          await tx.set('different', 'two')
        })
      await Promise.resolve()
      expect(ran).toBe(false)
      expect(rootCommitted).toBe(false)
      release()
      await first
      await root
      await different
      expect(await second.get('shared')).toBe('one')
      expect(await second.get('different')).toBe('two')
      expect(await second.get('root-different')).toBe('root')
      expect(await second.inspectLocks()).toEqual([])
      await second
        .tx()
        .lock(lockKey.text(['self', 1]), lockKey.record(['self', 1]))
        .run(async (tx) => {
          await tx.setMany([{ key: ['self', 1], value: 'text' }])
          expect(await tx.removeByPrefix(['self'])).toBe(1)
          await tx.putRecord({ value: 1 }, ['self', 1])
          expect(await tx.use(records).removeByPrefix(['self'])).toBe(1)
        })
      await second.set('redirect', 'input')
      expect(pipelineCalls).toBe(2)
      expect(await second.get('shared')).toBe('redirected')
      expect(await second.get('redirect')).toBeNull()
    }
  )

  it('keeps logical admission ahead of the physical queue on the same store', async () => {
    const { store, host } = await installed({ memory: true })
    const entered = deferred<void>()
    const release = deferred<void>()
    const queued = deferred<void>()
    await host.use(
      definePlugin('queue-marker', (core) => ({
        install() {
          core.usePipeline((request, next) => {
            const result = next(request)
            if (request.operation === 'set' && (request.input as { key?: unknown }).key === 'A')
              queued.resolve()
            return result
          })
          return {}
        }
      }))
    )
    const initial = store.transaction(
      async (tx) => {
        await tx.set('physical', 'held')
        entered.resolve()
        await release.promise
      },
      { lock: [lockKey.text('physical')], timeoutMs: 1000 }
    )
    await entered.promise
    try {
      const root = store.set('A', 'root', {
        timeoutMs: 1000,
        concurrency: ConcurrencyPolicy.wait()
      })
      await queued.promise
      await new Promise<void>((resolve) => setImmediate(resolve))
      const following = store.transaction(
        async (tx) => {
          expect(await tx.get('A')).toBe('root')
          await tx.set('A', 'transaction')
        },
        { lock: [lockKey.text('A')], timeoutMs: 1000, concurrency: ConcurrencyPolicy.wait() }
      )
      await new Promise<void>((resolve) => setImmediate(resolve))
      release.resolve()
      const results = await Promise.allSettled([initial, root, following])
      expect(results.map((result) => result.status)).toEqual([
        'fulfilled',
        'fulfilled',
        'fulfilled'
      ])
      expect(await store.get('A')).toBe('transaction')
    } finally {
      release.resolve()
    }
  })
})
