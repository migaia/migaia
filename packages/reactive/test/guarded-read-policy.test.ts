import { describe, expect, it } from 'vitest'
import { createRuntime } from '../src/index.js'
import { ReactiveErrorCode } from '../src/error-code.js'
import { ReactiveErrorText } from '../src/error-text.js'

describe('reactive guarded-read policy', () => {
  it('keeps option and adapter getter failures as INVALID_OPTION causes', () => {
    const failure = new Error('getter failed')
    let optionReads = 0
    let adapterReads = 0
    const options = {
      get maxFlushPasses(): never {
        optionReads += 1
        throw failure
      }
    }
    const adapter = {
      get now(): never {
        adapterReads += 1
        throw failure
      }
    }
    let optionError: unknown
    let adapterError: unknown
    try {
      createRuntime(options)
    } catch (error) {
      optionError = error
    }
    try {
      createRuntime({ adapter })
    } catch (error) {
      adapterError = error
    }
    expect(optionError).toBeInstanceOf(TypeError)
    expect(optionError).toMatchObject({
      code: ReactiveErrorCode.invalidOption,
      message: ReactiveErrorText.runtimeOptionGetterFailed('maxFlushPasses'),
      cause: failure
    })
    expect(adapterError).toBeInstanceOf(TypeError)
    expect(adapterError).toMatchObject({
      code: ReactiveErrorCode.invalidOption,
      message: ReactiveErrorText.runtimeAdapterGetterFailed('now'),
      cause: failure
    })
    expect(optionReads).toBe(1)
    expect(adapterReads).toBe(1)
  })

  it('reports one failed strategy then read with the original cause', () => {
    const failure = new Error('then failed')
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const signal = runtime.signal(0)
    const dispose = runtime.effect(() => {
      void signal.value
    })
    let reads = 0
    const result = Object.defineProperty({}, String.fromCharCode(116, 104, 101, 110), {
      get: () => {
        reads += 1
        throw failure
      }
    })
    runtime.setSchedulerStrategy(() => result as never)
    try {
      signal.value = 1
      expect(reported).toHaveLength(1)
      expect(reported[0]).toMatchObject({
        code: ReactiveErrorCode.invalidOption,
        message: ReactiveErrorText.schedulerStrategyReturnedThenable,
        cause: failure
      })
      expect(reads).toBe(1)
    } finally {
      dispose()
      signal.dispose()
    }
  })

  it('keeps a captured then method when the strategy returns a thenable', async () => {
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const signal = runtime.signal(0)
    const dispose = runtime.effect(() => {
      void signal.value
    })
    let reads = 0
    const result = Object.defineProperty({}, String.fromCharCode(116, 104, 101, 110), {
      get: () => {
        reads += 1
        return (resolve: (value?: unknown) => void): void => resolve(undefined)
      }
    })
    runtime.setSchedulerStrategy(() => result as never)
    try {
      signal.value = 1
      await Promise.resolve()
      await Promise.resolve()
      expect(reads).toBe(1)
      expect(reported).toHaveLength(1)
      expect(reported[0]).toMatchObject({
        code: ReactiveErrorCode.invalidOption,
        message: ReactiveErrorText.schedulerStrategyReturnedThenable
      })
    } finally {
      dispose()
      signal.dispose()
    }
  })

  it('keeps the pre-report cause-read fallback during batch and flush failure', () => {
    const runtime = createRuntime()
    const signal = runtime.signal(0)
    const flushFailure = new Error('flush failed')
    const causeReadFailure = new Error('cause read failed')
    const primary = new Error('batch failed')
    let causeReads = 0
    Object.defineProperty(primary, 'cause', {
      configurable: true,
      get: () => {
        causeReads += 1
        throw causeReadFailure
      }
    })
    const dispose = runtime.effect(() => {
      if (signal.value === 1) throw flushFailure
    })
    let caught: unknown
    try {
      runtime.batch(() => {
        signal.value = 1
        throw primary
      })
    } catch (error) {
      caught = error
    } finally {
      dispose()
      signal.dispose()
    }
    expect(caught).toBe(primary)
    expect(primary.cause).toBe(flushFailure)
    expect(causeReads).toBe(1)
  })
})
