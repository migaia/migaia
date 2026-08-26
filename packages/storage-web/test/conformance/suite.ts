import { describe, expect, it } from 'vitest'
import type { IRecordStore, IKeyValueStore } from '../../src/types'
import type { ITransactionScope } from '../../src/core/transaction'

/** 后端契约一致性套件。与后端无关的用例工厂，供每个后端各跑一遍（§12.2）。 能力缺失时不允许跳过，只允许按 capabilities 分支断言为预期抛错。 */
export const kvConformance = (
  name: string,
  create: () => IKeyValueStore | Promise<IKeyValueStore>
) => {
  describe(`${name} · L0 conformance`, () => {
    it('get 未写入的 key 返回 null', async () => {
      const store = await create()
      await expect(store.get('missing')).resolves.toBeNull()
    })

    it('set 后 get 返回同值', async () => {
      const store = await create()
      await store.set('k', 'v1')
      await expect(store.get('k')).resolves.toBe('v1')
    })

    it('set 同 key 覆盖', async () => {
      const store = await create()
      await store.set('k', 'v1')
      await store.set('k', 'v2')
      await expect(store.get('k')).resolves.toBe('v2')
    })

    it('remove 后 get 返回 null', async () => {
      const store = await create()
      await store.set('k', 'v1')
      await store.remove('k')
      await expect(store.get('k')).resolves.toBeNull()
    })

    it('remove 不存在的 key 不抛错', async () => {
      const store = await create()
      await expect(store.remove('never-set')).resolves.toBeUndefined()
    })

    it('has 与 get 的存在性判断一致', async () => {
      const store = await create()
      await expect(store.has('k')).resolves.toBe(false)
      await store.set('k', 'v')
      await expect(store.has('k')).resolves.toBe(true)
    })

    it('keys 只返回本命名空间的键', async () => {
      const store = await create()
      await store.set('a', '1')
      await store.set('b', '2')
      const keys = await store.keys()
      expect(new Set(keys)).toEqual(new Set(['a', 'b']))
    })

    it('clear 只清本命名空间', async () => {
      const store = await create()
      await store.set('a', '1')
      await store.set('b', '2')
      await store.clearAll()
      await expect(store.keys()).resolves.toEqual([])
    })

    it('空字符串值可以正确往返', async () => {
      const store = await create()
      await store.set('empty', '')
      await expect(store.get('empty')).resolves.toBe('')
      await expect(store.has('empty')).resolves.toBe(true)
    })

    it('key 含特殊字符（: / 空格 中文 emoji）可往返', async () => {
      const store = await create()
      const specialKeys = ['a:b', 'a/b', 'a b', '中文键', '🎉key']
      for (const key of specialKeys) {
        await store.set(key, `value-for-${key}`)
      }
      for (const key of specialKeys) {
        await expect(store.get(key)).resolves.toBe(`value-for-${key}`)
      }
    })

    it('value 含换行、引号、NUL 可往返', async () => {
      const store = await create()
      const value = 'line1\nline2\t"quoted"\0tail'
      await store.set('special-value', value)
      await expect(store.get('special-value')).resolves.toBe(value)
    })

    it('dispose 后任何 L0 操作抛 STORE_DISPOSED', async () => {
      const store = await create()
      await store.dispose()
      await expect(store.get('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await expect(store.set('k', 'v')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await expect(store.remove('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await expect(store.has('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await expect(store.keys()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await expect(store.clearAll()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    })

    it('已 abort 的 signal 立即以 ABORTED 拒绝', async () => {
      const store = await create()
      const controller = new AbortController()
      controller.abort()
      await expect(store.get('k', { signal: controller.signal })).rejects.toMatchObject({
        code: 'ABORTED'
      })
    })

    it('capabilities 与实际能力自洽', async () => {
      const store = await create()
      if (store.capabilities.syncRead) expect(store.sync).toBeDefined()
      else expect(store.sync).toBeUndefined()
    })

    it('clearValues 只清 value 通道', async () => {
      const store = await create()
      await store.set('value', 'v')
      await store.clearValues()
      await expect(store.get('value')).resolves.toBeNull()
    })

    it('sync.set 与异步 set 使用同一冲突策略', async () => {
      const store = await create()
      if (!store.sync) return
      if (!store.capabilities.binary) return
      const recordStore = store as IRecordStore
      await recordStore.setBytes('sync-conflict', new Uint8Array([1]))
      expect(() => store.sync!.set('sync-conflict', 'v')).toThrow(/DUPLICATE_KEY|duplicate/i)
    })
  })
}

/** L1 record 契约一致性套件，只对声明 capabilities.records 的后端跑。 */
export const recordConformance = (
  name: string,
  create: () => IRecordStore | Promise<IRecordStore>
) => {
  describe(`${name} · L1 conformance`, () => {
    it('putRecord 不传 key 时自动生成，且可用它读回', async () => {
      const store = await create()
      const key = await store.putRecord({ a: 1 })
      await expect(store.getRecord(key)).resolves.toEqual({ a: 1 })
    })

    it('putRecord 传 key 时使用调用方指定的 key', async () => {
      const store = await create()
      await store.putRecord({ a: 1 }, 'fixed-key')
      await expect(store.getRecord('fixed-key')).resolves.toEqual({ a: 1 })
    })

    it('getRecord 未写入的 key 返回 undefined', async () => {
      const store = await create()
      await expect(store.getRecord('missing')).resolves.toBeUndefined()
    })

    it('deleteRecord 后 getRecord 返回 undefined', async () => {
      const store = await create()
      await store.putRecord({ a: 1 }, 'k')
      await store.deleteRecord('k')
      await expect(store.getRecord('k')).resolves.toBeUndefined()
    })

    it('getBytes/setBytes 原样往返', async () => {
      const store = await create()
      const bytes = new Uint8Array([0, 1, 2, 250, 255])
      await store.setBytes('bytes-key', bytes)
      await expect(store.getBytes('bytes-key')).resolves.toEqual(bytes)
    })

    it('getBytes 未写入的 key 返回 null', async () => {
      const store = await create()
      await expect(store.getBytes('missing')).resolves.toBeNull()
    })

    it('setBytes 写入时隔离调用方的 Uint8Array view', async () => {
      const store = await create()
      const buffer = new Uint8Array([9, 8, 7])
      const view = buffer.subarray(1)
      await store.setBytes('bytes-clone', view)
      view[0] = 0
      buffer[2] = 1
      await expect(store.getBytes('bytes-clone')).resolves.toEqual(new Uint8Array([8, 7]))
    })

    it('通道清理彼此隔离，跨通道冲突可显式 replace', async () => {
      const store = await create()
      await store.setBytes('shared', new Uint8Array([1]))
      await expect(store.set('shared', 'value')).rejects.toMatchObject({ code: 'DUPLICATE_KEY' })
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

    it('clearValues 不删除 bytes 与 records', async () => {
      const store = await create()
      await store.set('value', 'v')
      await store.setBytes('bytes', new Uint8Array([7]))
      await store.putRecord({ value: 8 }, 'record')
      await store.clearValues()
      await expect(store.get('value')).resolves.toBeNull()
      await expect(store.getBytes('bytes')).resolves.toEqual(new Uint8Array([7]))
      await expect(store.getRecord('record')).resolves.toEqual({ value: 8 })
    })

    it('iterateRecords 遍历全部已写入 record', async () => {
      const store = await create()
      await store.putRecord({ v: 1 }, 'a')
      await store.putRecord({ v: 2 }, 'b')
      const seen: unknown[] = []
      for await (const [, value] of store.iterateRecords()) seen.push(value)
      expect(seen).toEqual([{ v: 1 }, { v: 2 }])
    })

    it('transaction 内的写入在成功后持久化', async () => {
      const store = await create()
      await store.transaction(async (tx) => {
        await tx.put({ v: 1 }, 'tx-key')
      })
      await expect(store.getRecord('tx-key')).resolves.toEqual({ v: 1 })
    })

    it('transaction 入口拒绝非法 callback', async () => {
      const store = await create()
      for (const run of [null, undefined, [], {}, 'run', 1])
        await expect(store.transaction(run as never)).rejects.toMatchObject({
          code: 'INVALID_ARGUMENT'
        })
    })

    it('transaction scope put 拒绝非法 write options 与 conflictPolicy', async () => {
      const store = await create()
      for (const options of [null, [], 'options', 1, { conflictPolicy: 'invalid' }])
        await expect(
          store.transaction((tx) => tx.put({ v: 1 }, 'invalid-options', options as never))
        ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      await expect(store.getRecord('invalid-options')).resolves.toBeUndefined()
      let reads = 0
      await expect(
        store.transaction((tx) =>
          tx.put({ v: 2 }, 'policy-snapshot', {
            get conflictPolicy() {
              reads += 1
              if (reads > 1) throw new Error('policy read twice')
              return 'replace' as const
            }
          })
        )
      ).resolves.toBe('policy-snapshot')
      expect(reads).toBe(1)
    })

    it('transaction callback 结束后逃逸 scope 拒绝继续读写', async () => {
      const store = await create()
      let escaped: ITransactionScope<unknown> | undefined
      await store.transaction(async (tx) => {
        escaped = tx
        await tx.put({ v: 1 }, 'inside')
      })

      await expect(escaped!.get('inside')).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        operation: 'transaction.scope'
      })
      await expect(escaped!.put({ v: 2 }, 'outside')).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        operation: 'transaction.scope'
      })
      await expect(escaped!.delete('inside')).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED',
        operation: 'transaction.scope'
      })
      await expect(store.getRecord('outside')).resolves.toBeUndefined()
    })

    it('transaction record 写入遵守跨通道 conflict/replace', async () => {
      const store = await create()
      await store.set('shared-tx', 'value')
      await expect(store.transaction((tx) => tx.put({ v: 1 }, 'shared-tx'))).rejects.toMatchObject({
        code: 'DUPLICATE_KEY'
      })
      await expect(
        store.transaction((tx) => tx.put({ v: 2 }, 'shared-tx', { conflictPolicy: 'replace' }))
      ).resolves.toBe('shared-tx')
      await expect(store.get('shared-tx')).resolves.toBeNull()
      await expect(store.getRecord('shared-tx')).resolves.toEqual({ v: 2 })
    })

    it('transaction 内抛错时整批写入回滚', async () => {
      const store = await create()
      await store.putRecord({ v: 'before' }, 'existing')
      await expect(
        store.transaction(async (tx) => {
          await tx.put({ v: 'new' }, 'tx-key')
          await tx.delete('existing')
          throw new Error('boom')
        })
      ).rejects.toThrow()
      await expect(store.getRecord('tx-key')).resolves.toBeUndefined()
      await expect(store.getRecord('existing')).resolves.toEqual({ v: 'before' })
    })

    it('transaction callback abort 后不提交草稿', async () => {
      const store = await create()
      const controller = new AbortController()
      await expect(
        store.transaction(
          async (tx) => {
            await tx.put({ value: 'must-not-commit' }, 'abort-transaction')
            controller.abort()
          },
          { signal: controller.signal }
        )
      ).rejects.toMatchObject({ code: 'ABORTED' })
      await expect(store.getRecord('abort-transaction')).resolves.toBeUndefined()
    })

    it('transaction 检测 await 期间的 record revision 冲突', async () => {
      const store = await create()
      await store.putRecord({ value: 0 }, 'revision-conflict')
      let release: (() => void) | undefined
      const paused = new Promise<void>((resolve) => {
        release = resolve
      })
      const first = store.transaction(async (tx) => {
        await tx.get('revision-conflict')
        await paused
        await tx.put({ value: 1 }, 'revision-conflict')
      })
      await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
      await store.putRecord({ value: 2 }, 'revision-conflict', { conflictPolicy: 'replace' })
      release!()
      await expect(first).rejects.toMatchObject({
        code: 'TRANSACTION_CONFLICT',
        operation: 'transaction.commit'
      })
      await expect(store.getRecord('revision-conflict')).resolves.toEqual({ value: 2 })
    })

    it('transaction 在外部写入后仍返回 repeatable snapshot，并拒绝只读提交', async () => {
      const store = await create()
      await store.putRecord({ value: 0 }, 'repeatable-read')
      let release: (() => void) | undefined
      const paused = new Promise<void>((resolve) => {
        release = resolve
      })
      const first = store.transaction(async (tx) => {
        await expect(tx.get('repeatable-read')).resolves.toEqual({ value: 0 })
        await paused
        await expect(tx.get('repeatable-read')).resolves.toEqual({ value: 0 })
      })
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      await store.putRecord({ value: 1 }, 'repeatable-read', { conflictPolicy: 'replace' })
      release!()
      await expect(first).rejects.toMatchObject({ code: 'TRANSACTION_CONFLICT' })
    })

    it('clear 后重建 record 不会通过旧 transaction 的 ABA 检查', async () => {
      const store = await create()
      await store.putRecord({ value: 0 }, 'aba-record')
      let release: (() => void) | undefined
      const paused = new Promise<void>((resolve) => {
        release = resolve
      })
      const first = store.transaction(async (tx) => {
        await tx.get('aba-record')
        await paused
        await tx.put({ value: 2 }, 'aba-record')
      })
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      await store.clearRecords()
      await store.putRecord({ value: 1 }, 'aba-record')
      release!()
      await expect(first).rejects.toMatchObject({ code: 'TRANSACTION_CONFLICT' })
      await expect(store.getRecord('aba-record')).resolves.toEqual({ value: 1 })
    })

    it('空事务（无读写）与并发 clearRecords 不误报冲突（memory 与 indexed-db 一致）', async () => {
      const store = await create()
      await store.putRecord({ value: 0 }, 'empty-epoch')
      let release: (() => void) | undefined
      const paused = new Promise<void>((resolve) => {
        release = resolve
      })
      const first = store.transaction(async (tx) => {
        await paused
        void tx
      })
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      await store.clearRecords()
      release!()
      // 空事务没有建立任何快照，clearRecords 发生在快照之外，两后端都应收敛为「无冲突」提交。
      await expect(first).resolves.toBeUndefined()
    })

    it('transaction 成功 delete 会持久化删除', async () => {
      const store = await create()
      await store.putRecord({ v: 1 }, 'delete-key')
      await store.transaction(async (tx) => {
        await tx.delete('delete-key')
      })
      await expect(store.getRecord('delete-key')).resolves.toBeUndefined()
    })

    it('读写 record 使用结构化克隆隔离调用方引用', async () => {
      const store = await create()
      const source = { nested: { value: 1 } }
      await store.putRecord(source, 'clone-key')
      source.nested.value = 2
      const first = await store.getRecord('clone-key')
      expect(first).toEqual({ nested: { value: 1 } })
      ;(first as { nested: { value: number } }).nested.value = 3
      await expect(store.getRecord('clone-key')).resolves.toEqual({ nested: { value: 1 } })
    })

    it('dispose 后所有 L1 操作抛 STORE_DISPOSED', async () => {
      const store = await create()
      await store.dispose()
      await expect(store.getBytes('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await expect(store.getRecord('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await expect(store.putRecord({}, 'k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await expect(store.deleteRecord('k')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    })

    it('非法空数组 key 与反向 range 统一抛稳定错误', async () => {
      const store = await create()
      await expect(store.putRecord({ v: 1 }, [])).rejects.toMatchObject({
        code: 'INVALID_KEY'
      })
      await expect(store.iterateRecords({ lower: 'z', upper: 'a' }).next()).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
    })
  })
}
