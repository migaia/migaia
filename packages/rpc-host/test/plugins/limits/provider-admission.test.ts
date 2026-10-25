import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'
import { ProviderAdmissionRegistry } from '../../../dist/plugins/limits/provider-admission.js'

describe('ProviderAdmissionRegistry', () => {
  it('rejects non-positive or unsafe admission limits', () => {
    expect(() => new ProviderAdmissionRegistry(0, 1)).toThrow()
    expect(() => new ProviderAdmissionRegistry(1, Number.POSITIVE_INFINITY)).toThrow()
  })

  it('enforces global and per-peer limits and releases leases', () => {
    const admission = new ProviderAdmissionRegistry(2, 1)
    expect(admission.acquire('a', 'p1')).toBe(true)
    expect(admission.acquire('a', 'p1')).toBe(false)
    expect(admission.acquire('b', 'p1')).toBe(false)
    expect(admission.acquire('b', 'p2')).toBe(true)
    expect(admission.acquire('c', 'p3')).toBe(false)
    admission.release('a')
    expect(admission.acquire('c', 'p3')).toBe(true)
  })
})

it('original admission reserves every group member or changes no lease', () => {
  /** New semantics are checked through the old class, without a missing-module RED. */
  const owner = new ProviderAdmissionRegistry(3, 3)
  const reserve = Reflect.get(owner, 'acquireMany')
  assert.equal(typeof reserve, 'function', 'original admission owns atomic group reservation')
  assert.equal(owner.acquireMany(['first:0', 'first:1'], 'peer'), true)
  assert.equal(owner.size, 2)
  assert.equal(owner.acquireMany(['second:0', 'second:1'], 'peer'), false)
  assert.equal(owner.size, 2, 'the competing group never holds a partial slot')
  assert.equal(owner.acquire('single', 'peer'), true)
  assert.equal(owner.acquireMany(['single', 'extra'], 'peer'), false)
  owner.release('first:0')
  owner.release('first:1')
  assert.equal(owner.acquireMany(['second:0', 'second:1'], 'peer'), true)
  assert.equal(owner.size, 3)
  owner.clear()
  assert.equal(owner.size, 0)
})
