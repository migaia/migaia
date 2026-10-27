import { bytesToBase64 } from '@migaia/utils/bytes'
import { throwIfAborted } from '@migaia/storage-host/sdk'
import { invalidArgument, sparqlError } from './errors.js'
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
  /**
   * Native response metadata stays on the original error so callers can inspect its status and
   * body.
   */
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
  /** URL construction can reject supported malformed input before any native request. */
  let url: URL
  try {
    url = new URL(value)
  } catch (cause) {
    throw invalidArgument(cause)
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
    throw invalidArgument()
  return url
}
/** Caller-created HTTP endpoint uses the native fetch transport and never owns a connection. */
/** Physical endpoint state is passed explicitly to named native and organization jobs. */
type ISparqlHttpContext = {
  /** Original options belongs to this physical namespace. */

  query: URL

  update: URL

  graph: URL | undefined

  auth: string | undefined

  endpoint: ISparqlEndpoint
}
export function httpEndpoint(options: ISparqlHttpOptions): ISparqlEndpoint {
  /** Initialize physical owners in original order before a store escapes. */
  const httpContext = {} as ISparqlHttpContext
  httpContext.query = endpointUrl(options.queryUrl)
  httpContext.update = endpointUrl(options.updateUrl)
  httpContext.graph =
    options.graphStoreUrl === undefined ? undefined : endpointUrl(options.graphStoreUrl)
  httpContext.auth = readHttpAuth(options.auth)
  httpContext.endpoint = createHttpSparqlEndpoint(httpContext)

  registerHttpRoutes(httpContext.endpoint, {
    query: httpContext.query.pathname,
    update: httpContext.update.pathname,
    graph: httpContext.graph?.pathname
  })
  return httpContext.endpoint
}

/** Each native request is sent once; transport uncertainty is never automatically replayed. */
async function request(
  httpContext: ISparqlHttpContext,
  url: URL,
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
  accept?: string,
  body?: string,
  contentType?: string,
  signal?: ISparqlAbortSignal
): Promise<Response> {
  throwIfAborted(signal)
  /** A sent mutation has uncertainty semantics distinct from a read request or HEAD. */
  const mutation =
    method !== SparqlText.get && method !== SparqlText.head && contentType !== SparqlText.query
  /** The original fetch response is consumed once; transport failures retain their native cause. */
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(accept === undefined ? {} : { Accept: accept }),
        ...(contentType === undefined ? {} : { 'Content-Type': contentType }),
        ...(httpContext.auth === undefined ? {} : { Authorization: httpContext.auth })
      },
      ...(body === undefined ? {} : { body }),
      ...(mutation ? { redirect: 'manual' as const } : {}),
      signal: signal as AbortSignal | undefined
    })
  } catch (cause) {
    throw sparqlError(mutation ? SparqlErrorCode.commitUnknown : SparqlErrorCode.unavailable, cause)
  }
  return response
}

/** Consume complete response text so native stream failures retain their original cause. */
async function text(
  httpContext: ISparqlHttpContext,
  response: Response,
  mutation: boolean
): Promise<string> {
  /** Complete native text is consumed before status or result validation can finish. */
  let body: string
  try {
    body = await response.text()
  } catch (cause) {
    throw sparqlError(mutation ? SparqlErrorCode.commitUnknown : SparqlErrorCode.unavailable, cause)
  }
  if (!response.ok) throw responseError(response.status, body, mutation)
  return body
}

/** The standard URL implementation encodes graph IRIs exactly once and preserves other routes. */
function targetUrl(httpContext: ISparqlHttpContext, value: IRdfGraphTarget): URL {
  /**
   * Graph query parameters are applied to a fresh URL so requests cannot mutate the configured
   * route.
   */
  const target = snapshotGraphTarget(value),
    url = new URL(httpContext.graph!)
  url.searchParams.delete('graph')
  url.searchParams.delete('default')
  if (target.default) url.searchParams.set('default', '')
  else url.searchParams.set('graph', target.graph.value)
  return url
}

function createHttpSparqlEndpoint(httpContext: ISparqlHttpContext): ISparqlHttpContext['endpoint'] {
  return {
    query: async (body, accept, signal) =>
      text(
        httpContext,
        await request(
          httpContext,
          httpContext.query,
          SparqlText.post,
          accept,
          body,
          SparqlText.query,
          signal
        ),
        false
      ),
    update: async (body, signal) => {
      await text(
        httpContext,
        await request(
          httpContext,
          httpContext.update,
          SparqlText.post,
          undefined,
          body,
          SparqlText.update,
          signal
        ),
        true
      )
    },
    ...(httpContext.graph === undefined
      ? {}
      : {
          graphStore: {
            get: async (target, format, signal) =>
              text(
                httpContext,
                await request(
                  httpContext,
                  targetUrl(httpContext, target),
                  SparqlText.get,
                  snapshotGraphFormat(format),
                  undefined,
                  undefined,
                  signal
                ),
                false
              ),
            put: async (target, document, signal) => {
              /** Document scalars must remain stable across the native request await. */
              const doc = snapshotGraphDocument(document)
              await text(
                httpContext,
                await request(
                  httpContext,
                  targetUrl(httpContext, target),
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
              /** Document scalars must remain stable across the native request await. */
              const doc = snapshotGraphDocument(document)
              await text(
                httpContext,
                await request(
                  httpContext,
                  targetUrl(httpContext, target),
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
                httpContext,
                await request(
                  httpContext,
                  targetUrl(httpContext, target),
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
              /**
               * The original fetch response is consumed once; transport failures retain their
               * native cause.
               */
              const response = await request(
                httpContext,
                targetUrl(httpContext, target),
                SparqlText.head,
                undefined,
                undefined,
                undefined,
                signal
              )
              if (response.status === 404) return false
              await text(httpContext, response, false)
              return true
            }
          }
        })
  }
}

/** Captures credential header scalars before any native request can await. */
function readHttpAuth(auth: ISparqlHttpOptions['auth']): string | undefined {
  if (auth === undefined) return undefined
  /** Exactly one supported authorization form is admitted before any request is sent. */
  const basic = auth.basic,
    bearer = auth.bearer
  if ((basic === undefined) === (bearer === undefined)) throw invalidArgument()
  if (bearer !== undefined) {
    if (typeof bearer !== 'string' || /[\r\n]/.test(bearer)) throw invalidArgument()
    return 'Bearer ' + bearer
  }
  /** Basic credentials are encoded into the request header only and never failure metadata. */
  const user = basic?.user,
    password = basic?.password
  if (typeof user !== 'string' || typeof password !== 'string') throw invalidArgument()
  return 'Basic ' + bytesToBase64(new TextEncoder().encode(user + ':' + password))
}
