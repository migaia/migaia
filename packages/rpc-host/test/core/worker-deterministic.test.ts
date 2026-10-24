import { readEndpointOwner } from '../../dist/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../dist/core/endpoint-kernel.js'
import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { describe, expect, it, vi } from 'vitest'

import type { IRpcTransport } from '../../dist/core/transport.js'
import { readEndpointDebugSnapshot } from '../../dist/core/internal/test-observer.js'
import { PendingRegistry } from '../../dist/core/internal/pending.js'
import { ProviderAdmissionRegistry } from '../../dist/core/internal/provider-admission.js'
import { connect } from '../../dist/core/middleware/connect.js'

type IQueuedFrame = {
  readonly data: unknown
  readonly source?: unknown
}

type IControlledTransport = IRpcTransport & {
  readonly queued: IQueuedFrame[]
  deliver(message: unknown): void
}

/** Canonical semantic frame fields read by the source-less Worker transport oracle. */
type ICanonicalWorkerFrame = {
  readonly id: string
  readonly data: {
    readonly route: { readonly receiverId?: string }
    readonly payload?: unknown
  }
}

/** One source-less Worker-like transport owns its actual listener and chronological frames. */
class ControlledTransport implements IControlledTransport {
  /** This original physical profile deliberately carries no sender-side source reference. */
  readonly platform = 'Worker'
  /** One exclusive peer owns the same original physical frame boundary. */
  readonly topology = 'exclusive' as const
  /** The current native subscription is replaced and revoked by the original callbacks. */
  #listener: ((message: IQueuedFrame) => void) | undefined
  /** Tests deliver each original chronological frame exactly when their phase permits it. */
  readonly queued: IQueuedFrame[] = []
  /** Retain the actual message object instead of simulating a response protocol. */
  send = (message: unknown): void => {
    this.queued.push({ data: message })
  }
  /** Install one actual listener and return its original unconditional revocation operation. */
  subscribe = (next: (message: IQueuedFrame) => void): (() => void) => {
    this.#listener = next
    return () => {
      this.#listener = undefined
    }
  }
  /** Native dispatch keeps a plain receiver and the original undefined source reference. */
  deliver = (message: unknown): void => {
    /** The original listener is not called with this transport as its receiver. */
    const listener = this.#listener
    listener?.({ data: message, source: undefined })
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
    const clientTransport = new ControlledTransport()
    const providerTransport = new ControlledTransport()
    let executions = 0
    const releaseProviderCalls = new Map<string, () => void>()
    const taskIdByData = new Map<string, string>()
    const providerAcquireSpy = vi.spyOn(ProviderAdmissionRegistry.prototype, 'acquire')
    const providerReleaseSpy = vi.spyOn(ProviderAdmissionRegistry.prototype, 'release')
    const clientReleaseSpy = vi.spyOn(PendingRegistry.prototype, 'delete')
    const provider = await createRuntimeEndpointComposition(
      {
        id: 'worker-provider',
        transport: providerTransport,
        middlewares: [connect({ transport: providerTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
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
    const client = await createRuntimeEndpointComposition(
      {
        id: 'worker-client',
        targetIds: ['worker-provider'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing

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
            (frame as ICanonicalWorkerFrame).data.route.receiverId === 'worker-provider'
        )
      ).toBe(true)

      const firstRequest = requests[0] as ICanonicalWorkerFrame
      providerTransport.deliver({
        ...firstRequest,
        data: {
          ...firstRequest.data,
          route: { ...firstRequest.data.route, receiverId: 'foreign-provider' }
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
      expect(
        readEndpointOwner<PendingRegistry<unknown>>(client, EndpointOwnerKey.pendingRegistry)!.size
      ).toBe(2)
      const providerAdmissionKeys = providerAcquireSpy.mock.calls.map(([key]) => key)
      expect(providerAdmissionKeys).toHaveLength(2)
      expect(new Set(providerAdmissionKeys)).toHaveLength(2)

      releaseProviderCalls.get(taskIdByData.get('first') ?? 'first')?.()
      releaseProviderCalls.get(taskIdByData.get('second') ?? 'second')?.()
      await drainMicrotasks()
      const responses = takeFrames(providerTransport)
      expect(responses).toHaveLength(2)
      await vi.waitFor(() =>
        expect(new Set(providerReleaseSpy.mock.calls.map(([key]) => key))).toEqual(
          new Set(providerAdmissionKeys)
        )
      )
      expect(
        responses.every(
          (frame) =>
            typeof frame === 'object' &&
            frame !== null &&
            'data' in frame &&
            (frame as ICanonicalWorkerFrame).data.route.receiverId === 'worker-client'
        )
      ).toBe(true)

      const firstResponse = responses[0] as ICanonicalWorkerFrame
      clientTransport.deliver({
        ...firstResponse,
        data: {
          ...firstResponse.data,
          route: { ...firstResponse.data.route, receiverId: 'foreign-client' }
        }
      })
      clientTransport.deliver({
        ...firstResponse,
        id: 'unknown-task'
      })
      await drainMicrotasks()
      expect(
        readEndpointOwner<PendingRegistry<unknown>>(client, EndpointOwnerKey.pendingRegistry)!.size
      ).toBe(2)
      expect(clientReleaseSpy).not.toHaveBeenCalled()

      const reversedResponses = responses.slice().reverse()
      clientTransport.deliver(reversedResponses[0])
      await drainMicrotasks()
      expect(
        readEndpointOwner<PendingRegistry<unknown>>(client, EndpointOwnerKey.pendingRegistry)!.size
      ).toBe(1)
      clientTransport.deliver(reversedResponses[1])
      await drainMicrotasks()
      expect(
        readEndpointOwner<PendingRegistry<unknown>>(client, EndpointOwnerKey.pendingRegistry)!.size
      ).toBe(0)
      await expect(first).resolves.toBe('first')
      await expect(second).resolves.toBe('second')
      for (const taskId of taskIds) {
        expect(clientReleaseSpy.mock.calls.filter(([id]) => id === taskId)).toHaveLength(1)
      }
      expect(executions).toBe(2)
      expect(readEndpointDebugSnapshot(provider)).toMatchObject({ activeControllers: 0 })
      clientTransport.deliver(reversedResponses[1])
      await drainMicrotasks()
      expect(
        readEndpointOwner<PendingRegistry<unknown>>(client, EndpointOwnerKey.pendingRegistry)!.size
      ).toBe(0)
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
