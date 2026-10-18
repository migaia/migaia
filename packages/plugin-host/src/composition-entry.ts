import { createRegistrationView } from './composition.js'
export { inspectFeatures } from './feature-runtime.js'
import type { IRegistrationToken, IRegistrationView, IPluginConstraint } from './typing.js'

/** Publishes only the exact live registration extensions carried by `token`. */
export const createView = <TPlugin extends IPluginConstraint<any>>(
  token: IRegistrationToken<TPlugin>
): IRegistrationView<TPlugin> =>
  createRegistrationView(token) as unknown as IRegistrationView<TPlugin>

export { isManagedHost, openComposition } from './composition.js'

export type { IRegistrationToken, IRegistrationView } from './typing.js'
export type { IPluginHostCompositionIntegration } from './typing.js'
export type { IPluginHostCompositionSnapshot } from './typing.js'
