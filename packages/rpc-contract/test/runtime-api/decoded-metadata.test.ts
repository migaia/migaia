import assert from 'node:assert/strict'
import { it } from 'vitest'
import {
  normalizeRuntimeEnvelope,
  normalizeRuntimeEnvelopeDecoded
} from '../../dist/contract/runtime-api/index.js'

/** One owner-independent wire fixture reaches the full shared runtime grammar through JSON decoding. */
function wireInput(): Record<string, unknown> {
  return {
    profile: 'migaia.rpc.runtime-api/1',
    kind: 'runtime-call',
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
function failure(operation: () => unknown): TypeError {
  try {
    operation()
  } catch (error) {
    assert.ok(error instanceof TypeError)
    return error
  }
  assert.fail('invalid decoded fixture was accepted')
}

it('codec-decoded data keeps the strict result, prototypes and frozen metadata', () => {
  /** Both parsers receive the same ordinary codec result, without an input trust flag. */
  const decoded = JSON.parse(JSON.stringify(wireInput())) as unknown
  /** Strict output is the existing contract oracle, rather than a copied expected grammar. */
  const strict = normalizeRuntimeEnvelope(decoded)
  /** This entry represents the actual decoder owner's selected operation. */
  const fast = normalizeRuntimeEnvelopeDecoded(decoded)
  assert.deepEqual(fast, strict)
  assert.equal(Object.getPrototypeOf(fast.route), Object.prototype)
  assert.equal(Object.getPrototypeOf(fast.task), Object.prototype)
  assert.ok(Object.isFrozen(fast) && Object.isFrozen(fast.route) && Object.isFrozen(fast.task))
})

it.each(['unknown', 'type', 'missing', 'ordered-errors'] as const)(
  'decoded %s rejection retains native identity and the original pointer text',
  (shape) => {
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
    /** Existing strict admission defines the unchanged native error/cause/pointer contract. */
    const expected = failure(() => normalizeRuntimeEnvelope(decoded))
    /** Fast admission must preserve the same first observable failure. */
    const actual = failure(() => normalizeRuntimeEnvelopeDecoded(decoded))
    assert.equal(actual.constructor, expected.constructor)
    assert.equal(Reflect.get(actual, 'source'), Reflect.get(expected, 'source'))
    assert.equal(Reflect.get(actual, 'code'), Reflect.get(expected, 'code'))
    assert.equal(actual.message, expected.message)
    assert.equal(actual.cause, expected.cause)
  }
)

it.each([new Date(0), new Map()] as const)(
  'native clone built-in records retain the strict prototype rejection',
  (route) => {
    /**
     * Structured clone preserves built-in prototypes; codec provenance cannot admit them as
     * records.
     */
    const decoded = structuredClone({ ...wireInput(), route })
    /** Ordinary-record admission must fail at /route before missing-field errors. */
    const expected = failure(() => normalizeRuntimeEnvelope(decoded))
    /** The decoded reader checks the same prototype without allocating descriptors. */
    const actual = failure(() => normalizeRuntimeEnvelopeDecoded(decoded))
    assert.equal(actual.message, expected.message)
    assert.equal(Reflect.get(actual, 'code'), Reflect.get(expected, 'code'))
  }
)

it('live objects use strict admission and reject an accessor without invoking it', () => {
  /** The old public entry still owns all live in-process object validation. */
  const input = wireInput()
  /** Accessor execution would be an observable behaviour change at the strict boundary. */
  let reads = 0
  Object.defineProperty(input, 'id', {
    enumerable: true,
    get: () => {
      reads++
      return 'forged-call'
    }
  })
  failure(() => normalizeRuntimeEnvelope(input))
  assert.equal(reads, 0)
})
