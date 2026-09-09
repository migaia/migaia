import { fileDesc, messageDesc } from '@bufbuild/protobuf/codegenv2'

/**
 * Deterministic Buf fixture generated from the normative `rpc-v1.proto` descriptor. Codec tests use
 * it as a schema input without making the generic serialize package own an RPC runtime binding.
 */
export const rpcEnvelopeDescriptorBase64 =
  'ChNtaWdhaWFfcnBjX3YxLnByb3RvEg1taWdhaWEucnBjLnYxIkQKC1JwY0VudmVsb3BlEhAKBGtpbmQYASABKAlCAhAAEg4KAmlkGAIgASgJQgIQABITCgdwYXlsb2FkGAMgASgMQgIQAGIGcHJvdG8z'

const rpcEnvelopeFile = fileDesc(rpcEnvelopeDescriptorBase64)

/** Value shape accepted by the generated RPC envelope descriptor. */
export type IRpcEnvelopeMessage = Readonly<{
  $typeName: 'migaia.rpc.v1.RpcEnvelope'
  kind: string
  id: string
  payload: Uint8Array
}>

/** Generated message descriptor for the normative RPC envelope fixture. */
export const RpcEnvelopeSchema = messageDesc<IRpcEnvelopeMessage>(rpcEnvelopeFile, 0)
