import { ignoreHostCleanup } from './fixtures/host-cleanup.ts'
import { describe, expect, it } from 'vitest'
import { createCapabilityHost, CapabilityErrorCode } from '../src/index.ts'

describe('capability terminal read-only query ruling', () => {
  it(
    'read-only queries remain available after dispose; mutations throw HOST_DISPOSED first',
    verifyReadOnlyQueriesRemainAvailableAfterDisposeMutationsThrowHOSTDISPOSEDFirst
  )
})

/**
 * Executes the existing case: read-only queries remain available after dispose; mutations throw
 * HOST_DISPOSED first.
 */
async function verifyReadOnlyQueriesRemainAvailableAfterDisposeMutationsThrowHOSTDISPOSEDFirst(): Promise<void> {
  const host = createCapabilityHost<unknown>({}, { flags: { worker: true } })
  /** No-op disposer is a fixture value, invoked only when the host releases the handle. */
  host.register({ name: 'worker', activate: () => ({ dispose: ignoreHostCleanup }) })
  await host.enable('worker')
  await host.dispose()

  // 只读终态诊断仍可用。
  expect(host.names).toEqual(['worker'])
  expect(host.state('worker')).toBe('off')

  // 变更方法：HOST_DISPOSED 优先级高于 NOT_REGISTERED。
  await expect(host.disable('worker')).rejects.toMatchObject({
    code: CapabilityErrorCode.hostDisposed
  })
  await expect(host.disable('unknown')).rejects.toMatchObject({
    code: CapabilityErrorCode.hostDisposed
  })
}
