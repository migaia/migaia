import { Parser, Writer, DataFactory } from 'n3'
import type { Term, Quad } from '@rdfjs/types'
import { term, snapshotStorageRdfTerm } from '@migaia/storage-host/sdk'
import { RdfTermType, type IRdfTerm, type IRawQuad } from '@migaia/storage-contract'
import { sparqlError } from './errors.ts'
import { SparqlErrorCode } from '@migaia/storage-contract/error-code'
import { SparqlErrorText } from './error-text.ts'
import type { IRdfGraphDocument, IRdfGraphFormat } from './endpoint.ts'
/** Real RDF/JS terms map to the shared complete RDF 1.1 term domain. */
function fromNative(value: Term): IRdfTerm {
  if (value.termType === 'NamedNode') return term.iri(value.value)
  if (value.termType === 'BlankNode')
    return snapshotStorageRdfTerm(
      { termType: RdfTermType.blankNode, value: value.value },
      undefined
    )
  if (value.termType === 'DefaultGraph') return term.defaultGraph
  if (value.termType === 'Literal')
    return term.literal(
      value.value,
      value.language ? { language: value.language } : { datatype: value.datatype.value }
    )
  throw new TypeError(SparqlErrorText.responseInvalid)
}
/**
 * A fresh parse scope separates blank labels in separate documents while retaining sharing inside
 * one.
 */
export function parseRdfDocument(document: IRdfGraphDocument): readonly IRawQuad[] {
  try {
    /** The real RDF peer parses the complete native document before canonical result conversion. */
    const quads = new Parser({
      format: document.format,
      blankNodePrefix: 'doc' + crypto.randomUUID().replaceAll('-', '') + '_'
    }).parse(document.text)
    return quads.map((quad): IRawQuad => {
      /** The real RDF parser result is converted once into canonical ground quad fields. */
      const subject = fromNative(quad.subject),
        predicate = fromNative(quad.predicate),
        object = fromNative(quad.object),
        graph = fromNative(quad.graph)
      if (
        (subject.termType !== RdfTermType.namedNode &&
          subject.termType !== RdfTermType.blankNode) ||
        predicate.termType !== RdfTermType.namedNode ||
        object.termType === RdfTermType.defaultGraph ||
        graph.termType === RdfTermType.literal
      )
        throw new TypeError(SparqlErrorText.responseInvalid)
      return { subject, predicate, object, graph }
    })
  } catch (cause) {
    throw sparqlError(SparqlErrorCode.responseInvalid, cause)
  }
}
/** Native writer owns RDF escaping and blank serialization; no second N-Triples codec exists. */
export function writeRdfDocument(
  quads: readonly IRawQuad[],
  format: IRdfGraphFormat
): Promise<string> {
  /** Only this complete canonical quad is converted to the real RDF writer representation. */
  const native = (value: IRdfTerm): Term =>
    value.termType === RdfTermType.namedNode
      ? DataFactory.namedNode(value.value)
      : value.termType === RdfTermType.blankNode
        ? DataFactory.blankNode(value.value)
        : value.termType === RdfTermType.defaultGraph
          ? DataFactory.defaultGraph()
          : DataFactory.literal(
              value.value,
              value.language ?? DataFactory.namedNode(value.datatype)
            )
  /** The existing RDF peer owns escaping and complete document serialization. */
  const writer = new Writer({ format })
  for (const quad of quads)
    writer.addQuad(
      DataFactory.quad(
        native(quad.subject) as Quad['subject'],
        native(quad.predicate) as Quad['predicate'],
        native(quad.object) as Quad['object'],
        native(quad.graph) as Quad['graph']
      )
    )
  return new Promise((resolve, reject) =>
    writer.end((error, result) =>
      error ? reject(sparqlError(SparqlErrorCode.responseInvalid, error)) : resolve(result)
    )
  )
}
