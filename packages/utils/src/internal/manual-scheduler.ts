/** Own virtual-clock admission, cancellation and callback flushing around the canonical heap. */
import { DeadlineHeap, type IDeadlineHeapEntry } from './deadline-heap.ts'
import { UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import type { IScheduledTask, IManualScheduler } from './scheduler-contract.ts'
import { schedulerError, assertDelay, addVirtualTime } from './scheduler-validation.ts'

/**
 * Upper bound on callbacks one `advance()` may flush before it is treated as runaway
 * self-scheduling.
 */
export const MAXIMUM_ADVANCE_FLUSH = 10_000

/** One heap entry carries its cancellation index and FIFO tie-breaker. */
export type IManualTask = IDeadlineHeapEntry & {
  callback: (() => void) | undefined
}

/**
 * Create one detached cancellation receipt for its explicit task and heap owners. Cancellation
 * clears the callback before indexed removal; repeated calls retain the same inert task identity.
 */
function createManualTaskReceipt(
  task: IManualTask,
  heap: DeadlineHeap<IManualTask>
): IScheduledTask {
  return {
    cancel: () => {
      task.callback = undefined
      heap.remove(task)
    },
    unref: () => undefined
  }
}

/** One virtual clock owns its task heap and reentrancy fence. */
export class ManualScheduler implements IManualScheduler {
  /** Virtual time starts at zero and never moves backwards. */
  #current = 0
  /** Nested advances cannot rewind the outer clock. */
  #advancing = false
  /** Indexed min-heap supports one insertion or cancellation in O(log n). */
  #tasks = new DeadlineHeap<IManualTask>()

  /** Read the current monotonic virtual clock. */
  now = (): number => this.#current

  /** Register a task against this clock without depending on the replaceable public method slot. */
  #register = (callback: () => void, delayMs: number): IScheduledTask => {
    assertDelay(delayMs, 'delayMs')
    /** Reject overflow before touching the heap. */
    const due = addVirtualTime(this.#current, delayMs, 'delayMs')
    /** The handle's index follows every heap exchange. */
    const task: IManualTask = {
      due,
      order: this.#tasks.takeOrder(),
      index: this.#tasks.size,
      callback
    }
    this.#tasks.add(task)
    return createManualTaskReceipt(task, this.#tasks)
  }

  /** Public registration retains detached-call behavior and the original callable identity. */
  schedule = this.#register

  /** Deferral retains the captured registration even if a caller replaces schedule. */
  defer = (callback: () => void): void => {
    this.#register(callback, 0)
  }

  /** Flush due callbacks in deadline/FIFO order, stopping at the existing fixed runaway bound. */
  advance = (ms: number): void => {
    if (this.#advancing)
      throw schedulerError(TypeError, UtilsErrorCode.reentrantCall, UtilsErrorText.reentrantCall)
    assertDelay(ms, 'ms')
    /** Validate the final clock value before any callback runs. */
    const target = addVirtualTime(this.#current, ms, 'ms')
    /**
     * MAXIMUM_ADVANCE_FLUSH remains the existing compile-time 10000 runaway boundary. Each admitted
     * callback is removed from the indexed heap in O(log n) before it can schedule more work.
     */
    let count = 0
    this.#advancing = true
    try {
      while (true) {
        /** Earliest pending deadline is always the heap root. */
        const next = this.#tasks.first
        if (next === undefined || next.due > target) break
        if (++count > MAXIMUM_ADVANCE_FLUSH)
          throw schedulerError(
            RangeError,
            UtilsErrorCode.schedulerRunaway,
            UtilsErrorText.schedulerRunaway
          )
        this.#tasks.remove(next)
        this.#current = next.due
        /** Detach before reentrant cancellation or scheduling. */
        const callback = next.callback
        next.callback = undefined
        callback?.()
      }
      this.#current = target
    } finally {
      this.#advancing = false
    }
  }

  /** Cancelled and completed tasks are absent from the heap. */
  get pendingCount(): number {
    return this.#tasks.size
  }
}
