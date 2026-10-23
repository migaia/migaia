import type { IOperationContext } from '../context.js'
import { StorageContractError, StorageContractErrorCode } from '../errors.js'
import { StorageContractErrorText } from '../error-text.js'
import { captureStorageTemplatePieces } from '../template.js'
import { defineStandardStorageCapability, invalidCapability } from '../capability-token.js'
import {
  RdfTermType,
  snapshotStorageRdfTerm,
  type IRdfNamedNode,
  type IRdfLiteral,
  type IRdfBindingTerm,
  type IRawQuad
} from './rdf.js'

/** Only the private fragment table establishes a portable composition identity. */
declare const sparqlFragmentBrand: unique symbol
/** A pure fragment has no endpoint, disposal method or execution terminal. */
export type ISparqlFragment = { readonly [sparqlFragmentBrand]: true }
/** Named nodes and literals carry values; grammar enters only through authentic fragments. */
export type ISparqlInput = IRdfNamedNode | IRdfLiteral | ISparqlFragment
/** Unbound SELECT columns retain undefined rather than acquiring a fabricated RDF value. */
export type ISparqlRow = Readonly<Record<string, IRdfBindingTerm | undefined>>
/** Native execution and raw response parsing retain response-local blank identity. */
export type ISparqlQuery<
  TRow extends object & { readonly [K in keyof TRow]: IRdfBindingTerm | undefined } = ISparqlRow
> = ISparqlFragment & {
  select(ctx?: IOperationContext): Promise<readonly TRow[]>
  ask(ctx?: IOperationContext): Promise<boolean>
  construct(ctx?: IOperationContext): Promise<readonly IRawQuad[]>
  update(ctx?: IOperationContext): Promise<void>
}
/** Pure tools never execute an endpoint or grant a transaction projection. */
export type ISparqlTagTools = {
  var(name: string): ISparqlFragment
  join(fragments: readonly ISparqlFragment[], separator?: ISparqlFragment): ISparqlFragment
  readonly empty: ISparqlFragment
}
/** One native callable tag selects its actual select/ask/construct/update endpoint. */
export type ISparqlApi = ISparqlTagTools & {
  <TRow extends object & { readonly [K in keyof TRow]: IRdfBindingTerm | undefined } = ISparqlRow>(
    strings: TemplateStringsArray,
    ...values: readonly ISparqlInput[]
  ): ISparqlQuery<TRow>
}
/** Immutable child references defer full-body expansion, never borrowed RDF value capture. */
type ISparqlNode = { readonly pieces: readonly (string | ISparqlNode)[] }
/** One weak identity owner retains no endpoint, driver or full-result cache. */
const sparqlNodes = new WeakMap<object, ISparqlNode>()
/** SPARQL VARNAME includes its full Unicode base range and combining suffixes. */
/* oxlint-disable no-misleading-character-class -- SPARQL VARNAME explicitly admits combining suffixes. */
const SPARQL_VARIABLE =
  /^[A-Za-z_0-9\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}][A-Za-z_0-9\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}\u00b7\u0300-\u036f\u203f-\u2040]*$/u
/* oxlint-enable no-misleading-character-class */
/** Short string syntax must escape actual C0/C1 controls as RDF values. */
// oxlint-disable-next-line no-control-regex -- SPARQL serialization must preserve control values safely.
const SPARQL_ESCAPE_PATTERN = /["\\\u0000-\u001f\u007f-\u009f]/g
/** Named escapes retain control characters as RDF values rather than query syntax. */
const SparqlStringEscape: Readonly<Record<string, string>> = {
  '"': '\\"',
  '\\': '\\\\',
  '\t': '\\t',
  '\b': '\\b',
  '\n': '\\n',
  '\r': '\\r',
  '\f': '\\f'
}

/** Shared argument identity retains original reflection causes. */
function invalidSparqlArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { cause },
    StorageContractErrorText.sparqlArgument
  )
}
/** Publishes a frozen identity over already captured node pieces. */
function registerSparqlFragment(pieces: readonly (string | ISparqlNode)[]): ISparqlFragment {
  /** Public objects reveal no forgeable serialized source or native callback. */
  const fragment = Object.freeze({}) as ISparqlFragment
  sparqlNodes.set(fragment, Object.freeze({ pieces: Object.freeze(pieces) }))
  return fragment
}
/** Empty composition has one canonical pure identity. */
const emptySparqlFragment = /* @__PURE__ */ registerSparqlFragment([])
/** Native joins use whitespace unless an authentic separator is supplied. */
const sparqlJoinSeparator = /* @__PURE__ */ registerSparqlFragment([' '])
/** Authentication ignores public brands, fields and constructor names. */
function sparqlNode(fragment: unknown): ISparqlNode {
  /** Arbitrary structural objects cannot smuggle query grammar. */
  const node =
    typeof fragment === 'object' && fragment !== null ? sparqlNodes.get(fragment) : undefined
  if (!node) throw invalidSparqlArgument()
  return node
}
/** Snapshot RDF once; raw blank/default graph terms cannot carry portable query identity. */
function sparqlInputPiece(value: unknown): string | ISparqlNode {
  if (typeof value === 'object' && value !== null && sparqlNodes.has(value))
    return sparqlNodes.get(value)!
  /** Shared RDF validation preserves exact IRI/datatype spelling and lowercase language. */
  const term = snapshotStorageRdfTerm(value as IRdfNamedNode | IRdfLiteral, undefined)
  if (term.termType === RdfTermType.namedNode) return '<' + term.value + '>'
  if (term.termType !== RdfTermType.literal) throw invalidSparqlArgument()
  /** One pass escapes quotes, backslashes and C0/C1 controls without changing RDF value. */
  const escaped = term.value.replace(
    SPARQL_ESCAPE_PATTERN,
    (character) =>
      SparqlStringEscape[character] ?? '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')
  )
  return (
    '"' +
    escaped +
    '"' +
    (term.language === undefined ? '^^<' + term.datatype + '>' : '@' + term.language)
  )
}
/** Frozen template capture preserves the original field and interpolation order. */
function sparqlFragmentTag(
  strings: TemplateStringsArray,
  ...values: readonly ISparqlInput[]
): ISparqlFragment {
  /** Nodes retain only captured values and references, never a growing flattened prefix. */
  const pieces = captureStorageTemplatePieces(
    strings,
    values,
    sparqlInputPiece,
    invalidSparqlArgument
  )
  return pieces.length === 1 && pieces[0] === ''
    ? emptySparqlFragment
    : registerSparqlFragment(pieces)
}
/** Validate VARNAME without a question mark or dollar prefix. */
function sparqlVariable(name: string): ISparqlFragment {
  if (typeof name !== 'string' || !SPARQL_VARIABLE.test(name)) throw invalidSparqlArgument()
  return registerSparqlFragment(['?' + name])
}
/** Joins immutable references in input order without expanding deep or repeated children. */
function joinSparqlFragments(
  fragments: readonly ISparqlFragment[],
  separator: ISparqlFragment = sparqlJoinSeparator
): ISparqlFragment {
  try {
    if (!Array.isArray(fragments)) throw invalidSparqlArgument()
    /** Separator authentication remains independent of list length. */
    const between = sparqlNode(separator)
    /** The original list length bounds capture even through changing getters. */
    const length = fragments.length
    if (!Number.isSafeInteger(length) || length < 0) throw invalidSparqlArgument()
    /** Only references and separators are retained, never copied prefix text. */
    const pieces: (string | ISparqlNode)[] = []
    for (let index = 0; index < length; index++) {
      if (!Object.hasOwn(fragments, index)) throw invalidSparqlArgument()
      /** Each borrowed child is read once before any later input can mutate. */
      const child = sparqlNode(fragments[index])
      if (index > 0) pieces.push(between)
      pieces.push(child)
    }
    return length === 0 ? emptySparqlFragment : registerSparqlFragment(pieces)
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidSparqlArgument(cause)
  }
}
/** Pure composition grants no endpoint or native operation authority. */
export const sparqlFragment: ISparqlTagTools & {
  (strings: TemplateStringsArray, ...values: readonly ISparqlInput[]): ISparqlFragment
} = /* @__PURE__ */ Object.freeze(
  Object.assign(sparqlFragmentTag, {
    var: sparqlVariable,
    join: joinSparqlFragments,
    empty: emptySparqlFragment
  })
)
/** Iterative expansion visits actual output without recursion or repeated prefix copying. */
function expandSparqlNode(node: ISparqlNode): string {
  /** Frames retain only the active path through immutable shared children. */
  const stack: { readonly node: ISparqlNode; index: number }[] = [{ node, index: 0 }]
  /** One final join performs the only complete-body concatenation. */
  const output: string[] = []
  while (stack.length > 0) {
    /** Each frame advances in place until its actual pieces are exhausted. */
    const frame = stack[stack.length - 1]!
    if (frame.index === frame.node.pieces.length) {
      stack.pop()
      continue
    }
    /** Repeated references deliberately expand at every original occurrence. */
    const piece = frame.node.pieces[frame.index++]!
    if (typeof piece === 'string') output.push(piece)
    else stack.push({ node: piece, index: 0 })
  }
  return output.join('')
}
/**
 * Bind the pure fragment owner to original native callbacks. Backends call lazy prepare after their
 * existing operation admission; this helper owns no endpoint, query parser or lifecycle.
 */
export function createSparqlTag(options: {
  readonly select: (
    prepare: () => string,
    ctx?: IOperationContext
  ) => Promise<readonly ISparqlRow[]>
  readonly ask: (prepare: () => string, ctx?: IOperationContext) => Promise<boolean>
  readonly construct: (
    prepare: () => string,
    ctx?: IOperationContext
  ) => Promise<readonly IRawQuad[]>
  readonly update: (prepare: () => string, ctx?: IOperationContext) => Promise<void>
}): ISparqlApi {
  try {
    /** Callback fields are borrowed once without rendering or sending a query. */
    const select = options.select
    /** Native ASK returns its original boolean Promise. */
    const ask = options.ask
    /** Raw CONSTRUCT retains its parser's response-local blank identity. */
    const construct = options.construct
    /** Native updates do not acquire generic transaction capability. */
    const update = options.update
    if (
      typeof select !== 'function' ||
      typeof ask !== 'function' ||
      typeof construct !== 'function' ||
      typeof update !== 'function'
    )
      throw invalidSparqlArgument()
    /** Explicit rows declare output shape; no runtime business schema is inferred. */
    const tag = <
      TRow extends object & { readonly [K in keyof TRow]: IRdfBindingTerm | undefined } = ISparqlRow
    >(
      strings: TemplateStringsArray,
      ...values: readonly ISparqlInput[]
    ): ISparqlQuery<TRow> => {
      /** The original table authenticates both pure and executable SPARQL nodes. */
      const node = sparqlNode(sparqlFragmentTag(strings, ...values))
      /** Final body cache belongs only to this query; no global text cache exists. */
      let compiled: string | undefined
      /** Native callbacks prepare only after their actual owner's admission. */
      const prepare = (): string => (compiled ??= expandSparqlNode(node))
      /** Direct forwarding preserves exact callback receiver, context and Promise. */
      const query = {
        select: (ctx?: IOperationContext) =>
          Reflect.apply(select, options, [prepare, ctx]) as Promise<readonly TRow[]>,
        ask: (ctx?: IOperationContext) => Reflect.apply(ask, options, [prepare, ctx]),
        construct: (ctx?: IOperationContext) => Reflect.apply(construct, options, [prepare, ctx]),
        update: (ctx?: IOperationContext) => Reflect.apply(update, options, [prepare, ctx])
      } as ISparqlQuery<TRow>
      sparqlNodes.set(query, node)
      return Object.freeze(query)
    }
    return Object.freeze(
      Object.assign(tag, {
        var: sparqlVariable,
        join: joinSparqlFragments,
        empty: emptySparqlFragment
      })
    )
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw invalidSparqlArgument(cause)
  }
}
/** Callable APIs publish pure tools without evaluating or probing native statements. */
function validateSparqlApi(api: unknown): void {
  if (typeof api !== 'function') throw invalidCapability()
  /** Node authenticity remains with the original SPARQL table rather than shape validation. */
  const tag = api as ISparqlApi
  /** Empty metadata is borrowed once before publication. */
  const empty = tag.empty
  if (
    typeof tag.var !== 'function' ||
    typeof tag.join !== 'function' ||
    typeof empty !== 'object' ||
    empty === null
  )
    throw invalidCapability()
}
/** Standard SPARQL has no generic KV/record transaction projection. */
export const sparql = /* @__PURE__ */ defineStandardStorageCapability<ISparqlApi, 'sparql'>(
  'sparql',
  { validate: validateSparqlApi }
)
