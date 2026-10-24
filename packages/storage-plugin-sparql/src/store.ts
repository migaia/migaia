import { createLifecycleScope, createAbortController } from '@migaia/lifecycle'
import {
  rdf,
  sparql,
  implement,
  assertTransactionCallback,
  StorageContractError,
  StorageContractErrorCode,
  type IQuad,
  type IRdfApi,
  type IOperationContext,
  type ITransactionOptions,
  type IConcurrencyAttempt,
  type ICapabilityInstallPort,
  type IStorageIterator,
  type IStorageKey,
  type IRdfQuerySource,
  type IRdfQueryMutation,
  type IRdfQuery,
  type IConcurrencyPolicy
} from '@migaia/storage-contract'
import { provideCapabilities } from '@migaia/storage-host/authoring/capability'
import { createSparqlTag, sparqlFragment } from '@migaia/storage-host/authoring/sparql'
import { createRdfQuery } from '@migaia/storage-host/authoring/query'
import {
  readTransactionOperationContext,
  runTransactionOperation,
  assertTransactionOwner,
  createTransactionOwner,
  createTransactionBuilder,
  resolveConcurrencyPolicy
} from '@migaia/storage-host/authoring/transaction'
import { createStorageIteratorLifetime } from '@migaia/storage-host/authoring/resource'
import { runWithConcurrency, ConcurrencyPolicy } from '@migaia/storage-host/authoring/concurrency'
import { snapshotOperationContext } from '@migaia/storage-host/authoring/context'
import {
  snapshotStorageRdfPattern,
  snapshotStorageRdfQuad,
  getStorageOrgGraphPrefix,
  prefixStorageOrgGraph,
  unprefixStorageOrgGraph,
  term
} from '@migaia/storage-host/authoring/rdf'
import { systemScheduler } from '@migaia/utils/scheduler'
import { walkErrorCauses } from '@migaia/utils/error'
import {
  observeStorageBatch,
  throwIfAborted,
  subscribeToAbort,
  readAbortReason
} from '@migaia/storage-host/authoring/backend'
import type { IStoragePluginCore } from '@migaia/storage-host'
import {
  invalidArgument,
  normalizeSparqlError,
  normalizeTransactionFailure,
  sparqlError
} from './errors.js'
import { ERROR_SOURCE, SparqlErrorCode } from './error-code.js'
import { SparqlText } from './text.js'
import { parseSparqlResults } from './results.js'
import { parseRdfDocument } from './ntriples.js'
import { renderFragment } from './render.js'
import { readHttpRoute } from './http-route.js'
import { captureQuads, matchesQuad, matchFragment, quadFragment, quadIdentity } from './rdf.js'
import {
  runSparqlAttempt,
  type ISparqlDraft,
  type ISparqlOwner,
  type ISparqlDraftAccess
} from './transaction.js'
import { nativeFeaturePort, type ISparqlNativeFeaturePort } from './native-feature.js'
import { snapshotGraphTarget } from './graph-store.js'
import type { ISparqlEndpoint, ISparqlAbortSignal, IRdfGraphTarget } from './endpoint.js'
import type { ISparqlBase, ISparqlStore, ISparqlTransactionScope } from './types.js'
import type {} from './hooks.js'
/** Native input methods are captured without granting the backend ownership of the endpoint. */
export function captureEndpoint(endpoint: ISparqlEndpoint): ISparqlEndpoint {
  /** Only supported endpoint methods are admitted; subsequent requests keep the original receiver. */
  const query = endpoint.query,
    update = endpoint.update,
    atomic = endpoint.atomicUpdate
  if (
    typeof query !== 'function' ||
    typeof update !== 'function' ||
    (atomic !== undefined && typeof atomic !== 'function')
  )
    throw invalidArgument()
  return endpoint
}
/**
 * Install one physical endpoint and the original owners for admission, resources and transaction
 * policy.
 */
/** One fixed organization view borrows native storage and its existing capability installer. */
type ISparqlOrganizationProjection = {
  store: ISparqlStore
  installer: ICapabilityInstallPort
  drop: () => Promise<void>
}
/** Physical endpoint state is passed explicitly to named native and organization jobs. */
type ISparqlBackendContext = {
  /** Original endpoint belongs to this physical namespace. */
  readonly endpoint: ISparqlEndpoint
  /** Original core belongs to this physical namespace. */
  readonly core: IStoragePluginCore

  resources: ReturnType<typeof createLifecycleScope>

  stores: Map<string, ISparqlOrganizationProjection>

  poisoned: Error | undefined

  symbolic: Promise<void> | undefined

  controller: ReturnType<IStoragePluginCore['createChangeController']>

  root: ISparqlOrganizationProjection
}
export function createSparqlBackend(endpoint: ISparqlEndpoint, core: IStoragePluginCore) {
  /** Initialize physical owners in original order before a store escapes. */
  const backendContext = { endpoint, core } as ISparqlBackendContext
  backendContext.resources = createLifecycleScope()
  backendContext.stores = new Map<
    string,
    { store: ISparqlStore; installer: ICapabilityInstallPort; drop: () => Promise<void> }
  >()
  backendContext.controller = backendContext.core.createChangeController({
    backend: SparqlText.backend,
    finalize: async () => {
      try {
        await backendContext.resources.dispose()
      } finally {
        backendContext.stores.clear()
      }
    }
  })
  backendContext.root = forOrg(backendContext, backendContext.core.defaultOrgId)
  return {
    ...backendContext.root,
    controller: backendContext.controller,
    orgBinding: {
      backend: (orgId: string) => forOrg(backendContext, orgId).store,
      drop: (orgId: string) => forOrg(backendContext, orgId).drop()
    },
    detect: async (signal: ISparqlAbortSignal) => {
      parseSparqlResults(
        await backendContext.endpoint.query('ASK {}', SparqlText.json, signal),
        'ask'
      )
    }
  }
}

/** Reports cleanup and native failures through the installed backend stage owner. */
function report(backendContext: ISparqlBackendContext, error: unknown): void {
  backendContext.core.stageBindings.backendStages.report(error)
}

function assertWrite(backendContext: ISparqlBackendContext): void {
  backendContext.controller.assertLive()
  if (backendContext.poisoned) throw backendContext.poisoned
}

/** Unknown native modification is terminal for this installed writer, never for read access. */
function uncertain(backendContext: ISparqlBackendContext, error: unknown): Error {
  /** The original failure remains the primary cause through rollback or terminal writer poisoning. */
  const failure =
    error instanceof Error &&
    'source' in error &&
    error.source === ERROR_SOURCE &&
    'code' in error &&
    error.code === SparqlErrorCode.commitUnknown
      ? error
      : sparqlError(SparqlErrorCode.commitUnknown, error)
  backendContext.poisoned ??= failure
  return failure
}

/** Each organization projection owns only logical mapping and reuses the physical native endpoint. */
/** Logical organization state is passed to named query, mutation and transaction jobs. */
type ISparqlOrganizationContext = {
  /** Original backendContext belongs to this physical namespace. */
  readonly backendContext: ISparqlBackendContext
  /** Original orgId belongs to this physical namespace. */
  readonly orgId: string

  existing: ISparqlOrganizationProjection | undefined

  ports: ReturnType<IStoragePluginCore['getOrgContext']>

  prefix: string

  identity: { backendId: string; backend: string; orgId: string }

  store: ISparqlStore

  installer: ICapabilityInstallPort

  base: ISparqlBase & { transaction: ISparqlStore['transaction']; tx: ISparqlStore['tx'] }

  owner: ISparqlOwner

  rdfApi: IRdfApi

  sparqlApi: ReturnType<typeof createSparqlTag>

  result: ISparqlOrganizationProjection
}
/** Builds one logical organization projection over the original physical endpoint. */
function forOrg(
  backendContext: ISparqlBackendContext,
  orgId: string
): ISparqlOrganizationProjection {
  /** Initialize physical owners in original order before a store escapes. */
  const organizationContext = { backendContext, orgId } as ISparqlOrganizationContext

  organizationContext.backendContext.controller.assertLive()
  organizationContext.existing = organizationContext.backendContext.stores.get(
    organizationContext.orgId
  )

  if (organizationContext.existing) return organizationContext.existing
  organizationContext.ports = organizationContext.backendContext.core.getOrgContext(
    organizationContext.orgId
  )
  organizationContext.prefix = getStorageOrgGraphPrefix(organizationContext.orgId)
  organizationContext.identity = {
    backendId: organizationContext.backendContext.core.getBackendId(),
    backend: SparqlText.backend,
    orgId: organizationContext.orgId
  }
  organizationContext.base = createSparqlBackendBase(organizationContext)
  organizationContext.rdfApi = {
    add: (quads, ctx) => {
      /**
       * This accepted input is retained across native, pipeline or rendering awaits; caller
       * mutation must not change that accepted operation.
       */
      const captured = captureQuads(quads)
      return operate(
        organizationContext,
        SparqlText.add,
        captured,
        ctx,
        (input, context) =>
          attempt(organizationContext, (scope) => scope.use(rdf).add(input), context),
        true,
        false
      )
    },
    delete: (quads, ctx) => {
      /**
       * This accepted input is retained across native, pipeline or rendering awaits; caller
       * mutation must not change that accepted operation.
       */
      const captured = captureQuads(quads)
      return operate(
        organizationContext,
        SparqlText.delete,
        captured,
        ctx,
        (input, context) =>
          attempt(organizationContext, (scope) => scope.use(rdf).delete(input), context),
        true,
        false
      )
    },
    match: (pattern) => query(organizationContext, pattern)
  }
  organizationContext.sparqlApi = createSparqlTag({
    select: (prepare, ctx) =>
      raw(organizationContext, SparqlText.select, prepare, ctx, async (text, context) =>
        parseSparqlResults(
          await queryText(organizationContext, text, SparqlText.json, context),
          'select'
        )
      ),
    ask: (prepare, ctx) =>
      raw(organizationContext, SparqlText.ask, prepare, ctx, async (text, context) =>
        parseSparqlResults(
          await queryText(organizationContext, text, SparqlText.json, context),
          'ask'
        )
      ),
    construct: (prepare, ctx) =>
      raw(organizationContext, SparqlText.construct, prepare, ctx, async (text, context) =>
        parseRdfDocument({
          format: SparqlText.triples,
          text: await queryText(organizationContext, text, SparqlText.triples, context)
        })
      ),
    update: (prepare, ctx) =>
      raw(
        organizationContext,
        SparqlText.rawUpdate,
        prepare,
        ctx,
        async (text, context) =>
          observeNative(organizationContext, 'update', SparqlText.post, () =>
            writing(organizationContext, () =>
              organizationContext.backendContext.endpoint.update(text, context.signal)
            )
          ),
        true
      )
  })

  installSparqlNativeFeature(organizationContext)

  organizationContext.store = provideCapabilities(
    organizationContext.base,
    [
      implement(rdf, organizationContext.rdfApi, {
        forTransaction: (scope) => {
          assertTransactionOwner(organizationContext.base, scope)
          return scope.use(rdf)
        }
      }),
      implement(sparql, organizationContext.sparqlApi)
    ] as const,
    {
      onInstaller: (port) => {
        organizationContext.installer = port
      }
    }
  )

  organizationContext.owner = createOwner(organizationContext)
  organizationContext.result = {
    store: organizationContext.store,
    installer: organizationContext.installer,
    drop: () => drop(organizationContext)
  }

  organizationContext.backendContext.stores.set(
    organizationContext.orgId,
    organizationContext.result
  )
  return organizationContext.result
}

/** Native sends expose only the actual sanitized HTTP route and aggregate request statistics. */
async function observeNative<T>(
  organizationContext: ISparqlOrganizationContext,
  kind: 'query' | 'update' | 'graph',
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
  invoke: () => Promise<T>
): Promise<T> {
  /** Only the sanitized route and monotonic start time enter the existing request observation. */
  const path = readHttpRoute(organizationContext.backendContext.endpoint, kind),
    start = systemScheduler.now()
  /** Only a native response failure contributes status to the original request observation. */
  let status: number | undefined
  try {
    return await invoke()
  } catch (error) {
    for (const cause of walkErrorCauses(error)) {
      if (
        cause &&
        typeof cause === 'object' &&
        'status' in cause &&
        typeof cause.status === 'number'
      ) {
        status = cause.status
        break
      }
    }
    throw error
  } finally {
    if (path !== undefined)
      organizationContext.backendContext.core.emit(SparqlText.onHttpRequest, () => ({
        ...organizationContext.identity,
        method,
        path,
        status,
        elapsedMs: systemScheduler.now() - start
      }))
  }
}

/** Read cancellation borrows the original controller and operation signal without another timer. */
async function reading<T>(
  organizationContext: ISparqlOrganizationContext,
  ctx: IOperationContext,
  invoke: (signal: ISparqlAbortSignal) => Promise<T>
): Promise<T> {
  /**
   * The accepted read borrows both abort sources and releases their existing listeners after
   * settlement.
   */
  const cancellation = createAbortController(),
    stops: (() => void)[] = []
  try {
    stops.push(
      subscribeToAbort(
        ctx.signal,
        () => cancellation.abort(readAbortReason(ctx.signal)),
        (error: unknown) => report(organizationContext.backendContext, error)
      )
    )
    stops.push(
      subscribeToAbort(
        organizationContext.backendContext.controller.closingSignal,
        () =>
          cancellation.abort(
            readAbortReason(organizationContext.backendContext.controller.closingSignal)
          ),
        (error: unknown) => report(organizationContext.backendContext, error)
      )
    )
    throwIfAborted(cancellation.signal)
    return await invoke(cancellation.signal)
  } finally {
    for (const stop of stops) stop()
  }
}

/** Definite native request failures remain definite; every other sent modification is unknown. */
async function writing(
  organizationContext: ISparqlOrganizationContext,
  invoke: () => Promise<void>,
  poison = true
): Promise<void> {
  try {
    await invoke()
  } catch (error) {
    if (
      error instanceof Error &&
      'source' in error &&
      error.source === ERROR_SOURCE &&
      'code' in error &&
      error.code === SparqlErrorCode.requestFailed
    )
      throw error
    if (poison) throw uncertain(organizationContext.backendContext, error)
    throw normalizeSparqlError(error)
  }
}

function queryText(
  organizationContext: ISparqlOrganizationContext,
  text: string,
  accept: typeof SparqlText.json | typeof SparqlText.triples,
  ctx: IOperationContext,
  protect = true
) {
  return observeNative(organizationContext, 'query', SparqlText.post, () =>
    protect
      ? reading(organizationContext, ctx, (signal) =>
          organizationContext.backendContext.endpoint.query(text, accept, signal)
        )
      : organizationContext.backendContext.endpoint.query(text, accept, ctx.signal)
  ).catch((error: unknown) => {
    throw normalizeSparqlError(error)
  })
}

/** Canonical ground SELECT returns logical graph terms; blank/native marker rows never leak. */
async function readQuads(
  organizationContext: ISparqlOrganizationContext,
  pattern: Partial<IQuad>,
  ctx: IOperationContext,
  draft?: ISparqlDraft
): Promise<readonly IQuad[]> {
  /**
   * The accepted pattern survives rendering and I/O; canonical rows are merged with the same
   * transaction draft.
   */
  const captured = snapshotStorageRdfPattern(pattern, SparqlText.backend),
    body = await renderFragment(
      matchFragment(organizationContext.orgId, captured, organizationContext.prefix)
    ),
    rows = parseSparqlResults(
      await queryText(organizationContext, body, SparqlText.json, ctx),
      'select'
    ),
    result = new Map<string, IQuad>()
  try {
    for (const row of rows) {
      if (row.g?.termType !== 'NamedNode') throw invalidArgument()
      /**
       * The canonical RDF validator admits a complete ground quad before it enters a retained
       * result or draft.
       */
      const quad = snapshotStorageRdfQuad(
        {
          subject: row.s!,
          predicate: row.p!,
          object: row.o!,
          graph: unprefixStorageOrgGraph(organizationContext.orgId, row.g)
        } as IQuad,
        SparqlText.backend
      )
      result.set(quadIdentity(quad), quad)
    }
  } catch (error) {
    throw sparqlError(SparqlErrorCode.responseInvalid, error)
  }
  if (draft)
    for (const [key, value] of draft) {
      if (!value.add) result.delete(key)
      else if (matchesQuad(value.quad, captured)) result.set(key, value.quad)
    }
  return [...result.values()]
}

/** Original operation snapshots detach options before retaining an admission lease. */
function optionsOf(
  organizationContext: ISparqlOrganizationContext,
  options?: ITransactionOptions
): ITransactionOptions {
  return {
    ...snapshotOperationContext(options),
    concurrency: options?.concurrency,
    lock: options?.lock,
    orgId: organizationContext.orgId
  }
}

/** Rejects unsupported lock modes before native work. */
function validatePolicy(
  organizationContext: ISparqlOrganizationContext,
  options: ITransactionOptions
): void {
  if (options.lock !== undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: SparqlText.backend
    })
  /** Resolve only the concurrency policy supported by this existing backend. */
  const policy = resolveConcurrencyPolicy(organizationContext.base, options.concurrency)
  if (policy.locking !== 'optimistic')
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: SparqlText.backend
    })
}

/** One public call owns one pipeline, original policy loop and operation observation. */
function operate<I, T>(
  organizationContext: ISparqlOrganizationContext,
  operation: string,
  input: I,
  options: ITransactionOptions | undefined,
  invoke: (input: I, ctx: IOperationContext) => Promise<IConcurrencyAttempt<T>>,
  write = false,
  pipeline = true,
  execution?: {
    readonly ctx: IOperationContext | undefined
    readonly policy: IConcurrencyPolicy | undefined
  }
): Promise<T> {
  organizationContext.backendContext.controller.assertLive()
  if (write) assertWrite(organizationContext.backendContext)
  /** Admission captures caller timing/options before the policy loop can yield. */
  const captured: ITransactionOptions = execution
      ? (execution.ctx ?? {})
      : optionsOf(organizationContext, options),
    policy = execution ? execution.policy : captured?.concurrency
  validatePolicy(organizationContext, { ...captured, concurrency: policy })
  /** This original mutation lease is released only after accepted work settles. */
  const release = organizationContext.backendContext.controller.beginMutation()
  return observeStorageBatch(
    organizationContext.ports.stageBindings.operationStages(organizationContext.store),
    systemScheduler,
    operation,
    undefined,
    () =>
      runWithConcurrency<T>(
        {
          store: organizationContext.base,
          options: captured,
          policy,
          execute: (ctx, loop) =>
            pipeline
              ? organizationContext.ports.execution.run({ operation, input, ctx }, (next) => {
                  input = next
                  return loop()
                })
              : loop()
        },
        {
          attempt: async (ctx) => {
            throwIfAborted(ctx.signal)
            return invoke(input, ctx)
          }
        }
      )
  )
    .catch((error: unknown) => {
      throw normalizeSparqlError(error)
    })
    .finally(release)
}

/**
 * Transaction-bound queries register with their actual original operation view, never a copied
 * scope.
 */
/** Logical organization state is passed to named query, mutation and transaction jobs. */
type ISparqlQueryContext = {
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
function query(
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
function sourceFor(
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

function createSparqlBackendBase(
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
function createOwner(organizationContext: ISparqlOrganizationContext) {
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
function attempt<R>(
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
function raw<T>(
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
function drop(organizationContext: ISparqlOrganizationContext) {
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
function mutateSparqlQuery(
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
function installSparqlNativeFeature(organizationContext: ISparqlOrganizationContext): void {
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
