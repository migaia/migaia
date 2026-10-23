import { createConcurrencyLimiter, deferred } from '@migaia/utils/promise'
import type { IPluginLifecycleCore } from '@migaia/plugin-host'
import type { ILoggerPluginCore } from '../../typing.js'
import {
  createLoggerError,
  createLoggerTypeError,
  tagLoggerError,
  LoggerErrorCode,
  LOGGER_SOURCE
} from '../../errors.js'
import { createObservation } from './observation.js'
import { logStorageFailure } from './store.js'
import { assertLogInteger } from './committed-index.js'
import { LogOperation, LogStage } from './state-constants.js'
import { DurableText } from './text.js'
import type { IDurablePluginOptions, ILogAppendPort, ILogPayload, ILogStore } from './types.js'

/** Each resource has one installed borrower; the map never grants native transaction authority. */
const borrowers = new WeakMap<ILogStore, object>()
/** Actual logger installation context includes the existing registration lifetime. */
export type IDurableCore = ILoggerPluginCore & IPluginLifecycleCore<Record<string, never>>
/** One installation reuses the existing limiter for initialization, operations, and port completion. */
export function createDurableRuntime(
  core: IDurableCore,
  options: IDurablePluginOptions,
  owner: 'binlog' | 'wal' | 'undo',
  initialize?: () => Promise<void>
) {
  const store = options.store
  if (!store || typeof store !== 'object')
    throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
  if (borrowers.has(store))
    throw createLoggerError(LoggerErrorCode.logStoreInUse, DurableText.inUse)
  /** Identity permits only this installation to return its own borrow. */
  const identity = {}
  borrowers.set(store, identity)
  /** The single FIFO also accounts for immediately started native port calls. */
  const limiter = createConcurrencyLimiter({ concurrency: 1 })
  /** Revocation never cancels previously admitted ordinary operations. */
  let accepting = true
  let prepared = false
  let initializationError: Error | undefined
  /** Installed source subscriptions and pending observation registrations release together. */
  const cleanups = new Set<() => void>()
  /** Index release waits until all previously accepted operations have completed. */
  const afterIdle = new Set<() => void>()
  /** Error reporting remains the logger's original policy, including original causes. */
  const report = (error: unknown): void => core.reportFailure({ source: 'sink', error })
  const reportHook = (error: unknown): void => core.reportFailure({ source: 'hook', error })
  const observe = createObservation(options, reportHook)
  /** Give back only our own registration, including failed initialization. */
  const release = (): void => {
    if (borrowers.get(store) === identity) borrowers.delete(store)
  }
  /** Stop new calls and source delivery while leaving already accepted FIFO work intact. */
  const stop = (): void => {
    if (!accepting) return
    accepting = false
    observe(() => ({ stage: LogStage.beforeLogClose, owner, operation: LogOperation.close }))
    for (const cleanup of cleanups) {
      try {
        cleanup()
      } catch (error) {
        reportHook(error)
      }
    }
    cleanups.clear()
  }
  /** All retained APIs consult this registration, never a later replacement. */
  const admit = (): void => {
    if (initializationError) throw initializationError
    if (!accepting || core.lifecycle.signal.aborted)
      throw createLoggerError(LoggerErrorCode.runtimeShuttingDown, DurableText.closed)
  }
  core.lifecycle.signal.addEventListener('abort', stop, { once: true })
  const offShutdown = core.onShutdown(() => stop())
  const offFlush = core.onFlush(() => limiter.whenIdle())
  core.onDispose(async () => {
    stop()
    await limiter.whenIdle()
    limiter.close()
    for (const cleanup of afterIdle) cleanup()
    afterIdle.clear()
    offFlush()
    offShutdown()
    core.lifecycle.signal.removeEventListener('abort', stop)
    release()
    observe(() => ({ stage: LogStage.afterLogClose, owner, operation: LogOperation.close }))
  })
  observe(() => ({ stage: LogStage.beforeLogOpen, owner, operation: LogOperation.open }))
  /** Ready is stable during the installation and observed internally if nobody awaits it. */
  const ready = limiter.run(async () => {
    try {
      if (initialize) await initialize()
      else await store.lastSeq()
      prepared = true
      observe(() => ({ stage: LogStage.afterLogOpen, owner, operation: LogOperation.open }))
    } catch (error) {
      initializationError = logStorageFailure(error)
      stop()
      release()
      observe(() => ({ stage: LogStage.onLogOpenError, owner, operation: LogOperation.open }))
      report(initializationError)
      throw initializationError
    }
  })
  void ready.catch(() => undefined)
  /** Executes accepted tasks after initialization, observing failure once at the same boundary. */
  const run = <T>(operation: string, task: () => T | PromiseLike<T>): Promise<T> => {
    try {
      admit()
    } catch (error) {
      return Promise.reject(error)
    }
    return limiter.run(async () => {
      await ready
      observe(() => ({ stage: LogStage.beforeLogOperation, owner, operation }))
      try {
        const result = await task()
        observe(() => ({ stage: LogStage.afterLogOperation, owner, operation }))
        return result
      } catch (error) {
        const coded = logStorageFailure(error)
        observe(() => ({ stage: LogStage.onLogOperationError, owner, operation }))
        report(coded)
        throw coded
      }
    })
  }
  /** Coded failures from the native transaction owner retain their original identity. */
  const portFailure = (error: unknown): unknown =>
    error &&
    typeof error === 'object' &&
    Object.getOwnPropertyDescriptor(error, 'source')?.value &&
    Object.getOwnPropertyDescriptor(error, 'code')?.value
      ? error
      : logStorageFailure(error)
  /** Starts the captured append in this stack; its result never waits behind ordinary FIFO tasks. */
  const appendPort = (
    port: ILogAppendPort,
    records: readonly { readonly kind: string; readonly payload: ILogPayload }[],
    committed: (seqs: readonly number[]) => void = () => undefined,
    rolledBack: () => void = () => undefined
  ): Promise<readonly number[]> => {
    try {
      admit()
      if (
        !prepared ||
        port.store !== store ||
        typeof port.append !== 'function' ||
        typeof port.onCommit !== 'function' ||
        typeof port.onRollback !== 'function'
      )
        throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
    } catch (error) {
      return Promise.reject(error)
    }
    /** Reserve accounting before native callbacks can synchronously close this installation. */
    const completion = deferred<readonly number[]>()
    const accounting = limiter.run(() =>
      completion.promise.then(
        () => undefined,
        () => undefined
      )
    )
    void accounting.catch(report)
    /** Pending callbacks belong only to this installation; store commit notices belong to the owner. */
    let offCommit = () => undefined as void
    let offRollback = () => undefined as void
    const cancel = (): void => {
      for (const off of [offCommit, offRollback]) {
        try {
          off()
        } catch (error) {
          reportHook(error)
        }
      }
      cleanups.delete(cancel)
    }
    cleanups.add(cancel)
    let result: Promise<readonly number[]>
    try {
      offCommit = port.onCommit(() => {
        cancel()
        if (accepting && !core.lifecycle.signal.aborted)
          void completion.promise
            .then(
              (seqs) => {
                committed(seqs)
                observe(() => ({
                  stage: LogStage.afterLogOperation,
                  owner,
                  operation: LogOperation.append,
                  count: seqs.length
                }))
              },
              () => undefined
            )
            .catch(reportHook)
      })
      offRollback = port.onRollback(() => {
        cancel()
        rolledBack()
      })
      observe(() => ({
        stage: LogStage.beforeLogOperation,
        owner,
        operation: LogOperation.append,
        count: records.length
      }))
      result = Promise.resolve(port.append(records)).catch((error) => {
        throw portFailure(error)
      })
    } catch (error) {
      result = Promise.reject(portFailure(error))
    }
    void result.then(completion.resolve, (error) => {
      cancel()
      rolledBack()
      observe(() => ({
        stage: LogStage.onLogOperationError,
        owner,
        operation: LogOperation.append
      }))
      report(error)
      completion.reject(error)
    })
    return result
  }
  return {
    store,
    core,
    run,
    appendPort,
    admit,
    observe,
    report,
    reportHook,
    cleanups,
    afterIdle,
    active: () => accepting && !core.lifecycle.signal.aborted,
    ready: (): Promise<void> => {
      try {
        admit()
        return ready
      } catch (error) {
        return Promise.reject(error)
      }
    },
    whenIdle: () => limiter.whenIdle(),
    stop
  }
}
/** Inferred runtime type keeps plugin helpers private to this package. */
export type IDurableRuntime = ReturnType<typeof createDurableRuntime>

/** Captures factory options without cloning or placing resource identities in plugin config. */
export function captureDurableOptions(
  input: import('./types.js').IBinlogOptions
): import('./types.js').IBinlogOptions {
  try {
    if (!input || typeof input !== 'object')
      throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
    const store = input.store
    const observe = input.observe
    const echo = input.echo
    if (
      !store ||
      typeof store !== 'object' ||
      (observe !== undefined && typeof observe !== 'function') ||
      (echo !== undefined && typeof echo !== 'boolean')
    )
      throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
    for (const method of [
      'append',
      'read',
      'lastSeq',
      'onAppend',
      'truncate',
      'setState',
      'states',
      'dispose'
    ] as const) {
      if (typeof store[method] !== 'function')
        throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
    }
    return { store, observe, echo }
  } catch (error) {
    if (
      error instanceof Error &&
      Object.getOwnPropertyDescriptor(error, 'source')?.value === LOGGER_SOURCE
    )
      throw error
    throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption, {
      cause: error
    })
  }
}

/** Captures one optional transaction port before entering the FIFO or native transaction. */
export function captureAppendPort(
  options: import('./types.js').ILogAppendOptions | undefined
): ILogAppendPort | undefined {
  if (options === undefined) return undefined
  try {
    if (!options || typeof options !== 'object')
      throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
    return options.transaction
  } catch (error) {
    throw optionFailure(error)
  }
}
/** Captures the public page size and validates its inclusive-zero range. */
export function captureLimit(options: { readonly limit?: number } | undefined): number {
  try {
    if (options !== undefined && (!options || typeof options !== 'object'))
      throw createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption)
    const limit = options?.limit ?? 100
    assertLogInteger(limit, 0)
    return limit
  } catch (error) {
    throw optionFailure(error)
  }
}
/** Captures undo list options without allowing accessors to escape the logger boundary. */
export function captureUndoListOptions(
  options: { readonly limit?: number; readonly sinceTime?: number } | undefined
): { limit: number; sinceTime: number } {
  const limit = captureLimit(options)
  try {
    const sinceTime = options?.sinceTime ?? 0
    if (!Number.isFinite(sinceTime) || sinceTime < 0)
      throw tagLoggerError(new RangeError(DurableText.invalidOption), LoggerErrorCode.invalidOption)
    return { limit, sinceTime }
  } catch (error) {
    throw optionFailure(error)
  }
}
/** All option access failures retain their cause while existing logger admission errors stay intact. */
function optionFailure(error: unknown): Error {
  if (
    error instanceof Error &&
    Object.getOwnPropertyDescriptor(error, 'source')?.value === LOGGER_SOURCE
  )
    return error
  return createLoggerTypeError(LoggerErrorCode.invalidOption, DurableText.invalidOption, {
    cause: error
  })
}
