/** JSON is the common startup codec of the sole semantic RPC profile. */
export const RpcCarrierCodecId = 'json'
/** Native UTF-8 decoder construction must reject malformed bytes rather than replace them. */
export const RpcCarrierEncoding = 'utf-8'
/** Original byte writer retains only small completed frame backings between physical drains. */
export const RPC_CARRIER_RETAINED_FRAME_BYTES = 64 * 1024
/** Existing native postMessage failure text survives at the actual executing carrier boundary. */
export const RpcCarrierErrorText = { nativeSendFailed: '[rpc] native message send failed' } as const
