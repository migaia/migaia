import { describe, expect, it } from 'vitest'
import { createDescriptor, rpcProtocolV1 } from '../src/index.js'
import type { IRpcEnvelope } from '../src/index.js'
import * as rpcV1 from '../src/v1/index.js'
import type { IRpcEnvelope as IRpcV1Envelope } from '../src/v1/index.js'

describe('rpc-contract declarations', () => {
  it('preserves descriptor literals and exhaustive envelope narrowing', () => {
    const descriptor = createDescriptor('test.protocol', 7)
    const id: 'test.protocol' = descriptor.id
    const version: 7 = descriptor.version
    expect(() => {
      // @ts-expect-error descriptor identity is immutable after construction.
      descriptor.id = 'changed'
    }).toThrow(TypeError)
    expect([id, version]).toEqual(['test.protocol', 7])
    expect(rpcProtocolV1).toBe(rpcV1.rpcProtocol)
    const v1Id: 'migaia.rpc' = rpcV1.rpcProtocol.id
    // @ts-expect-error V1 descriptor identity is not a different literal.
    const v2Id: 'migaia.rpc.v2' = rpcV1.rpcProtocol.id
    const v1Version: 1 = rpcV1.rpcProtocol.version
    // @ts-expect-error V1 descriptor version is not assignable to version 2.
    const v2Version: 2 = rpcV1.rpcProtocol.version
    void v2Id
    void v2Version
    expect(v1Id).toBe('migaia.rpc')
    expect(v1Version).toBe(1)

    const envelope = rpcProtocolV1.normalize({
      kind: 'response',
      ok: true,
      id: '1',
      data: null
    })
    const exhaustive = (value: never): never => value
    const narrowed = (value: IRpcEnvelope): string => {
      if (value.kind === 'response') return value.ok ? value.id : value.code
      if (value.kind === 'request') return value.method
      if (value.kind === 'discovery') return value.version
      if (value.kind === 'variation') return value.id
      return exhaustive(value)
    }
    expect(narrowed(envelope)).toBe('1')
    const v1Envelope: IRpcV1Envelope = envelope
    expect(narrowed(v1Envelope)).toBe('1')

    if (envelope.kind === 'response' && envelope.ok) {
      // @ts-expect-error response-success cannot expose failure-only code.
      const code: string = envelope.code
      expect(code).toBeUndefined()
    }
  })
})
