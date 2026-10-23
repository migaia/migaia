/** Stable public messages exclude credentials, request text and dataset contents. */
export const SparqlErrorText = {
  /** Public input cannot enter the supported native operation domain. */
  argument: 'sparql operation arguments are invalid',
  /** A native response or document does not conform to the requested RDF protocol. */
  responseInvalid: 'sparql response is invalid',
  /** A server or transport cannot finish a read. */
  unavailable: 'sparql endpoint is unavailable',
  /** A native endpoint explicitly rejected a request. */
  requestFailed: 'sparql request failed',
  /** The caller must verify an already-sent modification before reopening writing. */
  commitUnknown: 'sparql commit outcome is unknown'
} as const
