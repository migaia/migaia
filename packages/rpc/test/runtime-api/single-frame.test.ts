import assert from 'node:assert/strict'
import { it } from 'vitest'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { rpcProtocolV1 } from '../../src/contract/index.js'
import {
  normalizeRuntimeEnvelope,
  runtimeOperationCapabilities,
  readRuntimeCarrier
} from '../../src/contract/runtime-api/index.js'
import { messageFramerV1, createStringFramer } from '../../src/contract/framing/message-framer.js'
import * as framing from '../../src/contract/framing/reassembler.js'
import type { IRpcRuntimeEnvelope } from '../../src/contract/runtime-api/types.js'
import { RpcOutboundSender } from '../../src/core/internal/outbound-sender.js'
import type { IRpcSelectedComponents } from '../../src/core/internal/endpoint-options.js'
import { wrapRuntimeCarrier } from '../../src/contract/runtime-api/carrier.js'
import { measureRpcPhysicalFrame } from '../../src/contract/batch-frame.js'
import { bridgeFixture } from '../bridge/fixture.js'
import { objectFixtureEndpoint } from '../bridge/json-object-fixture.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'

it.each([false, true])(
  '[A65][A72] actual JSON-RPC bridge fallback=%s refuses group without a JSON-RPC batch or member send',
  async (fallback) => {
    /** The independent raw JSON-RPC peer establishes a genuine negotiated bridge channel. */
    const fixture = bridgeFixture()
    const channel = await fixture.open()
    const endpoint = await objectFixtureEndpoint(channel, { fallback })
    try {
      const sender = readEndpointOwner<RpcOutboundSender>(endpoint, 'outbound-pipeline')!
      const writes = fixture.writes.length
      const messages = fixture.messages.length
      await assert.rejects(sender.sendRuntime(group(), runtimeOperationCapabilities('group')), {
        code: 'CAPABILITY_UNSUPPORTED'
      })
      assert.equal(fixture.writes.length, writes)
      assert.equal(fixture.messages.length, messages)
      assert.equal(fixture.messages.some(Array.isArray), false)
    } finally {
      await endpoint.dispose()
      await channel.close()
    }
  }
)

/** One complete group, independently normalized before using the original sender. */
function group(): IRpcRuntimeEnvelope {
  return normalizeRuntimeEnvelope({
    profile: 'migaia.rpc.runtime-api/1',
    kind: 'runtime-group',
    id: 'REQUEST:caller:1',
    route: {
      applicationVersion: '1',
      senderId: 'caller',
      targetId: 'provider',
      receiverId: 'provider',
      sentAt: 0
    },
    task: {
      mode: 'group',
      callerId: 'caller',
      callerGeneration: { kind: 'session', value: 0, providerId: 'caller' },
      targetGeneration: { kind: 'restart', value: 0, providerId: 'provider' }
    },
    options: {},
    steps: [{ method: 'first' }, { method: 'second', payload: 42 }]
  })
}

it('[A59][A64] native splitting and an opaque whole-frame wrapper both reject before the first physical send', async () => {
  let sends = 0
  let opaqueCalls = 0
  for (const selected of [
    createStringFramer({ chunkBytes: 8, maxMessageBytes: 4096 }),
    {
      ...messageFramerV1,
      frame: (value: unknown, context: { source: string; messageId: string }) => {
        opaqueCalls++
        return messageFramerV1.frame(value, context)
      }
    }
  ]) {
    const framer = selected as unknown as IRpcSelectedComponents['framer']
    const sender = new RpcOutboundSender(
      {
        platform: 'Memory',
        send: () => {
          sends++
        }
      },
      'caller',
      {
        protocol: rpcProtocolV1,
        codec: {
          id: 'test-json',
          version: 1,
          encodedType: 'string',
          encode: (value) => JSON.stringify(value),
          decode: (value) => JSON.parse(value as string)
        },
        framer,
        ingressPrepare: framing.bindRpcFrameIngress(framer.accept, framer.frame),
        shadowed: []
      }
    )
    await assert.rejects(
      async () => sender.sendRuntime(group(), runtimeOperationCapabilities('group')),
      { code: 'CAPABILITY_UNSUPPORTED' }
    )
  }
  assert.equal(sends, 0)
  assert.equal(
    opaqueCalls,
    0,
    '[A59] matching metadata and a one-frame result cannot substitute native proof'
  )
})

it('[A64] complete carrier at 16 MiB or a tighter channel limit sends once; one byte more never splits or sends', async () => {
  for (const limit of [512, 16 * 1024 * 1024]) {
    const frames: unknown[] = []
    const sender = new RpcOutboundSender(
      {
        platform: 'Memory',
        send: (frame) => {
          frames.push(frame)
        }
      },
      'caller',
      {
        protocol: rpcProtocolV1,
        codec: identityCodecV1 as unknown as IRpcSelectedComponents['codec'],
        framer: messageFramerV1,
        ingressPrepare: framing.bindRpcFrameIngress(messageFramerV1.accept, messageFramerV1.frame),
        shadowed: []
      },
      undefined,
      'Memory',
      undefined,
      undefined,
      false,
      false,
      limit
    )
    /** Charge full selector and all metadata, rather than only the group's payload bytes. */
    const empty = normalizeRuntimeEnvelope({ ...group(), steps: [{ method: 'echo', payload: '' }] })
    const overhead = measureRpcPhysicalFrame(wrapRuntimeCarrier(empty))
    assert.ok(overhead < limit)
    const exact = normalizeRuntimeEnvelope({
      ...empty,
      steps: [{ method: 'echo', payload: 'x'.repeat(limit - overhead) }]
    })
    assert.equal(measureRpcPhysicalFrame(wrapRuntimeCarrier(exact)), limit)
    await sender.sendRuntime(exact, runtimeOperationCapabilities('group'))
    assert.equal(frames.length, 1)
    const tooLarge = normalizeRuntimeEnvelope({
      ...empty,
      steps: [{ method: 'echo', payload: 'x'.repeat(limit - overhead + 1) }]
    })
    await assert.rejects(
      async () => sender.sendRuntime(tooLarge, runtimeOperationCapabilities('group')),
      { code: 'FRAME_LIMIT_EXCEEDED' }
    )
    assert.equal(frames.length, 1, '[A64] over-limit complete group has zero additional sends')
  }
})

it('[A59][A64] single-frame facts come from the actual paired native callables and once-read framing limits', () => {
  const read = Reflect.get(framing, 'readRpcSingleFrameFacts')
  assert.equal(
    typeof read,
    'function',
    '[A59][A64] original framing owner supplies bounded whole-frame facts'
  )
  let reads = 0
  const native = createStringFramer({
    chunkBytes: 8,
    maxMessageBytes: 32,
    get maxConcurrentMessages() {
      reads++
      return 3
    }
  })
  assert.equal(reads, 1)
  assert.deepEqual(read(native.accept, native.frame), {
    maxConcurrentMessages: 3,
    maxMessageBytes: 32
  })
  assert.equal(reads, 1, '[A59] runtime selection never rereads user framing options')
  assert.equal(
    read(() => ({ status: 'pending' }), native.frame),
    undefined
  )
  assert.equal(
    read(native.accept, () => ['opaque']),
    undefined
  )
  assert.ok(read(messageFramerV1.accept, messageFramerV1.frame))
})

it('[A64][A73] one complete group uses the original codec/protect/write once and missing capabilities send nothing', async () => {
  const frames: unknown[] = []
  let protects = 0
  const components: IRpcSelectedComponents = {
    protocol: rpcProtocolV1,
    codec: identityCodecV1 as unknown as IRpcSelectedComponents['codec'],
    framer: messageFramerV1,
    ingressPrepare: framing.bindRpcFrameIngress(messageFramerV1.accept, messageFramerV1.frame),
    shadowed: []
  }
  const sender = new RpcOutboundSender(
    {
      platform: 'Memory',
      send: (frame) => {
        frames.push(frame)
      }
    },
    'caller',
    components,
    {
      enabled: true,
      encodedType: 'any',
      protect: (value) => {
        protects++
        return value
      },
      unprotect: (value) => value
    }
  )
  assert.equal(
    typeof Reflect.get(sender, 'sendRuntime'),
    'function',
    '[A64] original sender provides an independent prepared single-frame port'
  )
  const send = sender as RpcOutboundSender & {
    sendRuntime(message: IRpcRuntimeEnvelope, capabilities: readonly string[]): Promise<void>
  }
  const required = runtimeOperationCapabilities('group')
  for (const missing of required)
    await assert.rejects(
      async () =>
        send.sendRuntime(
          group(),
          required.filter((value) => value !== missing)
        ),
      { code: 'CAPABILITY_UNSUPPORTED' }
    )
  assert.equal(frames.length, 0)
  assert.equal(protects, 0)
  await send.sendRuntime(group(), required)
  assert.equal(frames.length, 1)
  assert.equal(protects, 1, '[A64] the complete semantic group is protected once')
  assert.deepEqual(readRuntimeCarrier(frames[0])?.frame, group())
})
