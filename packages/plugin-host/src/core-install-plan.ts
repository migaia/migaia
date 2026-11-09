import type { IInstallEntry } from './registry.ts'
import { PluginActivation } from './state-constants.ts'
/** No graph is constructed when the host has no feature dependencies. Input order is canonical. */
export function planCoreInstallBatch<TDomainCore extends object, TValue>(
  entries: readonly IInstallEntry<TDomainCore, TValue>[]
): Readonly<{
  order: readonly IInstallEntry<TDomainCore, TValue>[]
  installSet: ReadonlySet<string>
  activationOrder: readonly string[]
}> {
  /** Eager definitions execute now; lazy definitions retain their existing cold registration. */
  const installSet = new Set<string>()
  for (const entry of entries)
    if (entry.plugin.activation !== PluginActivation.lazy) installSet.add(entry.name)
  return { order: entries, installSet, activationOrder: [] as readonly string[] }
}
