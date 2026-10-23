import {
  snapshotStorageRdfQuad,
  snapshotStorageRdfPattern,
  encodeStorageRdfQuad,
  sparqlFragment,
  prefixStorageOrgGraph,
  term,
  type IQuad,
  type ISparqlFragment
} from '@migaia/storage-contract'
import { bytesToBase64 } from '@migaia/utils/bytes'
import { capture, invalidArgument } from './errors.js'
import { SparqlText } from './text.js'
/** Draft membership reuses the canonical ground quad codec rather than inventing RDF identity. */
export function quadIdentity(quad: IQuad): string {
  return bytesToBase64(encodeStorageRdfQuad(quad, SparqlText.backend))
}
/** Capture a complete batch before any mutation, including sparse and changing array inputs. */
export function captureQuads(quads: readonly IQuad[]): readonly IQuad[] {
  return capture(() => {
    if (!Array.isArray(quads)) throw invalidArgument()
    const count = quads.length,
      result: IQuad[] = []
    for (let index = 0; index < count; index++) {
      const quad = snapshotStorageRdfQuad(quads[index]!, SparqlText.backend)
      if (quad.graph.termType === 'NamedNode' && quad.graph.value === SparqlText.marker)
        throw invalidArgument()
      result.push(quad)
    }
    return Object.freeze(result)
  })
}
/** Shared validation and canonical equality also govern each pending draft candidate. */
export function matchesQuad(quad: IQuad, pattern: Readonly<Partial<IQuad>>): boolean {
  return quadIdentity(quad) === quadIdentity({ ...quad, ...pattern })
}
/** Only validated ground values enter the single shared SPARQL compiler. */
export function quadFragment(orgId: string, quad: IQuad): ISparqlFragment {
  return sparqlFragment`GRAPH ${prefixStorageOrgGraph(orgId, quad.graph)} { ${quad.subject} ${quad.predicate} ${quad.object} . }`
}
/** One native query handles the organization's physical default and named graphs together. */
export function matchFragment(
  orgId: string,
  pattern: Partial<IQuad>,
  prefix: string
): ISparqlFragment {
  const captured = snapshotStorageRdfPattern(pattern, SparqlText.backend)
  if (captured.graph?.termType === 'NamedNode' && captured.graph.value === SparqlText.marker)
    throw invalidArgument()
  const subject = captured.subject ?? sparqlFragment.var('s'),
    predicate = captured.predicate ?? sparqlFragment.var('p'),
    object = captured.object ?? sparqlFragment.var('o')
  const target =
    captured.graph === undefined
      ? sparqlFragment.var('g')
      : prefixStorageOrgGraph(orgId, captured.graph)
  const binding = sparqlFragment.join([
    ...(captured.subject ? [sparqlFragment`BIND(${captured.subject} AS ?s)`] : []),
    ...(captured.predicate ? [sparqlFragment`BIND(${captured.predicate} AS ?p)`] : []),
    ...(captured.object ? [sparqlFragment`BIND(${captured.object} AS ?o)`] : []),
    ...(captured.graph ? [sparqlFragment`BIND(${target} AS ?g)`] : [])
  ])
  return sparqlFragment`SELECT ?s ?p ?o ?g WHERE { GRAPH ${target} { ${subject} ${predicate} ${object} } ${binding} FILTER(STRSTARTS(STR(?g),${term.literal(prefix)})) FILTER(isIRI(?s)&&isIRI(?p)&&(isIRI(?o)||isLiteral(?o))&&isIRI(?g)) }`
}
