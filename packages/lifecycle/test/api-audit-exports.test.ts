import { describe, expect, it } from 'vitest'
import * as lifecycle from '../src/index.js'
import * as scheduler from '../src/scheduler-entry.js'
import * as errors from '../src/errors-entry.js'

describe('lifecycle public ownership boundaries', () => {
  it('C-01 retains scheduler admission while hiding internal arithmetic', () => {
    expect(scheduler.snapshotScheduler).toBeTypeOf('function')
    expect(scheduler.resolveScheduler).toBeTypeOf('function')
    expect(scheduler.resolveSchedulerOption).toBeTypeOf('function')
    expect(scheduler).not.toHaveProperty('addSchedulerTime')
  })

  it('C-03 leaves unit loading state to the internal unit owner', () => {
    expect(lifecycle).not.toHaveProperty('LifecycleUnitState')
    expect(lifecycle.LifecycleState.open).toBe('open')
  })

  it('C-04 exposes error policy without authorizing foreign lifecycle identities', () => {
    for (const entry of [lifecycle, errors])
      for (const name of [
        'createLifecycleError',
        'createLifecycleFailure',
        'createLifecycleTypeError'
      ])
        expect(entry).not.toHaveProperty(name)
    expect(errors.createErrorCollector).toBe(lifecycle.createErrorCollector)
  })
})
