import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'

/** Generate one native lowercase UUID; hosts without secure UUID support receive the original cause. */
export function createOrgId(): string {
  try {
    /** Neutral typing retains the original native receiver without depending on DOM declarations. */
    const entropy = Reflect.get(globalThis, 'crypto') as { randomUUID(): string }
    return entropy.randomUUID().toLowerCase()
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.unsupported, { cause })
  }
}
