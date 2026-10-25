import { createRegistrationView, openComposition as openManagedComposition } from './composition.js'
import { PluginHostCompositionRuntime } from './composition-runtime.js'
export { inspectFeatures } from './feature-runtime.js'
import type {
  IRegistrationToken,
  IRegistrationView,
  IPluginConstraint,
  IPluginHostCompositionIntegration
} from './typing.js'

/**
 * Creates a narrow extension view for an exact committed registration token, rather than a
 * name-addressed plugin handle. Unknown or revoked tokens throw REGISTRATION_REVOKED; captured
 * extension callables keep checking that generation and never follow a same-name replacement.
 */
export const createView = <TPlugin extends IPluginConstraint<any>>(
  token: IRegistrationToken<TPlugin>
): IRegistrationView<TPlugin> =>
  createRegistrationView(token) as unknown as IRegistrationView<TPlugin>

export { isManagedHost } from './composition.js'

/** Acquires the stable composition facade over the original Host state on its first real use. */
export const openComposition = (target: object): IPluginHostCompositionIntegration<object> =>
  openManagedComposition(target, (port) => new PluginHostCompositionRuntime(port))

export type { IRegistrationToken, IRegistrationView } from './typing.js'
export type { IPluginHostCompositionIntegration } from './typing.js'
export type { IPluginHostCompositionSnapshot } from './typing.js'
