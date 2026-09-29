import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createProcessSupervisor } from '../../src/process/index.js'
import { memoryProcessLauncher, processSpec } from './support/memory-process-launcher.js'

describe('A5 continuous output drain', () => {
  it('retains a bounded tail and continues after the consumer callback throws', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const report: unknown[] = []
    const chunks: Uint8Array[] = []
    const failure = new Error('callback failed')
    const supervisor = createProcessSupervisor({
      id: 'output',
      spec: processSpec(),
      launcher,
      budget,
      scheduler,
      report: (error) => {
        report.push(error)
      },
      output: {
        tailBytes: 1_024,
        onChunk: (_stream, chunk) => {
          chunks.push(chunk)
          if (chunks.length === 3) throw failure
        }
      }
    })
    await supervisor.start()
    const handle = launcher.handles[0]!
    for (let index = 0; index < 256; index++)
      handle.emit('stderr', new Uint8Array(4_096).fill(index))
    const tail = supervisor.inspect().unit?.stderrTail as Uint8Array
    expect(tail.byteLength).toBe(1_024)
    expect(tail.every((byte) => byte === 255)).toBe(true)
    expect(chunks).toHaveLength(256)
    expect(report).toContain(failure)
    await supervisor.stop()
    handle.emit('stderr', new Uint8Array([9]))
    expect(chunks).toHaveLength(256)
    await supervisor.dispose()
  })

  it('rejects an invalid tail limit at construction', () => {
    const scheduler = createManualScheduler()
    expect(() =>
      createProcessSupervisor({
        id: 'bad-tail',
        spec: processSpec(),
        launcher: memoryProcessLauncher(),
        budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
        scheduler,
        report: () => undefined,
        output: { tailBytes: 0 }
      })
    ).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.invalidOption,
        detail: expect.objectContaining({ field: 'output.tailBytes' })
      })
    )
  })

  it('uses the documented default tail limit', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher()
    const supervisor = createProcessSupervisor({
      id: 'default-tail',
      spec: processSpec(),
      launcher,
      budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
      scheduler,
      report: () => undefined
    })
    await supervisor.start()
    launcher.handles[0]!.emit('stderr', new Uint8Array(70_000).fill(7))
    expect((supervisor.inspect().unit!.stderrTail as Uint8Array).byteLength).toBe(65_536)
    await supervisor.dispose()
  })
})
