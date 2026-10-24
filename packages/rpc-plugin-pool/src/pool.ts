import { resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import { defaultRpcReporter, type IRpcHostMember } from '@migaia/rpc-host/plugin'
import { attachSecondaryErrors } from '@migaia/utils/error'
import type { IRpcPoolControls, IPoolPluginOptions } from './types.js'
import { RpcPoolErrorCode } from './error-code.js'
import { queuedPoolAbort, tagPoolError } from './error.js'
import {
  RPC_POOL_DEFAULT_MAX_QUEUE,
  RPC_POOL_MAX_IDLE_TIMEOUT_MS,
  RpcPoolState,
  RpcPoolText
} from './text.js'

/** Only original public Peer calls and cleanup cross the scheduling boundary. */
type IPoolPeer = Pick<
  IRpcHostMember,
  'request' | 'notify' | 'stream' | 'group' | 'outcome' | 'close'
>
/** Original call options stay intact; the queue reads only their cancellation signal. */
type IPoolCallOptions = Pick<NonNullable<Parameters<IPoolPeer['request']>[2]>, 'signal'>
/** The internal dynamic dispatcher is projected back to each factory's unchanged public types. */
type IPool = Omit<IPoolPeer, 'close'> & IRpcPoolControls
/** One member owns one client slot, a native acquisition, and exactly one public close. */
type IPoolMember = {
  peer?: IPoolPeer
  ready: Promise<IPoolPeer>
  resolveReady(peer: IPoolPeer): void
  rejectReady(error: unknown): void
  busy: boolean
  inFlight: boolean
  retiring: boolean
  idleTimer?: IScheduledTask
  closing?: Promise<void>
  closed: Promise<void>
  resolveClosed(): void
  rejectClosed(error: unknown): void
}
/** Waiting entries keep their own cancellation receipt and receive exactly one member slot. */
type IPoolWaiter = {
  resolve(member: IPoolMember): void
  reject(error: unknown): void
  unsubscribe(): void
}

/** Only this local identity settles a consumer stopped before its original iterator exists. */
const STREAM_FINISHED = Symbol()

/** Reject malformed and invalid numeric configuration before native creation starts. */
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

/** Construction and resize share the same positive integer boundary. */
function validatePoolSize(size: number): void {
  if (typeof size !== 'number')
    throw tagPoolError(new TypeError(RpcPoolText.size), RpcPoolErrorCode.invalidOptions)
  if (!Number.isInteger(size) || size <= 0)
    throw tagPoolError(new RangeError(RpcPoolText.size), RpcPoolErrorCode.invalidOptions)
}

/** Compose client scheduling over existing public factories without native state or recovery logic. */
/** Allocate the pool scheduler's member, FIFO and lifecycle ownership before opening peers. */
function poolState(options: IPoolPluginOptions, createPeer: () => Promise<IPoolPeer>) {
  /** Admit one timer capability before any original Peer factory can acquire resources. */
  const scheduler = resolveSchedulerOption(options, systemScheduler)
  /** Target capacity survives idle retirement; only explicit resize changes it. */
  let targetSize = options.size
  /** Queue capacity excludes tasks already assigned to a member. */
  const maxQueue = options.maxQueue ?? RPC_POOL_DEFAULT_MAX_QUEUE
  /** Pool state governs new client admission independently of every native Peer state. */
  const state: RpcPoolState = RpcPoolState.open
  /** Native acquisitions and retiring resources stay owned here until their cleanup completes. */
  const members = new Set<IPoolMember>()
  /** All accepted operations without a member remain in this bounded FIFO. */
  const queue = new Set<IPoolWaiter>()
  /** Accepted tasks include waiting, assigned acquisition, and actual public dispatch. */
  let accepted = 0
  /** A cursor rotates equally idle members without another priority or native scheduler. */
  let cursor = 0
  /** Creation batches remain owned across partial failure and close races. */
  const creationJobs = new Set<Promise<void>>()
  /** All native close failures remain available to the final aggregate, including retired members. */
  const closeErrors: unknown[] = []
  /** Accepted resizes converge in call order; rejection never poisons the next operation. */
  const resizeTail: Promise<void> = Promise.resolve()
  /** The original close Promise is published before any asynchronous drain work. */
  const closePromise = undefined as Promise<void> | undefined
  /** Drain waits only for this pool's accepted operations and in-progress acquisitions. */
  const drainedResolve = undefined as (() => void) | undefined

  return {
    scheduler,
    targetSize,
    maxQueue,
    state: state as RpcPoolState,
    members,
    queue,
    accepted,
    cursor,
    creationJobs,
    closeErrors,
    resizeTail,
    closePromise: closePromise as Promise<void> | undefined,
    drainedResolve: drainedResolve as (() => void) | undefined,
    options,
    createPeer
  }
}

/** Admission callbacks publish only this scheduler's exact member and waiting receipt. */
type IAcquirePoolMember = (
  options?: IPoolCallOptions,
  onAssigned?: (member: IPoolMember) => void,
  onWaiting?: (cancel: () => void) => void
) => Promise<IPoolMember>

/** Prepare one lazy stream's cancellation receipt without admitting any pool operation. */
function poolStreamState() {
  /** Calling stream without next neither acquires a slot nor calls the Peer. */
  const acquisition = undefined as Promise<IPoolMember> | undefined
  /** The exact acquired slot is released once across iterator races. */
  const member = undefined as IPoolMember | undefined
  /** The original native iterator receives every actual consumer operation. */
  const iterator = undefined as ReturnType<IPoolPeer['stream']> | undefined
  /** Completion prevents later iterator calls from acquiring another member. */
  let finished = false
  /** Only next operations are serialized; termination must reach a pending original consumer. */
  const tail: Promise<unknown> = Promise.resolve()
  /** The existing FIFO receipt can withdraw a stream before its first native dispatch. */
  const cancelWaiting = undefined as (() => void) | undefined
  /** Cold acquisition waits can finish without leaving their already-reserved pool slot. */
  let stopResolve!: () => void
  /** This local consumer completion never cancels or replaces the public native factory. */
  const stopped = new Promise<void>((resolve) => {
    stopResolve = resolve
  })

  return {
    acquisition: acquisition as Promise<IPoolMember> | undefined,
    member: member as IPoolMember | undefined,
    iterator: iterator as ReturnType<IPoolPeer['stream']> | undefined,
    finished,
    tail,
    cancelWaiting: cancelWaiting as (() => void) | undefined,
    stopResolve,
    stopped
  }
}

/** One lazy consumer owns its acquired member until the original iterator terminates. */
class PoolStream {
  /** Iterator, admission and termination state belong only to this consumer. */
  #state = poolStreamState()
  /** Original call arguments cross the peer boundary unchanged. */
  #args: Parameters<IPoolPeer['stream']>
  /** Admission is delegated to the one pool scheduler. */
  #acquire: IAcquirePoolMember
  /** Completion releases the exact reserved member through its scheduler. */
  #release: (member: IPoolMember) => void
  /** Store scheduler callbacks without opening or consuming a peer stream. */
  constructor(
    args: Parameters<IPoolPeer['stream']>,
    acquire: IAcquirePoolMember,
    release: (member: IPoolMember) => void
  ) {
    this.#args = args
    this.#acquire = acquire
    this.#release = release
  }
  /** Release after the public iterator's original terminal completion point. */
  #finish = (): void => {
    if (this.#state.finished) return
    this.#state.finished = true
    ;(0, this.#state.stopResolve)()
    ;(0, this.#state.cancelWaiting)?.()
    if (this.#state.member) {
      this.#release(this.#state.member)
      this.#state.member = undefined
    }
  }

  /** Open only after first-next synchronous admission, retaining original call arguments. */
  #start = async (): Promise<ReturnType<IPoolPeer['stream']>> => {
    if (this.#state.iterator) return this.#state.iterator
    /** Keep the assigned member locally even if return releases the consumer while it loads. */
    const assigned = await this.#state.acquisition!
    /** A failed idle refill still releases its reserved slot and accepted operation. */
    const peer = await Promise.race([
      assigned.ready,
      this.#state.stopped.then(() => {
        throw STREAM_FINISHED
      })
    ])
    if (this.#state.finished) throw STREAM_FINISHED
    assigned.inFlight = true
    this.#state.iterator = peer.stream(...this.#args)
    return this.#state.iterator
  }

  /** Serialize one consumer operation while preserving its original rejection value. */
  #step = (operation: () => Promise<IteratorResult<unknown>>): Promise<IteratorResult<unknown>> => {
    /** Rejected operations remain observable to their caller while later cleanup can run. */
    const result = this.#state.tail.then(operation)
    this.#state.tail = result.catch(() => undefined)
    return result
  };
  [Symbol.asyncIterator]() {
    return this
  }

  next(): ReturnType<ReturnType<IPoolPeer['stream']>['next']> {
    if (this.#state.finished) return Promise.resolve({ done: true, value: undefined })
    this.#state.acquisition ??= this.#acquire(
      this.#args[2],
      (assigned) => {
        this.#state.member = assigned
      },
      (cancel) => {
        this.#state.cancelWaiting = cancel
      }
    )
    // Observe admission immediately even when a prior iterator operation has not settled.
    void this.#state.acquisition.catch(() => undefined)
    return this.#step(async () => {
      if (this.#state.finished) return { done: true, value: undefined }
      try {
        /** The original iterator decides values and completion. */
        const result = await (await this.#start()).next()
        if (result.done) this.#finish()
        return result
      } catch (error) {
        this.#finish()
        if (error === STREAM_FINISHED) return { done: true, value: undefined }
        throw error
      }
    }) as ReturnType<ReturnType<IPoolPeer['stream']>['next']>
  }

  return(value?: unknown): ReturnType<NonNullable<ReturnType<IPoolPeer['stream']>['return']>> {
    if (!this.#state.iterator || this.#state.finished) {
      this.#finish()
      return Promise.resolve({ done: true, value })
    }
    /** Termination reaches this exact original consumer even while its next() is pending. */
    const current = this.#state.iterator
    return (async () => {
      try {
        /** Return is forwarded to the original consumer before releasing its slot. */
        return current.return ? await current.return(value) : { done: true, value }
      } finally {
        this.#finish()
      }
    })() as ReturnType<NonNullable<ReturnType<IPoolPeer['stream']>['return']>>
  }

  throw(error?: unknown): ReturnType<NonNullable<ReturnType<IPoolPeer['stream']>['throw']>> {
    if (!this.#state.iterator || this.#state.finished) {
      this.#finish()
      return Promise.reject(error)
    }
    /** Throw uses the same original consumer, rather than waiting behind its blocked next. */
    const current = this.#state.iterator
    return (async () => {
      try {
        /** Throw is forwarded once, without converting the caller's original reason. */
        if (current.throw) return await current.throw(error)
        throw error
      } finally {
        this.#finish()
      }
    })() as ReturnType<NonNullable<ReturnType<IPoolPeer['stream']>['throw']>>
  }
}

/** Own member rotation, FIFO admission and pool cleanup behind the public scheduling surface. */
class ClientPool {
  /** All member and lifecycle mutation belongs to this scheduler instance. */
  #state: ReturnType<typeof poolState>
  /** Public operations retain stable identities across resize and close. */
  readonly value: IPool
  /** Compose public dispatch callbacks after scheduler storage is initialized. */
  constructor(options: IPoolPluginOptions, createPeer: () => Promise<IPoolPeer>) {
    this.#state = poolState(options, createPeer)
    this.value = Object.freeze({
      request: (...args: Parameters<IPoolPeer['request']>) =>
        this.#dispatch(args[2], (peer) => peer.request(...args)),
      notify: (...args: Parameters<IPoolPeer['notify']>) =>
        this.#dispatch(args[2], (peer) => peer.notify(...args)),
      stream: this.#stream,
      group: (...args: Parameters<IPoolPeer['group']>) =>
        this.#dispatch(args[1], (peer) => peer.group(...args)),
      outcome: (...args: Parameters<IPoolPeer['outcome']>) =>
        this.#dispatch(undefined, (peer) => peer.outcome(...args)),
      stats: () =>
        Object.freeze({
          targetSize: this.#state.targetSize,
          memberCount: [...this.#state.members].filter((member) => member.peer !== undefined)
            .length,
          inFlight: [...this.#state.members].filter((member) => member.inFlight).length,
          queued: this.#state.queue.size,
          state: this.#state.state
        }),
      resize: (size: number) => {
        if (this.#state.state !== RpcPoolState.open)
          return Promise.reject(
            tagPoolError(new Error(RpcPoolText.closed), RpcPoolErrorCode.poolClosed)
          )
        try {
          validatePoolSize(size)
        } catch (error) {
          return Promise.reject(error)
        }
        /**
         * This operation's original result remains visible even though the sequencing tail
         * recovers.
         */
        const resizing = this.#state.resizeTail.then(async () => {
          if (this.#state.state !== RpcPoolState.open)
            throw tagPoolError(new Error(RpcPoolText.closed), RpcPoolErrorCode.poolClosed)
          /** Restore the old target if an expanding creation batch fails transactionally. */
          const previous = this.#state.targetSize
          this.#state.targetSize = size
          /**
           * Prefer idle slots when shrinking and defer occupied retirement until its operation
           * ends.
           */
          const idle: IPoolMember[] = []
          /** Busy members retain insertion order after the idle partition. */
          const occupied: IPoolMember[] = []
          for (const member of this.#state.members) {
            if (member.retiring) continue
            ;(member.busy ? occupied : idle).push(member)
          }
          /**
           * Prefer idle slots when shrinking and defer occupied retirement until its operation
           * ends.
           */
          const active = [...idle, ...occupied]
          if (active.length > size)
            await Promise.all(active.slice(0, active.length - size).map(this.#retire))
          else {
            try {
              await Promise.all(this.#refill().map((member) => member.ready))
            } catch (error) {
              if (this.#state.state === RpcPoolState.open) this.#state.targetSize = previous
              throw error
            }
          }
          this.#pump()
        })
        this.#state.resizeTail = resizing.catch(() => undefined)
        return resizing
      },
      close: () => {
        if (this.#state.closePromise) return this.#state.closePromise
        this.#state.state = RpcPoolState.closing
        for (const member of this.#state.members) this.#clearIdle(member)
        this.#state.closePromise = (async () => {
          await this.#state.resizeTail
          if (this.#state.accepted > 0 || this.#state.creationJobs.size > 0)
            await new Promise<void>((resolve) => {
              this.#state.drainedResolve = resolve
              this.#notifyDrain()
            })
          await Promise.allSettled([...this.#state.members].map(this.#retire))
          this.#state.state = RpcPoolState.closed
          if (this.#state.closeErrors.length > 0)
            throw tagPoolError(
              new AggregateError(this.#state.closeErrors, RpcPoolText.closeFailed, {
                cause: this.#state.closeErrors[0]
              }),
              RpcPoolErrorCode.closeFailed
            )
        })()
        return this.#state.closePromise
      }
    })
  }
  /** Initial construction exposes no operations until transactional capacity is ready. */
  async open(): Promise<void> {
    await Promise.all(this.#createBatch(this.#state.targetSize).map((member) => member.ready))
  }
  /** Resolve a closing pool's drain after all accepted continuations have settled. */
  #notifyDrain = (): void => {
    if (this.#state.accepted === 0 && this.#state.creationJobs.size === 0)
      (0, this.#state.drainedResolve)?.()
  }

  /** Clear a member's owned idle timer before assignment, retirement or pool close. */
  #clearIdle = (member: IPoolMember): void => {
    member.idleTimer?.cancel()
    member.idleTimer = undefined
  }

  /** Close through the original Peer once, retaining original failures for the final aggregate. */
  #closeMember = (member: IPoolMember): Promise<void> => {
    if (member.closing) return member.closing
    this.#clearIdle(member)
    member.closing = member.ready
      .then(
        (peer) => peer.close(),
        // Failed acquisition already rejects its callers and owns its partial rollback.
        () => undefined
      )
      .then(
        () => {
          this.#state.members.delete(member)
          member.resolveClosed()
          this.#notifyDrain()
        },
        (error: unknown) => {
          this.#state.closeErrors.push(error)
          this.#state.members.delete(member)
          member.rejectClosed(error)
          this.#notifyDrain()
          throw error
        }
      )
    return member.closing
  }

  /** Mark retirement immediately; an occupied slot keeps its actual Peer until completion. */
  #retire = (member: IPoolMember): Promise<void> => {
    member.retiring = true
    this.#clearIdle(member)
    if (!member.busy) void this.#closeMember(member).catch(defaultRpcReporter)
    return member.closed
  }

  /** Arm only real idle resources with no pending pool demand. */
  #armIdle = (member: IPoolMember): void => {
    if (
      this.#state.options.idleTimeoutMs === undefined ||
      this.#state.state !== RpcPoolState.open ||
      member.retiring ||
      member.busy ||
      !member.peer ||
      this.#state.queue.size > 0
    ) {
      this.#clearIdle(member)
      return
    }
    // Another member's activity must not reset this member's actual idle duration.
    if (member.idleTimer !== undefined) return
    member.idleTimer = this.#state.scheduler.schedule(() => {
      member.idleTimer = undefined
      if (this.#state.state === RpcPoolState.open && !member.busy && this.#state.queue.size === 0)
        // The owned close operation already reports its failure while retaining it for close().
        void this.#retire(member).catch(() => undefined)
    }, this.#state.options.idleTimeoutMs)
    member.idleTimer.unref?.()
  };

  /** Scan one rotating snapshot once; each yielded slot advances before reentrant callbacks. */
  *#available(): Generator<IPoolMember> {
    /** Held insertion order defines the existing round-robin cursor semantics. */
    const ordered = [...this.#state.members]
    /** This batch retains its starting position while each yield advances the next batch. */
    const start = this.#state.cursor
    for (let offset = 0; offset < ordered.length; offset++) {
      /** Only this exact member owns its dispatch slot. */
      const index = (start + offset) % ordered.length
      const member = ordered[index]!
      if (!member.retiring && !member.busy) {
        this.#state.cursor = (index + 1) % ordered.length
        yield member
      }
    }
  }

  /** A single admission needs at most one scan of the current member set. */
  #select = (): IPoolMember | undefined => this.#available().next().value

  /** Reserve before settling callers so reentrant operations observe the occupied slot. */
  #reserve = (member: IPoolMember): void => {
    this.#clearIdle(member)
    member.busy = true
    member.inFlight = member.peer !== undefined
  }

  /** FIFO dispatch never bypasses waiting operations or invokes native recovery itself. */
  #pump = (): void => {
    /** One iterator scans the rotating snapshot; do not advance when no waiter needs a slot. */
    const available = this.#available()
    while (this.#state.queue.size > 0) {
      /** Advancing the cursor belongs only to a slot actually considered for waiting work. */
      const member = available.next().value
      if (member === undefined) break
      /** Queued cancellation stops owning this task at the original dispatch boundary. */
      const waiter = this.#state.queue.values().next().value!
      this.#state.queue.delete(waiter)
      waiter.unsubscribe()
      this.#reserve(member)
      waiter.resolve(member)
    }
    for (const member of this.#state.members) this.#armIdle(member)
  }

  /** Release one accepted client operation after its original Peer completion point. */
  #release = (member: IPoolMember): void => {
    member.busy = false
    member.inFlight = false
    this.#state.accepted--
    if (member.retiring) void this.#closeMember(member).catch(defaultRpcReporter)
    this.#pump()
    this.#notifyDrain()
  }

  /** Acquire a batch transactionally; partial success closes without replacing the first failure. */
  #createBatch = (count: number): IPoolMember[] => {
    /** Deferred member slots let idle refill accept work without consuming FIFO capacity. */
    const batch = Array.from({ length: count }, (): IPoolMember => {
      /** The actual factory result is published only when the whole creation batch succeeds. */
      let resolveReady!: IPoolMember['resolveReady']
      /** The batch's original primary rejects every unpublished slot. */
      let rejectReady!: IPoolMember['rejectReady']
      /** Retirement waits on the same per-member cleanup receipt. */
      let resolveClosed!: IPoolMember['resolveClosed']
      /** Native close failure remains visible to resize and close callers. */
      let rejectClosed!: IPoolMember['rejectClosed']
      /** All startup rejections have a caller or rollback owner before publication. */
      const ready = new Promise<IPoolPeer>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })
      /** Cleanup is observed even if idle retirement has no explicit resize caller. */
      const closed = new Promise<void>((resolve, reject) => {
        resolveClosed = resolve
        rejectClosed = reject
      })
      void ready.catch(() => undefined)
      void closed.catch(() => undefined)
      return {
        ready,
        resolveReady,
        rejectReady,
        closed,
        resolveClosed,
        rejectClosed,
        busy: false,
        inFlight: false,
        retiring: false
      }
    })
    for (const member of batch) this.#state.members.add(member)
    /** Factory throws and rejections remain their original values, without source/code inspection. */
    const job = Promise.allSettled(batch.map(() => Promise.resolve().then(this.#state.createPeer)))
      .then(async (results) => {
        /** Input order defines the original primary when several acquisitions fail together. */
        const failed = results.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') {
          /** Original rollback failures stay reachable without replacing an extensible primary. */
          const cleanupErrors: unknown[] = []
          await Promise.all(
            results.map(async (result) => {
              if (result.status === 'fulfilled') {
                try {
                  await result.value.close()
                } catch (cleanup) {
                  cleanupErrors.push(cleanup)
                  defaultRpcReporter(cleanup)
                }
              }
            })
          )
          /** Reuse the canonical error graph attachment without adding another rollback owner. */
          const primary = attachSecondaryErrors(failed.reason, cleanupErrors)
          for (const member of batch) {
            this.#state.members.delete(member)
            member.rejectReady(primary)
            member.resolveClosed()
          }
          // Without any surviving slot, this refill's FIFO cannot dispatch or recover by itself.
          if (![...this.#state.members].some((member) => !member.retiring)) {
            for (const waiter of this.#state.queue) {
              this.#state.queue.delete(waiter)
              waiter.unsubscribe()
              this.#state.accepted--
              waiter.reject(primary)
            }
          }
          this.#pump()
          this.#notifyDrain()
          return
        }
        for (let index = 0; index < batch.length; index++) {
          /** A fulfilled batch retains each exact original public Peer object. */
          const member = batch[index]!
          /** No rejected result remains after the transactional branch above. */
          const result = results[index]!
          if (result.status !== 'fulfilled') continue
          member.peer = result.value
          member.inFlight = member.busy
          member.resolveReady(result.value)
          if (this.#state.state !== RpcPoolState.open && !member.busy) member.retiring = true
          if (member.retiring && !member.busy)
            void this.#closeMember(member).catch(defaultRpcReporter)
        }
        this.#pump()
      })
      .finally(() => {
        this.#state.creationJobs.delete(job)
        this.#notifyDrain()
      })
    this.#state.creationJobs.add(job)
    return batch
  }

  /** Refill only missing capacity on demand; never replace a failed native generation. */
  #refill = (): IPoolMember[] => {
    /** Retiring resources no longer count against the requested client slot capacity. */
    const count = [...this.#state.members].filter((member) => !member.retiring).length
    return count < this.#state.targetSize ? this.#createBatch(this.#state.targetSize - count) : []
  }

  /** Admission commits synchronously; only FIFO waiting owns a pool cancellation listener. */
  #acquire = (
    callOptions?: IPoolCallOptions,
    onAssigned?: (member: IPoolMember) => void,
    onWaiting?: (cancel: () => void) => void
  ): Promise<IPoolMember> => {
    if (this.#state.state !== RpcPoolState.open)
      return Promise.reject(
        tagPoolError(new Error(RpcPoolText.closed), RpcPoolErrorCode.poolClosed)
      )
    this.#refill()
    /** FIFO work is dispatched before a reentrant new call can select a freed slot. */
    this.#pump()
    /** A fresh free slot needs no queue admission, even while idle refill acquires its Peer. */
    const member = this.#state.queue.size === 0 ? this.#select() : undefined
    if (member) {
      this.#reserve(member)
      this.#state.accepted++
      onAssigned?.(member)
      return Promise.resolve(member)
    }
    if (this.#state.queue.size >= this.#state.maxQueue)
      return Promise.reject(
        tagPoolError(new Error(RpcPoolText.queueFull), RpcPoolErrorCode.queueFull)
      )
    /** The caller's actual signal is read only for pool waiting, then passed on untouched. */
    const signal = callOptions?.signal
    if (signal?.aborted) return Promise.reject(queuedPoolAbort(signal.reason))
    return new Promise<IPoolMember>((resolve, reject) => {
      /** One exact entry prevents cancellation from removing another accepted operation. */
      const waiter: IPoolWaiter = {
        resolve: (member) => {
          onAssigned?.(member)
          resolve(member)
        },
        reject,
        unsubscribe: () => signal?.removeEventListener('abort', abort)
      }
      /** One queue receipt owns signal cancellation and a not-yet-started stream's termination. */
      const remove = (reason: unknown): void => {
        /** Cancellation changes only an entry that still belongs to this FIFO. */
        if (!this.#state.queue.delete(waiter)) return
        waiter.unsubscribe()
        this.#state.accepted--
        reject(reason)
        this.#pump()
        this.#notifyDrain()
      }
      /** Signal cancellation preserves the original reason on the registered pool AbortError. */
      const abort = (): void => remove(queuedPoolAbort(signal?.reason))
      this.#state.queue.add(waiter)
      this.#state.accepted++
      onWaiting?.(() => remove(STREAM_FINISHED))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }

  /** Preserve original payload/options objects and original errors across one public invocation. */
  #dispatch = async <T>(
    callOptions: IPoolCallOptions | undefined,
    invoke: (peer: IPoolPeer) => Promise<T>
  ): Promise<T> => {
    /** First admission reserves a slot before native acquisition or business invocation awaits. */
    const member = await this.#acquire(callOptions)
    try {
      /** Initial construction is the only readiness wait owned by the pool. */
      const peer = await member.ready
      member.inFlight = true
      return await invoke(peer)
    } finally {
      this.#release(member)
    }
  }
  /** Construct one lazy stream owner without acquiring a scheduler member. */
  #stream = (...args: Parameters<IPoolPeer['stream']>): ReturnType<IPoolPeer['stream']> =>
    new PoolStream(args, this.#acquire, this.#release)
}

/** Compose client scheduling over original public peers, awaiting transactional initial capacity. */
export async function createPool(
  options: IPoolPluginOptions,
  createPeer: () => Promise<IPoolPeer>
): Promise<IPool> {
  const pool = new ClientPool(options, createPeer)
  await pool.open()
  return pool.value
}
