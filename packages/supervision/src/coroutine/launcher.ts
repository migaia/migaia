import { createAbortController, type IAbortSignal } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import { SupervisionErrorCode } from '../error-code.js'
import { SupervisionErrorText } from '../error-text.js'
import { createSupervisionError } from '../errors.js'
import type { IUnitLauncher } from '../types.js'
import { coroutineCapabilities, CoroutineOutcome } from './constants.js'
import type { ICoroutineExitStatus, ICoroutineHandle, ICoroutineSpec } from './types.js'

/** Private termination authority keyed by handle identity. */
const termination = new WeakMap<ICoroutineHandle<unknown>, () => void>()

/** Terminates only handles launched by this module; repeated calls are harmless. */
export function terminateCoroutineHandle(handle: ICoroutineHandle<unknown>): void {
  termination.get(handle)?.()
}

/** Constructs a cooperative launcher whose exited promises never reject. */
export function createCoroutineLauncher<TPort>(
  scheduler: IScheduler
): IUnitLauncher<ICoroutineSpec<TPort>, ICoroutineHandle<TPort>> {
  let nextIdentity = 0
  return {
    capabilities: coroutineCapabilities,
    async launch(spec: ICoroutineSpec<TPort>, context: { readonly signal: IAbortSignal }) {
      if (context.signal.aborted) throw context.signal.reason
      const controller = createAbortController()
      let exposed = false
      let resolveExposed!: (port: TPort) => void
      const exposedPromise = new Promise<TPort>((resolve) => {
        resolveExposed = resolve
      })
      let heartbeatAt = scheduler.now()
      let resolveExited!: (status: ICoroutineExitStatus) => void
      const exited = new Promise<ICoroutineExitStatus>((resolve) => {
        resolveExited = resolve
      })
      let settled = false
      let stopped = false
      let iterator: AsyncIterator<unknown> | undefined
      let returnTask: Promise<IteratorResult<unknown>> | undefined
      /** Publishes task settlement at most once, preserving a rejected value as data. */
      const finish = (status: ICoroutineExitStatus): void => {
        if (settled) return
        settled = true
        resolveExited(status)
      }
      /** Invokes a generator return once and observes synchronous and async failures. */
      const stop = (): void => {
        if (stopped) return
        stopped = true
        controller.abort()
        if (iterator?.return) {
          try {
            returnTask = Promise.resolve(iterator.return())
          } catch (error) {
            returnTask = Promise.reject(error)
          }
          void returnTask.then(
            () => undefined,
            (error) => {
              finish({ outcome: CoroutineOutcome.rejected, error })
            }
          )
        }
      }
      const runContext = {
        signal: controller.signal,
        expose(port: TPort) {
          if (exposed)
            throw createSupervisionError(
              TypeError,
              SupervisionErrorCode.invalidOption,
              SupervisionErrorText.invalidOption,
              { detail: { field: 'expose' } }
            )
          exposed = true
          resolveExposed(port)
        },
        heartbeat() {
          heartbeatAt = scheduler.now()
        }
      }
      let produced: PromiseLike<unknown> | AsyncIterable<unknown> | void
      try {
        produced = spec.task(runContext)
      } catch (error) {
        produced = Promise.reject(error)
      }
      if (produced !== null && typeof produced === 'object' && Symbol.asyncIterator in produced) {
        try {
          iterator = (produced as AsyncIterable<unknown>)[Symbol.asyncIterator]()
          const consume = async (): Promise<void> => {
            try {
              while (true) {
                const step = await iterator!.next()
                heartbeatAt = scheduler.now()
                if (stopped) {
                  await returnTask
                  finish({ outcome: CoroutineOutcome.fulfilled })
                  return
                }
                if (step.done) {
                  finish({ outcome: CoroutineOutcome.fulfilled })
                  return
                }
              }
            } catch (error) {
              finish({ outcome: CoroutineOutcome.rejected, error })
            }
          }
          void consume()
        } catch (error) {
          finish({ outcome: CoroutineOutcome.rejected, error })
        }
      } else {
        void Promise.resolve(produced).then(
          () => finish({ outcome: CoroutineOutcome.fulfilled }),
          (error) => finish({ outcome: CoroutineOutcome.rejected, error })
        )
      }
      const handle: ICoroutineHandle<TPort> = {
        identity: { fingerprint: `coroutine:${++nextIdentity}` },
        exited,
        exposed: exposedPromise,
        get lastHeartbeatAt() {
          return heartbeatAt
        }
      }
      termination.set(handle, stop)
      return handle
    }
  }
}
