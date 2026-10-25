/** Original control success, correlation and drain admission use actual SDK Session owners. */
import { assert, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type {
  IRpcObservation,
  IRpcTransportContext,
  IRpcSessionHandle
} from '@migaia/rpc-contract/interfaces'
import type { IRpcControlFrame, IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

/** One genuine native installation lends its original control methods and observation receipt. */
class NativeControlSource {
  /** The existing real medium retains its only receiver, codec and physical write owner. */
  readonly carrier: MemoryCarrier
  /** Only the genuine native install may supply this SDK authority. */
  context: IRpcTransportContext | undefined
  /** SessionTable creates and owns this exact original physical generation handle. */
  handle: IRpcSessionHandle | undefined
  /** Readonly native observations retain their original objects without rebuilding hook events. */
  readonly observations: IRpcObservation[] = []
  /** Original errors remain available by identity at the actual configured report boundary. */
  readonly errors: unknown[] = []
  /** The actual SDK definition performs the only physical Session attachment. */
  readonly transport
  /** This observer uses the supported readonly SDK port and executes no stages or decoder. */
  readonly observer

  /** Cold definitions acquire no native resource before their genuine public Host installs them. */
  constructor(name: string) {
    this.carrier = new MemoryCarrier(name)
    this.transport = defineTransportPlugin({
      name: `${name}-control-source`,
      namespace: 'memory',
      open: this.#open
    })
    this.observer = defineFlowPlugin({ name: `${name}-control-observer`, setup: this.#setup })
  }

  /** Setup lends only the original readonly callback; it creates no callback dispatch table. */
  readonly #setup = () => ({ observe: this.#observe })

  /** The actual Root emits peer drain intention after the Session admits the original frame. */
  readonly #observe = (event: IRpcObservation): void => {
    this.observations.push(event)
  }

  /** This configured public report callback preserves each original native error object. */
  readonly report = (error: unknown): void => {
    this.errors.push(error)
  }

  /** Native source acquisition borrows SessionTable's sole receiver and readiness ownership. */
  readonly #open = (context: IRpcTransportContext) => {
    this.context = context
    this.handle = context.attach(this.carrier)
    return { dispose: () => undefined }
  }
}

/** Join two genuine public hosts; no Peer, announceClose facade or control runner is supplied. */
async function nativeControlPair() {
  /** The original endpoint names remain the drain requester's observable identities. */
  const first = new NativeControlSource('a')
  /** Independent native acquisition owns the opposite physical endpoint. */
  const second = new NativeControlSource('b')
  first.carrier.link(second.carrier)
  second.carrier.link(first.carrier)
  /** Both original native receivers attach before either asynchronous hello is delivered. */
  const hosts = await Promise.all([
    createRpcHost({
      self: { name: 'a', instanceId: 'a' },
      plugins: [first.observer, first.transport],
      report: first.report
    }),
    createRpcHost({
      self: { name: 'b', instanceId: 'b' },
      plugins: [second.observer, second.transport],
      report: second.report
    })
  ])
  assert(first.context && first.handle && second.context && second.handle)
  await Promise.all([first.handle.ready, second.handle.ready])
  return { first, second, hosts }
}

// RPC-TEST-B381D3E58268-C001: original ping/pong order and exact shared correlation remain live.
it('exchanges the original correlated ping and pong through genuine SDK controls', async () => {
  /** Only genuine installed SDK contexts may originate either control. */
  const pair = await nativeControlPair()
  /** These are actual physical frames observed in invocation order, without another decode. */
  const sent: IRpcSemanticFrame[] = []
  /** Original receiver-independent methods retain their own native delivery contract. */
  const firstWrite = pair.first.carrier.write
  /** Reverse delivery remains owned by its actual original physical endpoint. */
  const secondWrite = pair.second.carrier.write
  /** Pass-through capture records the first real direction without changing any completion. */
  const firstSpy = vi.spyOn(pair.first.carrier, 'write').mockImplementation((frame, options) => {
    sent.push(frame.data as IRpcSemanticFrame)
    return firstWrite(frame, options)
  })
  /** The same observation captures the actual pong's position in the shared write sequence. */
  const secondSpy = vi.spyOn(pair.second.carrier, 'write').mockImplementation((frame, options) => {
    sent.push(frame.data as IRpcSemanticFrame)
    return secondWrite(frame, options)
  })
  try {
    assert(pair.first.context && pair.first.handle)
    /** BC1 removes old root ping's boolean result; successful SDK completion returns void. */
    await expect(
      pair.first.context.ping(pair.first.handle, { timeoutMs: 100 })
    ).resolves.toBeUndefined()
    /** The sole current profile owns these same original ping/pong semantic operations. */
    const controls = sent.filter((frame): frame is IRpcControlFrame => frame.kind === 'control')
    expect(controls.map((frame) => frame.operation)).toEqual(['ping', 'pong'])
    expect(controls[0]?.id).toBe(controls[1]?.id)
    expect(controls[0]?.kind).toBe('control')
    expect(pair.first.errors).toHaveLength(0)
    expect(pair.second.errors).toHaveLength(0)
  } finally {
    firstSpy.mockRestore()
    secondSpy.mockRestore()
    await Promise.all(pair.hosts.map((host) => host.close()))
  }
})

// RPC-TEST-0B9D3E57477F-C001: actual peer close intention retains requester a and drain budget500.
it('receives the original drain intention once and retains malformed-duration rejection', async () => {
  /** Each real root owns its independent original native source and receiving Session. */
  const pair = await nativeControlPair()
  try {
    assert(pair.first.context && pair.first.handle && pair.second.handle)
    expect(pair.first.context.drain).toBeTypeOf('function')
    await pair.first.context.drain(pair.first.handle, 500)
    /** Only the real admitted Root observation contributes to this peer-close event sequence. */
    await vi.waitFor(() => {
      expect(
        pair.second.observations
          .filter((event) => event.kind === 'control.close')
          .map((event) => event.data)
      ).toEqual([
        expect.objectContaining({ name: 'control.close', requesterId: 'a', durationMs: 500 })
      ])
    })
    /** The original medium exposes its actual valid control, without parsing a second copy. */
    const control = pair.first.carrier.written.find(
      (frame): frame is IRpcControlFrame => frame.kind === 'control' && frame.operation === 'drain'
    )
    expect(control).toMatchObject({
      kind: 'control',
      operation: 'drain',
      route: { remainingMs: 500 }
    })
    assert(control)
    /** Raw peer input reaches the same original codec; it does not call a fake protocol validator. */
    await pair.first.carrier.write({
      kind: 'message',
      data: {
        ...control,
        id: 'invalid-close-1',
        route: { ...control.route, remainingMs: 'x' }
      }
    })
    /** The original code remains an oracle, even if the current profile reports a different code. */
    await vi.waitFor(() => expect(pair.second.errors).toHaveLength(1))
    expect.soft(pair.second.errors[0]).toHaveProperty('code', 'PROTOCOL_INVALID')
    expect(pair.second.observations.filter((event) => event.kind === 'control.close')).toHaveLength(
      1
    )
  } finally {
    await Promise.all(pair.hosts.map((host) => host.close()))
  }
})

// RPC-TEST-0B9D3E57477F-C001-A004/A005/A006: both original invalid budgets reject synchronously.
it.each([-1, 2 ** 31])(
  'rejects original invalid drain budget %s synchronously before a physical write',
  async (budget) => {
    /** The original valid announcement precedes either rejected caller duration. */
    const pair = await nativeControlPair()
    try {
      assert(pair.first.context && pair.first.handle)
      await pair.first.context.drain(pair.first.handle, 500)
      /** This explicit invocation context retains the actual method, handle and original budget. */
      const invocation = { context: pair.first.context, handle: pair.first.handle, budget }
      /** Startup and the one valid announcement are excluded from the original no-write oracle. */
      const count = pair.first.carrier.written.length
      expect
        .soft(() => {
          /** Observe a wrong asynchronous rejection without changing the required synchronous throw. */
          const operation = invocation.context.drain(invocation.handle, invocation.budget)
          void operation.catch(() => undefined)
        })
        .toThrow(expect.objectContaining({ code: 'CONTRACT_INVALID' }))
      expect(pair.first.carrier.written).toHaveLength(count)
    } finally {
      await Promise.all(pair.hosts.map((host) => host.close()))
    }
  }
)
