import { systemScheduler } from '@migaia/utils/scheduler'
import {
  getBackendEnvelopeStages,
  getBackendValueCommit,
  type IEntitySecondaryMethods,
  type IEntityRecordMethods
} from '../core/backend-registry.js'
import { repositoryMigrationKey } from '../core/record-layout.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ITransactionScope,
  isStorageContractError,
  type IRecordIndexHandle
} from '@migaia/storage-contract'
import { encodeOrderedStorageKey } from '../authoring/key.js'
import { readTransactionOperationContext } from '../authoring/transaction.js'
import { migrateEnvelope } from '../authoring/migration.js'
import { StorageError, StorageErrorCode } from '../errors.js'

import {
  composeFlatKey,
  composeRepositoryKey,
  decodeRepositoryKey,
  flatKeyPrefix,
  repositoryEntityRange
} from './key.js'
import { decodeFlatStorageKey, encodeFlatStorageKey } from '../core/key-domain.js'

import { createStorageOperationRuntime, reportCleanupError } from '../core/operation-reporter.js'
import { EntityText } from './text.js'
import { snapshotOperationContext } from '../authoring/context.js'
import type { IOperationContext, IStorageKey } from '@migaia/storage-contract'

import type { IInvalidRecordIssue, IMigrateOptions, IRepository } from './types.js'
import { projectEntityIndexes } from './index-projection.js'
import { createOrderedRecordIndex } from '../core/ordered-record-index.js'

import {
  StorageMigrationPhase,
  StorageMigrationStatus,
  StorageInvalidRecordAction,
  StorageOperation,
  StorageRecordStage
} from './constants.js'
import {
  IEntityOperationRuntime,
  IEnvelope,
  IStageFailure,
  IEntityUniqueMutation,
  normalizeError,
  IEntityMigrationContext,
  IEntityMigrationCheckpoint
} from './repository-shared.js'

import type { EntityRepositoryOwner } from './repository.js'

/** Own only the explicitly assembled migration operations; the repository retains storage state. */
export class EntityMigrationOwner<
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {},
  TChangeFeed extends boolean = false
> {
  /** Borrow the original repository state and operations without another executor. */
  readonly #context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  /** Capture the original owner before this feature publishes any methods. */
  constructor(
    context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  ) {
    this.#context = context
  }

  /** Reuse the original repository operation through its explicit owner context. */
  normalizeMigrateOptions = (
    options: IMigrateOptions<TDomain>
  ): { readonly batchSize: number; readonly onInvalid: IMigrateOptions<TDomain>['onInvalid'] } => {
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new TypeError(EntityText.migrateOptionsMustBeAnObject)
      })
    let batchSize: IMigrateOptions<TDomain>['batchSize']
    let onInvalid: IMigrateOptions<TDomain>['onInvalid']
    batchSize = options.batchSize
    onInvalid = options.onInvalid

    const normalizedBatchSize = batchSize === undefined ? 100 : batchSize
    if (!Number.isSafeInteger(normalizedBatchSize) || normalizedBatchSize < 1)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend: this.#context.store.backend,
        cause: new RangeError(EntityText.migrateBatchSizeMustBeAPositiveSafeInteger)
      })
    this.#context.validateInvalidHandler(onInvalid)
    return { batchSize: normalizedBatchSize, onInvalid }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  apiMigrate: IRepository<TDomain, TIndexes, TChangeFeed, TAugmentMethods>['migrate'] = async (
    options: IMigrateOptions<TDomain> = {},
    ctx
  ) => {
    /** Migration progress belongs to this run and its existing checkpoint. */
    const migration = {} as IEntityMigrationContext<TDomain>
    if (
      this.#context.recordStore === undefined &&
      this.#context.uniqueDefinitions.length !== 0 &&
      getBackendValueCommit(this.#context.store) === undefined
    )
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: this.#context.store.backend
      })
    migration.context = snapshotOperationContext(ctx)
    migration.runtime = createStorageOperationRuntime()
    ;({ batchSize: migration.batchSize, onInvalid: migration.onInvalid } =
      this.normalizeMigrateOptions(options))
    migration.migrationMetadata = this.#context.recordStore?.metadata
    migration.checkpointKey = repositoryMigrationKey(this.#context.name)
    migration.checkpoint = (await migration.migrationMetadata?.get(
      migration.checkpointKey,
      migration.context
    )) as IEntityMigrationCheckpoint | undefined
    migration.checkpointMatches =
      migration.checkpoint?.status === StorageMigrationStatus.running &&
      migration.checkpoint.version === this.#context.version &&
      migration.checkpoint.schemaFingerprint === this.#context.migrationFingerprint
    migration.scanned = migration.checkpointMatches ? migration.checkpoint!.scanned : 0
    migration.migrated = migration.checkpointMatches ? migration.checkpoint!.migrated : 0
    migration.eligible = migration.checkpointMatches ? migration.checkpoint!.eligible : 0
    migration.alreadyCurrent = migration.checkpointMatches
      ? migration.checkpoint!.alreadyCurrent
      : 0
    migration.skipped = migration.checkpointMatches ? migration.checkpoint!.skipped : 0
    migration.conflicted = migration.checkpointMatches ? migration.checkpoint!.conflicted : 0
    migration.lastPhysicalKey = migration.checkpointMatches
      ? migration.checkpoint!.lastPhysicalKey
      : undefined
    migration.phase = migration.checkpointMatches
      ? (migration.checkpoint!.phase ?? StorageMigrationPhase.legacy)
      : StorageMigrationPhase.v2
    migration.batch = []
    if (this.#context.recordStore)
      await this.scanMigrationRecords(migration, this.#context.recordStore)
    else await this.scanMigrationValues(migration)
    await this.persistMigrationBatch(migration)
    await this.writeMigrationCheckpoint(migration, {
      status: StorageMigrationStatus.complete,
      phase: migration.phase,
      version: this.#context.version,
      schemaFingerprint: this.#context.migrationFingerprint,
      lastPhysicalKey: migration.lastPhysicalKey,
      scanned: migration.scanned,
      eligible: migration.eligible,
      migrated: migration.migrated,
      skipped: migration.skipped,
      alreadyCurrent: migration.alreadyCurrent,
      conflicted: migration.conflicted
    })
    return {
      scanned: migration.scanned,
      eligible: migration.eligible,
      migrated: migration.migrated,
      skipped: migration.skipped,
      alreadyCurrent: migration.alreadyCurrent,
      conflicted: migration.conflicted
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  scanMigrationRecords = async (
    migration: IEntityMigrationContext<TDomain>,
    recordStore: IEntityRecordMethods
  ): Promise<void> => {
    const phases =
      migration.phase === StorageMigrationPhase.v2
        ? [StorageMigrationPhase.v2, StorageMigrationPhase.legacy]
        : [StorageMigrationPhase.legacy]
    for (const scanPhase of phases) {
      migration.phase = scanPhase
      if (
        scanPhase !==
        (migration.checkpointMatches
          ? (migration.checkpoint!.phase ?? StorageMigrationPhase.legacy)
          : StorageMigrationPhase.v2)
      )
        migration.lastPhysicalKey = undefined
      const entityRange = repositoryEntityRange(this.#context.name)
      const migrationRange =
        scanPhase === StorageMigrationPhase.v2
          ? migration.lastPhysicalKey
            ? { ...entityRange, lower: migration.lastPhysicalKey, lowerOpen: true }
            : entityRange
          : migration.lastPhysicalKey
            ? { lower: migration.lastPhysicalKey, lowerOpen: true }
            : undefined
      for await (const [physicalKey, raw] of recordStore.iterateRecords(
        migrationRange,
        migration.context
      )) {
        migration.lastPhysicalKey = physicalKey
        const v2RecordId = decodeRepositoryKey(this.#context.name, physicalKey)
        const legacy =
          v2RecordId === undefined &&
          Array.isArray(physicalKey) &&
          physicalKey.length === 2 &&
          physicalKey[0] === this.#context.name
        const recordId = v2RecordId ?? (legacy ? (physicalKey[1] as IStorageKey) : undefined)
        if (scanPhase === StorageMigrationPhase.v2 && v2RecordId === undefined) continue
        if (scanPhase === StorageMigrationPhase.legacy && !legacy) continue
        if (recordId === undefined) continue
        migration.scanned += 1
        let envelope: IEnvelope
        try {
          envelope = await this.#context.decodeEnvelope(raw, migration.context, migration.runtime)
          /** Eligible records are materialized only under the commit transaction's read set. */
          const value =
            envelope.version >= this.#context.version
              ? await this.#context.materialize(envelope, migration.context, migration.runtime)
              : undefined
          if (envelope.version >= this.#context.version && value === undefined) continue
          if (envelope.version >= this.#context.version) {
            migration.alreadyCurrent += 1
            // A current-version legacy envelope still requires physical relocation before
            // migration completion can prove that entity queries may stop scanning legacy.
            if (legacy)
              migration.batch.push({
                physicalKey,
                raw,
                id: recordId,
                legacy,
                migrationRequired: false,
                value
              })
            continue
          }
          migration.eligible += 1
          migration.batch.push({
            physicalKey,
            raw,
            id: recordId,
            legacy,
            migrationRequired: true,
            value
          })
        } catch (cause) {
          const issue: IInvalidRecordIssue<TDomain> = {
            key: recordId,
            raw,
            stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.decode,
            cause
          }
          const action = this.#context.invokeInvalidHandler(migration.onInvalid, issue)
          if (action === StorageInvalidRecordAction.throw) this.#context.throwInvalid(issue)
          migration.skipped += 1
        }
        if (migration.batch.length >= migration.batchSize)
          await this.persistMigrationBatch(migration)
      }
      if (scanPhase === StorageMigrationPhase.v2 && phases.length > 1) {
        migration.phase = StorageMigrationPhase.legacy
        migration.lastPhysicalKey = undefined
        await this.writeMigrationCheckpoint(migration, {
          status: StorageMigrationStatus.running,
          phase: migration.phase,
          version: this.#context.version,
          schemaFingerprint: this.#context.migrationFingerprint,
          scanned: migration.scanned,
          eligible: migration.eligible,
          migrated: migration.migrated,
          skipped: migration.skipped,
          alreadyCurrent: migration.alreadyCurrent,
          conflicted: migration.conflicted
        })
      }
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  scanMigrationValues = async (migration: IEntityMigrationContext<TDomain>): Promise<void> => {
    const prefix = flatKeyPrefix(this.#context.name)
    /** Migration traverses the same canonical ordered structure without a second sorting path. */
    const keys = createOrderedRecordIndex<{
      readonly rawKey: string
      readonly id: IStorageKey
    }>()
    for (const rawKey of await this.#context.store.keys(migration.context)) {
      if (!rawKey.startsWith(prefix)) continue
      const id = decodeFlatStorageKey(rawKey.slice(prefix.length))
      if (id !== undefined)
        keys.set(encodeOrderedStorageKey(id, this.#context.store.backend), { rawKey, id })
    }
    for (const {
      value: { rawKey, id }
    } of keys.range()) {
      const raw = await this.#context.store.get(rawKey, migration.context)
      if (raw === null) continue
      migration.scanned += 1
      try {
        const envelope = await this.#context.decodeEnvelope(
          raw,
          migration.context,
          migration.runtime
        )
        const value = await this.#context.materialize(
          envelope,
          migration.context,
          migration.runtime
        )
        if (value === undefined) continue
        if (envelope.version >= this.#context.version) {
          migration.alreadyCurrent += 1
          continue
        }
        migration.eligible += 1
        migration.batch.push({
          physicalKey: rawKey,
          raw,
          id,
          legacy: false,
          migrationRequired: true,
          value
        })
      } catch (cause) {
        const issue: IInvalidRecordIssue<TDomain> = {
          key: id,
          raw,
          stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.decode,
          cause
        }
        const action = this.#context.invokeInvalidHandler(migration.onInvalid, issue)
        if (action === StorageInvalidRecordAction.throw) this.#context.throwInvalid(issue)
        migration.skipped += 1
      }
      if (migration.batch.length >= migration.batchSize) await this.persistMigrationBatch(migration)
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  executeMigrationBatch = async (
    migration: IEntityMigrationContext<TDomain>,
    indexedHandle: IRecordIndexHandle | undefined,
    tx: ITransactionScope,
    indexed: boolean
  ) => {
    /** Publish counts only after this transaction commits, including invalid-record policy. */
    const transactionContext = readTransactionOperationContext(tx)
    const currentIndexed =
      indexed &&
      indexedHandle !== undefined &&
      (await tx.isRecordIndexReady?.(indexedHandle)) === true
    const counts = { migrated: 0, alreadyCurrent: 0, skipped: 0, invalidEligible: 0 }
    /** Written rows supply prepared projections; unchanged rows use the transactional view. */
    const uniqueChanges = new Map<string, IEntityUniqueMutation>()
    for (const entry of migration.batch) {
      /** Every write is derived from a read tracked by this transaction. */
      const currentRaw = await tx.getRecord(entry.physicalKey)
      if (currentRaw === undefined) continue
      if (entry.legacy) {
        /** An authoritative current-layout record wins over an obsolete legacy copy. */
        const existingTarget = await tx.getRecord(
          composeRepositoryKey(this.#context.name, entry.id)
        )
        if (existingTarget !== undefined) {
          await tx.deleteRecord(entry.physicalKey)
          continue
        }
      }
      /** Keep decoding/migration failures under the existing per-record invalid policy. */
      let currentValue: TDomain | undefined
      try {
        /** A concurrent current-version update must not be rewritten by this migration. */
        const currentEnvelope = await this.#context.decodeEnvelope(
          currentRaw,
          transactionContext,
          migration.runtime
        )
        if (!entry.legacy && currentEnvelope.version >= this.#context.version) {
          counts.alreadyCurrent += 1
          continue
        }
        currentValue = await this.#context.materialize(
          currentEnvelope,
          transactionContext,
          migration.runtime
        )
      } catch (cause) {
        /** The issue reports the actual transactional value, not stale scan data. */
        const issue: IInvalidRecordIssue<TDomain> = {
          key: entry.id,
          raw: currentRaw,
          stage: (cause as Partial<IStageFailure>).stage ?? StorageRecordStage.decode,
          cause
        }
        if (
          this.#context.invokeInvalidHandler(migration.onInvalid, issue) ===
          StorageInvalidRecordAction.throw
        )
          this.#context.throwInvalid(issue)
        counts.skipped += 1
        if (entry.migrationRequired) counts.invalidEligible += 1
        continue
      }
      if (currentValue === undefined) {
        if (entry.migrationRequired) counts.invalidEligible += 1
        continue
      }
      /** Preparation retains the existing write-side schema/codec validation boundary. */
      const prepared = await this.#context.toEnvelope(
        currentValue,
        transactionContext,
        migration.runtime
      )
      /** Native and fallback paths write the same current envelope. */
      const raw = await this.#context.encodeEnvelope(
        prepared.envelope,
        transactionContext,
        migration.runtime
      )
      if (currentIndexed && indexedHandle !== undefined && tx.putIndexedRecord !== undefined)
        await tx.putIndexedRecord(
          raw,
          composeRepositoryKey(this.#context.name, entry.id),
          indexedHandle,
          projectEntityIndexes(
            this.#context.config.indexes,
            prepared.domain,
            this.#context.store.backend
          ),
          { conflictPolicy: 'replace' }
        )
      else
        await tx.putRecord(raw, composeRepositoryKey(this.#context.name, entry.id), {
          conflictPolicy: 'replace'
        })
      if (entry.legacy) await tx.deleteRecord(entry.physicalKey)
      if (!currentIndexed && this.#context.uniqueDefinitions.length > 0)
        uniqueChanges.set(encodeFlatStorageKey(entry.id), {
          id: entry.id,
          projection: this.#context.projectUniqueWrite(prepared.domain)
        })
      if (entry.migrationRequired) counts.migrated += 1
    }
    if (!currentIndexed && this.#context.uniqueDefinitions.length > 0)
      await this.#context.validateUniqueRecordCommit(
        tx,
        uniqueChanges,
        transactionContext,
        migration.runtime
      )
    return counts
  }
  /** Reuse the original repository operation through its explicit owner context. */
  retryMigrationEntry = async (
    migration: IEntityMigrationContext<TDomain>,
    indexedHandle: IRecordIndexHandle | undefined,
    entry: IEntityMigrationContext<TDomain>['batch'][number],
    tx: ITransactionScope
  ) => {
    const retryContext = readTransactionOperationContext(tx)
    const currentIndexed =
      indexedHandle !== undefined && (await tx.isRecordIndexReady?.(indexedHandle)) === true
    const targetRaw = await tx.getRecord(composeRepositoryKey(this.#context.name, entry.id))
    if (targetRaw !== undefined) {
      const targetEnvelope = await this.#context.decodeEnvelope(
        targetRaw,
        retryContext,
        migration.runtime
      )
      if (targetEnvelope.version >= this.#context.version) {
        if (entry.legacy) await tx.deleteRecord(entry.physicalKey)
        return 'alreadyCurrent' as const
      }
    }
    const currentRaw = await tx.getRecord(entry.physicalKey)
    if (currentRaw === undefined) return 'missing' as const
    const currentEnvelope = await this.#context.decodeEnvelope(
      currentRaw,
      retryContext,
      migration.runtime
    )
    const currentValue = await this.#context.materialize(
      currentEnvelope,
      retryContext,
      migration.runtime
    )
    if (currentValue === undefined) return 'missing' as const
    if (currentEnvelope.version >= this.#context.version) return 'alreadyCurrent' as const
    const prepared = await this.#context.toEnvelope(currentValue, retryContext, migration.runtime)
    const nextRaw = await this.#context.encodeEnvelope(
      prepared.envelope,
      retryContext,
      migration.runtime
    )
    if (currentIndexed && indexedHandle !== undefined && tx.putIndexedRecord !== undefined)
      await tx.putIndexedRecord(
        nextRaw,
        composeRepositoryKey(this.#context.name, entry.id),
        indexedHandle,
        projectEntityIndexes(
          this.#context.config.indexes,
          prepared.domain,
          this.#context.store.backend
        ),
        { conflictPolicy: 'replace' }
      )
    else
      await tx.putRecord(nextRaw, composeRepositoryKey(this.#context.name, entry.id), {
        conflictPolicy: 'replace'
      })
    if (entry.legacy) await tx.deleteRecord(entry.physicalKey)
    if (!currentIndexed && this.#context.uniqueDefinitions.length > 0)
      await this.#context.validateUniqueRecordCommit(
        tx,
        new Map([
          [
            encodeFlatStorageKey(entry.id),
            {
              id: entry.id,
              projection: projectEntityIndexes(
                this.#context.uniqueIndexes,
                prepared.domain,
                this.#context.store.backend
              )
            }
          ]
        ]),
        retryContext,
        migration.runtime
      )
    return 'migrated' as const
  }
  /** Reuse the original repository operation through its explicit owner context. */
  writeMigrationCheckpoint = async (
    migration: IEntityMigrationContext<TDomain>,
    value: unknown
  ): Promise<void> => {
    if (migration.migrationMetadata)
      await migration.migrationMetadata.set(migration.checkpointKey, value, migration.context)
  }
  /** Reuse the original repository operation through its explicit owner context. */
  persistMigrationBatch = async (migration: IEntityMigrationContext<TDomain>): Promise<void> => {
    if (migration.batch.length === 0) return
    if (!this.#context.recordStore) {
      for (const entry of migration.batch) {
        const prepared = await this.#context.toEnvelope(
          entry.value!,
          migration.context,
          migration.runtime
        )
        const nextKey = composeFlatKey(this.#context.name, entry.id)
        if (this.#context.uniqueDefinitions.length > 0)
          await this.#context.writeUniqueValue(
            entry.id,
            prepared.domain,
            prepared.envelope,
            migration.context
          )
        else
          await this.#context.writeEnvelopeAt(
            { flatKey: nextKey },
            prepared.envelope,
            migration.context,
            migration.runtime
          )
      }
      migration.migrated += migration.batch.length
    } else {
      let indexedStore: IEntitySecondaryMethods | undefined
      let indexedHandle: IRecordIndexHandle | undefined
      try {
        indexedStore =
          Object.keys(this.#context.config.indexes).length > 0
            ? this.#context.backend.secondaryStore()
            : undefined
        /** Materialize the transaction's current snapshot once, not the earlier scan value. */

        if (indexedStore !== undefined) {
          indexedHandle = await indexedStore.ensureRecordIndexes(
            this.#context.name,
            Object.values(this.#context.config.indexes).map((index) => index.definition),
            migration.context
          )
          const readiness = await indexedStore.getRecordIndexReadiness(
            indexedHandle,
            migration.context
          )
          if (readiness.status !== 'complete') indexedHandle = undefined
        }
        /** One callback owns migration semantics; backend adapters only supply their scope. */
        const batchOutcome = await this.#context.recordStore.transaction(
          (tx) =>
            this.executeMigrationBatch(migration, indexedHandle, tx, indexedHandle !== undefined),
          migration.context
        )
        migration.migrated += batchOutcome.migrated
        migration.alreadyCurrent += batchOutcome.alreadyCurrent
        migration.skipped += batchOutcome.skipped
        migration.eligible -= batchOutcome.invalidEligible
      } catch (cause) {
        if (
          isStorageContractError(cause) &&
          cause.code === StorageContractErrorCode.writeConflict
        ) {
          for (const entry of migration.batch) {
            try {
              const retryOutcome = await this.#context.recordStore.transaction(
                (tx) => this.retryMigrationEntry(migration, indexedHandle, entry, tx),
                migration.context
              )
              if (retryOutcome === 'migrated') migration.migrated += 1
              if (retryOutcome === 'alreadyCurrent') migration.alreadyCurrent += 1
            } catch (retryCause) {
              if (
                isStorageContractError(retryCause) &&
                retryCause.code === StorageContractErrorCode.writeConflict
              ) {
                migration.conflicted += 1
                continue
              }
              throw normalizeError(
                retryCause,
                this.#context.store.backend,
                StorageErrorCode.transactionFailed,
                'entity.migrate'
              )
            }
          }
        } else {
          throw normalizeError(
            cause,
            this.#context.store.backend,
            StorageErrorCode.transactionFailed,
            'entity.migrate'
          )
        }
      }
    }
    await this.writeMigrationCheckpoint(migration, {
      status: StorageMigrationStatus.running,
      phase: migration.phase,
      version: this.#context.version,
      schemaFingerprint: this.#context.migrationFingerprint,
      lastPhysicalKey: migration.lastPhysicalKey,
      scanned: migration.scanned,
      eligible: migration.eligible,
      migrated: migration.migrated,
      skipped: migration.skipped,
      alreadyCurrent: migration.alreadyCurrent,
      conflicted: migration.conflicted
    })
    migration.batch.length = 0
  }
  /** Upgrade only a mismatched envelope through the canonical migration owner. */
  materializeEnvelope = async (
    envelope: IEnvelope,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<unknown> => {
    /** Observation borrows this original host row and the shared plan's actual execution. */
    const stages = getBackendEnvelopeStages(this.#context.store, {
      operation: StorageOperation.entityEnvelope,
      targetVersion: this.#context.version
    })
    /** Timing observes only a real migration; the shared executor owns all steps and cancellation. */
    const started = stages === undefined ? 0 : systemScheduler.now()
    let stored: unknown
    try {
      stored = await migrateEnvelope(this.#context.migrationPlan!, envelope, {
        signal: ctx?.signal,
        report: (cause) => reportCleanupError(runtime.reporter, cause),
        observe: stages?.observe
      })
    } catch (cause) {
      if (
        isStorageContractError(cause) &&
        cause.code === StorageContractErrorCode.versionUnsupported
      ) {
        stages?.onVersionRejected(envelope.version, cause.code)
        throw new StorageError(StorageErrorCode.versionUnsupported, { cause })
      }
      if (isStorageContractError(cause) && cause.code === StorageContractErrorCode.migrationFailed)
        throw new StorageError(
          StorageErrorCode.migrationFailed,
          { cause },
          undefined,
          StorageRecordStage.migrate
        )
      throw cause
    }
    if (envelope.version !== this.#context.version)
      stages?.afterMigrate(
        this.#context.version,
        this.#context.migrationPlan!.reset === undefined ? 'steps' : 'reset',
        this.#context.migrationPlan!.reset === undefined
          ? this.#context.version - envelope.version
          : 0,
        systemScheduler.now() - started
      )
    return stored
  }
}
