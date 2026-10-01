import { inspect } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { acceptRpcHandshake, completeRpcHandshake } from '../../src/contract/handshake.js'
import * as control from '../../src/contract/handshake.js'
import { serializeRpcError } from '../../src/contract/error.js'
import {
  BRIDGE_CONTRACT,
  BRIDGE_METHODS,
  BRIDGE_PEER_OFFER,
  bridgeFixture,
  flush
} from './fixture.js'

describe('JSON-RPC bridge readiness', () => {
  it('[A4] completes control negotiation with diagnostic peer identity and no native capabilities', async () => {
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    expect(channel.agreement).toEqual({
      source: 'negotiated',
      codec: 'json',
      capabilities: ['jsonrpc-bridge@1', 'abort@1', 'wire-error@1', 'deadline@1', 'trace@1']
    })
    expect(channel.peerId).toBe('peer')
    expect(channel.scheduler).toBe(fixture.scheduler)
    expect(channel.features).toHaveLength(2)
    expect(inspect(channel, { depth: null })).not.toContain(fixture.options.token)
    await channel.close()
    expect(fixture.closes).toBe(1)
  })
  it.each(['ping@1', 'close@1', 'stream@1'])(
    '[A4] refuses unsupported capability %s before bytes',
    async (capability) => {
      const fixture = bridgeFixture()
      await expect(
        fixture.open({ offer: { ...fixture.options.offer, capabilities: [capability] } })
      ).rejects.toMatchObject({ code: 'JSONRPC_PROFILE_INVALID' })
      expect(fixture.writes).toEqual([])
    }
  )
  it.each(['', undefined])('[A4] refuses missing/empty token before bytes', async (token) => {
    const fixture = bridgeFixture()
    await expect(fixture.open({ token: token as string })).rejects.toMatchObject({
      code: 'JSONRPC_PROFILE_INVALID'
    })
    expect(fixture.writes).toEqual([])
  })
  it('[A3] refuses local streams and ambiguous target before bytes', async () => {
    const fixture = bridgeFixture()
    const streaming = {
      ...BRIDGE_CONTRACT,
      features: { f: { methods: { generator: { mode: 'generator' as const, idempotent: false } } } }
    }
    for (const target of [
      { kind: 'plugin', contract: streaming },
      { kind: 'host', catalog: { p: streaming } }
    ] as const)
      await expect(fixture.open({ target })).rejects.toMatchObject({
        code: 'JSONRPC_UNSUPPORTED_MODE'
      })
    await expect(
      fixture.open({
        target: {
          kind: 'plugin',
          contract: BRIDGE_CONTRACT,
          catalog: { p: BRIDGE_CONTRACT }
        } as never
      })
    ).rejects.toBeInstanceOf(TypeError)
    expect(fixture.writes).toEqual([])
  })
  it.each(BRIDGE_METHODS)('[A3] rejects missing method %s and closes once', async (missing) => {
    const fixture = bridgeFixture({
      responder(message) {
        const answer = acceptRpcHandshake(
          BRIDGE_PEER_OFFER,
          (message.params as { hello: string }).hello
        )
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            reply: answer.reply,
            methods: BRIDGE_METHODS.filter((method) => method !== missing)
          }
        }
      }
    })
    await expect(fixture.open()).rejects.toMatchObject({ code: 'JSONRPC_EXTENSION_MISSING' })
    expect(fixture.closes).toBe(1)
    expect(fixture.messages).toHaveLength(1)
  })
  it.each(['jsonrpc-bridge@1', 'abort@1', 'wire-error@1'])(
    '[A3] rejects absent capability %s after otherwise valid control accept',
    async (missing) => {
      const fixture = bridgeFixture({
        responder(message) {
          const answer = acceptRpcHandshake(
            {
              ...BRIDGE_PEER_OFFER,
              capabilities: BRIDGE_PEER_OFFER.capabilities.filter(
                (capability) => capability !== missing
              )
            },
            (message.params as { hello: string }).hello
          )
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: { reply: answer.reply, methods: BRIDGE_METHODS }
          }
        }
      })
      await expect(fixture.open()).rejects.toMatchObject({ code: 'JSONRPC_EXTENSION_MISSING' })
      expect(fixture.closes).toBe(1)
    }
  )
  it.each([
    [-32601, 'JSONRPC_EXTENSION_MISSING'],
    [-32602, 'JSONRPC_PROFILE_INVALID']
  ])(
    '[A3] classifies hello integer error %s without losing foreign cause',
    async (code, expected) => {
      const fixture = bridgeFixture({
        responder: (message) => ({
          jsonrpc: '2.0',
          id: message.id,
          error: { code, message: 'foreign hello failure' }
        })
      })
      await expect(fixture.open()).rejects.toMatchObject({
        code: expected,
        cause: { source: 'jsonrpc-2.0', code: String(code) }
      })
      expect(fixture.closes).toBe(1)
    }
  )
  it('[A4] times out at 10000ms, rejects abort by identity, and releases timers', async () => {
    const silent = bridgeFixture({ autoHello: false })
    const timed = silent.open()
    silent.scheduler.advance(9999)
    expect(silent.closes).toBe(0)
    silent.scheduler.advance(1)
    await expect(timed).rejects.toMatchObject({ code: 'JSONRPC_HANDSHAKE_TIMEOUT' })
    expect(silent.closes).toBe(1)
    expect(silent.scheduler.pendingCount).toBe(0)
    const fixture = bridgeFixture({ autoHello: false })
    const controller = new AbortController()
    const reason = new Error('caller cancellation')
    const aborted = fixture.open({ signal: controller.signal })
    fixture.scheduler.advance(5000)
    controller.abort(reason)
    await expect(aborted).rejects.toBe(reason)
    expect(fixture.scheduler.pendingCount).toBe(0)
    expect(fixture.closes).toBe(1)
  })
  it.each(['kind', 'step', 'protocol', 'codec', 'unknown-field', 'peer'])(
    '[A11] preserves original control failure and redacts hostile reply %s',
    async (field) => {
      const fixture = bridgeFixture({ autoHello: false })
      const pending = fixture.open()
      await flush()
      const hello = (fixture.messages[0]!.params as { hello: string }).hello
      const answer = acceptRpcHandshake(BRIDGE_PEER_OFFER, hello)
      const original = JSON.parse(answer.reply) as Record<string, unknown>
      const hostile =
        field === 'unknown-field'
          ? { ...original, kind: 'invalid', [fixture.options.token]: true }
          : {
              ...original,
              [field]:
                field === 'peer'
                  ? { id: fixture.options.token, runtime: [] }
                  : fixture.options.token
            }
      const reply = JSON.stringify(hostile)
      /** Capture the actual control exception crossing the bridge, rather than a second clone. */
      let upstream: unknown
      const originalComplete = completeRpcHandshake
      const spy = vi.spyOn(control, 'completeRpcHandshake').mockImplementation((offer, text) => {
        try {
          return originalComplete(offer, text)
        } catch (error) {
          upstream = error
          throw error
        }
      })
      fixture.deliver({
        jsonrpc: '2.0',
        id: 'migaia.hello',
        result: { reply, methods: BRIDGE_METHODS }
      })
      let observed: unknown
      try {
        await pending
      } catch (error) {
        observed = error
      } finally {
        spy.mockRestore()
      }
      expect(observed).toMatchObject({ code: 'HANDSHAKE_INVALID' })
      expect(observed).toBe(upstream)
      const evidence =
        inspect(observed, { depth: null, showHidden: true }) +
        JSON.stringify(serializeRpcError(observed, { report: () => undefined })) +
        inspect(fixture.reports, { depth: null })
      for (let offset = 0; offset <= fixture.options.token.length - 6; offset++)
        expect(evidence).not.toContain(fixture.options.token.slice(offset, offset + 6))
    }
  )
  it('[A11] redacts malformed JSON, truncated bodies and nonstring replies', async () => {
    for (const kind of ['json', 'truncated', 'shape']) {
      const fixture = bridgeFixture({ autoHello: false })
      const pending = fixture.open()
      await flush()
      if (kind === 'shape')
        fixture.deliver({
          jsonrpc: '2.0',
          id: 'migaia.hello',
          result: { reply: { token: fixture.options.token } }
        })
      else {
        const body = Buffer.from(`{"reply":${fixture.options.token}}`)
        fixture.bytes(
          Buffer.concat([
            Buffer.from(`Content-Length: ${body.length + (kind === 'truncated' ? 2 : 0)}\r\n\r\n`),
            body
          ])
        )
        if (kind === 'truncated') fixture.eof()
      }
      let error: unknown
      try {
        await pending
      } catch (failure) {
        error = failure
      }
      expect(error).toMatchObject({
        code: kind === 'shape' ? 'JSONRPC_PROFILE_INVALID' : 'JSONRPC_FRAME_INVALID'
      })
      expect(inspect(error, { depth: null, showHidden: true })).not.toContain(fixture.options.token)
    }
  })
})
