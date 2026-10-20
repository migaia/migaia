import { describe, expect, it } from 'vitest'
import * as core from '@migaia/rpc-core'
import { deserializeRpcError, serializeRpcError } from '@migaia/rpc-contract'

/** Runtime-facing symbol table, including exports whose names changed in the layering rename. */
const surface = core as Record<string, unknown>

describe('Rpc naming boundary', () => {
  it('publishes Rpc names and wire names without WebRpc aliases', () => {
    for (const name of [
      'RpcLifecycleError',
      'isRpcError',
      'isRpcErrorInstance',
      'isRpcRemoteError',
      'isRpcTimeoutError',
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
      'isWebRpcError',
      'tagRpcError',
      'RpcError',
      'RpcSchemaValidationError',
      'RpcConfigurationError',
      'RpcConstructionError',
      'RpcSerializationError',
      'RpcProtocolError',
      'RpcContractError',
      'RpcTransportError',
      'RpcAuthenticationError',
      'RpcChunkError',
      'RpcRemoteError',
      'RpcAbortError',
      'RpcTimeoutError'
    ]) {
      expect(surface[name], name).toBeUndefined()
    }
    /** Store Worker owns its disposal state and constructs only a lifecycle diagnostic. */
    const lifecycle = new core.RpcLifecycleError('consumer disposed')
    expect(lifecycle).toBeInstanceOf(Error)
    expect(lifecycle.name).toBe('RpcLifecycleError')
    expect(core.isRpcErrorInstance(lifecycle)).toBe(true)
    expect(serializeRpcError(lifecycle, { report: () => {} })).toMatchObject({
      name: 'RpcLifecycleError',
      source: core.RPC_CORE_ERROR_SOURCE,
      code: core.RpcCoreErrorCode.endpointDisposed
    })
    const abort = new DOMException('aborted', 'AbortError')
    const restored = deserializeRpcError(serializeRpcError(abort, { report: () => {} }))
    expect(restored).toBeInstanceOf(DOMException)
    expect(restored.name).toBe('AbortError')
  })
})
