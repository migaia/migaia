// Channel conformance cases: key-value, binary, records, iteration, cross-channel and sync binary.
import type { IConformanceCase, IConformanceHarness } from './harness.ts'
import { conformanceCleanup, invocation } from './harness.ts'
import type { IRecordStore } from '../store.ts'
import { isKeyValueStore } from '../store.ts'
import { walkErrorCauses } from '@migaia/utils/error'

/** Deliberate callback failures prove rollback without depending on a runner error type. */
export const ConformanceFailure = {
  rollback: 'conformance rollback',
  repeatedPolicy: 'conformance policy read twice'
} as const
/** The migrated suite asserts its required callable methods before executing the selected group. */
export function keyValueCases(
  check: IConformanceCase,
  harness: IConformanceHarness,
  methods: readonly string[]
) {
  return (name: string, run: (store: IRecordStore) => void | PromiseLike<void>) =>
    check(name, (store) => {
      harness.expect(isKeyValueStore(store)).toBe(true)
      for (const method of methods)
        harness.expect(typeof Reflect.get(store, method)).toBe('function')
      return run(store as unknown as IRecordStore)
    })
}

/** Native transaction wrappers retain semantic failures on their original cause chain. */
export async function conformanceTransactionFailure(
  harness: IConformanceHarness,
  store: Pick<IRecordStore, 'backend'>,
  run: () => unknown,
  code: string
): Promise<void> {
  let failure: unknown
  try {
    await run()
  } catch (error) {
    failure = error
  }
  if (
    store.backend === 'memory' ||
    store.backend === 'indexed-db' ||
    (typeof failure === 'object' && failure !== null && Reflect.get(failure, 'code') === code)
  ) {
    harness.expect(failure).toMatchObject({ code })
    return
  }
  harness.expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED' })
  harness
    .expect(
      walkErrorCauses(failure)
        .slice(1)
        .some(
          (cause) =>
            typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === code
        )
    )
    .toBe(true)
}

/** Original Web kv assertions, using one fresh fixture per registered case. */
export function kvConformance(checkCase: IConformanceCase, harness: IConformanceHarness): void {
  const check = keyValueCases(checkCase, harness, [])
  const expect = harness.expect
  check('get 未写入的 key 返回 null', async (store) => {
    await expect(store.get('missing')).resolves.toBeNull()
  })

  check('set 后 get 返回同值', async (store) => {
    await store.set('k', 'v1')
    await expect(store.get('k')).resolves.toBe('v1')
  })

  check('set 同 key 覆盖', async (store) => {
    await store.set('k', 'v1')
    await store.set('k', 'v2')
    await expect(store.get('k')).resolves.toBe('v2')
  })

  check('remove 后 get 返回 null', async (store) => {
    await store.set('k', 'v1')
    await store.remove('k')
    await expect(store.get('k')).resolves.toBeNull()
  })

  check('remove 不存在的 key 不抛错', async (store) => {
    await expect(store.remove('never-set')).resolves.toBeUndefined()
  })

  check('has 与 get 的存在性判断一致', async (store) => {
    await expect(store.has('k')).resolves.toBe(false)
    await store.set('k', 'v')
    await expect(store.has('k')).resolves.toBe(true)
  })

  check('keys 只返回本命名空间的键', async (store) => {
    await store.set('a', '1')
    await store.set('b', '2')
    const keys = await store.keys()
    expect(new Set(keys)).toEqual(new Set(['a', 'b']))
  })

  check('clear 只清本命名空间', async (store) => {
    await store.set('a', '1')
    await store.set('b', '2')
    await store.clearAll()
    await expect(store.keys()).resolves.toEqual([])
  })

  check('空字符串值可以正确往返', async (store) => {
    await store.set('empty', '')
    await expect(store.get('empty')).resolves.toBe('')
    await expect(store.has('empty')).resolves.toBe(true)
  })

  check('key 含特殊字符（: / 空格 中文 emoji）可往返', async (store) => {
    const specialKeys = ['a:b', 'a/b', 'a b', '中文键', '🎉key']
    for (const key of specialKeys) {
      await store.set(key, `value-for-${key}`)
    }
    for (const key of specialKeys) {
      await expect(store.get(key)).resolves.toBe(`value-for-${key}`)
    }
  })

  check('value 含换行、引号、NUL 可往返', async (store) => {
    const value = 'line1\nline2\t"quoted"\0tail'
    await store.set('special-value', value)
    await expect(store.get('special-value')).resolves.toBe(value)
  })

  check('dispose 后任何 L0 操作抛 STORE_DISPOSED', async (store) => {
    await store.dispose()
    await expect(invocation(() => store.get('k'))).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(invocation(() => store.set('k', 'v'))).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    await expect(invocation(() => store.remove('k'))).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    await expect(invocation(() => store.has('k'))).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(invocation(() => store.keys())).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(invocation(() => store.clearAll())).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
  })

  check('已 abort 的 signal 立即以 ABORTED 拒绝', async (store) => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      invocation(() => store.get('k', { signal: controller.signal }))
    ).rejects.toMatchObject({
      code: 'ABORTED'
    })
  })

  check('capabilities 与实际能力自洽', async (store) => {
    if (store.capabilities.syncRead) expect(store.sync).toBeDefined()
    else expect(store.sync).toBeUndefined()
  })

  check('clearValues 只清 value 通道', async (store) => {
    await store.set('value', 'v')
    await store.clearValues()
    await expect(store.get('value')).resolves.toBeNull()
  })
}

/** Original Web binary assertions, using one fresh fixture per registered case. */
export function binaryConformance(checkCase: IConformanceCase, harness: IConformanceHarness): void {
  const check = keyValueCases(checkCase, harness, [
    'getBytes',
    'setBytes',
    'removeBytes',
    'clearBytes'
  ])
  const expect = harness.expect
  check('getBytes/setBytes 原样往返', async (store) => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    await store.setBytes('bytes-key', bytes)
    await expect(store.getBytes('bytes-key')).resolves.toEqual(bytes)
  })

  check('getBytes 未写入的 key 返回 null', async (store) => {
    await expect(store.getBytes('missing')).resolves.toBeNull()
  })

  check('setBytes 写入时隔离调用方的 Uint8Array view', async (store) => {
    const buffer = new Uint8Array([9, 8, 7])
    const view = buffer.subarray(1)
    await store.setBytes('bytes-clone', view)
    view[0] = 0
    buffer[2] = 1
    await expect(store.getBytes('bytes-clone')).resolves.toEqual(new Uint8Array([8, 7]))
  })
}

/** Original Web records assertions, using one fresh fixture per registered case. */
export function recordsConformance(
  checkCase: IConformanceCase,
  harness: IConformanceHarness
): void {
  const check = keyValueCases(checkCase, harness, [
    'getRecord',
    'putRecord',
    'deleteRecord',
    'clearRecords'
  ])
  const expect = harness.expect
  check('putRecord 不传 key 时自动生成，且可用它读回', async (store) => {
    const key = await store.putRecord({ a: 1 })
    await expect(store.getRecord(key)).resolves.toEqual({ a: 1 })
  })

  check('putRecord 传 key 时使用调用方指定的 key', async (store) => {
    await store.putRecord({ a: 1 }, 'fixed-key')
    await expect(store.getRecord('fixed-key')).resolves.toEqual({ a: 1 })
  })

  check('getRecord 未写入的 key 返回 undefined', async (store) => {
    await expect(store.getRecord('missing')).resolves.toBeUndefined()
  })

  check('deleteRecord 后 getRecord 返回 undefined', async (store) => {
    await store.putRecord({ a: 1 }, 'k')
    await store.deleteRecord('k')
    await expect(store.getRecord('k')).resolves.toBeUndefined()
  })

  check('clear 后重建 record 遵守原生串行或乐观 ABA 检查', async (store) => {
    await store.putRecord({ value: 0 }, 'aba-record')
    // Strong concurrent snapshot/ABA assertions retain their original memory/IndexedDB domain.
    // Other native isolation guarantees remain in the corresponding backend's own conformance.
    if (store.backend !== 'memory' && store.backend !== 'indexed-db') {
      await store.transaction(async (tx) => {
        await expect(tx.getRecord('aba-record')).resolves.toEqual({ value: 0 })
        await tx.putRecord({ value: 1 }, 'aba-record')
      })
      await store.putRecord({ value: 2 }, 'aba-record', { conflictPolicy: 'replace' })
      await expect(store.getRecord('aba-record')).resolves.toEqual({ value: 2 })
      return
    }
    if (store.backend === 'indexed-db') {
      const first = store.transaction(async (tx) => {
        await tx.getRecord('aba-record')
        await Promise.resolve()
        await tx.putRecord({ value: 2 }, 'aba-record')
      })
      const clearing = store.clearRecords()
      await first
      await clearing
      await store.putRecord({ value: 1 }, 'aba-record')
      await expect(store.getRecord('aba-record')).resolves.toEqual({ value: 1 })
      return
    }
    let release: (() => void) | undefined
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = store.transaction(async (tx) => {
      await tx.getRecord('aba-record')
      await paused
      await tx.putRecord({ value: 2 }, 'aba-record')
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    await store.clearRecords()
    await store.putRecord({ value: 1 }, 'aba-record')
    release!()
    await expect(first).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    await expect(store.getRecord('aba-record')).resolves.toEqual({ value: 1 })
  })

  check('读写 record 使用结构化克隆隔离调用方引用', async (store) => {
    const source = { nested: { value: 1 } }
    await store.putRecord(source, 'clone-key')
    source.nested.value = 2
    const first = await store.getRecord('clone-key')
    expect(first).toEqual({ nested: { value: 1 } })
    ;(first as { nested: { value: number } }).nested.value = 3
    await expect(store.getRecord('clone-key')).resolves.toEqual({ nested: { value: 1 } })
  })

  check('dispose 后所有 L1 操作抛 STORE_DISPOSED', async (store) => {
    await store.dispose()
    await expect(invocation(() => store.getBytes('k'))).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    await expect(invocation(() => store.getRecord('k'))).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    await expect(invocation(() => store.putRecord({}, 'k'))).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    await expect(invocation(() => store.deleteRecord('k'))).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
  })
}

/** Original Web iteration assertions, using one fresh fixture per registered case. */
export function iterationConformance(
  checkCase: IConformanceCase,
  harness: IConformanceHarness
): void {
  const check = keyValueCases(checkCase, harness, ['putRecord', 'iterateRecords'])
  const expect = harness.expect
  check(
    'iteration · return and symbolic disposal share the original terminal resource',
    async (store) => {
      await store.putRecord({ value: 1 }, 'iterator-key')
      const iterator = store.iterateRecords()
      await conformanceCleanup(iterator, async () => {
        await expect(iterator.next()).resolves.toMatchObject({ done: false })
        expect(typeof iterator.return).toBe('function')
        await expect(iterator.return!()).resolves.toMatchObject({ done: true })
        expect(iterator.dispose()).toBe(iterator.dispose())
        expect(iterator[Symbol.asyncDispose]()).toBe(iterator[Symbol.asyncDispose]())
        await expect(iterator.next()).resolves.toMatchObject({ done: true })
      })
    }
  )
  check('iterateRecords 遍历全部已写入 record', async (store) => {
    await store.putRecord({ v: 1 }, 'a')
    await store.putRecord({ v: 2 }, 'b')
    const seen: unknown[] = []
    for await (const [, value] of store.iterateRecords()) seen.push(value)
    expect(seen).toEqual([{ v: 1 }, { v: 2 }])
  })

  check('非法空数组 key 与反向 range 统一抛稳定错误', async (store) => {
    await expect(invocation(() => store.putRecord({ v: 1 }, []))).rejects.toMatchObject({
      code: 'INVALID_KEY'
    })
    let failure: unknown
    try {
      await store.iterateRecords({ lower: 'z', upper: 'a' }).next()
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(
      typeof failure === 'object' &&
        failure !== null &&
        Reflect.get(failure, 'cause') instanceof RangeError
    ).toBe(true)
  })
}

/** Original Web crossChannel assertions, using one fresh fixture per registered case. */
export function crossChannelConformance(
  checkCase: IConformanceCase,
  harness: IConformanceHarness
): void {
  const check = keyValueCases(checkCase, harness, [
    'getBytes',
    'setBytes',
    'getRecord',
    'putRecord',
    'clearBytes',
    'clearRecords'
  ])
  const expect = harness.expect
  check('通道清理彼此隔离，跨通道冲突可显式 replace', async (store) => {
    await store.setBytes('shared', new Uint8Array([1]))
    await expect(invocation(() => store.set('shared', 'value'))).rejects.toMatchObject({
      code: 'DUPLICATE_KEY'
    })
    await store.set('shared', 'value', { conflictPolicy: 'replace' })
    await expect(store.getBytes('shared')).resolves.toBeNull()
    await expect(store.get('shared')).resolves.toBe('value')
    await store.putRecord({ value: 1 }, 'record-key', { conflictPolicy: 'replace' })
    await store.clearBytes()
    await expect(store.get('shared')).resolves.toBe('value')
    await expect(store.getRecord('record-key')).resolves.toEqual({ value: 1 })
    await store.clearRecords()
    await expect(store.getRecord('record-key')).resolves.toBeUndefined()
  })

  check('clearValues 不删除 bytes 与 records', async (store) => {
    await store.set('value', 'v')
    await store.setBytes('bytes', new Uint8Array([7]))
    await store.putRecord({ value: 8 }, 'record')
    await store.clearValues()
    await expect(store.get('value')).resolves.toBeNull()
    await expect(store.getBytes('bytes')).resolves.toEqual(new Uint8Array([7]))
    await expect(store.getRecord('record')).resolves.toEqual({ value: 8 })
  })
}

/** Original Web syncBinary assertions, using one fresh fixture per registered case. */
export function syncBinaryConformance(
  checkCase: IConformanceCase,
  harness: IConformanceHarness
): void {
  const check = keyValueCases(checkCase, harness, ['setBytes'])
  const expect = harness.expect
  check('sync.set 与异步 set 使用同一冲突策略', async (store) => {
    const recordStore = store as IRecordStore
    await recordStore.setBytes('sync-conflict', new Uint8Array([1]))
    if (store.backend === 'memory' || store.backend === 'indexed-db')
      expect(() => store.sync!.set('sync-conflict', 'v')).toThrow(/DUPLICATE_KEY|duplicate/i)
    else
      await expect(invocation(() => store.sync!.set('sync-conflict', 'v'))).rejects.toMatchObject({
        code: 'DUPLICATE_KEY'
      })
  })
}
