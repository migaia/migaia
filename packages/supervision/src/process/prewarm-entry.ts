/** Owns one prewarmed launch, output handoff and exit-ordered resource release. */
import { PROCESS_KIND, SAMPLE_USAGE_MISSING } from './text.ts'
import {
  boundedWait,
  createAbortController,
  createLifecycleScope,
  LifecycleErrorPolicy
} from '@migaia/lifecycle'
import type { IScheduler, IScheduledTask, IWallClock } from '@migaia/utils/scheduler'
import {
  CapabilityLevel,
  ExitReason,
  LaunchPhase,
  TerminationMode,
  type IUnitRuntime
} from '../index.ts'
import { SupervisionErrorCode } from '../error-code.ts'
import { SupervisionErrorText } from '../error-text.ts'
import { createSupervisionError } from '../errors.ts'
import { DrainedStream, ProcessCapability } from './constants.ts'
import { deliverOutput } from './output-tail.ts'
import { PrewarmOutput } from './prewarm-output.ts'
import type {
  IPrewarmEntry,
  IPrewarmPoolOptions,
  IProcessHandle,
  IProcessExitStatus,
  IProcessLaunchContext,
  IProcessRecord
} from './types.ts'
import { startUsageMonitor } from './usage-monitor.ts'

/** Immutable pool policy shared by entries without allocating per-entry adapters. */
export type IPrewarmContext<THandle extends IProcessHandle> = {
  readonly options: IPrewarmPoolOptions<THandle>
  readonly scheduler: IScheduler
  readonly wallClock: IWallClock
  readonly startupTimeoutMs: number
  readonly idleTimeoutMs: number
  readonly exitTimeoutMs: number
  readonly reapTimeoutMs: number
}

/** Pool membership and join ownership stay with the pool, not individual units. */
export type IPrewarmEntryOwner<THandle extends IProcessHandle> = {
  readonly closed: boolean
  remove(entry: PrewarmEntry<THandle>): void
  admit(entry: PrewarmEntry<THandle>): void
  track(task: Promise<void>): void
}

/** Builds the existing prewarm diagnostic without exposing output or bootstrap payload. */
function failure(
  code: (typeof SupervisionErrorCode)[keyof typeof SupervisionErrorCode],
  text: string,
  cause?: unknown,
  detail: Readonly<Record<string, unknown>> = {}
): Error {
  return createSupervisionError(Error, code, text, {
    cause,
    detail: { kind: PROCESS_KIND, prewarm: true, ...detail }
  })
}

/** One entry retains the lease until actual exit, even after startup/reap deadlines. */
export class PrewarmEntry<THandle extends IProcessHandle> {
  /** Shared construction policy and unchanged report/scheduler ports. */
  #context: IPrewarmContext<THandle>
  /** Pool owns entry membership and disposal joins. */
  #owner: IPrewarmEntryOwner<THandle>
  /** Lease is transferred on take and otherwise released only after actual exit. */
  #lease: IPrewarmEntry<THandle>['lease']
  /** Cancellation remains independent from the entry's exit-owned cleanup scope. */
  #controller = createAbortController()
  /** Lease, monitor and record cleanup use the existing lifecycle ordering. */
  #scope: ReturnType<typeof createLifecycleScope>
  /** Timers and sampling are detached before a taken unit changes owner. */
  #monitors: ReturnType<typeof createLifecycleScope>
  /** Idle output is retained until the supervisor installs its output sink. */
  #output = new PrewarmOutput()
  /** Actual launcher result, including one that arrives after a deadline. */
  #handle?: THandle
  /** Original launch Promise is observed by startup and lease teardown. */
  #launch?: Promise<THandle>
  /** Durable record remains attached until actual exit or transfer. */
  #record?: IProcessRecord
  /** Idle deadline is canceled at take or retirement. */
  #timer?: IScheduledTask
  /** A handed-off entry no longer responds to its idle exit observer. */
  #taken = false
  /** Retirement is idempotent before any cancellation or disposal callback. */
  #retired = false
  /** Live sink is installed only after buffered output has been replayed. */
  #sink?: IProcessLaunchContext['output']

  /** Registers the same resources in the same order as the baseline entry. */
  constructor(
    context: IPrewarmContext<THandle>,
    owner: IPrewarmEntryOwner<THandle>,
    lease: IPrewarmEntry<THandle>['lease']
  ) {
    this.#context = context
    this.#owner = owner
    this.#lease = lease
    this.#scope = createLifecycleScope({
      errorPolicy: LifecycleErrorPolicy.report,
      report: context.options.report,
      scheduler: context.scheduler
    })
    this.#monitors = createLifecycleScope({
      errorPolicy: LifecycleErrorPolicy.report,
      report: context.options.report,
      scheduler: context.scheduler
    })
    this.#scope.own(lease, { force: () => this.#releaseLease() })
    this.#scope.own(this.#monitors, { force: () => this.#monitors.dispose().then(ignoreResult) })
  }

  /** Record provenance is read only when the pool transfers this entry. */
  get record(): IProcessRecord | undefined {
    return this.#record
  }

  /** Starts the existing Promise stage and immediately observes its bounded deadline. */
  start(): void {
    this.#launch = Promise.resolve().then(() => this.#launchUnit())
    void this.#observeLaunch(this.#launch)
  }

  /** Supplies the original cancellation signal and an entry-owned output receiver. */
  #launchUnit(): Promise<THandle> {
    return this.#context.options.launcher.launch(this.#context.options.spec, {
      signal: this.#controller.signal,
      output: (stream, chunk) => this.#receiveOutput(stream, chunk)
    })
  }

  /** Retired output is ignored; attached output is delivered without buffering. */
  #receiveOutput(stream: DrainedStream, chunk: Uint8Array): void {
    if (this.#retired) return
    if (this.#sink) deliverOutput(this.#sink, stream, chunk, this.#context.options.report)
    else this.#output.append(stream, chunk)
  }

  /** Joins launch, registry attachment and idle monitoring without new Promise stages. */
  async #observeLaunch(launch: Promise<THandle>): Promise<void> {
    const { options, scheduler, startupTimeoutMs, idleTimeoutMs } = this.#context
    try {
      if (!(await boundedWait(launch, scheduler.now() + startupTimeoutMs, { scheduler }))) {
        options.report(
          failure(SupervisionErrorCode.startupTimeout, SupervisionErrorText.startupTimeout)
        )
        await this.retire(true)
        return
      }
      /** Startup and teardown continue to share this exact handle. */
      const handle = await launch
      this.#handle = handle
      if (this.#owner.closed || this.#retired) {
        await this.retire(true)
        return
      }
      this.#validateSampling(handle)
      if (options.registry) {
        /** Construct and attach around the original single registry await. */
        const record = this.#createRecord(handle)
        await options.registry.port.add(record)
        this.#record = record
        this.#scope.own(record, { force: () => this.#removeRecordAfterExit(handle, record) })
      }
      this.#owner.admit(this)
      /** The idle unit shares its original scopes and startup cancellation signal. */
      const unit: IUnitRuntime = {
        generation: 0,
        scope: this.#scope,
        monitors: this.#monitors,
        signal: this.#controller.signal
      }
      startUsageMonitor(
        handle,
        options.spec.limits,
        options.launcher.capabilities,
        unit,
        scheduler,
        options.usage?.intervalMs ?? 1_000,
        options.usage?.failureThreshold ?? 3,
        (reason, detail, cause) => this.#usageFailed(reason, detail, cause),
        options.report
      )
      this.#timer = scheduler.schedule(() => {
        void this.retire()
      }, idleTimeoutMs)
      this.#timer.unref?.()
      this.#monitors.own(this.#timer, { force: () => this.#timer?.cancel() })
      void handle.exited.then((status) => this.#exited(status), options.report)
    } catch (error) {
      if (!this.#retired)
        options.report(
          failure(SupervisionErrorCode.launchFailed, SupervisionErrorText.launchFailed, error)
        )
      await this.retire(true)
    }
  }

  /** Rejects monitored limits whose adapter cannot supply native usage samples. */
  #validateSampling(handle: THandle): void {
    const { options } = this.#context
    if (
      typeof handle.sampleUsage !== 'function' &&
      ((options.spec.limits?.memoryBytes !== undefined &&
        options.launcher.capabilities[ProcessCapability.memoryLimit] ===
          CapabilityLevel.monitored) ||
        (options.spec.limits?.cpuTimeMs !== undefined &&
          options.launcher.capabilities[ProcessCapability.cpuTimeLimit] ===
            CapabilityLevel.monitored))
    )
      throw createSupervisionError(
        Error,
        SupervisionErrorCode.capabilityUnsupported,
        SupervisionErrorText.capabilityUnsupported,
        { detail: { kind: PROCESS_KIND, reason: SAMPLE_USAGE_MISSING } }
      )
  }

  /** Creates the durable record without adding a Promise stage before idle admission. */
  #createRecord(handle: THandle): IProcessRecord {
    const { options, wallClock } = this.#context
    /** The record identity is preserved through prewarm handoff. */
    const record: IProcessRecord = {
      id: `${options.id}/${handle.identity.fingerprint}`,
      namespace: options.registry!.namespace,
      identity: handle.identity,
      launchedAt: wallClock.timestamp()
    }
    return record
  }

  /** A reap deadline never deletes the record before the corresponding actual exit. */
  async #removeRecordAfterExit(handle: THandle, record: IProcessRecord): Promise<void> {
    const { options, scheduler, reapTimeoutMs } = this.#context
    try {
      if (await boundedWait(handle.exited, scheduler.now() + reapTimeoutMs, { scheduler }))
        await options.registry!.port.remove(record.id)
      else void handle.exited.then(() => this.#removeRecord(record.id), options.report)
    } catch (error) {
      options.report(error)
    }
  }

  /** Late record removal keeps the existing passive report policy. */
  #removeRecord(id: string): Promise<void> | undefined {
    return this.#context.options.registry?.port.remove(id).catch(this.#context.options.report)
  }

  /** Usage failure is reported before force-retiring the idle entry. */
  #usageFailed(
    reason: typeof ExitReason.unhealthy | typeof ExitReason.resourceViolation,
    detail: Readonly<Record<string, unknown>>,
    cause?: unknown
  ): void {
    this.#context.options.report(
      failure(
        reason === ExitReason.unhealthy
          ? SupervisionErrorCode.unhealthy
          : SupervisionErrorCode.resourceLimitExceeded,
        reason === ExitReason.unhealthy
          ? SupervisionErrorText.unhealthy
          : SupervisionErrorText.resourceLimitExceeded,
        cause,
        detail
      )
    )
    void this.retire(true)
  }

  /** Idle exit does not refill the pool; transferred/retired entries ignore this observer. */
  #exited(status: IProcessExitStatus): void {
    if (this.#taken || this.#retired) return
    if (status.code !== 0 || status.signal !== null)
      this.#context.options.report(
        failure(
          SupervisionErrorCode.exitUnexpected,
          SupervisionErrorText.exitUnexpected,
          undefined,
          { code: status.code, signal: status.signal }
        )
      )
    void this.retire(true)
  }

  /** Ends an idle entry; record and lease cleanup continue to wait for actual exit. */
  retire(force = false): Promise<void> {
    if (this.#retired) return Promise.resolve()
    this.#retired = true
    this.#owner.remove(this)
    this.#controller.abort()
    this.#timer?.cancel()
    /** Capture the handle present at retirement, as in the original descriptor. */
    const handle = this.#handle
    if (handle)
      this.#scope.own(handle, {
        ...(force
          ? {}
          : {
              graceful: () => this.#graceful(handle),
              gracefulTimeoutMs: this.#context.exitTimeoutMs
            }),
        force: () => this.#force(handle)
      })
    /** The original scope join remains the task tracked by pool disposal. */
    const task = this.#scope.dispose().then(ignoreResult)
    this.#owner.track(task)
    return task
  }

  /** Requests graceful exit and joins the adapter's original exited Promise. */
  #graceful(handle: THandle): Promise<void> {
    handle.terminate(TerminationMode.graceful)
    return handle.exited.then(ignoreResult)
  }

  /** Force termination reports cleanup failures without replacing earlier launch errors. */
  async #force(handle: THandle): Promise<void> {
    const { options, scheduler, reapTimeoutMs } = this.#context
    try {
      handle.terminate(TerminationMode.force)
    } catch (error) {
      options.report(error)
    }
    try {
      if (!(await boundedWait(handle.exited, scheduler.now() + reapTimeoutMs, { scheduler })))
        options.report(failure(SupervisionErrorCode.reapTimeout, SupervisionErrorText.reapTimeout))
    } catch (error) {
      options.report(error)
    }
  }

  /** Lease cleanup follows late launch and late exit without declaring either exited early. */
  async #releaseLease(): Promise<void> {
    const { options, scheduler, reapTimeoutMs } = this.#context
    /** Teardown may discover a handle after startup has already timed out. */
    let handle = this.#handle
    if (!handle && this.#launch) {
      try {
        if (!(await boundedWait(this.#launch, scheduler.now() + reapTimeoutMs, { scheduler }))) {
          options.report(
            failure(SupervisionErrorCode.reapTimeout, SupervisionErrorText.reapTimeout, undefined, {
              phase: LaunchPhase.launch
            })
          )
          void this.#launch.then(
            (late) => this.#releaseLateLaunch(late),
            (error) => this.#releaseRejected(error)
          )
          return
        }
        handle = await this.#launch
        this.#handle = handle
        try {
          handle.terminate(TerminationMode.force)
        } catch (error) {
          options.report(error)
        }
      } catch {
        this.#lease.release()
        return
      }
    }
    if (handle) {
      try {
        if (!(await boundedWait(handle.exited, scheduler.now() + reapTimeoutMs, { scheduler }))) {
          void handle.exited.then(
            () => this.#lease.release(),
            (error) => this.#releaseRejected(error)
          )
          return
        }
      } catch (error) {
        options.report(error)
      }
    }
    this.#lease.release()
  }

  /** A late launched handle is forced and actually exited before its lease is released. */
  async #releaseLateLaunch(handle: THandle): Promise<void> {
    try {
      handle.terminate(TerminationMode.force)
    } catch (error) {
      this.#context.options.report(error)
    }
    try {
      await handle.exited
    } catch (error) {
      this.#context.options.report(error)
    }
    this.#lease.release()
  }

  /** Rejected late observation reports the original error, then relinquishes the lease. */
  #releaseRejected(error: unknown): void {
    this.#context.options.report(error)
    this.#lease.release()
  }

  /** Moves scopes/record ownership out of the pool before exposing the existing public port. */
  take(): IPrewarmEntry<THandle> | undefined {
    if (!this.#handle) return undefined
    this.#taken = true
    this.#timer?.cancel()
    void this.#monitors.dispose()
    this.#scope.release(this.#lease)
    this.#scope.release(this.#monitors)
    if (this.#record) {
      this.#scope.release(this.#record)
      void this.#handle.exited.then(
        () => this.#removeRecord(this.#record!.id),
        this.#context.options.report
      )
    }
    return {
      handle: this.#handle,
      lease: this.#lease,
      bindOutput: (sink) => this.#bindOutput(sink)
    }
  }

  /** Replay completes before installing the live sink, preserving reentrant output behavior. */
  #bindOutput(sink: IProcessLaunchContext['output']): void {
    this.#output.drain(sink, this.#context.options.report)
    this.#sink = sink
  }
}

/** Keeps the existing value-discarding Promise fulfillment stage. */
function ignoreResult(): void {}
