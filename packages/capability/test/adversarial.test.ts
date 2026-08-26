import { describe, expect, it } from 'vitest'
import { createCapabilityHost, CapabilityErrorCode } from '../src/index'

describe('AF-T22 capability terminal read-only query ruling', () => {
  it('read-only queries remain available after dispose; mutations throw HOST_DISPOSED first', async () => {
    const host = createCapabilityHost<unknown>({}, { flags: { worker: true } })
    host.register({ name: 'worker', activate: () => ({ dispose: () => undefined }) })
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
  })
})
