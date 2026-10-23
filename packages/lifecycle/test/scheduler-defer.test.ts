import { expect, it } from 'vitest'
import { deferTask } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { resolveScheduler } from '@migaia/lifecycle/scheduler'

it('captures deferred registration once with its original receiver', () => {
  /** Method admission reads the optional getter once for this scheduler. */
  let reads = 0
  /** Late replacement must not redirect an already admitted capability. */
  let replaced = 0
  /** Callbacks retain their source receiver until explicitly executed by the fixture. */
  const tasks: Array<() => void> = []
  /** Getter-backed capabilities expose receiver and capture-once behavior. */
  const source = {
    now: () => 0,
    schedule: () => ({ cancel: () => undefined }),
    get defer() {
      reads++
      /** The admitted method must keep this original receiver after replacement. */
      return function (this: unknown, callback: () => void) {
        expect(this).toBe(source)
        tasks.push(callback)
      }
    }
  }
  /** The existing public admission helper owns the captured methods. */
  const admitted = resolveScheduler(source)
  Object.defineProperty(source, 'defer', {
    value: () => {
      replaced++
    }
  })
  /** Observed callback order distinguishes microtasks, clock jobs and timer callbacks. */
  const trace: number[] = []
  deferTask(admitted, () => {
    trace.push(1)
  })
  deferTask(admitted, () => {
    trace.push(2)
  })
  for (const task of tasks) task()
  expect(trace).toEqual([1, 2])
  expect(reads).toBe(1)
  expect(replaced).toBe(0)
})

it('admits legacy schedulers and keeps their zero-time fallback controlled', () => {
  /** One deterministic clock owns both modern and legacy deferred registrations. */
  const manual = createManualScheduler()
  /** The existing public admission helper owns the captured methods. */
  const admitted = resolveScheduler({ now: manual.now, schedule: manual.schedule })
  /** Only advancing the original clock may run the admitted legacy callback. */
  let called = 0
  deferTask(admitted, () => {
    called++
  })
  expect(called).toBe(0)
  manual.advance(0)
  expect(called).toBe(1)
})

it('rejects an invalid optional method and retains a getter failure cause before work', () => {
  /** Valid required clock/timer methods isolate optional-method admission failures. */
  const base = { now: () => 0, schedule: () => ({ cancel: () => undefined }) }
  expect(() => resolveScheduler({ ...base, defer: 1 })).toThrow(
    expect.objectContaining({
      source: 'lifecycle',
      code: 'INVALID_OPTION'
    })
  )
  /** The exact caller-owned failure must remain reachable without replacement. */
  const cause = new Error('deferred getter failed')
  expect(() =>
    resolveScheduler({
      ...base,
      get defer() {
        throw cause
      }
    })
  ).toThrow(
    expect.objectContaining({
      source: 'lifecycle',
      code: 'INVALID_OPTION',
      cause
    })
  )
})
