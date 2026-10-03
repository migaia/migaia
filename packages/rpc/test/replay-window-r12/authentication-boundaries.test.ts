import assert from 'node:assert/strict'
import { describe, it, vi } from 'vitest'
import { authentication } from '../../src/core/middleware/authentication.js'
import { installPlugin } from '../core/middleware/helpers.js'
import type {
  IRpcAuthenticationCapability,
  IRpcAuthenticationContext
} from '../../src/core/typing.js'
import {
  bindAuthenticationReplayContext,
  hasAuthenticationReplayBinding,
  markAuthenticationReplayEnvelope,
  recordAuthenticationReplayBinding,
  setAuthenticationReplayCounter
} from '../../src/core/internal/authentication-replay.js'
import { RpcMiddlewareErrorText } from '../../src/core/middleware/error-text.js'

/** The installed canonical owner uses async methods while the public capability permits sync ports. */
type ITestAuthenticationCapability = Omit<IRpcAuthenticationCapability, 'protect' | 'unprotect'> & {
  protect(value: unknown, context: IRpcAuthenticationContext): Promise<unknown>
  unprotect(value: unknown, context: IRpcAuthenticationContext): Promise<unknown>
}

/** Only the frozen authentication owner changes in the BC discriminator baseline. */
const owner = process.env.RPC_REPLAY_BASE
  ? (
      (await import(/* @vite-ignore */ process.env.RPC_REPLAY_BASE)) as {
        authentication: typeof authentication
      }
    ).authentication
  : authentication

/** This receiver fixture exercises the production bitmap independently of cryptographic algorithms. */
function capability(): ITestAuthenticationCapability {
  return installPlugin(owner({ sign: (value) => value, verify: (value) => value })).get(
    'authenticationCapability'
  ) as ITestAuthenticationCapability
}

/** Every delivery has a fresh callback context, while the physical session remains identical. */
function context(session?: object, active: () => boolean = () => true): IRpcAuthenticationContext {
  const value: IRpcAuthenticationContext = {
    direction: session ? 'inbound' : 'outbound',
    endpointId: 'bounds',
    platform: 'MessagePort'
  }
  if (session) bindAuthenticationReplayContext(value, session, active)
  return value
}

describe('r12 authentication boundary ownership', () => {
  it('[A18/A25] transfers verified binding only to the exact semantic envelope identity', () => {
    /** Public context fields alone cannot claim completed physical verification. */
    const context: IRpcAuthenticationContext = {
      direction: 'inbound',
      endpointId: 'bound',
      platform: 'Memory'
    }
    /** Equal-shaped envelope copies must not inherit another member's private proof. */
    const envelope = { id: 'bound-member' }
    markAuthenticationReplayEnvelope(context, envelope)
    assert.equal(hasAuthenticationReplayBinding(envelope), false)
    recordAuthenticationReplayBinding(context)
    markAuthenticationReplayEnvelope(context, envelope)
    assert.equal(hasAuthenticationReplayBinding(envelope), true)
    assert.equal(hasAuthenticationReplayBinding({ ...envelope }), false)
    /** A different receiver context cannot transfer a verified physical fact. */
    const sibling = { id: 'other-member' }
    markAuthenticationReplayEnvelope({ ...context }, sibling)
    assert.equal(hasAuthenticationReplayBinding(sibling), false)
  })
  it('[A20] fails closed for absent or throwing secure nonce entropy without losing cause', async () => {
    /** Crypto is restored before the fixture observes the separately throwing native entropy path. */
    vi.stubGlobal('crypto', undefined)
    try {
      await assert.rejects(
        capability().protect('no entropy', context()),
        {
          code: 'INVALID_CONFIG',
          message: RpcMiddlewareErrorText.authenticationNonceUnavailable
        },
        '[A20] missing secure entropy cannot sign an unbound or weak-random frame'
      )
    } finally {
      vi.unstubAllGlobals()
    }
    /** Original native error identity remains reachable under the coded nonce configuration failure. */
    const original = new RangeError(RpcMiddlewareErrorText.authenticationNonceFailed)
    const entropy = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw original
    })
    try {
      await assert.rejects(
        capability().protect('throwing entropy', context()),
        (error) => {
          const failure = error as Error & { code: string; cause: unknown }
          assert.equal(failure.code, 'INVALID_CONFIG')
          assert.equal(failure.message, RpcMiddlewareErrorText.authenticationNonceFailed)
          assert.equal(failure.cause, original)
          assert.ok(original.stack)
          return true
        },
        '[A20] secure nonce failure preserves the native primary cause'
      )
    } finally {
      entropy.mockRestore()
    }
  })
  it('[A18] uses exactly 64 slots: unseen bit 63 passes, bit 64 and seen bits fail', async () => {
    const sender = capability()
    const receiver = capability()
    const session = {}
    const frames: unknown[] = []
    for (let index = 1; index <= 66; index++) frames.push(await sender.protect(index, context()))
    assert.equal(await receiver.unprotect(frames[64], context(session)), 65)
    assert.equal(
      await receiver.unprotect(frames[1], context(session)),
      2,
      '[A18] distance 63 remains in the window'
    )
    await assert.rejects(
      receiver.unprotect(frames[0], context(session)),
      { code: 'AUTHENTICATION_FAILED' },
      '[A18] distance 64 is outside the window'
    )
    await assert.rejects(
      receiver.unprotect(frames[1], context(session)),
      { code: 'AUTHENTICATION_FAILED' },
      '[A18] an accepted low bit cannot execute twice'
    )
    await assert.rejects(
      receiver.unprotect(frames[64], context(session)),
      { code: 'AUTHENTICATION_FAILED' },
      '[A18] bit zero cannot execute twice'
    )
    assert.equal(await receiver.unprotect(frames[65], context(session)), 66)
    setAuthenticationReplayCounter(sender, 130n)
    assert.equal(
      await receiver.unprotect(await sender.protect(131, context()), context(session)),
      131
    )
    await assert.rejects(
      receiver.unprotect(frames[65], context(session)),
      { code: 'AUTHENTICATION_FAILED' },
      '[A18] advancing by 65 clears the old window'
    )
  })

  it('[A18/A19] concurrent verification commits one counter once and session state stays isolated', async () => {
    const sender = capability()
    const receiver = capability()
    const frame = await sender.protect('value', context())
    const session = {}
    const results = await Promise.allSettled([
      receiver.unprotect(frame, context(session)),
      receiver.unprotect(frame, context(session))
    ])
    assert.equal(
      results.filter((value) => value.status === 'fulfilled').length,
      1,
      '[A18] concurrent verification can commit one physical counter only once'
    )
    assert.equal(
      results.filter(
        (value) => value.status === 'rejected' && value.reason.code === 'AUTHENTICATION_FAILED'
      ).length,
      1
    )
    assert.equal(
      await receiver.unprotect(frame, context({})),
      'value',
      '[A19] another physical session owns a separate window'
    )
    const anotherSender = capability()
    await assert.rejects(
      receiver.unprotect(await anotherSender.protect('new nonce', context()), context(session)),
      { code: 'AUTHENTICATION_FAILED' },
      '[A19] the original session never changes its pinned nonce'
    )
  })

  it('[A20] signs the last uint64 counter and rejects the next allocation without wrapping', async () => {
    const sender = capability()
    assert.equal(
      setAuthenticationReplayCounter(sender, 0xfffffffffffffffen),
      true,
      '[A20] the canonical counter is owned by the actual installed capability'
    )
    const frame = (await sender.protect({ value: 'last' }, context())) as { counter: string }
    assert.equal(frame.counter, '18446744073709551615')
    assert.deepEqual(await capability().unprotect(frame, context({})), { value: 'last' })
    await assert.rejects(sender.protect('overflow', context()), {
      code: 'INVALID_CONFIG',
      message: RpcMiddlewareErrorText.authenticationCounterExhausted
    })
    assert.equal(
      setAuthenticationReplayCounter({ ...sender }, 0n),
      false,
      '[A20] a public copy has no counter injection authority'
    )
  })

  it('[A7/A19/A29] missing or retired receiver ownership cannot return a verified payload', async () => {
    const sender = capability()
    const receiver = capability()
    const frame = await sender.protect('private', context())
    await assert.rejects(
      receiver.unprotect(frame, context()),
      { code: 'AUTHENTICATION_FAILED' },
      '[A29] public context fields supply no session proof'
    )
    await assert.rejects(
      receiver.unprotect(
        frame,
        context({}, () => false)
      ),
      { code: 'AUTHENTICATION_FAILED' },
      '[A7] a retired session stays retired after verification'
    )
  })

  it('[A18/A25] rejects unknown versions and malformed binding counters or nonces', async () => {
    const sender = capability()
    const frame = (await sender.protect({ value: 'payload' }, context())) as Record<string, unknown>
    /**
     * Invalid signed bindings prove parser behavior; signature tampering has separate HMAC
     * evidence.
     */
    const invalid = [
      { version: 2 },
      { nonce: '' },
      { nonce: 'A'.repeat(32) },
      { counter: '0' },
      { counter: '-1' },
      { counter: '01' },
      { counter: '18446744073709551616' }
    ]
    for (const change of invalid)
      await assert.rejects(
        capability().unprotect({ ...frame, ...change }, context({})),
        {
          code: 'AUTHENTICATION_FAILED'
        },
        '[A18/A25] malformed signed binding cannot return its payload'
      )
  })

  it('[A26] preserves the string, bytes and object categories through bound roundtrips', async () => {
    /** Each category gets its own signed physical session and counter window. */
    const values = ['text', new Uint8Array([0, 255, 42]), { nested: 'value' }]
    for (const value of values) {
      const sender = capability()
      const frame = await sender.protect(value, context())
      assert.equal(typeof frame, typeof value)
      assert.equal(frame instanceof Uint8Array, value instanceof Uint8Array)
      assert.deepEqual(await capability().unprotect(frame, context({})), value)
    }
  })
})
