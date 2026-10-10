import { existsSync } from 'node:fs'
import { normalizeRpcEnvelope, RpcRouteProfile } from '../../../src/contract/index.js'

/**
 * Selects the existing baseline owner before the candidate exists; import failures never count as
 * red.
 */
export async function outboundFactory(): Promise<
  (value: unknown) => ReturnType<typeof normalizeRpcEnvelope>
> {
  if (!existsSync(new URL('../../../src/core/internal/outbound-envelope.ts', import.meta.url)))
    return normalizeRpcEnvelope
  /** Explicit ESM suffix resolves the package-private candidate without publishing a public brand. */
  const path = '../../../src/core/internal/outbound-envelope.js'
  return (await import(path)).createOutboundEnvelope
}

/** Produces a first-user graph with bytes, negative zero, Unicode order and safe own prototype data. */
export function request() {
  /** JSON parsing creates **proto** as an own data field, not a setter invocation. */
  const payload = JSON.parse('{"z":1,"__proto__":{"value":2},"é":"ok"}') as Record<string, unknown>
  payload.zero = -0
  payload.bytes = new Uint8Array([0, 255])
  return {
    kind: 'request',
    id: 'task',
    method: 'echo',
    data: {
      route: {
        profile: RpcRouteProfile,
        type: 'request',
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        sentAt: 0
      },
      payload
    }
  }
}
