import { createRegistrationView } from './composition.js'
import type { IRegistrationToken, IRegistrationView, IPluginConstraint } from './typing.js'

/** Publishes only the exact live registration extensions carried by `token`. */
export const createView = <TPlugin extends IPluginConstraint<any>>(
  token: IRegistrationToken<TPlugin>
): IRegistrationView<TPlugin> =>
  createRegistrationView(token) as unknown as IRegistrationView<TPlugin>

export type { IRegistrationToken, IRegistrationView } from './typing.js'
