// Query contexts and query cursors for the SPARQL store (see ./store.ts).
import {
  createRdfQuery,
  readTransactionOperationContext,
  createStorageIteratorLifetime,
  snapshotStorageRdfPattern
} from '@migaia/storage-host/sdk'
import type {
  IQuad,
  IOperationContext,
  IStorageIterator,
  IStorageKey,
  IRdfQuerySource,
  IRdfQuery
} from '@migaia/storage-contract'
import { SparqlText } from './text.js'
import { quadIdentity } from './rdf.js'
import type { ISparqlDraft, ISparqlDraftAccess } from './transaction.js'
import type { ISparqlTransactionScope } from './types.js'
import { mutateSparqlQuery } from './store-mutation.js'
import { readQuads, operate, report } from './store.js'
import type { ISparqlOrganizationContext } from './store.js'

/**
 * Transaction-bound queries register with their actual original operation view, never a copied
 * scope.
 */
/** Logical organization state is passed to named query, mutation and transaction jobs. */
export type ISparqlQueryContext = {
  /** Original organizationContext belongs to this physical namespace. */
  readonly organizationContext: ISparqlOrganizationContext
  /** Original pattern belongs to this physical namespace. */
  readonly pattern: Partial<IQuad>
  /** Original scope belongs to this physical namespace. */
  readonly scope?: ISparqlTransactionScope
  /** Original draft belongs to this physical namespace. */
  readonly draft?: ISparqlDraft
  /** Original access belongs to this physical namespace. */
  readonly access?: ISparqlDraftAccess

  captured: Partial<IQuad>

  execute: IRdfQuerySource<ISparqlTransactionScope>['execute']
}
/** Builds a logical RDF query using the original planner and source identity. */
export function query(
  organizationContext: ISparqlOrganizationContext,
  pattern: Partial<IQuad>,
  scope?: ISparqlTransactionScope,
  draft?: ISparqlDraft,
  access?: ISparqlDraftAccess
): IRdfQuery<IOperationContext | undefined> {
  /** Initialize physical owners in original order before a store escapes. */
  const queryContext = { organizationContext, pattern, scope, draft, access } as ISparqlQueryContext
  queryContext.captured = snapshotStorageRdfPattern(queryContext.pattern, SparqlText.backend)
  queryContext.execute = sourceFor(queryContext, queryContext.scope, queryContext.draft)
  return createRdfQuery<
    IOperationContext | undefined,
    Record<never, never>,
    ISparqlTransactionScope
  >(
    {
      pushdown: { source: SparqlText.backend, operators: [], operations: [] },
      cursorSource: queryContext.organizationContext.store,
      execute: queryContext.execute,
      mutate: (request, run) => mutateSparqlQuery(queryContext, request, run)
    },
    queryContext.captured,
    queryContext.organizationContext.backendContext.core.getChainMethods('rdf') as
      | Record<never, never>
      | undefined
  )
}

/** One query source borrows its existing organization and optional transaction view. */
type ISparqlQuerySourceContext = {
  readonly queryContext: ISparqlQueryContext
  readonly boundScope: ISparqlTransactionScope | undefined
  readonly boundDraft: ISparqlDraft | undefined
  readonly pipeline: boolean
}
/** Native result buffering belongs to the original cursor, not a factory's captured variables. */
type ISparqlQueryCursorContext = ISparqlQuerySourceContext & {
  readonly input: Parameters<IRdfQuerySource<ISparqlTransactionScope>['execute']>[0]
  rows: readonly IQuad[] | undefined
  loading: Promise<readonly IQuad[]> | undefined
  index: number
  iterator: IStorageIterator<readonly [IStorageKey, unknown]> | undefined
  lifetime:
    | ReturnType<typeof createStorageIteratorLifetime<readonly [IStorageKey, unknown]>>
    | undefined
}
/** Creates an execute adapter; every actual cursor receives its own explicit state. */
export function sourceFor(
  queryContext: ISparqlQueryContext,
  boundScope?: ISparqlTransactionScope,
  boundDraft?: ISparqlDraft,
  pipeline = true
): IRdfQuerySource<ISparqlTransactionScope>['execute'] {
  /** This immutable source context grants no new transaction or lifecycle owner. */
  const source: ISparqlQuerySourceContext = { queryContext, boundScope, boundDraft, pipeline }
  return (input) =>
    openSparqlQueryCursor({
      ...source,
      input,
      rows: undefined,
      loading: undefined,
      index: 0,
      iterator: undefined,
      lifetime: undefined
    })
}
/** Reads each buffered quad once and shares the first native load across concurrent pulls. */
async function advanceSparqlQueryCursor(
  context: ISparqlQueryCursorContext,
  load: () => Promise<readonly IQuad[]>
): Promise<IteratorResult<readonly [IStorageKey, unknown]>> {
  context.rows ??= await (context.loading ??= load())
  /** Original source order determines the public cursor position. */
  const quad = context.rows[context.index++]
  return quad
    ? { done: false, value: [quadIdentity(quad), quad] as const }
    : { done: true, value: undefined }
}
/** Cleanup releases buffered rows through the same original iterator lifetime. */
async function closeSparqlQueryCursor(context: ISparqlQueryCursorContext): Promise<void> {
  context.rows = undefined
  context.loading = undefined
}
/** Transaction cursors run in the original accepted scope and optional pipeline. */
function loadScopedSparqlCursor(
  context: ISparqlQueryCursorContext,
  operationScope: ISparqlTransactionScope
): Promise<readonly IQuad[]> {
  if (!context.pipeline)
    return readQuads(
      context.queryContext.organizationContext,
      context.input.pattern,
      readTransactionOperationContext(operationScope) ?? {},
      context.boundDraft
    )
  return context.queryContext.organizationContext.ports.execution.run(
    {
      operation: SparqlText.match,
      input: context.input.pattern,
      scope: operationScope,
      ctx: readTransactionOperationContext(operationScope)
    },
    async (pattern) =>
      readQuads(
        context.queryContext.organizationContext,
        pattern,
        readTransactionOperationContext(operationScope) ?? {},
        context.boundDraft
      )
  )
}
/** Root pulls retain the existing operation admission and lifetime advance. */
function nextSparqlQueryCursor(
  context: ISparqlQueryCursorContext
): Promise<IteratorResult<readonly [IStorageKey, unknown]>> {
  context.queryContext.organizationContext.backendContext.controller.assertLive()
  if (context.lifetime!.isClosing()) return Promise.resolve({ done: true, value: undefined })
  return context.lifetime!.advance(() =>
    advanceSparqlQueryCursor(context, () =>
      operate(
        context.queryContext.organizationContext,
        SparqlText.match,
        context.input,
        context.input.ctx,
        async (value, ctx) => ({
          status: 'committed',
          value: await readQuads(
            context.queryContext.organizationContext,
            value.pattern,
            ctx,
            context.boundDraft
          )
        })
      )
    )
  )
}
/** Registers this native cursor with the original transaction or backend resource owner. */
function openSparqlQueryCursor(
  context: ISparqlQueryCursorContext
): IStorageIterator<readonly [IStorageKey, unknown]> {
  /** A supplied operation view takes precedence over the query's bound scope. */
  const current = context.input.operationScope ?? context.boundScope
  if (current)
    return context.queryContext.organizationContext.owner.registerIterator(current, {
      next: (scope) =>
        advanceSparqlQueryCursor(context, () => loadScopedSparqlCursor(context, scope)),
      close: () => closeSparqlQueryCursor(context)
    })
  context.queryContext.organizationContext.backendContext.controller.assertLive()
  context.lifetime = createStorageIteratorLifetime<readonly [IStorageKey, unknown]>({
    close: () => closeSparqlQueryCursor(context),
    report: (error) => report(context.queryContext.organizationContext.backendContext, error),
    onSettled: () => {
      context.queryContext.organizationContext.backendContext.resources.release(context.iterator!)
    }
  })
  context.iterator = {
    next: () => nextSparqlQueryCursor(context),
    return: context.lifetime.returned,
    dispose: context.lifetime.dispose,
    [Symbol.asyncDispose]: context.lifetime.symbolic,
    [Symbol.asyncIterator]() {
      return this
    }
  }
  context.queryContext.organizationContext.backendContext.resources.own(context.iterator, {
    force: () => context.iterator!.dispose()
  })
  return context.iterator
}
