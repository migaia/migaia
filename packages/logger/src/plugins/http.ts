import type { IEmptyPluginExt, ILogEntry, ILoggerPluginCore, ILoggerPlugin } from '../typing.js'
import { createBatcherForCore, type IBatchController, type IBatchShared } from './batch.js'
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
  batch?: {
    maxSize?: number
    maxWaitMs?: number
    maxConcurrentBatches?: number
    maxPendingBatches?: number
    asyncOutput?: boolean
  }
  /** Maximum valid Retry-After delay; valid excess is clamped. Defaults to 30000ms. */
  maxRetryAfterMs?: number
}

export const HTTP_PLUGIN_NAME = 'http' as const

/** Marks scheduler/listener admission failures that must outrank an earlier transport failure. */
const HTTP_WAIT_PRIMARY = Symbol('logger.http.wait.primary')

/** Abbreviated weekdays accepted by IMF-fixdate and asctime-date. */
const HTTP_DATE_SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Full weekdays accepted only by the obsolete RFC 850 HTTP-date form. */
const HTTP_DATE_LONG_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
] as const

/** Three-letter months shared by every HTTP-date grammar variant. */
const HTTP_DATE_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
] as const

type IHttpDateParts = {
  readonly day: number
  readonly month: number
  readonly year: number
  readonly hour: number
  readonly minute: number
  readonly second: number
  readonly weekday: number
}

/** Turns a strict four-digit or obsolete two-digit HTTP year into a calendar year. */
function resolveHttpDateYear(value: string, nowYear: number): number {
  if (value.length === 4) return Number(value)
  const centuryYear = Math.floor(nowYear / 100) * 100 + Number(value)
  return centuryYear > nowYear + 50 ? centuryYear - 100 : centuryYear
}

/** Validates a parsed HTTP-date calendar tuple without relying on permissive Date.parse rules. */
function toHttpDateTimestamp(parts: IHttpDateParts): number | undefined {
  if (parts.year < 1 || parts.day < 1 || parts.hour > 23 || parts.minute > 59 || parts.second > 59)
    return undefined
  /** Date instance whose UTC fields are checked after the calendar tuple is materialized. */
  const date = new Date(0)
  date.setUTCFullYear(parts.year, parts.month, parts.day)
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0)
  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month ||
    date.getUTCDate() !== parts.day ||
    date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute ||
    date.getUTCSeconds() !== parts.second ||
    date.getUTCDay() !== parts.weekday
  )
    return undefined
  return date.getTime()
}

/** Parses one strict HTTP-date grammar variant without accepting Date.parse extensions. */
function parseHttpDate(value: string): number | undefined {
  /** Current UTC year used only for RFC 850 two-digit-year interpretation. */
  const nowYear = new Date(Date.now()).getUTCFullYear()
  const shortWeekday = HTTP_DATE_SHORT_WEEKDAYS.join('|')
  const longWeekday = HTTP_DATE_LONG_WEEKDAYS.join('|')
  const month = HTTP_DATE_MONTHS.join('|')
  const imf = new RegExp(
    `^(${shortWeekday}), ([0-3][0-9]) (${month}) ([0-9]{4}) ([0-2][0-9]):([0-5][0-9]):([0-5][0-9]) GMT$`
  ).exec(value)
  if (imf) {
    return toHttpDateTimestamp({
      weekday: HTTP_DATE_SHORT_WEEKDAYS.indexOf(
        imf[1] as (typeof HTTP_DATE_SHORT_WEEKDAYS)[number]
      ),
      day: Number(imf[2]),
      month: HTTP_DATE_MONTHS.indexOf(imf[3] as (typeof HTTP_DATE_MONTHS)[number]),
      year: Number(imf[4]),
      hour: Number(imf[5]),
      minute: Number(imf[6]),
      second: Number(imf[7])
    })
  }
  const rfc850 = new RegExp(
    `^(${longWeekday}), ([0-3][0-9])-(${month})-([0-9]{2}) ([0-2][0-9]):([0-5][0-9]):([0-5][0-9]) GMT$`
  ).exec(value)
  if (rfc850) {
    return toHttpDateTimestamp({
      weekday: HTTP_DATE_LONG_WEEKDAYS.indexOf(
        rfc850[1] as (typeof HTTP_DATE_LONG_WEEKDAYS)[number]
      ),
      day: Number(rfc850[2]),
      month: HTTP_DATE_MONTHS.indexOf(rfc850[3] as (typeof HTTP_DATE_MONTHS)[number]),
      year: resolveHttpDateYear(rfc850[4], nowYear),
      hour: Number(rfc850[5]),
      minute: Number(rfc850[6]),
      second: Number(rfc850[7])
    })
  }
  const asctime = new RegExp(
    `^(${shortWeekday}) (${month}) ((?: [1-9])|(?:[0-3][0-9])) ([0-2][0-9]):([0-5][0-9]):([0-5][0-9]) ([0-9]{4})$`
  ).exec(value)
  if (!asctime) return undefined
  return toHttpDateTimestamp({
    weekday: HTTP_DATE_SHORT_WEEKDAYS.indexOf(
      asctime[1] as (typeof HTTP_DATE_SHORT_WEEKDAYS)[number]
    ),
    day: Number(asctime[3].trim()),
    month: HTTP_DATE_MONTHS.indexOf(asctime[2] as (typeof HTTP_DATE_MONTHS)[number]),
    year: Number(asctime[7]),
    hour: Number(asctime[4]),
    minute: Number(asctime[5]),
    second: Number(asctime[6])
  })
}

/** Parses one strict Retry-After value and clamps valid delays to the admitted bound. */
function parseRetryAfter(value: string | null, maxDelayMs: number): number | undefined {
  if (!value) return undefined
  if (/^[0-9]+$/.test(value)) {
    const seconds = Number(value)
    if (Number.isFinite(seconds)) return Math.min(maxDelayMs, seconds * 1000)
    return maxDelayMs
  }
  const timestamp = parseHttpDate(value)
  if (timestamp !== undefined) return Math.min(maxDelayMs, Math.max(0, timestamp - Date.now()))
  return undefined
}

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
    if (
      config.maxRetryAfterMs !== undefined &&
      (!Number.isFinite(config.maxRetryAfterMs) || config.maxRetryAfterMs < 0)
    )
      throw createLoggerError(LoggerErrorCode.invalidOption, LoggerErrorText.invalidOption)
    this.config = config
  }

  /** Creates a request/shutdown controller through the Logger runtime owner when available. */
  #createAbortController(): AbortController | undefined {
    const factory = getLoggerRuntimeManager().createAbortController
    if (factory) return factory()
    return typeof AbortController === 'function' ? new AbortController() : undefined
  }

  install(core: ILoggerPluginCore<IPipelineMode, Partial<IBatchShared>>): IEmptyPluginExt {
    // 不读 this.config——统一通过 core.config.get() 读取
    this.#resolvedConfig = core.config.get<IHttpPluginConfig>() ?? this.config
    this.#scheduler = core.scheduler
    this.#controller = this.#createAbortController()
    core.onDispose(core.onShutdown(() => this.#controller?.abort()))

    const send = (entries: ILogEntry[]): Promise<void> => this.#send(entries)
    const createBatcher = core.getShared('createBatcher')

    if (createBatcher) {
      const batcher = createBatcher<ILogEntry>(this.#resolvedConfig.batch ?? {}, send)
      core.onDispose(core.useSink((entry) => batcher.push(entry)))
      // batch 插件自己已经通过 core.onFlush(flush) 注册了缓冲区的清空逻辑，
      // 这条路径的可靠退出保障由 batch 插件负责，这里不需要重复处理。
    } else if (this.#resolvedConfig.batch) {
      const batcher = createBatcherForCore(
        core,
        {},
        { ...this.#resolvedConfig.batch, maxSize: 1, asyncOutput: false },
        send
      ) as IBatchController<ILogEntry>
      core.onDispose(() => {
        const cleanupErrors = batcher.dispose()
        if (cleanupErrors instanceof Promise)
          return cleanupErrors.then((errors) => {
            if (errors.length > 0) throw errors[0]
          })
        if (cleanupErrors.length > 0) throw cleanupErrors[0]
      })
      core.onDispose(core.useSink((entry) => batcher.push(entry)))
    } else {
      // Preserve the direct sink's native failure identity when no batch policy was requested.
      core.onDispose(core.useSink((entry) => send([entry])))
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
    /** Remembers a terminal shutdown callback even when a hostile signal does not expose replay. */
    let shutdownObserved = false
    for (let attempt = 0; attempt <= retries; attempt++) {
      // A late shutdown signal may not replay abort to a newly-created listener. Once the
      // first attempt observed that terminal signal, do not allocate another request controller
      // or reopen transport work for a retry.
      if (attempt > 0 && this.#controller?.signal.aborted) break
      let requestError: unknown
      let requestFailed = false
      const cleanupErrors: unknown[] = []
      const requestController = this.#createAbortController()
      const shutdownSignal = this.#controller?.signal
      const onShutdown = (): void => {
        shutdownObserved = true
        requestController?.abort()
      }
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
          shutdownObserved ||
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
      const maxRetryAfterMs = this.#resolvedConfig.maxRetryAfterMs ?? 30000
      const retryAfterMs = parseRetryAfter(retryAfter, maxRetryAfterMs)
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
