import type { IWebRpcProvider } from '../typing.js'

/** Snapshot of endpoint-owned lifecycle state exposed only to package tests. */
export type IWebRpcEndpointDebugSnapshot = {
  readonly phase: (typeof WebRpcDebugPhase)[keyof typeof WebRpcDebugPhase]
  readonly pending: number
  readonly pingPending: number
  readonly activeControllers: number
  /** Provider-operation counts observed without exposing mutable owner state. */
  readonly providerState?: {
    readonly admission: number
    readonly replay: number
  }
  readonly chunks: number
  readonly providers: number
  readonly events: number
  readonly hooks: number
  readonly resources: number
  /** Exact runtime owner identities allocated under the endpoint's canonical kernel. */
  readonly owners: readonly string[]
  readonly discovery: {
    readonly local: number
    readonly remote: number
    readonly waiters: number
    readonly tasks: number
    readonly timers: number
    readonly manualWaiters: number
    readonly inboundQueries: number
    readonly inboundTimers: number
  }
}

/** Immutable provider registration fact recorded at the canonical registry boundary. */
export type IWebRpcProviderRegistration = {
  readonly method: string
  readonly provider: IWebRpcProvider
}

type IEndpointSnapshotReader = () => IWebRpcEndpointDebugSnapshot

/** Passive time-port events used to verify endpoint-local clock ownership without controlling it. */
export type IWebRpcTimePortEvent =
  | { readonly kind: 'now'; readonly value: number }
  | { readonly kind: 'setTimeout'; readonly delayMs: number; readonly timer: object }
  | { readonly kind: 'clearTimeout'; readonly timer: object }

/** Immutable fault inputs used only by package-owned discovery lifecycle tests. */
export type IWebRpcDiscoveryCleanupFaults = {
  readonly route?: readonly unknown[]
  readonly replay?: readonly unknown[]
  readonly registry?: readonly unknown[]
}

/** Returns a registered package-test reader for transfer across a composed surface. */
export function getEndpointDebugSnapshotReader(
  endpoint: object
): IEndpointSnapshotReader | undefined {
  return readers.get(endpoint)
}

const readers = new WeakMap<object, IEndpointSnapshotReader>()
const discoveryCleanupFaults = new WeakMap<object, IWebRpcDiscoveryCleanupFaults>()
const endpointTimePorts = new WeakMap<object, object>()
const endpointTimePortObservers = new WeakMap<object, (event: IWebRpcTimePortEvent) => void>()

/** Associates the canonical endpoint with its existing kernel time port for package tests only. */
export function registerEndpointTimePortOwner(endpoint: object, timePort: object): void {
  endpointTimePorts.set(endpoint, timePort)
}

/** Registers one passive observer; registration cannot allocate, mutate, or dispose time state. */
export function registerEndpointTimePortObserver(
  endpoint: object,
  observer: (event: IWebRpcTimePortEvent) => void
): () => void {
  const timePort = endpointTimePorts.get(endpoint)
  if (timePort === undefined) return () => undefined
  endpointTimePortObservers.set(timePort, observer)
  return () => {
    if (endpointTimePortObservers.get(timePort) === observer)
      endpointTimePortObservers.delete(timePort)
  }
}

/** Reports a passive event without allowing diagnostics to affect clock or timer semantics. */
export function reportEndpointTimePortEvent(timePort: object, event: IWebRpcTimePortEvent): void {
  const observer = endpointTimePortObservers.get(timePort)
  if (observer === undefined) return
  try {
    observer(event)
  } catch {
    // Test observation is deliberately non-interfering with the canonical time owner.
  }
}

/** Registers immutable discovery cleanup faults for one exact endpoint test transaction. */
export function registerDiscoveryCleanupFaults(
  endpoint: object,
  faults: IWebRpcDiscoveryCleanupFaults
): () => void {
  const snapshot = Object.freeze({
    ...(faults.route === undefined ? {} : { route: Object.freeze([...faults.route]) }),
    ...(faults.replay === undefined ? {} : { replay: Object.freeze([...faults.replay]) }),
    ...(faults.registry === undefined ? {} : { registry: Object.freeze([...faults.registry]) })
  })
  discoveryCleanupFaults.set(endpoint, snapshot)
  return () => {
    if (discoveryCleanupFaults.get(endpoint) === snapshot) discoveryCleanupFaults.delete(endpoint)
  }
}

/** Reads immutable faults for the exact endpoint; copied or unrelated objects fail closed. */
export function readDiscoveryCleanupFaults(
  endpoint: unknown
): IWebRpcDiscoveryCleanupFaults | undefined {
  if (typeof endpoint !== 'object' || endpoint === null) return undefined
  return discoveryCleanupFaults.get(endpoint)
}
type IProviderRegistrationObservationState = {
  readonly token: object
  readonly entries: IWebRpcProviderRegistration[]
}

const providerRegistrationObservations = new WeakMap<
  object,
  IProviderRegistrationObservationState
>()

type IInboundIdentityReleaseObservationState = {
  readonly token: object
  releases: number
}

const inboundIdentityReleaseObservations = new WeakMap<
  object,
  IInboundIdentityReleaseObservationState
>()

type IProviderResultDisposalObservationState = {
  readonly token: object
  disposals: number
  readonly results: object[]
}

const providerResultDisposalObservations = new WeakMap<
  object,
  IProviderResultDisposalObservationState
>()

/** Registers a non-public lifecycle snapshot reader for deterministic package tests. */
export function registerEndpointDebugSnapshot(
  endpoint: object,
  reader: IEndpointSnapshotReader
): void {
  readers.set(endpoint, reader)
}

/** Reads an endpoint lifecycle snapshot without adding it to the public API. */
export function readEndpointDebugSnapshot(
  endpoint: object
): IWebRpcEndpointDebugSnapshot | undefined {
  return readers.get(endpoint)?.()
}

/** Registers passive provider facts for one exact transaction identity. */
export function registerProviderRegistrationObservation(transaction: object): () => void {
  const token = {}
  providerRegistrationObservations.set(transaction, { token, entries: [] })
  return () => {
    const observation = providerRegistrationObservations.get(transaction)
    if (observation?.token === token) providerRegistrationObservations.delete(transaction)
  }
}

/** Appends one immutable provider fact without executing test-controlled code. */
export function recordProviderRegistration(
  transaction: unknown,
  method: string,
  provider: IWebRpcProvider
): void {
  if (typeof transaction !== 'object' || transaction === null) return
  const observation = providerRegistrationObservations.get(transaction)
  if (observation) observation.entries.push(Object.freeze({ method, provider }))
}

/** Reads a frozen copy for the exact transaction identity; absent or copied keys fail closed. */
export function readProviderRegistrationObservation(
  transaction: unknown
): readonly IWebRpcProviderRegistration[] | undefined {
  if (typeof transaction !== 'object' || transaction === null) return undefined
  const observation = providerRegistrationObservations.get(transaction)
  return observation ? Object.freeze([...observation.entries]) : undefined
}

/** @internal Registers a passive release counter for one exact inbound-identity owner instance. */
export function registerInboundIdentityReleaseObservation(identity: object): () => void {
  const token = {}
  inboundIdentityReleaseObservations.set(identity, { token, releases: 0 })
  return () => {
    const observation = inboundIdentityReleaseObservations.get(identity)
    if (observation?.token === token) inboundIdentityReleaseObservations.delete(identity)
  }
}

/** @internal Records the canonical admission lease release without invoking test-controlled code. */
export function recordInboundIdentityRelease(identity: object): void {
  const observation = inboundIdentityReleaseObservations.get(identity)
  if (observation) observation.releases += 1
}

/** @internal Reads the release count for one exact owner instance; copied or unrelated objects fail closed. */
export function readInboundIdentityReleaseObservation(identity: unknown): number | undefined {
  if (typeof identity !== 'object' || identity === null) return undefined
  return inboundIdentityReleaseObservations.get(identity)?.releases
}

/** @internal Registers passive disposal observation for one exact provider transaction. */
export function registerProviderResultDisposalObservation(transaction: object): () => void {
  const token = {}
  providerResultDisposalObservations.set(transaction, { token, disposals: 0, results: [] })
  return () => {
    const observation = providerResultDisposalObservations.get(transaction)
    if (observation?.token === token) providerResultDisposalObservations.delete(transaction)
  }
}

/** @internal Records successful disposal and its exact result at the native boundary. */
export function recordProviderResultDisposal(transaction: object, result: object): void {
  const observation = providerResultDisposalObservations.get(transaction)
  if (observation) {
    observation.disposals += 1
    observation.results.push(result)
  }
}

/** @internal Reads one exact provider transaction's passive native-result disposal record. */
export function readProviderResultDisposalObservation(
  transaction: unknown
): { readonly disposals: number; readonly results: readonly object[] } | undefined {
  if (typeof transaction !== 'object' || transaction === null) return undefined
  const observation = providerResultDisposalObservations.get(transaction)
  if (!observation) return undefined
  return Object.freeze({
    disposals: observation.disposals,
    results: Object.freeze([...observation.results])
  })
}
import { WebRpcDebugPhase } from '../protocol-constants.js'
