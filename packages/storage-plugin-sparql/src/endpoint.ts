import type { IOperationContext, IRdfNamedNode } from '@migaia/storage-contract'
/** Cancellation stays owned by the caller's original operation context. */
export type ISparqlAbortSignal = NonNullable<IOperationContext['signal']>
/** Exactly one native graph is selected per Graph Store request. */
export type IRdfGraphTarget =
  | { readonly default: true; readonly graph?: never }
  | { readonly graph: IRdfNamedNode; readonly default?: never }
/** The native document formats deliberately exclude datasets, RDF-star and inference settings. */
export type IRdfGraphFormat = 'text/turtle' | 'application/n-triples'
/** Complete RDF document bytes remain native data rather than SPARQL grammar. */
export type IRdfGraphDocument = { readonly format: IRdfGraphFormat; readonly text: string }
/** Caller-owned per-graph operations never grant disposal authority. */
export type ISparqlGraphStorePort = {
  get(
    target: IRdfGraphTarget,
    format: IRdfGraphFormat,
    signal?: ISparqlAbortSignal
  ): Promise<string>
  put(
    target: IRdfGraphTarget,
    document: IRdfGraphDocument,
    signal?: ISparqlAbortSignal
  ): Promise<void>
  post(
    target: IRdfGraphTarget,
    document: IRdfGraphDocument,
    signal?: ISparqlAbortSignal
  ): Promise<void>
  remove(target: IRdfGraphTarget, signal?: ISparqlAbortSignal): Promise<void>
  has(target: IRdfGraphTarget, signal?: ISparqlAbortSignal): Promise<boolean>
}
/** A native complete Update is atomic only when the actual endpoint provides that port. */
export type ISparqlEndpoint = {
  query(
    text: string,
    accept: 'application/sparql-results+json' | 'application/n-triples',
    signal?: ISparqlAbortSignal
  ): Promise<string>
  update(text: string, signal?: ISparqlAbortSignal): Promise<void>
  readonly graphStore?: ISparqlGraphStorePort
  atomicUpdate?(text: string, signal?: ISparqlAbortSignal): Promise<void>
}
