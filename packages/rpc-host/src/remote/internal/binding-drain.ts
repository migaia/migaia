import {
  retainProviderPreflight,
  projectNativeStreamResult,
  wrapProviderStreamAdmission,
  type IProviderSessionPolicy
} from '../../core/internal/provider.js'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { RpcCapability } from '@migaia/rpc-contract'
import type { IRemoteChannel, IRemoteServeEndpoint, IRemoteRequestTracker } from '../types.js'
import type { IRuntimeCallOptions } from '../runtime-api/typing.js'
import type { IRpcEndpoint } from '../../core/typing.js'
import { EndpointOwnerKey } from '../../core/endpoint-kernel.js'
import { readEndpointOwner } from '../../core/internal/endpoint-projection.js'
import type { RpcStreamOwner } from '../../core/internal/stream/owner.js'
import { DEFAULT_DRAIN_MS } from '../constants.js'

/** Process bindings share one drain owner without exporting a new public surface. */
export type IRemoteBindingDrain = Readonly<{
  wrap(
    channel: IRemoteChannel,
    endpoint: IRemoteServeEndpoint,
    onExecution?: (execution: IProviderSessionPolicy) => void
  ): IRemoteServeEndpoint
  /** Keep logical request settlement inside the same physical generation's drain barrier. */
  trackCurrent: IRemoteRequestTracker
  drainCurrent(options?: Readonly<{ hostRemainingMs?: number; drainMs?: number }>): Promise<void>
}>

/** The same original counter admits either callback shape without allocating an argument array. */
type ITrackedRequest<T> =
  | (() => Promise<T>)
  | ((method: string, payload: unknown, options: IRuntimeCallOptions) => Promise<T>)

/** Preserve legacy zero-argument invocation while passing current runtime input to a cold closure. */
function invokeTrackedRequest<T>(
  operation: ITrackedRequest<T>,
  method?: string,
  payload?: unknown,
  options?: IRuntimeCallOptions
): Promise<T> {
  return method === undefined
    ? (operation as () => Promise<T>)()
    : (operation as (method: string, payload: unknown, options: IRuntimeCallOptions) => Promise<T>)(
        method,
        payload,
        options!
      )
}

/** Own the original counter and deadline for exactly one admitted physical generation. */
class BindingDrainGeneration {
  /** Native channel closure and close capability stay with this exact original receipt. */
  #channel: IRemoteChannel
  /** Actual endpoint resource and stream registry retain their original operation owners. */
  #served: IRemoteServeEndpoint
  /** Binding drain uses the same native monotonic scheduler as acquisition and supervision. */
  #scheduler: IScheduler
  /** Announcement failures retain the original bare report callback. */
  #report: (error: unknown) => void
  /** Native configured drain remains the default when Host supplies no shorter budget. */
  #drainMs: number
  /** Only calls/streams started on this actual generation contribute to its drain barrier. */
  #pending = 0
  /** Pending completion cannot finish drain before the original close announcement settles. */
  #announced = false
  /** A later Host budget may shorten, but never extend, the original deadline. */
  #deadlineAt: number | undefined
  /** The original scheduler owns this generation's sole current drain deadline task. */
  #timer: IScheduledTask | undefined
  /** Native completion or deadline settles this original Promise once. */
  #resolve: (() => void) | undefined
  /** Repeated drains join the exact original generation Promise. */
  #promise: Promise<void> | undefined
  /** The original frozen endpoint view is prepared before current-generation publication. */
  #trackedEndpoint!: IRpcEndpoint
  /** Original stream projection is captured before the execution policy callback. */
  #stream: IRemoteServeEndpoint['stream']

  /** Capture existing owners without sending an announcement or creating another execution scope. */
  constructor(
    channel: IRemoteChannel,
    served: IRemoteServeEndpoint,
    scheduler: IScheduler,
    report: (error: unknown) => void,
    drainMs: number
  ) {
    this.#channel = channel
    this.#served = served
    this.#scheduler = scheduler
    this.#report = report
    this.#drainMs = drainMs
  }

  /** Physical closure is proof supplied by the original native channel only. */
  get closed(): boolean | undefined {
    return this.#channel.transport.closed
  }

  /** Finish only after announcement and all original request/stream settlements. */
  #finish(): void {
    if (this.#pending !== 0 || !this.#announced || !this.#resolve) return
    this.#timer?.cancel()
    this.#timer = undefined
    this.#resolve()
    this.#resolve = undefined
  }

  /** The same counter records one actual original request/stream settlement. */
  #settled = (): void => {
    this.#pending -= 1
    this.#finish()
  }

  /** Count from invocation to its exact original Promise, without wrapping its result or identity. */
  track<T>(
    operation: ITrackedRequest<T>,
    method?: string,
    payload?: unknown,
    options?: IRuntimeCallOptions
  ): Promise<T> {
    this.#pending += 1
    /** Keep synchronous throws distinct from the returned Promise's eventual settlement. */
    let result: Promise<T>
    try {
      result = invokeTrackedRequest(operation, method, payload, options)
    } catch (error) {
      this.#settled()
      throw error
    }
    void result.then(this.#settled, this.#settled)
    return result
  }

  /** Provider/stream admission receives one original release callback for this exact generation. */
  #enter = (): (() => void) => {
    this.#pending += 1
    return () => this.#settled()
  }

  /** Preserve the original provider return value while its native completion releases the counter. */
  #trackProvider(
    invoke: Parameters<IRpcEndpoint['provide']>[1],
    context: Parameters<Parameters<IRpcEndpoint['provide']>[1]>[0]
  ): ReturnType<typeof invoke> {
    /** Admission contributes once before a handler can throw synchronously. */
    const settled = this.#enter()
    /** Business keeps its original synchronous versus asynchronous completion shape. */
    let result: ReturnType<typeof invoke>
    try {
      result = invoke(context)
    } catch (error) {
      settled()
      throw error
    }
    void Promise.resolve(result).then(settled, settled)
    return result
  }

  /** Immutable provider identity is captured once; mutable drain state remains in this owner. */
  #tracked =
    (invoke: Parameters<IRpcEndpoint['provide']>[1]): typeof invoke =>
    (context) =>
      this.#trackProvider(invoke, context)

  /** Original provider metadata and prepaid groups retain the same wrapper and bulk reservation. */
  #provider: NonNullable<IProviderSessionPolicy['provider']> = (original) =>
    retainProviderPreflight(original, this.#tracked(original), this.#tracked)

  /** Iterator construction remains cold; its first next enters the original generation barrier. */
  async *#openStream(
    targetId: string,
    method: string,
    params: unknown,
    options?: Parameters<NonNullable<IRemoteServeEndpoint['stream']>['open']>[3]
  ) {
    this.#pending += 1
    try {
      yield* this.#served.stream!.open(targetId, method, params, options)
    } finally {
      this.#settled()
    }
  }

  /** Legacy stream completion remains unchanged while new-profile consumers retain final outcome. */
  async *#runStream(
    run: Parameters<NonNullable<IRemoteServeEndpoint['stream']>['provide']>[1],
    params: unknown,
    context: Parameters<typeof run>[1]
  ) {
    if (context.context.targetGeneration === undefined) this.#pending += 1
    try {
      /** The original consumer retains its complete business terminal value only on the new profile. */
      const result = yield* run(params, context)
      return projectNativeStreamResult(result, context.context)
    } finally {
      if (context.context.targetGeneration === undefined) this.#settled()
    }
  }

  /** This same canonical admission callback is shared by legacy opens and runtime consumers. */
  execution(): IProviderSessionPolicy {
    return {
      provider: this.#provider,
      enterStream: this.#enter,
      streamResult: projectNativeStreamResult,
      enterStreamConsumer: this.#enter
    }
  }

  /** Shadow frozen operation properties through the original projection ancestry. */
  prepare(): void {
    readEndpointOwner<RpcStreamOwner>(
      this.#served.endpoint,
      EndpointOwnerKey.streamOwner
    )?.setRuntimeConsumerAdmission(this.#enter)
    /**
     * Original endpoint ownership is retained; only its send/provider drain observation is
     * projected.
     */
    const trackedEndpoint: IRpcEndpoint = Object.create(this.#served.endpoint)
    Object.defineProperties(trackedEndpoint, {
      send: {
        value: <T>(
          targetId: string,
          method: string,
          data: unknown,
          options?: Parameters<IRpcEndpoint['send']>[3]
        ): Promise<T> =>
          this.track(() => this.#served.endpoint.send<T>(targetId, method, data, options))
      },
      provide: {
        value: (method: string, original: Parameters<IRpcEndpoint['provide']>[1]) => {
          this.#served.endpoint.provide(method, this.#provider(original))
          return trackedEndpoint
        }
      }
    })
    Object.freeze(trackedEndpoint)
    /** Original stream operations retain exact method metadata and lazy consumer admission. */
    const stream = this.#served.stream
      ? Object.freeze({
          ...this.#served.stream,
          open: (
            targetId: string,
            method: string,
            params: unknown,
            options?: Parameters<NonNullable<IRemoteServeEndpoint['stream']>['open']>[3]
          ) => this.#openStream(targetId, method, params, options),
          provide: (
            method: string,
            run: Parameters<NonNullable<IRemoteServeEndpoint['stream']>['provide']>[1]
          ) =>
            this.#served.stream!.provide(
              method,
              retainProviderPreflight(
                run,
                wrapProviderStreamAdmission(
                  run,
                  (params: unknown, context: Parameters<typeof run>[1]) =>
                    this.#runStream(run, params, context),
                  this.#enter
                )
              )
            )
        })
      : undefined
    this.#trackedEndpoint = trackedEndpoint
    this.#stream = stream
  }

  /** Publish the original endpoint record only after current selection and execution policy. */
  surface(): IRemoteServeEndpoint {
    return Object.freeze({
      ...this.#served,
      endpoint: this.#trackedEndpoint,
      ...(this.#stream ? { stream: this.#stream } : {})
    })
  }

  /** A shortened deadline reuses the original scheduler task rather than extending native drain. */
  #setDeadline(remainingMs: number): void {
    /** Monotonic deadline is computed at the original binding scheduler boundary. */
    const deadlineAt = this.#scheduler.now() + remainingMs
    if (this.#deadlineAt !== undefined && this.#deadlineAt <= deadlineAt) return
    this.#deadlineAt = deadlineAt
    this.#timer?.cancel()
    this.#timer = this.#scheduler.schedule(
      () => {
        this.#resolve?.()
        this.#resolve = undefined
        this.#timer = undefined
      },
      Math.max(0, deadlineAt - this.#scheduler.now())
    )
  }

  /** Join one original drain, preserving its announcement, Host budget fraction and deadline. */
  drain(options: Readonly<{ hostRemainingMs?: number; drainMs?: number }> = {}): Promise<void> {
    /** Host metadata can only shorten the configured native drain bound. */
    const hostRemainingMs = options.hostRemainingMs
    /** Preserve the original integer drain budget before applying the existing0.8 Host fraction. */
    const limit = Math.floor(options.drainMs ?? this.#drainMs)
    /** The original native configured limit and Host remaining budget combine by minimum. */
    const remainingMs =
      hostRemainingMs === undefined
        ? limit
        : Math.min(limit, Math.floor(0.8 * Math.max(0, hostRemainingMs)))
    if (this.#promise) {
      if (this.#resolve) this.#setDeadline(remainingMs)
      return this.#promise
    }
    this.#promise = new Promise<void>((resolve) => {
      this.#resolve = resolve
    })
    this.#setDeadline(remainingMs)
    if (this.#channel.agreement.capabilities.includes(RpcCapability.close))
      void this.#served.endpoint
        .announceClose(this.#channel.peerId, { drainMs: remainingMs })
        .catch(this.#report)
        .finally(() => {
          this.#announced = true
          this.#finish()
        })
    else {
      this.#announced = true
      this.#finish()
    }
    return this.#promise
  }
}

/** Select only the currently admitted generation; native drain counters never cross replacements. */
class RemoteBindingDrain {
  /** The same native clock owns every actual generation's original drain deadline. */
  #scheduler: IScheduler
  /** Errors retain the original native reporting callback. */
  #report: (error: unknown) => void
  /** The configured drain bound is captured once for the original binding. */
  #drainMs: number
  /** Only successful endpoint admission can replace the current generation. */
  #current: BindingDrainGeneration | undefined

  /** Capture existing binding policy without opening or publishing any native generation. */
  constructor(scheduler: IScheduler, report: (error: unknown) => void, drainMs: number) {
    this.#scheduler = scheduler
    this.#report = report
    this.#drainMs = drainMs
  }

  /**
   * Preserve zero-argument and current-input request invocation without allocating an argument
   * array.
   */
  #trackCurrent = <T>(
    operation: ITrackedRequest<T>,
    method?: string,
    payload?: unknown,
    options?: IRuntimeCallOptions
  ): Promise<T> =>
    this.#current
      ? this.#current.track(operation, method, payload, options)
      : invokeTrackedRequest(operation, method, payload, options)

  /** Publish a new physical counter only after its original endpoint projection succeeds. */
  #wrap(
    channel: IRemoteChannel,
    endpoint: IRemoteServeEndpoint,
    onExecution?: (execution: IProviderSessionPolicy) => void
  ): IRemoteServeEndpoint {
    /** One generation owns all provider and iterator tracking for this actual endpoint. */
    const generation = new BindingDrainGeneration(
      channel,
      endpoint,
      this.#scheduler,
      this.#report,
      this.#drainMs
    )
    /** Projection and admission registration precede current-generation publication. */
    generation.prepare()
    this.#current = generation
    onExecution?.(generation.execution())
    return generation.surface()
  }

  /** Native closed/no-generation drain preserves the original immediate fulfilled Promise. */
  #drainCurrent(
    options: Readonly<{ hostRemainingMs?: number; drainMs?: number }> = {}
  ): Promise<void> {
    return !this.#current || this.#current.closed ? Promise.resolve() : this.#current.drain(options)
  }

  /** Retain the same frozen callback surface without another public generation or drain authority. */
  surface(): IRemoteBindingDrain {
    return Object.freeze({
      trackCurrent: this.#trackCurrent,
      wrap: (channel, endpoint, onExecution) => this.#wrap(channel, endpoint, onExecution),
      drainCurrent: (options) => this.#drainCurrent(options)
    })
  }
}

/** Reuse one original native counter per admitted physical generation. */
export function createRemoteBindingDrain(
  scheduler: IScheduler,
  report: (error: unknown) => void,
  drainMs = DEFAULT_DRAIN_MS
): IRemoteBindingDrain {
  return new RemoteBindingDrain(scheduler, report, drainMs).surface()
}
