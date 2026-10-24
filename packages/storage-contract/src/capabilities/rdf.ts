import type { IOperationContext } from '../context.js'
import type { IWriteConcurrencyOptions } from '../concurrency.js'
import type { IRdfQuery, IQueryWatch } from '../query-chain.js'
import { defineStandardStorageCapability, validateCapabilityMethods } from '../capability-token.js'
import { STORAGE_RDF_METHODS, STORAGE_RDF_WRITE_METHODS } from '../capability-constants.js'
import type { IBackendKind } from '../capabilities.js'
import { StorageContractError, StorageContractErrorCode } from '../errors.js'
import { StorageContractErrorText } from '../error-text.js'
import { encodeOrderedStorageKey } from '../key-order.js'
import type { IStorageKey } from '../context.js'
import { assertStorageOrgId } from '../org.js'

/** RDF term tags are shared by canonical snapshots, query bindings and SPARQL serialization. */
export const RdfTermType = {
  namedNode: 'NamedNode',
  blankNode: 'BlankNode',
  literal: 'Literal',
  defaultGraph: 'DefaultGraph'
} as const
/** RDF 1.1 assigns these datatypes to plain and language-tagged string literals. */
export const RdfDatatype = {
  string: 'http://www.w3.org/2001/XMLSchema#string',
  langString: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
} as const
/** Canonical position names also define deterministic structural capture order. */
const RdfQuadPosition = {
  subject: 'subject',
  predicate: 'predicate',
  object: 'object',
  graph: 'graph'
} as const
/** Named-node equality preserves the exact absolute IRI spelling. */
export type IRdfNamedNode = { readonly termType: 'NamedNode'; readonly value: string }
/** Blank identifiers are raw/parser-local and never portable repeated-identity write keys. */
export type IRdfBlankNode = { readonly termType: 'BlankNode'; readonly value: string }
/** Literal identity includes datatype and the normalized lowercase language when present. */
export type IRdfLiteral = {
  readonly termType: 'Literal'
  readonly value: string
  readonly datatype: string
  readonly language?: string
}
/** The default graph carries no fabricated IRI or binding value. */
export type IRdfDefaultGraph = { readonly termType: 'DefaultGraph' }
/** SELECT bindings omit DefaultGraph while raw responses can include request-local blank nodes. */
export type IRdfBindingTerm = IRdfNamedNode | IRdfBlankNode | IRdfLiteral
/** Complete raw RDF term domain. */
export type IRdfTerm = IRdfBindingTerm | IRdfDefaultGraph
/** Raw parser and CONSTRUCT output retain the complete RDF 1.1 blank-node positions. */
export type IRawQuad = {
  readonly subject: IRdfNamedNode | IRdfBlankNode
  readonly predicate: IRdfNamedNode
  readonly object: IRdfBindingTerm
  readonly graph: IRdfNamedNode | IRdfBlankNode | IRdfDefaultGraph
}
/** Standard repeated-identity writes use ground terms without request-local blank labels. */
export type IQuad = {
  readonly subject: IRdfNamedNode
  readonly predicate: IRdfNamedNode
  readonly object: IRdfNamedNode | IRdfLiteral
  readonly graph: IRdfNamedNode | IRdfDefaultGraph
}

/** Builds RFC 3987 section 2.2 grammar without URL normalization, resolution or platform APIs. */
function createIriPattern(): RegExp {
  /** UCSCHAR excludes surrogate halves, private use and the final two code points of each plane. */
  const unicode =
    '\\u00a0-\\ud7ff\\uf900-\\ufdcf\\ufdf0-\\uffef\\u{10000}-\\u{1fffd}\\u{20000}-\\u{2fffd}\\u{30000}-\\u{3fffd}\\u{40000}-\\u{4fffd}\\u{50000}-\\u{5fffd}\\u{60000}-\\u{6fffd}\\u{70000}-\\u{7fffd}\\u{80000}-\\u{8fffd}\\u{90000}-\\u{9fffd}\\u{a0000}-\\u{afffd}\\u{b0000}-\\u{bfffd}\\u{c0000}-\\u{cfffd}\\u{d0000}-\\u{dfffd}\\u{e1000}-\\u{efffd}'
  /** The same admitted percent triplet and unreserved component serve all IRI productions. */
  const unreserved = `[A-Za-z0-9._~${unicode}-]`
  /** Sub-delimiters retain their RFC spelling rather than being URL-escaped. */
  const component = `(?:${unreserved}|%[0-9A-Fa-f]{2}|[!$&'()*+,;=])`
  /** PCHAR admits colon and at-sign only in the productions that explicitly allow them. */
  const character = `(?:${component}|[:@])`
  /** IPv4 is admitted only as the final LS32 production inside an IPv6 literal. */
  const octet = '(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])'
  /** One or two hextets, or the equivalent final IPv4 spelling. */
  const h16 = '[0-9A-Fa-f]{1,4}'
  /** LS32 retains the exact self-contained IPv6 address grammar. */
  const ls32 = `(?:${h16}:${h16}|${octet}(?:\\.${octet}){3})`
  /** Each alternative is one RFC 3986 IPv6 compression placement. */
  const ipv6 = `(?:(?:${h16}:){6}${ls32}|::(?:${h16}:){5}${ls32}|(?:${h16})?::(?:${h16}:){4}${ls32}|(?:(?:${h16}:){0,1}${h16})?::(?:${h16}:){3}${ls32}|(?:(?:${h16}:){0,2}${h16})?::(?:${h16}:){2}${ls32}|(?:(?:${h16}:){0,3}${h16})?::${h16}:${ls32}|(?:(?:${h16}:){0,4}${h16})?::${ls32}|(?:(?:${h16}:){0,5}${h16})?::${h16}|(?:(?:${h16}:){0,6}${h16})?::)`
  /** Future address literals remain ASCII as required by their dedicated production. */
  const future = "[vV][0-9A-Fa-f]+\\.[A-Za-z0-9._~!$&'()*+,;=:-]+"
  /** Generic authorities allow empty registered names and ports without applying HTTP policy. */
  const authority = `(?:(?:${component}|:)*@)?(?:\\[(?:${ipv6}|${future})\\]|${component}*)(?::[0-9]*)?`
  /** Absolute, rootless and authority paths retain each original delimiter. */
  const hierarchy = `(?://${authority}(?:/${character}*)*|/(?:${character}+(?:/${character}*)*)?|${character}+(?:/${character}*)*|)`
  /** Private-use code points belong only to the query production. */
  const privateUse = '[\\ue000-\\uf8ff\\u{f0000}-\\u{ffffd}\\u{100000}-\\u{10fffd}]'
  return new RegExp(
    `^[A-Za-z][A-Za-z0-9+.-]*:${hierarchy}(?:\\?(?:${character}|[/?]|${privateUse})*)?(?:#(?:${character}|[/?])*)?$`,
    'u'
  )
}
/** Static lexical admission has no external state and can be eliminated when RDF is unused. */
const RDF_IRI = /* @__PURE__ */ createIriPattern()
/** RFC 5646 ABNF accepts well-formed tags without imposing IANA validity rules. */
const RDF_LANGUAGE =
  /^(?:(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?(?:-(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*(?:-[a-wy-z0-9](?:-[a-z0-9]{2,8})+)*(?:-x(?:-[a-z0-9]{1,8})+)?|x(?:-[a-z0-9]{1,8})+)$/
/** The finite grandfathered set is part of RFC 5646 grammar, not a language registry lookup. */
const RDF_GRANDFATHERED = /* @__PURE__ */ new Set([
  'en-gb-oed',
  'i-ami',
  'i-bnn',
  'i-default',
  'i-enochian',
  'i-hak',
  'i-klingon',
  'i-lux',
  'i-mingo',
  'i-navajo',
  'i-pwn',
  'i-tao',
  'i-tay',
  'i-tsu',
  'sgn-be-fr',
  'sgn-be-nl',
  'sgn-ch-de',
  'art-lojban',
  'cel-gaulish',
  'no-bok',
  'no-nyn',
  'zh-guoyu',
  'zh-hakka',
  'zh-min',
  'zh-min-nan',
  'zh-xiang'
])
/** DefaultGraph has one canonical value and no generated blank-node identity. */
const DEFAULT_GRAPH: IRdfDefaultGraph = { termType: RdfTermType.defaultGraph }
/** Generated raw labels are unique only within this term factory's runtime. */
let blankSequence = 0

/** RDF admission uses the existing argument error and canonical diagnostic text. */
function invalidRdf(backend: IBackendKind | undefined, cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend, cause },
    StorageContractErrorText.rdfArgument
  )
}
/** Unicode scalar strings preserve their exact lexical value without replacement characters. */
function assertRdfString(
  value: unknown,
  backend: IBackendKind | undefined
): asserts value is string {
  if (typeof value !== 'string' || /[\uD800-\uDFFF]/u.test(value)) throw invalidRdf(backend)
}
/** Absolute IRI admission preserves spelling without URL normalization or allocation. */
function assertRdfIri(value: unknown, backend: IBackendKind | undefined): asserts value is string {
  if (typeof value !== 'string' || !RDF_IRI.test(value)) throw invalidRdf(backend)
}
/** Absolute IRI factories allocate only their public result after canonical admission. */
function rdfIri(value: unknown, backend: IBackendKind | undefined): IRdfNamedNode {
  assertRdfIri(value, backend)
  return { termType: RdfTermType.namedNode, value }
}
/** Lowercases well-formed BCP47 tags while preserving their original, non-registry spelling. */
function rdfLanguage(value: unknown, backend: IBackendKind | undefined): string {
  if (typeof value !== 'string') throw invalidRdf(backend)
  /** Case is the only language-tag normalization permitted for RDF literal identity. */
  const language = value.toLowerCase()
  if (RDF_GRANDFATHERED.has(language)) return language
  if (!RDF_LANGUAGE.test(language)) throw invalidRdf(backend)
  return language
}
/** Literal validation is shared by structural terms and factories without allocating a term. */
function assertRdfLiteral(
  value: unknown,
  datatype: unknown,
  language: unknown,
  backend: IBackendKind | undefined
): void {
  assertRdfString(value, backend)
  assertRdfIri(datatype, backend)
  if (language === undefined) {
    if (datatype === RdfDatatype.langString) throw invalidRdf(backend)
  } else {
    if (datatype !== RdfDatatype.langString) throw invalidRdf(backend)
    rdfLanguage(language, backend)
  }
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
/** Validate raw RDF structure without copying terms or normalizing caller-owned fields. */
export function assertStorageRdfTerm(
  value: unknown,
  backend: IBackendKind | undefined
): asserts value is IRdfTerm {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidRdf(backend)
  /** The supported tag determines exactly which lexical fields have meaning. */
  const candidate = value as IRdfTerm
  switch (candidate.termType) {
    case RdfTermType.defaultGraph:
      return
    case RdfTermType.namedNode:
      assertRdfIri(candidate.value, backend)
      return
    case RdfTermType.blankNode:
      assertRdfString(candidate.value, backend)
      if (candidate.value.length === 0) throw invalidRdf(backend)
      return
    case RdfTermType.literal:
      assertRdfLiteral(candidate.value, candidate.datatype, candidate.language, backend)
      return
    default:
      throw invalidRdf(backend)
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
/** Ground positions add only positional rules to the one raw-term validator. */
function assertRdfPosition(
  value: unknown,
  position: keyof IQuad,
  backend: IBackendKind | undefined
): void {
  assertStorageRdfTerm(value, backend)
  if (
    value.termType === RdfTermType.namedNode ||
    (position === RdfQuadPosition.object && value.termType === RdfTermType.literal) ||
    (position === RdfQuadPosition.graph && value.termType === RdfTermType.defaultGraph)
  )
    return
  throw invalidRdf(backend)
}
/** Validate a partial ground pattern without allocating replacement terms or an input image. */
export function assertStorageRdfPattern(
  pattern: unknown,
  backend: IBackendKind | undefined
): asserts pattern is Partial<IQuad> {
  if (typeof pattern !== 'object' || pattern === null || Array.isArray(pattern))
    throw invalidRdf(backend)
  for (const position of Object.values(RdfQuadPosition)) {
    /** Missing fields remain omitted; a partial pattern never invents a default graph. */
    const value = (pattern as Partial<IQuad>)[position]
    if (value !== undefined) assertRdfPosition(value, position, backend)
  }
}
/** A complete quad uses the same positional rules plus all four mandatory positions. */
export function assertStorageRdfQuad(
  quad: unknown,
  backend: IBackendKind | undefined
): asserts quad is IQuad {
  assertStorageRdfPattern(quad, backend)
  if (!quad.subject || !quad.predicate || !quad.object || !quad.graph) throw invalidRdf(backend)
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
    return [value.termType, value.value, value.datatype, value.language ?? '']
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
  return encodeOrderedStorageKey(rdfTermKey(snapshotStorageRdfTerm(value, backend)), backend)
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
  return encodeRdfQuadSnapshot(snapshotStorageRdfQuad(quad, backend))
}

/** Pure RDF factories preserve ground/raw distinction and own no backend resource or query. */
export const term = /* @__PURE__ */ Object.freeze({
  /** Creates an exact absolute IRI without URL normalization. */
  iri: (value: string): IRdfNamedNode => rdfIri(value, undefined),
  /** Explicit labels remain runtime-local; omission generates a fresh raw label. */
  blank(label?: string): IRdfBlankNode {
    /** Generated labels are stable only for this returned raw term. */
    const value = label === undefined ? `b${++blankSequence}` : label
    return snapshotStorageRdfTerm(
      { termType: RdfTermType.blankNode, value },
      undefined
    ) as IRdfBlankNode
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
  /** The graph-position owner rejects blank nodes and literals without another term validator. */
  const captured = snapshotStorageRdfPattern({ graph }, undefined).graph
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
  /** Capturing a graph position admits its IRI once and then narrows the physical named identity. */
  const captured = snapshotStorageRdfPattern({ graph }, undefined).graph
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

/** Ground RDF writes and queries share canonical term identity and the backend's original owner. */
export type IRdfApi<
  TChangeFeed extends boolean = false,
  TAugmentMethods extends object = Record<never, never>
> = {
  add(quads: readonly IQuad[], ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  delete(quads: readonly IQuad[], ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  match(
    pattern: Partial<IQuad>
  ): IRdfQuery<
    IOperationContext,
    TAugmentMethods & (TChangeFeed extends true ? IQueryWatch : Record<never, never>)
  >
}
/** Generic RDF transactions expose only actual draft writes and zero-context queries. */
export type ITransactionRdfApi<TAugmentMethods extends object = Record<never, never>> = {
  add(quads: readonly IQuad[]): Promise<void>
  delete(quads: readonly IQuad[]): Promise<void>
  match(pattern: Partial<IQuad>): IRdfQuery<undefined, TAugmentMethods>
}
/** The authentic RDF token reuses the original fresh-view transaction projection. */
export const rdf = /* @__PURE__ */ defineStandardStorageCapability<IRdfApi, 'rdf'>('rdf', {
  validate: (api) => validateCapabilityMethods(api, STORAGE_RDF_METHODS),
  transaction: { methods: STORAGE_RDF_WRITE_METHODS, rdf: true }
})
