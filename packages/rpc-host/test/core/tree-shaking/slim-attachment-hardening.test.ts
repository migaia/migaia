import { readEndpointOwner } from '../../../dist/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../../dist/core/endpoint-kernel.js'
import type { PendingRegistry } from '../../../dist/core/internal/pending.js'
import { createRuntimeEndpointComposition } from '../../../dist/core/runtime-api-endpoint.js'
import { describe, expect, it, vi } from 'vitest'

import { createMemoryTransportPair } from '../../fixtures/memory-transport.js'
import { abort } from '../../../dist/core/middleware/abort.js'
import { connect } from '../../../dist/core/middleware/connect.js'
import { hooks } from '../../../dist/core/middleware/hooks.js'
import { timeout } from '../../../dist/core/middleware/timeout.js'
import { readEndpointDebugSnapshot } from '../../../dist/core/internal/test-observer.js'
import type { IRpcInboundMessage } from '../../../dist/core/transport.js'
import type { IRpcTransport } from '../../../dist/core/transport.js'
import type { IRpcEnvelope, IRpcPortableValue, IRpcRequestEnvelope } from '@migaia/rpc-contract'
import { RpcRouteProfile } from '@migaia/rpc-contract'

/** Flushes receiver and provider promise continuations without relying on timer duration. */
const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** Creates a manually driven multiplexed transport for hostile source-injection probes. */
function createDrivenTransport(sourceProof: (source: unknown) => boolean = () => true): {
  readonly transport: IRpcTransport
  readonly sent: unknown[]
  readonly receive: (message: IRpcInboundMessage<unknown>) => void
} {
  const sent: unknown[] = []
  let listener: ((message: IRpcInboundMessage<unknown>) => void) | undefined
  const transport: IRpcTransport = {
    platform: 'Memory',
    topology: 'multiplexed',
    sourceProof: (source) => sourceProof(source),
    send: (message) => {
      sent.push(message)
    },
    subscribe: (next) => {
      listener = next
      return () => {
        listener = undefined
      }
    }
  }
  return {
    transport,
    sent,
    receive: (message) => listener?.(message)
  }
}

/** Creates a matching successful response for one captured slim request. */
function responseFor(request: IRpcRequestEnvelope, data: unknown): IRpcEnvelope {
  const route = request.data.route
  return {
    kind: 'response',
    id: request.id,
    ok: true,
    data: {
      route: {
        profile: RpcRouteProfile,
        type: 'response',
        applicationVersion: route.applicationVersion,
        senderId: route.targetId,
        targetId: route.senderId,
        receiverId: route.senderId,
        method: request.method,
        sentAt: Date.now()
      },
      payload: data as IRpcPortableValue
    }
  }
}

describe('slim attachment hostile equivalence', () => {
  it('rejects source-proof mismatch and pins later responses to stable object identity', async () => {
    const acceptedSource = {}
    const forgedSource = {}
    let enforceSourceProof = true
    const driven = createDrivenTransport(
      (source) => !enforceSourceProof || source === acceptedSource
    )
    const endpoint = await createRuntimeEndpointComposition(
      {
        id: 'client-source-proof',
        targetIds: ['provider-source-proof'],
        transport: driven.transport,
        middlewares: [
          connect({
            transport: driven.transport,
            useBaseIdVerifyOnly: false,
            identifier: () => true
          })
        ]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const pending = endpoint.send('provider-source-proof', 'echo', 1, {
      timeoutMs: false,
      receiverId: 'provider-source-proof'
    } as never)
    await vi.waitFor(() => expect(driven.sent).toHaveLength(1))
    const request = driven.sent[0] as IRpcRequestEnvelope
    let settled = false
    void pending.then(() => {
      settled = true
    })
    driven.receive({ data: responseFor(request, 'forged'), source: forgedSource })
    await flush()
    expect(settled).toBe(false)
    driven.receive({ data: responseFor(request, 'accepted'), source: acceptedSource })
    await expect(pending).resolves.toBe('accepted')
    enforceSourceProof = false
    const pinned = endpoint.send('provider-source-proof', 'echo', 2, {
      timeoutMs: false,
      receiverId: 'provider-source-proof'
    } as never)
    await vi.waitFor(() => expect(driven.sent).toHaveLength(2))
    const pinnedRequest = driven.sent[1] as IRpcRequestEnvelope
    let pinnedSettled = false
    void pinned.then(() => {
      pinnedSettled = true
    })
    driven.receive({ data: responseFor(pinnedRequest, 'wrong-source'), source: forgedSource })
    await flush()
    expect(pinnedSettled).toBe(false)
    driven.receive({ data: responseFor(pinnedRequest, 'same-source'), source: acceptedSource })
    await expect(pinned).resolves.toBe('same-source')
    await endpoint.dispose()
  })

  it('isolates two accepted object sources instead of collapsing their provider replay keys', async () => {
    const driven = createDrivenTransport()
    const endpoint = await createRuntimeEndpointComposition(
      {
        id: 'provider-source-isolation',
        transport: driven.transport,
        middlewares: [
          connect({
            transport: driven.transport,
            useBaseIdVerifyOnly: false,
            identifier: () => true
          })
        ]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    let executions = 0
    endpoint.provide('event', (context) => {
      executions += 1
      return context.success()
    })
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({ providers: 1, pending: 0 })
    const request: IRpcRequestEnvelope = {
      kind: 'request',
      id: 'shared-task',
      method: 'event',
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'request',
          applicationVersion: '1.0',
          senderId: 'client-source-isolation',
          targetId: 'provider-source-isolation',
          receiverId: 'provider-source-isolation',
          dispatchOnly: true,
          sentAt: Date.now()
        },
        payload: null
      }
    }
    driven.receive({ data: request, source: {} })
    driven.receive({ data: request, source: {} })
    await flush()
    expect(executions).toBe(2)
    await endpoint.dispose()
  })

  it('cancels a pending request on caller abort and endpoint disposal', async () => {
    const driven = createDrivenTransport()
    const endpoint = await createRuntimeEndpointComposition(
      {
        id: 'abort-client',
        targetIds: ['absent-provider'],
        transport: driven.transport,
        middlewares: [
          connect({ transport: driven.transport }),
          abort(),
          timeout({ timeoutMs: false })
        ]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    /**
     * Observe the original request registry in the symmetric bundle, independently of its provider
     * snapshot.
     */
    const pendingRegistry = readEndpointOwner<PendingRegistry<unknown>>(
      endpoint,
      EndpointOwnerKey.pendingRegistry
    )!
    const controller = new AbortController()
    const callerAbort = endpoint.send('absent-provider', 'wait', null, {
      signal: controller.signal,
      timeoutMs: false
    })
    controller.abort()
    await expect(callerAbort).rejects.toMatchObject({ name: 'AbortError', code: 'CANCELLED' })
    expect(pendingRegistry.size).toBe(0)
    const disposalAbort = endpoint.send('absent-provider', 'wait', null, { timeoutMs: false })
    await vi.waitFor(() => expect(pendingRegistry.size).toBe(1))
    await endpoint.dispose()
    await expect(disposalAbort).rejects.toMatchObject({ name: 'AbortError', code: 'CANCELLED' })
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      hooks: 0,
      resources: 0
    })
  })

  it('routes caller abort through the verified provider variation owner', async () => {
    const [clientTransport, providerTransport] = createMemoryTransportPair()
    const provider = await createRuntimeEndpointComposition(
      {
        id: 'verified-abort-provider',
        transport: providerTransport,
        middlewares: [connect({ transport: providerTransport }), abort()]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    let started = false
    let aborted = false
    provider.provide('wait', (context) => {
      started = true
      return new Promise((resolve) => {
        context.signal.addEventListener(
          'abort',
          () => {
            aborted = true
            resolve(context.failed('cancelled', 'CANCELLED'))
          },
          { once: true }
        )
      })
    })
    const client = await createRuntimeEndpointComposition(
      {
        id: 'verified-abort-client',
        targetIds: ['verified-abort-provider'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), abort()]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const controller = new AbortController()
    const pending = client.send('verified-abort-provider', 'wait', null, {
      signal: controller.signal,
      timeoutMs: false
    })
    await vi.waitFor(() => expect(started).toBe(true))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', code: 'CANCELLED' })
    await vi.waitFor(() => expect(aborted).toBe(true))
    await Promise.all([client.dispose(), provider.dispose()])
  })

  it('rejects a hostile abort signal with the original cause before sending', async () => {
    const driven = createDrivenTransport()
    const endpoint = await createRuntimeEndpointComposition(
      {
        id: 'hostile-signal-client',
        targetIds: ['absent-provider'],
        transport: driven.transport,
        middlewares: [connect({ transport: driven.transport }), abort()]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const original = new Error('hostile addEventListener')
    const remove = vi.fn()
    const signal = {
      aborted: false,
      addEventListener: () => {
        throw original
      },
      removeEventListener: remove
    } as unknown as AbortSignal
    await expect(
      endpoint.send('absent-provider', 'wait', null, { signal, timeoutMs: false })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG', cause: original })
    expect(remove).toHaveBeenCalledOnce()
    expect(driven.sent).toHaveLength(0)
    await endpoint.dispose()
  })

  it('reports sync and async hook failures while containing reporter failure', async () => {
    const reports: unknown[] = []
    const listener = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('sync hook failure')
      })
      .mockRejectedValueOnce(new Error('async hook failure'))
    const reporter = vi.fn((error: unknown) => {
      reports.push(error)
      if (reports.length === 2) throw new Error('reporter failure')
    })
    const driven = createDrivenTransport()
    const eventMiddleware = {
      name: 'initial-events',
      metadata: {
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        }
      },
      install: ({ hooks: emit }: { hooks: (event: never) => void }) => {
        emit({ name: 'first', at: 1, localId: 'hook-client' } as never)
        emit({ name: 'second', at: 2, localId: 'hook-client' } as never)
        return { extension: {}, ports: {} }
      }
    }
    const endpoint = await createRuntimeEndpointComposition(
      {
        id: 'hook-client',
        transport: driven.transport,
        middlewares: [
          connect({ transport: driven.transport }),
          hooks({ listeners: listener, onHookError: reporter }),
          eventMiddleware
        ]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    /** Hook ownership remains at the original registry even when a provider snapshot is selected. */
    const hookRegistry = readEndpointOwner<{ readonly size: number }>(endpoint, 'hook-registry')!
    await flush()
    // Two constructor events fail independently; the retained endpoint hook receives its own
    // successful activation event after both failures without re-entering either reporter.
    expect(listener).toHaveBeenCalledTimes(3)
    expect(reporter).toHaveBeenCalledTimes(2)
    expect(reports).toHaveLength(2)
    expect(hookRegistry.size).toBe(1)
    await endpoint.dispose()
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({ hooks: 0, resources: 0 })
  })
})
