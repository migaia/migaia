/** Stable native vector-backend error domain. */
export const ERROR_SOURCE = 'storage.backend.qdrant'
/** Native protocol failures retain their original response or transport cause. */
export const QdrantErrorCode = {
  /** The native service or transport failed; a dispatched modification may have an unknown outcome. */
  unavailable: 'QDRANT_UNAVAILABLE',
  /** A native 4xx explicitly rejected the request; inspect the original response. */
  requestFailed: 'QDRANT_REQUEST_FAILED',
  /** A necessary native response field or managed envelope cannot be decoded. */
  responseInvalid: 'QDRANT_RESPONSE_INVALID'
} as const
export type IQdrantErrorCode = (typeof QdrantErrorCode)[keyof typeof QdrantErrorCode]
