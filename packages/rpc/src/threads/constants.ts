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
  acknowledged: 'migaia.thread.data.ack',
  /** Independent runtime ACK carries the child's actual offer rather than endpoint readiness. */
  runtimeAcknowledged: 'migaia.thread.runtime.ack'
} as const

/** Native lifecycle event names belong to launcher adapters, never RPC transport policy. */
export const ThreadEvent = {
  message: 'message',
  /** Native deserialization failure retires an incomplete private bootstrap. */
  messageerror: 'messageerror',
  error: 'error',
  exit: 'exit',
  close: 'close'
} as const

/** Launch identity is adapter-owned and monotonic even when runtime IDs are recycled. */
export const THREAD_FINGERPRINT_PREFIX = 'rpc-thread-'

/** Native Node heap-limit identity selects supervision's resource-violation classification. */
export const THREAD_HEAP_ERROR_CODE = 'ERR_WORKER_OUT_OF_MEMORY'

/** Private runtime bootstrap and capability ACK use the same independently validated version. */
export const THREAD_RUNTIME_API_VERSION = 1

/** A dedicated Worker without the launcher's private bootstrap must not retain capture forever. */
export const THREAD_RUNTIME_API_BOOTSTRAP_TIMEOUT_MS = 10_000
