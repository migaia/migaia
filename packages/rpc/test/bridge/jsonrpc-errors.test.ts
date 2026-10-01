import { describe, expect, it } from 'vitest'
import { deserializeRpcError, serializeRpcError } from '../../src/contract/error.js'
import { toJsonRpcError } from '../../src/contract/error-jsonrpc.js'
import { JsonRpcBridgeErrorCode } from '../../src/bridge/jsonrpc/error-code.js'
import { createJsonRpcBridgeError } from '../../src/bridge/jsonrpc/error.js'
import { bridgeFixture, request } from './fixture.js'

describe('JSON-RPC error graph', () => {
  it('[A7] preserves all wire error fields, cause/errors identity order and stack', async () => {
    const original = new AggregateError(
      [new Error('first child'), new TypeError('second child')],
      'aggregate root',
      { cause: new Error('middle cause', { cause: new Error('deep cause') }) }
    )
    Object.defineProperties(original, {
      source: { value: 'peer', enumerable: true },
      code: { value: 'PEER_FAILURE', enumerable: true }
    })
    const wire = serializeRpcError(original, { report: () => undefined })
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    const responses: Array<{ error: unknown }> = []
    channel.transport.subscribe((message) => responses.push(JSON.parse(message.data as string)))
    await channel.transport.send(JSON.stringify(request('graph')))
    fixture.deliver({ jsonrpc: '2.0', id: 'graph', error: toJsonRpcError(wire, -32000) })
    expect(responses[0]!.error).toEqual(wire)
    const restored = deserializeRpcError(responses[0]!.error)
    expect(restored).toMatchObject({
      name: 'AggregateError',
      source: 'peer',
      code: 'PEER_FAILURE',
      stack: original.stack,
      cause: { message: 'middle cause', cause: { message: 'deep cause' } }
    })
    expect((restored as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      'first child',
      'second child'
    ])
    await channel.close()
  })
  it.each([
    [{ code: -32601, message: 'not found' }, 'jsonrpc-2.0', '-32601', 0],
    [{ code: -32602, message: 'bad params' }, 'jsonrpc-2.0', '-32602', 0],
    [
      { code: -32000, message: 'business lacks extension' },
      '@migaia/rpc/bridge/jsonrpc',
      'JSONRPC_EXTENSION_MISSING',
      1
    ],
    [
      {
        code: -32000,
        message: 'invalid extension',
        data: {
          migaiaWireError: { source: 'peer', code: 'FAIL', name: 'Error', message: 'missing stack' }
        }
      },
      '@migaia/rpc/bridge/jsonrpc',
      'JSONRPC_PROFILE_INVALID',
      1
    ]
  ] as const)(
    '[A7] isolates correlated error %# and allows the next request',
    async (error, source, code, reports) => {
      const fixture = bridgeFixture()
      const channel = await fixture.open()
      const responses: Array<{
        error?: { source: string; code: string; cause?: { code: string } }
        data: unknown
      }> = []
      channel.transport.subscribe((message) => responses.push(JSON.parse(message.data as string)))
      await channel.transport.send(JSON.stringify(request('failure')))
      fixture.deliver({ jsonrpc: '2.0', id: 'failure', error })
      expect(responses[0]!.error).toMatchObject({ source, code })
      if (reports)
        expect(responses[0]!.error?.cause?.code).toBe(
          code === 'JSONRPC_PROFILE_INVALID' ? 'INVALID_WIRE_ERROR' : '-32000'
        )
      expect(fixture.reports).toHaveLength(reports)
      await channel.transport.send(JSON.stringify(request('next')))
      fixture.deliver({ jsonrpc: '2.0', id: 'next', result: 'next result' })
      expect(responses[1]!.data).toMatchObject({ payload: 'next result' })
      expect(fixture.closes).toBe(0)
      await channel.close()
    }
  )
  it('[A7] gives all five codes one dedicated source and preserves native types', () => {
    expect(Object.values(JsonRpcBridgeErrorCode)).toHaveLength(5)
    for (const code of Object.values(JsonRpcBridgeErrorCode)) {
      const error = createJsonRpcBridgeError(code)
      expect(error).toMatchObject({ source: '@migaia/rpc/bridge/jsonrpc', code })
      expect(error.stack).toBeTruthy()
    }
    expect(createJsonRpcBridgeError(JsonRpcBridgeErrorCode.unsupportedMode)).toBeInstanceOf(
      TypeError
    )
    expect(
      createJsonRpcBridgeError(JsonRpcBridgeErrorCode.profileInvalid, undefined, true)
    ).toBeInstanceOf(TypeError)
  })
  it('[A7] closes raw once under concurrent close', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    await Promise.all([channel.close(), channel.close(), channel.close()])
    expect(fixture.closes).toBe(1)
    expect(fixture.removals).toBe(2)
  })
  it('[A7] retains write, cleanup and reporter failures without replacing the primary', async () => {
    const fixture = bridgeFixture()
    const writeFailure = new Error('physical writer failed')
    const cleanupFailure = new Error('raw cleanup failed')
    const reporterFailure = new Error('reporter failed')
    let failWrite = false
    const channel = await fixture.open({
      report: () => {
        throw reporterFailure
      },
      byte: {
        ...fixture.raw,
        write: (chunk) => (failWrite ? Promise.reject(writeFailure) : fixture.raw.write(chunk)),
        close: () => {
          fixture.raw.close()
          throw cleanupFailure
        }
      }
    })
    failWrite = true
    await expect(
      channel.transport.send(JSON.stringify(request('write-failure')))
    ).rejects.toMatchObject({
      code: 'PROCESS_CHANNEL_CLOSED',
      cause: writeFailure
    })
    let collected: unknown
    try {
      await channel.close()
    } catch (error) {
      collected = error
    }
    expect(collected).toBeInstanceOf(AggregateError)
    /** Follow only contract graph edges and compare original objects, avoiding message evidence. */
    const nodes: unknown[] = []
    const visit = (error: unknown): void => {
      if (nodes.includes(error)) return
      nodes.push(error)
      if (error instanceof Error && error.cause !== undefined) visit(error.cause)
      if (error instanceof AggregateError) for (const child of error.errors) visit(child)
    }
    visit(collected)
    expect(nodes).toEqual(expect.arrayContaining([writeFailure, cleanupFailure, reporterFailure]))
    expect((collected as AggregateError).errors[0]).toMatchObject({
      code: 'PROCESS_CHANNEL_CLOSED',
      cause: writeFailure
    })
    expect(fixture.closes).toBe(1)
  })
})
