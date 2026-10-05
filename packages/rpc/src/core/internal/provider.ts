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
export function retainProviderPreflight<T extends Function>(source: Function, target: T): T {
  const check = readProviderPreflight(source)
  return check ? attachProviderPreflight(target, check) : target
}

/** Retain only admitted metadata on the forward provider's original context. */
export function retainProviderInvocation(context: IRpcContext, route: IRpcRouteHeader): void {
  Object.defineProperty(context, providerInvocation, { value: route })
}

/** The compiled forward entry reads its actual operation without trusting payload fields. */
export function readProviderInvocation(context: IRpcContext): IRpcRouteHeader | undefined {
  return Reflect.get(context, providerInvocation)
}

/** Owns provider and event routing tables for one endpoint. */
export class ProviderRegistry {
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
