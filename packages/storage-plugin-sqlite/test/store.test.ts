import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, onTestFinished } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import {
  kv,
  records,
  sqlFragment,
  lockKey,
  ConcurrencyPolicy,
  compareStorageKeys,
  type IStorageKey
} from '@migaia/storage-contract'
import { sqliteBackendPlugin } from '../src/index.js'
import { nodeSqliteDriver } from '../src/node.js'

/** Each case owns its actual file and disposes host before the borrowed native connection. */
async function installed(options: { wal?: boolean; memory?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-'))
  const path = options.memory ? ':memory:' : join(directory, 'data.sqlite')
  const connection = nodeSqliteDriver(path)
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: connection, wal: options.wal })] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  return { store: host.backend('sqlite'), host, connection, path }
}

describe('native SQLite installation', () => {
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
      await expect(
        second.clearValues({ concurrency: ConcurrencyPolicy.fail() } as never)
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
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
      release()
      await first
      await different
      expect(await second.get('shared')).toBe('one')
      expect(await second.get('different')).toBe('two')
      expect(await second.inspectLocks()).toEqual([])
    }
  )
})
