import { fileDesc, messageDesc } from '@bufbuild/protobuf/codegenv2'

/** Deterministic normative `rpc-v1.proto` descriptor used only by interop tests. */
const rpcEnvelopeFile = fileDesc(
  'ChNtaWdhaWFfcnBjX3YxLnByb3RvEg1taWdhaWEucnBjLnYxIkQKC1JwY0VudmVsb3BlEhAKBGtpbmQYASABKAlCAhAAEg4KAmlkGAIgASgJQgIQABITCgdwYXlsb2FkGAMgASgMQgIQAGIGcHJvdG8z'
)

/** Generated Buf descriptor for the independent interop envelope fixture. */
export const RpcEnvelopeSchema = messageDesc(rpcEnvelopeFile, 0)
