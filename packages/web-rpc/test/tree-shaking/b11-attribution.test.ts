import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core.js'
import { createEndpointKernel } from '../../src/endpoint-kernel.js'
import { createClientEndpoint } from '../../src/client.js'
import { createFullEndpoint } from '../../src/full.js'
import { createProviderEndpoint } from '../../src/provider.js'
import { outbound } from '../../src/features/outbound.js'
import { provider as providerFeature } from '../../src/features/provider.js'
import { discovery } from '../../src/features/discovery.js'
import { control } from '../../src/features/control.js'
import { chunk as chunkFeature } from '../../src/features/chunk.js'
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer.js'
import { WebRpcChunkAttachment } from '../../src/internal/chunk-attachment.js'
import { WebRpcDiscoveryAttachment } from '../../src/internal/discovery-attachment.js'
import { createEndpointTimePort } from '../../src/internal/time-port.js'
import { connect } from '../../src/middleware/connect.js'
import { chunk } from '../../src/middleware/chunk.js'
import { abort } from '../../src/middleware/abort.js'
import { WebRpcMessageKind } from '../../src/protocol-constants.js'
import { WebRpcVariation } from '../../src/protocol-constants.js'
import { normalizeWebRpcEnvelope } from '../../src/wire.js'
import { SourceIdentityRegistry } from '../../src/internal/source-identity.js'
import { WebRpcVariationCoordinator } from '../../src/internal/variation-coordinator.js'
import { WebRpcOutboundAttachment } from '../../src/internal/outbound-attachment.js'
import type {
  IWebRpcOutboundCommand,
  IWebRpcOutboundOperationsPort
} from '../../src/internal/plugin-shared-keys.js'
import {
  clientRuntimeOwnerKeys,
  coreRuntimeOwnerKeys,
  customRuntimeOwnerKeys,
  fullRuntimeOwnerKeys,
  providerRuntimeOwnerKeys
} from '../fixtures/tree-shaking/runtime-owner-topology.js'

type IRetainedReport = {
  readonly root: {
    readonly moduleCount: number
    readonly rawBytes: number
    readonly gzipBytes: number
    readonly endpointStaticImportCount: number
  }
  readonly modules: readonly string[]
  readonly moduleAttribution: readonly {
    readonly module: string
    readonly originalBytes: number
    readonly renderedBytes: number
  }[]
}

type IReviewedBaseline = {
  readonly root: IRetainedReport['root']
  readonly modules: readonly string[]
}

type IPostMigrationCandidate = {
  readonly status: 'approved'
  readonly provenanceDigest: string
  readonly approval: {
    readonly decisionId: string
    readonly keyId: string
    readonly digest: string
    readonly newTuple: Omit<IRetainedReport['root'], 'endpointStaticImportCount'>
  }
  readonly oldTuple: IRetainedReport['root']
  readonly newTuple: IRetainedReport['root']
  readonly addedModules: readonly { readonly module: string }[]
  readonly removedModules: readonly { readonly module: string }[]
}

const workspaceRoot = resolve(import.meta.dirname, '../../../..')

/** Runs the reviewed root bundler probe used for the B11 size decision. */
function readLiveReport(): IRetainedReport {
  const script = resolve(import.meta.dirname, '../tree-shaking-baseline.mjs')
  return JSON.parse(
    execFileSync(process.execPath, [script], { cwd: workspaceRoot, encoding: 'utf8' })
  ) as IRetainedReport
}

/** Normalizes the historical absolute module paths before comparing retained identity. */
function normalizeModulePath(module: string): string {
  const relative = module.replace(`${workspaceRoot}/`, '')
  return relative.startsWith('packages/web-rpc/')
    ? relative
    : relative.startsWith('packages/')
      ? `workspace:${relative}`
      : relative
}

/** Verifies the B11 retained/allocation attribution against the approved live graph. */
describe('WRC-C-B11 retained and allocation attribution', () => {
  it('binds approved byte drift to the current and historical retained graphs', async () => {
    const historicalBaseline = (await import(
      '../fixtures/tree-shaking/pre-migration-tree-shaking-baseline.json',
      {
        with: { type: 'json' }
      }
    )) as { readonly default: IReviewedBaseline }
    const candidate = (await import('../fixtures/tree-shaking/post-migration-candidate.json', {
      with: { type: 'json' }
    })) as { readonly default: IPostMigrationCandidate }
    const live = readLiveReport()
    const baselineModules = new Set(historicalBaseline.default.modules.map(normalizeModulePath))
    const liveModules = new Set(live.modules.map(normalizeModulePath))
    const addedModules = [...liveModules].filter((module) => !baselineModules.has(module)).sort()
    const removedModules = [...baselineModules].filter((module) => !liveModules.has(module)).sort()

    expect(candidate.default.status).toBe('approved')
    expect(candidate.default.approval).toEqual({
      decisionId: 'WRC-C-B11-decision-20260826-03',
      keyId: 'coordinator-ed25519-04ad8e84b3d15997',
      digest: candidate.default.provenanceDigest,
      newTuple: {
        moduleCount: candidate.default.newTuple.moduleCount,
        rawBytes: candidate.default.newTuple.rawBytes,
        gzipBytes: candidate.default.newTuple.gzipBytes
      }
    })
    expect(candidate.default.oldTuple).toEqual(historicalBaseline.default.root)
    expect(candidate.default.newTuple).toEqual(live.root)
    expect(addedModules).toEqual(candidate.default.addedModules.map(({ module }) => module))
    expect(removedModules).toEqual(candidate.default.removedModules.map(({ module }) => module))
    expect(live.root.moduleCount).toBe(candidate.default.newTuple.moduleCount)
    expect(live.root.endpointStaticImportCount).toBe(
      candidate.default.newTuple.endpointStaticImportCount
    )
    expect(live.root.rawBytes - historicalBaseline.default.root.rawBytes).toBe(205127)
    expect(live.root.gzipBytes - historicalBaseline.default.root.gzipBytes).toBe(46452)
    expect(live.moduleAttribution).toHaveLength(live.modules.length)
    expect(
      live.moduleAttribution.every(
        ({ originalBytes, renderedBytes }) => originalBytes >= 0 && renderedBytes >= 0
      )
    ).toBe(true)
    expect(live.moduleAttribution.some(({ originalBytes }) => originalBytes > 0)).toBe(true)
    expect(
      live.moduleAttribution
        .slice(0, 5)
        .every(({ module }) => liveModules.has(normalizeModulePath(module)))
    ).toBe(true)
    expect({ addedModules, removedModules, decision: candidate.default.status }).toEqual({
      addedModules: candidate.default.addedModules.map(({ module }) => module),
      removedModules: candidate.default.removedModules.map(({ module }) => module),
      decision: 'approved'
    })
  })

  it('closes source identity and variation terminal branches with one owner', async () => {
    const identities = new SourceIdentityRegistry()
    const firstSource = {}
    const secondSource = {}
    expect(identities.token(firstSource)).toBe(identities.token(firstSource))
    expect(identities.token(firstSource)).not.toBe(identities.token(secondSource))
    expect(identities.token(undefined)).toBe('source-undefined')
    expect(identities.token(null)).toBe('source-null')
    expect(identities.token('peer')).toBe('source-string:peer')

    let now = 10
    const coordinator = new WebRpcVariationCoordinator(() => now)
    const received: string[] = []
    const release = coordinator.register(WebRpcVariation.abort, (_message, peerKey) => {
      received.push(peerKey)
    })
    expect(() => coordinator.register(WebRpcVariation.abort, () => undefined)).toThrow()
    await expect(
      coordinator.dispatch(WebRpcVariation.ping, 'missing-handler', {}, 'peer')
    ).resolves.toBe(false)
    await expect(
      coordinator.dispatch(WebRpcVariation.abort, 'abort-task', {}, 'peer')
    ).resolves.toBe(true)
    await expect(
      coordinator.dispatch(WebRpcVariation.abort, 'abort-task', {}, 'peer')
    ).resolves.toBe(false)
    expect(received).toEqual(['peer'])

    release()
    const replacementRelease = coordinator.register(WebRpcVariation.abort, () => undefined)
    release()
    replacementRelease()

    const controller = new AbortController()
    expect(coordinator.abort('active', controller, 20)).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(coordinator.abort('early', undefined, 20)).toBe(true)
    expect(coordinator.abort('early', undefined, 20)).toBe(true)
    expect(coordinator.consumeAbort('early')).toBe(true)
    expect(coordinator.consumeAbort('early')).toBe(false)
    expect(coordinator.abort('expired', undefined, 20)).toBe(true)
    now = 20
    expect(coordinator.consumeAbort('expired')).toBe(false)
    release()
    coordinator.clear()
  })

  it('closes endpoint-local timer callback and disposed-port branches', () => {
    vi.useFakeTimers()
    try {
      const port = createEndpointTimePort()
      const fired = vi.fn()
      const timer = port.setTimeout(fired, 5)
      const cancelled = port.setTimeout(vi.fn(), 5)
      port.clearTimeout(cancelled)
      vi.advanceTimersByTime(5)
      expect(fired).toHaveBeenCalledTimes(1)
      port.clearTimeout(timer)
      port.clearTimeout(timer)

      const late = vi.fn()
      port.dispose()
      const disposedTimer = port.setTimeout(late, 5)
      port.clearTimeout(disposedTimer)
      vi.advanceTimersByTime(5)
      expect(late).not.toHaveBeenCalled()
      port.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('proves selected endpoint owner allocation is unique and attributable', async () => {
    const [coreTransport] = createMemoryTransportPair()
    const core = await createComposedEndpoint(
      {
        id: 'b11-core-allocation',
        transport: coreTransport,
        middlewares: [connect({ transport: coreTransport })]
      },
      [outbound()]
    )
    const [clientTransport] = createMemoryTransportPair()
    const client = await createClientEndpoint({
      id: 'b11-client-allocation',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    })
    const [providerTransport] = createMemoryTransportPair()
    const provider = await createProviderEndpoint({
      id: 'b11-provider-allocation',
      transport: providerTransport,
      middlewares: [connect({ transport: providerTransport })]
    })
    const [fullTransport] = createMemoryTransportPair()
    const full = await createFullEndpoint({
      id: 'b11-full-allocation',
      transport: fullTransport,
      middlewares: [connect({ transport: fullTransport })]
    })
    const [customTransport] = createMemoryTransportPair()
    const custom = await createComposedEndpoint(
      {
        id: 'b11-custom-allocation',
        transport: customTransport,
        middlewares: [connect({ transport: customTransport })]
      },
      [outbound(), providerFeature(), discovery(), control(), chunkFeature()]
    )

    expect(readEndpointDebugSnapshot(core)?.owners).toEqual(coreRuntimeOwnerKeys)
    expect(readEndpointDebugSnapshot(client)?.owners).toEqual(clientRuntimeOwnerKeys)
    expect(readEndpointDebugSnapshot(provider)?.owners).toEqual(providerRuntimeOwnerKeys)
    expect(readEndpointDebugSnapshot(full)?.owners).toEqual(fullRuntimeOwnerKeys)
    expect(readEndpointDebugSnapshot(custom)?.owners).toEqual(customRuntimeOwnerKeys)
    for (const endpoint of [core, client, provider, full, custom]) {
      const owners = readEndpointDebugSnapshot(endpoint)?.owners ?? []
      expect(new Set(owners).size).toBe(owners.length)
    }
    await Promise.all([
      core.dispose(),
      client.dispose(),
      provider.dispose(),
      full.dispose(),
      custom.dispose()
    ])
  })

  it('exercises composed discovery and chunk settlement through the shared kernel', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createFullEndpoint({
      id: 'b11-chunk-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), chunk({ chunkSize: 8 })],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createFullEndpoint({
      id: 'b11-chunk-client',
      targetIds: ['b11-chunk-server'],
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), chunk({ chunkSize: 8 })]
    })

    try {
      await expect(
        client.send('b11-chunk-server', 'echo', 'discovery-and-chunk'.repeat(8))
      ).resolves.toBe('discovery-and-chunk'.repeat(8))
      expect(readEndpointDebugSnapshot(client)?.chunks).toBe(0)
      expect(readEndpointDebugSnapshot(server)?.chunks).toBe(0)
    } finally {
      await Promise.all([client.dispose(), server.dispose()])
    }
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      chunks: 0,
      resources: 0
    })
    expect(readEndpointDebugSnapshot(server)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      chunks: 0,
      resources: 0
    })
  })

  it('keeps multi-receiver fanout isolated and settles an aborted request once', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const first = await createFullEndpoint({
      id: 'b11-multi-first',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success('first') }
    })
    const second = await createFullEndpoint({
      id: 'b11-multi-second',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success('second') }
    })
    const client = await createFullEndpoint({
      id: 'b11-multi-client',
      targetIds: ['b11-multi-first', 'b11-multi-second'],
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    })
    try {
      const fanout = await client.sendAll('echo', null)
      expect(Object.values(fanout.fulfilled).sort()).toEqual(['first', 'second'])
    } finally {
      await Promise.all([client.dispose(), first.dispose(), second.dispose()])
    }
    expect(readEndpointDebugSnapshot(client)).toMatchObject({ phase: 'disposed', pending: 0 })
    expect(readEndpointDebugSnapshot(first)).toMatchObject({ phase: 'disposed', pending: 0 })
    expect(readEndpointDebugSnapshot(second)).toMatchObject({ phase: 'disposed', pending: 0 })

    const [abortClientTransport, abortServerTransport] = createMemoryTransportPair()
    const abortServer = await createFullEndpoint({
      id: 'b11-abort-server',
      transport: abortServerTransport,
      middlewares: [connect({ transport: abortServerTransport }), abort()],
      provider: {
        echo: async (context) => {
          await new Promise((resolve) => setTimeout(resolve, 20))
          return context.success(context.data)
        }
      }
    })
    const abortClient = await createFullEndpoint({
      id: 'b11-abort-client',
      targetIds: ['b11-abort-server'],
      transport: abortClientTransport,
      middlewares: [connect({ transport: abortClientTransport }), abort()]
    })
    const controller = new AbortController()
    const request = abortClient.send('b11-abort-server', 'echo', 'late', {
      signal: controller.signal
    })
    controller.abort()
    await expect(request).rejects.toMatchObject({ code: 'CANCELLED' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(readEndpointDebugSnapshot(abortClient)).toMatchObject({ pending: 0 })
    await Promise.all([abortClient.dispose(), abortServer.dispose()])
  })

  it('covers chunk admission rejection, partial assembly, decode rejection, and dispatch', async () => {
    const routes: Array<(message: unknown) => void | Promise<void>> = []
    const time = createEndpointTimePort()
    const dispatched: unknown[] = []
    let routeReleased = false
    let admissions = 0
    let releases = 0
    const kernel = {
      resources: { add: () => undefined },
      time,
      registerOwner: () => undefined,
      registerRoute: (_kind: string, route: (message: unknown) => void | Promise<void>) => {
        routes.push((message) => (routeReleased ? undefined : route(message)))
        return () => {
          routeReleased = true
        }
      },
      dispatchRoute: async (_kind: string, message: unknown) => {
        dispatched.push(message)
        return true
      }
    }
    const identity = {
      admit: async () => {
        admissions += 1
        return {
          token: 'chunk-peer',
          release: () => {
            releases += 1
          }
        }
      }
    }
    const attachment = new WebRpcChunkAttachment(
      kernel as never,
      {
        id: 'chunk-target',
        options: { chunk: { chunkSize: 1024 }, protocol: { decode: JSON.parse } }
      } as never,
      identity as never
    )
    const route = routes[0]!
    await route({ envelope: { kind: WebRpcMessageKind.chunk, targetId: 'other' } })
    expect(admissions).toBe(0)
    await route({ envelope: { kind: WebRpcMessageKind.chunk, targetId: 'chunk-target' } })
    const payload = JSON.stringify({
      kind: WebRpcMessageKind.response,
      version: '1',
      taskId: 'chunk-task',
      senderId: 'chunk-peer',
      targetId: 'chunk-target',
      resolvedTargetId: 'chunk-target',
      method: 'echo',
      ok: true,
      data: 'chunked',
      sentAt: Date.now()
    })
    const midpoint = Math.floor(payload.length / 2)
    expect(normalizeWebRpcEnvelope(JSON.parse(payload))).toBeDefined()
    await route({
      envelope: {
        kind: WebRpcMessageKind.chunk,
        messageId: 'chunk-message',
        index: 0,
        total: 2,
        data: payload.slice(0, midpoint),
        senderId: 'chunk-peer',
        targetId: 'chunk-target'
      }
    })
    expect(attachment.size).toBe(1)
    await route({
      envelope: {
        kind: WebRpcMessageKind.chunk,
        messageId: 'chunk-message',
        index: 1,
        total: 2,
        data: payload.slice(midpoint),
        senderId: 'chunk-peer',
        targetId: 'chunk-target'
      }
    })
    expect(attachment.size).toBe(0)
    expect(dispatched).toHaveLength(1)
    attachment.dispose()
    expect(releases).toBe(admissions)
    const dispatchedBeforeDispose = dispatched.length
    await route({
      envelope: {
        kind: WebRpcMessageKind.chunk,
        messageId: 'late-chunk-message',
        index: 0,
        total: 1,
        data: payload,
        senderId: 'chunk-peer',
        targetId: 'chunk-target'
      }
    })
    expect(dispatched).toHaveLength(dispatchedBeforeDispose)
    expect(admissions).toBe(3)
    time.dispose()
  })

  it('rejects an unauthenticated chunk before allocating assembly, operation, or expiry timer', async () => {
    const routes: Array<(message: unknown) => void | Promise<void>> = []
    let timerCreates = 0
    let dispatches = 0
    const time = {
      now: () => Date.now(),
      setTimeout: () => {
        timerCreates += 1
        return { clear: () => undefined }
      },
      clearTimeout: () => undefined
    }
    const kernel = {
      resources: { add: () => undefined },
      time,
      registerOwner: () => undefined,
      registerRoute: (_kind: string, route: (message: unknown) => void | Promise<void>) => {
        routes.push(route)
        return () => undefined
      },
      dispatchRoute: async () => {
        dispatches += 1
        return true
      }
    }
    const attachment = new WebRpcChunkAttachment(
      kernel as never,
      { id: 'unauthenticated-target', options: { chunk: { assemblyTimeoutMs: 1 } } } as never,
      { admit: async () => undefined } as never,
      time
    )
    await routes[0]!({
      envelope: {
        kind: WebRpcMessageKind.chunk,
        messageId: 'unauthenticated-message',
        index: 0,
        total: 2,
        data: 'part',
        senderId: 'unauthenticated-peer',
        targetId: 'unauthenticated-target'
      }
    })
    expect(attachment.size).toBe(0)
    expect(timerCreates).toBe(0)
    expect(dispatches).toBe(0)
    attachment.dispose()
  })

  it('covers discovery query/response admission, pinning, and cleanup branches', async () => {
    const [transport, peerTransport] = createMemoryTransportPair()
    const kernel = createEndpointKernel(transport)
    const prepared = {
      id: 'discovery-target',
      transport,
      providers: undefined,
      options: { connect: { uniqueTargetId: 'unique-discovery-target' } }
    } as const
    const outbound = new WebRpcOutboundAttachment(kernel, prepared)
    let sentQueryTask = ''
    const peerRelease = peerTransport.subscribe(({ data }) => {
      const frame = data as { readonly kind?: unknown; readonly taskId?: unknown }
      if (frame.kind !== WebRpcMessageKind.discoveryQuery || typeof frame.taskId !== 'string')
        return
      sentQueryTask = frame.taskId
      void peerTransport.send({
        kind: WebRpcMessageKind.discoveryResponse,
        taskId: frame.taskId,
        senderId: 'discovery-peer',
        targetId: 'discovery-target',
        resolvedTargetId: 'discovery-target',
        receiverId: 'discovery-receiver',
        data: { __unique_id__: 'unique-discovery-target' },
        sentAt: Date.now()
      })
    })
    const attachment = new WebRpcDiscoveryAttachment(kernel, prepared, {
      inboundIdentity: {
        verify: (command) => {
          if (command.operation === 'admit') return outbound.inboundIdentity.admit(command.request)
          if (command.operation === 'retain') return outbound.inboundIdentity.retain(command.token)
          outbound.inboundIdentity.release(command.token)
        }
      },
      outboundOperations: {
        send: ((command: IWebRpcOutboundCommand) => {
          if (command.kind === 'response' || command.kind === 'frame')
            return outbound.sendFrame(command.message, command.transfer)
          if (command.kind === 'dispatch')
            return outbound.dispatch(command.targetId, command.method, command.data)
          if (command.kind === 'validate')
            return outbound.validate(command.method, command.side, command.data)
          if (command.kind === 'diagnostic') return outbound.emitDiagnostic(command.event)
          if (command.kind === 'report') return outbound.emitFailure(command.error, command.code)
          return undefined
        }) as IWebRpcOutboundOperationsPort['send']
      },
      time: kernel.time,
      candidatePing: async () => false
    })
    outbound.activate()

    try {
      await attachment.query('discovery-target')
      expect(sentQueryTask).toMatch(/^VARIATION:discovery-target:/)
      expect(attachment.controls.getServerList('discovery-target')).toEqual([
        expect.objectContaining({
          targetId: 'discovery-target',
          receiverId: 'discovery-receiver',
          uniqueTargetId: 'unique-discovery-target'
        })
      ])
      attachment.controls.pinReceiver('discovery-target', 'discovery-receiver')
      expect(attachment.controls.getServerList('discovery-target')).toHaveLength(1)
      attachment.controls.unpinReceiver('discovery-target')
      expect(attachment.controls.getServerList('foreign-target')).toEqual([])
    } finally {
      attachment.dispose()
      const outboundDispose = outbound.dispose()
      expect(outbound.dispose()).toBe(outboundDispose)
      await outboundDispose
      kernel.completeDispose()
      peerRelease()
    }
  })
})
