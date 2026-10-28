/** Byte order and binding receivers use the current codec and authentication owners. */
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { normalizePortable } from '@migaia/rpc-contract'
import type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'
import { jsonParser } from '@migaia/serialize/plugins'
import { RpcJsonCarrierCodec } from '../../dist/sdk/carrier/json-codec.js'
import {
  wrapAuthenticationEnvelope,
  readAuthenticationEnvelope
} from '../../dist/features/auth/envelope.js'
import { AuthenticationRepresentation } from '../../dist/features/auth/representation.js'
import { RpcAuthenticationEnvelope } from '../../dist/features/auth/constants.js'
import { codecContext, request } from '../core/fixtures/outbound-proof-candidate.ts'

/** The standalone public serialize parser receives its actual immutable fixture context. */
const serializeContext = { signal: new AbortController().signal, context: 'wire-order-fixture' }

it('current JSON preparation reads each getter once per occurrence, level by level, without a second caller traversal', async () => {
  /** Reused children retain original descriptor order at each independently captured occurrence. */
  const reads: string[] = []
  /** Both occurrences belong to the original caller graph, never a test-owned snapshot. */
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
  /** One legal current envelope exercises exactly the original payload property arrangement. */
  const envelope: IRpcEnvelope = {
    ...request(),
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
  /** The actual executing codec is the sole sender capture and JSON projection owner. */
  const codec = new RpcJsonCarrierCodec()
  /** Successful preparation is reused by each actual encoding without re-reading caller getters. */
  const prepared = await codec.prepare(envelope, codecContext)
  assert.deepEqual(reads, ['2', '10', 'b', 'a', 'shared.z', 'shared.a', 'shared.z', 'shared.a'])
  /** The selected serialize JSON implementation is the canonical byte-for-byte output oracle. */
  const expected = JSON.stringify(prepared.message)
  assert.deepEqual(jsonParser().encode(prepared.message, serializeContext), ['text', expected])
  assert.equal(codec.encode(prepared, codecContext).data, expected)
  assert.equal(codec.encode(prepared, codecContext).data, expected)
  assert.equal(
    JSON.stringify((prepared.message as Extract<IRpcEnvelope, { kind: 'call' }>).payload),
    '{"2":2,"10":10,"b":{"z":3,"a":4},"a":{"z":3,"a":4}}'
  )
  assert.deepEqual(reads, ['2', '10', 'b', 'a', 'shared.z', 'shared.a', 'shared.z', 'shared.a'])
})

it('retains the exact original payload getter failure through current preparation', async () => {
  /** This is the real media codec rather than a legacy fallback alias. */
  const codec = new RpcJsonCarrierCodec()
  /** Original getter failure remains the exact observable thrown value through real admission. */
  const original = new Error('plain envelope getter failed')
  /** The same original hostile getter reaches the current metadata capture boundary. */
  const failing: IRpcEnvelope = {
    ...request(),
    get payload(): never {
      throw original
    }
  }
  await assert.rejects(codec.prepare(failing, codecContext), (error) => error === original)
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

it('process JSON and signer metadata preserve integer keys, own text-key order and one getter capture', async () => {
  /** Reversed text keys and integer keys distinguish ordinary enumeration from sorting. */
  const reads: string[] = []
  /** The original two-level caller graph is captured by the executing codec once. */
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
  /** Actual media preparation replaces the removed owned-envelope factory. */
  const codec = new RpcJsonCarrierCodec()
  /** No payload getter is read by this fixture before the real codec does so. */
  const prepared = await codec.prepare({ ...request(), payload }, codecContext)
  assert.deepEqual(reads, ['2', '10', 'z', 'a'], 'caller getter order unchanged')
  /** The unchanged serialize encoder is the full current-profile byte oracle. */
  const expected = JSON.stringify(prepared.message)
  assert.deepEqual(jsonParser().encode(prepared.message, serializeContext), ['text', expected])
  assert.equal(codec.encode(prepared, codecContext).data, expected, 'exact process JSON wire')
  assert.equal(codec.encode(prepared, codecContext).data, expected, 'prepared JSON wire')
  assert.equal(
    JSON.stringify((prepared.message as Extract<IRpcEnvelope, { kind: 'call' }>).payload),
    '{"2":2,"10":10,"z":1,"a":{"z":3,"a":2}}'
  )
  /** The fixture nonce is public, deterministic data rather than a credential. */
  const nonce = 'a'.repeat(32)
  /** Authentication binds the same prepared metadata instead of a second business projection. */
  const binding = wrapAuthenticationEnvelope(prepared.message, nonce, 1n)
  assert.equal(binding.payload, prepared.message, 'binding retains original prepared metadata')
  /** Explicit string callbacks receive the canonical prefix and original five binding fields. */
  const representation = new AuthenticationRepresentation('string')
  assert.equal(
    representation.bound(binding),
    RpcAuthenticationEnvelope.prefix +
      JSON.stringify({
        authentication: RpcAuthenticationEnvelope.kind,
        version: 1,
        nonce,
        counter: '1',
        payload: prepared.message
      }),
    'exact signer string input'
  )
  assert.deepEqual(reads, ['2', '10', 'z', 'a'], 'signing does not re-read caller getters')
})

it('string and Uint8Array signed metadata keep binding fields, category and strict version admission', () => {
  /** Original binding bytes stay deterministic across the two supported callback categories. */
  const nonce = 'b'.repeat(32)
  for (const encoding of ['string', 'uint8array'] as const) {
    /** The real representation owner controls the configured transform category. */
    const representation = new AuthenticationRepresentation(encoding)
    /** Binary business metadata has already been prepared before authentication executes. */
    const payload = { text: 'signed-text', bytes: [0, 127, 255] }
    /** The actual authentication owner mints the original nonce/counter field order. */
    const binding = wrapAuthenticationEnvelope(payload, nonce, 23n)
    /** Public callback inputs preserve their configured string or byte category. */
    const signed = representation.bound(binding)
    assert.equal(signed instanceof Uint8Array, encoding === 'uint8array')
    /** Decode fixture bytes only to inspect the exact signed binding. */
    const text =
      signed instanceof Uint8Array ? new TextDecoder().decode(signed) : (signed as string)
    assert.ok(text.startsWith(RpcAuthenticationEnvelope.prefix))
    /** Actual signed JSON preserves the five stable binding fields in their original order. */
    const bound = JSON.parse(text.slice(RpcAuthenticationEnvelope.prefix.length))
    assert.deepEqual(Object.keys(bound), [
      'authentication',
      'version',
      'nonce',
      'counter',
      'payload'
    ])
    /** Single encoding retains object payload order in both text and UTF-8 callback categories. */
    const expectedBinding = {
      authentication: RpcAuthenticationEnvelope.kind,
      version: 1,
      nonce,
      counter: '23',
      payload
    }
    assert.deepEqual(bound, expectedBinding)
    assert.equal(
      text,
      RpcAuthenticationEnvelope.prefix + JSON.stringify(expectedBinding),
      'exact single-encoded signed metadata'
    )
    assert.deepEqual(
      representation.metadata(readAuthenticationEnvelope(representation.plaintext(signed)).payload),
      payload
    )
    /** Unsupported binding versions retain the original public authentication error code. */
    const tampered = RpcAuthenticationEnvelope.prefix + JSON.stringify({ ...bound, version: 2 })
    assert.throws(
      () =>
        readAuthenticationEnvelope(
          representation.plaintext(
            encoding === 'uint8array' ? new TextEncoder().encode(tampered) : tampered
          )
        ),
      { code: 'AUTHENTICATION_FAILED' },
      'unsupported signed version fails closed'
    )
  }
})
