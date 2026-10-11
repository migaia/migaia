import type { IRpcTransport } from '../transport.js'

/** Deep native adapters observe physical lifetime and actual reader exclusivity. */
export type INativeReplayOwner = Readonly<{ alive(): boolean; exclusive(): boolean }>
/** Resource registrations are permanent weak identities; retiring never makes one fresh again. */
const owners = new WeakMap<object, { owner: INativeReplayOwner; receipt?: NativeReplayReceipt }>()
/** Native child ports defer all listener installation until their first canonical channel opens. */
const initializers = new WeakMap<object, () => INativeReplayOwner>()
/** Only canonical composition carries this capability to the final transport identity. */
const transports = new WeakMap<object, NativeReplayReceipt>()

/** Registers the exact launcher/stdio resource, never a public handle shape or metadata field. */
export function registerNativeReplayOwner(resource: object, owner: INativeReplayOwner): void {
  if (!owners.has(resource)) owners.set(resource, { owner })
}

/** Defers native observation; importing a deep adapter itself must not attach port listeners. */
export function registerLazyNativeReplayOwner(
  resource: object,
  initialize: () => INativeReplayOwner
): void {
  if (!owners.has(resource) && !initializers.has(resource)) initializers.set(resource, initialize)
}

/** A second wrapper permanently downgrades the first consumer instead of creating parallel L. */
export function bindNativeReplayTransport(resource: object, transport: IRpcTransport): void {
  /** Only a deep adapter's registered initializer may produce physical provenance. */
  const initialize = initializers.get(resource)
  if (!owners.has(resource) && initialize) {
    registerNativeReplayOwner(resource, initialize())
    initializers.delete(resource)
  }
  /** Missing registration means unsupported resource, with existing legacy behavior. */
  const registration = owners.get(resource)
  if (!registration) return
  if (registration.receipt) {
    registration.receipt.downgrade()
    return
  }
  registration.receipt = new NativeReplayReceipt(registration.owner)
  transports.set(transport, registration.receipt)
}

/** Canonical wrappers transfer provenance explicitly; user spread copies retain no authority. */
export function carryNativeReplayTransport(source: IRpcTransport, target: IRpcTransport): void {
  /** Exact source membership avoids reads of caller-defined transport getters. */
  const receipt = transports.get(source)
  if (receipt) transports.set(target, receipt)
}

/** Existing feature owners share the one endpoint receipt without claiming another consumer. */
export function nativeReplayReceipt(transport: IRpcTransport): NativeReplayReceipt | undefined {
  return transports.get(transport)
}

/** Claims exactly one endpoint; repeated claims lose L without closing outstanding work. */
export function claimNativeReplayTransport(
  transport: IRpcTransport
): NativeReplayReceipt | undefined {
  /** Only privately registered final transport identity is eligible. */
  const receipt = transports.get(transport)
  return receipt?.claim() ? receipt : undefined
}

/** Narrow core-facing receipt keeps native resource types out of runtime-neutral code. */
export type INativeReplayReceipt = NativeReplayReceipt

/** Owns permanent downgrade/retirement separately from actual native termination. */
export class NativeReplayReceipt {
  /** Platform owner observes native events and listener counts without importing them into core. */
  readonly #owner: INativeReplayOwner
  /** Claim is one-way; no later endpoint can restore L on this resource. */
  #claimed = false
  /** Loss of exclusivity retains in-flight operations and tightens their settlement retention. */
  #downgraded = false
  /** Physical terminal state is separate from a live legacy downgrade and never revives. */
  #retired = false
  /** Existing endpoint cleanup callbacks are triggered only from explicit owner checkpoints. */
  readonly #listeners = new Set<() => void>()

  /** Stores only platform-neutral observations from the registered native adapter. */
  constructor(owner: INativeReplayOwner) {
    this.#owner = owner
  }

  /** Claims once after verifying native lifetime and reader exclusivity. */
  claim(): boolean {
    if (this.#claimed) {
      this.downgrade()
      return false
    }
    if (this.#retired || this.#downgraded || !this.#owner.alive() || !this.#owner.exclusive())
      return false
    this.#claimed = true
    return true
  }

  /** Pure reads cannot synchronously close or clear a ledger during admission. */
  get active(): boolean {
    return !this.#retired
  }

  /** Eligibility is read-only; only explicit resource observations can change its state. */
  get qualified(): boolean {
    return this.#claimed && !this.#retired && !this.#downgraded
  }

  /** Competing consumers permanently return this resource to legacy retention without teardown. */
  downgrade(): void {
    this.#downgraded = true
  }

  /** Receiver and settlement owners call this before committing or releasing business entries. */
  observeOwner(): void {
    if (!this.#owner.alive()) this.retire()
    else if (!this.#owner.exclusive()) this.downgrade()
  }

  /** Connects physical retirement to the existing endpoint cleanup path. */
  onRetire(listener: () => void): () => void {
    if (this.#retired) listener()
    else this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Spends only this receipt; native process/Worker termination remains with its launcher. */
  retire(): void {
    if (this.#retired) return
    this.#retired = true
    for (const listener of this.#listeners) listener()
    this.#listeners.clear()
  }
}
