import { describe, expect, it } from 'vitest'
import * as core from '../../src/core/index.js'
import { serializeRpcError } from '../../src/contract/index.js'

/** Runtime-facing symbol table, including exports whose names change in BC2. */
const surface = core as Record<string, unknown>

describe('Rpc naming boundary', () => {
  it('A3 publishes Rpc names and wire names without WebRpc aliases', () => {
    for (const name of [
      'RpcError',
      'RpcTransportError',
      'isRpcError',
      'RpcCoreErrorCode',
      'RPC_CORE_ERROR_SOURCE'
    ]) {
      expect(surface[name], name).toBeDefined()
    }
    for (const name of Object.keys(surface)) {
      expect(name).not.toMatch(/^(?:WebRpc|WEBRPC|isWebRpc|tagWebRpc)/u)
    }
    for (const name of [
      'WEBRPC_SOURCE',
      'WebRpcErrorCode',
      'WebRpcTransportError',
      'isWebRpcError'
    ]) {
      expect(surface[name], name).toBeUndefined()
    }
    const TransportError = surface.RpcTransportError as new (message: string) => Error
    const AbortError = surface.RpcAbortError as new () => Error
    const TimeoutError = surface.RpcTimeoutError as new () => Error
    const transport = new TransportError('transport failed')
    expect(transport.name).toBe('RpcTransportError')
    expect(new AbortError().name).toBe('AbortError')
    expect(new TimeoutError().name).toBe('TimeoutError')
    expect(serializeRpcError(transport, { report: () => {} })).toMatchObject({
      name: 'RpcTransportError',
      source: '@migaia/rpc/core'
    })
    const abort = new DOMException('aborted', 'AbortError')
    const serializeError = surface.serializeError as (error: unknown) => unknown
    const deserializeError = surface.deserializeError as (error: unknown) => unknown
    const restored = deserializeError(serializeError(abort)) as Error
    expect(restored).toBeInstanceOf(DOMException)
    expect(restored.name).toBe('AbortError')
  })
})
