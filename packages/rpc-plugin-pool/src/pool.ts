/**
 * Owns bounded FIFO member acquisition, cold-start rollback, resizing and idle retirement. Slots
 * hold native resources; provider execution and concurrency stay with Host.
 */
import { resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { defaultRpcReporter } from '@migaia/rpc-host'
import { RpcPoolErrorCode } from '@migaia/rpc-contract/error-code'
import type { IRpcPoolControls, IRpcPoolStats, IPoolPluginOptions } from './types.ts'
import { queuedPoolAbort, tagPoolError } from './error.ts'
import {
  RPC_POOL_DEFAULT_MAX_QUEUE,
  RPC_POOL_MAX_IDLE_TIMEOUT_MS,
  RpcPoolState,
  RpcPoolText
} from './text.ts'

/** Pool owns acquired native resources; business execution remains with the actual Host owners. */
export type IPoolResource = Readonly<{ close(): Promise<void> }>
/** One original member slot retains its own acquisition, idle timer and shared cleanup receipts. */
export type IPoolSlot<T extends IPoolResource> = {
  resource?: T
  ready: ReturnType<typeof deferred<T>>
  closed: ReturnType<typeof deferred<void>>
  busy: boolean
  inFlight: boolean
  retiring: boolean
  idleTimer?: IScheduledTask
  closing?: Promise<void>
}
/** A queued operation owns only its admission result and exact original abort registration. */
type IPoolWaiter<T extends IPoolResource> = {
  resolve(member: IPoolSlot<T>): void
  reject(error: unknown): void
  signal?: IAbortSignal
  abort(): void
}

/** Reject malformed numeric configuration before acquiring any member. */
export function validatePoolOptions(options: IPoolPluginOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw tagPoolError(new TypeError(RpcPoolText.optionsObject), RpcPoolErrorCode.invalidOptions)
  validatePoolSize(options.size)
  if (options.maxQueue !== undefined && typeof options.maxQueue !== 'number')
    throw tagPoolError(new TypeError(RpcPoolText.maxQueue), RpcPoolErrorCode.invalidOptions)
  if (options.idleTimeoutMs !== undefined && typeof options.idleTimeoutMs !== 'number')
    throw tagPoolError(new TypeError(RpcPoolText.idleTimeoutMs), RpcPoolErrorCode.invalidOptions)
  if (
    options.maxQueue !== undefined &&
    (!Number.isInteger(options.maxQueue) || options.maxQueue < 0)
  )
    throw tagPoolError(new RangeError(RpcPoolText.maxQueue), RpcPoolErrorCode.invalidOptions)
  if (
    options.idleTimeoutMs !== undefined &&
    (!Number.isFinite(options.idleTimeoutMs) ||
      options.idleTimeoutMs <= 0 ||
      options.idleTimeoutMs > RPC_POOL_MAX_IDLE_TIMEOUT_MS)
  )
    throw tagPoolError(new RangeError(RpcPoolText.idleTimeoutMs), RpcPoolErrorCode.invalidOptions)
}
/** Construction and resize share the original positive-integer admission boundary. */
function validatePoolSize(size: number): void {
  if (typeof size !== 'number')
    throw tagPoolError(new TypeError(RpcPoolText.size), RpcPoolErrorCode.invalidOptions)
  if (!Number.isInteger(size) || size <= 0)
    throw tagPoolError(new RangeError(RpcPoolText.size), RpcPoolErrorCode.invalidOptions)
}

/** The sole native-resource scheduler retains the original FIFO, rotation, resize and drain owner. */
export class PoolScheduler<T extends IPoolResource> implements IRpcPoolControls {
  /** Cold options preserve the original scheduler getter and idle-policy read semantics. */
  readonly #options: IPoolPluginOptions
  /** Repeatable acquisition belongs to the installed concrete transport, never a public Peer. */
  readonly #createResource: () => Promise<T>
  /** Native and idle failures use the owning installation's genuine report port. */
  readonly #report: (error: unknown) => void
  /** Native registrations lend current availability without copying their lifecycle state. */
  readonly #isAvailable: (resource: T) => boolean
  /** Idle timers borrow the scheduler admitted once before any member can open. */
  readonly #scheduler: IScheduler
  /** The requested capacity survives native idle retirement until an explicit resize. */
  #targetSize: number
  /** FIFO capacity excludes already reserved cold or ready member slots. */
  readonly #maxQueue: number
  /** Pool admission changes independently from each member's native supervision phase. */
  #state: RpcPoolState = RpcPoolState.open
  /** Resources remain held through retirement until their exact cleanup Promise settles. */
  readonly #members = new Set<IPoolSlot<T>>()
  /** Insertion order is the original bounded FIFO; cancellation removes its exact entry only. */
  readonly #queue = new Set<IPoolWaiter<T>>()
  /** Accepted work includes queued operations and reserved native acquisitions. */
  #accepted = 0
  /** One cursor rotates equally available members without another scheduler. */
  #cursor = 0
  /** Transactional acquisition batches survive partial failure and concurrent close. */
  readonly #creationJobs = new Set<Promise<void>>()
  /** Final cleanup retains its own failures; open-phase errors are delivered without history. */
  readonly #closeErrors: unknown[] = []
  /** Resize results stay visible while the sequencing tail recovers after rejection. */
  #resizeTail: Promise<void> = Promise.resolve()
  /** Every close caller joins the original cleanup Promise. */
  readonly #closing = deferred<void>()
  /** Closing waits only for accepted work and genuine acquisition jobs owned here. */
  #drained: (() => void) | undefined

  /** Capture only cold ownership; open performs the actual transactional initial acquisition. */
  constructor(
    options: IPoolPluginOptions,
    createResource: () => Promise<T>,
    report: (error: unknown) => void = defaultRpcReporter,
    isAvailable: (resource: T) => boolean = () => true
  ) {
    this.#options = options
    this.#scheduler = resolveSchedulerOption(options, systemScheduler)
    this.#targetSize = options.size
    this.#maxQueue = options.maxQueue ?? RPC_POOL_DEFAULT_MAX_QUEUE
    this.#createResource = createResource
    this.#report = report
    this.#isAvailable = isAvailable
    void this.#closing.promise.catch(() => undefined)
  }

  /** Initial construction publishes no usable feature until every original slot is ready. */
  async open(): Promise<void> {
    await Promise.all(this.#createBatch(this.#targetSize).map((member) => member.ready.promise))
  }
  /** Native projection observes existing admission state without enumerating scheduler slots. */
  get state(): RpcPoolState {
    return this.#state
  }

  /** Logical publication borrows the scheduler's same original final-close Promise. */
  get closed(): Promise<void> {
    return this.#closing.promise
  }

  /** Return the original frozen instantaneous snapshot, without acquiring or sampling a member. */
  readonly stats = (): IRpcPoolStats =>
    Object.freeze({
      targetSize: this.#targetSize,
      memberCount: [...this.#members].filter((member) => member.resource !== undefined).length,
      inFlight: [...this.#members].filter((member) => member.inFlight).length,
      queued: this.#queue.size,
      state: this.#state
    })
  /** Reserve before settling callers; the caller borrows the original native resource readiness. */
  acquire(signal?: IAbortSignal): Promise<IPoolSlot<T>> {
    if (this.#state !== RpcPoolState.open) return Promise.reject(this.#closedError())
    this.#refill()
    this.#pump()
    /** A cold reserved acquisition is not a waiting FIFO entry. */
    const member = this.#queue.size === 0 ? this.#available().next().value : undefined
    if (member) {
      this.#reserve(member)
      this.#accepted++
      return Promise.resolve(member)
    }
    if (this.#queue.size >= this.#maxQueue)
      return Promise.reject(
        tagPoolError(new Error(RpcPoolText.queueFull), RpcPoolErrorCode.queueFull)
      )
    if (signal?.aborted) return Promise.reject(queuedPoolAbort(signal.reason))
    return new Promise<IPoolSlot<T>>((resolve, reject) =>
      this.#enqueue({
        resolve,
        reject,
        signal
      })
    )
  }
  /** Borrow the actual originating operation's Promise; interpret no request or stream protocol. */
  async run<V>(invoke: (resource: T) => Promise<V>, signal?: IAbortSignal): Promise<V> {
    /** Reservation precedes native readiness exactly as in the original single dispatch algorithm. */
    const member = await this.acquire(signal)
    try {
      /** Only this genuine acquisition result can enter the caller's canonical execution owner. */
      const resource = await member.ready.promise
      member.inFlight = true
      return await invoke(resource)
    } finally {
      this.release(member)
    }
  }
  /** Actual Host completion releases the selected slot; pool never interprets business replies. */
  release(member: IPoolSlot<T>): void {
    /** A slot is released once per reservation; a repeated release must not undercount work. */
    if (!member.busy) return
    member.busy = false
    member.inFlight = false
    this.#accepted--
    if (member.retiring) void this.#closeMember(member).catch(this.#report)
    this.#pump()
    this.#notifyDrain()
  }
  /** Serialize accepted capacity changes while keeping each original failure visible. */
  readonly resize = (size: number): Promise<void> => {
    if (this.#state !== RpcPoolState.open) return Promise.reject(this.#closedError())
    try {
      validatePoolSize(size)
    } catch (error) {
      return Promise.reject(error)
    }
    /** This result is distinct from the recovered sequencing tail. */
    const resizing = this.#resizeTail.then(() => this.#resize(size))
    this.#resizeTail = resizing.catch(() => undefined)
    return resizing
  }
  /** Fence admission immediately, drain accepted work, then close every original resource. */
  readonly close = (): Promise<void> => {
    if (this.#state !== RpcPoolState.open) return this.#closing.promise
    this.#state = RpcPoolState.closing
    for (const member of this.#members) this.#clearIdle(member)
    void this.#close().then(this.#closing.resolve, this.#closing.reject)
    return this.#closing.promise
  }
  /** Keep the original registered closed error and text at each public scheduler admission. */
  #closedError(): Error {
    return tagPoolError(new Error(RpcPoolText.closed), RpcPoolErrorCode.poolClosed)
  }
  /** Shrink preserves idle-first/insertion order; expansion rolls target back after batch failure. */
  async #resize(size: number): Promise<void> {
    if (this.#state !== RpcPoolState.open) throw this.#closedError()
    /** Failed expansion restores only the original target while this scheduler remains open. */
    const previous = this.#targetSize
    this.#targetSize = size
    /** Partition held resources without changing either partition's insertion order. */
    const idle: IPoolSlot<T>[] = []
    /** Occupied retirees keep their actual native resource until the original operation ends. */
    const occupied: IPoolSlot<T>[] = []
    for (const member of this.#members)
      if (!member.retiring) (member.busy ? occupied : idle).push(member)
    /** The same idle-first snapshot decides the original shrinking order. */
    const active = [...idle, ...occupied]
    if (active.length > size)
      await Promise.all(active.slice(0, active.length - size).map(this.#retire))
    else {
      try {
        await Promise.all(this.#refill().map((member) => member.ready.promise))
      } catch (error) {
        if (this.#state === RpcPoolState.open) this.#targetSize = previous
        throw error
      }
    }
    this.#pump()
  }
  /** Native cleanup preserves the shared close Promise and original retained error ordering. */
  async #close(): Promise<void> {
    await this.#resizeTail
    if (this.#accepted > 0 || this.#creationJobs.size > 0)
      await new Promise<void>((resolve) => {
        this.#drained = resolve
        this.#notifyDrain()
      })
    await Promise.allSettled([...this.#members].map(this.#retire))
    this.#state = RpcPoolState.closed
    if (this.#closeErrors.length)
      throw tagPoolError(
        new AggregateError(this.#closeErrors, RpcPoolText.closeFailed, {
          cause: this.#closeErrors[0]
        }),
        RpcPoolErrorCode.closeFailed
      )
  }
  /** Drain observes the original accepted-work and acquisition counts only. */
  #notifyDrain(): void {
    if (this.#accepted === 0 && this.#creationJobs.size === 0) this.#drained?.()
  }
  /** Reservation, retirement and close cancel the exact original native idle task. */
  #clearIdle(member: IPoolSlot<T>): void {
    member.idleTimer?.cancel()
    member.idleTimer = undefined
  }
  /** A member is closed once; acquisition failure already owns its original partial rollback. */
  #closeMember(member: IPoolSlot<T>): Promise<void> {
    if (member.closing) return member.closing
    this.#clearIdle(member)
    member.closing = member.ready.promise
      .then(
        (resource) => resource.close(),
        () => undefined
      )
      .then(
        () => {
          this.#members.delete(member)
          member.closed.resolve()
          this.#notifyDrain()
        },
        (error: unknown) => {
          /** Open-phase failures go to resize/report; final close retains only its own failures. */
          if (this.#state !== RpcPoolState.open) this.#closeErrors.push(error)
          this.#members.delete(member)
          member.closed.reject(error)
          this.#notifyDrain()
          throw error
        }
      )
    return member.closing
  }
  /** Busy retirement fences new reservations but does not interrupt original native work. */
  readonly #retire = (member: IPoolSlot<T>): Promise<void> => {
    member.retiring = true
    this.#clearIdle(member)
    if (!member.busy) void this.#closeMember(member).catch(this.#report)
    return member.closed.promise
  }
  /** Another member's activity never resets an already armed idle deadline. */
  #armIdle(member: IPoolSlot<T>): void {
    if (
      this.#options.idleTimeoutMs === undefined ||
      this.#state !== RpcPoolState.open ||
      member.retiring ||
      member.busy ||
      !member.resource ||
      this.#queue.size > 0
    ) {
      this.#clearIdle(member)
      return
    }
    if (member.idleTimer !== undefined) return
    member.idleTimer = this.#scheduler.schedule(
      () => this.#expireIdle(member),
      this.#options.idleTimeoutMs
    )
    member.idleTimer.unref?.()
  }
  /** A real idle expiry retires only an unreserved member; original close reporting owns failure. */
  #expireIdle(member: IPoolSlot<T>): void {
    member.idleTimer = undefined
    if (this.#state === RpcPoolState.open && !member.busy && this.#queue.size === 0)
      void this.#retire(member).catch(() => undefined)
  }
  /** Scan one rotating snapshot once, advancing before a reentrant reservation can occur. */
  *#available(): Generator<IPoolSlot<T>> {
    /** Original insertion order defines round-robin tie selection. */
    const ordered = [...this.#members]
    /** Each yielded slot advances the next batch without moving this batch's starting point. */
    const start = this.#cursor
    for (let offset = 0; offset < ordered.length; offset++) {
      /** This exact resource alone owns the selected native slot. */
      const index = (start + offset) % ordered.length
      const member = ordered[index]!
      if (
        !member.retiring &&
        !member.busy &&
        (member.resource === undefined || this.#isAvailable(member.resource))
      ) {
        this.#cursor = (index + 1) % ordered.length
        yield member
      }
    }
  }
  /** Native readiness changes wake the original FIFO without acquiring or restarting members. */
  refresh(): void {
    this.#pump()
  }
  /** Publish occupancy before returning a slot or resolving a queued caller. */
  #reserve(member: IPoolSlot<T>): void {
    this.#clearIdle(member)
    member.busy = true
    member.inFlight = member.resource !== undefined
  }
  /** FIFO work is reserved first, without an extra readiness/recovery owner. */
  #pump(): void {
    /** A single rotating iterator serves this original FIFO pump. */
    const available = this.#available()
    while (this.#queue.size > 0) {
      /** Do not advance the cursor when no queued operation needs another slot. */
      const member = available.next().value
      if (member === undefined) break
      /** Exact insertion order prevents reentrant admission from bypassing an accepted waiter. */
      const waiter = this.#queue.values().next().value!
      this.#queue.delete(waiter)
      waiter.signal?.removeEventListener('abort', waiter.abort)
      this.#reserve(member)
      waiter.resolve(member)
    }
    for (const member of this.#members) this.#armIdle(member)
  }
  /** Register one exact abort receipt only while its operation remains in this FIFO. */
  #enqueue(input: Pick<IPoolWaiter<T>, 'resolve' | 'reject' | 'signal'>): void {
    /** The exact FIFO entry owns its native cancellation callback before registration begins. */
    const waiter: IPoolWaiter<T> = {
      ...input,
      abort: () => this.#cancel(waiter, queuedPoolAbort(waiter.signal?.reason))
    }
    this.#queue.add(waiter)
    this.#accepted++
    waiter.signal?.addEventListener('abort', waiter.abort, { once: true })
    if (waiter.signal?.aborted) waiter.abort()
  }
  /** Cancellation never removes another operation or starts native acquisition itself. */
  #cancel(waiter: IPoolWaiter<T>, reason: unknown): void {
    if (!this.#queue.delete(waiter)) return
    waiter.signal?.removeEventListener('abort', waiter.abort)
    this.#accepted--
    waiter.reject(reason)
    this.#pump()
    this.#notifyDrain()
  }
  /** Deferred native slots preserve original transactional publication and shared close receipts. */
  #slot(): IPoolSlot<T> {
    /** Rejections are observed immediately even before a particular operation reserves the slot. */
    const ready = deferred<T>()
    /** Idle retirement may have no separate resize caller to observe cleanup. */
    const closed = deferred<void>()
    void ready.promise.catch(() => undefined)
    void closed.promise.catch(() => undefined)
    return { ready, closed, busy: false, inFlight: false, retiring: false }
  }
  /** Start the same original allSettled transaction without publishing partial successes. */
  #createBatch(count: number): IPoolSlot<T>[] {
    /** A batch retains input order independently from native completion order. */
    const batch = Array.from({ length: count }, () => this.#slot())
    for (const member of batch) this.#members.add(member)
    /** Factory throws remain exact values, just like asynchronous acquisition failures. */
    const creating = Promise.allSettled(
      batch.map(() => Promise.resolve().then(this.#createResource))
    )
    /** One explicit operation keeps cleanup callbacks within the owning scheduler. */
    const operation = { batch, job: undefined as Promise<void> | undefined }
    const job = creating
      .then((results) => this.#settleBatch(operation.batch, results))
      .finally(() => {
        this.#creationJobs.delete(operation.job!)
        this.#notifyDrain()
      })
    operation.job = job
    this.#creationJobs.add(job)
    return batch
  }
  /** Preserve input-order primary selection and rollback all fulfilled native acquisitions. */
  async #settleBatch(batch: IPoolSlot<T>[], results: PromiseSettledResult<T>[]): Promise<void> {
    /** The first failed input retains primary ownership even when later inputs fail sooner. */
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') {
      /** Rollback failures remain reachable through the same canonical error graph attachment. */
      const cleanupErrors: unknown[] = []
      await Promise.all(
        results.map(async (result) => {
          if (result.status !== 'fulfilled') return
          try {
            await result.value.close()
          } catch (cleanup) {
            cleanupErrors.push(cleanup)
            this.#report(cleanup)
          }
        })
      )
      /**
       * Extensible primaries retain identity; nonextensible values retain original aggregate
       * policy.
       */
      const primary = attachSecondaryErrors(failed.reason, cleanupErrors)
      for (const member of batch) {
        this.#members.delete(member)
        member.ready.reject(primary)
        member.closed.resolve()
      }
      if (![...this.#members].some((member) => !member.retiring)) {
        for (const waiter of this.#queue) {
          this.#queue.delete(waiter)
          waiter.signal?.removeEventListener('abort', waiter.abort)
          this.#accepted--
          waiter.reject(primary)
        }
      }
      this.#pump()
      this.#notifyDrain()
      return
    }
    for (let index = 0; index < batch.length; index++) {
      /** Only a completely fulfilled batch publishes its exact original native resources. */
      const member = batch[index]!
      const result = results[index]!
      if (result.status !== 'fulfilled') continue
      member.resource = result.value
      member.inFlight = member.busy
      member.ready.resolve(result.value)
      if (this.#state !== RpcPoolState.open && !member.busy) member.retiring = true
      if (member.retiring && !member.busy) void this.#closeMember(member).catch(this.#report)
    }
    this.#pump()
  }
  /** Refill only missing capacity on demand; native restart policy remains with its actual source. */
  #refill(): IPoolSlot<T>[] {
    /** Retiring resources no longer consume requested target capacity. */
    const count = [...this.#members].filter((member) => !member.retiring).length
    return count < this.#targetSize ? this.#createBatch(this.#targetSize - count) : []
  }
}
