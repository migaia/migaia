import { normalizePortable } from '../contract/normalize.js'
import { RpcCoreErrorCode, tagRpcError } from '../core/errors.js'
import type { IThreadSpec } from '@migaia/supervision/threads'
import { ThreadErrorText } from './error-text.js'

/** Preserve native TypeError and original cause while naming the rejected field. */
export function invalidThreadConfig(field: string, message: string, cause?: unknown): never {
  /** Error identity attaches to the original native error, including its stack. */
  const error = tagRpcError(new TypeError(message, { cause }), RpcCoreErrorCode.invalidConfig)
  Object.defineProperty(error, 'detail', { value: Object.freeze({ field }), enumerable: true })
  throw error
}

/** Snapshot portable data before any supervisor or Worker is constructed. */
export function portableThreadSpec(spec: IThreadSpec): IThreadSpec {
  if (spec?.data === undefined) return spec
  try {
    return { ...spec, data: normalizePortable(spec.data) }
  } catch (error) {
    return invalidThreadConfig('spec.data', ThreadErrorText.invalidData, error)
  }
}

/** Launchers resolve absolute entries only; module-relative URLs are never guessed. */
export function absoluteThreadEntry(entry: string, node: boolean): string | URL {
  if (node && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(entry)) return entry
  try {
    /** URL construction rejects relative references without touching the filesystem. */
    const url = new URL(entry)
    if (!node || url.protocol === 'file:') return url
  } catch (error) {
    return invalidThreadConfig('spec.entry', ThreadErrorText.invalidEntry, error)
  }
  return invalidThreadConfig('spec.entry', ThreadErrorText.invalidEntry)
}
