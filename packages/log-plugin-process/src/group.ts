import { LogLevel, defaultLogFailureReporter } from '@migaia/log-host'
import type { ILogPluginCore, IShutdownReason } from '@migaia/log-host/plugin'
import type { IScheduler } from '@migaia/utils/scheduler'
import { LogProcessErrorCode } from './error-code.ts'
import { LogProcessErrorText } from './error-text.ts'
import { processError, processCleanupError, tagProcessError } from './errors.ts'
import { ProcessEvent, ProcessReason } from './state-constants.ts'
import { ProcessWait } from './wait.ts'
import type { IProcessCapability, IProcessPolicy } from './typing.ts'

/** Shared state is keyed by the exact injected capability, never by a global singleton. */
export const processGroups = new Map<IProcessCapability, ProcessGroup>()

/** A process group owns one listener set and one compatible scheduler/policy domain. */
export class ProcessGroup {
  /** The borrowed process is the group's only identity key. */
  #process: IProcessCapability
  /** Members remain distinct host cores so one signal closes every shared user. */
  #cores = new Set<ILogPluginCore>()
  /** Fixed normalized policy fields must match for later same-process installations. */
  #policy: IProcessPolicy
  /** Host core snapshots preserve source identity for scheduler-domain compatibility. */
  #scheduler: IScheduler
  /** Original listener identities support exact rollback and final removal. */
  #listeners: Array<[string, (...args: unknown[]) => void]> = []
  /** Interception retains the original function until cleanup restores it. */
  #originalExit: IProcessCapability['exit'] | undefined
  /** Terminal admission prevents another host joining this group during shutdown. */
  #shuttingDown = false
  /** Repeated signals share the same complete graceful operation. */
  #shutdownPromise: Promise<void> | undefined
  /** Repeated beforeExit/intercept requests share the current bounded flush. */
  #flushPromise: Promise<void> | undefined

  /** Capture one process and policy before listener installation can have side effects. */
  constructor(process: IProcessCapability, policy: IProcessPolicy, scheduler: IScheduler) {
    this.#process = process
    this.#policy = policy
    this.#scheduler = scheduler
  }

  /** Stable callbacks are owned by this group and retain their exact installed identities. */
  readonly #sigint = (): void => this.#signal()
  /** SIGTERM has its own listener identity but shares the same shutdown operation. */
  readonly #sigterm = (): void => this.#signal()
  /** Natural loop exhaustion flushes without invoking exit. */
  readonly #beforeExit = (): void => this.#flushBeforeExit()
  /** Crash payloads remain ordinary original values until fatal entry admission. */
  readonly #uncaught = (...args: unknown[]): void => this.#crash(args[0], false)
  /** Rejection payloads are normalized only by the preserved rejection-event behavior. */
  readonly #rejection = (...args: unknown[]): void => this.#crash(args[0], true)
  /**
   * The intercepted exit is allocated with this owner rather than assigned as a new function
   * literal.
   */
  readonly #interceptedExit = (code?: number): void => {
    void this.#exitAfterFlush(code)
  }
  /** Completion clears only the in-progress flush reference, allowing a future beforeExit cycle. */
  readonly #finishFlush = (): void => {
    this.#flushPromise = undefined
  }

  /** Install all listeners transactionally and attempt every rollback if any step fails. */
  initialize(): void {
    try {
      for (const [event, listener] of [
        [ProcessEvent.sigint, this.#sigint],
        [ProcessEvent.sigterm, this.#sigterm],
        [ProcessEvent.beforeExit, this.#beforeExit],
        [ProcessEvent.uncaughtException, this.#uncaught],
        [ProcessEvent.unhandledRejection, this.#rejection]
      ] as const) {
        // The five event names above are a compile-time bound, independent of member count.
        this.#listeners.push([event, listener])
        this.#process.on(event, listener)
      }
      if (this.#policy.interceptProcessExit) {
        this.#originalExit = this.#process.exit
        this.#process.exit = this.#interceptedExit
      }
    } catch (primary) {
      /** Rollback failures follow the installation primary in observed cleanup order. */
      const rollback: unknown[] = []
      if (this.#originalExit) {
        try {
          this.#process.exit = this.#originalExit
        } catch (error) {
          rollback.push(error)
        }
      }
      for (let index = this.#listeners.length - 1; index >= 0; index--) {
        /** The original listener tuple is retained even after a partially successful on call. */
        const [event, listener] = this.#listeners[index]
        try {
          this.#process.removeListener(event, listener)
        } catch (error) {
          rollback.push(error)
        }
      }
      this.#listeners = []
      this.#originalExit = undefined
      if (rollback.length)
        throw tagProcessError(
          new AggregateError([primary, ...rollback], LogProcessErrorText.installRollbackFailed),
          LogProcessErrorCode.processInstallRollbackFailed
        )
      throw primary
    }
  }

  /** Admit another member only when this exact process has the same policy and scheduler domain. */
  add(core: ILogPluginCore, policy: IProcessPolicy): void {
    if (this.#shuttingDown)
      throw processError(
        LogProcessErrorCode.runtimeShuttingDown,
        LogProcessErrorText.runtimeShuttingDown
      )
    if (
      policy.captureCrashes !== this.#policy.captureCrashes ||
      policy.shutdownTimeoutMs !== this.#policy.shutdownTimeoutMs ||
      policy.interceptProcessExit !== this.#policy.interceptProcessExit ||
      core.scheduler !== this.#scheduler
    )
      throw processError(
        LogProcessErrorCode.pluginConfigConflict,
        LogProcessErrorText.configConflict
      )
    this.#cores.add(core)
  }

  /** Only the final member releases listeners; repeated cleanup remains idempotent. */
  remove(core: ILogPluginCore): void {
    if (this.#cores.delete(core) && this.#cores.size === 0) this.#release()
  }

  /** Signals never throw into the host event emitter. */
  #signal(): void {
    void this.#shutdown(ProcessReason.signal, 0).catch(defaultLogFailureReporter)
  }

  /** BeforeExit does not force process termination and contains its own reporting failures. */
  #flushBeforeExit(): void {
    void this.#flush().catch(defaultLogFailureReporter)
  }

  /** Capture crashes before requesting the single shared error-code shutdown. */
  #crash(reason: unknown, rejection: boolean): void {
    /** Primitive rejection values keep their original string conversion behavior. */
    const error =
      reason instanceof Error || !rejection
        ? reason
        : new Error(LogProcessErrorText.rejectionReason(reason))
    if (this.#policy.captureCrashes)
      for (const core of this.#cores)
        core.log(
          LogLevel.fatal,
          rejection
            ? LogProcessErrorText.unhandledRejection
            : LogProcessErrorText.uncaughtException,
          error
        )
    void this.#shutdown(
      rejection ? ProcessReason.unhandledRejection : ProcessReason.uncaughtException,
      1
    ).catch(defaultLogFailureReporter)
  }

  /** Publish one terminal Promise before any member starts its asynchronous handlers. */
  #shutdown(reason: IShutdownReason, code: number): Promise<void> {
    if (this.#shutdownPromise) return this.#shutdownPromise
    this.#shuttingDown = true
    this.#shutdownPromise = this.#runShutdown(reason, code)
    return this.#shutdownPromise
  }

  /** Bound graceful member shutdown, then invoke the exit captured before member disposal. */
  async #runShutdown(reason: IShutdownReason, code: number): Promise<void> {
    /** Member cleanup may restore/reset group state; this original exit must survive it unchanged. */
    const exit = this.#originalExit ?? this.#process.exit
    /** Failure order is shutdown work, timer cancellation, then exit. */
    const errors: unknown[] = []
    /** Every member is snapshotted before shutdown can remove cores from the live group. */
    const shutdowns: Promise<void>[] = []
    for (const core of this.#cores) shutdowns.push(this.#shutdownCore(core, reason, errors))
    /** A separate returned task always remains cancellable after a synchronous callback. */
    const wait = new ProcessWait(this.#scheduler, this.#policy.shutdownTimeoutMs)
    try {
      await Promise.race([Promise.all(shutdowns), wait.promise])
    } catch (error) {
      errors.push(error)
    }
    try {
      wait.cancel()
    } catch (error) {
      errors.push(error)
    }
    try {
      Reflect.apply(exit, this.#process, [code])
    } catch (error) {
      errors.push(error)
    }
    if (errors.length)
      throw processCleanupError(
        LogProcessErrorCode.pluginShutdownCleanupFailed,
        LogProcessErrorText.shutdownCleanupFailed,
        errors
      )
  }

  /** Preserve a member's rejection without allowing it to prevent another member's shutdown. */
  async #shutdownCore(
    core: ILogPluginCore,
    reason: IShutdownReason,
    errors: unknown[]
  ): Promise<void> {
    try {
      await core.shutdown(reason)
    } catch (error) {
      errors.push(error)
    }
  }

  /** Current flush calls share one Promise and clear it only after ordered cleanup finishes. */
  #flush(): Promise<void> {
    this.#flushPromise ??= this.#runFlush().finally(this.#finishFlush)
    return this.#flushPromise
  }

  /** Bound all current member flushes with the existing graceful timeout and cleanup semantics. */
  async #runFlush(): Promise<void> {
    /** Snapshot member operations before any of them can affect group membership. */
    const flushes: Promise<void>[] = []
    for (const core of this.#cores) flushes.push(core.flush())
    /** The timer is independent from the host's own flush deadline. */
    const wait = new ProcessWait(this.#scheduler, this.#policy.shutdownTimeoutMs)
    /** A wait primary must remain before cancellation failure on the resulting cause chain. */
    const errors: unknown[] = []
    try {
      await Promise.race([Promise.all(flushes), wait.promise])
    } catch (error) {
      errors.push(error)
    }
    try {
      wait.cancel()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length)
      throw processCleanupError(
        LogProcessErrorCode.pluginShutdownCleanupFailed,
        LogProcessErrorText.shutdownCleanupFailed,
        errors
      )
  }

  /** Intercepted application exit preserves the original function and receiver across its flush. */
  async #exitAfterFlush(code?: number): Promise<void> {
    /** Keep the exact original before a flusher can trigger member removal. */
    const exit = this.#originalExit!
    try {
      await this.#flush()
    } catch (error) {
      defaultLogFailureReporter(
        tagProcessError(
          new AggregateError([error], LogProcessErrorText.shutdownCleanupFailed),
          LogProcessErrorCode.pluginShutdownCleanupFailed
        )
      )
    }
    try {
      Reflect.apply(exit, this.#process, [code])
    } catch (error) {
      defaultLogFailureReporter(
        processError(
          LogProcessErrorCode.pluginShutdownCleanupFailed,
          LogProcessErrorText.shutdownCleanupFailed,
          error
        )
      )
    }
  }

  /** Attempt every final cleanup even when exit restoration or one listener removal fails. */
  #release(): void {
    /** Tagged cleanup failures preserve native types and original order. */
    const errors: unknown[] = []
    try {
      if (this.#originalExit) {
        try {
          this.#process.exit = this.#originalExit
        } catch (error) {
          errors.push(this.#uninstallError(error))
        }
      }
      for (const [event, listener] of this.#listeners) {
        try {
          this.#process.removeListener(event, listener)
        } catch (error) {
          errors.push(this.#uninstallError(error))
        }
      }
    } finally {
      processGroups.delete(this.#process)
      this.#listeners = []
      this.#originalExit = undefined
    }
    if (errors.length)
      throw processCleanupError(
        LogProcessErrorCode.pluginUninstallCleanupFailed,
        LogProcessErrorText.uninstallCleanupFailed,
        errors
      )
  }

  /**
   * Native cleanup errors keep their identity when attachable; primitives remain reachable on
   * cause.
   */
  #uninstallError(error: unknown): Error {
    return error instanceof Error
      ? tagProcessError(error, LogProcessErrorCode.pluginUninstallCleanupFailed)
      : processError(
          LogProcessErrorCode.pluginUninstallCleanupFailed,
          LogProcessErrorText.uninstallCleanupFailed,
          error
        )
  }
}
