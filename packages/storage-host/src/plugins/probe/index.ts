import { definePlugin } from '../../contracts.js'
import { createStorageTypeError } from '../../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../../error-text.js'
import { STORAGE_PROBE_PLUGIN_ID } from '../../state-constants.js'
import type { IStorageHookMap, IStorageHooks } from '../../hook-types.js'
import type { IStorageBackendPluginHandle, IStoragePluginCallContext } from '../../types.js'
import { attachStorageProbeHandlers, type IStorageProbeHandlers } from './handlers.js'

export type { IStorageProbeHandlers } from './handlers.js'

/** Extension method published by `storageProbe()` on `host.extensions` and org views. */
export type IStorageProbeApi = {
  /**
   * Subscribe one listener after construction and return its unsubscribe function. On an org view
   * other than the default organization, only events carrying that `orgId` are delivered.
   */
  observe<K extends keyof IStorageHookMap>(
    name: K,
    handler: (payload: IStorageHookMap[K]) => void
  ): () => void
}

/** Plugin handle of `storageProbe()`; its id is fixed, so a host has at most one probe. */
export type IStorageProbePluginHandle = IStorageBackendPluginHandle<IStorageProbeApi> & {
  readonly id: typeof STORAGE_PROBE_PLUGIN_ID
}

/** Owns the listener registrations made through one installed probe's `observe` extension. */
class StorageProbeObserver {
  /** Host registry subscription usable after install; this observer owns every removal. */
  readonly #subscribe: IStorageHooks['on']
  /** Organization whose events reach root-level calls unfiltered. */
  readonly #defaultOrgId: string
  /** Live unsubscribe functions; each is removed when its caller unsubscribes or the probe closes. */
  readonly #subscriptions = new Set<() => void>()
  /** Capture the host registry and default organization from the installing core. */
  constructor(subscribe: IStorageHooks['on'], defaultOrgId: string) {
    this.#subscribe = subscribe
    this.#defaultOrgId = defaultOrgId
  }
  /** Register `handler`; calls from a non-default org view receive only that org's events. */
  observe<K extends keyof IStorageHookMap>(
    context: IStoragePluginCallContext,
    name: K,
    handler: (payload: IStorageHookMap[K]) => void
  ): () => void {
    if (typeof handler !== 'function')
      throw createStorageTypeError(
        StorageHostErrorCode.invalidConfig,
        StorageErrorText.invalidHookHandler
      )
    const orgId = context.orgId
    const off =
      orgId === this.#defaultOrgId
        ? this.#subscribe(name, handler)
        : this.#subscribe(name, (payload) => {
            if ('orgId' in payload && payload.orgId === orgId) handler(payload)
          })
    const unsubscribe = () => {
      if (this.#subscriptions.delete(unsubscribe)) off()
    }
    this.#subscriptions.add(unsubscribe)
    return unsubscribe
  }
  /** Remove every listener this probe registered; called once when the plugin is disposed. */
  dispose(): void {
    // Deleting the visited entry while iterating a Set is well defined.
    for (const unsubscribe of this.#subscriptions) unsubscribe()
  }
}

/** Rejects a handler map that is not a plain object of functions before the plugin is created. */
function assertProbeHandlers(handlers: unknown): asserts handlers is IStorageProbeHandlers {
  if (typeof handlers !== 'object' || handlers === null || Array.isArray(handlers))
    throw createStorageTypeError(StorageHostErrorCode.invalidConfig, StorageErrorText.invalidHooks)
  for (const handler of Object.values(handlers))
    if (handler !== undefined && typeof handler !== 'function')
      throw createStorageTypeError(
        StorageHostErrorCode.invalidConfig,
        StorageErrorText.invalidHookHandler
      )
}

/**
 * The only observation entry of a storage host. `handlers` are subscribed when the install batch
 * that contains this plugin starts, so a probe in `createStorageHost({ plugins })` sees every
 * lifecycle event from the first one. After installation, `host.extensions.observe(name, handler)`
 * adds listeners. Listener failures are reported and never change storage results. Removing the
 * probe with `unUse` removes all of its listeners.
 */
export function storageProbe(handlers: IStorageProbeHandlers = {}): IStorageProbePluginHandle {
  assertProbeHandlers(handlers)
  const captured = { ...handlers }
  const plugin = definePlugin(STORAGE_PROBE_PLUGIN_ID, (core) => ({
    install() {
      const observer = new StorageProbeObserver(core.subscribeStorageHook, core.defaultOrgId)
      core.onDispose(() => observer.dispose())
      return {
        observe<K extends keyof IStorageHookMap>(
          this: IStoragePluginCallContext,
          name: K,
          handler: (payload: IStorageHookMap[K]) => void
        ) {
          return observer.observe(this, name, handler)
        }
      } as IStorageProbeApi
    }
  }))
  attachStorageProbeHandlers(plugin, captured)
  return plugin as unknown as IStorageProbePluginHandle
}
