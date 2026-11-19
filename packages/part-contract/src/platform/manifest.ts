import type { IPartSnapshot } from './lock.ts'

/**
 * Capabilities a client build provides locally: every definition id available in its host catalog
 * and the installed renderer names. `build` names the client build that produced it.
 */
export type ICapabilityManifest = {
  readonly format: 1
  readonly build: string
  readonly definitions: readonly string[]
  readonly renderers: readonly string[]
}

/** Outcome of `checkDelivery`: either deliverable, or the ids neither side provides. */
export type IDeliveryResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: readonly string[] }

/**
 * Delivery check run by the client before installing a snapshot: every id in `lock.definitions`
 * must be in the manifest or exported by one of the snapshot's remote modules. Reports every
 * missing id, in lock order. Each reference is one Set lookup.
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
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}
