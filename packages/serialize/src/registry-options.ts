/** Registry capability admission owns one-time reads and their original receivers. */
import type {
  ISerializeRegistryOptions,
  ITextEncoder,
  ITextDecoder,
  ISerializeCleanupError,
  ISerializeTimeoutDiagnostic
} from './types.ts'
import { snapshotScheduler } from '@migaia/lifecycle/scheduler'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  createSerializeError,
  createSerializeTypeError,
  SerializeErrorCode,
  SerializeErrorText
} from './errors.ts'
import { SerializeCleanupPolicy } from './format-constants.ts'
import { isSerializeTaggedError } from './operation-support.ts'
import { SerializeDiagnosticText } from './diagnostic-text.ts'
import { type IInvokable } from './registry-protocol.ts'

/** 结构化探测宿主 `TextEncoder`（Encoding API），不 import DOM/Node。 */
const hostTextEncoder = (): ITextEncoder | undefined => {
  /** Host encoding capability is read once without importing a runtime adapter. */
  const Ctor = (globalThis as { TextEncoder?: new () => ITextEncoder }).TextEncoder
  return Ctor ? new Ctor() : undefined
}

/** 结构化探测宿主 `TextDecoder`（Encoding API），不 import DOM/Node。 */
const hostTextDecoder = (): ITextDecoder | undefined => {
  /** Host encoding capability is read once without importing a runtime adapter. */
  const Ctor = (globalThis as { TextDecoder?: new () => ITextDecoder }).TextDecoder
  return Ctor ? new Ctor() : undefined
}

/** Immutable cleanup callback snapshot used after registry construction. */
export type ICleanupSnapshot =
  | { readonly policy: typeof SerializeCleanupPolicy.throw }
  | {
      readonly policy: typeof SerializeCleanupPolicy.report
      readonly report: (diagnostic: ISerializeCleanupError) => void
    }

/** Immutable capability set captured before the registry can publish any lifecycle state. */
export type IRegistryOptionsSnapshot = {
  readonly scheduler: NonNullable<ReturnType<typeof snapshotScheduler>>
  readonly encoder: ITextEncoder
  readonly decoder: ITextDecoder
  readonly report: (error: unknown) => void
  readonly onDrainTimeout: (diagnostic: ISerializeTimeoutDiagnostic) => void
  readonly cleanup: ICleanupSnapshot
}

/** A no-op reporter that keeps detached parser failures observed without host dependencies. */
const defaultReport = (_error: unknown): void => {}

/** A no-op timeout observer used when callers do not request deadline diagnostics. */
const defaultOnDrainTimeout = (_diagnostic: ISerializeTimeoutDiagnostic): void => {}

/** Capture one callback value and retain the object that owned its option property. */
const captureOptionCallback = <TArgs extends readonly unknown[], TResult>(
  value: unknown,
  receiver: object,
  invalidMessage: string
): ((...args: TArgs) => TResult) => {
  if (typeof value !== 'function')
    throw createSerializeTypeError(SerializeErrorCode.invalidOption, invalidMessage)
  /** The captured callable is reused without another caller-owned property read. */
  const method = value as IInvokable<TResult>
  return (...args: TArgs): TResult => Reflect.apply(method, receiver, args)
}

/** Capture an encoder method once and preserve the encoder object's receiver. */
const captureEncoder = (value: unknown): ITextEncoder => {
  /** Default resolution happens before method capture and parser ownership. */
  const encoder = value === undefined ? hostTextEncoder() : value
  if (encoder === undefined) {
    throw createSerializeError(
      SerializeErrorCode.envUnsupported,
      SerializeDiagnosticText.encodingUnavailable
    )
  }
  if (encoder === null || (typeof encoder !== 'object' && typeof encoder !== 'function'))
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.encoderInvalid
    )
  /** The captured callable is reused without another caller-owned property read. */
  const method = (encoder as { encode?: unknown }).encode
  if (typeof method !== 'function')
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.encoderInvalid
    )
  /** Original option or protocol receiver survives later caller mutation. */
  const receiver = encoder as object
  return {
    encode: (input: string) => Reflect.apply(method as IInvokable<Uint8Array>, receiver, [input])
  }
}

/** Capture a decoder method once and preserve the decoder object's receiver. */
const captureDecoder = (value: unknown): ITextDecoder => {
  /** Default decoding capability is admitted even when this operation only encodes. */
  const decoder = value === undefined ? hostTextDecoder() : value
  if (decoder === undefined) {
    throw createSerializeError(
      SerializeErrorCode.envUnsupported,
      SerializeDiagnosticText.encodingUnavailable
    )
  }
  if (decoder === null || (typeof decoder !== 'object' && typeof decoder !== 'function'))
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.decoderInvalid
    )
  /** The captured callable is reused without another caller-owned property read. */
  const method = (decoder as { decode?: unknown }).decode
  if (typeof method !== 'function')
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.decoderInvalid
    )
  /** Original option or protocol receiver survives later caller mutation. */
  const receiver = decoder as object
  return {
    decode: (input: Uint8Array) => Reflect.apply(method as IInvokable<string>, receiver, [input])
  }
}

/** Snapshot all registry options before parser ownership or dispose single-flight state exists. */
export const snapshotRegistryOptions = (
  options: ISerializeRegistryOptions | undefined
): IRegistryOptionsSnapshot => {
  try {
    if (
      options !== undefined &&
      (options === null || (typeof options !== 'object' && typeof options !== 'function'))
    )
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.registryOptionReadFailed
      )
    /** Original option or protocol receiver survives later caller mutation. */
    const receiver = options as object | undefined
    /** Scheduler getter is captured in the required construction read order. */
    const schedulerOption = options?.scheduler
    /** Encoder getter is captured before any capability method is admitted. */
    const encoderOption = options?.encoder
    /** Decoder getter is captured once before callback admission. */
    const decoderOption = options?.decoder
    /** Detached-failure reporter is snapshotted before parser ownership. */
    const reportOption = options?.report
    /** Timeout observer is captured once before lifecycle state exists. */
    const onDrainTimeoutOption = options?.onDrainTimeout
    /** Cleanup policy is captured once after all top-level option getters. */
    const cleanupOption = options?.cleanup

    /** Admitted scheduler retains the original clock and task receiver semantics. */
    const scheduler = snapshotScheduler(
      schedulerOption === undefined ? systemScheduler : schedulerOption
    )
    if (scheduler === undefined)
      throw createSerializeTypeError(
        SerializeErrorCode.invalidOption,
        SerializeErrorText.schedulerInvalid
      )

    /** Default resolution happens before method capture and parser ownership. */
    const encoder = captureEncoder(encoderOption)
    /** Default decoding capability is admitted even when this operation only encodes. */
    const decoder = captureDecoder(decoderOption)
    /** Stable reporter retains the original option object as its receiver. */
    const report =
      reportOption === undefined
        ? defaultReport
        : captureOptionCallback<[unknown], void>(
            reportOption,
            receiver as object,
            SerializeErrorText.reportInvalid
          )
    /** Stable observer cannot be changed by later option mutation. */
    const onDrainTimeout =
      onDrainTimeoutOption === undefined
        ? defaultOnDrainTimeout
        : captureOptionCallback<[ISerializeTimeoutDiagnostic], void>(
            onDrainTimeoutOption,
            receiver as object,
            SerializeErrorText.onDrainTimeoutInvalid
          )

    /** Only the captured cleanup policy controls terminal parser failures. */
    let cleanup: ICleanupSnapshot
    if (cleanupOption === undefined) {
      cleanup = { policy: SerializeCleanupPolicy.throw }
    } else {
      if (
        cleanupOption === null ||
        (typeof cleanupOption !== 'object' && typeof cleanupOption !== 'function')
      )
        throw createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeErrorText.cleanupInvalid
        )
      /** Cleanup discriminant is read once before accessing a policy-specific callback. */
      const policy = (cleanupOption as { policy?: unknown }).policy
      if (policy === SerializeCleanupPolicy.throw) {
        cleanup = { policy: SerializeCleanupPolicy.throw }
      } else if (policy === SerializeCleanupPolicy.report) {
        /** Report-policy callback is read only after that policy is admitted. */
        const cleanupReport = (cleanupOption as { report?: unknown }).report
        cleanup = {
          policy: SerializeCleanupPolicy.report,
          report: captureOptionCallback<[ISerializeCleanupError], void>(
            cleanupReport,
            cleanupOption as object,
            SerializeErrorText.cleanupReportInvalid
          )
        }
      } else {
        throw createSerializeTypeError(
          SerializeErrorCode.invalidOption,
          SerializeErrorText.cleanupInvalid
        )
      }
    }

    return {
      scheduler,
      encoder,
      decoder,
      report,
      onDrainTimeout,
      cleanup
    }
  } catch (error) {
    if (isSerializeTaggedError(error)) throw error
    throw createSerializeTypeError(
      SerializeErrorCode.invalidOption,
      SerializeErrorText.registryOptionReadFailed,
      { cause: error }
    )
  }
}
