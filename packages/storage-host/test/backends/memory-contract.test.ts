import { describe, expect, it } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  kv,
  records,
  lockKey,
  ConcurrencyPolicy,
  registerTransactionFinalizer,
  type ITransactionKeyValueApi,
  type ITransactionScope
} from '@migaia/storage-contract'
import { createStorageHost, memoryBackendPlugin, StorageError } from '../../src/index.js'

/** The selected row domain belongs to the actual native memory record channel. */
type IOrder = { state: string; total: number }

describe('memory native contract integration', () => {
  it('uses all three channels and the original capability query inside one native commit', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    let expired!: ITransactionScope<unknown, typeof records>
    let expiredText!: ITransactionKeyValueApi
    let checkRuns = 0
    /** Compare actual draft results with the same committed query after native commit. */
    let transactionRows: readonly { total: number }[] | undefined
    await store.transaction(async (scope) => {
      expired = scope
      const text = scope.use(kv)
      expiredText = text
      await text.set('plain', 'value')
      expect(await text.get('plain')).toBe('value')
      expect(await text.has('plain')).toBe(true)
      await text.setMany([
        { key: ['group', 1], value: 'one' },
        { key: ['group', 2], value: 'two' }
      ])
      expect(await text.getMany([['group', 1], ['group', 2], 'missing'])).toEqual([
        'one',
        'two',
        undefined
      ])
      expect(
        await text.removeMany([
          ['group', 1],
          ['group', 1]
        ])
      ).toBe(1)
      expect(await text.removeByPrefix(['group'])).toBe(1)
      await text.remove('plain')
      expect(await text.get('plain')).toBeNull()
      await scope.setBytes('bytes', new Uint8Array([1, 2]))
      const bytes = await scope.getBytes('bytes')
      bytes![0] = 9
      expect(await scope.getBytes('bytes')).toEqual(new Uint8Array([1, 2]))
      await scope.removeBytes('bytes')
      await scope.setBytes('bytes', new Uint8Array([3]))
      await scope.putRecord({ state: 'paid', total: 2 }, 'one')
      await scope.putRecord({ state: 'open', total: 7 }, 'two')
      await scope.putRecord({ state: 'paid', total: 4 }, ['tenant', 1])
      const paid = scope.use(records).query<IOrder>().where({ state: 'paid' }).select('total')
      transactionRows = await paid.all()
      expect(transactionRows).toEqual([{ total: 2 }, { total: 4 }])
      registerTransactionFinalizer(scope, async (check) => {
        expect(check).not.toBe(scope)
        expect(
          await check.use(records).query<IOrder>().where({ state: 'paid' }).all()
        ).toHaveLength(2)
        checkRuns++
      })
    })
    expect(checkRuns).toBe(1)
    expect(await store.getBytes('bytes')).toEqual(new Uint8Array([3]))
    const committedRows = await store
      .use(records)
      .query<IOrder>()
      .where({ state: 'paid' })
      .select('total')
      .all()
    expect(committedRows).toEqual(transactionRows)
    expect(committedRows).toEqual([{ total: 2 }, { total: 4 }])
    expect(await store.use(records).removeByPrefix(['tenant'])).toBe(1)
    expect(await store.getRecord(['tenant', 1])).toBeUndefined()
    /** Every escaped data method reuses the original owner's one native expiry diagnostic. */
    const expiredFailure = await expired.getRecord('one').catch((error) => error)
    expect(expiredFailure).toBeInstanceOf(StorageError)
    expect(expiredFailure).toMatchObject({
      source: '@migaia/storage-host',
      code: 'TRANSACTION_FAILED',
      operation: 'transaction.scope'
    })
    expect(expiredFailure).toHaveProperty('cause', expect.any(Error))
    await expect(expired.putRecord({ state: 'late' }, 'one')).rejects.toBe(expiredFailure)
    await expect(expired.deleteRecord('one')).rejects.toBe(expiredFailure)
    expect(() => expired.use(kv)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await expect(expiredText.get('plain')).rejects.toBe(expiredFailure)
  })

  it('merges only a bounded physical and draft record range including tombstones', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    for (const key of [1, 2, 3, 4, 5]) await store.putRecord({ key }, key)
    await store.transaction(async (scope) => {
      for (let key = 100; key < 200; key++) await scope.putRecord({ key }, key)
      await scope.putRecord({ key: 'updated' }, 2)
      await scope.deleteRecord(3)
      await scope.putRecord({ key: 'new' }, 3.5)
      const seen: unknown[] = []
      for await (const row of scope.iterateRecords({ lower: 2, upper: 4, upperOpen: true }))
        seen.push(row)
      expect(seen).toEqual([
        [2, { key: 'updated' }],
        [3.5, { key: 'new' }]
      ])
    })
    const seen: unknown[] = []
    for await (const row of store.iterateRecords({ lower: 2, upper: 4, upperOpen: true }))
      seen.push(row)
    expect(seen).toEqual([
      [2, { key: 'updated' }],
      [3.5, { key: 'new' }]
    ])
  })

  it('retains the original cause when a plugin option getter fails before acquisition', () => {
    const original = new Error('memory namespace getter')
    expect(() =>
      memoryBackendPlugin({
        get namespace(): string {
          throw original
        }
      })
    ).toThrowError(
      expect.objectContaining({
        source: '@migaia/storage-host',
        code: 'INVALID_CONFIG',
        cause: original
      })
    )
  })

  it('retains the first native operation failure even when the callback catches it', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    await store.set('occupied', 'original')
    let first: unknown
    await expect(
      store.transaction(async (scope) => {
        await scope.putRecord({ value: 'draft' }, 'earlier')
        try {
          await scope.putRecord({ value: 'conflict' }, 'occupied')
        } catch (error) {
          first = error
        }
      })
    ).rejects.toSatisfy((error: unknown) => error === first)
    expect(first).toMatchObject({ source: '@migaia/storage-host', code: 'DUPLICATE_KEY' })
    /** Ordinary callback normalization retains its own native cause without expiry metadata. */
    const original = new TypeError('ordinary transaction callback')
    const failure = await store
      .transaction(() => {
        throw original
      })
      .catch((error) => error)
    expect(failure).toBeInstanceOf(StorageError)
    expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED', cause: original })
    expect(failure.operation).toBeUndefined()
    expect(await store.getRecord('earlier')).toBeUndefined()
    expect(await store.get('occupied')).toBe('original')
    await expect(
      store.transaction((scope) =>
        scope.use(kv).setMany([
          { key: ['duplicate', 1], value: 'first' },
          { key: ['duplicate', 1], value: 'second' }
        ])
      )
    ).rejects.toMatchObject({ source: '@migaia/storage-contract', code: 'INVALID_ARGUMENT' })
    expect(await store.transaction((scope) => scope.use(kv).getMany([['duplicate', 1]]))).toEqual([
      undefined
    ])
  })

  it('protects every root write and synchronous replacement through the original active keys', async () => {
    await using host = await createStorageHost({
      plugins: [memoryBackendPlugin({ owner: { label: 'root-owner' } })]
    })
    const store = host.backend('memory')
    await store.set('shared', 'before')
    /** The original transaction owns all affected physical channels until its actual callback ends. */
    const entered = deferred<void>()
    const finish = deferred<void>()
    const first = store
      .tx()
      .lock(lockKey.text('shared'), lockKey.bytes('shared'), lockKey.record('shared'))
      .run(async () => {
        entered.resolve()
        await finish.promise
      })
    await entered.promise
    let pending: Promise<void> | undefined
    try {
      const rejected = {
        code: 'LOCK_REJECTED',
        holder: expect.objectContaining({ label: 'root-owner' })
      }
      expect(() => store.sync.set('shared', 'wrong', { conflictPolicy: 'replace' })).toThrowError(
        expect.objectContaining(rejected)
      )
      expect(() => store.sync.remove('shared')).toThrowError(expect.objectContaining(rejected))
      expect(() => store.sync.clearValues()).toThrowError(expect.objectContaining(rejected))
      await expect(
        store.set('shared', 'wrong', {
          concurrency: ConcurrencyPolicy.fail(),
          conflictPolicy: 'replace'
        })
      ).rejects.toMatchObject(rejected)
      await expect(
        store.remove('shared', { concurrency: ConcurrencyPolicy.fail() })
      ).rejects.toMatchObject(rejected)
      await expect(
        store.setBytes('shared', new Uint8Array([9]), {
          concurrency: ConcurrencyPolicy.fail(),
          conflictPolicy: 'replace'
        })
      ).rejects.toMatchObject(rejected)
      await expect(
        store.removeBytes('shared', { concurrency: ConcurrencyPolicy.fail() })
      ).rejects.toMatchObject(rejected)
      await expect(
        store.putRecord({ wrong: true }, 'shared', {
          concurrency: ConcurrencyPolicy.fail(),
          conflictPolicy: 'replace'
        })
      ).rejects.toMatchObject(rejected)
      await expect(
        store.deleteRecord('shared', { concurrency: ConcurrencyPolicy.fail() })
      ).rejects.toMatchObject(rejected)
      await expect(
        store.set('shared', 'wrong', {
          conflictPolicy: 'replace',
          concurrency: ConcurrencyPolicy.optimistic({ retries: 0 })
        })
      ).rejects.toMatchObject(rejected)
      expect(await store.get('shared')).toBe('before')
      await store.putRecord({ independent: true }, 'other')
      /** Default wait snapshots mutable payloads before entering the same original admission FIFO. */
      const payload = new Uint8Array([3])
      pending = store.setBytes('shared', payload, { conflictPolicy: 'replace' })
      payload[0] = 99
      expect(await store.getBytes('shared')).toBeNull()
      finish.resolve()
      await Promise.all([first, pending])
      expect(await store.get('shared')).toBeNull()
      expect(await store.getBytes('shared')).toEqual(new Uint8Array([3]))
      expect(await store.inspectLocks()).toEqual([])
    } finally {
      finish.resolve()
      await Promise.allSettled([first, ...(pending ? [pending] : [])])
    }
  })

  it('admits clears and native prefix deletion only against their actual channel ranges', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    await store.set('text', 'safe')
    await store.putRecord({ value: 1 }, ['tenant', 1])
    await store.putRecord({ value: 2 }, ['other', 1])
    /** The lock remains meaningful even if a future mutation deletes its physical row. */
    const entered = deferred<void>()
    const finish = deferred<void>()
    const first = store
      .tx()
      .lock(lockKey.record(['tenant', 1]))
      .run(async () => {
        entered.resolve()
        await finish.promise
      })
    await entered.promise
    let pending: Promise<void> | undefined
    try {
      store.sync.clearValues()
      expect(await store.get('text')).toBeNull()
      await store.clearBytes()
      await expect(
        store.clearRecords({ concurrency: ConcurrencyPolicy.fail() })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      await expect(store.clearAll({ concurrency: ConcurrencyPolicy.fail() })).rejects.toMatchObject(
        { code: 'LOCK_REJECTED' }
      )
      await expect(
        store.use(records).removeByPrefix(['tenant'], { concurrency: ConcurrencyPolicy.fail() })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      expect(await store.use(records).removeByPrefix(['other'])).toBe(1)
      /** Cancellation removes the actual queued clear and preserves both its reason and native data. */
      const abort = new AbortController()
      const reason = new Error('cancel root clear')
      const cancelled = store.clearRecords({ signal: abort.signal })
      const checked = expect(cancelled).rejects.toMatchObject({ code: 'ABORTED', cause: reason })
      abort.abort(reason)
      await checked
      expect(await store.getRecord(['tenant', 1])).toEqual({ value: 1 })
      pending = store.clearRecords()
      expect(await store.getRecord(['tenant', 1])).toEqual({ value: 1 })
      finish.resolve()
      await Promise.all([first, pending])
      expect(await store.getRecord(['tenant', 1])).toBeUndefined()
      expect(await store.inspectLocks()).toEqual([])
    } finally {
      finish.resolve()
      await Promise.allSettled([first, ...(pending ? [pending] : [])])
    }
  })

  it('shares the original lock admission with the native transaction until commit and cleanup end', async () => {
    const owner = { label: 'orders' }
    const plugin = memoryBackendPlugin({ owner })
    owner.label = 'changed after definition'
    await using host = await createStorageHost({ plugins: [plugin] })
    const store = host.backend('memory')
    const entered = deferred<void>()
    const finish = deferred<void>()
    const first = store
      .tx()
      .lock(lockKey.record('counter'))
      .run(async (scope) => {
        await scope.putRecord({ count: 1 }, 'counter')
        entered.resolve()
        await finish.promise
      })
    await entered.promise
    let second: Promise<void> | undefined
    try {
      const held = await store.inspectLocks()
      expect(held).toHaveLength(1)
      expect(held[0]!.holder).toMatchObject({ scope: 'local', label: 'orders', status: 'held' })
      let secondEntered = false
      second = store
        .tx()
        .lock(lockKey.record('counter'))
        .run(async (scope) => {
          secondEntered = true
          expect(await scope.getRecord('counter')).toEqual({ count: 1 })
          await scope.putRecord({ count: 2 }, 'counter')
        })
      await Promise.resolve()
      expect(secondEntered).toBe(false)
      await expect(
        store
          .tx()
          .lock(lockKey.record('counter'))
          .concurrency(ConcurrencyPolicy.fail())
          .run(() => undefined)
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      finish.resolve()
      await first
      await second
      expect(await store.getRecord('counter')).toEqual({ count: 2 })
      expect(await store.inspectLocks()).toEqual([])
    } finally {
      finish.resolve()
      await Promise.allSettled([first, ...(second ? [second] : [])])
    }
  })
})
