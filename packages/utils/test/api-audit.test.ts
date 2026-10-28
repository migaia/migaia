import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { ElectronProcessType, GlobalScopeKind, ServerRuntime } from '@migaia/utils'
import { attachErrorIdentity, isUtilsError, UtilsErrorCode } from '../src/error.ts'
import { decodeUtf8, splitUtf8, streamBase64Chunks } from '../src/bytes.ts'
import { inspectThenable, observeThenableRejection, onceAsync } from '../src/function.ts'
import { probeProperty } from '../src/object.ts'
import { probeObjectPathSegments } from '../src/object-path.ts'
import { createManualScheduler } from '../src/testing.ts'
import {
  createAbortTimeoutSignal,
  createConcurrencyLimiter,
  raceWithAbort,
  retry,
  sleep,
  withTimeout
} from '../src/promise.ts'

describe('utils audited public contracts', () => {
  it('exports the exact runtime detection domains from the package entry', () => {
    expect(ServerRuntime).toEqual({ deno: 'deno', bun: 'bun', node: 'node' })
    expect(ElectronProcessType).toEqual({ main: 'main', renderer: 'renderer', utility: 'utility' })
    expect(GlobalScopeKind).toEqual({
      window: 'window',
      'dedicated-worker': 'dedicated-worker',
      'shared-worker': 'shared-worker',
      'service-worker': 'service-worker'
    })
  })

  it('accepts PromiseLike callbacks and preserves the one native Promise identity', async () => {
    /** The public signature must match the existing captured-then assimilation contract. */
    const load = onceAsync((): PromiseLike<number> => Promise.resolve(7))
    /** All consumers share one native Promise even when the callback only promises PromiseLike. */
    const first = load()
    await expect(first).resolves.toBe(7)
    expect(load()).toBe(first)
    expect(first).toBeInstanceOf(Promise)
  })

  it('retains the conflict cause and attaches its registered native identity', () => {
    /** Conflicting public identities must not erase the first error. */
    const original = attachErrorIdentity(new Error('original'), { source: 'first', code: 'FIRST' })
    expect(() => attachErrorIdentity(original, { source: 'second', code: 'SECOND' })).toThrowError(
      expect.objectContaining({
        source: 'foundation.utils',
        code: 'ERROR_IDENTITY_CONFLICT',
        cause: original
      })
    )
  })

  it('attaches INVALID_ARGUMENT while retaining native validation error families', async () => {
    /** Every documented public argument rejection uses the existing code, never a new error family. */
    const operations: readonly (() => unknown)[] = [
      () => [...streamBase64Chunks(new Uint8Array([1]), 2)],
      () => splitUtf8('x', 3),
      () => sleep(-1),
      () => withTimeout(() => 1, { timeoutMs: -1 }),
      () => raceWithAbort(() => 1, { signal: new AbortController().signal, signals: [] }),
      () => retry(() => 1, { maxAttempts: 0, shouldRetry: () => false }),
      () => createAbortTimeoutSignal({ timeoutMs: -1 }),
      () => createConcurrencyLimiter({ concurrency: 0 })
    ]
    for (const operation of operations) {
      await expect(Promise.resolve().then(operation)).rejects.toSatisfy(
        (error: unknown) =>
          (error instanceof RangeError || error instanceof TypeError) &&
          Object.hasOwn(error, 'stack') &&
          (error as { source?: string }).source === 'foundation.utils' &&
          (error as { code?: string }).code === UtilsErrorCode.invalidArgument
      )
    }
  })

  it('names UTF-8 in fatal decoding diagnostics', () => {
    expect(() => decodeUtf8(new Uint8Array([255]), { fatal: true })).toThrowError(
      expect.objectContaining({
        code: 'INVALID_ENCODING',
        message: '[utils] invalid UTF-8 input at offset 0'
      })
    )
  })

  it('contains has trap failures in the property probe result', () => {
    /** A failed existence probe is observable data, just like a failed getter. */
    const cause = new Error('has trap failed')
    expect(
      probeProperty(
        new Proxy(
          {},
          {
            has: () => {
              throw cause
            }
          }
        ),
        'name'
      )
    ).toEqual({ kind: 'failed', error: cause })
  })

  it('accepts parsed tuples and rejects string paths at the type boundary', () => {
    expect(probeObjectPathSegments({ name: 'value' }, ['name'] as const)).toMatchObject({
      kind: 'value',
      value: 'value'
    })
    // @ts-expect-error This entry consumes parsed tuples; strings go through probeObjectPath.
    expectTypeOf(probeObjectPathSegments<{ name: string }, 'name'>).toBeFunction()
  })

  it('rejects exclusive signal options before total timeout can start work', async () => {
    /** The total deadline must not remove an invalid public option before admission checks. */
    const operation = vi.fn(() => 42)
    await expect(
      Promise.resolve().then(() =>
        retry(operation, {
          maxAttempts: 1,
          shouldRetry: () => false,
          totalTimeoutMs: 100,
          signal: new AbortController().signal,
          signals: []
        })
      )
    ).rejects.toMatchObject({ source: 'foundation.utils', code: 'INVALID_ARGUMENT' })
    expect(operation).not.toHaveBeenCalled()
  })

  it('exposes attempt scope on both the rejection and operation cancellation reason', async () => {
    /** The same attempt deadline must identify both cancellation and the rejected result. */
    const scheduler = createManualScheduler()
    /** Captured native signal proves the actual operation observes the promised reason. */
    let signal: AbortSignal | undefined
    /** The operation intentionally waits for its deadline. */
    const pending = retry(
      (context) => {
        signal = context.signal
        return new Promise(() => {})
      },
      {
        maxAttempts: 1,
        shouldRetry: () => false,
        attemptTimeoutMs: 5,
        scheduler
      }
    )
    /** Observe rejection before advancing the deterministic clock. */
    const observed = expect(pending).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED',
      scope: 'attempt'
    })
    scheduler.advance(5)
    await observed
    expect(signal?.reason).toMatchObject({ code: 'DEADLINE_EXCEEDED', scope: 'attempt' })
  })

  it('reports secondary reporter failures without an unhandled rejected Promise', async () => {
    /**
     * Captured host callbacks prove reporting while preventing intentional host throws during
     * tests.
     */
    const callbacks: (() => void)[] = []
    /** Exact reporter failures remain reachable at the host boundary. */
    const reporterFailure = new Error('reporter failure')
    /** Stub only the existing host diagnostic seam, restoring it even if assertions fail. */
    const enqueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      callbacks.push(callback)
    })
    try {
      observeThenableRejection(undefined, { error: new Error('inspection failed') }, () => {
        throw reporterFailure
      })
      /** A native rejected Promise exercises the asynchronous reporting branch. */
      const rejected = Promise.reject(new Error('operation failed'))
      observeThenableRejection(rejected, inspectThenable(rejected), () => {
        throw reporterFailure
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(callbacks).toHaveLength(2)
      for (const callback of callbacks) expect(callback).toThrow(reporterFailure)
    } finally {
      enqueue.mockRestore()
    }
  })

  it('only narrows errors with a registered utils code', () => {
    expect(isUtilsError(Object.assign(new Error('missing'), { source: 'foundation.utils' }))).toBe(
      false
    )
    expect(
      isUtilsError(
        Object.assign(new Error('unknown'), { source: 'foundation.utils', code: 'UNKNOWN' })
      )
    ).toBe(false)
    expect(
      isUtilsError(
        attachErrorIdentity(new TypeError('argument'), {
          source: 'foundation.utils',
          code: UtilsErrorCode.invalidArgument
        })
      )
    ).toBe(true)
  })
})
