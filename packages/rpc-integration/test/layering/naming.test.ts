import { describe, expect, it } from 'vitest'
import * as core from '@migaia/rpc-host'
import * as contract from '@migaia/rpc-host/contract'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deserializeRpcError, serializeRpcError } from '@migaia/rpc-contract'

/** The Host root retains only Host-owned symbols after BC30's contract-entry migration. */
const surface = core as Record<string, unknown>
/** Contract diagnostics retain their runtime-facing names at the dedicated public entry. */
const contractSurface = contract as Record<string, unknown>

describe('Rpc naming boundary', () => {
  it('publishes Rpc names and wire names without WebRpc aliases', () => {
    for (const name of [
      'RpcLifecycleError',
      'isRpcError',
      'isRpcErrorInstance',
      'isRpcRemoteError',
      'isRpcTimeoutError',
      'RPC_CORE_ERROR_SOURCE'
    ]) {
      expect(contractSurface[name], name).toBeDefined()
      expect(surface[name], name).toBeUndefined()
    }
    for (const name of [...Object.keys(surface), ...Object.keys(contractSurface)]) {
      expect(name).not.toMatch(/^(?:WebRpc|WEBRPC|isWebRpc|tagWebRpc)/u)
    }
    for (const name of [
      'RpcCoreErrorCode',
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
    const lifecycle = new contract.RpcLifecycleError('consumer disposed')
    expect(lifecycle).toBeInstanceOf(Error)
    expect(lifecycle.name).toBe('RpcLifecycleError')
    expect(contract.isRpcErrorInstance(lifecycle)).toBe(true)
    expect(serializeRpcError(lifecycle, { report: () => {} })).toMatchObject({
      name: 'RpcLifecycleError',
      source: contract.RPC_CORE_ERROR_SOURCE,
      code: RpcCoreErrorCode.endpointDisposed
    })
    const abort = new DOMException('aborted', 'AbortError')
    const restored = deserializeRpcError(serializeRpcError(abort, { report: () => {} }))
    expect(restored).toBeInstanceOf(DOMException)
    expect(restored.name).toBe('AbortError')
  })
})
