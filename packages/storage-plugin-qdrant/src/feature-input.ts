import { asCodecValue, toPortableValue } from '@migaia/serialize/codec'
import {
  snapshotStorageVector,
  snapshotStorageVectorCollection,
  snapshotStorageVectorIds,
  assertStringStorageKey
} from '@migaia/storage-contract'
import type { Schemas } from '@qdrant/js-client-rest'
import { capture, invalidArgument } from './errors.js'
import { QdrantText } from './constants.js'
import type {
  IQdrantRescoreOptions,
  IQdrantRescoreConfiguration,
  IQdrantRescoreVector,
  IQdrantRescorePoint
} from './feature-types.js'
/** Installation captures each caller property once and delegates names, metric and dimensions. */
export function snapshotRescoreOptions(
  options: IQdrantRescoreOptions
): IQdrantRescoreConfiguration {
  return capture(() => {
    const { collections } = options
    if (collections === null || typeof collections !== 'object' || Array.isArray(collections))
      throw invalidArgument()
    return Object.freeze(
      Object.fromEntries(
        Object.entries(collections).map(([name, slot]) => {
          const { dimensions, metric = 'cosine', multivector } = slot
          if (multivector !== undefined && multivector !== 'max_sim') throw invalidArgument()
          const configuration = snapshotStorageVectorCollection(
            name,
            { dimensions, metric },
            QdrantText.backend
          ).options!
          return [
            name,
            Object.freeze({
              ...configuration,
              ...(multivector === undefined ? {} : { multivector })
            })
          ]
        })
      )
    )
  })
}
/** This protocol-specific matrix shape reuses the canonical dense-vector component snapshot. */
export function snapshotRescoreVector(value: IQdrantRescoreVector): IQdrantRescoreVector {
  return capture(() => {
    if (!Array.isArray(value) || value.length === 0) throw invalidArgument()
    const captured = Array.from(value)
    if (!Array.isArray(captured[0]))
      return snapshotStorageVector(captured as readonly number[], undefined, QdrantText.backend)
    const vectors = captured.map((row) =>
      snapshotStorageVector(row as readonly number[], undefined, QdrantText.backend)
    )
    if (vectors.some((row) => row.length !== vectors[0]!.length)) throw invalidArgument()
    return Object.freeze(vectors)
  })
}
/** One native write batch has dense unique logical IDs and detached vectors before any I/O. */
export function snapshotRescorePoints(
  points: readonly IQdrantRescorePoint[]
): readonly IQdrantRescorePoint[] {
  return capture(() => {
    if (!Array.isArray(points)) throw invalidArgument()
    const captured = Array.from(points, (point) => {
      const { id, vector } = point
      assertStringStorageKey(id, QdrantText.backend)
      return Object.freeze({ id, vector: snapshotRescoreVector(vector) })
    })
    snapshotStorageVectorIds(
      captured.map((point) => point.id),
      QdrantText.backend,
      true
    )
    return Object.freeze(captured)
  })
}
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
