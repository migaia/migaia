import type { ILogFeatureRecord } from '@migaia/log-host/plugin'

/** A fetch response needs only success, status and the existing Retry-After header reader. */
export type IHttpResponse = {
  readonly ok: boolean
  readonly status: number
  readonly headers: { get(name: string): string | null }
}

/** Fetch injection remains portable and does not require a concrete native Response implementation. */
export type IHttpFetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<IHttpResponse>

/** A single HTTP attempt delegates batching, retries and timeouts to the host's features. */
export type IHttpPluginConfig<F extends ILogFeatureRecord = ILogFeatureRecord> = {
  /** Destination passed unchanged to the borrowed fetcher. */
  url: string
  /** Defaults to the current host fetch function when present. */
  fetcher?: IHttpFetcher
  /** Caller headers override the default JSON content type. */
  headers?: Record<string, string>
  /** A truthy token overrides Authorization with the existing bearer convention. */
  authToken?: string
  /** Valid server delays are clamped to this finite nonnegative bound, default 30000ms. */
  maxRetryAfterMs?: number
  /** Output-scoped host features override defaults without adding a second transport policy. */
  features?: F
}
