import { PartRemoteErrorCode } from './error-code.ts'
import { createPartRemoteError } from './errors.ts'
import { PartRemoteText } from './text.ts'

/** Result of one snapshot request. */
export type IFetchResult =
  | { readonly status: 'unchanged' }
  | { readonly status: 'changed'; readonly bytes: Uint8Array }

/** Catalog location and credentials of one client. */
export type IClientTarget = {
  readonly service: string
  readonly project: string
  readonly env: string
  readonly token?: string
}

/** Base URL that snapshot-relative module URLs resolve against: `<service>/p/<project>/`. */
export function projectBase(target: IClientTarget): string {
  return `${target.service.replace(/\/$/, '')}/p/${encodeURIComponent(target.project)}/`
}

/** Request headers with the bearer token when one is configured. */
export function authHeaders(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { authorization: `Bearer ${token}` }
}

/** Fetches a URL, mapping network failures and non-2xx/304 statuses to REMOTE_FETCH_FAILED. */
export async function fetchChecked(url: string, init: RequestInit): Promise<Response> {
  /** Response. */
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (cause) {
    throw createPartRemoteError(
      PartRemoteErrorCode.fetchFailed,
      PartRemoteText.fetchFailed(url),
      cause
    )
  }
  if (response.status !== 304 && !response.ok)
    throw createPartRemoteError(
      PartRemoteErrorCode.fetchFailed,
      PartRemoteText.fetchFailed(url),
      response.status
    )
  return response
}

/**
 * Requests the environment's snapshot with `If-None-Match: "<current hash>"`. A 304 is `unchanged`;
 * a 200 returns the raw bytes.
 */
export async function fetchSnapshot(
  target: IClientTarget,
  current: string | undefined,
  signal: AbortSignal
): Promise<IFetchResult> {
  /** Snapshot URL. */
  const url = `${projectBase(target)}env/${encodeURIComponent(target.env)}/snapshot`
  /** Response. */
  const response = await fetchChecked(url, {
    headers: {
      ...authHeaders(target.token),
      ...(current === undefined ? {} : { 'if-none-match': `"${current}"` })
    },
    signal
  })
  if (response.status === 304) return { status: 'unchanged' }
  return { status: 'changed', bytes: new Uint8Array(await response.arrayBuffer()) }
}
