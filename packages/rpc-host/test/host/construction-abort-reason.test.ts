/** Public pre-acquisition cancellation retains a throwing structural reason as original cause. */
import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin, resolveAbortReason } from '@migaia/rpc-host/sdk'
import { deferred } from '@migaia/utils/promise'
import { throwingSignal } from '../fixtures/throwing-signal.ts'

it('keeps the original failed reason read on CANCELLED before acquiring a carrier', async () => {
  /** A supported structural signal can throw while supplying its terminal reason. */
  const original = new Error('construction getter')
  /** The controlled getter records every actual reason read independently from cancellation. */
  const source = throwingSignal(original, true)
  /** Cold registration must not acquire a native resource after the signal is already terminal. */
  const open = vi.fn(async () => ({ dispose: () => undefined }))
  /** Capture the real public failure regardless of its construction phase. */
  let failure: unknown
  try {
    await createRpcHost({
      self: { name: 'construction-reason-client', instanceId: 'construction-reason-client' },
      signal: source.signal,
      plugins: [defineTransportPlugin({ name: 'construction-reason', namespace: 'native', open })]
    })
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({ source: 'rpc.endpoint', code: 'CANCELLED', cause: original })
  expect((failure as Error).cause).toBe(original)
  expect(source.reads()).toBe(1)
  expect(open).not.toHaveBeenCalled()
})

// The supported SDK exposes the one canonical reason reader.
it('exposes the canonical SDK helper without rereading a failed abort reason', () => {
  /** The same getter error remains data rather than another thrown cancellation failure. */
  const original = new Error('helper reason')
  /** Count reads at the actual helper input, independently of public construction adapters. */
  const source = throwingSignal(original, true)
  expect(typeof resolveAbortReason).toBe('function')
  expect(resolveAbortReason(source.signal)).toBe(original)
  expect(source.reads()).toBe(1)
})

// The original pending install owns cleanup before cancellation.
it('cancels a held native install with the failed reason read and releases its owned resource', async (test) => {
  /** The same original getter exception must become this construction's cancellation cause. */
  const original = new Error('mid-install reason')
  /** Only the real public Host subscribes to this controlled structural caller signal. */
  const source = throwingSignal(original, false)
  /** Entry occurs only after native cleanup has acquired the original resource callback. */
  const entered = deferred<void>()
  /** Setup remains unresolved throughout all required cancellation and release assertions. */
  const held = deferred<{ dispose(): void }>()
  /** Final fixture cleanup may settle setup only after the cancellation outcome was checked. */
  const installation = { dispose: () => undefined }
  /** Count only release of the actual pre-owned native callback, never the late output. */
  let releases = 0
  /** The supported transport context lends its genuine installation core without a new flow port. */
  const transport = defineTransportPlugin({
    name: 'pending-reason-transport',
    namespace: 'native',
    open(context) {
      context.owner.onDispose(() => {
        releases += 1
      })
      entered.resolve()
      return held.promise
    }
  })
  /** Observe the public construction before its pending install can receive external cancellation. */
  const opening = createRpcHost({
    self: { name: 'mid-install-reason', instanceId: 'mid-install-reason' },
    signal: source.signal,
    plugins: [transport],
    report: () => undefined
  }).then(
    (host) => ({ host }),
    (error: unknown) => ({ error })
  )
  /** Framework cleanup releases this same held setup if a real regression times the case out. */
  const cleanup = { held, installation, opening }
  test.onTestFinished(async () => {
    cleanup.held.resolve(cleanup.installation)
    const outcome = await cleanup.opening
    if ('host' in outcome) await outcome.host.close()
  })
  try {
    await entered.promise
    source.fire()
    /** The actual Host must settle before setup is permitted to produce any installation output. */
    const outcome = await opening
    if (test.signal.aborted) return
    /** No Root/SDK wrapper or fixture factory substitutes another abort reason. */
    const failure = 'error' in outcome ? outcome.error : undefined
    expect(failure).toMatchObject({ code: 'CANCELLED', cause: original })
    expect((failure as Error).cause).toBe(original)
    expect(releases).toBe(1)
    expect(source.reads()).toBe(1)
  } finally {
    held.resolve(installation)
    const outcome = await opening
    if ('host' in outcome) await outcome.host.close()
  }
})
