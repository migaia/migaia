import { type IOperationContext } from '../context.js'
import { defineStandardStorageCapability, invalidCapability } from '../capability-token.js'
import { type IRdfNamedNode, type IRdfLiteral, type IRdfBindingTerm, type IRawQuad } from './rdf.js'

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
