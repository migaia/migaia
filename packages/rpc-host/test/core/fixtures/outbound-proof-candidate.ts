import {
  RpcWireProfile,
  RpcWireJsonCodec,
  type IRpcEnvelope,
  type IRpcPortableValue
} from '@migaia/rpc-contract/protocol'
import type { IRpcCodecContext } from '@migaia/rpc-contract/interfaces'

/** Both real media projections use the same explicit non-native codec storage policy. */
export const codecContext: IRpcCodecContext = {
  codec: RpcWireJsonCodec,
  nativeBinary: false,
  maxFrameBytes: 1024 * 1024
}

/** Produces a first-user graph with bytes, negative zero, Unicode order and safe own prototype data. */
export function request(): Extract<IRpcEnvelope, { kind: 'call' }> {
  /** JSON parsing creates **proto** as an own data field, not a setter invocation. */
  const payload = JSON.parse('{"z":1,"__proto__":{"value":2},"é":"ok"}') as Record<
    string,
    IRpcPortableValue
  >
  payload.zero = -0
  payload.bytes = new Uint8Array([0, 255])
  return {
    profile: RpcWireProfile,
    kind: 'call',
    id: 'task',
    route: {
      applicationVersion: '1',
      senderId: 'a',
      receiverId: 'b',
      targetId: 'b',
      sentAt: 0
    },
    task: {
      mode: 'request',
      callerId: 'a',
      callerGeneration: { kind: 'session', value: 1, providerId: 'a' },
      targetGeneration: { kind: 'session', value: 1, providerId: 'b' },
      method: 'echo'
    },
    options: {},
    payload
  }
}
