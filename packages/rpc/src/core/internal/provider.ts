import { createEventChannel, withSnapshotEntries } from '@migaia/event-subscriber'
import type { ICanonicalEventChannel } from '@migaia/event-subscriber'
import type { IRpcEventListener, IRpcProvider } from '../typing.js'
import type { IRpcAbortSignal, IRpcContext } from '../typing.js'
import type { IRpcRouteHeader } from '../../contract/v1/route.js'
import {
  registerLocalErrorWireSummary,
  registerLocalErrorWireRoute,
  localErrorWireRoute
} from '../../contract/contract-error.js'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcPortableValue } from '../../contract/types.js'
import type {
  IRpcRuntimeCompletion,
  IRpcRuntimeEnvelope,
  IRpcRuntimeStream,
  IRpcRuntimeOutcomeResult
} from '../../contract/runtime-api/types.js'

/** The original executor hands start, identity and seal authority to its registered stream owner. */
export type IProviderRuntimeStream = Readonly<{
  envelope: Extract<IRpcRuntimeEnvelope, { kind: 'runtime-call' }>
  signal: IRpcAbortSignal
  /** Reverse source identity comes from the admitted native/authentication owner. */
  replyReceiverId?: string
  /** A relay retains its local stream lifetime while the final provider receives start intent. */
  forwarded?: boolean
  /** Relay readiness and finish stay on the actual downstream consumer, without an extra ACK. */
  prepareStream?(context: IRpcContext): Promise<void>
  finishStream?(reason?: unknown): Promise<void>
  seal(completion: IRpcRuntimeCompletion): Promise<void>
  bindControl(handler: (payload: IRpcRuntimeStream) => Promise<void>): void
  bindCancel(handler: (reason?: unknown) => Promise<void>): void
}>

/** A compiled relay uses the same registry and preserves one complete downstream operation. */
export type IProviderRuntimeRelay = Readonly<{
  execute(context: IRpcContext): Promise<IRpcPortableValue | undefined>
  stream(context: IRpcContext): AsyncIterableIterator<IRpcPortableValue>
  prepareStream(context: IRpcContext): Promise<void>
  finishStream(reason?: unknown): Promise<void>
}>

/** One original policy owner reserves an entire group before any member can execute. */
export type IProviderAdmissionReservation = Readonly<{
  consume(): void
  release(): void
}>

/** The provider's existing quota owner exposes only atomic reservation and exact rollback. */
export type IProviderBulkAdmission = Readonly<{
  reserveMany(payloads: readonly (IRpcPortableValue | undefined)[]): IProviderAdmissionReservation
}>

/** The registered native callback retains its original tracked invocation and shared quota owner. */
export type IProviderBulkRegistration = Readonly<{
  admission: IProviderBulkAdmission
  invoke: IRpcProvider
}>

/** The original generation event is the cause of a forwarding execution's terminal failure. */
export function createProviderGenerationRetired(cause: unknown): RpcError {
  return new RpcError(
    RpcCoreErrorCode.providerGenerationRetired,
    RpcCoreErrorText.providerGenerationRetired,
    cause
  )
}

/** Add admitted node metadata without replacing the provider's error, stack, or cause identity. */
export function retainProviderFailureRoute(error: unknown, route?: readonly string[]): unknown {
  if (error instanceof Error && route && route.length > 0 && !localErrorWireRoute(error))
    registerLocalErrorWireRoute(error, route)
  return error
}

/** Refuse loops and a fourth forwarding node before the original provider allocates admission. */
export function assertProviderForwardRoute(
  route: readonly string[],
  nodeId: string,
  nextNodeId: string | undefined
): void {
  /** The canonical core owner constructs each public code at its actual rejection branch. */
  const error =
    route.includes(nodeId) ||
    (nextNodeId !== undefined && (nextNodeId === nodeId || route.includes(nextNodeId)))
      ? new RpcError(RpcCoreErrorCode.forwardLoop, RpcCoreErrorText.forwardLoop)
      : route.length >= 4
        ? new RpcError(RpcCoreErrorCode.forwardHopLimit, RpcCoreErrorText.forwardHopLimit)
        : undefined
  if (!error) return
  /** One immutable snapshot feeds the caller-visible diagnostic and original wire metadata. */
  const snapshot = Object.freeze([...route])
  Object.defineProperty(error, 'route', { value: snapshot, enumerable: true })
  registerLocalErrorWireRoute(error, snapshot)
  registerLocalErrorWireSummary(error, error.code, error.message, { preserveSerializedError: true })
  throw error
}

/** Pure pre-admission policy stays on the already registered provider, never a second table. */
const providerPreflight = Symbol('rpc-provider-preflight')
/** Only forwarding contexts carry private access to their admitted operation metadata. */
const providerInvocation = Symbol('rpc-provider-invocation')
/** Cold registration carries the original native quota owner without a second routing table. */
const providerBulkAdmission = Symbol('rpc-provider-bulk-admission')
/** Native stream policy starts at the original producer's construction, before relay preparation. */
const providerStreamAdmission = Symbol('rpc-provider-stream-admission')
/** The original scope callback can carry a stable authenticated principal for the new key domain. */
const runtimeIdempotencyScope = Symbol('rpc-runtime-idempotency-scope')

/**
 * Native session construction preserves old scope behavior while retaining actual principal
 * provenance.
 */
export function retainRuntimeIdempotencyScope<T extends Function>(scope: T, principal: string): T {
  Object.defineProperty(scope, runtimeIdempotencyScope, { value: principal })
  return scope
}

/** Only a canonical native callback supplies stable scope; opaque user scope keeps its own policy. */
export function readRuntimeIdempotencyScope(scope: Function | undefined): string | undefined {
  return scope ? Reflect.get(scope, runtimeIdempotencyScope) : undefined
}

/** Register a policy owner on the actual callback consumed by the original executor. */
export function attachProviderBulkAdmission<T extends Function>(
  provider: T,
  registration: IProviderBulkRegistration
): T {
  Object.defineProperty(provider, providerBulkAdmission, { value: registration })
  return provider
}

/** Group preparation discovers quota ownership only through canonical registered callbacks. */
export function readProviderBulkAdmission(
  provider: Function
): IProviderBulkRegistration | undefined {
  return Reflect.get(provider, providerBulkAdmission)
}

/** Existing native policy counters release only when this exact original producer lifetime ends. */
type IProviderStreamSettlement = (succeeded: boolean) => void
/** Cold registered stream policy uses the admitted context, never an untrusted outer selector. */
type IProviderStreamAdmission = (context: IRpcContext) => IProviderStreamSettlement

/** Compose original native policy owners without another iterator, activity counter, or registry. */
export function wrapProviderStreamAdmission<T extends Function>(
  source: Function,
  target: T,
  enter: IProviderStreamAdmission
): T {
  /** Already wrapped policy must enter before the outer drain owns this same producer. */
  const prior = readProviderStreamAdmission(source)
  Object.defineProperty(target, providerStreamAdmission, {
    value: (context: IRpcContext): IProviderStreamSettlement => {
      /** Original policy rollback runs even if the next owner refuses construction. */
      const releasePrior = prior?.(context)
      let release: IProviderStreamSettlement
      try {
        release = enter(context)
      } catch (error) {
        releasePrior?.(false)
        throw error
      }
      return (succeeded) => {
        try {
          release(succeeded)
        } finally {
          releasePrior?.(succeeded)
        }
      }
    }
  })
  return target
}

/** Only the original producer owner invokes this optional new-profile lifetime policy. */
export function readProviderStreamAdmission(
  provider: Function
): IProviderStreamAdmission | undefined {
  return Reflect.get(provider, providerStreamAdmission)
}

/** Attach the synchronous route check to the canonical scalar or stream provider. */
export function attachProviderPreflight<T extends Function>(
  provider: T,
  check: (route: IRpcRouteHeader) => void
): T {
  Object.defineProperty(provider, providerPreflight, { value: check })
  return provider
}

/** Project optional policy before allocating replay entries or provider leases. */
export function readProviderPreflight(
  provider: Function | undefined
): ((route: IRpcRouteHeader) => void) | undefined {
  return provider ? Reflect.get(provider, providerPreflight) : undefined
}

/** Original native wrappers retain forward policy while registering their own callback identity. */
export function retainProviderPreflight<T extends Function>(
  source: Function,
  target: T,
  wrapAdmission?: (invoke: IRpcProvider) => IRpcProvider
): T {
  /** Native wrapping keeps quota provenance on the original provider registration. */
  const admission = readProviderBulkAdmission(source)
  if (admission && wrapAdmission)
    attachProviderBulkAdmission(target, {
      admission: admission.admission,
      invoke: wrapAdmission(admission.invoke)
    })
  const check = readProviderPreflight(source)
  /** Core registration preserves the same cold native lifetime port through its own callback. */
  const streamAdmission = readProviderStreamAdmission(source)
  if (streamAdmission && !Object.hasOwn(target, providerStreamAdmission))
    Object.defineProperty(target, providerStreamAdmission, { value: streamAdmission })
  return check ? attachProviderPreflight(target, check) : target
}

/** Retain only admitted metadata on the forward provider's original context. */
export function retainProviderInvocation(
  context: IRpcContext,
  route: IRpcRouteHeader,
  peerKey?: string,
  runtime?: IRpcRuntimeEnvelope,
  relay?: IProviderRuntimeRelay
): void {
  Object.defineProperty(context, providerInvocation, { value: { route, peerKey, runtime, relay } })
}

/** Forwarding reads the original admitted task/options without trusting payload metadata. */
export function readProviderRuntimeOperation(
  context: IRpcContext
): IRpcRuntimeEnvelope | undefined {
  return Reflect.get(context, providerInvocation)?.runtime
}

/** The admitted relay captures one exact original slot receipt before waiting in the key queue. */
export function readProviderRuntimeRelay(context: IRpcContext): IProviderRuntimeRelay | undefined {
  return Reflect.get(context, providerInvocation)?.relay
}

/** The compiled forward entry reads its actual operation without trusting payload fields. */
export function readProviderInvocation(context: IRpcContext): IRpcRouteHeader | undefined {
  return Reflect.get(context, providerInvocation)?.route
}

/** Authenticated describe reads its original admitted token without accepting payload credentials. */
export function readProviderIdentity(context: IRpcContext): string | undefined {
  return Reflect.get(context, providerInvocation)?.peerKey
}

/** Owns provider and event routing tables for one endpoint. */
export class ProviderRegistry {
  /** Cold runtime compilation resolves opt-in relay operations from the same method whitelist. */
  runtimeRelay?: (envelope: IRpcRuntimeEnvelope) => IProviderRuntimeRelay | undefined
  /** A forward-only namespace queries its final provider; no intermediate result store participates. */
  runtimeLookup?: (
    envelope: Extract<IRpcRuntimeEnvelope, { kind: 'runtime-outcome'; operation: 'lookup' }>
  ) => Promise<IRpcRuntimeOutcomeResult>
  /** Provider ownership remains separate from event listener registrations. */
  readonly providers = new Map<string, IRpcProvider>()
  /** Stream handlers share the method namespace with ordinary providers. */
  readonly streamProviders = new Map<
    string,
    (
      message: unknown,
      createContext: (signal: IRpcAbortSignal) => IRpcContext
    ) => void | Promise<void>
  >()
  /** Each event owns one channel so subscription handles identify their own registration. */
  readonly #events = new Map<string, ICanonicalEventChannel<IRpcContext, void | Promise<void>>>()

  /** Removes all application callbacks during endpoint disposal. */
  clear(): void {
    this.runtimeRelay = undefined
    this.runtimeLookup = undefined
    this.providers.clear()
    this.streamProviders.clear()
    for (const channel of this.#events.values()) channel.clear()
    this.#events.clear()
  }
  /** Registers a provider and rejects duplicate method ownership. */
  register(method: string, provider: IRpcProvider): boolean {
    if (this.providers.has(method) || this.streamProviders.has(method)) return false
    this.providers.set(method, provider)
    return true
  }

  /** Registers one stream handler in the same method namespace as ordinary providers. */
  registerStream(
    method: string,
    handler: (
      message: unknown,
      createContext: (signal: IRpcAbortSignal) => IRpcContext
    ) => void | Promise<void>
  ): boolean {
    if (this.providers.has(method) || this.streamProviders.has(method)) return false
    this.streamProviders.set(method, handler)
    return true
  }

  /** Registers an event listener and returns its idempotent disposer. */
  listen(event: string, listener: IRpcEventListener): () => void {
    const channel =
      this.#events.get(event) ?? createEventChannel<IRpcContext, void | Promise<void>>()
    this.#events.set(event, channel)
    const subscription = channel.subscribe((entry) => listener(entry.value))
    return () => {
      subscription()
      if (channel.size === 0 && this.#events.get(event) === channel) this.#events.delete(event)
    }
  }

  /** Reports whether the provider has a live dispatch-only listener for an event. */
  hasListeners(event: string): boolean {
    return (this.#events.get(event)?.size ?? 0) > 0
  }

  /** Counts live registrations, including multiple handles for one callback. */
  get listenerCount(): number {
    let count = 0
    for (const channel of this.#events.values()) count += channel.size
    return count
  }

  /** Invokes the event's starting snapshot in registration order and stops on the first failure. */
  dispatch(event: string, context: IRpcContext): void | Promise<void> {
    const channel = this.#events.get(event)
    if (!channel) return
    return withSnapshotEntries(channel, context, async (entries) => {
      for (const entry of entries) await entry.invoke()
    })
  }

  /** Looks up an inbound provider. */
  getProvider(method: string): IRpcProvider | undefined {
    return this.providers.get(method)
  }
}
