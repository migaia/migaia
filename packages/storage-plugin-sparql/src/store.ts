import {
  createBackendChangeController,
  provideCapabilities,
  createSparqlTag,
  assertTransactionOwner,
  resolveConcurrencyPolicy,
  runWithConcurrency,
  snapshotOperationContext,
  snapshotStorageRdfPattern,
  snapshotStorageRdfQuad,
  getStorageOrgGraphPrefix,
  unprefixStorageOrgGraph,
  observeStorageBatch,
  throwIfAborted,
  subscribeToAbort,
  readAbortReason
} from '@migaia/storage-host/sdk'
import { createLifecycleScope, createAbortController } from '@migaia/lifecycle'
import {
  rdf,
  sparql,
  implement,
  StorageContractError,
  StorageContractErrorCode,
  type IQuad,
  type IRdfApi,
  type IOperationContext,
  type ITransactionOptions,
  type IConcurrencyAttempt,
  type ICapabilityInstallPort,
  type IConcurrencyPolicy
} from '@migaia/storage-contract'
import { systemScheduler } from '@migaia/utils/scheduler'
import { walkErrorCauses } from '@migaia/utils/error'
import type { IStoragePluginCore } from '@migaia/storage-host'
import { invalidArgument, normalizeSparqlError, sparqlError } from './errors.js'
import { STORAGE_SPARQL_ERROR_SOURCE, SparqlErrorCode } from '@migaia/storage-contract/error-code'
import { SparqlText } from './text.js'
import { parseSparqlResults } from './results.js'
import { parseRdfDocument } from './ntriples.js'
import { renderFragment } from './render.js'
import { readHttpRoute } from './http-route.js'
import { captureQuads, matchesQuad, matchFragment, quadIdentity } from './rdf.js'
import type { ISparqlDraft, ISparqlOwner } from './transaction.js'
import type { ISparqlEndpoint, ISparqlAbortSignal } from './endpoint.js'
import type { ISparqlBase, ISparqlStore } from './types.js'
import {
  createSparqlBackendBase,
  attempt,
  raw,
  installSparqlNativeFeature,
  createOwner,
  drop
} from './store-mutation.js'
import { query } from './store-query.js'

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
  backendContext.controller = backendContext.core.createChangeController(
    {
      backend: SparqlText.backend,
      finalize: async () => {
        try {
          await backendContext.resources.dispose()
        } finally {
          backendContext.stores.clear()
        }
      }
    },
    createBackendChangeController
  )
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
export function report(backendContext: ISparqlBackendContext, error: unknown): void {
  backendContext.core.stageBindings.backendStages.report(error)
}

export function assertWrite(backendContext: ISparqlBackendContext): void {
  backendContext.controller.assertLive()
  if (backendContext.poisoned) throw backendContext.poisoned
}

/** Unknown native modification is terminal for this installed writer, never for read access. */
export function uncertain(backendContext: ISparqlBackendContext, error: unknown): Error {
  /** The original failure remains the primary cause through rollback or terminal writer poisoning. */
  const failure =
    error instanceof Error &&
    'source' in error &&
    error.source === STORAGE_SPARQL_ERROR_SOURCE &&
    'code' in error &&
    error.code === SparqlErrorCode.commitUnknown
      ? error
      : sparqlError(SparqlErrorCode.commitUnknown, error)
  backendContext.poisoned ??= failure
  return failure
}

/** Each organization projection owns only logical mapping and reuses the physical native endpoint. */
/** Logical organization state is passed to named query, mutation and transaction jobs. */
export type ISparqlOrganizationContext = {
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
export async function observeNative<T>(
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
export async function reading<T>(
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
export async function writing(
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
      error.source === STORAGE_SPARQL_ERROR_SOURCE &&
      'code' in error &&
      error.code === SparqlErrorCode.requestFailed
    )
      throw error
    if (poison) throw uncertain(organizationContext.backendContext, error)
    throw normalizeSparqlError(error)
  }
}

export function queryText(
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
export async function readQuads(
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
export function operate<I, T>(
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
