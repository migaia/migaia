import type { IEmptyPluginExt, ILoggerPluginCore, ILoggerPlugin } from '../typing.js'
import { getLoggerRuntimeManager, type ILoggerProcess } from '../runtime-manager.js'
import {
  createLoggerAggregateError,
  createLoggerCleanupError,
  createLoggerError,
  LoggerErrorCode,
  tagLoggerError
} from '../errors.js'
import { LoggerErrorText } from '../error-text.js'
import { LoggerProcessReason } from '../plugin-constants.js'
import type { ILifecycleScheduler, IScheduledTask } from '@migaia/lifecycle'
import { getLoggerSchedulerDomain } from '../scheduler-domain.js'
import { observeLoggerReporterResult } from '../thenable.js'

export type IProcessPluginConfig = {
  /** 是否捕获 uncaughtException/unhandledRejection 并记为 fatal 日志，默认 true */
  captureCrashes?: boolean
  /** 优雅关闭最多等待 flush 完成的时间（毫秒），超时后强制退出，默认 3000 */
  shutdownTimeoutMs?: number
  /**
   * 是否劫持 process.exit()，让应用代码里任意位置调用 process.exit() 也会先等 flush。 默认关闭，因为这会把 process.exit()
   * 从"立即终止"变成"发起异步 flush 后才终止"， 如果你的代码依赖 process.exit() 同步阻断执行，开启前务必评估影响。
   */
  interceptProcessExit?: boolean
}

export const PROCESS_PLUGIN_NAME = 'process' as const

/**
 * 多个 Logger 实例都装了 process() 插件时，真正的 OS 信号监听器只应该注册一次， 否则会重复触发。这类"跨实例共享的运行时状态"用 `static #` 字段表达—— 真正的
 * ECMAScript 私有字段，运行时由引擎强制隔离，不是 TS 的 `private` 那种编译期约定、其实还能被外部代码用类型断言绕过去的"假私有"。
 */
class ProcessPlugin implements ILoggerPlugin<IEmptyPluginExt, IProcessPluginConfig> {
  /** Whether this runtime owns the process listener set. */
  static #installed = false
  /** Whether new process-plugin admission is blocked by runtime shutdown. */
  static #shuttingDown = false
  /** Shared runtime shutdown single-flight promise. */
  static #shutdownPromise: Promise<void> | undefined
  /** Shared runtime flush single-flight promise. */
  static #flushPromise: Promise<void> | undefined
  /** First installed process-plugin configuration. */
  static #config: Required<IProcessPluginConfig> | undefined
  /** Runtime process capability currently owned by this plugin. */
  static #runtimeProcess: ILoggerProcess | undefined
  /** Scheduler snapshot shared by every process-plugin timer in this runtime. */
  static #scheduler: ILifecycleScheduler | undefined
  /** Stable token identifying the scheduler source's time domain across snapshots. */
  static #schedulerDomain: object | undefined
  /** Exact exit function captured before interception so late callbacks cannot recurse. */
  static #originalExit: ILoggerProcess['exit'] | null = null
  /** Receiver captured with the original exit function so method semantics survive interception. */
  static #originalExitReceiver: ILoggerProcess | null = null
  static readonly #cores = new Set<ILoggerPluginCore>()
  static #listeners: Array<[string, (...args: any[]) => void]> = []

  readonly name = PROCESS_PLUGIN_NAME
  readonly config: IProcessPluginConfig

  constructor(config: IProcessPluginConfig) {
    this.config = config
  }

  install(core: ILoggerPluginCore): IEmptyPluginExt {
    if (ProcessPlugin.#shuttingDown)
      throw createLoggerError(
        LoggerErrorCode.runtimeShuttingDown,
        LoggerErrorText.processRuntimeShuttingDown
      )
    const runtimeProcess = getLoggerRuntimeManager().process
    if (!runtimeProcess) return {}
    if (ProcessPlugin.#installed && ProcessPlugin.#runtimeProcess !== runtimeProcess)
      throw createLoggerError(
        LoggerErrorCode.pluginConfigConflict,
        LoggerErrorText.processConfigConflict
      )
    ProcessPlugin.#runtimeProcess ??= runtimeProcess
    // 不读 this.config——统一通过 core.config.get() 读取
    const config = core.config.get<IProcessPluginConfig>() ?? {}

    ProcessPlugin.#installOnce(
      {
        captureCrashes: config.captureCrashes ?? true,
        shutdownTimeoutMs: config.shutdownTimeoutMs ?? 3000,
        interceptProcessExit: config.interceptProcessExit ?? false
      },
      core.scheduler
    )
    ProcessPlugin.#cores.add(core)
    core.onDispose(() => {
      ProcessPlugin.#cores.delete(core)
      if (ProcessPlugin.#cores.size === 0) ProcessPlugin.#disposeRuntime()
    })
    return {}
  }

  /** 只有第一次调用会真正生效；后续实例复用同一套监听器和配置。 */
  static #installOnce(
    config: Required<IProcessPluginConfig>,
    scheduler: ILifecycleScheduler
  ): void {
    if (ProcessPlugin.#installed) {
      const previous = ProcessPlugin.#config!
      const schedulerDomain = getLoggerSchedulerDomain(scheduler)
      if (
        JSON.stringify(previous) !== JSON.stringify(config) ||
        schedulerDomain !== ProcessPlugin.#schedulerDomain
      ) {
        throw createLoggerError(
          LoggerErrorCode.pluginConfigConflict,
          LoggerErrorText.processConfigConflict
        )
      }
      return
    }
    ProcessPlugin.#scheduler = scheduler
    ProcessPlugin.#schedulerDomain = getLoggerSchedulerDomain(scheduler)
    const onSigint = () =>
      void ProcessPlugin.#gracefulShutdown(LoggerProcessReason.signal, 0, config).catch((error) =>
        ProcessPlugin.#reportRuntimeFailure(error)
      )
    const onSigterm = () =>
      void ProcessPlugin.#gracefulShutdown(LoggerProcessReason.signal, 0, config).catch((error) =>
        ProcessPlugin.#reportRuntimeFailure(error)
      )
    const runtimeProcess = ProcessPlugin.#runtimeProcess!
    const listeners: Array<[string, (...args: any[]) => void]> = []
    try {
      listeners.push(['SIGINT', onSigint])
      runtimeProcess.on('SIGINT', onSigint)
      listeners.push(['SIGTERM', onSigterm])
      runtimeProcess.on('SIGTERM', onSigterm)

      const onBeforeExit = () => {
        // beforeExit 支持异步：事件循环即将自然耗尽时触发，此时 flush 是安全的，
        // 不需要我们自己调用 exit，进程会在异步任务完成后自然退出
        void ProcessPlugin.#flushAllWithTimeout(config.shutdownTimeoutMs).catch((error) =>
          ProcessPlugin.#reportRuntimeFailure(error)
        )
      }
      listeners.push(['beforeExit', onBeforeExit])
      runtimeProcess.on('beforeExit', onBeforeExit)

      const onUncaughtException = (err: Error) => {
        if (config.captureCrashes) {
          for (const c of ProcessPlugin.#cores)
            c.log('fatal', LoggerErrorText.processUncaughtException, err)
        }
        void ProcessPlugin.#gracefulShutdown(
          LoggerProcessReason.uncaughtException,
          1,
          config
        ).catch((error) => ProcessPlugin.#reportRuntimeFailure(error))
      }
      listeners.push(['uncaughtException', onUncaughtException])
      runtimeProcess.on('uncaughtException', onUncaughtException)

      const onUnhandledRejection = (reason: unknown) => {
        const err = reason instanceof Error ? reason : new Error(String(reason))
        if (config.captureCrashes) {
          for (const c of ProcessPlugin.#cores) {
            c.log('fatal', LoggerErrorText.processUnhandledRejection, err)
          }
        }
        void ProcessPlugin.#gracefulShutdown(
          LoggerProcessReason.unhandledRejection,
          1,
          config
        ).catch((error) => ProcessPlugin.#reportRuntimeFailure(error))
      }
      listeners.push(['unhandledRejection', onUnhandledRejection])
      runtimeProcess.on('unhandledRejection', onUnhandledRejection)

      if (config.interceptProcessExit) {
        const originalExit = runtimeProcess.exit
        const originalExitReceiver = runtimeProcess
        ProcessPlugin.#originalExit = originalExit
        ProcessPlugin.#originalExitReceiver = originalExitReceiver
        runtimeProcess.exit = ((code?: number) => {
          void (async () => {
            try {
              await ProcessPlugin.#flushAllWithTimeout(config.shutdownTimeoutMs)
            } catch (error) {
              const cleanupError = createLoggerAggregateError(
                LoggerErrorCode.pluginShutdownCleanupFailed,
                LoggerErrorText.pluginShutdownCleanupFailed,
                [error]
              )
              ProcessPlugin.#reportRuntimeFailure(cleanupError)
            }
            try {
              Reflect.apply(originalExit, originalExitReceiver, [code])
            } catch (error) {
              ProcessPlugin.#reportRuntimeFailure(
                createLoggerError(
                  LoggerErrorCode.pluginShutdownCleanupFailed,
                  LoggerErrorText.pluginShutdownCleanupFailed,
                  { cause: error }
                )
              )
            }
          })()
          return undefined as never
        }) as ILoggerProcess['exit']
      }
    } catch (error) {
      const rollbackErrors: unknown[] = []
      if (ProcessPlugin.#originalExit && ProcessPlugin.#originalExitReceiver) {
        try {
          ProcessPlugin.#originalExitReceiver.exit = ProcessPlugin.#originalExit
        } catch (restorationError) {
          rollbackErrors.push(restorationError)
        }
      }
      for (const [event, listener] of listeners.reverse()) {
        try {
          runtimeProcess.removeListener(event, listener)
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError)
        }
      }
      ProcessPlugin.#originalExit = null
      ProcessPlugin.#originalExitReceiver = null
      ProcessPlugin.#listeners = []
      ProcessPlugin.#installed = false
      ProcessPlugin.#config = undefined
      ProcessPlugin.#runtimeProcess = undefined
      ProcessPlugin.#scheduler = undefined
      ProcessPlugin.#schedulerDomain = undefined
      if (rollbackErrors.length > 0)
        throw createLoggerAggregateError(
          LoggerErrorCode.processInstallRollbackFailed,
          LoggerErrorText.processInstallRollbackFailed,
          [error, ...rollbackErrors]
        )
      throw error
    }
    ProcessPlugin.#listeners = listeners
    ProcessPlugin.#installed = true
    ProcessPlugin.#config = config
  }

  /** Completes every final uninstall cleanup step, then resets runtime state even after failures. */
  static #disposeRuntime(): void {
    const cleanupErrors: unknown[] = []
    const runtimeProcess = ProcessPlugin.#runtimeProcess
    const originalExit = ProcessPlugin.#originalExit
    const originalExitReceiver = ProcessPlugin.#originalExitReceiver
    try {
      if (originalExit && originalExitReceiver) {
        try {
          originalExitReceiver.exit = originalExit
        } catch (error) {
          cleanupErrors.push(
            error instanceof Error
              ? tagLoggerError(error, LoggerErrorCode.pluginUninstallCleanupFailed)
              : createLoggerError(
                  LoggerErrorCode.pluginUninstallCleanupFailed,
                  LoggerErrorText.pluginUninstallCleanupFailed,
                  { cause: error }
                )
          )
        }
      }
      if (runtimeProcess) {
        for (const [event, listener] of ProcessPlugin.#listeners) {
          try {
            runtimeProcess.removeListener(event, listener)
          } catch (error) {
            cleanupErrors.push(
              error instanceof Error
                ? tagLoggerError(error, LoggerErrorCode.pluginUninstallCleanupFailed)
                : createLoggerError(
                    LoggerErrorCode.pluginUninstallCleanupFailed,
                    LoggerErrorText.pluginUninstallCleanupFailed,
                    { cause: error }
                  )
            )
          }
        }
      }
    } finally {
      ProcessPlugin.#listeners = []
      ProcessPlugin.#installed = false
      ProcessPlugin.#shuttingDown = false
      ProcessPlugin.#shutdownPromise = undefined
      ProcessPlugin.#flushPromise = undefined
      ProcessPlugin.#config = undefined
      ProcessPlugin.#runtimeProcess = undefined
      ProcessPlugin.#scheduler = undefined
      ProcessPlugin.#schedulerDomain = undefined
      ProcessPlugin.#originalExit = null
      ProcessPlugin.#originalExitReceiver = null
    }
    if (cleanupErrors.length > 0)
      throw createLoggerCleanupError(
        LoggerErrorCode.pluginUninstallCleanupFailed,
        LoggerErrorText.pluginUninstallCleanupFailed,
        cleanupErrors
      )
  }

  static async #gracefulShutdown(
    reason: (typeof LoggerProcessReason)[keyof typeof LoggerProcessReason],
    exitCode: number,
    config: Required<IProcessPluginConfig>
  ): Promise<void> {
    if (ProcessPlugin.#shutdownPromise) return ProcessPlugin.#shutdownPromise
    ProcessPlugin.#shuttingDown = true
    const runtimeProcess = ProcessPlugin.#runtimeProcess!
    const scheduler = ProcessPlugin.#scheduler!
    const originalExit = ProcessPlugin.#originalExit
    const originalExitReceiver = ProcessPlugin.#originalExitReceiver
    const exit =
      originalExit && originalExitReceiver
        ? (code?: number) => Reflect.apply(originalExit, originalExitReceiver, [code])
        : (code?: number) => runtimeProcess.exit(code)
    ProcessPlugin.#shutdownPromise = (async () => {
      const failures: unknown[] = []
      let timer: IScheduledTask | undefined
      /** Ensures an independently armed shutdown task is cancelled once after callback return. */
      let timerCancelAttempted = false
      try {
        const shutdowns = Promise.all(
          [...ProcessPlugin.#cores].map(async (core) => {
            try {
              await core.shutdown(reason)
            } catch (error) {
              failures.push(error)
            }
          })
        )
        const timeout = new Promise<void>((resolve, reject) => {
          try {
            const scheduled = scheduler.schedule(() => {
              resolve()
            }, config.shutdownTimeoutMs)
            timer = scheduled
          } catch (error) {
            reject(error)
          }
        })
        try {
          await Promise.race([shutdowns, timeout])
        } catch (error) {
          failures.push(error)
        }
      } finally {
        if (timer && !timerCancelAttempted) {
          timerCancelAttempted = true
          const scheduled = timer
          timer = undefined
          try {
            scheduled.cancel()
          } catch (error) {
            failures.push(error)
          }
        }
      }
      try {
        exit(exitCode)
      } catch (error) {
        failures.push(error)
      }
      if (failures.length > 0)
        throw createLoggerCleanupError(
          LoggerErrorCode.pluginShutdownCleanupFailed,
          LoggerErrorText.pluginShutdownCleanupFailed,
          failures
        )
    })()
    return ProcessPlugin.#shutdownPromise
  }

  static async #flushAllWithTimeout(timeoutMs: number): Promise<void> {
    if (ProcessPlugin.#flushPromise) return ProcessPlugin.#flushPromise
    const scheduler = ProcessPlugin.#scheduler!
    let timer: IScheduledTask | undefined
    /** Ensures an independently armed flush task is cancelled once after callback return. */
    let timerCancelAttempted = false
    let hasPrimary = false
    let primary: unknown
    const cleanupErrors: unknown[] = []
    const flushes = Promise.all([...ProcessPlugin.#cores].map((core) => core.flush())).then(
      () => undefined
    )
    const timeout = new Promise<void>((resolve, reject) => {
      try {
        const scheduled = scheduler.schedule(() => {
          resolve()
        }, timeoutMs)
        timer = scheduled
      } catch (error) {
        reject(error)
      }
    })
    ProcessPlugin.#flushPromise = Promise.race([flushes, timeout])
    try {
      await ProcessPlugin.#flushPromise
    } catch (error) {
      hasPrimary = true
      primary = error
    } finally {
      if (timer && !timerCancelAttempted) {
        timerCancelAttempted = true
        const scheduled = timer
        timer = undefined
        try {
          scheduled.cancel()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      ProcessPlugin.#flushPromise = undefined
    }
    if (hasPrimary || cleanupErrors.length > 0)
      throw createLoggerCleanupError(
        LoggerErrorCode.pluginShutdownCleanupFailed,
        LoggerErrorText.pluginShutdownCleanupFailed,
        hasPrimary ? [primary, ...cleanupErrors] : cleanupErrors
      )
  }

  /** Emits process-runtime cleanup failures without creating a second unhandled rejection. */
  static #reportRuntimeFailure(error: unknown): void {
    try {
      const runtime = getLoggerRuntimeManager()
      const result = runtime.console ? runtime.console.error(error) : runtime.write(String(error))
      observeLoggerReporterResult(result)
    } catch {
      // Process runtime reporting is terminal containment.
    }
  }
}

export const process = (
  config: IProcessPluginConfig = {}
): ILoggerPlugin<IEmptyPluginExt, IProcessPluginConfig> => new ProcessPlugin(config)
