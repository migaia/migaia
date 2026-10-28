import type { IStorageHookMap } from '../../hook-types.ts'

/** Handler map accepted by `storageProbe(handlers)`: one optional listener per event name. */
export type IStorageProbeHandlers = {
  readonly [K in keyof IStorageHookMap]?: (payload: IStorageHookMap[K]) => void
}

/**
 * Handlers given to each `storageProbe()` handle. The host subscribes them when the install batch
 * starts, before it emits its first lifecycle event, so a probe in the first batch observes the
 * same events a construction-time listener would. This module has no runtime imports, so the base
 * host entry can read it without bundling the probe plugin.
 */
const probeHandlers = new WeakMap<object, IStorageProbeHandlers>()

/** Attaches the handler map of `storageProbe(handlers)` to its plugin handle. */
export function attachStorageProbeHandlers(plugin: object, handlers: IStorageProbeHandlers): void {
  probeHandlers.set(plugin, handlers)
}

/** Returns the handler map of a `storageProbe()` handle, or `undefined` for any other plugin. */
export function readStorageProbeHandlers(plugin: object): IStorageProbeHandlers | undefined {
  return probeHandlers.get(plugin)
}
