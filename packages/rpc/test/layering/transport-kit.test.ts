import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createEndpoint, RpcCoreErrorCode, RpcTransportError } from '../../src/core/index.js'
import { connect } from '../../src/core/middleware/connect.js'
import * as kit from '@migaia/rpc/core/transport-kit'
import type { IRpcTransport } from '@migaia/rpc/core/transport-kit'

/** Only the adapter primitives declared by the transport-kit contract are public. */
const runtimeExports = [
  'RpcPlatform',
  'RpcTransportOwnership',
  'tagRpcError',
  'collectListenerCleanupFailures',
  'collectListenerFailure',
  'createListenerFailure',
  'createListenerFailureState',
  'drainListenerFailures',
  'drainTerminalListenerFailures',
  'observeListener',
  'registerListeners',
  'releaseListenerRegistration',
  'reportListenerFailure',
  'createMessageListenerHub',
  'safeRead',
  'safeString'
].sort()

/** Browser adapter source location for the import boundary oracle. */
const adapters = join(import.meta.dirname, '../../src/browser/adapters')

/** Creates the smallest asynchronous in-memory transport using public adapter primitives. */
function loopback(): readonly [IRpcTransport, IRpcTransport] {
  const a = new Set<(message: { data: unknown }) => void>()
  const b = new Set<(message: { data: unknown }) => void>()
  const side = (
    incoming: Set<(message: { data: unknown }) => void>,
    outgoing: Set<(message: { data: unknown }) => void>
  ): IRpcTransport => ({
    platform: kit.RpcPlatform.memory,
    ownership: kit.RpcTransportOwnership.borrowed,
    topology: 'exclusive',
    send(message) {
      queueMicrotask(() => {
        for (const listener of outgoing) listener({ data: message })
      })
    },
    subscribe(listener) {
      incoming.add(listener)
      return () => {
        incoming.delete(listener)
      }
    }
  })
  return [side(a, b), side(b, a)]
}

describe('public transport kit', () => {
  it('A5 exports exactly the adapter primitives and keeps browser adapters on the public boundary', () => {
    expect(Object.keys(kit).sort()).toEqual(runtimeExports)
    for (const name of readdirSync(adapters).filter((name) => name.endsWith('.ts'))) {
      const path = join(adapters, name)
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        const specifier = (statement.moduleSpecifier as ts.StringLiteral).text
        if (!specifier.startsWith('.')) {
          expect(specifier, path).toMatch(/^@migaia\/utils\//u)
          continue
        }
        expect(specifier, path).toMatch(
          /^(\.\.\/\.\.\/core\/(transport-kit|errors)|\.\.\/error-text)\.js$/u
        )
      }
    }
  })

  it('A5 runs request/response and preserves a tagged native send failure as the cause', async () => {
    const [clientTransport, serverTransport] = loopback()
    const server = await createEndpoint({
      id: 'server',
      transport: serverTransport,
      provider: { echo: (context) => context.success(context.data) },
      middlewares: [connect({ transport: serverTransport })]
    })
    const client = await createEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    })
    await expect(client.send('server', 'echo', { value: 1 })).resolves.toEqual({ value: 1 })
    await client.dispose()
    await server.dispose()

    const original = kit.tagRpcError(
      new TypeError('adapter send failed'),
      RpcCoreErrorCode.transport
    )
    const failing: IRpcTransport = {
      platform: kit.RpcPlatform.memory,
      ownership: kit.RpcTransportOwnership.borrowed,
      topology: 'exclusive',
      send() {
        throw original
      },
      subscribe() {
        return () => undefined
      }
    }
    const sender = await createEndpoint({
      id: 'sender',
      transport: failing,
      middlewares: [connect({ transport: failing })]
    })
    try {
      await sender.send('server', 'echo', null)
      expect.fail('send should reject')
    } catch (error) {
      expect(error).toBeInstanceOf(RpcTransportError)
      expect(error).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT' })
      expect((error as Error & { cause: unknown }).cause).toBe(original)
      expect(original).toBeInstanceOf(TypeError)
      expect(original).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT' })
    }
    await sender.dispose()
  })
})
