import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createParentLossGuard, ParentLossExitCode } from '../../src/process/index.js'

describe('A9 parent disappearance guard', () => {
  it('completes once when shutdown settles within the grace period', async () => {
    const scheduler = createManualScheduler()
    let resolveShutdown: () => void = () => undefined
    let calls = 0
    const exits: number[] = []
    const guard = createParentLossGuard({
      scheduler,
      graceMs: 5_000,
      shutdown: () => {
        calls++
        return new Promise<void>((resolve) => {
          resolveShutdown = resolve
        })
      },
      exit: (code) => {
        exits.push(code)
      },
      report: () => undefined
    })
    guard.trigger()
    guard.trigger()
    scheduler.advance(1_000)
    resolveShutdown()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toBe(1)
    expect(exits).toEqual([ParentLossExitCode.completed])
    expect(scheduler.pendingCount).toBe(0)
  })

  it('aborts and exits exactly once at the finite deadline', () => {
    const scheduler = createManualScheduler()
    const exits: number[] = []
    let aborted = false
    const guard = createParentLossGuard({
      scheduler,
      graceMs: 5_000,
      shutdown: (signal) => {
        signal.addEventListener('abort', () => {
          aborted = true
        })
        return new Promise<void>(() => undefined)
      },
      exit: (code) => {
        exits.push(code)
      },
      report: () => undefined
    })
    guard.trigger()
    scheduler.advance(4_999)
    expect(exits).toHaveLength(0)
    scheduler.advance(1)
    expect(aborted).toBe(true)
    expect(exits).toEqual([ParentLossExitCode.forced])
    guard.trigger()
    expect(exits).toHaveLength(1)
  })

  it('reports the original synchronous shutdown failure', () => {
    const scheduler = createManualScheduler()
    const cause = new Error('shutdown failed')
    const errors: unknown[] = []
    const exits: number[] = []
    const guard = createParentLossGuard({
      scheduler,
      shutdown: () => {
        throw cause
      },
      exit: (code) => {
        exits.push(code)
      },
      report: (error) => {
        errors.push(error)
      }
    })
    guard.trigger()
    expect(errors).toEqual([cause])
    expect(exits).toEqual([ParentLossExitCode.forced])
    expect(scheduler.pendingCount).toBe(0)
  })
})
