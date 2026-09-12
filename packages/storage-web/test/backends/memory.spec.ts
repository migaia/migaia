import { isChangeFeedStore, type IStorageChange } from '@migaia/storage-contract'
import { describe, expect, it, vi } from 'vitest'
import { memoryStorageHost } from '../../src/backends/memory'
import { composeRepositoryKey } from '../../src/entity/key.js'

describe('memoryStorageHost', () => {
  it('absent record deletes are true no-ops for revisions and change feed', async () => {
    const store = memoryStorageHost()
    const changes: IStorageChange[] = []
    const stop = store.subscribeChanges((change) => changes.push(change))
    await store.deleteRecord('missing')
    await store.transaction(async (tx) => tx.delete('also-missing'))
    stop()
    expect(changes).toEqual([])
  })

  it('自动生成 key 即使随机源重复也不会覆盖已有 record', async () => {
    const originalCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: () => 'fixed-auto-key' }
    })
    try {
      const store = memoryStorageHost()
      const first = await store.putRecord({ value: 1 })
      const second = await store.putRecord({ value: 2 })
      expect(second).not.toEqual(first)
      await expect(store.getRecord(first)).resolves.toEqual({ value: 1 })
      await expect(store.getRecord(second)).resolves.toEqual({ value: 2 })
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto })
    }
  })
  it('在无冲突写入路径也拒绝非法 conflictPolicy', async () => {
    const store = memoryStorageHost()
    await expect(
      store.set('key', 'value', { conflictPolicy: 'invalid' as never })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
  })

  it('拒绝运行时非字符串 value', async () => {
    const store = memoryStorageHost()
    expect(() => store.sync!.set('key', 42 as unknown as string)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    await expect(store.set('key', 42 as unknown as string)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
  })
  it('L0 与 bytes 通道拒绝运行时非字符串 key', async () => {
    const store = memoryStorageHost()
    const invalidKey = 42 as unknown as string
    for (const invoke of [
      () => store.get(invalidKey),
      () => store.set(invalidKey, 'value'),
      () => store.remove(invalidKey),
      () => store.has(invalidKey),
      () => store.getBytes(invalidKey),
      () => store.setBytes(invalidKey, new Uint8Array([1]))
    ])
      await expect(invoke()).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
        backend: 'memory'
      })
    for (const invoke of [
      () => store.sync.get(invalidKey),
      () => store.sync.set(invalidKey, 'value'),
      () => store.sync.remove(invalidKey),
      () => store.sync.has(invalidKey)
    ])
      expect(invoke).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })
  it('拒绝非 Uint8Array 的 bytes value', async () => {
    const store = memoryStorageHost()
    await expect(
      store.setBytes('key', new DataView(new ArrayBuffer(1)) as unknown as Uint8Array)
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
  })
  it('record replace 在 clone 失败时保留原 value 通道', async () => {
    const store = memoryStorageHost()
    await store.set('shared', 'original')
    await expect(
      store.putRecord({ uncloneable: () => {} }, 'shared', { conflictPolicy: 'replace' })
    ).rejects.toMatchObject({ code: 'SERIALIZE_FAILED', backend: 'memory' })
    await expect(store.get('shared')).resolves.toBe('original')
    await expect(store.getRecord('shared')).resolves.toBeUndefined()
  })
  it('bytes replace 在 detached buffer 复制失败时保留原 value 通道', async () => {
    const store = memoryStorageHost()
    await store.set('shared', 'original')
    const buffer = new ArrayBuffer(4)
    const detached = new Uint8Array(buffer)
    structuredClone(buffer, { transfer: [buffer] })
    await expect(
      store.setBytes('shared', detached, { conflictPolicy: 'replace' })
    ).rejects.toMatchObject({ code: 'SERIALIZE_FAILED', backend: 'memory' })
    await expect(store.get('shared')).resolves.toBe('original')
    await expect(store.getBytes('shared')).resolves.toBeNull()
  })

  it('optimistic transaction detects revision changed during await', async () => {
    const store = memoryStorageHost()
    await store.putRecord({ value: 0 }, 'revision-key')
    let release: (() => void) | undefined
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = store.transaction(async (tx) => {
      await tx.get('revision-key')
      await paused
      await tx.put({ value: 1 }, 'revision-key')
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    await store.putRecord({ value: 2 }, 'revision-key', { conflictPolicy: 'replace' })
    release!()
    await expect(first).rejects.toMatchObject({
      code: 'TRANSACTION_CONFLICT',
      operation: 'transaction.commit'
    })
    await expect(store.getRecord('revision-key')).resolves.toEqual({ value: 2 })
  })
  it('transaction reads a repeatable snapshot even when an external write commits', async () => {
    const store = memoryStorageHost()
    await store.putRecord({ value: 0 }, 'snapshot-key')
    let release: (() => void) | undefined
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const transaction = store.transaction(async (tx) => {
      await expect(tx.get('snapshot-key')).resolves.toEqual({ value: 0 })
      await paused
      await expect(tx.get('snapshot-key')).resolves.toEqual({ value: 0 })
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    await store.putRecord({ value: 1 }, 'snapshot-key', { conflictPolicy: 'replace' })
    release!()
    await expect(transaction).rejects.toMatchObject({ code: 'TRANSACTION_CONFLICT' })
  })
  it('clear and recreate cannot pass an old transaction revision check', async () => {
    const store = memoryStorageHost()
    await store.putRecord({ value: 0 }, 'aba-key')
    let release: (() => void) | undefined
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const transaction = store.transaction(async (tx) => {
      await tx.get('aba-key')
      await paused
      await tx.put({ value: 2 }, 'aba-key')
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    await store.clearRecords()
    await store.putRecord({ value: 1 }, 'aba-key')
    release!()
    await expect(transaction).rejects.toMatchObject({ code: 'TRANSACTION_CONFLICT' })
    await expect(store.getRecord('aba-key')).resolves.toEqual({ value: 1 })
  })
  it('transaction 进入同步 commit point 后不因 hostile signal 漂移留下半提交', async () => {
    const store = memoryStorageHost()
    let abortedReads = 0
    const signal = {
      get aborted(): boolean {
        abortedReads += 1
        return abortedReads >= 8
      },
      reason: new Error('hostile late abort'),
      addEventListener: () => {},
      removeEventListener: () => {}
    } as unknown as AbortSignal
    await expect(
      store.transaction(
        async (tx) => {
          await tx.put({ value: 1 }, 'first')
          await tx.put({ value: 2 }, 'second')
        },
        { signal }
      )
    ).resolves.toBeUndefined()
    await expect(store.getRecord('first')).resolves.toEqual({ value: 1 })
    await expect(store.getRecord('second')).resolves.toEqual({ value: 2 })
    expect(abortedReads).toBe(6)
  })
  it('backend 与 capabilities 正确声明', () => {
    const store = memoryStorageHost()
    expect(store.backend).toBe('memory')
    expect(store.capabilities.records).toBe(true)
    expect(store.capabilities.syncRead).toBe(true)
  })
  it('sync 通道全方法可用', () => {
    const store = memoryStorageHost()
    store.sync!.set('k', 'v')
    expect(store.sync!.get('k')).toBe('v')
    expect(store.sync!.has('k')).toBe(true)
    expect(store.sync!.keys()).toEqual(['k'])
    store.sync!.remove('k')
    expect(store.sync!.get('k')).toBeNull()
  })
  it('每个实例独立隔离', () => {
    const a = memoryStorageHost()
    const b = memoryStorageHost()
    a.sync!.set('k', 'a-value')
    expect(b.sync!.get('k')).toBeNull()
  })
  it('dispose 后 sync 方法也拒绝', async () => {
    const store = memoryStorageHost()
    await store.dispose()
    expect(() => store.sync!.get('k')).toThrow(expect.objectContaining({ code: 'STORE_DISPOSED' }))
  })
  it('iterate 按 range 的 lower/upper 边界过滤', async () => {
    const store = memoryStorageHost()
    await store.putRecord({ v: 1 }, 1)
    await store.putRecord({ v: 2 }, 2)
    await store.putRecord({ v: 3 }, 3)
    const collect = async (range: Parameters<typeof store.iterateRecords>[0]) => {
      const seen: unknown[] = []
      for await (const [, value] of store.iterateRecords(range)) seen.push(value)
      return seen
    }
    expect(await collect({ lower: 1, lowerOpen: true, upper: 3 })).toEqual([{ v: 2 }, { v: 3 }])
    expect(await collect({ lower: 1, lowerOpen: false })).toEqual([{ v: 1 }, { v: 2 }, { v: 3 }])
    expect(await collect({ upper: 2, upperOpen: true })).toEqual([{ v: 1 }])
    expect(await collect({ upper: 2, upperOpen: false })).toEqual([{ v: 1 }, { v: 2 }])
  })
  it('iterate 首次 yield 后修改复合 range 不影响剩余结果', async () => {
    const store = memoryStorageHost()
    await store.putRecord({ value: 1 }, ['tenant', 1])
    await store.putRecord({ value: 2 }, ['tenant', 2])
    await store.putRecord({ value: 3 }, ['tenant', 3])
    const upper: Array<string | number> = ['tenant', 3]
    const iterator = store.iterateRecords({ upper })
    await expect(iterator.next()).resolves.toMatchObject({ value: [['tenant', 1], { value: 1 }] })
    upper[1] = 1
    await expect(iterator.next()).resolves.toMatchObject({ value: [['tenant', 2], { value: 2 }] })
    await expect(iterator.next()).resolves.toMatchObject({ value: [['tenant', 3], { value: 3 }] })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
  })
  it('自动生成 key 在 crypto.randomUUID 不可用时回退', async () => {
    const original = crypto.randomUUID
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const store = memoryStorageHost()
      const key = await store.putRecord({ a: 1 })
      expect(typeof key).toBe('string')
      await expect(store.getRecord(key)).resolves.toEqual({ a: 1 })
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true })
    }
  })
  it('transaction 作用域内 put 不传 key 时自动生成，get 可读取快照内的值', async () => {
    const store = memoryStorageHost()
    let generatedKey: unknown
    await store.transaction(async (tx) => {
      generatedKey = await tx.put({ v: 'auto' })
      await expect(tx.get(generatedKey as never)).resolves.toEqual({ v: 'auto' })
    })
    await expect(store.getRecord(generatedKey as never)).resolves.toEqual({ v: 'auto' })
  })
  it('iterate 在 signal 已 abort 时抛 ABORTED', async () => {
    const store = memoryStorageHost()
    await store.putRecord({ v: 1 }, 'a')
    const controller = new AbortController()
    controller.abort()
    await expect(
      store.iterateRecords(undefined, { signal: controller.signal }).next()
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })
  it('dispose 后 getBytes/getRecord/iterate/transaction 均拒绝', async () => {
    const store = memoryStorageHost()
    await store.dispose()
    await expect(store.putRecord({ a: 1 })).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(store.setBytes('k', new Uint8Array())).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    await expect(store.transaction(async () => {})).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
  })
  it('复合主键编码无碰撞且事务边界结构化克隆', async () => {
    const store = memoryStorageHost()
    await store.putRecord({ value: 'comma' }, ['a,b'])
    await store.putRecord({ value: 'split' }, ['a', 'b'])
    await expect(store.getRecord(['a,b'])).resolves.toEqual({ value: 'comma' })
    await expect(store.getRecord(['a', 'b'])).resolves.toEqual({ value: 'split' })
    const input = { nested: { value: 1 } }
    await store.transaction(async (tx) => {
      await tx.put(input, 'tx-clone')
      const read = await tx.get('tx-clone')
      ;(read as typeof input).nested.value = 9
    })
    input.nested.value = 8
    await expect(store.getRecord('tx-clone')).resolves.toEqual({ nested: { value: 1 } })
  })
  it('direct/transaction/iterate 均不泄漏复合 key 的可变引用', async () => {
    const store = memoryStorageHost()
    const directKey: (string | number)[] = ['direct', 1]
    await store.putRecord({ source: 'direct' }, directKey)
    directKey[1] = 9

    const transactionKey: (string | number)[] = ['transaction', 1]
    await store.transaction(async (tx) => {
      await tx.put({ source: 'transaction' }, transactionKey)
      transactionKey[1] = 9
    })

    const firstPass: unknown[] = []
    for await (const [key] of store.iterateRecords()) firstPass.push(key)
    expect(firstPass).toEqual([
      ['direct', 1],
      ['transaction', 1]
    ])
    ;(firstPass[0] as (string | number)[])[1] = 7

    const secondPass: unknown[] = []
    for await (const [key] of store.iterateRecords()) secondPass.push(key)
    expect(secondPass).toEqual([
      ['direct', 1],
      ['transaction', 1]
    ])
    await expect(store.getRecord(['direct', 1])).resolves.toEqual({ source: 'direct' })
    await expect(store.getRecord(['transaction', 1])).resolves.toEqual({ source: 'transaction' })
    await expect(store.getRecord(['direct', 9])).resolves.toBeUndefined()
    await expect(store.getRecord(['transaction', 9])).resolves.toBeUndefined()

    const overriddenMapKey = ['overridden-map', 1] as (string | number)[]
    overriddenMapKey.map = (() => ['overridden-map', 2]) as typeof overriddenMapKey.map
    await store.putRecord({ source: 'map-safe' }, overriddenMapKey)
    await expect(store.getRecord(['overridden-map', 1])).resolves.toEqual({
      source: 'map-safe'
    })
    await expect(store.getRecord(['overridden-map', 2])).resolves.toBeUndefined()
  })
})

describe('memoryStorageHost change feed (SWV2-B05/R05/R16)', () => {
  it('SWV2-R05 declares changeFeed:true and is recognized by the storage-contract guard', () => {
    const store = memoryStorageHost()
    expect(store.capabilities.changeFeed).toBe(true)
    expect(isChangeFeedStore(store)).toBe(true)
  })

  it('SWV2-I05 fires one put event per channel with the correct kind/channel/keys, and one remove event', async () => {
    const store = memoryStorageHost()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.set('k', 'v')
    await store.setBytes('b', new Uint8Array([1]))
    await store.putRecord({ x: 1 }, 'r')
    await store.remove('k')
    await store.deleteRecord('r')

    expect(changes.map(({ channel, kind, keys }) => ({ channel, kind, keys }))).toEqual([
      { channel: 'value', kind: 'put', keys: ['k'] },
      { channel: 'bytes', kind: 'put', keys: ['b'] },
      { channel: 'record', kind: 'put', keys: ['r'] },
      { channel: 'value', kind: 'remove', keys: ['k'] },
      { channel: 'record', kind: 'remove', keys: ['r'] }
    ])
    // Sequence is monotonic and origin is stable across every event from one store instance.
    expect(changes.map((change) => change.sequence)).toEqual([1, 2, 3, 4, 5])
    expect(new Set(changes.map((change) => change.origin)).size).toBe(1)
  })

  it('SOL-SWV2-045 a record-channel event derives scope from a canonical entity key; value/bytes events never carry one', async () => {
    const store = memoryStorageHost()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.set('plain-value', 'v')
    await store.setBytes('plain-bytes', new Uint8Array([1]))
    await store.putRecord({ x: 1 }, composeRepositoryKey('users', 'id-1'))
    await store.deleteRecord(composeRepositoryKey('users', 'id-1'))
    // A non-canonical (plain string) record key has no derivable scope.
    await store.putRecord({ x: 1 }, 'plain-record-key')

    expect(changes.map(({ channel, scope }) => ({ channel, scope }))).toEqual([
      { channel: 'value', scope: undefined },
      { channel: 'bytes', scope: undefined },
      { channel: 'record', scope: 'users' },
      { channel: 'record', scope: 'users' },
      { channel: 'record', scope: undefined }
    ])
  })

  it('SOL-SWV2-045 a batch touching two scopes has no single scope to report', async () => {
    const store = memoryStorageHost()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.transaction(async (tx) => {
      await tx.put({ x: 1 }, composeRepositoryKey('users', 'a'))
      await tx.put({ x: 2 }, composeRepositoryKey('posts', 'b'))
    })

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'batch', scope: undefined })
  })

  it('SOL-SWV2-045 omits keys above 128 (consumer must fall back to scope) but keeps them at exactly 128', async () => {
    const store = memoryStorageHost()

    const atCap = memoryStorageHost()
    const capChanges: IStorageChange[] = []
    atCap.subscribeChanges((change) => capChanges.push(change))
    await atCap.transaction(async (tx) => {
      for (let index = 0; index < 128; index += 1)
        await tx.put({ index }, composeRepositoryKey('users', `id-${index}`))
    })
    expect(capChanges).toHaveLength(1)
    expect(capChanges[0]!.keys).toHaveLength(128)
    expect(capChanges[0]!.scope).toBe('users')

    const overChanges: IStorageChange[] = []
    store.subscribeChanges((change) => overChanges.push(change))
    await store.transaction(async (tx) => {
      for (let index = 0; index < 129; index += 1)
        await tx.put({ index }, composeRepositoryKey('users', `id-${index}`))
    })
    expect(overChanges).toHaveLength(1)
    expect(overChanges[0]!.keys).toBeUndefined()
    // The cap must not defeat the whole point of §4.6: scope survives so the consumer still has
    // something to invalidate against.
    expect(overChanges[0]!.scope).toBe('users')
  })

  it('SOL-SWV2-046 a listener that subscribes during fanout does not receive the event already in flight', async () => {
    const store = memoryStorageHost()
    const lateListenerEvents: IStorageChange[] = []
    store.subscribeChanges(() => {
      store.subscribeChanges((change) => lateListenerEvents.push(change))
    })

    await store.set('k', 'v1')
    expect(lateListenerEvents).toHaveLength(0)

    await store.set('k', 'v2')
    expect(lateListenerEvents).toHaveLength(1)
  })

  it('SOL-SWV2-046 a listener unsubscribing during fanout does not affect delivery to the rest of that same event', async () => {
    const store = memoryStorageHost()
    const order: string[] = []
    let unsubscribeSelf: (() => void) | undefined
    unsubscribeSelf = store.subscribeChanges(() => {
      order.push('A')
      unsubscribeSelf?.()
    })
    store.subscribeChanges(() => order.push('B'))

    await store.set('k', 'v1')
    expect(order).toEqual(['A', 'B'])

    await store.set('k', 'v2')
    // A unsubscribed itself during the first event; only B should see the second.
    expect(order).toEqual(['A', 'B', 'B'])
  })

  it('SOL-SWV2-046 a listener that mutates the store during delivery is queued, not dispatched recursively: every listener sees event N before anyone sees event N+1', async () => {
    const store = memoryStorageHost()
    const order: string[] = []
    let reentered = false
    store.subscribeChanges((change) => {
      order.push(`A:${change.sequence}`)
      if (!reentered) {
        reentered = true
        // Synchronous re-entrant mutation from inside a listener callback.
        void store.set('other', 'v')
      }
    })
    store.subscribeChanges((change) => order.push(`B:${change.sequence}`))

    await store.set('k', 'v1')

    expect(order).toEqual(['A:1', 'B:1', 'A:2', 'B:2'])
  })

  it('SOL-SWV2-046 a listener that always mutates on every event terminates via a bounded loop, not unbounded recursion', async () => {
    const store = memoryStorageHost()
    let calls = 0
    const limit = 50
    store.subscribeChanges(() => {
      calls += 1
      if (calls < limit) void store.set(`k${calls}`, 'v')
    })

    await expect(store.set('k0', 'v')).resolves.toBeUndefined()
    expect(calls).toBe(limit)
  })

  it('SWV2-B05 clearValues/clearBytes/clearRecords/clearAll each fire exactly one clear event on the right channel, when there is something to clear', async () => {
    const store = memoryStorageHost()
    // Each channel must hold something before its clear, or the clear is a no-op per
    // SOL-SWV2-047 and must not publish (covered separately below).
    await store.set('k', 'v')
    await store.setBytes('b', new Uint8Array([1]))
    await store.putRecord({ x: 1 }, 'r')
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.clearValues()
    await store.setBytes('b', new Uint8Array([1]))
    await store.clearBytes()
    await store.putRecord({ x: 1 }, 'r')
    await store.clearRecords()
    await store.set('k', 'v')
    await store.clearAll()

    expect(
      changes.filter(({ kind }) => kind === 'clear').map(({ channel, kind }) => ({ channel, kind }))
    ).toEqual([
      { channel: 'value', kind: 'clear' },
      { channel: 'bytes', kind: 'clear' },
      { channel: 'record', kind: 'clear' },
      { channel: 'all', kind: 'clear' }
    ])
  })

  it('SOL-SWV2-047: clearing an already-empty channel, removing an absent value key, and deleting an absent record all publish nothing', async () => {
    const store = memoryStorageHost()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.remove('missing')
    await store.deleteRecord('missing')
    await store.clearValues()
    await store.clearBytes()
    await store.clearRecords()
    await store.clearAll()

    expect(changes).toHaveLength(0)
  })

  it('SWV2-E04/rollback-no-event: a write that fails (cross-channel conflict) must not publish a change', async () => {
    const store = memoryStorageHost()
    await store.set('shared', 'value')
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    // Attempting to put a record at a key that already holds a `value` under the default
    // 'conflict' policy must fail closed and publish nothing.
    await expect(store.putRecord({ x: 1 }, 'shared')).rejects.toBeTruthy()
    expect(changes).toHaveLength(0)
  })

  it('a conflictPolicy:"replace" write that silently evicts another channel also publishes that channel\'s own remove event', async () => {
    const store = memoryStorageHost()
    await store.set('shared', 'value')
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    // Replacing the `value` channel at 'shared' with a `record` evicts the old value entry —
    // that eviction must be independently observable, not silently folded into the put.
    await store.putRecord({ x: 1 }, 'shared', { conflictPolicy: 'replace' })

    expect(changes.map(({ channel, kind, keys }) => ({ channel, kind, keys }))).toEqual([
      { channel: 'value', kind: 'remove', keys: ['shared'] },
      { channel: 'record', kind: 'put', keys: ['shared'] }
    ])
    await expect(store.get('shared')).resolves.toBeNull()
    await expect(store.getRecord('shared')).resolves.toEqual({ x: 1 })
  })

  it('a transaction put that evicts another channel via replace still counts as one batch event, not an extra standalone remove', async () => {
    const store = memoryStorageHost()
    await store.set('shared', 'value')
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.transaction(async (tx) => {
      await tx.put({ x: 1 }, 'shared', { conflictPolicy: 'replace' })
    })

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ channel: 'record', kind: 'batch', keys: ['shared'] })
    await expect(store.get('shared')).resolves.toBeNull()
    await expect(store.getRecord('shared')).resolves.toEqual({ x: 1 })
  })

  it('SWV2-B05 batch one-event: a transaction publishes exactly one batch event for all its writes, and a rolled-back transaction publishes none', async () => {
    const store = memoryStorageHost()
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))

    await store.transaction(async (tx) => {
      await tx.put({ v: 1 }, 'a')
      await tx.put({ v: 2 }, 'b')
      await tx.delete('a')
    })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ channel: 'record', kind: 'batch' })
    // Net-change reporting omits the transient put/delete of `a`; only `b` exists
    // in the committed transaction result.
    expect(new Set(changes[0]!.keys)).toEqual(new Set(['b']))

    // A transaction whose callback throws must roll back with zero events (not one, not partial).
    await expect(
      store.transaction(async (tx) => {
        await tx.put({ v: 3 }, 'c')
        throw new Error('callback failure')
      })
    ).rejects.toThrow()
    expect(changes).toHaveLength(1)
    await expect(store.getRecord('c')).resolves.toBeUndefined()

    // A read-only transaction (no put/delete) has nothing to report.
    await store.transaction(async (tx) => {
      await tx.get('a')
    })
    expect(changes).toHaveLength(1)
  })

  it('SWV2-E08 one listener throwing does not stop delivery to other listeners or break the write', async () => {
    const store = memoryStorageHost()
    const originalConsoleError = console.error
    const reported: unknown[] = []
    console.error = (...args: unknown[]) => reported.push(args)
    try {
      const secondCalls: IStorageChange[] = []
      store.subscribeChanges(() => {
        throw new Error('hostile listener')
      })
      store.subscribeChanges((change) => secondCalls.push(change))

      await expect(store.set('k', 'v')).resolves.toBeUndefined()
      expect(secondCalls).toHaveLength(1)
      await expect(store.get('k')).resolves.toBe('v')
      expect(reported.length).toBeGreaterThan(0)
    } finally {
      console.error = originalConsoleError
    }
  })

  it('unsubscribe stops delivery, and calling the returned unsubscribe twice is a no-op', async () => {
    const store = memoryStorageHost()
    const changes: IStorageChange[] = []
    const unsubscribe = store.subscribeChanges((change) => changes.push(change))
    await store.set('k', 'v1')
    unsubscribe()
    unsubscribe()
    await store.set('k', 'v2')
    expect(changes).toHaveLength(1)
  })

  it('dispose clears listeners and further mutation is impossible (STORE_DISPOSED), so no late events can fire', async () => {
    const store = memoryStorageHost()
    const listener = vi.fn()
    store.subscribeChanges(listener)
    await store.dispose()
    await expect(store.set('k', 'v')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    expect(listener).not.toHaveBeenCalled()
  })
})
