/** Owns async task dispatch mechanics; strategy selection remains at the public entry. */

import type { IConcreteAsyncTaskStrategy } from './async-task-contract.ts'
import { host, member, POST_TASK_PRIORITY } from './async-task-capability.ts'

/** Host callback typed loosely; every call goes through `Reflect.apply` with the host receiver. */
export type IHostFunction = (...args: unknown[]) => unknown

/** Native channel shape used solely for one message-channel task. */
export type ITaskMessageChannel = {
  readonly port1: { onmessage: unknown; close(): void }
  readonly port2: { postMessage(value: unknown): void; close(): void }
}

/** Native idle context remains borrowed so its remaining-time method keeps the original receiver. */
export type ITaskIdleDeadline = { readonly didTimeout?: unknown; timeRemaining?: () => number }

/** One concrete dispatch owns its native registration, cancellation marker and optional delay stage. */
export class TaskDispatch {
  /** One host snapshot pairs native registration and cancellation. */
  #globals = host()
  /** Concrete queue was selected before this native registration. */
  #strategy: IConcreteAsyncTaskStrategy
  /** The original caller owns callback result settlement. */
  #run: (context: Record<string, unknown>) => void
  /** Shared diagnostic context records the selected queue. */
  #base: Record<string, unknown>
  /** Already-admitted delay is consumed by the native or preliminary timer. */
  #delay: number
  /** Optional idle deadline is forwarded only to idle registration. */
  #idleTimeout: number | undefined
  /** Non-cancellable callbacks consult this marker before running. */
  #cancelled = false
  /** A preliminary delay hands cancellation to its subsequently registered inner queue. */
  #cancelInner: (() => void) | undefined
  /** Only a message-channel strategy owns this pair of native ports. */
  #channel: ITaskMessageChannel | undefined

  /** Capture the concrete operation without touching its native queue yet. */
  constructor(
    strategy: IConcreteAsyncTaskStrategy,
    run: (context: Record<string, unknown>) => void,
    delay: number,
    idleTimeout: number | undefined
  ) {
    this.#strategy = strategy
    this.#run = run
    this.#base = { strategy }
    this.#delay = delay
    this.#idleTimeout = idleTimeout
  }

  /** Invoke host functions with their exact required receiver. */
  #call(name: string, args: unknown[]): unknown {
    return Reflect.apply(member(this.#globals, name) as IHostFunction, this.#globals, args)
  }

  /** Choose one actual native registration, keeping fallback outside this concrete owner. */
  register(): () => void {
    /** Timeout and postTask already implement their own native delay. */
    const nativeDelay = this.#strategy === 'timeout' || this.#strategy in POST_TASK_PRIORITY
    if (this.#delay > 0 && !nativeDelay) return this.#registerDelay()
    switch (this.#strategy) {
      case 'promise':
      case 'microtask':
      case 'nextTick':
      case 'schedulerYield':
        return this.#registerDeferred()
      case 'timeout':
        return this.#registerTimer('setTimeout', 'clearTimeout', this.#delay)
      case 'immediate':
        return this.#registerTimer('setImmediate', 'clearImmediate')
      case 'messageChannel':
        return this.#registerChannel()
      case 'animationFrame': {
        /** The frame callback retains the original native timestamp conversion. */
        const id = this.#call('requestAnimationFrame', [
          (frameTime: unknown) => this.#run({ ...this.#base, frameTime: Number(frameTime) })
        ])
        return () => {
          this.#call('cancelAnimationFrame', [id])
        }
      }
      case 'idleCallback':
        return this.#registerIdle()
      case 'postTaskUserBlocking':
      case 'postTaskUserVisible':
      case 'postTaskBackground':
        return this.#registerPosted(this.#strategy)
    }
  }

  /** A preliminary timer yields cancellation to the second stage only after it is registered. */
  #registerDelay(): () => void {
    /** This first stage owns only its own native timer. */
    const handle = this.#call('setTimeout', [
      () => {
        this.#cancelInner = dispatch(this.#strategy, this.#run, 0, this.#idleTimeout)
      },
      this.#delay
    ])
    return () => {
      if (this.#cancelInner) this.#cancelInner()
      else this.#call('clearTimeout', [handle])
    }
  }

  /** Non-cancellable microtask/tick/continuation registrations share one cancellation marker. */
  #registerDeferred(): () => void {
    switch (this.#strategy) {
      case 'promise':
        void Promise.resolve().then(this.#runIfOpen)
        break
      case 'microtask':
        this.#call('queueMicrotask', [this.#runIfOpen])
        break
      case 'nextTick': {
        /** Node-compatible process is the native nextTick receiver. */
        const processHost = member(this.#globals, 'process')
        Reflect.apply(member(processHost, 'nextTick') as IHostFunction, processHost, [
          this.#runIfOpen
        ])
        break
      }
      case 'schedulerYield': {
        /** The host scheduler owns its continuation queue. */
        const schedulerHost = member(this.#globals, 'scheduler')
        void Promise.resolve(
          Reflect.apply(member(schedulerHost, 'yield') as IHostFunction, schedulerHost, [])
        ).then(this.#runIfOpen)
        break
      }
    }
    return () => {
      this.#cancelled = true
    }
  }

  /** Callback admission for queues that cannot unregister a native job. */
  #runIfOpen = (): void => {
    if (!this.#cancelled) this.#run(this.#base)
  }

  /** Timer and immediate registration share native-handle cancellation, preserving argument count. */
  #registerTimer(register: string, cancel: string, delay?: number): () => void {
    /** Native delay is supplied only by timeout, as in the original call. */
    const handle = this.#call(register, [
      () => this.#run(this.#base),
      ...(delay === undefined ? [] : [delay])
    ])
    return () => {
      this.#call(cancel, [handle])
    }
  }

  /** A fresh channel belongs to this task and closes on run or cancellation. */
  #registerChannel(): () => void {
    this.#channel = new (member(this.#globals, 'MessageChannel') as new () => ITaskMessageChannel)()
    Object.assign(this.#channel.port1, {
      onmessage: () => {
        this.#closeChannel()
        this.#run(this.#base)
      }
    })
    this.#channel.port2.postMessage(undefined)
    return this.#closeChannel
  }

  /** Release the original two ports and detach their message callback. */
  #closeChannel = (): void => {
    this.#channel!.port1.onmessage = null
    this.#channel!.port1.close()
    this.#channel!.port2.close()
  }

  /** Idle callbacks expose the original native deadline receiver lazily. */
  #registerIdle(): () => void {
    /** Cancellation uses the exact id returned by native registration. */
    const id = this.#call('requestIdleCallback', [
      (deadline: ITaskIdleDeadline) => this.#runIdle(deadline),
      ...(this.#idleTimeout === undefined ? [] : [{ timeout: this.#idleTimeout }])
    ])
    return () => {
      this.#call('cancelIdleCallback', [id])
    }
  }

  /** Project the native idle deadline while leaving timeRemaining lazy and receiver-preserving. */
  #runIdle(deadline: ITaskIdleDeadline): void {
    this.#run({
      ...this.#base,
      didTimeout: deadline?.didTimeout === true,
      timeRemaining: () =>
        typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : 0
    })
  }

  /** Native postTask owns cancellation; unexpected native rejections still reach the host. */
  #registerPosted(strategy: keyof typeof POST_TASK_PRIORITY): () => void {
    /** The host scheduler must remain the receiver of postTask. */
    const schedulerHost = member(this.#globals, 'scheduler')
    /** This native controller cancels only the posted task. */
    const controller = new (member(this.#globals, 'AbortController') as new () => {
      readonly signal: unknown
      abort(): void
    })()
    /** Preserve the original host promise and its optional then surface. */
    const posted = Reflect.apply(
      member(schedulerHost, 'postTask') as IHostFunction,
      schedulerHost,
      [
        () => this.#run(this.#base),
        { priority: POST_TASK_PRIORITY[strategy], delay: this.#delay, signal: controller.signal }
      ]
    ) as PromiseLike<unknown> | undefined
    posted?.then(undefined, (error: unknown) => this.#reportPosted(error))
    return () => {
      this.#cancelled = true
      controller.abort()
    }
  }

  /** Unexpected postTask rejection reaches the same host queue without replacing the thrown value. */
  #reportPosted(error: unknown): void {
    if (!this.#cancelled)
      this.#call('queueMicrotask', [
        () => {
          throw error
        }
      ])
  }
}

/** Register one concrete queue; its named owner retains cancellation and native handles. */
export function dispatch(
  strategy: IConcreteAsyncTaskStrategy,
  run: (context: Record<string, unknown>) => void,
  delay: number,
  idleTimeout: number | undefined
): () => void {
  return new TaskDispatch(strategy, run, delay, idleTimeout).register()
}
