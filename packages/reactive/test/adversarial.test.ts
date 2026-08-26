import { describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRuntime } from '../src/runtime/runtime.class'
import { noteRuntimeCopy, resetRuntimeCopiesForTest } from '../src/runtime/copy-check'
import { ReactiveErrorCode } from '../src/error-code.js'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

function collectSourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...collectSourceFiles(full))
    else if (entry.endsWith('.ts')) found.push(full)
  }
  return found
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('AF-T4 reactive runtime-neutrality', () => {
  it('core modules (excluding the adapter boundary) never touch host clock/timer/console directly', () => {
    const allowed = new Set(['default-runtime-adapter.ts', 'ambient.d.ts'])
    const offenders: string[] = []
    for (const file of collectSourceFiles(srcDir)) {
      if (allowed.has(file.split('/').pop() ?? '')) continue
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const pattern of ['Date.now', 'performance', 'queueMicrotask', 'console.']) {
        if (source.includes(pattern)) {
          offenders.push(`${relative(srcDir, file)}: ${pattern}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('a manual adapter drives trace timestamps without reading the real host clock', async () => {
    const reportError = vi.fn()
    const events: Array<{ timestamp?: number; type?: string }> = []
    const runtime = createRuntime({
      adapter: {
        scheduleMicrotask: (task) => queueMicrotask(task),
        now: () => 1_000,
        timestamp: () => 42,
        reportError
      },
      onTrace: (event) => events.push(event)
    })
    const signal = runtime.signal(0)
    signal.value = 1
    await flush()
    expect(
      events.some((event) => event.type === 'observable-change' && event.timestamp === 42)
    ).toBe(true)
    expect(reportError).not.toHaveBeenCalled()
    signal.dispose()
  })

  it('AF-T20: a non-function adapter field is rejected with INVALID_OPTION at construction', () => {
    for (const key of ['scheduleMicrotask', 'now', 'timestamp', 'reportError'] as const) {
      expect(() => createRuntime({ adapter: { [key]: 'not-a-function' } as any })).toThrow(
        expect.objectContaining({ code: 'INVALID_OPTION' })
      )
    }
  })

  it('AF-T20: a throwing reporter does not break Runtime construction (copy warning containment)', () => {
    noteRuntimeCopy(Symbol('foreign-copy'))
    expect(() =>
      createRuntime({
        onError: () => {
          throw new Error('reporter boom')
        }
      })
    ).not.toThrow()
    resetRuntimeCopiesForTest()
  })

  it('AF-T20: an async-rejecting reporter is contained without unhandled rejection', async () => {
    noteRuntimeCopy(Symbol('foreign-copy'))
    const runtime = createRuntime({
      onError: () => Promise.reject(new Error('async reporter boom'))
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime).toBeDefined()
    resetRuntimeCopiesForTest()
  })

  it('AF-T25: explicit undefined adapter field keeps the default (no overwrite)', async () => {
    const runtime = createRuntime({ adapter: { now: undefined } as any })
    // 显式 undefined 视为 omitted：默认 now 仍可用，不延迟产生裸 TypeError。
    const signal = runtime.signal(0)
    signal.value = 1
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(runtime.currentVersion()).toBeGreaterThan(0)
    signal.dispose()
  })

  it('AF-T28: hostile adapter getter is wrapped as INVALID_OPTION with the original as cause', () => {
    const getterError = new Error('adapter getter boom')
    const adapter = new Proxy(
      {},
      {
        get() {
          throw getterError
        }
      }
    )
    let caught: unknown
    try {
      createRuntime({ adapter } as any)
    } catch (error) {
      caught = error
    }
    expect((caught as { code?: string }).code).toBe('INVALID_OPTION')
    expect((caught as { cause?: unknown }).cause).toBe(getterError)
  })
})

describe('AF-T71 runtime callback admission', () => {
  it('rejects non-function scheduleIdle, onError, and onTrace during construction', () => {
    for (const key of ['scheduleIdle', 'onError', 'onTrace'] as const) {
      expect(() => createRuntime({ [key]: 1 } as never)).toThrowError(
        expect.objectContaining({
          name: 'TypeError',
          code: 'INVALID_OPTION'
        })
      )
    }
  })

  it('reads each callback option once and preserves a hostile getter as cause', () => {
    for (const key of ['scheduleIdle', 'onError', 'onTrace'] as const) {
      const getterError = new Error(`${key} getter boom`)
      let reads = 0
      const options = Object.defineProperty({}, key, {
        configurable: true,
        get() {
          reads++
          throw getterError
        }
      })

      let caught: unknown
      try {
        createRuntime(options as never)
      } catch (error) {
        caught = error
      }

      expect(reads).toBe(1)
      expect(caught).toEqual(
        expect.objectContaining({
          code: 'INVALID_OPTION',
          cause: getterError
        })
      )
    }
  })

  it('treats explicit undefined as omitted for all three callback options', () => {
    const runtime = createRuntime({
      scheduleIdle: undefined,
      onError: undefined,
      onTrace: undefined
    })
    const computed = runtime.computed(() => 1)

    expect(computed.value).toBe(1)
    computed.dispose()
  })

  it('snapshots callback identity, preserves receiver, and ignores later mutation', () => {
    const scheduled: Array<() => void> = []
    const traceReceivers: unknown[] = []
    const errorReceivers: unknown[] = []
    const options = {
      marker: 'original',
      scheduleIdle(this: { marker: string }, task: () => void) {
        scheduled.push(task)
        expect(this.marker).toBe('original')
      },
      onError(this: { marker: string }) {
        errorReceivers.push(this)
        expect(this.marker).toBe('original')
      },
      onTrace(this: { marker: string }) {
        traceReceivers.push(this)
        expect(this.marker).toBe('original')
      }
    }
    const runtime = createRuntime(options)
    options.scheduleIdle = () => {
      throw new Error('replacement scheduleIdle must not run')
    }
    options.onError = () => {
      throw new Error('replacement onError must not run')
    }
    options.onTrace = () => {
      throw new Error('replacement onTrace must not run')
    }

    const computed = runtime.computed(() => 1)
    expect(computed.value).toBe(1)
    runtime.reportError(new Error('diagnostic'), { phase: 'lifecycle-hook' } as never)
    const signal = runtime.signal(0)
    signal.value = 1

    expect(scheduled).toHaveLength(1)
    expect(errorReceivers).toEqual([options])
    expect(traceReceivers.length).toBeGreaterThan(0)
    expect(traceReceivers.every((receiver) => receiver === options)).toBe(true)
    computed.dispose()
    signal.dispose()
  })
})

describe('Sol scheduler strategy admission', () => {
  it('rejects null, object, and string immediately while retaining the prior strategy', () => {
    const scheduled: Array<() => void> = []
    const runtime = createRuntime()
    runtime.setSchedulerStrategy((flush) => {
      scheduled.push(flush)
    })

    for (const invalid of [null, {}, 'not-a-function']) {
      let caught: unknown
      try {
        runtime.setSchedulerStrategy(invalid as never)
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(TypeError)
      expect(caught).toMatchObject({
        source: '@migaia/reactive',
        code: ReactiveErrorCode.invalidOption
      })
    }

    const signal = runtime.signal(0)
    let runs = 0
    const dispose = runtime.effect(() => {
      void signal.value
      runs += 1
    })
    expect(runs).toBe(1)
    signal.value = 1
    expect(scheduled).toHaveLength(1)
    scheduled.shift()?.()
    expect(runs).toBe(2)
    dispose()
    signal.dispose()
  })
})

describe('scheduler strategy runtime contract', () => {
  it('reports async rejection once, observes it, and recovers with the prior strategy', async () => {
    const rejection = new Error('async strategy rejection')
    const reported: unknown[] = []
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const signal = runtime.signal(0)
    let runs = 0
    const dispose = runtime.effect(() => {
      void signal.value
      runs++
    })
    runtime.setSchedulerStrategy(async () => {
      await Promise.resolve()
      throw rejection
    })

    process.on('unhandledRejection', onUnhandled)
    try {
      signal.value = 1
      await flush()
      expect(reported).toHaveLength(1)
      expect(reported[0]).toMatchObject({
        source: '@migaia/reactive',
        code: ReactiveErrorCode.invalidOption,
        cause: rejection
      })

      signal.value = 2
      await flush()
      expect(runs).toBe(2)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      dispose()
      signal.dispose()
    }
  })

  it('reports thenable getter failure with its cause and recovers for later writes', async () => {
    const getterError = new Error('then getter failure')
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const signal = runtime.signal(0)
    let runs = 0
    const dispose = runtime.effect(() => {
      void signal.value
      runs++
    })
    const thenable = new Proxy(
      {},
      {
        get() {
          throw getterError
        }
      }
    )
    runtime.setSchedulerStrategy(() => thenable as never)

    try {
      signal.value = 1
      expect(reported).toHaveLength(1)
      expect(reported[0]).toMatchObject({
        source: '@migaia/reactive',
        code: ReactiveErrorCode.invalidOption,
        cause: getterError
      })
      signal.value = 2
      await flush()
      expect(runs).toBe(2)
    } finally {
      dispose()
      signal.dispose()
    }
  })

  it('clears scheduled after a synchronous strategy throw and recovers for later writes', async () => {
    const strategyError = new Error('sync strategy failure')
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const signal = runtime.signal(0)
    let runs = 0
    const dispose = runtime.effect(() => {
      void signal.value
      runs++
    })
    runtime.setSchedulerStrategy(() => {
      throw strategyError
    })

    try {
      expect(() => {
        signal.value = 1
      }).toThrow(strategyError)
      expect(reported).toEqual([])
      signal.value = 2
      await flush()
      expect(runs).toBe(2)
    } finally {
      dispose()
      signal.dispose()
    }
  })

  it('retires thenable callbacks before fallback and ignores late calls around one coalesced flush', async () => {
    const rejection = new Error('controlled strategy rejection')
    const reported: unknown[] = []
    const unhandled: unknown[] = []
    const fallbackTasks: Array<() => void> = []
    let oldCallback: (() => void) | undefined
    let rejectThenable: ((error: unknown) => void) | undefined
    const thenable = new Proxy(
      {},
      {
        get: (): ((resolve: unknown, reject: unknown) => void) => (_resolve, reject) => {
          rejectThenable = reject as (error: unknown) => void
        }
      }
    )
    const runtime = createRuntime({
      adapter: { scheduleMicrotask: (task) => fallbackTasks.push(task) },
      onError: (error) => reported.push(error)
    })
    const signal = runtime.signal(0)
    let runs = 0
    const dispose = runtime.effect(() => {
      void signal.value
      runs++
    })
    runtime.setSchedulerStrategy((flush) => {
      oldCallback = flush
      return thenable as never
    })

    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      signal.value = 1
      expect(oldCallback).toBeDefined()
      expect(rejectThenable).toBeDefined()
      rejectThenable?.(rejection)
      oldCallback?.()
      await Promise.resolve()

      expect(reported).toHaveLength(1)
      expect(reported[0]).toMatchObject({
        source: '@migaia/reactive',
        code: ReactiveErrorCode.invalidOption,
        cause: rejection
      })
      expect(runs).toBe(1)

      signal.value = 2
      signal.value = 3
      expect(fallbackTasks).toHaveLength(1)
      oldCallback?.()
      fallbackTasks.shift()?.()
      oldCallback?.()
      expect(runs).toBe(2)

      signal.value = 4
      expect(fallbackTasks).toHaveLength(1)
      fallbackTasks.shift()?.()
      expect(runs).toBe(3)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      dispose()
      signal.dispose()
    }
  })
})

describe('AF-T78 maxFlushPasses admission', () => {
  it('reads a hostile maxFlushPasses getter once and preserves its cause', () => {
    const getterError = new Error('maxFlushPasses getter boom')
    let reads = 0
    const options = Object.defineProperty({}, 'maxFlushPasses', {
      configurable: true,
      get() {
        reads++
        throw getterError
      }
    })

    let caught: unknown
    try {
      createRuntime(options as never)
    } catch (error) {
      caught = error
    }

    expect(reads).toBe(1)
    expect(caught).toEqual(
      expect.objectContaining({
        source: '@migaia/reactive',
        code: ReactiveErrorCode.invalidOption,
        cause: getterError
      })
    )
  })

  it('validates maxFlushPasses before construction and treats undefined as default', () => {
    expect(() => createRuntime({ maxFlushPasses: 0 })).toThrowError(
      expect.objectContaining({
        name: 'RangeError',
        code: ReactiveErrorCode.invalidOption
      })
    )
    expect(createRuntime({ maxFlushPasses: undefined })).toBeDefined()
  })
})
