/**
 * Owns the initial native supervisor start wait and its exact event/abort subscriptions. Stops at
 * the first accepted outcome or original backoff boundary, then releases listeners; restart policy
 * and native execution remain with the borrowed supervisor.
 */
import {
  SupervisorState as S,
  SupervisorEventType as E,
  type ISupervisor,
  type IReadyOutcome
} from '@migaia/supervision'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import { resolveAbortReason } from '../host/abort-reason.js'

/** Original first launch stops at its first backoff; later native restart policy remains untouched. */
export class RpcMemberFirstStart<TUnit, TSpec> {
  /** The actual supplied supervisor remains the sole start/stop authority. */
  readonly #supervisor: ISupervisor<TUnit, TSpec>
  /** Preparation cancellation only abandons this wait; final release owns native disposal. */
  readonly #signal: IAbortSignal
  /** Late native stop failures keep the original unhandled-failure reporter. */
  readonly #report: (error: unknown) => void
  /** Every original completion path shares this one wait Promise. */
  readonly #completion = deferred<IReadyOutcome<TUnit>>()
  /** Native observation is removed on success, failure, first backoff or abort. */
  #unsubscribe: () => void = () => undefined

  /** Install the exact original failure/abort watch before asking the native owner to start. */
  constructor(
    supervisor: ISupervisor<TUnit, TSpec>,
    signal: IAbortSignal,
    report: (error: unknown) => void
  ) {
    this.#supervisor = supervisor
    this.#signal = signal
    this.#report = report
    if (signal.aborted) {
      this.#completion.reject(resolveAbortReason(signal))
      return
    }
    this.#unsubscribe = supervisor.subscribe((event) => {
      if (event.type !== E.state || event.to !== S.backoff) return
      this.#settle()
      void this.#supervisor.stop().catch(this.#report)
      this.#completion.resolve({ state: S.stopped })
    })
    signal.addEventListener('abort', this.#abort, { once: true })
    void supervisor.start().then(
      (outcome) => {
        this.#settle()
        this.#completion.resolve(outcome)
      },
      (error: unknown) => {
        this.#settle()
        this.#completion.reject(error)
      }
    )
  }

  /** Return the original shared launch wait without wrapping its identity. */
  get promise(): Promise<IReadyOutcome<TUnit>> {
    return this.#completion.promise
  }
  /** No subscription outlives its actual native start wait. */
  #settle(): void {
    ;(0, this.#unsubscribe)()
    this.#signal.removeEventListener('abort', this.#abort)
  }
  /** Native abort reasons keep exact identity through initial rollback. */
  readonly #abort = (): void => {
    this.#settle()
    this.#completion.reject(resolveAbortReason(this.#signal))
  }
}
