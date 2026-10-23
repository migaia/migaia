import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageResource
} from '@migaia/storage-contract'
import type { IStorageJournalBackendBinding } from './types.js'
import { isStorageErrorFamily } from '../core/error-family.js'

/** This internal symbol lives only on the original facade and its fixed-org projection shells. */
export const storageJournalAccess = Symbol()
/** A resolved view cannot change org, install a backend, close the host, or return a raw store. */
export type IStorageJournalBackendAccess = {
  readonly orgId: string
  readonly backendInstanceId: string
  readonly binding: Omit<IStorageJournalBackendBinding, 'forOrg'>
  retain(resource: IStorageResource): () => void
}
/** Capture the exact original callbacks once before the descriptor's installation window closes. */
export function snapshotStorageJournalBinding(
  input: IStorageJournalBackendBinding
): IStorageJournalBackendBinding {
  try {
    const result = Object.create(null) as Record<string, unknown>
    for (const key of [
      'forOrg',
      'openNamespace',
      'changes',
      'readImage',
      'writeImage',
      'readRevision',
      'writeCommitMarker',
      'hasCommitMarker',
      'removeCommitMarker'
    ] as const) {
      const method = input?.[key]
      if (method === undefined && key !== 'forOrg' && key !== 'openNamespace') continue
      if (typeof method !== 'function')
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      result[key] = (...args: unknown[]) => Reflect.apply(method, input, args)
    }
    return Object.freeze(result) as IStorageJournalBackendBinding
  } catch (cause) {
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
}
/**
 * Resolve only the facade-issued closure; public KV shapes and matching backend names grant
 * nothing.
 */
export function resolveStorageJournalBinding(
  host: object,
  id: string
): IStorageJournalBackendAccess {
  try {
    const resolve = (host as { [storageJournalAccess]?: unknown })[storageJournalAccess]
    if (typeof resolve !== 'function')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    return Reflect.apply(resolve, host, [id]) as IStorageJournalBackendAccess
  } catch (cause) {
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
  }
}
