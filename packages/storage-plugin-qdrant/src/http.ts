import type { IOperationContext } from '@migaia/storage-contract'
import { throwIfAborted } from '@migaia/storage-host/sdk'
import { QdrantRoute, QdrantText } from './constants.js'
import { QdrantErrorCode } from '@migaia/storage-contract/error-code'
import { QdrantErrorText } from './error-text.js'
import { invalidArgument, normalizeQdrantError, qdrantError } from './errors.js'
import { nativeResult } from './protocol.js'
import { nativeHttp } from './native.js'
import { qdrantWireValue } from './wire.js'
import type { IQdrantHttp, IQdrantOperationName } from './types.js'
/** Runtime fetch is the only native transport loaded by this explicit HTTP entry. */
export function fetchHttp(url: string, apiKey?: string): IQdrantHttp {
  const base = parseQdrantUrl(url)
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    (apiKey !== undefined && (typeof apiKey !== 'string' || /[\r\n]/.test(apiKey)))
  )
    throw invalidArgument()
  /** One named transport owns URL selection; the SDK/public client lifetime stays outside it. */
  const transport = new QdrantFetchTransport(base, apiKey)
  return nativeHttp(transport.invoke, transport.version)
}

/** Native fetch routing owns one validated endpoint and its original per-request jobs. */
class QdrantFetchTransport {
  /** URL copies remain request-local so routing never mutates the configured endpoint. */
  readonly #base: URL
  /** Header data is private to the transport and never enters hooks. */
  readonly #apiKey: string | undefined
  /** Bind validated endpoint data without issuing a request. */
  constructor(base: URL, apiKey: string | undefined) {
    this.#base = base
    this.#apiKey = apiKey
  }
  /** Consume one native response without replaying a mutation or following a redirect. */
  #request = async (
    target: URL,
    method: string,
    body: unknown,
    ctx: IOperationContext | undefined
  ): Promise<unknown> => {
    throwIfAborted(ctx?.signal)
    let response: Response, text: string
    try {
      response = await fetch(target, {
        method,
        headers: {
          Accept: QdrantText.json,
          ...(body === undefined ? {} : { 'Content-Type': QdrantText.json }),
          ...(this.#apiKey === undefined ? {} : { [QdrantText.apiKey]: this.#apiKey })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(qdrantWireValue(body)) }),
        signal: ctx?.signal as AbortSignal | undefined,
        redirect: 'manual'
      })
      text = await response.text()
    } catch (cause) {
      throw normalizeQdrantError(cause)
    }
    if (!response.ok) {
      const cause = new Error(QdrantErrorText.requestFailed)
      Object.defineProperties(cause, {
        status: { value: response.status, enumerable: true },
        response: { value: text, enumerable: true }
      })
      throw normalizeQdrantError(cause)
    }
    try {
      return JSON.parse(text)
    } catch (cause) {
      throw qdrantError(QdrantErrorCode.responseInvalid, cause)
    }
  }
  /** Map canonical route arguments into this transport's one native request. */
  invoke = async <K extends IQdrantOperationName>(
    operation: K,
    args: readonly unknown[],
    ctx: IOperationContext | undefined
  ): Promise<Awaited<ReturnType<IQdrantHttp[K]>>> => {
    const route = QdrantRoute[operation],
      target = new URL(this.#base),
      collection = route.collection ? args[0] : undefined
    if (route.collection && typeof collection !== 'string') throw invalidArgument()
    target.pathname =
      this.#base.pathname.replace(/\/$/, '') +
      '/' +
      route.path.replace(':collection', encodeURIComponent(collection as string))
    const parameters = route.parameters ? (args[route.collection ? 1 : 0] ?? {}) : undefined,
      fields = parameters === undefined ? undefined : Object.fromEntries(Object.entries(parameters))
    for (const field of route.query) {
      const value = fields?.[field]
      if (value !== undefined && value !== null) target.searchParams.set(field, String(value))
      if (fields) delete fields[field]
    }
    const body =
      route.method === 'GET' ||
      route.method === 'DELETE' ||
      (fields !== undefined && Object.keys(fields).length === 0)
        ? undefined
        : fields
    const response = await this.#request(target, route.method, body, ctx)
    if (
      !response ||
      typeof response !== 'object' ||
      (!Object.hasOwn(response, 'result') && operation !== 'createSnapshot')
    )
      throw qdrantError(QdrantErrorCode.responseInvalid)
    return nativeResult(operation, Reflect.get(response, 'result'))
  }
  /** Read the server version through the original read-only endpoint. */
  version = async (ctx: IOperationContext | undefined) => {
    const response = await this.#request(new URL(this.#base), 'GET', undefined, ctx)
    if (
      !response ||
      typeof response !== 'object' ||
      !('version' in response) ||
      typeof response.version !== 'string'
    )
      throw qdrantError(QdrantErrorCode.responseInvalid)
    return response.version
  }
}

/**
 * URL syntax is a real public input contract; retain the native parse failure on the argument
 * error.
 */
function parseQdrantUrl(url: string): URL {
  try {
    return new URL(url)
  } catch (cause) {
    throw invalidArgument(cause)
  }
}
