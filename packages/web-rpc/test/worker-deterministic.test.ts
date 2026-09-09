import { describe, expect, it, vi } from 'vitest'
import { createClientEndpoint } from '../src/client.js'
import { createProviderEndpoint } from '../src/provider.js'
import type { IWebRpcTransport } from '../src/transport.js'
import { readEndpointDebugSnapshot } from '../src/internal/test-observer.js'
import { PendingRegistry } from '../src/internal/pending.js'
import { ProviderAdmissionRegistry } from '../src/internal/provider-admission.js'
import { connect } from '../src/middleware/connect.js'

type IQueuedFrame = {
  readonly data: unknown
  readonly source?: unknown
}

type IControlledTransport = IWebRpcTransport & {
  readonly queued: IQueuedFrame[]
  deliver(message: unknown): void
}

/** Canonical semantic frame fields read by the source-less Worker transport oracle. */
type ICanonicalWorkerFrame = {
  readonly id: string
  readonly data: {
    readonly webRpc: { readonly receiverId?: string }
    readonly payload?: unknown
  }
}

/** Creates a source-less Worker-like transport whose delivery order is test-controlled. */
function createControlledTransport(): IControlledTransport {
  let listener: ((message: IQueuedFrame) => void) | undefined
  const queued: IQueuedFrame[] = []
  return {
    platform: 'Worker',
    topology: 'exclusive',
    send(message) {
      queued.push({ data: message })
    },
    subscribe(next) {
      listener = next
      return () => {
        listener = undefined
      }
    },
    deliver(message) {
      listener?.({ data: message, source: undefined })
    },
    queued
  }
}

/** Removes queued frames so the harness can deliver each phase deliberately. */
function takeFrames(from: IControlledTransport): readonly unknown[] {
  return from.queued.splice(0).map(({ data }) => data)
}

/** Lets endpoint construction and request preprocessing publish their queued frames. */
async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

describe('deterministic source-less Worker settlement', () => {
  it('settles concurrent out-of-order responses exactly once', async () => {
    const clientTransport = createControlledTransport()
    const providerTransport = createControlledTransport()
    let executions = 0
    const releaseProviderCalls = new Map<string, () => void>()
    const taskIdByData = new Map<string, string>()
    const providerAcquireSpy = vi.spyOn(ProviderAdmissionRegistry.prototype, 'acquire')
    const providerReleaseSpy = vi.spyOn(ProviderAdmissionRegistry.prototype, 'release')
    const clientReleaseSpy = vi.spyOn(PendingRegistry.prototype, 'delete')
    const provider = await createProviderEndpoint({
      id: 'worker-provider',
      transport: providerTransport,
      middlewares: [connect({ transport: providerTransport })]
    })
    provider.provide('echo', async (context) => {
      executions += 1
      const taskId = taskIdByData.get(String(context.data)) ?? String(context.data)
      await new Promise<void>((resolve) => {
        releaseProviderCalls.set(taskId, () => {
          resolve()
        })
      })
      return context.success(context.data)
    })
    const client = await createClientEndpoint({
      id: 'worker-client',
      targetIds: ['worker-provider'],
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    })

    try {
      const first = client.send('worker-provider', 'echo', 'first')
      const second = client.send('worker-provider', 'echo', 'second')
      await drainMicrotasks()
      const requests = takeFrames(clientTransport)
      expect(requests).toHaveLength(2)
      const taskIds = requests.map((frame) => (frame as ICanonicalWorkerFrame).id)
      requests.forEach((frame) => {
        const record = frame as ICanonicalWorkerFrame
        taskIdByData.set(String(record.data.payload), record.id)
      })
      expect(
        requests.every(
          (frame) =>
            typeof frame === 'object' &&
            frame !== null &&
            'data' in frame &&
            (frame as ICanonicalWorkerFrame).data.webRpc.receiverId === 'worker-provider'
        )
      ).toBe(true)

      const firstRequest = requests[0] as ICanonicalWorkerFrame
      providerTransport.deliver({
        ...firstRequest,
        data: {
          ...firstRequest.data,
          webRpc: { ...firstRequest.data.webRpc, receiverId: 'foreign-provider' }
        }
      })
      await drainMicrotasks()
      expect(executions).toBe(0)
      expect(readEndpointDebugSnapshot(provider)).toMatchObject({ activeControllers: 0 })
      expect(providerAcquireSpy).not.toHaveBeenCalled()

      providerTransport.deliver(requests[0])
      await drainMicrotasks()
      expect(executions).toBe(1)
      expect(readEndpointDebugSnapshot(provider)).toMatchObject({ activeControllers: 1 })

      providerTransport.deliver(requests[1])
      await drainMicrotasks()
      expect(executions).toBe(2)
      expect(readEndpointDebugSnapshot(provider)).toMatchObject({ activeControllers: 2 })
      expect(readEndpointDebugSnapshot(client)).toMatchObject({ pending: 2 })
      const providerAdmissionKeys = providerAcquireSpy.mock.calls.map(([key]) => key)
      expect(providerAdmissionKeys).toHaveLength(2)
      expect(new Set(providerAdmissionKeys)).toHaveLength(2)

      releaseProviderCalls.get(taskIdByData.get('first') ?? 'first')?.()
      releaseProviderCalls.get(taskIdByData.get('second') ?? 'second')?.()
      await drainMicrotasks()
      const responses = takeFrames(providerTransport)
      expect(responses).toHaveLength(2)
      await vi.waitFor(() =>
        expect(providerReleaseSpy.mock.calls.map(([key]) => key).sort()).toEqual(
          providerAdmissionKeys.slice().sort()
        )
      )
      expect(
        responses.every(
          (frame) =>
            typeof frame === 'object' &&
            frame !== null &&
            'data' in frame &&
            (frame as ICanonicalWorkerFrame).data.webRpc.receiverId === 'worker-client'
        )
      ).toBe(true)

      const firstResponse = responses[0] as ICanonicalWorkerFrame
      clientTransport.deliver({
        ...firstResponse,
        data: {
          ...firstResponse.data,
          webRpc: { ...firstResponse.data.webRpc, receiverId: 'foreign-client' }
        }
      })
      clientTransport.deliver({
        ...firstResponse,
        id: 'unknown-task'
      })
      await drainMicrotasks()
      expect(readEndpointDebugSnapshot(client)).toMatchObject({ pending: 2 })
      expect(clientReleaseSpy).not.toHaveBeenCalled()

      const reversedResponses = responses.slice().reverse()
      clientTransport.deliver(reversedResponses[0])
      await drainMicrotasks()
      expect(readEndpointDebugSnapshot(client)).toMatchObject({ pending: 1 })
      clientTransport.deliver(reversedResponses[1])
      await drainMicrotasks()
      expect(readEndpointDebugSnapshot(client)).toMatchObject({ pending: 0 })
      await expect(first).resolves.toBe('first')
      await expect(second).resolves.toBe('second')
      for (const taskId of taskIds) {
        expect(clientReleaseSpy.mock.calls.filter(([id]) => id === taskId)).toHaveLength(1)
      }
      expect(executions).toBe(2)
      expect(readEndpointDebugSnapshot(provider)).toMatchObject({ activeControllers: 0 })
      clientTransport.deliver(reversedResponses[1])
      await drainMicrotasks()
      expect(readEndpointDebugSnapshot(client)).toMatchObject({ pending: 0 })
    } finally {
      providerAcquireSpy.mockRestore()
      providerReleaseSpy.mockRestore()
      clientReleaseSpy.mockRestore()
      await Promise.all([client.dispose(), provider.dispose()])
    }

    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      resources: 0
    })
    expect(readEndpointDebugSnapshot(provider)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      resources: 0
    })
  })
})
