import { fromBinary, toBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf'
import { SerializeErrorCode } from '../error-code.js'
import {
  assertCodecVersion,
  createCodecError,
  CodecErrorText,
  normalizeCodecFailure,
  type ICodec
} from '../codec.js'

/** Stable public schema identity remains independent from codec and binding versions. */
export type IProtobufSchema<TId extends string, TVersion extends number> = Readonly<{
  id: TId
  version: TVersion
}>

/** A generated Buf descriptor is the only executable binding accepted by a Protobuf codec. */
export type IProtobufCodecOptions<
  TVersion extends number,
  TSchemaId extends string,
  TSchemaVersion extends number,
  TBinding extends DescMessage
> = Readonly<{
  version: TVersion
  schema: IProtobufSchema<TSchemaId, TSchemaVersion>
  binding: TBinding
}>

/** Accepts intrinsic byte views from another realm while rejecting arbitrary typed arrays. */
function isUint8Array(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array ||
    (ArrayBuffer.isView(value) &&
      (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag] === 'Uint8Array')
  )
}

/** Create a protobuf codec that keeps codec and schema identities independent. */
export function defineProtobufCodec<
  const TVersion extends number,
  const TSchemaId extends string,
  const TSchemaVersion extends number,
  const TBinding extends DescMessage
>(
  options: IProtobufCodecOptions<TVersion, TSchemaId, TSchemaVersion, TBinding>
): ICodec<MessageShape<TBinding>, Uint8Array, 'protobuf', TVersion> &
  Readonly<{ schema: IProtobufSchema<TSchemaId, TSchemaVersion> }> {
  let version: TVersion
  try {
    version = assertCodecVersion(options.version)
  } catch (error) {
    throw normalizeCodecFailure(
      error,
      SerializeErrorCode.invalidOption,
      CodecErrorText.invalidVersion
    )
  }
  let schema: IProtobufSchema<TSchemaId, TSchemaVersion>
  let schemaId: TSchemaId
  let schemaVersion: TSchemaVersion
  try {
    schema = options.schema
    /** Snapshot hostile schema identity once before validation and publication. */
    schemaId = schema?.id
    /** Snapshot hostile schema version once before validation and publication. */
    schemaVersion = schema?.version
  } catch (error) {
    throw normalizeCodecFailure(
      error,
      SerializeErrorCode.invalidOption,
      CodecErrorText.invalidSchema
    )
  }
  if (
    !schema ||
    typeof schemaId !== 'string' ||
    !/^[a-z][a-z0-9.-]*$/u.test(schemaId) ||
    !Number.isSafeInteger(schemaVersion) ||
    schemaVersion <= 0
  ) {
    throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.invalidSchema)
  }
  let binding: TBinding
  try {
    binding = options.binding
  } catch (error) {
    throw normalizeCodecFailure(
      error,
      SerializeErrorCode.invalidOption,
      CodecErrorText.portableValueInvalid
    )
  }
  let bindingKind: unknown
  let bindingTypeName: unknown
  try {
    bindingKind = binding?.kind
    bindingTypeName = binding?.typeName
  } catch (error) {
    throw normalizeCodecFailure(
      error,
      SerializeErrorCode.invalidOption,
      CodecErrorText.portableValueInvalid
    )
  }
  if (!binding || bindingKind !== 'message' || typeof bindingTypeName !== 'string')
    throw createCodecError(SerializeErrorCode.invalidOption, CodecErrorText.portableValueInvalid)
  return Object.freeze({
    id: 'protobuf' as const,
    version,
    schema: Object.freeze({ id: schemaId, version: schemaVersion }),
    encodedType: 'uint8array' as const,
    encode: (value: MessageShape<TBinding>): Uint8Array => {
      try {
        const encoded = toBinary(binding, value)
        if (!isUint8Array(encoded))
          throw createCodecError(SerializeErrorCode.encodeFailed, CodecErrorText.encodeFailed)
        return encoded
      } catch (error) {
        throw normalizeCodecFailure(
          error,
          SerializeErrorCode.encodeFailed,
          CodecErrorText.encodeFailed
        )
      }
    },
    decode: (value: Uint8Array): MessageShape<TBinding> => {
      try {
        if (!isUint8Array(value))
          throw createCodecError(SerializeErrorCode.decodeFailed, CodecErrorText.decodeFailed)
        return fromBinary(binding, value)
      } catch (error) {
        throw normalizeCodecFailure(
          error,
          SerializeErrorCode.decodeFailed,
          CodecErrorText.decodeFailed
        )
      }
    }
  })
}
