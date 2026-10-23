import type { IQdrantHttp, IQdrantOperationName } from './types.js'
import { QdrantErrorCode } from './error-code.js'
import { qdrantError } from './errors.js'
/** Result unwrapping retains native optional fields, booleans and snapshot nullability. */
export function nativeResult<K extends IQdrantOperationName>(
  name: K,
  value: unknown
): Awaited<ReturnType<IQdrantHttp[K]>> {
  // The SDK's snapshot method maps an accepted response without a result to null.
  if (name === 'createSnapshot' && value === undefined) value = null
  const bad = () => {
    throw qdrantError(QdrantErrorCode.responseInvalid)
  }
  if (
    name === 'createCollection' ||
    name === 'deleteCollection' ||
    name === 'updateCollectionAliases'
  ) {
    if (typeof value !== 'boolean') bad()
  } else if (name === 'createSnapshot') {
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) bad()
  } else if (name === 'retrieve' || name === 'recommend') {
    if (!Array.isArray(value)) bad()
  } else if (value === null || typeof value !== 'object' || Array.isArray(value)) bad()
  return value as Awaited<ReturnType<IQdrantHttp[K]>>
}
