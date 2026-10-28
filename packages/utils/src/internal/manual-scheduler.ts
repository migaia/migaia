/** Own the original manual indexed heap; canonical queue reuse lands separately. */
import { UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import type { IScheduledTask, IManualScheduler } from './scheduler-contract.ts'
import { schedulerError, assertDelay, addVirtualTime } from './scheduler-validation.ts'

/** Original runaway bound is independent of queue membership. */
export const MAXIMUM_ADVANCE_FLUSH = 10_000

type IManualTask = {
  readonly due: number
  readonly order: number
  index: number
  callback: (() => void) | undefined
}

export class ManualScheduler implements IManualScheduler {
  /** Virtual time starts at zero and never moves backwards. */
  #current = 0
  /** Registration order breaks equal-deadline ties. */
  #sequence = 0
  /** Nested advances cannot rewind the outer clock. */
  #advancing = false
  /** Indexed min-heap supports one insertion or cancellation in O(log n). */
  #tasks: IManualTask[] = []

  /** Heap ordering: earlier due time first, then earlier registration. */
  #compareTasks = (left: IManualTask, right: IManualTask): number =>
    left.due - right.due || left.order - right.order
  /** Exchanges two heap entries and keeps cancellation handles synchronized with their indexes. */
  #swapTasks = (left: number, right: number): void => {
    ;[this.#tasks[left], this.#tasks[right]] = [this.#tasks[right]!, this.#tasks[left]!]
    this.#tasks[left]!.index = left
    this.#tasks[right]!.index = right
  }
  /** Restores heap order toward the root after an indexed insertion or removal. */
  #siftUp = (start: number): void => {
    /** Heap slot currently being compared with its parent. */
    let index = start
    while (index > 0) {
      /** Parent slot of `index` in the implicit binary heap. */
      const parent = Math.floor((index - 1) / 2)
      if (this.#compareTasks(this.#tasks[parent]!, this.#tasks[index]!) <= 0) break
      this.#swapTasks(parent, index)
      index = parent
    }
  }
  /** Restores heap order toward the leaves after a root or indexed removal. */
  #siftDown = (start: number): void => {
    /** Heap slot currently being compared with its children. */
    let index = start
    while (true) {
      /** Left child slot of `index`. */
      const left = index * 2 + 1
      /** Right child slot of `index`. */
      const right = left + 1
      /** Slot holding the earliest task among `index` and its children. */
      let smallest = index
      if (
        left < this.#tasks.length &&
        this.#compareTasks(this.#tasks[left]!, this.#tasks[smallest]!) < 0
      )
        smallest = left
      if (
        right < this.#tasks.length &&
        this.#compareTasks(this.#tasks[right]!, this.#tasks[smallest]!) < 0
      )
        smallest = right
      if (smallest === index) break
      this.#swapTasks(index, smallest)
      index = smallest
    }
  }
  /** Removes one task by its handle index in O(log n); a no-op for tasks already removed. */
  #removeTask = (task: IManualTask): void => {
    /** Heap slot recorded on the task handle. */
    const index = task.index
    if (index < 0 || this.#tasks[index] !== task) return
    /** Last heap entry, moved into the freed slot. */
    const last = this.#tasks.pop()!
    task.index = -1
    if (index === this.#tasks.length) return
    this.#tasks[index] = last
    last.index = index
    if (index > 0 && this.#compareTasks(this.#tasks[Math.floor((index - 1) / 2)]!, last) > 0)
      this.#siftUp(index)
    else this.#siftDown(index)
  }

  /** Read the current monotonic virtual clock. */
  now = (): number => this.#current

  /** Register a task against this clock without depending on the replaceable public method slot. */
  #register = (callback: () => void, delayMs: number): IScheduledTask => {
    assertDelay(delayMs, 'delayMs')
    /** Reject overflow before touching the heap. */
    const due = addVirtualTime(this.#current, delayMs, 'delayMs')
    /** The handle's index follows every heap exchange. */
    const task: IManualTask = { due, order: this.#sequence++, index: this.#tasks.length, callback }
    this.#tasks.push(task)
    this.#siftUp(task.index)
    return {
      cancel: () => {
        task.callback = undefined
        this.#removeTask(task)
      },
      unref: () => undefined
    }
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
     * MAXIMUM_ADVANCE_FLUSH is a compile-time 10000 bound, so one advance performs O(log n) heap
     * work.
     */
    let count = 0
    this.#advancing = true
    try {
      while (true) {
        /** Earliest pending deadline is always the heap root. */
        const next = this.#tasks[0]
        if (next === undefined || next.due > target) break
        if (++count > MAXIMUM_ADVANCE_FLUSH)
          throw schedulerError(
            RangeError,
            UtilsErrorCode.schedulerRunaway,
            UtilsErrorText.schedulerRunaway
          )
        this.#removeTask(next)
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
    return this.#tasks.length
  }
}
