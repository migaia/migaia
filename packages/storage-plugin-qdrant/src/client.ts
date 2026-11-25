import type { QdrantClient } from '@qdrant/js-client-rest'
import type { IOperationContext } from '@migaia/storage-contract'
import { throwIfAborted } from '@migaia/storage-host/sdk'
import { nativeHttp } from './native.ts'
import { nativeResult } from './protocol.ts'
import { qdrantWireValue } from './wire.ts'
import { invalidArgument, normalizeQdrantError, qdrantError } from './errors.ts'
import { QdrantRoute } from './constants.ts'
import { QdrantErrorCode } from '@migaia/storage-contract/error-code'
import type { IQdrantHttp, IQdrantOperationName } from './types.ts'

/** Projects every native call argument through float wire encoding in one linear pass. */
function wireArgs(args: readonly unknown[]): unknown[] {
  /** Wire-encoded positional arguments. */
  const encoded: unknown[] = []
  for (const arg of args) encoded.push(qdrantWireValue(arg))
  return encoded
}
/** Borrow one real SDK client; its timeout/configuration and lifetime remain caller-owned. */
export function qdrantClientHttp(client: QdrantClient): IQdrantHttp {
  /** Borrowed client ports belong to one named adapter, never a second client or cleanup owner. */
  const adapter = new QdrantSdkTransport(client)
  return nativeHttp(adapter.invoke, adapter.version)
}

/** Resolve the official generated API once while preserving direct method receivers. */
function readQdrantSdkPorts(client: QdrantClient) {
  /** Official generated OpenAPI client exposes all route groups on one receiver. */
  const api = client.api()
  return {
    points: api,
    collections: api,
    snapshots: api
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
    /** Route metadata determines collection argument and request body shape. */
    const route = QdrantRoute[operation]
    if (route.collection && typeof args[0] !== 'string') throw invalidArgument()
    try {
      if (Object.hasOwn(this.#writes, operation)) {
        /** Float wire projection preserves integer multivectors on the official SDK path. */
        const parameters = qdrantWireValue(args[route.collection ? 1 : 0] ?? {})
        /** User parameters spread first so they cannot override the route's target collection. */
        const body = {
          ...(parameters as object),
          ...(route.collection ? { collection_name: args[0] } : {})
        }
        /** The membership check above admits only an existing finite generated mutation port. */
        const ports = this.#writes as unknown as Record<
          IQdrantOperationName,
          (
            body: unknown,
            options: { redirect: 'manual' }
          ) => Promise<{ readonly data?: { readonly result?: unknown } }>
        >
        /** Direct dispatch keeps the adapter/native API receiver and does not retry. */
        const response = await ports[operation](body, { redirect: 'manual' })
        if (
          !response ||
          typeof response !== 'object' ||
          !response.data ||
          typeof response.data !== 'object'
        )
          throw qdrantError(QdrantErrorCode.responseInvalid)
        return nativeResult(operation, response.data.result)
      }
      /** Read dispatch uses the actual borrowed client as receiver. */
      const client = this.#client as unknown as Record<
        IQdrantOperationName,
        (...args: unknown[]) => Promise<unknown>
      >
      return nativeResult(operation, await client[operation](...wireArgs(args)))
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
