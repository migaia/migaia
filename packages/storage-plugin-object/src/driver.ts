import type { IObjectDriver, IObjectNative, IObjectOpenContext } from './types.js'
import type { ObjectDriverKind } from './constants.js'
import { invalidArgument } from './errors.js'
/** One descriptor map owns brand identity and the captured native opener. */
const drivers = new WeakMap<
  IObjectDriver,
  (context: IObjectOpenContext) => Promise<IObjectNative>
>()
/** Create one authentic lazy descriptor without running native code. */
export function defineObjectDriver(
  kind: ObjectDriverKind,
  open: (context: IObjectOpenContext) => Promise<IObjectNative>
): IObjectDriver {
  /** Brand identity is private; the descriptor itself requires no instance freeze. */
  const driver = { kind } as IObjectDriver
  drivers.set(driver, open)
  return driver
}
/** Resolve the actual factory without accepting structural lookalikes. */
export function readObjectDriver(
  driver: IObjectDriver
): (context: IObjectOpenContext) => Promise<IObjectNative> {
  const open = drivers.get(driver)
  if (!open) throw invalidArgument()
  return open
}
