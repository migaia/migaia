/**
 * Classify Tray boundary failures with stable codes while retaining foreign identities and original
 * chains.
 */
import { ERROR_SOURCE, TrayErrorCode, type ITrayErrorCode } from './error-code.js'
import { TrayErrorText } from './error-text.js'
import { attachErrorIdentity, attachSecondaryErrors, isNativeErrorValue } from '@migaia/utils/error'

/** Stable package source attached to every Tray-owned boundary error. */
export const TRAY_SOURCE = ERROR_SOURCE

/**
 * Classifies native errors without replacing their type or stack. Complete foreign identities stay
 * with their owner; immutable/non-native throws remain reachable through a tagged wrapper's cause.
 */
export function attachTrayError(error: unknown, code: ITrayErrorCode): Error {
  if (isNativeErrorValue(error)) {
    try {
      /** Annotation inspects descriptors so application metadata getters are not invoked. */
      const source = Object.getOwnPropertyDescriptor(error, 'source')
      /** Complete existing identities remain owned by their originating package. */
      const existingCode = Object.getOwnPropertyDescriptor(error, 'code')
      if (typeof source?.value === 'string' && typeof existingCode?.value === 'string') return error
      if (!source && !existingCode && Object.isExtensible(error))
        return attachErrorIdentity(error, { source: TRAY_SOURCE, code })
    } catch (metadataError) {
      return attachSecondaryErrors(createTrayError(code, error), [metadataError]) as Error
    }
  }
  return createTrayError(code, error)
}

/** Creates a new Tray-owned Error for non-Error failures or local diagnostics. */
export function createTrayError(code: ITrayErrorCode, cause?: unknown): Error {
  const messages: Record<ITrayErrorCode, string> = {
    [TrayErrorCode.hostUnavailable]: TrayErrorText.hostUnavailable,
    [TrayErrorCode.routingUnknown]: TrayErrorText.routingUnknown,
    [TrayErrorCode.topicInvalid]: TrayErrorText.topicInvalid,
    [TrayErrorCode.routingInvalid]: TrayErrorText.routingInvalid,
    [TrayErrorCode.hostInvalid]: TrayErrorText.hostInvalid,
    [TrayErrorCode.hostUnknown]: TrayErrorText.hostUnknown,
    [TrayErrorCode.hostMismatch]: TrayErrorText.hostMismatch,
    [TrayErrorCode.reservedName]: TrayErrorText.reservedName,
    [TrayErrorCode.valueNotPortable]: TrayErrorText.valueNotPortable,
    [TrayErrorCode.instanceDuplicate]: TrayErrorText.instanceDuplicate,
    [TrayErrorCode.instanceUnknown]: TrayErrorText.instanceUnknown,
    [TrayErrorCode.instanceNotReady]: TrayErrorText.instanceNotReady,
    [TrayErrorCode.instanceStartFailed]: TrayErrorText.instanceStartFailed,
    [TrayErrorCode.pathNotExposed]: TrayErrorText.pathNotExposed,
    [TrayErrorCode.childStateInvalid]: TrayErrorText.childStateInvalid,
    [TrayErrorCode.disposed]: TrayErrorText.disposed,
    [TrayErrorCode.loaderContractInvalid]: TrayErrorText.loaderContractInvalid,
    [TrayErrorCode.loaderExecutionFailed]: TrayErrorText.loaderExecutionFailed,
    [TrayErrorCode.adapterContractInvalid]: TrayErrorText.adapterContractInvalid,
    [TrayErrorCode.adapterExecutionFailed]: TrayErrorText.adapterExecutionFailed,
    [TrayErrorCode.runtimeContractInvalid]: TrayErrorText.runtimeContractInvalid,
    [TrayErrorCode.runtimeDisposed]: TrayErrorText.runtimeDisposed,
    [TrayErrorCode.runtimeExecutionFailed]: TrayErrorText.runtimeExecutionFailed,
    [TrayErrorCode.runtimeAborted]: TrayErrorText.runtimeAborted,
    [TrayErrorCode.artifactCleanupFailed]: TrayErrorText.artifactCleanupFailed,
    [TrayErrorCode.invalidEntry]: TrayErrorText.invalidEntry,
    [TrayErrorCode.duplicateEntry]: TrayErrorText.duplicateEntry,
    [TrayErrorCode.unknownEntry]: TrayErrorText.unknownEntry,
    [TrayErrorCode.unavailable]: TrayErrorText.unavailable,
    [TrayErrorCode.gateReadFailed]: TrayErrorText.gateReadFailed,
    [TrayErrorCode.hostMutationBypass]: TrayErrorText.hostMutationBypass
  }
  const ErrorType =
    code === TrayErrorCode.loaderContractInvalid ||
    code === TrayErrorCode.adapterContractInvalid ||
    code === TrayErrorCode.runtimeContractInvalid
      ? TypeError
      : Error
  const error = new ErrorType(messages[code], cause === undefined ? undefined : { cause })
  Object.defineProperties(error, {
    source: { value: TRAY_SOURCE },
    code: { value: code }
  })
  return error
}
