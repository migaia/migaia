import type { QdrantClient } from '@qdrant/js-client-rest'
import type { IOperationContext } from '@migaia/storage-contract'
import { throwIfAborted } from '@migaia/storage-host/authoring/backend'
import { nativeHttp } from './native.js'
import { nativeResult } from './protocol.js'
import { qdrantWireValue } from './wire.js'
import { normalizeQdrantError } from './errors.js'
import { QdrantRoute } from './constants.js'
import { QdrantErrorCode } from './error-code.js'
import { qdrantError } from './errors.js'
import type { IQdrantHttp, IQdrantOperationName } from './types.js'
/** Borrow one real SDK client; its timeout/configuration and lifetime remain caller-owned. */
export function qdrantClientHttp(client: QdrantClient): IQdrantHttp {
  /** Borrowed client ports belong to one named adapter, never a second client or cleanup owner. */
  const adapter = new QdrantSdkTransport(client)
  return nativeHttp(adapter.invoke, adapter.version)
}

/** Resolve the official generated APIs once while preserving direct method receivers. */
function readQdrantSdkPorts(client: QdrantClient) {
  return {
    points: client.api('points'),
    collections: client.api('collections'),
    snapshots: client.api('snapshots')
  }
}

/** The SDK adapter borrows the real client and applies command-local wire/redirect rules. */
class QdrantSdkTransport {
  /** Native client configuration and destruction remain caller-owned. */
  readonly #client: QdrantClient
  /** Official generated mutation APIs preserve SDK request semantics. */
  readonly #ports: ReturnType<typeof readQdrantSdkPorts>
  /** Tiny mutation adapters retain each generated object's required receiver. */
  readonly #writes = {
    upsert: (body: never, options: never) => this.#ports.points.upsertPoints(body, options),
    delete: (body: never, options: never) => this.#ports.points.deletePoints(body, options),
    updateVectors: (body: never, options: never) => this.#ports.points.updateVectors(body, options),
    createCollection: (body: never, options: never) =>
      this.#ports.collections.createCollection(body, options),
    deleteCollection: (body: never, options: never) =>
      this.#ports.collections.deleteCollection(body, options),
    updateCollectionAliases: (body: never, options: never) =>
      this.#ports.collections.updateAliases(body, options),
    createSnapshot: (body: never, options: never) =>
      this.#ports.snapshots.createSnapshot(body, options),
    createPayloadIndex: (body: never, options: never) =>
      this.#ports.collections.createFieldIndex(body, options),
    setPayload: (body: never, options: never) => this.#ports.points.setPayload(body, options),
    deletePayload: (body: never, options: never) => this.#ports.points.deletePayload(body, options)
  }
  /** Select existing generated API objects without issuing native requests. */
  constructor(client: QdrantClient) {
    this.#client = client
    this.#ports = readQdrantSdkPorts(client)
  }
  /**
   * Native mutations use one generated call with manual redirect handling; reads retain client
   * methods.
   */
  invoke = async <K extends IQdrantOperationName>(
    operation: K,
    args: readonly unknown[],
    ctx: IOperationContext | undefined
  ): Promise<Awaited<ReturnType<IQdrantHttp[K]>>> => {
    throwIfAborted(ctx?.signal)
    try {
      if (Object.hasOwn(this.#writes, operation)) {
        /** Route metadata determines body shape before the one native mutation call. */
        const route = QdrantRoute[operation]
        /** Float wire projection preserves integer multivectors on the official SDK path. */
        const parameters = qdrantWireValue(args[route.collection ? 1 : 0] ?? {})
        /** The original generated API expects the collection in its request object. */
        const body = {
          ...(route.collection ? { collection_name: args[0] } : {}),
          ...(parameters as object)
        }
        /** The membership check above admits only an existing finite generated mutation port. */
        const ports = this.#writes as unknown as Record<
          IQdrantOperationName,
          (
            body: unknown,
            options: { redirect: 'manual' }
          ) => Promise<{ readonly data: { readonly result?: unknown } }>
        >
        /** Direct dispatch keeps the adapter/native API receiver and does not retry. */
        const response = await ports[operation](body, { redirect: 'manual' })
        return nativeResult(operation, response.data.result)
      }
      /** Read dispatch uses the actual borrowed client as receiver. */
      const client = this.#client as unknown as Record<
        IQdrantOperationName,
        (...args: unknown[]) => Promise<unknown>
      >
      return nativeResult(
        operation,
        await client[operation](...args.map((arg) => qdrantWireValue(arg)))
      )
    } catch (cause) {
      throw normalizeQdrantError(cause)
    }
  }
  /** Version inspection stays on the actual borrowed SDK client. */
  version = async (ctx: IOperationContext | undefined) => {
    throwIfAborted(ctx?.signal)
    try {
      /** Only the server-provided version can satisfy the supported protocol check. */
      const info = await this.#client.versionInfo()
      if (!info || typeof info.version !== 'string')
        throw qdrantError(QdrantErrorCode.responseInvalid)
      return info.version
    } catch (cause) {
      throw normalizeQdrantError(cause)
    }
  }
}
