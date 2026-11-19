import type {
  IBlueprint,
  IChangeset,
  IChangesetResult,
  IDescriptor,
  IRemoteModuleRef
} from '@migaia/part-contract'

/** Draft as the catalog returns it: each item with its catalog-computed hash. */
export type IDraftView = {
  readonly base: { readonly snapshot: string; readonly tag: string }
  readonly conflicts: readonly {
    readonly address?: string
    readonly facet?: string
    readonly blueprint?: string
    readonly module?: string
  }[]
  readonly blueprints: readonly {
    readonly id: string
    readonly hash: string
    readonly document: IBlueprint
  }[]
  readonly modules: readonly {
    readonly name: string
    readonly hash: string
    readonly source?: string
    readonly built: IRemoteModuleRef
  }[]
}

/** Outcome of one catalog call: parsed JSON, or the HTTP status (0 for a network failure). */
export type IApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly body: string }

/** Catalog HTTP client of one project, authenticated with the session token. */
export class CatalogApi {
  /** Project base URL `<service>/p/<project>/`. */
  readonly base: string
  /** Bearer token. */
  readonly #token: string

  /** Binds the client to a service, project and token. */
  constructor(service: string, project: string, token: string) {
    this.base = `${service.replace(/\/$/, '')}/p/${encodeURIComponent(project)}/`
    this.#token = token
  }

  /** `GET drafts`. */
  draft(): Promise<IApiResult<IDraftView>> {
    return this.#call('drafts')
  }

  /** `GET catalog?draft=1`: descriptors of the dev snapshot plus draft module exports. */
  catalog(): Promise<IApiResult<readonly IDescriptor[]>> {
    return this.#call('catalog?draft=1')
  }

  /** `POST drafts/changesets`; a 409/422 answer still carries the per-artifact result. */
  changeset(changeset: IChangeset): Promise<IApiResult<IChangesetResult>> {
    return this.#call('drafts/changesets', { method: 'POST', body: JSON.stringify(changeset) })
  }

  /** Sends one request; network failures are status 0. */
  async #call<T>(path: string, init: RequestInit = {}): Promise<IApiResult<T>> {
    /** Response. */
    let response: Response
    try {
      response = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.#token}`, 'content-type': 'application/json' }
      })
    } catch (cause) {
      return { ok: false, status: 0, body: String(cause) }
    }
    /** Body text. */
    const body = await response.text()
    if (
      response.ok ||
      ((response.status === 409 || response.status === 422) && body.includes('"artifacts"'))
    )
      return { ok: true, value: JSON.parse(body) as T }
    return { ok: false, status: response.status, body }
  }
}
