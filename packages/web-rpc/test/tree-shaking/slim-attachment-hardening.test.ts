import { describe, expect, it, vi } from 'vitest'
import { createClientEndpoint } from '../../src/client.js'
import { createProviderEndpoint } from '../../src/provider.js'
import { createMemoryTransportPair } from '../../src/adapters/memory.js'
import { abort } from '../../src/middleware/abort.js'
import { connect } from '../../src/middleware/connect.js'
import { hooks } from '../../src/middleware/hooks.js'
import { protocol } from '../../src/middleware/protocol.js'
import { timeout } from '../../src/middleware/timeout.js'
import { WebRpcSharedKey } from '../../src/internal/plugin-shared-keys.js'
import { readEndpointDebugSnapshot } from '../../src/internal/test-observer.js'
import type { IWebRpcInboundMessage, IWebRpcTransport } from '../../src/transport.js'
import type { IWebRpcEnvelope, IWebRpcRequest } from '../../src/wire.js'

/** Flushes receiver and provider promise continuations without relying on timer duration. */
const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** Creates a manually driven multiplexed transport for hostile source-injection probes. */
function createDrivenTransport(sourceProof: (source: unknown) => boolean = () => true): {
  readonly transport: IWebRpcTransport
  readonly sent: unknown[]
  readonly receive: (message: IWebRpcInboundMessage<unknown>) => void
} {
  const sent: unknown[] = []
  let listener: ((message: IWebRpcInboundMessage<unknown>) => void) | undefined
  const transport: IWebRpcTransport = {
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
function responseFor(request: IWebRpcRequest, data: unknown): IWebRpcEnvelope {
  return {
    kind: 'response',
    version: request.version,
    taskId: request.taskId,
    senderId: request.targetId,
    targetId: request.senderId,
    receiverId: request.senderId,
    method: request.method,
    ok: true,
    data,
    sentAt: Date.now()
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
    const endpoint = await createClientEndpoint({
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
    })
    const pending = endpoint.send('provider-source-proof', 'echo', 1, { timeoutMs: false })
    await flush()
    const request = driven.sent[0] as IWebRpcRequest
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
    const pinned = endpoint.send('provider-source-proof', 'echo', 2, { timeoutMs: false })
    await flush()
    const pinnedRequest = driven.sent[1] as IWebRpcRequest
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
    const endpoint = await createProviderEndpoint({
      id: 'provider-source-isolation',
      transport: driven.transport,
      middlewares: [
        connect({
          transport: driven.transport,
          useBaseIdVerifyOnly: false,
          identifier: () => true
        })
      ]
    })
    let executions = 0
    endpoint.provide('event', (context) => {
      executions += 1
      return context.success()
    })
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({ providers: 1, pending: 0 })
    const request: IWebRpcRequest = {
      kind: 'request',
      version: '1.0',
      taskId: 'shared-task',
      senderId: 'client-source-isolation',
      targetId: 'provider-source-isolation',
      receiverId: 'provider-source-isolation',
      method: 'event',
      data: null,
      dispatchOnly: true,
      sentAt: Date.now()
    }
    driven.receive({ data: request, source: {} })
    driven.receive({ data: request, source: {} })
    await flush()
    expect(executions).toBe(2)
    await endpoint.dispose()
  })

  it('uses dynamic timeout overrides and retries failed transport attempts serially', async () => {
    const [clientBase, providerTransport] = createMemoryTransportPair()
    let attempts = 0
    const clientTransport: IWebRpcTransport = {
      ...clientBase,
      send: (message, options) => {
        attempts += 1
        if (attempts === 1) throw new Error('retryable transport failure')
        return clientBase.send(message, options)
      },
      subscribe: (listener) => clientBase.subscribe(listener)
    }
    const provider = await createProviderEndpoint({
      id: 'retry-provider',
      transport: providerTransport,
      middlewares: [connect({ transport: providerTransport })]
    })
    provider.provide('echo', (context) => context.success(context.data))
    const overrides: Array<number | false | undefined> = []
    const dynamicTimeout = {
      name: 'dynamic-timeout',
      metadata: {
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        },
        sharedProvides: [WebRpcSharedKey.timeout]
      },
      install: () => {
        const capability = {
          retry: { maxAttempts: 2, shouldRetry: () => true, delay: () => 0 },
          resolveTimeout: (override?: number | false) => {
            overrides.push(override)
            return override
          }
        }
        return { extension: {}, shared: { [WebRpcSharedKey.timeout]: capability } }
      }
    }
    const client = await createClientEndpoint({
      id: 'retry-client',
      targetIds: ['retry-provider'],
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), dynamicTimeout]
    })
    await expect(client.send('retry-provider', 'echo', 'ok', { timeoutMs: 200 })).resolves.toBe(
      'ok'
    )
    expect(attempts).toBe(2)
    expect(overrides).toEqual([200])
    await Promise.all([client.dispose(), provider.dispose()])
  })

  it('cleans synchronous preprocessing ownership before retry and terminal disposal', async () => {
    const driven = createDrivenTransport()
    let encodes = 0
    const endpoint = await createClientEndpoint({
      id: 'sync-preprocess-client',
      targetIds: ['absent-provider'],
      transport: driven.transport,
      middlewares: [
        connect({ transport: driven.transport }),
        protocol({
          encode: (value) => {
            encodes += 1
            if (encodes === 1) throw new Error('synchronous encode failure')
            return value
          }
        }),
        timeout({
          timeoutMs: false,
          retry: { maxAttempts: 2, shouldRetry: () => true, delay: () => 0 }
        })
      ]
    })
    const before = readEndpointDebugSnapshot(endpoint)!
    const pending = endpoint.send('absent-provider', 'wait', null, { timeoutMs: false })
    await vi.waitFor(() => expect(encodes).toBe(2))
    expect(driven.sent).toHaveLength(1)
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
      pending: 1,
      hooks: before.hooks,
      resources: before.resources
    })
    await endpoint.dispose()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', code: 'CANCELLED' })
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      hooks: 0,
      resources: 0
    })
    driven.receive({ data: responseFor(driven.sent[0] as IWebRpcRequest, 'late') })
    await flush()
    expect(readEndpointDebugSnapshot(endpoint)?.pending).toBe(0)
  })

  it('cancels a pending request on caller abort and endpoint disposal', async () => {
    const driven = createDrivenTransport()
    const endpoint = await createClientEndpoint({
      id: 'abort-client',
      targetIds: ['absent-provider'],
      transport: driven.transport,
      middlewares: [
        connect({ transport: driven.transport }),
        abort(),
        timeout({ timeoutMs: false })
      ]
    })
    const controller = new AbortController()
    const callerAbort = endpoint.send('absent-provider', 'wait', null, {
      signal: controller.signal,
      timeoutMs: false
    })
    controller.abort()
    await expect(callerAbort).rejects.toMatchObject({ name: 'AbortError', code: 'CANCELLED' })
    expect(readEndpointDebugSnapshot(endpoint)?.pending).toBe(0)
    const disposalAbort = endpoint.send('absent-provider', 'wait', null, { timeoutMs: false })
    await vi.waitFor(() => expect(readEndpointDebugSnapshot(endpoint)?.pending).toBe(1))
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
    const provider = await createProviderEndpoint({
      id: 'verified-abort-provider',
      transport: providerTransport,
      middlewares: [connect({ transport: providerTransport }), abort()]
    })
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
    const client = await createClientEndpoint({
      id: 'verified-abort-client',
      targetIds: ['verified-abort-provider'],
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
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
    const endpoint = await createClientEndpoint({
      id: 'hostile-signal-client',
      targetIds: ['absent-provider'],
      transport: driven.transport,
      middlewares: [connect({ transport: driven.transport }), abort()]
    })
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

  it('bounds asynchronous retry policy by total deadline and disposal', async () => {
    const createRetryClient = async (id: string, timeoutMs: number | false) => {
      const driven = createDrivenTransport()
      const transport: IWebRpcTransport = {
        ...driven.transport,
        send: () => {
          throw new Error('retry policy input')
        }
      }
      const endpoint = await createClientEndpoint({
        id,
        targetIds: ['absent-provider'],
        transport,
        middlewares: [
          connect({ transport }),
          timeout({
            timeoutMs,
            retry: {
              maxAttempts: 2,
              shouldRetry: () => new Promise<boolean>(() => undefined)
            }
          })
        ]
      })
      return endpoint
    }
    const deadlineClient = await createRetryClient('deadline-retry-client', 10)
    await expect(deadlineClient.send('absent-provider', 'wait', null)).rejects.toMatchObject({
      name: 'TimeoutError',
      code: 'DEADLINE_EXCEEDED'
    })
    await deadlineClient.dispose()
    const disposalClient = await createRetryClient('dispose-retry-client', false)
    const pending = disposalClient.send('absent-provider', 'wait', null)
    await flush()
    await disposalClient.dispose()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', code: 'CANCELLED' })
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
        return { extension: {}, shared: {} }
      }
    }
    const endpoint = await createClientEndpoint({
      id: 'hook-client',
      transport: driven.transport,
      middlewares: [
        connect({ transport: driven.transport }),
        hooks({ listeners: listener, onHookError: reporter }),
        eventMiddleware
      ]
    })
    await flush()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(reporter).toHaveBeenCalledTimes(2)
    expect(reports).toHaveLength(2)
    expect(readEndpointDebugSnapshot(endpoint)?.hooks).toBe(1)
    await endpoint.dispose()
    expect(readEndpointDebugSnapshot(endpoint)).toMatchObject({ hooks: 0, resources: 0 })
  })
})
