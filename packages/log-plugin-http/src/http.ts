import { attachErrorIdentity } from '@migaia/utils/error'
import {
  defineOutputPlugin,
  projectLogEntry,
  type ILogOutputRecord,
  type ILogPlugin
} from '@migaia/log-host/plugin'
import { ERROR_SOURCE, LogHttpErrorCode, type ILogHttpErrorCode } from './error-code.ts'
import { LogHttpErrorText } from './error-text.ts'
import { HTTP_PLUGIN_NAME, HttpRequest } from './state-constants.ts'
import { parseRetryAfter } from './retry-after.ts'
import type { IHttpFetcher, IHttpPluginConfig, IHttpResponse } from './typing.ts'

/** Transport hints remain private and are consulted only by the host retry feature. */
type IRetryHint = { readonly retryable: boolean; readonly delay: number | undefined }

/** Attach this package's identity to a native Error while retaining the original failure on cause. */
function httpError(code: ILogHttpErrorCode, text: string, cause?: unknown): Error {
  return attachErrorIdentity(new Error(text, cause === undefined ? undefined : { cause }), {
    source: ERROR_SOURCE,
    code
  })
}

/** A named output owns only request construction and one network attempt. */
class HttpOutput {
  /** Destination belongs to this immutable factory snapshot. */
  #url: string
  /** The transport capability is borrowed and never replaced or disposed by the output. */
  #fetcher: IHttpFetcher
  /** Headers are copied once, with bearer authorization resolved before any POST. */
  #headers: Record<string, string>
  /** Server advice is bounded by the admitted factory option. */
  #maxRetryAfterMs: number
  /** Error objects carry private retry classification without changing the public wire or errors. */
  #hints = new WeakMap<Error, IRetryHint>()

  /** Reject missing transport and invalid retained options synchronously. */
  constructor(options: IHttpPluginConfig) {
    this.#url = options.url
    this.#fetcher = options.fetcher ?? globalThis.fetch
    if (typeof this.#fetcher !== 'function')
      throw httpError(LogHttpErrorCode.transportUnavailable, LogHttpErrorText.transportUnavailable)
    this.#maxRetryAfterMs = options.maxRetryAfterMs ?? 30000
    if (!Number.isFinite(this.#maxRetryAfterMs) || this.#maxRetryAfterMs < 0)
      throw httpError(LogHttpErrorCode.invalidOption, LogHttpErrorText.invalidOption)
    this.#headers = { [HttpRequest.contentType]: HttpRequest.json, ...options.headers }
    if (options.authToken) this.#headers[HttpRequest.authorization] = `Bearer ${options.authToken}`
  }

  /** Keep the exact entries envelope and the host-owned error projection on every attempt. */
  async deliver(
    records: readonly Pick<ILogOutputRecord, 'entry'>[],
    signal: AbortSignal
  ): Promise<void> {
    /** A failed projection must never reach the transport. */
    let body: string
    try {
      body = JSON.stringify({ entries: records.map((record) => projectLogEntry(record.entry)) })
    } catch (cause) {
      throw httpError(LogHttpErrorCode.serializeFailed, LogHttpErrorText.serializeFailed, cause)
    }
    /**
     * Borrow the function as a plain capability rather than accidentally rebinding it to this
     * owner.
     */
    const fetcher = this.#fetcher
    /** Response metadata is used only after the original transport Promise settles. */
    let response: IHttpResponse
    try {
      response = await fetcher(this.#url, {
        method: HttpRequest.method,
        headers: this.#headers,
        body,
        signal
      })
    } catch (cause) {
      /** Already-tagged delivery failures retain their original Error type, stack and identity. */
      const error =
        cause instanceof Error &&
        Object.getOwnPropertyDescriptor(cause, 'source')?.value === ERROR_SOURCE &&
        Object.getOwnPropertyDescriptor(cause, 'code')?.value === LogHttpErrorCode.deliveryFailed
          ? cause
          : httpError(LogHttpErrorCode.deliveryFailed, LogHttpErrorText.transportFailed, cause)
      this.#hints.set(error, { retryable: true, delay: undefined })
      throw error
    }
    if (response.ok) return
    /** Status failure text and native Error identity are preserved for the final failure channel. */
    const error = httpError(
      LogHttpErrorCode.deliveryFailed,
      LogHttpErrorText.deliveryFailed(response.status)
    )
    /** Only network failure, 429 and server errors qualify for host-managed retry. */
    const retryable = response.status === 429 || response.status >= 500
    this.#hints.set(error, {
      retryable,
      delay: retryable
        ? parseRetryAfter(response.headers.get(HttpRequest.retryAfter), this.#maxRetryAfterMs)
        : undefined
    })
    throw error
  }

  /** Host retry policy consumes only failures actually produced by this transport owner. */
  retryable(error: unknown): boolean {
    return error instanceof Error && this.#hints.get(error)?.retryable === true
  }

  /** The private server hint overrides ordinary host backoff for the next attempt only. */
  retryDelay(error: unknown): number | undefined {
    return error instanceof Error ? this.#hints.get(error)?.delay : undefined
  }
}

/** Create one HTTP output with host-owned policy and the unchanged JSON entries envelope. */
export function httpPlugin(options: IHttpPluginConfig): ILogPlugin {
  /** A named owner retains request state; SDK callbacks only forward to its methods. */
  const output = new HttpOutput(options)
  return defineOutputPlugin({
    name: HTTP_PLUGIN_NAME,
    batchable: true,
    consumesText: false,
    features: options.features,
    retryable: (error) => output.retryable(error),
    retryDelay: (error) => output.retryDelay(error),
    deliver: (records, context) => output.deliver(records, context.signal)
  })
}
