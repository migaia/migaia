import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as root from '@migaia/supervision'
import * as threads from '@migaia/supervision/threads'
import { SupervisionErrorCode } from '../../src/index.js'

describe('A9 thread public contract', () => {
  it('exports exactly the thread API from its own subpath', () => {
    expect(Object.keys(threads).sort()).toEqual(
      ['ThreadCapability', 'ThreadLimit', 'ThreadUnitKind', 'createThreadSupervisor'].sort()
    )
    for (const name of Object.keys(threads)) expect(root).not.toHaveProperty(name)
    expect(threads).not.toHaveProperty('createThreadBudget')
    expect(threads).not.toHaveProperty('createProcessSupervisor')
    expect(threads).not.toHaveProperty('createCoroutineSupervisor')
    expect(Object.values(SupervisionErrorCode).some((code) => code.startsWith('THREAD_'))).toBe(
      false
    )
  })

  it('asserts each inherited error through the canonical code table', () => {
    const directory = import.meta.dirname
    const source = readdirSync(directory)
      .filter((name) => name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(directory, name), 'utf8'))
      .join('\n')
    for (const name of [
      'invalidOption',
      'capabilityUnsupported',
      'launchFailed',
      'exitUnexpected',
      'unhealthy',
      'resourceLimitExceeded',
      'reapTimeout',
      'supervisionExhausted',
      'scopeClosed',
      'scopeTerminal'
    ])
      expect(source).toContain(`SupervisionErrorCode.${name}`)
  })
})
