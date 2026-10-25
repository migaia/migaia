import { describe, expect, it } from 'vitest'
import { createWindowCarrier } from '../../../dist/browser/adapters/window.js'
import { RpcCarrierFrameKind } from '@migaia/rpc-contract/protocol'

describe('window adapter source proof', () => {
  it('accepts only the configured endpoint and origin', async () => {
    /** Only this actual native target is allowed to supply incoming frames. */
    const target = { postMessage() {} }
    /** The receiving native callback is observed directly, without invoking a sourceProof facade. */
    let inbound: ((event: MessageEvent<unknown>) => void) | undefined
    /** Incoming registration belongs to the distinct local realm. */
    const receiver = {
      addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
        inbound = listener
      },
      removeEventListener() {}
    }
    /** Only native source-admitted data may reach SDK's actual receiver. */
    const received: unknown[] = []
    /** This is the production Window carrier and its actual native source filter. */
    const carrier = createWindowCarrier(
      { target, receiver, targetOrigin: 'https://peer.test' },
      { report: () => undefined }
    )
    carrier.subscribe({
      frame: (frame) => received.push(frame),
      error: () => undefined,
      close: () => undefined
    })
    inbound?.({
      data: 'accepted',
      source: target,
      origin: 'https://peer.test'
    } as unknown as MessageEvent)
    inbound?.({ data: 'wrong-source', source: {}, origin: 'https://peer.test' } as MessageEvent)
    inbound?.({
      data: 'wrong-origin',
      source: target,
      origin: 'https://spoof.test'
    } as unknown as MessageEvent)
    expect(received).toEqual(['accepted'])
    await carrier.close()
  })

  it('accepts the configured endpoint with wildcard origin but never another source', async () => {
    /** Wildcard delivery relaxes origin only, never the original native Window identity. */
    const target = { postMessage() {} }
    /** Native callback acquisition stays local to this borrowed receiving realm. */
    let inbound: ((event: MessageEvent<unknown>) => void) | undefined
    /** No physical Window close operation exists on either borrowed object. */
    const receiver = {
      addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
        inbound = listener
      },
      removeEventListener() {}
    }
    /** Native source delivery, rather than a boolean adapter method, proves admission. */
    const received: unknown[] = []
    /** The real carrier retains the original explicit unsafe opt-in. */
    const carrier = createWindowCarrier(
      { target, receiver, targetOrigin: '*', allowUnsafeTargetOrigin: true },
      { report: () => undefined }
    )
    carrier.subscribe({
      frame: (frame) => received.push(frame),
      error: () => undefined,
      close: () => undefined
    })
    inbound?.({
      data: 'accepted',
      source: target,
      origin: 'https://any.test'
    } as unknown as MessageEvent)
    inbound?.({ data: 'wrong-source', source: {}, origin: 'https://any.test' } as MessageEvent)
    expect(received).toEqual(['accepted'])
    await carrier.close()
  })

  it('registers inbound listeners on the receiver rather than the outbound target', async () => {
    /** Original native registration and removal order remains the lifecycle oracle. */
    const registrations: string[] = []
    /** Native sending does not acquire the receiving subscription. */
    const target = { postMessage() {} }
    /** The actual local receiving realm owns both exact callback operations. */
    const receiver = {
      addEventListener(type: string) {
        registrations.push(`add:${type}`)
      },
      removeEventListener(type: string) {
        registrations.push(`remove:${type}`)
      }
    }
    /** SDK owns the one acquired listener; its real close replaces retired adapter unsubscribe. */
    const carrier = createWindowCarrier(
      { target, receiver, targetOrigin: 'https://peer.test' },
      { report: () => undefined }
    )
    await carrier.close()
    expect(registrations).toEqual(['add:message', 'remove:message'])
  })

  it('forwards transfer and inbound metadata while isolating listener failures', async () => {
    /** The native callback is retained only to drive this actual physical receive boundary. */
    let inbound: ((event: MessageEvent<unknown>) => void) | undefined
    /** These original native arguments expose exact transfer and destination origin choices. */
    const sent: unknown[][] = []
    /** Only the target performs physical postMessage handoff. */
    const target = {
      postMessage(...args: unknown[]) {
        sent.push(args)
      }
    }
    /** Local event registration stays distinct from that outgoing Window. */
    const receiver = {
      addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
        inbound = listener
      },
      removeEventListener() {}
    }
    /** SDK reporting observes the exact failure thrown by its single actual receiver. */
    const failures: unknown[] = []
    /** The real native Window carrier remains the only physical IO owner. */
    const carrier = createWindowCarrier(
      { target, receiver, targetOrigin: 'https://peer.test' },
      { report: (error) => failures.push(error) }
    )
    carrier.subscribe({
      frame: () => {
        throw new Error('listener failed')
      },
      error: () => undefined,
      close: () => undefined
    })
    /** The native transfer list is the exact original backing list, without copying or remapping. */
    const transfer = new ArrayBuffer(1)
    /** New profile framing is supplied by the actual media contract; its payload remains unchanged. */
    const frame = { kind: RpcCarrierFrameKind.message, data: 'outbound' } as const
    await carrier.write(frame, { transfer: [transfer] })
    expect(() =>
      inbound?.({
        data: 'inbound',
        origin: 'https://peer.test',
        source: target
      } as unknown as MessageEvent)
    ).not.toThrow()
    expect(sent).toEqual([[frame, 'https://peer.test', [transfer]]])
    expect(failures).toHaveLength(1)
    await carrier.close()
  })

  it('rejects empty target origins and reports hostile inbound getters', async () => {
    /** Original target/origin validation precedes any codec or native subscription. */
    const target = { postMessage() {} }
    /** The exact native callback is invoked with an admitted source and a hostile payload getter. */
    let inbound: ((event: MessageEvent<unknown>) => void) | undefined
    /** Local receiver admission remains separate from outgoing source identity. */
    const receiver = {
      addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
        inbound = listener
      },
      removeEventListener() {}
    }
    expect(() =>
      createWindowCarrier({ target, receiver, targetOrigin: '' }, { report: () => undefined })
    ).toThrow('targetOrigin')
    expect(() =>
      createWindowCarrier({ target, receiver, targetOrigin: '*' }, { report: () => undefined })
    ).toThrow('allowUnsafeTargetOrigin')
    /** One actual physical error must reach the original SDK receiver without a data frame. */
    const failures: unknown[] = []
    /** Wildcard only relaxes origin; the original target is still supplied by the native event. */
    const carrier = createWindowCarrier(
      { target, receiver, targetOrigin: '*', allowUnsafeTargetOrigin: true },
      { report: () => undefined }
    )
    carrier.subscribe({
      frame: () => undefined,
      error: (error) => failures.push(error),
      close: () => undefined
    })
    inbound?.({
      source: target,
      get data(): never {
        throw new Error('hostile data')
      }
    } as unknown as MessageEvent)
    expect(failures).toHaveLength(1)
    await carrier.close()
  })
})
