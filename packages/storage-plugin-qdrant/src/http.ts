import type { IOperationContext } from '@migaia/storage-contract'
import { throwIfAborted } from '@migaia/storage-host/authoring/backend'
import { QdrantRoute, QdrantText } from './constants.js'
import { QdrantErrorCode } from './error-code.js'
import { QdrantErrorText } from './error-text.js'
import { capture, invalidArgument, normalizeQdrantError, qdrantError } from './errors.js'
import { nativeResult } from './protocol.js'
import { nativeHttp } from './native.js'
import type { IQdrantHttp, IQdrantOperationName } from './types.js'
/** Runtime fetch is the only native transport loaded by this explicit HTTP entry. */
export function fetchHttp(url: string, apiKey?: string): IQdrantHttp {
  const base = capture(() => new URL(url))
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    (apiKey !== undefined && (typeof apiKey !== 'string' || /[\r\n]/.test(apiKey)))
  )
    throw invalidArgument()
  /** One request consumes its complete response once and never follows mutation redirects. */
  const request = async (
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
          ...(apiKey === undefined ? {} : { [QdrantText.apiKey]: apiKey })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  const invoke = async <K extends IQdrantOperationName>(
    operation: K,
    args: readonly unknown[],
    ctx: IOperationContext | undefined
  ): Promise<Awaited<ReturnType<IQdrantHttp[K]>>> => {
    const route = QdrantRoute[operation],
      target = new URL(base),
      collection = route.collection ? args[0] : undefined
    if (route.collection && typeof collection !== 'string') throw invalidArgument()
    target.pathname =
      base.pathname.replace(/\/$/, '') +
      '/' +
      route.path.replace(':collection', encodeURIComponent(collection as string))
    const parameters = route.parameters ? (args[route.collection ? 1 : 0] ?? {}) : undefined,
      fields =
        parameters === undefined
          ? undefined
          : capture(() => Object.fromEntries(Object.entries(parameters)))
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
    const response = await request(target, route.method, body, ctx)
    if (
      !response ||
      typeof response !== 'object' ||
      (!Object.hasOwn(response, 'result') && operation !== 'createSnapshot')
    )
      throw qdrantError(QdrantErrorCode.responseInvalid)
    return nativeResult(operation, Reflect.get(response, 'result'))
  }
  return nativeHttp(invoke, async (ctx) => {
    const response = await request(new URL(base), 'GET', undefined, ctx)
    if (
      !response ||
      typeof response !== 'object' ||
      !('version' in response) ||
      typeof response.version !== 'string'
    )
      throw qdrantError(QdrantErrorCode.responseInvalid)
    return response.version
  })
}
