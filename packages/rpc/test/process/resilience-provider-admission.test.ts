import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import type { IRpcContext, IRpcEndpoint, IRpcProvider } from '../../src/core/typing.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../src/remote/types.js'
import { createProcessProviderAdmission } from '../../src/process/resilience/provider-admission.js'
import { createProcessSessionManager } from '../../src/process/resilience/session.js'

/** Observe actual provider registration and inbound activity without a platform adapter. */
function fixture(maxCallsPerMinute: number) {
  const scheduler = createManualScheduler()
  const options = createProcessSessionManager({
    scheduler,
    report: () => undefined,
    maxCallsPerMinute,
    idleTimeoutMs: 100
  }).options
  let onFrame: (() => void) | undefined
  let provider: IRpcProvider | undefined
  const close = vi.fn(async () => undefined)
  const channel = {
    transport: {
      subscribe(listener: () => void) {
        onFrame = listener
        return () => {
          onFrame = undefined
        }
      }
    }
  } as unknown as IRemoteChannel
  const endpoint = {
    endpoint: {
      provide(_method: string, next: IRpcProvider) {
        provider = next
      }
    } as unknown as IRpcEndpoint
  } as IRemoteServeEndpoint
  const admission = createProcessProviderAdmission(channel, options, scheduler, close, vi.fn())
  admission.wrap(endpoint).endpoint.provide('request', () => ({ ok: true, data: 'done' }))
  const context = {
    data: ['ok'],
    signal: { aborted: false },
    success: (data: unknown) => ({ ok: true, data })
  } as IRpcContext
  return {
    admission,
    close,
    context,
    frame: () => onFrame?.(),
    provider: () => provider!,
    scheduler
  }
}

describe('process session provider admission', () => {
  it('[A3] rejects excess calls before the provider and closes after a second violation', async () => {
    const test = fixture(1)
    expect(await test.provider()(test.context)).toMatchObject({ ok: true })
    const first = () => test.provider()(test.context)
    expect(first).toThrowError(expect.objectContaining({ code: 'PROCESS_CONNECTION_LIMIT' }))
    expect(first).toThrowError(expect.objectContaining({ code: 'PROCESS_CONNECTION_LIMIT' }))
    await Promise.resolve()
    expect(test.close).toHaveBeenCalledTimes(1)
    test.admission.close()
    expect(test.scheduler.pendingCount).toBe(0)
  })

  it('[A3] resets the idle timer on inbound frames and keeps it cancelled after close', async () => {
    const test = fixture(2)
    test.scheduler.advance(90)
    test.frame()
    test.scheduler.advance(99)
    expect(test.close).not.toHaveBeenCalled()
    test.scheduler.advance(1)
    await Promise.resolve()
    expect(test.close).toHaveBeenCalledTimes(1)
    test.admission.close()
    expect(test.scheduler.pendingCount).toBe(0)
  })
})
