/** Convert config values to JSON data with the ConfigOwner unsupported-value policy. */
import { ConfigReason } from './config-text.ts'
import { UtilsErrorCode } from '../error-code.ts'
import { UtilsErrorText } from '../error-text.ts'
import { isPlainObject } from '../object.ts'
import { ownerError } from './config-owner-error.ts'

/**
 * Converts an owned graph into JSON data. Dates use `toISOString()`; values JSON cannot represent
 * (Map, Set, functions, bigint, symbols) throw `CONFIG_UNSUPPORTED`.
 */
export function toPlain(value: unknown, path: string, depth: number): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === undefined) return undefined
  if (value instanceof Date) return value.toISOString()
  if (depth > 256)
    throw ownerError(
      TypeError,
      UtilsErrorCode.configUnsupported,
      UtilsErrorText.configUnsupported(path, ConfigReason.jsonTooDeep)
    )
  if (Array.isArray(value))
    return value.map((item, index) => {
      /** JSON writes `undefined` array items as `null`. */
      const plain = toPlain(item, `${path}.${index}`, depth + 1)
      return plain === undefined ? null : plain
    })
  if (isPlainObject(value)) {
    /** Plain output record. */
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      /** Converted child; `undefined` keys are omitted as `JSON.stringify` does. */
      const plain = toPlain(value[key], `${path}.${key}`, depth + 1)
      if (plain !== undefined) out[key] = plain
    }
    return out
  }
  throw ownerError(
    TypeError,
    UtilsErrorCode.configUnsupported,
    UtilsErrorText.configUnsupported(path, ConfigReason.notJsonSerializable)
  )
}
