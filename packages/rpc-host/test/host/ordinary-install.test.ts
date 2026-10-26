/** Ordinary installation uses the receiving native core and its actual namespace publication. */
import { defineHost, definePlugin, defineFeature } from '@migaia/plugin-host'
import {
  defineTransportPlugin,
  defineFlowFeature,
  rpcFlowPlugin,
  rpcHostPipelines,
  RpcFlowLayer,
  type IRpcFlowStage
} from '@migaia/rpc-host/sdk'
import { createRpcHost, type IRpcNamespace } from '@migaia/rpc-host'
import type { IRpcDispatchContext } from '@migaia/rpc-contract/interfaces'
import { typegen } from '@migaia/rpc-host/plugins/typegen'
import { limits } from '@migaia/rpc-host/plugins/limits'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { chunk } from '@migaia/rpc-host/plugins/chunk'
import { deferred, type IDeferred } from '@migaia/utils/promise'
import { describe, expect, it, vi, type MockInstance as IMockInstance } from 'vitest'
import { readRpcDefinition } from '../../dist/sdk/metadata.js'
import { LimitsGovernor } from '../../dist/features/limits/governor.js'
import { coreMemoryServer } from './core-fixture.js'

/** Native Host defaults remain the same as tray's receiving plugin-host runtime. */
function ordinaryHost() {
  /** The single SDK function lends execution lazily while supplying the fixed declarations. */
  const rpc = rpcHostPipelines(
    () => host,
    (name, request) => host.pipeline(name, request)
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
  return defineFlowFeature({
    name: 'held-limits-dispatch',
    setup: () => ({
      stages: { dispatchInbound: { layer: RpcFlowLayer.wire, stage: inbound } }
    })
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

  it('installs transport-owned pipelines when the ordinary Host supplies only SDK domainCore', async () => {
    /** The transport declares its own group; the ordinary Host lends genuine candidate execution. */
    const rpc = rpcHostPipelines(
      () => host,
      (name, request) => host.pipeline(name, request)
    )
    /** No cold namespace inventory or pipeline declaration belongs to this actual Host. */
    const host = defineHost({
      domainCore: rpc.domainCore,
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    /** The native acquisition callback runs only after its own plugin pipeline declaration exists. */
    const open = vi.fn(() => ({ dispose: () => undefined }))
    try {
      /** Public publication and the exact acquisition count receive the new R25 contract. */
      const outcome = await host
        .use(defineTransportPlugin({ name: 'worker', namespace: 'worker', open }))
        .then(
          () => ({ accepted: true, acquisitions: open.mock.calls.length }),
          (error: unknown) => ({ error })
        )
      expect(outcome).toEqual({ accepted: true, acquisitions: 1 })
      expect(Reflect.get(host, 'worker')).toBeDefined()
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

  it('A31 rejects removal of an in-use shared Auth wrapper and permits deletion after Session close', async () => {
    /**
     * The same ordinary Host keeps its shared information-flow owner until all affected Sessions
     * close.
     */
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
    /** The actual governor cleanup proves the native Feature instance has retired before reuse. */
    let retirements: IMockInstance | undefined
    /** The common native bridge owns both real Features in this cold worker group. */
    const transport = namedTransport(server)
    /** Removing this generation retires its actual limits instance and original borrowed stages. */
    const flows = rpcFlowPlugin([
      auth({ sign: (value) => value, verify: (value) => value }),
      limits(),
      heldDispatch({ entered, resume: resume.promise, admitted: () => additions?.mockClear() }),
      transport
    ])
    await host.use(limitsService, flows)
    await host.use(transport)
    /** This is a genuine connected public client, not a constructed flow context or fake signal. */
    const client = await server.connect('limits-client', {
      plugins: [auth({ sign: (value) => value, verify: (value) => value })]
    })
    /** Native readiness supplies the exact accepted close receipt needed before cold deletion. */
    const accepted = server.lookup('limits-client')!.handle
    /** The actual inbound chain captures its original suffix before optional unUse occurs. */
    const pending = namespace(client.host).request('limits-service.value')
    void pending.catch(() => undefined)
    /** Observe limits' own source subscription owner; native invocation parent leases stay separate. */
    try {
      /** Holding the outer hook proves limits has not yet attached an operation/source observer. */
      const context = await entered.promise
      expect(context.connectionSignal).toBeDefined()
      additions = vi.spyOn(LimitsGovernor.prototype, 'bind')
      retirements = vi.spyOn(LimitsGovernor.prototype, 'close')
      /** BC18 replaces the old mid-session withdrawal oracle with native lifecycle refusal. */
      await expect(host.unUse(flows.name)).rejects.toMatchObject({
        source: 'plugin.host',
        code: 'LIFECYCLE_MUTATION'
      })
      expect(retirements).not.toHaveBeenCalled()
      resume.resolve()
      expect(await pending).toBe(42)
      additions.mockClear()
      expect(await namespace(client.host).request('limits-service.value')).toBe(42)
      expect(additions).toHaveBeenCalled()
      expect(retirements).not.toHaveBeenCalled()
      await client.host.close()
      await accepted.closed
      expect(await host.unUse(flows.name)).toMatchObject({ ok: true })
      expect(retirements).toHaveBeenCalledTimes(1)
    } finally {
      resume.resolve()
      await Promise.allSettled([pending])
      additions?.mockRestore()
      retirements?.mockRestore()
      await client.host.close()
      await host.dispose()
    }
  })

  it('A31 protects a selected transport-local Feature while active and permits cold deletion and reconstruction', async () => {
    /** The local information-flow instance belongs to this original transport registration. */
    const server = coreMemoryServer('local-auth-server', 'local-auth-server', 'memory', [
      auth({ sign: (value) => value, verify: (value) => value })
    ])
    /** Only the genuine public provider supplies observable post-refusal communication. */
    const host = await createRpcHost({ ...server.options, provide: { echo: (value) => value } })
    /** Both peers explicitly install the original wire-changing Feature. */
    const client = await server.connect('local-auth-client', {
      plugins: [auth({ sign: (value) => value, verify: (value) => value })]
    })
    /** The actual accepted native receipt fences cold deletion after the last Session closes. */
    const accepted = server.lookup('local-auth-client')!.handle
    try {
      await expect(host.unuse(server.transport.name)).rejects.toMatchObject({
        source: 'plugin.host',
        code: 'LIFECYCLE_MUTATION'
      })
      expect(await client.host.memory.send('local-auth-server', 'echo', 42)).toBe(42)
      await client.host.close()
      await accepted.closed
      expect(await host.unuse(server.transport.name)).toMatchObject({ ok: true })
    } finally {
      await Promise.all([client.host.close(), host.close()])
    }
    /** A closed host lends no old capability promise to this fresh featureless construction. */
    const fresh = coreMemoryServer('reconstructed-server')
    /** The new public root and its new physical pair contain no deleted Feature. */
    const reconstructed = await createRpcHost({
      ...fresh.options,
      provide: { echo: (value) => value }
    })
    const peer = await fresh.connect('reconstructed-client')
    try {
      expect(await peer.host.memory.send('reconstructed-server', 'echo', 43)).toBe(43)
    } finally {
      await Promise.all([peer.host.close(), reconstructed.close()])
    }
  })

  it('A31 records a one-sided chunk outcome without imposing a compatibility guarantee', async () => {
    /** Only this side installs chunk; the framework does not manufacture an opposite Feature. */
    const server = coreMemoryServer('one-sided-chunk-server')
    /** Reports retain native failure details separately from an optional public operation rejection. */
    const reports: unknown[] = []
    /** This public root deliberately publishes the wire-changing Feature on just one endpoint. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [chunk({ chunkBytes: 1_024 }), server.transport],
      provide: { echo: (value) => value },
      report: (error) => reports.push(error)
    })
    /** Unexpected success still retains its real public close owner. */
    let peer: Awaited<ReturnType<typeof server.connect>> | undefined
    /** The receipt records actual establishment/call outcome without requiring either result. */
    let outcome: unknown
    try {
      try {
        peer = await server.connect('one-sided-chunk-client', {
          report: (error) => reports.push(error)
        })
        outcome = {
          status: 'fulfilled',
          value: await peer.host.memory.send('one-sided-chunk-server', 'echo', 'one-sided')
        }
      } catch (error) {
        outcome = { status: 'rejected', failure: classifyOneSidedFailure(error) }
      }
      console.info('A31-ONE-SIDED-CHUNK', {
        outcome,
        reports: reports.map(classifyOneSidedFailure)
      })
    } finally {
      await Promise.all([peer?.host.close(), host.close()])
    }
  })
})

/**
 * One-sided outcomes retain the complete native diagnostic chain and package-specific refusal
 * reason.
 */
type IOneSidedFailure = Readonly<{
  source?: string
  code?: string
  name: string
  reason?: unknown
  message: string
  stack?: string
  cause?: IOneSidedFailure
  errors?: readonly IOneSidedFailure[]
}>

/** Preserve actual native failure details; this fixture contains no credential-bearing inputs. */
function classifyOneSidedFailure(error: unknown): IOneSidedFailure {
  /** Only normal native errors are expected from the genuine public transport and call paths. */
  const failure = error as Error & { source?: string; code?: string; reason?: unknown }
  return {
    source: failure?.source,
    code: failure?.code,
    name: failure?.name ?? typeof error,
    reason: failure?.reason,
    message: failure?.message ?? String(error),
    stack: failure?.stack,
    cause: failure?.cause === undefined ? undefined : classifyOneSidedFailure(failure.cause),
    errors:
      failure instanceof AggregateError ? failure.errors.map(classifyOneSidedFailure) : undefined
  }
}
