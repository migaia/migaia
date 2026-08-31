import { TrayErrorCode, type ITrayErrorCode } from './error-code.js'
import { TrayErrorText } from './error-text.js'

/** Stable package source attached to every Tray-owned boundary error. */
export const TRAY_SOURCE = '@migaia/tray'

/**
 * Attaches code/source to same- or cross-realm Error-shaped objects when extensible. Frozen objects
 * remain the primary value without a tag; this avoids replacing native identity or masking the
 * original failure.
 */
export function attachTrayError(error: unknown, code: ITrayErrorCode): unknown {
  const classification = classifyError(error)
  if (classification === 'hostile') return error
  if (classification === 'error') {
    try {
      Object.defineProperties(error, { source: { value: TRAY_SOURCE }, code: { value: code } })
    } catch {
      // Preserve primary identity/type/stack when hostile errors reject tagging.
    }
    return error
  }
  return createTrayError(code, error)
}

/** Creates a new Tray-owned Error for non-Error failures or local diagnostics. */
export function createTrayError(code: ITrayErrorCode, cause?: unknown): Error {
  const messages: Record<ITrayErrorCode, string> = {
    [TrayErrorCode.invalidEntry]: TrayErrorText.invalidEntry,
    [TrayErrorCode.duplicateEntry]: TrayErrorText.duplicateEntry,
    [TrayErrorCode.unknownEntry]: TrayErrorText.unknownEntry,
    [TrayErrorCode.unavailable]: TrayErrorText.unavailable,
    [TrayErrorCode.gateReadFailed]: TrayErrorText.gateReadFailed,
    [TrayErrorCode.hostMutationBypass]: TrayErrorText.hostMutationBypass
  }
  const error = new Error(messages[code], cause === undefined ? undefined : { cause })
  Object.defineProperties(error, {
    source: { value: TRAY_SOURCE },
    code: { value: code }
  })
  return error
}

/** Recognizes cross-realm Error-shaped values without unsafe prototype assumptions. */
function isErrorLike(value: unknown): value is Error {
  return Object.prototype.toString.call(value) === '[object Error]'
}

/** Classifies thrown values without allowing hostile Proxy traps to replace them. */
function classifyError(value: unknown): 'error' | 'other' | 'hostile' {
  try {
    if (value instanceof Error) return 'error'
  } catch {
    return 'hostile'
  }
  if (typeof value !== 'object' || value === null) return 'other'
  try {
    return isErrorLike(value) ? 'error' : 'other'
  } catch {
    return 'hostile'
  }
}
