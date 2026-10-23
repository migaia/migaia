import * as contract from '@migaia/rpc-contract'
import type { IRuntimeByteDiagnostics } from '../../dist/adapter/internal-advanced.js'
/** Core owns these generic byte-adapter failure identities. */
export const diagnostics: IRuntimeByteDiagnostics = {
  closed: { source: 'rpc.endpoint', code: 'TRANSPORT', message: 'audit byte closed' },
  timeout: {
    source: 'rpc.endpoint',
    code: 'DEADLINE_EXCEEDED',
    message: 'audit handshake timeout'
  },
  authenticationRejected: {
    source: 'rpc.endpoint',
    code: 'AUTHENTICATION_FAILED',
    message: 'audit authentication rejected'
  },
  duplicateBinding: 'audit duplicate reader',
  optionsInvalid: 'audit invalid options',
  jsonCodecRequired: 'audit JSON required',
  negotiatedCodecUnsupported: 'audit unsupported codec',
  handshakeTimeoutInvalid: 'audit invalid timeout'
}
/** A complete supported byte port delivers the original bytes and owns its actual close callbacks. */
export function duplex() {
  /** Each side has one physical stream and an independent release counter. */
  const states = [0, 1].map(() => ({
    data: new Set<(bytes: Uint8Array) => void>(),
    close: new Set<(reason?: unknown) => void>(),
    queued: [] as Uint8Array[],
    closed: false,
    closes: 0
  }))
  /** Writes remain ordered and retain bytes until the opposite side installs its reader. */
  const ports = states.map((state, index) => ({
    kind: 'byte' as const,
    async write(bytes: Uint8Array) {
      const other = states[1 - index]!
      other.queued.push(bytes.slice())
      await Promise.resolve()
      if (other.data.size)
        for (const bytes of other.queued.splice(0))
          for (const listener of other.data) listener(bytes)
    },
    onData(listener: (bytes: Uint8Array) => void) {
      state.data.add(listener)
      queueMicrotask(() => {
        if (state.data.has(listener)) for (const bytes of state.queued.splice(0)) listener(bytes)
      })
      return () => {
        state.data.delete(listener)
      }
    },
    onClose(listener: (reason?: unknown) => void) {
      state.close.add(listener)
      return () => {
        state.close.delete(listener)
      }
    },
    close() {
      if (state.closed) return
      state.closes++
      state.closed = true
      for (const listener of state.close) listener()
    }
  }))
  return {
    states,
    ports,
    close() {
      for (const port of ports) port.close()
    }
  }
}
/** Both control offers are genuine independently submitted public handshake configurations. */
export const offer = (id: string) => ({
  versions: [{ major: contract.RpcProtocol.major, minor: contract.RpcProtocol.minor }],
  codecs: [contract.RpcCodecId.json],
  capabilities: [contract.RpcCapability.runtimeApi, contract.RpcCapability.batch],
  peer: { id, runtime: 'node' as const }
})
/** No timing or synthetic marker establishes a connection; both sides exchange real control frames. */
export const connectionOptions = (
  id: string,
  peerId: string,
  report = (_error: unknown) => {}
) => ({
  platform: 'Process' as const,
  expectedStringText: 'audit expected string',
  peerId,
  report,
  offer: offer(id),
  ipc: { connectionId: id, sessionId: id, log: () => {} }
})
/** Check the actual cause/errors graph without reading or printing its message or credentials. */
export function reaches(value: unknown, target: unknown, seen = new Set<unknown>()): boolean {
  if (value === target) return true
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const error = value as { cause?: unknown; errors?: unknown[] }
  return (
    reaches(error.cause, target, seen) ||
    (Array.isArray(error.errors) && error.errors.some((child) => reaches(child, target, seen)))
  )
}
