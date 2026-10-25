/** Stable diagnostics never copy credentials or request payloads. */
export const QdrantErrorText = {
  argument: 'qdrant operation arguments are invalid',
  unavailable: 'qdrant service or transport is unavailable',
  requestFailed: 'qdrant request was rejected',
  responseInvalid: 'qdrant response is invalid'
} as const
