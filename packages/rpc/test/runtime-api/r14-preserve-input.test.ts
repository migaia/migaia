import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { connected } from './fixture.js'
import * as portable from '../../src/contract/normalize.js'
import {
  createRuntimeRequestInput,
  retainRuntimeRequestInput,
  readRuntimeRequestInput
} from '../../src/core/internal/outbound-envelope.js'
import { createRemoteRetryPort } from '../../src/remote/retry.js'
import type { IRemoteGenerationEvents } from '../../src/remote/types.js'
import { OperationScope } from '../../src/core/internal/operation-scope.js'

it('[R14-A8] live operation rejects a stale generation before any close and preserves first abort reason', () => {
  /** First close call owns all repeated close callers. */
  const closing = new AbortController()
  /** The first completion or reason must remain authoritative after later events. */
  const first = new RangeError('r14-first-reason')
  /** Original operation scope retains its receive generation and first cancellation reason. */
  const scope = new OperationScope(3, false, closing.signal, () => 0)
  assert.doesNotThrow(() => scope.assertActive(3))
  assert.throws(
    () => scope.assertActive(4),
    { code: 'ENDPOINT_DISPOSED' },
    '[R14-A8] stale generation cannot commit'
  )
  scope.abort(first)
  scope.abort(new Error('r14-second-reason'))
  assert.equal(scope.signal.reason, first)
})

it.each([4, 32])(
  '[R14-A30] catalog %s ordinary and retry input admission reuses two-layer payload and rejects forged proof',
  async (size) => {
    /** Distinguish business input from directory traffic and primitive results. */
    const marker = `r14-catalog-${size}`
    /** Input depth varies independently from the number of compiled methods. */
    const payload = { marker, nested: { value: size } }
    /** The receiver must see the canonical null-prototype graph, not an unvalidated original. */
    const expected = Object.assign(Object.create(null), {
      marker,
      nested: Object.assign(Object.create(null), { value: size })
    })
    /**
     * Actual handlers validate both payload levels before a primitive result excludes result
     * traversal.
     */
    const providers = Object.fromEntries(
      Array.from({ length: size }, (_, index) => [
        `method${index}`,
        (value: unknown) => {
          assert.deepEqual(value, expected)
          return 42
        }
      ])
    )
    /** Both real Peers dispatch through their existing source and payload owners. */
    const fixture = await connected({}, providers)
    /** Observe only canonical admissions of this actual business input. */
    const normalize = vi.spyOn(portable, 'normalizePortable')
    /** Root matching excludes recursive children, ready metadata and the primitive response. */
    const walks = () =>
      normalize.mock.calls.filter(
        ([value]) =>
          typeof value === 'object' && value !== null && Reflect.get(value, 'marker') === marker
      ).length
    try {
      assert.equal(await fixture.peers[0].request('method0', payload, { timeoutMs: false }), 42)
      assert.equal(
        walks(),
        2,
        '[R14-A30] ordinary input has one caller admission and one untrusted receiver admission'
      )
      normalize.mockClear()
      /** The same canonical private input survives reconstruction of original retry options. */
      const input = createRuntimeRequestInput('method0', payload, false, undefined, 2)
      /** No public skip flag is used to retain the admitted method and payload. */
      const options = retainRuntimeRequestInput({ timeoutMs: false as const }, input)
      assert.equal(readRuntimeRequestInput(options, 'method0', input.payload, 2), input)
      /** This branch uses the original retry port without an artificial generation departure. */
      const events: IRemoteGenerationEvents = {
        current: () => ({ generation: 1, active: true }),
        onLeave: () => () => undefined,
        whenReady: () => Promise.reject(new Error('r14-unexpected-retry'))
      }
      /**
       * The actual native replacement branch is independently exercised by
       * managed-generation.test.ts.
       */
      const retry = createRemoteRetryPort({
        events,
        scheduler: createManualScheduler(),
        report: (error) => {
          throw error
        }
      })
      assert.equal(
        await retry.dispatch({
          method: 'method0',
          mode: 'request',
          generation: 1,
          idempotent: true,
          events,
          sendOnce: () =>
            fixture.peers[0].request('method0', input.payload, options).then((value) => {
              assert.ok(value !== undefined)
              return value
            })
        }),
        42
      )
      assert.equal(
        walks(),
        2,
        '[R14-A30] original retry owner carries one admission instead of walking caller input again'
      )
      /** Freezing and copying cannot transfer the genuine private proof. */
      const copied = Object.freeze({ ...input })
      assert.equal(
        readRuntimeRequestInput(
          retainRuntimeRequestInput({}, copied),
          'method0',
          copied.payload,
          2
        ),
        undefined,
        '[R14-A30] copied public proof stays strict'
      )
      /** Unsupported caller data receives strict admission even when public flags claim validation. */
      const forged = { skipPortable: true, validated: true, trusted: true }
      assert.throws(() => createRuntimeRequestInput('method0', new Date(), false, forged, 2), {
        code: 'INVALID_ENVELOPE'
      })
    } finally {
      normalize.mockRestore()
      await fixture.close()
    }
  }
)
