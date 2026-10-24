import {
  defineFeature,
  StorageError,
  type IStorageFeatureOutput,
  type IStoragePluginCallContext
} from '@migaia/storage-host'
import {
  vector,
  ttl,
  snapshotStorageVectorCollection,
  snapshotStorageVector,
  snapshotStorageWhere,
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
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import type { ICodecValue } from '@migaia/serialize/codec'
import { raceWithAbort, UtilsAbortError } from '@migaia/utils/promise'
import { tryReadProperty } from '@migaia/utils/error'
import {
  withAbort,
  throwIfAborted,
  readAbortReason,
  createStorageOperationReporter,
  reportCleanupError,
  type IBackendChangeController
} from '@migaia/storage-host/authoring/backend'
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

/** Getter failures at the public semantic boundary retain their original cause under admission. */
function captureInput<T>(read: () => T): T {
  try {
    return read()
  } catch (cause) {
    if (isStorageContractError(cause)) throw cause
    throw invalidArgument(cause)
  }
}
/** Own only semantic scalar admission; portable encoding and normalized hashing remain canonical. */
function snapshotPayload(input: ISemanticPayload | undefined): ISemanticPayload {
  if (input === undefined) return Object.freeze({})
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalidArgument()
    /** Detached own scalar fields also preserve otherwise-special names such as **proto**. */
    const result = Object.fromEntries(
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
    return Object.freeze(result)
  } catch (cause) {
    if (isStorageContractError(cause)) throw cause
    throw invalidArgument(cause)
  }
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
/** Native cloning detaches scalar filter metadata; the original compiler still owns every operator. */
function snapshotWhere(
  where: IWhere<ISemanticPayload> | undefined
): IWhere<ISemanticPayload> | undefined {
  if (where === undefined) return undefined
  try {
    /** Native cloning reads user accessors before any embedding or backend await. */
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

/** Install semantic metadata and native vector calls on the original cache kind only. */
export function semanticCacheFeature(options: ISemanticCacheOptions) {
  /** Capture known options once; subsequent caller mutation never changes this installed policy. */
  let captured: ISemanticCacheOptions & IStorageVectorConfiguration
  try {
    const { backend, collection, dimensions, metric, minScore, ttlMs, embed } = options
    /** The vector owner validates both installed dimensions and metric without schema inference. */
    const configuration = snapshotStorageVectorCollection(
      collection,
      { dimensions, metric: metric ?? 'cosine' },
      CacheText.backend
    )
    if (typeof backend !== 'string' || typeof embed !== 'function' || !Number.isFinite(minScore))
      throw invalidArgument()
    if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, CacheText.backend)
    captured = Object.freeze({
      backend,
      collection: configuration.name,
      ...configuration.options!,
      minScore,
      ttlMs,
      embed
    })
  } catch (cause) {
    if (isStorageContractError(cause)) throw cause
    throw invalidArgument(cause)
  }
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
  >(cacheBackendKind, ({ featureExpose: core }) => {
    /** Borrow once in the installation window; the host later projects this exact store per org. */
    const borrowed = core.getPublishedBackend(captured.backend)
    if (!borrowed.has(vector)) missingCapability(-1, vector.name)
    if (captured.ttlMs !== undefined && !borrowed.has(ttl)) missingCapability(-1, ttl.name)
    /** Descriptors validate actual configured collections without opening an independent resource. */
    borrowed.use(vector).collection(captured.collection, captured)
    /** Only pending shared loads occupy this Feature's explicit singleflight table. */
    const flights = new Map<string, Promise<ISemanticLoaded<ICodecValue>>>()
    /** Diagnostics retain original errors independently from sanitized lazy hook payloads. */
    const reporter = createStorageOperationReporter()
    core.onDispose(() => {
      flights.clear()
    })
    /**
     * Feature construction can precede store publication, so the original controller is read
     * lazily.
     */
    const controller = (): IBackendChangeController => {
      /** The host remains the sole authority for this installed backend's current controller. */
      const current = core.getChangeController()
      if (current === undefined) missingCapability(-1, 'lifecycle')
      return current
    }
    /** Per-org targets remain genuine borrowed APIs and never acquire a backend's closing authority. */
    const collectionFor = (
      context: IStoragePluginCallContext
    ): IVectorCollection<ISemanticPayload> =>
      context
        .backend(borrowed)
        .use(vector)
        .collection<ISemanticPayload>(captured.collection, captured)
    /** Every swallowed backend or callback error reaches the original diagnostic boundary and hook. */
    const report = (
      context: IStoragePluginCallContext,
      operation: string,
      error: unknown
    ): void => {
      reportCleanupError(reporter, error)
      core.emit(CacheHook.tierError, () => {
        /** A hostile diagnostic property cannot replace the original reported backend failure. */
        const code =
          typeof error === 'object' && error !== null
            ? tryReadProperty(error as { readonly code?: unknown }, 'code')
            : undefined
        return {
          backendId: core.getBackendId(),
          backend: CacheText.backend,
          orgId: context.orgId,
          tier: -1,
          operation,
          ...(code !== undefined && !code.threw && typeof code.value === 'string'
            ? { code: code.value }
            : {})
        }
      })
    }
    /** Invalid arguments, cancellation and genuine host admission errors never become a cache miss. */
    const tierFailure = (
      context: IStoragePluginCallContext,
      operation: string,
      cause: unknown
    ): void => {
      if (isStorageContractError(cause) || cause instanceof StorageError) throw cause
      report(context, operation, cause)
    }
    /** Original utility signal composition and original controller leases own all accepted work. */
    const run = <R>(
      context: IStoragePluginCallContext,
      ctx: IOperationContext | undefined,
      work: (
        signal: AbortSignal,
        native: IOperationContext,
        owner: IBackendChangeController
      ) => Promise<R>
    ): Promise<R> => {
      /** Every call borrows admission and draining from the same original cache controller. */
      const owner = controller()
      owner.assertLive()
      return withAbort(ctx, async (caller, snapshot) => {
        if (snapshot?.orgId !== undefined && snapshot.orgId !== context.orgId)
          throw invalidArgument()
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
              report: (error) => reportCleanupError(reporter, error)
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
    const embed = async (prompt: string, signal: AbortSignal): Promise<readonly number[]> => {
      /** Only the callback produces vectors; canonical admission owns dimension and metric checks. */
      let direction: readonly number[]
      try {
        direction = await captured.embed(prompt, signal)
      } catch (cause) {
        throwIfAborted(signal)
        throw cacheError(CacheErrorCode.embedFailed, cause)
      }
      throwIfAborted(signal)
      return snapshotStorageVector(direction, captured, CacheText.backend)
    }
    /** Read bounded native candidates, decode original values, then apply the caller's acceptance. */
    const read = async <T extends ICodecValue>(
      context: IStoragePluginCallContext,
      prompt: string,
      options: ISemanticGetOptions<T>,
      signal: AbortSignal,
      native: IOperationContext
    ): Promise<ISemanticHit<T> | undefined> => {
      /** The engine receives the original embedder's canonically detached components. */
      const direction = await embed(prompt, signal)
      /** Only bounded native hits cross into decode and acceptance, never a collection full scan. */
      let hits
      try {
        /** The original immutable vector builder owns all native ranking and filter planning. */
        let query = collectionFor(context).near(direction)
        if (options.where !== undefined) query = query.where(options.where)
        hits = await query.minScore(options.minScore!).topK(options.candidates!).all(native)
      } catch (cause) {
        tierFailure(context, CacheOperation.get, cause)
        return undefined
      }
      for (const item of [...hits].sort((a, b) => b.score - a.score)) {
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
          hit = Object.freeze({
            value: valueCodec.decode(encoded) as T,
            score: item.score,
            prompt: originalPrompt
          })
        } catch (cause) {
          report(context, CacheOperation.decode, cause)
          continue
        }
        if (options.accept === undefined) return hit
        try {
          if ((await options.accept(hit)) === true) return hit
        } catch (cause) {
          report(context, SemanticOperation.accept, cause)
        }
        throwIfAborted(signal)
      }
      return undefined
    }
    /** Point identity and value encoding use existing owners; the vector backend alone owns TTL. */
    const write = async (
      context: IStoragePluginCallContext,
      prompt: string,
      value: string,
      payload: ISemanticPayload,
      ttlMs: number | undefined,
      signal: AbortSignal,
      native: IOperationContext
    ): Promise<void> => {
      /** Canonical portable hashing gives field-order-equivalent model metadata one point identity. */
      const id = await cacheKey(prompt, payload)
      /** No point mutation starts until the embedding is complete and dimensionally valid. */
      const direction = await embed(prompt, signal)
      try {
        await collectionFor(context).upsert(
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
        tierFailure(context, CacheOperation.set, cause)
      }
    }
    /** Call options detach only semantic metadata; the existing context owner captures budgets. */
    const getOptions = <T>(
      prompt: string,
      options: ISemanticGetOptions<T> | undefined
    ): ISemanticGetOptions<T> =>
      captureInput(() => {
        if (typeof prompt !== 'string') throw invalidArgument()
        const { where, minScore = captured.minScore, candidates = 1, accept, ctx } = options ?? {}
        if (
          !Number.isFinite(minScore) ||
          !Number.isSafeInteger(candidates) ||
          candidates < 1 ||
          candidates > 10 ||
          (accept !== undefined && typeof accept !== 'function')
        )
          throw invalidArgument()
        return { where: snapshotWhere(where), minScore, candidates, accept, ctx }
      })
    return {
      capabilities: [] as const,
      chain: {},
      api: {
        transaction: {},
        store: {
          semantic: {
            /** Native vector queries retain this call's filter and acceptance policy. */
            async get<T extends ICodecValue>(prompt: string, options?: ISemanticGetOptions<T>) {
              /** Detach the caller's query policy before any asynchronous operation. */
              const selected = getOptions(prompt, options)
              return run(this, selected.ctx, (signal, native) =>
                read(this, prompt, selected, signal, native)
              )
            },
            /** Write one semantic point through the borrowed backend and its own TTL owner. */
            async set<T extends ICodecValue>(
              prompt: string,
              value: T,
              options?: { readonly payload?: ISemanticPayload; readonly ctx?: IOperationContext }
            ) {
              if (typeof prompt !== 'string') throw invalidArgument()
              const { payload, ctx } = captureInput(() => {
                const { payload, ctx } = options ?? {}
                return { payload, ctx }
              })
              /** User fields are validated before the original value codec or embedder runs. */
              const selected = snapshotPayload(payload)
              /**
               * Encoding happens before awaits so later application mutation cannot alter the
               * point.
               */
              const encoded = encodeValue(value)
              return run(this, ctx, (signal, native) =>
                write(this, prompt, encoded, selected, captured.ttlMs, signal, native)
              )
            },
            /** Misses share only the loader/write result, while reads remain per-caller decisions. */
            async getOrLoad<T extends ICodecValue>(
              prompt: string,
              load: (signal: AbortSignal) => Promise<T>,
              options?: ISemanticGetOptions<T> & {
                readonly payload?: ISemanticPayload
                readonly ttlMs?: number
                readonly cacheIf?: (value: T) => boolean
              }
            ) {
              /** Each caller keeps its own filter, acceptance callback and cancellation budget. */
              const selected = getOptions(prompt, options)
              const {
                payload,
                ttlMs = captured.ttlMs,
                cacheIf
              } = captureInput(() => {
                const { payload, ttlMs, cacheIf } = options ?? {}
                return { payload, ttlMs, cacheIf }
              })
              if (
                typeof load !== 'function' ||
                (cacheIf !== undefined && typeof cacheIf !== 'function')
              )
                throw invalidArgument()
              if (ttlMs !== undefined) {
                assertStorageTtlDuration(ttlMs, CacheText.backend)
                if (captured.ttlMs !== undefined && ttlMs > captured.ttlMs)
                  throw cacheError(CacheErrorCode.tierInvalid, undefined, -1)
              }
              /** The same detached fields define both shared-load and eventual physical identity. */
              const metadata = snapshotPayload(payload)
              return run(this, selected.ctx, async (signal, native, owner) => {
                /** A caller that accepts a native hit never participates in shared loading. */
                const hit = await read(this, prompt, selected, signal, native)
                if (hit !== undefined) return hit
                /** Logical organizations never join each other's in-process loaders. */
                const key = await cacheKey(this.orgId, prompt, metadata)
                throwIfAborted(signal)
                /** Keep exactly one pending load per canonical semantic identity. */
                let pending = flights.get(key)
                if (pending === undefined) {
                  /** Closing is the sole shared cancellation owner; individual ctx signals stay out. */
                  const sharedSignal = owner.closingSignal as AbortSignal
                  /** The first admitted loader owns this shared result's write policy. */
                  const shared = (async (): Promise<ISemanticLoaded<T>> => {
                    /** Preserve the actual callback value for all joiners without a second codec. */
                    let value: T
                    try {
                      value = await load(sharedSignal)
                    } catch (cause) {
                      throwIfAborted(sharedSignal)
                      throw cacheError(CacheErrorCode.loadFailed, cause)
                    }
                    throwIfAborted(sharedSignal)
                    /** A declined result is still returned identically to every joined caller. */
                    let cache = true
                    try {
                      cache = cacheIf === undefined || cacheIf(value) !== false
                    } catch (cause) {
                      throw cacheError(CacheErrorCode.loadFailed, cause)
                    }
                    if (cache)
                      await write(this, prompt, encodeValue(value), metadata, ttlMs, sharedSignal, {
                        signal: sharedSignal
                      })
                    return Object.freeze({ value, score: undefined, prompt })
                  })()
                  pending = shared.finally(() => {
                    if (flights.get(key) === pending) flights.delete(key)
                  })
                  flights.set(key, pending)
                }
                return (await pending) as ISemanticLoaded<T>
              })
            },
            /** Delegate physical deletion and numeric count semantics exactly once to the backend. */
            async invalidate(
              where: IWhere<ISemanticPayload>,
              ctx?: IOperationContext & { readonly count?: DeleteCountMode }
            ) {
              /** Only reserved-field admission detaches the original declarative condition. */
              const selected = snapshotWhere(where)!
              /** The native endpoint alone captures this exact context and its original budget. */
              return run(this, undefined, () => collectionFor(this).deleteWhere(selected, ctx))
            }
          }
        }
      }
    }
  })
}
