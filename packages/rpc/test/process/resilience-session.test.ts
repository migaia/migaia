import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { createProcessSessionManager } from '../../src/process/resilience/session.js'

describe('process resilience session ownership', () => {
  it('[A1] keeps one deduplication store and scope per verified principal across connections', () => {
    const manager = createProcessSessionManager({
      scheduler: createManualScheduler(),
      report: () => undefined
    })
    const first = manager.sessionOptions({
      connectionId: 'one',
      sessionId: 's1',
      principalId: 'alice'
    })
    const later = manager.sessionOptions({
      connectionId: 'two',
      sessionId: 's2',
      principalId: 'alice'
    })
    const other = manager.sessionOptions({
      connectionId: 'three',
      sessionId: 's3',
      principalId: 'bob'
    })
    expect(first.idempotency.store).toBe(later.idempotency.store)
    expect(first.idempotency.store).toBe(other.idempotency.store)
    expect(first.idempotency.scope?.({ token: 'secret', senderId: 'sender-1' })).toBe(
      later.idempotency.scope?.({ token: 'other-secret', senderId: 'sender-2' })
    )
    expect(first.idempotency.scope?.({ token: 'secret', senderId: 'sender-1' })).not.toBe(
      other.idempotency.scope?.({ token: 'secret', senderId: 'sender-1' })
    )
    expect(first.idempotency.scope?.({ token: 'secret', senderId: 'sender-1' })).not.toContain(
      'secret'
    )
    expect(first.limits).toEqual({ maxGlobal: 32, maxPerPeer: 32 })
  })

  it('[A1] admits at most the configured physical connections and returns a lease once', () => {
    const manager = createProcessSessionManager({
      scheduler: createManualScheduler(),
      report: () => undefined,
      maxConnections: 1
    })
    const lease = manager.claimConnection()
    expect(() => manager.claimConnection()).toThrowError(
      expect.objectContaining({ code: 'PROCESS_CONNECTION_LIMIT' })
    )
    lease.release()
    lease.release()
    const replacement = manager.claimConnection()
    replacement.release()
    manager.close()
    expect(() => manager.claimConnection()).toThrowError(
      expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })
    )
  })

  it('[A2] validates numeric quotas and report offsets before any connection is opened', () => {
    expect(() =>
      createProcessSessionManager({
        scheduler: createManualScheduler(),
        report: () => undefined,
        maxConnections: 0
      })
    ).toThrowError(expect.objectContaining({ code: 'PROCESS_RESILIENCE_INVALID_OPTION' }))
    expect(() =>
      createProcessSessionManager({
        scheduler: createManualScheduler(),
        report: () => undefined,
        reportAtMs: [0, 1, 1]
      })
    ).toThrowError(expect.objectContaining({ code: 'PROCESS_RESILIENCE_INVALID_OPTION' }))
  })
})
