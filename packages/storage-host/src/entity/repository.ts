import { EntityFeatureName } from './constants.js'
import {
  getBackendEnvelopeStages,
  getBackendValueCommit,
  type IBackendEntityAccess,
  type IEntityKeyValueMethods,
  type IEntityRecordMethods
} from '../core/backend-registry.js'
import {
  StorageContractError,
  assertVersionedEnvelope,
  type IMigrationPlan,
  StorageContractErrorCode,
  assertStorageKey,
  StorageStageKind,
  type ICodecStageObserver,
  type IQueryStageObserver,
  type ITransactionScope,
  type IRecordIndexHandle
} from '@migaia/storage-contract'
import { compareStorageKeys } from '../authoring/key.js'
import {
  runTransactionOperation,
  readTransactionOperationContext
} from '../authoring/transaction.js'
import { lockKey } from '../authoring/concurrency.js'
import { isStorageErrorFamily } from '../core/error-family.js'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import { readStorageHookFailureCode } from '../hooks.js'
import { selectCodec } from '../serialize/index.js'
import { jsonCodec } from '../serialize/json.js'
import { structuredCodec } from '../serialize/structured.js'
import { composeFlatKey, composeRepositoryKey, composeStructuredKey } from './key.js'
import { encodeFlatStorageKey } from '../core/key-domain.js'
import { invokeExtension } from '../core/errors.js'
import { createStorageOperationRuntime, reportCleanupError } from '../core/operation-reporter.js'
import { EntityText } from './text.js'
import { snapshotOperationContext } from '../authoring/context.js'
import type { IOperationContext, IStorageKey } from '@migaia/storage-contract'
import type { ISchemaAdapter } from '../entity.js'
import type { ISelectedCodec } from '../entity.js'
import type {
  IEntityTransactionScope,
  IEntityConnectOptions,
  IRepository,
  IEntityConnectStore
} from './types.js'
import type { ISnapshotEntityIndexes } from './index-projection.js'

import { StorageOperation, StorageRecordStage } from './constants.js'
import {
  IEntityOperationRuntime,
  entityRuntime,
  observeEntity,
  IEnvelope,
  IStageFailure,
  IWriteTarget,
  stageFailure,
  snapshotEntityStore,
  IRepositoryConfig,
  idOf,
  IEntityRepositoryBinding
} from './repository-shared.js'
import type { EntityMigrationOwner } from './migration-owner.js'
import type { EntityUniqueOwner } from './unique-owner.js'
import type { EntityIndexesOwner } from './indexes-owner.js'
import type { EntityQueryOwner } from './query-owner.js'
import type { IEntityKeysetOwner } from './keyset.js'
import { missingEntityFeature } from './assembly.js'

export class EntityRepositoryOwner<
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {},
  TChangeFeed extends boolean = false
> {
  /** The repository borrows its validated entity declaration for every materialization path. */
  #config: IRepositoryConfig<TDomain, TStored>

  /** Entity gets business methods and original owner assertions, never a native close handle. */
  #backend: IBackendEntityAccess

  /** Borrowed text methods carry business access without native disposal authority. */
  #store: IEntityKeyValueMethods
  /** The entity name separates physical keys and diagnostic events across definitions. */
  #name: string
  /** The declared domain property supplies stable physical record identities. */
  #keyProp: Extract<keyof TDomain, string>
  /** Materialization and migration write envelopes at this target version. */
  #version: number
  /** The original schema object receives validation and conversion calls with its receiver. */
  #schema: ISchemaAdapter<TDomain, TStored>
  /** The shared plan owns version transitions instead of repository-local migration rules. */
  #migrationPlan: IMigrationPlan | undefined
  /** Read materialization validates domain data only when the declaration enables it. */
  #validateOnRead: boolean
  /** The original application callback receives non-fatal entity diagnostics. */
  #onDiagnostic: (message: string) => void
  /** An optional application comparator orders bounded entity query results. */
  #defaultOrderBy: ((left: TDomain, right: TDomain) => number) | undefined

  /** The codec observer receives conversion phases for this repository and its transactions. */
  #codecStages: ICodecStageObserver | undefined

  /** The declared query observer reports actual read counts and transaction phases. */
  #queryStages: IQueryStageObserver | undefined

  /** Optional borrowed record methods choose structured transactions instead of text fallback. */
  #recordStore: IEntityRecordMethods | undefined

  /** Codec selection retains the backend kind established before repository publication. */
  #records: boolean

  /** Non-unique selectors retain their existing write call counts; only constraints need scans. */
  #uniqueIndexes: ISnapshotEntityIndexes<TDomain>

  /** Native and fallback commits share the same canonical unique-key ownership rule. */
  #uniqueDefinitions: readonly ISnapshotEntityIndexes<TDomain>[string]['definition'][]

  /**
   * Select one codec for every repository path. Structured backends use the identity-like
   * structured codec by default, while text-only backends use JSON; an explicit codec is always
   * routed through capability validation.
   */
  #selectedCodec: ISelectedCodec

  /** The selected route preserves the original codec identity for observation. */
  #codecName: string

  /** The declared schema and version route identify resumable checkpoint compatibility. */
  #migrationFingerprint: string

  /** A ready handle is a captured backend fact; bound transactions never create or backfill it. */
  #readyHandle: IRecordIndexHandle | undefined

  /** Per-repository final changes belong to one authentic original transaction identity. */
  /** One stable public repository view is returned for this owner. */
  #repository: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>
  /** Select codec, backend and stage ports before publishing this repository. */
  constructor(
    config: IRepositoryConfig<TDomain, TStored>,
    inputStore: IEntityConnectStore,
    connectOptions?: IEntityConnectOptions
  ) {
    this.#config = config
    this.#backend = snapshotEntityStore(inputStore)
    this.#store = this.#backend.store
    this.#name = config.name
    this.#keyProp = config.key
    this.#version = config.version
    this.#schema = config.schema
    this.#migrationPlan = config.migrationPlan
    this.#validateOnRead = config.validateOnRead
    this.#onDiagnostic = config.onDiagnostic
    this.#defaultOrderBy = config.defaultOrderBy

    this.#codecStages = connectOptions?.codecStages
    this.#queryStages = connectOptions?.queryStages
    if (
      (this.#codecStages !== undefined && this.#codecStages.kind !== StorageStageKind.codec) ||
      (this.#queryStages !== undefined && this.#queryStages.kind !== StorageStageKind.query)
    )
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(StorageErrorText.backendKindMismatch)
      })
    this.#recordStore = this.#backend.recordStore()
    this.#records = this.#recordStore !== undefined
    this.#uniqueIndexes = Object.fromEntries(
      Object.entries(this.#config.indexes).filter(([, index]) => index.definition.unique)
    )
    this.#uniqueDefinitions = Object.values(this.#uniqueIndexes).map((index) => index.definition)
    this.#selectedCodec = selectCodec(
      this.#config.codec ?? (this.#records ? structuredCodec : jsonCodec),
      this.#store.capabilities,
      this.#emitDiagnostic
    )
    this.#codecName =
      this.#config.codec?.name ?? (this.#records ? structuredCodec.name : jsonCodec.name)
    this.#migrationFingerprint = [
      this.#name,
      String(this.#version),
      this.#keyProp,
      this.#schema.name,
      this.#config.codec?.name ?? (this.#records ? structuredCodec.name : jsonCodec.name),
      `range:${this.#migrationPlan?.baseVersion ?? 1}:${this.#migrationPlan?.version ?? this.#version}`
    ].join('|')
    for (const feature of config.features) this.#features.set(feature.name, feature.create(this))
    this.#repository = this.#createApi()
  }
  /** Return the stable public methods while keeping the component state private. */
  api() {
    return this.#repository
  }

  /** Perform the repository emitDiagnostic operation using its own state. */
  #emitDiagnostic = (message: string): void => {
    try {
      /** Preserve the application callback's ordinary function receiver. */
      const report = this.#onDiagnostic
      report(message)
    } catch (cause) {
      reportCleanupError(createStorageOperationRuntime().reporter, cause)
    }
  }

  /** Drive backend-private projection migration without exposing its lease/checkpoint protocol. */
  get #backfillIndexes(): EntityIndexesOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['backfillIndexes'] {
    return this.#feature<
      EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.indexes).backfillIndexes
  }

  /** Perform the repository writeEnvelopeAt operation using its own state. */
  #writeEnvelopeAt = async (
    target: IWriteTarget,
    envelope: IEnvelope,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<void> => {
    await this.#writeEncodedEnvelopeAt(
      target,
      await this.#encodeEnvelope(envelope, ctx, runtime),
      ctx
    )
  }

  /** Commit already encoded data so exclusive KV sections never invoke application codecs. */
  #writeEncodedEnvelopeAt = async (
    target: IWriteTarget,
    raw: unknown,
    ctx: IOperationContext | undefined
  ): Promise<void> => {
    if (this.#recordStore && target.documentKey !== undefined) {
      await this.#recordStore.putRecord(raw, target.documentKey, ctx)
      return
    }
    if (target.flatKey !== undefined) {
      await this.#store.set(target.flatKey, raw as string, ctx)
    }
  }

  /** Every real conversion emits exactly one matching observation sequence. */
  #codecCall = async <R>(
    phase: 'encode' | 'decode',
    invoke: () => Promise<R>,
    runtime: IEntityOperationRuntime
  ): Promise<R> => {
    const stages =
      runtime.scope === undefined
        ? this.#codecStages
        : this.#codecStages?.forTransaction(runtime.scope)
    const operation =
      phase === 'encode' ? StorageOperation.entityCodecEncode : StorageOperation.entityCodecDecode
    const before = phase === 'encode' ? 'beforeEncode' : 'beforeDecode'
    const after = phase === 'encode' ? 'afterEncode' : 'afterDecode'
    const failed = phase === 'encode' ? 'onEncodeError' : 'onDecodeError'
    if (stages?.[before] !== undefined)
      observeEntity(stages!, () => stages![before]!(operation, this.#codecName))
    try {
      const value = await invoke()
      if (stages?.[after] !== undefined)
        observeEntity(stages!, () => stages![after]!(operation, this.#codecName))
      return value
    } catch (cause) {
      if (stages?.[failed] !== undefined)
        observeEntity(stages!, () =>
          stages![failed]!(
            operation,
            this.#codecName,
            readStorageHookFailureCode(cause, stages!.report)
          )
        )
      throw cause
    }
  }

  /** Encode every repository write through the original codec and extension error boundary. */
  #encodeEnvelope = (
    envelope: IEnvelope,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<unknown> =>
    this.#codecCall(
      'encode',
      () =>
        invokeExtension(
          () => this.#selectedCodec.encode(envelope, ctx),
          this.#store.backend,
          StorageOperation.entityCodecEncode,
          'codec',
          ctx?.signal,
          runtime
        ),
      runtime
    )

  /** Perform the repository materialize operation using its own state. */
  #materialize = async (
    envelope: IEnvelope | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<TDomain | undefined> => {
    if (!envelope) return undefined
    const stored =
      envelope.version === this.#version
        ? envelope.state
        : await this.#feature<
            EntityMigrationOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
          >(EntityFeatureName.migration).materializeEnvelope(envelope, ctx, runtime)
    let decoded: TDomain
    try {
      decoded = this.#schema.decode
        ? await invokeExtension(
            () => this.#schema.decode!(stored as TStored, ctx),
            this.#store.backend,
            StorageOperation.entitySchemaDecode,
            'schema',
            ctx?.signal,
            runtime
          )
        : (stored as TDomain)
    } catch (cause) {
      throw stageFailure('decode', cause)
    }
    if (!this.#validateOnRead) return decoded
    try {
      return await invokeExtension(
        () => this.#schema.validate(decoded, ctx),
        this.#store.backend,
        StorageOperation.entitySchemaValidate,
        'schema',
        ctx?.signal,
        runtime
      )
    } catch (cause) {
      throw stageFailure('validate', cause)
    }
  }

  /** Perform the repository toEnvelope operation using its own state. */
  #toEnvelope = async (
    value: TDomain,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<{ readonly domain: TDomain; readonly envelope: IEnvelope }> => {
    const domain = await invokeExtension(
      () => this.#schema.validate(value, ctx),
      this.#store.backend,
      StorageOperation.entitySchemaValidate,
      'schema',
      ctx?.signal,
      runtime
    )
    const normalized = this.#schema.normalize
      ? await invokeExtension(
          () => this.#schema.normalize!(domain, ctx),
          this.#store.backend,
          StorageOperation.entitySchemaNormalize,
          'schema',
          ctx?.signal,
          runtime
        )
      : domain
    const stored = this.#schema.encode
      ? await invokeExtension(
          () => this.#schema.encode!(normalized, ctx),
          this.#store.backend,
          StorageOperation.entitySchemaEncode,
          'schema',
          ctx?.signal,
          runtime
        )
      : (normalized as unknown as TStored)
    try {
      return {
        domain: normalized,
        envelope: assertVersionedEnvelope({ version: this.#version, state: stored })
      }
    } catch (cause) {
      throw new StorageError(StorageErrorCode.serializeFailed, { cause })
    }
  }

  /** Perform the repository decodeEnvelope operation using its own state. */
  #decodeEnvelope = async (
    raw: unknown,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<IEnvelope> => {
    const decoded: unknown = await this.#codecCall(
      'decode',
      () =>
        invokeExtension(
          () => this.#selectedCodec.decode(raw, ctx),
          this.#store.backend,
          StorageOperation.entityCodecDecode,
          'codec',
          ctx?.signal,
          runtime
        ),
      runtime
    )
    /** Hooks observe the same validated version envelope used for materialization. */
    const stages = getBackendEnvelopeStages(this.#store, {
      operation: StorageOperation.entityEnvelope,
      targetVersion: this.#version
    })
    stages?.beforeEnvelopeCheck()
    try {
      const envelope = assertVersionedEnvelope(decoded)
      stages?.afterEnvelopeCheck(envelope.version)
      return envelope
    } catch (cause) {
      stages?.onVersionRejected(undefined, StorageContractErrorCode.envelopeInvalid)
      throw new StorageError(StorageErrorCode.deserializeFailed, { cause })
    }
  }

  /** Apply the invalid-record policy once so handler failures have one stable error boundary. */
  get #invalidAction(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['invalidAction'] {
    return this.#feature<
      EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.query).invalidAction
  }

  /** Perform the repository validateInvalidHandler operation using its own state. */
  get #validateInvalidHandler(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['validateInvalidHandler'] {
    return this.#feature<
      EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.query).validateInvalidHandler
  }

  /** Detach list bounds before the lazy source opens and awaits native reads. */
  get #normalizeListOptions(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['normalizeListOptions'] {
    return this.#feature<
      EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.query).normalizeListOptions
  }

  /** Detach indexed list bounds before lazy native work can outlive caller mutation. */
  get #snapshotIndexedListOptions(): EntityIndexesOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['snapshotIndexedListOptions'] {
    return this.#feature<
      EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.indexes).snapshotIndexedListOptions
  }

  /** Build an indexed snapshot for the findManyBy/findBy/streamBy APIs. */
  get #createIndexedListSnapshot(): EntityIndexesOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['createIndexedListSnapshot'] {
    return this.#feature<
      EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.indexes).createIndexedListSnapshot
  }

  /** Perform the repository invokeInvalidHandler operation using its own state. */
  get #invokeInvalidHandler(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['invokeInvalidHandler'] {
    return this.#feature<
      EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.query).invokeInvalidHandler
  }

  /** Perform the repository throwInvalid operation using its own state. */
  get #throwInvalid(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['throwInvalid'] {
    return this.#feature<
      EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.query).throwInvalid
  }

  /** Perform the repository materializeForRead operation using its own state. */
  #materializeForRead = async (
    id: IStorageKey,
    envelope: IEnvelope | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<TDomain | undefined> => {
    try {
      return await this.#materialize(envelope, ctx, runtime)
    } catch (cause) {
      /* c8 ignore start -- materialize's extension boundaries already return StorageError. */
      if (isStorageErrorFamily(cause)) throw cause
      const stage = (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.validate
      const code =
        stage === StorageRecordStage.migrate
          ? StorageErrorCode.migrationFailed
          : stage === StorageRecordStage.decode
            ? StorageErrorCode.deserializeFailed
            : StorageErrorCode.validationFailed
      throw new StorageError(code, { backend: this.#store.backend, key: id, cause })
    }
  }

  /** Perform the repository readEnvelope operation using its own state. */
  #readEnvelope = async (
    id: IStorageKey,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<IEnvelope | undefined> => {
    if (this.#recordStore) {
      let raw = await this.#recordStore.getRecord(composeRepositoryKey(this.#name, id), ctx)
      if (raw === undefined)
        raw = await this.#recordStore.getRecord(composeStructuredKey(this.#name, id), ctx)
      if (raw === undefined) return undefined
      return this.#decodeEnvelope(raw, ctx, runtime)
    }
    const raw = await this.#store.get(composeFlatKey(this.#name, id), ctx)
    if (raw === null) return undefined
    return this.#decodeEnvelope(raw, ctx, runtime)
  }

  /**
   * Canonical ID ordering uses the same radix structure; comparator scans retain only heap
   * candidates.
   */
  get #streamImpl(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['streamImpl'] {
    const feature =
      this.#feature<EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>>(
        'query'
      )
    return (...args) => feature.streamImpl(...args)
  }

  /**
   * New fallback write checks reuse the existing extension boundary without changing native
   * backfill identity.
   */
  get #projectUniqueWrite(): EntityUniqueOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['projectUniqueWrite'] {
    return this.#feature<
      EntityUniqueOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.unique).projectUniqueWrite
  }

  /** Use one normal record revision as a phantom barrier, with no sidecar or duplicate queue. */
  get #validateUniqueRecordCommit(): EntityUniqueOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['validateUniqueRecordCommit'] {
    return this.#feature<
      EntityUniqueOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.unique).validateUniqueRecordCommit
  }

  /**
   * Preserve KV support: validate outside the critical section, then compare-and-commit under its
   * host owner.
   */
  get #writeUniqueValue(): EntityUniqueOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['writeUniqueValue'] {
    return this.#feature<
      EntityUniqueOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.unique).writeUniqueValue
  }

  /** Fixed ordering metadata concatenates two canonical encodings without taxing a synthetic key. */
  get #encodeIndexOrder(): EntityIndexesOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['encodeIndexOrder'] {
    return this.#feature<
      EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.indexes).encodeIndexOrder
  }

  /** Perform the repository indexRows operation using its own state. */
  get #indexRows(): EntityIndexesOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['indexRows'] {
    return this.#feature<
      EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.indexes).indexRows
  }

  /** Perform the repository createIndexQuery operation using its own state. */
  get #createIndexQuery(): EntityIndexesOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['createIndexQuery'] {
    return this.#feature<
      EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.indexes).createIndexQuery
  }

  /** Source adaptation contributes no second AST or query executor. */

  /** Adapt the application index callback at the entity boundary. */
  get #queryIndex(): EntityIndexesOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['queryIndex'] {
    return this.#feature<
      EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.indexes).queryIndex
  }

  /** Select the canonical index plan using explicit source facts. */
  get #planEntitySource(): EntityIndexesOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['planEntitySource'] {
    return this.#feature<
      EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.indexes).planEntitySource
  }

  /** Perform the repository bindRepository operation using its own state. */
  #bindRepository = (
    scope: ITransactionScope,
    expectedIdentity?: IStorageKey
  ): IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods> => {
    const info = this.#backend.assertScope(scope)
    /** Unique draft tracking exists only when its explicit unit owns constraints. */
    const activeChanges =
      this.#uniqueDefinitions.length === 0
        ? undefined
        : this.#feature<
            EntityUniqueOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
          >(EntityFeatureName.unique).bindChanges(scope, info)
    /** Bound endpoints retain only the same weak mutation state and authentic scope. */
    const binding: IEntityRepositoryBinding = { scope, expectedIdentity, activeChanges }
    return {
      query: () => this.#boundQuery(binding),
      get: (id) => this.#boundGet(binding, id),
      put: (value) => this.#boundPut(binding, value),
      remove: (id) => this.#boundRemove(binding, id),
      list: (options) => this.#boundList(binding, options)
    }
  }
  /** Perform transaction-bound query work through its authentic original scope. */
  get #boundQuery(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['boundQuery'] {
    return this.#feature<
      EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.query).boundQuery
  }
  /** Perform transaction-bound get work through its authentic original scope. */
  #boundGet = (
    binding: IEntityRepositoryBinding,
    id: IStorageKey
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['get']> =>
    runTransactionOperation(binding.scope, async (current) => {
      this.#backend.assertScope(current)
      const context = readTransactionOperationContext(current)
      assertStorageKey(id, this.#store.backend)
      const runtime = entityRuntime(current)
      const raw =
        (await current.getRecord(composeRepositoryKey(this.#name, id))) ??
        (await current.getRecord(composeStructuredKey(this.#name, id)))
      return raw === undefined
        ? undefined
        : this.#materializeForRead(
            id,
            await this.#decodeEnvelope(raw, context, runtime),
            context,
            runtime
          )
    })
  /** Perform transaction-bound put work through its authentic original scope. */
  #boundPut = (
    binding: IEntityRepositoryBinding,
    value: TDomain
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['put']> =>
    runTransactionOperation(binding.scope, async (current) => {
      this.#backend.assertScope(current)
      const context = readTransactionOperationContext(current)
      const runtime = entityRuntime(current)
      const prepared = await this.#toEnvelope(value, context, runtime)
      const id = idOf(this.#name, this.#keyProp, prepared.domain, this.#store.backend)
      /** Query patches cannot move a physical record or overwrite another entity identity. */
      if (
        binding.expectedIdentity !== undefined &&
        compareStorageKeys(id, binding.expectedIdentity) !== 0
      )
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: this.#store.backend,
          cause: new TypeError(EntityText.queryIdentityChanged)
        })
      const raw = await this.#encodeEnvelope(prepared.envelope, context, runtime)
      /** A historical repository handle is usable only after this native snapshot confirms it. */
      const handle =
        this.#readyHandle !== undefined && (await current.isRecordIndexReady?.(this.#readyHandle))
          ? this.#readyHandle
          : undefined
      if (handle !== undefined && current.putIndexedRecord !== undefined)
        await current.putIndexedRecord(
          raw,
          composeRepositoryKey(this.#name, id),
          handle,
          this.#feature<
            EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
          >(EntityFeatureName.indexes).projectAllIndexes(prepared.domain),
          { conflictPolicy: 'replace' }
        )
      else
        await current.putRecord(raw, composeRepositoryKey(this.#name, id), {
          conflictPolicy: 'replace'
        })
      await current.deleteRecord(composeStructuredKey(this.#name, id))
      binding.activeChanges?.deref()!.set(encodeFlatStorageKey(id), {
        id,
        projection: this.#projectUniqueWrite(prepared.domain)
      })
      return id
    })
  /** Perform transaction-bound remove work through its authentic original scope. */
  #boundRemove = (
    binding: IEntityRepositoryBinding,
    id: IStorageKey
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['remove']> =>
    runTransactionOperation(binding.scope, async (current) => {
      this.#backend.assertScope(current)
      assertStorageKey(id, this.#store.backend)
      await current.deleteRecord(composeRepositoryKey(this.#name, id))
      await current.deleteRecord(composeStructuredKey(this.#name, id))
      binding.activeChanges?.deref()!.set(encodeFlatStorageKey(id), { id, projection: undefined })
    })
  /** Perform transaction-bound list work through its authentic original scope. */
  get #boundList(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['boundList'] {
    return this.#feature<
      EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.query).boundList
  }

  /** Publish the original repository methods without exposing its internal state. */
  #createApi = (): IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods> => ({
    query: (...args) => this.#apiQuery(...args),
    get: this.#apiGet,
    put: this.#apiPut,
    remove: this.#apiRemove,
    list: (...args) => this.#apiList(...args),
    stream: (...args) => this.#apiStream(...args),
    findBy: (...args) => this.#apiFindBy(...args),
    migrate: (...args) => this.#apiMigrate(...args),
    in: this.#apiIn,
    lockKey: this.#apiLockKey,
    batch: this.#apiBatch
  })
  /** Perform the public query operation using this repository state. */
  get #apiQuery(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['apiQuery'] {
    return this.#feature<
      EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.query).apiQuery
  }
  /** Perform the public get operation using this repository state. */
  #apiGet: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['get'] = async (
    id,
    ctx
  ) => {
    const context = snapshotOperationContext(ctx)
    const runtime = createStorageOperationRuntime()
    assertStorageKey(id, this.#store.backend, `entity "${this.#name}" id`)
    return this.#materializeForRead(
      id,
      await this.#readEnvelope(id, context, runtime),
      context,
      runtime
    )
  }
  /** Perform the public put operation using this repository state. */
  #apiPut: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['put'] = async (
    value,
    ctx
  ) => {
    if (this.#recordStore !== undefined)
      return this.#recordStore.transaction((scope) => this.#bindRepository(scope).put(value), ctx)
    if (this.#uniqueDefinitions.length !== 0 && getBackendValueCommit(this.#store) === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: this.#store.backend
      })
    const context = snapshotOperationContext(ctx)
    const runtime = createStorageOperationRuntime()
    const prepared = await this.#toEnvelope(value, context, runtime)
    const id = idOf(this.#name, this.#keyProp, prepared.domain, this.#store.backend)
    if (this.#uniqueDefinitions.length > 0)
      await this.#writeUniqueValue(id, prepared.domain, prepared.envelope, context)
    else
      await this.#writeEnvelopeAt(
        { flatKey: composeFlatKey(this.#name, id) },
        prepared.envelope,
        context,
        runtime
      )
    return id
  }
  /** Perform the public remove operation using this repository state. */
  #apiRemove: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['remove'] = async (
    id,
    ctx
  ) => {
    if (this.#recordStore !== undefined)
      return this.#recordStore.transaction((scope) => this.#bindRepository(scope).remove(id), ctx)
    assertStorageKey(id, this.#store.backend)
    await this.#store.remove(composeFlatKey(this.#name, id), ctx)
  }
  /** Perform the public list operation using this repository state. */
  get #apiList(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['apiList'] {
    return this.#feature<
      EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.query).apiList
  }
  /** Perform the public stream operation using this repository state. */
  get #apiStream(): EntityQueryOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['apiStream'] {
    return this.#feature<
      EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.query).apiStream
  }
  /** Perform the public findBy operation using this repository state. */
  get #apiFindBy(): EntityIndexesOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['apiFindBy'] {
    return this.#feature<
      EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.indexes).apiFindBy
  }
  /** Perform the public migrate operation using this repository state. */
  get #apiMigrate(): EntityMigrationOwner<
    TDomain,
    TStored,
    TIndexes,
    TAugmentMethods,
    TChangeFeed
  >['apiMigrate'] {
    return this.#feature<
      EntityMigrationOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.migration).apiMigrate
  }

  /** Perform the public in operation using this repository state. */
  #apiIn: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['in'] = (scope) =>
    this.#bindRepository(scope)
  /** Perform the public lockKey operation using this repository state. */
  #apiLockKey: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['lockKey'] = (id) => {
    assertStorageKey(id, this.#store.backend)
    return this.#records
      ? lockKey.record(composeRepositoryKey(this.#name, id))
      : lockKey.text(composeFlatKey(this.#name, id))
  }
  /** Perform the public batch operation using this repository state. */
  #apiBatch: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['batch'] = (run, ctx) => {
    if (typeof run !== 'function')
      return Promise.reject(
        new StorageError(StorageErrorCode.invalidConfig, {
          backend: this.#store.backend,
          cause: new TypeError(EntityText.batchCallbackMustBeAFunction)
        })
      )
    if (this.#recordStore === undefined)
      return Promise.reject(
        new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: this.#store.backend
        })
      )
    return this.#recordStore.transaction((scope) => run(this.#bindRepository(scope)), ctx)
  }

  /** Keyset admission resolves only its explicit owner and preserves the original query result. */
  get runKeyset(): IEntityKeysetOwner['run'] {
    return this.#feature<IEntityKeysetOwner>(EntityFeatureName.keyset).run
  }
  /** An absent keyset unit never imports or constructs its query implementation. */
  get keysetQuery(): IEntityKeysetOwner['query'] | undefined {
    return (this.#features.get(EntityFeatureName.keyset) as IEntityKeysetOwner | undefined)?.query
  }
  /** Read only assembly presence; this never constructs another capability. */
  hasFeature(name: string): boolean {
    return this.#features.has(name)
  }
  /** Only explicitly supplied feature units retain their implementation owners. */
  #features = new Map<string, object>()
  /** Resolve one required assembly without enabling any other capability. */
  #feature<T extends object>(name: string): T {
    const feature = this.#features.get(name)
    if (feature === undefined) return missingEntityFeature(name)
    return feature as T
  }

  /** Internal port shares the original config fact or operation with an assembled owner. */
  get config() {
    return this.#config
  }
  /** Internal port shares the original backend fact or operation with an assembled owner. */
  get backend() {
    return this.#backend
  }
  /** Internal port shares the original store fact or operation with an assembled owner. */
  get store() {
    return this.#store
  }
  /** Internal port shares the original name fact or operation with an assembled owner. */
  get name() {
    return this.#name
  }
  /** Internal port shares the original keyProp fact or operation with an assembled owner. */
  get keyProp() {
    return this.#keyProp
  }
  /** Internal port shares the original version fact or operation with an assembled owner. */
  get version() {
    return this.#version
  }

  /** Internal port shares the original migrationPlan fact or operation with an assembled owner. */
  get migrationPlan() {
    return this.#migrationPlan
  }

  /** Internal port shares the original defaultOrderBy fact or operation with an assembled owner. */
  get defaultOrderBy() {
    return this.#defaultOrderBy
  }

  /** Internal port shares the original queryStages fact or operation with an assembled owner. */
  get queryStages() {
    return this.#queryStages
  }
  /** Internal port shares the original recordStore fact or operation with an assembled owner. */
  get recordStore() {
    return this.#recordStore
  }

  /** Internal port shares the original uniqueIndexes fact or operation with an assembled owner. */
  get uniqueIndexes() {
    return this.#uniqueIndexes
  }
  /** Internal port shares the original uniqueDefinitions fact or operation with an assembled owner. */
  get uniqueDefinitions() {
    return this.#uniqueDefinitions
  }

  /**
   * Internal port shares the original migrationFingerprint fact or operation with an assembled
   * owner.
   */
  get migrationFingerprint() {
    return this.#migrationFingerprint
  }
  /** Internal port shares the original readyHandle fact or operation with an assembled owner. */
  get readyHandle() {
    return this.#readyHandle
  }
  /** The index owner publishes only its already validated native handle. */
  set readyHandle(value: IRecordIndexHandle | undefined) {
    this.#readyHandle = value
  }

  /** Internal port shares the original emitDiagnostic fact or operation with an assembled owner. */
  get emitDiagnostic() {
    return this.#emitDiagnostic
  }
  /** Internal port shares the original backfillIndexes fact or operation with an assembled owner. */
  get backfillIndexes() {
    return this.#backfillIndexes
  }
  /** Internal port shares the original writeEnvelopeAt fact or operation with an assembled owner. */
  get writeEnvelopeAt() {
    return this.#writeEnvelopeAt
  }

  /** Internal port shares the original encodeEnvelope fact or operation with an assembled owner. */
  get encodeEnvelope() {
    return this.#encodeEnvelope
  }
  /** Internal port shares the original materialize fact or operation with an assembled owner. */
  get materialize() {
    return this.#materialize
  }
  /** Internal port shares the original toEnvelope fact or operation with an assembled owner. */
  get toEnvelope() {
    return this.#toEnvelope
  }
  /** Internal port shares the original decodeEnvelope fact or operation with an assembled owner. */
  get decodeEnvelope() {
    return this.#decodeEnvelope
  }
  /** Internal port shares the original invalidAction fact or operation with an assembled owner. */
  get invalidAction() {
    return this.#invalidAction
  }
  /**
   * Internal port shares the original validateInvalidHandler fact or operation with an assembled
   * owner.
   */
  get validateInvalidHandler() {
    return this.#validateInvalidHandler
  }
  /**
   * Internal port shares the original normalizeListOptions fact or operation with an assembled
   * owner.
   */
  get normalizeListOptions() {
    return this.#normalizeListOptions
  }
  /**
   * Internal port shares the original snapshotIndexedListOptions fact or operation with an
   * assembled owner.
   */
  get snapshotIndexedListOptions() {
    return this.#snapshotIndexedListOptions
  }
  /**
   * Internal port shares the original createIndexedListSnapshot fact or operation with an assembled
   * owner.
   */
  get createIndexedListSnapshot() {
    return this.#createIndexedListSnapshot
  }

  /**
   * Internal port shares the original invokeInvalidHandler fact or operation with an assembled
   * owner.
   */
  get invokeInvalidHandler() {
    return this.#invokeInvalidHandler
  }
  /** Internal port shares the original throwInvalid fact or operation with an assembled owner. */
  get throwInvalid() {
    return this.#throwInvalid
  }

  /** Internal port shares the original streamImpl fact or operation with an assembled owner. */
  get streamImpl() {
    return this.#streamImpl
  }

  /** Internal port shares the original projectUniqueWrite fact or operation with an assembled owner. */
  get projectUniqueWrite() {
    return this.#projectUniqueWrite
  }

  /**
   * Internal port shares the original validateUniqueRecordCommit fact or operation with an
   * assembled owner.
   */
  get validateUniqueRecordCommit() {
    return this.#validateUniqueRecordCommit
  }

  /** Internal port shares the original writeUniqueValue fact or operation with an assembled owner. */
  get writeUniqueValue() {
    return this.#writeUniqueValue
  }
  /** Internal port shares the original encodeIndexOrder fact or operation with an assembled owner. */
  get encodeIndexOrder() {
    return this.#encodeIndexOrder
  }
  /** Internal port shares the original indexRows fact or operation with an assembled owner. */
  get indexRows() {
    return this.#indexRows
  }
  /** Internal port shares the original createIndexQuery fact or operation with an assembled owner. */
  get createIndexQuery() {
    return this.#createIndexQuery
  }

  /** Internal port shares the original queryIndex fact or operation with an assembled owner. */
  get queryIndex() {
    return this.#queryIndex
  }

  /** Internal port shares the original planEntitySource fact or operation with an assembled owner. */
  get planEntitySource() {
    return this.#planEntitySource
  }

  /** Internal port shares the original bindRepository fact or operation with an assembled owner. */
  get bindRepository() {
    return this.#bindRepository
  }
}

export const createRepository = <
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {},
  TChangeFeed extends boolean = false
>(
  config: IRepositoryConfig<TDomain, TStored>,
  inputStore: IEntityConnectStore,
  connectOptions?: IEntityConnectOptions
): IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods> => {
  return new EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>(
    config,
    inputStore,
    connectOptions
  ).api()
}
