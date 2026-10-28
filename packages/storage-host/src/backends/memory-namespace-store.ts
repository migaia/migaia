// Namespace RDF, store and journal-image surfaces for the memory backend (see ./memory.ts).
import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  implement,
  kv,
  records,
  ttl,
  counter,
  vector,
  rdf,
  blob,
  type IQuad,
  type ITransactionScope,
  type IWriteConcurrencyOptions,
  type IOperationContext
} from '@migaia/storage-contract'
import { snapshotConcurrencyLockRange } from '../authoring/concurrency.ts'
import { snapshotStorageKeyPrefix } from '../authoring/key.ts'
import { assertTransactionOwner } from '../authoring/transaction.ts'
import { createRecordQuery } from '../authoring/query.ts'
import { provideCapabilities } from '../authoring/capability.ts'
import type { IStorageJournalImage, IStorageJournalTarget } from '../journal/types.ts'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.ts'
import { MemoryOperation, MemoryState } from './memory-constants.ts'
import { encodeFlatStorageKey } from '../core/key-domain.ts'
import {
  mutationEntry,
  capacityFact,
  identity,
  bump,
  publish,
  deletePhysical,
  liveEntry
} from './memory-entries.ts'
import {
  captureRdfEntries,
  logicalRdfQuad,
  rootRdfQuery,
  watchChanges,
  atomicEntry
} from './memory-namespace-base.ts'
import { bindRecords } from './memory-scope.ts'
import {
  ttlOperations,
  rdfOperations,
  counterOperations,
  queryDraft,
  journalOperations
} from './memory.ts'
import type { IMemoryNamespaceContext, IMemoryEntry, IMemoryScope } from './memory.ts'

/** Native RDF writes use the original mutation runner, canonical locks and final synchronous turn. */
export function createMemoryNamespaceRdfApi<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['rdfApi'] {
  return {
    add: (quads, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.rdfAdd, quads, ctx, (input) => {
        /** Full canonical admission precedes root lock acquisition and the final physical turn. */
        const entries = captureRdfEntries(namespaceContext, input)
        return {
          keys: entries.map((entry) => entry.rdfLock),
          invoke: (draft) =>
            draft.rdf(
              entries.map((entry: IMemoryEntry) => logicalRdfQuad(namespaceContext, entry)),
              false
            ),
          capacityChanges:
            namespaceContext.capacity === undefined
              ? undefined
              : () =>
                  entries.map((entry) =>
                    capacityFact(namespaceContext, 'rdf', entry.key, entry.bytes, entry.rdfLock)
                  ),
          run: () => {
            /** Idempotent additions publish only when physical membership really changes. */
            let changed = false
            for (const entry of entries) {
              if (namespaceContext.data.rdf.has(entry.encoded)) {
                namespaceContext.capacityIndex?.touch(
                  identity(namespaceContext, 'rdf', entry.encoded)
                )
                continue
              }
              namespaceContext.data.rdf.set(entry.encoded, entry)
              namespaceContext.rdfIndex.set(entry.rdfKeys, entry)
              namespaceContext.capacityIndex?.put({
                ...capacityFact(namespaceContext, 'rdf', entry.key, undefined, entry.rdfLock),
                bytes: entry.bytes ?? 0
              })
              bump(namespaceContext, 'rdf', entry.encoded)
              changed = true
            }
            if (changed) publish(namespaceContext, 'rdf', 'batch')
          }
        }
      }),
    delete: (quads, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.rdfDelete, quads, ctx, (input) => {
        /** All supplied quads validate before an existing point can be removed. */
        const entries = captureRdfEntries(namespaceContext, input)
        return {
          keys: entries.map((entry) => entry.rdfLock),
          invoke: (draft) =>
            draft.rdf(
              entries.map((entry: IMemoryEntry) => logicalRdfQuad(namespaceContext, entry)),
              true
            ),
          run: () => {
            /** Repeated or absent deletions do not manufacture revisions or events. */
            let changed = false
            for (const entry of entries)
              if (deletePhysical(namespaceContext, 'rdf', entry.encoded) !== undefined)
                changed = true
            if (changed) publish(namespaceContext, 'rdf', 'batch')
          }
        }
      }),
    match: (pattern: Partial<IQuad>) => rootRdfQuery(namespaceContext, pattern)
  }
}

/** Publish the real built-in APIs on the original resource, never a copied base. */
export function createMemoryNamespaceStore<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['store'] {
  return provideCapabilities(
    namespaceContext.base,
    [
      implement(kv, namespaceContext.keyValue, { forTransaction: (scope) => scope }),
      implement(ttl, namespaceContext.timeToLive, {
        forTransaction: (scope) => (scope as IMemoryScope<T>)[ttlOperations]
      }),
      implement(vector, namespaceContext.vectors),
      implement(blob, namespaceContext.objects),
      implement(rdf, namespaceContext.rdfApi, {
        forTransaction: (scope) => (scope as IMemoryScope<T>)[rdfOperations]
      }),
      implement(counter, namespaceContext.counters, {
        forTransaction: (scope) => (scope as IMemoryScope<T>)[counterOperations]
      }),
      implement(
        records,
        {
          query: <R = T>() =>
            createRecordQuery<R>(
              {
                asyncDisposeKey,
                watch: ({ ctx }) => watchChanges(namespaceContext, 'record', ctx),
                mutate: (request, run) =>
                  atomicEntry(
                    namespaceContext,
                    request.operation === 'delete'
                      ? MemoryOperation.recordQueryDelete
                      : MemoryOperation.recordQueryUpdate,
                    () => ({ ...request }),
                    { ...request.ctx, concurrency: request.concurrency },
                    (input) => ({ invoke: (scope) => scope[queryDraft].record(input, run) })
                  ),
                pushdown: { source: MemoryState.querySource, operations: [], operators: [] },
                execute: ({ ctx }) => namespaceContext.base.iterateRecords(undefined, ctx)
              },
              namespaceContext.core.getChainMethods('query')
            ),
          removeByPrefix: (prefix, ctx?: IOperationContext & IWriteConcurrencyOptions) =>
            mutationEntry(
              namespaceContext,
              MemoryOperation.recordRemoveByPrefix,
              prefix,
              ctx,
              (input) => {
                /** Native membership is localized by the same canonical prefix bounds as queries. */
                const captured = snapshotStorageKeyPrefix(input, STORAGE_MEMORY_BACKEND)
                return {
                  keys: [],
                  invoke: (draft) => draft.removeByPrefix(captured.key, 'record'),
                  ranges: [
                    {
                      channel: 'record',
                      ...snapshotConcurrencyLockRange(
                        { channel: 'record', prefix: captured.key },
                        STORAGE_MEMORY_BACKEND
                      )
                    }
                  ],
                  run: () => {
                    namespaceContext.controller.assertLive()
                    /** Capture only matching native leaves before unlinking their adjacency links. */
                    const rows = [
                      ...namespaceContext.ordered.record.range({
                        lower: captured.lower,
                        upper: captured.upper,
                        upperOpen: true
                      })
                    ]
                      .map((leaf) =>
                        liveEntry(namespaceContext, 'record', encodeFlatStorageKey(leaf.value.key))
                      )
                      .filter((entry): entry is IMemoryEntry => entry !== undefined)
                    for (const row of rows) {
                      /** Every selected live row shares the original hash/radix/revision identity. */
                      const encoded = encodeFlatStorageKey(row.key)
                      deletePhysical(namespaceContext, 'record', encoded)
                    }
                    if (rows.length > 0)
                      publish(
                        namespaceContext,
                        'record',
                        'batch',
                        rows.map((row) => row.key)
                      )
                    return rows.length
                  }
                }
              }
            )
        },
        { forTransaction: (scope: ITransactionScope) => bindRecords(namespaceContext, scope) }
      )
    ],
    {
      onInstaller: (value) => {
        namespaceContext.installer = value
      }
    }
  )
}

/** Only this original registration can forward image operations to an authenticated native scope. */
export function createMemoryNamespaceJournalImages<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['journalImages'] {
  return {
    changes: (scope: Omit<ITransactionScope, 'use'>) => {
      assertTransactionOwner(namespaceContext.store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].changes()
    },
    readImage: (scope: Omit<ITransactionScope, 'use'>, target: IStorageJournalTarget) => {
      assertTransactionOwner(namespaceContext.store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].readImage(target)
    },
    writeImage: (
      scope: Omit<ITransactionScope, 'use'>,
      target: IStorageJournalTarget,
      image: IStorageJournalImage
    ) => {
      assertTransactionOwner(namespaceContext.store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].writeImage(target, image)
    },
    readRevision: (scope: Omit<ITransactionScope, 'use'>, target: IStorageJournalTarget) => {
      assertTransactionOwner(namespaceContext.store, scope)
      return (scope as IMemoryScope<T>)[journalOperations].readRevision(target)
    }
  }
}
