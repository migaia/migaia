import { invokeCaptured } from './invocation.js'
import type { IRegistration } from './registry.js'
import type {
  IPluginConfig,
  IPluginConstraint,
  IPluginHostConfigFor,
  IPluginHostCompositionSnapshot
} from './typing.js'

/** Host callbacks needed to materialize a view without transferring lifecycle ownership. */
export type IPluginHostPublicationPort<THost, TDomainCore extends object, TValue> = Readonly<{
  readonly host: THost
  assertLive(registrations: readonly IRegistration<TDomainCore, TValue>[]): void
  readConfig(path: string): unknown
  updateConfig(
    name: string,
    recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void>
}>

/** Weak registration-set cache preserving callable identity across disable/enable round trips. */
type IExtensionCacheNode = {
  readonly next: WeakMap<object, IExtensionCacheNode>
  readonly functions: Map<PropertyKey, Function>
}

/** Per-host cache root; exact registration objects distinguish later reinstall generations. */
const extensionCache = new WeakMap<object, IExtensionCacheNode>()

/** Returns the cache node for one exact ordered registration set. */
const readExtensionCache = (
  host: object,
  registrations: readonly object[]
): IExtensionCacheNode => {
  const existing = extensionCache.get(host)
  const root: IExtensionCacheNode = existing ?? { next: new WeakMap(), functions: new Map() }
  if (!existing) extensionCache.set(host, root)
  let node: IExtensionCacheNode = root
  for (const registration of registrations) {
    let child: IExtensionCacheNode | undefined = node.next.get(registration)
    if (!child) {
      child = { next: new WeakMap(), functions: new Map() }
      node.next.set(registration, child)
    }
    node = child
  }
  return node
}

/**
 * Materializes one immutable publication snapshot. All liveness and mutation decisions remain in
 * PluginHost; this module owns only descriptor-safe view construction.
 */
export const createPluginHostPublication = <THost, TDomainCore extends object, TValue>(
  registrations: readonly IRegistration<TDomainCore, TValue>[],
  port: IPluginHostPublicationPort<THost, TDomainCore, TValue>
): IPluginHostCompositionSnapshot => {
  /** Frozen registration identities defining this exact publication generation. */
  const captured = Object.freeze([...registrations])
  /** Exact-set cache keeps restored callable references stable without sharing stale generations. */
  const cached = readExtensionCache(port.host as object, captured)
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
          published = (...args: unknown[]) => {
            port.assertLive(captured)
            return invokeCaptured(value, port.host, args)
          }
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
  Object.freeze(extensions)

  /** Null-prototype public view whose every read revalidates the captured generation. */
  const view = Object.create(null) as Record<PropertyKey, unknown>
  Object.defineProperties(view, {
    extensions: {
      enumerable: true,
      configurable: false,
      get: () => {
        port.assertLive(captured)
        return extensions
      }
    },
    config: {
      enumerable: true,
      configurable: false,
      get: () => {
        port.assertLive(captured)
        return {
          get: (path: string) => {
            port.assertLive(captured)
            return port.readConfig(path)
          },
          update: (
            name: string,
            recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
          ) => {
            port.assertLive(captured)
            return port.updateConfig(name, recipe)
          }
        } as IPluginHostConfigFor<readonly IPluginConstraint<any>[]>
      }
    }
  })
  return Object.freeze(view) as IPluginHostCompositionSnapshot
}

/** Materializes only extension capabilities for one exact registration token. */
export const createPluginHostExtensionPublication = <THost, TDomainCore extends object, TValue>(
  registrations: readonly IRegistration<TDomainCore, TValue>[],
  host: THost,
  assertLive: (registrations: readonly IRegistration<TDomainCore, TValue>[]) => void
): Readonly<{ readonly extensions: Readonly<Record<PropertyKey, unknown>> }> => {
  const captured = Object.freeze([...registrations])
  const extensions = Object.create(null) as Record<PropertyKey, unknown>
  for (const registration of captured)
    for (const { key, descriptor } of registration.extensions) {
      const value = descriptor.value
      const published =
        typeof value === 'function'
          ? (...args: unknown[]) => {
              assertLive(captured)
              return invokeCaptured(value, host, args)
            }
          : value
      Object.defineProperty(extensions, key, {
        value: published,
        enumerable: true,
        configurable: false,
        writable: false
      })
    }
  Object.freeze(extensions)
  return Object.freeze({
    get extensions() {
      assertLive(captured)
      return extensions
    }
  })
}
