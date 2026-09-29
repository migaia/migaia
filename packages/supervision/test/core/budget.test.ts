import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createAbortController } from '@migaia/lifecycle'
import { BudgetRejection, createUnitBudget } from '../../src/index.js'

/** Lets queued mutation tasks progress after a manual clock tick. */
async function flush(): Promise<void> {
  for (let index = 0; index < 12; index++) await Promise.resolve()
}

describe('A2 unit budget', () => {
  it('grants leases in FIFO order, releases once, and times out pending work', async () => {
    const scheduler = createManualScheduler()
    const budget = createUnitBudget({
      kind: 'memory',
      maxUnits: 2,
      queueTimeoutMs: 1_000,
      launchRate: false,
      scheduler
    })
    const first = await budget.acquire()
    const second = await budget.acquire()
    expect(first.kind).toBe('granted')
    expect(second.kind).toBe('granted')
    expect(budget.inUse).toBe(2)
    const third = budget.acquire()
    expect(budget.pending).toBe(1)
    if (first.kind === 'granted') first.lease.release()
    await flush()
    const thirdResult = await third
    expect(thirdResult.kind).toBe('granted')
    expect(budget.inUse).toBe(2)
    if (first.kind === 'granted') first.lease.release()
    expect(budget.inUse).toBe(2)
    const fourth = budget.acquire()
    scheduler.advance(1_000)
    expect(await fourth).toEqual({ kind: 'rejected', reason: BudgetRejection.queueTimeout })
    expect(budget.pending).toBe(0)
    if (second.kind === 'granted') second.lease.release()
    if (thirdResult.kind === 'granted') thirdResult.lease.release()
    expect(budget.inUse).toBe(0)
  })

  it('closes pending work, preserves live leases, and rejects overflow', async () => {
    const scheduler = createManualScheduler()
    const budget = createUnitBudget({
      kind: 'memory',
      maxUnits: 1,
      queueTimeoutMs: 1_000,
      launchRate: false,
      scheduler
    })
    const first = await budget.acquire()
    const waiting = budget.acquire()
    expect(budget.pending).toBe(1)
    budget.close()
    expect(await waiting).toEqual({ kind: 'rejected', reason: BudgetRejection.closed })
    expect(await budget.acquire()).toEqual({ kind: 'rejected', reason: BudgetRejection.closed })
    expect(budget.tryAcquire()).toEqual({ kind: 'rejected', reason: BudgetRejection.closed })
    expect(budget.inUse).toBe(1)
    if (first.kind === 'granted') first.lease.release()
    expect(budget.inUse).toBe(0)

    const rejecting = createUnitBudget({
      kind: 'memory',
      maxUnits: 0,
      overflow: 'reject',
      launchRate: false,
      scheduler
    })
    expect(await rejecting.acquire()).toEqual({ kind: 'rejected', reason: BudgetRejection.full })
  })

  it('applies a rolling launch rate and releases child slots on parent refusal', async () => {
    const scheduler = createManualScheduler()
    const rate = createUnitBudget({
      kind: 'memory',
      maxUnits: 3,
      launchRate: { max: 2, windowMs: 1_000 },
      scheduler
    })
    const first = rate.tryAcquire()
    const second = rate.tryAcquire()
    expect(rate.tryAcquire()).toEqual({ kind: 'rejected', reason: BudgetRejection.rateLimited })
    const third = rate.acquire()
    await flush()
    scheduler.advance(1_000)
    await flush()
    const result = await third
    expect(result.kind).toBe('granted')
    for (const outcome of [first, second, result])
      if (outcome.kind === 'granted') outcome.lease.release()

    const parent = createUnitBudget({
      kind: 'memory',
      maxUnits: 0,
      launchRate: false,
      queueTimeoutMs: 1_000,
      scheduler
    })
    const child = createUnitBudget({
      kind: 'memory',
      maxUnits: 1,
      launchRate: false,
      queueTimeoutMs: 5_000,
      parent,
      scheduler
    })
    const childPending = child.acquire()
    await flush()
    expect(child.inUse).toBe(1)
    expect(parent.pending).toBe(1)
    scheduler.advance(1_000)
    await flush()
    expect(await childPending).toEqual({ kind: 'rejected', reason: BudgetRejection.queueTimeout })
    expect(child.inUse).toBe(0)
    expect(parent.pending).toBe(0)
  })

  it('settles caller cancellation and a child deadline while its parent still waits', async () => {
    const scheduler = createManualScheduler()
    const parent = createUnitBudget({
      kind: 'memory',
      maxUnits: 0,
      queueTimeoutMs: 10_000,
      launchRate: false,
      scheduler
    })
    const child = createUnitBudget({
      kind: 'memory',
      maxUnits: 1,
      queueTimeoutMs: 5_000,
      launchRate: false,
      parent,
      scheduler
    })
    const pending = child.acquire()
    await flush()
    expect(child.inUse).toBe(1)
    expect(parent.pending).toBe(1)
    scheduler.advance(5_000)
    await flush()
    expect(await pending).toEqual({ kind: 'rejected', reason: BudgetRejection.queueTimeout })
    expect(child.inUse).toBe(0)
    expect(parent.pending).toBe(0)

    const controller = createAbortController()
    const aborted = child.acquire(controller.signal)
    await flush()
    controller.abort()
    expect(await aborted).toEqual({ kind: 'rejected', reason: BudgetRejection.aborted })
    await flush()
    expect(child.inUse).toBe(0)
    expect(parent.pending).toBe(0)
  })
})
