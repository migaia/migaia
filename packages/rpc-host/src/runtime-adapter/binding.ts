import { createRemoteBindingDrain } from '../remote/internal/binding-drain.js'
import type { IRemoteBindingDrain } from '../remote/internal/binding-drain.js'

/** Only factory-created drain identities may supply their actual endpoint attachment operation. */
const adapterDrains = new WeakSet<object>()

/** Public drain resources expose existing operations rather than a prepared endpoint claim. */
export type IAdapterBindingDrain = IRemoteBindingDrain

/** Core assemblies read exact drain construction without probing caller fields or getters. */
export function readAdapterBindingDrain(value: object): IAdapterBindingDrain | undefined {
  return adapterDrains.has(value) ? (value as IAdapterBindingDrain) : undefined
}

/** Own one adapter binding's real endpoint drain through the existing remote lifecycle mechanism. */
export function createAdapterBindingDrain(...args: Parameters<typeof createRemoteBindingDrain>) {
  /** This original owner retains the same tracking, drain Promise and provider proof propagation. */
  const drain = createRemoteBindingDrain(...args)
  adapterDrains.add(drain)
  return drain
}
