import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { it } from 'vitest'
import * as contract from '../../src/contract/runtime-api/index.js'
import { RpcError, RpcCoreErrorCode } from '../../src/core/errors.js'
import { serializeRpcError } from '../../src/contract/error.js'
import { RpcCoreErrorText } from '../../src/core/error-text.js'

it('[A69][A73] failed read-only lookup returns an exact same-task terminal error without fabricating an outcome', () => {
  /** The original error chain is serialized by the existing package boundary owner. */
  const failure = serializeRpcError(
    new RpcError(RpcCoreErrorCode.capabilityUnsupported, RpcCoreErrorText.capabilityUnsupported),
    {
      report: (failure) => {
        throw failure.error
      }
    }
  )
  const value = {
    ...common('outcome'),
    kind: 'runtime-control',
    operation: 'terminal',
    completion: { ok: false, error: failure }
  }
  assert.deepEqual(parser()(value), value, '[A69] lookup failure must settle its original query')
  assert.throws(() => parser()({ ...value, completion: { ok: true } }), {
    code: 'INVALID_ENVELOPE'
  })
  assert.throws(() => parser()({ ...value, operation: 'cancel', reason: failure }), {
    code: 'INVALID_ENVELOPE'
  })
})

it('[A73][A74] the new profile schema and independent vectors share the same closed contract', () => {
  /** Existence is asserted before reading so absence is a semantic RED, not a loader failure. */
  const path = new URL('../../schema/runtime-api.schema.json', import.meta.url)
  assert.equal(existsSync(path), true, '[A74] runtime union has its owning wire schema')
  const schema = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(schema.$id, 'migaia.rpc.runtime-api/1')
  const vectorPath = new URL('../../schema/vectors/runtime-api.json', import.meta.url)
  assert.equal(existsSync(vectorPath), true, '[A74] new union has independent normative vectors')
  const vectors = JSON.parse(readFileSync(vectorPath, 'utf8')) as {
    valid: unknown[]
    invalid: unknown[]
  }
  for (const value of vectors.valid) parser()(value)
  for (const value of vectors.invalid) assert.throws(() => parser()(value))
})

it('[A73] each requested operation requires every actual capability without filling an offer closure', () => {
  const required = Reflect.get(contract, 'runtimeOperationCapabilities')
  assert.equal(
    typeof required,
    'function',
    '[A73] the contract owns one exact capability dependency table'
  )
  for (const [mode, options, expected] of [
    ['request', {}, ['runtime-api@1', 'generation@1']],
    [
      'group',
      { orderKey: 'order', cancel: 'before-start', idempotencyKey: 'key' },
      ['runtime-api@1', 'generation@1', 'group@1', 'order@1', 'cancel-before-start@1', 'outcome@1']
    ],
    [
      'stream',
      { cancel: 'before-start', idempotencyKey: 'key', timeoutMs: 1 },
      ['runtime-api@1', 'generation@1', 'stream@1', 'cancel-before-start@1', 'outcome@1']
    ],
    ['outcome', {}, ['runtime-api@1', 'generation@1', 'outcome@1']],
    ['notify', { timeoutMs: 1 }, ['runtime-api@1', 'generation@1', 'deadline@1']]
  ] as const)
    assert.deepEqual(required(mode, options), expected)
  assert.deepEqual(required('request', {}, true), ['runtime-api@1', 'generation@1', 'abort@1'])
})

/** The existing contract entry permits a semantic RED before the new parser is implemented. */
function parser(): (value: unknown) => unknown {
  const normalize = Reflect.get(contract, 'normalizeRuntimeEnvelope')
  assert.equal(
    typeof normalize,
    'function',
    '[A73][A75] the contract owns the complete runtime union'
  )
  return normalize
}

/** One actual-hop tuple, with separate execution and connection generation domains. */
function common(mode = 'request') {
  return {
    profile: 'migaia.rpc.runtime-api/1',
    id: 'REQUEST:caller:1',
    route: {
      applicationVersion: '1',
      senderId: 'caller',
      targetId: 'provider',
      receiverId: 'provider',
      sentAt: 0
    },
    task: {
      mode,
      callerId: 'caller',
      callerGeneration: { kind: 'session', value: 0, providerId: 'caller' },
      targetGeneration: { kind: 'restart', value: 0, providerId: 'provider' },
      ...(['request', 'notify', 'stream'].includes(mode) ? { method: 'echo' } : {})
    }
  }
}

it('[A73][A75] the four closed runtime envelopes preserve their distinct task and completion semantics', () => {
  const normalize = parser()
  for (const value of [
    { ...common(), kind: 'runtime-call', options: {}, payload: 42 },
    {
      ...common('group'),
      kind: 'runtime-group',
      options: {},
      steps: [{ method: 'first' }, { method: 'second', payload: null }]
    },
    { ...common(), kind: 'runtime-control', operation: 'terminal', completion: { ok: true } },
    { ...common('outcome'), kind: 'runtime-outcome', operation: 'lookup', idempotencyKey: 'key-1' },
    {
      ...common('outcome'),
      kind: 'runtime-outcome',
      operation: 'result',
      state: 'done',
      store: { kind: 'memory', epoch: 'epoch-1', continuity: 'retained' },
      outcome: {
        mode: 'request',
        targetGeneration: common().task.targetGeneration,
        completion: { ok: true, result: 42 }
      }
    }
  ])
    assert.deepEqual(normalize(value), value)
  const withoutResult = normalize({
    ...common(),
    kind: 'runtime-control',
    operation: 'terminal',
    completion: { ok: true }
  }) as { completion: object }
  assert.equal(
    Object.hasOwn(withoutResult.completion, 'result'),
    false,
    '[A75] undefined completion is omitted, never replaced by null'
  )
})

it('[A73][A75] wrong variants, unknown fields and fake execution fences are rejected before an owner can execute', () => {
  const normalize = parser()
  const call = { ...common(), kind: 'runtime-call', options: {} }
  for (const value of [
    { ...call, delegation: 'forged' },
    { ...call, task: { ...call.task, targetGeneration: 1 } },
    {
      ...call,
      task: {
        ...call.task,
        targetGeneration: { kind: 'session', value: -1, providerId: 'provider' }
      }
    },
    { ...call, task: { ...call.task, mode: 'group' } },
    { ...call, options: { signal: {} } },
    { ...call, options: { timeoutMs: false } },
    { ...common('notify'), kind: 'runtime-call', options: { idempotencyKey: 'key-1' } },
    { ...common('group'), kind: 'runtime-group', options: {}, steps: [] },
    {
      ...common('group'),
      kind: 'runtime-group',
      options: {},
      steps: [{ method: 'echo', options: {} }]
    },
    {
      ...common('outcome'),
      kind: 'runtime-outcome',
      operation: 'result',
      state: 'pending',
      store: { kind: 'memory', epoch: 'epoch-1', continuity: 'retained' },
      outcome: {}
    },
    {
      ...common('outcome'),
      kind: 'runtime-outcome',
      operation: 'result',
      state: 'done',
      store: { kind: 'unavailable', continuity: 'unavailable' }
    }
  ])
    assert.throws(() => normalize(value), { code: 'INVALID_ENVELOPE' })
  let reads = 0
  const hostile = {
    ...call,
    task: Object.defineProperty({}, 'mode', {
      enumerable: true,
      get: () => {
        reads += 1
        return 'request'
      }
    })
  }
  assert.throws(() => normalize(hostile), { code: 'INVALID_ENVELOPE' })
  assert.equal(reads, 0, '[A75] closed metadata grammar never executes a getter')
})

it('[A64][A74] carrier selection preserves the original object, string or byte representation without decoding protected content', () => {
  /**
   * RED reads existing exports so a missing implementation is an assertion rather than import
   * failure.
   */
  const wrap = Reflect.get(contract, 'wrapRuntimeCarrier')
  const read = Reflect.get(contract, 'readRuntimeCarrier')
  assert.equal(
    typeof wrap,
    'function',
    '[A64][A74] original sender has one runtime carrier grammar'
  )
  assert.equal(typeof read, 'function', '[A74] canonical ingress reads the same selector')
  for (const frame of [{ protected: 'opaque' }, 'signed:opaque', new Uint8Array([0, 1, 255])]) {
    const carrier = wrap(frame)
    const selected = read(carrier)
    assert.ok(selected)
    assert.deepEqual(selected.frame, frame)
    if (typeof frame === 'object' && !(frame instanceof Uint8Array))
      assert.equal(selected.frame, frame)
  }
  assert.equal(read({ kind: 'request' }), undefined)
  assert.equal(read('ordinary'), undefined)
  assert.equal(read(new Uint8Array([0, 1, 2])), undefined)
  let reads = 0
  const hostile = Object.defineProperty({ kind: 'rpc.runtime-api.v1' }, 'frame', {
    enumerable: true,
    get: () => {
      reads += 1
      return 'forged'
    }
  })
  assert.throws(() => read(hostile), { code: 'INVALID_ENVELOPE' })
  assert.equal(reads, 0, '[A74] selector inspection cannot execute a frame getter')
  assert.throws(() => read({ kind: 'rpc.runtime-api.v1', frame: {}, task: {} }), {
    code: 'INVALID_ENVELOPE'
  })
})
