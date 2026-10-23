import { lockKey, type ILockKey } from '@migaia/storage-contract'
import { encodeFlatStorageKey } from '../core/key-domain.js'

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
  return lockKey.text(encodeFlatStorageKey(['storage.journal', prefix, part]))
}
