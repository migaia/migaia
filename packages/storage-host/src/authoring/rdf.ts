import {
  RdfTermType,
  RdfDatatype,
  RdfQuadPosition,
  type IRdfNamedNode,
  type IRdfBlankNode,
  type IRdfLiteral,
  type IRdfDefaultGraph,
  type IRdfTerm,
  type IQuad,
  invalidRdf,
  assertRdfIri,
  assertRdfLiteral,
  assertStorageRdfTerm,
  assertStorageRdfPattern,
  assertStorageRdfQuad,
  type IBackendKind,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText,
  type IStorageKey,
  assertStorageOrgId
} from '@migaia/storage-contract'
import { encodeOrderedStorageKey } from './key.ts'

/** DefaultGraph has one canonical value and no generated blank-node identity. */
const DEFAULT_GRAPH: IRdfDefaultGraph = { termType: RdfTermType.defaultGraph }

/** Generated raw labels are unique only within this term factory's runtime. */
let blankSequence = 0

/** Absolute IRI factories allocate only their public result after canonical admission. */
function rdfIri(value: unknown, backend: IBackendKind | undefined): IRdfNamedNode {
  assertRdfIri(value, backend)
  return { termType: RdfTermType.namedNode, value }
}

/** Creates a literal result after the same canonical structural validation used by native authors. */
function rdfLiteral(
  value: string,
  datatype: string,
  language: string | undefined,
  backend: IBackendKind | undefined
): IRdfLiteral {
  assertRdfLiteral(value, datatype, language, backend)
  return {
    termType: RdfTermType.literal,
    value,
    datatype,
    ...(language === undefined ? {} : { language: language.toLowerCase() })
  }
}

/** Copy only admitted structural fields when the result must survive asynchronous caller mutation. */
function copyRdfTerm(value: IRdfTerm): IRdfTerm {
  switch (value.termType) {
    case RdfTermType.defaultGraph:
      return DEFAULT_GRAPH
    case RdfTermType.literal:
      return {
        termType: value.termType,
        value: value.value,
        datatype: value.datatype,
        ...(value.language === undefined ? {} : { language: value.language.toLowerCase() })
      }
    default:
      return { termType: value.termType, value: value.value }
  }
}

/** Snapshots direct structural terms only when a deferred consumer needs an independent value. */
export function snapshotStorageRdfTerm(
  value: IRdfTerm,
  backend: IBackendKind | undefined
): IRdfTerm {
  assertStorageRdfTerm(value, backend)
  return copyRdfTerm(value)
}

/** Copy admitted positions once; completeness and raw-term admission belong to the pure guards. */
function copyRdfPattern(pattern: Partial<IQuad>): Partial<IQuad> {
  /** Only supplied positions enter the independent result. */
  const result: Partial<Record<keyof IQuad, IRdfTerm>> = {}
  for (const position of Object.values(RdfQuadPosition)) {
    /** Each term is copied after canonical validation, without another guard traversal. */
    const value = pattern[position]
    if (value !== undefined) result[position] = copyRdfTerm(value)
  }
  return result as Partial<IQuad>
}

/** Capture a partial pattern before a deferred query can observe later caller mutation. */
export function snapshotStorageRdfPattern(
  pattern: Partial<IQuad>,
  backend: IBackendKind | undefined
): Readonly<Partial<IQuad>> {
  assertStorageRdfPattern(pattern, backend)
  return copyRdfPattern(pattern)
}

/** Capture all ground positions before a queued write or lock can observe caller mutation. */
export function snapshotStorageRdfQuad(quad: IQuad, backend: IBackendKind | undefined): IQuad {
  assertStorageRdfQuad(quad, backend)
  return copyRdfPattern(quad) as IQuad
}

/** Projects an already captured term into self-delimiting components for the original key writer. */
function rdfTermKey(value: IRdfTerm): IStorageKey {
  if (value.termType === RdfTermType.defaultGraph) return [value.termType]
  if (value.termType === RdfTermType.literal)
    return [value.termType, value.value, value.datatype, value.language?.toLowerCase() ?? '']
  return [value.termType, value.value]
}

/**
 * Encodes one canonical RDF term with the original self-delimiting key writer. Native index
 * permutations can concatenate these bytes directly without reclassifying them as public binary
 * keys or applying a second term codec. Raw blank labels remain request-local identities.
 */
export function encodeStorageRdfTerm(
  value: IRdfTerm,
  backend: IBackendKind | undefined
): Uint8Array {
  assertStorageRdfTerm(value, backend)
  return encodeOrderedStorageKey(rdfTermKey(value), backend)
}

/** Internal lock/native authors encode a validated quad without a second input traversal. */
export function encodeRdfQuadSnapshot(quad: IQuad): Uint8Array {
  return encodeOrderedStorageKey(
    [
      rdfTermKey(quad.subject),
      rdfTermKey(quad.predicate),
      rdfTermKey(quad.object),
      rdfTermKey(quad.graph)
    ],
    undefined
  )
}

/** Canonical term identity uses only the original self-delimiting ordered-key encoder. */
export function encodeStorageRdfQuad(quad: IQuad, backend: IBackendKind | undefined): Uint8Array {
  assertStorageRdfQuad(quad, backend)
  return encodeRdfQuadSnapshot(quad)
}

/** Pure RDF factories preserve ground/raw distinction and own no backend resource or query. */
export const term = /* @__PURE__ */ Object.freeze({
  /** Creates an exact absolute IRI without URL normalization. */
  iri: (value: string): IRdfNamedNode => rdfIri(value, undefined),
  /** Explicit labels remain runtime-local; omission generates a fresh raw label. */
  blank(label?: string): IRdfBlankNode {
    /** Generated labels are stable only for this returned raw term. */
    const value = label === undefined ? `b${++blankSequence}` : label
    /** The factory owns this new result; validation does not require another copy. */
    const result = { termType: RdfTermType.blankNode, value } as const
    assertStorageRdfTerm(result, undefined)
    return result
  },
  /** Omitted annotation becomes xsd:string; language alone becomes rdf:langString. */
  literal(
    value: string,
    options?:
      | { readonly language?: string; readonly datatype?: never }
      | { readonly language?: never; readonly datatype?: string }
  ): IRdfLiteral {
    if (
      options !== undefined &&
      (typeof options !== 'object' || options === null || Array.isArray(options))
    )
      throw invalidRdf(undefined)
    /** Options are captured once before their mutually exclusive annotations are validated. */
    const language = options?.language
    /** Datatype omission is filled only by this public factory, never by raw structural admission. */
    const datatype = options?.datatype
    if (language !== undefined && datatype !== undefined) throw invalidRdf(undefined)
    return rdfLiteral(
      value,
      datatype === undefined
        ? language === undefined
          ? RdfDatatype.string
          : RdfDatatype.langString
        : datatype,
      language,
      undefined
    )
  },
  defaultGraph: DEFAULT_GRAPH
})

/** Default and named graph tags occupy disjoint physical identities below one organization prefix. */
const storageOrgDefaultGraph = 'd'

/** Named graph IRIs use canonical percent encoding so arbitrary authorities remain valid URN paths. */
const storageOrgNamedGraph = 'n:'

/** Returns the exact native graph prefix without opening a store or selecting an organization. */
export function getStorageOrgGraphPrefix(orgId: string): string {
  assertStorageOrgId(orgId)
  return `urn:migaia:org:${orgId}:`
}

/** Reports a malformed or foreign physical graph without changing the shared RDF error owner. */
function invalidOrgGraph(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { cause },
    StorageContractErrorText.orgGraphEnvelope
  )
}

/**
 * Maps a logical default or named graph to a real named graph in the exact organization. The
 * canonical RDF position validator preserves IRI spelling before percent encoding.
 */
export function prefixStorageOrgGraph(
  orgId: string,
  graph: IRdfNamedNode | IRdfDefaultGraph
): IRdfNamedNode {
  /** UUID admission precedes reflecting the caller's graph. */
  const prefix = getStorageOrgGraphPrefix(orgId)
  /** Synchronous graph encoding borrows input after the canonical position guard. */
  assertStorageRdfPattern({ graph }, undefined)
  const captured = graph
  if (!captured) throw invalidOrgGraph()
  return term.iri(
    prefix +
      (captured.termType === RdfTermType.defaultGraph
        ? storageOrgDefaultGraph
        : storageOrgNamedGraph + encodeURIComponent(captured.value))
  )
}

/**
 * Accepts only this organization's canonical physical graph. Returned terms reuse the shared
 * factories; malformed percent encoding retains its original native error as cause.
 */
export function unprefixStorageOrgGraph(
  orgId: string,
  graph: IRdfNamedNode
): IRdfNamedNode | IRdfDefaultGraph {
  /** Canonical UUID admission precedes graph validation and envelope decoding. */
  const prefix = getStorageOrgGraphPrefix(orgId)
  /** The pure position guard admits this IRI without a synchronous throwaway snapshot. */
  assertStorageRdfPattern({ graph }, undefined)
  const captured = graph
  if (captured?.termType !== RdfTermType.namedNode || !captured.value.startsWith(prefix))
    throw invalidOrgGraph()
  /** Tags and encoded suffix are native identities, not user-controlled namespace selectors. */
  const suffix = captured.value.slice(prefix.length)
  if (suffix === storageOrgDefaultGraph) return term.defaultGraph
  if (!suffix.startsWith(storageOrgNamedGraph)) throw invalidOrgGraph()
  /** Percent decoding is the inverse of the one canonical writer, never URL normalization. */
  const encoded = suffix.slice(storageOrgNamedGraph.length)
  /** Decode errors remain reachable while envelope and term errors keep their existing owner. */
  let logical: string
  try {
    logical = decodeURIComponent(encoded)
  } catch (cause) {
    throw invalidOrgGraph(cause)
  }
  if (encodeURIComponent(logical) !== encoded) throw invalidOrgGraph()
  return term.iri(logical)
}
