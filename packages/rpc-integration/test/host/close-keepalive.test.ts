/** A23 uses genuine Process and Worker children, with no fabricated Session or close observer. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { deferred } from '@migaia/utils/promise'
import { probe } from '@migaia/rpc-host/plugins/probe'
import { defineFlowFeature, type IRpcFlowInstallation } from '@migaia/rpc-host/sdk'
import { RpcProbeDirection, RpcProbeKind } from '@migaia/rpc-contract/interfaces'
import { RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { CloseFixture, closeFixtureReason, type ICloseFixtureMode } from './fixtures/close-child.js'

/** The same public namespace exposes either actual native medium; the child itself has its own Host. */
function transport(kind: 'process' | 'thread', mode: ICloseFixtureMode = 'namespace') {
  return kind === 'process'
    ? processPlugin({
        name: CloseFixture.child,
        namespace: CloseFixture.namespace,
        spawn: {
          entry: new URL('./fixtures/close-process-child.ts', import.meta.url),
          args: [mode]
        }
      })
    : threadPlugin({
        name: CloseFixture.child,
        namespace: CloseFixture.namespace,
        spawn: { entry: new URL('./fixtures/close-thread-child.ts', import.meta.url), data: mode }
      })
}

/** A single real named stage holds one closing write so a second operation reaches its FIFO. */
class ClosingWriteGate {
  /** This barrier records actual first-frame entry at the original outbound intervention point. */
  readonly entered = deferred<void>()
  /** Only the test releases the original continuation; Session still owns cancellation and cleanup. */
  readonly release = deferred<void>()
  /** Later frames use the same stage without another wait. */
  #held = false
  /** The normal SDK factory installs this exact stage, with no alternate send or codec path. */
  readonly plugin = defineFlowFeature({
    name: 'a23-closing-write-gate',
    setup: () => this.#installation()
  })

  /** Build only ordinary native pipeline registration output. */
  #installation(): IRpcFlowInstallation {
    return { stages: { frameOutbound: this.#write } }
  }

  /** One held closing continuation preserves the physical writer's exact order. */
  readonly #write: NonNullable<IRpcFlowInstallation['stages']>['frameOutbound'] = async (
    payload,
    next
  ) => {
    if (payload.write?.closing && !this.#held) {
      this.#held = true
      this.entered.resolve()
      await this.release.promise
    }
    return next(payload)
  }
}

it.each(['process', 'thread'] as const)(
  'A23 %s writes keepalive calls before the close frame and retains the remote cause',
  async (kind) => {
    /** Provider rows are appended only by actual messages received from the child. */
    const received: unknown[] = []
    /** The close event comes from the receiving Session's actual wire control admission. */
    const closed = deferred<unknown>()
    /** A real reverse request holds child closing while the parent probes ordinary inbound work. */
    const closingEntered = deferred<void>()
    /** Releasing this application reply lets the child's original closing hook finish normally. */
    const reply = deferred<void>()
    /** Secondary failures remain observable without being confused with close's primary error. */
    const reports: unknown[] = []
    /** This Host owns the actual transport, provider catalog and close-event subscription. */
    const host = await createRpcHost({
      plugins: [transport(kind)] as const,
      report: (error) => reports.push(error),
      provide: {
        mark: (value: unknown) => received.push(value),
        answer: async (value: unknown) => {
          received.push(value)
          closingEntered.resolve()
          await reply.promise
          return 42
        }
      }
    })
    /** Disposing the original subscription is idempotent and never closes the native carrier. */
    const remove = host.native.onPeerClosed((event) => {
      received.push('close')
      closed.resolve(event)
    })
    try {
      expect(await host.native.send(CloseFixture.child, 'echo', 21)).toBe(21)
      await host.native.notify('beginClose')
      await closingEntered.promise
      await expect(host.native.send(CloseFixture.child, 'echo', 99)).rejects.toMatchObject({
        code: 'ENDPOINT_DISPOSED',
        cause: { code: 'TRANSPORT', message: CloseFixture.primary }
      })
      reply.resolve()
      expect(await closed.promise).toMatchObject({
        closeFrame: true,
        reason: {
          source: 'rpc.endpoint',
          code: 'TRANSPORT',
          message: CloseFixture.primary,
          cause: {
            source: 'rpc.endpoint',
            code: 'ENDPOINT_DISPOSED',
            message: CloseFixture.cause
          }
        }
      })
      expect(received).toEqual([
        CloseFixture.notify,
        CloseFixture.request,
        {
          kind: CloseFixture.summary,
          response: 42,
          ordinary: 'ENDPOINT_DISPOSED',
          quota: 'KEEPALIVE_QUOTA_EXCEEDED',
          echoCalls: 1
        },
        'close'
      ])
      await expect(host.native.send(CloseFixture.child, 'echo', 1)).rejects.toMatchObject({
        code: 'TRANSPORT',
        message: CloseFixture.primary
      })
    } finally {
      reply.resolve()
      remove()
      remove()
      await host.close()
    }
  },
  15000
)

it.each(['process', 'thread'] as const)(
  'A23 %s bounds an unanswered closing request and reports hook errors without replacing close',
  async (kind) => {
    /** Reports preserve the actual thrown hook Error identity rather than a synthetic projection. */
    const reports: unknown[] = []
    /**
     * The configured clock budget is short, but this is behavioral evidence, not a timing
     * benchmark.
     */
    const host = await createRpcHost({
      plugins: [transport(kind)] as const,
      keepalive: { timeoutMs: 50 },
      report: (error) => reports.push(error)
    })
    /** The original close reason must remain the pending call's cause after the budget expires. */
    const reason = closeFixtureReason()
    /** One hook error is reported while the following hook still executes. */
    const hookError = new Error(CloseFixture.hook)
    /** Completion is observed independently from the request rejection and original host close. */
    const pending = deferred<unknown>()
    host.native.onClosing(() => {
      throw hookError
    })
    host.native.onClosing(async () => {
      try {
        await host.native.send(CloseFixture.child, 'hang', undefined, { keepalive: true })
      } catch (error) {
        pending.resolve(error)
      }
    })
    await expect(host.close(reason)).resolves.toBeUndefined()
    expect(reports).toContain(hookError)
    expect(await pending.promise).toMatchObject({ code: 'ENDPOINT_DISPOSED', cause: reason })
  },
  15000
)

it.each(['maxBytes', 'timeoutMs'] as const)(
  'A23 rejects invalid keepalive.%s before acquisition',
  (key) => {
    for (const value of [0, -1, 1.5])
      expect(() =>
        createRpcHost({ plugins: [transport('thread')], keepalive: { [key]: value } })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  }
)

it.each(['process', 'thread'] as const)(
  'A23 %s distinguishes Host disposal, liquidation and idle close notifications',
  async (kind) => {
    for (const mode of ['host', 'limits', 'idle'] as const) {
      /** Each policy owns a separate real child so retirement cannot reuse another case's facts. */
      const host = await createRpcHost({
        plugins: [transport(kind, mode)] as const,
        report: () => undefined
      })
      /** Only the original receiving Session can publish this actual retirement event. */
      const closed = deferred<unknown>()
      host.native.onPeerClosed((event) => closed.resolve(event))
      try {
        if (mode === 'host') await host.native.notify('beginClose')
        else if (mode === 'limits')
          await host.native.send(CloseFixture.child, 'echo', 'x'.repeat(100)).catch(() => undefined)
        /** Idle is caused by the actual configured governor, with no synthetic detach invocation. */
        const event = await closed.promise
        expect(event).toMatchObject({ closeFrame: true })
        if (mode === 'host')
          expect(event).toMatchObject({
            reason: { code: 'TRANSPORT', message: CloseFixture.primary }
          })
        else if (mode === 'idle')
          expect(event).toMatchObject({
            reason: { code: 'ENDPOINT_DISPOSED', message: 'Connection idle timeout' }
          })
        else
          expect(event).toMatchObject({
            reason:
              kind === 'process'
                ? { code: 'PROCESS_LIQUIDATED', cause: { code: 'OVERLOADED' } }
                : { code: 'OVERLOADED' }
          })
      } finally {
        await host.close()
      }
    }
  },
  20000
)

it('A23 preserves the actual killed Process signal when no close frame could be written', async () => {
  /** Public native members retain the original supervisor; the fixture does not replace it. */
  const host = await createRpcHost({
    plugins: [transport('process')] as const,
    report: () => undefined
  })
  /** Native EOF can precede the actual exit receipt; the one Session close budget joins both. */
  const closed = deferred<unknown>()
  host.native.onPeerClosed((event) => closed.resolve(event))
  try {
    /** This pid comes from the genuine spawned child through its accepted provider connection. */
    const pid = await host.native.send(CloseFixture.child, 'nativePid')
    expect(typeof pid).toBe('number')
    expect(pid).not.toBe(process.pid)
    process.kill(pid as number, 'SIGKILL')
    expect(await closed.promise).toMatchObject({
      closeFrame: false,
      reason: { code: 'PROCESS_CHANNEL_CLOSED', detail: { exitCode: null, signal: 'SIGKILL' } }
    })
  } finally {
    await host.close()
  }
}, 15000)

it.each(['process', 'thread'] as const)(
  'A23 %s keeps local and remote reasons distinct when both endpoints close',
  async (kind) => {
    /** Actual application reply suspension first proves the child is already closing. */
    const childClosing = deferred<void>()
    /** This reply remains ordinary admitted provider work while the parent also starts closing. */
    const reply = deferred<void>()
    /** The original probe observes a real inbound close control before Session retirement. */
    const closeWire = deferred<void>()
    /** Local hook entry distinguishes started closing from a merely scheduled host.close call. */
    const localClosing = deferred<void>()
    /** The public peer event must contain the child reason even when local close owns another one. */
    const departed = deferred<unknown>()
    const host = await createRpcHost({
      plugins: [
        probe({
          stages: ['message'],
          emit: (event) => {
            if (
              event.direction === RpcProbeDirection.inbound &&
              event.kind === RpcProbeKind.control &&
              event.variation === 'close'
            )
              closeWire.resolve()
          }
        }),
        transport(kind)
      ] as const,
      report: () => undefined,
      provide: {
        mark: () => undefined,
        answer: async () => {
          childClosing.resolve()
          await reply.promise
          return 42
        }
      }
    })
    host.native.onPeerClosed((event) => departed.resolve(event))
    host.native.onClosing(async () => {
      localClosing.resolve()
      await closeWire.promise
    })
    /** The parent's original primary stays independent from the child's final wire reason. */
    const localReason = new RpcError(RpcCoreErrorCode.overloaded, CloseFixture.local)
    try {
      await host.native.notify('beginClose')
      await childClosing.promise
      const closing = host.close(localReason)
      await localClosing.promise
      reply.resolve()
      await closing
      expect(await departed.promise).toMatchObject({
        closeFrame: true,
        reason: { code: 'TRANSPORT', message: CloseFixture.primary }
      })
    } finally {
      reply.resolve()
      closeWire.resolve()
      await host.close()
    }
  },
  15000
)

it.each(['process', 'thread'] as const)(
  'A23 %s charges the same captured payload that its closing FIFO writes',
  async (kind) => {
    /** This is a genuine optional stage in the Host's one declared outbound pipeline. */
    const gate = new ClosingWriteGate()
    const host = await createRpcHost({
      plugins: [gate.plugin, transport(kind)] as const,
      report: () => undefined
    })
    /** The result is the actual child response, never a claimed byte counter. */
    let result: unknown
    host.native.onClosing(async () => {
      const first = host.native.send(CloseFixture.child, 'echo', 1, { keepalive: true })
      await gate.entered.promise
      /** Ordinary mutable data changes only after this call has reached the physical FIFO. */
      const payload = { value: 'x' }
      const second = host.native.send(CloseFixture.child, 'echoPayload', payload, {
        keepalive: true
      })
      await new Promise<void>((resolve) => setImmediate(resolve))
      payload.value = 'x'.repeat(100000)
      gate.release.resolve()
      await first
      result = await second
    })
    try {
      await host.close()
      expect(result).toEqual({ value: 'x' })
    } finally {
      gate.release.resolve()
      await host.close()
    }
  },
  15000
)
