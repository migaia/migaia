import { isStorageErrorFamily } from '../core/error-family.ts'
import { isPlainObject } from '@migaia/utils/object'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { repositoryMigrationKey } from '../core/record-layout.ts'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStorageKey,
  QueryOperation,
  type IQueryCondition,
  type IRecordQuerySource,
  type IStorageIterator,
  type IRecordQueryBase,
  type IQueryResult,
  isStorageContractError,
  type ISecondaryIndexRecordStore
} from '@migaia/storage-contract'
import { compareStorageKeys, encodeOrderedStorageKey } from '../authoring/key.ts'
import { createRecordQueryWithoutKeyset } from '../authoring/query.ts'

import { StorageError, createStorageTypeError, createStorageAggregateError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { indexBackfillFailureText, StorageErrorText } from '../error-text.ts'

import { composeRepositoryKey, decodeRepositoryKey, repositoryEntityRange } from './key.ts'
import { encodeFlatStorageKey, snapshotKeyRange } from '../core/key-domain.ts'

import { createStorageOperationRuntime } from '../core/operation-reporter.ts'
import { EntityText } from './text.ts'
import { createEntityQuery } from './query-adapter.ts'
import { snapshotOperationContext } from '../authoring/context.ts'
import type { IOperationContext, IStorageKey } from '@migaia/storage-contract'

import type { IIndexedListOptions, IInvalidRecordIssue, IRepository } from './types.ts'
import {
  projectEntityIndexes,
  chooseEntityQueryIndex,
  supportsEntityIndexCondition,
  ENTITY_QUERY_INDEX_OPERATORS
} from './index-projection.ts'
import { createOrderedRecordIndex } from '../core/ordered-record-index.ts'
import { safeJsonPayloadByteLength } from '../core/json.ts'
import {
  asRecordIndexBackfillStore,
  RecordIndexBackfillPhase,
  isBackfillContentionFailure,
  type IRecordIndexBackfillPreparation,
  type IRecordIndexBackfillSession,
  type IRecordIndexBackfillCandidate
} from './backfill.ts'
import {
  EntityState,
  StorageMigrationStatus,
  StorageInvalidRecordAction,
  StorageOperation,
  StorageRecordStage
} from './constants.ts'
import {
  entityIterator,
  IListSnapshot,
  IStageFailure,
  minimumProjectedIndexKey,
  IRepositoryReadView,
  validateListOptions,
  idOf,
  IIndexedListSnapshot,
  IMatch,
  IEntityQuerySourceContext
} from './repository-shared.ts'

import type { EntityRepositoryOwner } from './repository.ts'

/** Own only the explicitly assembled indexes operations; the repository retains storage state. */
export class EntityIndexesOwner<
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {},
  TChangeFeed extends boolean = false
> {
  /** Project declared indexes using their single canonical owner during a native commit. */
  projectAllIndexes = (value: TDomain) =>
    projectEntityIndexes(this.#context.config.indexes, value, this.#context.store.backend)
  /** Borrow the original repository state and operations without another executor. */
  readonly #context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  /** Capture the original owner before this feature publishes any methods. */
  constructor(
    context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  ) {
    this.#context = context
  }

  /** Reuse the original repository operation through its explicit owner context. */
  backfillIndexes = async (ctx?: IOperationContext): Promise<void> => {
    const capability = asRecordIndexBackfillStore<unknown>(this.#context.store)
    const definitions = Object.values(this.#context.config.indexes).map((index) => index.definition)
    if (capability === undefined || definitions.length === 0) return
    const handle = await capability.ensureRecordIndexes(this.#context.name, definitions, ctx)
    const readiness = await capability.getRecordIndexReadiness(handle, ctx)
    if (readiness.status === 'complete') return
    const migrationState = (await this.#context.recordStore?.metadata?.get(
      repositoryMigrationKey(this.#context.name),
      ctx
    )) as { readonly status?: unknown; readonly schemaFingerprint?: unknown } | undefined
    const allowComplete =
      migrationState?.status === StorageMigrationStatus.complete &&
      migrationState.schemaFingerprint === this.#context.migrationFingerprint
    /** This owner updates completion permission only after observing the entire clean scan. */
    const backfillOptions = {
      range: repositoryEntityRange(this.#context.name),
      // Legacy keys can contain arbitrarily nested valid array IDs; the backend scans bounded
      // pages and this preparation classifies entity ownership without a lossy prefix range.
      legacyRange: undefined,
      includeLegacy: true,
      allowComplete
    }
    let session = await capability.openBackfillSession(handle, backfillOptions, ctx)
    let sessionReleased = false
    /** Undefined precedes the first batch; resumed scans cannot prove earlier records were clean. */
    let canonicalOnlyScan: boolean | undefined
    try {
      let finished = false
      while (!finished) {
        await session.renew(ctx)
        const batch = await session.readBatch(ctx, {
          prepare: (candidate) => this.prepareEntityBackfillCandidate(session, ctx, candidate)
        })
        if (
          batch.preparations === undefined ||
          batch.preparations.length !== batch.candidates.length
        )
          throw new StorageError(StorageHostErrorCode.invalidConfig, {
            backend: this.#context.store.backend
          })
        if (canonicalOnlyScan === undefined)
          canonicalOnlyScan =
            (batch.phase ?? RecordIndexBackfillPhase.canonical) ===
              RecordIndexBackfillPhase.canonical && batch.checkpoint === undefined
        canonicalOnlyScan &&= batch.preparations.every(
          (preparation) =>
            preparation.legacy !== true &&
            (preparation.counted === false || preparation.outcome !== 'skipped')
        )
        const projections = batch.candidates.map((candidate, index) => {
          const preparation = batch.preparations![index]!
          return {
            key: candidate.key,
            expectedRevision: candidate.revision,
            outcome: preparation.outcome,
            projection: preparation.projection,
            counted: preparation.counted
          }
        })
        const nextCheckpoint = batch.candidates.at(-1)?.key
        finished =
          (batch.phase ?? RecordIndexBackfillPhase.canonical) === RecordIndexBackfillPhase.legacy &&
          batch.endOfScan
        backfillOptions.allowComplete =
          allowComplete || (migrationState === undefined && finished && canonicalOnlyScan)
        await session.renew(ctx)
        await session.commitBatch(
          {
            phase: batch.phase ?? RecordIndexBackfillPhase.canonical,
            generation: session.generation,
            ownerToken: session.ownerToken,
            checkpoint: batch.checkpoint,
            nextCheckpoint,
            endOfScan: batch.endOfScan,
            projections
          },
          ctx
        )
        if (!finished) {
          session.release()
          sessionReleased = true
          session = await capability.openBackfillSession(handle, backfillOptions, ctx)
          sessionReleased = false
        }
      }
    } catch (cause) {
      if (isStorageContractError(cause) && cause.code === StorageContractErrorCode.aborted)
        throw cause
      if (sessionReleased) throw cause
      try {
        await session.fail(cause, ctx)
      } catch (persistFailure) {
        throw createStorageAggregateError(
          StorageHostErrorCode.indexBackfillFailed,
          indexBackfillFailureText(this.#context.name),
          [cause, persistFailure]
        )
      }
      throw cause
    } finally {
      session.release()
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  snapshotIndexedListOptions = (
    options:
      | IListSnapshot<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IIndexedListSnapshot<TDomain> | undefined => {
    validateListOptions(options, this.#context.store.backend)
    if (options === undefined) return undefined
    let index: unknown
    let range: IListSnapshot<TDomain>['range']
    let limit: IListSnapshot<TDomain>['limit']
    let orderBy: IListSnapshot<TDomain>['orderBy']
    let direction: IListSnapshot<TDomain>['direction']
    let onInvalid: IListSnapshot<TDomain>['onInvalid']
    index = (options as { readonly index?: unknown }).index
    if (index === undefined) return undefined
    range = options.range
    limit = options.limit
    orderBy = options.orderBy
    direction = options.direction
    onInvalid = options.onInvalid

    if (typeof index !== 'string' || index.length === 0)
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.indexedListIndexMustBeANonEmptyString)
      })
    const normalized = this.#context.normalizeListOptions({
      range,
      limit,
      orderBy,
      direction,
      onInvalid
    })
    return { index, range: normalized?.range, options: normalized }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  createIndexedListSnapshot = (
    index: string,
    range: IListSnapshot<TDomain>['range'],
    options:
      | IListSnapshot<TDomain>
      | IIndexedListOptions<TDomain, Readonly<Record<string, IStorageKey>>>
      | undefined
  ): IIndexedListSnapshot<TDomain> => {
    const normalized = this.#context.normalizeListOptions(options)
    const rangeSnapshot = snapshotKeyRange(range, this.#context.store.backend)
    return { index, range: rangeSnapshot, options: normalized }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  encodeIndexOrder = (key: IStorageKey, id: IStorageKey): Uint8Array => {
    const index = encodeOrderedStorageKey(key, this.#context.store.backend)
    const primary = encodeOrderedStorageKey(id, this.#context.store.backend)
    const encoded = new Uint8Array(index.byteLength + primary.byteLength)
    encoded.set(index)
    encoded.set(primary, index.byteLength)
    return encoded
  }
  /** Reuse the original repository operation through its explicit owner context. */
  indexRows = (
    snapshot: IIndexedListSnapshot<TDomain>,
    ctx: IOperationContext | undefined,
    readView?: IRepositoryReadView,
    orderedSource = true,
    onRead?: () => void,
    requireNative = false
  ): IStorageIterator<readonly [IStorageKey, IMatch<TDomain>]> => {
    const index = this.#context.config.indexes[snapshot.index]
    if (index === undefined)
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.indexMissing(this.#context.name, snapshot.index))
      })
    const runtime = readView?.runtime ?? createStorageOperationRuntime()
    return entityIterator(
      (async function* (
        repositoryOwner: EntityRepositoryOwner<
          TDomain,
          TStored,
          TIndexes,
          TAugmentMethods,
          TChangeFeed
        >
      ) {
        if (snapshot.options?.limit === 0) return
        const seen = new Set<string>()
        const ordered = createOrderedRecordIndex<IMatch<TDomain>>()
        const match = (value: TDomain): IMatch<TDomain> | undefined => {
          const id = idOf(
            repositoryOwner.name,
            repositoryOwner.keyProp,
            value,
            repositoryOwner.store.backend
          )
          const identity = encodeFlatStorageKey(id)
          if (seen.has(identity)) return
          const projection = index.project(value, repositoryOwner.store.backend)
          const first = minimumProjectedIndexKey(projection, snapshot.range)
          if (first === undefined) return
          seen.add(identity)
          return { id, key: first, value }
        }
        try {
          if (readView === undefined) {
            const capability = asRecordIndexBackfillStore<unknown>(repositoryOwner.store)
            if (capability !== undefined) {
              /** Only current native readiness can admit a cursor after preparation or a failure. */
              repositoryOwner.readyHandle = undefined
              try {
                await repositoryOwner.backfillIndexes(ctx)
                const handle = await capability.ensureRecordIndexes(
                  repositoryOwner.name,
                  Object.values(repositoryOwner.config.indexes).map((item) => item.definition),
                  ctx
                )
                if ((await capability.getRecordIndexReadiness(handle, ctx)).status === 'complete')
                  repositoryOwner.readyHandle = handle
              } catch (cause) {
                if (!isBackfillContentionFailure(cause)) throw cause
              }
            }
          }
          /** Native index admission retains its original lazy position after source preparation. */
          const secondaryStore =
            readView === undefined && repositoryOwner.recordStore !== undefined
              ? repositoryOwner.backend.secondaryStore()
              : undefined
          const native =
            readView === undefined
              ? secondaryStore !== undefined
                ? (query: Parameters<ISecondaryIndexRecordStore['iterateRecordIndex']>[0]) =>
                    secondaryStore.iterateRecordIndex(query, ctx)
                : undefined
              : readView.iterateRecordIndex
          /** Bound operations carry only readiness proved by their own current native scope. */
          const selectedHandle =
            readView === undefined ? repositoryOwner.readyHandle : readView.readyHandle
          if (selectedHandle !== undefined && native !== undefined) {
            for await (const [physical, raw] of native({
              handle: selectedHandle,
              index: snapshot.index,
              range: snapshot.range,
              direction: snapshot.options?.direction
            })) {
              onRead?.()
              let current: IMatch<TDomain> | undefined
              try {
                const value = await repositoryOwner.materialize(
                  await repositoryOwner.decodeEnvelope(raw, ctx, runtime),
                  ctx,
                  runtime
                )
                if (value !== undefined) current = match(value)
              } catch (cause) {
                const issue: IInvalidRecordIssue<TDomain> = {
                  key: physical,
                  raw,
                  stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.validate,
                  cause
                }
                if (
                  repositoryOwner.invalidAction(issue, snapshot.options) ===
                  StorageInvalidRecordAction.throw
                )
                  repositoryOwner.throwInvalid(issue)
                repositoryOwner.emitDiagnostic(
                  EntityText.invalidRecord(repositoryOwner.name, physical)
                )
              }
              if (current !== undefined) {
                if (!orderedSource) yield [current.id, current] as const
                else ordered.set(repositoryOwner.encodeIndexOrder(current.key, current.id), current)
              }
            }
          } else {
            if (requireNative)
              throw new StorageContractError(StorageContractErrorCode.queryNotPushable)
            repositoryOwner.emitDiagnostic(
              EntityText.indexFallback(repositoryOwner.name, snapshot.index)
            )
            let projected: IMatch<TDomain> | undefined
            for await (const _value of repositoryOwner.streamImpl(
              { onInvalid: snapshot.options?.onInvalid },
              ctx,
              runtime,
              false,
              readView,
              onRead,
              (value) => {
                projected = match(value)
              }
            )) {
              const current = projected
              if (current === undefined) continue
              if (!orderedSource) yield [current.id, current] as const
              else ordered.set(repositoryOwner.encodeIndexOrder(current.key, current.id), current)
            }
          }
          for (
            let item = snapshot.options?.direction === 'prev' ? ordered.last : ordered.first;
            item !== undefined;
            item = snapshot.options?.direction === 'prev' ? item.previous : item.next
          )
            yield [item.value.id, item.value] as const
        } finally {
          ordered.clear()
          seen.clear()
        }
      })(this.#context),
      runtime
    )
  }
  /** Reuse the original repository operation through its explicit owner context. */
  createIndexQuery = (
    snapshot: IIndexedListSnapshot<TDomain>,
    ctx: IOperationContext | undefined,
    readView?: IRepositoryReadView,
    onRead?: () => void
  ): IQueryResult<TDomain, IOperationContext> => {
    ctx = snapshotOperationContext(ctx)
    const index = this.#context.config.indexes[snapshot.index]
    if (index === undefined)
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.indexMissing(this.#context.name, snapshot.index))
      })
    const comparator = snapshot.options?.orderBy ?? this.#context.defaultOrderBy
    if (comparator !== undefined && snapshot.options?.limit === undefined)
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.comparatorLimit)
      })
    const source = createRecordQueryWithoutKeyset<IMatch<TDomain>>({
      asyncDisposeKey,
      pushdown: { source: EntityState.querySource, operations: [], operators: [] },
      execute: () => this.indexRows(snapshot, ctx, readView, comparator === undefined, onRead)
    })
    let query: IRecordQueryBase<IMatch<TDomain>, IOperationContext> = source
    if (comparator !== undefined)
      query = source
        .orderByComparator((left, right) => {
          try {
            const compared = comparator(left.value, right.value)
            if (!Number.isFinite(compared))
              throw createStorageTypeError(
                StorageHostErrorCode.extensionFailed,
                StorageErrorText.entityComparatorInvalid
              )
            const tie =
              compareStorageKeys(left.key, right.key) || compareStorageKeys(left.id, right.id)
            const result = compared || tie
            return snapshot.options?.direction === 'prev' ? -result : result
          } catch (cause) {
            throw new StorageError(StorageHostErrorCode.extensionFailed, {
              backend: this.#context.store.backend,
              cause,
              operation: StorageOperation.entityOrderBy,
              extensionStage: 'comparator'
            })
          }
        })
        .limit(snapshot.options!.limit!)
    else if (snapshot.options?.limit !== undefined) query = source.limit(snapshot.options.limit)
    return query.select((match) => match.value)
  }
  /** Reuse the original repository operation through its explicit owner context. */
  queryIndex: Parameters<
    typeof createEntityQuery<TDomain, TIndexes, IOperationContext, TAugmentMethods>
  >[0]['index'] = (index, match) => {
    const range =
      match === undefined
        ? undefined
        : isPlainObject(match) && ('lower' in match || 'upper' in match)
          ? match
          : { lower: match, upper: match }
    const snapshot = this.createIndexedListSnapshot(
      index,
      range as import('@migaia/storage-contract').IKeyRange | undefined,
      undefined
    )
    if (this.#context.config.indexes[index] === undefined)
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.indexMissing(this.#context.name, index))
      })
    return { index, range: snapshot.range }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  planEntitySource = (
    sourceContext: IEntityQuerySourceContext<TDomain>,
    conditions: Parameters<NonNullable<IRecordQuerySource['plan']>>[0]
  ): ReturnType<NonNullable<IRecordQuerySource['plan']>> => {
    /** Explicit source choice precedes automatic static condition selection. */
    const explicit =
      sourceContext.selection.index !== undefined || sourceContext.selection.range !== undefined
    const automatic = explicit
      ? undefined
      : chooseEntityQueryIndex(
          this.#context.config.indexes,
          conditions,
          this.#context.store.backend
        )
    const selection = { ...(automatic?.selection ?? sourceContext.selection) }
    const index =
      selection.index === undefined ? undefined : this.#context.config.indexes[selection.index]
    /** Physical native admission and private preparation share the same resolved backend owner. */
    const native =
      index !== undefined &&
      this.#context.backend.secondaryStore() !== undefined &&
      asRecordIndexBackfillStore(this.#context.store) !== undefined &&
      (sourceContext.execution.scope === undefined || this.#context.readyHandle !== undefined)
    return {
      ...(native ? {} : { fullScan: true }),
      selection,
      pushdown: {
        source: EntityState.querySource,
        ...(selection.index === undefined ? {} : { index: selection.index }),
        operations: index === undefined ? [] : [QueryOperation.where],
        operators: index === undefined ? [] : ENTITY_QUERY_INDEX_OPERATORS,
        ...(index === undefined
          ? {}
          : {
              canPushCondition: (condition: IQueryCondition) =>
                supportsEntityIndexCondition(this.#context.config.indexes, condition)
            })
      },
      sourceReason: explicit ? EntityText.queryIndexExplicit : automatic!.sourceReason,
      sourceCandidates: explicit
        ? Object.keys(this.#context.config.indexes).map((index) => ({
            index,
            reason: EntityText.queryIndexExplicit
          }))
        : automatic!.sourceCandidates
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  apiFindBy: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['findBy'] = async (
    index,
    key,
    ctx
  ) => {
    assertStorageKey(key, this.#context.store.backend, `entity "${this.#context.name}" index query`)
    const context = snapshotOperationContext(ctx)
    const snapshot = this.createIndexedListSnapshot(index, { lower: key, upper: key }, undefined)
    let matched = 0
    const runtime = createStorageOperationRuntime()
    /** One source scan caps its diagnostic count while the original heap retains one result. */
    const source = createRecordQueryWithoutKeyset<IMatch<TDomain>>({
      asyncDisposeKey,
      pushdown: { source: EntityState.querySource, operations: [], operators: [] },
      execute: () =>
        entityIterator(
          (async function* (
            repositoryOwner: EntityRepositoryOwner<
              TDomain,
              TStored,
              TIndexes,
              TAugmentMethods,
              TChangeFeed
            >
          ) {
            for await (const row of repositoryOwner.indexRows(
              snapshot,
              context,
              undefined,
              false
            )) {
              if (matched < 2) matched++
              yield row
            }
          })(this.#context),
          runtime
        )
    })
    const [best] = await source
      .orderByComparator((left, right) => {
        let compared = 0
        if (this.#context.defaultOrderBy !== undefined) {
          try {
            /** A user comparator remains an ordinary function invocation. */
            const compare = this.#context.defaultOrderBy
            compared = compare(left.value, right.value)
            if (!Number.isFinite(compared)) {
              void Promise.resolve(compared).catch(runtime.reporter)
              throw new TypeError(StorageErrorText.entityComparatorInvalid)
            }
          } catch (cause) {
            throw new StorageError(StorageHostErrorCode.extensionFailed, {
              backend: this.#context.store.backend,
              cause,
              operation: StorageOperation.entityOrderBy,
              extensionStage: 'comparator'
            })
          }
        }
        return (
          compared ||
          compareStorageKeys(left.key, right.key) ||
          compareStorageKeys(left.id, right.id)
        )
      })
      .limit(1)
      .all(context)
    const definition = this.#context.config.indexes[index]?.definition
    if (definition !== undefined && !definition.unique && matched === 2)
      this.#context.emitDiagnostic(
        EntityText.storageWebEntityFindByOnNonUniqueIndexReturnedTheFirst(this.#context.name, index)
      )
    return best?.value
  }
  /** Reuse the original repository operation through its explicit owner context. */
  prepareEntityBackfillCandidate = async (
    session: IRecordIndexBackfillSession<unknown>,
    ctx: IOperationContext | undefined,
    candidate: IRecordIndexBackfillCandidate<unknown>
  ): Promise<IRecordIndexBackfillPreparation> => {
    await session.renew(ctx)
    const runtime = createStorageOperationRuntime()
    let domain: TDomain | undefined
    /** Legacy ownership is observed before a canonical shadow can make the candidate uncounted. */
    let legacy: true | undefined
    try {
      if (candidate.phase === RecordIndexBackfillPhase.legacy) {
        const canonicalId = decodeRepositoryKey(this.#context.name, candidate.key)
        const legacyId =
          Array.isArray(candidate.key) &&
          candidate.key.length === 2 &&
          candidate.key[0] === this.#context.name &&
          (typeof candidate.key[1] === 'string' || Array.isArray(candidate.key[1]))
            ? (candidate.key[1] as IStorageKey)
            : undefined
        if (canonicalId === undefined && legacyId === undefined)
          return { decodedBytes: 0, outcome: 'skipped', counted: false }
        if (canonicalId !== undefined)
          return { decodedBytes: 0, outcome: 'skipped', counted: false }
        if (legacyId !== undefined) {
          legacy = true
          const id = legacyId
          const canonicalRaw = await this.#context.recordStore!.getRecord(
            composeRepositoryKey(this.#context.name, id),
            ctx
          )
          if (canonicalRaw !== undefined)
            return { decodedBytes: 0, outcome: 'skipped', counted: false, legacy }
        }
      }
      const envelope = await this.#context.decodeEnvelope(candidate.raw, ctx, runtime)
      domain = await this.#context.materialize(envelope, ctx, runtime)
    } catch (cause) {
      /** Missing assembly cannot be persisted as a skipped invalid business record. */
      if (isStorageErrorFamily(cause) && cause.code === StorageHostErrorCode.entityFeatureRequired)
        throw cause
      this.#context.emitDiagnostic(
        EntityText.storageWebEntitySkippedInvalidIndexBackfillRecord(
          this.#context.name,
          String(candidate.key),
          String(cause)
        )
      )
      return { decodedBytes: 0, outcome: 'skipped', legacy }
    }
    return {
      decodedBytes: safeJsonPayloadByteLength(domain),
      legacy,
      outcome: domain === undefined ? 'skipped' : 'indexed',
      projection:
        domain === undefined
          ? undefined
          : projectEntityIndexes(this.#context.config.indexes, domain, this.#context.store.backend)
    }
  }
}
