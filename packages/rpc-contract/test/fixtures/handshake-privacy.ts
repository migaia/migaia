/** Distinctive noncredential fixture detects disclosure through every public error projection. */
import { inspect } from 'node:util'
import { serializeRpcError } from '@migaia/rpc-contract/errors'

/** Six-unit fragments catch partial engine excerpts as well as whole-token disclosures. */
export const TOKEN = 'tok_SECRET_9f8e7d6c5b4a'

/** Inspect visible, hidden, serialized, report and cause values for every six-unit token fragment. */
export function leaks(error: unknown, token: string): boolean {
  /** Every public diagnostic projection contributes independently to this privacy oracle. */
  const seen: string[] = [inspect(error, { depth: null, showHidden: true })]
  /** Serializer reports are part of the same observable failure boundary. */
  const reported: unknown[] = []
  seen.push(JSON.stringify(serializeRpcError(error, { report: (value) => reported.push(value) })))
  seen.push(inspect(reported, { depth: null, showHidden: true }))
  /** Bounded cause walking preserves the original oracle without a production-side input walk. */
  let cause: unknown = error
  for (let depth = 0; depth < 16 && cause !== null && typeof cause === 'object'; depth++) {
    const current = cause as { cause?: unknown }
    cause = current.cause
    if (typeof cause === 'string') seen.push(cause)
    else if (cause instanceof Uint8Array) seen.push(new TextDecoder().decode(cause))
    else if (cause !== undefined) seen.push(JSON.stringify(cause))
  }
  for (let offset = 0; offset <= token.length - 6; offset++) {
    const fragment = token.slice(offset, offset + 6)
    if (seen.some((value) => value.includes(fragment))) return true
  }
  return false
}
