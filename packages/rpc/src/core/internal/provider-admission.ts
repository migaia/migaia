import { RpcCoreErrorText } from '../error-text.js'
import { RpcError, tagRpcError, RpcCoreErrorCode } from '../errors.js'

/** Original endpoint execution capacity; opt-in shared scopes preserve this default. */
const DEFAULT_MAX_GLOBAL = 256
/** Original verified-peer execution capacity, including waiting and running work. */
const DEFAULT_MAX_PER_PEER = 64

/** Validate the same owner limits at construction and when another physical session joins it. */
function validateLimits(maxGlobal: number, maxPerPeer: number, maxIngress?: number): void {
  if (
    ![maxGlobal, maxPerPeer].every(Number.isSafeInteger) ||
    maxGlobal < 1 ||
    maxPerPeer < 1 ||
    (maxIngress !== undefined && (!Number.isSafeInteger(maxIngress) || maxIngress < 1))
  )
    throw tagRpcError(
      new TypeError(RpcCoreErrorText.providerAdmissionLimitsMustBePositiveSafeIntegers),
      RpcCoreErrorCode.invalidConfig
    )
}

/** A cold original owner stores one registry reference, without another queue, quota or lifecycle. */
export type IProviderAdmissionScope = Readonly<{
  prepare(
    maxGlobal: number | undefined,
    maxPerPeer: number | undefined,
    maxIngress: number | undefined,
    commitPolicy?: boolean
  ): ProviderAdmissionRegistry
  /** Original Host install commit applies only its actually prepared, successful source policy. */
  constrain(maxGlobal: number | undefined, maxPerPeer: number | undefined): void
  clear(): void
}>

/** Delay assembly until actual framing facts exist; every joined session then borrows this scope. */
export function createProviderAdmissionScope(): IProviderAdmissionScope {
  /** All FIFO, receipt and business state remains exclusively in this one original registry. */
  let registry: ProviderAdmissionRegistry | undefined
  return Object.freeze({
    /** Candidates validate framing without changing an already committed provider's business bound. */
    prepare(
      maxGlobal = DEFAULT_MAX_GLOBAL,
      maxPerPeer = DEFAULT_MAX_PER_PEER,
      maxIngress,
      commitPolicy = true
    ) {
      validateLimits(maxGlobal, maxPerPeer, maxIngress)
      if (maxIngress === undefined || (registry && !registry.matchesFraming(maxIngress)))
        throw new RpcError(
          RpcCoreErrorCode.capabilityUnsupported,
          RpcCoreErrorText.capabilityUnsupported
        )
      if (registry && commitPolicy) registry.constrainBusiness(maxGlobal, maxPerPeer)
      return (registry ??= new ProviderAdmissionRegistry(maxGlobal, maxPerPeer, maxIngress))
    },
    constrain(maxGlobal = DEFAULT_MAX_GLOBAL, maxPerPeer = DEFAULT_MAX_PER_PEER) {
      validateLimits(maxGlobal, maxPerPeer)
      registry?.constrainBusiness(maxGlobal, maxPerPeer)
    },
    clear: () => registry?.clear()
  })
}

/** An opt-in physical candidate retains no unverified caller, method or order-key bucket. */
type IIngressEntry = {
  previous?: IIngressEntry
  next?: IIngressEntry
  submit?: () => void
}

/** Only canonical ingress can mark verification complete or withdraw this exact candidate. */
export type IProviderIngressReceipt = Readonly<{
  ready(submit: () => void): boolean
  release(): boolean
}>

/** An ordered item already owns its original business lease; this node owns only FIFO linkage. */
type IOrderedEntry = {
  readonly key: string
  readonly start: () => void
  previous?: IOrderedEntry
  next?: IOrderedEntry
}

/** Owns global and per-peer admission leases for provider execution. */
export class ProviderAdmissionRegistry {
  /** Each waiting or running business item owns one original global/per-peer lease. */
  readonly #leases = new Map<string, string>()
  /** Verified peers share the original execution limit across methods and ordered keys. */
  readonly #peerCounts = new Map<string, number>()
  /** The original provider quota bounds all business modes, including group members. */
  #maxGlobal: number
  /** Per-peer occupancy includes queued work and never uses an unverified selector field. */
  #maxPerPeer: number
  /** Independent candidate capacity comes only from once-read canonical framing facts. */
  readonly #maxIngress: number | undefined
  /** The receipt chain is allocated only for the independent application profile. */
  #ingress: Set<IIngressEntry> | undefined
  /** Arrival head can block business submission while authenticated controls withdraw directly. */
  #head: IIngressEntry | undefined
  /** Tail preserves physical arrival order across all sessions sharing this provider scope. */
  #tail: IIngressEntry | undefined
  /** Lazy opt-in key heads and tails share this logical provider across methods and sessions. */
  #ordered: Map<string, { head: IOrderedEntry; tail: IOrderedEntry }> | undefined

  /** Capture bounded owner limits once; no framing proof means no new-profile ingress capacity. */
  constructor(
    maxGlobal = DEFAULT_MAX_GLOBAL,
    maxPerPeer = DEFAULT_MAX_PER_PEER,
    maxIngress?: number
  ) {
    validateLimits(maxGlobal, maxPerPeer, maxIngress)
    this.#maxGlobal = maxGlobal
    this.#maxPerPeer = maxPerPeer
    this.#maxIngress = maxIngress
  }

  /** A physical candidate count stays fixed for the complete logical-provider scope lifetime. */
  matchesFraming(maxIngress: number): boolean {
    return this.#maxIngress === maxIngress
  }

  /** Committed cold policies only tighten subsequent admissions; existing leases remain exact. */
  constrainBusiness(maxGlobal: number, maxPerPeer: number): void {
    this.#maxGlobal = Math.min(this.#maxGlobal, maxGlobal)
    this.#maxPerPeer = Math.min(this.#maxPerPeer, maxPerPeer)
  }

  /** Atomically reserves one task lease; duplicate keys are rejected. */
  acquire(taskKey: string, peerKey: string): boolean {
    if (this.#leases.has(taskKey)) return false
    const peerCount = this.#peerCounts.get(peerKey) ?? 0
    if (this.#leases.size >= this.#maxGlobal || peerCount >= this.#maxPerPeer) return false
    this.#leases.set(taskKey, peerKey)
    this.#peerCounts.set(peerKey, peerCount + 1)
    return true
  }

  /** Reserve all group member leases at one synchronous point; refusal changes no occupancy. */
  acquireMany(taskKeys: readonly string[], peerKey: string): boolean {
    /** Group keys are trusted canonical identities allocated after complete profile/ACL checks. */
    const count = taskKeys.length
    if (
      count === 0 ||
      this.#leases.size + count > this.#maxGlobal ||
      (this.#peerCounts.get(peerKey) ?? 0) + count > this.#maxPerPeer
    )
      return false
    /** Duplicate members cannot turn one lease into several units of purported capacity. */
    const unique = new Set(taskKeys)
    if (unique.size !== count || taskKeys.some((key) => this.#leases.has(key))) return false
    for (const key of taskKeys) this.#leases.set(key, peerKey)
    this.#peerCounts.set(peerKey, (this.#peerCounts.get(peerKey) ?? 0) + count)
    return true
  }

  /** Join one authenticated key FIFO after business admission; different keys start independently. */
  enqueueOrder(orderKey: string, start: () => void): () => void {
    const entry: IOrderedEntry = { key: orderKey, start }
    this.#ordered ??= new Map()
    const queue = this.#ordered.get(orderKey)
    if (queue) {
      entry.previous = queue.tail
      queue.tail.next = entry
      queue.tail = entry
    } else this.#ordered.set(orderKey, { head: entry, tail: entry })
    /** Exact removal handles both queued cancellation and actual terminal completion. */
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      const current = this.#ordered?.get(orderKey)
      if (!current) return
      const wasHead = current.head === entry
      if (entry.previous) entry.previous.next = entry.next
      if (entry.next) entry.next.previous = entry.previous
      if (wasHead) {
        if (entry.next) current.head = entry.next
        else this.#ordered!.delete(orderKey)
      }
      if (current.tail === entry && entry.previous) current.tail = entry.previous
      entry.previous = undefined
      entry.next = undefined
      if (wasHead && this.#ordered?.get(orderKey) === current) current.head.start()
    }
    if (!queue) start()
    return release
  }

  /** Capture one bounded arrival before authentication; it never reserves a business lease. */
  captureIngress(): IProviderIngressReceipt | undefined {
    if (this.#maxIngress === undefined || (this.#ingress?.size ?? 0) >= this.#maxIngress)
      return undefined
    /** This one node is both capacity accounting and arrival ordering, not a second queue. */
    const entry: IIngressEntry = { previous: this.#tail }
    this.#ingress ??= new Set()
    this.#ingress.add(entry)
    if (this.#tail) this.#tail.next = entry
    else this.#head = entry
    this.#tail = entry
    return Object.freeze({
      ready: (submit: () => void): boolean => {
        if (!this.#ingress?.has(entry) || entry.submit !== undefined) return false
        entry.submit = submit
        this.#submitPrefix()
        return true
      },
      release: (): boolean => {
        if (!this.#withdraw(entry)) return false
        this.#submitPrefix()
        return true
      }
    })
  }

  /** Withdraw exact candidate identity in O(1), including authenticated control bypass/close. */
  #withdraw(entry: IIngressEntry): boolean {
    if (!this.#ingress?.delete(entry)) return false
    if (entry.previous) entry.previous.next = entry.next
    else this.#head = entry.next
    if (entry.next) entry.next.previous = entry.previous
    else this.#tail = entry.previous
    entry.previous = undefined
    entry.next = undefined
    return true
  }

  /** Only complete business prefixes reach the original executor, which owns execution failures. */
  #submitPrefix(): void {
    while (this.#head?.submit) {
      /** Release physical retention before the executor applies its separate logical quota. */
      const entry = this.#head
      /** Submitting enqueues canonical execution; it does not await provider completion. */
      const submit = entry.submit!
      this.#withdraw(entry)
      submit()
    }
  }

  /** Releases a task lease exactly once. */
  release(taskKey: string): void {
    const peerKey = this.#leases.get(taskKey)
    if (peerKey === undefined) return
    this.#leases.delete(taskKey)
    const count = this.#peerCounts.get(peerKey) ?? 0
    if (count <= 1) this.#peerCounts.delete(peerKey)
    else this.#peerCounts.set(peerKey, count - 1)
  }

  /** Reports the number of active admission leases without exposing the lease map. */
  get size(): number {
    return this.#leases.size
  }

  /** Clears all leases during endpoint disposal. */
  clear(): void {
    this.#leases.clear()
    this.#peerCounts.clear()
    this.#ingress?.clear()
    this.#head = undefined
    this.#tail = undefined
    this.#ordered?.clear()
  }
}
