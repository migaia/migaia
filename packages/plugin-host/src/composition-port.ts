/**
 * Owns the existing managed composition surface through explicit context; provenance stays in
 * composition.
 */
import type { IPluginHostCompositionIntegration } from './composition-types.js'

/** Composition methods are acquired on demand; revision and snapshot authority remain with the Host. */
export type IManagedHostRuntime = Omit<
  IPluginHostCompositionIntegration<object>,
  'revision' | 'getCurrentSnapshot'
>

/** Explicit immutable collaborators for this module's original plain frozen protocol surface. */
export type IManagedCompositionPortContext = Readonly<{
  runtime: IManagedHostRuntime
  readRevision(): number
  readCurrentSnapshot(): unknown
}>

/**
 * Preserves own enumerable methods, the live revision getter, Object prototype and detached calls.
 * Small adapters are required by the existing public object shape; runtime state stays with the
 * original composition owner and this module adds no forwarding class or compatibility layer.
 */
export function buildManagedPort(
  context: IManagedCompositionPortContext
): IPluginHostCompositionIntegration<object> {
  return Object.freeze({
    createPluginAdmission: (plugin) => context.runtime.createPluginAdmission(plugin),
    createDataOrderSlot: (name) => context.runtime.createDataOrderSlot(name),
    retireDataOrderSlot: (slot) => context.runtime.retireDataOrderSlot(slot),
    prepareAdmissions: (requests) => context.runtime.prepareAdmissions(requests),
    commitPreparedAdmissions: (prepared) => context.runtime.commitPreparedAdmissions(prepared),
    discardPreparedAdmissions: (prepared) => context.runtime.discardPreparedAdmissions(prepared),
    prepareUnUseBatch: (receipts) => context.runtime.prepareUnUseBatch(receipts),
    commitPreparedUnUseBatch: (prepared, options) =>
      context.runtime.commitPreparedUnUseBatch(prepared, options),
    get revision(): number {
      return context.readRevision()
    },
    getCurrentSnapshot: () =>
      context.readCurrentSnapshot() as ReturnType<
        IPluginHostCompositionIntegration<object>['getCurrentSnapshot']
      >
  })
}
