import { identityCodecV1 } from '@migaia/serialize/codec'
import { messageFramerV1 } from '../contract/framing/message-framer.js'
import { RpcCapability } from '../contract/wire-constants.js'

/** Both ends share this static identity pipeline; no hello is sent on message channels. */
export const THREAD_CHANNEL_PROFILE = Object.freeze({
  codec: identityCodecV1.id,
  capabilities: Object.freeze([RpcCapability.stream, RpcCapability.batch]),
  pipeline: Object.freeze({ codec: identityCodecV1, framer: messageFramerV1 })
})

/** Private bootstrap records are consumed before core owns the message listener. */
export const ThreadBootstrap = {
  data: 'migaia.thread.data',
  acknowledged: 'migaia.thread.data.ack'
} as const

/** Native lifecycle event names belong to launcher adapters, never RPC transport policy. */
export const ThreadEvent = {
  message: 'message',
  error: 'error',
  exit: 'exit',
  close: 'close'
} as const

/** Launch identity is adapter-owned and monotonic even when runtime IDs are recycled. */
export const THREAD_FINGERPRINT_PREFIX = 'rpc-thread-'

/** Native Node heap-limit identity selects supervision's resource-violation classification. */
export const THREAD_HEAP_ERROR_CODE = 'ERR_WORKER_OUT_OF_MEMORY'
