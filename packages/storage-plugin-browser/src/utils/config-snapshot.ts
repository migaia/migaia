import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'

/**
 * Copy caller configuration with one read of each own enumerable property. A throwing getter or
 * Proxy trap becomes the browser INVALID_CONFIG error with the original on `cause`. A non-object or
 * an array is returned unchanged for the caller's own shape check.
 */
export function snapshotBrowserConfig<T>(
  options: T,
  code: (typeof StorageBrowserErrorCode)[keyof typeof StorageBrowserErrorCode] = StorageBrowserErrorCode.invalidConfig
): T {
  if (options === null || typeof options !== 'object') return options
  try {
    return Array.isArray(options) ? options : { ...options }
  } catch (cause) {
    throw new StorageError(code, { cause })
  }
}
