import { asCodecValue, toPortableValue } from '@migaia/serialize/codec'
import { snapshotStorageVector } from '@migaia/storage-contract'
import type { Schemas } from '@qdrant/js-client-rest'
import { capture, invalidArgument } from './errors.js'
import { QdrantText } from './constants.js'
/** Native request snapshots use the original portable owner, never a second JSON validator. */
export function nativeRequest<T extends object>(request: T): T {
  return capture(() => asCodecValue(toPortableValue(request)) as T)
}
/** Sparse indices are one finite native input with a single uniqueness pass. */
export function validateSparse(vector: Schemas['SparseVector']): void {
  const { indices, values } = vector
  if (!Array.isArray(indices) || !Array.isArray(values) || indices.length !== values.length)
    throw invalidArgument()
  const seen = new Set<number>()
  for (let index = 0; index < indices.length; index++) {
    const id = indices[index],
      value = values[index]
    if (
      !Number.isSafeInteger(id) ||
      id! < 0 ||
      seen.has(id!) ||
      typeof value !== 'number' ||
      !Number.isFinite(value)
    )
      throw invalidArgument()
    seen.add(id!)
  }
}
/** Validate the configured branch and return whether it uses the native sparse slot. */
export function validateBranch(
  name: string,
  query: Schemas['VectorInput'],
  info: Schemas['CollectionInfo']
): boolean {
  const dense = info.config.params.vectors,
    sparse = info.config.params.sparse_vectors
  const configuration = dense && typeof dense === 'object' ? Reflect.get(dense, name) : undefined
  if (configuration) {
    if (typeof query === 'object' && query !== null && !Array.isArray(query))
      throw invalidArgument()
    if (Array.isArray(query))
      snapshotStorageVector(
        query as readonly number[],
        {
          dimensions: configuration.size,
          metric: configuration.distance === 'Cosine' ? 'cosine' : 'dot'
        },
        QdrantText.backend
      )
    return false
  }
  if (sparse && Object.hasOwn(sparse, name)) {
    if (Array.isArray(query)) throw invalidArgument()
    if (typeof query === 'object' && query !== null && !Array.isArray(query) && 'indices' in query)
      validateSparse(query as Schemas['SparseVector'])
    return true
  }
  throw invalidArgument()
}
