/** Receive original one-way delivery and physical failure business through public namespaces. */
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { limits } from '@migaia/rpc-host/plugins/limits'
import { deferred } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer, connectedCoreHosts } from '../host/core-fixture.js'

/** Own only the original provider's business suspension, not RPC pending or admission state. */
class HeldNotification {
  /** The caller observes actual provider entry before checking its physical notification result. */
  readonly entered = deferred<void>()
  /** The test releases business even when an assertion fails before normal completion. */
  readonly release = deferred<void>()
  /** Original payload order remains the observable delivery oracle. */
  readonly deliveries: unknown[] = []
  /** A real provider context exposes cancellation while the business is running. */
  signal: AbortSignal | undefined

  /** Hold the genuine provider invocation until its caller explicitly releases business. */
  readonly notify = async (value: unknown, context: IRpcContext): Promise<null> => {
    this.deliveries.push(value)
    this.signal = context.signal
    this.entered.resolve()
    await this.release.promise
    return null
  }
}

it('one-way delivery does not wait for business or emit a response and releases its provider lease', async () => {
  /** The original hold remains application code, independent from the actual limits owner. */
  const business = new HeldNotification()
  /** The caller installs the same real test transport used by the other public host oracles. */
  const server = coreMemoryServer('one-way-client')
  /** This public root owns the originating call table. */
  const caller = await createRpcHost(server.options)
  /** A single real quota makes admission and release observable without a private snapshot. */
  const provider = await server.connect('one-way-server', {
    provide: { notify: business.notify, ready: () => 'ready' },
    plugins: [limits({ maxGlobal: 1, maxPerPeer: 1 })]
  })
  try {
    /** Ready traffic precedes the original no-response observation window. */
    const responseStart = provider.pair[1].written.length
    /** Notify's public Promise observes physical write without waiting for the held provider. */
    const sent = caller.memory.notify('notify', 'payload')
    await business.entered.promise
    expect(business.deliveries).toEqual(['payload'])
    await expect(sent).resolves.toBeUndefined()
    expect(business.signal?.aborted).toBe(false)
    expect(provider.pair[1].written.slice(responseStart)).toEqual([])
    await expect(caller.memory.send('one-way-server', 'ready')).rejects.toMatchObject({
      code: 'OVERLOADED'
    })
    /** The deliberate quota rejection is separate from the notification's no-response window. */
    const afterRejection = provider.pair[1].written.length
    business.release.resolve()
    await nextTurn()
    expect(provider.pair[1].written.slice(afterRejection)).toEqual([])
    expect(await caller.memory.send('one-way-server', 'ready')).toBe('ready')
  } finally {
    business.release.resolve()
    await Promise.all([caller.close(), provider.host.close()])
  }
})

it('one-way physical rejection preserves its exact cause before a later real delivery', async () => {
  /** Only actual provider calls may append payloads; failed physical delivery must append none. */
  const deliveries: unknown[] = []
  /** Real native installation and handshake complete before the controlled physical write failure. */
  const fixture = await connectedCoreHosts(
    {},
    { notify: (value) => deliveries.push(value) },
    () => undefined
  )
  /** The original raw transport failure must remain reachable by exact identity. */
  const physicalFailure = new Error('one-way physical send failed')
  /** Fail one genuine write, then automatically restore the same original physical sender. */
  const writing = vi.spyOn(fixture.pair[0], 'write').mockRejectedValueOnce(physicalFailure)
  try {
    /** Capture the real public failure without manufacturing a response or alternate call owner. */
    const failure = await fixture.a.memory.notify('notify', 'failed').then(
      () => undefined,
      (error: unknown) => error
    )
    expect(failure).toMatchObject({ code: 'TRANSPORT' })
    expect((failure as Error).cause).toBe(physicalFailure)
    expect(deliveries).toEqual([])
    await expect(fixture.a.memory.notify('notify', 'delivered')).resolves.toBeUndefined()
    await vi.waitFor(() => expect(deliveries).toEqual(['delivered']))
  } finally {
    writing.mockRestore()
    await fixture.close()
  }
})
