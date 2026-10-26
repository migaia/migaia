/**
 * Owns one whole-message carrier's native listener set, writes, cold handoff and shared close
 * Promise. Borrows actual IO/capability ports and the complete codec; Session remains the receiver
 * and semantic lifetime owner, while native raw observation originates below this decoded
 * boundary.
 */
import { deferred } from '@migaia/utils/promise'
import { attachSecondaryErrors } from '@migaia/utils/error'
import type {
  IRpcCarrier,
  IRpcCarrierObservation,
  IRpcCarrierFrame,
  IRpcCarrierReceiver,
  IRpcCarrierWriteOptions,
  IRpcDispose
} from '@migaia/rpc-contract/interfaces'
import { createContractError, identifyRpcBoundaryFailure } from '@migaia/rpc-contract/errors'
import { RpcContractErrorCode, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import {
  createRpcAbortError,
  createRpcConfigurationError,
  createRpcLifecycleError
} from '../../host/error-owner.js'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { resolveAbortReason } from '../../host/abort-reason.js'
import { RpcCarrierCodecId, RpcCarrierErrorText } from './constants.js'
import { RpcJsonCarrierCodec } from './json-codec.js'
import type { IRpcMessageCarrierOptions } from './types.js'

/** Each original write remains owned until its native drain, physical close or original failure. */
type ICarrierWrite = ReturnType<typeof deferred<void>>

/**
 * Generic whole-message resource owns one native listener set and one actual physical-close
 * Promise.
 */
class RpcMessageCarrier implements IRpcCarrier {
  /** Native opt-in is lent unchanged; the generic factory grants no closing capability by default. */
  readonly closingWrites: IRpcCarrier['closingWrites']
  /** Only the actual transport may project a typed retirement onto its own error vocabulary. */
  readonly mapRetirement: IRpcCarrier['mapRetirement']
  /** Borrow original native completion without introducing another terminal wait or timeout. */
  readonly terminalReason: IRpcCarrier['terminalReason']
  /** Raw observation belongs to the native IO owner rather than this decoded frame boundary. */
  readonly observation: IRpcCarrierObservation | undefined
  /** Host-local connection identity remains supplied by the actual platform resource. */
  readonly id: string
  /** JSON is the common real codec; custom complete codecs may use the same physical owner. */
  readonly codecs = Object.freeze([RpcCarrierCodecId])
  /** Native storage is physical capability, independent of any remote proposal. */
  readonly nativeBinary: boolean
  /** The four executing media stages are held by this same physical resource. */
  readonly codec
  /** Native logical capacity remains owned by the original process feature. */
  readonly reserveWrite: IRpcCarrier['reserveWrite']
  /** Original native resource and error policy are captured without a legacy adapter wrapper. */
  readonly #options: IRpcMessageCarrierOptions
  /** Only Session's current receiver may observe frames or terminal delivery. */
  #receiver: IRpcCarrierReceiver | undefined
  /** One cold frame preserves the original pre-subscription handoff without a second receive queue. */
  #queued: unknown
  /** Occupancy distinguishes an actual undefined malformed frame from an empty cold slot. */
  #occupied = false
  /** Native callbacks are installed once and removed on this exact resource's close. */
  readonly #removers: IRpcDispose[] = []
  /** Native drain records are removed on settlement or physical close. */
  readonly #writes = new Set<ICarrierWrite>()
  /** Closing revokes new writes and deliveries synchronously. */
  #closing: Promise<void> | undefined
  /** The first original terminal reason is replayed to late subscribers. */
  #reason: unknown
  /** Native registration may synchronously close before returning its original disposer. */
  #constructing = true

  /** Acquire original native subscriptions and rollback them if partial registration fails. */
  constructor(options: IRpcMessageCarrierOptions) {
    this.#options = options
    this.closingWrites = options.closingWrites
    this.mapRetirement = options.mapRetirement
    this.terminalReason = options.terminalReason
    this.observation = options.observation
    this.id = options.id
    this.nativeBinary = options.nativeBinary ?? false
    this.codec = options.codec ?? new RpcJsonCarrierCodec({ digest: options.digest })
    this.reserveWrite = options.reserveWrite
    try {
      this.#removers.push(options.io.onMessage(this.#receive))
      this.#removers.push(options.io.onClose(this.#ended))
      if (options.io.onError) this.#removers.push(options.io.onError(this.#failed))
    } catch (primary) {
      void this.close(primary).catch(options.report)
      throw primary
    } finally {
      this.#constructing = false
    }
  }
  /** Transfer the cold frame before arbitrary reentrant delivery and return this receiver's remover. */
  subscribe(receiver: IRpcCarrierReceiver): IRpcDispose {
    if (this.#closing) {
      receiver.close(this.#reason)
      return () => undefined
    }
    this.#receiver = receiver
    /** The original single cold slot becomes empty before Session receives its held frame. */
    const queued = this.#queued
    /** Occupancy is cleared independently from the possibly undefined captured native value. */
    const occupied = this.#occupied
    this.#queued = undefined
    this.#occupied = false
    if (occupied) this.#notify(queued as IRpcCarrierFrame)
    return () => {
      if (this.#receiver === receiver) this.#receiver = undefined
    }
  }
  /** Borrow actual native capability semantics without confusing clone storage with transfer. */
  assertTransfer(signed?: boolean): void {
    if (this.#options.assertTransfer) this.#options.assertTransfer(signed)
    else if (!this.nativeBinary)
      throw createRpcConfigurationError(RpcCoreErrorText.runtimeProcessTransferInvalid)
  }

  /** Preserve native handoff order; late native failures remain reported even after local close. */
  write(frame: IRpcCarrierFrame, options?: IRpcCarrierWriteOptions): Promise<void> {
    if (this.#closing) return Promise.reject(this.#reason)
    if (options?.signal?.aborted)
      return Promise.reject(
        createRpcAbortError(undefined, undefined, resolveAbortReason(options.signal))
      )
    /** One original native write owns this completion until drain or local retirement. */
    const pending = deferred<void>()
    this.#writes.add(pending)
    try {
      /** The caller's original transfer list is never replaced with a list of copied buffers. */
      const result = this.#options.io.send(frame, options?.transfer, options)
      void Promise.resolve(result).then(
        () => {
          this.#writes.delete(pending)
          pending.resolve()
        },
        (cause: unknown) => {
          this.#writes.delete(pending)
          /** Native class, stack and exact original Error identity survive semantic tagging. */
          const error = identifyRpcBoundaryFailure(
            cause,
            RpcCoreErrorCode.transport,
            RpcCarrierErrorText.nativeSendFailed
          )
          if (this.#closing && error !== this.#reason) this.#options.report(error)
          pending.reject(error)
        }
      )
    } catch (cause) {
      this.#writes.delete(pending)
      pending.reject(
        identifyRpcBoundaryFailure(
          cause,
          RpcCoreErrorCode.transport,
          RpcCarrierErrorText.nativeSendFailed
        )
      )
    }
    return pending.promise
  }
  /** Deliver native whole frames unchanged; only the canonical codec/contract admits their contents. */
  readonly #receive = (value: unknown): void => {
    if (this.#closing) return
    if (this.#receiver) {
      this.#notify(value as IRpcCarrierFrame)
      return
    }
    if (this.#occupied) {
      this.#failed(
        createContractError(
          RpcContractErrorCode.handshakeInvalid,
          undefined,
          this.#options.errorMetadata
        )
      )
      return
    }
    this.#queued = value
    this.#occupied = true
  }
  /** Subscriber failures are diagnostic; they do not close an otherwise valid native source. */
  #notify(value: IRpcCarrierFrame): void {
    try {
      this.#receiver?.frame(value)
    } catch (error) {
      this.#report(error)
    }
  }
  /**
   * Attach the carrier boundary to the original callback Error without changing its native
   * identity.
   */
  #report(error: unknown): void {
    this.#options.report(
      identifyRpcBoundaryFailure(error, RpcCoreErrorCode.transport, RpcCoreErrorText.callbackFailed)
    )
  }
  /** Native close keeps its original reason and retires all local work through one cleanup owner. */
  readonly #ended = (reason?: unknown): void => {
    void this.close(reason).catch(this.#options.report)
  }
  /** Physical failure is delivered before terminal close, retaining the original error identity. */
  readonly #failed = (error: unknown): void => {
    try {
      this.#receiver?.error(error)
    } catch (failure) {
      this.#report(failure)
    }
    this.#ended(error)
  }
  /**
   * Publish close before notifying arbitrary callbacks; all original cleanup failures remain
   * reachable.
   */
  close(reason?: unknown): Promise<void> {
    if (this.#closing) return this.#closing
    /** Reentrant Session.close and native close join this exact completion. */
    const completion = deferred<void>()
    this.#closing = completion.promise
    this.#reason =
      reason ??
      this.#options.defaultCloseError?.() ??
      createRpcLifecycleError(RpcCoreErrorText.endpointDisposed)
    /** Receiver is detached before a close callback can reenter this physical resource. */
    const receiver = this.#receiver
    this.#receiver = undefined
    this.#queued = undefined
    this.#occupied = false
    for (const write of this.#writes) write.reject(this.#reason)
    this.#writes.clear()
    try {
      receiver?.close(this.#reason)
    } catch (error) {
      this.#report(error)
    }
    void this.#release().then(completion.resolve, completion.reject)
    return this.#closing
  }
  /** Reverse only actually acquired listeners, then join the original native physical close. */
  async #release(): Promise<void> {
    if (this.#constructing) await Promise.resolve()
    /** Listener cleanup precedes the original native resource's close failure. */
    const failures: unknown[] = []
    for (const remove of this.#removers.splice(0).reverse()) {
      try {
        await remove()
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      await this.#options.io.close(this.#reason)
    } catch (error) {
      failures.push(error)
    }
    if (failures.length === 1)
      throw identifyRpcBoundaryFailure(
        failures[0],
        RpcCoreErrorCode.transport,
        RpcCoreErrorText.endpointDisposalCleanupFailed
      )
    if (failures.length > 1)
      throw attachSecondaryErrors(
        createRpcLifecycleError(RpcCoreErrorText.endpointDisposalCleanupFailed, this.#reason),
        failures
      )
  }
}

/**
 * Hold one real whole-message carrier; platform-native EventEmitter/EventTarget adaptation stays
 * C3.
 */
export function createRpcMessageCarrier(options: IRpcMessageCarrierOptions): IRpcCarrier {
  return new RpcMessageCarrier(options)
}
