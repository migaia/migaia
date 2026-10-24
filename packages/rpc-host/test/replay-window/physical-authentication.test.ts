import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { MessageChannel } from 'node:worker_threads'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createManualScheduler } from '@migaia/utils/testing'
import { describe, it } from 'vitest'
import { createNodeMessagePortTransport } from '../../dist/core/adapters/message-port.js'

import { authentication } from '../../dist/core/middleware/authentication.js'
import { connect } from '../../dist/core/middleware/connect.js'
import {
  readAuthenticationEnvelope,
  RpcAuthenticationEnvelope
} from '../../dist/core/middleware/authentication-envelope.js'
import { setAuthenticationReplayCounter } from '../../dist/core/internal/authentication-replay.js'
import { RpcMiddlewareErrorText } from '../../dist/core/middleware/error-text.js'
import type { IRpcAuthenticationCapability, IRpcPlugin } from '../../dist/core/typing.js'

/** The optional frozen baseline changes only the authentication owner, never production source. */
const authenticationOwner = process.env.RPC_REPLAY_BASE
  ? (
      (await import(/* @vite-ignore */ process.env.RPC_REPLAY_BASE)) as {
        authentication: typeof authentication
      }
    ).authentication
  : authentication

/** Public fixture key is intentionally unrelated to any real account or process credential. */
const fixtureKey = 'replay-r12-public-fixture-key'

/**
 * HMAC covers the complete physical frame; replay uses captured bytes rather than a re-signed
 * value.
 */
function signature(value: unknown): string {
  return createHmac('sha256', fixtureKey).update(JSON.stringify(value)).digest('hex')
}

describe('replay-window r12 real MessagePort authentication', () => {
  it('signs every binding field and reports actual outbound counter exhaustion', async () => {
    /**
     * Both endpoints communicate through physical structured-clone ports with independent auth
     * owners.
     */
    const { port1, port2 } = new MessageChannel()
    const clientTransport = createNodeMessagePortTransport(port1)
    const serverTransport = createNodeMessagePortTransport(port2)
    /** The exact last valid physical frame is retained before any rejected subsequent send. */
    let captured: unknown
    /** Provider count is a business observable, separate from failure hooks and signature calls. */
    let providers = 0
    /** Seeding follows normal target discovery so only the final business frame consumes uint64 max. */
    let clientCapability: IRpcAuthenticationCapability | undefined
    /**
     * One constructor wrapper seeds the actual canonical capability without copying its private
     * authority.
     */
    const signed = (seed = false): IRpcPlugin => {
      const plugin = authenticationOwner({
        sign: (value) => ({ value, signature: signature(value) }),
        verify: (value) => {
          const frame = value as { value: unknown; signature: string }
          assert.equal(
            frame.signature,
            signature(frame.value),
            'signature covers binding and payload'
          )
          return frame.value
        }
      })
      if (!seed) return plugin
      return {
        ...plugin,
        install: async (context) => {
          const installed = await plugin.install(context)
          clientCapability = installed.ports?.authentication as IRpcAuthenticationCapability
          return installed
        }
      }
    }
    /** Capture observes only the existing physical write and preserves adapter identity. */
    const send = clientTransport.send
    clientTransport.send = (value, options) => {
      captured = value
      return send(value, options)
    }
    const server = await createRuntimeEndpointComposition(
      {
        id: 'tamper-server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport }), signed()],
        provider: {
          echo: (context) => {
            providers++
            return context.success(context.data)
          }
        }
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'tamper-client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), signed(true)]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    /** Existing hooks retain original coded errors for identity and cause assertions. */
    const inboundFailures: unknown[] = []
    const outboundFailures: unknown[] = []
    const removeServer = server.hooks.on((event) => {
      if (event.name === 'failure') inboundFailures.push(event.error)
    })
    const removeClient = client.hooks.on((event) => {
      if (event.name === 'failure') outboundFailures.push(event.error)
    })
    try {
      assert.equal(await client.send('tamper-server', 'echo', 'discovered'), 'discovered')
      assert.ok(clientCapability)
      assert.equal(
        setAuthenticationReplayCounter(clientCapability, 0xfffffffffffffffen),
        true,
        'actual endpoint owns the counter after normal target discovery'
      )
      assert.equal(await client.send('tamper-server', 'echo', 'last'), 'last')
      assert.equal(providers, 2)
      const frame = captured as { value: unknown; signature: string }
      const bound = readAuthenticationEnvelope(frame.value)
      assert.equal(bound.counter, '18446744073709551615')
      /** Actual signed semantic identity fields are independent tamper positions inside the payload. */
      const semantic = bound.payload as { data: { route: Record<string, unknown> } }
      for (const change of [
        { version: 2 },
        { nonce: '0'.repeat(32) },
        { counter: '1' },
        { payload: 'tampered' },
        {
          payload: {
            ...semantic,
            data: {
              ...semantic.data,
              route: { ...semantic.data.route, senderId: 'forged-sender' }
            }
          }
        },
        {
          payload: {
            ...semantic,
            data: {
              ...semantic.data,
              route: { ...semantic.data.route, receiverId: 'forged-receiver' }
            }
          }
        }
      ]) {
        const changed = { ...bound, ...change }
        const inner =
          typeof frame.value === 'string'
            ? RpcAuthenticationEnvelope.prefix + JSON.stringify(changed)
            : changed
        const previous = inboundFailures.length
        port1.postMessage({ ...frame, value: inner })
        for (let turn = 0; turn < 20 && inboundFailures.length === previous; turn++)
          await nextTurn()
        assert.equal(
          inboundFailures.length,
          previous + 1,
          'each tampered physical frame fails authentication'
        )
        assert.equal((inboundFailures.at(-1) as { code: string }).code, 'AUTHENTICATION_FAILED')
        assert.equal(providers, 2, 'tampering never reaches the provider')
      }
      let failure: unknown
      try {
        await client.send('tamper-server', 'echo', 'overflow')
      } catch (error) {
        failure = error
      }
      assert.ok(failure, 'exhausted endpoint rejects rather than wrapping')
      assert.equal((failure as { code: string }).code, 'INVALID_CONFIG')
      assert.equal(
        (failure as Error).message,
        RpcMiddlewareErrorText.authenticationCounterExhausted
      )
      assert.equal(
        outboundFailures.filter((error) => error === failure).length,
        1,
        'original exhaustion error is reported exactly once'
      )
      assert.equal(providers, 2)
    } finally {
      removeClient()
      removeServer()
      await client.dispose()
      await server.dispose()
      port1.close()
      port2.close()
    }
  })
  it.each([100, 310_001])('rejects a captured signed physical frame at %s ms', async (elapsed) => {
    /** Real Node ports clone the frame across a physical receive boundary. */
    const { port1, port2 } = new MessageChannel()
    /** Observed transport send retains the original adapter identity and lifecycle. */
    const clientTransport = createNodeMessagePortTransport(port1)
    /** Server owns a separate physical authentication session. */
    const serverTransport = createNodeMessagePortTransport(port2)
    /** Only the server's monotonic clock moves; no real 310-second wait changes the replay oracle. */
    const scheduler = createManualScheduler()
    /** The captured outer signed frame is replayed verbatim via the real port. */
    let captured: unknown
    /** Counts business execution, independently of verification callbacks. */
    let providers = 0
    /** Counts accepted cryptographic verifications, including the replay attempt. */
    let verifies = 0
    /** Existing hook reporting is the fail-closed physical-authentication observable. */
    const rejected: unknown[] = []
    /** Both endpoints use the same declared signer and verifier, with separate installed sequences. */
    const signed = () =>
      authenticationOwner({
        sign: (value) => ({ value, signature: signature(value) }),
        verify: (frame) => {
          /** Fixture signature verification reads only its stable captured shape. */
          const candidate = frame as { value: unknown; signature: string }
          assert.equal(
            candidate.signature,
            signature(candidate.value),
            'captured signature remains valid'
          )
          verifies += 1
          return candidate.value
        }
      })
    /** A send observer records the actual protected frame without replacing the transport wrapper. */
    const send = clientTransport.send
    clientTransport.send = (value, options) => {
      captured = value
      return send(value, options)
    }
    /** Server receives the actual physical request and returns the original user payload. */
    const server = await createRuntimeEndpointComposition(
      {
        id: 'physical-server',
        transport: serverTransport,
        scheduler,
        middlewares: [connect({ transport: serverTransport }), signed()],
        provider: {
          echo: (context) => {
            providers += 1
            return context.success(context.data)
          }
        }
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    /**
     * Client sends through canonical encode/framing/protect rather than manually constructing an
     * envelope.
     */
    const client = await createRuntimeEndpointComposition(
      {
        id: 'physical-client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), signed()]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    /** Hook collection preserves the production authentication rejection/reporting path. */
    const release = server.hooks.on((event) => {
      if (
        event.name === 'failure' &&
        (event.error as { code?: unknown } | undefined)?.code === 'AUTHENTICATION_FAILED'
      )
        rejected.push(event)
    })
    try {
      assert.equal(await client.send('physical-server', 'echo', 'original'), 'original')
      assert.equal(providers, 1, 'first signed request executes exactly once')
      assert.ok(captured, 'real protected physical frame captured')
      /** Freeze the replay input before any response or late transport callback can replace it. */
      const replay = captured
      /** Response verification is complete before this counter snapshot. */
      const before = verifies
      scheduler.advance(elapsed)
      port1.postMessage(replay)
      for (let turn = 0; turn < 20 && verifies === before; turn += 1) await nextTurn()
      assert.equal(verifies, before + 1, 'actual replay reaches cryptographic verification')
      await nextTurn()
      await nextTurn()
      assert.equal(providers, 1, 'captured signed replay cannot execute again')
      assert.equal(rejected.length, 1, 'replay fails authentication before business admission')
    } finally {
      release()
      await client.dispose()
      await server.dispose()
      port1.close()
      port2.close()
    }
  })
})
