import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SupervisionErrorCode } from '../../src/index.js'
import { BootstrapVia, createProcessSupervisor, StdinMode } from '../../src/process/index.js'
import { memoryProcessLauncher, processSpec } from './support/memory-process-launcher.js'

describe('A2 closed process specification', () => {
  it('rejects shell, malformed fields and bootstrap combinations before launch', () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher({
      termination: 'enforced',
      'fault-isolation': 'enforced',
      'bootstrap-fd': 'enforced'
    })
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const base = processSpec()
    const cases = [
      [{ ...base, shell: true }, 'shell', TypeError],
      [{ ...base, command: '' }, 'command', TypeError],
      [{ ...base, args: ['a', 1] }, 'args', TypeError],
      [{ ...base, limits: { memoryBytes: 0 } }, 'limits.memoryBytes', RangeError],
      [{ ...base, stdio: { ...base.stdio, stderr: 'channel' } }, 'stdio.stderr', TypeError],
      [
        { ...base, bootstrap: { via: 'stdin', payload: new Uint8Array([91]) } },
        'bootstrap.via',
        TypeError
      ],
      [
        { ...base, bootstrap: { via: 'fd', fd: 2, payload: new Uint8Array([91]) } },
        'bootstrap.fd',
        RangeError
      ],
      [
        { ...base, bootstrap: { via: 'fd', fd: 3, payload: 'secret-marker' } },
        'bootstrap.payload',
        TypeError
      ]
    ] as const
    for (const [spec, field, Constructor] of cases) {
      try {
        createProcessSupervisor({
          id: 'spec',
          spec: spec as never,
          launcher,
          budget,
          report: () => undefined,
          scheduler
        })
        throw new Error('expected invalid specification')
      } catch (error) {
        expect(error).toBeInstanceOf(Constructor)
        expect(error).toMatchObject({ code: SupervisionErrorCode.invalidOption, detail: { field } })
        expect(JSON.stringify(error)).not.toContain('secret-marker')
      }
    }
    expect(launcher.specs).toHaveLength(0)
  })

  it('preserves a valid fd specification and rejects replacement without retiring the old unit', async () => {
    const scheduler = createManualScheduler()
    const launcher = memoryProcessLauncher({
      termination: 'enforced',
      'fault-isolation': 'enforced',
      'bootstrap-fd': 'enforced'
    })
    const budget = createUnitBudget({ kind: 'process', maxUnits: 1, scheduler })
    const spec = {
      ...processSpec(),
      bootstrap: { via: BootstrapVia.fd, fd: 3, payload: new Uint8Array([91, 92]) },
      stdio: { ...processSpec().stdio, stdin: StdinMode.ignore }
    }
    const supervisor = createProcessSupervisor({
      id: 'spec',
      spec,
      launcher,
      budget,
      report: () => undefined,
      scheduler
    })
    expect((await supervisor.start()).state).toBe('ready')
    expect(launcher.specs[0]).toBe(spec)
    expect(JSON.stringify(supervisor.inspect())).not.toContain('91')
    const outcome = await supervisor.replace({ spec: { ...spec, shell: true } as never })
    expect(outcome).toMatchObject({
      kind: 'failed',
      error: { code: SupervisionErrorCode.invalidOption }
    })
    expect(supervisor.inspect().state).toBe('ready')
    await supervisor.dispose()
  })
})
