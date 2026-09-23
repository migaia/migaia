import { createRegistrationView } from './composition.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
export { inspectFeatures } from './feature-runtime.js'
import type {
  IRegistrationToken,
  IRegistrationView,
  IPluginConstraint,
  IPluginHostCompositionIntegration
} from './typing.js'

/** Publishes only the exact live registration extensions carried by `token`. */
export const createView = <TPlugin extends IPluginConstraint<any>>(
  token: IRegistrationToken<TPlugin>
): IRegistrationView<TPlugin> =>
  createRegistrationView(token) as unknown as IRegistrationView<TPlugin>

/**
 * Hosts this package constructed, mapped to their managed-protocol port.
 *
 * Module-private and deliberately separate from the disposal-provenance map in `host-runtime`: the
 * two answer different questions about the same objects, and one map answering both would make
 * either owner unable to change its own key set. A `WeakMap` means a host that goes out of scope
 * takes its entry with it, so there is no registration to undo and nothing to leak.
 */
const managedHosts = new WeakMap<object, IPluginHostCompositionIntegration<object>>()

/**
 * Builds the managed-protocol port over a host's composition runtime.
 *
 * It lives here rather than in the host constructor because this module owns what the protocol is:
 * the host only owns the runtime the port delegates to, and a literal spelled out in the
 * constructor put the shape of a composition-only surface in the middle of ordinary host wiring.
 */
export const buildManagedPort = <TRuntime extends IPluginHostCompositionIntegration<object>>(
  runtime: TRuntime,
  readRevision: () => number,
  readCurrentView: () => unknown
): IPluginHostCompositionIntegration<object> =>
  Object.freeze({
    createPluginAdmission: (plugin) => runtime.createPluginAdmission(plugin),
    createDataOrderSlot: (name) => runtime.createDataOrderSlot(name),
    retireDataOrderSlot: (slot) => runtime.retireDataOrderSlot(slot),
    prepareAdmissions: (requests) => runtime.prepareAdmissions(requests),
    commitPreparedAdmissions: (prepared) => runtime.commitPreparedAdmissions(prepared),
    discardPreparedAdmissions: (prepared) => runtime.discardPreparedAdmissions(prepared),
    prepareUnUseBatch: (receipts) => runtime.prepareUnUseBatch(receipts),
    commitPreparedUnUseBatch: (prepared, options) =>
      runtime.commitPreparedUnUseBatch(prepared, options),
    // getter，不是快照：`revision` 每次读都必须反映当前提交代次。
    get revision(): number {
      return readRevision()
    },
    getCurrentView: () =>
      readCurrentView() as ReturnType<IPluginHostCompositionIntegration<object>['getCurrentView']>
  })

/** Records a host's managed-protocol port. Called once, at the end of host construction. */
export const registerManagedHost = (
  target: object,
  port: IPluginHostCompositionIntegration<object>
): void => {
  managedHosts.set(target, port)
}

/**
 * Whether a value is a host this package constructed.
 *
 * The predicate a composing package should branch on instead of `instanceof`: a nominal check fails
 * across two copies of the package and cannot see a host produced by a factory rather than a
 * constructor, and both of those are shapes this package now ships.
 */
export const isManagedHost = (target: unknown): boolean =>
  (typeof target === 'object' || typeof target === 'function') &&
  target !== null &&
  managedHosts.has(target as object)

/** The managed-protocol port of a registered host, or `COMPOSITION_TARGET_UNMANAGED`. */
export const openComposition = (target: object): IPluginHostCompositionIntegration<object> => {
  const port = managedHosts.get(target)
  if (!port)
    throw new PluginHostError(
      PluginHostErrorCode.compositionTargetUnmanaged,
      ERROR_TEXT.COMPOSITION_TARGET_UNMANAGED
    )
  return port
}

export type { IRegistrationToken, IRegistrationView } from './typing.js'
export type { IPluginHostCompositionIntegration } from './typing.js'
