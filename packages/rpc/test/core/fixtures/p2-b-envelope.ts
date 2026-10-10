import { normalizeRpcEnvelope, type IRpcEnvelope } from '../../../src/contract/index.js'

/** Valid fixtures preserve the ordinary semantic contract independently of physical grouping. */
export function envelope(
  id: string,
  kind: 'request' | 'response' = 'request',
  payload: unknown = id
): IRpcEnvelope {
  return normalizeRpcEnvelope({
    kind,
    id,
    ...(kind === 'request' ? { method: 'echo' } : { ok: true }),
    data: {
      route: {
        profile: 'migaia.rpc.route',
        type: kind,
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        receiverId: 'b',
        sentAt: 0,
        ...(kind === 'response' ? { receiverId: 'b', method: 'echo' } : {})
      },
      payload
    }
  })
}
