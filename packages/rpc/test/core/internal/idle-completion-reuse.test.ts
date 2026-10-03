import assert from 'node:assert/strict'
import { it } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import {
  normalizeRpcEnvelope,
  rpcProtocolV1,
  type IRpcEnvelope
} from '../../../src/contract/index.js'
import { messageFramerV1 } from '../../../src/contract/framing/message-framer.js'
import { RpcTransportError } from '../../../src/core/errors.js'
import { RpcOutboundSender } from '../../../src/core/internal/outbound-sender.js'
import type { IRpcSelectedComponents } from '../../../src/core/internal/endpoint-options.js'

/** Ordinary requests exercise the canonical idle sender without introducing another queue. */
function request(id: string): IRpcEnvelope {
  return normalizeRpcEnvelope({
    kind: 'request',
    id,
    method: 'echo',
    data: {
      route: {
        profile: 'migaia.rpc.route',
        type: 'request',
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        receiverId: 'b',
        sentAt: 0
      },
      payload: id
    }
  })
}

/** Observe synchronous reaction registration while retaining the native Promise operation. */
function recordedSend(sender: RpcOutboundSender, message: IRpcEnvelope) {
  /** The last synchronous reaction belongs to idle completion, after the transport error owner. */
  const reactions: (readonly [unknown, unknown])[] = []
  /** Native delegation preserves completion, rejection and Promise construction semantics. */
  const original = Promise.prototype.then
  /** Preserve the native property's full descriptor during temporary observation. */
  const descriptor = Object.getOwnPropertyDescriptor(Promise.prototype, 'then')!
  /** Restore immediately after send so awaiting work and other callers are not instrumented. */
  // eslint-disable-next-line unicorn/no-thenable -- Observe the existing native method for one synchronous send.
  Object.defineProperty(Promise.prototype, 'then', {
    ...descriptor,
    value: function (this: Promise<unknown>, fulfilled: unknown, rejected: unknown) {
      reactions.push([fulfilled, rejected])
      return Reflect.apply(original, this, [fulfilled, rejected])
    }
  })
  try {
    /** The synchronous physical invocation must register a real pair before observation succeeds. */
    const pending = sender.send(message)
    assert.ok(reactions.length > 0, '[A25/IDLE1] native reaction positive control')
    return { pending, completion: reactions.at(-1)! }
  } finally {
    // eslint-disable-next-line unicorn/no-thenable -- Restore the original native descriptor before awaiting.
    Object.defineProperty(Promise.prototype, 'then', descriptor)
  }
}

it('[A25/IDLE1] idle completions reuse owner callbacks and preserve failure recovery', async () => {
  /** Canonical components keep the original identity payload and whole-frame path. */
  const components: IRpcSelectedComponents = {
    protocol: rpcProtocolV1,
    codec: identityCodecV1 as unknown as IRpcSelectedComponents['codec'],
    framer: messageFramerV1,
    ingressPrepare: (frame) => ({ frame, messageId: 'whole' }),
    shadowed: []
  }
  /** Actual host invocations prove idle sends remain synchronous and ordered. */
  const written: string[] = []
  /** Only the next physical send consumes this fixture failure. */
  let nextFailure: Error | undefined
  /** The real sender retains all admission, encoding, busy-state and error ownership. */
  const sender = new RpcOutboundSender(
    {
      platform: 'Memory',
      send(value) {
        written.push((value as IRpcEnvelope).id)
        if (nextFailure) {
          const failure = nextFailure
          nextFailure = undefined
          return Promise.reject(failure)
        }
      }
    },
    'a',
    components,
    undefined,
    'Memory',
    undefined,
    undefined,
    true,
    true
  )
  /** Successful dependent sends have one callback pair throughout this sender's lifetime. */
  const pairs: (readonly [unknown, unknown])[] = []
  for (const id of ['first', 'second', 'third']) {
    const observed = recordedSend(sender, request(id))
    assert.equal(written.at(-1), id, '[A25/IDLE1] idle physical send remains synchronous')
    pairs.push(observed.completion)
    await observed.pending
  }
  assert.equal(new Set(pairs.map((pair) => pair[0])).size, 1, '[A25/IDLE1] reuse success callback')
  assert.equal(new Set(pairs.map((pair) => pair[1])).size, 1, '[A25/IDLE1] reuse failure callback')
  /** A rejected physical write retains its native cause and releases busy before the next call. */
  const reason = new Error('fixture physical write failure')
  nextFailure = reason
  const failed = recordedSend(sender, request('failed'))
  assert.equal(failed.completion[0], pairs[0]![0])
  assert.equal(failed.completion[1], pairs[0]![1])
  await assert.rejects(Promise.resolve(failed.pending), (error: unknown) => {
    assert.ok(error instanceof RpcTransportError)
    assert.equal(error.cause, reason)
    return true
  })
  const recovered = recordedSend(sender, request('recovered'))
  assert.equal(written.at(-1), 'recovered', '[A25/IDLE1] failure releases busy before continuation')
  assert.equal(recovered.completion[0], pairs[0]![0])
  assert.equal(recovered.completion[1], pairs[0]![1])
  await recovered.pending
  assert.deepEqual(written, ['first', 'second', 'third', 'failed', 'recovered'])
})
