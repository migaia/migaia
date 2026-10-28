// Commits, attempts, raw access, drops, query mutations and native graph access for the SPARQL store (see ./store.ts).
import {
  sparqlFragment,
  readTransactionOperationContext,
  runTransactionOperation,
  createTransactionOwner,
  createTransactionBuilder,
  ConcurrencyPolicy,
  snapshotStorageRdfQuad,
  prefixStorageOrgGraph,
  unprefixStorageOrgGraph,
  term,
  throwIfAborted
} from '@migaia/storage-host/sdk'
import {
  assertTransactionCallback,
  StorageContractError,
  StorageContractErrorCode,
  type IQuad,
  type IOperationContext,
  type IConcurrencyAttempt,
  type IRdfQuerySource,
  type IRdfQueryMutation
} from '@migaia/storage-contract'
import { invalidArgument, normalizeTransactionFailure, sparqlError } from './errors.ts'
import { SparqlErrorCode } from '@migaia/storage-contract/error-code'
import { SparqlText } from './text.ts'
import { parseSparqlResults } from './results.ts'
import { renderFragment } from './render.ts'
import { quadFragment } from './rdf.ts'
import { runSparqlAttempt, type ISparqlDraft, type ISparqlDraftAccess } from './transaction.ts'
import { nativeFeaturePort, type ISparqlNativeFeaturePort } from './native-feature.ts'
import { snapshotGraphTarget } from './graph-store.ts'
import type { ISparqlEndpoint, ISparqlAbortSignal, IRdfGraphTarget } from './endpoint.ts'
import type { ISparqlTransactionScope } from './types.ts'
import { query, sourceFor } from './store-query.ts'
import type { ISparqlQueryContext } from './store-query.ts'
import {
  assertWrite,
  observeNative,
  writing,
  queryText,
  uncertain,
  report,
  operate,
  reading
} from './store.ts'
import type { ISparqlOrganizationContext } from './store.ts'

/** One native conditional Modify publishes user quads and its marker atomically. */
async function commit(
  organizationContext: ISparqlOrganizationContext,
  draft: ISparqlDraft,
  present: ReadonlyMap<string, IQuad>,
  absent: ReadonlyMap<string, IQuad>,
  raw: string | undefined,
  ctx: IOperationContext
): Promise<boolean> {
  assertWrite(organizationContext.backendContext)
  throwIfAborted(ctx.signal)
  organizationContext.backendContext.core.emit(SparqlText.beforeSparqlUpdate, () => ({
    ...organizationContext.identity,
    operationCount: raw === undefined ? draft.size : 1,
    preconditionCount: present.size + absent.size
  }))
  if (raw !== undefined) {
    if (
      organizationContext.orgId !== organizationContext.backendContext.core.defaultOrgId ||
      typeof organizationContext.backendContext.endpoint.atomicUpdate !== 'function'
    )
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: SparqlText.backend
      })
    await observeNative(organizationContext, 'update', SparqlText.post, () =>
      writing(organizationContext, () =>
        organizationContext.backendContext.endpoint.atomicUpdate!(raw, ctx.signal)
      )
    )
    return true
  }
  /**
   * The existing commit marker distinguishes a definite conditional conflict from an uncertain sent
   * write.
   */
  const marker = term.iri(SparqlText.marker + ':' + crypto.randomUUID()),
    markerGraph = term.iri(SparqlText.marker),
    predicate = term.iri(SparqlText.markerPredicate)
  /**
   * One native conditional update must publish the complete draft and both precondition sets
   * atomically.
   */
  const adds = sparqlFragment.join(
      [...draft.values()]
        .filter((value) => value.add)
        .map((value) => quadFragment(organizationContext.orgId, value.quad))
    ),
    deletes = sparqlFragment.join(
      [...draft.values()]
        .filter((value) => !value.add)
        .map((value) => quadFragment(organizationContext.orgId, value.quad))
    ),
    conditions = sparqlFragment.join(
      [...present.values()].map((quad) => quadFragment(organizationContext.orgId, quad))
    ),
    missing = sparqlFragment.join(
      [...absent.values()].map(
        (quad) =>
          sparqlFragment`FILTER NOT EXISTS { ${quadFragment(organizationContext.orgId, quad)} }`
      )
    )
  /** The same marker is published, confirmed and cleaned up through the original endpoint. */
  const markerBody = sparqlFragment`GRAPH ${markerGraph} { ${marker} ${predicate} ${term.literal('1')} . }`,
    text = await renderFragment(
      sparqlFragment`DELETE { ${deletes} } INSERT { ${adds} ${markerBody} } WHERE { ${conditions} ${missing} }`
    )
  throwIfAborted(ctx.signal)
  await observeNative(organizationContext, 'update', SparqlText.post, () =>
    writing(organizationContext, () =>
      organizationContext.backendContext.endpoint.update(text, ctx.signal)
    )
  )
  /** Only the actual marker query can classify the conditional update as committed. */
  let exists: boolean
  try {
    exists = parseSparqlResults(
      await queryText(
        organizationContext,
        await renderFragment(sparqlFragment`ASK { ${markerBody} }`),
        SparqlText.json,
        ctx,
        false
      ),
      'ask'
    )
  } catch (error) {
    throw uncertain(organizationContext.backendContext, error)
  }
  if (!exists) {
    organizationContext.backendContext.core.emit(SparqlText.onPreconditionFailed, () => ({
      ...organizationContext.identity,
      preconditionCount: present.size + absent.size
    }))
    return false
  }
  try {
    await observeNative(organizationContext, 'update', SparqlText.post, () =>
      writing(
        organizationContext,
        async () =>
          organizationContext.backendContext.endpoint.update(
            await renderFragment(sparqlFragment`DELETE DATA { ${markerBody} }`)
          ),
        false
      )
    )
  } catch (error) {
    report(organizationContext.backendContext, error)
  }
  return true
}

export function createSparqlBackendBase(
  organizationContext: ISparqlOrganizationContext
): ISparqlOrganizationContext['base'] {
  return {
    backend: SparqlText.backend,
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: true,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    dispose: () => organizationContext.backendContext.controller.dispose(),
    [Symbol.asyncDispose]: () =>
      (organizationContext.backendContext.symbolic ??= organizationContext.backendContext.controller
        .dispose()
        .then(undefined, (error: unknown) => report(organizationContext.backendContext, error))),
    transaction: (run, options) => {
      assertTransactionCallback(run, SparqlText.backend)
      return operate(
        organizationContext,
        SparqlText.transaction,
        run,
        options,
        (callback, ctx) => attempt(organizationContext, callback, ctx),
        true
      )
    },
    tx: () =>
      createTransactionBuilder(
        organizationContext.store,
        undefined,
        organizationContext.backendContext.core.getChainMethods('tx') as
          | Record<never, never>
          | undefined,
        { mode: 'optimistic' }
      )
  }
}

/** Registers original transaction normalization and concurrency stage ownership. */
export function createOwner(organizationContext: ISparqlOrganizationContext) {
  return createTransactionOwner<unknown, ISparqlTransactionScope>(
    organizationContext.base,
    (error) => normalizeTransactionFailure(error) as Error & { source: string; code: string },
    {
      defaultPolicy: ConcurrencyPolicy.optimistic(),
      concurrencyStages: organizationContext.ports.stageBindings.concurrencyStages(
        organizationContext.store
      )
    }
  )
}

/** Runs one native draft attempt through the existing concurrency owner. */
export function attempt<R>(
  organizationContext: ISparqlOrganizationContext,
  run: (scope: ISparqlTransactionScope, draft: ISparqlDraft, access: ISparqlDraftAccess) => R,
  ctx: IOperationContext
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  return runSparqlAttempt(
    {
      base: organizationContext.base,
      owner: organizationContext.owner,
      context: ctx,
      ports: organizationContext.ports,
      assertLive: () => organizationContext.backendContext.controller.assertLive(),
      stages: (scope) =>
        organizationContext.ports.stageBindings
          .transactionStages(organizationContext.store)
          .forTransaction(scope),
      query: (pattern, scope, draft, access) =>
        query(
          organizationContext,
          pattern,
          scope,
          draft,
          access
        ) as import('@migaia/storage-contract').IRdfQuery<undefined>,
      commit: (draft, present, absent, raw) =>
        commit(organizationContext, draft, present, absent, raw, ctx),
      hasAtomicUpdate: () =>
        organizationContext.orgId === organizationContext.backendContext.core.defaultOrgId &&
        typeof organizationContext.backendContext.endpoint.atomicUpdate === 'function'
    },
    run
  )
}

/** Routes a supported physical-default raw query through one original operation observation. */
export function raw<T>(
  organizationContext: ISparqlOrganizationContext,
  operation: string,
  prepare: () => string,
  ctx: IOperationContext | undefined,
  invoke: (text: string, context: IOperationContext) => Promise<T>,
  write = false
): Promise<T> {
  if (organizationContext.orgId !== organizationContext.backendContext.core.defaultOrgId)
    return Promise.reject(
      new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: SparqlText.backend
      })
    )
  return operate(
    organizationContext,
    operation,
    prepare,
    ctx,
    async (input, context) => ({ status: 'committed', value: await invoke(input(), context) }),
    write
  )
}

/** Graph Store writes return native results while retaining the same uncertainty seal. */
async function writingValue<T>(
  organizationContext: ISparqlOrganizationContext,
  invoke: () => Promise<T>
): Promise<T> {
  /** The original native or user result is retained until its accepted write/read branch settles. */
  let value!: T
  await writing(organizationContext, async () => {
    value = await invoke()
  })
  return value
}

/** Organization removal includes raw blank documents and empty named graphs, not only ground rows. */
export function drop(organizationContext: ISparqlOrganizationContext) {
  return operate(
    organizationContext,
    SparqlText.dropOrg,
    undefined,
    undefined,
    async (_input, ctx) => {
      /** Complete native text is consumed before status or result validation can finish. */
      const body = await renderFragment(
        sparqlFragment`SELECT ?g WHERE { GRAPH ?g {} FILTER(STRSTARTS(STR(?g),${term.literal(organizationContext.prefix)})) }`
      )
      /** The native result rows are consumed by the current logical graph operation only. */
      const rows = parseSparqlResults(
        await queryText(organizationContext, body, SparqlText.json, ctx),
        'select'
      )
      /** Only validated graphs belonging to this organization may enter its drop request. */
      const graphs = new Map<string, import('@migaia/storage-contract').IRdfNamedNode>()
      for (const row of rows) {
        if (row.g?.termType !== 'NamedNode') throw sparqlError(SparqlErrorCode.responseInvalid)
        try {
          unprefixStorageOrgGraph(organizationContext.orgId, row.g)
        } catch (error) {
          throw sparqlError(SparqlErrorCode.responseInvalid, error)
        }
        graphs.set(row.g.value, row.g)
      }
      if (graphs.size > 0) {
        assertWrite(organizationContext.backendContext)
        throwIfAborted(ctx.signal)
        /**
         * Stable contract text or a complete native request is selected before crossing its
         * boundary.
         */
        const text = await renderFragment(
          sparqlFragment.join(
            [...graphs.values()].map((graph) => sparqlFragment`DROP SILENT GRAPH ${graph}`),
            sparqlFragment`;`
          )
        )
        await observeNative(organizationContext, 'update', SparqlText.post, () =>
          writing(organizationContext, () =>
            organizationContext.backendContext.endpoint.update(text, ctx.signal)
          )
        )
      }
      return { status: 'committed', value: undefined }
    },
    true
  )
}

/** Mutation request and execution callback retain the original RDF query boundary. */
type ISparqlQueryMutationRequest = Parameters<
  NonNullable<IRdfQuerySource<ISparqlTransactionScope>['mutate']>
>[0]
/** The original reader owns mutation selection and accepted-row accounting. */
type ISparqlQueryMutationRun = Parameters<
  NonNullable<IRdfQuerySource<ISparqlTransactionScope>['mutate']>
>[1]
/** Claims the existing draft and applies only the original selected quads. */
function applySparqlQueryMutation(
  queryContext: ISparqlQueryContext,
  request: ISparqlQueryMutationRequest,
  run: ISparqlQueryMutationRun,
  current: ISparqlTransactionScope,
  state: ISparqlDraft,
  writer: ISparqlDraftAccess,
  input: IRdfQueryMutation
): ReturnType<ISparqlQueryMutationRun> {
  if (input.operation !== request.operation) throw invalidArgument()
  /**
   * A caller replacement quad must survive selection and commit awaits without observing later
   * caller mutation.
   */
  const replacement =
    input.operation === 'replace'
      ? snapshotStorageRdfQuad(input.newQuad, SparqlText.backend)
      : undefined
  writer.claim(current)
  return run({
    execute: sourceFor(queryContext, current, state, false),
    accept: (_key, quad) => {
      writer.write(current, [quad], false)
      if (replacement) writer.write(current, [replacement], true)
      return true
    }
  })
}
/** One mutation reuses the original scope, pipeline and native transaction attempt. */
export function mutateSparqlQuery(
  queryContext: ISparqlQueryContext,
  request: ISparqlQueryMutationRequest,
  run: ISparqlQueryMutationRun
): ReturnType<NonNullable<IRdfQuerySource<ISparqlTransactionScope>['mutate']>> {
  /** The original mutation discriminator selects one existing pipeline observation. */
  const operation =
    request.operation === 'delete' ? SparqlText.queryDelete : SparqlText.queryReplace
  /** One accepted write terminal claims RDF before selection and changes only this attempt's draft. */

  if (queryContext.scope && queryContext.draft && queryContext.access)
    return runTransactionOperation(queryContext.scope, (current) =>
      queryContext.organizationContext.ports.execution.run(
        {
          operation,
          input: request,
          scope: current,
          ctx: readTransactionOperationContext(current)
        },
        async (input) => {
          /** The original transaction stage owner receives callbacks in its established order. */
          const stage = queryContext.organizationContext.ports.stageBindings
            .transactionStages(queryContext.organizationContext.store)
            .forTransaction(current)
          void stage.beforeTxOperation?.(operation)
          /**
           * The accepted selection count is retained until the existing after-operation
           * notification runs.
           */
          const count = await applySparqlQueryMutation(
            queryContext,
            request,
            run,
            current,
            queryContext.draft!,
            queryContext.access!,
            input
          )
          void stage.afterTxOperation?.(operation)
          return count
        }
      )
    )
  return operate(
    queryContext.organizationContext,
    operation,
    request,
    undefined,
    (input, ctx) =>
      attempt(
        queryContext.organizationContext,
        (current, state, writer) =>
          applySparqlQueryMutation(queryContext, request, run, current, state, writer, input),
        ctx
      ),
    true,
    true,
    { ctx: request.ctx, policy: request.concurrency }
  )
}

/** Installs graph operations on the existing native port without another host or lifecycle owner. */
export function installSparqlNativeFeature(organizationContext: ISparqlOrganizationContext): void {
  Object.defineProperty(organizationContext.base, nativeFeaturePort, {
    value: {
      run: <T>(
        operation: string,
        ctx: IOperationContext | undefined,
        write: boolean,
        method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
        invoke: (
          endpoint: ISparqlEndpoint,
          signal: ISparqlAbortSignal | undefined,
          map: (target: IRdfGraphTarget) => IRdfGraphTarget
        ) => Promise<T>
      ) => runSparqlNativeGraph<T>(organizationContext, operation, ctx, write, method, invoke)
    } satisfies ISparqlNativeFeaturePort
  })
}

/** Runs one graph operation through the original admission, observation and uncertainty policy. */
function runSparqlNativeGraph<T>(
  organizationContext: ISparqlOrganizationContext,
  operation: string,
  ctx: IOperationContext | undefined,
  write: boolean,
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
  invoke: (
    endpoint: ISparqlEndpoint,
    signal: ISparqlAbortSignal | undefined,
    map: (target: IRdfGraphTarget) => IRdfGraphTarget
  ) => Promise<T>
): Promise<T> {
  return operate(
    organizationContext,
    operation,
    undefined,
    ctx,
    async (_input, context) => ({
      status: 'committed',
      value: await observeNative(organizationContext, 'graph', method, () => {
        /** The original graph prefix mapper is passed only to this accepted native request. */
        const map = (target: IRdfGraphTarget): IRdfGraphTarget => {
          /**
           * This accepted input is retained across native, pipeline or rendering awaits; caller
           * mutation must not change that accepted operation.
           */
          const captured = snapshotGraphTarget(target)
          return {
            graph: prefixStorageOrgGraph(
              organizationContext.orgId,
              captured.default ? term.defaultGraph : captured.graph
            )
          }
        }
        if (write)
          return writingValue(organizationContext, () =>
            invoke(organizationContext.backendContext.endpoint, context.signal, map)
          )
        return reading(organizationContext, context, (signal) =>
          invoke(organizationContext.backendContext.endpoint, signal, map)
        )
      })
    }),
    write,
    false
  )
}
