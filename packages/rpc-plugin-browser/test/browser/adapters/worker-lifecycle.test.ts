import { describe, expect, it, vi } from 'vitest'
import { createServiceWorkerCarrier } from '../../../dist/browser/adapters/service-worker.js'
import { createSharedWorkerCarrier } from '../../../dist/browser/adapters/shared-worker.js'
import {
  createDedicatedWorkerCarrier,
  subscribeWorkerErrors
} from '../../../dist/browser/adapters/dedicated-worker.js'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'

describe('shared-worker native lifecycle', () => {
  it('shares one underlying subscription and isolates delivery failures', async () => {
    /** Native callbacks and their exact acquisition/release order remain the original oracle. */
    const listeners = new Map<string, (event: MessageEvent<unknown>) => void>()
    /** Only actual native add calls enter this receipt. */
    const added: string[] = []
    /** SDK cleanup must remove the same native callbacks in original reverse order. */
    const removed: string[] = []
    /** Native postMessage receives the exact frame and original backing list. */
    const sent: unknown[] = []
    /** Transfer identity is independent of new semantic media framing. */
    const transferLists: Array<readonly Transferable[]> = []
    /** Actual MessagePort activation occurs once, before its one message subscription. */
    let starts = 0
    /** This borrowed native source has no close operation taken by the carrier. */
    const port = {
      postMessage(message: unknown, transfer?: readonly Transferable[]) {
        sent.push(message)
        if (transfer) transferLists.push(transfer)
      },
      start() {
        starts += 1
      },
      addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
        added.push(type)
        listeners.set(type, listener)
      },
      removeEventListener(type: string) {
        removed.push(type)
        listeners.delete(type)
      }
    }
    /** Original callback failures reach the actual SDK reporter without escaping native delivery. */
    const listenerFailures: unknown[] = []
    /** Physical messageerror is still a separate native transport failure. */
    const transportFailures: unknown[] = []
    /** This is the actual native constructor used by sharedWorkerPlugin. */
    const carrier = createSharedWorkerCarrier(port, {
      report: (error) => listenerFailures.push(error)
    })
    /** SDK has one receiver; first delivery exercises real callback-failure containment. */
    const first = carrier.subscribe({
      frame: () => {
        throw new Error('listener failed')
      },
      error: () => undefined,
      close: () => undefined
    })
    expect(() => listeners.get('message')?.({ data: 'inbound' } as MessageEvent)).not.toThrow()
    first()
    expect(removed).toEqual([])
    /** A new actual receiver replaces the deleted adapter subscriber fanout. */
    const received: unknown[] = []
    carrier.subscribe({
      frame: (message) => received.push(message),
      error: (error) => transportFailures.push(error),
      close: () => undefined
    })
    /** Real backing identity replaces the old opaque Transferable placeholder. */
    const token = new ArrayBuffer(1)
    /** Canonical media shell is passed unchanged to actual native postMessage. */
    const frame = { kind: RpcCarrierFrameKind.message, data: 'outbound' } as const
    await carrier.write(frame, { transfer: [token] })
    listeners.get('message')?.({
      data: 'inbound',
      origin: 'https://peer.test',
      source: {}
    } as MessageEvent)
    listeners.get('messageerror')?.(new Event('messageerror') as MessageEvent)
    expect(starts).toBe(1)
    expect(added).toEqual(['message', 'messageerror'])
    expect(sent).toEqual([frame])
    expect(transferLists).toEqual([[token]])
    expect(received).toEqual(['inbound'])
    expect(listenerFailures).toHaveLength(1)
    expect(transportFailures).toHaveLength(1)
    await carrier.close()
    expect(removed).toEqual(['messageerror', 'message'])
  })

  it('reports hostile events and contains throwing diagnostic listeners', async () => {
    /**
     * Each native physical failure is tested on a live carrier, without delivering after
     * retirement.
     */
    const failures: unknown[] = []
    for (const kind of ['data', 'messageerror']) {
      /** The original event and messageerror callbacks belong only to this actual acquisition. */
      const listeners = new Map<string, (event: MessageEvent<unknown>) => void>()
      /** This borrowed native object exposes only the real callback registration operations. */
      const port = {
        postMessage() {},
        addEventListener(type: string, listener: (event: MessageEvent<unknown>) => void) {
          listeners.set(type, listener)
        },
        removeEventListener(type: string) {
          listeners.delete(type)
        }
      }
      /** Callback faults are independently reported by SDK after the original physical failure. */
      const diagnostics: unknown[] = []
      /** The production native constructor retains the original getter/messageerror classification. */
      const carrier = createSharedWorkerCarrier(port, {
        report: (error) => diagnostics.push(error)
      })
      carrier.subscribe({
        frame: () => undefined,
        error: (error) => {
          failures.push(error)
          throw new Error('reporter failed')
        },
        close: () => undefined
      })
      if (kind === 'data') {
        expect(() =>
          listeners.get('message')?.(
            Object.defineProperty({}, 'data', {
              get: () => {
                throw new Error('hostile data')
              }
            }) as MessageEvent
          )
        ).not.toThrow()
      } else
        expect(() =>
          listeners.get('messageerror')?.(new Event('messageerror') as MessageEvent)
        ).not.toThrow()
      expect(diagnostics).toHaveLength(1)
      await carrier.close()
    }
    expect(failures).toHaveLength(2)
  })

  it('retains the final subscription when shared-worker cleanup fails', async () => {
    /** Native removal failure remains exact; deleted subscriber retry protocol is not recreated. */
    let removals = 0
    /** The native exception must stay the actual close rejection, without test wrapping. */
    const primary = new Error('message cleanup failed')
    /** This exact native remover fails only its original first attempt. */
    const port = {
      postMessage() {},
      addEventListener() {},
      removeEventListener(type: string) {
        if (type !== 'message') return
        removals += 1
        if (removals === 1) throw primary
      }
    }
    /** Actual SDK close owns this lifetime and shares one physical completion. */
    const carrier = createSharedWorkerCarrier(port, { report: () => undefined })
    /** Close is published before native cleanup can fail or reenter. */
    const closing = carrier.close()
    await expect(closing).rejects.toThrow('message cleanup failed')
    await expect(closing).rejects.toBe(primary)
    expect(carrier.close()).toBe(closing)
    expect(removals).toBe(1)
  })
})

describe('dedicated-worker native lifecycle', () => {
  it('forwards metadata and owns lazy message and failure subscriptions', async () => {
    /** Actual native callback effects preserve acquisition and cleanup counts. */
    const listeners = new Map<string, (event: MessageEvent<unknown>) => void>()
    /** Native acquisition remains exactly message, error and messageerror once. */
    const add = vi.fn((type: string, listener: (event: MessageEvent<unknown>) => void) =>
      listeners.set(type, listener)
    )
    /** The actual SDK lifetime releases the three original callbacks once. */
    const remove = vi.fn((type: string) => listeners.delete(type))
    /** Only the exact outgoing native port is used for physical write. */
    const postMessage = vi.fn()
    /** This source is the same actual borrowed Worker surface used by the public plugin. */
    const port = { postMessage, addEventListener: add, removeEventListener: remove }
    /** One actual receiver failure goes to SDK report, separate from physical failures. */
    const listenerFailures: unknown[] = []
    /** The real native constructor owns no accepted peerId/origin metadata facade. */
    const carrier = createDedicatedWorkerCarrier(port, {
      report: (error) => listenerFailures.push(error)
    })
    /** The first actual delivery exercises callback isolation without fabricating subscriber fanout. */
    const first = carrier.subscribe({
      frame: () => {
        throw new Error('listener failed')
      },
      error: () => undefined,
      close: () => undefined
    })
    expect(() => listeners.get('message')?.({ data: 'inbound' } as MessageEvent)).not.toThrow()
    first()
    /** The next actual receiver observes unchanged native payload. */
    const received: unknown[] = []
    carrier.subscribe({
      frame: (message) => received.push(message),
      error: () => undefined,
      close: () => undefined
    })
    /** New media framing retains the same semantic payload and exact native backing transfer. */
    const frame = { kind: RpcCarrierFrameKind.message, data: 'outbound' } as const
    await carrier.write(frame, { transfer: [new ArrayBuffer(1)] })
    listeners.get('message')?.({
      data: 'inbound',
      origin: 'origin',
      source: 'source'
    } as unknown as MessageEvent)
    expect(received).toEqual(['inbound'])
    expect(listenerFailures).toHaveLength(1)
    expect(add).toHaveBeenCalledTimes(3)
    await carrier.close()
    expect(remove).toHaveBeenCalledTimes(3)
    expect(postMessage).toHaveBeenCalledOnce()
  })

  it('rolls back the first failure listener when the second registration fails', () => {
    /** This native error subscription is the exact helper called by the actual Worker carrier. */
    const added: string[] = []
    /** Only the first successfully acquired native callback may be removed on partial failure. */
    const removed: string[] = []
    /** The second native add fails before its callback has been acquired. */
    const port = {
      postMessage() {},
      addEventListener(type: string) {
        if (type === 'messageerror') throw new Error('messageerror listener failed')
        added.push(type)
      },
      removeEventListener(type: string) {
        removed.push(type)
      }
    }
    expect(() =>
      subscribeWorkerErrors(
        port,
        () => undefined,
        () => undefined
      )
    ).toThrow('messageerror listener failed')
    expect(added).toEqual(['error'])
    expect(removed).toEqual(['error'])
  })

  it('retains the final failure subscription when cleanup fails', async () => {
    /** Actual native cleanup executes once; old subscriber rollback/retry state is retired by BC3. */
    let removals = 0
    /** The exact original native failure must survive actual Worker close aggregation. */
    const primary = new Error('error listener removal failed')
    /** Each actual remover is attempted despite its sibling's failure. */
    const removed: string[] = []
    /** Native error callback removal fails without taking ownership of the borrowed Worker. */
    const port = {
      postMessage() {},
      addEventListener() {},
      removeEventListener(type: string) {
        removed.push(type)
        if (type !== 'error') return
        removals += 1
        if (removals === 1) throw primary
      }
    }
    /** Production Worker construction and SDK close are the only actual cleanup owners. */
    const carrier = createDedicatedWorkerCarrier(port, { report: () => undefined })
    /** Existing original Worker close aggregates even a single native removal failure. */
    const closing = carrier.close()
    /**
     * Observe the actual native aggregate without rebuilding its primary or child list in the
     * fixture.
     */
    const failure = await closing.catch((error) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors).toContain(primary)
    expect((failure as Error).cause).toBe(primary)
    expect(primary.message).toBe('error listener removal failed')
    expect(carrier.close()).toBe(closing)
    expect(removals).toBe(1)
    expect(removed).toEqual(['error', 'messageerror', 'message'])
  })
})

describe('service-worker native lifecycle', () => {
  it('uses separate send and receive owners with shared listener cleanup', async () => {
    /** The original receiving callback is independent from the native outgoing Client. */
    let inbound: ((event: MessageEvent<unknown>) => void) | undefined
    /** Native transfer uses only this original caller-owned Client. */
    const target = { id: 'client-1', postMessage: vi.fn() }
    /** Only the actual receiver owns native callback registration and release. */
    const receiver = {
      addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
        inbound = listener
      },
      removeEventListener: vi.fn()
    }
    /** Actual native receiver failures are isolated through SDK's original report port. */
    const listenerFailures: unknown[] = []
    /** Source and receiver are supplied directly to the one actual native owner. */
    const carrier = createServiceWorkerCarrier(
      { target, receiver },
      { report: (error) => listenerFailures.push(error) }
    )
    /** The first actual native delivery throws through the one current SDK receiver. */
    const first = carrier.subscribe({
      frame: () => {
        throw new Error('listener failed')
      },
      error: () => undefined,
      close: () => undefined
    })
    /** Same-id cross-realm source remains the original native Client selection. */
    const source = { id: 'client-1' }
    expect(() =>
      inbound?.({ data: 'inbound', origin: 'origin', source } as unknown as MessageEvent)
    ).not.toThrow()
    first()
    expect(receiver.removeEventListener).not.toHaveBeenCalled()
    /** Replacing SDK receiver never registers a second native event source. */
    const received: unknown[] = []
    carrier.subscribe({
      frame: (message) => received.push(message),
      error: () => undefined,
      close: () => undefined
    })
    /** The exact native backing remains the physical transfer object. */
    const transfer = new ArrayBuffer(1)
    /** Shared codec's canonical shell reaches native postMessage unchanged. */
    const frame = { kind: RpcCarrierFrameKind.message, data: 'outbound' } as const
    await carrier.write(frame, { transfer: [transfer] })
    inbound?.({ data: 'inbound', origin: 'origin', source } as unknown as MessageEvent)
    expect(target.postMessage).toHaveBeenCalledWith(frame, [transfer])
    expect(received).toEqual(['inbound'])
    expect(listenerFailures).toHaveLength(1)
    await carrier.close()
    expect(receiver.removeEventListener).toHaveBeenCalledOnce()
  })
})
