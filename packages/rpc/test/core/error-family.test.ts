import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  RpcCoreErrorCode,
  RpcError,
  RpcRemoteError,
  RpcTimeoutError,
  RPC_CORE_ERROR_SOURCE
} from '../../src/core/index.js'
import { isRpcErrorInstance, isRpcRemoteError, isRpcTimeoutError } from '../../src/core/spi.js'

/** A real independent realm supplies native Error objects rather than local class instances. */
function foreignError(name: string, code: string, source = RPC_CORE_ERROR_SOURCE): unknown {
  return runInNewContext('Object.assign(new Error("foreign failure"), { name, code, source })', {
    name,
    code,
    source
  })
}

describe('B6 coded error families', () => {
  it('retains local native families and their original instances', () => {
    /** Caller-owned failure objects remain untouched by classification. */
    const core = new RpcError(RpcCoreErrorCode.invalidConfig, 'fixture configuration')
    /** Remote codes retain the remote party code domain. */
    const remote = new RpcRemoteError('FIXTURE_REMOTE', 'fixture remote')
    /** Deadline classification retains the standard native family. */
    const timeout = new RpcTimeoutError()
    expect(isRpcErrorInstance(core)).toBe(true)
    expect(isRpcErrorInstance(timeout)).toBe(true)
    expect(isRpcRemoteError(remote)).toBe(true)
    expect(isRpcTimeoutError(timeout)).toBe(true)
    expect(isRpcErrorInstance(remote)).toBe(false)
    expect(isRpcRemoteError(core)).toBe(false)
    expect(isRpcTimeoutError(core)).toBe(false)
  })

  it('recognizes coded equivalent errors from an independent realm', () => {
    /** Foreign prototypes cannot satisfy any local Core instanceof check. */
    const core = foreignError('RpcError', RpcCoreErrorCode.invalidConfig)
    /** Remote wire codes need no entry in the local Core code enumeration. */
    const remote = foreignError('RpcRemoteError', 'FIXTURE_REMOTE')
    /** Timeout uses the exact original name, source and deadline code. */
    const timeout = foreignError('TimeoutError', RpcCoreErrorCode.deadlineExceeded)
    expect(core instanceof RpcError).toBe(false)
    expect(remote instanceof RpcRemoteError).toBe(false)
    expect(timeout instanceof RpcTimeoutError).toBe(false)
    expect(isRpcErrorInstance(core)).toBe(true)
    expect(isRpcRemoteError(remote)).toBe(true)
    expect(isRpcTimeoutError(timeout)).toBe(true)
  })

  it('does not classify unrelated names, sources or codes as these families', () => {
    expect(isRpcErrorInstance(foreignError('Error', RpcCoreErrorCode.invalidConfig))).toBe(false)
    expect(isRpcErrorInstance(foreignError('RpcError', 'FIXTURE_REMOTE'))).toBe(false)
    expect(isRpcRemoteError(foreignError('RpcRemoteError', 'FIXTURE_REMOTE', 'fixture'))).toBe(
      false
    )
    expect(isRpcTimeoutError(foreignError('TimeoutError', RpcCoreErrorCode.invalidConfig))).toBe(
      false
    )
    expect(
      isRpcTimeoutError(foreignError('TimeoutError', RpcCoreErrorCode.deadlineExceeded, 'fixture'))
    ).toBe(false)
  })
})
