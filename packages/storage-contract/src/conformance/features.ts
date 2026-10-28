import type { IConformanceCase, IConformanceHarness, IConformanceSubject } from './harness.ts'
import { conformanceRows, conformanceCleanup } from './harness.ts'
import { isKeyValueStore, type IKeyValueStore, type IRecordStore } from '../store.ts'
import type { IStorageStore } from '../capability.ts'
import { asSecondaryIndexRecordStore } from '../secondary-index.ts'
import { asChangeFeedStore } from '../change-feed.ts'

/** Exercise the actual synchronous channel and both directions of shared text visibility. */
export function syncConformance(check: IConformanceCase, harness: IConformanceHarness): void {
  const expect = harness.expect
  check('syncRead · native reads, writes and async visibility', async (store) => {
    expect(isKeyValueStore(store)).toBe(true)
    const api = store as unknown as IKeyValueStore
    const sync = api.sync!
    expect(sync).toBeDefined()
    expect(sync.get('missing')).toBeNull()
    expect(sync.has('missing')).toBe(false)
    sync.set('a', '1')
    expect(sync.get('a')).toBe('1')
    expect(sync.has('a')).toBe(true)
    expect(sync.keys()).toEqual(['a'])
    await expect(api.get('a')).resolves.toBe('1')
    await api.set('b', '2')
    expect(sync.get('b')).toBe('2')
    sync.remove('a')
    expect(sync.get('a')).toBeNull()
    await expect(api.get('a')).resolves.toBeNull()
    sync.clearValues()
    expect(sync.keys()).toEqual([])
    await expect(api.keys()).resolves.toEqual([])
  })
  check('syncRead · invalid write options', async (store) => {
    expect(isKeyValueStore(store)).toBe(true)
    const sync = (store as unknown as IKeyValueStore).sync!
    for (const options of [
      null,
      [],
      'options',
      1,
      { conflictPolicy: 'invalid' },
      { timeoutMs: 1 },
      { signal: new AbortController().signal }
    ]) {
      let failure: unknown
      try {
        sync.set('key', 'value', options as never)
      } catch (error) {
        failure = error
      }
      expect(
        typeof failure === 'object' &&
          failure !== null &&
          /^INVALID_(ARGUMENT|CONFIG)$/.test(Reflect.get(failure, 'code'))
      ).toBe(true)
    }
  })
}

/** Existing public index operations own readiness, projections, uniqueness and transaction state. */
export function indexConformance(
  check: IConformanceCase,
  harness: IConformanceHarness,
  prepare?: IConformanceSubject<IStorageStore<never>>['prepareSecondaryIndexes']
): void {
  const expect = harness.expect
  check('secondaryIndexes · ranges, order, limit and projection maintenance', async (store) => {
    const api = asSecondaryIndexRecordStore(store as unknown as IRecordStore)
    const handle = await api.ensureRecordIndexes('conformance', [
      { name: 'value', unique: false, multiEntry: false, revision: 1 }
    ])
    const projectKey = await prepare?.(store, handle)
    const firstKey = typeof projectKey === 'function' ? projectKey('a') : 'a'
    const secondKey = typeof projectKey === 'function' ? projectKey('b') : 'b'
    await expect(api.getRecordIndexReadiness(handle)).resolves.toMatchObject({ status: 'complete' })
    await api.putIndexedRecord({ value: 1 }, firstKey, handle, {
      value: { kind: 'single', key: 1 }
    })
    await api.putIndexedRecord({ value: 2 }, secondKey, handle, {
      value: { kind: 'single', key: 2 }
    })
    expect(
      (
        await conformanceRows(
          api.iterateRecordIndex({ handle, index: 'value', range: { lower: 2, upper: 2 } })
        )
      ).map(([key]) => key)
    ).toEqual([secondKey])
    expect(
      (
        await conformanceRows(api.iterateRecordIndex({ handle, index: 'value', direction: 'next' }))
      ).map(([key]) => key)
    ).toEqual([firstKey, secondKey])
    expect(
      (
        await conformanceRows(
          api.iterateRecordIndex({ handle, index: 'value', direction: 'prev', limit: 1 })
        )
      ).map(([key]) => key)
    ).toEqual([secondKey])
    await api.putIndexedRecord(
      { value: 3 },
      firstKey,
      handle,
      { value: { kind: 'single', key: 3 } },
      { conflictPolicy: 'replace' }
    )
    expect(
      await conformanceRows(
        api.iterateRecordIndex({ handle, index: 'value', range: { lower: 1, upper: 1 } })
      )
    ).toEqual([])
    await api.transactionIndexed(handle, async (tx) => {
      await tx.deleteRecord(secondKey)
    })
    expect(
      await conformanceRows(
        api.iterateRecordIndex({ handle, index: 'value', range: { lower: 2, upper: 2 } })
      )
    ).toEqual([])
    await expect(api.getRecord(firstKey)).resolves.toEqual({ value: 3 })
  })
  check('secondaryIndexes · unique rollback and multiEntry projections', async (store) => {
    const api = asSecondaryIndexRecordStore(store as unknown as IRecordStore)
    const handle = await api.ensureRecordIndexes('conformance', [
      { name: 'unique', unique: true, multiEntry: false, revision: 1 },
      { name: 'tags', unique: false, multiEntry: true, revision: 1 }
    ])
    const projectKey = await prepare?.(store, handle)
    const firstKey = typeof projectKey === 'function' ? projectKey('a') : 'a'
    const secondKey = typeof projectKey === 'function' ? projectKey('b') : 'b'
    await expect(api.getRecordIndexReadiness(handle)).resolves.toMatchObject({ status: 'complete' })
    await api.transactionIndexed(handle, (tx) =>
      tx.putIndexedRecord({ id: 'a' }, firstKey, handle, {
        unique: { kind: 'single', key: 'one' },
        tags: { kind: 'multiple', keys: ['x', 'y'] }
      })
    )
    await expect(
      api.putIndexedRecord({ id: 'b' }, secondKey, handle, {
        unique: { kind: 'single', key: 'one' }
      })
    ).rejects.toMatchObject({ code: 'INDEX_UNIQUE_CONFLICT' })
    await expect(api.getRecord(secondKey)).resolves.toBeUndefined()
    for (const key of ['x', 'y'])
      expect(
        (
          await conformanceRows(
            api.iterateRecordIndex({ handle, index: 'tags', range: { lower: key, upper: key } })
          )
        ).map(([id]) => id)
      ).toEqual([firstKey])
  })
}

/** Await a real post-commit notification; only the consumer runner supplies a case timeout. */
export function feedConformance(check: IConformanceCase, harness: IConformanceHarness): void {
  const expect = harness.expect
  check('changeFeed · committed visibility and unsubscribe', async (store) => {
    const api = asChangeFeedStore(store as unknown as IKeyValueStore)
    let calls = 0
    let notified!: () => void
    const notification = new Promise<void>((resolve) => {
      notified = resolve
    })
    let observed: Promise<string | null> | undefined
    let stop: (() => void) | undefined = api.subscribeChanges((change) => {
      if (change.channel !== 'all' && change.channel !== 'value') return
      if (change.keys && !change.keys.includes('feed-key')) return
      calls += 1
      observed = api.get('feed-key')
      notified()
    })
    await conformanceCleanup(
      () => stop?.(),
      async () => {
        await api.set('feed-key', 'committed')
        await notification
        await expect(observed).resolves.toBe('committed')
        const unsubscribe = stop!
        stop = undefined
        unsubscribe()
        const before = calls
        await api.set('feed-key', 'after-unsubscribe', { conflictPolicy: 'replace' })
        expect(calls).toBe(before)
      }
    )
  })
}
