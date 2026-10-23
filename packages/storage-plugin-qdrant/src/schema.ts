import type { Schemas } from '@qdrant/js-client-rest'
import type { IStorageVectorConfiguration } from '@migaia/storage-contract'
import { QdrantManagedVectorName } from './constants.js'
import { invalidArgument, qdrantError } from './errors.js'
import { QdrantErrorCode } from './error-code.js'
/** Native distances retain the public metric's exact engine meaning. */
export const QdrantDistance = { cosine: 'Cosine', dot: 'Dot', euclid: 'Euclid' } as const
/** Cosine's second Dot slot preserves input amplitude without participating in ranking. */
export function collectionVectors(
  configuration: IStorageVectorConfiguration
): Record<string, Schemas['VectorParams']> {
  const search = { size: configuration.dimensions, distance: QdrantDistance[configuration.metric] }
  return {
    [QdrantManagedVectorName.search]: search,
    ...(configuration.metric === 'cosine'
      ? {
          [QdrantManagedVectorName.source]: {
            size: configuration.dimensions,
            distance: QdrantDistance.dot,
            hnsw_config: { m: 0, payload_m: 0 }
          }
        }
      : {})
  }
}
/** External schema changes never silently change the managed metric or normalize source samples. */
export function readCollectionConfiguration(
  info: Schemas['CollectionInfo'],
  requested?: IStorageVectorConfiguration
): IStorageVectorConfiguration {
  const vectors = info?.config?.params?.vectors
  if (!vectors || Array.isArray(vectors) || typeof vectors !== 'object')
    throw qdrantError(QdrantErrorCode.responseInvalid)
  const search = Reflect.get(vectors, QdrantManagedVectorName.search)
  if (!search || !Number.isSafeInteger(search.size) || search.size < 1) throw invalidArgument()
  const metric =
    search.distance === QdrantDistance.cosine
      ? 'cosine'
      : search.distance === QdrantDistance.dot
        ? 'dot'
        : search.distance === QdrantDistance.euclid
          ? 'euclid'
          : undefined
  if (!metric) throw invalidArgument()
  const keys = Object.keys(vectors),
    source = Reflect.get(vectors, QdrantManagedVectorName.source)
  if (
    metric === 'cosine'
      ? keys.length !== 2 ||
        !source ||
        source.size !== search.size ||
        source.distance !== QdrantDistance.dot ||
        source.hnsw_config?.m !== 0 ||
        source.hnsw_config?.payload_m !== 0 ||
        source.quantization_config != null
      : keys.length !== 1
  )
    throw invalidArgument()
  if (requested && (requested.dimensions !== search.size || requested.metric !== metric))
    throw invalidArgument()
  return Object.freeze({ dimensions: search.size, metric })
}
