import type { IBackendKind } from '../capabilities.js'
import { StorageContractError, StorageContractErrorCode } from '../errors.js'
import { StorageContractErrorText } from '../error-text.js'
import { encodeOrderedStorageKey } from '../key-order.js'
import type { IStorageKey } from '../context.js'

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
/** RFC 5646 well-formed language tags, before duplicate variant/extension checks. */
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
/** DefaultGraph has one immutable value and no generated blank-node identity. */
const DEFAULT_GRAPH: IRdfDefaultGraph = /* @__PURE__ */ Object.freeze({
  termType: RdfTermType.defaultGraph
})
/** Generated raw labels are unique only within this term factory's runtime. */
let blankSequence = 0

/** RDF input errors retain the original getter failure without changing its identity or stack. */
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
/** Absolute IRI spelling is validated and retained without case folding, escaping or normalization. */
function rdfIri(value: unknown, backend: IBackendKind | undefined): IRdfNamedNode {
  if (typeof value !== 'string' || !RDF_IRI.test(value)) throw invalidRdf(backend)
  return Object.freeze({ termType: RdfTermType.namedNode, value })
}
/** Lowercases well-formed BCP47 tags while preserving their original, non-registry spelling. */
function rdfLanguage(value: unknown, backend: IBackendKind | undefined): string {
  if (typeof value !== 'string') throw invalidRdf(backend)
  /** Case is the only language-tag normalization permitted for RDF literal identity. */
  const language = value.toLowerCase()
  if (RDF_GRANDFATHERED.has(language)) return language
  if (!RDF_LANGUAGE.test(language)) throw invalidRdf(backend)
  if (language.startsWith('x-')) return language
  /** Repeated variants and extension singletons are not well-formed under RFC 5646 section 2.2.9. */
  const variants = new Set<string>()
  /** Extension keys are independent from ordinary variant subtags. */
  const extensions = new Set<string>()
  /** Private-use tails permit repeated subtags and no longer participate in these uniqueness rules. */
  let extension = false
  for (const part of language.split('-').slice(1)) {
    if (part === 'x') break
    if (part.length === 1) {
      if (extensions.has(part)) throw invalidRdf(backend)
      extensions.add(part)
      extension = true
    } else if (!extension && (part.length >= 5 || /^[0-9][a-z0-9]{3}$/.test(part))) {
      if (variants.has(part)) throw invalidRdf(backend)
      variants.add(part)
    }
  }
  return language
}
/** Creates an admitted literal with its mandatory datatype and consistent optional language. */
function rdfLiteral(
  value: unknown,
  datatype: unknown,
  language: unknown,
  backend: IBackendKind | undefined
): IRdfLiteral {
  assertRdfString(value, backend)
  /** Datatypes remain exact absolute IRI strings, just like named-node terms. */
  const type = rdfIri(datatype, backend).value
  if (language === undefined) {
    if (type === RdfDatatype.langString) throw invalidRdf(backend)
    return Object.freeze({ termType: RdfTermType.literal, value, datatype: type })
  }
  if (type !== RdfDatatype.langString) throw invalidRdf(backend)
  return Object.freeze({
    termType: RdfTermType.literal,
    value,
    datatype: type,
    language: rdfLanguage(language, backend)
  })
}
/** Snapshots direct structural terms for the shared raw/parser and ground-position validators. */
export function snapshotStorageRdfTerm(
  value: IRdfTerm,
  backend: IBackendKind | undefined
): IRdfTerm {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw invalidRdf(backend)
    /** Tag is captured first; irrelevant term fields are never reflected. */
    const kind = value.termType
    if (kind === RdfTermType.defaultGraph) return DEFAULT_GRAPH
    /** Every non-default term carries exactly one captured lexical value. */
    const lexical = (value as IRdfBindingTerm).value
    if (kind === RdfTermType.namedNode) return rdfIri(lexical, backend)
    if (kind === RdfTermType.blankNode) {
      assertRdfString(lexical, backend)
      if (lexical.length === 0) throw invalidRdf(backend)
      return Object.freeze({ termType: kind, value: lexical })
    }
    if (kind === RdfTermType.literal) {
      /** Both annotation fields are captured once before their consistency is checked. */
      const datatype = (value as IRdfLiteral).datatype
      /** Language omission remains distinct from an invalid empty annotation. */
      const language = (value as IRdfLiteral).language
      return rdfLiteral(lexical, datatype, language, backend)
    }
    throw invalidRdf(backend)
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidRdf(backend, cause)
  }
}
/** Standard ground positions reject blank nodes and literal/default-graph misuse before I/O. */
function rdfPosition(
  value: IRdfTerm,
  position: keyof IQuad,
  backend: IBackendKind | undefined
): IRdfTerm {
  /** Snapshot validation is shared with raw terms; ground narrowing owns only position rules. */
  const captured = snapshotStorageRdfTerm(value, backend)
  if (
    captured.termType === RdfTermType.namedNode ||
    (position === RdfQuadPosition.object && captured.termType === RdfTermType.literal) ||
    (position === RdfQuadPosition.graph && captured.termType === RdfTermType.defaultGraph)
  )
    return captured
  throw invalidRdf(backend)
}
/** Captures a partial ground pattern; omitted graph deliberately continues to match every graph. */
export function snapshotStorageRdfPattern(
  pattern: Partial<IQuad>,
  backend: IBackendKind | undefined
): Readonly<Partial<IQuad>> {
  try {
    if (typeof pattern !== 'object' || pattern === null || Array.isArray(pattern))
      throw invalidRdf(backend)
    /**
     * Each supplied position is read once and validated in canonical subject/predicate/object/graph
     * order.
     */
    const result: Partial<Record<keyof IQuad, IRdfTerm>> = {}
    for (const position of Object.values(RdfQuadPosition)) {
      /** A missing field remains omitted; no default graph is inserted into a pattern. */
      const value = pattern[position]
      if (value !== undefined) result[position] = rdfPosition(value, position, backend)
    }
    return Object.freeze(result) as Readonly<Partial<IQuad>>
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidRdf(backend, cause)
  }
}
/** Captures all four mandatory ground positions, never retaining caller term objects or getters. */
export function snapshotStorageRdfQuad(quad: IQuad, backend: IBackendKind | undefined): IQuad {
  /**
   * The partial validator owns reflection and positional checks for both complete and partial
   * input.
   */
  const result = snapshotStorageRdfPattern(quad, backend)
  if (!result.subject || !result.predicate || !result.object || !result.graph)
    throw invalidRdf(backend)
  return result as IQuad
}
/** Projects an already captured term into self-delimiting components for the original key writer. */
function rdfTermKey(value: IRdfTerm): IStorageKey {
  if (value.termType === RdfTermType.defaultGraph) return [value.termType]
  if (value.termType === RdfTermType.literal)
    return [value.termType, value.value, value.datatype, value.language ?? '']
  return [value.termType, value.value]
}
/** Internal lock/native authors encode a validated frozen quad without a second input traversal. */
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
    try {
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
    } catch (cause) {
      if (cause instanceof StorageContractError) throw cause
      throw invalidRdf(undefined, cause)
    }
  },
  defaultGraph: DEFAULT_GRAPH
})
