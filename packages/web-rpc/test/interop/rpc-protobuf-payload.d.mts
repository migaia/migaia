import type { ICodec, ICodecValue } from '../../../serialize/dist/codec.js'
import type { IRpcEnvelope } from '../../../rpc-contract/dist/v1/types.js'

/** Protobuf outer-envelope shape required by the RPC payload test adapter. */
export type IRpcProtobufEnvelope = Readonly<{
  kind: string
  id: string
  payload: Uint8Array
}>

/** Generic protobuf codec surface consumed by the test-only adapter. */
export type IRpcProtobufCodec<TEnvelope extends IRpcProtobufEnvelope> = Readonly<{
  encode: (value: TEnvelope) => Uint8Array
  decode: (value: Uint8Array) => TEnvelope
}>

/** Production JSON codec surface for the portable semantic body. */
export type IRpcJsonCodec = ICodec<ICodecValue, string, string, number>

/** Semantic normalization boundary supplied by the production RPC contract. */
export type IRpcEnvelopeNormalizer = (value: unknown) => IRpcEnvelope

/** Dependencies injected into the side-effect-free RPC protobuf payload adapter. */
export type IRpcProtobufPayloadCodecOptions<TEnvelope extends IRpcProtobufEnvelope> = Readonly<{
  protobufCodec: IRpcProtobufCodec<TEnvelope>
  jsonCodec: IRpcJsonCodec
  normalize: IRpcEnvelopeNormalizer
}>

/** Builds the production-side protobuf outer-envelope and JSON-body test adapter. */
export function createRpcProtobufPayloadCodec<TEnvelope extends IRpcProtobufEnvelope>(
  options: IRpcProtobufPayloadCodecOptions<TEnvelope>
): ICodec<IRpcEnvelope, Uint8Array, string, number>
