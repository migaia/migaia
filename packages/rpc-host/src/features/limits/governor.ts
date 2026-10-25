/**
 * Owns one actual source's rate window, violation/timeout counters, activity and idle deadline.
 * Borrows the existing scheduler and source-retirement port, while shared provider concurrency
 * belongs to the installation's admission registry.
 */
import { attachErrorIdentity } from '@migaia/utils/error'
import type { IAbortSignal } from '@migaia/utils/promise'
import { deferTask, type IScheduledTask, type IScheduler } from '@migaia/utils/scheduler'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { RpcSessionRetirement } from '@migaia/rpc-contract/interfaces'
import { createRpcError, createRpcLifecycleError } from '../../host/error-owner.js'
import { registerLocalErrorWireSummary } from '../../host/error-wire-metadata.js'
import { portableBytes } from '../../sdk/wire/portable-size.js'
import { RpcLimitsIdleTimeoutText, RpcLimitsRateWindowMs } from './constants.js'
import type { IRpcLimitsOptions } from './types.js'

/** One actual connection lends only lifecycle, reporting and the existing scheduler. */
export type ILimitsGovernorPorts = Readonly<{
  scheduler: IScheduler
  report(error: unknown): void
  retire(carrierId: string, reason?: unknown, kind?: RpcSessionRetirement): Promise<void>
  release(carrierId: string, governor: LimitsGovernor): void
}>

/** Connection-local rate/activity state is independent from shared provider concurrency leases. */
export class LimitsGovernor {
  /** Policy is captured by the optional plugin before this actual connection is observed. */
  readonly #options: IRpcLimitsOptions
  /** Native retirement and monotonic time remain owned by the original host collaborators. */
  readonly #ports: ILimitsGovernorPorts
  /** Native source identity cannot follow a same-name replacement. */
  readonly #carrierId: string
  /** Rate credit belongs to the exact bucket that originally reserved it. */
  #windowStart: number
  /** Group reservations debit all original members before any member starts. */
  #calls = 0
  /** Only consecutive quota refusals count toward the configured connection policy. */
  #violations = 0
  /** Only private-minted provider deadline aborts increment this connection counter. */
  #timeouts = 0
  /** Real business lifetimes, including stream cleanup, suppress idle retirement. */
  #active = 0
  /** Physical inbound activity uses the same monotonic clock as idle scheduling. */
  #lastInboundAt: number
  /** Candidate dispatch cannot begin an idle clock before actual public readiness. */
  #ready = false
  /** Retirement is terminal and removes every owned observer/timer. */
  #closed = false
  /** At most one quiet-connection deadline belongs to this governor. */
  #idle: IScheduledTask | undefined
  /** Original deadline observers are detached even when business ignores cancellation. */
  readonly #observers = new Set<() => void>()
  /** Unpublished candidates also retire through their genuine physical lifetime. */
  #connectionSignal: IAbortSignal | undefined

  /** Capture one admitted carrier without a Session or a provider execution facade. */
  constructor(carrierId: string, options: IRpcLimitsOptions, ports: ILimitsGovernorPorts) {
    this.#carrierId = carrierId
    this.#options = options
    this.#ports = ports
    this.#windowStart = ports.scheduler.now()
    this.#lastInboundAt = this.#windowStart
  }

  /** Actual peer-ready publication begins the original idle lifetime. */
  ready(): void {
    this.#ready = true
    this.touch()
  }

  /** Bind the source lifetime once; physical loss removes even an uncommitted candidate. */
  bind(signal: IAbortSignal): void {
    if (this.#connectionSignal) return
    this.#connectionSignal = signal
    signal.addEventListener('abort', this.#connectionClosed, { once: true })
    if (signal.aborted) this.#connectionClosed()
  }

  /** Every physical inbound frame refreshes activity without starting another rate window. */
  touch(): void {
    this.#lastInboundAt = this.#ports.scheduler.now()
    this.#scheduleIdle()
  }

  /** Atomically admit a whole group's rate/payload budget before its first provider starts. */
  reserve(payloads: readonly unknown[]): number {
    /** The original bucket advances lazily only when another call seeks admission. */
    const now = this.#ports.scheduler.now()
    if (now - this.#windowStart >= RpcLimitsRateWindowMs) {
      this.#windowStart = now
      this.#calls = 0
    }
    if (
      this.#calls + payloads.length > (this.#options.maxCallsPerMinute ?? Infinity) ||
      (this.#options.maxPayloadBytes !== undefined &&
        payloads.some(
          (payload) =>
            portableBytes(
              payload as Parameters<typeof portableBytes>[0],
              this.#options.maxPayloadBytes
            ) > this.#options.maxPayloadBytes!
        ))
    ) {
      /** A selected native diagnostic remains public attachment only, never local control proof. */
      const diagnostic = this.#options.overflow
      /** Preserve selected native codes while retaining the original correlated quota summary. */
      const error = diagnostic
        ? attachErrorIdentity(new Error(diagnostic.message), {
            source: diagnostic.source,
            code: diagnostic.code
          })
        : createRpcError(
            RpcCoreErrorCode.overloaded,
            RpcCoreErrorText.providerAdmissionLimitReached
          )
      registerLocalErrorWireSummary(
        error,
        diagnostic?.code ?? RpcCoreErrorCode.overloaded,
        RpcCoreErrorText.providerFailed,
        { preserveSerializedError: true }
      )
      this.violate(error)
      throw error
    }
    this.#calls += payloads.length
    return this.#windowStart
  }

  /** Unstarted group credit can return only to its exact original minute bucket. */
  refund(window: number, remaining: number): void {
    if (this.#windowStart === window) this.#calls -= remaining
  }

  /** Native concurrency and quota refusals share the original consecutive-violation policy. */
  violate(error: unknown): void {
    this.#violations += 1
    if (this.#violations >= (this.#options.violationLimit ?? Infinity))
      deferTask(this.#ports.scheduler, () =>
        this.#requestClose(error, RpcSessionRetirement.liquidated)
      )
  }

  /** Lease activity begins only after rate and payload admission succeed. */
  begin(unsubscribe: () => void): void {
    this.#active += 1
    this.#observers.add(unsubscribe)
    this.#idle?.cancel()
    this.#idle = undefined
  }

  /** The lease already proved this is its one genuine local deadline. */
  timeout(error: unknown): void {
    if (this.#closed) return
    this.#timeouts += 1
    if (this.#timeouts === this.#options.maxConsecutiveTimeouts)
      deferTask(this.#ports.scheduler, () =>
        this.#requestClose(error, RpcSessionRetirement.liquidated)
      )
  }

  /** Only successful uncancelled actual completion resets consecutive policy failures. */
  finish(unsubscribe: () => void, succeeded: boolean): void {
    this.#observers.delete(unsubscribe)
    if (!this.#closed && succeeded) {
      this.#timeouts = 0
      this.#violations = 0
    }
    this.#active -= 1
    this.#scheduleIdle()
  }

  /** Native retirement clears original observers without pretending pending business completed. */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#connectionSignal?.removeEventListener('abort', this.#connectionClosed)
    this.#connectionSignal = undefined
    this.#idle?.cancel()
    this.#idle = undefined
    for (const unsubscribe of this.#observers) unsubscribe()
    this.#observers.clear()
    this.#ports.release(this.#carrierId, this)
  }

  /** Only the original physical source can end this governor's publication-independent lifetime. */
  readonly #connectionClosed = (): void => this.close()

  /** The policy borrows exact carrier retirement and preserves any original cleanup failure. */
  readonly #requestClose = (error: unknown, kind: RpcSessionRetirement): void => {
    if (!this.#closed)
      void this.#ports.retire(this.#carrierId, error, kind).catch(this.#ports.report)
  }

  /** A ready quiet connection with no real business may retire at its original idle deadline. */
  #scheduleIdle(): void {
    this.#idle?.cancel()
    this.#idle = undefined
    if (
      this.#closed ||
      !this.#ready ||
      this.#active > 0 ||
      this.#options.idleTimeoutMs === undefined
    )
      return
    this.#idle = this.#ports.scheduler.schedule(
      () => {
        this.#idle = undefined
        if (this.#closed || this.#active > 0) return
        if (this.#ports.scheduler.now() - this.#lastInboundAt >= this.#options.idleTimeoutMs!)
          this.#requestClose(
            createRpcLifecycleError(RpcLimitsIdleTimeoutText),
            RpcSessionRetirement.idle
          )
        else this.#scheduleIdle()
      },
      Math.max(0, this.#lastInboundAt + this.#options.idleTimeoutMs - this.#ports.scheduler.now())
    )
    this.#idle.unref?.()
  }
}
