// Scope operations and scoped capability surfaces for the memory backend (see ./memory.ts).
import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  assertStorageTtlDuration,
  type ITransactionRecordsApi,
  readTransactionConflictPolicy,
  type IStorageVectorPoint,
  type IVectorQuerySource,
  type IQueryDelete,
  type IStorageKey,
  type ITransactionScope
} from '@migaia/storage-contract'
import { snapshotStorageBatchKeys, snapshotStorageKeyPrefix } from '../authoring/key.ts'
import { snapshotStorageCounterIncrement } from '../authoring/counter.ts'
import {
  assertTransactionOwner,
  runTransactionOperation,
  useTransactionCapability
} from '../authoring/transaction.ts'
import { createRecordQuery } from '../authoring/query.ts'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.ts'
import { MemoryOperation, MemoryState } from './memory-constants.ts'
import { createStorageToken } from '../core/storage-token.ts'
import { throwIfAborted } from '../core/operation.ts'
import { clone, planCapacity, identity, capacityFact, copyValue } from './memory-entries.ts'
import { captureTtlTarget } from './memory-keyvalue.ts'
import {
  batchSize,
  observeBatch,
  readTextBatch,
  captureTextEntries,
  orderedRange,
  captureRdfEntries,
  logicalRdfQuad
} from './memory-namespace-base.ts'
import {
  changes,
  readJournalImage,
  writeJournalImage,
  readJournalRevision,
  txTtl,
  txRemaining
} from './memory-transaction-journal.ts'
import {
  privateJournal,
  queryIterator,
  txVectorPoints,
  txRead,
  txRemove,
  txWrite,
  txRdfWrite,
  rdfQuery,
  txRows,
  txEntry,
  txRdfRows,
  txSnapshot
} from './memory-transaction.ts'
import type { IMemoryTransactionContext } from './memory-transaction.ts'
import { vectorKey } from './memory-vector.ts'
import {
  journalOperations,
  queryDraft,
  recordQueries,
  ttlOperations,
  counterOperations,
  rdfOperations,
  recordPrefix
} from './memory.ts'
import type {
  IMemoryScope,
  IMemoryVectorSelection,
  IMemoryNamespaceContext,
  IMemoryQueryDraft
} from './memory.ts'

/** The same physical scope factory serves callbacks, nested operations and final checks. */
/** One published view borrows the original attempt and authentic native scope. */
type IMemoryScopeContext<T, R> = {
  /** The accepted transaction owns draft rows, stages and lifetime. */
  readonly transactionContext: IMemoryTransactionContext<T, R>
  /** Every method uses this published view for owner admission. */
  scope: IMemoryScope<T>
}
/** Publish native channel methods before attaching the original feature API. */
export function createScope<T, R>(
  transactionContext: IMemoryTransactionContext<T, R>
): IMemoryScope<T> {
  /** Channel callbacks access the scope only after construction completes. */
  const scopeContext = { transactionContext } as IMemoryScopeContext<T, R>
  scopeContext.scope = {
    [journalOperations]: createMemoryScopeJournal(scopeContext),
    [queryDraft]: createMemoryScopeQueryDraft(scopeContext),
    [recordQueries]: createMemoryScopeRecordQuery(scopeContext),
    [ttlOperations]: createMemoryScopeTtl(scopeContext),
    [counterOperations]: createMemoryScopeCounter(scopeContext),
    [rdfOperations]: createMemoryScopeRdf(scopeContext),
    [recordPrefix]: createMemoryScopeRecordPrefix(scopeContext),
    use: (capability) => useTransactionCapability(scopeContext.scope, capability),
    ...createMemoryScopeText(scopeContext),
    ...createMemoryScopeBytes(scopeContext),
    ...createMemoryScopeRecords(scopeContext)
  }
  /** Feature assembly receives the same authentic native view. */
  const api = transactionContext.namespaceContext.core.createTransactionApi(scopeContext.scope)
  if (api !== undefined)
    Object.defineProperty(scopeContext.scope, 'api', { value: api, enumerable: true })
  return scopeContext.scope
}
/** Admit one native operation before pipeline evaluation and stage observation. */
function memoryScopeOperation<T, R, I, V>(
  scopeContext: IMemoryScopeContext<T, R>,
  name: string,
  input: I,
  invoke: (captured: I) => V,
  settle?: true
): Promise<Awaited<V>> {
  return runTransactionOperation(scopeContext.scope, (current) =>
    acceptedMemoryScopeOperation(scopeContext, name, input, invoke, current, settle)
  )
}
/** Run already-admitted draft work through the sole pipeline and original stage pair. */
function acceptedMemoryScopeOperation<T, R, I, V>(
  scopeContext: IMemoryScopeContext<T, R>,
  name: string,
  input: I,
  invoke: (captured: I) => V,
  current: ITransactionScope,
  settle?: true
): Promise<V> {
  return scopeContext.transactionContext.namespaceContext.core.execution.run(
    { operation: name, input, scope: current, ctx: scopeContext.transactionContext.ctx },
    async (captured) => {
      scopeContext.transactionContext.namespaceContext.controller.assertLive()
      throwIfAborted(scopeContext.transactionContext.ctx.signal)
      /** This current scope is authentic for exactly this operation's original lifetime. */
      const stage = scopeContext.transactionContext.namespaceContext.core.stageBindings
        .transactionStages(scopeContext.transactionContext.namespaceContext.store)
        .forTransaction(current)
      void stage.beforeTxOperation?.(name)
      /** Native memory operations mutate only the private isolated draft. */
      const result = invoke(captured)
      if (settle) {
        /** Query writes finish their existing asynchronous reader before the after stage. */
        const completed = await result
        void stage.afterTxOperation?.(name)
        return completed
      }
      void stage.afterTxOperation?.(name)
      return result
    }
  )
}
/** Empty batches retain owner admission while skipping pipeline and batch observation. */
function memoryScopeBatchOperation<T, R, I extends readonly unknown[], V>(
  scopeContext: IMemoryScopeContext<T, R>,
  name: string,
  input: I,
  invoke: (captured: I) => V
): Promise<Awaited<V>> {
  return runTransactionOperation(scopeContext.scope, (current) => {
    if (batchSize(scopeContext.transactionContext.namespaceContext, input) === 0)
      return invoke(input)
    return acceptedMemoryScopeOperation(
      scopeContext,
      name,
      input,
      (captured) =>
        observeBatch(
          scopeContext.transactionContext.namespaceContext,
          name,
          captured.length,
          () => invoke(captured),
          scopeContext.scope
        ),
      current
    )
  })
}
/** Compose the current native view's Journal channel. */
function createMemoryScopeJournal<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof journalOperations] {
  return {
    changes: () => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      return changes(scopeContext.transactionContext)
    },
    readImage: (target) =>
      runTransactionOperation(scopeContext.scope, () =>
        readJournalImage(scopeContext.transactionContext, target)
      ),
    writeImage: (target, image) =>
      runTransactionOperation(scopeContext.scope, () =>
        writeJournalImage(scopeContext.transactionContext, target, image)
      ),
    readRevision: (target) =>
      runTransactionOperation(scopeContext.scope, () =>
        readJournalRevision(scopeContext.transactionContext, target)
      ),
    run: (prefix, work) =>
      runTransactionOperation(scopeContext.scope, (current) =>
        privateJournal(scopeContext.transactionContext).port.run(prefix, work, (run) =>
          runTransactionOperation(current, run)
        )
      ),
    onCommit: (effect) => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      return privateJournal(scopeContext.transactionContext).port.onCommit(effect)
    },
    onRollback: (effect) => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      return privateJournal(scopeContext.transactionContext).port.onRollback(effect)
    }
  }
}
/** Compose the current native view's QueryDraft channel. */
function createMemoryScopeQueryDraft<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof queryDraft] {
  return {
    record: (...args) => memoryScopeQueryRecord(scopeContext, ...args),
    rdf: (...args) => memoryScopeQueryRdf(scopeContext, ...args),
    vector: <P>(
      collection: string,
      _request: IQueryDelete,
      run: Parameters<NonNullable<IVectorQuerySource<P>['mutate']>>[1],
      select: IMemoryVectorSelection<P>
    ) => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      return run({
        execute: (input) =>
          queryIterator(scopeContext.transactionContext, scopeContext.scope, () =>
            select(
              input,
              txVectorPoints<T, R, P>(scopeContext.transactionContext, collection),
              (id) =>
                txRead(
                  scopeContext.transactionContext,
                  'vector',
                  vectorKey(scopeContext.transactionContext.namespaceContext, collection, id)
                ) as IStorageVectorPoint<P> | undefined
            )
          ),
        accept: (_key, hit) => {
          assertTransactionOwner(
            scopeContext.transactionContext.namespaceContext.store,
            scopeContext.scope
          )
          return txRemove(
            scopeContext.transactionContext,
            'vector',
            vectorKey(scopeContext.transactionContext.namespaceContext, collection, hit.id)
          )
        }
      })
    }
  }
}
/** Compose the current native view's RecordQuery channel. */
function createMemoryScopeRecordQuery<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof recordQueries] {
  return <R>() =>
    createRecordQuery<R>(
      {
        asyncDisposeKey,
        cursorSource: scopeContext.scope,
        pushdown: { source: MemoryState.querySource, operations: [], operators: [] },
        execute: () => scopeContext.scope.iterateRecords(),
        mutate: (request, run) =>
          memoryScopeOperation(
            scopeContext,
            request.operation === 'delete'
              ? MemoryOperation.recordQueryDelete
              : MemoryOperation.recordQueryUpdate,
            request,
            (captured) => scopeContext.scope[queryDraft].record(captured, run),
            true
          )
      },
      scopeContext.transactionContext.namespaceContext.core.getChainMethods('query')
    )
}
/** Compose the current native view's Ttl channel. */
function createMemoryScopeTtl<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof ttlOperations] {
  return {
    expire: (target, ms) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.ttlExpire,
        { target, ms },
        (input) => {
          /** Validation stays inside the one operation already admitted by tx.use(ttl). */
          const target = captureTtlTarget(
            scopeContext.transactionContext.namespaceContext,
            input.target
          )
          /** Preserve this pipeline-provided duration while the native operation settles. */
          const ms = input.ms
          assertStorageTtlDuration(ms, STORAGE_MEMORY_BACKEND)
          return txTtl(scopeContext.transactionContext, target, ms, false)
        },
        scopeContext.scope
      ),
    remaining: (target) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.ttlRemaining,
        target,
        (input) =>
          txRemaining(
            scopeContext.transactionContext,
            captureTtlTarget(scopeContext.transactionContext.namespaceContext, input)
          ),
        scopeContext.scope
      ),
    persist: (target) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.ttlPersist,
        target,
        (input) =>
          txTtl(
            scopeContext.transactionContext,
            captureTtlTarget(scopeContext.transactionContext.namespaceContext, input),
            undefined,
            true
          ),
        scopeContext.scope
      )
  }
}
/** Compose the current native view's Counter channel. */
function createMemoryScopeCounter<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof counterOperations] {
  return {
    increment: (key, by) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.counterIncrement,
        { key, by },
        (input) => {
          /** Snapshot pipeline-provided identity before any native text access. */
          const key = input.key
          assertStringStorageKey(key, STORAGE_MEMORY_BACKEND)
          /** The pure contract calculation runs against this native text draft only. */
          const increment = snapshotStorageCounterIncrement(input.by, STORAGE_MEMORY_BACKEND)
          const result = increment(
            txRead(scopeContext.transactionContext, 'value', key) as string | undefined
          )
          txWrite(scopeContext.transactionContext, 'value', key, String(result), 'conflict')
          return result
        },
        scopeContext.scope
      )
  }
}
/** Compose the current native view's Rdf channel. */
function createMemoryScopeRdf<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof rdfOperations] {
  return {
    add: (quads) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.rdfAdd,
        quads,
        (input) => txRdfWrite(scopeContext.transactionContext, input, false),
        scopeContext.scope
      ),
    delete: (quads) =>
      acceptedMemoryScopeOperation(
        scopeContext,
        MemoryOperation.rdfDelete,
        quads,
        (input) => txRdfWrite(scopeContext.transactionContext, input, true),
        scopeContext.scope
      ),
    match: (pattern) =>
      rdfQuery(scopeContext.transactionContext, pattern, scopeContext.scope, (request, run) =>
        memoryScopeOperation(
          scopeContext,
          request.operation === 'delete'
            ? MemoryOperation.rdfQueryDelete
            : MemoryOperation.rdfQueryReplace,
          request,
          (captured) => scopeContext.scope[queryDraft].rdf(captured, run),
          true
        )
      )
  }
}
/** Compose the current native view's RecordPrefix channel. */
function createMemoryScopeRecordPrefix<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): IMemoryScope<T>[typeof recordPrefix] {
  return (prefix) =>
    memoryScopeOperation(scopeContext, MemoryOperation.recordRemoveByPrefix, prefix, (current) => {
      /** Native record prefix deletion uses the same bounded draft merge as record iteration. */
      const captured = snapshotStorageKeyPrefix(current, STORAGE_MEMORY_BACKEND)
      let count = 0
      for (const row of txRows(scopeContext.transactionContext, 'record', {
        lower: captured.lower,
        upper: captured.upper,
        upperOpen: true
      }))
        if (txRemove(scopeContext.transactionContext, 'record', row.key)) count++
      return count
    })
}
/** Compose the current native view's text methods. */
function createMemoryScopeText<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): Pick<
  IMemoryScope<T>,
  'get' | 'set' | 'remove' | 'has' | 'getMany' | 'setMany' | 'removeMany' | 'removeByPrefix'
> {
  return {
    get: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.get, key, (current) => {
        assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
        return (
          (txRead(scopeContext.transactionContext, 'value', current) as string | undefined) ?? null
        )
      }),
    set: (key, value, options) =>
      memoryScopeOperation(
        scopeContext,
        MemoryOperation.set,
        { key, value, options },
        (current) => {
          assertStringStorageKey(current.key, STORAGE_MEMORY_BACKEND)
          txWrite(
            scopeContext.transactionContext,
            'value',
            current.key,
            current.value,
            readTransactionConflictPolicy(current.options, STORAGE_MEMORY_BACKEND)
          )
        }
      ),
    remove: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.remove, key, (current) => {
        assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
        txRemove(scopeContext.transactionContext, 'value', current)
      }),
    has: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.has, key, (current) => {
        assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
        return txRead(scopeContext.transactionContext, 'value', current) !== undefined
      }),
    getMany: (keys) =>
      memoryScopeBatchOperation(scopeContext, MemoryOperation.getMany, keys, (current) =>
        readTextBatch(
          scopeContext.transactionContext.namespaceContext,
          current,
          (key) => txRead(scopeContext.transactionContext, 'value', key) as string | undefined
        )
      ),
    setMany: (entries) =>
      memoryScopeBatchOperation(scopeContext, MemoryOperation.setMany, entries, (current) =>
        scopeContext.transactionContext.textDraft.setMany(
          captureTextEntries(scopeContext.transactionContext.namespaceContext, current)
        )
      ),
    removeMany: (keys) =>
      memoryScopeBatchOperation(scopeContext, MemoryOperation.removeMany, keys, (current) => {
        /** Validate every key before applying the batch's first tombstone. */
        const captured = snapshotStorageBatchKeys(current, STORAGE_MEMORY_BACKEND)
          .filter(({ firstIndex }, index) => firstIndex === index)
          .map(({ key }) => key)
        return scopeContext.transactionContext.textDraft.removeMany(captured)
      }),
    removeByPrefix: (prefix) =>
      memoryScopeOperation(scopeContext, MemoryOperation.removeByPrefix, prefix, (current) =>
        observeBatch(
          scopeContext.transactionContext.namespaceContext,
          MemoryOperation.removeByPrefix,
          undefined,
          () => scopeContext.transactionContext.textDraft.removeByPrefix(current),
          scopeContext.scope
        )
      )
  }
}
/** Compose the current native view's bytes methods. */
function createMemoryScopeBytes<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): Pick<IMemoryScope<T>, 'getBytes' | 'setBytes' | 'removeBytes'> {
  return {
    getBytes: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.getBytes, key, (current) => {
        assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
        return (
          (txRead(scopeContext.transactionContext, 'bytes', current) as Uint8Array | undefined) ??
          null
        )
      }),
    setBytes: (key, value, options) =>
      memoryScopeOperation(
        scopeContext,
        MemoryOperation.setBytes,
        { key, value, options },
        (current) => {
          assertStringStorageKey(current.key, STORAGE_MEMORY_BACKEND)
          txWrite(
            scopeContext.transactionContext,
            'bytes',
            current.key,
            current.value,
            readTransactionConflictPolicy(current.options, STORAGE_MEMORY_BACKEND)
          )
        }
      ),
    removeBytes: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.removeBytes, key, (current) => {
        assertStringStorageKey(current, STORAGE_MEMORY_BACKEND)
        txRemove(scopeContext.transactionContext, 'bytes', current)
      })
  }
}
/** Compose the current native view's records methods. */
function createMemoryScopeRecords<T, R>(
  scopeContext: IMemoryScopeContext<T, R>
): Pick<IMemoryScope<T>, 'getRecord' | 'putRecord' | 'deleteRecord' | 'iterateRecords'> {
  return {
    getRecord: (key) =>
      memoryScopeOperation(
        scopeContext,
        MemoryOperation.getRecord,
        key,
        (current) => txRead(scopeContext.transactionContext, 'record', current) as T | undefined
      ),
    putRecord: (value, key, options) =>
      memoryScopeOperation(
        scopeContext,
        MemoryOperation.putRecord,
        { value, key, options },
        (current) => {
          /** Opaque generated record identities use the existing native entropy helper. */
          const resolved = current.key ?? createStorageToken()
          txWrite(
            scopeContext.transactionContext,
            'record',
            resolved,
            current.value,
            readTransactionConflictPolicy(current.options, STORAGE_MEMORY_BACKEND)
          )
          return resolved
        }
      ),
    deleteRecord: (key) =>
      memoryScopeOperation(scopeContext, MemoryOperation.deleteRecord, key, (current) => {
        txRemove(scopeContext.transactionContext, 'record', current)
      }),
    iterateRecords: (range) => {
      /** Bounds are captured at construction; native rows are snapshotted at first advance. */
      const captured = orderedRange(scopeContext.transactionContext.namespaceContext, range)
      /** The actual native iterator is registered once with the original transaction owner. */
      const iterator = (async function* () {
        /** Snapshot values together with membership on the first actual native advance. */
        const rows = txRows(scopeContext.transactionContext, 'record', captured).map(
          (row) =>
            [
              clone(scopeContext.transactionContext.namespaceContext, row.key),
              txRead(scopeContext.transactionContext, 'record', row.key) as T
            ] as [IStorageKey, T]
        )
        for (const [key, value] of rows) {
          scopeContext.transactionContext.namespaceContext.controller.assertLive()
          throwIfAborted(scopeContext.transactionContext.ctx.signal)
          yield [
            clone(scopeContext.transactionContext.namespaceContext, key),
            clone(scopeContext.transactionContext.namespaceContext, value)
          ] as [IStorageKey, T]
        }
      })()
      return scopeContext.transactionContext.namespaceContext.owner.registerIterator(
        scopeContext.scope,
        {
          next: (current) =>
            scopeContext.transactionContext.namespaceContext.core.execution.run(
              {
                operation: MemoryOperation.iterateRecords,
                input: undefined,
                scope: current,
                ctx: scopeContext.transactionContext.ctx
              },
              () => iterator.next()
            ),
          close: async () => {
            await iterator.return(undefined)
          }
        }
      )
    }
  }
}

/** Preview the original business draft, excluding only journal's own planned victim facts. */
export function draftCapacityPlan<T, R>(transactionContext: IMemoryTransactionContext<T, R>) {
  return transactionContext.namespaceContext.capacity === undefined
    ? undefined
    : planCapacity(
        transactionContext.namespaceContext,
        [...transactionContext.draft.values()]
          .filter(
            (proposed) =>
              !transactionContext.journalVictims?.has(
                identity(transactionContext.namespaceContext, proposed.channel, proposed.encoded)
              )
          )
          .map((proposed) =>
            capacityFact(
              transactionContext.namespaceContext,
              proposed.channel,
              proposed.key,
              proposed.remove ||
                (proposed.deadline !== undefined &&
                  proposed.deadline <= transactionContext.namespaceContext.scheduler.now())
                ? undefined
                : (proposed.bytes ?? 0),
              proposed.rdfLock
            )
          )
      )
}

/** Records capability binding composes only the supplied original transaction's real methods. */
export function bindRecords<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  scope: ITransactionScope
): ITransactionRecordsApi {
  return {
    query: (scope as IMemoryScope<unknown>)[recordQueries],
    removeByPrefix: (prefix) => (scope as IMemoryScope<unknown>)[recordPrefix](prefix)
  }
}
/** Apply the original record query mutation to the same accepted scope draft. */
function memoryScopeQueryRecord<T, R>(
  scopeContext: IMemoryScopeContext<T, R>,
  ...args: Parameters<IMemoryQueryDraft['record']>
): ReturnType<IMemoryQueryDraft['record']> {
  const [request, run] = args
  assertTransactionOwner(scopeContext.transactionContext.namespaceContext.store, scopeContext.scope)
  /** Pipeline-provided patches detach once before selection can touch any draft row. */
  const patch =
    request.operation === 'update'
      ? clone(scopeContext.transactionContext.namespaceContext, request.patch)
      : undefined
  if (
    request.operation !== 'delete' &&
    (request.operation !== 'update' ||
      typeof patch !== 'object' ||
      patch === null ||
      Array.isArray(patch))
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: STORAGE_MEMORY_BACKEND
    })
  return run({
    execute: () =>
      queryIterator(scopeContext.transactionContext, scopeContext.scope, function* () {
        for (const row of txRows(scopeContext.transactionContext, 'record'))
          yield [
            clone(scopeContext.transactionContext.namespaceContext, row.key),
            copyValue(
              scopeContext.transactionContext.namespaceContext,
              'record',
              row.value,
              row.key
            )
          ] as const
      }),
    accept: (key) => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      if (request.operation === 'delete')
        return txRemove(scopeContext.transactionContext, 'record', key)
      /** Query projections never become replacement values; patch the actual draft row. */
      const current = txEntry(scopeContext.transactionContext, 'record', key)
      if (current === undefined) return false
      if (typeof current.value !== 'object' || current.value === null)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
          backend: STORAGE_MEMORY_BACKEND
        })
      /** Existing native cloning preserves Date/Map values admitted by memory. */
      const value = clone(scopeContext.transactionContext.namespaceContext, current.value, key)
      for (const field of Object.keys(patch!)) {
        /** Existing native fields such as Array.length retain their original descriptors. */
        const descriptor = Object.getOwnPropertyDescriptor(value, field)
        Object.defineProperty(
          value,
          field,
          descriptor === undefined
            ? {
                value: patch![field],
                enumerable: true,
                configurable: true,
                writable: true
              }
            : { ...descriptor, value: patch![field] }
        )
      }
      txWrite(scopeContext.transactionContext, 'record', key, value, 'replace')
      return true
    }
  })
}
/** Apply the original rdf query mutation to the same accepted scope draft. */
function memoryScopeQueryRdf<T, R>(
  scopeContext: IMemoryScopeContext<T, R>,
  ...args: Parameters<IMemoryQueryDraft['rdf']>
): ReturnType<IMemoryQueryDraft['rdf']> {
  const [request, run] = args
  assertTransactionOwner(scopeContext.transactionContext.namespaceContext.store, scopeContext.scope)
  /** Replacement admission precedes selection or any draft tombstone. */
  const replacement =
    request.operation === 'replace'
      ? captureRdfEntries(scopeContext.transactionContext.namespaceContext, [request.newQuad])[0]
      : undefined
  return run({
    execute: (input) =>
      queryIterator(scopeContext.transactionContext, scopeContext.scope, function* () {
        for (const row of txRdfRows(scopeContext.transactionContext, input.pattern))
          yield [
            row.key,
            logicalRdfQuad(scopeContext.transactionContext.namespaceContext, row)
          ] as const
      }),
    accept: (_key, quad) => {
      assertTransactionOwner(
        scopeContext.transactionContext.namespaceContext.store,
        scopeContext.scope
      )
      /** The original physical identity resolves actual draft membership and no-op replacement. */
      const entry = captureRdfEntries(scopeContext.transactionContext.namespaceContext, [quad])[0]!
      const proposed = scopeContext.transactionContext.draft.get(
        identity(scopeContext.transactionContext.namespaceContext, 'rdf', entry.encoded)
      )
      const current = proposed
        ? proposed.remove
          ? undefined
          : proposed
        : txSnapshot(scopeContext.transactionContext, 'rdf', entry.encoded, entry.key)
      if (current === undefined || replacement?.encoded === entry.encoded) return false
      txRdfWrite(scopeContext.transactionContext, [quad], true)
      if (replacement !== undefined)
        txRdfWrite(
          scopeContext.transactionContext,
          [logicalRdfQuad(scopeContext.transactionContext.namespaceContext, replacement)],
          false
        )
      return true
    }
  })
}
