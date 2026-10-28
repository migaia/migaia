/** Owns descriptor-safe immutable publications; registration and lifecycle decisions stay in ports. */
import { invokeCaptured } from './invocation.ts'
import type { IRegistration } from './registry.ts'
import type { IPluginConfig } from './plugin-lifecycle-types.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type { IPluginHostConfigFor } from './plugin-handle-types.ts'
import type { IPluginHostCompositionSnapshot } from './composition-types.ts'

/** Host callbacks needed to materialize a view without transferring lifecycle ownership. */
type IPluginHostPublicationPort<THost, TDomainCore extends object, TValue> = Readonly<{
  readonly host: THost
  assertLive(registrations: readonly IRegistration<TDomainCore, TValue>[]): void
  readConfig(path: string): unknown
  updateConfig(
    name: string,
    recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void>
  /** Read committed shared slots from canonical state; publication owns no contribution registry. */
  readSharedExtensions(): ReadonlyMap<PropertyKey, object>
}>

/** Weak registration-set cache preserving callable identity across disable/enable round trips. */
type IExtensionCacheNode = {
  readonly next: WeakMap<object, IExtensionCacheNode>
  readonly functions: Map<PropertyKey, Function>
}

/** Per-host cache root; exact registration objects distinguish later reinstall generations. */
const extensionCache = new WeakMap<object, IExtensionCacheNode>()

/** Token capabilities survive disable(), unlike full Host views; never share their guards. */
const tokenExtensionCache = new WeakMap<object, IExtensionCacheNode>()

/** Returns the cache node for one exact ordered registration set. */
const readExtensionCache = (
  cacheRoot: WeakMap<object, IExtensionCacheNode>,
  host: object,
  registrations: readonly object[]
): IExtensionCacheNode => {
  /** A live Host retains one weak registration trie for this liveness policy. */
  const existing = cacheRoot.get(host)
  /** New Hosts allocate only the root; later calls reuse the same identity trie. */
  const root: IExtensionCacheNode = existing ?? { next: new WeakMap(), functions: new Map() }
  if (!existing) cacheRoot.set(host, root)
  /** Traversal follows the exact ordered registration set without retaining it as a strong key. */
  let node: IExtensionCacheNode = root
  for (const registration of registrations) {
    /** Each generation contributes one weak edge in the exact-set callable cache. */
    let child: IExtensionCacheNode | undefined = node.next.get(registration)
    if (!child) {
      child = { next: new WeakMap(), functions: new Map() }
      node.next.set(registration, child)
    }
    node = child
  }
  return node
}

/** Owns one cached callable's exact registration set, receiver and liveness policy. */
class PublishedExtension<TDomainCore extends object, TValue> {
  /** Ordered generations captured by the immutable publication. */
  readonly #captured: readonly IRegistration<TDomainCore, TValue>[]
  /** Concrete Host receiver expected by the original admitted extension. */
  readonly #host: unknown
  /** Publication-specific liveness policy distinguishes full views from token capabilities. */
  readonly #assertLive: (registrations: readonly IRegistration<TDomainCore, TValue>[]) => void
  /** Original descriptor value, never re-read from user objects. */
  readonly #value: Function

  /** Captures one publication's immutable invocation context. */
  constructor(
    captured: readonly IRegistration<TDomainCore, TValue>[],
    host: unknown,
    assertLive: (registrations: readonly IRegistration<TDomainCore, TValue>[]) => void,
    value: Function
  ) {
    this.#captured = captured
    this.#host = host
    this.#assertLive = assertLive
    this.#value = value
  }

  /** Revalidates the exact captured set before forwarding the original receiver and arguments. */
  invoke(args: unknown[]): unknown {
    /** Captured callbacks retain their original receiver-independent invocation. */
    const assertLive = this.#assertLive
    assertLive(this.#captured)
    return invokeCaptured(this.#value, this.#host, args)
  }
}

/** Copies admitted descriptors once, with stable callable identity under one liveness policy. */
const materializeExtensions = <TDomainCore extends object, TValue>(
  captured: readonly IRegistration<TDomainCore, TValue>[],
  host: unknown,
  assertLive: (registrations: readonly IRegistration<TDomainCore, TValue>[]) => void,
  cacheRoot: WeakMap<object, IExtensionCacheNode>
): Record<PropertyKey, unknown> => {
  /** Exact-set cache keeps restored callable references stable without sharing stale generations. */
  const cached = readExtensionCache(cacheRoot, host as object, captured)
  /** Null-prototype extension record excluding Host and Object prototype capabilities. */
  const extensions = Object.create(null) as Record<PropertyKey, unknown>
  for (const registration of captured)
    for (const { key, descriptor } of registration.extensions) {
      /** Captured extension value published without re-reading the candidate object. */
      const value = descriptor.value
      /** Callable extensions retain the concrete Host receiver through the canonical invoker. */
      let published = value
      if (typeof value === 'function') {
        published = cached.functions.get(key)
        if (!published) {
          /** One explicit owner retains the exact invocation boundary for this cached function. */
          const invocation = new PublishedExtension(captured, host, assertLive, value)
          /**
           * A short object callback preserves the original assigned function name without a helper
           * layer.
           */
          const callable = { published: (...args: unknown[]) => invocation.invoke(args) }
          published = callable.published
          cached.functions.set(key, published as Function)
        }
      }
      Object.defineProperty(extensions, key, {
        value: published,
        enumerable: true,
        configurable: false,
        writable: false
      })
    }
  return extensions
}

/** Owns the config methods created by each publication config read. */
class PublicationConfig<THost, TDomainCore extends object, TValue> {
  /** Exact generations determine whether a later config call remains admitted. */
  readonly #captured: readonly IRegistration<TDomainCore, TValue>[]
  /** Config reads and writes remain Host-owned operations. */
  readonly #port: IPluginHostPublicationPort<THost, TDomainCore, TValue>

  /** Captures this config object's original publication context. */
  constructor(
    captured: readonly IRegistration<TDomainCore, TValue>[],
    port: IPluginHostPublicationPort<THost, TDomainCore, TValue>
  ) {
    this.#captured = captured
    this.#port = port
  }

  /** Rechecks publication liveness before resolving the current Host config path. */
  read(path: string): unknown {
    this.#port.assertLive(this.#captured)
    return this.#port.readConfig(path)
  }

  /** Preserves synchronous admission and the exact update Promise. */
  update(
    name: string,
    recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void> {
    this.#port.assertLive(this.#captured)
    return this.#port.updateConfig(name, recipe)
  }
}

/** Owns a full publication's frozen generations and extensions without taking lifecycle authority. */
class PluginHostPublication<THost, TDomainCore extends object, TValue> {
  /** Every getter validates the exact generations captured when the view was created. */
  readonly #captured: readonly IRegistration<TDomainCore, TValue>[]
  /** Host callbacks remain the authority for liveness and config mutation. */
  readonly #port: IPluginHostPublicationPort<THost, TDomainCore, TValue>
  /** Frozen extension descriptors share the original exact-set callable cache. */
  readonly #extensions: Readonly<Record<PropertyKey, unknown>>

  /** Copies the publication once, including committed shared slots in their original order. */
  constructor(
    registrations: readonly IRegistration<TDomainCore, TValue>[],
    port: IPluginHostPublicationPort<THost, TDomainCore, TValue>
  ) {
    this.#captured = Object.freeze([...registrations])
    this.#port = port
    /** Descriptor construction precedes shared-slot reads and final freezing, as before. */
    const extensions = materializeExtensions(
      this.#captured,
      port.host,
      port.assertLive,
      extensionCache
    )
    for (const [key, facade] of port.readSharedExtensions())
      Object.defineProperty(extensions, key, {
        value: facade,
        enumerable: true,
        configurable: false,
        writable: false
      })
    this.#extensions = Object.freeze(extensions)
  }

  /** Validates this view before returning its stable extension facade. */
  readExtensions(): Readonly<Record<PropertyKey, unknown>> {
    this.#port.assertLive(this.#captured)
    return this.#extensions
  }

  /** Preserves the original fresh config-object allocation on every successful getter read. */
  createConfig(): IPluginHostConfigFor<readonly IPluginConstraint<any>[]> {
    this.#port.assertLive(this.#captured)
    /** Fresh config state retains the original publication generation and mutable surface. */
    const owner = new PublicationConfig(this.#captured, this.#port)
    return {
      get: (path: string) => owner.read(path),
      update: (
        name: string,
        recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
      ) => owner.update(name, recipe)
    } as IPluginHostConfigFor<readonly IPluginConstraint<any>[]>
  }
}

/**
 * Materializes one immutable publication snapshot. All liveness and mutation decisions remain in
 * PluginHost; this module owns only descriptor-safe view construction.
 */
export const createPluginHostPublication = <THost, TDomainCore extends object, TValue>(
  registrations: readonly IRegistration<TDomainCore, TValue>[],
  port: IPluginHostPublicationPort<THost, TDomainCore, TValue>
): IPluginHostCompositionSnapshot => {
  /** Runtime state belongs to one explicit owner while the public view retains its original shape. */
  const owner = new PluginHostPublication(registrations, port)
  /**
   * The view remains a frozen null-prototype object with own accessor descriptors in original
   * order.
   */
  const view = Object.create(null) as Record<PropertyKey, unknown>
  Object.defineProperties(view, {
    extensions: { enumerable: true, configurable: false, get: () => owner.readExtensions() },
    config: { enumerable: true, configurable: false, get: () => owner.createConfig() }
  })
  return Object.freeze(view) as IPluginHostCompositionSnapshot
}

/** Owns only extension capabilities for a token publication's exact captured generations. */
class PluginHostExtensionPublication<THost, TDomainCore extends object, TValue> {
  /** Exact generations retain token-specific guards independently from full Host views. */
  readonly #captured: readonly IRegistration<TDomainCore, TValue>[]
  /** Token extensions keep their separate exact-set callable cache and immutable surface. */
  readonly #extensions: Readonly<Record<PropertyKey, unknown>>
  /** Token liveness policy deliberately survives disable transitions. */
  readonly #assertLive: (registrations: readonly IRegistration<TDomainCore, TValue>[]) => void

  /** Captures and freezes the same extension projection as the original token factory. */
  constructor(
    registrations: readonly IRegistration<TDomainCore, TValue>[],
    host: THost,
    assertLive: (registrations: readonly IRegistration<TDomainCore, TValue>[]) => void
  ) {
    this.#captured = Object.freeze([...registrations])
    this.#assertLive = assertLive
    this.#extensions = Object.freeze(
      materializeExtensions(this.#captured, host, assertLive, tokenExtensionCache)
    )
  }

  /** Validates the token generations before returning the immutable extension facade. */
  readExtensions(): Readonly<Record<PropertyKey, unknown>> {
    /** Captured callbacks retain their original receiver-independent invocation. */
    const assertLive = this.#assertLive
    assertLive(this.#captured)
    return this.#extensions
  }
}

/** Materializes only extension capabilities for one exact registration token. */
export const createPluginHostExtensionPublication = <THost, TDomainCore extends object, TValue>(
  registrations: readonly IRegistration<TDomainCore, TValue>[],
  host: THost,
  assertLive: (registrations: readonly IRegistration<TDomainCore, TValue>[]) => void
): Readonly<{ readonly extensions: Readonly<Record<PropertyKey, unknown>> }> => {
  /** Token state and guards remain explicit while its public projection keeps the original getter. */
  const owner = new PluginHostExtensionPublication(registrations, host, assertLive)
  return Object.freeze({
    get extensions() {
      return owner.readExtensions()
    }
  })
}
