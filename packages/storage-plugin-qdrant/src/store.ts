import {
  createBackendChangeController,
  provideCapabilities,
  createTransactionOwner,
  resolveConcurrencyPolicy,
  runWithConcurrency,
  snapshotOperationContext,
  snapshotStorageTtlTarget,
  createVectorQuery,
  compileStorageQueryCondition,
  snapshotStorageWhere,
  observeStorageBatch,
  throwIfAborted,
  subscribeToAbort,
  readAbortReason
} from '@migaia/storage-host/sdk'
import { createLifecycleScope, createAbortController } from '@migaia/lifecycle'
import {
  vector,
  ttl,
  implement,
  assertStorageVector,
  assertStorageVectorIds,
  assertStorageTtlDuration,
  type IVectorQueryOrigin,
  QueryOperator,
  DeleteCountMode,
  StorageContractError,
  StorageContractErrorCode,
  type ICapabilityInstallPort,
  type IOperationContext,
  type IStorageVectorConfiguration,
  type IVectorApi,
  type IVectorCollection,
  type ITtlApi,
  type IQueryCondition
} from '@migaia/storage-contract'
import { parseObjectPath } from '@migaia/utils/object'
import type { ICodecValue } from '@migaia/serialize/codec'
import type { Schemas } from '@qdrant/js-client-rest'
import type { IStoragePluginCore } from '@migaia/storage-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  QdrantRoute,
  QdrantText,
  QdrantManagedVectorName,
  QdrantRequiredOperations
} from './constants.ts'
import {
  invalidArgument,
  normalizeQdrantError,
  normalizeOperationError,
  qdrantError,
  responseStatus
} from './errors.ts'
import { QdrantErrorCode } from '@migaia/storage-contract/error-code'
import { nativeId } from './id.ts'
import { decodePointPayload } from './envelope.ts'
import { nativeCondition, orgFilter } from './filter.ts'
import { collectionVectors, readCollectionConfiguration, readCollectionRescore } from './schema.ts'
import type { IQdrantRescoreConfiguration, IQdrantRescoreVector } from './feature-types.ts'
import { nativeFeaturePort } from './native-feature.ts'
import type {
  IQdrantBase,
  IQdrantStore,
  IQdrantOptions,
  IQdrantHttp,
  IQdrantOperationName,
  IQdrantUpdateResult
} from './types.ts'
import { QdrantVectorCollection } from './store-collection.ts'
import { createQdrantNativeFeaturePort, QdrantRankSource } from './store-rank.ts'

/** A descriptor borrows one resolved physical schema across every organization. */
export type ICollectionState = {
  readonly name: string
  configuration?: IStorageVectorConfiguration
  resolved?: Promise<{
    name: string
    configuration: IStorageVectorConfiguration
    rescore?: IQdrantRescoreConfiguration[string]
  }>
}
/** Genuine missing native methods never become a fabricated fallback transport. */
export function unsupported(): never {
  throw new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: QdrantText.backend
  })
}
/** Shared capture owns admission; native deletion and recommendation retain first-occurrence IDs. */
export function idsOf(ids: readonly string[]): string[] {
  assertStorageVectorIds(ids, QdrantText.backend)
  return [...new Set(ids)]
}
/** One native operation record is not a count, including acknowledged asynchronous writes. */
export function operationResult(result: Schemas['UpdateResult']): IQdrantUpdateResult {
  if (
    !Number.isSafeInteger(result?.operation_id) ||
    (result.status !== 'completed' && result.status !== 'acknowledged')
  )
    throw qdrantError(QdrantErrorCode.responseInvalid)
  return { operationId: result.operation_id!, status: result.status }
}
/** Adapt the admitted vector filter shape to the sole canonical query condition vocabulary. */
export function vectorCondition(
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
  backendContext.controller = backendContext.core.createChangeController(
    {
      backend: QdrantText.backend,
      finalize: async () => {
        try {
          await backendContext.resources.dispose()
        } finally {
          backendContext.stores.clear()
          backendContext.collections.clear()
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
export function rescoreSlot(backendContext: IQdrantBackendContext, name: string) {
  return backendContext.rescore && Object.hasOwn(backendContext.rescore, name)
    ? backendContext.rescore[name]
    : undefined
}

/** Dense and matrix admission stays with the existing dense-vector snapshot owner. */
export function admitRescore(
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
export function requireRescore(
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

export function report(backendContext: IQdrantBackendContext, error: unknown): void {
  backendContext.core.stageBindings.backendStages.report(error)
}

/** Organization wrappers never create another native client, collection registry or disposal right. */
/** One fixed organization owns its public ports and routes through the original physical backend. */
export type IQdrantOrganizationContext = {
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
export async function send<K extends IQdrantOperationName>(
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
export function run<I, T>(
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
export function resolveCollection(
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
export async function decode(
  organizationContext: IQdrantOrganizationContext,
  point: Schemas['Record'] | Schemas['ScoredPoint']
) {
  const value = decodePointPayload(point.payload, organizationContext.orgId)
  if (point.id !== (await nativeId([organizationContext.orgId, value.id])))
    throw qdrantError(QdrantErrorCode.responseInvalid)
  return { ...value, point }
}

/** Source slots remain engine float32 values; no payload vector or scoring fallback exists. */
export function sample(
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

export async function retrieve(
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
export async function deleteWhere(
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
export function query<TPayload>(
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
