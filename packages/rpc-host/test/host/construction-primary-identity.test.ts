import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** Public construction retains its primary failure after dependency setup and failing rollback. */
import { defineFeature } from '@migaia/plugin-host'
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowFeature, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { walkErrorCauses } from '@migaia/utils/error'
import { expect, it, vi } from 'vitest'

it('keeps the original construction failure after object dependencies and both cleanup callbacks fail', async () => {
  /** Native dependency injection must preserve this exact caller-owned object. */
  const dependencyValue = Object.freeze({ owner: 'construction-dependency' })
  /** The dependent native factory records the actual injected object, without copying it. */
  const observed: unknown[] = []
  /** Later installation failure stays independent from both acquired resource cleanup failures. */
  const primary = new Error('public construction failed after acquisition')
  /** Each original cleanup failure must remain reachable through errors or the existing reporter. */
  const firstCleanup = new RangeError('first construction cleanup failed')
  /** The second cleanup also throws, proving it does not prevent the earlier resource release. */
  const secondCleanup = new TypeError('second construction cleanup failed')
  /** Cleanup order exposes duplicate or skipped rollback without replacing the real callbacks. */
  const order: string[] = []
  /** The first acquired setup owns this exact callback. */
  const releaseFirst = vi.fn(() => {
    order.push('first')
    throw firstCleanup
  })
  /** The second acquired setup owns its independently registered callback. */
  const releaseSecond = vi.fn(() => {
    order.push('second')
    throw secondCleanup
  })
  /** Native Feature construction is synchronous; the original object is its complete output. */
  const dependency = defineFeature(() => dependencyValue)
  /** This existing dependency object path proves actual native injection before flow setup runs. */
  const dependent = defineFeature(
    (_core, dependencies) => {
      observed.push(dependencies.value)
      return dependencies.value
    },
    { value: dependency }
  )
  /** The first real flow setup transfers its disposer to the same native installation lifetime. */
  const first = defineFlowFeature({
    phase: 1000,
    name: 'construction-first-resource',
    dependencies: { value: dependent },
    setup: () => ({ dispose: releaseFirst })
  })
  /** Native dependency order acquires this second disposer only after the first setup succeeds. */
  const second = defineFlowFeature({
    phase: 1001,
    name: 'construction-second-resource',
    dependencies: { previous: first },
    setup: () => ({ dispose: releaseSecond })
  })
  /** Failure occurs inside public construction after both genuine cleanup registrations exist. */
  const failing = defineFlowFeature({
    phase: 1002,
    name: 'construction-later-failure',
    dependencies: { previous: second },
    setup: () => {
      throw primary
    }
  })
  /**
   * The public factory still receives a genuine transport definition, whose startup stays
   * unentered.
   */
  const open = vi.fn(() => ({ dispose: () => undefined }))
  /** Reported rollback failures retain their existing diagnostic ownership and original identities. */
  const reports: unknown[] = []
  /** Observe the actual public rejection, rather than a native Host.use wrapper or its cause. */
  const failure = await createRpcHost({
    plugins: [
      rpcFeaturesPlugin({ features: { first, second, failing } }),
      defineTransportPlugin({ name: 'construction-transport', namespace: 'native', open })
    ],
    report: (error) => reports.push(error)
  }).catch((error: unknown) => error)
  expect(failure).toBe(primary)
  expect(observed).toEqual([dependencyValue])
  expect(observed[0]).toBe(dependencyValue)
  expect(releaseFirst).toHaveBeenCalledOnce()
  expect(releaseSecond).toHaveBeenCalledOnce()
  expect(order).toEqual(['second', 'first'])
  expect(open).not.toHaveBeenCalled()
  /** The existing bounded error-graph walker includes both errors[] and original cause chains. */
  const recorded = [failure, ...reports].flatMap((error) => walkErrorCauses(error))
  expect(recorded).toContain(firstCleanup)
  expect(recorded).toContain(secondCleanup)
})
