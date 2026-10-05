import {
  retainProviderPreflight,
  wrapProviderStreamAdmission
} from '../../core/internal/provider.js'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { RpcCapability } from '../../contract/wire-constants.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../types.js'
import type { IRpcEndpoint } from '../../core/typing.js'
import { DEFAULT_DRAIN_MS } from '../constants.js'

/** A generation retains only the calls started on its own endpoint. */
type IDrainGeneration = {
  channel: IRemoteChannel
  endpoint: IRpcEndpoint
  pending: number
  announced: boolean
  deadlineAt?: number
  timer?: IScheduledTask
  resolve?: () => void
  promise?: Promise<void>
}

/** Process bindings share one drain owner without exporting a new public surface. */
export type IRemoteBindingDrain = Readonly<{
  wrap(channel: IRemoteChannel, endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint
  /** Keep logical request settlement inside the same physical generation's drain barrier. */
  trackCurrent<T>(operation: () => Promise<T>): Promise<T>
  drainCurrent(options?: Readonly<{ hostRemainingMs?: number; drainMs?: number }>): Promise<void>
}>

/** One counter follows each physical generation, so a replacement cannot inherit old work. */
export function createRemoteBindingDrain(
  scheduler: IScheduler,
  report: (error: unknown) => void,
  drainMs = DEFAULT_DRAIN_MS
): IRemoteBindingDrain {
  /** The currently published endpoint is replaced only by a successfully admitted generation. */
  let current: IDrainGeneration | undefined

  /** Resolve the one drain promise after its announcement and outstanding calls settle. */
  const finish = (generation: IDrainGeneration): void => {
    if (generation.pending !== 0 || !generation.announced || !generation.resolve) return
    generation.timer?.cancel()
    generation.timer = undefined
    generation.resolve()
    generation.resolve = undefined
  }

  /** Count a request from send until its original promise settles, without changing its result. */
  const track = <T>(generation: IDrainGeneration, operation: () => Promise<T>): Promise<T> => {
    generation.pending += 1
    let result: Promise<T>
    try {
      result = operation()
    } catch (error) {
      generation.pending -= 1
      finish(generation)
      throw error
    }
    const settled = (): void => {
      generation.pending -= 1
      finish(generation)
    }
    void result.then(settled, settled)
    return result
  }

  /** A later Host budget may only shorten the existing generation's drain timer. */
  const setDeadline = (generation: IDrainGeneration, remainingMs: number): void => {
    const deadlineAt = scheduler.now() + remainingMs
    if (generation.deadlineAt !== undefined && generation.deadlineAt <= deadlineAt) return
    generation.deadlineAt = deadlineAt
    generation.timer?.cancel()
    generation.timer = scheduler.schedule(
      () => {
        generation.resolve?.()
        generation.resolve = undefined
        generation.timer = undefined
      },
      Math.max(0, deadlineAt - scheduler.now())
    )
  }

  return Object.freeze({
    trackCurrent: <T>(operation: () => Promise<T>): Promise<T> =>
      current ? track(current, operation) : operation(),
    wrap(channel, endpoint) {
      const generation: IDrainGeneration = {
        channel,
        endpoint: endpoint.endpoint,
        pending: 0,
        announced: false
      }
      /** Own properties shadow the frozen endpoint's methods without violating Proxy invariants. */
      const trackedEndpoint: IRpcEndpoint = Object.create(endpoint.endpoint)
      Object.defineProperties(trackedEndpoint, {
        send: {
          value: <T>(
            targetId: string,
            method: string,
            data: unknown,
            options?: Parameters<IRpcEndpoint['send']>[3]
          ): Promise<T> =>
            track(generation, () => endpoint.endpoint.send<T>(targetId, method, data, options))
        },
        provide: {
          value: (method: string, provider: Parameters<IRpcEndpoint['provide']>[1]) => {
            /** Prepaid groups and ordinary calls enter this same original drain tracking body. */
            const tracked =
              (invoke: typeof provider): typeof provider =>
              (context) => {
                generation.pending += 1
                let result: ReturnType<typeof provider>
                try {
                  result = invoke(context)
                } catch (error) {
                  generation.pending -= 1
                  finish(generation)
                  throw error
                }
                const settled = (): void => {
                  generation.pending -= 1
                  finish(generation)
                }
                void Promise.resolve(result).then(settled, settled)
                return result
              }
            endpoint.endpoint.provide(
              method,
              retainProviderPreflight(provider, tracked(provider), tracked)
            )
            return trackedEndpoint
          }
        }
      })
      Object.freeze(trackedEndpoint)
      /** A stream occupies one slot from first next until its iterator settles. */
      const stream = endpoint.stream
        ? Object.freeze({
            ...endpoint.stream,
            open: (
              targetId: string,
              method: string,
              params: unknown,
              options?: Parameters<NonNullable<IRemoteServeEndpoint['stream']>['open']>[3]
            ) =>
              (async function* () {
                generation.pending += 1
                try {
                  yield* endpoint.stream!.open(targetId, method, params, options)
                } finally {
                  generation.pending -= 1
                  finish(generation)
                }
              })(),
            provide: (
              method: string,
              run: Parameters<NonNullable<IRemoteServeEndpoint['stream']>['provide']>[1]
            ) =>
              endpoint.stream!.provide(
                method,
                retainProviderPreflight(
                  run,
                  wrapProviderStreamAdmission(
                    run,
                    (params: unknown, context: Parameters<typeof run>[1]) =>
                      (async function* () {
                        if (context.context.targetGeneration === undefined) generation.pending += 1
                        try {
                          /**
                           * Only the new profile exposes final outcome; legacy terminal stays
                           * unchanged.
                           */
                          const result = yield* run(params, context)
                          return context.context.targetGeneration === undefined ? undefined : result
                        } finally {
                          if (context.context.targetGeneration === undefined) {
                            generation.pending -= 1
                            finish(generation)
                          }
                        }
                      })(),
                    () => {
                      generation.pending += 1
                      return () => {
                        generation.pending -= 1
                        finish(generation)
                      }
                    }
                  )
                )
              )
          })
        : undefined
      current = generation
      return Object.freeze({
        ...endpoint,
        endpoint: trackedEndpoint,
        ...(stream ? { stream } : {})
      })
    },
    drainCurrent(options = {}) {
      const generation = current
      if (!generation || generation.channel.transport.closed) return Promise.resolve()
      const hostRemainingMs = options.hostRemainingMs
      const limit = Math.floor(options.drainMs ?? drainMs)
      const remainingMs =
        hostRemainingMs === undefined
          ? limit
          : Math.min(limit, Math.floor(0.8 * Math.max(0, hostRemainingMs)))
      if (generation.promise) {
        if (generation.resolve) setDeadline(generation, remainingMs)
        return generation.promise
      }
      generation.promise = new Promise<void>((resolve) => {
        generation.resolve = resolve
      })
      setDeadline(generation, remainingMs)
      if (generation.channel.agreement.capabilities.includes(RpcCapability.close)) {
        void generation.endpoint
          .announceClose(generation.channel.peerId, { drainMs: remainingMs })
          .catch(report)
          .finally(() => {
            generation.announced = true
            finish(generation)
          })
      } else {
        generation.announced = true
        finish(generation)
      }
      return generation.promise
    }
  })
}
