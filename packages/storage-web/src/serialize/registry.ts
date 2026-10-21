import { StorageError, StorageErrorCode } from '../types/errors.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  snapshotCodec,
  assertCodec,
  type ICodec,
  type IOperationContext
} from '@migaia/storage-contract'
import { bytesToBase64, base64ToBytes } from '@migaia/utils/bytes'
import { snapshotStorageCapabilities, type IStorageCapabilities } from '../types/capabilities.js'
import { isUint8Array } from '../core/bytes.js'
import { reportCleanupError } from '../core/operation-reporter.js'

// Codec descriptor guards belong to `@migaia/storage-contract`. Re-exports preserve existing import paths.
export { snapshotCodec, assertCodec }

const toBinaryBytes = (value: unknown): Uint8Array => {
  if (!isUint8Array(value))
    throw new StorageError(StorageErrorCode.serializeFailed, {
      cause: new TypeError('binary codec must return a Uint8Array')
    })
  const view = value as Uint8Array
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice()
}

const fromBase64 = (value: unknown): Uint8Array => {
  if (typeof value !== 'string')
    throw new StorageError(StorageErrorCode.deserializeFailed, {
      cause: new TypeError('binary fallback expects a base64 string')
    })
  try {
    return base64ToBytes(value)
  } catch (cause) {
    throw new StorageError(StorageErrorCode.deserializeFailed, { cause })
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
  const normalizedCodec = snapshotCodec(codec)
  const normalizedCapabilities = snapshotStorageCapabilities(capabilities)
  if (!normalizedCapabilities)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      cause: new TypeError('capabilities must be a complete storage descriptor')
    })
  if (onDiagnostic !== undefined && typeof onDiagnostic !== 'function')
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('onDiagnostic must be a function')
    })
  if (normalizedCodec.output === 'structured') {
    if (!normalizedCapabilities.records)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        cause: new Error(
          `codec "${normalizedCodec.name}" produces structured output but the backend only supports text`
        )
      })
    return normalizedCodec
  }

  if (normalizedCodec.output === 'binary') {
    if (normalizedCapabilities.binary) return normalizedCodec
    if (onDiagnostic)
      reportCleanupError(
        (error) => onDiagnostic(String(error)),
        `[storage-web] codec "${normalizedCodec.name}" falls back to base64 on a text-only backend (+33% size)`
      )
    return {
      encode: async (value, ctx) =>
        bytesToBase64(toBinaryBytes(await normalizedCodec.encode(value, ctx))),
      decode: async (raw, ctx) => normalizedCodec.decode(fromBase64(raw), ctx)
    }
  }

  return normalizedCodec
}
