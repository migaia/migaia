import {
  assertCodec,
  type ICodec,
  type IOperationContext,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText
} from '@migaia/storage-contract'
import { type ICodecEncodedType } from '@migaia/serialize/codec'

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

/** Adapt one admitted source codec without owning its value format or lifetime. */
class ValueCodecAdapter<TCodec extends IValueCodecDescriptor> {
  /** The caller owns this stable descriptor; callbacks are invoked on their original receiver. */
  readonly #codec: TCodec
  /** Source identity and version select the same persisted format name. */
  readonly name: string
  /** The declared encoded carrier determines the storage route. */
  readonly output: 'text' | 'binary' | 'structured'

  /** Validate the actual public descriptor before exposing asynchronous conversion methods. */
  constructor(codec: TCodec) {
    if (
      typeof codec !== 'object' ||
      codec === null ||
      Array.isArray(codec) ||
      typeof codec.id !== 'string' ||
      codec.id.trim() === '' ||
      !Number.isSafeInteger(codec.version) ||
      codec.version < 1 ||
      (codec.encodedType !== 'string' &&
        codec.encodedType !== 'uint8array' &&
        codec.encodedType !== 'unknown') ||
      typeof codec.encode !== 'function' ||
      typeof codec.decode !== 'function'
    )
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { cause: new TypeError(StorageContractErrorText.valueCodecDescriptor) },
        StorageContractErrorText.valueCodecDescriptor
      )
    this.#codec = codec
    this.name = `${codec.id}@${codec.version}`
    this.output =
      codec.encodedType === 'string'
        ? 'text'
        : codec.encodedType === 'uint8array'
          ? 'binary'
          : 'structured'
  }

  /** Encode through the original codec; preserve the exact failure as the contract cause. */
  readonly encode = async (value: unknown): Promise<unknown> => {
    try {
      return await this.#codec.encode(value)
    } catch (cause) {
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { cause },
        StorageContractErrorText.valueCodecEncode
      )
    }
  }

  /** Decode through the original codec; preserve the exact failure as the contract cause. */
  readonly decode = async (raw: unknown): Promise<unknown> => {
    try {
      return await this.#codec.decode(raw)
    } catch (cause) {
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { cause },
        StorageContractErrorText.valueCodecDecode
      )
    }
  }
}

/** Build the asynchronous storage adapter; source encode/decode domains remain independently typed. */
export function fromValueCodec<const TCodec extends IValueCodecDescriptor>(
  codec: TCodec
): IAdaptedValueCodec<TCodec> {
  /** The public conditional type preserves source-union correlations beyond a generic class. */
  return new ValueCodecAdapter(codec) as unknown as IAdaptedValueCodec<TCodec>
}

/**
 * Borrows the admitted original codec so class methods retain their private-state receiver.
 * Ordinary readonly descriptors are not copied or frozen; no conversion runs during admission.
 */
export function snapshotCodec(codec: unknown): ICodec {
  assertCodec(codec)
  return codec
}
