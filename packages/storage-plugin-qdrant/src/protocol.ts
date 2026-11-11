import { QdrantRoute } from './constants.ts'
import type { IQdrantHttp, IQdrantOperationName } from './types.ts'
import { QdrantErrorCode } from '@migaia/storage-contract/error-code'
import { qdrantError } from './errors.ts'
/** Result unwrapping retains native optional fields, booleans and snapshot nullability. */
export function nativeResult<K extends IQdrantOperationName>(
  name: K,
  value: unknown
): Awaited<ReturnType<IQdrantHttp[K]>> {
  // The SDK's snapshot method maps an accepted response without a result to null.
  if (name === QdrantRoute.createSnapshot.name && value === undefined) value = null
  if (
    name === QdrantRoute.createCollection.name ||
    name === QdrantRoute.deleteCollection.name ||
    name === QdrantRoute.updateCollectionAliases.name
  ) {
    if (typeof value !== 'boolean') throwResponseInvalid()
  } else if (name === QdrantRoute.createSnapshot.name) {
    if (value !== null && (typeof value !== 'object' || Array.isArray(value)))
      throwResponseInvalid()
  } else if (name === QdrantRoute.retrieve.name || name === QdrantRoute.recommend.name) {
    if (!Array.isArray(value)) throwResponseInvalid()
  } else if (value === null || typeof value !== 'object' || Array.isArray(value))
    throwResponseInvalid()
  return value as Awaited<ReturnType<IQdrantHttp[K]>>
}
/** A native response whose result has the wrong shape for its route. */
function throwResponseInvalid(): never {
  throw qdrantError(QdrantErrorCode.responseInvalid)
}
