import { bytesToBase64 } from '@migaia/utils/bytes'
import { throwIfAborted } from '@migaia/storage-host/authoring/backend'
import { capture, invalidArgument, sparqlError } from './errors.js'
import { SparqlErrorCode } from './error-code.js'
import { SparqlErrorText } from './error-text.js'
import { SparqlText } from './text.js'
import { registerHttpRoutes } from './http-route.js'
import { snapshotGraphTarget, snapshotGraphDocument, snapshotGraphFormat } from './graph-store.js'
import type { ISparqlEndpoint, ISparqlAbortSignal, IRdfGraphTarget } from './endpoint.js'
/** Credentials enter request headers only and are never copied into native failure data. */
export type ISparqlHttpOptions = {
  readonly queryUrl: string
  readonly updateUrl: string
  readonly graphStoreUrl?: string
  readonly auth?:
    | {
        readonly basic: { readonly user: string; readonly password: string }
        readonly bearer?: never
      }
    | { readonly bearer: string; readonly basic?: never }
}
/** Native protocol failures preserve the actual response status and complete body without headers. */
function responseError(status: number, body: string, mutation: boolean): Error {
  const original = new Error(SparqlErrorText.requestFailed)
  Object.defineProperties(original, {
    status: { value: status, enumerable: true },
    body: { value: body, enumerable: true }
  })
  return sparqlError(
    status >= 500 || status === 0
      ? mutation
        ? SparqlErrorCode.commitUnknown
        : SparqlErrorCode.unavailable
      : SparqlErrorCode.requestFailed,
    original
  )
}
/** Capture absolute HTTP URLs without accepting embedded credential material. */
function endpointUrl(value: string): URL {
  const url = capture(() => new URL(value))
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
    throw invalidArgument()
  return url
}
/** Caller-created HTTP endpoint uses the native fetch transport and never owns a connection. */
export function httpEndpoint(options: ISparqlHttpOptions): ISparqlEndpoint {
  const captured = capture(() => ({
    query: options.queryUrl,
    update: options.updateUrl,
    graph: options.graphStoreUrl,
    auth: options.auth
  }))
  const query = endpointUrl(captured.query),
    update = endpointUrl(captured.update),
    graph = captured.graph === undefined ? undefined : endpointUrl(captured.graph)
  const auth = capture(() => {
    if (captured.auth === undefined) return undefined
    const basic = captured.auth.basic,
      bearer = captured.auth.bearer
    if ((basic === undefined) === (bearer === undefined)) throw invalidArgument()
    if (bearer !== undefined) {
      if (typeof bearer !== 'string' || /[\r\n]/.test(bearer)) throw invalidArgument()
      return 'Bearer ' + bearer
    }
    const user = basic?.user,
      password = basic?.password
    if (typeof user !== 'string' || typeof password !== 'string') throw invalidArgument()
    return 'Basic ' + bytesToBase64(new TextEncoder().encode(user + ':' + password))
  })
  /** Each native request is sent once; transport uncertainty is never automatically replayed. */
  const request = async (
    url: URL,
    method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
    accept?: string,
    body?: string,
    contentType?: string,
    signal?: ISparqlAbortSignal
  ): Promise<Response> => {
    throwIfAborted(signal)
    const mutation =
      method !== SparqlText.get && method !== SparqlText.head && contentType !== SparqlText.query
    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: {
          ...(accept === undefined ? {} : { Accept: accept }),
          ...(contentType === undefined ? {} : { 'Content-Type': contentType }),
          ...(auth === undefined ? {} : { Authorization: auth })
        },
        ...(body === undefined ? {} : { body }),
        ...(mutation ? { redirect: 'manual' as const } : {}),
        signal: signal as AbortSignal | undefined
      })
    } catch (cause) {
      throw sparqlError(
        mutation ? SparqlErrorCode.commitUnknown : SparqlErrorCode.unavailable,
        cause
      )
    }
    return response
  }
  /** Consume complete response text so native stream failures retain their original cause. */
  const text = async (response: Response, mutation: boolean): Promise<string> => {
    let body: string
    try {
      body = await response.text()
    } catch (cause) {
      throw sparqlError(
        mutation ? SparqlErrorCode.commitUnknown : SparqlErrorCode.unavailable,
        cause
      )
    }
    if (!response.ok) throw responseError(response.status, body, mutation)
    return body
  }
  /** The standard URL implementation encodes graph IRIs exactly once and preserves other routes. */
  const targetUrl = (value: IRdfGraphTarget): URL => {
    const target = snapshotGraphTarget(value),
      url = new URL(graph!)
    url.searchParams.delete('graph')
    url.searchParams.delete('default')
    if (target.default) url.searchParams.set('default', '')
    else url.searchParams.set('graph', target.graph.value)
    return url
  }
  const endpoint: ISparqlEndpoint = {
    query: async (body, accept, signal) =>
      text(await request(query, SparqlText.post, accept, body, SparqlText.query, signal), false),
    update: async (body, signal) => {
      await text(
        await request(update, SparqlText.post, undefined, body, SparqlText.update, signal),
        true
      )
    },
    ...(graph === undefined
      ? {}
      : {
          graphStore: {
            get: async (target, format, signal) =>
              text(
                await request(
                  targetUrl(target),
                  SparqlText.get,
                  snapshotGraphFormat(format),
                  undefined,
                  undefined,
                  signal
                ),
                false
              ),
            put: async (target, document, signal) => {
              const doc = snapshotGraphDocument(document)
              await text(
                await request(
                  targetUrl(target),
                  SparqlText.put,
                  undefined,
                  doc.text,
                  doc.format,
                  signal
                ),
                true
              )
            },
            post: async (target, document, signal) => {
              const doc = snapshotGraphDocument(document)
              await text(
                await request(
                  targetUrl(target),
                  SparqlText.post,
                  undefined,
                  doc.text,
                  doc.format,
                  signal
                ),
                true
              )
            },
            remove: async (target, signal) => {
              await text(
                await request(
                  targetUrl(target),
                  SparqlText.remove,
                  undefined,
                  undefined,
                  undefined,
                  signal
                ),
                true
              )
            },
            has: async (target, signal) => {
              const response = await request(
                targetUrl(target),
                SparqlText.head,
                undefined,
                undefined,
                undefined,
                signal
              )
              if (response.status === 404) return false
              await text(response, false)
              return true
            }
          }
        })
  }
  registerHttpRoutes(endpoint, {
    query: query.pathname,
    update: update.pathname,
    graph: graph?.pathname
  })
  return Object.freeze(endpoint)
}
