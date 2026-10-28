// Codec, schema and envelope conversion for one entity repository (see ./repository.ts).
import { EntityFeatureName } from './constants.ts'
import {
  getBackendEnvelopeStages,
  type IEntityKeyValueMethods,
  type IEntityRecordMethods
} from '../core/backend-registry.ts'
import {
  assertVersionedEnvelope,
  StorageContractErrorCode,
  type ICodecStageObserver
} from '@migaia/storage-contract'
import { isStorageErrorFamily } from '../core/error-family.ts'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { readStorageHookFailureCode } from '../hooks.ts'
import { composeFlatKey, composeRepositoryKey, composeStructuredKey } from './key.ts'
import { invokeExtension } from '../core/invoke-extension.ts'
import type { IOperationContext, IStorageKey } from '@migaia/storage-contract'
import type { ISchemaAdapter } from '../entity.ts'
import type { ISelectedCodec } from '../entity.ts'
import { StorageOperation, StorageRecordStage } from './constants.ts'
import {
  IEntityOperationRuntime,
  observeEntity,
  IEnvelope,
  IStageFailure,
  stageFailure
} from './repository-shared.ts'
import type { EntityMigrationOwner } from './migration-owner.ts'
import type { EntityRepositoryOwner } from './repository.ts'

/** Immutable codec, schema and storage facts the repository selects before publication. */
export type IEntityRecordCodecState<TDomain, TStored> = {
  readonly store: IEntityKeyValueMethods
  readonly name: string
  readonly version: number
  readonly schema: ISchemaAdapter<TDomain, TStored>
  readonly validateOnRead: boolean
  readonly codecStages: ICodecStageObserver | undefined
  readonly recordStore: IEntityRecordMethods | undefined
  readonly selectedCodec: ISelectedCodec
  readonly codecName: string
}

/** Own codec selection, schema conversion and envelope checks for one entity repository. */
export class EntityRecordCodec<
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {},
  TChangeFeed extends boolean = false
> {
  /** The repository that owns migration features for envelopes at older versions. */
  readonly #owner: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  /** Borrowed text methods carry business access without native disposal authority. */
  readonly #store: IEntityKeyValueMethods
  /** The entity name separates physical keys across definitions. */
  readonly #name: string
  /** Materialization and migration write envelopes at this target version. */
  readonly #version: number
  /** The original schema object receives validation and conversion calls with its receiver. */
  readonly #schema: ISchemaAdapter<TDomain, TStored>
  /** Read materialization validates domain data only when the declaration enables it. */
  readonly #validateOnRead: boolean
  /** The codec observer receives conversion phases for this repository and its transactions. */
  readonly #codecStages: ICodecStageObserver | undefined
  /** Optional borrowed record methods choose structured reads instead of text fallback. */
  readonly #recordStore: IEntityRecordMethods | undefined
  /** The one codec selected for every repository path. */
  readonly #selectedCodec: ISelectedCodec
  /** The selected route preserves the original codec identity for observation. */
  readonly #codecName: string

  /** Capture the owning repository and the codec facts it selected. */
  constructor(
    owner: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>,
    state: IEntityRecordCodecState<TDomain, TStored>
  ) {
    this.#owner = owner
    this.#store = state.store
    this.#name = state.name
    this.#version = state.version
    this.#schema = state.schema
    this.#validateOnRead = state.validateOnRead
    this.#codecStages = state.codecStages
    this.#recordStore = state.recordStore
    this.#selectedCodec = state.selectedCodec
    this.#codecName = state.codecName
  }

  /** Every real conversion emits exactly one matching observation sequence. */
  codecCall = async <R>(
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
  encodeEnvelope = (
    envelope: IEnvelope,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<unknown> =>
    this.codecCall(
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
  materialize = async (
    envelope: IEnvelope | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<TDomain | undefined> => {
    if (!envelope) return undefined
    const stored =
      envelope.version === this.#version
        ? envelope.state
        : await this.#owner
            .feature<
              EntityMigrationOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
            >(EntityFeatureName.migration)
            .materializeEnvelope(envelope, ctx, runtime)
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
  toEnvelope = async (
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
      throw new StorageError(StorageHostErrorCode.serializeFailed, { cause })
    }
  }

  /** Perform the repository decodeEnvelope operation using its own state. */
  decodeEnvelope = async (
    raw: unknown,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<IEnvelope> => {
    const decoded: unknown = await this.codecCall(
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
      throw new StorageError(StorageHostErrorCode.deserializeFailed, { cause })
    }
  }

  /** Perform the repository materializeForRead operation using its own state. */
  materializeForRead = async (
    id: IStorageKey,
    envelope: IEnvelope | undefined,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<TDomain | undefined> => {
    try {
      return await this.materialize(envelope, ctx, runtime)
    } catch (cause) {
      /* c8 ignore start -- materialize's extension boundaries already return StorageError. */
      if (isStorageErrorFamily(cause)) throw cause
      const stage = (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.validate
      const code =
        stage === StorageRecordStage.migrate
          ? StorageHostErrorCode.migrationFailed
          : stage === StorageRecordStage.decode
            ? StorageHostErrorCode.deserializeFailed
            : StorageHostErrorCode.validationFailed
      throw new StorageError(code, { backend: this.#store.backend, key: id, cause })
    }
  }

  /** Perform the repository readEnvelope operation using its own state. */
  readEnvelope = async (
    id: IStorageKey,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<IEnvelope | undefined> => {
    if (this.#recordStore) {
      let raw = await this.#recordStore.getRecord(composeRepositoryKey(this.#name, id), ctx)
      if (raw === undefined)
        raw = await this.#recordStore.getRecord(composeStructuredKey(this.#name, id), ctx)
      if (raw === undefined) return undefined
      return this.decodeEnvelope(raw, ctx, runtime)
    }
    const raw = await this.#store.get(composeFlatKey(this.#name, id), ctx)
    if (raw === null) return undefined
    return this.decodeEnvelope(raw, ctx, runtime)
  }
}
