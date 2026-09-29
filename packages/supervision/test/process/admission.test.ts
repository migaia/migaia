import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { createProcessSupervisor } from '../../src/process/index.js'
import { memoryProcessLauncher, processSpec } from './support/memory-process-launcher.js'

describe('A3 process capability admission', () => {
  it('fails closed for absent standard and requested guarantees', () => {
    const scheduler = createManualScheduler()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const base = processSpec()
    const cases = [
      [base, {}, 'termination'],
      [
        { ...base, limits: { memoryBytes: 100 } },
        { termination: 'enforced', 'fault-isolation': 'enforced' },
        'memory-limit'
      ],
      [
        { ...base, limits: { cpuTimeMs: 100 } },
        { termination: 'enforced', 'fault-isolation': 'enforced' },
        'cpu-time-limit'
      ],
      [
        { ...base, permissions: ['net'] },
        { termination: 'enforced', 'fault-isolation': 'enforced' },
        'permissions'
      ],
      [
        {
          ...base,
          stdio: { ...base.stdio, stdin: 'channel' },
          bootstrap: { via: 'stdin', payload: new Uint8Array([83]) }
        },
        { termination: 'enforced', 'fault-isolation': 'enforced' },
        'bootstrap-stdin'
      ],
      [
        { ...base, bootstrap: { via: 'fd', fd: 3, payload: new Uint8Array([83]) } },
        { termination: 'enforced', 'fault-isolation': 'enforced' },
        'bootstrap-fd'
      ]
    ] as const
    for (const [spec, capabilities, capability] of cases) {
      const launcher = memoryProcessLauncher(capabilities as never)
      expect(() =>
        createProcessSupervisor({
          id: 'admit',
          spec: spec as never,
          launcher,
          budget,
          report: () => undefined,
          scheduler
        })
      ).toThrowError(
        expect.objectContaining({
          code: SupervisionErrorCode.capabilityUnsupported,
          detail: expect.objectContaining({ capability, kind: 'process' })
        })
      )
      expect(launcher.handles).toHaveLength(0)
    }
  })

  it('rejects impossible grades and reports a deliberate best-effort downgrade once', async () => {
    const scheduler = createManualScheduler()
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const base = processSpec()
    const bad = memoryProcessLauncher({
      termination: 'monitored',
      'fault-isolation': 'enforced'
    } as never)
    expect(() =>
      createProcessSupervisor({
        id: 'bad',
        spec: base,
        launcher: bad,
        budget,
        report: () => undefined,
        scheduler
      })
    ).toThrowError(
      expect.objectContaining({
        code: SupervisionErrorCode.invalidOption,
        detail: expect.objectContaining({ field: 'launcher.capabilities.termination' })
      })
    )
    const report: unknown[] = []
    const launcher = memoryProcessLauncher({
      termination: 'enforced',
      'fault-isolation': 'enforced'
    })
    const supervisor = createProcessSupervisor({
      id: 'degrade',
      spec: { ...base, limits: { cpuTimeMs: 100 } },
      launcher,
      budget,
      isolation: 'best-effort',
      report: (error) => {
        report.push(error)
      },
      scheduler
    })
    expect(supervisor.inspect().degraded).toContain('cpu-time-limit')
    expect((await supervisor.start()).state).toBe('ready')
    expect(
      report.filter(
        (error) => (error as { code?: string }).code === SupervisionErrorCode.capabilityUnsupported
      )
    ).toHaveLength(1)
    await supervisor.dispose()
  })

  it('treats a monitored limit without sampleUsage as an attach failure', async () => {
    const scheduler = createManualScheduler()
    const base = memoryProcessLauncher({
      termination: 'enforced',
      'fault-isolation': 'enforced',
      'memory-limit': 'monitored'
    })
    const launcher = {
      ...base,
      launch: async (...args: Parameters<typeof base.launch>) => {
        const handle = await base.launch(...args)
        delete handle.sampleUsage
        return handle
      }
    }
    const supervisor = createProcessSupervisor({
      id: 'missing-sampler',
      spec: { ...processSpec(), limits: { memoryBytes: 100 } },
      launcher,
      budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
      scheduler,
      report: () => undefined,
      restart: { mode: 'never' }
    })
    await supervisor.start()
    for (let index = 0; index < 100; index++) await Promise.resolve()
    expect(base.handles[0]!.terminations).toContain('force')
    expect(supervisor.inspect().lastExit?.error).toMatchObject({
      code: SupervisionErrorCode.launchFailed,
      detail: expect.objectContaining({ phase: 'attach' })
    })
    expect((supervisor.inspect().lastExit!.error as Error).cause).toMatchObject({
      code: SupervisionErrorCode.capabilityUnsupported,
      detail: expect.objectContaining({ reason: 'sample-usage-missing' })
    })
    await supervisor.dispose()
  })
})
