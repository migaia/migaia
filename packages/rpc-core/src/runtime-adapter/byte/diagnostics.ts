import { attachErrorIdentity } from '@migaia/utils/error'
import { RpcCoreErrorCode, tagRpcError } from '../../core/errors.js'
import type { IRuntimeDiagnosticError } from './types.js'

/** Attach public diagnostics only; no local Core decision identity is minted by this helper. */
export function createRuntimeDiagnosticError(
  diagnostic: IRuntimeDiagnosticError,
  cause?: unknown,
  typeError = false
): Error {
  /** Preserve absence of the cause key when the original adapter has no failure cause. */
  const options = cause === undefined ? undefined : { cause }
  /** Credential rejection retains its existing native TypeError family. */
  const error = typeError
    ? new TypeError(diagnostic.message, options)
    : new Error(diagnostic.message, options)
  return attachErrorIdentity(error, { source: diagnostic.source, code: diagnostic.code })
}

/** Preserve the caller-owned string diagnostic and the existing Core payload code. */
export function asRuntimeString(value: unknown, expectedString: string): string {
  if (typeof value !== 'string')
    throw tagRpcError(new TypeError(expectedString), RpcCoreErrorCode.payloadInvalid)
  return value
}
