import { describe, expect, it } from 'vitest'
import {
  createRuntime,
  ReactiveTracePhase,
  ReactiveTraceType,
  type IRuntimeTraceEvent
} from '../src/index.js'
import { createObserverBinding } from '../src/runtime/observer-binding.js'

type IObserverRunEvent = Extract<
  IRuntimeTraceEvent,
  { readonly type: typeof ReactiveTraceType.observerRun }
>

/** Selects observer-run events so span assertions ignore dependency and source diagnostics. */
function observerRunEvents(events: readonly IRuntimeTraceEvent[]): IObserverRunEvent[] {
  return events.filter(
    (event): event is IObserverRunEvent => event.type === ReactiveTraceType.observerRun
  )
}

describe('RT25 observer-run trace closure', () => {
  it('RT25-T01: cleanup self-dispose closes one successful terminal span', () => {
    const events: IRuntimeTraceEvent[] = []
    const scheduled: Array<() => void> = []
    const runtime = createRuntime({ onTrace: (event) => events.push(event) })
    runtime.setSchedulerStrategy((flush) => {
      scheduled.push(flush)
    })
    const source = runtime.signal(0)
    let runs = 0
    let cleanups = 0
    let stop: (() => void) | undefined

    stop = runtime.effect(() => {
      runs++
      void source.value
      return () => {
        cleanups++
        stop?.()
      }
    })

    source.value = 1
    scheduled.shift()?.()

    const traces = observerRunEvents(events)
    expect(traces.map((event) => event.phase)).toEqual([
      ReactiveTracePhase.start,
      ReactiveTracePhase.end,
      ReactiveTracePhase.start,
      ReactiveTracePhase.end
    ])
    expect(traces.filter((event) => event.phase === ReactiveTracePhase.error)).toHaveLength(0)
    expect(runs).toBe(1)
    expect(cleanups).toBe(1)
    expect(source.subs).toHaveLength(0)
    expect(runtime.flush()).toBe('completed')
    expect(scheduled).toHaveLength(0)

    stop()
    stop()
    expect(cleanups).toBe(1)
    source.dispose()
  })

  it('RT25-T02: terminal binding retrack closes one successful observer span', () => {
    const events: IRuntimeTraceEvent[] = []
    const runtime = createRuntime({ onTrace: (event) => events.push(event) })
    const source = runtime.signal(0)
    const binding = createObserverBinding(runtime)
    let runs = 0
    let cleanups = 0
    let stop: (() => void) | undefined

    stop = binding.observe(() => {
      runs++
      void source.value
      return () => {
        cleanups++
        stop?.()
      }
    })

    expect(binding.retrack()).toBe('no-observer')

    const traces = observerRunEvents(events)
    expect(traces.map((event) => event.phase)).toEqual([
      ReactiveTracePhase.start,
      ReactiveTracePhase.end,
      ReactiveTracePhase.start,
      ReactiveTracePhase.end
    ])
    expect(traces.filter((event) => event.phase === ReactiveTracePhase.error)).toHaveLength(0)
    expect(runs).toBe(1)
    expect(cleanups).toBe(1)
    expect(source.subs).toHaveLength(0)
    expect(binding.retrack()).toBe('no-observer')

    stop()
    stop()
    expect(cleanups).toBe(1)
    source.dispose()
  })

  it('RT25-T03: cleanup throw keeps exact error terminal trace and emits no end', () => {
    const events: IRuntimeTraceEvent[] = []
    const scheduled: Array<() => void> = []
    const cleanupError = new Error('cleanup boom')
    const reported: unknown[] = []
    const runtime = createRuntime({
      onError: (error) => reported.push(error),
      onTrace: (event) => events.push(event)
    })
    runtime.setSchedulerStrategy((flush) => {
      scheduled.push(flush)
    })
    const source = runtime.signal(0)
    let cleanups = 0

    const stop = runtime.effect(() => {
      void source.value
      return () => {
        cleanups++
        throw cleanupError
      }
    })

    source.value = 1
    const flush = scheduled.shift()
    expect(flush).toBeTypeOf('function')
    expect(() => flush?.()).not.toThrow()

    const traces = observerRunEvents(events)
    expect(traces.map((event) => event.phase)).toEqual([
      ReactiveTracePhase.start,
      ReactiveTracePhase.end,
      ReactiveTracePhase.start,
      ReactiveTracePhase.error
    ])
    expect(traces.at(-1)?.error).toBe(cleanupError)
    expect(reported).toEqual([cleanupError])
    expect(traces.filter((event) => event.phase === ReactiveTracePhase.end)).toHaveLength(1)
    expect(cleanups).toBe(1)

    stop()
    source.dispose()
  })

  it('RT25-T04: repeated dispose does not duplicate terminal trace events', () => {
    const events: IRuntimeTraceEvent[] = []
    const runtime = createRuntime({ onTrace: (event) => events.push(event) })
    let cleanups = 0

    const stop = runtime.effect(() => () => {
      cleanups++
    })
    const beforeDispose = observerRunEvents(events)

    stop()
    stop()
    stop()

    expect(observerRunEvents(events)).toEqual(beforeDispose)
    expect(observerRunEvents(events).map((event) => event.phase)).toEqual([
      ReactiveTracePhase.start,
      ReactiveTracePhase.end
    ])
    expect(cleanups).toBe(1)
  })
})
