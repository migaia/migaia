import type { IAbortSignal } from '@migaia/lifecycle'
import type { ISupervisor, ISupervisorBaseOptions, IUnitBudget, IUnitHandle } from '../types.js'

/** Cooperative task context; the exposed port may be published once. */
export type ICoroutineRunContext<TPort> = {
  readonly signal: IAbortSignal
  expose(port: TPort): void
  heartbeat(): void
}
/** Promise-like or async iterable work executed inside one coroutine unit. */
export type ICoroutineTask<TPort> = (
  context: ICoroutineRunContext<TPort>
) => PromiseLike<unknown> | AsyncIterable<unknown> | void
/** Specification owned by a coroutine profile. */
export type ICoroutineSpec<TPort = undefined> = {
  readonly name?: string
  readonly task: ICoroutineTask<TPort>
}
/** Coroutine exit always fulfills, carrying a task rejection as data. */
export type ICoroutineExitStatus =
  | { readonly outcome: 'fulfilled' }
  | { readonly outcome: 'rejected'; readonly error: unknown }
/** Public coroutine handle with a single optional port and heartbeat observation. */
export type ICoroutineHandle<TPort> = IUnitHandle<ICoroutineExitStatus> & {
  readonly exposed: Promise<TPort>
  readonly lastHeartbeatAt: number
}
/** Core options plus coroutine-specific heartbeat monitoring. */
export type ICoroutineSupervisorOptions<TPort> = ISupervisorBaseOptions<ICoroutineHandle<TPort>> & {
  readonly spec: ICoroutineSpec<TPort>
  readonly budget: IUnitBudget<'coroutine'>
  readonly heartbeat?: {
    readonly timeoutMs: number
    readonly intervalMs?: number
    readonly failureThreshold?: number
  }
}
/** Supervisor of one coroutine specification. */
export type ICoroutineSupervisor<TPort> = ISupervisor<
  ICoroutineHandle<TPort>,
  ICoroutineSpec<TPort>
>
