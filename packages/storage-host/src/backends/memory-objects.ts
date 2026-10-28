// Object (blob) capability and blob put/get for the memory backend (see ./memory.ts).
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  type IBlobInfo,
  type IBlobObject,
  type IStorageKey,
  type IOperationContext
} from '@migaia/storage-contract'
import { runWithConcurrency } from '../authoring/concurrency.ts'
import { prefixStorageOrgKey } from '../authoring/key.ts'
import {
  snapshotStorageBlobPut,
  snapshotStorageBlobGet,
  snapshotStorageBlobList,
  createStorageBlobObject,
  createStorageBlobBodyReader
} from '../authoring/blob.ts'
import { isUint8Array } from '@migaia/utils/bytes'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.ts'
import { MemoryOperation } from './memory-constants.ts'
import { createStorageToken } from '../core/storage-token.ts'
import { isStorageErrorFamily } from '../core/error-family.ts'
import {
  throwIfAborted,
  mergeSignals,
  subscribeToAbort,
  readAbortReason
} from '../core/operation.ts'
import { reportCleanupError } from '../core/operation-reporter.ts'
import {
  identity,
  mutationEntry,
  deletePhysical,
  publish,
  planCapacity,
  holding,
  commitCapacity,
  capacityFact
} from './memory-entries.ts'
import { asyncEntry } from './memory-namespace-base.ts'
import type { IMemoryNamespaceContext } from './memory.ts'

/** Native object failures reuse the existing memory serialization boundary and original cause. */
function blobFailure<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  cause: unknown,
  key?: string
) {
  return isStorageErrorFamily(cause)
    ? cause
    : new StorageError(StorageHostErrorCode.serializeFailed, {
        backend: STORAGE_MEMORY_BACKEND,
        key,
        cause
      })
}

/** Conditions inspect the current native generation both before reading and in the final turn. */
function assertBlobCondition<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  input: ReturnType<typeof snapshotStorageBlobPut>
): void {
  /** The current opaque generation is observed without taking reader ownership. */
  const current = namespaceContext.blobs.get(input.key)
  if (
    (input.options.ifMatch !== undefined && current?.value.info.etag !== input.options.ifMatch) ||
    (input.options.ifNoneMatch === true && current !== undefined)
  )
    throw new StorageContractError(StorageContractErrorCode.writeConflict, {
      backend: STORAGE_MEMORY_BACKEND
    })
}

/** Only the native sink buffers the complete object; reader lifecycle stays in the contract owner. */
async function loadBlobBody<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  input: ReturnType<typeof snapshotStorageBlobPut>,
  signal: IOperationContext['signal']
): Promise<Uint8Array> {
  if (isUint8Array(input.body)) return input.body
  /** Upload consumption and cancellation reuse the sole shared body-reader resource owner. */
  const reader = createStorageBlobBodyReader(input.body, {
    report: namespaceContext.report,
    backend: STORAGE_MEMORY_BACKEND,
    normalizeFailure: (cause) => blobFailure(namespaceContext, cause, input.key)
  })
  /** Only memory's native sink buffers complete content; server sinks keep their own backpressure. */
  const chunks: Uint8Array[] = []
  /** Byte accounting belongs to the completed native body rather than metadata or indexes. */
  let size = 0
  /** A primary read/abort/close failure must remain reachable if cleanup also fails. */
  let failed = false
  /** Cleanup failure becomes primary only when the body itself completed successfully. */
  let cleanupFailed = false
  /** Undefined rejection is still preserved when the shared cleanup rejects with it. */
  let cleanupFailure: unknown
  /** A fully collected body remains private until cleanup and the final CAS both succeed. */
  let body!: Uint8Array
  /** Context and host closure each release their original signal listener during settlement. */
  let stopContext: () => void = () => undefined
  /** Root closure wakes an unfinished read before the original mutation lease drains it. */
  let stopClosing: () => void = () => undefined
  /** The original dispose below consumes cancellation errors after the blocked read wakes. */
  const cancel = (target: IOperationContext['signal']) => {
    void reader.return!(readAbortReason(target)).catch(() => undefined)
  }
  try {
    stopContext = subscribeToAbort(signal, () => cancel(signal), namespaceContext.report)
    stopClosing = subscribeToAbort(
      namespaceContext.controller.closingSignal,
      () => cancel(namespaceContext.controller.closingSignal),
      namespaceContext.report
    )
    for (;;) {
      throwIfAborted(signal)
      namespaceContext.controller.assertLive()
      /** The original reader returns a detached byte chunk or its stable EOF result. */
      const next = await reader.next()
      throwIfAborted(signal)
      namespaceContext.controller.assertLive()
      if (next.done) break
      chunks.push(next.value)
      size += next.value.byteLength
    }
    body = new Uint8Array(size)
    /** A single final allocation owns the bytes installed by the synchronous native commit. */
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
  } catch (cause) {
    failed = true
    throwIfAborted(signal)
    namespaceContext.controller.assertLive()
    throw cause
  } finally {
    stopContext()
    stopClosing()
    try {
      await reader.dispose()
    } catch (cause) {
      if (failed) reportCleanupError(namespaceContext.report, cause)
      else {
        cleanupFailed = true
        cleanupFailure = cause
      }
    }
  }
  if (cleanupFailed) throw cleanupFailure
  return body
}

/** Opaque objects use the same original operation runner and physical capacity commit. */
export function createMemoryNamespaceObjects<T>(
  namespaceContext: IMemoryNamespaceContext<T>
): IMemoryNamespaceContext<T>['objects'] {
  return {
    put: (...args) => memoryBlobPut(namespaceContext, ...args),
    get: (...args) => memoryBlobGet(namespaceContext, ...args),
    head: (key, ctx) =>
      asyncEntry(namespaceContext, MemoryOperation.blobHead, key, ctx, (captured) => {
        namespaceContext.controller.assertLive()
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        const entry = namespaceContext.blobs.get(captured)
        if (entry !== undefined)
          namespaceContext.capacityIndex?.touch(identity(namespaceContext, 'blob', entry.encoded))
        return entry?.value.info
      }),
    remove: (key, ctx) =>
      mutationEntry(namespaceContext, MemoryOperation.blobRemove, key, ctx, (captured) => {
        assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
        return {
          keys: [],
          run: () => {
            const entry = deletePhysical(
              namespaceContext,
              'blob',
              namespaceContext.blobs.encodedOf(captured)
            )
            if (entry !== undefined) publish(namespaceContext, 'blob', 'remove')
            return entry !== undefined
          }
        }
      }),
    async list(options, ctx) {
      const request = snapshotStorageBlobList(options, ctx, STORAGE_MEMORY_BACKEND)
      return asyncEntry(
        namespaceContext,
        MemoryOperation.blobList,
        { ...request },
        request.ctx,
        (captured) => {
          namespaceContext.controller.assertLive()
          const input = snapshotStorageBlobList(captured, request.ctx, STORAGE_MEMORY_BACKEND)
          const result = namespaceContext.blobs.list(input.prefix, input.after, input.limit)
          for (const info of result.items)
            namespaceContext.capacityIndex?.touch(
              identity(namespaceContext, 'blob', namespaceContext.blobs.encodedOf(info.key))
            )
          return result
        }
      )
    },
    removeByPrefix: (prefix, ctx) =>
      mutationEntry(
        namespaceContext,
        MemoryOperation.blobRemoveByPrefix,
        prefix,
        ctx,
        (captured) => {
          assertStringStorageKey(captured, STORAGE_MEMORY_BACKEND)
          return {
            keys: [],
            run: () => {
              let count = 0
              for (const entry of namespaceContext.blobs.rows(captured))
                if (deletePhysical(namespaceContext, 'blob', entry.encoded) !== undefined) count++
              if (count > 0) publish(namespaceContext, 'blob', 'batch')
              return count
            }
          }
        }
      )
  }
}
/** Execute the native blob put with the original streaming and resource behavior. */
async function memoryBlobPut<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  ...args: Parameters<IMemoryNamespaceContext<T>['objects']['put']>
): ReturnType<IMemoryNamespaceContext<T>['objects']['put']> {
  const [key, body, options] = args
  namespaceContext.controller.assertLive()
  /** Caller-owned body/options are captured before the original operation pipeline can await. */
  const input = snapshotStorageBlobPut(key, body, options, STORAGE_MEMORY_BACKEND)
  /** Pipeline intervention receives owned writable fields without reviving caller getters. */
  const pipelineInput = { ...input, options: { ...input.options } }
  /** Pipeline-provided fields are captured once before upload starts or native admission waits. */
  let prepared: ReturnType<typeof snapshotStorageBlobPut>
  /** Complete content remains private through lock waits and the final generation recheck. */
  let bytes: Uint8Array
  /** Opaque generation metadata is prepared before capacity can remove any original entry. */
  let info: IBlobInfo
  /** Capacity uses the same shared physical tuple as this namespace's native object map. */
  let physicalKey: IStorageKey
  /** The original lock owner's final synchronous preflight selects the exact capacity victims. */
  let plan: ReturnType<typeof planCapacity>
  /** Selected preparation remains accepted original-controller work even when rejected. */
  const preparing =
    namespaceContext.core.journal === undefined
      ? undefined
      : namespaceContext.controller.beginMutation()
  const pending = runWithConcurrency<IBlobInfo>(
    {
      store: namespaceContext.base,
      options: input.options.ctx ?? {},
      prepare:
        namespaceContext.core.journal === undefined
          ? undefined
          : async () => {
              await namespaceContext.core.journal!.prepare()
              /** Blob has no shared journal target; reject before taking upload reader ownership. */
              if (namespaceContext.core.journal!.active())
                throw new StorageContractError(StorageContractErrorCode.unsupported)
            },
      execute: (context, invoke) =>
        namespaceContext.core.execution.run(
          { operation: MemoryOperation.blobPut, input: pipelineInput, ctx: context },
          async (captured) => {
            namespaceContext.controller.assertLive()
            /** Accepted uploads drain through the existing controller's mutation lease. */
            const release = namespaceContext.controller.beginMutation()
            try {
              prepared = snapshotStorageBlobPut(
                captured.key,
                captured.body,
                captured.options,
                STORAGE_MEMORY_BACKEND
              )
              assertBlobCondition(namespaceContext, prepared)
              bytes = await loadBlobBody(namespaceContext, prepared, context.signal)
              throwIfAborted(context.signal)
              namespaceContext.controller.assertLive()
              physicalKey = prefixStorageOrgKey(namespaceContext.orgId, prepared.key)
              info = {
                key: prepared.key,
                size: bytes.byteLength,
                etag: createStorageToken(),
                contentType: prepared.options.contentType,
                metadata: prepared.options.metadata ?? {},
                updatedAt: Date.now()
              }
              return await invoke()
            } catch (cause) {
              throw blobFailure(namespaceContext, cause, input.key)
            } finally {
              release()
            }
          }
        ),
      lock: () => []
    },
    {
      attempt: (attempt) =>
        namespaceContext.locks.attemptWrite(
          attempt,
          holding(namespaceContext),
          () => {
            assertBlobCondition(namespaceContext, prepared)
            return commitCapacity(namespaceContext, plan, () => {
              /** All failure-prone input and body work precedes this final synchronous turn. */
              const entry = namespaceContext.blobs.put(bytes, info)
              namespaceContext.capacityIndex?.put({
                ...capacityFact(namespaceContext, 'blob', entry.key),
                bytes: bytes.byteLength
              })
              publish(namespaceContext, 'blob', 'put')
              return info
            })
          },
          namespaceContext.core.stageBindings.concurrencyStages(namespaceContext.store),
          namespaceContext.controller.closingSignal,
          undefined,
          undefined,
          () => {
            assertBlobCondition(namespaceContext, prepared)
            plan =
              namespaceContext.capacity === undefined
                ? undefined
                : planCapacity(namespaceContext, [
                    capacityFact(namespaceContext, 'blob', physicalKey, bytes.byteLength)
                  ])
            return plan?.identities ?? []
          }
        )
    }
  )
  return preparing === undefined ? pending : pending.finally(preparing)
}
/** Execute the native blob get with the original streaming and resource behavior. */
async function memoryBlobGet<T>(
  namespaceContext: IMemoryNamespaceContext<T>,
  ...args: Parameters<IMemoryNamespaceContext<T>['objects']['get']>
): ReturnType<IMemoryNamespaceContext<T>['objects']['get']> {
  const [key, options] = args
  namespaceContext.controller.assertLive()
  /** Range and caller context are admitted before any native object snapshot is opened. */
  const input = snapshotStorageBlobGet(key, options, STORAGE_MEMORY_BACKEND)
  /** The original pipeline may replace or mutate this owned request before native admission. */
  const pipelineInput = { ...input, options: { ...input.options } }
  /** This original timeout/context lifetime transfers to the returned shared object resource. */
  const merged = mergeSignals(input.options.ctx, namespaceContext.report)
  /** A pipeline failure after opening content still disposes that exact original resource. */
  let resource: IBlobObject | undefined
  try {
    throwIfAborted(merged.signal)
    return await namespaceContext.core.execution.run(
      { operation: MemoryOperation.blobGet, input: pipelineInput, ctx: merged.context },
      async (captured) => {
        namespaceContext.controller.assertLive()
        throwIfAborted(merged.signal)
        /** Re-capture pipeline changes even when it retained the same request object identity. */
        const request = snapshotStorageBlobGet(
          captured.key,
          captured.options,
          STORAGE_MEMORY_BACKEND
        )
        /** Native metadata and body come from the same immutable committed generation. */
        const entry = namespaceContext.blobs.get(request.key)
        if (entry === undefined) {
          merged.dispose()
          return undefined
        }
        namespaceContext.capacityIndex?.touch(identity(namespaceContext, 'blob', entry.encoded))
        /** Inclusive public range bounds become a detached native slice. */
        const range = request.options.range
        /** A clipped endpoint also makes reads beyond EOF return an empty body. */
        const end =
          range?.end === undefined
            ? entry.value.body.byteLength
            : Math.min(entry.value.body.byteLength, range.end + 1)
        /** Future overwrites, removal and capacity eviction cannot change returned content. */
        const snapshot = entry.value.body.slice(range?.start ?? 0, end)
        /** Native pull opens no second lifecycle or storage subscription. */
        const source = new ReadableStream<Uint8Array>(
          {
            pull(native) {
              namespaceContext.controller.assertLive()
              throwIfAborted(merged.signal)
              native.enqueue(snapshot)
              native.close()
            }
          },
          { highWaterMark: 0 }
        )
        resource = createStorageBlobObject(entry.value.info, source, {
          close: () => merged.dispose(),
          report: namespaceContext.report,
          backend: STORAGE_MEMORY_BACKEND,
          normalizeFailure: (cause) => blobFailure(namespaceContext, cause, request.key)
        })
        return resource
      }
    )
  } catch (cause) {
    try {
      await resource?.dispose()
    } catch (cleanup) {
      reportCleanupError(namespaceContext.report, cleanup)
    }
    merged.dispose()
    throw blobFailure(namespaceContext, cause, input.key)
  }
}
