import {
  assertOperationContext,
  StorageContractError,
  StorageContractErrorCode
} from '@migaia/storage-contract'

/** Resolve one configured physical target while retaining every backend's existing defaults. */
export function resolveStorageNamespace(configured: string): string
export function resolveStorageNamespace(
  configured: string,
  orgId: string,
  defaultOrgId: string
): string
export function resolveStorageNamespace(
  configured: string,
  orgId?: string,
  defaultOrgId?: string
): string {
  if (typeof configured !== 'string')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  if (arguments.length !== 1) {
    assertOperationContext({ orgId })
    assertOperationContext({ orgId: defaultOrgId })
  }
  if (configured.length > 36 && configured.at(-37) === '/') {
    /** Only the canonical validator decides whether a suffix is a UUID. */
    let reserved = false
    try {
      assertOperationContext({ orgId: configured.slice(-36) })
      reserved = true
    } catch (error) {
      if (
        !(error instanceof StorageContractError) ||
        error.code !== StorageContractErrorCode.invalidArgument
      )
        throw error
    }
    if (reserved) throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  }
  return arguments.length === 1 || orgId === defaultOrgId ? configured : `${configured}/${orgId}`
}
