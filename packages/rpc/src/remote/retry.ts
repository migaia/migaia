import { createAbortController } from '@migaia/lifecycle'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import type { IRpcPortableValue } from '../contract/types.js'
import { RpcAbortError, RpcTimeoutError } from '../core/errors.js'
import { resolveAbortReason } from '../core/internal/async-control.js'
import { RpcRemoteLayerErrorCode } from './error-code.js'
import { createRemoteLayerError } from './error.js'
import type { IRemoteGenerationEvents, IRemoteRetryDispatch, IRemoteRetryPort } from './types.js'

/** One logical request retains its key and deadline across at most two physical sends. */
export function createRemoteRetryPort(
  options: Readonly<{
    events: IRemoteGenerationEvents
    scheduler: IScheduler
    report(error: unknown): void
  }>
): IRemoteRetryPort {
  return Object.freeze({
    dispatch(input: IRemoteRetryDispatch): Promise<IRpcPortableValue> {
      return new Promise<IRpcPortableValue>((resolve, reject) => {
        /** The readiness waiter is canceled when this logical call finishes. */
        const controller = createAbortController()
        /** Each send observes its own generation until a result or departure wins. */
        let unsubscribe: () => void = () => undefined
        /** One timer enforces the original logical deadline, including rebind wait. */
        let timer: IScheduledTask | undefined
        /** Terminal settlement prevents a late send or readiness result from publishing. */
        let settled = false
        /** The latest departure remains the cause of an unknown result. */
        let leaveReason: unknown
        /** The original generation is the only one eligible for a single replay. */
        let replayed = false

        const finish = (result: IRpcPortableValue | unknown, success: boolean): void => {
          if (settled) return
          settled = true
          unsubscribe()
          timer?.cancel()
          input.signal?.removeEventListener('abort', onAbort)
          controller.abort()
          if (success) resolve(result as IRpcPortableValue)
          else reject(result)
        }
        const unknownResult = (generation: number, reason?: unknown): Error =>
          createRemoteLayerError(RpcRemoteLayerErrorCode.resultUnknown, leaveReason, {
            method: input.method,
            generation,
            ...(reason === undefined ? {} : { reason })
          })
        const onAbort = (): void => {
          finish(new RpcAbortError(undefined, undefined, resolveAbortReason(input.signal!)), false)
        }
        const remaining = (): number | undefined =>
          input.deadlineAt === undefined
            ? undefined
            : Math.max(0, input.deadlineAt - options.scheduler.now())

        const send = (generation: number): void => {
          if (settled) return
          const current = options.events.current()
          if (!current.active || current.generation !== generation) {
            finish(
              replayed
                ? unknownResult(generation)
                : createRemoteLayerError(RpcRemoteLayerErrorCode.closed, leaveReason, {
                    generation
                  }),
              false
            )
            return
          }
          /** A departure observed before the send means no frame was admitted. */
          let sent = false
          let departed = false
          unsubscribe = options.events.onLeave(generation, (reason) => {
            if (settled) return
            departed = true
            leaveReason = reason
            unsubscribe()
            if (!sent) {
              finish(
                createRemoteLayerError(RpcRemoteLayerErrorCode.closed, reason, { generation }),
                false
              )
              return
            }
            if (!input.idempotent || replayed) {
              finish(unknownResult(generation), false)
              return
            }
            replayed = true
            void options.events.whenReady(generation, controller.signal).then(
              (next) => {
                if (!settled) send(next)
              },
              (error: unknown) => {
                if (!settled) finish(unknownResult(generation, error), false)
              }
            )
          })
          if (settled || departed) {
            unsubscribe()
            return
          }
          const budget = remaining()
          if (budget === 0) {
            finish(new RpcTimeoutError(), false)
            return
          }
          sent = true
          try {
            void input
              .sendOnce({ expectedGeneration: generation, key: input.key, remainingMs: budget })
              .then(
                (value) => {
                  if (!departed) finish(value, true)
                },
                (error: unknown) => {
                  if (departed) options.report(error)
                  else finish(error, false)
                }
              )
          } catch (error) {
            if (departed) options.report(error)
            else finish(error, false)
          }
        }

        if (input.signal?.aborted) {
          onAbort()
          return
        }
        input.signal?.addEventListener('abort', onAbort, { once: true })
        const budget = remaining()
        if (budget === 0) {
          finish(new RpcTimeoutError(), false)
          return
        }
        if (budget !== undefined)
          timer = options.scheduler.schedule(() => finish(new RpcTimeoutError(), false), budget)
        send(input.generation)
      })
    }
  })
}
