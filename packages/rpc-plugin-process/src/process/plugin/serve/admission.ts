/**
 * Shares native capacity across pending and ready connections through exact-release leases. This
 * count governs acquired connections rather than provider call concurrency.
 */
import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'
import { createProcessError, createProcessRangeError } from '../../error.js'
import { DEFAULT_MAX_CONNECTIONS } from '../../resilience/constants.js'

/** Pending and ready native connections share the same actual installation capacity. */
type IProcessConnectionState = { active: number; closed: boolean }
/** A successful native acquisition releases exactly once after transfer or rollback. */
export type IProcessConnectionLease = Readonly<{ release(): void }>

/** A lease owns its release bit while the capacity owner retains the shared native count. */
class ProcessConnectionLease implements IProcessConnectionLease {
  /** The only shared count belongs to the original native admission owner. */
  readonly #state: IProcessConnectionState
  /** Repeated native cleanup cannot release another connection's quota. */
  #released = false

  /** Capture an already acquired slot without allocating a second connection table. */
  constructor(state: IProcessConnectionState) {
    this.#state = state
  }
  /** Release this original native slot once, including after the owner has closed admission. */
  readonly release = (): void => {
    if (this.#released) return
    this.#released = true
    this.#state.active--
  }
}

/** Native physical capacity is independent from optional business/provider governance. */
export class ProcessConnectionCapacity {
  /** Only pending/committed native acquisitions change this count; no provider data is retained. */
  readonly #state: IProcessConnectionState = { active: 0, closed: false }
  /** This installation captures the original positive safe-integer connection maximum once. */
  readonly #maximum: number

  /** Validate the same capacity before any listener or child source acquires native resources. */
  constructor(maximum = DEFAULT_MAX_CONNECTIONS) {
    if (!Number.isSafeInteger(maximum) || maximum <= 0)
      throw createProcessRangeError('maxConnections')
    this.#maximum = maximum
  }
  /** Admission preserves original closed/limit errors and claims before asynchronous preparation. */
  claim(): IProcessConnectionLease {
    if (this.#state.closed) throw createProcessError(RpcProcessErrorCode.channelClosed)
    if (this.#state.active >= this.#maximum)
      throw createProcessError(RpcProcessErrorCode.connectionLimit)
    this.#state.active++
    return new ProcessConnectionLease(this.#state)
  }
  /** Closing admission leaves existing resources and their original lease receipts intact. */
  close(): void {
    this.#state.closed = true
  }
}
