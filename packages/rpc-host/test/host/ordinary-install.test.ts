/** Ordinary installation uses the receiving native core and its actual namespace publication. */
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import { defineTransportPlugin, defineFlowPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcNamespace } from '@migaia/rpc-host'
import type { IRpcDispatchContext, IRpcDispatchOutcome } from '@migaia/rpc-contract/interfaces'
import { typegen } from '@migaia/rpc-host/plugins/typegen'
import { limits } from '@migaia/rpc-host/plugins/limits'
import { deferred, type IDeferred } from '@migaia/utils/promise'
import { describe, expect, it, vi, type MockInstance as IMockInstance } from 'vitest'
import { readRpcDefinition } from '../../dist/sdk/metadata.js'
import { coreMemoryServer } from './core-fixture.js'

/** Native Host defaults remain the same as tray's receiving plugin-host runtime. */
function ordinaryHost() {
  return defineHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
}

/** Reuse the original acquisition callback while naming the real native replacement slot. */
function namedTransport(server: ReturnType<typeof coreMemoryServer>, name = 'worker') {
  /** Exact SDK identity supplies cold metadata, never a running outlet or alternate host. */
  const metadata = readRpcDefinition(server.transport)
  if (metadata?.kind !== 'transport') return expect.unreachable()
  return defineTransportPlugin({ ...metadata.definition, name })
}

/** The real native extension slot publishes one namespace independently from its TS surface. */
function namespace(host: object): IRpcNamespace {
  return Reflect.get(host, 'worker') as IRpcNamespace
}

/** A held real dispatch borrows its original continuation, without replacing provider execution. */
function heldDispatch(
  input: Readonly<{ entered: IDeferred<IRpcDispatchContext>; resume: Promise<void> }>
) {
  /** Only this actual invocation waits; native unUse and physical source cleanup remain unchanged. */
  const inbound = async (
    context: IRpcDispatchContext,
    next: () => Promise<IRpcDispatchOutcome>
  ): Promise<IRpcDispatchOutcome> => {
    input.entered.resolve(context)
    await input.resume
    return next()
  }
  return defineFlowPlugin({
    name: 'held-limits-dispatch',
    setup: () => ({ hooks: { dispatch: { inbound } } })
  })
}

/** Real native Feature output supplies a public provider without exposing a private RPC owner. */
const limitsBusiness = Object.freeze({ value: () => 42 })
/** Native exposure captures this exact existing output during the transport installation. */
const limitsService = definePlugin({
  name: 'limits-service',
  features: { data: defineFeature(() => limitsBusiness) },
  install: () => ({})
})

describe('ordinary native Host RPC installation', () => {
  it('keeps old publication after candidate failure and retires it only after successful replacement', async () => {
    /** This actual native host owns both original and candidate installation transactions. */
    const host = ordinaryHost()
    /** BC1 makes the transport namespace explicit rather than addressing a registration outlet. */
    const server = coreMemoryServer('first', 'first', 'worker')
    await host.use(namedTransport(server))
    /** A real physical client keeps the old generation callable throughout candidate acquisition. */
    const first = await server.connect('first-client', { provide: { value: () => 1 } })
    /** Only the original physical resource supplies the cleanup count. */
    const close = vi.spyOn(first.pair[0], 'close')
    /** BC1 replaces the private Peer with this registration's original held namespace operation. */
    const held = namespace(host).request
    /** Native rejection must preserve this original candidate acquisition failure. */
    const failure = new Error('candidate listener failed')
    /** The failed candidate attempts the same genuine native publication and namespace. */
    const failed = defineTransportPlugin({
      name: 'worker',
      namespace: 'worker',
      open: async () => {
        throw failure
      }
    })
    try {
      await expect(host.replace('worker', failed)).rejects.toMatchObject({ cause: failure })
      expect(await namespace(host).request('value')).toBe(1)
      expect(close).not.toHaveBeenCalled()
      /** A successful candidate must acquire its listener before committing over the old slot. */
      const next = coreMemoryServer('next', 'next', 'worker')
      /** Read the exact real callback captured by the canonical SDK definition. */
      const metadata = readRpcDefinition(namedTransport(next))
      if (metadata?.kind !== 'transport') return expect.unreachable()
      /** The sequence observes actual acquisition and actual old cleanup without replacing either. */
      const order: string[] = []
      close.mockRestore()
      /** The original stable arrow retains the native carrier's required receiver. */
      const originalClose = first.pair[0].close
      /** Count ordering while preserving the original physical close operation. */
      const orderedClose = vi.spyOn(first.pair[0], 'close').mockImplementation(() => {
        order.push('old:close')
        return originalClose()
      })
      /** This remains the same actual transport definition with an observed native acquisition. */
      const candidate = defineTransportPlugin({
        ...metadata.definition,
        open: async (context) => {
          /** Candidate acquisition may not redirect or retire any existing namespace calls. */
          const listener = await metadata.definition.open(context)
          order.push('candidate:listening')
          expect(await namespace(host).request('value')).toBe(1)
          return listener
        }
      })
      await host.replace('worker', candidate)
      expect(order).toEqual(['candidate:listening', 'old:close'])
      expect(orderedClose).toHaveBeenCalledTimes(1)
      await expect(held('value')).rejects.toMatchObject({ code: 'ENDPOINT_DISPOSED' })
      /** Only after the native commit may new calls select the successor's actual accepted source. */
      const second = await next.connect('next-client', { provide: { value: () => 2 } })
      try {
        expect(await namespace(host).request('value')).toBe(2)
      } finally {
        await second.host.close()
      }
    } finally {
      await first.host.close()
      await host.dispose()
    }
  })

  it('ends typegen writes when its original feature is removed while transport remains installed', async () => {
    /** Ordinary SDK installation must join this native host instead of constructing another one. */
    const host = ordinaryHost()
    /** One real namespace retains independent accepted clients when the observer is removed. */
    const server = coreMemoryServer('server', 'server', 'worker')
    /** The actual output port records every original observer write. */
    const write = vi.fn()
    await host.use(typegen({ out: { write } }), namedTransport(server))
    /** The first accepted handshake reaches the original installed observer exactly once. */
    const first = await server.connect('first', { provide: { value: () => 1 } })
    try {
      expect(write).toHaveBeenCalledTimes(1)
      expect(write.mock.calls[0]![1]).toContain('"value"')
      await host.unUse('rpc-typegen')
      /** Removing the flow leaves actual transport calls usable without another declaration write. */
      const second = await server.connect('second', { provide: { other: () => 2 } })
      try {
        expect(write).toHaveBeenCalledTimes(1)
        expect(await namespace(host).send('second', 'other')).toBe(2)
      } finally {
        await second.host.close()
      }
    } finally {
      await first.host.close()
      await host.dispose()
    }
  })

  it('does not reattach limits after unUse resumes an existing dispatch continuation', async () => {
    /** The same ordinary Host retains its live transport after the optional policy is removed. */
    const host = ordinaryHost()
    /** Actual native exposure supplies the original provider directory and physical connection. */
    const server = coreMemoryServer(
      'limits-server',
      'limits-server',
      'worker',
      [],
      ['limits-service']
    )
    /** These original receipts separate provider admission from optional native policy disposal. */
    const entered = deferred<IRpcDispatchContext>()
    /** Cleanup releases this same continuation even when a public assertion fails. */
    const resume = deferred<void>()
    await host.use(
      limitsService,
      limits(),
      heldDispatch({ entered, resume: resume.promise }),
      namedTransport(server)
    )
    /** This is a genuine connected public client, not a constructed flow context or fake signal. */
    const client = await server.connect('limits-client')
    /** The actual inbound chain captures its original suffix before optional unUse occurs. */
    const pending = namespace(client.host).request('limits-service.value')
    void pending.catch(() => undefined)
    /** The spy borrows the original Session signal without replacing any native listener method. */
    let additions: IMockInstance | undefined
    try {
      /** Holding the outer hook proves limits has not yet attached an operation/source observer. */
      const context = await entered.promise
      expect(context.connectionSignal).toBeDefined()
      additions = vi.spyOn(context.connectionSignal!, 'addEventListener')
      await host.unUse('limits')
      additions.mockClear()
      resume.resolve()
      expect(await pending).toBe(42)
      expect(additions).not.toHaveBeenCalled()
    } finally {
      resume.resolve()
      await Promise.allSettled([pending])
      additions?.mockRestore()
      await client.host.close()
      await host.dispose()
    }
  })
})
