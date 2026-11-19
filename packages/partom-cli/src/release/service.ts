import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError } from '../errors.ts'
import { ReleaseText, TOKEN_VARIABLE } from './text.ts'

/** Outcome of one catalog call: a 2xx response, or the 4xx body to print as is. */
export type ICallOutcome =
  | { readonly ok: true; readonly response: Response }
  | { readonly ok: false; readonly body: string }

/**
 * HTTP client of one catalog project. The token comes only from `PARTOM_TOKEN`; without it requests
 * go unauthenticated and the catalog answers with its own error. Network failures and 5xx throw
 * SERVICE_UNREACHABLE; 4xx bodies are returned for the command to print.
 */
export class CatalogClient {
  /** Catalog base URL without a trailing slash. */
  readonly #service: string
  /** Project path segment. */
  readonly #project: string
  /** Bearer token, when set. */
  readonly #token: string | undefined

  /** Binds the client to a service and a project. */
  constructor(service: string, project: string) {
    this.#service = service.replace(/\/$/, '')
    this.#project = project
    this.#token = process.env[TOKEN_VARIABLE] || undefined
  }

  /** Sends one request under `/p/<project>/`. */
  async call(method: string, path: string, body?: BodyInit, type?: string): Promise<ICallOutcome> {
    /** Request URL. */
    const url = `${this.#service}/p/${encodeURIComponent(this.#project)}/${path}`
    /** Request headers. */
    const headers: Record<string, string> = {}
    if (this.#token !== undefined) headers.authorization = `Bearer ${this.#token}`
    if (type !== undefined) headers['content-type'] = type
    /** Response. */
    let response: Response
    try {
      response = await fetch(url, { method, headers, ...(body === undefined ? {} : { body }) })
    } catch (cause) {
      throw createPartCliError(
        PartCliErrorCode.serviceUnreachable,
        ReleaseText.serviceUnreachable(url),
        cause
      )
    }
    if (response.status >= 500)
      throw createPartCliError(
        PartCliErrorCode.serviceUnreachable,
        ReleaseText.serviceUnreachable(url),
        response.status
      )
    if (!response.ok) return { ok: false, body: await response.text() }
    return { ok: true, response }
  }

  /** Sends a JSON body. */
  json(method: string, path: string, value: unknown): Promise<ICallOutcome> {
    return this.call(method, path, JSON.stringify(value), 'application/json')
  }
}
