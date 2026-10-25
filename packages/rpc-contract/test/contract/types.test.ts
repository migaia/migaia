import { describe, expect, it } from 'vitest'
import {
  RpcWireProfile,
  RpcWireVersion,
  normalizeRpcFrame,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { header } from '../fixtures/core-profile.js'

describe('rpc-contract declarations', () => {
  it('preserves sole-profile literals and exhaustive semantic frame narrowing', () => {
    const id: 'migaia.rpc/2' = RpcWireProfile
    const major: 2 = RpcWireVersion.major
    // @ts-expect-error The old profile literal is no longer the sole protocol identity.
    const legacyId: 'migaia.rpc' = RpcWireProfile
    // @ts-expect-error The protocol major is not assignable to its retired generation.
    const legacyVersion: 1 = RpcWireVersion.major
    void legacyId
    void legacyVersion
    expect([id, major]).toEqual(['migaia.rpc/2', 2])
    const envelope = normalizeRpcFrame({ ...header(), kind: 'result', result: 1 })
    const exhaustive = (value: never): never => value
    const narrowed = (value: IRpcSemanticFrame): string => {
      switch (value.kind) {
        case 'handshake':
          return value.step
        case 'call':
          return value.task.method!
        case 'group':
        case 'result':
        case 'error':
        case 'cancel':
        case 'stream':
        case 'outcome':
        case 'control':
        case 'directory':
          return value.id
        default:
          return exhaustive(value)
      }
    }
    expect(narrowed(envelope)).toBe('call-1')
    if (envelope.kind === 'result') {
      // @ts-expect-error A successful result cannot expose the failed terminal's error graph.
      const error: string = envelope.error
      expect(error).toBeUndefined()
    }
  })
})
