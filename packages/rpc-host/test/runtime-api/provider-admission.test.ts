import assert from 'node:assert/strict'
import { it } from 'vitest'
import { createProviderAdmissionScope } from '../../dist/core/internal/provider-admission.js'
import {
  ProviderAdmissionRegistry,
  prepareProviderAdmissionScope
} from '../../dist/core/internal/provider-admission.js'

it('valid narrower connection policies share the same logical scope without relaxing prior bounds or revoking admitted work', () => {
  const scope = createProviderAdmissionScope()
  const first = prepareProviderAdmissionScope(scope, 4, 3, 8)
  assert.equal(first.acquireMany(['a', 'b', 'c'], 'peer'), true)
  let later: ProviderAdmissionRegistry | undefined
  assert.doesNotThrow(() => {
    later = prepareProviderAdmissionScope(scope, 2, 1, 8)
  }, 'joining a stricter valid connection cannot split the target FIFO')
  assert.equal(later, first)
  assert.equal(first.size, 3, 'already admitted work retains its original lease')
  assert.equal(first.acquire('d', 'other'), false)
  first.release('a')
  first.release('b')
  assert.equal(
    first.acquire('d', 'peer'),
    false,
    'narrower per-peer policy applies to subsequent admission'
  )
  assert.equal(first.acquire('d', 'other'), true)
  assert.equal(prepareProviderAdmissionScope(scope, 8, 8, 8), first)
  assert.equal(
    first.acquire('e', 'third'),
    false,
    'later wider offers cannot loosen a shared bound'
  )
  assert.throws(
    () => prepareProviderAdmissionScope(scope, 2, 1, 4),
    { code: 'CAPABILITY_UNSUPPORTED' },
    'candidate framing policy stays fixed'
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

it('physical receipts preserve arrival order without consuming the sole business slot', () => {
  /** The third argument represents once-read original framing capacity, not execution quota. */
  const owner = Reflect.construct(ProviderAdmissionRegistry, [1, 1, 4]) as IAdmission
  const capture = Reflect.get(owner, 'captureIngress')
  assert.equal(typeof capture, 'function', 'the original scope captures before authentication')
  const first = owner.captureIngress()!
  const second = owner.captureIngress()!
  const control = owner.captureIngress()!
  const rejected = owner.captureIngress()!
  assert.equal(
    owner.captureIngress(),
    undefined,
    'unauthenticated retention is independently bounded'
  )
  assert.equal(owner.size, 0, 'physical candidates do not take business leases')
  const submitted: string[] = []
  second.ready(() => submitted.push('second'))
  control.release()
  submitted.push('control')
  rejected.release()
  assert.deepEqual(
    submitted,
    ['control'],
    'authenticated control bypasses the unresolved business prefix'
  )
  first.ready(() => {
    assert.equal(owner.acquire('business', 'verified-peer'), true)
    submitted.push('first')
  })
  assert.deepEqual(submitted, ['control', 'first', 'second'])
  assert.equal(owner.size, 1, 'maxGlobal=1 admits the complete frame')
  const closing = owner.captureIngress()
  assert.ok(closing)
  owner.clear()
  assert.equal(
    closing.ready(() => submitted.push('late')),
    false
  )
  assert.equal(closing.release(), false, 'retired receipt is released exactly once')
  assert.deepEqual(submitted, ['control', 'first', 'second'])
})
