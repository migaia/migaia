/**
 * Owns one admitted operation's concurrency keys, rate reservation and completion subscriptions.
 * Actual completion or cancellation releases the original registry/governor rights once; provider
 * execution and native connection lifecycle remain outside this lease.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IRpcCompletion } from '@migaia/rpc-contract/protocol'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { localRpcErrorCode } from '../../host/error-owner.js'
import { resolveAbortReason } from '../../host/abort-reason.js'
import type { ProviderAdmissionRegistry } from './provider-admission.js'
import type { LimitsGovernor } from './governor.js'

/** One original provider operation owns its leases and one optional deadline/activity receipt. */
export class LimitsLease {
  /** The single shared concurrency owner retains each member's original release identity. */
  readonly #registry: ProviderAdmissionRegistry
  /** Only compact member keys survive admission, never a business payload or envelope. */
  readonly #keys: readonly string[]
  /** One connection owns rate credit, activity and consecutive deadline observations. */
  readonly #governor: LimitsGovernor
  /** This actual provider signal distinguishes private local timeouts from remote forged codes. */
  readonly #signal: IAbortSignal
  /** Only groups refund unused reserved rate credit at their actual terminal. */
  #reservation: Readonly<{ window: number; started(): number }> | undefined
  /** A successful quota admission installs exactly one activity receipt. */
  #active = false
  /** The exact native signal listener is removed only after its real registration succeeds. */
  #listening = false
  /** Even an already-aborted provider contributes at most one genuine deadline. */
  #timedOut = false
  /** The canonical completion owns the one idempotent terminal release. */
  #settled = false

  /** Retain only explicit quota identities and the original business cancellation signal. */
  constructor(
    registry: ProviderAdmissionRegistry,
    keys: readonly string[],
    governor: LimitsGovernor,
    signal: IAbortSignal
  ) {
    this.#registry = registry
    this.#keys = keys
    this.#governor = governor
    this.#signal = signal
  }

  /**
   * Attach activity only after quota admission; group progress is an actual readonly operation
   * fact.
   */
  begin(window: number, started?: () => number): void {
    if (started) this.#reservation = { window, started }
    this.#active = true
    this.#governor.begin(this.#unsubscribe)
    this.#signal.addEventListener('abort', this.#abort, { once: true })
    this.#listening = true
    if (this.#signal.aborted) this.#abort()
  }

  /** Release every original lease only at real completion, including streams and cancelled work. */
  readonly settle = (completion: IRpcCompletion): void => {
    if (this.#settled) return
    this.#settled = true
    for (const key of this.#keys) this.#registry.release(key)
    this.#unsubscribe()
    if (this.#reservation)
      this.#governor.refund(
        this.#reservation.window,
        Math.max(0, this.#keys.length - this.#reservation.started())
      )
    this.#reservation = undefined
    if (this.#active)
      this.#governor.finish(this.#unsubscribe, completion.ok && !this.#signal.aborted)
  }

  /** Local timeout provenance comes from the mint owner, never writable source/code properties. */
  readonly #abort = (): void => {
    this.#unsubscribe()
    if (
      this.#timedOut ||
      localRpcErrorCode(resolveAbortReason(this.#signal)) !== RpcCoreErrorCode.deadlineExceeded
    )
      return
    this.#timedOut = true
    this.#governor.timeout()
  }

  /** Remove exactly the observer attached to the actual provider signal. */
  readonly #unsubscribe = (): void => {
    if (!this.#listening) return
    this.#listening = false
    this.#signal.removeEventListener('abort', this.#abort)
  }
}
