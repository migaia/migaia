import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** Original reference-Memory capacity and observer assertions use the installed Auth owner. */
import { createRpcHost } from '@migaia/rpc-host'
import auth from '@migaia/rpc-host/plugins/auth'
import type { IRpcProviderRejection } from '@migaia/rpc-contract/errors'
import { deserializeRpcWireError } from '@migaia/rpc-contract/protocol'
import assert from 'node:assert/strict'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.ts'

/** Only this portable fixture credential is admitted by the actual handshake verifier. */
const replayCredential = 'auth-capacity-fixture-credential'

/** Only native errors reported by the real Host enter this receiving observation. */
type IReportedError = Error & { code?: string; cause?: unknown }

/** Separate actual Auth capacity errors from callback-failure diagnostics. */
function isReplayRefusal(error: IReportedError): boolean {
  return error.code === 'OVERLOADED'
}

/** Observer failures retain their own public code and original native cause. */
function isObserverFailure(error: IReportedError): boolean {
  return error.code === 'INTERNAL'
}

/** Credential-only admission keeps request-ID replay distinct from signed-counter admission. */
function verifyReplayCredential(credentials: unknown): void {
  if (credentials !== replayCredential) throw new Error('unrecognized Auth capacity credentials')
}

/** Each real Host installs its own mutable replay owner from this reusable cold definition. */
const clientAuthentication = auth({
  credentials: replayCredential,
  verifyCredentials: verifyReplayCredential
})

// And share one real workload.
it.each([undefined, 1101])(
  'retains the default1024 and explicit%s completed Auth workload without business overflow',
  async (maximum) => {
    /** The unchanged default is selected by omission, rather than an explicit surrogate1024. */
    const admitted = maximum ?? 1024
    /** Only the genuine application provider increments this effect count. */
    let effects = 0
    /** Local rejection notices come from the same installed Auth owner as the refusal. */
    const notices: IRpcProviderRejection[] = []
    /** Reference Memory deliberately claims no qualified native replay retention. */
    const server = coreMemoryServer('replay-server')
    /** Auth alone owns replay capacity; no provider-concurrency policy is installed here. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [
        rpcFeaturesPlugin({
          features: {
            feature0: auth({
              credentials: replayCredential,
              verifyCredentials: verifyReplayCredential,
              retain: 310_000,
              ...(maximum === undefined ? {} : { maxReplayEntriesPerPeer: maximum }),
              onRejected: (notice) => {
                notices.push(notice)
              }
            })
          }
        }),
        ...server.options.plugins
      ],
      provide: {
        echo: (value, context) => {
          effects += 1
          return context.success(value)
        }
      }
    })
    /** Every invocation uses this original accepted Session and its actual allocated task. */
    const client = await server.connect('replay-client', {
      plugins: [rpcFeaturesPlugin({ features: { feature0: clientAuthentication } })]
    })
    try {
      for (let index = 0; index < admitted; index++) {
        /** Both old suites observe this one real result without sending duplicate workload. */
        const result = await client.host.memory.send('replay-server', 'echo', index)
        expect(result).toBe(index)
        if (maximum === undefined) assert.equal(result, index)
      }
      if (maximum === undefined) assert.equal(effects, 1024)
      /** The default row retains the original default-preservation fixture payload. */
      const overflow = client.host.memory.send(
        'replay-server',
        'echo',
        maximum === undefined ? 'next' : null
      )
      await expect(overflow).rejects.toMatchObject({ code: 'OVERLOADED' })
      if (maximum === undefined) {
        await assert.rejects(
          overflow,
          { code: 'OVERLOADED' },
          'public default per-peer replay limit stays 1024'
        )
        assert.equal(effects, 1024, 'overflow executes no business')
        assert.equal(notices.length, 1)
        assert.equal(notices[0]!.reason, 'replayLedgerFull')
      }
    } finally {
      await Promise.all([client.host.close(), host.close()])
    }
  }
)

// Moves validation from private composition to the public factory.
it.each([0, -1, 1.5, NaN])('rejects invalid explicit Auth replay limit%s', (value) => {
  expect(() =>
    auth({
      credentials: replayCredential,
      verifyCredentials: verifyReplayCredential,
      maxReplayEntriesPerPeer: value
    })
  ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
})

// Hooks DTOs retire; public refusals and observer causes remain.
it.each(['none', 'ok', 'throw', 'reject'] as const)(
  'preserves request and notify Auth replay refusal with%s rejection observer',
  async (mode) => {
    /** The original native observer failure must remain reachable by exact identity. */
    const original = new Error('capacity observer fixture failure')
    /** The genuine public report callback receives errors, rather than a reconstructed hook event. */
    const reports: IReportedError[] = []
    /** Preserve the same synchronous throw and asynchronous reject observer branches. */
    const observer = vi.fn((_notice: IRpcProviderRejection) => {
      if (mode === 'throw') throw original
      if (mode === 'reject') return Promise.reject(original)
    })
    /** One original reference-Memory source is shared by the request and directed notification. */
    const server = coreMemoryServer('ledger-server')
    /** Only Auth retains the first completed task; absent observers are genuinely omitted. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [
        rpcFeaturesPlugin({
          features: {
            feature0: auth({
              credentials: replayCredential,
              verifyCredentials: verifyReplayCredential,
              retain: 310_000,
              maxReplayEntriesPerPeer: 1,
              ...(mode === 'none' ? {} : { onRejected: observer })
            })
          }
        }),
        ...server.options.plugins
      ],
      report: (error) => {
        if (error instanceof Error) reports.push(error)
      },
      provide: { echo: (value, context) => context.success(value) }
    })
    /** The client uses real routing and call IDs without an inbound capacity surrogate. */
    const client = await server.connect('ledger-client', {
      plugins: [rpcFeaturesPlugin({ features: { feature0: clientAuthentication } })]
    })
    try {
      expect(await client.host.memory.send('ledger-server', 'echo', null)).toBe(null)
      await expect
        .soft(client.host.memory.send('ledger-server', 'echo', 'secret-request-payload'))
        .rejects.toMatchObject({ code: 'OVERLOADED', message: 'Request replay ledger is full' })
      await client.host.memory.notify('echo', 'secret-oneway-payload', {
        targetId: 'ledger-server'
      })
      /** Real report delivery proves both refusals reached terminal handling even without observer. */
      await vi.waitFor(() => expect(reports.filter(isReplayRefusal)).toHaveLength(2))
      await vi.waitFor(() => expect(observer).toHaveBeenCalledTimes(mode === 'none' ? 0 : 2))
      /** Actual allocated calls provide the correlations; no response or caller identity is forged. */
      const calls = client.pair[1].written.filter(
        (frame) => frame.kind === 'call' && frame.task.method === 'echo'
      )
      /** The second physical call is the refused scalar request on the original accepted source. */
      const request = calls[1]
      /** The third physical call is the directed notify, whose failure must send no terminal. */
      const notification = calls[2]
      assert(request?.kind === 'call' && notification?.kind === 'call')
      /** Directory and the first successful response are excluded by the actual attempted task IDs. */
      const replies = client.pair[0].written.filter(
        (frame) =>
          (frame.kind === 'result' || frame.kind === 'error') &&
          (frame.id === request.id || frame.id === notification.id) &&
          frame.route.receiverId === request.route.senderId
      )
      expect(replies).toHaveLength(1)
      /** Only the real Contract decoder restores the admitted new-profile flat error. */
      const response = replies[0]
      assert(response?.kind === 'error')
      expect
        .soft(deserializeRpcWireError(response.error))
        .toMatchObject({ code: 'OVERLOADED', message: 'Request replay ledger is full' })
      expect(reports.filter(isReplayRefusal)[0]).toMatchObject({
        source: 'rpc.endpoint',
        code: 'OVERLOADED',
        message: 'Request replay ledger is full'
      })
      for (const [notice] of observer.mock.calls) {
        expect(Object.keys(notice).sort()).toEqual([
          'controllerKey',
          'method',
          'reason',
          'verifiedPeerKey'
        ])
        expect(notice.reason).toBe('replayLedgerFull')
      }
      if (mode === 'throw' || mode === 'reject') {
        await vi.waitFor(() => expect(reports.filter(isObserverFailure)).toHaveLength(2))
        for (const error of reports.filter(isObserverFailure)) {
          expect(error).toMatchObject({ cause: original, code: 'INTERNAL' })
          expect(error.cause).toBe(original)
        }
      }
      /** Removed Host clock injection is separate from the still-live repeated refusal behavior. */
      await expect(client.host.memory.send('ledger-server', 'echo', null)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(JSON.stringify(observer.mock.calls)).not.toContain('secret-')
    } finally {
      await Promise.all([client.host.close(), host.close()])
    }
  }
)
