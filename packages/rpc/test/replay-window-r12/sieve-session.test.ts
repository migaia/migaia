import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { authentication } from '../../src/core/middleware/authentication.js'
import { installPlugin } from '../core/middleware/helpers.js'
import {
  bindAuthenticationReplayContext,
  readAuthenticationChallengePort
} from '../../src/core/internal/authentication-replay.js'
import { wrapAuthenticationEnvelope } from '../../src/core/middleware/authentication-envelope.js'
import type {
  IRpcAuthenticationCapability,
  IRpcAuthenticationContext
} from '../../src/core/typing.js'

/** Exercise the original authentication table without unrelated endpoint registries or codecs. */
function table() {
  /** Identity transforms isolate SIEVE mechanics; real signed carrier cases cover authentication. */
  const capability = installPlugin(
    authentication({ sign: (value) => value, verify: (value) => value })
  ).get('authenticationCapability') as IRpcAuthenticationCapability
  /** Only the installed owner can issue challenges; no second table or public option is created. */
  const port = readAuthenticationChallengePort(capability)!
  /** A fixed physical owner supplies source-less receiver facts through the existing private seam. */
  const session = {}
  /** Deterministic valid nonces make eviction identities observable without reading table internals. */
  const nonce = (index: number) => index.toString(16).padStart(32, '0')
  /** Each delivery traverses original verification and counter admission before marking visited. */
  const hit = (index: number, challenge: string, counter = 1n) => {
    /** A fresh physical callback context retains the same genuine receiver partition. */
    const context: IRpcAuthenticationContext = {
      direction: 'inbound',
      endpointId: 'receiver',
      platform: 'BroadcastChannel'
    }
    bindAuthenticationReplayContext(context, session, () => true, {
      receiverId: 'receiver',
      unknown: () => undefined
    })
    return capability.unprotect(
      wrapAuthenticationEnvelope('business', nonce(index), counter, {
        challenge,
        receiverId: 'receiver',
        replyChallenge: 'f'.repeat(32),
        replyReceiverId: `client-${index}`
      }),
      context
    )
  }
  return { port, nonce, hit }
}

it('[U42-A41] unvisited sessions leave in insertion order', async () => {
  /** Fill exactly the unchanged 64-slot budget using discovery only. */
  const owner = table()
  const challenges = Array.from({ length: 64 }, (_, index) => owner.port.issue(owner.nonce(index)))
  owner.port.issue(owner.nonce(64))
  await assert.rejects(Promise.resolve(owner.hit(0, challenges[0]!)), { reason: 'SESSION_UNKNOWN' })
  assert.equal(await owner.hit(1, challenges[1]!), 'business')
})

it('[U42-A42] hand skips a visited session, clears its bit, and advances after eviction', async () => {
  /** The first business hit grants one second chance without moving the entry. */
  const owner = table()
  const challenges = Array.from({ length: 64 }, (_, index) => owner.port.issue(owner.nonce(index)))
  await owner.hit(0, challenges[0]!)
  owner.port.issue(owner.nonce(64))
  await assert.rejects(Promise.resolve(owner.hit(1, challenges[1]!)), { reason: 'SESSION_UNKNOWN' })
  assert.equal(await owner.hit(0, challenges[0]!, 2n), 'business')
  owner.port.issue(owner.nonce(65))
  await assert.rejects(Promise.resolve(owner.hit(2, challenges[2]!)), { reason: 'SESSION_UNKNOWN' })
})

it('[U42-A43] a full visited table clears one circle and evicts the hand starting session', async () => {
  /** The corrected U42 boundary permits a legitimate eviction at full capacity. */
  const owner = table()
  const challenges = Array.from({ length: 64 }, (_, index) => owner.port.issue(owner.nonce(index)))
  for (let index = 0; index < 64; index++) await owner.hit(index, challenges[index]!)
  owner.port.issue(owner.nonce(64))
  await assert.rejects(Promise.resolve(owner.hit(0, challenges[0]!, 2n)), {
    reason: 'SESSION_UNKNOWN'
  })
  assert.equal(await owner.hit(1, challenges[1]!, 2n), 'business')
})

it('[U42-A44] repeated resident discovery cannot mark or reorder a session', async () => {
  /** Replayed discovery remains side-effect free with respect to visited and queue position. */
  const owner = table()
  const challenges = Array.from({ length: 64 }, (_, index) => owner.port.issue(owner.nonce(index)))
  for (let repeat = 0; repeat < 20; repeat++)
    assert.equal(owner.port.issue(owner.nonce(0)), challenges[0])
  owner.port.issue(owner.nonce(64))
  await assert.rejects(Promise.resolve(owner.hit(0, challenges[0]!)), { reason: 'SESSION_UNKNOWN' })
})

it('[U42-A45] a successful business hit performs no Map deletion or insertion', async () => {
  /** Observe only this nonce so framework bookkeeping cannot masquerade as a table mutation. */
  const owner = table()
  const nonce = owner.nonce(0)
  const challenge = owner.port.issue(nonce)
  const deletion = vi.spyOn(Map.prototype, 'delete')
  const insertion = vi.spyOn(Map.prototype, 'set')
  try {
    assert.equal(await owner.hit(0, challenge), 'business')
    assert.equal(deletion.mock.calls.filter(([key]) => key === nonce).length, 0)
    assert.equal(insertion.mock.calls.filter(([key]) => key === nonce).length, 0)
  } finally {
    deletion.mockRestore()
    insertion.mockRestore()
  }
})
