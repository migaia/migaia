import { describe, expect, it } from 'vitest'
import { createDescriptor, serializeRpcError } from '../../src/contract/index.js'
import { ERROR_SOURCE as contractSource } from '../../src/contract/error-code.js'
import { createEndpoint, RpcError } from '../../src/core/index.js'
import { ERROR_SOURCE as coreSource } from '../../src/core/error-code.js'
import { createWindowMessageTransport } from '../../src/browser/adapters/window.js'

describe('A4 source continuity through merged layers', () => {
  it('tags contract descriptor failure with contract source and original native type', () => {
    let caught: unknown
    try {
      createDescriptor('Bad', 1)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(TypeError)
    expect(caught).toMatchObject({ source: contractSource, code: 'INVALID_DESCRIPTOR' })
    expect(contractSource).toBe('@migaia/rpc/contract')
  })

  it('tags core invalid configuration and preserves serialized source', async () => {
    let caught: unknown
    try {
      await createEndpoint({ id: '', middlewares: [] } as never)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(RpcError)
    expect(caught).toMatchObject({ source: coreSource, code: 'INVALID_CONFIG' })
    expect(coreSource).toBe('@migaia/rpc/core')
    expect(serializeRpcError(caught as Error).source).toBe(coreSource)
  })

  it('tags browser adapter configuration failure with core source', () => {
    const target = { postMessage() {} }
    const receiver = { addEventListener() {}, removeEventListener() {} }
    let caught: unknown
    try {
      createWindowMessageTransport({ target, receiver, targetOrigin: '' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(RpcError)
    expect(caught).toMatchObject({ source: coreSource, code: 'INVALID_CONFIG' })
  })
})
