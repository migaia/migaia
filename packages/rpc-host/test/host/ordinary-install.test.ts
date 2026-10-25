/** Ordinary installation uses the receiving native core and its actual namespace publication. */
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import {
  defineTransportPlugin,
  defineFlowPlugin,
  rpcHostPipelines,
  type IRpcFlowStage
} from '@migaia/rpc-host/sdk'
import type { IRpcNamespace } from '@migaia/rpc-host'
import type { IRpcDispatchContext } from '@migaia/rpc-contract/interfaces'
import { typegen } from '@migaia/rpc-host/plugins/typegen'
import { limits } from '@migaia/rpc-host/plugins/limits'
import { deferred, type IDeferred } from '@migaia/utils/promise'
import { describe, expect, it, vi, type MockInstance as IMockInstance } from 'vitest'
import { readRpcDefinition } from '../../dist/sdk/metadata.js'
import { coreMemoryServer } from './core-fixture.js'

/** Native Host defaults remain the same as tray's receiving plugin-host runtime. */
function ordinaryHost() {
  /** The single SDK function lends execution lazily while supplying the fixed declarations. */
  const rpc = rpcHostPipelines(
    () => host,
    (name) => host.pipeline(name)
  )
  /** Native execution authority refers to this actual owner after construction completes. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  return host
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
  input: Readonly<{
    entered: IDeferred<IRpcDispatchContext>
    resume: Promise<void>
    admitted?(): void
  }>
) {
  /** Only this actual invocation waits; native unUse and physical source cleanup remain unchanged. */
  const inbound: IRpcFlowStage<'dispatchInbound'> = async (payload, next) => {
    input.admitted?.()
    input.entered.resolve(payload.context)
    await input.resume
    await next(payload)
  }
  return defineFlowPlugin({
    name: 'held-limits-dispatch',
    setup: () => ({ stages: { dispatchInbound: inbound } })
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
  it('rejects missing SDK pipeline configuration before native acquisition', async () => {
    /** A plain native Host has no RPC execution authority until explicitly configured. */
    const host = defineHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** Cold SDK definition is real; its acquisition must remain untouched after admission failure. */
    const open = vi.fn(() => ({ dispose: () => undefined }))
    try {
      await expect(
        host.use(defineTransportPlugin({ name: 'unconfigured', namespace: 'worker', open }))
      ).rejects.toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: {
          source: 'rpc.endpoint',
          code: 'INVALID_CONFIG',
          message: 'RPC native host must configure rpcHostPipelines with its actual pipeline owner'
        }
      })
      expect(open).not.toHaveBeenCalled()
    } finally {
      await host.dispose()
    }
  })

  it('rejects omitted pipeline declarations before native acquisition when domainCore is configured', async () => {
    /** JavaScript may accidentally keep only domainCore while omitting the returned declarations. */
    const rpc = rpcHostPipelines(
      () => host,
      (name) => host.pipeline(name as never) as never
    )
    /** This is a real native owner and callback; only its required construction declarations lack. */
    const host = defineHost({
      domainCore: rpc.domainCore,
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** A cold genuine transport exposes any resource acquisition before declaration admission. */
    const open = vi.fn(() => ({ dispose: () => undefined }))
    try {
      /** Box admission facts rather than formatting a native handle after finally disposes it. */
      const outcome = await host
        .use(defineTransportPlugin({ name: 'undeclared', namespace: 'worker', open }))
        .then(
          () => ({ accepted: true, acquisitions: open.mock.calls.length }),
          (error: unknown) => ({ error })
        )
      expect(outcome).toMatchObject({
        error: {
          code: 'PLUGIN_INSTALL_FAILED',
          cause: {
            source: 'rpc.endpoint',
            code: 'INVALID_CONFIG',
            cause: { source: 'plugin.host', code: 'PIPELINE_UNKNOWN' }
          }
        }
      })
      expect(open).not.toHaveBeenCalled()
    } finally {
      await host.dispose()
    }
  })

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
    /** Observation begins at this same real dispatch seam, after provider lifetime setup. */
    let additions: IMockInstance | undefined
    await host.use(
      limitsService,
      limits(),
      heldDispatch({ entered, resume: resume.promise, admitted: () => additions?.mockClear() }),
      namedTransport(server)
    )
    /** This is a genuine connected public client, not a constructed flow context or fake signal. */
    const client = await server.connect('limits-client')
    /** The actual inbound chain captures its original suffix before optional unUse occurs. */
    const pending = namespace(client.host).request('limits-service.value')
    void pending.catch(() => undefined)
    /** The spy borrows the original Session signal without replacing any native listener method. */
    try {
      /** Holding the outer hook proves limits has not yet attached an operation/source observer. */
      const context = await entered.promise
      expect(context.connectionSignal).toBeDefined()
      additions = vi.spyOn(context.connectionSignal!, 'addEventListener')
      /** Native R5 withdrawal waits for this already borrowed snapshot before completing removal. */
      let removed = false
      /** Observe the actual public completion rather than reconstructing private lease state. */
      const removing = host.unUse('limits').then((value) => {
        removed = true
        return value
      })
      await Promise.resolve()
      expect(removed).toBe(false)
      resume.resolve()
      expect(await pending).toBe(42)
      await removing
      additions.mockClear()
      expect(await namespace(client.host).request('limits-service.value')).toBe(42)
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
