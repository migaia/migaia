import { createRpcIdempotencyStore } from '@migaia/rpc-core'
import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { createProcessResilience } from '../../src/process/index.js'

describe('process resilience public session policy', () => {
  it('isolates owners sharing a store while retaining a principal across connections', async () => {
    /** Sharing the caller-owned store must not merge distinct governor namespaces. */
    const store = createRpcIdempotencyStore()
    /** The caller supplies one deterministic clock for both independent owners. */
    const scheduler = createManualScheduler()
    /** Construction and ordinary session derivation must not emit failure reports. */
    const report = vi.fn()
    /** Explicit positive quotas exercise the supported non-default policy path. */
    const owner = createProcessResilience({
      scheduler,
      report,
      idempotencyStore: store,
      maxConnections: 2,
      maxConcurrentCallsPerConnection: 3,
      maxCallsPerMinute: 5,
      maxPayloadBytes: 1024,
      maxConsecutiveTimeouts: 2,
      idleTimeoutMs: 100,
      drainMs: 10,
      reportAtMs: [0, 10],
      unhandledLimit: 2,
      liquidation: { cascade: true }
    })
    /** A second governor deliberately reuses the same external store and principal. */
    const otherOwner = createProcessResilience({ scheduler, report, idempotencyStore: store })
    try {
      /** Physical connection and session IDs do not define authenticated deduplication scope. */
      const first = owner.sessionOptions({
        connectionId: 'first',
        sessionId: 'first-session',
        principalId: 'alice'
      })
      /** A replacement connection preserves the original principal's scope. */
      const replacement = owner.sessionOptions({
        connectionId: 'replacement',
        sessionId: 'replacement-session',
        principalId: 'alice'
      })
      /** Different authenticated principals share storage without sharing cached results. */
      const otherPrincipal = owner.sessionOptions({
        connectionId: 'other',
        sessionId: 'other-session',
        principalId: 'bob'
      })
      /** An independent owner must receive its own namespace even for the same principal. */
      const foreign = otherOwner.sessionOptions({
        connectionId: 'first',
        sessionId: 'first-session',
        principalId: 'alice'
      })
      /** Route metadata and bearer material must not affect or leak into the stable scope. */
      const scope = first.idempotency.scope!({ token: 'first-token', senderId: 'first-peer' })
      expect(first.idempotency.store).toBe(store)
      expect(replacement.idempotency.store).toBe(store)
      expect(foreign.idempotency.store).toBe(store)
      expect(scope).toBe(
        replacement.idempotency.scope!({ token: 'replacement-token', senderId: 'other-peer' })
      )
      expect(scope).not.toBe(
        otherPrincipal.idempotency.scope!({ token: 'first-token', senderId: 'first-peer' })
      )
      expect(scope).not.toBe(
        foreign.idempotency.scope!({ token: 'first-token', senderId: 'first-peer' })
      )
      expect(scope).not.toContain('first-token')
      expect(first.limits).toEqual({ maxGlobal: 3, maxPerPeer: 3 })
      expect(report).not.toHaveBeenCalled()
    } finally {
      await owner.close()
      await otherOwner.close()
    }
    expect(scheduler.pendingCount).toBe(0)
  })

  it('rejects an empty verified principal with the native public error contract', async () => {
    /** Session admission uses the same caller-owned clock as normal policy construction. */
    const scheduler = createManualScheduler()
    /** Invalid caller input is thrown to its caller rather than reported asynchronously. */
    const report = vi.fn()
    /** The public facade owns the manager that validates authenticated identities. */
    const owner = createProcessResilience({ scheduler, report })
    try {
      expect(() =>
        owner.sessionOptions({ connectionId: 'connection', sessionId: 'session', principalId: '' })
      ).toThrowError(
        expect.objectContaining({
          constructor: TypeError,
          source: '@migaia/rpc/process',
          code: 'PROCESS_RESILIENCE_INVALID_OPTION',
          message: 'process resilience options are invalid',
          detail: { field: 'identity.principalId' },
          stack: expect.stringMatching(/\S/)
        })
      )
      expect(report).not.toHaveBeenCalled()
    } finally {
      await owner.close()
    }
    expect(scheduler.pendingCount).toBe(0)
  })

  it('rejects a report schedule without a zero origin before scheduling work', () => {
    /** Construction must reject an invalid schedule without acquiring timer ownership. */
    const scheduler = createManualScheduler()
    /** A synchronous option error must not escape through the asynchronous report sink. */
    const report = vi.fn()
    expect(() => createProcessResilience({ scheduler, report, reportAtMs: [5, 10] })).toThrowError(
      expect.objectContaining({
        constructor: RangeError,
        source: '@migaia/rpc/process',
        code: 'PROCESS_RESILIENCE_INVALID_OPTION',
        message: 'process resilience options are invalid',
        detail: { field: 'reportAtMs' },
        stack: expect.stringMatching(/\S/)
      })
    )
    expect(report).not.toHaveBeenCalled()
    expect(scheduler.pendingCount).toBe(0)
  })
})
