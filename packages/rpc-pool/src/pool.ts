import { resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import type { IRuntimePeer } from '@migaia/rpc-core/remote'
import type { IRpcPoolControls, IRpcPoolOptions } from './types.js'
import { RpcPoolErrorCode } from './error-code.js'
import { queuedPoolAbort, tagPoolError } from './error.js'
import {
  RPC_POOL_DEFAULT_MAX_QUEUE,
  RPC_POOL_MAX_IDLE_TIMEOUT_MS,
  RpcPoolState,
  RpcPoolText
} from './text.js'
import { defaultRpcReporter } from '@migaia/rpc-core'

/** Only original public Peer calls and cleanup cross the scheduling boundary. */
type IPoolPeer = Pick<IRuntimePeer, 'request' | 'notify' | 'stream' | 'close'>
/** Original call options stay intact; the queue reads only their cancellation signal. */
type IPoolCallOptions = Parameters<IPoolPeer['request']>[2]
/** The internal dynamic dispatcher is projected back to each factory's unchanged public types. */
type IPool = Pick<IPoolPeer, 'request' | 'notify' | 'stream'> & IRpcPoolControls
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
export function validatePoolOptions(options: IRpcPoolOptions & { spawn: unknown }): void {
  if (!options || typeof options !== 'object' || Array.isArray(options) || options.spawn == null)
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
export async function createPool(
  options: IRpcPoolOptions,
  createPeer: () => Promise<IPoolPeer>
): Promise<IPool> {
  /** Admit one timer capability before any original Peer factory can acquire resources. */
  const scheduler = resolveSchedulerOption(options, systemScheduler)
  /** Target capacity survives idle retirement; only explicit resize changes it. */
  let targetSize = options.size
  /** Queue capacity excludes tasks already assigned to a member. */
  const maxQueue = options.maxQueue ?? RPC_POOL_DEFAULT_MAX_QUEUE
  /** Pool state governs new client admission independently of every native Peer state. */
  let state: RpcPoolState = RpcPoolState.open
  /** Native acquisitions and retiring resources stay owned here until their cleanup completes. */
  const members = new Set<IPoolMember>()
  /** All accepted operations without a member remain in this bounded FIFO. */
  const queue: IPoolWaiter[] = []
  /** Accepted tasks include waiting, assigned acquisition, and actual public dispatch. */
  let accepted = 0
  /** A cursor rotates equally idle members without another priority or native scheduler. */
  let cursor = 0
  /** Creation batches remain owned across partial failure and close races. */
  const creationJobs = new Set<Promise<void>>()
  /** All native close failures remain available to the final aggregate, including retired members. */
  const closeErrors: unknown[] = []
  /** Accepted resizes converge in call order; rejection never poisons the next operation. */
  let resizeTail: Promise<void> = Promise.resolve()
  /** The original close Promise is published before any asynchronous drain work. */
  let closePromise: Promise<void> | undefined
  /** Drain waits only for this pool's accepted operations and in-progress acquisitions. */
  let drainedResolve: (() => void) | undefined

  /** Resolve a closing pool's drain after all accepted continuations have settled. */
  const notifyDrain = (): void => {
    if (accepted === 0 && creationJobs.size === 0) drainedResolve?.()
  }
  /** Clear a member's owned idle timer before assignment, retirement or pool close. */
  const clearIdle = (member: IPoolMember): void => {
    member.idleTimer?.cancel()
    member.idleTimer = undefined
  }
  /** Close through the original Peer once, retaining original failures for the final aggregate. */
  const closeMember = (member: IPoolMember): Promise<void> => {
    if (member.closing) return member.closing
    clearIdle(member)
    member.closing = member.ready
      .then(
        (peer) => peer.close(),
        // Failed acquisition already rejects its callers and owns its partial rollback.
        () => undefined
      )
      .then(
        () => {
          members.delete(member)
          member.resolveClosed()
          notifyDrain()
        },
        (error: unknown) => {
          closeErrors.push(error)
          members.delete(member)
          member.rejectClosed(error)
          notifyDrain()
          throw error
        }
      )
    return member.closing
  }
  /** Mark retirement immediately; an occupied slot keeps its actual Peer until completion. */
  const retire = (member: IPoolMember): Promise<void> => {
    member.retiring = true
    clearIdle(member)
    if (!member.busy) void closeMember(member).catch(defaultRpcReporter)
    return member.closed
  }
  /** Arm only real idle resources with no pending pool demand. */
  const armIdle = (member: IPoolMember): void => {
    if (
      options.idleTimeoutMs === undefined ||
      state !== RpcPoolState.open ||
      member.retiring ||
      member.busy ||
      !member.peer ||
      queue.length > 0
    ) {
      clearIdle(member)
      return
    }
    // Another member's activity must not reset this member's actual idle duration.
    if (member.idleTimer !== undefined) return
    member.idleTimer = scheduler.schedule(() => {
      member.idleTimer = undefined
      if (state === RpcPoolState.open && !member.busy && queue.length === 0)
        // The owned close operation already reports its failure while retaining it for close().
        void retire(member).catch(() => undefined)
    }, options.idleTimeoutMs)
    member.idleTimer.unref?.()
  }
  /** Choose only empty pool slots; native readiness and terminal errors stay with the Peer. */
  const select = (): IPoolMember | undefined => {
    /** Rotation is over the held member order, rather than resetting when busy members disappear. */
    const ordered = [...members]
    for (let offset = 0; offset < ordered.length; offset++) {
      /** The cursor advances before user callbacks can reenter acquisition. */
      const index = (cursor + offset) % ordered.length
      /** Only this exact member owns its dispatch slot. */
      const member = ordered[index]!
      if (!member.retiring && !member.busy) {
        cursor = (index + 1) % ordered.length
        return member
      }
    }
    return undefined
  }
  /** Reserve before settling callers so reentrant operations observe the occupied slot. */
  const reserve = (member: IPoolMember): void => {
    clearIdle(member)
    member.busy = true
    member.inFlight = member.peer !== undefined
  }
  /** FIFO dispatch never bypasses waiting operations or invokes native recovery itself. */
  const pump = (): void => {
    while (queue.length > 0) {
      /** An available slot is selected before removing exactly the FIFO head. */
      const member = select()
      if (!member) break
      /** Queued cancellation stops owning this task at the original dispatch boundary. */
      const waiter = queue.shift()!
      waiter.unsubscribe()
      reserve(member)
      waiter.resolve(member)
    }
    for (const member of members) armIdle(member)
  }
  /** Release one accepted client operation after its original Peer completion point. */
  const release = (member: IPoolMember): void => {
    member.busy = false
    member.inFlight = false
    accepted--
    if (member.retiring) void closeMember(member).catch(defaultRpcReporter)
    pump()
    notifyDrain()
  }
  /** Acquire a batch transactionally; partial success closes without replacing the first failure. */
  const createBatch = (count: number): IPoolMember[] => {
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
    for (const member of batch) members.add(member)
    /** Factory throws and rejections remain their original values, without source/code inspection. */
    const job = Promise.allSettled(batch.map(() => Promise.resolve().then(createPeer)))
      .then(async (results) => {
        /** Input order defines the original primary when several acquisitions fail together. */
        const failed = results.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') {
          await Promise.all(
            results.map(async (result) => {
              if (result.status === 'fulfilled') {
                try {
                  await result.value.close()
                } catch (cleanup) {
                  defaultRpcReporter(cleanup)
                }
              }
            })
          )
          for (const member of batch) {
            members.delete(member)
            member.rejectReady(failed.reason)
            member.resolveClosed()
          }
          // Without any surviving slot, this refill's FIFO cannot dispatch or recover by itself.
          if (![...members].some((member) => !member.retiring)) {
            for (const waiter of queue.splice(0)) {
              waiter.unsubscribe()
              accepted--
              waiter.reject(failed.reason)
            }
          }
          pump()
          notifyDrain()
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
          if (state !== RpcPoolState.open && !member.busy) member.retiring = true
          if (member.retiring && !member.busy) void closeMember(member).catch(defaultRpcReporter)
        }
        pump()
      })
      .finally(() => {
        creationJobs.delete(job)
        notifyDrain()
      })
    creationJobs.add(job)
    return batch
  }
  /** Refill only missing capacity on demand; never replace a failed native generation. */
  const refill = (): IPoolMember[] => {
    /** Retiring resources no longer count against the requested client slot capacity. */
    const count = [...members].filter((member) => !member.retiring).length
    return count < targetSize ? createBatch(targetSize - count) : []
  }
  /** Admission commits synchronously; only FIFO waiting owns a pool cancellation listener. */
  const acquire = (
    callOptions?: IPoolCallOptions,
    onAssigned?: (member: IPoolMember) => void,
    onWaiting?: (cancel: () => void) => void
  ): Promise<IPoolMember> => {
    if (state !== RpcPoolState.open)
      return Promise.reject(
        tagPoolError(new Error(RpcPoolText.closed), RpcPoolErrorCode.poolClosed)
      )
    refill()
    /** FIFO work is dispatched before a reentrant new call can select a freed slot. */
    pump()
    /** A fresh free slot needs no queue admission, even while idle refill acquires its Peer. */
    const member = queue.length === 0 ? select() : undefined
    if (member) {
      reserve(member)
      accepted++
      onAssigned?.(member)
      return Promise.resolve(member)
    }
    if (queue.length >= maxQueue)
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
        const index = queue.indexOf(waiter)
        if (index < 0) return
        queue.splice(index, 1)
        waiter.unsubscribe()
        accepted--
        reject(reason)
        pump()
        notifyDrain()
      }
      /** Signal cancellation preserves the original reason on the registered pool AbortError. */
      const abort = (): void => remove(queuedPoolAbort(signal?.reason))
      queue.push(waiter)
      accepted++
      onWaiting?.(() => remove(STREAM_FINISHED))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }
  /** Preserve original payload/options objects and original errors across one public invocation. */
  const dispatch = async (
    mode: 'request' | 'notify',
    args: Parameters<IPoolPeer['request']>
  ): Promise<unknown> => {
    /** First admission reserves a slot before native acquisition or business invocation awaits. */
    const member = await acquire(args[2])
    try {
      /** Initial construction is the only readiness wait owned by the pool. */
      const peer = await member.ready
      member.inFlight = true
      return await peer[mode](...args)
    } finally {
      release(member)
    }
  }
  /** A lazy iterator owns one slot from first next through done, return, throw or failure. */
  const stream = (...args: Parameters<IPoolPeer['stream']>): ReturnType<IPoolPeer['stream']> => {
    /** Calling stream without next neither acquires a slot nor calls the Peer. */
    let acquisition: Promise<IPoolMember> | undefined
    /** The exact acquired slot is released once across iterator races. */
    let member: IPoolMember | undefined
    /** The original native iterator receives every actual consumer operation. */
    let iterator: ReturnType<IPoolPeer['stream']> | undefined
    /** Completion prevents later iterator calls from acquiring another member. */
    let finished = false
    /** Only next operations are serialized; termination must reach a pending original consumer. */
    let tail: Promise<unknown> = Promise.resolve()
    /** The existing FIFO receipt can withdraw a stream before its first native dispatch. */
    let cancelWaiting: (() => void) | undefined
    /** Cold acquisition waits can finish without leaving their already-reserved pool slot. */
    let stopResolve!: () => void
    /** This local consumer completion never cancels or replaces the public native factory. */
    const stopped = new Promise<void>((resolve) => {
      stopResolve = resolve
    })
    /** Release after the public iterator's original terminal completion point. */
    const finish = (): void => {
      if (finished) return
      finished = true
      stopResolve()
      cancelWaiting?.()
      if (member) {
        release(member)
        member = undefined
      }
    }
    /** Open only after first-next synchronous admission, retaining original call arguments. */
    const start = async (): Promise<ReturnType<IPoolPeer['stream']>> => {
      if (iterator) return iterator
      /** Keep the assigned member locally even if return releases the consumer while it loads. */
      const assigned = await acquisition!
      /** A failed idle refill still releases its reserved slot and accepted operation. */
      const peer = await Promise.race([
        assigned.ready,
        stopped.then(() => {
          throw STREAM_FINISHED
        })
      ])
      if (finished) throw STREAM_FINISHED
      assigned.inFlight = true
      iterator = peer.stream(...args)
      return iterator
    }
    /** Serialize one consumer operation while preserving its original rejection value. */
    const step = (
      operation: () => Promise<IteratorResult<unknown>>
    ): Promise<IteratorResult<unknown>> => {
      /** Rejected operations remain observable to their caller while later cleanup can run. */
      const result = tail.then(operation)
      tail = result.catch(() => undefined)
      return result
    }
    return {
      [Symbol.asyncIterator]() {
        return this
      },
      next() {
        if (finished) return Promise.resolve({ done: true, value: undefined })
        acquisition ??= acquire(
          args[2],
          (assigned) => {
            member = assigned
          },
          (cancel) => {
            cancelWaiting = cancel
          }
        )
        // Observe admission immediately even when a prior iterator operation has not settled.
        void acquisition.catch(() => undefined)
        return step(async () => {
          if (finished) return { done: true, value: undefined }
          try {
            /** The original iterator decides values and completion. */
            const result = await (await start()).next()
            if (result.done) finish()
            return result
          } catch (error) {
            finish()
            if (error === STREAM_FINISHED) return { done: true, value: undefined }
            throw error
          }
        }) as ReturnType<ReturnType<IPoolPeer['stream']>['next']>
      },
      return(value) {
        if (!iterator || finished) {
          finish()
          return Promise.resolve({ done: true, value })
        }
        /** Termination reaches this exact original consumer even while its next() is pending. */
        const current = iterator
        return (async () => {
          try {
            /** Return is forwarded to the original consumer before releasing its slot. */
            return current.return ? await current.return(value) : { done: true, value }
          } finally {
            finish()
          }
        })() as ReturnType<NonNullable<ReturnType<IPoolPeer['stream']>['return']>>
      },
      throw(error) {
        if (!iterator || finished) {
          finish()
          return Promise.reject(error)
        }
        /** Throw uses the same original consumer, rather than waiting behind its blocked next. */
        const current = iterator
        return (async () => {
          try {
            /** Throw is forwarded once, without converting the caller's original reason. */
            if (current.throw) return await current.throw(error)
            throw error
          } finally {
            finish()
          }
        })() as ReturnType<NonNullable<ReturnType<IPoolPeer['stream']>['throw']>>
      }
    }
  }
  /** Acquire initial capacity transactionally before exposing any pool operations. */
  await Promise.all(createBatch(targetSize).map((member) => member.ready))
  return Object.freeze({
    request: (...args: Parameters<IPoolPeer['request']>) =>
      dispatch('request', args) as ReturnType<IPoolPeer['request']>,
    notify: (...args: Parameters<IPoolPeer['notify']>) =>
      dispatch('notify', args) as ReturnType<IPoolPeer['notify']>,
    stream,
    stats: () =>
      Object.freeze({
        targetSize,
        memberCount: [...members].filter((member) => member.peer !== undefined).length,
        inFlight: [...members].filter((member) => member.inFlight).length,
        queued: queue.length,
        state
      }),
    resize(size: number) {
      if (state !== RpcPoolState.open)
        return Promise.reject(
          tagPoolError(new Error(RpcPoolText.closed), RpcPoolErrorCode.poolClosed)
        )
      try {
        validatePoolSize(size)
      } catch (error) {
        return Promise.reject(error)
      }
      /** This operation's original result remains visible even though the sequencing tail recovers. */
      const resizing = resizeTail.then(async () => {
        if (state !== RpcPoolState.open)
          throw tagPoolError(new Error(RpcPoolText.closed), RpcPoolErrorCode.poolClosed)
        /** Restore the old target if an expanding creation batch fails transactionally. */
        const previous = targetSize
        targetSize = size
        /** Prefer idle slots when shrinking and defer occupied retirement until its operation ends. */
        const active = [...members]
          .filter((member) => !member.retiring)
          .sort((left, right) => Number(left.busy) - Number(right.busy))
        if (active.length > size)
          await Promise.all(active.slice(0, active.length - size).map(retire))
        else {
          try {
            await Promise.all(refill().map((member) => member.ready))
          } catch (error) {
            if (state === RpcPoolState.open) targetSize = previous
            throw error
          }
        }
        pump()
      })
      resizeTail = resizing.catch(() => undefined)
      return resizing
    },
    close() {
      if (closePromise) return closePromise
      state = RpcPoolState.closing
      for (const member of members) clearIdle(member)
      closePromise = (async () => {
        await resizeTail
        if (accepted > 0 || creationJobs.size > 0)
          await new Promise<void>((resolve) => {
            drainedResolve = resolve
            notifyDrain()
          })
        await Promise.allSettled([...members].map(retire))
        state = RpcPoolState.closed
        if (closeErrors.length > 0)
          throw tagPoolError(
            new AggregateError(closeErrors, RpcPoolText.closeFailed, { cause: closeErrors[0] }),
            RpcPoolErrorCode.closeFailed
          )
      })()
      return closePromise
    }
  })
}
