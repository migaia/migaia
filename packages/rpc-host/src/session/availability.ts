/**
 * Lends actual Session departure and same-name accepted readiness to originating call features.
 * Native readiness delegates to its existing generation owner; ordinary waiters live on the
 * existing namespace index and retain no business input, timer or alternate Session registry.
 */
import { observeAbortSubscription } from '@migaia/lifecycle/abort'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import type {
  IRpcAttemptAvailability,
  IRpcAvailableAttempt,
  IRpcNativeGeneration,
  IRpcSessionSelection,
  IRpcTargetSource
} from '@migaia/rpc-contract/interfaces'
import { RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { createRemoteLayerError } from '../host/remote-error-owner.js'

/** Readiness subscribers extend the actual namespace index rather than copying accepted entries. */
export type ISessionAvailabilityIndex = {
  names: Map<string, IRpcSessionSelection>
  waiting: Map<string, Set<SessionReadiness>>
  signal?: IAbortSignal
}

/** An availability port borrows only canonical lookup and original source-lifetime facts. */
type IAvailabilityOptions = Readonly<{
  index: ISessionAvailabilityIndex
  name: string
  carrierId: string
  source?: IRpcTargetSource
  native?: IRpcNativeGeneration
  currentIndex(): ISessionAvailabilityIndex | undefined
  signal(carrierId: string): IAbortSignal | undefined
  generation(carrierId: string): IRpcNativeGeneration | undefined
  report(error: unknown): void
}>

/** One narrow immutable snapshot borrows exact departure and readiness from its original owner. */
class AvailableSession implements IRpcAvailableAttempt {
  /** The real selected carrier is also the next attempt's physical admission fence. */
  readonly carrierId: string
  /** Only a genuine native owner supplies this optional execution-generation fact. */
  readonly generation: number | undefined
  /** Current selection and readiness remain owned by the actual table/native registration. */
  readonly #owner: SessionAvailability
  /** Ordinary departure borrows the existing Session controller, including its exact reason. */
  readonly #signal: IAbortSignal | undefined

  /** Capture real source facts before any physical departure can revoke table membership. */
  constructor(owner: SessionAvailability, carrierId: string, signal?: IAbortSignal) {
    this.#owner = owner
    this.carrierId = carrierId
    this.#signal = signal
    this.generation = owner.native?.current().generation
  }

  /** Subscribe before invocation; native and ordinary sources share one retry policy. */
  onLeave(listener: (reason: unknown) => void): () => void {
    if (this.#owner.native) return this.#owner.native.onLeave(this.generation!, listener)
    return observeAbortSubscription(this.#signal!, listener, this.#owner.report).unsubscribe
  }

  /** Only genuinely accepted readiness can authorize another physical attempt. */
  async whenReady(signal?: IAbortSignal): Promise<IRpcAvailableAttempt> {
    if (!this.#owner.native) return new SessionReadiness(this.#owner, this.carrierId).start(signal)
    await this.#owner.native.whenReady(this.generation!, signal)
    /** The native owner must have committed a selectable physical replacement after readiness. */
    const current = this.#owner.current()
    if (!current) throw createRemoteLayerError(RpcRemoteLayerErrorCode.closed)
    return current
  }
}

/** This projection owns no native generation, Session, business waiter or readiness timer. */
export class SessionAvailability implements IRpcAttemptAvailability {
  /** Immutable address and source collaborators remain valid through one logical invocation. */
  readonly #options: IAvailabilityOptions
  /** A private member borrows its original generation owner without table-indexing the member. */
  readonly native: IRpcNativeGeneration | undefined
  /** Exact registration lifetime owns only its matching-name readiness subscriptions. */
  readonly index: ISessionAvailabilityIndex
  /** The admitted display name selects replacements within the same installed namespace index. */
  readonly name: string
  /** Secondary subscription cleanup keeps the actual Host diagnostic boundary. */
  readonly report: (error: unknown) => void

  /** Capture actual owner ports rather than synthesize an ordinary native generation. */
  constructor(options: IAvailabilityOptions) {
    this.#options = options
    this.native = options.native
    this.index = options.index
    this.name = options.name
    this.report = options.report
  }

  /** O(1) lookup returns only an accepted current source, never a pending handshake candidate. */
  current(): IRpcAvailableAttempt | undefined {
    if (this.native && !this.native.current().active) return undefined
    if (!this.#options.source && this.#options.currentIndex() !== this.index) return undefined
    /** Private sources keep their member index; ordinary selection borrows the canonical name Map. */
    const selected = this.#options.source
      ? this.#options.source.current(this.#options.carrierId)
      : this.index.names.get(this.name)
    if (!selected) return undefined
    if (this.native && this.#options.generation(selected.carrierId) !== this.native)
      return undefined
    /** Captured physical cancellation stays valid even after retirement removes this carrier id. */
    const signal = this.#options.signal(selected.carrierId)
    if (!this.native && (!signal || signal.aborted)) return undefined
    return new AvailableSession(this, selected.carrierId, signal)
  }
}

/** One exact readiness waiter holds settlement and abort receipts, never a call body or frame. */
class SessionReadiness {
  /** The actual table index and source projection own all accepted identity facts. */
  readonly #owner: SessionAvailability
  /** A directory refresh of the departed physical source cannot authorize replay. */
  readonly #after: string
  /** Every readiness join returns this one actual completion Promise. */
  readonly #completion = deferred<IRpcAvailableAttempt>()
  /** Caller and registration abort subscriptions are released before exposing settlement. */
  readonly #removers: Array<() => void> = []
  /** Reentrant abort/acceptance cannot settle twice or retain a late acquired remover. */
  #settled = false

  /** Capture the original matching-name owner without registering an alternate connection. */
  constructor(owner: SessionAvailability, after: string) {
    this.#owner = owner
    this.#after = after
  }

  /** Publish exact membership before acquiring cancellation, then recheck actual accepted state. */
  start(signal?: IAbortSignal): Promise<IRpcAvailableAttempt> {
    /** Only this existing namespace/name cell retains readiness subscribers during disconnection. */
    const waiting = this.#owner.index.waiting
    /** Set membership makes cancellation and terminal cleanup independent of other waiting calls. */
    let entries = waiting.get(this.#owner.name)
    if (!entries) waiting.set(this.#owner.name, (entries = new Set()))
    entries.add(this)
    try {
      for (const source of [signal, this.#owner.index.signal]) {
        if (!source || this.#settled) continue
        /** Already-aborted registration may settle before this exact remover is returned. */
        const receipt = observeAbortSubscription(source, this.reject, this.#owner.report)
        if (this.#settled) receipt.unsubscribe()
        else this.#removers.push(receipt.unsubscribe)
      }
      this.ready()
    } catch (error) {
      this.reject(error)
    }
    return this.#completion.promise
  }

  /** Canonical publication wakes only this name's interested waiters, with no Session scan. */
  ready(): void {
    if (this.#settled) return
    /** Only actual newly accepted media can release the original retry readiness wait. */
    const current = this.#owner.current()
    if (current && current.carrierId !== this.#after) {
      this.#release()
      this.#completion.resolve(current)
    }
  }

  /** Exact caller/registration/Host close reasons survive readiness cancellation unchanged. */
  readonly reject = (reason: unknown): void => {
    if (this.#settled) return
    this.#release()
    this.#completion.reject(reason)
  }

  /** Remove membership and both original abort receipts before any Promise continuation runs. */
  #release(): void {
    this.#settled = true
    /** An obsolete waiter cannot remove another operation sharing this same display name. */
    const entries = this.#owner.index.waiting.get(this.#owner.name)
    entries?.delete(this)
    if (entries?.size === 0) this.#owner.index.waiting.delete(this.#owner.name)
    for (const remove of this.#removers) remove()
    this.#removers.length = 0
  }
}

/** Only a canonical accepted publication can announce readiness for this exact name. */
export function publishSessionReadiness(index: ISessionAvailabilityIndex, name: string): void {
  for (const waiter of index.waiting.get(name) ?? []) waiter.ready()
}

/** Final table close rejects only readiness subscribers through the existing close reason. */
export function closeSessionReadiness(index: ISessionAvailabilityIndex, reason: unknown): void {
  for (const entries of index.waiting.values()) for (const waiter of entries) waiter.reject(reason)
}
