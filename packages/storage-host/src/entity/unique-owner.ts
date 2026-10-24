import {
  registerTransactionFinalizer,
  readTransactionOperationContext
} from '../authoring/transaction.js'
import type { ITransactionInfo } from '@migaia/storage-contract'
import { entityRuntime } from './repository-shared.js'
import { getBackendValueCommit } from '../core/backend-registry.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ITransactionScope,
  type IRecordIndexProjection
} from '@migaia/storage-contract'

import { StorageErrorCode } from '../errors.js'

import {
  composeFlatKey,
  composeRepositoryKey,
  composeStructuredKey,
  flatKeyPrefix,
  repositoryUniqueWriteKey
} from './key.js'
import { encodeFlatStorageKey } from '../core/key-domain.js'

import { withAbort } from '../core/operation.js'

import type { IOperationContext, IStorageKey } from '@migaia/storage-contract'

import { projectEntityIndexes } from './index-projection.js'
import { collectUniqueIndexOwners } from '../core/unique-index.js'

import { StorageOperation } from './constants.js'
import {
  IEntityOperationRuntime,
  IEnvelope,
  IRepositoryReadView,
  IEntityUniqueMutation,
  normalizeError,
  idOf
} from './repository-shared.js'

import type { EntityRepositoryOwner } from './repository.js'

/** Own only the explicitly assembled unique operations; the repository retains storage state. */
export class EntityUniqueOwner<
  TDomain,
  TStored,
  TIndexes extends Readonly<Record<string, IStorageKey>> = Readonly<Record<never, IStorageKey>>,
  TAugmentMethods extends object = {},
  TChangeFeed extends boolean = false
> {
  /** Active original transactions own their unique draft changes until the canonical finalizer runs. */
  #states = new WeakMap<ITransactionInfo, WeakRef<Map<string, IEntityUniqueMutation>>>()
  /** Register the original one-shot validation on the authentic transaction, with no parallel owner. */
  bindChanges = (
    scope: ITransactionScope,
    info: ITransactionInfo
  ): WeakRef<Map<string, IEntityUniqueMutation>> | undefined => {
    let stateReference = this.#states.get(info)
    if (this.#context.uniqueDefinitions.length !== 0 && stateReference?.deref() === undefined) {
      const changes = new Map<string, IEntityUniqueMutation>()
      stateReference = new WeakRef(changes)
      this.#states.set(info, stateReference)
      registerTransactionFinalizer(scope, async (check) => {
        try {
          await this.validateUniqueRecordCommit(
            check,
            changes,
            readTransactionOperationContext(check),
            entityRuntime(check)
          )
        } finally {
          changes.clear()
          this.#states.delete(info)
        }
      })
    }
    return stateReference
  }
  /** Borrow the original repository state and operations without another executor. */
  readonly #context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  /** Capture the original owner before this feature publishes any methods. */
  constructor(
    context: EntityRepositoryOwner<TDomain, TStored, TIndexes, TAugmentMethods, TChangeFeed>
  ) {
    this.#context = context
  }

  /** Reuse the original repository operation through its explicit owner context. */
  projectUniqueWrite = (value: TDomain): IRecordIndexProjection => {
    try {
      return projectEntityIndexes(this.#context.uniqueIndexes, value, this.#context.store.backend)
    } catch (cause) {
      throw normalizeError(
        cause,
        this.#context.store.backend,
        StorageErrorCode.extensionFailed,
        StorageOperation.entityIndexProjection
      )
    }
  }
  /** Reuse the original repository operation through its explicit owner context. */
  validateUniqueRows = async (
    changes: ReadonlyMap<string, IEntityUniqueMutation>,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime,
    readView: IRepositoryReadView
  ): Promise<void> => {
    /**
     * Unchanged rows come from one canonical decoder; changed rows already have prepared
     * projections.
     */
    const rows: Array<{ readonly key: IStorageKey; readonly projection: IRecordIndexProjection }> =
      []
    for await (const value of this.#context.streamImpl(undefined, ctx, runtime, false, readView)) {
      /** Normal repository writes bind the domain key to the physical record identity. */
      const id = idOf(this.#context.name, this.#context.keyProp, value, this.#context.store.backend)
      rows.push({ key: id, projection: this.projectUniqueWrite(value) })
    }
    for (const change of changes.values())
      if (change.projection !== undefined)
        rows.push({ key: change.id, projection: change.projection })
    collectUniqueIndexOwners(this.#context.uniqueDefinitions, rows, this.#context.store.backend)
  }
  /** Reuse the original repository operation through its explicit owner context. */
  validateUniqueRecordCommit = async (
    tx: ITransactionScope,
    changes: ReadonlyMap<string, IEntityUniqueMutation>,
    ctx: IOperationContext | undefined,
    runtime: IEntityOperationRuntime
  ): Promise<void> => {
    if (
      this.#context.uniqueDefinitions.length === 0 ||
      ![...changes.values()].some((change) => change.projection !== undefined)
    )
      return
    const marker = repositoryUniqueWriteKey(this.#context.name)
    await tx.getRecord(marker)
    const replaced = new Set(
      [...changes.values()].flatMap((change) => [
        encodeFlatStorageKey(composeRepositoryKey(this.#context.name, change.id)),
        encodeFlatStorageKey(composeStructuredKey(this.#context.name, change.id))
      ])
    )
    await this.validateUniqueRows(changes, ctx, runtime, {
      getRecord: (key) =>
        replaced.has(encodeFlatStorageKey(key)) ? Promise.resolve(undefined) : tx.getRecord(key),
      iterateRecords: (range) => tx.iterateRecords(range),
      ...(tx.iterateRecordIndex === undefined
        ? {}
        : { iterateRecordIndex: (query) => tx.iterateRecordIndex!(query) })
    })
    await tx.putRecord(true, marker, { conflictPolicy: 'replace' })
  }
  /** Reuse the original repository operation through its explicit owner context. */
  snapshotUniqueValues = async (
    ctx: IOperationContext | undefined
  ): Promise<ReadonlyMap<string, string>> => {
    /** Backend namespace isolation is already owned by its public keys/get methods. */
    const prefix = flatKeyPrefix(this.#context.name)
    /** Missing keys are absent from the snapshot even if enumeration raced their deletion. */
    const snapshot = new Map<string, string>()
    for (const key of await this.#context.store.keys(ctx)) {
      if (!key.startsWith(prefix)) continue
      /** Read each stored text once for subsequent schema/projection work. */
      const raw = await this.#context.store.get(key, ctx)
      if (raw !== null) snapshot.set(key, raw)
    }
    return snapshot
  }
  /** Reuse the original repository operation through its explicit owner context. */
  writeUniqueValue = async (
    id: IStorageKey,
    domain: TDomain,
    envelope: IEnvelope,
    ctx: IOperationContext | undefined
  ): Promise<void> => {
    const commit = getBackendValueCommit(this.#context.store)
    if (commit === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: this.#context.store.backend
      })
    return withAbort(ctx, async (signal, context, runtime) => {
      /** One deadline covers preparation and lock admission; nested backend calls share its signal. */
      const operation = { ...context, signal, timeoutMs: undefined }
      /** All application encoding runs before lock admission, including asynchronous codecs. */
      const raw = await this.#context.encodeEnvelope(envelope, operation, runtime)
      /** Incoming projection is prepared once; the old value at the same primary key is replaced. */
      const changes = new Map<string, IEntityUniqueMutation>([
        [
          encodeFlatStorageKey(id),
          {
            id,
            projection: this.projectUniqueWrite(domain)
          }
        ]
      ])
      /** Capture the exact raw values whose materialized projections are checked. */
      const snapshot = await this.snapshotUniqueValues(operation)
      /** The current primary key is not a competing owner. */
      const targetKey = composeFlatKey(this.#context.name, id)
      await this.validateUniqueRows(changes, operation, runtime, {
        keys: async () => [...snapshot.keys()].filter((key) => key !== targetKey),
        get: async (key) => snapshot.get(key) ?? null
      })
      await commit(
        {
          prefix: flatKeyPrefix(this.#context.name),
          expected: [...snapshot],
          key: targetKey,
          value: raw as string
        },
        operation
      )
    })
  }
}
