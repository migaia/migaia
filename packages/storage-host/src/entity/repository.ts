import { EntityFeatureName } from './constants.ts'
import {
  getBackendValueCommit,
  type IBackendEntityAccess,
  type IEntityKeyValueMethods,
  type IEntityRecordMethods
} from '../core/backend-registry.ts'
import {
  StorageContractError,
  type IMigrationPlan,
  StorageContractErrorCode,
  assertStorageKey,
  StorageStageKind,
  type IQueryStageObserver,
  type ITransactionScope,
  type IRecordIndexHandle
} from '@migaia/storage-contract'
import { compareStorageKeys } from '../authoring/key.ts'
import {
  runTransactionOperation,
  readTransactionOperationContext
} from '../authoring/transaction.ts'
import { lockKey } from '../authoring/concurrency.ts'
import { isStorageErrorFamily } from '../core/error-family.ts'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import { selectCodec } from '../serialize/index.ts'
import { jsonCodec } from '../serialize/json.ts'
import { structuredCodec } from '../serialize/structured.ts'
import { composeFlatKey, composeRepositoryKey, composeStructuredKey } from './key.ts'
import { encodeFlatStorageKey } from '../core/key-domain.ts'
import { createStorageOperationRuntime, reportCleanupError } from '../core/operation-reporter.ts'
import { EntityText } from './text.ts'
import { snapshotOperationContext } from '../authoring/context.ts'
import type { IOperationContext, IStorageKey } from '@migaia/storage-contract'
import type {
  IEntityTransactionScope,
  IEntityConnectOptions,
  IRepository,
  IEntityConnectStore,
  IInvalidRecordAction,
  IInvalidRecordHandler,
  IInvalidRecordIssue
} from './types.ts'
import type { ISnapshotEntityIndexes } from './index-projection.ts'
import { StorageRecordStage } from './constants.ts'
import {
  IEntityOperationRuntime,
  entityRuntime,
  IEnvelope,
  IWriteTarget,
  snapshotEntityStore,
  IRepositoryConfig,
  idOf,
  IEntityRepositoryBinding
} from './repository-shared.ts'
import type { EntityMigrationOwner } from './migration-owner.ts'
import type { EntityUniqueOwner } from './unique-owner.ts'
import type { EntityIndexesOwner } from './indexes-owner.ts'
import type { EntityQueryOwner } from './query-owner.ts'
import type { IEntityKeysetOwner } from './keyset.ts'
import { missingEntityFeature } from './assembly.ts'
import { throwIfAborted } from '../core/operation.ts'
import { EntityRecordCodec } from './record-codec.ts'

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
  /** The shared plan owns version transitions instead of repository-local migration rules. */
  #migrationPlan: IMigrationPlan | undefined
  /** The original application callback receives non-fatal entity diagnostics. */
  #onDiagnostic: (message: string) => void
  /** An optional application comparator orders bounded entity query results. */
  #defaultOrderBy: ((left: TDomain, right: TDomain) => number) | undefined

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

  /** Encode, decode and materialize envelopes with this repository's selected codec and schema. */
  readonly #codec: EntityRecordCodec<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>

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
    this.assertCurrent()
    this.#backend = snapshotEntityStore(inputStore)
    this.#store = this.#backend.store
    this.#name = config.name
    this.#keyProp = config.key
    this.#version = config.version
    this.#migrationPlan = config.migrationPlan
    this.#onDiagnostic = config.onDiagnostic
    this.#defaultOrderBy = config.defaultOrderBy

    /** The codec observer receives conversion phases for this repository and its transactions. */
    const codecStages = connectOptions?.codecStages
    this.#queryStages = connectOptions?.queryStages
    if (
      (codecStages !== undefined && codecStages.kind !== StorageStageKind.codec) ||
      (this.#queryStages !== undefined && this.#queryStages.kind !== StorageStageKind.query)
    )
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(StorageErrorText.backendKindMismatch)
      })
    this.#recordStore = this.#backend.recordStore()
    this.#records = this.#recordStore !== undefined
    this.#uniqueIndexes = config.uniqueIndexes
    this.#uniqueDefinitions = config.uniqueDefinitions
    /**
     * Select one codec for every repository path. Structured backends use the identity-like
     * structured codec by default, while text-only backends use JSON; an explicit codec is always
     * routed through capability validation.
     */
    const selectedCodec = selectCodec(
      this.#config.codec ?? (this.#records ? structuredCodec : jsonCodec),
      this.#store.capabilities,
      this.#emitDiagnostic
    )
    /** The selected route preserves the original codec identity for observation. */
    const codecName =
      this.#config.codec?.name ?? (this.#records ? structuredCodec.name : jsonCodec.name)
    this.#codec = new EntityRecordCodec(this, {
      store: this.#store,
      name: this.#name,
      version: this.#version,
      schema: config.schema,
      validateOnRead: config.validateOnRead,
      codecStages,
      recordStore: this.#recordStore,
      selectedCodec,
      codecName
    })
    this.#migrationFingerprint = [
      this.#name,
      String(this.#version),
      this.#keyProp,
      config.schema.name,
      codecName,
      `range:${this.#migrationPlan?.baseVersion ?? 1}:${this.#migrationPlan?.version ?? this.#version}`
    ].join('|')
    for (const { role, factory } of config.units) this.#features.set(role, factory.create(this))
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

  /**
   * Resolve the assembled indexes feature on demand; a missing unit throws its required-feature
   * error.
   */
  get #indexes(): EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed> {
    return this.feature<
      EntityIndexesOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.indexes)
  }

  /**
   * Resolve the assembled query feature on demand; a missing unit throws its required-feature
   * error.
   */
  get #query(): EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed> {
    return this.feature<EntityQueryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>>(
      EntityFeatureName.query
    )
  }

  /**
   * Resolve the assembled unique feature on demand; a missing unit throws its required-feature
   * error.
   */
  get #unique(): EntityUniqueOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed> {
    return this.feature<
      EntityUniqueOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.unique)
  }

  /**
   * Resolve the assembled migration feature on demand; a missing unit throws its required-feature
   * error.
   */
  get #migration(): EntityMigrationOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed> {
    return this.feature<
      EntityMigrationOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
    >(EntityFeatureName.migration)
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
      await this.#codec.encodeEnvelope(envelope, ctx, runtime),
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

  /** Own shared invalid-record policy without requiring optional query assembly. */
  #validateInvalidHandler = (handler: unknown): void => {
    if (
      handler !== undefined &&
      handler !== 'skip' &&
      handler !== 'throw' &&
      typeof handler !== 'function'
    )
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
        backend: this.#store.backend,
        cause: new TypeError(EntityText.oninvalidMustBeSkipThrowOrAHandler)
      })
  }

  /** Own shared invalid-record policy without requiring optional query assembly. */
  #invokeInvalidHandler = (
    handler: IInvalidRecordAction | IInvalidRecordHandler<TDomain> | undefined,
    issue: IInvalidRecordIssue<TDomain>
  ): IInvalidRecordAction => {
    /** Missing assembly is an operation failure, never corrupt data eligible for skipping. */
    if (
      isStorageErrorFamily(issue.cause) &&
      issue.cause.code === StorageHostErrorCode.entityFeatureRequired
    )
      throw issue.cause
    if (handler === undefined || handler === 'skip' || handler === 'throw') return handler ?? 'skip'
    if (typeof handler !== 'function')
      throw new StorageError(StorageHostErrorCode.invalidConfig, {
        backend: this.#store.backend,
        key: issue.key,
        cause: new TypeError(EntityText.oninvalidMustBeSkipThrowOrAHandler)
      })
    try {
      const action = handler(issue)
      if (action !== 'skip' && action !== 'throw')
        throw new StorageError(StorageHostErrorCode.invalidConfig, {
          backend: this.#store.backend,
          key: issue.key,
          cause: new TypeError(EntityText.oninvalidHandlerMustReturnSkipOrThrow)
        })
      return action
    } catch (cause) {
      if (isStorageErrorFamily(cause) && cause.code === StorageHostErrorCode.invalidConfig)
        throw cause
      throw new StorageError(StorageHostErrorCode.validationFailed, {
        backend: this.#store.backend,
        key: issue.key,
        cause
      })
    }
  }

  /** Own shared invalid-record policy without requiring optional query assembly. */
  #throwInvalid = (issue: IInvalidRecordIssue<TDomain>): never => {
    /* c8 ignore start -- all current decode/migrate/validate stages normalize to StorageError. */
    if (isStorageErrorFamily(issue.cause)) throw issue.cause
    const code =
      issue.stage === StorageRecordStage.migrate
        ? StorageHostErrorCode.migrationFailed
        : issue.stage === StorageRecordStage.decode
          ? StorageHostErrorCode.deserializeFailed
          : StorageHostErrorCode.validationFailed
    throw new StorageError(code, {
      backend: this.#store.backend,
      key: issue.key,
      cause: issue.cause
    })
    /* c8 ignore stop */
  }

  /** Source adaptation contributes no second AST or query executor. */

  /** Perform the repository bindRepository operation using its own state. */
  #bindRepository = (
    scope: ITransactionScope,
    expectedIdentity?: IStorageKey
  ): IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods> => {
    this.assertCurrent()
    const info = this.#backend.assertScope(scope)
    /** Unique draft tracking exists only when its explicit unit owns constraints. */
    const activeChanges =
      this.#uniqueDefinitions.length === 0
        ? undefined
        : this.feature<EntityUniqueOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>>(
            EntityFeatureName.unique
          ).bindChanges(scope, info)
    /** Bound endpoints retain only the same weak mutation state and authentic scope. */
    const binding: IEntityRepositoryBinding = { scope, expectedIdentity, activeChanges }
    return {
      query: () => this.#query.boundQuery(binding),
      get: (id) => this.#boundGet(binding, id),
      put: (value) => this.#boundPut(binding, value),
      remove: (id) => this.#boundRemove(binding, id),
      list: (options) => this.#query.boundList(binding, options)
    }
  }
  /** Perform transaction-bound get work through its authentic original scope. */
  #boundGet = (
    binding: IEntityRepositoryBinding,
    id: IStorageKey
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['get']> => {
    try {
      this.assertCurrent()
    } catch (cause) {
      return Promise.reject(cause)
    }
    return runTransactionOperation(binding.scope, async (current) => {
      this.#backend.assertScope(current)
      const context = readTransactionOperationContext(current)
      assertStorageKey(id, this.#store.backend)
      const runtime = entityRuntime(current)
      const raw =
        (await current.getRecord(composeRepositoryKey(this.#name, id))) ??
        (await current.getRecord(composeStructuredKey(this.#name, id)))
      return raw === undefined
        ? undefined
        : this.#codec.materializeForRead(
            id,
            await this.#codec.decodeEnvelope(raw, context, runtime),
            context,
            runtime
          )
    })
  }
  /** Perform transaction-bound put work through its authentic original scope. */
  #boundPut = (
    binding: IEntityRepositoryBinding,
    value: TDomain
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['put']> => {
    try {
      this.assertCurrent()
    } catch (cause) {
      return Promise.reject(cause)
    }
    return runTransactionOperation(binding.scope, async (current) => {
      this.#backend.assertScope(current)
      const context = readTransactionOperationContext(current)
      const runtime = entityRuntime(current)
      const prepared = await this.#codec.toEnvelope(value, context, runtime)
      const id = idOf(this.#name, this.#keyProp, prepared.domain, this.#store.backend)
      /** Query patches cannot move a physical record or overwrite another entity identity. */
      if (
        binding.expectedIdentity !== undefined &&
        compareStorageKeys(id, binding.expectedIdentity) !== 0
      )
        throw new StorageError(StorageHostErrorCode.invalidConfig, {
          backend: this.#store.backend,
          cause: new TypeError(EntityText.queryIdentityChanged)
        })
      const raw = await this.#codec.encodeEnvelope(prepared.envelope, context, runtime)
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
          this.feature<
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
        projection: this.#unique.projectUniqueWrite(prepared.domain)
      })
      return id
    })
  }
  /** Perform transaction-bound remove work through its authentic original scope. */
  #boundRemove = (
    binding: IEntityRepositoryBinding,
    id: IStorageKey
  ): ReturnType<IEntityTransactionScope<TDomain, TIndexes, TAugmentMethods>['remove']> => {
    try {
      this.assertCurrent()
    } catch (cause) {
      return Promise.reject(cause)
    }
    return runTransactionOperation(binding.scope, async (current) => {
      this.#backend.assertScope(current)
      assertStorageKey(id, this.#store.backend)
      await current.deleteRecord(composeRepositoryKey(this.#name, id))
      await current.deleteRecord(composeStructuredKey(this.#name, id))
      binding.activeChanges?.deref()!.set(encodeFlatStorageKey(id), { id, projection: undefined })
    })
  }

  /** Publish the original repository methods without exposing its internal state. */
  #createApi = (): IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods> => ({
    query: (...args) => this.#query.apiQuery(...args),
    get: this.#apiGet,
    put: this.#apiPut,
    remove: this.#apiRemove,
    list: (...args) => this.#query.apiList(...args),
    stream: (...args) => this.#query.apiStream(...args),
    findBy: (...args) => this.#indexes.apiFindBy(...args),
    migrate: (...args) => this.#migration.apiMigrate(...args),
    in: this.#apiIn,
    lockKey: this.#apiLockKey,
    batch: this.#apiBatch
  })
  /** Perform the public get operation using this repository state. */
  #apiGet: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['get'] = async (
    id,
    ctx
  ) => {
    this.assertCurrent()
    const context = snapshotOperationContext(ctx)
    const runtime = createStorageOperationRuntime()
    assertStorageKey(id, this.#store.backend, `entity "${this.#name}" id`)
    return this.#codec.materializeForRead(
      id,
      await this.#codec.readEnvelope(id, context, runtime),
      context,
      runtime
    )
  }
  /** Perform the public put operation using this repository state. */
  #apiPut: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['put'] = async (
    value,
    ctx
  ) => {
    this.assertCurrent()
    if (this.#recordStore !== undefined)
      return this.#recordStore.transaction((scope) => this.#bindRepository(scope).put(value), ctx)
    if (this.#uniqueDefinitions.length !== 0 && getBackendValueCommit(this.#store) === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: this.#store.backend
      })
    const context = snapshotOperationContext(ctx)
    const runtime = createStorageOperationRuntime()
    const prepared = await this.#codec.toEnvelope(value, context, runtime)
    const id = idOf(this.#name, this.#keyProp, prepared.domain, this.#store.backend)
    if (this.#uniqueDefinitions.length > 0)
      await this.#unique.writeUniqueValue(id, prepared.domain, prepared.envelope, context)
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
    this.assertCurrent()
    if (this.#recordStore !== undefined)
      return this.#recordStore.transaction((scope) => this.#bindRepository(scope).remove(id), ctx)
    assertStorageKey(id, this.#store.backend)
    await this.#store.remove(composeFlatKey(this.#name, id), ctx)
  }

  /** Perform the public in operation using this repository state. */
  #apiIn: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['in'] = (scope) =>
    this.#bindRepository(scope)
  /** Perform the public lockKey operation using this repository state. */
  #apiLockKey: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['lockKey'] = (id) => {
    this.assertCurrent()
    assertStorageKey(id, this.#store.backend)
    return this.#records
      ? lockKey.record(composeRepositoryKey(this.#name, id))
      : lockKey.text(composeFlatKey(this.#name, id))
  }
  /** Perform the public batch operation using this repository state. */
  #apiBatch: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['batch'] = (run, ctx) => {
    try {
      this.assertCurrent()
    } catch (cause) {
      return Promise.reject(cause)
    }
    if (typeof run !== 'function')
      return Promise.reject(
        new StorageError(StorageHostErrorCode.invalidConfig, {
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
    return this.feature<IEntityKeysetOwner>(EntityFeatureName.keyset).run
  }
  /** An absent keyset unit never imports or constructs its query implementation. */
  get keysetQuery(): IEntityKeysetOwner['query'] | undefined {
    return (this.#features.get(EntityFeatureName.keyset) as IEntityKeysetOwner | undefined)?.query
  }
  /** Reuse the native entity registration signal; no repository lifecycle state is introduced. */
  assertCurrent(): void {
    throwIfAborted(this.#config.signal)
  }
  /** The existing iterator owner borrows this signal for retained stream next calls. */
  get signal() {
    return this.#config.signal
  }
  /** Read only assembly presence; this never constructs another capability. */
  hasFeature(name: string): boolean {
    return this.#features.has(name)
  }
  /** Only explicitly supplied feature units retain their implementation owners. */
  #features = new Map<string, object>()
  /** Resolve one required assembly without enabling any other capability. */
  feature<T extends object>(name: string): T {
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
    return this.#indexes.backfillIndexes
  }
  /** Internal port shares the original writeEnvelopeAt fact or operation with an assembled owner. */
  get writeEnvelopeAt() {
    return this.#writeEnvelopeAt
  }

  /** Internal port shares the original encodeEnvelope fact or operation with an assembled owner. */
  get encodeEnvelope() {
    return this.#codec.encodeEnvelope
  }
  /** Internal port shares the original materialize fact or operation with an assembled owner. */
  get materialize() {
    return this.#codec.materialize
  }
  /** Internal port shares the original toEnvelope fact or operation with an assembled owner. */
  get toEnvelope() {
    return this.#codec.toEnvelope
  }
  /** Internal port shares the original decodeEnvelope fact or operation with an assembled owner. */
  get decodeEnvelope() {
    return this.#codec.decodeEnvelope
  }
  /** Internal port shares the original invalidAction fact or operation with an assembled owner. */
  get invalidAction() {
    return this.#query.invalidAction
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
    return this.#query.normalizeListOptions
  }
  /**
   * Internal port shares the original snapshotIndexedListOptions fact or operation with an
   * assembled owner.
   */
  get snapshotIndexedListOptions() {
    return this.#indexes.snapshotIndexedListOptions
  }
  /**
   * Internal port shares the original createIndexedListSnapshot fact or operation with an assembled
   * owner.
   */
  get createIndexedListSnapshot() {
    return this.#indexes.createIndexedListSnapshot
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
    const feature = this.#query
    return (...args: Parameters<typeof feature.streamImpl>) => feature.streamImpl(...args)
  }

  /** Internal port shares the original projectUniqueWrite fact or operation with an assembled owner. */
  get projectUniqueWrite() {
    return this.#unique.projectUniqueWrite
  }

  /**
   * Internal port shares the original validateUniqueRecordCommit fact or operation with an
   * assembled owner.
   */
  get validateUniqueRecordCommit() {
    return this.#unique.validateUniqueRecordCommit
  }

  /** Internal port shares the original writeUniqueValue fact or operation with an assembled owner. */
  get writeUniqueValue() {
    return this.#unique.writeUniqueValue
  }
  /** Internal port shares the original encodeIndexOrder fact or operation with an assembled owner. */
  get encodeIndexOrder() {
    return this.#indexes.encodeIndexOrder
  }
  /** Internal port shares the original indexRows fact or operation with an assembled owner. */
  get indexRows() {
    return this.#indexes.indexRows
  }
  /** Internal port shares the original createIndexQuery fact or operation with an assembled owner. */
  get createIndexQuery() {
    return this.#indexes.createIndexQuery
  }

  /** Internal port shares the original queryIndex fact or operation with an assembled owner. */
  get queryIndex() {
    return this.#indexes.queryIndex
  }

  /** Internal port shares the original planEntitySource fact or operation with an assembled owner. */
  get planEntitySource() {
    return this.#indexes.planEntitySource
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
