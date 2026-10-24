import { createLifecycleScope, createAbortController } from '@migaia/lifecycle'
import {
  vector,
  ttl,
  implement,
  provideCapabilities,
  createTransactionOwner,
  runWithConcurrency,
  resolveConcurrencyPolicy,
  snapshotOperationContext,
  snapshotStorageVectorCollection,
  snapshotStorageVector,
  assertStorageVector,
  snapshotStorageVectorUpsert,
  snapshotStorageVectorSearch,
  assertStorageVectorIds,
  snapshotStorageDeleteCountMode,
  assertStringStorageKey,
  snapshotStorageTtlTarget,
  assertStorageTtlDuration,
  createVectorQuery,
  VectorQueryOriginKind,
  type IVectorQueryOrigin,
  createStorageIteratorLifetime,
  compileStorageQueryCondition,
  snapshotStorageWhere,
  QueryOperation,
  QueryOperator,
  DeleteCountMode,
  StorageContractError,
  StorageContractErrorCode,
  type ICapabilityInstallPort,
  type IOperationContext,
  type IStorageVectorConfiguration,
  type IVectorApi,
  type IVectorCollection,
  type IVectorHit,
  type IVectorQueryInput,
  type IStorageIterator,
  type IStorageKey,
  type IWhere,
  type ITtlApi,
  type IQueryCondition
} from '@migaia/storage-contract'
import { parseObjectPath } from '@migaia/utils/object'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { Schemas } from '@qdrant/js-client-rest'
import type { IStoragePluginCore } from '@migaia/storage-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  observeStorageBatch,
  throwIfAborted,
  subscribeToAbort,
  readAbortReason
} from '@migaia/storage-host/authoring/backend'
import { recommendStorageVector } from '@migaia/storage-host/authoring/vector'
import {
  QdrantRoute,
  QdrantText,
  QdrantManagedVectorName,
  QdrantRequiredOperations
} from './constants.js'
import {
  invalidArgument,
  normalizeQdrantError,
  normalizeOperationError,
  qdrantError,
  responseStatus
} from './errors.js'
import { QdrantErrorCode } from './error-code.js'
import { nativeId } from './id.js'
import { encodePointPayload, decodePointPayload, assertPointPayload } from './envelope.js'
import { nativeCondition, orgFilter, type IQdrantFilter } from './filter.js'
import { collectionVectors, readCollectionConfiguration, readCollectionRescore } from './schema.js'
import { snapshotRescoreVector, snapshotRescorePoints } from './feature-input.js'
import type {
  IQdrantRescoreConfiguration,
  IQdrantRescoreVector,
  IQdrantRescorePoint
} from './feature-types.js'
import { nativeFeaturePort, type IQdrantNativeFeaturePort } from './native-feature.js'
import type {
  IQdrantBase,
  IQdrantStore,
  IQdrantOptions,
  IQdrantHttp,
  IQdrantOperationName,
  IQdrantUpdateResult
} from './types.js'
import type {} from './hooks.js'
/** A descriptor borrows one resolved physical schema across every organization. */
type ICollectionState = {
  readonly name: string
  configuration?: IStorageVectorConfiguration
  resolved?: Promise<{
    name: string
    configuration: IStorageVectorConfiguration
    rescore?: IQdrantRescoreConfiguration[string]
  }>
}
/** Genuine missing native methods never become a fabricated fallback transport. */
function unsupported(): never {
  throw new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: QdrantText.backend
  })
}
/** Shared capture owns admission; native deletion and recommendation retain first-occurrence IDs. */
function idsOf(ids: readonly string[]): string[] {
  assertStorageVectorIds(ids, QdrantText.backend)
  return [...new Set(ids)]
}
/** One native operation record is not a count, including acknowledged asynchronous writes. */
function operationResult(result: Schemas['UpdateResult']): IQdrantUpdateResult {
  if (
    !Number.isSafeInteger(result?.operation_id) ||
    (result.status !== 'completed' && result.status !== 'acknowledged')
  )
    throw qdrantError(QdrantErrorCode.responseInvalid)
  return { operationId: result.operation_id!, status: result.status }
}
/** Adapt the admitted vector filter shape to the sole canonical query condition vocabulary. */
function vectorCondition(
  filter: import('@migaia/storage-contract').IVectorFilter
): IQueryCondition {
  if ('all' in filter) return { kind: 'and', conditions: filter.all.map(vectorCondition) }
  if ('any' in filter) return { kind: 'or', conditions: filter.any.map(vectorCondition) }
  if ('not' in filter) return { kind: 'not', condition: vectorCondition(filter.not) }
  const path = parseObjectPath(filter.field).map(String)
  if ('eq' in filter) return { kind: 'field', path, operator: QueryOperator.eq, value: filter.eq }
  if ('in' in filter) return { kind: 'field', path, operator: QueryOperator.in, value: filter.in }
  return {
    kind: 'and',
    conditions: [
      ...(filter.gte === undefined
        ? []
        : [{ kind: 'field' as const, path, operator: QueryOperator.gte, value: filter.gte }]),
      ...(filter.lte === undefined
        ? []
        : [{ kind: 'field' as const, path, operator: QueryOperator.lte, value: filter.lte }])
    ]
  }
}
/** Install the existing controller, lifecycle and immutable organization projection owners. */
/** One fixed organization view borrows native storage and its existing capability installer. */
type IQdrantOrganizationProjection = {
  store: IQdrantStore
  installer: ICapabilityInstallPort
  drop: () => Promise<void>
}
/** Explicit physical Qdrant state belongs to named module operations. */
type IQdrantBackendContext = {
  /** Original options belongs to this physical namespace. */
  readonly options: IQdrantOptions & {
    readonly http: IQdrantHttp
    readonly collectionPrefix: string
  }
  /** Original core belongs to this physical namespace. */
  readonly core: IStoragePluginCore
  /** Original rescore belongs to this physical namespace. */
  readonly rescore?: IQdrantRescoreConfiguration

  resources: ReturnType<typeof createLifecycleScope>

  collections: Map<string, ICollectionState>

  stores: Map<string, IQdrantOrganizationProjection>

  http: IQdrantHttp

  namespace: Promise<string>

  detected: boolean

  symbolic: Promise<void> | undefined

  controller: ReturnType<IStoragePluginCore['createChangeController']>

  root: IQdrantOrganizationProjection
}
export function createQdrantBackend(
  options: IQdrantOptions & { readonly http: IQdrantHttp; readonly collectionPrefix: string },
  core: IStoragePluginCore,
  rescore?: IQdrantRescoreConfiguration
) {
  /** Initialize physical owners in original order before a store escapes. */
  const backendContext = { options, core, rescore } as IQdrantBackendContext
  backendContext.resources = createLifecycleScope()
  backendContext.collections = new Map<string, ICollectionState>()
  backendContext.stores = new Map<
    string,
    { store: IQdrantStore; installer: ICapabilityInstallPort; drop: () => Promise<void> }
  >()
  backendContext.http = backendContext.options.http
  backendContext.namespace = nativeId([backendContext.options.collectionPrefix]).then(
    (hash) => QdrantText.prefix + hash + '_'
  )
  backendContext.detected = false
  backendContext.controller = backendContext.core.createChangeController({
    backend: QdrantText.backend,
    finalize: async () => {
      try {
        await backendContext.resources.dispose()
      } finally {
        backendContext.stores.clear()
        backendContext.collections.clear()
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
    detect: async (signal: import('@migaia/utils/promise').INativeAbortSignal) => {
      backendContext.controller.assertLive()
      for (const operation of QdrantRequiredOperations)
        if (typeof backendContext.http[operation] !== 'function') unsupported()
      if (typeof backendContext.http.getVersion !== 'function') unsupported()
      const version = await backendContext.http.getVersion({ signal }),
        parts = version.split('.').map(Number)
      if (parts[0] !== 1 || !Number.isInteger(parts[1]) || parts[1]! < 11) unsupported()
      backendContext.detected = true
    }
  }
}

/** A captured installation schema is shared by organizations, never registered per point. */
function rescoreSlot(backendContext: IQdrantBackendContext, name: string) {
  return backendContext.rescore && Object.hasOwn(backendContext.rescore, name)
    ? backendContext.rescore[name]
    : undefined
}

/** Dense and matrix admission stays with the existing dense-vector snapshot owner. */
function admitRescore(
  backendContext: IQdrantBackendContext,
  value: IQdrantRescoreVector,
  slot: IQdrantRescoreConfiguration[string]
): IQdrantRescoreVector {
  const matrix = Array.isArray(value[0])
  if (matrix !== (slot.multivector !== undefined)) throw invalidArgument()
  if (matrix) {
    for (const row of value as readonly (readonly number[])[])
      assertStorageVector(row, slot, QdrantText.backend)
  } else assertStorageVector(value as readonly number[], slot, QdrantText.backend)
  return value
}

/** Missing or incompatible slots isolate only the new Feature, never the standard collection. */
function requireRescore(
  backendContext: IQdrantBackendContext,
  name: string,
  actual: IQdrantRescoreConfiguration[string] | undefined
) {
  const selected = rescoreSlot(backendContext, name)
  if (
    !selected ||
    !actual ||
    selected.dimensions !== actual.dimensions ||
    selected.metric !== actual.metric ||
    selected.multivector !== actual.multivector
  )
    unsupported()
  return selected
}

function report(backendContext: IQdrantBackendContext, error: unknown): void {
  backendContext.core.stageBindings.backendStages.report(error)
}

/** Organization wrappers never create another native client, collection registry or disposal right. */
/** One fixed organization owns its public ports and routes through the original physical backend. */
type IQdrantOrganizationContext = {
  /** Original backendContext belongs to this physical namespace. */
  readonly backendContext: IQdrantBackendContext
  /** Original orgId belongs to this physical namespace. */
  readonly orgId: string

  previous: IQdrantOrganizationProjection | undefined

  ports: ReturnType<IStoragePluginCore['getOrgContext']>

  identity: { backendId: string; backend: typeof QdrantText.backend; orgId: string }

  store: IQdrantStore

  installer: ICapabilityInstallPort

  base: IQdrantBase

  vectorApi: IVectorApi<true>

  ttlApi: ITtlApi

  result: IQdrantOrganizationProjection
}
function forOrg(
  backendContext: IQdrantBackendContext,
  orgId: string
): IQdrantOrganizationProjection {
  /** Initialize organization methods in their original publication order. */
  const organizationContext = { backendContext, orgId } as IQdrantOrganizationContext

  organizationContext.backendContext.controller.assertLive()
  organizationContext.previous = organizationContext.backendContext.stores.get(
    organizationContext.orgId
  )

  if (organizationContext.previous) return organizationContext.previous
  organizationContext.ports = organizationContext.backendContext.core.getOrgContext(
    organizationContext.orgId
  )
  organizationContext.identity = {
    backendId: organizationContext.backendContext.core.getBackendId(),
    backend: QdrantText.backend,
    orgId: organizationContext.orgId
  }
  organizationContext.base = {
    backend: QdrantText.backend,
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: false,
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
        .then(undefined, (error: unknown) => report(organizationContext.backendContext, error)))
  }
  organizationContext.vectorApi = createQdrantOrganizationVectorApi(organizationContext)
  organizationContext.ttlApi = {
    expire: (target, ms, ctx) =>
      ttlOperation(organizationContext, target, ctx, 'expire', ms) as Promise<boolean>,
    remaining: (target, ctx) =>
      ttlOperation(organizationContext, target, ctx, 'remaining') as Promise<number | undefined>,
    persist: (target, ctx) =>
      ttlOperation(organizationContext, target, ctx, 'persist') as Promise<boolean>
  }

  Object.defineProperty(organizationContext.base, nativeFeaturePort, {
    value: createQdrantNativeFeaturePort(organizationContext)
  })

  organizationContext.store = provideCapabilities(
    organizationContext.base,
    [
      implement(vector, organizationContext.vectorApi),
      implement(ttl, organizationContext.ttlApi)
    ] as const,
    {
      onInstaller: (port) => {
        organizationContext.installer = port
      }
    }
  )

  createTransactionOwner(
    organizationContext.base,
    (error) => normalizeQdrantError(error) as never,
    {
      concurrencyStages: organizationContext.ports.stageBindings.concurrencyStages(
        organizationContext.store
      )
    }
  )
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

/** Every actual wire call contributes sanitized route statistics to the original hook registry. */
async function send<K extends IQdrantOperationName>(
  organizationContext: IQdrantOrganizationContext,
  operation: K,
  args: readonly unknown[],
  ctx: IOperationContext
): Promise<Awaited<ReturnType<IQdrantHttp[K]>>> {
  throwIfAborted(ctx.signal)
  const route = QdrantRoute[operation],
    start = systemScheduler.now()
  let status: number | undefined
  try {
    const method = organizationContext.backendContext.http[operation]
    if (typeof method !== 'function') unsupported()
    /** Indexed native dispatch still calls the actual HTTP object as its receiver. */
    const value = await (
      organizationContext.backendContext.http[operation] as (...input: unknown[]) => unknown
    )(...args, ctx)
    return value as Awaited<ReturnType<IQdrantHttp[K]>>
  } catch (error) {
    status = responseStatus(error)
    throw normalizeQdrantError(error)
  } finally {
    organizationContext.backendContext.core.emit(QdrantText.onHttpRequest, () => ({
      ...organizationContext.identity,
      method: route.method,
      path: '/' + route.path.replace(':collection', encodeURIComponent(String(args[0]))),
      status,
      elapsedMs: systemScheduler.now() - start
    }))
  }
}

/** One public terminal retains one original admission lease until real native work settles. */
function run<I, T>(
  organizationContext: IQdrantOrganizationContext,
  operation: string,
  input: I,
  ctx: IOperationContext | undefined,
  write: boolean,
  invoke: (input: I, ctx: IOperationContext) => Promise<T>,
  policy?: import('@migaia/storage-contract').IConcurrencyPolicy
): Promise<T> {
  organizationContext.backendContext.controller.assertLive()
  if (!organizationContext.backendContext.detected) unsupported()
  /** Accepted routing/cancellation must remain fixed while native admission and requests await. */
  const captured = snapshotOperationContext(ctx) ?? {}
  if (policy !== undefined) {
    resolveConcurrencyPolicy(organizationContext.base, policy)
    unsupported()
  }
  if ((ctx as (IOperationContext & { readonly lock?: unknown }) | undefined)?.lock !== undefined)
    unsupported()
  const release = organizationContext.backendContext.controller.beginMutation(),
    cancellation = createAbortController(),
    stops: (() => void)[] = []
  try {
    stops.push(
      subscribeToAbort(
        captured.signal,
        () => cancellation.abort(readAbortReason(captured.signal)),
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
  } catch (error) {
    for (const stop of stops) stop()
    release()
    throw error
  }
  const context = { ...captured, orgId: organizationContext.orgId, signal: cancellation.signal }
  let prepared = input
  return observeStorageBatch(
    organizationContext.ports.stageBindings.operationStages(organizationContext.store),
    systemScheduler,
    operation,
    undefined,
    () =>
      runWithConcurrency<T>(
        {
          store: organizationContext.base,
          options: context,
          execute: (actual, loop) =>
            organizationContext.ports.execution.run({ operation, input, ctx: actual }, (next) => {
              prepared = next
              return loop()
            })
        },
        {
          attempt: async (actual) => ({
            status: 'committed',
            value: await invoke(prepared, actual)
          })
        }
      )
  )
    .catch((error) => {
      throw normalizeOperationError(error, operation)
    })
    .finally(() => {
      for (const stop of stops) stop()
      release()
    })
}

/** A single schema promise serializes only first configuration; it is never a point-write queue. */
function resolveCollection(
  organizationContext: IQdrantOrganizationContext,
  state: ICollectionState,
  ctx: IOperationContext
) {
  return (state.resolved ??= (async () => {
    const name =
      (await organizationContext.backendContext.namespace) +
      (await nativeId([organizationContext.backendContext.options.collectionPrefix, state.name]))
    let info: Awaited<ReturnType<IQdrantHttp['getCollection']>>
    try {
      info = await send(organizationContext, QdrantRoute.getCollection.name, [name], ctx)
    } catch (error) {
      if (responseStatus(error) !== 404 || !state.configuration) throw error
      try {
        await send(
          organizationContext,
          'createCollection',
          [
            name,
            {
              vectors: collectionVectors(
                state.configuration,
                rescoreSlot(organizationContext.backendContext, state.name)
              )
            }
          ],
          ctx
        )
      } catch (cause) {
        if (responseStatus(cause) !== 409) throw cause
      }
      info = await send(organizationContext, QdrantRoute.getCollection.name, [name], ctx)
    }
    const configuration = readCollectionConfiguration(info, state.configuration)
    state.configuration = configuration
    const orgIndex =
        info.payload_schema?.[JSON.stringify(QdrantText.org)] ??
        info.payload_schema?.[QdrantText.org],
      expiryIndex =
        info.payload_schema?.[JSON.stringify(QdrantText.expiresAt)] ??
        info.payload_schema?.[QdrantText.expiresAt]
    if (orgIndex) {
      const params = orgIndex.params
      if (
        orgIndex.data_type !== 'keyword' ||
        !params ||
        !('is_tenant' in params) ||
        params.is_tenant !== true
      )
        throw invalidArgument()
    } else
      await send(
        organizationContext,
        'createPayloadIndex',
        [
          name,
          {
            field_name: JSON.stringify(QdrantText.org),
            field_schema: { type: 'keyword', is_tenant: true },
            wait: true
          }
        ],
        ctx
      )
    if (expiryIndex) {
      if (expiryIndex.data_type !== 'datetime') throw invalidArgument()
    } else
      await send(
        organizationContext,
        'createPayloadIndex',
        [
          name,
          {
            field_name: JSON.stringify(QdrantText.expiresAt),
            field_schema: 'datetime',
            wait: true
          }
        ],
        ctx
      )
    return { name, configuration, rescore: readCollectionRescore(info) }
  })().catch((error) => {
    state.resolved = undefined
    throw error
  }))
}

/** Canonical envelopes and native UUIDs are cross-checked before any logical row is exposed. */
async function decode(
  organizationContext: IQdrantOrganizationContext,
  point: Schemas['Record'] | Schemas['ScoredPoint']
) {
  const value = decodePointPayload(point.payload, organizationContext.orgId)
  if (point.id !== (await nativeId([organizationContext.orgId, value.id])))
    throw qdrantError(QdrantErrorCode.responseInvalid)
  return { ...value, point }
}

/** Source slots remain engine float32 values; no payload vector or scoring fallback exists. */
function sample(
  organizationContext: IQdrantOrganizationContext,
  point: Schemas['Record'] | Schemas['ScoredPoint'],
  configuration: IStorageVectorConfiguration
): readonly number[] {
  const vector = point.vector,
    name =
      configuration.metric === 'cosine'
        ? QdrantManagedVectorName.source
        : QdrantManagedVectorName.search
  if (
    !vector ||
    typeof vector !== 'object' ||
    Array.isArray(vector) ||
    !Array.isArray(Reflect.get(vector, name))
  )
    throw qdrantError(QdrantErrorCode.responseInvalid)
  const components = Reflect.get(vector, name) as readonly number[]
  try {
    assertStorageVector(components, configuration, QdrantText.backend)
    return components
  } catch (error) {
    throw qdrantError(QdrantErrorCode.responseInvalid, error)
  }
}

async function retrieve(
  organizationContext: IQdrantOrganizationContext,
  name: string,
  ids: readonly string[],
  ctx: IOperationContext,
  configuration?: IStorageVectorConfiguration
) {
  const physical = await Promise.all(ids.map((id) => nativeId([organizationContext.orgId, id]))),
    rows = await send(
      organizationContext,
      'retrieve',
      [
        name,
        {
          ids: physical,
          with_payload: true,
          with_vector: configuration
            ? [
                configuration.metric === 'cosine'
                  ? QdrantManagedVectorName.source
                  : QdrantManagedVectorName.search
              ]
            : false
        }
      ],
      ctx
    )
  if (!Array.isArray(rows)) throw qdrantError(QdrantErrorCode.responseInvalid)
  return Promise.all(
    rows.map((point: Schemas['Record'] | Schemas['ScoredPoint']) =>
      decode(organizationContext, point)
    )
  )
}

/** Public numeric deletion owns its original count strategy and never adds an expiry predicate. */
async function deleteWhere(
  organizationContext: IQdrantOrganizationContext,
  physical: ICollectionState | string,
  condition: IQueryCondition,
  count: DeleteCountMode,
  ctx: IOperationContext
): Promise<number> {
  const expression = nativeCondition(condition),
    predicate = compileStorageQueryCondition<ICodecValue | undefined>(condition)
  if (count === DeleteCountMode.precount && expression === undefined) unsupported()
  const name =
      typeof physical === 'string'
        ? physical
        : (await resolveCollection(organizationContext, physical, ctx)).name,
    filter = orgFilter(organizationContext.orgId, expression === undefined ? [] : [expression])
  if (count === DeleteCountMode.precount) {
    const counted = await send(
      organizationContext,
      QdrantRoute.count.name,
      [name, { filter, exact: true }],
      ctx
    )
    if (!Number.isSafeInteger(counted?.count) || counted.count < 0)
      throw qdrantError(QdrantErrorCode.responseInvalid)
    await send(organizationContext, QdrantRoute.delete.name, [name, { filter, wait: true }], ctx)
    return counted.count
  }
  const collected = new Set<string>()
  let offset: string | number | undefined
  do {
    const page = await send(
      organizationContext,
      'scroll',
      [name, { filter, limit: 256, offset, with_payload: true, with_vector: false }],
      ctx
    )
    if (!Array.isArray(page?.points)) throw qdrantError(QdrantErrorCode.responseInvalid)
    for (const point of page.points) {
      const row = await decode(organizationContext, point)
      if (predicate(row.payload)) {
        if (typeof point.id !== 'string') throw qdrantError(QdrantErrorCode.responseInvalid)
        collected.add(point.id)
      }
    }
    const next = page.next_page_offset
    if (next === offset && next != null) throw qdrantError(QdrantErrorCode.responseInvalid)
    if (next !== null && next !== undefined && typeof next !== 'string' && typeof next !== 'number')
      throw qdrantError(QdrantErrorCode.responseInvalid)
    offset = next ?? undefined
  } while (offset !== undefined)
  const ids = [...collected]
  let committed = 0
  for (let start = 0; start < ids.length; start += 256) {
    const batch = ids.slice(start, start + 256)
    await send(
      organizationContext,
      QdrantRoute.delete.name,
      [name, { points: batch, wait: true }],
      ctx
    )
    committed += batch.length
  }
  return committed
}

/** The original query reader owns chain operations; this iterator performs one bounded native rank. */
function query<TPayload>(
  organizationContext: IQdrantOrganizationContext,
  state: ICollectionState,
  resolve: (
    name: string,
    configuration: IStorageVectorConfiguration,
    ctx: IOperationContext,
    now: number
  ) => Promise<{ query: readonly number[]; exclude: readonly string[] }>,
  exact: boolean,
  metric?: IStorageVectorConfiguration['metric'],
  initialConditions: readonly IQueryCondition[] = [],
  origin?: IVectorQueryOrigin
) {
  /** Query source state belongs to this accepted query, with iteration owned separately. */
  const source = new QdrantRankSource<TPayload>({
    organizationContext,
    state,
    resolve,
    exact,
    metric,
    initialConditions,
    origin
  })
  return createVectorQuery<TPayload, true>(
    source,
    organizationContext.backendContext.core.getChainMethods('vector') as
      | Record<never, never>
      | undefined
  )
}

function createQdrantOrganizationVectorApi(
  organizationContext: IQdrantOrganizationContext
): IQdrantOrganizationContext['vectorApi'] {
  return {
    collection: <TPayload>(
      name: string,
      options?: IStorageVectorConfiguration
    ): IVectorCollection<TPayload, true> => {
      return new QdrantVectorCollection<TPayload>(organizationContext, name, options)
    }
  }
}

/** TTL addresses the same canonical point and never creates a per-point scheduler. */
function ttlOperation(
  organizationContext: IQdrantOrganizationContext,
  target: Parameters<ITtlApi['remaining']>[0],
  ctx: IOperationContext | undefined,
  mode: 'expire' | 'persist' | 'remaining',
  ms?: number
) {
  const captured = snapshotStorageTtlTarget(target, QdrantText.backend)
  if (captured.channel !== 'vector') unsupported()
  if (ms !== undefined) assertStorageTtlDuration(ms, QdrantText.backend)
  const policy = (
    ctx as
      | (IOperationContext & {
          readonly concurrency?: import('@migaia/storage-contract').IConcurrencyPolicy
        })
      | undefined
  )?.concurrency
  return run(
    organizationContext,
    QdrantText.ttl + mode,
    captured,
    ctx,
    mode !== 'remaining',
    async (input, context) => {
      if (input.channel !== 'vector') unsupported()
      const state = organizationContext.backendContext.collections.get(input.collection) ?? {
          name: input.collection
        },
        resolved = await resolveCollection(organizationContext, state, context),
        now = Date.now(),
        row = (await retrieve(organizationContext, resolved.name, [input.id], context))[0]
      if (!row || (row.expiresAt !== undefined && row.expiresAt <= now))
        return mode === 'remaining' ? undefined : false
      if (mode === 'remaining')
        return row.expiresAt === undefined ? undefined : Math.max(0, row.expiresAt - now)
      const id = await nativeId([organizationContext.orgId, input.id])
      if (mode === 'expire')
        await send(
          organizationContext,
          'setPayload',
          [
            resolved.name,
            {
              points: [id],
              payload: { [QdrantText.expiresAt]: new Date(now + ms!).toISOString() },
              wait: true
            }
          ],
          context
        )
      else
        await send(
          organizationContext,
          'deletePayload',
          [
            resolved.name,
            { points: [id], keys: [JSON.stringify(QdrantText.expiresAt)], wait: true }
          ],
          context
        )
      return true
    },
    policy
  )
}

function drop(organizationContext: IQdrantOrganizationContext) {
  return run(
    organizationContext,
    QdrantText.dropOrg,
    undefined,
    undefined,
    true,
    async (_input, context) => {
      const prefix = await organizationContext.backendContext.namespace,
        result = await send(organizationContext, QdrantRoute.getCollections.name, [], context)
      if (!Array.isArray(result?.collections)) throw qdrantError(QdrantErrorCode.responseInvalid)
      for (const collection of result.collections) {
        if (typeof collection.name !== 'string') throw qdrantError(QdrantErrorCode.responseInvalid)
        if (collection.name.startsWith(prefix))
          await deleteWhere(
            organizationContext,
            collection.name,
            snapshotStorageWhere({}),
            DeleteCountMode.precount,
            context
          )
      }
    }
  )
}

/** A fixed organization collection owns its canonical schema reference and public vector ports. */
class QdrantVectorCollection<TPayload> implements IVectorCollection<TPayload, true> {
  /** The original organization supplies admission, native calls and lifetime. */
  readonly #organization: IQdrantOrganizationContext
  /** All organization views borrow one physical schema reference for this logical collection. */
  readonly #current: ICollectionState
  /** Resolve descriptor identity synchronously without opening a native collection. */
  constructor(
    organizationContext: IQdrantOrganizationContext,
    name: string,
    options?: IStorageVectorConfiguration
  ) {
    this.#organization = organizationContext
    organizationContext.backendContext.controller.assertLive()
    /** Schema configuration is retained by the collection across later async discovery. */
    const captured = snapshotStorageVectorCollection(name, options, QdrantText.backend)
    let state = organizationContext.backendContext.collections.get(name)
    if (state) {
      if (
        captured.options &&
        state.configuration &&
        (captured.options.metric !== state.configuration.metric ||
          captured.options.dimensions !== state.configuration.dimensions)
      )
        throw invalidArgument()
      state.configuration ??= captured.options
    } else {
      state = { name, configuration: captured.options }
      organizationContext.backendContext.collections.set(name, state)
    }
    this.#current = state!
  }

  /** Execute the existing near port using this fixed organization and schema. */
  near: IVectorCollection<TPayload, true>['near'] = (input, options) => {
    this.#organization.backendContext.controller.assertLive()
    const exact = options?.exact ?? false,
      metric = options?.metric
    if (typeof exact !== 'boolean') throw invalidArgument()
    if (
      metric !== undefined &&
      this.#current.configuration &&
      metric !== this.#current.configuration.metric
    )
      unsupported()
    /** A deferred query must keep the direction accepted before caller mutation. */
    const direction = snapshotStorageVector(input, this.#current.configuration, QdrantText.backend)
    return query<TPayload>(
      this.#organization,
      this.#current,
      async () => ({ query: direction, exclude: [] }),
      exact,
      metric,
      [],
      { kind: VectorQueryOriginKind.near, vector: direction }
    )
  }

  /** Execute the existing similarTo port using this fixed organization and schema. */
  similarTo: IVectorCollection<TPayload, true>['similarTo'] = (id) => {
    assertStringStorageKey(id, QdrantText.backend)
    return query<TPayload>(
      this.#organization,
      this.#current,
      async (name, configuration, ctx, now) => {
        const row = (await retrieve(this.#organization, name, [id], ctx, configuration))[0]
        if (!row || (row.expiresAt !== undefined && row.expiresAt <= now)) throw invalidArgument()
        return { query: sample(this.#organization, row.point, configuration), exclude: [id] }
      },
      false,
      undefined,
      [],
      { kind: VectorQueryOriginKind.similarTo, id }
    )
  }

  /** Execute the existing recommend port using this fixed organization and schema. */
  recommend: IVectorCollection<TPayload, true>['recommend'] = (examples) => {
    const captured = (function readAcceptedInput() {
      const { positive, negative } = examples,
        pos = idsOf(positive),
        neg = idsOf(negative ?? [])
      if (!pos.length || new Set([...pos, ...neg]).size !== pos.length + neg.length)
        throw invalidArgument()
      return { pos, neg }
    })()
    return query<TPayload>(
      this.#organization,
      this.#current,
      async (name, configuration, ctx, now) => {
        const rows = await retrieve(
            this.#organization,
            name,
            [...captured.pos, ...captured.neg],
            ctx,
            configuration
          ),
          byId = new Map(rows.map((row) => [row.id, row]))
        const load = (id: string) => {
          const row = byId.get(id)
          if (!row || (row.expiresAt !== undefined && row.expiresAt <= now)) throw invalidArgument()
          return sample(this.#organization, row.point, configuration)
        }
        return {
          query: recommendStorageVector(
            captured.pos.map(load) as [readonly number[], ...(readonly number[])[]],
            captured.neg.map(load)
          ),
          exclude: [...captured.pos, ...captured.neg]
        }
      },
      false,
      undefined,
      [],
      {
        kind: VectorQueryOriginKind.recommend,
        positive: captured.pos,
        negative: captured.neg
      }
    )
  }

  /** Execute the existing upsert port using this fixed organization and schema. */
  upsert: IVectorCollection<TPayload, true>['upsert'] = (points, ctx) => {
    const configuration = this.#current.configuration
    /** Points and payloads must remain stable across schema and native-ID awaits. */
    const captured = snapshotStorageVectorUpsert(points, configuration, QdrantText.backend),
      options = { ttlMs: ctx?.ttlMs, policy: ctx?.concurrency }
    if (options.ttlMs !== undefined) assertStorageTtlDuration(options.ttlMs, QdrantText.backend)
    for (const point of captured) assertPointPayload(point.payload as ICodecValue | undefined)
    return run(
      this.#organization,
      QdrantText.upsert,
      captured,
      ctx,
      true,
      async (input, context) => {
        const prepared =
            input === captured
              ? input
              : snapshotStorageVectorUpsert(input, this.#current.configuration, QdrantText.backend),
          facts = prepared.map((point) => ({
            point,
            payload: encodePointPayload(
              this.#organization.orgId,
              point.id,
              point.payload as ICodecValue | undefined
            )
          }))
        const { name, configuration } = await resolveCollection(
            this.#organization,
            this.#current,
            context
          ),
          now = Date.now(),
          ids = await Promise.all(
            prepared.map((point) => nativeId([this.#organization.orgId, point.id]))
          ),
          previous =
            options.ttlMs === undefined && ids.length
              ? await retrieve(
                  this.#organization,
                  name,
                  prepared.map((point) => point.id),
                  context
                )
              : [],
          expiries = new Map(
            previous
              .filter((point) => point.expiresAt !== undefined && point.expiresAt > now)
              .map((point) => [point.id, point.expiresAt!])
          )
        for (const point of prepared)
          assertStorageVector(point.vector, configuration, QdrantText.backend)
        const native = facts.map(({ point, payload: encoded }, index) => {
          const expiry = options.ttlMs === undefined ? expiries.get(point.id) : now + options.ttlMs
          const payload = {
            ...encoded,
            ...(expiry === undefined
              ? {}
              : { [QdrantText.expiresAt]: new Date(expiry).toISOString() })
          }
          return {
            id: ids[index]!,
            vector: {
              [QdrantManagedVectorName.search]: [...point.vector],
              ...(configuration.metric === 'cosine'
                ? { [QdrantManagedVectorName.source]: [...point.vector] }
                : {})
            },
            payload
          }
        })
        if (native.length)
          await send(
            this.#organization,
            QdrantRoute.upsert.name,
            [name, { points: native, wait: true }],
            context
          )
      },
      options.policy
    )
  }

  /** Execute the existing delete port using this fixed organization and schema. */
  delete: IVectorCollection<TPayload, true>['delete'] = (ids, ctx) => {
    /** Native-ID hashing awaits, so retain the original ordered ID selection. */
    const captured = idsOf(ids),
      policy = ctx?.concurrency
    return run(
      this.#organization,
      QdrantText.delete,
      captured,
      ctx,
      true,
      async (input, context) => {
        const { name } = await resolveCollection(this.#organization, this.#current, context),
          physical = await Promise.all(input.map((id) => nativeId([this.#organization.orgId, id])))
        if (physical.length)
          await send(
            this.#organization,
            'delete',
            [
              name,
              {
                filter: orgFilter(this.#organization.orgId, [{ must: [{ has_id: physical }] }]),
                wait: true
              }
            ],
            context
          )
      },
      policy
    )
  }

  /** Execute the existing deleteWhere port using this fixed organization and schema. */
  deleteWhere: IVectorCollection<TPayload, true>['deleteWhere'] = (where, ctx) => {
    const condition = snapshotStorageWhere(where),
      options = {
        count: snapshotStorageDeleteCountMode(ctx?.count ?? undefined, QdrantText.backend),
        policy: ctx?.concurrency
      }
    if (options.count === DeleteCountMode.precount && nativeCondition(condition) === undefined)
      unsupported()
    return run(
      this.#organization,
      QdrantText.deleteWhere,
      condition,
      ctx,
      true,
      (input, context) =>
        deleteWhere(this.#organization, this.#current, input, options.count, context),
      options.policy
    )
  }

  /** Execute the existing search port using this fixed organization and schema. */
  search: IVectorCollection<TPayload, true>['search'] = async (input, options, ctx) => {
    const configuration = this.#current.configuration
    const captured = snapshotStorageVectorSearch(input, options, configuration, QdrantText.backend)
    if (captured.options.k === 0)
      return run(
        this.#organization,
        QdrantText.search,
        captured,
        ctx,
        false,
        async (input, context) => {
          const { configuration } = await resolveCollection(
            this.#organization,
            this.#current,
            context
          )
          assertStorageVector(input.query, configuration, QdrantText.backend)
          return []
        }
      )
    // Public search delegates to the exact same immutable query source and terminal owner.
    const chain = query<TPayload>(
      this.#organization,
      this.#current,
      async () => ({ query: captured.query, exclude: [] }),
      captured.options.exact,
      undefined,
      captured.options.filter ? [vectorCondition(captured.options.filter)] : []
    )
    const hits = await chain.topK(captured.options.k).all(ctx)
    return hits.map((hit) => ({
      id: hit.id,
      score: hit.score,
      ...(captured.options.withPayload && hit.payload !== undefined ? { payload: hit.payload } : {})
    }))
  }
}

/** A vector query emits logical keys and original backend hit metadata. */
type IQdrantQueryRow<TPayload> = readonly [IStorageKey, IVectorHit<TPayload, boolean>]
/** One accepted query retains its source selection and immutable query options across native awaits. */
type IQdrantQueryContext = {
  readonly organizationContext: IQdrantOrganizationContext
  readonly state: ICollectionState
  readonly resolve: (
    name: string,
    configuration: IStorageVectorConfiguration,
    ctx: IOperationContext,
    now: number
  ) => Promise<{ query: readonly number[]; exclude: readonly string[] }>
  readonly exact: boolean
  readonly metric?: IStorageVectorConfiguration['metric']
  readonly initialConditions: readonly IQueryCondition[]
  readonly origin?: IVectorQueryOrigin
}
/** The query source borrows the original backend and creates an independent native-rank iterator. */
class QdrantRankSource<TPayload> {
  /** Fixed query options route every terminal through the same organization and collection. */
  readonly #context: IQdrantQueryContext
  /** Exact selection is public query planning metadata, not a native fallback. */
  readonly exact: boolean
  /** Original origin permits installed rescore refinement without replacing its vector source. */
  readonly origin: IVectorQueryOrigin | undefined
  /** Native refinement is advertised only for the existing configured rescore slot. */
  declare readonly native?: true
  /** Native rank results already support the existing grouped query reader. */
  readonly groupBy = true
  /** Only native-supported operators and terminals can be pushed down. */
  readonly pushdown = {
    source: QdrantText.backend,
    operators: Object.values(QueryOperator),
    operations: [QueryOperation.where, QueryOperation.topK, QueryOperation.minScore],
    canPushCondition: (condition: IQueryCondition) => nativeCondition(condition) !== undefined
  }
  /** Retain the accepted query facts without opening native resources. */
  constructor(context: IQdrantQueryContext) {
    this.#context = context
    this.exact = context.exact
    this.origin = context.origin
    if (context.organizationContext.backendContext.rescore !== undefined) this.native = true
  }
  /** The original change controller owns admission leases. */
  beginOperation = () => this.#context.organizationContext.backendContext.controller.beginMutation()
  /** One execution gets one named iterator and original resource lease. */
  execute = (input: IVectorQueryInput): IStorageIterator<IQdrantQueryRow<TPayload>> => {
    this.#context.organizationContext.backendContext.controller.assertLive()
    return new QdrantRankIterator<TPayload>(this.#context, input)
  }
}
/** One native-rank iterator owns loading, row position and its original iterator lifetime. */
class QdrantRankIterator<TPayload> implements IStorageIterator<IQdrantQueryRow<TPayload>> {
  /** Source facts are fixed before this cursor becomes visible. */
  readonly #context: IQdrantQueryContext
  /** Original pipeline input owns conditions, topK and cancellation for this execution. */
  readonly #input: IVectorQueryInput
  /** Native rows remain local to this cursor until close. */
  #rows: readonly IQdrantQueryRow<TPayload>[] | undefined
  /** The next native row position advances only inside the original lifetime. */
  #index = 0
  /** Concurrent next calls share the one accepted native ranking promise. */
  #loading: Promise<readonly IQdrantQueryRow<TPayload>[]> | undefined
  /** Existing shared iterator lifecycle owns close, return and failure reporting. */
  readonly #lifetime: ReturnType<typeof createStorageIteratorLifetime<IQdrantQueryRow<TPayload>>>
  /** Register this cursor with the existing resource owner after its lifetime is allocated. */
  constructor(context: IQdrantQueryContext, input: IVectorQueryInput) {
    this.#context = context
    this.#input = input
    this.#lifetime = createStorageIteratorLifetime<IQdrantQueryRow<TPayload>>({
      close: async () => {
        this.#rows = undefined
        this.#loading = undefined
      },
      report: (error) => report(context.organizationContext.backendContext, error),
      onSettled: () => {
        context.organizationContext.backendContext.resources.release(this)
      }
    })
    context.organizationContext.backendContext.resources.own(this, { force: () => this.dispose() })
  }
  /** Preserve closed-cursor and original store-disposal behavior before advancing. */
  next = () => {
    this.#context.organizationContext.backendContext.controller.assertLive()
    if (this.#lifetime.isClosing())
      return Promise.resolve({ done: true as const, value: undefined })
    return this.#lifetime.advance(() => this.#advance())
  }
  /** Load at most once and retain the native rank's original row ordering. */
  async #advance(): Promise<IteratorResult<IQdrantQueryRow<TPayload>>> {
    this.#rows ??= await (this.#loading ??= loadQdrantRank<TPayload>(this.#context, this.#input))
    const row = this.#rows[this.#index++]
    return row === undefined ? { done: true, value: undefined } : { done: false, value: row }
  }
  /** Return uses the same cached lifetime close promise. */
  return = (value?: unknown) => this.#lifetime.returned(value)
  /** Ordinary disposal retains the exact original shared promise. */
  dispose = () => this.#lifetime.dispose();
  /** Symbol disposal retains the original one-report cleanup behavior. */
  [Symbol.asyncDispose] = () => this.#lifetime.symbolic();
  /** Iteration never creates another cursor or resource. */
  [Symbol.asyncIterator]() {
    return this
  }
}
/** Enter original operation admission before native schema reads and rank execution. */
function loadQdrantRank<TPayload>(
  queryContext: IQdrantQueryContext,
  input: IVectorQueryInput
): Promise<readonly IQdrantQueryRow<TPayload>[]> {
  return run(
    queryContext.organizationContext,
    QdrantText.search,
    input,
    input.ctx,
    false,
    (next, context) => executeQdrantRank<TPayload>(queryContext, next, context)
  )
}
/**
 * Resolve and execute one bounded native rank, keeping logical payload and score conversion
 * together.
 */
async function executeQdrantRank<TPayload>(
  queryContext: IQdrantQueryContext,
  next: IVectorQueryInput,
  context: IOperationContext
): Promise<readonly IQdrantQueryRow<TPayload>[]> {
  const { organizationContext, state, resolve, exact, metric, initialConditions } = queryContext

  /** Pipeline replacements are captured before schema reads or native ranking. */
  const refinement = next.native
  const native =
    refinement === undefined
      ? undefined
      : (function readAcceptedInput() {
          const { kind, query, topN } = refinement as {
            kind: unknown
            query: IQdrantRescoreVector
            topN: number
          }
          if (
            kind !== QdrantText.rescore ||
            !Number.isSafeInteger(topN) ||
            topN < 1 ||
            topN > next.topK
          )
            throw invalidArgument()
          const selected = rescoreSlot(organizationContext.backendContext, state.name)
          if (!selected) unsupported()
          return {
            query: admitRescore(
              organizationContext.backendContext,
              snapshotRescoreVector(query),
              selected
            ),
            topN
          }
        })()
  const {
    name,
    configuration,
    rescore: actualSlot
  } = await resolveCollection(organizationContext, state, context)
  const extra =
    native === undefined
      ? undefined
      : requireRescore(organizationContext.backendContext, state.name, actualSlot)
  if (metric !== undefined && metric !== configuration.metric) unsupported()
  const now = Date.now(),
    selected = await resolve(name, configuration, context, now)
  if (next.topK === 0) return []
  const conditions = [...initialConditions, ...next.conditions].map(nativeCondition)
  if (conditions.some((condition) => condition === undefined)) unsupported()
  const exclude = await Promise.all(
      selected.exclude.map((id) => nativeId([organizationContext.orgId, id]))
    ),
    filter = orgFilter(organizationContext.orgId, conditions as IQdrantFilter[], now)
  if (exclude.length) filter.must_not = [{ has_id: exclude }]
  assertStorageVector(selected.query, configuration, QdrantText.backend)
  const direction = selected.query,
    result = await send(
      organizationContext,
      'query',
      [name, qdrantRankParameters(native, direction, filter, exact, next, configuration)],
      context
    )
  if (!Array.isArray(result?.points)) throw qdrantError(QdrantErrorCode.responseInvalid)
  const hits: (readonly [IStorageKey, IVectorHit<TPayload, boolean>])[] = []
  for (const point of result.points) {
    const row = await decode(organizationContext, point)
    if (typeof point.score !== 'number' || !Number.isFinite(point.score))
      throw qdrantError(QdrantErrorCode.responseInvalid)
    hits.push([
      row.id,
      {
        id: row.id,
        score: (extra?.metric ?? configuration.metric) === 'euclid' ? -point.score : point.score,
        ...(row.payload === undefined ? {} : { payload: row.payload as TPayload }),
        ...(next.withVector ? { vector: sample(organizationContext, point, configuration) } : {})
      }
    ])
  }
  return hits
}

/** Execute the original updateRescoreVectors feature job with explicit organization context. */
function updateQdrantRescoreVectors(
  organizationContext: IQdrantOrganizationContext,
  collection: string,
  points: readonly IQdrantRescorePoint[],
  ctx?: IOperationContext
) {
  if (typeof organizationContext.backendContext.http[QdrantRoute.updateVectors.name] !== 'function')
    unsupported()
  const selected = rescoreSlot(organizationContext.backendContext, collection)
  if (!selected) unsupported()
  for (const point of points)
    admitRescore(organizationContext.backendContext, point.vector, selected)
  return run(organizationContext, QdrantText.rescore, points, ctx, true, async (input, context) => {
    const prepared = snapshotRescorePoints(input)
    const vectors = prepared.map((point) =>
      admitRescore(organizationContext.backendContext, point.vector, selected)
    )
    const state = organizationContext.backendContext.collections.get(collection) ?? {
      name: collection
    }
    const resolved = await resolveCollection(organizationContext, state, context)
    requireRescore(organizationContext.backendContext, collection, resolved.rescore)
    return send(
      organizationContext,
      QdrantRoute.updateVectors.name,
      [
        resolved.name,
        {
          points: await Promise.all(
            prepared.map(async (point, index) => ({
              id: await nativeId([organizationContext.orgId, point.id]),
              vector: { [QdrantManagedVectorName.rescore]: vectors[index]! }
            }))
          ),
          wait: true
        }
      ],
      context
    )
  })
}

/** Execute the original run feature job with explicit organization context. */
function runQdrantNativeOperation<K extends IQdrantOperationName>(
  organizationContext: IQdrantOrganizationContext,
  operation: K,
  args: readonly unknown[],
  ctx: IOperationContext | undefined,
  write: boolean,
  validate?: (info: Awaited<ReturnType<IQdrantHttp['getCollection']>>) => void
) {
  if (organizationContext.orgId !== organizationContext.backendContext.core.defaultOrgId)
    unsupported()
  return run<readonly unknown[], Awaited<ReturnType<IQdrantHttp[K]>>>(
    organizationContext,
    operation,
    args,
    ctx,
    write,
    async (input, context): Promise<Awaited<ReturnType<IQdrantHttp[K]>>> => {
      if (validate)
        validate(
          await send(organizationContext, QdrantRoute.getCollection.name, [input[0]], context)
        )
      return await send(organizationContext, operation, input, context)
    }
  )
}

/** Execute the original managedDelete feature job with explicit organization context. */
function deleteQdrantManagedPoints<TPayload>(
  organizationContext: IQdrantOrganizationContext,
  collection: string,
  where: IWhere<TPayload> | undefined,
  options: { wait?: boolean; ordering?: 'weak' | 'medium' | 'strong' } | undefined,
  ctx: IOperationContext | undefined,
  purge: boolean
) {
  const condition = where === undefined ? undefined : snapshotStorageWhere(where),
    expression = condition === undefined ? undefined : nativeCondition(condition)
  if (condition !== undefined && expression === undefined) unsupported()
  const captured = {
    wait: options?.wait ?? true,
    ordering: options?.ordering,
    policy: (
      ctx as
        | (IOperationContext & {
            readonly concurrency?: import('@migaia/storage-contract').IConcurrencyPolicy
          })
        | undefined
    )?.concurrency
  }
  if (
    typeof captured.wait !== 'boolean' ||
    (captured.ordering !== undefined && !['weak', 'medium', 'strong'].includes(captured.ordering))
  )
    throw invalidArgument()
  const state = organizationContext.backendContext.collections.get(collection) ?? {
    name: collection
  }
  return run(
    organizationContext,
    purge ? QdrantText.purgeExpired : QdrantText.deleteByFilter,
    undefined,
    ctx,
    true,
    async (_input, context) => {
      const { name } = await resolveCollection(organizationContext, state, context),
        filter = orgFilter(
          organizationContext.orgId,
          purge
            ? [
                {
                  must: [
                    {
                      key: JSON.stringify(QdrantText.expiresAt),
                      range: { lt: new Date(Date.now()).toISOString() }
                    }
                  ]
                }
              ]
            : expression === undefined
              ? []
              : [expression]
        )
      return operationResult(
        await send(
          organizationContext,
          'delete',
          [
            name,
            {
              filter,
              wait: captured.wait,
              ...(captured.ordering === undefined ? {} : { ordering: captured.ordering })
            }
          ],
          context
        )
      )
    },
    captured.policy
  )
}

/**
 * Assemble finite native Feature ports; each short adapter passes explicit organization state to
 * its job.
 */
function createQdrantNativeFeaturePort(
  organizationContext: IQdrantOrganizationContext
): IQdrantNativeFeaturePort {
  return {
    updateRescoreVectors: (
      collection: string,
      points: readonly IQdrantRescorePoint[],
      ctx?: IOperationContext
    ) => updateQdrantRescoreVectors(organizationContext, collection, points, ctx),
    run: <K extends IQdrantOperationName>(
      operation: K,
      args: readonly unknown[],
      ctx: IOperationContext | undefined,
      write: boolean,
      validate?: (info: Awaited<ReturnType<IQdrantHttp['getCollection']>>) => void
    ) => runQdrantNativeOperation<K>(organizationContext, operation, args, ctx, write, validate),
    managedDelete: <TPayload>(
      collection: string,
      where: IWhere<TPayload> | undefined,
      options: { wait?: boolean; ordering?: 'weak' | 'medium' | 'strong' } | undefined,
      ctx: IOperationContext | undefined,
      purge: boolean
    ) =>
      deleteQdrantManagedPoints<TPayload>(
        organizationContext,
        collection,
        where,
        options,
        ctx,
        purge
      )
  } satisfies IQdrantNativeFeaturePort
}

/** Encode one native rank request, keeping prefetch and score conventions in the same wire owner. */
function qdrantRankParameters(
  native: { query: IQdrantRescoreVector; topN: number } | undefined,
  direction: readonly number[],
  filter: IQdrantFilter,
  exact: boolean,
  next: IVectorQueryInput,
  configuration: IStorageVectorConfiguration
) {
  return {
    query: native?.query ?? [...direction],
    using: native === undefined ? QdrantManagedVectorName.search : QdrantManagedVectorName.rescore,
    filter,
    params: { exact: native === undefined ? exact : true },
    limit: native?.topN ?? next.topK,
    ...(native === undefined
      ? {}
      : {
          prefetch: {
            query: [...direction],
            using: QdrantManagedVectorName.search,
            filter,
            params: { exact },
            limit: next.topK,
            ...(next.minScore === undefined
              ? {}
              : {
                  score_threshold:
                    configuration.metric === 'euclid' ? -next.minScore : next.minScore
                })
          }
        }),
    ...(native !== undefined || next.minScore === undefined
      ? {}
      : {
          score_threshold: configuration.metric === 'euclid' ? -next.minScore : next.minScore
        }),
    with_payload: true,
    with_vector: next.withVector
      ? [
          configuration.metric === 'cosine'
            ? QdrantManagedVectorName.source
            : QdrantManagedVectorName.search
        ]
      : false
  }
}
