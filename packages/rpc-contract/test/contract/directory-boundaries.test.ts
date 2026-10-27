import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import {
  normalizeRpcDirectory,
  RuntimeApiMode,
  RuntimeApiModeSource,
  RpcWireLimit
} from '@migaia/rpc-contract/protocol'

/** The actual cold wire grammar admits data only, independently of erased handler types. */
const valid = () => ({
  schemaVersion: 3,
  self: {
    name: 'peer',
    instanceId: 'peer-1',
    generation: { kind: 'session', value: 0, providerId: 'peer-1' }
  },
  methods: [
    {
      name: 'service.echo',
      supportedModes: [RuntimeApiMode.request],
      modeSource: RuntimeApiModeSource.declared
    }
  ]
})

it('a cold directory rejects invalid identity, paths and actual mode sets without leaking fields', () => {
  /**
   * Supported malformed messages exercise the known-field public directory contract at its sole
   * owner.
   */
  const malformed: unknown[] = [
    { ...valid(), nodeId: 'wrong-node' },
    { ...valid(), schemaVersion: 1 },
    { ...valid(), methods: null },
    { ...valid(), self: { name: '', instanceId: 'peer-1' } },
    {
      ...valid(),
      self: { name: 'peer', instanceId: 'x'.repeat(RpcWireLimit.maxIdentifierChars + 1) }
    },
    { ...valid(), methods: [...valid().methods, ...valid().methods] },
    { ...valid(), methods: [{ ...valid().methods[0], name: 'service..echo' }] },
    { ...valid(), methods: [{ ...valid().methods[0], supportedModes: [] }] },
    { ...valid(), methods: [{ ...valid().methods[0], supportedModes: ['other-mode'] }] },
    { ...valid(), methods: [{ ...valid().methods[0], supportedModes: ['request', 'request'] }] },
    { ...valid(), methods: [{ ...valid().methods[0], modeSource: 'from-type' }] },
    { ...valid(), methods: [{ ...valid().methods[0], idempotent: 'true' }] },
    { ...valid(), methods: [{ ...valid().methods[0], forwardedVia: 'two.names' }] }
  ]
  for (const value of malformed)
    assert.throws(
      () => normalizeRpcDirectory(value),
      (error: unknown) => {
        assert.equal(Reflect.get(error as object, 'code'), 'INVALID_ENVELOPE')
        assert.equal(
          String(Reflect.get(error as object, 'message')).includes('private-field'),
          false
        )
        return true
      }
    )
  /** Optional facts retain their original data identity, never a handler or inferred type table. */
  const input = {
    ...valid(),
    nodeId: 'a'.repeat(32),
    methods: [{ ...valid().methods[0], idempotent: true, forwardedVia: 'leaf' }]
  }
  const accepted = normalizeRpcDirectory(input)
  assert.equal(accepted, input)
  assert.equal(accepted.methods, input.methods)
  assert.equal(accepted.methods[0]?.idempotent, true)
  assert.equal(accepted.methods[0]?.forwardedVia, 'leaf')
})

it('directory known fields are read directly while unknown metadata is ignored', () => {
  let reads = 0
  const accessor = Object.defineProperty(valid(), 'methods', {
    enumerable: true,
    get: () => {
      reads++
      return []
    }
  })
  assert.equal(normalizeRpcDirectory(accessor), accessor)
  assert.ok(reads > 0)
  const original = new RangeError('directory reflection fixture failure')
  const value = new Proxy(valid(), {
    ownKeys: () => {
      throw original
    }
  })
  assert.equal(normalizeRpcDirectory(value), value)
  /** Neither unknown string properties nor symbols enter known-field admission. */
  const additive = Object.defineProperty(
    { ...valid(), futureA: () => undefined },
    Symbol('futureB'),
    { value: original }
  )
  assert.equal(normalizeRpcDirectory(additive), additive)
})

/** The original foreign schema vector retains its expected rejection under current metadata grammar. */
it('preserves schema-depth-counts-directory embedding from the original foreign vector', () => {
  /** Only the already-authored schema input is reused; current metadata comes from this fixture. */
  const vectors = JSON.parse(
    readFileSync(
      new URL('../../../rpc-integration/schema/vectors/description-schema.json', import.meta.url),
      'utf8'
    )
  ) as {
    cases: { id: string; valid: boolean; value: { methods: { input?: unknown }[] } }[]
  }
  /** Stable original scenario and false expectation are unchanged. */
  const vector = vectors.cases.find((entry) => entry.id === 'schema-depth-counts-directory')
  assert.ok(vector)
  assert.equal(vector.valid, false)
  /** Changed only surrounding directory identity/version, never the original nested schema. */
  const input = {
    ...valid(),
    methods: [{ ...valid().methods[0], input: vector.value.methods[0]!.input }]
  }
  assert.throws(() => normalizeRpcDirectory(input), { code: 'INVALID_ENVELOPE' })
})
