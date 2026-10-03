import assert from 'node:assert/strict'
import { it } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { rpcProtocolV1 } from '../../src/contract/index.js'
import { messageFramerV1 } from '../../src/contract/framing/message-framer.js'
import { measureRpcPhysicalFrame } from '../../src/contract/batch-frame.js'
import { createOutboundEnvelope } from '../../src/core/internal/outbound-envelope.js'
import { RpcOutboundSender } from '../../src/core/internal/outbound-sender.js'
import type { IRpcSelectedComponents } from '../../src/core/internal/endpoint-options.js'

it('[A27-FIX1] owned 1 MiB singleton keeps its size guard without scanning or serializing its payload', async () => {
  /** Same portable envelope and canonical identity codec used by the native Worker sender. */
  const message = createOutboundEnvelope({
    kind: 'request',
    id: 'size-positive-control',
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
      payload: 'x'.repeat(1_048_576)
    }
  })
  /** The actual sender owns idle/busy admission and the delivered frame identity. */
  const frames: unknown[] = []
  /** No receiver or host timing is simulated in this execution-count discriminator. */
  const sender = new RpcOutboundSender(
    {
      platform: 'Memory',
      send: (value) => {
        frames.push(value)
      }
    },
    'a',
    {
      protocol: rpcProtocolV1,
      codec: identityCodecV1 as unknown as IRpcSelectedComponents['codec'],
      framer: messageFramerV1,
      ingressPrepare: (frame) => ({ frame, messageId: 'whole' }),
      shadowed: []
    },
    undefined,
    'Memory',
    undefined,
    undefined,
    true,
    true
  )
  /** Built-in descriptors are restored even when the red assertion throws. */
  const characterDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'codePointAt')!
  /** Counting records no per-character mock arguments or payload copies. */
  let characterReads = 0
  /** Whole-envelope JSON work is distinct from the exact UTF-8 counting loop. */
  let serializations = 0
  /** Preserve every native JSON overload and return value. */
  const jsonDescriptor = Object.getOwnPropertyDescriptor(JSON, 'stringify')!
  Object.defineProperty(String.prototype, 'codePointAt', {
    ...characterDescriptor,
    /** Observe only the large payload's execution; delegate exact built-in behavior unchanged. */
    value: function (this: string, index: number) {
      if (this.length >= 1_048_576) characterReads++
      return Reflect.apply(characterDescriptor.value, this, [index])
    }
  })
  Object.defineProperty(JSON, 'stringify', {
    ...jsonDescriptor,
    /** Count the sender's complete representation without changing serialization semantics. */
    value: (...args: unknown[]) => {
      if (args[0] === message) serializations++
      return Reflect.apply(jsonDescriptor.value, JSON, args)
    }
  })
  try {
    /** Positive control proves the counter observes the old exact sizing path on this same value. */
    assert.ok(measureRpcPhysicalFrame(message) > 1_048_576)
    assert.ok(characterReads >= 1_048_576)
    assert.equal(serializations, 1)
    characterReads = 0
    serializations = 0
    await sender.send(message)
    assert.equal(frames.length, 1)
    assert.equal(frames[0], message)
    assert.equal(
      characterReads,
      0,
      '[A27-FIX1] admitted 1 MiB payload has no JavaScript byte-counting pass'
    )
    assert.equal(
      serializations,
      0,
      '[A27-FIX1] identity carrier does not JSON-encode an admitted singleton'
    )
  } finally {
    Object.defineProperty(String.prototype, 'codePointAt', characterDescriptor)
    Object.defineProperty(JSON, 'stringify', jsonDescriptor)
  }
})
