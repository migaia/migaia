import { type IOperationContext } from '../context.ts'
import { type IWriteConcurrencyOptions } from '../concurrency.ts'
import { type IRdfQuery, type IQueryWatch } from '../query-chain.ts'
import { defineStandardStorageCapability, validateCapabilityMethods } from '../capability-token.ts'
import { STORAGE_RDF_METHODS, STORAGE_RDF_WRITE_METHODS } from '../capability-constants.ts'
import { type IBackendKind } from '../capabilities.ts'
import { StorageContractError, StorageContractErrorCode } from '../errors.ts'
import { StorageContractErrorText } from '../error-text.ts'

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
export const RdfQuadPosition = {
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

/** RDF admission uses the existing argument error and canonical diagnostic text. */
export function invalidRdf(
  backend: IBackendKind | undefined,
  cause?: unknown
): StorageContractError {
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
export function assertRdfIri(
  value: unknown,
  backend: IBackendKind | undefined
): asserts value is string {
  if (typeof value !== 'string' || !RDF_IRI.test(value)) throw invalidRdf(backend)
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
export function assertRdfLiteral(
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
