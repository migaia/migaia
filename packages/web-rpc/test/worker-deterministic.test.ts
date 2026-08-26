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
      const taskIds = requests.map((frame) => (frame as { taskId: string }).taskId)
      requests.forEach((frame) => {
        const record = frame as { data: string; taskId: string }
        taskIdByData.set(record.data, record.taskId)
      })
      expect(
        requests.every(
          (frame) =>
            typeof frame === 'object' &&
            frame !== null &&
            'receiverId' in frame &&
            frame.receiverId === 'worker-provider'
        )
      ).toBe(true)

      providerTransport.deliver({
        ...(requests[0] as Record<string, unknown>),
        receiverId: 'foreign-provider'
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
      for (const taskId of taskIds) {
        expect(providerAcquireSpy.mock.calls.filter(([key]) => key.includes(taskId))).toHaveLength(
          1
        )
      }

      releaseProviderCalls.get(taskIdByData.get('first') ?? 'first')?.()
      releaseProviderCalls.get(taskIdByData.get('second') ?? 'second')?.()
      await drainMicrotasks()
      const responses = takeFrames(providerTransport)
      expect(responses).toHaveLength(2)
      for (const taskId of taskIds) {
        expect(providerReleaseSpy.mock.calls.filter(([key]) => key.includes(taskId))).toHaveLength(
          1
        )
      }
      expect(
        responses.every(
          (frame) =>
            typeof frame === 'object' &&
            frame !== null &&
            'receiverId' in frame &&
            frame.receiverId === 'worker-client'
        )
      ).toBe(true)

      clientTransport.deliver({
        ...(responses[0] as Record<string, unknown>),
        receiverId: 'foreign-client'
      })
      clientTransport.deliver({
        ...(responses[0] as Record<string, unknown>),
        taskId: 'unknown-task'
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
