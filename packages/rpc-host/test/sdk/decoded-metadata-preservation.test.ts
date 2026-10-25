import assert from 'node:assert/strict'
import { it } from 'vitest'
import {
  normalizeRpcFrame,
  normalizeRpcPortable,
  type IRpcEnvelope
} from '@migaia/rpc-contract/protocol'
import { prepareRpcBinary, restoreRpcBinary, RpcBinaryStorage } from '../../dist/sdk/wire/binary.js'

/** One owner-independent wire fixture reaches the full shared runtime grammar through JSON decoding. */
function wireInput(): Record<string, unknown> {
  return {
    profile: 'migaia.rpc/2',
    kind: 'call',
    id: 'decoded-call',
    route: {
      applicationVersion: '1',
      senderId: 'caller',
      targetId: 'provider',
      receiverId: 'provider',
      sentAt: 0
    },
    task: {
      mode: 'request',
      method: 'echo',
      callerId: 'caller',
      callerGeneration: { kind: 'session', value: 0, providerId: 'caller' },
      targetGeneration: { kind: 'session', value: 0, providerId: 'provider' }
    },
    options: {},
    payload: { message: 'decoded' }
  }
}

/** Capture the observable contract error for comparison; a successful invalid input fails the test. */
async function failure(operation: () => unknown): Promise<TypeError> {
  try {
    await operation()
  } catch (error) {
    assert.ok(error instanceof TypeError)
    return error
  }
  assert.fail('invalid decoded fixture was accepted')
}

it('codec-decoded data preserves known results and original metadata records', async () => {
  /** Both parsers receive the same ordinary codec result, without an input trust flag. */
  const decoded = JSON.parse(JSON.stringify(wireInput())) as unknown
  /** Strict output is the existing contract oracle, rather than a copied expected grammar. */
  const strict = normalizeRpcFrame(decoded)
  assert.ok('task' in strict)
  /** This entry represents the actual decoder owner's selected operation. */
  const prepared = await prepareRpcBinary(strict, { storage: RpcBinaryStorage.inline })
  /** The codec's decoded metadata, rather than a validator snapshot, owns these record identities. */
  const manifest = JSON.parse(JSON.stringify(prepared.manifest))
  const fast = await restoreRpcBinary(manifest, {
    storage: RpcBinaryStorage.inline
  })
  assert.ok(strict.kind === 'call')
  assert.deepEqual(fast, { ...strict, payload: normalizeRpcPortable(strict.payload) })
  assert.equal(Object.getPrototypeOf(fast.route), Object.prototype)
  assert.equal(Object.getPrototypeOf(fast.task), Object.prototype)
  assert.equal(strict, decoded)
  assert.equal(fast.route, manifest.envelope.route)
  assert.equal(fast.task, manifest.envelope.task)
})

it.each(['unknown', 'type', 'missing', 'ordered-errors'] as const)(
  'decoded %s metadata retains known-field admission and native failures',
  async (shape) => {
    /** Mutations represent malformed decoded data, never a getter or proxy shortcut. */
    const input = wireInput()
    /** The route shape is deliberately ordinary so the single-pass reader is exercised. */
    const route = input.route as Record<string, unknown>
    if (shape === 'unknown') route.foreign = true
    else if (shape === 'type') route.senderId = 123
    else if (shape === 'missing') delete route.applicationVersion
    else {
      delete route.applicationVersion
      route.senderId = 123
    }
    /** A real JSON result fixes property ownership and strips live object machinery. */
    const decoded = JSON.parse(JSON.stringify(input)) as unknown
    if (shape === 'unknown') {
      /** BC9 ignores the extra field without making a metadata copy. */
      assert.equal(normalizeRpcFrame(decoded), decoded)
      const prepared = await prepareRpcBinary(decoded as IRpcEnvelope, {
        storage: RpcBinaryStorage.inline
      })
      const restored = await restoreRpcBinary(prepared.manifest, {
        storage: RpcBinaryStorage.inline
      })
      assert.deepEqual(restored.route, (decoded as IRpcEnvelope).route)
      return
    }
    /** Existing strict admission defines the unchanged native error/cause/pointer contract. */
    const expected = await failure(() => normalizeRpcFrame(decoded))
    /** Fast admission must preserve the same first observable failure. */
    const prepared = await prepareRpcBinary(normalizeRpcFrame(wireInput()) as IRpcEnvelope, {
      storage: RpcBinaryStorage.inline
    })
    const actual = await failure(() =>
      restoreRpcBinary(
        { ...prepared.manifest, envelope: decoded },
        { storage: RpcBinaryStorage.inline }
      )
    )
    assert.equal(actual.constructor, expected.constructor)
    assert.equal(Reflect.get(actual, 'source'), Reflect.get(expected, 'source'))
    assert.equal(Reflect.get(actual, 'code'), Reflect.get(expected, 'code'))
    assert.equal(actual.message, expected.message)
    assert.equal(Reflect.get(actual, 'pointer'), Reflect.get(expected, 'pointer'))
    assert.ok(actual.cause instanceof TypeError)
    assert.equal(Reflect.get(actual.cause, 'source'), Reflect.get(expected, 'source'))
    assert.equal(Reflect.get(actual.cause, 'code'), Reflect.get(expected, 'code'))
    assert.equal(Reflect.get(actual.cause, 'pointer'), Reflect.get(expected, 'pointer'))
  }
)

it.each([new Date(0), new Map()] as const)(
  'metadata records use known fields without a prototype gate',
  async (route) => {
    /** BC9 validates known metadata fields independently from Date/Map prototypes. */
    const decoded = { ...wireInput(), route }
    /** The known fields are valid independently from the metadata object's native prototype. */
    Object.assign(route, wireInput().route)
    /** The canonical admission provides the operational type without inventing another input gate. */
    const admitted = normalizeRpcFrame(decoded)
    assert.equal(admitted, decoded)
    assert.ok('task' in admitted)
    const prepared = await prepareRpcBinary(admitted, {
      storage: RpcBinaryStorage.inline
    })
    const restored = await restoreRpcBinary(prepared.manifest, { storage: RpcBinaryStorage.inline })
    assert.equal(restored.route, route)
  }
)

it('live metadata reads its known accessor instead of rejecting the descriptor', () => {
  /** The canonical public protocol entry owns live in-process object admission. */
  const input = wireInput()
  /** BC9 explicitly permits direct known-field reads in this shared in-process trust domain. */
  let reads = 0
  Object.defineProperty(input, 'id', {
    enumerable: true,
    get: () => {
      reads++
      return 'forged-call'
    }
  })
  assert.equal(normalizeRpcFrame(input), input)
  assert.ok(reads > 0)
})
