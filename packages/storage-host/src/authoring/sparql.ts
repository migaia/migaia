import {
  type ISparqlFragment,
  type ISparqlInput,
  type ISparqlRow,
  type ISparqlQuery,
  type ISparqlTagTools,
  type ISparqlApi,
  type IOperationContext,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText,
  RdfTermType,
  type IRdfNamedNode,
  type IRdfLiteral,
  type IRdfBindingTerm,
  type IRawQuad
} from '@migaia/storage-contract'
import { captureStorageTemplatePieces } from './template.ts'
import { snapshotStorageRdfTerm } from './rdf.ts'

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

/** Invalid SPARQL inputs retain the canonical argument error identity. */
function invalidSparqlArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { cause },
    StorageContractErrorText.sparqlArgument
  )
}

/** Publish an opaque identity over already captured node pieces. */
function registerSparqlFragment(pieces: readonly (string | ISparqlNode)[]): ISparqlFragment {
  /** Public objects reveal no forgeable serialized source or native callback. */
  const fragment = {} as ISparqlFragment
  sparqlNodes.set(fragment, { pieces: pieces })
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

/**
 * Capture RDF into text before deferred native execution; later caller mutation must not change the
 * query.
 */
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

/** Native template capture preserves the original field and interpolation order. */
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
  if (!Array.isArray(fragments)) throw invalidSparqlArgument()
  /** Separator authentication remains independent of list length. */
  const between = sparqlNode(separator)
  /** The ordinary dense list determines child order. */
  const length = fragments.length
  /** Only references and separators are retained, never copied prefix text. */
  const pieces: (string | ISparqlNode)[] = []
  for (let index = 0; index < length; index++) {
    /** Retain the canonical child node rather than the caller-owned array. */
    const child = sparqlNode(fragments[index])
    if (index > 0) pieces.push(between)
    pieces.push(child)
  }
  return length === 0 ? emptySparqlFragment : registerSparqlFragment(pieces)
}

/** Pure composition grants no endpoint or native operation authority. */
export const sparqlFragment = /* @__PURE__ */ createSparqlFragmentTools()

/** Initialize only the retained authoring channel, without top-level property mutation. */
function createSparqlFragmentTools(): ISparqlTagTools & typeof sparqlFragmentTag {
  /** Pure tools share the original node table and never retain a native endpoint. */
  const tag = sparqlFragmentTag as ISparqlTagTools & typeof sparqlFragmentTag
  tag.var = sparqlVariable
  tag.join = joinSparqlFragments
  Object.defineProperty(tag, 'empty', { value: emptySparqlFragment, enumerable: true })
  return tag
}

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
/** Original native endpoints prepare only after entering their backend operation boundary. */
type ISparqlBindingOptions = {
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
}

/** Bind one native callable tag; graph and compiled state belong to each named query. */
export function createSparqlTag(options: ISparqlBindingOptions): ISparqlApi {
  /** This adapter only constructs query owners; it does not capture mutable execution state. */
  function tag<
    TRow extends object & { readonly [K in keyof TRow]: IRdfBindingTerm | undefined } = ISparqlRow
  >(strings: TemplateStringsArray, ...values: readonly ISparqlInput[]): ISparqlQuery<TRow> {
    return new BoundSparqlQuery<TRow>(
      sparqlNode(sparqlFragmentTag(strings, ...values)),
      options
    ) as unknown as ISparqlQuery<TRow>
  }
  tag.var = sparqlVariable
  tag.join = joinSparqlFragments
  Object.defineProperty(tag, 'empty', { value: emptySparqlFragment, enumerable: true })
  return tag as ISparqlApi
}

/**
 * One query owns its prepared text while the original backend retains native execution and
 * lifetime.
 */
class BoundSparqlQuery<TRow extends object> {
  /** The private composition graph preserves repeated references without a global text cache. */
  readonly #node: ISparqlNode
  /** Direct native method calls preserve receiver, context and exact Promise identity. */
  readonly #options: ISparqlBindingOptions
  /** Final text belongs only to this query, never to an endpoint or process cache. */
  #compiled: string | undefined
  /** Register executable identity in the same table used by pure fragments. */
  constructor(node: ISparqlNode, options: ISparqlBindingOptions) {
    this.#node = node
    this.#options = options
    sparqlNodes.set(this, node)
  }
  /** Backend admission determines when lazy body expansion happens. */
  #prepare = (): string => (this.#compiled ??= expandSparqlNode(this.#node))
  /** Return the actual native SELECT promise without assimilation. */
  select = (ctx?: IOperationContext): Promise<readonly TRow[]> =>
    this.#options.select(this.#prepare, ctx) as Promise<readonly TRow[]>
  /** Return the actual native ASK promise without assimilation. */
  ask = (ctx?: IOperationContext) => this.#options.ask(this.#prepare, ctx)
  /** Return the actual native CONSTRUCT promise and response-local blank identity. */
  construct = (ctx?: IOperationContext) => this.#options.construct(this.#prepare, ctx)
  /** Return the actual native UPDATE promise without adding a transaction. */
  update = (ctx?: IOperationContext) => this.#options.update(this.#prepare, ctx)
}
