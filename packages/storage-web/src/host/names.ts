import { StorageError, StorageErrorCode } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { assertStorageBackendId } from './contracts.js'

/** Stable singleton PluginHost registration name for the future shared live-query service. */
export const STORAGE_LIVE_QUERY_SERVICE_NAME = 'storage-live-query-service'

/** Encodes one validated ASCII backend ID into the collision-free PluginHost namespace. */
export const pluginNameFromBackendId = (id: string): string => {
  assertStorageBackendId(id)
  const bytes = Array.from(id, (character) => character.charCodeAt(0))
  return `storage-backend:${bytes.map((value) => value.toString(16).toUpperCase().padStart(2, '0')).join('')}`
}

/** Produces the canonical adapter registration name without exposing user IDs to PluginHost. */
export const reactiveAdapterNameFromBackendId = (id: string): string => {
  try {
    return `storage-reactive-adapter:${pluginNameFromBackendId(id).slice('storage-backend:'.length)}`
  } catch (cause) {
    if (cause instanceof StorageError) throw cause
    throw new StorageError(
      StorageErrorCode.backendIdInvalid,
      { cause },
      StorageErrorText.backendIdInvalid
    )
  }
}
