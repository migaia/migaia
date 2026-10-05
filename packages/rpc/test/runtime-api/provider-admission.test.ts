import assert from 'node:assert/strict'
import { it } from 'vitest'
import {
  createProviderAdmissionScope,
  ProviderAdmissionRegistry
} from '../../src/core/internal/provider-admission.js'

it('[A60] valid narrower connection policies share the same logical scope without relaxing prior bounds or revoking admitted work', () => {
  const scope = createProviderAdmissionScope()
  const first = scope.prepare(4, 3, 8)
  assert.equal(first.acquireMany(['a', 'b', 'c'], 'peer'), true)
  let later: ProviderAdmissionRegistry | undefined
  assert.doesNotThrow(() => {
    later = scope.prepare(2, 1, 8)
  }, '[A60] joining a stricter valid connection cannot split the target FIFO')
  assert.equal(later, first)
  assert.equal(first.size, 3, '[A60] already admitted work retains its original lease')
  assert.equal(first.acquire('d', 'other'), false)
  first.release('a')
  first.release('b')
  assert.equal(
    first.acquire('d', 'peer'),
    false,
    '[A60] narrower per-peer policy applies to subsequent admission'
  )
  assert.equal(first.acquire('d', 'other'), true)
  assert.equal(scope.prepare(8, 8, 8), first)
  assert.equal(
    first.acquire('e', 'third'),
    false,
    '[A60] later wider offers cannot loosen a shared bound'
  )
  assert.throws(
    () => scope.prepare(2, 1, 4),
    { code: 'CAPABILITY_UNSUPPORTED' },
    '[A60] candidate framing policy stays fixed'
  )
  scope.clear()
  assert.equal(first.size, 0)
})

/**
 * Narrow planned methods permit assertions against the existing owner before production
 * implementation.
 */
type IAdmission = ProviderAdmissionRegistry & {
  acquireMany(keys: readonly string[], peer: string): boolean
  captureIngress(): { ready(submit: () => void): boolean; release(): boolean } | undefined
}

it('[A62][A63] original admission reserves every group member or changes no lease', () => {
  /** New semantics are checked through the old class, without a missing-module RED. */
  const owner = new ProviderAdmissionRegistry(3, 3) as IAdmission
  const reserve = Reflect.get(owner, 'acquireMany')
  assert.equal(
    typeof reserve,
    'function',
    '[A62][A63] original admission owns atomic group reservation'
  )
  assert.equal(owner.acquireMany(['first:0', 'first:1'], 'peer'), true)
  assert.equal(owner.size, 2)
  assert.equal(owner.acquireMany(['second:0', 'second:1'], 'peer'), false)
  assert.equal(owner.size, 2, '[A63] the competing group never holds a partial slot')
  assert.equal(owner.acquire('single', 'peer'), true)
  assert.equal(owner.acquireMany(['single', 'extra'], 'peer'), false)
  owner.release('first:0')
  owner.release('first:1')
  assert.equal(owner.acquireMany(['second:0', 'second:1'], 'peer'), true)
  assert.equal(owner.size, 3)
  owner.clear()
  assert.equal(owner.size, 0)
})

it('[A59][A60] physical receipts preserve arrival order without consuming the sole business slot', () => {
  /** The third argument represents once-read original framing capacity, not execution quota. */
  const owner = Reflect.construct(ProviderAdmissionRegistry, [1, 1, 4]) as IAdmission
  const capture = Reflect.get(owner, 'captureIngress')
  assert.equal(
    typeof capture,
    'function',
    '[A59][A60] the original scope captures before authentication'
  )
  const first = owner.captureIngress()!
  const second = owner.captureIngress()!
  const control = owner.captureIngress()!
  const rejected = owner.captureIngress()!
  assert.equal(
    owner.captureIngress(),
    undefined,
    '[A60] unauthenticated retention is independently bounded'
  )
  assert.equal(owner.size, 0, '[A60] physical candidates do not take business leases')
  const submitted: string[] = []
  second.ready(() => submitted.push('second'))
  control.release()
  submitted.push('control')
  rejected.release()
  assert.deepEqual(
    submitted,
    ['control'],
    '[A60] authenticated control bypasses the unresolved business prefix'
  )
  first.ready(() => {
    assert.equal(owner.acquire('business', 'verified-peer'), true)
    submitted.push('first')
  })
  assert.deepEqual(submitted, ['control', 'first', 'second'])
  assert.equal(owner.size, 1, '[A59] maxGlobal=1 admits the complete frame')
  const closing = owner.captureIngress()
  assert.ok(closing)
  owner.clear()
  assert.equal(
    closing.ready(() => submitted.push('late')),
    false
  )
  assert.equal(closing.release(), false, '[A60] retired receipt is released exactly once')
  assert.deepEqual(submitted, ['control', 'first', 'second'])
})
