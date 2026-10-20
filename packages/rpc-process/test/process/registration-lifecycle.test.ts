import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  createNativeProcessOffer,
  createProcessResilience,
  createProcessTransport,
  type IListenProcessByteChannel,
  type IProcessPendingByteConnection,
  type IProcessRegistrationListenOptions,
  type IProcessSessionLease
} from '../../src/process/index.js'

/** Flush only the public listener's asynchronous candidate continuation. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve()
}

/** A caller-supplied listener exposes candidates while Core owns each real channel. */
async function registrationFixture(
  onCandidate: IProcessRegistrationListenOptions['onCandidate'],
  maxConnections = 1
) {
  /** One clock and report sink retain admission, cleanup, and error evidence. */
  const scheduler = createManualScheduler()
  /** Reports preserve exact callback failures for public contract assertions. */
  const reports: unknown[] = []
  /** The governor receives the same public transport objects an adapter would return. */
  const resilience = createProcessResilience({
    scheduler,
    report: (error) => reports.push(error),
    maxConnections
  })
  /** Captured callback belongs to the injected public native listener boundary. */
  let accept!: Parameters<IListenProcessByteChannel>[0]['onConnection']
  /** The listener disposer can fail independently from candidate cleanup. */
  const close = vi.fn(async () => undefined)
  /** Ordinary connection metadata is independent from the authenticated principal. */
  const options: IProcessRegistrationListenOptions = {
    wire: 'native',
    address: 'tcp://127.0.0.1:0',
    offer: createNativeProcessOffer({ peer: { id: 'server', runtime: 'node' } }),
    scheduler,
    listen: async (input) => {
      accept = input.onConnection
      return { address: input.address, close }
    },
    verifyToken: () => 'principal',
    createConnectionContext: () => ({
      peerId: 'peer',
      ipc: {
        connectionId: 'connection',
        sessionId: 'session',
        processId: 'process',
        log: () => undefined
      }
    }),
    onCandidate
  }
  /** Opening through the governor gives it ownership of the returned listener. */
  const listener = await resilience.listenRegistrations(options)
  return { scheduler, reports, resilience, options, listener, accept, close }
}

/** The pending adapter hands off a genuinely constructed public message channel. */
async function candidate() {
  /** Physical closure remains independently observable after transport handoff. */
  const close = vi.fn(async () => undefined)
  /** No message or byte handshake is fabricated by the session lifecycle fixture. */
  const channel = await createProcessTransport(
    {
      kind: 'message',
      send: () => undefined,
      onMessage: () => () => undefined,
      onClose: () => () => undefined,
      close
    },
    {
      peerId: 'peer',
      report: () => undefined,
      ipc: { connectionId: 'connection', sessionId: 'session', log: () => undefined },
      staticAgreement: {
        local: { codec: 'identity', capabilities: [] },
        peer: { codec: 'identity', capabilities: [] }
      }
    }
  )
  /** Rejecting before accept closes pending; after accept only the real channel is closed. */
  const pendingClose = vi.fn(async () => undefined)
  /** Public accept is the adapter's authentication and channel ownership transfer boundary. */
  const pending: IProcessPendingByteConnection = {
    accept: async () => ({ channel, principalId: 'principal' }),
    close: pendingClose
  }
  return { channel, pending, close, pendingClose }
}

describe('registration listener ownership', () => {
  it('rejects a candidate, returns its admission slot, and retains authenticated identity', async () => {
    /** Public candidate leases expose identity independently from route peerId. */
    const leases: IProcessSessionLease[] = []
    /** Rejecting both connections proves the one-slot budget is released after each close. */
    const fixture = await registrationFixture((lease) => {
      leases.push(lease)
      return 'reject'
    })
    /** Two physical channels reuse the same bounded listener sequentially. */
    const first = await candidate()
    const second = await candidate()
    try {
      await fixture.accept(first.pending)
      await settle()
      await fixture.accept(second.pending)
      await settle()
      expect(leases).toHaveLength(2)
      expect(leases[0]!.identity).toEqual({
        connectionId: 'connection',
        sessionId: 'session',
        principalId: 'principal',
        processId: 'process'
      })
      expect(first.close).toHaveBeenCalledOnce()
      expect(second.close).toHaveBeenCalledOnce()
      expect(first.pendingClose).not.toHaveBeenCalled()
      expect(fixture.reports).toEqual([])
    } finally {
      await fixture.resilience.close()
      await first.channel.close()
      await second.channel.close()
    }
  })

  it('keeps adopted channels alive when the listener closes and joins repeated lease close', async () => {
    /** The caller explicitly receives and retains the only adopted lease. */
    let adopted!: IProcessSessionLease
    /** Adoption transfers lifetime without creating a second physical channel. */
    const fixture = await registrationFixture((lease) => {
      adopted = lease
      return 'adopt'
    })
    /** A complete public transport lets closure be asserted independently of listener state. */
    const owned = await candidate()
    try {
      await fixture.accept(owned.pending)
      await settle()
      await fixture.listener.close()
      expect(owned.close).not.toHaveBeenCalled()
      expect(fixture.close).toHaveBeenCalledOnce()
      /** Each caller joins the exact candidate-owned Promise after explicit retirement. */
      const closing = adopted.close()
      expect(adopted.close()).toBe(closing)
      await closing
      expect(owned.close).toHaveBeenCalledOnce()
      expect(fixture.reports).toEqual([])
    } finally {
      await owned.channel.close()
      await fixture.resilience.close()
    }
  })

  it('rejects excess candidates before accept while an adopted connection owns the quota', async () => {
    /** One adopted connection intentionally occupies the complete configured quota. */
    let adopted!: IProcessSessionLease
    /** Observed callbacks prove the rejected candidate is never authenticated or published. */
    const onCandidate = vi.fn((lease: IProcessSessionLease) => {
      adopted = lease
      return 'adopt' as const
    })
    /** One admission slot provides the public overload boundary. */
    const fixture = await registrationFixture(onCandidate)
    /** Both channels still require independent final cleanup in this fixture. */
    const first = await candidate()
    const second = await candidate()
    /** Authentication must not start when the public quota rejects a candidate. */
    const accept = vi.fn(second.pending.accept)
    try {
      await fixture.accept(first.pending)
      await settle()
      await fixture.accept({ ...second.pending, accept })
      await settle()
      expect(accept).not.toHaveBeenCalled()
      expect(second.pendingClose).toHaveBeenCalledOnce()
      expect(onCandidate).toHaveBeenCalledOnce()
      expect(fixture.reports).toEqual([
        expect.objectContaining({ source: '@migaia/rpc/process', code: 'PROCESS_CONNECTION_LIMIT' })
      ])
      await adopted.close()
    } finally {
      await first.channel.close()
      await second.channel.close()
      await fixture.resilience.close()
    }
  })

  it('reports a candidate callback failure and closes its channel before admitting another', async () => {
    /** The original application failure remains identifiable through the public report hook. */
    const failure = new Error('candidate rejected by application')
    /** Both callbacks fail through the same normal extension boundary. */
    const fixture = await registrationFixture(() => {
      throw failure
    })
    /** Independent channels prove rollback returns the bounded connection lease. */
    const first = await candidate()
    const second = await candidate()
    try {
      for (const owned of [first, second]) {
        await fixture.accept(owned.pending)
        await settle()
        expect(owned.close).toHaveBeenCalledOnce()
      }
      expect(fixture.reports).toEqual([failure, failure])
    } finally {
      await first.channel.close()
      await second.channel.close()
      await fixture.resilience.close()
    }
  })

  it('rejects invalid listener policy before acquisition and closed owners before reopening', async () => {
    /** A valid unopened native listener is reused while varying independent public policy fields. */
    const fixture = await registrationFixture(() => 'reject')
    /** No invalid option may acquire an additional physical listener. */
    const listen = vi.fn(fixture.options.listen)
    try {
      for (const input of [
        { ...fixture.options, listen, wire: 'other' },
        { ...fixture.options, listen, address: '/fixture.sock', serviceId: '' }
      ]) {
        await expect(
          fixture.resilience.listenRegistrations(input as IProcessRegistrationListenOptions)
        ).rejects.toMatchObject({
          source: '@migaia/rpc/process',
          code: 'PROCESS_RESILIENCE_INVALID_OPTION'
        })
      }
      expect(listen).not.toHaveBeenCalled()
      await fixture.resilience.close()
      await expect(fixture.resilience.listenRegistrations(fixture.options)).rejects.toMatchObject({
        source: '@migaia/rpc/process',
        code: 'PROCESS_CHANNEL_CLOSED'
      })
      expect(() => fixture.resilience.onTerminal(() => undefined)).toThrow(
        expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })
      )
    } finally {
      await fixture.resilience.close()
    }
  })

  it('retires a listener acquired after its governor has already closed', async () => {
    /** The first listener is fully acquired before a second native bind is held pending. */
    const fixture = await registrationFixture(() => 'reject')
    /** The native listener factory settles only after public governor close has finished. */
    let publish!: (listener: { address: string; close(): Promise<void> }) => void
    /** This deferred native acquisition models an ordinary asynchronous bind operation. */
    const acquired = new Promise<{ address: string; close(): Promise<void> }>((resolve) => {
      publish = resolve
    })
    /** The late native resource must be returned even though it was never published to a caller. */
    const close = vi.fn(async () => undefined)
    /** Rejection is observed immediately so asynchronous acquisition cannot leak a rejection. */
    const opening = fixture.resilience.listenRegistrations({
      ...fixture.options,
      listen: () => acquired
    })
    /** The original governor owns all listeners it successfully publishes. */
    const rejected = expect(opening).rejects.toMatchObject({
      source: '@migaia/rpc/process',
      code: 'PROCESS_CHANNEL_CLOSED'
    })
    await fixture.resilience.close()
    publish({ address: 'tcp://127.0.0.1:1', close })
    await rejected
    expect(close).toHaveBeenCalledOnce()
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(fixture.reports).toEqual([])
  })

  it('attempts every listener close and preserves each native cleanup failure', async () => {
    /** Independent native listeners may fail cleanup without suppressing their siblings. */
    const fixture = await registrationFixture(() => 'reject')
    /** Both original failure instances must survive the governor's one aggregate settlement. */
    const first = new Error('first listener close failed')
    /** A second failure proves the aggregate collects outcomes instead of failing fast. */
    const second = new Error('second listener close failed')
    fixture.close.mockRejectedValue(first)
    /** The second native disposer remains independently observable after the first one rejects. */
    const close = vi.fn(async () => {
      throw second
    })
    await fixture.resilience.listenRegistrations({
      ...fixture.options,
      listen: async () => ({ address: 'tcp://127.0.0.1:1', close })
    })
    /** Repeated owner close must join the same public failure outcome. */
    const closing = fixture.resilience.close()
    expect(fixture.resilience.close()).toBe(closing)
    await expect(closing).rejects.toSatisfy((error: AggregateError) => {
      expect(error).toMatchObject({
        constructor: AggregateError,
        source: '@migaia/rpc/process',
        code: 'PROCESS_CHANNEL_CLOSED'
      })
      expect(error.errors).toHaveLength(2)
      expect(error.errors[0]).toBe(first)
      expect(error.errors[1]).toBe(second)
      return true
    })
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(fixture.reports).toEqual([])
  })
})
