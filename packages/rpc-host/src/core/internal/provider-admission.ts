import { createRpcError, RpcCoreErrorCode, tagRpcError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'

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

/** The public quota handle affects only the original scope deliberately shared by its caller. */
export type IProviderAdmissionScope = Readonly<{
  /** Narrow this scope's original business limits; omitted values retain the original defaults. */
  constrain(maxGlobal?: number, maxPerPeer?: number): void
  /** Clear only the registry owned by this handle, retaining the existing disposal semantics. */
  clear(): void
}>

/** Core construction prepares the same registry after actual framing and Host commit are known. */
type IProviderAdmissionPreparation = (
  maxGlobal: number | undefined,
  maxPerPeer: number | undefined,
  maxIngress: number | undefined,
  commitPolicy: boolean
) => ProviderAdmissionRegistry

/** Exact quota handles resolve only inside their original Core admission owner. */
const admissionPreparations = new WeakMap<
  IProviderAdmissionScope,
  Readonly<{ prepare: IProviderAdmissionPreparation; owns(candidate: unknown): boolean }>
>()

/** Create one caller-owned lazy quota resource without publishing its registry or prepare port. */
export function createProviderAdmissionScope(): IProviderAdmissionScope {
  return ProviderAdmissionScope.create()
}

/** One caller-owned quota resource retains its registry without publishing admission authority. */
class ProviderAdmissionScope implements IProviderAdmissionScope {
  /** FIFO, receipts, and business state remain in the existing lazily created single registry. */
  #registry: ProviderAdmissionRegistry | undefined

  /** Freeze the public resource before its exact private construction ports become resolvable. */
  static create(): IProviderAdmissionScope {
    /** The exact scope identity is the only key capable of resolving this lazy registry. */
    const scope = new ProviderAdmissionScope()
    Object.freeze(scope)
    admissionPreparations.set(scope, { owns: scope.#owns, prepare: scope.#prepare })
    return scope
  }

  /** Narrow only an already constructed registry while retaining lazy scope semantics. */
  readonly constrain = (
    maxGlobal = DEFAULT_MAX_GLOBAL,
    maxPerPeer = DEFAULT_MAX_PER_PEER
  ): void => {
    validateLimits(maxGlobal, maxPerPeer)
    this.#registry?.constrainBusiness(maxGlobal, maxPerPeer)
  }

  /** Cleanup clears only this resource's original registry. */
  readonly clear = (): void => this.#registry?.clear()

  /** Structural copies cannot claim another scope's original admission owner. */
  #owns = (candidate: unknown): boolean =>
    this.#registry !== undefined && candidate === this.#registry

  /** Actual Core framing facts alone may create or narrow the original quota registry. */
  #prepare: IProviderAdmissionPreparation = (
    maxGlobal = DEFAULT_MAX_GLOBAL,
    maxPerPeer = DEFAULT_MAX_PER_PEER,
    maxIngress,
    commitPolicy
  ) => {
    validateLimits(maxGlobal, maxPerPeer, maxIngress)
    if (maxIngress === undefined || (this.#registry && !this.#registry.matchesFraming(maxIngress)))
      throw createRpcError(
        RpcCoreErrorCode.capabilityUnsupported,
        RpcCoreErrorText.capabilityUnsupported
      )
    if (this.#registry && commitPolicy) this.#registry.constrainBusiness(maxGlobal, maxPerPeer)
    return (this.#registry ??= new ProviderAdmissionRegistry(maxGlobal, maxPerPeer, maxIngress))
  }
}

/** Same-layer provider construction alone resolves a quota handle using its actual framing facts. */
export function prepareProviderAdmissionScope(
  scope: IProviderAdmissionScope,
  maxGlobal: number | undefined,
  maxPerPeer: number | undefined,
  maxIngress: number | undefined,
  commitPolicy = true
): ProviderAdmissionRegistry {
  /** A fabricated structural handle cannot resolve another scope's registry. */
  const prepare = admissionPreparations.get(scope)?.prepare
  if (!prepare)
    throw createRpcError(
      RpcCoreErrorCode.capabilityUnsupported,
      RpcCoreErrorText.capabilityUnsupported
    )
  return prepare(maxGlobal, maxPerPeer, maxIngress, commitPolicy)
}

/** Core's custom-root operation accepts only the registry belonging to its exact held quota scope. */
export function isProviderAdmissionScopeOwner(
  scope: IProviderAdmissionScope,
  candidate: unknown
): boolean {
  return admissionPreparations.get(scope)?.owns(candidate) === true
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
  /** Exact node retirement makes repeated cancellation/terminal release a no-op. */
  released?: boolean
  previous?: IOrderedEntry
  next?: IOrderedEntry
}

/** One native connection lends its original object identity and fixed call capacity. */
export type IProviderConnectionQuota = Readonly<{
  key: object
  maxConcurrent: number
}>

/** A physical quota shares the original logical lease, without another admission registry. */
type IProviderAdmissionLease = Readonly<{
  peerKey: string
  connectionKey: object
}>

/** Owns global and per-peer admission leases for provider execution. */
export class ProviderAdmissionRegistry {
  /** Each waiting or running business item owns one original global/per-peer lease. */
  readonly #leases = new Map<string, string | IProviderAdmissionLease>()
  /** Verified-peer strings and native-connection objects keep independent counts in the same owner. */
  readonly #peerCounts = new Map<string | object, number>()
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
  acquire(taskKey: string, peerKey: string, connectionQuota?: IProviderConnectionQuota): boolean {
    if (this.#leases.has(taskKey)) return false
    const peerCount = this.#peerCounts.get(peerKey) ?? 0
    if (
      this.#leases.size >= this.#maxGlobal ||
      peerCount >= this.#maxPerPeer ||
      (connectionQuota !== undefined &&
        (this.#peerCounts.get(connectionQuota.key) ?? 0) >= connectionQuota.maxConcurrent)
    )
      return false
    this.#leases.set(
      taskKey,
      connectionQuota ? { peerKey, connectionKey: connectionQuota.key } : peerKey
    )
    this.#peerCounts.set(peerKey, peerCount + 1)
    if (connectionQuota)
      this.#peerCounts.set(
        connectionQuota.key,
        (this.#peerCounts.get(connectionQuota.key) ?? 0) + 1
      )
    return true
  }

  /** Reserve every member against logical and physical bounds in the same synchronous transaction. */
  acquireMany(
    taskKeys: readonly string[],
    peerKey: string,
    connectionQuota?: IProviderConnectionQuota
  ): boolean {
    /** Group keys are trusted canonical identities allocated after complete profile/ACL checks. */
    const count = taskKeys.length
    if (
      count === 0 ||
      this.#leases.size + count > this.#maxGlobal ||
      (this.#peerCounts.get(peerKey) ?? 0) + count > this.#maxPerPeer ||
      (connectionQuota !== undefined &&
        (this.#peerCounts.get(connectionQuota.key) ?? 0) + count > connectionQuota.maxConcurrent)
    )
      return false
    /** Duplicate members cannot turn one lease into several units of purported capacity. */
    const unique = new Set(taskKeys)
    if (unique.size !== count || taskKeys.some((key) => this.#leases.has(key))) return false
    /** All original members share one immutable identity pair; each retains its own release key. */
    const lease = connectionQuota ? { peerKey, connectionKey: connectionQuota.key } : peerKey
    for (const key of taskKeys) this.#leases.set(key, lease)
    this.#peerCounts.set(peerKey, (this.#peerCounts.get(peerKey) ?? 0) + count)
    if (connectionQuota)
      this.#peerCounts.set(
        connectionQuota.key,
        (this.#peerCounts.get(connectionQuota.key) ?? 0) + count
      )
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
    if (!queue) start()
    /** Short cancellation callback retains only immutable identity; the registry owns all state. */
    return () => this.#releaseOrdered(entry)
  }

  /** Remove one queued or running order node in O(1), then start only its original successor. */
  #releaseOrdered(entry: IOrderedEntry): void {
    if (entry.released) return
    entry.released = true
    /** Node identity determines its original queue; no captured mutable release cache remains. */
    const current = this.#ordered?.get(entry.key)
    if (!current) return
    /** Only a completed head can make its same-queue successor eligible. */
    const wasHead = current.head === entry
    if (entry.previous) entry.previous.next = entry.next
    if (entry.next) entry.next.previous = entry.previous
    if (wasHead) {
      if (entry.next) current.head = entry.next
      else this.#ordered!.delete(entry.key)
    }
    if (current.tail === entry && entry.previous) current.tail = entry.previous
    entry.previous = undefined
    entry.next = undefined
    if (wasHead && this.#ordered?.get(entry.key) === current) current.head.start()
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
    /**
     * These short receipt callbacks capture this exact node identity and its owning scope only.
     * Linked ordering, capacity and submission state remain fields of ProviderAdmissionRegistry.
     */
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
    /** The original task key alone can retire both dimensions, including after queued cancellation. */
    const lease = this.#leases.get(taskKey)
    if (lease === undefined) return
    this.#leases.delete(taskKey)
    this.#releaseCount(typeof lease === 'string' ? lease : lease.peerKey)
    if (typeof lease !== 'string') this.#releaseCount(lease.connectionKey)
  }

  /** Both verified and physical counts retire under the same original lease exactly once. */
  #releaseCount(key: string | object): void {
    const count = this.#peerCounts.get(key) ?? 0
    if (count <= 1) this.#peerCounts.delete(key)
    else this.#peerCounts.set(key, count - 1)
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
