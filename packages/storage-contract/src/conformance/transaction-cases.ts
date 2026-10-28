// Transaction conformance cases, one fresh fixture per registered case.
import type { IConformanceCase, IConformanceHarness } from './harness.ts'
import { invocation } from './harness.ts'
import type { ITransactionScope } from '../transaction.ts'
import { keyValueCases, conformanceTransactionFailure, ConformanceFailure } from './channels.ts'

/** Original Web transactions assertions, using one fresh fixture per registered case. */
export function transactionsConformance(
  checkCase: IConformanceCase,
  harness: IConformanceHarness
): void {
  const check = keyValueCases(checkCase, harness, ['getRecord', 'putRecord', 'transaction'])
  const expect = harness.expect
  check(
    'transaction · accepted writes drain and caught first failure rolls back',
    async (store) => {
      await store.transaction((tx) => {
        void tx.putRecord({ accepted: true }, 'accepted-write')
      })
      await expect(store.getRecord('accepted-write')).resolves.toEqual({ accepted: true })
      await conformanceTransactionFailure(
        harness,
        store,
        () =>
          store.transaction(async (tx) => {
            try {
              await tx.putRecord({ invalid: true }, 'invalid-write', {
                conflictPolicy: 'invalid'
              } as never)
            } catch {
              /* The owner retains the original operation failure even when user code catches it. */
            }
            await tx.putRecord({ rolledBack: true }, 'after-first-failure')
          }),
        'INVALID_ARGUMENT'
      )
      await expect(store.getRecord('after-first-failure')).resolves.toBeUndefined()
    }
  )
  check('transaction 内的写入在成功后持久化', async (store) => {
    await store.transaction(async (tx) => {
      await tx.putRecord({ v: 1 }, 'tx-key')
    })
    await expect(store.getRecord('tx-key')).resolves.toEqual({ v: 1 })
  })

  check('transaction 入口拒绝非法 callback', async (store) => {
    for (const run of [null, undefined, [], {}, 'run', 1])
      await expect(invocation(() => store.transaction(run as never))).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
  })

  check('transaction scope put 拒绝非法 write options 与 conflictPolicy', async (store) => {
    for (const options of [null, [], 'options', 1, { conflictPolicy: 'invalid' }])
      await conformanceTransactionFailure(
        harness,
        store,
        () =>
          store.transaction((tx) => tx.putRecord({ v: 1 }, 'invalid-options', options as never)),
        'INVALID_ARGUMENT'
      )
    await expect(store.getRecord('invalid-options')).resolves.toBeUndefined()
    let reads = 0
    await expect(
      store.transaction((tx) =>
        tx.putRecord({ v: 2 }, 'policy-snapshot', {
          get conflictPolicy() {
            reads += 1
            if (reads > 1) throw new Error(ConformanceFailure.repeatedPolicy)
            return 'replace' as const
          }
        })
      )
    ).resolves.toBe('policy-snapshot')
    expect(reads).toBe(1)
  })

  check('transaction callback 结束后逃逸 scope 拒绝继续读写', async (store) => {
    let escaped: ITransactionScope<unknown> | undefined
    await store.transaction(async (tx) => {
      escaped = tx
      await tx.putRecord({ v: 1 }, 'inside')
    })

    await expect(invocation(() => escaped!.getRecord('inside'))).rejects.toMatchObject(
      store.backend === 'memory' || store.backend === 'indexed-db'
        ? { code: 'TRANSACTION_FAILED', operation: 'transaction.scope' }
        : { code: 'TRANSACTION_FAILED' }
    )
    await expect(invocation(() => escaped!.putRecord({ v: 2 }, 'outside'))).rejects.toMatchObject(
      store.backend === 'memory' || store.backend === 'indexed-db'
        ? { code: 'TRANSACTION_FAILED', operation: 'transaction.scope' }
        : { code: 'TRANSACTION_FAILED' }
    )
    await expect(invocation(() => escaped!.deleteRecord('inside'))).rejects.toMatchObject(
      store.backend === 'memory' || store.backend === 'indexed-db'
        ? { code: 'TRANSACTION_FAILED', operation: 'transaction.scope' }
        : { code: 'TRANSACTION_FAILED' }
    )
    await expect(store.getRecord('outside')).resolves.toBeUndefined()
  })

  check('transaction record 写入遵守跨通道 conflict/replace', async (store) => {
    await store.set('shared-tx', 'value')
    await conformanceTransactionFailure(
      harness,
      store,
      () => store.transaction((tx) => tx.putRecord({ v: 1 }, 'shared-tx')),
      'DUPLICATE_KEY'
    )
    await expect(
      store.transaction((tx) => tx.putRecord({ v: 2 }, 'shared-tx', { conflictPolicy: 'replace' }))
    ).resolves.toBe('shared-tx')
    await expect(store.get('shared-tx')).resolves.toBeNull()
    await expect(store.getRecord('shared-tx')).resolves.toEqual({ v: 2 })
  })
  transactionsConformanceRest(checkCase, harness)
}

/** Second half of the transactionsConformance cases; same fixtures and assertions, split for size. */
function transactionsConformanceRest(
  checkCase: IConformanceCase,
  harness: IConformanceHarness
): void {
  const check = keyValueCases(checkCase, harness, ['getRecord', 'putRecord', 'transaction'])
  const expect = harness.expect
  check('transaction 内抛错时整批写入回滚', async (store) => {
    await store.putRecord({ v: 'before' }, 'existing')
    await expect(
      store.transaction(async (tx) => {
        await tx.putRecord({ v: 'new' }, 'tx-key')
        await tx.deleteRecord('existing')
        throw new Error(ConformanceFailure.rollback)
      })
    ).rejects.toThrow()
    await expect(store.getRecord('tx-key')).resolves.toBeUndefined()
    await expect(store.getRecord('existing')).resolves.toEqual({ v: 'before' })
  })
  check('transaction callback abort 后不提交草稿', async (store) => {
    const controller = new AbortController()
    await expect(
      store.transaction(
        async (tx) => {
          await tx.putRecord({ value: 'must-not-commit' }, 'abort-transaction')
          controller.abort()
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(store.getRecord('abort-transaction')).resolves.toBeUndefined()
  })
  check('transaction 对实际并发写采用后端隔离语义', async (store) => {
    await store.putRecord({ value: 0 }, 'revision-conflict')
    // Strong concurrent snapshot/ABA assertions retain their original memory/IndexedDB domain.
    // Other native isolation guarantees remain in the corresponding backend's own conformance.
    if (store.backend !== 'memory' && store.backend !== 'indexed-db') {
      await store.transaction(async (tx) => {
        await expect(tx.getRecord('revision-conflict')).resolves.toEqual({ value: 0 })
        await expect(tx.getRecord('revision-conflict')).resolves.toEqual({ value: 0 })
      })
      await store.putRecord({ value: 1 }, 'revision-conflict', { conflictPolicy: 'replace' })
      await expect(store.getRecord('revision-conflict')).resolves.toEqual({ value: 1 })
      return
    }
    if (store.backend === 'indexed-db') {
      const first = store.transaction(async (tx) => {
        await tx.getRecord('revision-conflict')
        await Promise.resolve()
        await tx.putRecord({ value: 1 }, 'revision-conflict')
      })
      const concurrent = store.putRecord({ value: 2 }, 'revision-conflict', {
        conflictPolicy: 'replace'
      })
      await first
      await concurrent
      await expect(store.getRecord('revision-conflict')).resolves.toEqual({ value: 2 })
      return
    }
    let release: (() => void) | undefined
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = store.transaction(async (tx) => {
      await tx.getRecord('revision-conflict')
      await paused
      await tx.putRecord({ value: 1 }, 'revision-conflict')
    })
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))
    await store.putRecord({ value: 2 }, 'revision-conflict', { conflictPolicy: 'replace' })
    release!()
    await expect(first).rejects.toMatchObject({
      code: 'WRITE_CONFLICT'
    })
    await expect(store.getRecord('revision-conflict')).resolves.toEqual({ value: 2 })
  })
  check('transaction 保持 repeatable snapshot，按后端原生或乐观规则提交', async (store) => {
    await store.putRecord({ value: 0 }, 'repeatable-read')
    // Strong concurrent snapshot/ABA assertions retain their original memory/IndexedDB domain.
    // Other native isolation guarantees remain in the corresponding backend's own conformance.
    if (store.backend !== 'memory' && store.backend !== 'indexed-db') {
      await store.transaction(async (tx) => {
        await expect(tx.getRecord('repeatable-read')).resolves.toEqual({ value: 0 })
        await expect(tx.getRecord('repeatable-read')).resolves.toEqual({ value: 0 })
      })
      await store.putRecord({ value: 1 }, 'repeatable-read', { conflictPolicy: 'replace' })
      await expect(store.getRecord('repeatable-read')).resolves.toEqual({ value: 1 })
      return
    }
    if (store.backend === 'indexed-db') {
      const first = store.transaction(async (tx) => {
        await expect(tx.getRecord('repeatable-read')).resolves.toEqual({ value: 0 })
        await Promise.resolve()
        await expect(tx.getRecord('repeatable-read')).resolves.toEqual({ value: 0 })
      })
      const concurrent = store.putRecord({ value: 1 }, 'repeatable-read', {
        conflictPolicy: 'replace'
      })
      await first
      await concurrent
      await expect(store.getRecord('repeatable-read')).resolves.toEqual({ value: 1 })
      return
    }
    let release: (() => void) | undefined
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = store.transaction(async (tx) => {
      await expect(tx.getRecord('repeatable-read')).resolves.toEqual({ value: 0 })
      await paused
      await expect(tx.getRecord('repeatable-read')).resolves.toEqual({ value: 0 })
    })
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    await store.putRecord({ value: 1 }, 'repeatable-read', { conflictPolicy: 'replace' })
    release!()
    await expect(first).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
  })
  check(
    '空事务（无读写）与并发 clearRecords 不误报冲突（memory 与 indexed-db 一致）',
    async (store) => {
      await store.putRecord({ value: 0 }, 'empty-epoch')
      // Strong concurrent snapshot/ABA assertions retain their original memory/IndexedDB domain.
      // Other native isolation guarantees remain in the corresponding backend's own conformance.
      if (store.backend !== 'memory' && store.backend !== 'indexed-db') {
        await expect(store.transaction(() => undefined)).resolves.toBeUndefined()
        await store.clearRecords()
        await expect(store.getRecord('empty-epoch')).resolves.toBeUndefined()
        return
      }
      if (store.backend === 'indexed-db') {
        const first = store.transaction(async () => {
          await Promise.resolve()
        })
        const clearing = store.clearRecords()
        await expect(first).resolves.toBeUndefined()
        await clearing
        await expect(store.getRecord('empty-epoch')).resolves.toBeUndefined()
        return
      }
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
    }
  )
  check('transaction 成功 delete 会持久化删除', async (store) => {
    await store.putRecord({ v: 1 }, 'delete-key')
    await store.transaction(async (tx) => {
      await tx.deleteRecord('delete-key')
    })
    await expect(store.getRecord('delete-key')).resolves.toBeUndefined()
  })
}
