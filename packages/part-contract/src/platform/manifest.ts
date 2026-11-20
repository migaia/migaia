import type { IPartSnapshot } from './lock.ts'
import { collectStores } from './stores.ts'

/**
 * Capabilities a client build provides locally: every definition id available in its host catalog,
 * the installed renderer names and the state namespaces its plugins register besides `page`,
 * `section` and `part` (`stores`, absent means none). `build` names the client build.
 */
export type ICapabilityManifest = {
  readonly format: 1
  readonly build: string
  readonly definitions: readonly string[]
  readonly renderers: readonly string[]
  readonly stores?: readonly string[]
}

/**
 * Outcome of `checkDelivery`: deliverable, or the definition ids (`missing`) and state namespaces
 * (`missingStores`) the client lacks. They are separate lists because definition ids may contain
 * `:` and must not be mixed with namespaces.
 */
export type IDeliveryResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly missing: readonly string[]
      readonly missingStores: readonly string[]
    }

/**
 * Delivery check run by the client before installing a snapshot: every id in `lock.definitions`
 * must be in the manifest or exported by one of the snapshot's remote modules, and every
 * non-default namespace the snapshot's blueprints bind (`collectStores`) must be in the manifest's
 * `stores`. Reports every missing id in lock order and every missing namespace in first-binding
 * order. Each reference is one Set lookup.
 */
export function checkDelivery(
  snapshot: IPartSnapshot,
  manifest: ICapabilityManifest
): IDeliveryResult {
  /** Ids available locally or from remote modules. */
  const available = new Set(manifest.definitions)
  for (const module of snapshot.lock.modules)
    for (const entry of module.exports) available.add(entry.id)
  /** Referenced ids nobody provides. */
  const missing = snapshot.lock.definitions.filter((id) => !available.has(id))
  /** Namespaces the client registers. */
  const stores = new Set(manifest.stores ?? [])
  /** Bound namespaces the client does not register. */
  const missingStores = collectStores(snapshot.blueprints).filter((name) => !stores.has(name))
  return missing.length === 0 && missingStores.length === 0
    ? { ok: true }
    : { ok: false, missing, missingStores }
}
