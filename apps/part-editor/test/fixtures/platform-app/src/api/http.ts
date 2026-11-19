// @partom-generated sha256:1121dcf0539be052a225d87b44830800211895a40c0beb29ec708118506ef80b
import { definePlugin } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'

/** Message of the error thrown on a non-2xx response. */
const HTTP_FAILED = 'HTTP request failed'

/** Options of the HTTP Feature: the API base URL and an optional fetch (for auth or tests). */
export type IHttpOptions = { readonly baseUrl: string; readonly fetch?: typeof fetch }

/** One request of a generated resource. */
export type IHttpRequest = {
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, unknown>>
  readonly body?: unknown
  readonly signal?: AbortSignal
}

/** HTTP client the generated resources call; JSON in, JSON out. */
export class HttpClient {
  /** Client options. */
  readonly #options: IHttpOptions

  /** Binds the client to its options. */
  constructor(options: IHttpOptions) {
    this.#options = options
  }

  /** Sends a request; a non-2xx status throws an error carrying `status` and the response text. */
  async request(request: IHttpRequest): Promise<unknown> {
    /** Absolute URL with the query string. */
    const url = new URL(
      request.path.replace(/^\//, ''),
      this.#options.baseUrl.endsWith('/') ? this.#options.baseUrl : `${this.#options.baseUrl}/`
    )
    for (const [key, value] of Object.entries(request.query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value))
    /** Response of the request. */
    const response = await (this.#options.fetch ?? fetch)(url, {
      method: request.method,
      signal: request.signal,
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body), headers: { 'content-type': 'application/json' } })
    })
    /** Response text. */
    const text = await response.text()
    if (!response.ok)
      throw Object.assign(new Error(HTTP_FAILED), { status: response.status, body: text })
    return text === '' ? undefined : JSON.parse(text)
  }
}

/** Creates the plugin providing the HTTP Feature; install it next to the generated api plugin. */
export function createHttpPlugin(options: IHttpOptions) {
  return definePlugin({
    name: 'api-http',
    features: { http: defineFeature(() => new HttpClient(options)) },
    install: () => ({})
  })
}

/** Reference to the HTTP Feature; it resolves to whichever "api-http" plugin is installed. */
export const httpFeature = createHttpPlugin({ baseUrl: 'http://localhost/' }).getFeature('http')

/** Path with `{name}` segments replaced by encoded parameter values. */
export function fillPath(path: string, values: unknown, names: readonly string[]): string {
  /** Parameter values. */
  const record = (values ?? {}) as Readonly<Record<string, unknown>>
  /** Filled path. */
  let filled = path
  for (const name of names)
    filled = filled.replace(`{${name}}`, encodeURIComponent(String(record[name])))
  return filled
}

/** The named fields of a value. */
export function pick(values: unknown, names: readonly string[]): Record<string, unknown> {
  /** Parameter values. */
  const record = (values ?? {}) as Readonly<Record<string, unknown>>
  /** Picked fields. */
  const picked: Record<string, unknown> = {}
  for (const name of names) picked[name] = record[name]
  return picked
}
