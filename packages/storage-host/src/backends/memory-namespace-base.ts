// Namespace base iteration, watch and RDF read paths for the memory backend (see ./memory.ts).
import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStorageTtlDuration,
  type IQuad,
  type IRdfApi,
  type ITransactionKeyValueApi,
  type IStorageKey,
  type IStorageIterator,
  type ITransactionOptions,
  type IOperationContextSnapshot,
  type ILockKey,
  type IStorageChange,
  type IOperationContext,
  type IKeyRange
} from '@migaia/storage-contract'
import {
  snapshotConcurrencyLockKeys,
  lockKey,
  runWithConcurrency
} from '../authoring/concurrency.ts'
import {
  snapshotStorageBatchKeys,
  createStorageBatchKeyCapture,
  encodeOrderedStorageKey
} from '../authoring/key.ts'
import { createTransactionBuilder } from '../authoring/transaction.ts'
import { createRdfQuery } from '../authoring/query.ts'
import {
  snapshotStorageRdfQuad,
  snapshotStorageRdfPattern,
  prefixStorageOrgGraph,
  unprefixStorageOrgGraph
} from '../authoring/rdf.ts'
import { memoryRdfKeys } from './rdf-core.ts'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.ts'
import { MemoryOperation, MemoryState } from './memory-constants.ts'
import { encodeFlatStorageKey, snapshotKeyRange } from '../core/key-domain.ts'
import type { IOrderedRecordRange } from '../core/ordered-record-index.ts'
import { throwIfAborted, mergeSignals, withAbort } from '../core/operation.ts'
import { reportCleanupError } from '../core/operation-reporter.ts'
import { observeStorageBatch } from '../core/batch-observation.ts'
import { prepare, holding, entryBytes, identity, liveEntry, clone } from './memory-entries.ts'
import {
  createMemoryNamespaceSync,
  createMemoryNamespaceBaseText,
  createMemoryNamespaceBaseBytes,
  createMemoryNamespaceBaseRecords,
  createMemoryNamespaceBaseTransactions,
  createMemoryNamespaceBaseObservation
} from './memory-namespace-sync.ts'
import { transact } from './memory-transaction.ts'
import { queryDraft } from './memory.ts'
import type {
  IMemoryNamespaceContext,
  IMemoryScope,
  IMemoryTextEntry,
  IMemoryAtomicWork,
  IMemoryEntry,
  IMemoryRdfEntry
} from './memory.ts'

/** One existing runner owns every asynchronous public endpoint. */
export function asyncEntry<T, I, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  input: I,
  ctx: IOperationContext | undefined,
  run: (captured: I) => R,
  keys?: (captured: I) => readonly ILockKey[]
): Promise<R> {
  /** The original pipeline's actual captured input is read only if telemetry requests keys. */
  let current = input
  const invoke = (captured: I) => {
    current = captured
    return run(captured)
  }
  const describeKeys = () => keys?.(current) ?? []
  if (namespaceContext.core.journal === undefined)
    return namespaceContext.core.execution.run(
      { operation, input, ctx, keys: describeKeys },
      (captured) => withAbort(ctx, async () => invoke(captured))
    )
  /** The original controller drains lazy org preparation before its native cleanup can finish. */
  const release = namespaceContext.controller.beginMutation()
  return runWithConcurrency<R>(
    {
      store: namespaceContext.base,
      options: ctx ?? {},
      prepare: () => namespaceContext.core.journal!.prepare()
    },
    {
      attempt: async (context) => ({
        status: 'committed',
        value: await namespaceContext.core.execution.run(
          { operation, input, ctx: context, keys: describeKeys },
          (captured) => withAbort(context, async () => invoke(captured))
        )
      })
    }
  ).finally(release)
}

/** Native feeds share one original subscription bridge and the backend's per-next pipeline. */
export function watchChanges<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  channel: IStorageChange['channel'],
  ctx: IOperationContext | undefined,
  key?: string
): IStorageIterator<IStorageChange> {
  if (namespaceContext.assembly.iterator === undefined)
    throw new StorageError(
      StorageHostErrorCode.changeIteratorNotAssembled,
      {},
      StorageErrorText.changeIteratorNotAssembled
    )
  return namespaceContext.assembly.iterator(namespaceContext.controller, {
    orgId: namespaceContext.orgId,
    channel,
    key,
    ctx,
    execute: (advance, context) =>
      namespaceContext.core.execution.run(
        { operation: MemoryOperation.watch, input: key, ctx: context },
        advance
      )
  })
}

/** Empty batches have no pipeline or native transaction, while resource expiry still applies. */
export function batchSize<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  input: readonly unknown[]
): number {
  namespaceContext.controller.assertLive()
  return (() => {
    if (!Array.isArray(input))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: STORAGE_MEMORY_BACKEND
      })
    return input.length
  })()
}

/** One high-level batch reports one observation without exposing per-key native work. */
export function observeBatch<T, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  count: number | undefined,
  invoke: () => R | Promise<R>,
  scope?: IMemoryScope<T>
): Promise<R> {
  /** Observation remains on the original registration and authentic transaction view. */
  const root = namespaceContext.core.stageBindings.operationStages(namespaceContext.store)
  /** A scoped observer captures its real transaction identity before that view expires. */
  const stages = scope === undefined ? root : root.forTransaction(scope)
  return observeStorageBatch(stages, namespaceContext.scheduler, operation, count, invoke)
}

/** Both root and scoped batches capture the same keys and reject duplicates before staging. */
export function captureTextEntries<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  entries: Parameters<ITransactionKeyValueApi['setMany']>[0]
): readonly IMemoryTextEntry[] {
  /** The canonical owner captures identities at the original per-entry validation boundary. */
  const capture = createStorageBatchKeyCapture(STORAGE_MEMORY_BACKEND)
  return entries.map((entry, index) => {
    /** Borrowed fields and payload detach once before a policy can wait or a draft can change. */
    const fact = capture(entry.key)
    if (fact.firstIndex !== index)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: STORAGE_MEMORY_BACKEND
      })
    /** Each optional duration is captured once before any native draft mutation. */
    const ttlMs = entry.ttlMs
    if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, STORAGE_MEMORY_BACKEND)
    return {
      key: fact.key,
      value: prepare(namespaceContext, 'value', entry.value, fact.key) as string,
      ttlMs
    }
  })
}

/** Every duplicate position reuses its first result in both native root and scoped snapshots. */
export function readTextBatch<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  keys: readonly IStorageKey[],
  readValue: (key: IStorageKey) => string | undefined
): Array<string | undefined> {
  /** The canonical owner alone validates keys and records their first positions. */
  const captured = snapshotStorageBatchKeys(keys, STORAGE_MEMORY_BACKEND)
  /** Positions are retained without a second identity map or a repeated native read. */
  const values: Array<string | undefined> = []
  for (const [index, fact] of captured.entries())
    values.push(fact.firstIndex === index ? readValue(fact.key) : values[fact.firstIndex])
  return values
}

/** Public transactions and native batches use one original loop, pipeline and attempt owner. */
export function atomicEntry<T, I, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  input: (context: IOperationContextSnapshot) => I,
  ctx: ITransactionOptions | undefined,
  prepare: (captured: I, admit: () => void) => IMemoryAtomicWork<T, R>,
  journaled = true
): Promise<Awaited<R>> {
  /** Private metadata work keeps its original draft and never recursively journals itself. */
  const selectedJournal = journaled ? namespaceContext.core.journal : undefined
  /** One accepted lifetime spans every real attempt and all original pipeline settlement. */
  let release: (() => void) | undefined
  /** The existing lease admits once, including the original callback-capture boundary. */
  const admit = (): void => {
    release ??= namespaceContext.controller.beginMutation()
  }
  if (selectedJournal !== undefined) admit()
  /** Each pipeline fixes this attempt's original callback or detached native batch. */
  let work: IMemoryAtomicWork<T, R>
  /** Only the final original pipeline payload belongs to the one public operation observation. */
  let observedInput: I | undefined
  /** Actual final native facts are copied only for explicitly enabled observation. */
  let observing = false
  let observedKeys: readonly ILockKey[] | undefined
  /** Only actual previous-attempt victim identities feed the original policy's waiting admission. */
  let capacityIdentities: readonly string[] = []
  const execute = () =>
    runWithConcurrency<Awaited<R>>(
      {
        store: namespaceContext.base,
        options: ctx === undefined ? {} : ctx,
        prepare: selectedJournal === undefined ? undefined : () => selectedJournal.prepare(),
        executeAttempt: (context, invoke) =>
          namespaceContext.core.execution.run(
            { operation, input: input(context), ctx: context, internal: true },
            (captured) => {
              namespaceContext.controller.assertLive()
              observedInput = captured
              work = prepare(captured, admit)
              admit()
              return invoke()
            }
          ),
        lock: () =>
          selectedJournal === undefined
            ? (work.keys ?? [])
            : [...(work.keys ?? []), ...selectedJournal.headLocks()]
      },
      {
        attempt: (attempt) =>
          namespaceContext.locks.attempt(
            attempt,
            holding(namespaceContext),
            {
              attempt: () =>
                transact(
                  namespaceContext,
                  work.invoke,
                  attempt,
                  work.ranges,
                  (identities) => {
                    capacityIdentities = identities
                  },
                  journaled,
                  observing
                    ? (keys) => {
                        observedKeys = keys
                      }
                    : undefined
                )
            },
            namespaceContext.core.stageBindings.concurrencyStages(namespaceContext.store),
            namespaceContext.controller.closingSignal,
            work.ranges,
            namespaceContext.capacity === undefined ? undefined : () => capacityIdentities
          )
      }
    ).finally(() => release?.())
  return namespaceContext.core.execution.observe === undefined
    ? execute()
    : namespaceContext.core.execution.observe(
        () => ({
          operation,
          input: observedInput,
          keys: () => observedKeys ?? work?.keys ?? [],
          internal: journaled ? undefined : true
        }),
        (enabled) => {
          observing = enabled
          return execute()
        }
      )
}

/** Native store construction keeps public sync methods separate from internal asynchronous calls. */
export function createMemoryNamespaceBase<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['base'] {
  return {
    backend: STORAGE_MEMORY_BACKEND,
    capabilities: {
      batch: true,
      syncRead: true,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: namespaceContext.assembly.iterator !== undefined,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    sync: createMemoryNamespaceSync(namespaceContext),
    ...createMemoryNamespaceBaseText(namespaceContext),
    ...createMemoryNamespaceBaseBytes(namespaceContext),
    ...createMemoryNamespaceBaseRecords(namespaceContext),
    ...createMemoryNamespaceBaseTransactions(namespaceContext),
    ...(namespaceContext.core.journal === undefined
      ? {}
      : {
          undo: async (txId: string, ctx?: IOperationContext) => {
            namespaceContext.controller.assertLive()
            /** The existing controller drains accepted image lookup and the actual native commit. */
            const release = namespaceContext.controller.beginMutation()
            /**
             * This outer call supplies only the original shared budget; the builder owns all locks,
             * retries, the one pipeline and native data transaction.
             */
            return runWithConcurrency<{ readonly txId: string }>(
              {
                store: namespaceContext.base,
                options: ctx === undefined ? {} : ctx,
                prepare: () => namespaceContext.core.journal!.prepare()
              },
              {
                attempt: async (context) => ({
                  status: 'committed',
                  value: await namespaceContext.core.journal!.undo(txId, (keys, work) =>
                    createTransactionBuilder(
                      namespaceContext.store,
                      context,
                      namespaceContext.core.getChainMethods('tx')
                    )
                      .lock(keys[0]!, ...keys.slice(1))
                      .run(work)
                  )
                })
              }
            ).finally(release)
          }
        }),
    ...createMemoryNamespaceBaseObservation(namespaceContext),
    [asyncDisposeKey]: () =>
      (namespaceContext.symbolic ??= namespaceContext.controller
        .dispose()
        .catch((error) => reportCleanupError(namespaceContext.report, error)))
  }
}

/** Bound bytes are independently held and reused for radix localization rather than full scans. */
export function orderedRange<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  range: IKeyRange | undefined
): IOrderedRecordRange {
  /** The original range owner captures every caller getter and mutable logical bound. */
  const captured = snapshotKeyRange(range, STORAGE_MEMORY_BACKEND)
  return {
    lower:
      captured?.lower === undefined
        ? undefined
        : encodeOrderedStorageKey(captured.lower, STORAGE_MEMORY_BACKEND),
    upper:
      captured?.upper === undefined
        ? undefined
        : encodeOrderedStorageKey(captured.upper, STORAGE_MEMORY_BACKEND),
    lowerOpen: captured?.lowerOpen,
    upperOpen: captured?.upperOpen
  }
}

/** RDF graph projection reuses the one contract owner while keeping this namespace immutable. */
export function physicalRdfPattern<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  pattern: Readonly<Partial<IQuad>>
): Readonly<Partial<IQuad>> {
  return pattern.graph === undefined
    ? pattern
    : { ...pattern, graph: prefixStorageOrgGraph(namespaceContext.orgId, pattern.graph) }
}

/** Physical graph envelopes never escape a native organization view. */
export function logicalRdfQuad<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  entry: IMemoryEntry
): IQuad {
  /** Native RDF entries own detached ground terms and an organization-prefixed named graph. */
  const quad = entry.value as IQuad
  return {
    ...quad,
    graph: unprefixStorageOrgGraph(
      namespaceContext.orgId,
      quad.graph as Parameters<typeof unprefixStorageOrgGraph>[1]
    )
  }
}

/** Full-batch canonical capture finishes before any logical lock or physical mutation. */
export function captureRdfEntries<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  input: readonly IQuad[]
): readonly IMemoryRdfEntry[] {
  return (() => {
    if (!Array.isArray(input))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: STORAGE_MEMORY_BACKEND
      })
    /** Borrowed array bounds are captured once before validating any member or changing data. */
    const length = input.length
    /** Duplicate quads share one eventual physical change after every input has been admitted. */
    const entries = new Map<string, IMemoryRdfEntry>()
    for (let index = 0; index < length; index++) {
      /** The contract alone owns ground position rules and detached term identity. */
      const logical = snapshotStorageRdfQuad(input[index]!, STORAGE_MEMORY_BACKEND)
      /** Each namespace stores real organization graphs even though its maps are also isolated. */
      const value = {
        ...logical,
        graph: prefixStorageOrgGraph(namespaceContext.orgId, logical.graph)
      }
      /** Explicit user locks and additional capacity victims must meet on this logical quad. */
      const rdfLock = lockKey.rdf(logical)
      /** A string row key avoids reclassifying large canonical RDF bytes as public binary keys. */
      const encoded = snapshotConcurrencyLockKeys([lockKey.rdf(value)], STORAGE_MEMORY_BACKEND)
        .identities[0]!
      /** Six physical permutations retain only the canonical term writer's independent bytes. */
      const rdfKeys = memoryRdfKeys(value)
      entries.set(encoded, {
        key: encoded,
        encoded,
        value,
        ordered: rdfKeys[0]!,
        rdfKeys,
        rdfLock,
        bytes: entryBytes(namespaceContext, 'rdf', value)
      })
    }
    return [...entries.values()]
  })()
}

/** Root pattern reads stream only the selected native prefix and retain safe leaf advancement. */
function* rdfRows<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  pattern: Readonly<Partial<IQuad>>
): IterableIterator<IMemoryEntry> {
  for (const row of namespaceContext.rdfIndex.match(
    physicalRdfPattern(namespaceContext, pattern)
  )) {
    namespaceContext.capacityIndex?.touch(identity(namespaceContext, 'rdf', row.key as string))
    yield row
  }
}

/** Root RDF queries expose truthful pattern access; traversal, sorting and cursors keep their owner. */
export function rootRdfQuery<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  pattern: Partial<IQuad>
): ReturnType<IRdfApi['match']> {
  namespaceContext.controller.assertLive()
  /** Caller getters detach at construction; native execution later receives this trusted shape. */
  const captured = snapshotStorageRdfPattern(pattern, STORAGE_MEMORY_BACKEND)
  return createRdfQuery(
    {
      asyncDisposeKey,
      cursorSource: namespaceContext.store,
      watch: ({ ctx }) => watchChanges(namespaceContext, 'all', ctx),
      mutate: (request, run) =>
        atomicEntry(
          namespaceContext,
          request.operation === 'delete'
            ? MemoryOperation.rdfQueryDelete
            : MemoryOperation.rdfQueryReplace,
          () => ({ ...request }),
          { ...request.ctx, concurrency: request.concurrency },
          (input) => ({ invoke: (scope) => scope[queryDraft].rdf(input, run) })
        ),
      pushdown: {
        source: MemoryState.querySource,
        index: namespaceContext.rdfIndex.select(physicalRdfPattern(namespaceContext, captured))
          .name,
        operations: [],
        operators: []
      },
      execute: (input) =>
        nativeIterator(
          namespaceContext,
          MemoryOperation.rdfMatch,
          input.ctx,
          () => rdfRows(namespaceContext, input.pattern),
          (row): readonly [IStorageKey, IQuad] => [row.key, logicalRdfQuad(namespaceContext, row)]
        )
    },
    captured,
    namespaceContext.core.getChainMethods('rdf')
  )
}

/** Root scans retain one actual native generator and one cached cleanup path. */
export function rootIterator<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  range: IKeyRange | undefined,
  ctx: IOperationContext | undefined
): IStorageIterator<[IStorageKey, T]> {
  /** Bounds capture at construction; data membership and values capture on the first actual next. */
  const captured = orderedRange(namespaceContext, range)
  return nativeIterator(
    namespaceContext,
    MemoryOperation.iterateRecords,
    ctx,
    () =>
      [...namespaceContext.ordered.record.range(captured)]
        .map((leaf) => {
          const encoded = encodeFlatStorageKey(leaf.value.key)
          const entry = liveEntry(namespaceContext, 'record', encoded)
          if (entry !== undefined)
            namespaceContext.capacityIndex?.touch(identity(namespaceContext, 'record', encoded))
          return entry
        })
        .filter((entry): entry is IMemoryEntry => entry !== undefined),
    (row): [IStorageKey, T] => [
      clone(namespaceContext, row.key),
      clone(namespaceContext, row.value) as T
    ]
  )
}

/** Native families reuse this original memory generator and its cached cleanup/signal owner. */
export function nativeIterator<T, V, R>(
  namespaceContext: IMemoryNamespaceContext<T>,
  operation: string,
  ctx: IOperationContext | undefined,
  select: () => Iterable<V>,
  project: (row: V) => R,
  beforeNext?: () => void
): IStorageIterator<R> {
  /** This actual iterator alone owns its timeout and caller abort subscriptions. */
  const merged = mergeSignals(ctx, namespaceContext.report)
  /** The primary cleanup Promise seals further native advances synchronously. */
  let disposal: Promise<void> | undefined
  /** Symbolic disposal reports once through its separately cached derivative. */
  let symbolic: Promise<void> | undefined
  /** Iterator return shares the same cleanup while retaining its own result Promise. */
  let returned: Promise<IteratorResult<R>> | undefined
  /** The generator supplies serialization of native next/return without another resource queue. */
  const native = (async function* () {
    namespaceContext.controller.assertLive()
    throwIfAborted(merged.signal)
    /** Committed values are immutable to callers and snapshot with native membership. */
    const rows = select()
    for (const row of rows) {
      namespaceContext.controller.assertLive()
      throwIfAborted(merged.signal)
      yield project(row)
    }
  })()
  /** Explicit return, natural completion and disposal release this same generator and signal owner. */
  const dispose = (): Promise<void> =>
    (disposal ??= Promise.resolve().then(async () => {
      try {
        await native.return(undefined)
      } finally {
        merged.dispose()
      }
    }))
  return {
    next: () => {
      try {
        beforeNext?.()
        return namespaceContext.core.execution.run(
          { operation, input: undefined, ctx },
          async () => {
            if (disposal) {
              await disposal
              return { done: true, value: undefined }
            }
            try {
              /** Each original native advancement completes before its result is exposed. */
              const result = await native.next()
              if (result.done) await dispose()
              return result
            } catch (cause) {
              await dispose()
              throw cause
            }
          }
        )
      } catch (cause) {
        return Promise.reject(cause)
      }
    },
    return: (value) => (returned ??= dispose().then(() => ({ done: true, value }))),
    dispose,
    [asyncDisposeKey]: () =>
      (symbolic ??= dispose().catch((error) => reportCleanupError(namespaceContext.report, error))),
    [Symbol.asyncIterator]() {
      return this
    }
  }
}
