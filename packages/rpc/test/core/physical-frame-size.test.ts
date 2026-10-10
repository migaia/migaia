import assert from 'node:assert/strict'
import { it } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { rpcProtocolV1 } from '../../src/contract/index.js'
import { messageFramerV1 } from '../../src/contract/framing/message-framer.js'
import { bindRpcFrameIngress } from '../../src/contract/framing/index.js'
import { measureRpcPhysicalFrame } from '../../src/contract/batch-frame.js'
import {
  createOutboundEnvelope,
  outboundJsonByteUpperBound,
  createRuntimeOutboundEnvelope
} from '../../src/core/internal/outbound-envelope.js'
import vectors from '../../schema/vectors/runtime-api.json'
import { proveFastComponents } from '../../src/core/internal/fast-path.js'
import { readOwnedJsonSnapshot } from '../../src/core/internal/outbound-owned-codec.js'
import { RUNTIME_API_CAPABILITIES } from '../../src/remote/runtime-api/constants.js'
import { RpcSerializationError } from '../../src/core/errors.js'
import { RpcOutboundSender } from '../../src/core/internal/outbound-sender.js'
import type { IRpcSelectedComponents } from '../../src/core/internal/endpoint-options.js'

/** Build the same portable envelope used by the native Worker sender and sizing boundary. */
function sizeRequest(payload: unknown) {
  return createOutboundEnvelope({
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
      payload
    }
  })
}

for (const size of [64 * 1024, 1024 * 1024]) {
  it(`[A61][A21] Worker ${size} runtime data reuses one owned bound and preserves frame identity`, async () => {
    /** The real runtime union receives the same canonical first-user portable admission. */
    const message = createRuntimeOutboundEnvelope({
      ...vectors.valid[0],
      payload: { z: 'x'.repeat(size), a: { text: '汉字\ud83d', value: -0 } }
    })
    /** These exact first-party descriptors select the production identity/frame path. */
    const components: IRpcSelectedComponents = {
      protocol: rpcProtocolV1,
      codec: identityCodecV1 as IRpcSelectedComponents['codec'],
      framer: messageFramerV1,
      ingressPrepare: bindRpcFrameIngress(messageFramerV1.accept, messageFramerV1.frame),
      shadowed: []
    }
    proveFastComponents(components, rpcProtocolV1, identityCodecV1, messageFramerV1)
    /** The existing sender owns physical admission; this sink observes its exact delivered object. */
    const frames: unknown[] = []
    const sender = new RpcOutboundSender(
      {
        platform: 'Memory',
        send: (value) => {
          frames.push(value)
        }
      },
      'a',
      components
    )
    /**
     * Count actual object serialization, with a same-value positive control before the business
     * call.
     */
    const descriptor = Object.getOwnPropertyDescriptor(JSON, 'stringify')!
    let serializations = 0
    Object.defineProperty(JSON, 'stringify', {
      ...descriptor,
      value: (...args: unknown[]) => {
        serializations++
        return Reflect.apply(descriptor.value, JSON, args)
      }
    })
    try {
      assert.ok(measureRpcPhysicalFrame(message) > size)
      assert.equal(serializations, 1)
      serializations = 0
      await sender.sendRuntime(message, RUNTIME_API_CAPABILITIES)
      assert.equal(serializations, 0, '[A61] both runtime size gates reuse owned facts')
      assert.equal(frames.length, 1)
      assert.equal((frames[0] as { frame: unknown }).frame, message)
      assert.ok(readOwnedJsonSnapshot(message))
      assert.ok('payload' in message)
      assert.equal(Object.is((message.payload as { a: { value: number } }).a.value, -0), true)
    } finally {
      Object.defineProperty(JSON, 'stringify', descriptor)
    }
  })
}

/** Exercise idle or queued singletons through the same canonical sender and observable counters. */
async function verifyOwnedSingleton(queued: boolean) {
  /** The actual canonical snapshot carries the private sender sizing proof. */
  const message = sizeRequest('x'.repeat(1_048_576))
  /** The actual sender owns idle/busy admission and the delivered frame identity. */
  const frames: unknown[] = []
  /** Hold the first write only when exercising the reachable busy-sender singleton path. */
  let releaseWrite: (() => void) | undefined
  /** Native Promise settlement drives the canonical queue, without simulating its internals. */
  const pendingWrite = queued
    ? new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
    : undefined
  /** No receiver or host timing is simulated in this execution-count discriminator. */
  const sender = new RpcOutboundSender(
    {
      platform: 'Memory',
      send: (value) => {
        frames.push(value)
        if (frames.length === 1) return pendingWrite
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
    /** The first envelope stays in flight while exactly one large envelope enters the FIFO. */
    const first = queued ? sender.send(sizeRequest('held')) : undefined
    /** The queued operation keeps its own settlement until the transport write completes. */
    const sent = sender.send(message)
    if (queued) {
      assert.equal(frames.length, 1)
      releaseWrite!()
    }
    await Promise.all([first, sent])
    assert.equal(frames.length, queued ? 2 : 1)
    assert.equal(frames[queued ? 1 : 0], message)
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
}

it('[A27-FIX1] owned 1 MiB singleton keeps its size guard without scanning or serializing its payload', () =>
  verifyOwnedSingleton(false))

it('[A27-FIX4] queued owned 1 MiB singleton keeps FIFO and its size guard without a payload scan', () =>
  verifyOwnedSingleton(true))

it('[A27-FIX3] the owned upper bound includes JSON null slots preserved by portable normalization', () => {
  /** Array.map retains holes; JSON represents every absent slot as null. */
  const payload: unknown[] = []
  payload.length = 4096
  /** The admitted array keeps its absent own indices. */
  const message = sizeRequest(payload)
  assert.ok(
    outboundJsonByteUpperBound(message)! >= measureRpcPhysicalFrame(message),
    '[A27-FIX3] an admitted sparse array cannot bypass exact physical sizing with an unsafe bound'
  )
})

it('[A27-FIX5] queued opaque sizing failures keep the serialization category and native cause', async () => {
  /** The supported variation contract preserves opaque payload identity, including cycles. */
  const payload: { cycle?: unknown } = {}
  payload.cycle = payload
  /** Normalization keeps the opaque value outside the owned portable size proof. */
  const message = createOutboundEnvelope({
    kind: 'variation',
    id: 'opaque-size-failure',
    data: {
      route: {
        profile: 'migaia.rpc.route',
        type: 'variation',
        variation: 'ping',
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        receiverId: 'b',
        sentAt: 0
      },
      payload
    }
  })
  /** Keep one real write pending so the opaque singleton is prepared by the FIFO drain. */
  let releaseWrite!: () => void
  /** Only the first transport write is held; failed serialization must never write a frame. */
  const pending = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  /** Delivered frame count observes rollback at the existing physical boundary. */
  const frames: unknown[] = []
  /** Identity codec admits the variation before exact JSON sizing discovers its native cycle. */
  const sender = new RpcOutboundSender(
    {
      platform: 'Memory',
      send: (value) => {
        frames.push(value)
        return pending
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
  /** The queued failure is observed before releasing the transport to avoid a late rejection. */
  const first = sender.send(sizeRequest('held'))
  /** The pre-existing category distinguishes encoding failure from physical oversize. */
  const rejected = assert.rejects(Promise.resolve(sender.send(message)), (error: unknown) => {
    assert.ok(error instanceof RpcSerializationError)
    assert.ok(error.cause instanceof TypeError)
    return true
  })
  releaseWrite()
  await Promise.all([first, rejected])
  assert.equal(frames.length, 1)
})
