import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createProcessSupervisor } from '../../src/process/index.js'
import { memoryProcessLauncher, processSpec } from './support/memory-process-launcher.js'
import { memoryRegistry } from './support/memory-registry.js'

/** Flushes lifecycle disposal after an externally completed exit. */
async function settle(): Promise<void> {
  for (let index = 0; index < 100; index++) await Promise.resolve()
}

describe('A7 durable unit registration', () => {
  it('registers before ready and removes after disappearance', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const registry = memoryRegistry()
    const supervisor = createProcessSupervisor({
      id: 'svc',
      spec: processSpec(),
      launcher,
      budget,
      scheduler,
      registry: { port: registry.port, namespace: 'test' },
      wallClock: { timestamp: () => 1_700_000_000_000 },
      report: () => undefined
    })
    await supervisor.start()
    const handle = launcher.handles[0]!
    const record = registry.records.get(`svc/${handle.identity.fingerprint}`)
    expect(record?.identity).toBe(handle.identity)
    expect(record?.launchedAt).toBe(1_700_000_000_000)
    handle.complete()
    await settle()
    expect(registry.records.size).toBe(0)
    expect(budget.inUse).toBe(0)
    await supervisor.dispose()
  })

  it('fails closed on add rejection and preserves its original cause', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const registry = memoryRegistry()
    const cause = new Error('registry unavailable')
    registry.failAdd(cause)
    const supervisor = createProcessSupervisor({
      id: 'svc',
      spec: processSpec(),
      launcher,
      budget,
      scheduler,
      registry: { port: registry.port, namespace: 'test' },
      report: () => undefined,
      restart: { mode: 'never' }
    })
    await supervisor.start()
    await settle()
    expect(launcher.handles[0]!.terminations).toContain('force')
    expect(supervisor.inspect().lastExit?.error).toMatchObject({
      code: SupervisionErrorCode.launchFailed,
      detail: expect.objectContaining({ phase: 'attach' })
    })
    expect((supervisor.inspect().lastExit!.error as Error).cause).toBe(cause)
    await supervisor.dispose()
  })

  it('uses a new fingerprint after a prior parent left a record behind', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const registry = memoryRegistry()
    const removalFailure = new Error('remove failed')
    const reported: unknown[] = []
    registry.failRemove(removalFailure)
    const options = {
      id: 'svc',
      spec: processSpec(),
      launcher,
      budget,
      scheduler,
      registry: { port: registry.port, namespace: 'test' },
      report: (error: unknown) => {
        reported.push(error)
      }
    }
    const first = createProcessSupervisor(options)
    await first.start()
    await first.dispose()
    expect(registry.records.size).toBe(1)
    expect(reported).toContain(removalFailure)
    const second = createProcessSupervisor(options)
    await second.start()
    expect(registry.records.size).toBe(2)
    expect([...registry.records.keys()][0]).not.toBe([...registry.records.keys()][1])
    await second.dispose()
  })
})
