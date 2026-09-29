import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { SupervisionErrorCode } from '../../src/index.js'

/** Core codes remain a subset when later profiles extend the one package table. */
const coreCodes = {
  invalidOption: 'INVALID_OPTION',
  capabilityUnsupported: 'CAPABILITY_UNSUPPORTED',
  launchFailed: 'LAUNCH_FAILED',
  startupTimeout: 'STARTUP_TIMEOUT',
  exitUnexpected: 'EXIT_UNEXPECTED',
  unhealthy: 'UNHEALTHY',
  resourceLimitExceeded: 'RESOURCE_LIMIT_EXCEEDED',
  reapTimeout: 'REAP_TIMEOUT',
  supervisionExhausted: 'SUPERVISION_EXHAUSTED',
  scopeClosed: 'SCOPE_CLOSED',
  scopeTerminal: 'SCOPE_TERMINAL',
  heartbeatMissed: 'HEARTBEAT_MISSED'
} as const

describe('A11 public entries and core codes', () => {
  it('exports exactly the core and coroutine runtime surfaces', async () => {
    const core = await import('../../dist/index.js')
    const coroutine = await import('../../dist/coroutine/index.js')
    expect(Object.keys(core).sort()).toEqual(
      [
        'createSupervisor',
        'createUnitBudget',
        'SUPERVISION_SOURCE',
        'SupervisionErrorCode',
        'SupervisionErrorText',
        'SupervisorState',
        'ExitReason',
        'RestartMode',
        'TerminalPolicyMode',
        'ReplaceStrategy',
        'CapabilityLevel',
        'IsolationMode',
        'TerminationMode',
        'BudgetOverflow',
        'BudgetRejection',
        'LaunchPhase',
        'LaunchCause',
        'SupervisorEventType',
        'StandardCapability'
      ].sort()
    )
    expect(Object.keys(coroutine).sort()).toEqual(
      ['createCoroutineSupervisor', 'CoroutineOutcome', 'coroutineCapabilities'].sort()
    )
  })

  it('keeps every core semantic code unique and explicitly asserted', () => {
    expect(SupervisionErrorCode.invalidOption).toBe(coreCodes.invalidOption)
    expect(SupervisionErrorCode.capabilityUnsupported).toBe(coreCodes.capabilityUnsupported)
    expect(SupervisionErrorCode.launchFailed).toBe(coreCodes.launchFailed)
    expect(SupervisionErrorCode.startupTimeout).toBe(coreCodes.startupTimeout)
    expect(SupervisionErrorCode.exitUnexpected).toBe(coreCodes.exitUnexpected)
    expect(SupervisionErrorCode.unhealthy).toBe(coreCodes.unhealthy)
    expect(SupervisionErrorCode.resourceLimitExceeded).toBe(coreCodes.resourceLimitExceeded)
    expect(SupervisionErrorCode.reapTimeout).toBe(coreCodes.reapTimeout)
    expect(SupervisionErrorCode.supervisionExhausted).toBe(coreCodes.supervisionExhausted)
    expect(SupervisionErrorCode.scopeClosed).toBe(coreCodes.scopeClosed)
    expect(SupervisionErrorCode.scopeTerminal).toBe(coreCodes.scopeTerminal)
    expect(SupervisionErrorCode.heartbeatMissed).toBe(coreCodes.heartbeatMissed)
    expect(new Set(Object.values(SupervisionErrorCode)).size).toBe(
      Object.values(SupervisionErrorCode).length
    )
    const root = join(import.meta.dirname, '..')
    const testText =
      readdirSync(join(root, 'core'))
        .filter((name) => name.endsWith('.test.ts'))
        .map((name) => readFileSync(join(root, 'core', name), 'utf8'))
        .join('\n') +
      readdirSync(join(root, 'coroutine'))
        .filter((name) => name.endsWith('.test.ts'))
        .map((name) => readFileSync(join(root, 'coroutine', name), 'utf8'))
        .join('\n')
    for (const key of Object.keys(coreCodes))
      expect(testText).toContain(`SupervisionErrorCode.${key}`)
  })
})
