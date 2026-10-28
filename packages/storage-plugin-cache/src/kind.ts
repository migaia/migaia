import { defineStorageBackendKind } from '@migaia/storage-host'
import { CacheText } from './constants.ts'
import type { ICacheStore } from './types.ts'
/** Exact kind identity admits only cache Features without exposing any tier as a native client. */
export const cacheBackendKind = defineStorageBackendKind<ICacheStore, undefined>()(
  CacheText.backend
)
