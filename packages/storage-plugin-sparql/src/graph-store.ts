import { snapshotStorageRdfTerm, RdfTermType } from '@migaia/storage-contract'
import { capture, invalidArgument } from './errors.js'
import { SparqlText } from './text.js'
import type { IRdfGraphTarget, IRdfGraphFormat, IRdfGraphDocument } from './endpoint.js'
import type { ISparqlEndpoint, ISparqlGraphStorePort } from './endpoint.js'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
/** Environment detection checks the actual native port without issuing a hidden request. */
export function requireGraphStore(endpoint: ISparqlEndpoint): ISparqlGraphStorePort {
  const port = endpoint.graphStore
  if (
    !port ||
    typeof port.get !== 'function' ||
    typeof port.put !== 'function' ||
    typeof port.post !== 'function' ||
    typeof port.remove !== 'function' ||
    typeof port.has !== 'function'
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: SparqlText.backend
    })
  return port
}
/** Standard graph operations cannot read or modify the internal commit marker graph. */
export function snapshotGraphTarget(value: IRdfGraphTarget): IRdfGraphTarget {
  return capture(() => {
    if (typeof value !== 'object' || value === null) throw invalidArgument()
    const defaultGraph = value.default,
      graph = value.graph
    if (defaultGraph === true && graph === undefined) return Object.freeze({ default: true })
    if (defaultGraph !== undefined || graph === undefined) throw invalidArgument()
    const captured = snapshotStorageRdfTerm(graph, SparqlText.backend)
    if (captured.termType !== RdfTermType.namedNode || captured.value === SparqlText.marker)
      throw invalidArgument()
    return Object.freeze({ graph: captured })
  })
}
/** Omission alone applies the documented Turtle default. */
export function snapshotGraphFormat(format?: IRdfGraphFormat): IRdfGraphFormat {
  const captured = format === undefined ? SparqlText.turtle : format
  if (captured !== SparqlText.turtle && captured !== SparqlText.triples) throw invalidArgument()
  return captured
}
/** Document bytes detach from mutable option objects before native work. */
export function snapshotGraphDocument(document: IRdfGraphDocument): IRdfGraphDocument {
  return capture(() => {
    const suppliedFormat = document.format
    if (suppliedFormat === undefined) throw invalidArgument()
    const format = snapshotGraphFormat(suppliedFormat),
      text = document.text
    if (typeof text !== 'string') throw invalidArgument()
    return Object.freeze({ format, text })
  })
}
