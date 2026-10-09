import { hostRethrowReporter } from '@migaia/utils/promise'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import type { IIpcLogInstallation } from '../core/plugins/flow-control.js'
import { IpcLogEventName } from '../core/plugins/flow-control.js'
import { IpcReporterContext } from '../core/plugins/reporter-context.js'
import {
  CHILD_STDERR_REDACTED,
  PROCESS_STDERR_EVENT_BUDGET,
  PROCESS_STDERR_INTERVAL_MS
} from './constants.js'
import type { IProcessCommonOptions } from './types.js'

/** Project the existing reader into a bounded session log without retaining or delaying bytes. */
export function attachIpcStderr(
  install: IIpcLogInstallation,
  ipc: IProcessCommonOptions['ipc'],
  report: (error: unknown) => void,
  scheduler: IScheduler = systemScheduler
): () => void {
  if (!ipc.stderr) return () => undefined
  /** Ignore callbacks racing after unsubscribe, including callbacks retained by a bad source. */
  let closed = false
  /** The first chunk anchors fixed intervals on this session's monotonic clock. */
  let intervalStart: number | undefined
  /** Normal records consume the session budget before invoking reentrant reporters. */
  let emitted = 0
  /** Only a count survives overflow; raw bytes stay exclusively with the binding reader. */
  let dropped = 0
  /** Overflow owns one boundary callback; normal traffic allocates no scheduled task. */
  let task: IScheduledTask | undefined
  /** Preserve the original redacted record and original reporter failure owner. */
  const record = (droppedChunks?: number): void => {
    try {
      install.recordStderr({
        name: IpcLogEventName['ipc.stderr'],
        connectionId: ipc.connectionId,
        sessionId: ipc.sessionId,
        ...(ipc.processId === undefined ? {} : { processId: ipc.processId }),
        text: CHILD_STDERR_REDACTED,
        ...(droppedChunks === undefined ? {} : { droppedChunks })
      })
    } catch (error) {
      try {
        report(error)
      } catch (reporterError) {
        hostRethrowReporter(reporterError, IpcReporterContext)
      }
    }
  }
  /** Detach counters and task before reporting so close or chunk reentry cannot duplicate drops. */
  const flush = (nextStart: number): void => {
    /** One immutable total belongs to the interval ending at this flush. */
    const total = dropped
    /** Detaching ownership makes cancellation and reporter reentry harmless to this task. */
    const previousTask = task
    task = undefined
    dropped = 0
    emitted = 0
    intervalStart = nextStart
    previousTask?.cancel()
    if (total > 0) record(total)
  }
  /** The binding keeps draining; this callback performs only constant work per observed chunk. */
  const unsubscribe = ipc.stderr((_chunk) => {
    if (closed) return
    /** One read identifies the current fixed interval without interpreting the chunk. */
    const now = scheduler.now()
    if (intervalStart === undefined) intervalStart = now
    else if (now - intervalStart >= PROCESS_STDERR_INTERVAL_MS) {
      flush(
        intervalStart +
          Math.floor((now - intervalStart) / PROCESS_STDERR_INTERVAL_MS) *
            PROCESS_STDERR_INTERVAL_MS
      )
      if (closed) return
    }
    if (emitted < PROCESS_STDERR_EVENT_BUDGET) {
      emitted += 1
      record()
      return
    }
    dropped += 1
    if (!task) {
      /** A delayed callback closes the original fixed interval without shifting its anchor. */
      const boundary = intervalStart + PROCESS_STDERR_INTERVAL_MS
      task = scheduler.schedule(
        () => {
          if (!closed) flush(boundary)
        },
        Math.max(0, boundary - now)
      )
    }
  })
  /** Seal the session before final summary and unsubscribe; late callbacks cannot revive it. */
  return () => {
    if (closed) return
    closed = true
    flush(scheduler.now())
    unsubscribe()
  }
}
