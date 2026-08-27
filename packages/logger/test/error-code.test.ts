import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { Logger, LoggerErrorCode, LOGGER_SOURCE, setLoggerRuntimeManager } from '../src/index.js'
import { http } from '../src/plugins/http.js'
import { process as processPlugin } from '../src/plugins/process.js'
import { LoggerErrorText } from '../src/error-text.js'

describe('logger error-code contract (E-T9)', () => {
  it('declares 14 unique codes under the package source', () => {
    const codes = Object.values(LoggerErrorCode)
    expect(codes).toHaveLength(14)
    expect(new Set(codes).size).toBe(14)
    expect(LOGGER_SOURCE).toBe('@migaia/logger')
  })

  it('INVALID_OPTION preserves TypeError and scheduler accessor cause', () => {
    const cause = new Error('scheduler-accessor')
    let failure: unknown
    try {
      new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler: {
          get now(): never {
            throw cause
          },
          schedule: () => ({ cancel: () => undefined })
        }
      } as any)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(TypeError)
    expect(failure).toMatchObject({ source: LOGGER_SOURCE, code: LoggerErrorCode.invalidOption })
    expect((failure as Error & { cause?: unknown }).cause).toBe(cause)
  })

  it('RUNTIME_SHUTTING_DOWN rejects process plugin/logger installation during runtime shutdown', async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
      },
      removeListener: (event: string, listener: (...args: any[]) => void) =>
        listeners.get(event)?.delete(listener),
      exit: (() => undefined as never) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'runtime-shutdown-code',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      const first = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [processPlugin()]
      })
      listeners.get('SIGINT')?.values().next().value?.()
      let failure: unknown
      try {
        new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          plugins: [processPlugin()]
        })
      } catch (error) {
        failure = error
      }

      const tagged = (failure as Error & { cause?: unknown }).cause
      expect(failure).toBeInstanceOf(Error)
      expect(tagged).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.runtimeShuttingDown
      })
      expect((tagged as Error & { cause?: unknown }).cause).toBeUndefined()
      await first.shutdown('manual')
    } finally {
      restore()
    }
  })

  it('PLUGIN_CONFIG_CONFLICT rejects a second process configuration', async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
      },
      removeListener: (event: string, listener: (...args: any[]) => void) =>
        listeners.get(event)?.delete(listener),
      exit: (() => undefined as never) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'config-conflict-code',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      const first = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [processPlugin()]
      })
      let failure: unknown
      try {
        new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          plugins: [processPlugin({ shutdownTimeoutMs: 7 })]
        })
      } catch (error) {
        failure = error
      }

      const tagged = (failure as Error & { cause?: unknown }).cause
      expect(failure).toBeInstanceOf(Error)
      expect(tagged).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.pluginConfigConflict
      })
      expect((tagged as Error & { cause?: unknown }).cause).toBeUndefined()
      await first.shutdown('manual')
    } finally {
      restore()
    }
  })

  it('TRANSPORT_UNAVAILABLE is reported from the real HTTP sink path', async () => {
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'transport-code',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      const logger = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [http({ url: 'https://example.test/logs', retries: 0 })]
      })
      let failure: unknown
      logger.onFailure(({ error }) => {
        failure = error
      })
      logger.log('info', 'transport')
      await logger.flush()

      expect(failure).toBeInstanceOf(Error)
      expect(failure).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.transportUnavailable
      })
      expect((failure as Error & { cause?: unknown }).cause).toBeUndefined()
      await logger.shutdown('manual')
    } finally {
      restore()
    }
  })

  it('SERIALIZE_FAILED preserves the JSON serialization cause', async () => {
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'serialize-code',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      const logger = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [http({ url: 'https://example.test/logs', retries: 0 })]
      })
      let failure: unknown
      logger.onFailure(({ error }) => {
        failure = error
      })
      const circular: Record<string, unknown> = {}
      circular.self = circular
      logger.dispatchRaw({ tag: 'info', message: 'serialize', data: circular })
      await logger.flush()

      expect(failure).toBeInstanceOf(Error)
      expect(failure).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.serializeFailed
      })
      expect((failure as Error & { cause?: unknown }).cause).toBeInstanceOf(Error)
      await logger.shutdown('manual')
    } finally {
      restore()
    }
  })

  it('DELIVERY_FAILED preserves HTTP failure type and logger identity', async () => {
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'delivery-code',
      defer: (task) => task(),
      write: () => undefined,
      fetch: async () => ({ ok: false, status: 400, headers: { get: () => null } })
    })
    try {
      const logger = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [http({ url: 'https://example.test/logs', retries: 0 })]
      })
      let failure: unknown
      logger.onFailure(({ error }) => {
        failure = error
      })
      logger.log('info', 'delivery')
      await logger.flush()

      expect(failure).toBeInstanceOf(Error)
      expect(failure).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.deliveryFailed
      })
      expect((failure as Error & { cause?: unknown }).cause).toBeUndefined()
      await logger.shutdown('manual')
    } finally {
      restore()
    }
  })

  it('DELIVERY_FAILED wraps one exhausted runtimeFetch transport error with cause and one failure', async () => {
    const transportError = new TypeError('runtime-fetch-zero-retries')
    const receivers: unknown[] = []
    const fetch = vi.fn(function (this: unknown) {
      receivers.push(this)
      return Promise.reject(transportError)
    })
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'delivery-transport-zero',
      defer: (task) => task(),
      write: () => undefined,
      fetch
    })
    try {
      const logger = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [http({ url: 'https://example.test/logs', retries: 0 })]
      })
      const failures: Array<{ source: string; error: unknown }> = []
      logger.onFailure((failure) => failures.push(failure))
      logger.log('info', 'delivery transport')
      await logger.flush()

      expect(fetch).toHaveBeenCalledOnce()
      expect(receivers).toEqual([undefined])
      expect(failures).toHaveLength(1)
      const failure = failures[0]!
      expect(failure.source).toBe('sink')
      expect(failure.error).toBeInstanceOf(Error)
      expect(failure.error).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.deliveryFailed
      })
      expect((failure.error as Error & { cause?: unknown }).cause).toBe(transportError)
      expect(transportError).toBeInstanceOf(TypeError)
      await logger.shutdown('manual')
    } finally {
      restore()
    }
  })

  it('DELIVERY_FAILED exhausts retries and preserves an already tagged delivery error', async () => {
    const tagged = new TypeError('already-tagged-delivery')
    Object.defineProperty(tagged, 'source', { value: LOGGER_SOURCE, enumerable: true })
    Object.defineProperty(tagged, 'code', {
      value: LoggerErrorCode.deliveryFailed,
      enumerable: true
    })
    const fetch = vi.fn(async () => {
      throw tagged
    })
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'delivery-transport-retries',
      defer: (task) => task(),
      write: () => undefined,
      fetch
    })
    try {
      const logger = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [http({ url: 'https://example.test/logs', retries: 2 })]
      })
      const failures: Array<{ source: string; error: unknown }> = []
      logger.onFailure((failure) => failures.push(failure))
      logger.log('info', 'delivery retry transport')
      await logger.flush()

      expect(fetch).toHaveBeenCalledTimes(3)
      expect(failures).toHaveLength(1)
      const failure = failures[0]!
      expect(failure.source).toBe('sink')
      expect(failure.error).toBe(tagged)
      expect(failure.error).toBeInstanceOf(TypeError)
      expect((failure.error as Error & { cause?: unknown }).cause).toBeUndefined()
      await logger.shutdown('manual')
    } finally {
      restore()
    }
  })

  it('INVALID_RETRY_COUNT rejects invalid HTTP configuration before installation', () => {
    let failure: unknown
    try {
      http({ url: 'https://example.test/logs', retries: -1 })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.invalidRetryCount
    })
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined()
  })

  it('LIFECYCLE_DEADLINE reports a real never-settling sink after its deadline', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    try {
      const logger = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      let failure: unknown
      logger.onFailure(({ error }) => {
        failure = error
      })
      logger.useSink(
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          })
      )
      logger.log('info', 'deadline')
      const flush = logger.flush()
      await vi.advanceTimersByTimeAsync(3_000)
      await flush

      expect(failure).toBeInstanceOf(Error)
      expect(failure).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.lifecycleDeadline
      })
      expect((failure as Error & { cause?: unknown }).cause).toBeUndefined()
      release?.()
      await logger.shutdown('manual')
    } finally {
      vi.useRealTimers()
    }
  })

  it('PROCESS_INSTALL_ROLLBACK_FAILED preserves primary and rollback errors', () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const primary = new Error('process-install-primary')
    const rollback = new Error('process-install-rollback')
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        if (event === 'beforeExit') throw primary
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
      },
      removeListener: (event: string, listener: (...args: any[]) => void) => {
        if (event === 'SIGTERM') throw rollback
        listeners.get(event)?.delete(listener)
      },
      exit: (() => undefined as never) as (code?: number) => never
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'rollback-code',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      let failure: unknown
      try {
        new Logger({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
          plugins: [processPlugin()]
        })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      const tagged = (failure as Error & { cause?: unknown }).cause

      expect(tagged).toBeInstanceOf(AggregateError)
      expect(tagged).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.processInstallRollbackFailed
      })
      expect((tagged as AggregateError).errors).toEqual([primary, rollback])
      expect((tagged as Error & { cause?: unknown }).cause).toBeUndefined()
    } finally {
      restore()
    }
  })

  it('PLUGIN_UNINSTALL_CLEANUP_FAILED identifies final process cleanup, not install rollback', async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>()
    const restorationError = new Error('uninstall-exit-restore')
    const listenerError = new Error('uninstall-listener-remove')
    const originalExit = (() => undefined as never) as (code?: number) => never
    let exitValue = originalExit
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        const group = listeners.get(event) ?? new Set()
        group.add(listener)
        listeners.set(event, group)
      },
      removeListener: (event: string, listener: (...args: any[]) => void) => {
        if (event === 'SIGTERM') throw listenerError
        listeners.get(event)?.delete(listener)
      },
      get exit() {
        return exitValue
      },
      set exit(value: typeof originalExit) {
        exitValue = value
        if (value === originalExit) throw restorationError
      }
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'uninstall-code',
      defer: (task) => task(),
      write: () => undefined
    })
    try {
      const logger: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        plugins: [processPlugin({ interceptProcessExit: true })]
      })
      const failure = await logger.unUse('process')
      expect(failure).toBeDefined()
      const tagged = ((): Error & { source?: string; code?: string; cause?: unknown } => {
        const pending: unknown[] = [failure]
        const visited = new Set<unknown>()
        while (pending.length > 0) {
          const candidate = pending.shift()
          if (visited.has(candidate)) continue
          visited.add(candidate)
          if (
            candidate instanceof Error &&
            (candidate as Error & { code?: string }).code ===
              LoggerErrorCode.pluginUninstallCleanupFailed
          )
            return candidate
          if (candidate instanceof AggregateError) pending.push(...candidate.errors)
          if (candidate instanceof Error) pending.push(candidate.cause)
          if (candidate && typeof candidate === 'object') {
            const result = candidate as {
              readonly cleanupErrors?: unknown
              readonly error?: unknown
            }
            if (Array.isArray(result.cleanupErrors)) pending.push(...result.cleanupErrors)
            if (result.error !== undefined) pending.push(result.error)
          }
        }
        throw new Error('tagged uninstall error not found')
      })()
      expect(tagged).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.pluginUninstallCleanupFailed
      })
      expect(tagged).not.toMatchObject({ code: LoggerErrorCode.processInstallRollbackFailed })
      const cleanupErrors = (tagged as Error & { cause?: AggregateError }).cause?.errors ?? []
      expect(cleanupErrors).toEqual([restorationError, listenerError])
    } finally {
      exitValue = originalExit
      restore()
    }
  })

  it('PLUGIN_SHUTDOWN_CLEANUP_FAILED preserves cancel and exit failures in order', async () => {
    const cancelError = new Error('shutdown-timer-cancel')
    const exitError = new Error('shutdown-exit')
    const listeners = new Map<string, (...args: any[]) => void>()
    const diagnostics: unknown[] = []
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => listeners.set(event, listener),
      removeListener: () => undefined,
      exit: (() => {
        throw exitError
      }) as (code?: number) => never
    }
    const scheduler = {
      now: () => 0,
      schedule: (_callback: () => void, delay: number) => ({
        cancel: () => {
          if (delay === 10) throw cancelError
        }
      })
    }
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'shutdown-code',
      defer: (task) => task(),
      write: () => undefined,
      console: {
        log: () => undefined,
        warn: () => undefined,
        error: (...args) => diagnostics.push(...args)
      }
    })
    try {
      const logger: any = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
        scheduler,
        plugins: [processPlugin({ shutdownTimeoutMs: 10 })]
      })
      listeners.get('SIGINT')?.()
      await Promise.resolve()
      await Promise.resolve()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const tagged = diagnostics.find(
        (value) =>
          value instanceof Error &&
          (value as Error & { code?: string }).code === LoggerErrorCode.pluginShutdownCleanupFailed
      ) as
        | (Error & { source?: string; code?: string; message?: string; cause?: AggregateError })
        | undefined
      expect(tagged).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.pluginShutdownCleanupFailed,
        message: LoggerErrorText.pluginShutdownCleanupFailed
      })
      expect(tagged).not.toMatchObject({ code: LoggerErrorCode.processInstallRollbackFailed })
      expect(tagged?.cause?.errors).toEqual([cancelError, exitError])
      await logger.shutdown('manual')
    } finally {
      restore()
    }
  })

  it('HOOK_FAILED emits a tagged diagnostic with the reporter failure as cause', async () => {
    const diagnostics: unknown[][] = []
    const reporterFailure = new Error('failure-hook')
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'hook-code',
      defer: (task) => task(),
      write: () => undefined,
      console: {
        log: () => undefined,
        warn: () => undefined,
        error: (...args) => diagnostics.push(args)
      }
    })
    try {
      const logger = new Logger({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      logger.onFailure(() => {
        throw reporterFailure
      })
      logger.useSink(() => Promise.reject(new Error('sink-for-hook')))
      logger.log('error', 'hook')
      await logger.flush()
      const diagnostic = diagnostics.find(
        (args) => (args[0] as { code?: unknown } | undefined)?.code === LoggerErrorCode.hookFailed
      )?.[0]

      expect(diagnostic).toBeInstanceOf(Error)
      expect(diagnostic).toMatchObject({ source: LOGGER_SOURCE, code: LoggerErrorCode.hookFailed })
      expect((diagnostic as Error & { cause?: unknown }).cause).toBe(reporterFailure)
      await logger.shutdown('manual')
    } finally {
      restore()
    }
  })

  it('EXTENDS_SELF rejects self forwarding with logger identity', async () => {
    const logger = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    let failure: unknown
    try {
      logger.extends(logger)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ source: LOGGER_SOURCE, code: LoggerErrorCode.extendsSelf })
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined()
    await logger.shutdown('manual')
  })

  it('EXTENDS_CYCLE rejects a cycle in the real extends graph', async () => {
    const first = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      topic: 'first'
    })
    const second = new Logger({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
      topic: 'second'
    })
    first.extends(second)
    let failure: unknown
    try {
      second.extends(first)
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ source: LOGGER_SOURCE, code: LoggerErrorCode.extendsCycle })
    expect((failure as Error & { cause?: unknown }).cause).toBeUndefined()
    await first.shutdown('manual')
    await second.shutdown('manual')
  })
})
