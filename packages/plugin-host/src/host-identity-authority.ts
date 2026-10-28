/**
 * Owns the one module-instance Host identity table; it performs no admission, entropy or error
 * construction.
 */
import type { IPluginHostIdentity } from './host-identity-types.js'

/** A facade and its runtime retain this exact frozen provenance record rather than copying it. */
export type IHostIdentityRecord = Readonly<{ identity: IPluginHostIdentity; nodeId: string }>

/** Module-instance authority retains no Host strongly and disappears with its exact target key. */
const identities = new WeakMap<object, IHostIdentityRecord>()

/** Records the original issuance or aliases the same record for its canonical frozen facade. */
export function recordHostIdentity(host: object, record: IHostIdentityRecord): void {
  identities.set(host, record)
}

/** Issuance reuses only the original record issued to the exact node owner. */
export function readHostIdentityRecord(host: object): IHostIdentityRecord | undefined {
  return identities.get(host)
}

/** Reads identity only through exact module-instance provenance, without inspecting user properties. */
export const readHostIdentity = (target: unknown): IPluginHostIdentity | undefined =>
  (typeof target === 'object' || typeof target === 'function') && target !== null
    ? identities.get(target as object)?.identity
    : undefined

/** The original integration owner reads its private node fact only after canonical Host issuance. */
export const readHostNodeId = (target: object): string => identities.get(target)!.nodeId
