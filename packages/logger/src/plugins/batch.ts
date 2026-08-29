import type { IEmptyPluginExt, ILoggerPluginCore, ILoggerPlugin } from '../typing.js'
import type { IPipelineMode } from '@migaia/plugin-host'
import { boundedWait, type IScheduledTask } from '@migaia/lifecycle'
import {
  createLoggerCleanupError,
  createLoggerError,
  LoggerErrorCode,
  tagLoggerError
} from '../errors.js'
import { LoggerErrorText } from '../error-text.js'

export type IBatchPluginConfig = {
  maxSize?: number
  maxWaitMs?: number
  /** Maximum number of batches executing at once. Defaults to one for lossless delivery. */
  maxConcurrentBatches?: number
  /** Maximum number of queued or executing batches. Defaults to 1024. */
  maxPendingBatches?: number
  /** 批次满时是否异步调度回调；默认 true。定时触发本身已是异步。 */
  asyncOutput?: boolean
}

export type IBatcher<T> = {
  push(item: T): void
  flush(): Promise<void>
}

/** Batch 插件共享的批处理器工厂签名。 */
export type ICreateBatcher = <T>(
  config: IBatchPluginConfig,
  onBatch: (items: T[]) => void | Promise<void>
) => IBatcher<T>

export type IBatchShared = { createBatcher: ICreateBatcher }

export type IBatchController<T> = IBatcher<T> & {
  dispose(): readonly unknown[] | Promise<readonly unknown[]>
}

export const BATCH_PLUGIN_NAME = 'batch' as const

/**
 * Batch 插件本身不假设"被批量处理的对象一定是日志 entry"—— 它只是把"攒够数量或者攒够时间就触发一次回调"这件事抽象成一个通用能力， 通过 shared() 暴露
 * createBatcher，消费插件用 getShared("createBatcher") 获取。 这也是为什么它对实例本身不附加任何方法（IEmptyPluginExt）。
 */
class BatchPlugin implements ILoggerPlugin<
  IEmptyPluginExt,
  IBatchPluginConfig,
  IPipelineMode,
  IBatchShared
> {
  readonly name = BATCH_PLUGIN_NAME
  readonly config: IBatchPluginConfig

  constructor(config: IBatchPluginConfig) {
    this.config = config
  }

  shared(core: ILoggerPluginCore): IBatchShared {
    // 不读 this.config——统一通过 core.config.get() 读取
    const defaultConfig = core.config.get<IBatchPluginConfig>() ?? {}
    /** Keeps every batcher created from this plugin-owned shared factory. */
    const batchers = new Set<() => readonly unknown[] | Promise<readonly unknown[]>>()
    /** Shared factory admission closes before any batcher cleanup runs. */
    let available = true

    core.onDispose(async () => {
      available = false
      const cleanupErrors: unknown[] = []
      for (const dispose of batchers) cleanupErrors.push(...(await dispose()))
      batchers.clear()
      if (cleanupErrors.length > 0) {
        const tagged = createLoggerCleanupError(
          LoggerErrorCode.pluginUninstallCleanupFailed,
          LoggerErrorText.pluginUninstallCleanupFailed,
          cleanupErrors
        )
        throw tagged
      }
    })

    const createBatcher: ICreateBatcher = (perCallConfig, onBatch) => {
      if (!available) return this.#createDisposedBatcher()
      const batcher = this.buildBatcher(core, defaultConfig, perCallConfig, onBatch)
      batchers.add(batcher.dispose)
      return batcher
    }

    return { createBatcher }
  }

  install(): IEmptyPluginExt {
    return {}
  }

  buildBatcher<T>(
    core: ILoggerPluginCore,
    defaultConfig: IBatchPluginConfig,
    perCallConfig: IBatchPluginConfig,
    onBatch: (items: T[]) => void | Promise<void>,
    propagateErrors = false
  ): IBatchController<T> {
    const maxSize = perCallConfig.maxSize ?? defaultConfig.maxSize ?? 20
    const maxWaitMs = perCallConfig.maxWaitMs ?? defaultConfig.maxWaitMs ?? 2000
    const asyncOutput = perCallConfig.asyncOutput ?? defaultConfig.asyncOutput ?? true
    const maxConcurrentBatches =
      perCallConfig.maxConcurrentBatches ?? defaultConfig.maxConcurrentBatches ?? 1
    const maxPendingBatches =
      perCallConfig.maxPendingBatches ?? defaultConfig.maxPendingBatches ?? 1024
    if (!Number.isSafeInteger(maxConcurrentBatches) || maxConcurrentBatches < 1)
      throw createLoggerError(LoggerErrorCode.invalidOption, LoggerErrorText.invalidOption)
    if (!Number.isSafeInteger(maxPendingBatches) || maxPendingBatches < 1)
      throw createLoggerError(LoggerErrorCode.invalidOption, LoggerErrorText.invalidOption)

    let buffer: T[] = []
    const queue: T[][] = []
    let timer: IScheduledTask | null = null
    /** Prevents one returned debounce task from being cancelled more than once. */
    let timerCancelAttempted = false
    const inFlight = new Set<Promise<void>>()
    let pumpScheduled = false
    let flushing: Promise<void> | null = null
    /** False after plugin uninstall; late scheduler callbacks become inert. */
    let active = true
    /** Closes producer admission before the existing queue is drained during uninstall. */
    let accepting = true

    const flush = async (): Promise<void> => {
      if (!active) return
      if (flushing) return flushing
      flushing = (async () => {
        const deadline = core.scheduler.now() + 3000
        do {
          await flushBatch()
          // A full batch may be queued behind the logger's asynchronous defer boundary. Flush
          // owns the delivery barrier, so it must start that queued work before waiting on the
          // in-flight set; otherwise an empty set plus a non-empty queue can spin forever.
          pump()
          if (!(await boundedWait(Promise.all(inFlight), deadline, { scheduler: core.scheduler })))
            return
        } while (
          (buffer.length > 0 || queue.length > 0 || inFlight.size > 0) &&
          core.scheduler.now() < deadline
        )
      })()
      try {
        await flushing
      } finally {
        flushing = null
      }
    }

    const reportCleanupFailure = (error: unknown): void => {
      if (!active) return
      // Route timer cleanup failures through core tracking so direct timer callbacks cannot
      // create an unhandled rejection or hide a scheduler failure from logger policy.
      core.defer(() => {
        throw error
      })
    }

    const cancelTimer = (cleanupErrors?: unknown[]): void => {
      const scheduled = timer
      timer = null
      if (!scheduled) return
      if (timerCancelAttempted) return
      timerCancelAttempted = true
      try {
        scheduled.cancel()
      } catch (error) {
        if (cleanupErrors)
          cleanupErrors.push(
            error instanceof Error
              ? tagLoggerError(error, LoggerErrorCode.pluginUninstallCleanupFailed)
              : createLoggerError(
                  LoggerErrorCode.pluginUninstallCleanupFailed,
                  LoggerErrorText.pluginUninstallCleanupFailed,
                  { cause: error }
                )
          )
        else reportCleanupFailure(error)
      }
    }

    const pump = (): Promise<void> | undefined => {
      if (!active) return
      let firstTask: Promise<void> | undefined
      while (queue.length > 0 && inFlight.size < maxConcurrentBatches) {
        const batch = queue.shift()!
        const task = runBatch(batch)
        firstTask ??= task
      }
      return firstTask
    }

    const schedulePump = (): void => {
      if (pumpScheduled || !active) return
      pumpScheduled = true
      try {
        core.defer(() => {
          pumpScheduled = false
          pump()
        })
      } catch (error) {
        pumpScheduled = false
        reportBatchFailure(error)
      }
    }

    const enqueue = (batch: T[], immediate: boolean): Promise<void> | undefined => {
      if (!active) return
      if (!immediate && queue.length + inFlight.size >= maxPendingBatches) {
        throw createLoggerError(LoggerErrorCode.batchOverflow, LoggerErrorText.batchOverflow)
      }
      queue.push(batch)
      if (immediate) return pump()
      if (asyncOutput) {
        schedulePump()
        return undefined
      }
      return pump()
    }

    const flushBatch = async (): Promise<void> => {
      if (!active) return
      cancelTimer()
      if (buffer.length === 0) return
      const batch = buffer
      buffer = []
      enqueue(batch, true)
    }

    /** 执行一个已从 buffer 摘出的批次，并让 flush() 可观察其生命周期。 */
    const reportBatchFailure = (error: unknown): void => {
      if (!active) return
      core.defer(() => {
        throw error
      })
    }

    const runBatch = (batch: T[]): Promise<void> | undefined => {
      if (!active) return
      let result: void | Promise<void>
      try {
        result = onBatch(batch)
      } catch (error) {
        if (propagateErrors) {
          const raw = Promise.reject(error)
          const task = raw.catch(() => undefined)
          inFlight.add(task)
          void task.then(() => {
            inFlight.delete(task)
            pump()
          })
          return raw
        }
        reportBatchFailure(error)
        return
      }
      const raw = Promise.resolve(result)
      const task = raw.catch((error) => {
        if (!propagateErrors) reportBatchFailure(error)
      })
      inFlight.add(task)
      void task.then(() => {
        inFlight.delete(task)
        pump()
      })
      return propagateErrors ? raw : task
    }

    const push = (item: T): void | Promise<void> => {
      if (!active || !accepting) return
      buffer.push(item)
      if (buffer.length >= maxSize) {
        cancelTimer()
        const fullBatch = buffer
        buffer = []
        try {
          return enqueue(fullBatch, false)
        } catch (error) {
          buffer = fullBatch
          throw error
        }
      }
      if (!timer) {
        // 从缓冲区第一条数据进来起，最多等 maxWaitMs 就必须 flush 一次
        let callbackFired = false
        timerCancelAttempted = false
        try {
          const scheduled = core.scheduler.schedule(() => {
            callbackFired = true
            if (!active) return
            try {
              core.defer(() => {
                if (active) return flush()
              })
            } catch (error) {
              reportBatchFailure(error)
            } finally {
              // If callback was asynchronous, returned task is already admitted here; if it was
              // synchronous, the post-schedule check below performs the same cleanup.
              cancelTimer()
            }
          }, maxWaitMs)
          // Retain handle even when scheduler fired callback before returning it. The task may
          // have independent armed work that still requires cancellation.
          timer = scheduled
          if (callbackFired) cancelTimer()
        } catch (error) {
          reportBatchFailure(error)
        }
      }
    }

    const dispose = async (): Promise<readonly unknown[]> => {
      if (!active) return []
      accepting = false
      const cleanupErrors: unknown[] = []
      cancelTimer(cleanupErrors)
      try {
        await flush()
      } catch (error) {
        cleanupErrors.push(error)
      }
      active = false
      buffer = []
      queue.length = 0
      inFlight.clear()
      return cleanupErrors
    }

    // Dynamic batchers may be created after plugin installation. Keep their flusher paired with
    // the batcher's own idempotent disposer; `onDispose` is intentionally install-scoped in V2.
    const offFlush = core.onFlush(flush)
    const originalDispose = dispose
    const disposeWithFlush = async (): Promise<readonly unknown[]> => {
      offFlush()
      return originalDispose()
    }
    return { push, flush, dispose: disposeWithFlush }
  }

  /** Returns an inert batcher to retained factories after their plugin has been uninstalled. */
  #createDisposedBatcher<T>(): IBatchController<T> {
    return {
      push: () => undefined,
      flush: async () => undefined,
      dispose: () => []
    }
  }
}

export const batch = (
  config: IBatchPluginConfig = {}
): ILoggerPlugin<IEmptyPluginExt, IBatchPluginConfig, IPipelineMode, IBatchShared> =>
  new BatchPlugin(config)

/** Builds the canonical bounded delivery queue for a direct HTTP sink without another owner. */
export function createBatcherForCore<T>(
  core: ILoggerPluginCore,
  defaultConfig: IBatchPluginConfig,
  perCallConfig: IBatchPluginConfig,
  onBatch: (items: T[]) => void | Promise<void>
): IBatcher<T> {
  return new BatchPlugin({}).buildBatcher(core, defaultConfig, perCallConfig, onBatch, true)
}
