import { StorageError } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ICodec,
  type IOperationContext
} from '@migaia/storage-contract'
import { snapshotCodec } from '../authoring/codec.js'
import { bytesToBase64, base64ToBytes } from '@migaia/utils/bytes'
import { snapshotStorageCapabilities } from '../authoring/store.js'
import { type IStorageCapabilities } from '@migaia/storage-contract'
import { isUint8Array } from '@migaia/utils/bytes'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { StorageErrorText } from '../error-text.js'

/** Snapshot a binary codec result before wrapping it as text. */
const toBinaryBytes = (value: unknown): Uint8Array => {
  if (!isUint8Array(value))
    throw new StorageError(StorageHostErrorCode.serializeFailed, {
      cause: new TypeError(StorageErrorText.binaryCodecResult)
    })
  /** Preserve the original view bounds while isolating its bytes. */
  const view = value as Uint8Array
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice()
}

/** Restore the explicit binary fallback carrier or retain its native decoding cause. */
const fromBase64 = (value: unknown): Uint8Array => {
  if (typeof value !== 'string')
    throw new StorageError(StorageHostErrorCode.deserializeFailed, {
      cause: new TypeError(StorageErrorText.binaryFallbackInput)
    })
  try {
    return base64ToBytes(value)
  } catch (cause) {
    throw new StorageError(StorageHostErrorCode.deserializeFailed, { cause })
  }
}

/**
 * Backend-compatible codec route with optional base64 wrapping; input/output domain validation
 * remains with the selected codec.
 */
export type ISelectedCodec = {
  /** Produces the string, bytes, or structured value that the selected route writes to storage. */
  encode(
    value: unknown,
    ctx?: { signal?: NonNullable<IOperationContext['signal']> }
  ): Promise<string | Uint8Array | unknown>
  /** Restore one stored representation, forwarding the operation signal to the original codec. */
  decode(
    raw: string | Uint8Array | unknown,
    ctx?: { signal?: NonNullable<IOperationContext['signal']> }
  ): Promise<unknown>
}

/**
 * Selects a codec route from backend capabilities. A matching `codec.output` uses the codec
 * directly. A binary codec on a text-only backend uses a base64 wrapper with four times
 * ceil(byteLength / 3) characters. onDiagnostic observes that fallback once per route selection;
 * diagnostic failures are contained and cannot change the chosen route. A structured codec on a
 * text-only backend throws `UNSUPPORTED_CAPABILITY`. JSON cannot preserve structured clone values
 * such as `Blob`, `Map`, `Set`, or cycles, so this function does not silently convert them and lose
 * data.
 */
export const selectCodec = (
  codec: ICodec,
  capabilities: IStorageCapabilities,
  onDiagnostic?: (message: string) => void
): ISelectedCodec => {
  /** One descriptor snapshot fixes the selected codec callbacks. */
  const normalizedCodec = snapshotCodec(codec)
  /** Capability admission runs once before choosing a storage carrier. */
  const normalizedCapabilities = snapshotStorageCapabilities(capabilities)
  if (!normalizedCapabilities)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError(StorageErrorText.codecCapabilities)
    })
  if (onDiagnostic !== undefined && typeof onDiagnostic !== 'function')
    throw new StorageError(StorageHostErrorCode.invalidConfig, {
      cause: new TypeError(StorageErrorText.codecDiagnostic)
    })
  if (normalizedCodec.output === 'structured') {
    if (!normalizedCapabilities.records)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        cause: new Error(StorageErrorText.structuredCodecUnsupported(normalizedCodec.name))
      })
    return normalizedCodec
  }

  if (normalizedCodec.output === 'binary') {
    if (normalizedCapabilities.binary) return normalizedCodec
    if (onDiagnostic) {
      /** Diagnostic failures are contained through the shared thenable observer. */
      const reportFailure = (error: unknown): void => {
        /** Console is a host diagnostic facility, not a DOM or Node type dependency. */
        const host = globalThis as typeof globalThis & {
          console: { error(message: string, error: unknown): void }
        }
        host.console.error(StorageErrorText.codecDiagnosticFailure, error)
      }
      try {
        /** Observe callback rejection without changing the selected codec route. */
        const result = onDiagnostic(StorageErrorText.codecBinaryFallback(normalizedCodec.name))
        observeThenableRejection(result, inspectThenable(result), reportFailure)
      } catch (cause) {
        observeThenableRejection(undefined, { error: cause }, reportFailure)
      }
    }
    return {
      encode: async (value, ctx) =>
        bytesToBase64(toBinaryBytes(await normalizedCodec.encode(value, ctx))),
      decode: async (raw, ctx) => normalizedCodec.decode(fromBase64(raw), ctx)
    }
  }

  return normalizedCodec
}
