/**
 * Projects original stderr observations into bounded fixed-text IPC records and owns their
 * subscription/timer retirement. Raw child bytes stay with the native supervision reader.
 */
import { hostRethrowReporter } from '@migaia/utils/promise'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import type { IIpcLogExecution } from '../features/log.ts'
import { IpcLogEventName } from '../features/flow-control.ts'
import { IpcReporterContext } from '@migaia/rpc-host/sdk'
import {
  CHILD_STDERR_REDACTED,
  PROCESS_STDERR_EVENT_BUDGET,
  PROCESS_STDERR_INTERVAL_MS
} from './constants.ts'
import type { IProcessCommonOptions } from './types.ts'
/** The concrete log installation owns its sink and exact observer remover. */
type IProcessLog = ReturnType<IIpcLogExecution['install']>['value']

/** Project the existing reader into a bounded session log without retaining or delaying bytes. */
/** Own one session's stderr budget, timer and exact native unsubscription. */
class ProcessStderrLog {
  /** Original log installation receives only the existing redacted records. */
  #install: IProcessLog
  /** The session identity and native source remain the original process options. */
  #ipc: IProcessCommonOptions['ipc']
  /** Secondary reporter failures retain their existing host observation policy. */
  #report: (error: unknown) => void
  /** One monotonic clock owns fixed intervals and their boundary task. */
  #scheduler: IScheduler
  /** Closed callbacks cannot revive a detached stderr subscription. */
  #closed = false
  /** First observed chunk anchors each fixed session interval. */
  #intervalStart: number | undefined
  /** Normal records consume the current interval's budget before reentrant reporting. */
  #emitted = 0
  /** Overflow retains a count only, never raw bytes. */
  #dropped = 0
  /** At most one overflow boundary task belongs to this log subscription. */
  #task: IScheduledTask | undefined
  /** The exact source remover is invoked once after final summary emission. */
  #unsubscribe: () => void
  /** Register only after all counters and lifecycle callbacks belong to this instance. */
  constructor(
    install: IProcessLog,
    ipc: IProcessCommonOptions['ipc'],
    report: (error: unknown) => void,
    scheduler: IScheduler = systemScheduler
  ) {
    this.#install = install
    this.#ipc = ipc
    this.#report = report
    this.#scheduler = scheduler
    /** The configured subscription callback borrows no private IPC options as its receiver. */
    const subscribe = ipc.stderr!
    this.#unsubscribe = subscribe(this.#chunk)
  }
  /** Emit original redacted text and preserve the original receiverless error reporter. */
  #record = (droppedChunks?: number): void => {
    try {
      this.#install.recordStderr({
        name: IpcLogEventName['ipc.stderr'],
        connectionId: this.#ipc.connectionId,
        sessionId: this.#ipc.sessionId,
        ...(this.#ipc.processId === undefined ? {} : { processId: this.#ipc.processId }),
        text: CHILD_STDERR_REDACTED,
        ...(droppedChunks === undefined ? {} : { droppedChunks })
      })
    } catch (error) {
      try {
        ;(0, this.#report)(error)
      } catch (reporterError) {
        hostRethrowReporter(reporterError, IpcReporterContext)
      }
    }
  }
  /** Detach task/counters before invoking reentrant summary reporting. */
  #flush = (nextStart: number): void => {
    /** One immutable total belongs to the interval ending at this flush. */
    const total = this.#dropped
    /** Detaching ownership makes cancellation and reporter reentry harmless to this task. */
    const previousTask = this.#task
    this.#task = undefined
    this.#dropped = 0
    this.#emitted = 0
    this.#intervalStart = nextStart
    previousTask?.cancel()
    if (total > 0) this.#record(total)
  }
  /** Consume each actual chunk in constant work without retaining bytes or delaying its reader. */
  #chunk = (_chunk: Uint8Array) => {
    if (this.#closed) return
    /** One read identifies the current fixed interval without interpreting the chunk. */
    const now = this.#scheduler.now()
    if (this.#intervalStart === undefined) this.#intervalStart = now
    else if (now - this.#intervalStart >= PROCESS_STDERR_INTERVAL_MS) {
      this.#flush(
        this.#intervalStart +
          Math.floor((now - this.#intervalStart) / PROCESS_STDERR_INTERVAL_MS) *
            PROCESS_STDERR_INTERVAL_MS
      )
      if (this.#closed) return
    }
    if (this.#emitted < PROCESS_STDERR_EVENT_BUDGET) {
      this.#emitted += 1
      this.#record()
      return
    }
    this.#dropped += 1
    if (!this.#task) {
      /** A delayed callback closes the original fixed interval without shifting its anchor. */
      const boundary = this.#intervalStart + PROCESS_STDERR_INTERVAL_MS
      this.#task = this.#scheduler.schedule(
        () => {
          if (!this.#closed) this.#flush(boundary)
        },
        Math.max(0, boundary - now)
      )
    }
  }
  /** Seal before summary and source removal; repeated cleanup remains idempotent. */
  close = () => {
    if (this.#closed) return
    this.#closed = true
    this.#flush(this.#scheduler.now())
    ;(0, this.#unsubscribe)()
  }
}

/** Project the original stderr reader into its bounded redacted session log. */
export function attachIpcStderr(
  install: IProcessLog,
  ipc: IProcessCommonOptions['ipc'],
  report: (error: unknown) => void,
  scheduler: IScheduler = systemScheduler
): () => void {
  return ipc.stderr ? new ProcessStderrLog(install, ipc, report, scheduler).close : () => undefined
}
