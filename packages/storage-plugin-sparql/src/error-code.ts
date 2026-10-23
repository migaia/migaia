/** Stable error identity for the native RDF and SPARQL backend domain. */
export const ERROR_SOURCE = 'storage.backend.sparql'
/** Semantic identities distinguish definite protocol rejection from an unknown modification. */
export const SparqlErrorCode = {
  /** Native result or RDF document cannot be decoded; inspect its original parse cause. */
  responseInvalid: 'SPARQL_RESPONSE_INVALID',
  /** Native reads failed through transport or server failure; retry only under caller policy. */
  unavailable: 'SPARQL_UNAVAILABLE',
  /** Native request was explicitly rejected; inspect its status and response body. */
  requestFailed: 'SPARQL_REQUEST_FAILED',
  /** Modification may have committed; verify the dataset before creating another writer. */
  commitUnknown: 'SPARQL_COMMIT_UNKNOWN'
} as const
export type ISparqlErrorCode = (typeof SparqlErrorCode)[keyof typeof SparqlErrorCode]
