import type { IOperationContext } from './context.js'
import type { ICodecEncodedType } from '@migaia/serialize/codec'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'
import { StorageStageKind } from './stage-kind.js'

/** Declared encoded form: text strings, binary bytes, or backend-supported structured values. */
export type ICodecOutput = 'text' | 'binary' | 'structured'

/**
 * Defines an open serialization contract without tying it to a library. `storage-web` supplies
 * three common implementations in `jsonCodec`, `structured.ts`, and `binary.ts`. Custom
 * compression, encryption, and Worker-based recoding implement the same contract. This package
 * neither supplies nor depends on those custom implementations.
 */
export type ICodec<T = unknown, TRaw = string | Uint8Array | unknown> = {
  /** Nonempty format identifier; snapshotCodec validates but does not trim or rewrite it. */
  readonly name: string
  /** Declares the output form used to select a route from the backend capabilities. */
  readonly output: ICodecOutput
  /** Encodes one business value; the implementation owns transformation and any context handling. */
  encode(value: T, ctx?: IOperationContext): Promise<TRaw>
  /**
   * Decodes an encoded value or rejects on a format failure; no implicit format conversion is
   * supplied.
   */
  decode(raw: TRaw, ctx?: IOperationContext): Promise<T>
}

/** Structural source contract keeps each concrete callback's own input and output types. */
type IValueCodecDescriptor = Readonly<{
  id: string
  version: number
  encodedType: ICodecEncodedType
  encode(value: unknown): unknown
  decode(raw: unknown): unknown
}>

/** One canonical carrier-to-storage-route mapping; it never guesses from a callback result. */
type IAdaptedCodecOutput<TFormat extends ICodecEncodedType> = TFormat extends 'string'
  ? 'text'
  : TFormat extends 'uint8array'
    ? 'binary'
    : 'structured'

/** Distributes over source unions so metadata and mutually exclusive callback domains stay paired. */
type IAdaptedValueCodec<TCodec extends IValueCodecDescriptor> = TCodec extends IValueCodecDescriptor
  ? Readonly<{
      name: `${TCodec['id']}@${TCodec['version']}`
      output: IAdaptedCodecOutput<TCodec['encodedType']>
      encode: (
        value: Parameters<TCodec['encode']>[0],
        context?: IOperationContext
      ) => Promise<Awaited<ReturnType<TCodec['encode']>>>
      decode: (
        raw: Parameters<TCodec['decode']>[0],
        context?: IOperationContext
      ) => Promise<Awaited<ReturnType<TCodec['decode']>>>
    }>
  : never

/**
 * Captures a value codec once and adapts its callbacks without parsing or copying values.
 * Conversion remains asynchronous, preserves source failure identity on cause and owns no
 * resource.
 */
export function fromValueCodec<const TCodec extends IValueCodecDescriptor>(
  codec: TCodec
): IAdaptedValueCodec<TCodec> {
  /** Metadata and callbacks are read exactly once before validation or closure construction. */
  let id: unknown
  /** Source format revision becomes part of the stable storage codec name. */
  let version: unknown
  /** Declared carrier alone chooses the storage channel. */
  let encodedType: unknown
  /** Captured encode callback never changes when the caller later mutates its descriptor. */
  let encode: unknown
  /** Decode has its own input domain, including legacy inputs accepted by tagged codecs. */
  let decode: unknown
  try {
    if (typeof codec !== 'object' || codec === null || Array.isArray(codec))
      throw new TypeError(StorageContractErrorText.valueCodecDescriptor)
    id = codec.id
    version = codec.version
    encodedType = codec.encodedType
    encode = codec.encode
    decode = codec.decode
    if (
      typeof id !== 'string' ||
      id.trim() === '' ||
      !Number.isSafeInteger(version) ||
      (version as number) < 1 ||
      (encodedType !== 'string' && encodedType !== 'uint8array' && encodedType !== 'unknown') ||
      typeof encode !== 'function' ||
      typeof decode !== 'function'
    )
      throw new TypeError(StorageContractErrorText.valueCodecDescriptor)
  } catch (cause) {
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { cause },
      StorageContractErrorText.valueCodecDescriptor
    )
  }
  /**
   * Structural admission permits these callback types; public inference stays on the original
   * codec.
   */
  const capturedEncode = encode as (value: unknown) => unknown
  /** Source callbacks intentionally do not depend on their descriptor as a receiver. */
  const capturedDecode = decode as (raw: unknown) => unknown
  return Object.freeze({
    name: `${id}@${version}`,
    output:
      encodedType === 'string' ? 'text' : encodedType === 'uint8array' ? 'binary' : 'structured',
    async encode(value: unknown): Promise<unknown> {
      try {
        return await capturedEncode(value)
      } catch (cause) {
        throw new StorageContractError(
          StorageContractErrorCode.invalidArgument,
          { cause },
          StorageContractErrorText.valueCodecEncode
        )
      }
    },
    async decode(raw: unknown): Promise<unknown> {
      try {
        return await capturedDecode(raw)
      } catch (cause) {
        throw new StorageContractError(
          StorageContractErrorCode.invalidArgument,
          { cause },
          StorageContractErrorText.valueCodecDecode
        )
      }
    }
  }) as IAdaptedValueCodec<TCodec>
}

/** Observation-only codec ports are bound to real stores and scopes by their existing host owner. */
export type ICodecStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.codec
  forTransaction: (scope: object) => ICodecStageObserver
  beforeEncode?: (operation: string, codec: string) => void | PromiseLike<void>
  afterEncode?: (operation: string, codec: string) => void | PromiseLike<void>
  onEncodeError?: (operation: string, codec: string, code?: string) => void | PromiseLike<void>
  beforeDecode?: (operation: string, codec: string) => void | PromiseLike<void>
  afterDecode?: (operation: string, codec: string) => void | PromiseLike<void>
  onDecodeError?: (operation: string, codec: string, code?: string) => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>
