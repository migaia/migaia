/** Per-carrier business completion barriers remain owned by the canonical Session table. */
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { normalizeRpcRemainingMs } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcContractError } from '../host/error-owner.ts'

/** A single physical generation retains only counts and its original drain completion. */
type IDrainRecord = {
  /** Only real business completion, never a physical write, releases this count. */
  pending: number
  /** Announcement and business completion must both finish before an early graceful terminal. */
  announced: boolean
  /** Every concurrent caller joins this exact Promise after drain starts. */
  promise?: Promise<void>
  /** Deadline or actual completion settles the original Promise once. */
  resolve?: () => void
  /** Later budgets may shorten this monotonic deadline, never extend it. */
  deadlineAt?: number
  /** The existing borrowed scheduler owns the sole deadline task. */
  timer?: IScheduledTask
}

/** The host lends its existing clock and reporting boundary without adding a shutdown policy. */
export type ISessionDrainOptions = Readonly<{
  scheduler: IScheduler
  report(error: unknown): void
}>

/** Count real work once per physical generation without wrapping its Promise or owning the work. */
export class SessionDrain {
  /** Exact carrier identity keeps completions from an old generation away from a reused id. */
  readonly #records = new Map<string, IDrainRecord>()
  /** The original native/host clock is shared with announcement and physical cleanup. */
  readonly #scheduler: IScheduler
  /** A failed close announcement remains visible without suppressing the drain barrier. */
  readonly #report: (error: unknown) => void

  /** Capture only explicit collaborators; no timer exists until drain actually starts. */
  constructor(options: ISessionDrainOptions) {
    this.#scheduler = options.scheduler
    this.#report = options.report
  }

  /** Return the exact original business Promise while recording both original settlement paths. */
  track<T>(carrierId: string, promise: Promise<T>): Promise<T> {
    /** Callbacks retain this one compact record, not a Session or a business payload. */
    const record = this.#record(carrierId)
    record.pending += 1
    void promise.then(
      () => this.#settled(record),
      () => this.#settled(record)
    )
    return promise
  }

  /** Announce once and join one drain; the caller supplies its already-selected remaining budget. */
  drain(
    carrierId: string,
    remainingMs: number,
    announce: (remainingMs: number) => void | Promise<void>
  ): Promise<void> {
    try {
      normalizeRpcRemainingMs(remainingMs)
    } catch (error) {
      throw createRpcContractError(RpcCoreErrorText.drainInvalid, error)
    }
    /** Per-carrier records are independent even when display names or native units are reused. */
    const record = this.#record(carrierId)
    if (record.promise) {
      if (record.resolve) this.#setDeadline(record, remainingMs)
      return record.promise
    }
    record.promise = new Promise<void>((resolve) => {
      record.resolve = resolve
    })
    this.#setDeadline(record, remainingMs)
    void this.#announce(record, remainingMs, announce)
    return record.promise
  }

  /** Physical retirement releases its exact original barrier and timer without cancelling work. */
  retire(carrierId: string): void {
    /** Remove identity before callbacks can reuse this carrier id for a different generation. */
    const record = this.#records.get(carrierId)
    if (!record) return
    this.#records.delete(carrierId)
    this.#complete(record)
  }

  /** Join only drains that already selected a grace budget; ordinary close creates no new drain. */
  async quiesce(): Promise<void> {
    /** These are the existing generation-owned barriers, never a second business tracker. */
    const draining: Promise<void>[] = []
    for (const record of this.#records.values()) if (record.promise) draining.push(record.promise)
    await Promise.all(draining)
  }

  /** Global close clears every held deadline and resolves every original drain exactly once. */
  close(): void {
    for (const carrierId of this.#records.keys()) this.retire(carrierId)
  }

  /** Only an actual tracked operation or drain allocates this small generation-local context. */
  #record(carrierId: string): IDrainRecord {
    /** Existing records retain their original Promise and deadline rather than restarting grace. */
    let record = this.#records.get(carrierId)
    if (!record) {
      record = { pending: 0, announced: false }
      this.#records.set(carrierId, record)
    }
    return record
  }

  /** Every real terminal, including rejection, releases exactly one original business count. */
  #settled(record: IDrainRecord): void {
    record.pending -= 1
    this.#finish(record)
  }

  /** Successful graceful completion requires both the actual announcement and all tracked work. */
  #finish(record: IDrainRecord): void {
    if (record.pending === 0 && record.announced && record.resolve) this.#complete(record)
  }

  /** Resolve the original completion and detach its timer before a reentrant caller can join it. */
  #complete(record: IDrainRecord): void {
    record.timer?.cancel()
    record.timer = undefined
    record.resolve?.()
    record.resolve = undefined
  }

  /** Repeated grace budgets can only move the one original monotonic deadline earlier. */
  #setDeadline(record: IDrainRecord, remainingMs: number): void {
    /** Computing at this shared clock boundary preserves elapsed time between repeated drains. */
    const deadlineAt = this.#scheduler.now() + remainingMs
    if (record.deadlineAt !== undefined && record.deadlineAt <= deadlineAt) return
    record.deadlineAt = deadlineAt
    record.timer?.cancel()
    record.timer = this.#scheduler.schedule(
      () => {
        record.timer = undefined
        record.resolve?.()
        record.resolve = undefined
      },
      Math.max(0, deadlineAt - this.#scheduler.now())
    )
  }

  /** Announcement failures report their exact original cause, then permit ordinary completion. */
  async #announce(
    record: IDrainRecord,
    remainingMs: number,
    announce: (remainingMs: number) => void | Promise<void>
  ): Promise<void> {
    try {
      await announce(remainingMs)
    } catch (error) {
      this.#report(error)
    } finally {
      record.announced = true
      this.#finish(record)
    }
  }
}
