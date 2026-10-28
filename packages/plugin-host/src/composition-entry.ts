import { createRegistrationView, openComposition as openManagedComposition } from './composition.ts'
import { PluginHostCompositionRuntime } from './composition-runtime.ts'
export { inspectFeatures } from './feature-runtime.ts'
import type {
  IRegistrationToken,
  IRegistrationView,
  IPluginHostCompositionIntegration
} from './composition-types.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'

/**
 * Creates a narrow extension view for an exact committed registration token, rather than a
 * name-addressed plugin handle. Unknown or revoked tokens throw REGISTRATION_REVOKED; captured
 * extension callables keep checking that generation and never follow a same-name replacement.
 */
export const createView = <TPlugin extends IPluginConstraint<any>>(
  token: IRegistrationToken<TPlugin>
): IRegistrationView<TPlugin> =>
  createRegistrationView(token) as unknown as IRegistrationView<TPlugin>

export { isManagedHost } from './composition.ts'

/** Acquires the stable composition facade over the original Host state on its first real use. */
export const openComposition = (target: object): IPluginHostCompositionIntegration<object> =>
  openManagedComposition(target, (port) => new PluginHostCompositionRuntime(port))

export type { IRegistrationToken, IRegistrationView } from './composition-types.ts'
export type { IPluginHostCompositionIntegration } from './composition-types.ts'
export type { IPluginHostCompositionSnapshot } from './composition-types.ts'
