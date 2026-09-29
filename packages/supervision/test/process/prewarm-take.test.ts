import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createPrewarmPool, createProcessSupervisor } from '../../src/process/index.js'
import { memoryProcessLauncher, processSpec } from './support/memory-process-launcher.js'
import { memoryRegistry } from './support/memory-registry.js'

/** Flushes pool fill and lifecycle microtasks. */
async function settle(): Promise<void> {
  for (let index = 0; index < 100; index++) await Promise.resolve()
}

describe('A11 prewarm handover', () => {
  it('takes the exact idle handle and preserves its output and both records', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 3, scheduler })
    const registry = memoryRegistry()
    const spec = processSpec()
    const pool = createPrewarmPool({
      id: 'pool',
      spec,
      launcher,
      budget,
      size: 1,
      scheduler,
      registry: { port: registry.port, namespace: 'test' },
      report: () => undefined
    })
    await settle()
    const warm = launcher.handles[0]!
    warm.emit('stderr', new Uint8Array([1, 2, 3]))
    const chunks: Uint8Array[] = []
    const supervisor = createProcessSupervisor({
      id: 'svc',
      spec,
      launcher,
      budget,
      prewarm: pool,
      scheduler,
      registry: { port: registry.port, namespace: 'test' },
      output: {
        onChunk: (_stream, chunk) => {
          chunks.push(chunk)
        }
      },
      report: () => undefined
    })
    const ready = await supervisor.start()
    expect(ready).toMatchObject({ state: 'ready', unit: warm })
    expect(chunks).toEqual([new Uint8Array([1, 2, 3])])
    expect(supervisor.inspect().unit?.stderrTail).toEqual(new Uint8Array([1, 2, 3]))
    await settle()
    expect(launcher.handles).toHaveLength(2)
    expect(registry.records.has(`pool/${warm.identity.fingerprint}`)).toBe(true)
    expect(registry.records.has(`svc/${warm.identity.fingerprint}`)).toBe(true)
    await supervisor.stop()
    await settle()
    expect(registry.records.has(`pool/${warm.identity.fingerprint}`)).toBe(false)
    expect(registry.records.has(`svc/${warm.identity.fingerprint}`)).toBe(false)
    await pool.dispose()
    await supervisor.dispose()
  })

  it('bypasses a stale idle unit on restart and rejects a mismatched pool', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 3, scheduler })
    const spec = processSpec()
    const pool = createPrewarmPool({
      id: 'pool',
      spec,
      launcher,
      budget,
      size: 1,
      scheduler,
      report: () => undefined
    })
    await settle()
    expect(() =>
      createProcessSupervisor({
        id: 'bad',
        spec: { ...spec },
        launcher,
        budget,
        prewarm: pool,
        scheduler,
        report: () => undefined
      })
    ).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.invalidOption,
        detail: expect.objectContaining({ field: 'prewarm' })
      })
    )
    const supervisor = createProcessSupervisor({
      id: 'svc',
      spec,
      launcher,
      budget,
      prewarm: pool,
      scheduler,
      report: () => undefined
    })
    await supervisor.start()
    await settle()
    const previouslyIdle = launcher.handles[1]!
    const next = await supervisor.restart()
    expect(next.state).toBe('ready')
    expect(previouslyIdle.terminations).toContain('graceful')
    expect((next as { unit?: unknown }).unit).not.toBe(previouslyIdle)
    await settle()
    const idleBeforeReplace = launcher.handles.at(-1)!
    const countBeforeReplace = launcher.handles.length
    const replaced = await supervisor.replace({ strategy: 'start-then-switch' })
    expect(replaced.kind).toBe('replaced')
    expect(launcher.handles.length).toBeGreaterThan(countBeforeReplace)
    expect(idleBeforeReplace.terminations).toContain('graceful')
    expect(supervisor.inspect().identity?.fingerprint).not.toBe(
      idleBeforeReplace.identity.fingerprint
    )
    await supervisor.dispose()
    await pool.dispose()
  })
})
