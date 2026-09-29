import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createCoroutineSupervisor } from '../../src/coroutine/index.js'
import { deferred } from '../support/memory-launcher.js'

/** Allows replacement to reach the candidate readiness wait. */
async function flush(): Promise<void> {
  for (let index = 0; index < 30; index++) await Promise.resolve()
}

describe('A14 in-memory exposed port', () => {
  it('keeps the old port available until the switched event', async () => {
    const scheduler = createManualScheduler()
    const secondReady = deferred<void>()
    const cleanup: number[] = []
    let calls = 0
    const supervisor = createCoroutineSupervisor<{ call(value: number): number }>({
      id: 'echo',
      report: () => undefined,
      spec: {
        task: async ({ signal, expose }) => {
          const generation = ++calls
          if (generation === 2) await secondReady.promise
          expose({ call: (value: number) => value })
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', resolve, { once: true })
          })
          cleanup.push(generation)
        }
      },
      budget: createUnitBudget({ kind: 'coroutine', maxUnits: 2, launchRate: false, scheduler }),
      scheduler,
      ready: (unit) => unit.exposed.then(() => undefined)
    })
    const initial = await supervisor.start()
    expect(initial.state).toBe('ready')
    if (initial.state !== 'ready') return
    expect((await initial.unit.exposed).call(1)).toBe(1)
    const replacement = supervisor.replace({ strategy: 'start-then-switch' })
    await flush()
    expect((await initial.unit.exposed).call(2)).toBe(2)
    secondReady.resolve()
    expect(await replacement).toEqual({ kind: 'replaced', generation: 2 })
    const current = await supervisor.whenReady()
    expect(current.state).toBe('ready')
    if (current.state === 'ready') expect((await current.unit.exposed).call(3)).toBe(3)
    expect(cleanup).toContain(1)
    await supervisor.stop()
    expect(cleanup).toContain(2)
  })

  it('rejects a second exposure with the package option code', async () => {
    const scheduler = createManualScheduler()
    const supervisor = createCoroutineSupervisor<number>({
      id: 'duplicate',
      report: () => undefined,
      spec: {
        task: ({ expose }) => {
          expose(1)
          expose(2)
        }
      },
      budget: createUnitBudget({ kind: 'coroutine', maxUnits: 1, launchRate: false, scheduler }),
      scheduler
    })
    await supervisor.start()
    await flush()
    const error = supervisor.inspect().lastExit?.error as Error & { code?: string }
    expect((error.cause as { code?: string })?.code).toBe(SupervisionErrorCode.invalidOption)
  })
})
