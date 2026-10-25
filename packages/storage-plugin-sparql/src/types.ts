import {
  rdf,
  sparql,
  type ICapabilityStore,
  type IStorageBase,
  type ICapabilityImpl,
  type IRdfApi,
  type ITransactionRdfApi,
  type ISparqlApi,
  type ISparqlInput,
  type ISparqlTagTools,
  type IConcurrencyPolicy,
  type ITransactionOptions,
  type IOptimisticTransactionBuilder
} from '@migaia/storage-contract'
/** Native transaction scopes expose only actual RDF drafts and one update-only raw body. */
export type ISparqlTxRdf = ITransactionRdfApi & {
  expect(quads: readonly import('@migaia/storage-contract').IQuad[]): void
  expectAbsent(quads: readonly import('@migaia/storage-contract').IQuad[]): void
}
export type ISparqlTxUpdateApi = ISparqlTagTools & {
  (
    strings: TemplateStringsArray,
    ...values: readonly ISparqlInput[]
  ): { update(ctx?: never): Promise<void> }
}
export type ISparqlTransactionScope = {
  use(capability: typeof rdf): ISparqlTxRdf
  use(capability: typeof sparql): ISparqlTxUpdateApi
}
export type ISparqlOptimisticPolicy = IConcurrencyPolicy & { readonly locking: 'optimistic' }
export type ISparqlTransactionOptions = Omit<ITransactionOptions, 'lock' | 'concurrency'> & {
  readonly lock?: never
  readonly concurrency?: ISparqlOptimisticPolicy
}
/** Native fluent construction is the original shared optimistic builder type. */
export type ISparqlTransactionBuilder = IOptimisticTransactionBuilder<ISparqlTransactionScope>
/** Support facts publish the actual non-KV native transaction surface. */
export type ISparqlBase = IStorageBase & {
  readonly backend: 'sparql'
  readonly capabilities: {
    readonly syncRead: false
    readonly binary: false
    readonly records: false
    readonly transactions: true
    readonly iteration: false
    readonly secondaryIndexes: false
    readonly changeFeed: false
    readonly maxValueBytes: undefined
    readonly opaqueEntries: false
  }
}
export type ISparqlStore = ICapabilityStore<
  ISparqlBase,
  typeof rdf | typeof sparql,
  readonly [ICapabilityImpl<typeof rdf, IRdfApi>, ICapabilityImpl<typeof sparql, ISparqlApi>]
> & {
  transaction<R>(
    run: (scope: ISparqlTransactionScope) => R,
    options?: ISparqlTransactionOptions
  ): Promise<Awaited<R>>
  tx(): ISparqlTransactionBuilder
}
