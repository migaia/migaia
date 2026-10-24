import { createRuntimeEndpointComposition } from '../../../rpc-host/dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { isRpcErrorInstance } from '@migaia/rpc-host'
import { connect } from '../../../rpc-host/dist/core/middleware/connect.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import * as kit from '@migaia/rpc-host/plugin'
import type { IRpcTransport } from '@migaia/rpc-host/plugin'

/** Browser adapter source location for the import boundary oracle. */
const adapters = join(import.meta.dirname, '../../../rpc-plugin-browser/src/browser/adapters')

/** One test-side transport owns its subscription set and the actual opposite endpoint listeners. */
class LoopbackSide implements IRpcTransport {
  /** Original local subscribers retain their own removable callback identity. */
  readonly #incoming: Set<(message: { data: unknown }) => void>
  /** The opposite endpoint's original listener set receives unchanged fixture payloads. */
  readonly #outgoing: Set<(message: { data: unknown }) => void>
  readonly platform = kit.RpcPlatform.memory
  readonly ownership = kit.RpcTransportOwnership.borrowed
  readonly topology = 'exclusive' as const
  /** The pair owns both listener sets; each side borrows only the actual opposite reference. */
  constructor(
    incoming: Set<(message: { data: unknown }) => void>,
    outgoing: Set<(message: { data: unknown }) => void>
  ) {
    this.#incoming = incoming
    this.#outgoing = outgoing
  }
  /** Native microtask delivery preserves the prior asynchronous loopback behavior. */
  send(message: unknown): void {
    queueMicrotask(() => {
      for (const listener of this.#outgoing) listener({ data: message })
    })
  }
  /** Return the original listener's independent removal receipt. */
  subscribe(listener: (message: { data: unknown }) => void): () => void {
    this.#incoming.add(listener)
    return () => {
      this.#incoming.delete(listener)
    }
  }
}

/** Two actual sides share only their explicitly owned local subscription sets. */
function loopback(): readonly [IRpcTransport, IRpcTransport] {
  /** First receiver listener ownership remains distinct from the second. */
  const a = new Set<(message: { data: unknown }) => void>()
  /** Second receiver listener ownership survives unsubscribing the first. */
  const b = new Set<(message: { data: unknown }) => void>()
  return [new LoopbackSide(a, b), new LoopbackSide(b, a)]
}

describe('public transport kit', () => {
  it('keeps browser adapters on the public plugin-author boundary', () => {
    for (const name of readdirSync(adapters).filter((name) => name.endsWith('.ts'))) {
      const path = join(adapters, name)
      for (const statement of parseSync(path, readFileSync(path, 'utf8')).program.body) {
        if (statement.type !== 'ImportDeclaration') continue
        const specifier = statement.source.value
        if (!specifier.startsWith('.')) {
          expect(specifier, path).toMatch(/^@migaia\/(?:utils(?:\/|$)|rpc-host(?:\/plugin)?$)/u)
          continue
        }
        // probe-detail is the package-owned carrier observation helper; it reaches Core only
        // through the public plugin-author boundary.
        expect(specifier, path).toMatch(
          /^(?:\.\.\/error(?:-text)?|\.\.\/probe-detail|\.\/shared-worker)\.js$/u
        )
      }
    }
  })

  it('runs request/response and preserves a tagged native send failure as the cause', async () => {
    const [clientTransport, serverTransport] = loopback()
    const server = await createRuntimeEndpointComposition(
      {
        id: 'server',
        transport: serverTransport,
        provider: { echo: (context) => context.success(context.data) },
        middlewares: [connect({ transport: serverTransport })]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    await expect(client.send('server', 'echo', { value: 1 })).resolves.toEqual({ value: 1 })
    await client.dispose()
    await server.dispose()

    /** This carrier owns its failure identity; Core wraps the exact native cause. */
    const original = attachErrorIdentity(new TypeError('adapter send failed'), {
      source: '@example/carrier',
      code: 'SEND_FAILED'
    })
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
    const sender = await createRuntimeEndpointComposition(
      {
        id: 'sender',
        transport: failing,
        middlewares: [connect({ transport: failing })]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    try {
      await sender.send('server', 'echo', null)
      expect.fail('send should reject')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(isRpcErrorInstance(error)).toBe(true)
      expect((error as Error).name).toBe('RpcTransportError')
      expect(error).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
      expect((error as Error & { cause: unknown }).cause).toBe(original)
      expect(original).toBeInstanceOf(TypeError)
      expect(original).toMatchObject({ source: '@example/carrier', code: 'SEND_FAILED' })
    }
    await sender.dispose()
  })
})
