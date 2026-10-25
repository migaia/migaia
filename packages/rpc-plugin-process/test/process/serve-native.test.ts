import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { createManualScheduler } from '@migaia/utils/testing'
import { deferred } from '@migaia/utils/promise'
import { describe, expect, it, vi } from 'vitest'
import { createProcessCarrier } from '../../dist/process/carrier.js'
import { serveProcessSessions } from '../../dist/process/plugin/serve.js'
import { ProcessConnectionCapacity } from '../../dist/process/plugin/serve/admission.js'
import type { IProcessMessageChannel } from '../../dist/process/types.js'

/** Native MessagePorts retain their actual message/close events and original physical write. */
function messagePortIO(port: MessagePort): IProcessMessageChannel {
  return {
    kind: 'message',
    send: (value) => port.postMessage(value),
    onMessage(listener) {
      port.on('message', listener)
      return () => {
        port.off('message', listener)
      }
    },
    onClose(listener) {
      /** Node's close event is an event object, not the byte/message port's terminal reason. */
      const closed = (): void => {
        listener()
      }
      port.on('close', closed)
      return () => {
        port.off('close', closed)
      }
    },
    close: () => {
      port.close()
    }
  }
}

/** The real public hosts and Node ports expose the original grace/accepting lifecycle boundaries. */
class NativeParentFixture {
  /** One original monotonic clock owns the sole parent-loss grace timer. */
  readonly scheduler = createManualScheduler()
  /** Native exit decisions are observable without terminating the test runner. */
  readonly exit = vi.fn()
  /** Reports preserve original lifecycle failures and never stand in for exit evidence. */
  readonly reports: unknown[] = []
  /** Actual acquired ports carry the real SDK codec/Session exchange. */
  readonly ports = new MessageChannel()
  /** The child cleanup callback can remain pending under the native IO contract. */
  readonly closeGate = deferred<void>()
  /** The original native write Promise can remain unsettled during startup. */
  readonly writeGate = deferred<void>()
  /** Positive control proves real physical writing entered before parent loss. */
  readonly writing = deferred<void>()
  /** Physical child cleanup is counted independently from close method reentry. */
  readonly physicalClose = vi.fn()
  /** The same actual serve receipt supplies explicit close and its shared completion. */
  serving: Awaited<ReturnType<typeof serveProcessSessions>> | undefined
  /** Both public root owners are retained until actual native cleanup completes. */
  #hosts: readonly { close(): Promise<void> }[] = []
  /** The startup transaction is observed immediately, including expected native EOF rejection. */
  #opening: Promise<unknown> | undefined
  /** One original native cleanup operation belongs to all repeated child close calls. */
  #closing: Promise<void> | undefined
  /** Native raw IO is independent from either public RPC host. */
  readonly parent: IProcessMessageChannel
  /** The child uses the original native ports while explicit held callbacks exercise IO ownership. */
  readonly child: IProcessMessageChannel

  /** Capture an optional startup hold without creating another lifecycle manager or carrier. */
  constructor(holdWrite = false) {
    this.parent = messagePortIO(this.ports.port1)
    /** Original native operations are borrowed once, with no private endpoint replacement. */
    const child = messagePortIO(this.ports.port2)
    this.child = {
      ...child,
      send: (value) => {
        child.send(value)
        this.writing.resolve()
        return holdWrite ? this.writeGate.promise : undefined
      },
      close: () =>
        (this.#closing ??= this.closeGate.promise.then(() => {
          this.physicalClose()
          child.close()
        }))
    }
  }
  /** Both genuine native plugin installs attach their original process carriers to actual hosts. */
  open(): Promise<unknown> {
    /** The parent borrows its actual raw port without a fake handshake implementation. */
    const parent = defineTransportPlugin({
      name: 'native-parent',
      namespace: 'process',
      open: async (context) => {
        const handle = context.attach(createProcessCarrier(this.parent, context, { id: 'parent' }))
        await handle.ready
        return { dispose: () => context.detach(handle) }
      }
    })
    /** Child serve owns its guard before acquiring this original native channel. */
    const child = defineTransportPlugin({
      name: 'native-child',
      namespace: 'process',
      open: async (context) => {
        this.serving = await serveProcessSessions(
          {
            kind: 'child',
            channelKind: 'message',
            openRaw: async () => this.child,
            parentLoss: { exit: this.exit, graceMs: 100 }
          },
          context,
          { scheduler: this.scheduler, drainMs: 100 }
        )
        return {
          namespaceExtensions: { members: this.serving.members },
          dispose: this.serving.close
        }
      }
    })
    this.#opening = Promise.all([
      createRpcHost({
        self: { name: 'parent', instanceId: 'a-parent' },
        plugins: [parent],
        report: (error) => this.reports.push(error)
      }),
      createRpcHost({
        self: { name: 'child', instanceId: 'z-child' },
        plugins: [child],
        report: (error) => this.reports.push(error)
      })
    ])
      .then((hosts) => {
        this.#hosts = hosts
      })
      .catch((error: unknown) => error)
    return this.#opening
  }
  /** Release only original native callbacks and join public-host teardown after each case. */
  async close(): Promise<void> {
    this.writeGate.resolve()
    this.closeGate.resolve()
    this.parent.close()
    await this.#opening
    await Promise.all(this.#hosts.map((host) => host.close()))
    this.ports.port1.close()
    this.ports.port2.close()
  }
}

describe('native child parent-loss ownership', () => {
  it.each(['graceful', 'hung', 'explicit'] as const)(
    'keeps the original ready-session %s grace and exit contract',
    async (mode) => {
      /** Each mode retains the same100ms grace and99/100 boundary as C0. */
      const fixture = new NativeParentFixture()
      if (mode !== 'hung') fixture.closeGate.resolve()
      try {
        await fixture.open()
        expect(fixture.serving).toBeDefined()
        if (mode === 'explicit') {
          const closing = fixture.serving!.close()
          expect(fixture.serving!.close()).toBe(closing)
          await closing
          expect(fixture.exit).not.toHaveBeenCalled()
        } else {
          fixture.parent.close()
          if (mode === 'graceful')
            await vi.waitFor(() => expect(fixture.exit).toHaveBeenCalledWith(0))
          else {
            await vi.waitFor(() => expect(fixture.scheduler.pendingCount).toBeGreaterThan(0))
            fixture.scheduler.advance(99)
            expect(fixture.exit).not.toHaveBeenCalled()
            fixture.scheduler.advance(1)
            expect(fixture.exit).toHaveBeenCalledWith(1)
          }
          expect(fixture.exit).toHaveBeenCalledTimes(1)
        }
      } finally {
        await fixture.close()
      }
      expect(fixture.physicalClose).toHaveBeenCalledTimes(1)
    }
  )

  it('enters the same grace while actual child preparation and native cleanup remain pending', async () => {
    /** A real native write enters before the child's Session can publish readiness. */
    const fixture = new NativeParentFixture(true)
    try {
      void fixture.open()
      await fixture.writing.promise
      expect(fixture.serving).toBeUndefined()
      fixture.parent.close()
      await vi.waitFor(() => expect(fixture.scheduler.pendingCount).toBeGreaterThan(0))
      fixture.scheduler.advance(99)
      expect(fixture.exit).not.toHaveBeenCalled()
      fixture.scheduler.advance(1)
      expect(fixture.exit).toHaveBeenCalledWith(1)
      expect(fixture.exit).toHaveBeenCalledTimes(1)
    } finally {
      await fixture.close()
    }
    expect(fixture.physicalClose).toHaveBeenCalledTimes(1)
  })
})

it('moves the original default64 native slots, closed errors and idempotent leases to one owner', () => {
  /** No provider policy participates in physical native connection capacity. */
  const capacity = new ProcessConnectionCapacity()
  /** These are the original64 independent physical acquisition receipts. */
  const leases = Array.from({ length: 64 }, () => capacity.claim())
  expect(() => capacity.claim()).toThrowError(
    expect.objectContaining({ code: 'PROCESS_CONNECTION_LIMIT' })
  )
  leases[0]!.release()
  leases[0]!.release()
  const replacement = capacity.claim()
  expect(() => capacity.claim()).toThrowError(
    expect.objectContaining({ code: 'PROCESS_CONNECTION_LIMIT' })
  )
  replacement.release()
  capacity.close()
  expect(() => capacity.claim()).toThrowError(
    expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })
  )
  for (const lease of leases) lease.release()
})
