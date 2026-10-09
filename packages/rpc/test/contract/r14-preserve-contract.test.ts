import assert from 'node:assert/strict'
import { it } from 'vitest'
import { normalizePortable } from '../../src/contract/normalize.js'
import {
  createOutboundEnvelope,
  materializeOutboundJson
} from '../../src/core/internal/outbound-envelope.js'
import { remoteProcessJsonCodec, messageProcessPipeline } from '../../src/process/pipeline.js'
import {
  wrapAuthenticationEnvelope,
  readAuthenticationEnvelope,
  RpcAuthenticationEnvelope
} from '../../src/core/middleware/authentication-envelope.js'

it('[R14-A22] two portable inputs preserve null prototypes, frozen own snapshots and shared getter order', () => {
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
    '[R14-A22] complete getter order'
  )
  for (const output of outputs) {
    assert.equal(Object.getPrototypeOf(output), null, '[R14-A22] null prototype')
    assert.equal(Object.isFrozen(output), true)
    assert.equal(Object.hasOwn(output, 'toString'), false)
    for (const child of Object.values(output)) {
      assert.equal(Object.getPrototypeOf(child), null)
      assert.equal(Object.isFrozen(child), true)
    }
  }
  assert.deepEqual(Object.keys(outputs[0]!), ['z', 'a'])
  assert.notEqual(outputs[0]!.z, shared, '[R14-A22] never publish validated caller object')
  assert.notEqual(
    outputs[0]!.z,
    outputs[0]!.a,
    '[R14-A22] preserve independent repeated-reference snapshots'
  )
  assert.equal(Object.hasOwn(outputs[1]!, 'second'), true)
  assert.equal(Object.isFrozen((outputs[1]!.second as Record<string, unknown>).child), true)
})

it('[R14-A23] process JSON and Worker signer input preserve integer keys, sorted owned keys and getter order', () => {
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
    id: 'r14-wire',
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
  assert.deepEqual(reads, ['2', '10', 'z', 'a'], '[R14-A23] caller getter order unchanged')
  /** Actual process codec output is compared byte-for-byte with the preserved wire spelling. */
  const wire = remoteProcessJsonCodec.encode(envelope) as string
  /** Pinned complete wire vector includes integer-key enumeration and sorted record keys. */
  const expected =
    '{"data":{"payload":{"2":2,"10":10,"a":{"a":2,"z":3},"z":1},"route":{"applicationVersion":"1","profile":"migaia.rpc.route","senderId":"a","sentAt":0,"targetId":"b","type":"request"}},"id":"r14-wire","kind":"request","method":"echo"}'
  assert.equal(wire, expected, '[R14-A23] exact process JSON wire')
  assert.deepEqual(materializeOutboundJson(envelope), JSON.parse(expected))
  assert.equal(
    messageProcessPipeline.codec.encode(envelope),
    envelope,
    '[R14-A23] Worker identity codec retains admitted snapshot'
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
    '[R14-A23] exact signer string input'
  )
  /** Identity carrier signs the existing admitted snapshot without extra caller reads. */
  const workerSignedInput = wrapAuthenticationEnvelope(envelope, nonce, 1n) as { payload: unknown }
  assert.equal(
    workerSignedInput.payload,
    envelope,
    '[R14-A23] Worker signer receives original admitted snapshot'
  )
  assert.deepEqual(
    reads,
    ['2', '10', 'z', 'a'],
    '[R14-A23] signing does not re-read caller getters'
  )
})

it('[R14-A24] string and Uint8Array signed grammar keeps binding fields, category and strict version admission', () => {
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
      '[R14-A24] unsupported signed version fails closed'
    )
  }
})
