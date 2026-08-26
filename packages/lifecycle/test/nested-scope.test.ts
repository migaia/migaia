import { describe, expect, it } from 'vitest'
import { createLifecycleScope } from '../src/lifecycle-scope'
import { createSyncLifecycleScope } from '../src/sync-lifecycle-scope'
import { LifecycleErrorCode } from '../src/error-code'

/**
 * L-T18（`lifecycle-extraction.sdd.md` §4.5, §5.4）: "异步父可收纳同步子错误；同步父拒绝异步子 scope"。
 *
 * `SyncLifecycleScope` 拒绝拥有 `LifecycleScope`/`ProvisionalScope` 实例已由
 * `sync-lifecycle-scope.test.ts`（L-T4）覆盖。本文件补上此前缺失的另一半：一个真实的异步 `LifecycleScope` 拥有一个真实的同步
 * `SyncLifecycleScope` 子容器，子容器内部失败时， 错误必须折进外层的错误策略——既不会绕过外层策略直接抛穿，也不会在外层完全不知情的情况下丢失。
 */
describe('L-T18 nested scope: an async LifecycleScope can absorb a sync child scope’s error', () => {
  it('the child’s AggregateError (thrown synchronously by its own throw policy) is folded into the parent’s `collect` result, not thrown past it', async () => {
    const child = createSyncLifecycleScope({ errorPolicy: 'throw' })
    child.own(
      {},
      {
        syncSafe: true,
        force: () => {
          throw new Error('child resource A failed')
        }
      }
    )
    child.own(
      {},
      {
        syncSafe: true,
        force: () => {
          throw new Error('child resource B failed')
        }
      }
    )

    const parent = createLifecycleScope({ errorPolicy: 'collect' })
    parent.own(child, {
      syncSafe: false,
      force: () => {
        // child.dispose() throws synchronously here (its own `throw` policy, 2 errors ->
        // AggregateError) — this callback itself throws, exercising the parent's own
        // synchronous-throw capture path in `executeReleaseDescriptor`/`runCallback`.
        child.dispose()
      }
    })

    const collected = await parent.dispose()

    expect(collected).toHaveLength(1)
    const childFailure = collected[0]!.error
    expect(childFailure).toBeInstanceOf(AggregateError)
    expect((childFailure as AggregateError).errors).toHaveLength(2)
    expect((childFailure as AggregateError).errors.map((e: Error) => e.message).sort()).toEqual([
      'child resource A failed',
      'child resource B failed'
    ])
  })

  it('the child’s single error (thrown as-is by its own throw policy) reaches the parent’s throw policy by identity, not just by shape', async () => {
    const originalError = new Error('the one child failure')
    const child = createSyncLifecycleScope({ errorPolicy: 'throw' })
    child.own(
      {},
      {
        syncSafe: true,
        force: () => {
          throw originalError
        }
      }
    )

    const parent = createLifecycleScope({ errorPolicy: 'throw' })
    parent.own(child, {
      syncSafe: false,
      force: () => {
        child.dispose()
      }
    })

    let caught: unknown
    try {
      await parent.dispose()
    } catch (error) {
      caught = error
    }

    // The parent's own `throw` policy sees a single failing item and rethrows it exactly as
    // produced — here that item's error is itself the child's single original error, by identity.
    expect(caught).toBe(originalError)
  })

  it('a report-policy child’s errors are absorbed by the reporter and never surface as a parent-level failure', async () => {
    const reported: unknown[] = []
    const child = createSyncLifecycleScope({
      errorPolicy: 'report',
      report: (error) => reported.push(error)
    })
    child.own(
      {},
      {
        syncSafe: true,
        force: () => {
          throw new Error('child failure, only reported')
        }
      }
    )

    const parent = createLifecycleScope({ errorPolicy: 'throw' })
    parent.own(child, {
      syncSafe: false,
      force: () => {
        // `report` policy never throws, so this force() call itself succeeds cleanly.
        child.dispose()
      }
    })

    await expect(parent.dispose()).resolves.toEqual([])
    expect(reported).toHaveLength(1)
    expect((reported[0] as Error).message).toBe('child failure, only reported')
  })

  it('L-T4 cross-check: a real SyncLifecycleScope still rejects owning a real LifecycleScope instance', () => {
    const asyncChild = createLifecycleScope()
    const syncParent = createSyncLifecycleScope()
    expect(() =>
      syncParent.own(asyncChild, {
        syncSafe: true,
        force: () => {
          /* never reached */
        }
      })
    ).toThrowError(expect.objectContaining({ code: LifecycleErrorCode.scopeSyncViolation }))
  })
})
