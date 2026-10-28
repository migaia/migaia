// Transaction conflict detection and commit for the memory backend (see ./memory.ts).
import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageKey,
  type ILockKey,
  type IConcurrencyAttempt,
  type IConcurrencyAttemptContext
} from '@migaia/storage-contract'
import { readConcurrencyLockIdentities, lockKey } from '../authoring/concurrency.js'
import { createMemoryRdfIndex } from './rdf-core.js'
import type { IStorageChannel } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import { createOrderedRecordIndex } from '../core/ordered-record-index.js'
import { throwIfAborted } from '../core/operation.js'
import {
  liveEntry,
  revision,
  identity,
  clearAll,
  clear,
  setDeadline,
  capacityFact,
  bump,
  publish,
  commitCapacity
} from './memory-entries.js'
import { createScope, draftCapacityPlan } from './memory-scope.js'
import { createMemoryTransactionTextDraft } from './memory-transaction-journal.js'
import { txSnapshot, stageDraft } from './memory-transaction.js'
import type { IMemoryTransactionContext } from './memory-transaction.js'
import type {
  IMemoryNamespaceContext,
  IMemoryScope,
  IMemoryTextDraft,
  IMemoryRootMutation,
  IMemoryDraft,
  IMemorySnapshot,
  IMemoryChannel
} from './memory.js'

/** Initialize one native attempt before any business or journal work is admitted. */
export function createMemoryTransactionContext<T, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  run: (scope: IMemoryScope<T>, draft: IMemoryTextDraft) => R,
  ctx: IConcurrencyAttemptContext,
  protectedRanges?: IMemoryRootMutation<unknown>['ranges'],
  setCapacityIdentities?: (identities: readonly string[]) => void,
  journaled = true,
  observeKeys?: (keys: readonly ILockKey[]) => void
): IMemoryTransactionContext<T, R> {
  /** Initialize attempt-local facts before publishing its original native scope. */
  const transactionContext = {
    namespaceContext,
    run,
    ctx,
    protectedRanges,
    setCapacityIdentities,
    journaled,
    observeKeys
  } as IMemoryTransactionContext<T, R>

  transactionContext.namespaceContext.controller.assertLive()

  throwIfAborted(transactionContext.ctx.signal)

  transactionContext.setCapacityIdentities?.([])
  transactionContext.draft = new Map<string, IMemoryDraft>()
  transactionContext.clearAllRequested = false
  transactionContext.clearChanged = false
  transactionContext.draftOrdered = {
    value: createOrderedRecordIndex<IMemoryDraft>(),
    bytes: createOrderedRecordIndex<IMemoryDraft>(),
    record: createOrderedRecordIndex<IMemoryDraft>(),
    vector: createOrderedRecordIndex<IMemoryDraft>(),
    rdf: createOrderedRecordIndex<IMemoryDraft>()
  }
  transactionContext.draftRdfIndex = createMemoryRdfIndex(transactionContext.draftOrdered.rdf)
  transactionContext.snapshots = new Map<string, IMemorySnapshot | undefined>()
  transactionContext.expected = new Map<
    string,
    { channel: IMemoryChannel; encoded: string; key: IStorageKey; revision: number }
  >()
  transactionContext.snapshotEpochs = new Map<IMemoryChannel, number>()
  transactionContext.textDraft = createMemoryTransactionTextDraft(transactionContext)
  transactionContext.scope = createScope(transactionContext)
  transactionContext.control = transactionContext.namespaceContext.owner.register(
    transactionContext.scope,
    {
      context: transactionContext.ctx,
      createScope: () => createScope(transactionContext),
      onFailure: (error) => {
        transactionContext.failure ??= error
      },
      beforeCommit: (current) => {
        transactionContext.namespaceContext.controller.assertLive()
        throwIfAborted(transactionContext.ctx.signal)
        void transactionContext.namespaceContext.core.stageBindings
          .transactionStages(transactionContext.namespaceContext.store)
          .forTransaction(current)
          .beforeCommit?.()
        if (transactionContext.journalAttempt === undefined) return
        transactionContext.journalCapacity = draftCapacityPlan(transactionContext)
        for (const victim of transactionContext.journalCapacity?.victims ?? []) {
          /** Blob has no shared transaction target; never fabricate a logical blob lock/image. */
          if (victim.channel === 'blob')
            throw new StorageContractError(StorageContractErrorCode.unsupported)
          const channel = victim.channel as IMemoryChannel
          const current = txSnapshot(transactionContext, channel, victim.encoded, victim.key)
          if (current === undefined) continue
          ;(transactionContext.journalVictims ??= new Set()).add(victim.id)
          stageDraft(transactionContext, {
            ...current,
            channel,
            encoded: victim.encoded,
            remove: true
          })
        }
        return transactionContext.journalAttempt.record(current)
      }
    }
  )
  transactionContext.stage = transactionContext.namespaceContext.core.stageBindings
    .transactionStages(transactionContext.namespaceContext.store)
    .forTransaction(transactionContext.scope)

  return transactionContext
}
/** Detect existing range, journal, key and epoch conflicts before native commit admission. */
export function memoryTransactionConflict<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>
): IConcurrencyAttempt<never> | undefined {
  if (transactionContext.protectedRanges !== undefined) {
    /** Batch commits cannot bypass a holder admitted while this original draft was preparing. */
    const held = transactionContext.namespaceContext.locks.probe(
      readConcurrencyLockIdentities(transactionContext.ctx),
      transactionContext.protectedRanges,
      transactionContext.ctx
    )
    if (held !== undefined) {
      void transactionContext.stage.afterRollback?.(StorageContractErrorCode.lockRejected)
      return { status: 'conflict', phase: 'acquire', keys: [held.key], holder: held.holder }
    }
  }
  /** Expiry after an observed read changes the same original revision before commit checks. */
  for (const entry of transactionContext.expected.values())
    liveEntry(transactionContext.namespaceContext, entry.channel, entry.encoded)
  /** The same original retry owner handles concurrent private-head changes and drop/reopen. */
  const journalConflict = transactionContext.journalDraft?.conflict()
  if (journalConflict !== undefined) {
    void transactionContext.stage.afterRollback?.(StorageContractErrorCode.writeConflict)
    return { status: 'conflict', phase: 'commit', keys: [], holder: undefined }
  }
  /** Conflict identities are collected before the synchronous all-channel draft merge. */
  const conflicts = [...transactionContext.expected.values()].filter(
    (entry) =>
      revision(transactionContext.namespaceContext, entry.channel, entry.encoded) !==
        entry.revision ||
      transactionContext.namespaceContext.revisions.epoch(
        entry.channel === 'value' ? 'text' : entry.channel
      ) !== transactionContext.snapshotEpochs.get(entry.channel)
  )
  if (
    conflicts.length !== 0 ||
    [...transactionContext.snapshotEpochs].some(
      ([channel, epoch]) =>
        transactionContext.namespaceContext.revisions.epoch(
          channel === 'value' ? 'text' : channel
        ) !== epoch
    )
  ) {
    void transactionContext.stage.afterRollback?.(StorageContractErrorCode.writeConflict)
    return {
      status: 'conflict',
      phase: 'commit',
      keys: conflicts.map((entry) =>
        entry.channel === 'value'
          ? lockKey.text(entry.key)
          : entry.channel === 'bytes'
            ? lockKey.bytes(entry.key as string)
            : entry.channel === 'vector'
              ? lockKey.vector(
                  (entry.key as readonly [string, string])[0],
                  (entry.key as readonly [string, string])[1]
                )
              : entry.channel === 'rdf'
                ? (transactionContext.draft.get(
                    identity(transactionContext.namespaceContext, 'rdf', entry.encoded)
                  ) ??
                    transactionContext.snapshots.get(
                      identity(transactionContext.namespaceContext, 'rdf', entry.encoded)
                    ))!.rdfLock!
                : lockKey.record(entry.key)
      ),
      holder: undefined,
      cause: new Error(
        conflicts[0] &&
          revision(
            transactionContext.namespaceContext,
            conflicts[0].channel,
            conflicts[0].encoded
          ) !== conflicts[0].revision
          ? StorageErrorText.memoryRevisionChanged(
              conflicts[0].revision,
              revision(
                transactionContext.namespaceContext,
                conflicts[0].channel,
                conflicts[0].encoded
              )
            )
          : StorageErrorText.memoryEpochChanged
      )
    }
  }
  return undefined
}
/** Check the finalized capacity proposal against the existing journal and lock owners. */
export function memoryTransactionCapacityConflict<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  capacityPlan: ReturnType<typeof draftCapacityPlan<T, R>>
): IConcurrencyAttempt<never> | undefined {
  if (
    transactionContext.journalAttempt !== undefined &&
    (capacityPlan?.expired.length !== transactionContext.journalCapacity?.expired.length ||
      capacityPlan?.victims.length !== transactionContext.journalCapacity?.victims.length ||
      capacityPlan?.expired.some(
        (entry, index) => entry.id !== transactionContext.journalCapacity!.expired[index]!.id
      ) ||
      capacityPlan?.victims.some(
        (entry, index) => entry.id !== transactionContext.journalCapacity!.victims[index]!.id
      ))
  ) {
    void transactionContext.stage.afterRollback?.(StorageContractErrorCode.writeConflict)
    return { status: 'conflict', phase: 'commit', keys: [], holder: undefined }
  }
  transactionContext.setCapacityIdentities?.(capacityPlan?.identities ?? [])
  const capacityHeld =
    capacityPlan === undefined
      ? undefined
      : transactionContext.namespaceContext.locks.probe(
          capacityPlan.identities,
          undefined,
          transactionContext.ctx
        )
  if (capacityHeld !== undefined) {
    void transactionContext.stage.afterRollback?.(StorageContractErrorCode.lockRejected)
    return {
      status: 'conflict',
      phase: 'acquire',
      keys: [capacityHeld.key],
      holder: capacityHeld.holder
    }
  }
  return undefined
}
/** Apply every draft row during the original synchronous capacity commit turn. */
function applyMemoryTransactionDraft<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  capacityPlan: ReturnType<typeof draftCapacityPlan<T, R>>,
  changed: Record<IMemoryChannel, IStorageKey[]>
): void {
  /** Clear's physical maps, revisions and accounting remain owned by their original turn. */
  if (transactionContext.clearedChannels !== undefined) {
    if (transactionContext.clearAllRequested) clearAll(transactionContext.namespaceContext, false)
    else
      clear(
        transactionContext.namespaceContext,
        transactionContext.clearedChannels[0] as IStorageChannel,
        false
      )
  }
  for (const proposed of transactionContext.draft.values()) {
    if (transactionContext.clearedChannels?.includes(proposed.channel)) {
      changed[proposed.channel].push(proposed.key)
      continue
    }
    /** Policy eviction remains owned by commitCapacity, including revision and onEvict. */
    if (
      transactionContext.journalVictims?.has(
        identity(transactionContext.namespaceContext, proposed.channel, proposed.encoded)
      )
    )
      continue
    /** Existing draft identities retain their already captured logical key. */
    const encoded = proposed.encoded
    /** New deadlines that elapsed within this draft commit as immediate absence. */
    if (
      proposed.remove ||
      (proposed.deadline !== undefined &&
        proposed.deadline <= transactionContext.namespaceContext.scheduler.now())
    ) {
      setDeadline(transactionContext.namespaceContext, proposed.channel, encoded, undefined)
      transactionContext.namespaceContext.capacityIndex?.remove(
        identity(transactionContext.namespaceContext, proposed.channel, encoded)
      )
      if (!transactionContext.namespaceContext.data[proposed.channel].delete(encoded)) continue
      if (proposed.channel === 'rdf')
        transactionContext.namespaceContext.rdfIndex.delete(proposed.rdfKeys!)
      else transactionContext.namespaceContext.ordered[proposed.channel].delete(proposed.ordered)
    } else {
      /**
       * An overwrite retains its original live ordered encoding instead of keeping duplicate key
       * bytes.
       */
      const keyBytes =
        transactionContext.namespaceContext.ordered[proposed.channel].get(proposed.ordered)?.key ??
        proposed.ordered
      const entry = {
        key: proposed.key,
        value: proposed.value,
        ordered: keyBytes,
        bytes: proposed.bytes,
        rdfKeys: proposed.rdfKeys,
        rdfLock: proposed.rdfLock
      }
      transactionContext.namespaceContext.data[proposed.channel].set(encoded, entry)
      if (proposed.channel === 'rdf')
        transactionContext.namespaceContext.rdfIndex.set(proposed.rdfKeys!, entry)
      else transactionContext.namespaceContext.ordered[proposed.channel].set(keyBytes, entry)
      setDeadline(transactionContext.namespaceContext, proposed.channel, encoded, proposed.deadline)
      transactionContext.namespaceContext.capacityIndex?.put({
        ...capacityFact(
          transactionContext.namespaceContext,
          proposed.channel,
          proposed.key,
          undefined,
          proposed.rdfLock
        ),
        bytes: proposed.bytes ?? 0
      })
    }
    bump(transactionContext.namespaceContext, proposed.channel, encoded)
    changed[proposed.channel].push(proposed.key)
  }
  /** The original capacity buffer preserves batch-before-victim notification order. */
  if (capacityPlan !== undefined)
    for (const channel of transactionContext.namespaceContext.physicalChannels)
      if (!transactionContext.clearedChannels?.includes(channel) && changed[channel].length !== 0)
        publish(transactionContext.namespaceContext, channel, 'batch', changed[channel])
}
/** Publish journal completion and channel notifications after physical commit. */
function completeMemoryTransactionDraft<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  capacityPlan: ReturnType<typeof draftCapacityPlan<T, R>>,
  changed: Record<IMemoryChannel, IStorageKey[]>
): void {
  /** Actual data and capacity victims are final before private indexes become visible. */
  transactionContext.journalDraft?.commit()
  transactionContext.journalDraft?.complete(true)
  if (transactionContext.clearChanged) {
    if (transactionContext.clearAllRequested)
      transactionContext.namespaceContext.controller.publish({
        channel: 'all',
        kind: 'clear',
        orgId: transactionContext.namespaceContext.orgId
      })
    else
      publish(transactionContext.namespaceContext, transactionContext.clearedChannels![0]!, 'clear')
  }
  if (capacityPlan === undefined)
    for (const channel of transactionContext.namespaceContext.physicalChannels)
      if (!transactionContext.clearedChannels?.includes(channel) && changed[channel].length !== 0)
        publish(transactionContext.namespaceContext, channel, 'batch', changed[channel])
}
/** Commit channels and report the original count without admitting another operation. */
export function commitMemoryTransaction<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  capacityPlan: ReturnType<typeof draftCapacityPlan<T, R>>
): void {
  const changed = {
    value: [] as IStorageKey[],
    bytes: [] as IStorageKey[],
    record: [] as IStorageKey[],
    vector: [] as IStorageKey[],
    rdf: [] as IStorageKey[]
  }
  commitCapacity(
    transactionContext.namespaceContext,
    capacityPlan,
    () => applyMemoryTransactionDraft(transactionContext, capacityPlan, changed),
    () => completeMemoryTransactionDraft(transactionContext, capacityPlan, changed)
  )
  void transactionContext.stage.afterCommit?.(
    transactionContext.namespaceContext.physicalChannels.reduce(
      (count, channel) => count + changed[channel].length,
      0
    ) +
      (capacityPlan?.expired.length ?? 0) +
      (capacityPlan?.victims.length ?? 0)
  )
}
