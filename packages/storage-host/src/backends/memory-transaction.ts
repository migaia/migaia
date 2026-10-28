// Transaction context, staged reads and writes for the memory backend (see ./memory.ts).
import { asyncDisposeKey } from '@migaia/plugin-host'
import type {
  IQuad,
  ITransactionRdfApi,
  IStorageVectorPoint,
  IRdfQuerySource,
  IStorageKey,
  IStorageIterator,
  ITransactionScope,
  ILockKey,
  IConcurrencyAttempt,
  IConcurrencyAttemptContext,
  IConflictPolicy
} from '@migaia/storage-contract'
import {
  snapshotStorageKey,
  encodeOrderedStorageKey,
  snapshotStorageKeyPrefix
} from '../authoring/key.ts'
import { assertTransactionOwner, runTransactionOperation } from '../authoring/transaction.ts'
import { createRdfQuery } from '../authoring/query.ts'
import { snapshotStorageRdfPattern } from '../authoring/rdf.ts'
import { createMemoryRdfIndex } from './rdf-core.ts'
import type { IStorageJournalChange } from '../journal/types.ts'
import type { IStorageChannel } from '../errors.ts'
import type { IStoragePluginCore } from '../types.ts'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.ts'
import { MemoryOperation, MemoryState } from './memory-constants.ts'
import { encodeFlatStorageKey } from '../core/key-domain.ts'
import {
  createOrderedRecordIndex,
  compareRecordIndexKeys,
  type IOrderedRecordRange
} from '../core/ordered-record-index.ts'
import { planChannelWrite } from '../core/channel-write.ts'
import { throwIfAborted } from '../core/operation.ts'
import {
  createMemoryTransactionContext,
  memoryTransactionConflict,
  memoryTransactionCapacityConflict,
  commitMemoryTransaction
} from './memory-commit.ts'
import {
  planCapacity,
  normalize,
  identity,
  capacityLock,
  capacityFact,
  revision,
  liveEntry,
  copyValue,
  prepare,
  entryBytes
} from './memory-entries.ts'
import { captureRdfEntries, physicalRdfPattern, logicalRdfQuad } from './memory-namespace-base.ts'
import { draftCapacityPlan } from './memory-scope.ts'
import { captureJournalStage } from './memory-transaction-journal.ts'
import type {
  IMemoryNamespaceContext,
  IMemoryScope,
  IMemoryTextDraft,
  IMemoryRootMutation,
  IMemoryDraft,
  IMemoryChannel,
  IMemorySnapshot,
  IMemoryEntry
} from './memory.ts'

/** One accepted native attempt owns its draft, repeatable reads and original scope controls. */
export type IMemoryTransactionContext<T, R> = {
  /** Original namespaceContext belongs to this accepted transaction attempt. */
  readonly namespaceContext: IMemoryNamespaceContext<T>
  /** Original run belongs to this accepted transaction attempt. */
  readonly run: (scope: IMemoryScope<T>, draft: IMemoryTextDraft) => R
  /** Original ctx belongs to this accepted transaction attempt. */
  readonly ctx: IConcurrencyAttemptContext
  /** Original protectedRanges belongs to this accepted transaction attempt. */
  readonly protectedRanges: IMemoryRootMutation<unknown>['ranges']
  /** Original setCapacityIdentities belongs to this accepted transaction attempt. */
  readonly setCapacityIdentities?: (identities: readonly string[]) => void
  /** Original journaled belongs to this accepted transaction attempt. */
  readonly journaled: boolean
  /** Original observeKeys belongs to this accepted transaction attempt. */
  readonly observeKeys?: (keys: readonly ILockKey[]) => void

  /** Private log writes and terminal effects belong to this exact original native attempt. */
  journalDraft: ReturnType<IMemoryNamespaceContext<T>['journal']['draft']> | undefined

  /** Only touched identities retain draft entries; rollback never rewrites committed maps. */
  draft: Map<string, IMemoryDraft>

  /** Opt-in ordered facts exist only for this authentic attempt, never for ordinary memory work. */
  journalChanges: Array<Omit<IStorageJournalChange, 'afterRevision'>> | undefined

  /** Only journal-selected policy victims gain draft tombstones before the same final commit. */
  journalVictims: Set<string> | undefined

  /** The original capacity plan must still select these same rows after asynchronous append. */
  journalCapacity: ReturnType<typeof planCapacity>

  /** Root clear keeps the original coarse epoch transition, without exposing a new scope method. */
  clearedChannels: readonly IMemoryChannel[] | undefined

  /** The original all-channel clear publishes one broad event instead of per-channel batches. */
  clearAllRequested: boolean

  /** Preserve whether the original physical clear has an event, even if capture prunes expiry. */
  clearChanged: boolean

  /** Each channel draft reuses the same compressed radix implementation, including tombstones. */
  draftOrdered: Record<IMemoryChannel, ReturnType<typeof createOrderedRecordIndex<IMemoryDraft>>>

  /** Proposed RDF entries and tombstones use the same six native permutations. */
  draftRdfIndex: ReturnType<typeof createMemoryRdfIndex<IMemoryDraft>>

  /** First reads are repeatable until a write in this attempt replaces their snapshot. */
  snapshots: Map<string, IMemorySnapshot | undefined>

  /** Per-key tombstone revisions detect delete/reinsert and other ABA writes. */
  expected: Map<
    string,
    { channel: IMemoryChannel; encoded: string; key: IStorageKey; revision: number }
  >

  /** A clear invalidates only channels already observed by this native attempt. */
  snapshotEpochs: Map<IMemoryChannel, number>

  /** The original owner retains the first asynchronous operation failure. */
  failure: (Error & { readonly source: string; readonly code: string }) | undefined

  /** Native text batches stage only into this attempt's existing draft and revision baseline. */
  textDraft: IMemoryTextDraft

  /** The initial callback view is created and registered by the original owner exactly once. */
  scope: IMemoryScope<T>

  /** Original registration authenticates this same scope before any journal capture is enabled. */
  journalAttempt: ReturnType<NonNullable<IStoragePluginCore['journal']>['begin']>

  /** Final checks receive fresh complete native views under the same transaction identity. */
  control: ReturnType<IMemoryNamespaceContext<T>['owner']['register']>

  /** Terminal observations retain identity captured while the original scope was valid. */
  stage: ReturnType<
    ReturnType<IStoragePluginCore['stageBindings']['transactionStages']>['forTransaction']
  >
}
/** Execute one isolated attempt while the shared contract owner controls policy and retry. */
export async function transact<T, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  run: (scope: IMemoryScope<T>, draft: IMemoryTextDraft) => R,
  ctx: IConcurrencyAttemptContext,
  protectedRanges?: IMemoryRootMutation<unknown>['ranges'],
  setCapacityIdentities?: (identities: readonly string[]) => void,
  journaled = true,
  observeKeys?: (keys: readonly ILockKey[]) => void
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  /** Native attempt state is complete before callback admission begins. */
  const transactionContext = createMemoryTransactionContext(
    namespaceContext,
    run,
    ctx,
    protectedRanges,
    setCapacityIdentities,
    journaled,
    observeKeys
  )
  try {
    if (transactionContext.journaled)
      transactionContext.journalAttempt = transactionContext.namespaceContext.core.journal?.begin(
        transactionContext.scope
      )
    void transactionContext.stage.beforeTransaction?.()
    void transactionContext.stage.onTransactionStart?.()
    /** The callback itself is an accepted operation, so its failure cannot bypass first-error state. */
    const value = await runTransactionOperation(transactionContext.scope, (current) =>
      transactionContext.run(current, transactionContext.textDraft)
    )
    transactionContext.control.stopAdmission()
    await transactionContext.control.runFinalizers()
    transactionContext.namespaceContext.controller.assertLive()
    throwIfAborted(transactionContext.ctx.signal)
    /** Return the same conflict before changing any committed row. */
    const conflict = memoryTransactionConflict(transactionContext)
    if (conflict !== undefined) return conflict
    /** Final capacity admission shares the same original attempt, locks and no-await commit turn. */
    const capacityPlan = draftCapacityPlan(transactionContext)
    /** Capacity retains the existing original-attempt admission point. */
    const capacityConflict = memoryTransactionCapacityConflict(transactionContext, capacityPlan)
    if (capacityConflict !== undefined) return capacityConflict
    /** Each channel reports one batch after all physical draft rows have committed. */
    commitMemoryTransaction(transactionContext, capacityPlan)
    return { status: 'committed', value }
  } catch (cause) {
    /** The original owner combines cleanup after the first failure without replacing its cause. */
    let primary =
      transactionContext.failure ?? normalize(transactionContext.namespaceContext, cause)
    try {
      await transactionContext.control.closeIterators()
    } catch (cleanup) {
      primary = normalize(transactionContext.namespaceContext, cleanup)
    }
    void transactionContext.stage.afterRollback?.(primary.code)
    throw primary
  } finally {
    transactionContext.journalDraft?.complete(false)
    if (transactionContext.journalAttempt?.settle !== undefined)
      await transactionContext.journalAttempt.settle()
    transactionContext.control.close()
    if (transactionContext.observeKeys !== undefined)
      transactionContext.observeKeys(
        [...transactionContext.expected.values()]
          .map((entry) => {
            const physical =
              transactionContext.draft.get(
                identity(transactionContext.namespaceContext, entry.channel, entry.encoded)
              ) ?? transactionContext.namespaceContext.data[entry.channel].get(entry.encoded)
            return capacityLock(
              transactionContext.namespaceContext,
              capacityFact(
                transactionContext.namespaceContext,
                entry.channel,
                entry.key,
                undefined,
                physical?.rdfLock
              )
            )
          })
          .filter((key): key is ILockKey => key !== undefined)
      )
    transactionContext.draft.clear()
    transactionContext.snapshots.clear()
    transactionContext.expected.clear()
    transactionContext.snapshotEpochs.clear()
    for (const channel of transactionContext.namespaceContext.physicalChannels)
      transactionContext.draftOrdered[channel].clear()
    transactionContext.draftRdfIndex.clear()
    void transactionContext.stage.onTransactionClose?.()
  }
}

/** Ordinary transactions allocate no private metadata rows or terminal channels until used. */
export function privateJournal<T, R>(transactionContext: IMemoryTransactionContext<T, R>) {
  return (transactionContext.journalDraft ??= transactionContext.namespaceContext.journal.draft())
}

/** Capture the real revision once, before any draft read or write. */
function track<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IMemoryChannel,
  encoded: string,
  key: IStorageKey
): string {
  if (!transactionContext.snapshotEpochs.has(channel))
    transactionContext.snapshotEpochs.set(
      channel,
      transactionContext.namespaceContext.revisions.epoch(channel === 'value' ? 'text' : channel)
    )
  /** Channel plus original flat key identifies one actual native row. */
  const id = identity(transactionContext.namespaceContext, channel, encoded)
  if (!transactionContext.expected.has(id))
    transactionContext.expected.set(id, {
      channel,
      encoded,
      key,
      revision: revision(transactionContext.namespaceContext, channel, encoded)
    })
  return id
}

/** First access captures value, deadline and revision once; later reads retain that snapshot. */
export function txSnapshot<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IMemoryChannel,
  encoded: string,
  key: IStorageKey
): IMemorySnapshot | undefined {
  /** Existing observations are never refreshed from a later clock or physical mutation. */
  const id = identity(transactionContext.namespaceContext, channel, encoded)
  if (!transactionContext.snapshots.has(id)) {
    /** Expiry removes the physical row before its revision baseline is observed. */
    const current = liveEntry(transactionContext.namespaceContext, channel, encoded)
    track(transactionContext, channel, encoded, key)
    transactionContext.snapshots.set(
      id,
      current === undefined
        ? undefined
        : {
            key,
            value: copyValue(transactionContext.namespaceContext, channel, current.value, key),
            ordered: current.ordered,
            bytes: current.bytes,
            rdfKeys: current.rdfKeys,
            rdfLock: current.rdfLock,
            deadline: transactionContext.namespaceContext.deadlines.get(id)
          }
    )
  }
  return transactionContext.snapshots.get(id)
}

/** Read own writes first; otherwise retain the first committed value in this attempt. */
export function txEntry<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IMemoryChannel,
  key: IStorageKey
): IMemorySnapshot | undefined {
  /** Caller-owned keys detach before contributing to revision or draft identity. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** Every channel uses the same canonical logical-key wire. */
  const encoded = encodeFlatStorageKey(captured)
  /** A draft row replaces the previous read snapshot immediately. */
  const proposed = transactionContext.draft.get(
    identity(transactionContext.namespaceContext, channel, encoded)
  )
  return proposed
    ? proposed.remove
      ? undefined
      : proposed
    : txSnapshot(transactionContext, channel, encoded, captured)
}

/** Every mutable value returned from a retained native snapshot has independent ownership. */
export function txRead<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IMemoryChannel,
  key: IStorageKey
): unknown {
  /** Membership and an undefined-valued record remain separate facts. */
  const current = txEntry(transactionContext, channel, key)
  if (current !== undefined)
    transactionContext.namespaceContext.capacityIndex?.touch(
      identity(transactionContext.namespaceContext, channel, encodeFlatStorageKey(current.key))
    )
  return current === undefined
    ? undefined
    : copyValue(transactionContext.namespaceContext, channel, current.value, current.key)
}

/** Membership shares the same first snapshot, including undefined-valued records. */
function txHas<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IMemoryChannel,
  encoded: string,
  key: IStorageKey
): boolean {
  /** A tombstone masks physical membership until the attempt commits. */
  const proposed = transactionContext.draft.get(
    identity(transactionContext.namespaceContext, channel, encoded)
  )
  return proposed
    ? !proposed.remove
    : txSnapshot(transactionContext, channel, encoded, key) !== undefined
}

/** Draft hash and ordered range lookup retain one actual proposed row reference. */
export function stageDraft<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  entry: IMemoryDraft,
  metadataOnly = false
): void {
  captureJournalStage(transactionContext, entry, metadataOnly)
  /** Replacing one draft value keeps its original independently owned key encoding. */
  const proposed = {
    ...entry,
    ordered: transactionContext.draftOrdered[entry.channel].get(entry.ordered)?.key ?? entry.ordered
  }
  transactionContext.draft.set(
    track(transactionContext, proposed.channel, proposed.encoded, proposed.key),
    proposed
  )
  if (proposed.channel === 'rdf') transactionContext.draftRdfIndex.set(proposed.rdfKeys!, proposed)
  else transactionContext.draftOrdered[proposed.channel].set(proposed.ordered, proposed)
}

/** Prepare first, then stage eviction and put atomically within this native draft. */
export function txWrite<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IStorageChannel,
  key: IStorageKey,
  value: unknown,
  policy: IConflictPolicy,
  ttlMs?: number
): void {
  /** Preparation can reject before any prior channel loses draft membership. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** One logical-key encoding serves all affected channels. */
  const encoded = encodeFlatStorageKey(captured)
  /** Clone caller-owned payload before mutating the draft. */
  const prepared = prepare(transactionContext.namespaceContext, channel, value, captured)
  /** Explicit byte-domain failure happens before staging any replacement or native victim. */
  const bytes = entryBytes(transactionContext.namespaceContext, channel, prepared)
  /** Channel conflict semantics are owned by the same shared plan as root writes. */
  const existing = new Set(
    MemoryState.channels.filter((current) => txHas(transactionContext, current, encoded, captured))
  )
  /** The canonical plan retains eviction order and the existing duplicate-key diagnostic. */
  const plan = planChannelWrite(captured, channel, existing, policy, STORAGE_MEMORY_BACKEND)
  /** Encode this logical key once for all affected channel draft entries. */
  const keyBytes = encodeOrderedStorageKey(captured, STORAGE_MEMORY_BACKEND)
  for (const previous of plan.remove)
    stageDraft(transactionContext, {
      channel: previous,
      key: captured,
      value: undefined,
      remove: true,
      encoded,
      ordered: keyBytes
    })
  /** Overwriting a live row retains its deadline unless this batch supplies a new duration. */
  const current = txEntry(transactionContext, channel, captured)
  stageDraft(transactionContext, {
    channel,
    key: captured,
    value: prepared,
    bytes,
    remove: false,
    encoded,
    ordered: keyBytes,
    deadline:
      ttlMs === undefined
        ? current?.deadline
        : transactionContext.namespaceContext.scheduler.now() + ttlMs
  })
}

/** Delete returns actual draft membership, so repeated keys count at most once. */
export function txRemove<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IStorageChannel | 'vector',
  key: IStorageKey
): boolean {
  /** Delete keys follow the same detached canonical domain as reads and writes. */
  const captured = snapshotStorageKey(key, STORAGE_MEMORY_BACKEND)
  /** One encoding serves membership and the resulting tombstone. */
  const encoded = encodeFlatStorageKey(captured)
  if (!txHas(transactionContext, channel, encoded, captured)) return false
  /** Existing physical or proposed membership already owns this exact ordered identity. */
  const current =
    transactionContext.draft.get(identity(transactionContext.namespaceContext, channel, encoded)) ??
    txSnapshot(transactionContext, channel, encoded, captured)!
  stageDraft(transactionContext, {
    channel,
    key: captured,
    value: undefined,
    remove: true,
    encoded,
    ordered: current.ordered
  })
  return true
}

/** Localize both physical and draft trees, then merge only their actual range candidates. */
export function txRows<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  channel: IStorageChannel,
  range?: IOrderedRecordRange
): IMemoryEntry[] {
  if (!transactionContext.snapshotEpochs.has(channel))
    transactionContext.snapshotEpochs.set(
      channel,
      transactionContext.namespaceContext.revisions.epoch(channel === 'value' ? 'text' : channel)
    )
  /** Independent owner iterators begin at the same lower bound, without scanning other draft keys. */
  const physical = transactionContext.namespaceContext.ordered[channel].range(range)
  const proposed = transactionContext.draftOrdered[channel].range(range)
  /** The native scan captures only candidates selected by these actual bounds. */
  const rows: IMemoryEntry[] = []
  let left = physical.next()
  let right = proposed.next()
  while (!left.done || !right.done) {
    /** Equal canonical identities are decided by the draft, including its tombstone. */
    const comparison = left.done
      ? 1
      : right.done
        ? -1
        : compareRecordIndexKeys(left.value.key, right.value.key)
    if (comparison < 0) {
      /** First range access uses the same repeatable membership and deadline as point reads. */
      const row = left.value!.value
      /** Expiry unlinks this leaf, so retain the next original candidate before pruning it. */
      left = physical.next()
      const current = txSnapshot(
        transactionContext,
        channel,
        encodeFlatStorageKey(row.key),
        row.key
      )
      if (current !== undefined) rows.push(current)
    } else {
      if (!right.value!.value.remove) rows.push(right.value!.value)
      if (comparison === 0) left = physical.next()
      right = proposed.next()
    }
  }
  return rows
}

/** RDF writes retain the same original draft, first-read revisions and logical lock facts. */
export function txRdfWrite<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  input: readonly IQuad[],
  remove: boolean
): void {
  /** Admission of the entire batch precedes even the first draft tombstone. */
  const entries = captureRdfEntries(transactionContext.namespaceContext, input)
  for (const entry of entries) {
    /** Draft and first-read membership share the original channel identity. */
    const id = identity(transactionContext.namespaceContext, 'rdf', entry.encoded)
    /** Own writes mask physical membership without introducing another transaction owner. */
    const proposed = transactionContext.draft.get(id)
    /** The original first-read owner records even absence for ABA conflict checks. */
    const current = proposed
      ? proposed.remove
        ? undefined
        : proposed
      : txSnapshot(transactionContext, 'rdf', entry.encoded, entry.key)
    if (remove ? current === undefined : current !== undefined) continue
    stageDraft(transactionContext, { ...entry, channel: 'rdf', remove })
  }
}

/** Physical and proposed prefix scans merge by identity without materializing complete results. */
export function* txRdfRows<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  pattern: Readonly<Partial<IQuad>>
): IterableIterator<IMemoryEntry> {
  if (!transactionContext.snapshotEpochs.has('rdf'))
    transactionContext.snapshotEpochs.set(
      'rdf',
      transactionContext.namespaceContext.revisions.epoch('rdf')
    )
  /** Both trees receive one identical bound graph envelope and access-path choice. */
  const physical = physicalRdfPattern(transactionContext.namespaceContext, pattern)
  for (const row of transactionContext.namespaceContext.rdfIndex.match(physical)) {
    /** The original physical key remains a string even for a large literal. */
    const encoded = row.key as string
    if (transactionContext.draft.has(identity(transactionContext.namespaceContext, 'rdf', encoded)))
      continue
    /** Repeat reads retain the first physical snapshot and original revision. */
    const current = txSnapshot(transactionContext, 'rdf', encoded, row.key)
    if (current !== undefined) {
      transactionContext.namespaceContext.capacityIndex?.touch(
        identity(transactionContext.namespaceContext, 'rdf', encoded)
      )
      yield current
    }
  }
  for (const row of transactionContext.draftRdfIndex.match(physical)) if (!row.remove) yield row
}

/** The original transaction owner admits each native advance and closes the actual generator. */
export function rdfQuery<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>,
  pattern: Partial<IQuad>,
  scope: ITransactionScope<T>,
  mutate: NonNullable<IRdfQuerySource<ITransactionScope<T>>['mutate']>
): ReturnType<ITransactionRdfApi['match']> {
  /** The shared planner owns subsequent query snapshots and operation-scope rebinding. */
  const captured = snapshotStorageRdfPattern(pattern, STORAGE_MEMORY_BACKEND)
  return createRdfQuery<undefined, Record<never, never>, ITransactionScope<T>>(
    {
      asyncDisposeKey,
      cursorSource: scope,
      mutate,
      pushdown: {
        source: MemoryState.querySource,
        index: transactionContext.namespaceContext.rdfIndex.select(
          physicalRdfPattern(transactionContext.namespaceContext, captured)
        ).name,
        operations: [],
        operators: []
      },
      execute: (input) => {
        /** This actual generator, including client traversal children, has one native owner. */
        const iterator = (async function* () {
          for (const row of txRdfRows(transactionContext, input.pattern)) {
            transactionContext.namespaceContext.controller.assertLive()
            throwIfAborted(transactionContext.ctx.signal)
            yield [row.key, logicalRdfQuad(transactionContext.namespaceContext, row)] as const
          }
        })()
        return transactionContext.namespaceContext.owner.registerIterator(
          input.operationScope ?? scope,
          {
            next: (current) =>
              transactionContext.namespaceContext.core.execution.run(
                {
                  operation: MemoryOperation.rdfMatch,
                  input: input.pattern,
                  scope: current,
                  ctx: transactionContext.ctx
                },
                () => iterator.next()
              ),
            close: async () => {
              await iterator.return(undefined)
            }
          }
        )
      }
    },
    captured,
    transactionContext.namespaceContext.core.getChainMethods('rdf')
  )
}

/** Query selection borrows the original iterator owner without a second operation pipeline. */
export function queryIterator<T, R, V>(
  transactionContext: IMemoryTransactionContext<T, R>,
  scope: ITransactionScope<T>,
  rows: () => Iterable<readonly [IStorageKey, V]>
): IStorageIterator<readonly [IStorageKey, V]> {
  assertTransactionOwner(transactionContext.namespaceContext.store, scope)
  /** The actual generator is drained and closed by this existing native transaction owner. */
  const iterator = (async function* () {
    for (const row of rows()) {
      transactionContext.namespaceContext.controller.assertLive()
      throwIfAborted(transactionContext.ctx.signal)
      yield row
    }
  })()
  return transactionContext.namespaceContext.owner.registerIterator(scope, {
    next: () => iterator.next(),
    close: async () => {
      await iterator.return(undefined)
    }
  })
}

/** A vector write attempt streams native candidates while retaining the original read set. */
export function* txVectorPoints<T, R, P>(
  transactionContext: IMemoryTransactionContext<T, R>,
  collection: string
): IterableIterator<IStorageVectorPoint<P>> {
  if (!transactionContext.snapshotEpochs.has('vector'))
    transactionContext.snapshotEpochs.set(
      'vector',
      transactionContext.namespaceContext.revisions.epoch('vector')
    )
  /** Physical and proposed rows use the same canonical collection tuple prefix. */
  const bounds = snapshotStorageKeyPrefix([collection], STORAGE_MEMORY_BACKEND)
  let leaf = transactionContext.namespaceContext.ordered.vector.lowerBound(bounds.lower)
  while (leaf !== undefined && compareRecordIndexKeys(leaf.key, bounds.upper) < 0) {
    /** Expiry can unlink this row before the generator advances again. */
    const next = leaf.next
    const key = leaf.value.key
    const encoded = encodeFlatStorageKey(key)
    if (
      !transactionContext.draft.has(
        identity(transactionContext.namespaceContext, 'vector', encoded)
      )
    ) {
      const current = txSnapshot(transactionContext, 'vector', encoded, key)
      if (current !== undefined) yield current.value as IStorageVectorPoint<P>
    }
    leaf = next
  }
  for (const row of transactionContext.draftOrdered.vector.range({
    lower: bounds.lower,
    upper: bounds.upper,
    upperOpen: true
  }))
    if (!row.value.remove) yield row.value.value as IStorageVectorPoint<P>
}
