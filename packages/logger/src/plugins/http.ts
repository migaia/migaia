import type { IEmptyPluginExt, ILogEntry, ILoggerPluginCore, ILoggerPlugin } from '../typing.js'
import type { IBatchShared } from './batch.js'
import type { IPipelineMode } from '@migaia/plugin-host'
import { getLoggerRuntimeManager } from '../runtime-manager.js'
import {
  createLoggerAggregateError,
  createLoggerError,
  ensureLoggerDeliveryError,
  LoggerErrorCode
} from '../errors.js'
import { LoggerErrorText } from '../error-text.js'
import type { ILifecycleScheduler, IScheduledTask } from '@migaia/lifecycle'

export type IHttpPluginConfig = {
  url: string
  authToken?: string
  headers?: Record<string, string>
  retries?: number
  /** 单次 HTTP 请求最长等待时间；默认 10000ms。 */
  requestTimeoutMs?: number
  /** 是否复用 batch 插件的批量能力；未装 batch 插件时自动退化为每条日志单独发送 */
  batch?: { maxSize?: number; maxWaitMs?: number; asyncOutput?: boolean }
}

export const HTTP_PLUGIN_NAME = 'http' as const

/** Marks scheduler/listener admission failures that must outrank an earlier transport failure. */
const HTTP_WAIT_PRIMARY = Symbol('logger.http.wait.primary')

/** Retains wait-admission classification without changing the public logger error contract. */
function markHttpWaitPrimary(error: Error): Error {
  Object.defineProperty(error, HTTP_WAIT_PRIMARY, { value: true })
  return error
}

/** Identifies wait admission failures that remain primary over an earlier retry error. */
function isHttpWaitPrimary(error: unknown): boolean {
  return (
    error instanceof Error &&
    Object.getOwnPropertyDescriptor(error, HTTP_WAIT_PRIMARY)?.value === true
  )
}

/** Keeps a transport error primary while retaining every scheduler/listener cleanup failure. */
function ensureHttpFailure(
  hasPrimary: boolean,
  primary: unknown,
  cleanupErrors: readonly unknown[]
): Error {
  const errors = hasPrimary ? [primary, ...cleanupErrors] : [...cleanupErrors]
  if (errors.length === 1) return ensureLoggerDeliveryError(errors[0])
  return createLoggerAggregateError(
    LoggerErrorCode.deliveryFailed,
    LoggerErrorText.httpTransportFailed,
    errors
  )
}

/**
 * 注意插件安装顺序：http 插件在 install() 时通过 core.getShared("createBatcher") 读取 batch 插件的 shared 能力，所以 plugins
 * 数组里 batch 必须排在 http 之前， 例如 `plugins: [batch({...}), http({...})]`。这跟 Vite/Rollup 这类插件系统里 "顺序敏感"
 * 是同一类约定，不是 bug。没装 batch 也完全可以单独用 http 插件， 只是会退化成每条日志各自发一次请求。
 *
 * 进程退出前的可靠性说明：不管走哪条路径（批量还是单条直发），这个插件的 sink 函数都会把发请求的 Promise **原样 return 出去**，而不是在内部
 * fire-and-forget 掉——这一点很关键，是配合核心那边 `#process()` 现在会 把 sink 返回的 Promise 纳入 flush()/shutdown()
 * 等待范围这个修复生效的 前提。如果 sink 内部自己 `.catch()` 了但不 return，核心根本不知道这个 sink 还有异步工作没完成，flush()
 * 会在请求真正发出去之前就"提前完工"， 进程一旦在这中间被杀掉，这条日志就真的丢了——这正是之前这里的 bug。
 */
class HttpPlugin implements ILoggerPlugin<
  IEmptyPluginExt,
  IHttpPluginConfig,
  IPipelineMode,
  {},
  Partial<IBatchShared>
> {
  readonly name = HTTP_PLUGIN_NAME
  readonly config: IHttpPluginConfig

  #resolvedConfig!: IHttpPluginConfig
  #controller: AbortController | undefined
  #scheduler!: ILifecycleScheduler

  constructor(config: IHttpPluginConfig) {
    if (
      config.retries !== undefined &&
      (!Number.isInteger(config.retries) || config.retries < 0 || !Number.isFinite(config.retries))
    )
      throw createLoggerError(LoggerErrorCode.invalidRetryCount, LoggerErrorText.invalidRetryCount)
    if (
      config.requestTimeoutMs !== undefined &&
      (!Number.isFinite(config.requestTimeoutMs) || config.requestTimeoutMs < 0)
    )
      throw createLoggerError(LoggerErrorCode.invalidOption, LoggerErrorText.invalidRequestTimeout)
    this.config = config
  }

  install(core: ILoggerPluginCore<IPipelineMode, Partial<IBatchShared>>): IEmptyPluginExt {
    // 不读 this.config——统一通过 core.config.get() 读取
    this.#resolvedConfig = core.config.get<IHttpPluginConfig>() ?? this.config
    this.#scheduler = core.scheduler
    this.#controller = typeof AbortController === 'function' ? new AbortController() : undefined
    core.onShutdown(() => this.#controller?.abort())

    const send = (entries: ILogEntry[]): Promise<void> => this.#send(entries)
    const createBatcher = core.getShared('createBatcher')

    if (createBatcher) {
      const batcher = createBatcher<ILogEntry>(this.#resolvedConfig.batch ?? {}, send)
      core.useSink((entry) => batcher.push(entry))
      // batch 插件自己已经通过 core.onFlush(flush) 注册了缓冲区的清空逻辑，
      // 这条路径的可靠退出保障由 batch 插件负责，这里不需要重复处理。
    } else {
      core.useSink((entry) => send([entry]))
    }

    return {}
  }

  async #send(entries: ILogEntry[]): Promise<void> {
    const retries = this.#resolvedConfig.retries ?? 2
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.#resolvedConfig.headers
    }
    if (this.#resolvedConfig.authToken)
      headers.Authorization = `Bearer ${this.#resolvedConfig.authToken}`

    let body: string
    try {
      body = JSON.stringify({ entries })
    } catch (err) {
      throw createLoggerError(
        LoggerErrorCode.serializeFailed,
        LoggerErrorText.httpSerializeFailed,
        {
          cause: err
        }
      )
    }
    const runtimeFetch = getLoggerRuntimeManager().fetch
    if (!runtimeFetch)
      throw createLoggerError(
        LoggerErrorCode.transportUnavailable,
        LoggerErrorText.httpTransportUnavailable
      )
    let lastErr: unknown
    /** Retains each cleanup error once so a later status retry cannot make it unobservable. */
    const cleanupErrorsSeen: unknown[] = []
    for (let attempt = 0; attempt <= retries; attempt++) {
      let requestError: unknown
      let requestFailed = false
      const cleanupErrors: unknown[] = []
      const requestController =
        typeof AbortController === 'function' ? new AbortController() : undefined
      const shutdownSignal = this.#controller?.signal
      const onShutdown = () => requestController?.abort()
      /**
       * Conservatively owns cleanup once a signal exists, because hostile addEventListener
       * implementations can retain the listener before throwing.
       */
      const listenerCleanupRequired = shutdownSignal !== undefined
      /** Prevents a throwing removeEventListener from causing a second cleanup attempt. */
      let listenerRemoved = false
      /** Prevents retry after request admission itself failed before any POST was committed. */
      let registrationFailed = false
      /** Prevents retry after timeout scheduler admission/callback failure before any POST. */
      let requestAdmissionFailed = false
      let timer: IScheduledTask | undefined
      /** Prevents a returned request-timeout task from being cancelled more than once. */
      let timerCancelAttempted = false
      /** Records an exception thrown by the timeout callback before schedule() returns. */
      let timerCallbackFailed = false
      let timerCallbackError: unknown
      let res: Awaited<ReturnType<NonNullable<typeof runtimeFetch>>> | undefined
      /** Aborts request state after partial listener registration and retains abort failures. */
      const abortRequestController = (reason?: unknown): void => {
        if (!requestController || requestController.signal.aborted) return
        try {
          requestController.abort(reason)
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      /** Aborts a fresh request controller when shutdown was already published without replay. */
      const rejectIfShutdownAborted = (): boolean => {
        if (!shutdownSignal?.aborted) return false
        const reason = shutdownSignal.reason
        requestController?.abort(reason)
        requestFailed = true
        requestError = reason
        return true
      }
      try {
        try {
          shutdownSignal?.addEventListener('abort', onShutdown, { once: true })
        } catch (error) {
          registrationFailed = true
          requestFailed = true
          requestError = error
          abortRequestController(error)
        }
        if (!registrationFailed && !rejectIfShutdownAborted()) {
          const timeout = this.#resolvedConfig.requestTimeoutMs ?? 10000
          if (requestController && !requestController.signal.aborted) {
            const onTimeout = (): void => {
              try {
                requestController.abort()
              } catch (error) {
                timerCallbackFailed = true
                timerCallbackError = error
              }
            }
            try {
              // Keep the returned handle even when a hostile scheduler fires onTimeout inline;
              // the scheduler may already have armed independent work that still needs cancel().
              timer = this.#scheduler.schedule(onTimeout, timeout)
              if (timerCallbackFailed) {
                requestAdmissionFailed = true
                requestFailed = true
                requestError = timerCallbackError
              }
            } catch (error) {
              requestAdmissionFailed = true
              requestFailed = true
              if (timerCallbackFailed) {
                requestError = timerCallbackError
                if (error !== timerCallbackError) cleanupErrors.push(error)
              } else {
                requestError = error
              }
            }
          }
          if (!requestFailed && !requestController?.signal.aborted && !rejectIfShutdownAborted()) {
            try {
              res = await runtimeFetch(this.#resolvedConfig.url, {
                method: 'POST',
                headers,
                body,
                signal: requestController?.signal ?? shutdownSignal
              })
            } catch (error) {
              requestFailed = true
              requestError = error
            }
          }
        }
      } catch (err) {
        requestFailed = true
        requestError = err
      } finally {
        if (timer && !timerCancelAttempted) {
          timerCancelAttempted = true
          try {
            timer.cancel()
          } catch (error) {
            cleanupErrors.push(error)
          }
        }
        if (listenerCleanupRequired && !listenerRemoved) {
          listenerRemoved = true
          try {
            shutdownSignal?.removeEventListener('abort', onShutdown)
          } catch (error) {
            cleanupErrors.push(error)
          }
        }
      }
      for (const error of cleanupErrors) {
        if (!cleanupErrorsSeen.includes(error)) cleanupErrorsSeen.push(error)
      }
      if (requestFailed) {
        lastErr = ensureHttpFailure(requestFailed, requestError, cleanupErrorsSeen)
        if (
          registrationFailed ||
          requestAdmissionFailed ||
          this.#controller?.signal.aborted ||
          attempt >= retries
        )
          break
        try {
          await this.#wait(this.#backoffDelay(attempt))
        } catch (error) {
          if (isHttpWaitPrimary(error)) throw error
          throw ensureHttpFailure(true, lastErr, [error])
        }
        continue
      }
      if (!res) {
        lastErr = ensureHttpFailure(
          false,
          undefined,
          cleanupErrorsSeen.length > 0
            ? cleanupErrorsSeen
            : [new Error(LoggerErrorText.httpTransportFailed)]
        )
        break
      }
      // A resolved response commits the POST. Cleanup belongs to the completed attempt and must
      // not participate in transport retry; only response status decides whether another POST is
      // allowed.
      if (res.ok) {
        if (cleanupErrorsSeen.length > 0)
          throw ensureHttpFailure(false, undefined, cleanupErrorsSeen)
        return
      }
      const responseError = createLoggerError(
        LoggerErrorCode.deliveryFailed,
        LoggerErrorText.httpDeliveryFailed(res.status)
      )
      lastErr =
        cleanupErrorsSeen.length > 0
          ? ensureHttpFailure(true, responseError, cleanupErrorsSeen)
          : responseError
      if (res.status !== 429 && res.status < 500) {
        break
      }
      const retryAfter = res.headers.get('Retry-After')
      const parsedRetryAfterMs = retryAfter ? Number(retryAfter) * 1000 : NaN
      const retryAfterMs = Number.isFinite(parsedRetryAfterMs)
        ? Math.max(0, parsedRetryAfterMs)
        : undefined
      if (attempt < retries && !this.#controller?.signal.aborted) {
        try {
          await this.#wait(retryAfterMs ?? this.#backoffDelay(attempt))
        } catch (error) {
          if (isHttpWaitPrimary(error)) throw error
          throw ensureHttpFailure(true, lastErr, [error])
        }
      }
    }
    throw ensureLoggerDeliveryError(lastErr)
  }

  #wait(delayMs: number): Promise<void> {
    const signal = this.#controller?.signal
    if (signal?.aborted) return Promise.resolve()
    return new Promise((resolve, reject) => {
      /** Task returned by scheduler, retained until the schedule return boundary settles. */
      let timer: IScheduledTask | undefined
      /** Whether the scheduler callback or abort path requested settlement. */
      let callbackFired = false
      /** Whether schedule() returned or failed, allowing cleanup to observe the task. */
      let scheduleSettled = false
      let settled = false
      /** Owns listener cleanup before registration can partially commit and throw. */
      const listenerCleanupRequired = signal !== undefined
      /** Prevents removeEventListener failure from causing a second removal attempt. */
      let listenerRemoved = false
      /** Delays abort settlement until registration throw can remain the primary error. */
      let listenerRegistrationComplete = false
      /** Records callback delivery that happened before addEventListener threw. */
      let abortObserved = false
      /** Preserves the first wait failure; cancellation/removal failures remain secondary. */
      let primaryError: unknown
      /** Prevents a synchronous callback and final cleanup from cancelling twice. */
      let cancelAttempted = false
      let onAbort: () => void
      const finish = (primary?: unknown, hasPrimary = false): void => {
        if (settled || !scheduleSettled || (!callbackFired && !hasPrimary && !primaryError)) return
        const cleanupErrors: unknown[] = []
        const scheduled = timer
        timer = undefined
        if (scheduled && !cancelAttempted) {
          cancelAttempted = true
          try {
            scheduled.cancel()
          } catch (error) {
            cleanupErrors.push(error)
          }
        }
        if (listenerCleanupRequired && !listenerRemoved) {
          listenerRemoved = true
          try {
            signal?.removeEventListener('abort', onAbort)
          } catch (error) {
            cleanupErrors.push(error)
          }
        }
        settled = true
        if (hasPrimary || primaryError !== undefined || cleanupErrors.length > 0) {
          const failure = ensureHttpFailure(
            hasPrimary || primaryError !== undefined,
            primary ?? primaryError,
            cleanupErrors
          )
          reject(hasPrimary || primaryError !== undefined ? markHttpWaitPrimary(failure) : failure)
          return
        }
        resolve()
      }
      onAbort = () => {
        abortObserved = true
        callbackFired = true
        if (listenerRegistrationComplete) finish()
      }
      try {
        signal?.addEventListener('abort', onAbort, { once: true })
        listenerRegistrationComplete = true
        if (settled || signal?.aborted || abortObserved) {
          callbackFired = true
          scheduleSettled = true
          finish()
          return
        }
        timer = this.#scheduler.schedule(() => {
          callbackFired = true
          finish()
        }, delayMs)
        scheduleSettled = true
      } catch (error) {
        primaryError = error
        listenerRegistrationComplete = true
        scheduleSettled = true
        finish(error, true)
      }
      finish()
    })
  }

  /** Keeps exponential retry delays finite for arbitrarily large valid retry counts. */
  #backoffDelay(attempt: number): number {
    return Math.min(Number.MAX_SAFE_INTEGER, 200 * 2 ** Math.min(attempt, 52))
  }
}

export const http = (
  config: IHttpPluginConfig
): ILoggerPlugin<IEmptyPluginExt, IHttpPluginConfig, IPipelineMode, {}, Partial<IBatchShared>> =>
  new HttpPlugin(config)
