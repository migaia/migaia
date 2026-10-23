import { snapshotStorageRdfTerm, RdfTermType } from '@migaia/storage-contract'
import { capture, invalidArgument } from './errors.js'
import { SparqlText } from './text.js'
import type { IRdfGraphTarget, IRdfGraphFormat, IRdfGraphDocument } from './endpoint.js'
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
    if (document.format === undefined) throw invalidArgument()
    const format = snapshotGraphFormat(document.format),
      text = document.text
    if (typeof text !== 'string') throw invalidArgument()
    return Object.freeze({ format, text })
  })
}
