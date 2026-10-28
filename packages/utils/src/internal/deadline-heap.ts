/**
 * Own indexed finite-deadline ordering and FIFO ties for manual and shared schedulers. Callers own
 * their task records, clocks, callbacks, native resources and liveness; this heap never invokes
 * caller code or allocates a per-task wrapper. One insertion or removal takes O(log n).
 */

/** Scheduler-owned task fields used directly by the canonical ordering index. */
export type IDeadlineHeapEntry = {
  /** Admitted finite absolute deadline, compared without reading a clock. */
  readonly due: number
  /** Registration order is assigned once by this task's owning heap. */
  readonly order: number
  /** Current heap slot, or -1 after removal, makes repeated cancellation inert. */
  index: number
}

/** One scheduler's heap owns task positions and its equal-deadline registration sequence. */
export class DeadlineHeap<T extends IDeadlineHeapEntry> {
  /** The array stores caller-owned tasks directly and releases removed members with pop(). */
  #tasks: T[] = []
  /** Registration order breaks exact deadline ties without a comparator callback or wrapper. */
  #sequence = 0

  /** Read membership without scanning tasks or advancing any clock. */
  get size(): number {
    return this.#tasks.length
  }

  /** Read the earliest task without consuming it or invoking caller-owned code. */
  get first(): T | undefined {
    return this.#tasks[0]
  }

  /** Assign one admission's FIFO order before its caller constructs the task record. */
  takeOrder(): number {
    return this.#sequence++
  }

  /** Admit a caller-owned task whose index was initialized from size immediately before this call. */
  add(task: T): void {
    this.#tasks.push(task)
    this.#siftUp(task.index)
  }

  /**
   * Remove a task admitted by this heap. Entries never leave their scheduler owner, so their
   * maintained index is sufficient; -1 keeps completed and repeatedly cancelled tasks inert.
   */
  remove(task: T): void {
    /** Heap slot recorded on the task itself follows every exchange. */
    const index = task.index
    if (index < 0) return
    /** Last member fills a removed interior slot without allocating a replacement record. */
    const last = this.#tasks.pop()!
    task.index = -1
    if (index === this.#tasks.length) return
    this.#tasks[index] = last
    last.index = index
    if (index > 0 && this.#compare(this.#tasks[Math.floor((index - 1) / 2)]!, last) > 0)
      this.#siftUp(index)
    else this.#siftDown(index)
  }

  /** Earlier finite deadlines precede later ones; registration order resolves exact ties. */
  #compare(left: T, right: T): number {
    return left.due - right.due || left.order - right.order
  }

  /** Exchange two stored tasks and update their cancellation indexes without temporary arrays. */
  #swap(left: number, right: number): void {
    /** Keep the first task while the second takes its slot. */
    const task = this.#tasks[left]!
    this.#tasks[left] = this.#tasks[right]!
    this.#tasks[right] = task
    this.#tasks[left]!.index = left
    task.index = right
  }

  /** Restore ordering toward the root after an indexed insertion or removal. */
  #siftUp(start: number): void {
    /** Heap slot currently being compared with its parent. */
    let index = start
    while (index > 0) {
      /** Parent slot of index in the implicit binary heap. */
      const parent = Math.floor((index - 1) / 2)
      if (this.#compare(this.#tasks[parent]!, this.#tasks[index]!) <= 0) break
      this.#swap(parent, index)
      index = parent
    }
  }

  /** Restore ordering toward the leaves after a root or indexed removal. */
  #siftDown(start: number): void {
    /** Heap slot currently being compared with its children. */
    let index = start
    while (true) {
      /** Left child slot of index. */
      const left = index * 2 + 1
      /** Right child slot of index. */
      const right = left + 1
      /** Slot holding the earliest task among index and its children. */
      let smallest = index
      if (
        left < this.#tasks.length &&
        this.#compare(this.#tasks[left]!, this.#tasks[smallest]!) < 0
      )
        smallest = left
      if (
        right < this.#tasks.length &&
        this.#compare(this.#tasks[right]!, this.#tasks[smallest]!) < 0
      )
        smallest = right
      if (smallest === index) break
      this.#swap(index, smallest)
      index = smallest
    }
  }
}
