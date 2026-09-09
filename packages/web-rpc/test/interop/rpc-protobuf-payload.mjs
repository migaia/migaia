import { RpcContractErrorCode } from '../../../rpc-contract/dist/error-code.js'
import { RPC_CONTRACT_SOURCE, RpcContractErrorText } from '../../../rpc-contract/dist/error-text.js'

/**
 * @typedef {{
 *   encode: (value: unknown) => Uint8Array
 *   decode: (bytes: Uint8Array) => { kind: string; id: string; payload: Uint8Array }
 * }} IProtobufCodec
 */
/**
 * @typedef {{
 *   encode: (value: Record<string, unknown>) => string
 *   decode: (value: string) => unknown
 * }} IJsonCodec
 */
/** @typedef {(value: Record<string, unknown>) => unknown} INormalize */
/** @typedef {{ protobufCodec: IProtobufCodec; jsonCodec: IJsonCodec; normalize: INormalize }} IRpcProtobufPayloadCodecOptions */
/**
 * @typedef {{
 *   encode: (envelope: Record<string, unknown>) => Uint8Array
 *   decode: (bytes: Uint8Array) => unknown
 * }} IRpcProtobufPayloadCodec
 */

/** Kinds whose body can be reconstructed from a protobuf envelope. */
const envelopeKinds = new Set(['request', 'response', 'discovery', 'variation'])

/** Preserve the rejected low-level value as the direct cause of an RPC boundary error. */
const rejectEnvelope = (cause) => {
  const error = new TypeError(RpcContractErrorText.invalidEnvelope, { cause })
  Object.defineProperty(error, 'source', { value: RPC_CONTRACT_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', {
    value: RpcContractErrorCode.invalidEnvelope,
    enumerable: true
  })
  return error
}

/** Decode protobuf payload bytes without silently replacing invalid UTF-8 sequences. */
const decodeUtf8 = (payload) => new TextDecoder('utf-8', { fatal: true }).decode(payload)

/**
 * Adapts only the RPC test envelope to a generic protobuf codec. Production codec and protocol
 * dependencies are injected so an independent peer need not import this adapter.
 *
 * @param {IRpcProtobufPayloadCodecOptions} options Generic codecs and semantic normalizer used by
 *   production.
 * @returns {IRpcProtobufPayloadCodec} RPC-envelope codec that leaves peer implementation
 *   independent.
 */
export const createRpcProtobufPayloadCodec = ({ protobufCodec, jsonCodec, normalize }) =>
  Object.freeze({
    ...protobufCodec,
    encode: (envelope) => {
      const normalized = normalize(envelope)
      const { kind, id, ...body } = normalized
      if (!envelopeKinds.has(kind) || id.length === 0) throw rejectEnvelope(normalized)
      return protobufCodec.encode({
        $typeName: 'migaia.rpc.v1.RpcEnvelope',
        kind,
        id,
        payload: new TextEncoder().encode(jsonCodec.encode(body))
      })
    },
    decode: (bytes) => {
      const envelope = protobufCodec.decode(bytes)
      if (!envelopeKinds.has(envelope.kind) || envelope.id.length === 0)
        throw rejectEnvelope(envelope)
      let body
      try {
        body = jsonCodec.decode(decodeUtf8(envelope.payload))
      } catch (error) {
        throw rejectEnvelope(error)
      }
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        'kind' in body ||
        'id' in body
      )
        throw rejectEnvelope(body)
      try {
        return normalize({ kind: envelope.kind, id: envelope.id, ...body })
      } catch (error) {
        throw rejectEnvelope(error)
      }
    }
  })
