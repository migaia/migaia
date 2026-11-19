import type { IDiagnosticInfo } from '@migaia/part-host'
import { PartRemoteText } from './text.ts'

/** The log-host write method `forwardPartErrors` uses. */
export type IErrorLog = { error(...args: unknown[]): void }

/** One forwarded part error: where it happened, which version, and its classification. */
export type IPartErrorRecord = {
  readonly address?: string
  readonly version?: string
  readonly snapshot?: string
  readonly source?: unknown
  readonly code?: unknown
  readonly message: string
}

/** Record of an error and its diagnostic info; configuration values are never included. */
export function partErrorRecord(error: unknown, info: IDiagnosticInfo): IPartErrorRecord {
  /** Classification fields of the error. */
  const fields = (typeof error === 'object' && error !== null ? error : {}) as {
    readonly source?: unknown
    readonly code?: unknown
    readonly message?: unknown
  }
  return {
    ...(info.address === undefined ? {} : { address: info.address }),
    ...(info.context.version === undefined ? {} : { version: info.context.version }),
    ...(info.context.snapshot === undefined ? {} : { snapshot: info.context.snapshot }),
    source: fields.source,
    code: fields.code,
    message: typeof fields.message === 'string' ? fields.message : String(error)
  }
}

/**
 * `onError` for `createPartHost` that writes each reported error to log-host as one `error` entry
 * carrying the address, version, snapshot hash, `source` and `code`.
 */
export function forwardPartErrors(log: IErrorLog): (error: unknown, info: IDiagnosticInfo) => void {
  return (error, info) => log.error(PartRemoteText.partError, partErrorRecord(error, info))
}
