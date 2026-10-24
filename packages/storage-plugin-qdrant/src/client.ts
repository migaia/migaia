import type { QdrantClient } from '@qdrant/js-client-rest'
import type { IOperationContext } from '@migaia/storage-contract'
import { throwIfAborted } from '@migaia/storage-host/authoring/backend'
import { nativeHttp } from './native.js'
import { nativeResult } from './protocol.js'
import { qdrantWireValue } from './wire.js'
import { capture, normalizeQdrantError } from './errors.js'
import { QdrantRoute } from './constants.js'
import { QdrantErrorCode } from './error-code.js'
import { qdrantError } from './errors.js'
import type { IQdrantHttp, IQdrantOperationName } from './types.js'
/** Borrow one real SDK client; its timeout/configuration and lifetime remain caller-owned. */
export function qdrantClientHttp(client: QdrantClient): IQdrantHttp {
  const points = capture(() => client.api('points')),
    collections = capture(() => client.api('collections')),
    snapshots = capture(() => client.api('snapshots'))
  const writes = capture(() => ({
    upsert: points.upsertPoints,
    delete: points.deletePoints,
    updateVectors: points.updateVectors,
    createCollection: collections.createCollection,
    deleteCollection: collections.deleteCollection,
    updateCollectionAliases: collections.updateAliases,
    createSnapshot: snapshots.createSnapshot,
    createPayloadIndex: collections.createFieldIndex,
    setPayload: points.setPayload,
    deletePayload: points.deletePayload
  }))
  const reads = capture(() => ({
    scroll: client.scroll,
    retrieve: client.retrieve,
    getCollection: client.getCollection,
    getCollections: client.getCollections,
    query: client.query,
    recommend: client.recommend,
    searchPointGroups: client.searchPointGroups,
    count: client.count,
    versionInfo: client.versionInfo
  }))
  /**
   * The original generated method accepts per-request redirect control without reconfiguring the
   * SDK.
   */
  const invoke = async <K extends IQdrantOperationName>(
    operation: K,
    args: readonly unknown[],
    ctx: IOperationContext | undefined
  ): Promise<Awaited<ReturnType<IQdrantHttp[K]>>> => {
    throwIfAborted(ctx?.signal)
    try {
      if (Object.hasOwn(writes, operation)) {
        const route = QdrantRoute[operation],
          parameters = qdrantWireValue(args[route.collection ? 1 : 0] ?? {}),
          body = {
            ...(route.collection ? { collection_name: args[0] } : {}),
            ...(parameters as object)
          },
          method = Reflect.get(writes, operation) as (
            ...args: unknown[]
          ) => Promise<{ readonly data: { readonly result?: unknown } }>
        const response = await method(body, { redirect: 'manual' })
        return nativeResult(operation, response.data.result)
      }
      const method = Reflect.get(reads, operation) as (...args: unknown[]) => Promise<unknown>
      return nativeResult(
        operation,
        await Reflect.apply(
          method,
          client,
          args.map((arg) => qdrantWireValue(arg))
        )
      )
    } catch (cause) {
      throw normalizeQdrantError(cause)
    }
  }
  return nativeHttp(invoke, async (ctx) => {
    throwIfAborted(ctx?.signal)
    try {
      const info = await Reflect.apply(reads.versionInfo, client, [])
      if (!info || typeof info.version !== 'string')
        throw qdrantError(QdrantErrorCode.responseInvalid)
      return info.version
    } catch (cause) {
      throw normalizeQdrantError(cause)
    }
  })
}
