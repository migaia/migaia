import { compareStorageKeys } from './key-domain.js'
import type { IKeyRange, IStorageKey } from '../types/context.js'

/** Apply the shared inclusive/exclusive storage-key range contract. */
export const isStorageKeyInRange = (key: IStorageKey, range: IKeyRange | undefined): boolean => {
  if (!range) return true
  if (range.lower !== undefined) {
    const comparison = compareStorageKeys(key, range.lower)
    if (range.lowerOpen ? comparison <= 0 : comparison < 0) return false
  }
  if (range.upper !== undefined) {
    const comparison = compareStorageKeys(key, range.upper)
    if (range.upperOpen ? comparison >= 0 : comparison > 0) return false
  }
  return true
}
