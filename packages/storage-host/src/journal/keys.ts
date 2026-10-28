import { lockKey } from '../authoring/concurrency.ts'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ILockKey
} from '@migaia/storage-contract'
import { encodeFlatStorageKey } from '../core/key-domain.ts'

/** Fixed original metadata locks distinguish handle ownership from each native head update. */
export const StorageJournalLock = {
  resource: 'resource-owner',
  head: 'head'
} as const
/** Original canonical text locks protect the private prefix; no private lock table or codec exists. */
export function storageJournalLockKey(
  prefix: string,
  part: (typeof StorageJournalLock)[keyof typeof StorageJournalLock]
): ILockKey {
  if (
    typeof prefix !== 'string' ||
    prefix.length === 0 ||
    (part !== StorageJournalLock.head && part !== StorageJournalLock.resource)
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return lockKey.text(encodeFlatStorageKey(['storage.journal', prefix, part]))
}
