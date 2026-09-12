import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import { messageFramer } from '@migaia/rpc-contract/framing/v1'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { createComposedEndpoint } from '../../src/core.js'
import { createEndpointKernel } from '../../src/endpoint-kernel.js'
import { createClientEndpoint } from '../../src/client.js'
import { createFullEndpoint } from '../../src/full.js'
import { createProviderEndpoint } from '../../src/provider.js'
import { createClientFirstPartyRoots } from '../../src/internal/client-first-party-roots.js'
import {
  createFirstPartyRoots,
  type IWebRpcFirstPartyRootName
} from '../../src/internal/first-party-roots.js'
import { authentication } from '../../src/middleware/authentication.js'
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer.js'
import { WebRpcCanonicalChunkAttachment as WebRpcChunkAttachment } from '../../src/internal/canonical-chunk-attachment.js'
import { WebRpcDiscoveryAttachment } from '../../src/internal/discovery-attachment.js'
import { createEndpointTimePort } from '../../src/internal/time-port.js'
import { connect } from '../../src/middleware/connect.js'
import { abort } from '../../src/middleware/abort.js'
import { WebRpcVariation } from '../../src/semantic-constants.js'
import { SourceIdentityRegistry } from '../../src/internal/source-identity.js'
import { WebRpcVariationCoordinator } from '../../src/internal/variation-coordinator.js'
import { WebRpcOutboundAttachment } from '../../src/internal/outbound-attachment.js'
import { prepareEndpoint } from '../../src/internal/endpoint-bootstrap.js'
import { WebRpcSharedKey } from '../../src/internal/plugin-shared-keys.js'
import type { IWebRpcTransport } from '../../src/transport.js'
import type {
  IWebRpcOutboundCommand,
  IWebRpcOutboundOperationsPort
} from '../../src/internal/plugin-shared-keys.js'
import {
  clientRuntimeOwnerKeys,
  coreRuntimeOwnerKeys,
  customRuntimeOwnerKeys,
  defaultRuntimeOwnerKeys,
  observeRuntimeOwnerAllocation,
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
  it('binds pending byte drift to the current and historical retained graphs', async () => {
    const historicalBaseline = (await import(
      '../fixtures/tree-shaking/pre-migration-tree-shaking-baseline.json',
      {
        with: { type: 'json' }
      }
    )) as { readonly default: IReviewedBaseline }
    const candidate = (await import('../fixtures/tree-shaking/post-migration-candidate.json', {
      with: { type: 'json' }
    })) as { readonly default: IPostMigrationCandidate }
    const custody = (await import('../fixtures/tree-shaking/f004-intended-cost-custody.json', {
      with: { type: 'json' }
    })) as {
      readonly default: {
        readonly successorTuple: IRetainedReport['root']
        readonly moduleLedger: readonly { readonly module: string }[]
      }
    }
    const live = readLiveReport()
    const liveModules = new Set(live.modules.map(normalizeModulePath))
    const custodyModules = custody.default.moduleLedger.map(({ module }) => module)

    expect(candidate.default.status).toBe('approved')
    expect(candidate.default.oldTuple).toEqual(historicalBaseline.default.root)
    expect(candidate.default.newTuple).toEqual({
      moduleCount: 121,
      rawBytes: 475725,
      gzipBytes: 113838,
      endpointStaticImportCount: 12
    })
    // The custody artifact records the immutable historical successor, not the live bundle.
    expect(custodyModules).toHaveLength(custody.default.successorTuple.moduleCount)
    expect(new Set(custodyModules).size).toBe(custodyModules.length)
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
    expect(coordinator.abort('active', controller, 20, 'active reason')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toBe('active reason')
    expect(coordinator.abort('early', undefined, 20, 'early reason')).toBe(true)
    expect(coordinator.abort('early', undefined, 20, 'replacement reason')).toBe(true)
    expect(coordinator.consumeAbort('early')).toEqual({ found: true, reason: 'early reason' })
    expect(coordinator.consumeAbort('early')).toEqual({ found: false, reason: undefined })
    expect(coordinator.abort('expired', undefined, 20, 'expired reason')).toBe(true)
    now = 20
    expect(coordinator.consumeAbort('expired')).toEqual({ found: false, reason: undefined })
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
    const observed = await observeRuntimeOwnerAllocation()
    expect(observed.core).toEqual(coreRuntimeOwnerKeys)
    expect(observed.client).toEqual(clientRuntimeOwnerKeys)
    expect(observed.provider).toEqual(providerRuntimeOwnerKeys)
    expect(observed.full).toEqual(defaultRuntimeOwnerKeys)
    expect(observed.custom).toEqual(customRuntimeOwnerKeys)
    const [coreTransport] = createMemoryTransportPair()
    const core = await createComposedEndpoint(
      {
        id: 'b11-core-allocation',
        transport: coreTransport,
        middlewares: [connect({ transport: coreTransport })]
      },
      createClientFirstPartyRoots()
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
      createFirstPartyRoots(
        new Set<IWebRpcFirstPartyRootName>([
          'first-party-chunk',
          'first-party-outbound',
          'first-party-provider',
          'first-party-discovery',
          'first-party-control'
        ])
      )
    )

    expect(readEndpointDebugSnapshot(core)?.owners).toEqual(coreRuntimeOwnerKeys)
    expect(readEndpointDebugSnapshot(client)?.owners).toEqual(clientRuntimeOwnerKeys)
    expect(readEndpointDebugSnapshot(provider)?.owners).toEqual(providerRuntimeOwnerKeys)
    expect(readEndpointDebugSnapshot(full)?.owners).toEqual(defaultRuntimeOwnerKeys)
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
      codec: defineJsonCodec({ version: 1 }),
      framer: createStringFramer({ chunkBytes: 8 }),
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createFullEndpoint({
      id: 'b11-chunk-client',
      targetIds: ['b11-chunk-server'],
      transport: clientTransport,
      codec: defineJsonCodec({ version: 1 }),
      framer: createStringFramer({ chunkBytes: 8 }),
      middlewares: [connect({ transport: clientTransport })]
    })

    try {
      await expect(
        client.send('b11-chunk-server', 'echo', 'discovery-and-chunk'.repeat(8))
      ).resolves.toBe('discovery-and-chunk'.repeat(8))
    } finally {
      await Promise.all([client.dispose(), server.dispose()])
    }
    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      resources: 0
    })
    expect(readEndpointDebugSnapshot(server)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      resources: 0
    })
  })

  it('rejects an unauthenticated chunk before allocating assembly, operation, or expiry timer', async () => {
    const [clientBase, serverTransport] = createMemoryTransportPair()
    /** Counts selected-framer expiry scheduling so rejected input cannot allocate reassembly state. */
    let assemblyTimers = 0
    /** Counts provider entry only after a verified, fully assembled request reaches dispatch. */
    let providerCalls = 0
    /** Proves the forged physical frame reached the real inbound authentication boundary. */
    let verificationAttempts = 0
    /**
     * Switches the same authentication/framer configuration to valid frames on the fresh control
     * pair.
     */
    let forge = true
    const forgedTransport: IWebRpcTransport = {
      ...clientBase,
      send: (value, options) =>
        clientBase.send(forge ? { ...(value as object), signature: 'forged' } : value, options)
    }
    const signed = authentication({
      sign: (value) => ({ value, signature: 'trusted' }),
      verify: (frame) => {
        verificationAttempts += 1
        const candidate = frame as { readonly value?: unknown; readonly signature?: string }
        if (candidate.signature !== 'trusted') throw new Error('forged chunk')
        return candidate.value
      }
    })
    const server = await createFullEndpoint({
      id: 'b11-unauthenticated-chunk-server',
      transport: serverTransport,
      codec: defineJsonCodec({ version: 1 }),
      framer: createStringFramer({
        chunkBytes: 1,
        maxMessageBytes: 1_024,
        assemblyTimeoutMs: 50,
        schedule: () => {
          assemblyTimers += 1
          return Object.freeze({})
        },
        cancel: () => undefined
      }),
      middlewares: [connect({ transport: serverTransport }), signed],
      provider: {
        echo: (context) => {
          providerCalls += 1
          return context.success(context.data)
        }
      }
    })
    const client = await createFullEndpoint({
      id: 'b11-unauthenticated-chunk-client',
      targetIds: ['b11-unauthenticated-chunk-server'],
      transport: forgedTransport,
      codec: defineJsonCodec({ version: 1 }),
      framer: createStringFramer({ chunkBytes: 1, maxMessageBytes: 1_024 }),
      middlewares: [connect({ transport: forgedTransport }), signed]
    })

    try {
      await expect(
        client.send('b11-unauthenticated-chunk-server', 'echo', 'fragmented', { timeoutMs: 20 })
      ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      expect(assemblyTimers).toBe(0)
      expect(providerCalls).toBe(0)
      expect(verificationAttempts).toBeGreaterThan(0)
      expect(readEndpointDebugSnapshot(server)).toMatchObject({
        activeControllers: 0,
        pending: 0
      })
      forge = false
      const [goodClientBase, goodServerTransport] = createMemoryTransportPair()
      const goodClientTransport: IWebRpcTransport = {
        ...goodClientBase,
        send: (value, options) =>
          goodClientBase.send(
            forge ? { ...(value as object), signature: 'forged' } : value,
            options
          )
      }
      const goodServer = await createFullEndpoint({
        id: 'b11-unauthenticated-chunk-good-server',
        transport: goodServerTransport,
        codec: defineJsonCodec({ version: 1 }),
        framer: createStringFramer({
          chunkBytes: 1,
          maxMessageBytes: 1_024,
          assemblyTimeoutMs: 50,
          schedule: () => {
            assemblyTimers += 1
            return Object.freeze({})
          },
          cancel: () => undefined
        }),
        middlewares: [connect({ transport: goodServerTransport }), signed],
        provider: {
          echo: (context) => {
            providerCalls += 1
            return context.success(context.data)
          }
        }
      })
      const goodClient = await createFullEndpoint({
        id: 'b11-unauthenticated-chunk-good-client',
        targetIds: ['b11-unauthenticated-chunk-good-server'],
        transport: goodClientTransport,
        codec: defineJsonCodec({ version: 1 }),
        framer: createStringFramer({ chunkBytes: 1, maxMessageBytes: 1_024 }),
        middlewares: [connect({ transport: goodClientTransport }), signed]
      })
      try {
        await expect(
          goodClient.send('b11-unauthenticated-chunk-good-server', 'echo', 'fragmented', {
            timeoutMs: 100
          })
        ).resolves.toBe('fragmented')
      } finally {
        await Promise.all([goodClient.dispose(), goodServer.dispose()])
      }
      expect(providerCalls).toBe(1)
      expect(assemblyTimers).toBeGreaterThan(0)
    } finally {
      await Promise.all([client.dispose(), server.dispose()])
    }
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

  it('registers the selected framer as the sole chunk-assembler owner and closes it once', async () => {
    const [transport] = createMemoryTransportPair()
    const kernel = createEndpointKernel(transport)
    const reasons: unknown[] = []
    const framer = {
      ...messageFramer,
      close: (reason?: unknown) => reasons.push(reason)
    }
    new WebRpcChunkAttachment(kernel, framer)
    expect(kernel.ownerKeys).toContain('chunk-assembler')
    await expect(kernel.dispatchRoute('chunk', {})).resolves.toBe(false)
    const reason = new Error('B11 bridge close')
    kernel.beginClose(reason)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toBe(reason)
    await kernel.resources.releaseAll()
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toBe(reason)
  })

  it('covers discovery query/response admission, pinning, and cleanup branches', async () => {
    const [transport, peerTransport] = createMemoryTransportPair()
    const kernel = createEndpointKernel(transport)
    const deferred = await prepareEndpoint(
      { id: 'discovery-target', transport, middlewares: [] },
      { deferMiddlewareInstall: true }
    )
    const connectPort = { uniqueTargetId: 'unique-discovery-target' }
    const prepared = await deferred.finalize(
      [],
      async (operation) => await operation(),
      (key) => (key === WebRpcSharedKey.connect ? connectPort : undefined)
    )
    const outbound = new WebRpcOutboundAttachment(kernel, prepared)
    let sentQueryTask = ''
    const peerRelease = peerTransport.subscribe(({ data }) => {
      const frame = data as { readonly kind?: unknown; readonly id?: unknown }
      if (frame.kind !== 'discovery' || typeof frame.id !== 'string') return
      sentQueryTask = frame.id
      void peerTransport.send({
        kind: 'discovery',
        id: frame.id,
        version: '1.0.0',
        acceptVersions: ['1.0.0'],
        data: {
          webRpc: {
            profile: 'web-rpc.route.v1',
            type: 'discovery-response',
            applicationVersion: '1.0.0',
            senderId: 'discovery-peer',
            targetId: 'discovery-target',
            resolvedTargetId: 'discovery-target',
            receiverId: 'discovery-receiver',
            sentAt: Date.now()
          },
          payload: { __unique_id__: 'unique-discovery-target' }
        }
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
