import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageResource
} from '@migaia/storage-contract'
import type { IStorageJournalBackendBinding } from './types.js'

/** This internal symbol lives only on the original facade and its fixed-org projection shells. */
export const storageJournalAccess = Symbol()
/** A resolved view cannot change org, install a backend, close the host, or return a raw store. */
export type IStorageJournalBackendAccess = {
  readonly registration: object
  readonly orgId: string
  readonly backendInstanceId: string
  readonly binding: Omit<IStorageJournalBackendBinding, 'forOrg'>
  retain(resource: IStorageResource): () => void
}
/** Borrow native author methods directly on their original descriptor receiver. */
export function snapshotStorageJournalBinding(
  input: IStorageJournalBackendBinding
): IStorageJournalBackendBinding {
  const result = Object.create(null) as Record<string, unknown>
  /** Only the original descriptor grants this bounded text-draft projection. */
  const redo = input?.redo
  if (redo !== undefined) {
    if (redo === null || typeof redo !== 'object')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    const captured: Record<string, unknown> = Object.create(null)
    for (const key of [
      'transactionInfo',
      'changes',
      'protect',
      'apply',
      'replay',
      'seal'
    ] as const) {
      const method = redo[key]
      if (typeof method !== 'function')
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      captured[key] = (...args: unknown[]) =>
        (redo as unknown as Record<string, (...values: unknown[]) => unknown>)[key]!(...args)
    }
    result.redo = captured
  }
  /** Native authors declare this finite opt-in fact; backend names do not imply it. */
  const requiresIndexedDbUndo = input?.requiresIndexedDbUndo
  if (requiresIndexedDbUndo !== undefined) {
    if (requiresIndexedDbUndo !== true)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    result.requiresIndexedDbUndo = true
  }
  /** This fact belongs to the original factory, not the backend name or nativeAtomic flag. */
  const externalWal = input?.externalWal
  if (externalWal !== undefined) {
    if (externalWal !== true)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    result.externalWal = true
  }
  for (const key of [
    'forOrg',
    'lockTarget',
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
    result[key] = (...args: unknown[]) =>
      (input as unknown as Record<string, (...values: unknown[]) => unknown>)[key]!(...args)
  }
  return result as IStorageJournalBackendBinding
}
/**
 * Resolve only the facade-issued closure; public KV shapes and matching backend names grant
 * nothing.
 */
export function resolveStorageJournalBinding(
  host: object,
  id: string
): IStorageJournalBackendAccess {
  /** The original facade issues this exact method; matching public store labels grant nothing. */
  const owner = host as { [storageJournalAccess]?: (id: string) => IStorageJournalBackendAccess }
  if (typeof owner[storageJournalAccess] !== 'function')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return owner[storageJournalAccess](id)
}
