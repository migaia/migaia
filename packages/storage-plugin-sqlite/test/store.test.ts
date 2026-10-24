import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, onTestFinished, vi } from 'vitest'
import { createStorageHost, createOrgId, definePlugin } from '@migaia/storage-host'
import { deferred } from '@migaia/utils/promise'
import {
  kv,
  ttl,
  counter,
  records,
  sql,
  sqlFragment,
  lockKey,
  ConcurrencyPolicy,
  compareStorageKeys,
  type IStorageKey
} from '@migaia/storage-contract'
import { runConformance } from '@migaia/storage-contract/conformance'
import { sqliteBackendPlugin, type ISqliteValue } from '../src/index.js'
import { nodeSqliteDriver } from '../src/node.js'

/** Each case owns its actual file and disposes host before the borrowed native connection. */
async function installed(
  options: { wal?: boolean; memory?: boolean; native?: string[]; org?: string } = {}
) {
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
    org: options.org,
    plugins: [sqliteBackendPlugin({ driver, wal: options.wal })] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  return { store: host.backend('sqlite'), host, connection, path }
}

/** Each selected standard group receives a fresh actual native database and original owner. */
runConformance(
  { describe, it, expect },
  {
    name: 'native SQLite standard capabilities',
    capabilities: [kv, records, sql, ttl, counter],
    features: {
      batch: true,
      syncRead: true,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    create: async () => (await installed({ memory: true })).store
  }
)

describe('native SQLite installation', () => {
  it('keeps native TTL with values, reclaims expiry, and rolls back the same three channels', async () => {
    /** This backend uses the local wall clock; no scheduler timer performs cleanup. */
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    onTestFinished(() => clock.mockRestore())
    const { store } = await installed({ memory: true })
    await store.set('text-expiry', 'old')
    await store.setBytes('bytes-expiry', new Uint8Array([1]))
    await store.putRecord({ value: 'old' }, 'record-expiry')
    for (const target of [
      lockKey.text('text-expiry'),
      lockKey.bytes('bytes-expiry'),
      lockKey.record('record-expiry')
    ]) {
      expect(await store.use(ttl).expire(target, 25.5)).toBe(true)
      expect(await store.use(ttl).remaining(target)).toBe(25.5)
    }
    /** Every ordinary same-channel overwrite keeps its existing live deadline. */
    await store.set('text-expiry', 'updated')
    await store.setBytes('bytes-expiry', new Uint8Array([2]))
    await store.putRecord({ value: 'updated' }, 'record-expiry')
    expect(await store.use(ttl).remaining(lockKey.text('text-expiry'))).toBe(25.5)
    expect(await store.use(ttl).remaining(lockKey.bytes('bytes-expiry'))).toBe(25.5)
    expect(await store.use(ttl).remaining(lockKey.record('record-expiry'))).toBe(25.5)
    now += 26
    /** No warm read is allowed to hide a stale cross-channel duplicate. */
    await store.setBytes('text-expiry', new Uint8Array([3]))
    await store.putRecord({ live: true }, 'bytes-expiry')
    await store.set('record-expiry', 'live')
    expect(await store.get('text-expiry')).toBeNull()
    expect(await store.getBytes('bytes-expiry')).toBeNull()
    expect(await store.getRecord('record-expiry')).toBeUndefined()
    expect(await store.use(ttl).remaining(lockKey.bytes('text-expiry'))).toBeUndefined()
    /** Expiry metadata and same-connection replacement share the original native scope. */
    await store.transaction(async (tx) => {
      await tx.set('scoped-expiry', 'old')
      expect(await tx.use(ttl).expire(lockKey.text('scoped-expiry'), 5)).toBe(true)
      now += 6
      await tx.setBytes('scoped-expiry', new Uint8Array([4]))
      expect(await tx.get('scoped-expiry')).toBeNull()
      expect(await tx.getBytes('scoped-expiry')).toEqual(new Uint8Array([4]))
    })
    const primary = new Error('TTL native rollback')
    await expect(
      store.transaction(async (tx) => {
        await tx.set('ttl-rollback', 'new')
        await tx.use(ttl).expire(lockKey.text('ttl-rollback'), 100)
        throw primary
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: primary })
    expect(await store.get('ttl-rollback')).toBeNull()
    await store.clearAll()
    /** Reads physically reclaim expired text while preserving the existing revision owner. */
    await store.set('lazy', 'value')
    await store.use(ttl).expire(lockKey.text('lazy'), 1)
    now += 2
    expect(store.sync.get('lazy')).toBeNull()
    expect(await store.sql`SELECT count(*) AS count FROM migaia_text`.get()).toMatchObject({
      count: 0
    })
    await store.use(kv).setMany([{ key: ['batch-expiry'], value: 'gone', ttlMs: 1 }])
    now += 2
    expect(await store.use(kv).getMany([['batch-expiry'], ['batch-expiry']])).toEqual([
      undefined,
      undefined
    ])
    expect(await store.sql`SELECT count(*) AS count FROM migaia_text`.get()).toMatchObject({
      count: 0
    })
    await store.putRecord({ gone: true }, ['record-expiry'])
    await store.use(ttl).expire(lockKey.record(['record-expiry']), 1)
    now += 2
    expect(await store.use(records).query().all()).toEqual([])
    expect(await store.sql`SELECT count(*) AS count FROM migaia_records`.get()).toMatchObject({
      count: 0
    })
    await store.set('persistent', 'value')
    expect(await store.use(ttl).persist(lockKey.text('persistent'))).toBe(false)
    expect(await store.use(ttl).expire(lockKey.text('persistent'), 50)).toBe(true)
    expect(await store.use(ttl).persist(lockKey.text('persistent'))).toBe(true)
    expect(await store.use(ttl).remaining(lockKey.text('persistent'))).toBeUndefined()
    expect(await store.use(ttl).expire(lockKey.text('persistent'), 0)).toBe(true)
    expect(await store.get('persistent')).toBeNull()
    expect(await store.use(ttl).expire(lockKey.text('persistent'), 50)).toBe(false)
    await expect(store.use(ttl).expire(lockKey.vector('absent', 'point'), 1)).rejects.toMatchObject(
      { code: 'UNSUPPORTED_CAPABILITY' }
    )
  })

  it('updates native counters atomically and keeps canonical text and TTL semantics', async () => {
    /** Real native operations and failures share the same root text mutation owner. */
    const { store } = await installed({ memory: true })
    expect(await store.use(counter).increment('visits')).toBe(1)
    await Promise.all(Array.from({ length: 100 }, () => store.use(counter).increment('visits')))
    expect(await store.get('visits')).toBe('101')
    await store.use(ttl).expire(lockKey.text('visits'), 60_000)
    expect(await store.use(counter).increment('visits', -1)).toBe(100)
    expect(await store.use(ttl).remaining(lockKey.text('visits'))).toBeGreaterThan(59_000)
    await store.set('invalid-counter', '01')
    await expect(store.use(counter).increment('invalid-counter')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(await store.get('invalid-counter')).toBe('01')
    await expect(store.use(counter).increment('visits', 0.5)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    await store.set('overflow-counter', String(Number.MAX_SAFE_INTEGER))
    await expect(store.use(counter).increment('overflow-counter')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(await store.get('overflow-counter')).toBe(String(Number.MAX_SAFE_INTEGER))
    const primary = new Error('counter native rollback')
    await expect(
      store.transaction(async (tx) => {
        expect(await tx.use(counter).increment('visits', 5)).toBe(105)
        await tx.use(ttl).persist(lockKey.text('visits'))
        throw primary
      })
    ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: primary })
    expect(await store.get('visits')).toBe('100')
    expect(await store.use(ttl).remaining(lockKey.text('visits'))).toBeGreaterThan(59_000)
  })

  it('retains first native TTL observations and returns commit expiry to the original policy', async () => {
    /** The deterministic local clock exercises actual native transactions without a timer. */
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    onTestFinished(() => clock.mockRestore())
    const { store } = await installed({ memory: true })
    await store.set('observed', 'old')
    await store.use(ttl).expire(lockKey.text('observed'), 5)
    await expect(
      store.transaction(
        async (scope) => {
          expect(await scope.get('observed')).toBe('old')
          now += 5
          expect(await scope.get('observed')).toBe('old')
          expect(await scope.use(kv).getMany(['observed'])).toEqual(['old'])
          expect(await scope.use(ttl).remaining(lockKey.text('observed'))).toBe(0)
          await scope.set('rollback-expiry', 'never')
        },
        { concurrency: ConcurrencyPolicy.optimistic({ retries: 0 }) }
      )
    ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    expect(await store.get('observed')).toBeNull()
    expect(await store.get('rollback-expiry')).toBeNull()
    /** First byte and record reads retain their same native snapshot until original commit check. */
    await store.setBytes('observed-bytes', new Uint8Array([7]))
    await store.putRecord({ value: 'old' }, 'observed-record')
    await store.use(ttl).expire(lockKey.bytes('observed-bytes'), 5)
    await store.use(ttl).expire(lockKey.record('observed-record'), 5)
    await expect(
      store.transaction(
        async (scope) => {
          expect(await scope.getBytes('observed-bytes')).toEqual(new Uint8Array([7]))
          expect(await scope.use(records).query().all()).toEqual([{ value: 'old' }])
          now += 5
          expect(await scope.getBytes('observed-bytes')).toEqual(new Uint8Array([7]))
          expect(await scope.getRecord('observed-record')).toEqual({ value: 'old' })
          expect(await scope.use(records).query().all()).toEqual([{ value: 'old' }])
        },
        { concurrency: ConcurrencyPolicy.optimistic({ retries: 0 }) }
      )
    ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    expect(await store.getBytes('observed-bytes')).toBeNull()
    expect(await store.getRecord('observed-record')).toBeUndefined()
  })

  it('keeps observed deadlines through native TTL writes until the original commit conflict', async () => {
    /** Every supported target shares the same real native snapshot and deterministic local clock. */
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    onTestFinished(() => clock.mockRestore())
    const { store } = await installed({ memory: true })
    for (const channel of ['text', 'bytes', 'record'] as const) {
      for (const action of ['persist', 'extend'] as const) {
        const key = `${channel}-${action}`
        const target =
          channel === 'text'
            ? lockKey.text(key)
            : channel === 'bytes'
              ? lockKey.bytes(key)
              : lockKey.record(key)
        if (channel === 'text') await store.set(key, 'old')
        else if (channel === 'bytes') await store.setBytes(key, new Uint8Array([7]))
        else await store.putRecord({ value: 'old' }, key)
        await store.use(ttl).expire(target, 5)
        await expect(
          store.transaction(
            async (scope) => {
              if (channel === 'text') expect(await scope.get(key)).toBe('old')
              else if (channel === 'bytes')
                expect(await scope.getBytes(key)).toEqual(new Uint8Array([7]))
              else expect(await scope.getRecord(key)).toEqual({ value: 'old' })
              now += 5
              expect(
                action === 'persist'
                  ? await scope.use(ttl).persist(target)
                  : await scope.use(ttl).expire(target, 50)
              ).toBe(true)
              await scope.set('rollback-ttl-write', 'never')
            },
            { concurrency: ConcurrencyPolicy.optimistic({ retries: 0 }) }
          )
        ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
        expect(await store.get('rollback-ttl-write')).toBeNull()
        expect(await store.use(ttl).remaining(target)).toBeUndefined()
      }
    }
  })

  it('skips unobserved expired iterator positions and counts only returned native rows', async () => {
    /** Iteration uses the same native snapshot and existing observer in root and scoped paths. */
    let now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const counts: number[] = []
    const connection = nodeSqliteDriver(':memory:')
    const host = await createStorageHost({
      hooks: { onStorageIterationClose: ({ count }) => counts.push(count) },
      plugins: [sqliteBackendPlugin({ driver: connection })] as const
    })
    onTestFinished(async () => {
      await host.dispose()
      await connection.dispose()
      clock.mockRestore()
    })
    const store = host.backend('sqlite')
    for (const transactional of [false, true]) {
      await store.clearRecords()
      await store.putRecord({ id: 'a' }, 'a')
      await store.putRecord({ id: 'b' }, 'b')
      await store.putRecord({ id: 'z' }, 'z')
      await store.use(ttl).expire(lockKey.record('b'), 5)
      /** The first native open snapshots b; it expires before its first accepted next operation. */
      const visit = async (scope?: Parameters<Parameters<typeof store.transaction>[0]>[0]) => {
        const stream = scope ? scope.iterateRecords() : store.iterateRecords()
        expect((await stream.next()).value).toEqual(['a', { id: 'a' }])
        now += 5
        expect((await stream.next()).value).toEqual(['z', { id: 'z' }])
        expect((await stream.next()).done).toBe(true)
        await stream.dispose()
      }
      if (transactional) await store.transaction((scope) => visit(scope))
      else await visit()
    }
    expect(counts).toEqual([2, 2])
  })

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

  it('uses supported in-place pipeline edits for native root and scoped batches', async () => {
    /** This is the original public pipeline entry; its input is shallow-readonly, not deep-frozen. */
    const { store, host } = await installed({ memory: true })
    await host.use(
      definePlugin('rewrite-batch', (core) => ({
        install() {
          core.usePipeline((request, next) => {
            if (request.operation === 'setMany') {
              const input = request.input as { entries: Array<{ key: IStorageKey; value: string }> }
              input.entries[0]!.key = 'redirected:point'
              input.entries[0]!.value = 'changed'
            } else if (request.operation === 'getMany' || request.operation === 'removeMany') {
              const input = request.input as { keys: IStorageKey[] }
              input.keys[0] = 'redirected:point'
            } else if (request.operation === 'removeByPrefix') {
              const input = request.input as { prefix: IStorageKey }
              input.prefix = 'redirected:'
            }
            return next(request)
          })
          return {}
        }
      }))
    )
    /** Original caller getters run once; the pipeline edits only the detached native payload. */
    let keyReads = 0
    await store.use(kv).setMany([
      {
        get key() {
          keyReads++
          return 'caller'
        },
        value: 'original'
      }
    ])
    expect(keyReads).toBe(1)
    expect(await store.get('caller')).toBeNull()
    expect(await store.get('redirected:point')).toBe('changed')
    expect(await store.use(kv).getMany(['caller'])).toEqual(['changed'])
    expect(await store.use(kv).removeMany(['caller'])).toBe(1)
    await store.transaction(async (tx) => {
      await tx.setMany([{ key: 'caller', value: 'original' }])
      expect(await tx.getMany(['caller'])).toEqual(['changed'])
      expect(await tx.removeMany(['caller'])).toBe(1)
      await tx.setMany([{ key: 'caller', value: 'original' }])
      expect(await tx.removeByPrefix('wrong-prefix')).toBe(1)
      await tx.putRecord({ retained: false }, 'redirected:record')
      expect(await tx.use(records).removeByPrefix('wrong-prefix')).toBe(1)
    })
    expect(await store.getRecord('redirected:record')).toBeUndefined()
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

describe('native SQLite organizations', () => {
  it('honors organization locks when the root supplies its existing organization context', async () => {
    const { host, store } = await installed({ memory: true })
    const orgId = createOrgId()
    const organization = host.org(orgId).backend('sqlite')
    const entered = deferred<void>()
    const release = deferred<void>()
    const holding = organization
      .tx()
      .lock(lockKey.text('held'))
      .run(async (tx) => {
        entered.resolve()
        await release.promise
        await tx.set('held', 'organization')
      })
    await entered.promise
    try {
      await expect(
        store.set('held', 'root', {
          orgId,
          timeoutMs: 50,
          concurrency: ConcurrencyPolicy.fail()
        })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
    } finally {
      release.resolve()
      await holding
    }
    expect(await organization.get('held')).toBe('organization')
  })
  it('serializes root and organization attempts through one native connection', async () => {
    const native: string[] = []
    const { store, host } = await installed({ memory: true, native })
    const first = host.org(createOrgId()).backend('sqlite')
    const second = host.org(createOrgId()).backend('sqlite')
    const entered = deferred<void>()
    const release = deferred<void>()
    const initial = first.transaction(async (tx) => {
      await tx.set('shared-key', 'first')
      entered.resolve()
      await release.promise
    })
    await entered.promise
    try {
      expect(() => store.sync.get('shared-key')).toThrowError(
        expect.objectContaining({ code: 'TRANSACTION_FAILED' })
      )
      const rootWrite = store.set('shared-key', 'root')
      const following = second.transaction((tx) => tx.set('shared-key', 'second'))
      await new Promise<void>((resolve) => setImmediate(resolve))
      release.resolve()
      await Promise.all([initial, rootWrite, following])
      expect(await store.get('shared-key')).toBe('root')
      expect(await first.get('shared-key')).toBe('first')
      expect(await second.get('shared-key')).toBe('second')
      expect(native.filter((text) => text.startsWith('BEGIN'))).toHaveLength(3)
    } finally {
      release.resolve()
      await initial
    }
  })
  for (const memory of [true, false])
    for (const configured of [false, true]) {
      it(
        'keeps the configured default, two organizations and physical deletion isolated (' +
          memory +
          ',' +
          configured +
          ')',
        async () => {
          const org = configured ? createOrgId() : '00000000-0000-0000-0000-000000000000'
          const native: string[] = []
          const { host, connection } = await installed({ memory, org, native })
          const root = host.backend('sqlite')
          const same = host.org(org).backend('sqlite')
          const first = createOrgId()
          const second = createOrgId()
          const left = host.org(first).backend('sqlite')
          const right = host.org(second).backend('sqlite')
          native.length = 0
          await root.set('key', 'root')
          expect(await same.get('key')).toBe('root')
          await same.set('key', 'default')
          expect(await root.get('key')).toBe('default')
          await left.set('key', 'left')
          await right.set('key', 'right')
          await left.setBytes('bytes', new Uint8Array([1]))
          await left.putRecord({ owner: 'left' }, 'row')
          await left.use(kv).setMany([{ key: ['batch', 1], value: 'left' }])
          await left.use(ttl).expire(lockKey.text('key'), 60_000)
          await left.use(counter).increment('count', 2)
          expect(await right.getRecord('row')).toBeUndefined()
          expect(await right.use(kv).getMany([['batch', 1]])).toEqual([undefined])
          expect(await right.use(ttl).remaining(lockKey.text('key'))).toBeUndefined()
          expect(await right.get('count')).toBeNull()
          expect(native.some((text) => /CREATE|PRAGMA/i.test(text))).toBe(false)
          const countBeforeMismatch = native.length
          await expect(left.set('escape', 'blocked', { orgId: second })).rejects.toMatchObject({
            code: 'INVALID_ARGUMENT'
          })
          expect(native.length).toBe(countBeforeMismatch)
          expect(await right.get('escape')).toBeNull()
          const owners = connection
            .prepare('SELECT DISTINCT org_id FROM migaia_text')
            .all()
            .map((row) => row.org_id)
          expect(new Set(owners)).toEqual(new Set([org, first, second]))
          await host.dropOrg(first)
          expect(await left.get('key')).toBeNull()
          expect(await left.getRecord('row')).toBeUndefined()
          expect(await left.use(kv).getMany([['batch', 1]])).toEqual([undefined])
          expect(await right.get('key')).toBe('right')
          expect(await root.get('key')).toBe('default')
          await host.dropOrg(first)
          await left.set('key', 'reused')
          expect(await left.get('key')).toBe('reused')
          expect(host.org(first).backend('sqlite')).toBe(left)
          await host.dropOrg(org)
          expect(await root.get('key')).toBeNull()
          expect(await same.get('key')).toBeNull()
          expect(await left.get('key')).toBe('reused')
          expect(await right.get('key')).toBe('right')
          expect(native.some((text) => /CREATE|PRAGMA/i.test(text))).toBe(false)
        }
      )
    }
})
