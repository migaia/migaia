import {
  defineFeature,
  StorageError,
  type IStorageFeatureOutput,
  type IStoragePluginCallContext,
  type IStorageFeatureExpose,
  type IStorageBorrowedBackend
} from '@migaia/storage-host'
import {
  vector,
  ttl,
  assertStorageTtlDuration,
  isStorageContractError,
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContext,
  type IQueryCondition,
  type IWhere,
  type DeleteCountMode,
  type IVectorCollection,
  type IStorageVectorConfiguration
} from '@migaia/storage-contract'
import {
  snapshotStorageVectorCollection,
  snapshotStorageVector,
  snapshotStorageWhere,
  withAbort,
  throwIfAborted,
  readAbortReason,
  createStorageOperationReporter,
  reportCleanupError,
  type IBackendChangeController
} from '@migaia/storage-host/sdk'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import type { ICodecValue } from '@migaia/serialize/codec'
import { raceWithAbort, UtilsAbortError } from '@migaia/utils/promise'
import { cacheBackendKind } from '../kind.js'
import { cacheKey } from '../key.js'
import { cacheError, invalidArgument, missingCapability } from '../errors.js'
import { CacheErrorCode } from '../error-code.js'
import { CacheText, CacheOperation, CacheHook } from '../constants.js'
import type {} from '../hooks.js'

/** User metadata stays scalar and separate from the Feature's reserved flat fields. */
export type ISemanticPayload = Readonly<Record<string, string | number | boolean>>
/** An earlier published vector backend retains every native query, deadline and resource owner. */
export type ISemanticCacheOptions = {
  readonly backend: string
  readonly collection: string
  readonly dimensions: number
  readonly metric?: 'cosine' | 'dot' | 'euclid'
  readonly minScore: number
  readonly ttlMs?: number
  readonly embed: (text: string, signal?: AbortSignal) => Promise<readonly number[]>
}
/** Hits expose application values and provenance without returning the physical vector point. */
export type ISemanticHit<T> = Readonly<{ value: T; score: number; prompt: string }>
/** Fresh loads have no engine score and retain the caller's requested prompt. */
export type ISemanticLoaded<T> = Readonly<{ value: T; score: undefined; prompt: string }>
/** Candidate acceptance runs in descending native score order and can reject false semantic hits. */
export type ISemanticGetOptions<T> = {
  readonly where?: IWhere<ISemanticPayload>
  readonly minScore?: number
  readonly candidates?: number
  readonly accept?: (hit: ISemanticHit<T>) => boolean | Promise<boolean>
  readonly ctx?: IOperationContext
}
/** Semantic policy is an actual cache Feature; it adds no transaction or storage ownership. */
export type ISemanticCacheApi = {
  get<T extends ICodecValue>(
    prompt: string,
    options?: ISemanticGetOptions<T>
  ): Promise<ISemanticHit<T> | undefined>
  set<T extends ICodecValue>(
    prompt: string,
    value: T,
    options?: { readonly payload?: ISemanticPayload; readonly ctx?: IOperationContext }
  ): Promise<void>
  getOrLoad<T extends ICodecValue>(
    prompt: string,
    load: (signal: AbortSignal) => Promise<T>,
    options?: ISemanticGetOptions<T> & {
      readonly payload?: ISemanticPayload
      readonly ttlMs?: number
      readonly cacheIf?: (value: T) => boolean
    }
  ): Promise<ISemanticHit<T> | ISemanticLoaded<T>>
  invalidate(
    where: IWhere<ISemanticPayload>,
    ctx?: IOperationContext & { readonly count?: DeleteCountMode }
  ): Promise<number>
}
/** These flat names are the only semantic on-disk envelope; user fields retain their original names. */
const SemanticField = {
  prefix: '$cache.',
  value: '$cache.v',
  prompt: '$cache.p',
  format: '$cache.f'
} as const
/** This format identifies only the semantic envelope, independently of the original value codec. */
const SEMANTIC_FORMAT = 1
/** Fail-soft observations use the host's existing cache hook and its existing operation vocabulary. */
const SemanticOperation = { accept: 'accept' } as const
/** The original strict JSON value codec alone defines application encoding and decoding. */
const valueCodec = defineJsonCodec({ version: 1 })

/** Detaches scalar metadata before hashing and embedding can await caller-owned values. */
function snapshotPayload(input: ISemanticPayload | undefined): ISemanticPayload {
  if (input === undefined) return {}
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalidArgument()
  /** Own scalar fields preserve otherwise-special names while sharing one eventual point identity. */
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (
        key.startsWith(SemanticField.prefix) ||
        !(
          typeof value === 'string' ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value))
        )
      )
        throw invalidArgument()
      return [key, value]
    })
  )
}
/** Inspect only the original compiler's AST; no cache-side predicate compiler is introduced. */
function assertPublicCondition(condition: IQueryCondition): void {
  /** The original canonical tree supplies paths; this stack never interprets DSL operators. */
  const pending = [condition]
  while (pending.length) {
    /** Each canonical node is inspected once without recursive application stack growth. */
    const current = pending.pop()!
    if (current.kind === 'field') {
      if (current.path.join('.').startsWith(SemanticField.prefix)) throw invalidArgument()
    } else if (current.kind === 'not') pending.push(current.condition)
    else pending.push(...current.conditions)
  }
}
/**
 * The native endpoints accept the original declarative DSL, while the canonical parser returns an
 * AST. Keep one detached DSL image across embedding/native-admission awaits, then reuse the
 * canonical AST only for reserved-path validation; the cache does not translate operator rules.
 */
function snapshotWhere(
  where: IWhere<ISemanticPayload> | undefined
): IWhere<ISemanticPayload> | undefined {
  if (where === undefined) return undefined
  try {
    /** Capture the caller's scalar filter containers before embedding can yield control. */
    const captured = structuredClone(where)
    assertPublicCondition(snapshotStorageWhere(captured))
    return captured
  } catch (cause) {
    if (isStorageContractError(cause)) throw cause
    throw invalidArgument(cause)
  }
}
/** Callback result encoding failures use the same registered cache load boundary as core loading. */
function encodeValue(value: ICodecValue): string {
  try {
    return valueCodec.encode(value)
  } catch (cause) {
    throw cacheError(CacheErrorCode.loadFailed, cause)
  }
}

/** Scalar installation options stay detached for all later Feature and embedding awaits. */
function snapshotSemanticConfiguration(options: ISemanticCacheOptions) {
  if (typeof options !== 'object' || options === null) throw invalidArgument()
  const { backend, collection, dimensions, metric, minScore, ttlMs, embed } = options
  /** The canonical vector owner alone validates names, dimensions and metric. */
  const configuration = snapshotStorageVectorCollection(
    collection,
    { dimensions, metric: metric ?? 'cosine' },
    CacheText.backend
  )
  if (typeof backend !== 'string' || typeof embed !== 'function' || !Number.isFinite(minScore))
    throw invalidArgument()
  if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, CacheText.backend)
  return {
    backend,
    collection: configuration.name,
    ...configuration.options!,
    minScore,
    ttlMs,
    embed
  }
}

/** One installed semantic policy borrows native APIs and owns only its in-process pending loads. */
type ISemanticInstallationContext = {
  readonly configuration: ISemanticCacheOptions & IStorageVectorConfiguration
  readonly core: IStorageFeatureExpose<typeof cacheBackendKind>
  readonly borrowed: IStorageBorrowedBackend
  readonly flights: Map<string, Promise<ISemanticLoaded<ICodecValue>>>
  readonly reporter: ReturnType<typeof createStorageOperationReporter>
}
/** Reuses the original backend publication and cleanup registration; no resource is acquired. */
function createSemanticContext(
  core: ISemanticInstallationContext['core'],
  configuration: ISemanticInstallationContext['configuration']
): ISemanticInstallationContext {
  /** Only an earlier published vector backend grants native collection APIs. */
  const borrowed = core.getPublishedBackend(configuration.backend)
  if (!borrowed.has(vector)) missingCapability(-1, vector.name)
  if (configuration.ttlMs !== undefined && !borrowed.has(ttl)) missingCapability(-1, ttl.name)
  borrowed.use(vector).collection(configuration.collection, configuration)
  /** The map owns pending shared results only; the original controller owns accepted work. */
  const state: ISemanticInstallationContext = {
    configuration,
    core,
    borrowed,
    flights: new Map(),
    reporter: createStorageOperationReporter()
  }
  core.onDispose(() => {
    state.flights.clear()
  })
  return state
}
/** Feature construction can precede store publication, so the original controller is read lazily. */
function semanticController(state: ISemanticInstallationContext): IBackendChangeController {
  /** The host remains the sole authority for this installed backend's current controller. */
  const current = state.core.getChangeController()
  if (current === undefined) missingCapability(-1, 'lifecycle')
  return current
}
/** Per-org targets remain genuine borrowed APIs and never acquire a backend's closing authority. */
function semanticCollection(
  state: ISemanticInstallationContext,
  context: IStoragePluginCallContext
): IVectorCollection<ISemanticPayload> {
  return context
    .backend(state.borrowed)
    .use(vector)
    .collection<ISemanticPayload>(state.configuration.collection, state.configuration)
}
/** Every swallowed backend or callback error reaches the original diagnostic boundary and hook. */
function reportSemanticFailure(
  state: ISemanticInstallationContext,
  context: IStoragePluginCallContext,
  operation: string,
  error: unknown
): void {
  reportCleanupError(state.reporter, error)
  state.core.emit(CacheHook.tierError, () => {
    /** The original error was reported before its optional code is projected for observers. */
    const code =
      typeof error === 'object' && error !== null
        ? (error as { readonly code?: unknown }).code
        : undefined
    return {
      backendId: state.core.getBackendId(),
      backend: CacheText.backend,
      orgId: context.orgId,
      tier: -1,
      operation,
      ...(typeof code === 'string' ? { code } : {})
    }
  })
}
/** Invalid arguments, cancellation and genuine host admission errors never become a cache miss. */
function handleSemanticTierFailure(
  state: ISemanticInstallationContext,
  context: IStoragePluginCallContext,
  operation: string,
  cause: unknown
): void {
  if (isStorageContractError(cause) || cause instanceof StorageError) throw cause
  reportSemanticFailure(state, context, operation, cause)
}
/** Original utility signal composition and original controller leases own all accepted work. */
function runSemanticOperation<R>(
  state: ISemanticInstallationContext,
  context: IStoragePluginCallContext,
  ctx: IOperationContext | undefined,
  work: (
    signal: AbortSignal,
    native: IOperationContext,
    owner: IBackendChangeController
  ) => Promise<R>
): Promise<R> {
  /** Every call borrows admission and draining from the same original cache controller. */
  const owner = semanticController(state)
  owner.assertLive()
  return withAbort(ctx, async (caller, snapshot) => {
    if (snapshot?.orgId !== undefined && snapshot.orgId !== context.orgId) throw invalidArgument()
    try {
      return await raceWithAbort(
        ({ signal }) => {
          /** Caller cancellation must not release accepted work before its native Promise ends. */
          const release = owner.beginMutation()
          /** The original context owner already captured the caller's timeout and organization. */
          const native = { ...snapshot, signal }
          try {
            return work(signal as AbortSignal, native, owner).finally(release)
          } catch (cause) {
            release()
            throw cause
          }
        },
        {
          signals: [...(caller === undefined ? [] : [caller]), owner.closingSignal],
          report: (error) => reportCleanupError(state.reporter, error)
        }
      )
    } catch (cause) {
      if (cause instanceof UtilsAbortError)
        throw new StorageContractError(StorageContractErrorCode.aborted, {
          backend: CacheText.backend,
          cause: readAbortReason(caller?.aborted ? caller : owner.closingSignal)
        })
      throw cause
    }
  })
}
/** Embedding failures preserve the exact callback error; vector dimensions use the sole owner. */
async function embedSemanticPrompt(
  state: ISemanticInstallationContext,
  prompt: string,
  signal: AbortSignal
): Promise<readonly number[]> {
  /** Only the callback produces vectors; canonical admission owns dimension and metric checks. */
  let direction: readonly number[]
  try {
    direction = await state.configuration.embed(prompt, signal)
  } catch (cause) {
    throwIfAborted(signal)
    throw cacheError(CacheErrorCode.embedFailed, cause)
  }
  throwIfAborted(signal)
  return snapshotStorageVector(direction, state.configuration, CacheText.backend)
}
/** Read bounded native candidates, decode original values, then apply the caller's acceptance. */
async function readSemanticHit<T extends ICodecValue>(
  state: ISemanticInstallationContext,
  context: IStoragePluginCallContext,
  prompt: string,
  options: ISemanticGetOptions<T>,
  signal: AbortSignal,
  native: IOperationContext
): Promise<ISemanticHit<T> | undefined> {
  /**
   * The engine receives the original embedder's canonically detached components captured across the
   * embed Promise handoff.
   */
  const direction = await embedSemanticPrompt(state, prompt, signal)
  /** Only bounded native hits cross into decode and acceptance, never a collection full scan. */
  let hits
  try {
    /** The original immutable vector builder owns all native ranking and filter planning. */
    let query = semanticCollection(state, context).near(direction)
    if (options.where !== undefined) query = query.where(options.where)
    hits = await query.minScore(options.minScore!).topK(options.candidates!).all(native)
  } catch (cause) {
    handleSemanticTierFailure(state, context, CacheOperation.get, cause)
    return undefined
  }
  for (const item of hits) {
    /** Malformed physical envelopes cannot escape as application values. */
    let hit: ISemanticHit<T>
    try {
      /** Physical metadata remains read-only input to this single decoding boundary. */
      const payload = item.payload
      /** Capture reserved values once before any asynchronous acceptance callback. */
      const encoded = payload?.[SemanticField.value]
      /** Application metadata named prompt cannot replace this reserved original provenance. */
      const originalPrompt = payload?.[SemanticField.prompt]
      if (
        payload?.[SemanticField.format] !== SEMANTIC_FORMAT ||
        typeof encoded !== 'string' ||
        typeof originalPrompt !== 'string'
      )
        throw invalidArgument()
      hit = {
        value: valueCodec.decode(encoded) as T,
        score: item.score,
        prompt: originalPrompt
      }
    } catch (cause) {
      reportSemanticFailure(state, context, CacheOperation.decode, cause)
      continue
    }
    if (options.accept === undefined) return hit
    try {
      if ((await options.accept(hit)) === true) return hit
    } catch (cause) {
      reportSemanticFailure(state, context, SemanticOperation.accept, cause)
    }
    throwIfAborted(signal)
  }
  return undefined
}
/** Point identity and value encoding use existing owners; the vector backend alone owns TTL. */
async function writeSemanticPoint(
  state: ISemanticInstallationContext,
  context: IStoragePluginCallContext,
  prompt: string,
  value: string,
  payload: ISemanticPayload,
  ttlMs: number | undefined,
  signal: AbortSignal,
  native: IOperationContext
): Promise<void> {
  /** Canonical portable hashing gives field-order-equivalent model metadata one point identity. */
  const id = await cacheKey(prompt, payload)
  /** No point mutation starts until the embedding is complete and dimensionally valid. */
  const direction = await embedSemanticPrompt(state, prompt, signal)
  try {
    await semanticCollection(state, context).upsert(
      [
        {
          id,
          vector: direction,
          payload: {
            ...payload,
            [SemanticField.value]: value,
            [SemanticField.prompt]: prompt,
            [SemanticField.format]: SEMANTIC_FORMAT
          }
        }
      ],
      { ...native, ...(ttlMs === undefined ? {} : { ttlMs }) }
    )
  } catch (cause) {
    handleSemanticTierFailure(state, context, CacheOperation.set, cause)
  }
}
/** Call options detach only semantic metadata; the existing context owner captures budgets. */
function snapshotSemanticGetOptions<T>(
  state: ISemanticInstallationContext,
  prompt: string,
  options: ISemanticGetOptions<T> | undefined
): ISemanticGetOptions<T> {
  if (typeof prompt !== 'string') throw invalidArgument()
  const {
    where,
    minScore = state.configuration.minScore,
    candidates = 1,
    accept,
    ctx
  } = options ?? {}
  if (
    !Number.isFinite(minScore) ||
    !Number.isSafeInteger(candidates) ||
    candidates < 1 ||
    candidates > 10 ||
    (accept !== undefined && typeof accept !== 'function')
  )
    throw invalidArgument()
  return { where: snapshotWhere(where), minScore, candidates, accept, ctx }
}
/** The first admitted loader owns the shared write policy and exact result for all joiners. */
async function loadSemanticValue<T extends ICodecValue>(
  state: ISemanticInstallationContext,
  context: IStoragePluginCallContext,
  prompt: string,
  load: (signal: AbortSignal) => Promise<T>,
  metadata: ISemanticPayload,
  ttlMs: number | undefined,
  cacheIf: ((value: T) => boolean) | undefined,
  sharedSignal: AbortSignal
): Promise<ISemanticLoaded<T>> {
  /** Preserve the callback value itself rather than encoding and decoding it for joiners. */
  let value: T
  try {
    value = await load(sharedSignal)
  } catch (cause) {
    throwIfAborted(sharedSignal)
    throw cacheError(CacheErrorCode.loadFailed, cause)
  }
  throwIfAborted(sharedSignal)
  /** A declined result still fulfills every joined caller with the same original value. */
  let cache = true
  try {
    cache = cacheIf === undefined || cacheIf(value) !== false
  } catch (cause) {
    throw cacheError(CacheErrorCode.loadFailed, cause)
  }
  if (cache)
    await writeSemanticPoint(
      state,
      context,
      prompt,
      encodeValue(value),
      metadata,
      ttlMs,
      sharedSignal,
      { signal: sharedSignal }
    )
  return { value, score: undefined, prompt }
}

/** Joins one pending identity without adding caller cancellation to shared work. */
async function joinSemanticFlight<T extends ICodecValue>(
  state: ISemanticInstallationContext,
  context: IStoragePluginCallContext,
  prompt: string,
  load: (signal: AbortSignal) => Promise<T>,
  metadata: ISemanticPayload,
  ttlMs: number | undefined,
  cacheIf: ((value: T) => boolean) | undefined,
  signal: AbortSignal,
  owner: IBackendChangeController
): Promise<ISemanticLoaded<T>> {
  /** Org and normalized payload keep physically different values in separate in-process flights. */
  const key = await cacheKey(context.orgId, prompt, metadata)
  throwIfAborted(signal)
  /** Only a pending load remains in the installation table. */
  let pending = state.flights.get(key)
  if (pending === undefined) {
    /** Closing is the sole cancellation owner of a shared loader and its eventual write. */
    const shared = loadSemanticValue(
      state,
      context,
      prompt,
      load,
      metadata,
      ttlMs,
      cacheIf,
      owner.closingSignal as AbortSignal
    )
    pending = shared.finally(() => {
      if (state.flights.get(key) === pending) state.flights.delete(key)
    })
    state.flights.set(key, pending)
  }
  return (await pending) as ISemanticLoaded<T>
}

/** Loader options add a shorter TTL and scalar metadata to each caller's read policy. */
type ISemanticLoadOptions<T> = ISemanticGetOptions<T> & {
  readonly payload?: ISemanticPayload
  readonly ttlMs?: number
  readonly cacheIf?: (value: T) => boolean
}
/** Per-caller native reads precede shared loading so filters and acceptance never leak across calls. */
async function getOrLoadSemanticValue<T extends ICodecValue>(
  state: ISemanticInstallationContext,
  context: IStoragePluginCallContext,
  prompt: string,
  load: (signal: AbortSignal) => Promise<T>,
  options?: ISemanticLoadOptions<T>
): Promise<ISemanticHit<T> | ISemanticLoaded<T>> {
  /** Read metadata is captured before any backend admission or embedding await. */
  const selected = snapshotSemanticGetOptions(state, prompt, options)
  const { payload, ttlMs = state.configuration.ttlMs, cacheIf } = options ?? {}
  if (typeof load !== 'function' || (cacheIf !== undefined && typeof cacheIf !== 'function'))
    throw invalidArgument()
  if (ttlMs !== undefined) {
    assertStorageTtlDuration(ttlMs, CacheText.backend)
    if (state.configuration.ttlMs !== undefined && ttlMs > state.configuration.ttlMs)
      throw cacheError(CacheErrorCode.tierInvalid, undefined, -1)
  }
  /** This detached scalar image survives hash/embed awaits and defines the eventual point identity. */
  const metadata = snapshotPayload(payload)
  return runSemanticOperation(state, context, selected.ctx, async (signal, native, owner) => {
    const hit = await readSemanticHit(state, context, prompt, selected, signal, native)
    return (
      hit ??
      joinSemanticFlight(state, context, prompt, load, metadata, ttlMs, cacheIf, signal, owner)
    )
  })
}

/** Fixed Feature API methods retain the host-supplied org receiver and explicit installation state. */
function createSemanticFeatureOutput(state: ISemanticInstallationContext) {
  return {
    capabilities: [] as const,
    chain: {},
    api: {
      transaction: {},
      store: {
        semantic: {
          /** Native vector ranking keeps this caller's captured filter and acceptance policy. */
          async get<T extends ICodecValue>(
            this: IStoragePluginCallContext,
            prompt: string,
            options?: ISemanticGetOptions<T>
          ) {
            const selected = snapshotSemanticGetOptions(state, prompt, options)
            return runSemanticOperation(state, this, selected.ctx, (signal, native) =>
              readSemanticHit(state, this, prompt, selected, signal, native)
            )
          },
          /** Capture application data before embedding or native backend admission can await. */
          async set<T extends ICodecValue>(
            this: IStoragePluginCallContext,
            prompt: string,
            value: T,
            options?: { readonly payload?: ISemanticPayload; readonly ctx?: IOperationContext }
          ) {
            if (typeof prompt !== 'string') throw invalidArgument()
            const { payload, ctx } = options ?? {}
            const selected = snapshotPayload(payload)
            const encoded = encodeValue(value)
            return runSemanticOperation(state, this, ctx, (signal, native) =>
              writeSemanticPoint(
                state,
                this,
                prompt,
                encoded,
                selected,
                state.configuration.ttlMs,
                signal,
                native
              )
            )
          },
          /** Misses share only loading/write policy; each caller retains its own read decision. */
          async getOrLoad<T extends ICodecValue>(
            this: IStoragePluginCallContext,
            prompt: string,
            load: (signal: AbortSignal) => Promise<T>,
            options?: ISemanticLoadOptions<T>
          ) {
            return getOrLoadSemanticValue(state, this, prompt, load, options)
          },
          /** Native deletion receives the exact original context and remains the sole count owner. */
          async invalidate(
            this: IStoragePluginCallContext,
            where: IWhere<ISemanticPayload>,
            ctx?: IOperationContext & { readonly count?: DeleteCountMode }
          ) {
            const selected = snapshotWhere(where)!
            return runSemanticOperation(state, this, undefined, () =>
              semanticCollection(state, this).deleteWhere(selected, ctx)
            )
          }
        }
      }
    }
  }
}

/** Installs semantic policy through the original Feature registration and borrowed native backend. */
export function semanticCacheFeature(options: ISemanticCacheOptions) {
  const captured = snapshotSemanticConfiguration(options)
  return defineFeature<
    typeof cacheBackendKind,
    {},
    IStorageFeatureOutput<
      readonly [],
      {},
      {
        readonly store: { readonly semantic: ISemanticCacheApi }
        readonly transaction: {}
      }
    >
  >(cacheBackendKind, ({ featureExpose: core }) =>
    createSemanticFeatureOutput(createSemanticContext(core, captured))
  )
}
