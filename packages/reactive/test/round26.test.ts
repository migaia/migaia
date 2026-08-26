import { describe, expect, it } from 'vitest'
import {
  createRuntime,
  ReactiveTracePhase,
  ReactiveTraceType,
  type IRuntimeTraceEvent
} from '../src/index.js'

type IObserverRunEvent = Extract<
  IRuntimeTraceEvent,
  { readonly type: typeof ReactiveTraceType.observerRun }
>

/** Selects observer-run spans so clock and sink assertions ignore other trace domains. */
function observerRunEvents(events: readonly IRuntimeTraceEvent[]): IObserverRunEvent[] {
  return events.filter(
    (event): event is IObserverRunEvent => event.type === ReactiveTraceType.observerRun
  )
}

describe('RT26 failure-contained observer trace terminals', () => {
  it('RT26-T01: Effect start-clock failures report and still close a successful span', () => {
    const events: IRuntimeTraceEvent[] = []
    const reported: unknown[] = []
    const startNowError = new Error('effect start now failed')
    const startTimestampError = new Error('effect start timestamp failed')
    let nowCalls = 0
    let timestampCalls = 0
    const runtime = createRuntime({
      adapter: {
        now: () => {
          nowCalls++
          if (nowCalls === 1) throw startNowError
          return 10
        },
        timestamp: () => {
          timestampCalls++
          if (timestampCalls === 1) throw startTimestampError
          return 100
        }
      },
      onError: (error) => reported.push(error),
      onTrace: (event) => events.push(event)
    })
    const source = runtime.signal(0)
    let runs = 0

    const stop = runtime.effect(() => {
      runs++
      void source.value
    })

    const traces = observerRunEvents(events)
    expect(traces.map((event) => event.phase)).toEqual([
      ReactiveTracePhase.start,
      ReactiveTracePhase.end
    ])
    expect(traces[0]?.timestamp).toBe(0)
    expect(reported).toEqual(expect.arrayContaining([startNowError, startTimestampError]))
    expect(runs).toBe(1)
    expect(source.subs).toHaveLength(1)
    expect(runtime.flush()).toBe('completed')

    stop()
    expect(source.subs).toHaveLength(0)
    source.dispose()
  })

  it('RT26-T02: Computed start-clock failures report and preserve graph admission', () => {
    const events: IRuntimeTraceEvent[] = []
    const reported: unknown[] = []
    const startNowError = new Error('computed start now failed')
    const startTimestampError = new Error('computed start timestamp failed')
    let nowCalls = 0
    let timestampCalls = 0
    const runtime = createRuntime({
      adapter: {
        now: () => {
          nowCalls++
          if (nowCalls === 1) throw startNowError
          return 20
        },
        timestamp: () => {
          timestampCalls++
          if (timestampCalls === 1) throw startTimestampError
          return 200
        }
      },
      onError: (error) => reported.push(error),
      onTrace: (event) => events.push(event)
    })
    const source = runtime.signal(1)
    let runs = 0
    const computed = runtime.computed(() => {
      runs++
      return source.value
    })

    expect(computed.peek()).toBe(1)
    const traces = observerRunEvents(events)
    expect(traces.map((event) => event.phase)).toEqual([
      ReactiveTracePhase.start,
      ReactiveTracePhase.end
    ])
    expect(traces[0]?.timestamp).toBe(0)
    expect(reported).toEqual(expect.arrayContaining([startNowError, startTimestampError]))
    expect(runs).toBe(1)
    expect(source.subs).toHaveLength(1)

    computed.dispose()
    computed.dispose()
    expect(source.subs).toHaveLength(0)
    source.dispose()
  })

  it('RT26-T03: Effect terminal clock failures report without changing success or scheduler state', () => {
    const events: IRuntimeTraceEvent[] = []
    const reported: unknown[] = []
    const terminalTimestampError = new Error('effect terminal timestamp failed')
    const terminalNowError = new Error('effect terminal now failed')
    let nowCalls = 0
    let timestampCalls = 0
    const runtime = createRuntime({
      adapter: {
        now: () => {
          nowCalls++
          if (nowCalls === 2) throw terminalNowError
          return 30
        },
        timestamp: () => {
          timestampCalls++
          if (timestampCalls === 3) throw terminalTimestampError
          return 300
        }
      },
      onError: (error) => reported.push(error),
      onTrace: (event) => events.push(event)
    })
    const source = runtime.signal(0)
    let runs = 0
    const stop = runtime.effect(() => {
      runs++
      void source.value
    })

    expect(observerRunEvents(events).map((event) => event.phase)).toEqual([
      ReactiveTracePhase.start,
      ReactiveTracePhase.end
    ])
    expect(reported.some((error) => error === terminalTimestampError)).toBe(true)
    expect(reported.some((error) => error === terminalNowError)).toBe(true)
    expect(runs).toBe(1)
    expect(source.subs).toHaveLength(1)
    expect(runtime.flush()).toBe('completed')

    stop()
    source.dispose()
  })

  it('RT26-T04: Computed terminal clock failures preserve body error and allow recompute', () => {
    const events: IRuntimeTraceEvent[] = []
    const reported: unknown[] = []
    const bodyError = new Error('computed body failed')
    const terminalTimestampError = new Error('computed terminal timestamp failed')
    const terminalNowError = new Error('computed terminal now failed')
    let nowCalls = 0
    let timestampCalls = 0
    const runtime = createRuntime({
      adapter: {
        now: () => {
          nowCalls++
          if (nowCalls === 2) throw terminalNowError
          return 40
        },
        timestamp: () => {
          timestampCalls++
          if (timestampCalls === 2) throw terminalTimestampError
          return 400
        }
      },
      onError: (error) => reported.push(error),
      onTrace: (event) => events.push(event)
    })
    const source = runtime.signal(1)
    const computed = runtime.computed(() => {
      void source.value
      throw bodyError
    })

    expect(() => computed.peek()).toThrow(bodyError)
    expect(() => computed.peek()).toThrow(bodyError)

    const traces = observerRunEvents(events)
    expect(traces.map((event) => event.phase)).toEqual([
      ReactiveTracePhase.start,
      ReactiveTracePhase.error,
      ReactiveTracePhase.start,
      ReactiveTracePhase.error
    ])
    expect(traces[1]?.error).toBe(bodyError)
    expect(traces[3]?.error).toBe(bodyError)
    expect(reported).toEqual(expect.arrayContaining([terminalTimestampError, terminalNowError]))
    expect(source.subs).toHaveLength(0)

    computed.dispose()
    computed.dispose()
    source.dispose()
  })

  it('RT26-T05: Effect terminal clock failures preserve body error and graph state', () => {
    const events: IRuntimeTraceEvent[] = []
    const reported: unknown[] = []
    const bodyError = new Error('effect body failed')
    const terminalTimestampError = new Error('effect error timestamp failed')
    const terminalNowError = new Error('effect error now failed')
    let nowCalls = 0
    let timestampCalls = 0
    const runtime = createRuntime({
      adapter: {
        now: () => {
          nowCalls++
          if (nowCalls === 2) throw terminalNowError
          return 50
        },
        timestamp: () => {
          timestampCalls++
          if (timestampCalls === 2) throw terminalTimestampError
          return 500
        }
      },
      onError: (error) => reported.push(error),
      onTrace: (event) => events.push(event)
    })
    const source = runtime.signal(1)

    expect(() =>
      runtime.effect(() => {
        void source.value
        throw bodyError
      })
    ).toThrow(bodyError)

    const traces = observerRunEvents(events)
    expect(traces.map((event) => event.phase)).toEqual([
      ReactiveTracePhase.start,
      ReactiveTracePhase.error
    ])
    expect(traces[1]?.error).toBe(bodyError)
    expect(reported.some((error) => error === terminalTimestampError)).toBe(true)
    expect(reported.some((error) => error === terminalNowError)).toBe(true)
    expect(source.subs).toHaveLength(0)

    source.dispose()
  })

  it('RT26-T06: throwing trace sinks are reported while Effect disposal and Computed recompute stay balanced', () => {
    const events: IRuntimeTraceEvent[] = []
    const reported: unknown[] = []
    const sinkError = new Error('trace sink failed')
    const runtime = createRuntime({
      onError: (error) => reported.push(error),
      onTrace: () => {
        throw sinkError
      }
    })
    const unsubscribe = runtime.subscribeTrace((event) => events.push(event))
    let cleanups = 0
    const stop = runtime.effect(() => () => {
      cleanups++
    })
    const source = runtime.signal(0)
    const computed = runtime.computed(() => source.value)

    expect(computed.peek()).toBe(0)
    source.value = 1
    expect(computed.peek()).toBe(1)
    stop()
    stop()
    computed.dispose()
    computed.dispose()
    unsubscribe()

    expect(observerRunEvents(events).map((event) => event.phase)).toEqual([
      ReactiveTracePhase.start,
      ReactiveTracePhase.end,
      ReactiveTracePhase.start,
      ReactiveTracePhase.end,
      ReactiveTracePhase.start,
      ReactiveTracePhase.end
    ])
    expect(reported.filter((error) => error === sinkError).length).toBeGreaterThanOrEqual(6)
    expect(cleanups).toBe(1)
    source.dispose()
  })
})
