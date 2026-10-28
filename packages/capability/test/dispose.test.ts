import { RecordedCapabilityRelease } from './fixtures/host-cleanup.js'
import { describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  throwOnController: -1,
  cleanupError: undefined as unknown
}))

vi.mock('@migaia/lifecycle', mockLifecycleWithCleanupFailure)

/** Mock setup owns controller numbering while the fixture preserves all real lifecycle behavior. */
async function mockLifecycleWithCleanupFailure(): Promise<typeof import('@migaia/lifecycle')> {
  const actual = await vi.importActual<typeof import('@migaia/lifecycle')>('@migaia/lifecycle')
  const { GenerationFailureFactory } = await import('./fixtures/generation-failure.js')
  const factory = new GenerationFailureFactory(actual, mockState)
  return { ...actual, createGenerationController: factory.createGenerationController }
}

import { CapabilityErrorCode, createCapabilityHost } from '../src/index.js'

describe('dispose generation cleanup isolation', () => {
  it(
    'reports a generation cleanup failure and still releases every active handle',
    verifyReportsAGenerationCleanupFailureAndStillReleasesEveryActiveHandle
  )
})

/**
 * Executes the existing case: reports a generation cleanup failure and still releases every active
 * handle.
 */
async function verifyReportsAGenerationCleanupFailureAndStillReleasesEveryActiveHandle(): Promise<void> {
  const generationError = new Error('generation cleanup failed')
  const handleError = new Error('second handle cleanup failed')
  const releaseOrder: string[] = []
  const onError = vi.fn()
  mockState.throwOnController = 0
  mockState.cleanupError = generationError
  const host = createCapabilityHost(undefined, {
    flags: { first: true, second: true },
    onError
  })
  /** Cleanup fixture keeps release order and failure timing under the host's disposer call. */
  const releaseFirst = new RecordedCapabilityRelease(releaseOrder, 'first')
  host.register({
    name: 'first',
    activate: () => ({ dispose: releaseFirst.dispose })
  })
  /** Cleanup fixture keeps release order and failure timing under the host's disposer call. */
  const releaseSecond = new RecordedCapabilityRelease(releaseOrder, 'second', handleError)
  host.register({
    name: 'second',
    activate: () => ({ dispose: releaseSecond.dispose })
  })

  await host.enable('first')
  await host.enable('second')
  const firstDispose = host.dispose()

  expect(host.disposed).toBe(true)
  await expect(host.dispose()).rejects.toEqual(
    expect.objectContaining({
      source: 'capability',
      code: CapabilityErrorCode.hostTransitioning
    })
  )
  await expect(firstDispose).resolves.toBeUndefined()
  expect(releaseOrder).toEqual(['second', 'first'])
  expect(onError.mock.calls).toEqual([
    ['first', generationError],
    ['second', handleError]
  ])
  expect(host.error('first')).toBe(generationError)
  expect(host.error('second')).toBe(handleError)
  expect(host.state('first')).toBe('off')
  expect(host.state('second')).toBe('off')
  expect(host.handle('first')).toBeUndefined()
  expect(host.handle('second')).toBeUndefined()
  expect(host.dispose()).toBe(firstDispose)
}
