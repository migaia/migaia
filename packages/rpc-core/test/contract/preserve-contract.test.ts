import assert from 'node:assert/strict'
import { it } from 'vitest'
import { normalizePortable, type IRpcEnvelope } from '@migaia/rpc-contract'
import {
  createOutboundEnvelope,
  materializeOutboundJson
} from '../../dist/core/internal/outbound-envelope.js'
import {
  createRuntimeBytePipeline,
  runtimeMessagePipeline as messageProcessPipeline
} from '../../dist/runtime-adapter/byte/pipeline.js'
import { createRuntimeObjectPipeline } from '../../dist/runtime-adapter/object/pipeline.js'
import {
  wrapAuthenticationEnvelope,
  readAuthenticationEnvelope,
  RpcAuthenticationEnvelope
} from '../../dist/core/middleware/authentication-envelope.js'

/** Preserve byte-for-byte vectors through the same canonical generic codec. */
const remoteProcessJsonCodec = createRuntimeBytePipeline('json-wire-fixture').codec

/** Build an ordinary legal envelope without minting any private outbound snapshot provenance. */
function createPlainEnvelope(reads: string[]): IRpcEnvelope {
  /** Reused children expose traversal order and prove each occurrence is read independently. */
  const shared = {
    get z() {
      reads.push('shared.z')
      return 3
    },
    get a() {
      reads.push('shared.a')
      return 4
    }
  }
  return {
    kind: 'request',
    id: 'plain-wire',
    method: 'echo',
    data: {
      route: {
        profile: 'migaia.rpc.route',
        type: 'request',
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        sentAt: 0
      },
      payload: {
        get b() {
          reads.push('b')
          return shared
        },
        get '10'() {
          reads.push('10')
          return 10
        },
        get a() {
          reads.push('a')
          return shared
        },
        get '2'() {
          reads.push('2')
          return 2
        }
      }
    }
  }
}

it('ordinary byte and object fallbacks retain own field and getter order', () => {
  /** Both actual descriptors consume the same unowned caller envelope through their fallback. */
  const reads: string[] = []
  /** Plain input retains integer-key enumeration and reversed text-key insertion at two levels. */
  const envelope = createPlainEnvelope(reads)
  /** One portable admission precedes each format's own projection of the original getters. */
  const admittedReads = ['2', '10', 'b', 'shared.z', 'shared.a', 'a', 'shared.z', 'shared.a']
  /** Both canonical descriptors preserve the admitted portable input's own-key order. */
  const objectCodec = createRuntimeObjectPipeline('json-wire-fixture').codec
  /** The byte fallback delegates to the selected JSON codec's property enumeration order. */
  const wire = remoteProcessJsonCodec.encode(envelope)
  assert.equal(
    wire,
    '{"kind":"request","id":"plain-wire","method":"echo","data":{"route":{"profile":"migaia.rpc.route","type":"request","applicationVersion":"1","senderId":"a","targetId":"b","sentAt":0},"payload":{"2":2,"10":10,"b":{"z":3,"a":4},"a":{"z":3,"a":4}}}}'
  )
  assert.deepEqual(reads, [...admittedReads, ...admittedReads], 'byte admission and projection')
  reads.length = 0
  /** Object materialization retains the same traversal while integer output keys enumerate first. */
  const object = objectCodec.encode(envelope)
  assert.equal(
    JSON.stringify(object),
    '{"kind":"request","id":"plain-wire","method":"echo","data":{"route":{"profile":"migaia.rpc.route","type":"request","applicationVersion":"1","senderId":"a","targetId":"b","sentAt":0},"payload":{"2":2,"10":10,"b":{"z":3,"a":4},"a":{"z":3,"a":4}}}}'
  )
  assert.deepEqual(reads, [...admittedReads, ...admittedReads], 'object admission and projection')
  /** Caller getter failure stays outside either format's error-normalization boundary. */
  const original = new Error('plain envelope getter failed')
  /** The failing data getter is reachable during the same ordinary admission path. */
  const failing: IRpcEnvelope = {
    ...envelope,
    data: {
      ...envelope.data,
      get payload(): never {
        throw original
      }
    }
  }
  assert.throws(
    () => remoteProcessJsonCodec.encode(failing),
    (error) => error === original
  )
  assert.throws(
    () => objectCodec.encode(failing),
    (error) => error === original
  )
})

it('two portable inputs preserve null prototypes, frozen own snapshots and shared getter order', () => {
  /** Both inputs independently reuse one nested caller object; admission snapshots each occurrence. */
  const reads: string[] = []
  /** Caller-owned nested object appears twice and must receive independent immutable snapshots. */
  const shared = {
    get value() {
      reads.push('shared.value')
      return 7
    }
  }
  /** Two independent graphs exercise repeated references and nested getter capture. */
  const inputs = [
    {
      get z() {
        reads.push('first.z')
        return shared
      },
      get a() {
        reads.push('first.a')
        return shared
      }
    },
    {
      get second() {
        reads.push('second.second')
        return {
          get child() {
            reads.push('second.child')
            return shared
          }
        }
      },
      get first() {
        reads.push('second.first')
        return shared
      }
    }
  ]
  /** Canonical admission outputs are inspected without re-reading caller input. */
  const outputs = inputs.map((input) => normalizePortable(input)) as Record<string, unknown>[]
  assert.deepEqual(
    reads,
    [
      'first.z',
      'first.a',
      'shared.value',
      'shared.value',
      'second.second',
      'second.first',
      'second.child',
      'shared.value',
      'shared.value'
    ],
    'complete getter order'
  )
  for (const output of outputs) {
    assert.equal(Object.getPrototypeOf(output), null, 'null prototype')
    assert.equal(Object.isFrozen(output), true)
    assert.equal(Object.hasOwn(output, 'toString'), false)
    for (const child of Object.values(output)) {
      assert.equal(Object.getPrototypeOf(child), null)
      assert.equal(Object.isFrozen(child), true)
    }
  }
  assert.deepEqual(Object.keys(outputs[0]!), ['z', 'a'])
  assert.notEqual(outputs[0]!.z, shared, 'never publish validated caller object')
  assert.notEqual(outputs[0]!.z, outputs[0]!.a, 'preserve independent repeated-reference snapshots')
  assert.equal(Object.hasOwn(outputs[1]!, 'second'), true)
  assert.equal(Object.isFrozen((outputs[1]!.second as Record<string, unknown>).child), true)
})

it('process JSON and Worker signer input preserve integer keys, own text-key order and getter order', () => {
  /**
   * Deliberately reversed text keys and integer keys distinguish semantic sorting from insertion
   * order.
   */
  const reads: string[] = []
  /** Two-level caller data distinguishes graph traversal from metadata-only work. */
  const payload = {
    get z() {
      reads.push('z')
      return 1
    },
    get '10'() {
      reads.push('10')
      return 10
    },
    get a() {
      reads.push('a')
      return { z: 3, a: 2 }
    },
    get '2'() {
      reads.push('2')
      return 2
    }
  }
  /** Canonical outbound owner mints the private snapshot consumed by actual codecs. */
  const envelope = createOutboundEnvelope({
    kind: 'request',
    id: 'fixture-wire',
    method: 'echo',
    data: {
      route: {
        profile: 'migaia.rpc.route',
        type: 'request',
        applicationVersion: '1',
        senderId: 'a',
        targetId: 'b',
        sentAt: 0
      },
      payload
    }
  })
  assert.deepEqual(reads, ['2', '10', 'z', 'a'], 'caller getter order unchanged')
  /** Actual process codec output is compared byte-for-byte with the preserved wire spelling. */
  const wire = remoteProcessJsonCodec.encode(envelope) as string
  /** Pinned complete wire vector includes integer-key enumeration and own text-key order. */
  const expected =
    '{"kind":"request","id":"fixture-wire","method":"echo","data":{"route":{"profile":"migaia.rpc.route","type":"request","applicationVersion":"1","senderId":"a","targetId":"b","sentAt":0},"payload":{"2":2,"10":10,"z":1,"a":{"z":3,"a":2}}}}'
  assert.equal(wire, expected, 'exact process JSON wire')
  assert.equal(remoteProcessJsonCodec.encode(envelope), expected, 'prepared owned JSON wire')
  assert.deepEqual(materializeOutboundJson(envelope), JSON.parse(expected))
  assert.equal(
    JSON.stringify(createRuntimeObjectPipeline('json-wire-fixture').codec.encode(envelope)),
    expected,
    'owned object codec keeps own key order'
  )
  assert.equal(
    messageProcessPipeline.codec.encode(envelope),
    envelope,
    'Worker identity codec retains admitted snapshot'
  )
  /** Public fixture nonce pins signed grammar without any real credential. */
  const nonce = 'a'.repeat(32)
  /** Actual authentication wrapper receives the exact process wire string. */
  const processSignedInput = wrapAuthenticationEnvelope(wire, nonce, 1n)
  assert.equal(
    processSignedInput,
    RpcAuthenticationEnvelope.prefix +
      JSON.stringify({
        authentication: RpcAuthenticationEnvelope.kind,
        version: 1,
        nonce,
        counter: '1',
        payload: expected
      }),
    'exact signer string input'
  )
  /** Identity carrier signs the existing admitted snapshot without extra caller reads. */
  const workerSignedInput = wrapAuthenticationEnvelope(envelope, nonce, 1n) as { payload: unknown }
  assert.equal(
    workerSignedInput.payload,
    envelope,
    'Worker signer receives original admitted snapshot'
  )
  assert.deepEqual(reads, ['2', '10', 'z', 'a'], 'signing does not re-read caller getters')
})

it('string and Uint8Array signed grammar keeps binding fields, category and strict version admission', () => {
  /** Public fixture nonce pins signed grammar without any real credential. */
  const nonce = 'b'.repeat(32)
  for (const payload of ['signed-text', new Uint8Array([0, 127, 255])]) {
    /** Canonical protected value retains its original transform category. */
    const signed = wrapAuthenticationEnvelope(payload, nonce, 23n)
    assert.equal(signed instanceof Uint8Array, payload instanceof Uint8Array)
    /** Decode fixture bytes only to assert the complete signed grammar. */
    const text =
      signed instanceof Uint8Array ? new TextDecoder().decode(signed) : (signed as string)
    assert.ok(text.startsWith(RpcAuthenticationEnvelope.prefix))
    /** Read each canonical binding field and its payload from the protected vector. */
    const bound = JSON.parse(text.slice(RpcAuthenticationEnvelope.prefix.length))
    assert.deepEqual(Object.keys(bound), [
      'authentication',
      'version',
      'nonce',
      'counter',
      'payload'
    ])
    assert.deepEqual(bound, {
      authentication: RpcAuthenticationEnvelope.kind,
      version: 1,
      nonce,
      counter: '23',
      payload: payload instanceof Uint8Array ? [...payload] : payload
    })
    assert.deepEqual(readAuthenticationEnvelope(signed).payload, payload)
    /** A cryptographically signed future version remains grammatically unsupported. */
    const tampered = RpcAuthenticationEnvelope.prefix + JSON.stringify({ ...bound, version: 2 })
    assert.throws(
      () =>
        readAuthenticationEnvelope(
          payload instanceof Uint8Array ? new TextEncoder().encode(tampered) : tampered
        ),
      { code: 'AUTHENTICATION_FAILED' },
      'unsupported signed version fails closed'
    )
  }
})
