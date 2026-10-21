import { afterEach, expect, it, vi } from 'vitest'
import { deferTask, systemScheduler } from '../src/scheduler.js'
import { createManualScheduler } from '../src/testing.js'

afterEach(() => vi.unstubAllGlobals())

it('keeps native microtask order independently of zero-delay timers', async () => {
  /** Observed callback order distinguishes microtasks, clock jobs and timer callbacks. */
  const trace: string[] = []
  deferTask(systemScheduler, () => {
    trace.push('job')
  })
  /** The existing timer remains separate from deferred work and is cancelled after the assertion. */
  const timer = systemScheduler.schedule(() => {
    trace.push('timer')
  }, 0)
  await Promise.resolve().then(() => {
    trace.push('reaction')
  })
  expect(trace).toEqual(['job', 'reaction'])
  timer.cancel()
})

it('controls manual and legacy two-method jobs without host microtasks', () => {
  vi.stubGlobal('queueMicrotask', undefined)
  /** One deterministic clock owns both modern and legacy deferred registrations. */
  const manual = createManualScheduler()
  /** An unchanged two-method scheduler proves backward compatibility without a host queue. */
  const legacy = { now: manual.now, schedule: manual.schedule }
  /** Observed callback order distinguishes microtasks, clock jobs and timer callbacks. */
  const trace: string[] = []
  deferTask(manual, () => {
    trace.push('manual')
  })
  deferTask(legacy, () => {
    trace.push('legacy')
  })
  expect(trace).toEqual([])
  expect(manual.pendingCount).toBe(2)
  manual.advance(0)
  expect(trace).toEqual(['manual', 'legacy'])
})

it('rejects invalid callback/capability arguments with native coded TypeError', () => {
  /** Invalid JavaScript inputs must fail before any registration starts. */
  const invalid = [
    () => deferTask(systemScheduler, undefined as never),
    () => deferTask(null as never, () => undefined),
    () => deferTask({ defer: 1 } as never, () => undefined)
  ]
  for (const run of invalid) {
    expect(run).toThrow(TypeError)
    expect(run).toThrow(
      expect.objectContaining({ source: '@migaia/utils', code: 'INVALID_ARGUMENT' })
    )
  }
})

it('preserves the exact failed scheduler getter on cause', () => {
  /** The exact caller-owned failure must remain reachable without replacement. */
  const cause = new Error('defer getter failed')
  /** This scheduler exercises only the external method/error contract under test. */
  const scheduler = {
    now: () => 0,
    schedule: () => ({ cancel: () => undefined }),
    get defer(): (callback: () => void) => void {
      throw cause
    }
  }
  expect(() => deferTask(scheduler, () => undefined)).toThrow(
    expect.objectContaining({
      source: '@migaia/utils',
      code: 'INVALID_ARGUMENT',
      cause
    })
  )
})

it('reports absent default host capability without affecting custom schedulers', () => {
  vi.stubGlobal('queueMicrotask', undefined)
  expect(() => deferTask(systemScheduler, () => undefined)).toThrow(
    expect.objectContaining({
      source: '@migaia/utils',
      code: 'ENV_UNSUPPORTED'
    })
  )
})

it('preserves a caller-owned registration failure by identity', () => {
  /** The exact caller-owned failure must remain reachable without replacement. */
  const cause = new Error('custom deferred registration failed')
  /** This scheduler exercises only the external method/error contract under test. */
  const scheduler = {
    now: () => 0,
    schedule: () => ({ cancel: () => undefined }),
    defer() {
      throw cause
    }
  }
  /** Capture the exact thrown object rather than comparing only its message. */
  let observed: unknown
  try {
    deferTask(scheduler, () => undefined)
  } catch (error) {
    observed = error
  }
  expect(observed).toBe(cause)
})
