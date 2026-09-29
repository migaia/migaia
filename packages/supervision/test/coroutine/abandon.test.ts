import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createCoroutineSupervisor } from '../../src/coroutine/index.js'
import { deferred } from '../support/memory-launcher.js'

/** Advances pending coroutine and budget continuations. */
async function flush(): Promise<void> {
  for (let index = 0; index < 45; index++) await Promise.resolve()
}

describe('A13 coroutine abandonment and heartbeat', () => {
  it('retains budget capacity until a noncooperative task exits', async () => {
    const scheduler = createManualScheduler()
    const first = deferred<void>()
    const second = deferred<void>()
    const reported: unknown[] = []
    const budget = createUnitBudget({
      kind: 'coroutine',
      maxUnits: 1,
      launchRate: false,
      scheduler
    })
    let calls = 0
    const supervisor = createCoroutineSupervisor({
      id: 'coroutine',
      report: (error) => {
        reported.push(error)
      },
      spec: { task: () => (++calls === 1 ? first.promise : second.promise) },
      budget,
      scheduler
    })
    await supervisor.start()
    const stopping = supervisor.stop()
    await flush()
    scheduler.advance(5_000)
    await stopping
    expect(supervisor.inspect().lastExit?.reason).toBe('abandoned')
    expect((reported[0] as { code?: string })?.code).toBe(SupervisionErrorCode.reapTimeout)
    expect(budget.inUse).toBe(1)
    const restarted = supervisor.start()
    await flush()
    expect(supervisor.state).toBe('queued')
    expect(calls).toBe(1)
    first.resolve()
    await flush()
    expect(calls).toBe(2)
    expect((await restarted).state).toBe('ready')
    expect(budget.inUse).toBe(1)
    const stopSecond = supervisor.stop()
    second.resolve()
    await stopSecond
  })

  it('reports a missed heartbeat as the cause of an unhealthy unit', async () => {
    const scheduler = createManualScheduler()
    const supervisor = createCoroutineSupervisor({
      id: 'heartbeat',
      report: () => undefined,
      spec: {
        task: ({ signal }) =>
          new Promise<void>((resolve) => {
            signal.addEventListener('abort', resolve, { once: true })
          })
      },
      budget: createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false, scheduler }),
      scheduler,
      heartbeat: { timeoutMs: 3_000 }
    })
    await supervisor.start()
    scheduler.advance(3_000)
    await flush()
    scheduler.advance(3_000)
    await flush()
    expect(supervisor.inspect().lastExit?.reason).toBe('unhealthy')
    const unhealthy = supervisor.inspect().lastExit?.error as Error & { code?: string }
    expect(unhealthy.code).toBe(SupervisionErrorCode.unhealthy)
    expect((unhealthy.cause as { code?: string })?.code).toBe(SupervisionErrorCode.heartbeatMissed)
  })
})
