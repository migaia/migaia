import assert from 'node:assert/strict'
import { it } from 'vitest'
import { normalizeRuntimeDescription } from '../../src/remote/runtime-api/description.js'
import { RuntimeApiMode, RuntimeApiModeSource } from '../../src/remote/runtime-api/constants.js'
import { RpcWireLimit } from '../../src/contract/wire-constants.js'

/** The actual cold wire grammar admits data only, independently of erased handler types. */
const valid = () => ({
  schemaVersion: 2,
  self: { name: 'peer', instanceId: 'peer-1' },
  methods: [
    {
      name: 'service.echo',
      supportedModes: [RuntimeApiMode.request],
      modeSource: RuntimeApiModeSource.declared
    }
  ]
})

it('[A7][A24][A82] a cold directory rejects invalid identity, paths and actual mode sets without leaking fields', () => {
  /** Supported malformed messages exercise the closed public directory contract at its sole owner. */
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
    { ...valid(), methods: [{ ...valid().methods[0], forwardedVia: 'two.names' }] },
    { ...valid(), secret: 'directory-private-field' },
    Object.defineProperty(valid(), Symbol('untrusted'), {
      value: 'symbol-private-field',
      enumerable: true
    })
  ]
  for (const value of malformed)
    assert.throws(
      () => normalizeRuntimeDescription(value),
      (error: unknown) => {
        assert.equal(Reflect.get(error as object, 'code'), 'CONTRACT_INVALID')
        assert.equal(
          String(Reflect.get(error as object, 'message')).includes('private-field'),
          false
        )
        return true
      }
    )
  /** Accepted optional facts remain frozen data, never a handler or an inferred type table. */
  const accepted = normalizeRuntimeDescription({
    ...valid(),
    nodeId: 'a'.repeat(32),
    methods: [{ ...valid().methods[0], idempotent: true, forwardedVia: 'leaf' }]
  })
  assert.equal(accepted.methods[0]?.idempotent, true)
  assert.equal(accepted.methods[0]?.forwardedVia, 'leaf')
  assert.ok(Object.isFrozen(accepted.methods))
})

it('[A7][A24] directory descriptors reject accessors without executing them and preserve reflection failure', () => {
  let reads = 0
  const accessor = Object.defineProperty(valid(), 'methods', {
    enumerable: true,
    get: () => {
      reads++
      return []
    }
  })
  assert.throws(() => normalizeRuntimeDescription(accessor), { code: 'CONTRACT_INVALID' })
  assert.equal(reads, 0)
  const original = new RangeError('directory reflection fixture failure')
  const value = new Proxy(valid(), {
    ownKeys: () => {
      throw original
    }
  })
  assert.throws(
    () => normalizeRuntimeDescription(value),
    (error: unknown) => {
      assert.equal(Reflect.get(error as object, 'code'), 'CONTRACT_INVALID')
      assert.equal(Reflect.get(error as object, 'cause'), original)
      return true
    }
  )
})
