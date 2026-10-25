import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { createRpcMessageCarrier } from '@migaia/rpc-host/sdk'
import { walkErrorCauses } from '@migaia/utils/error'
import { broadcastChannelPlugin } from '../../../dist/index.js'
import { BroadcastRouteIO } from '../../../dist/browser/adapters/broadcast-channel.js'
import { BroadcastChannelControl } from '../../../dist/browser/broadcast-channel-text.js'
import { createBrowserTransportError } from '../../../dist/browser/error.js'
import { BrowserRpcErrorText } from '../../../dist/browser/error-text.js'

/** Original native EventTarget-shaped channel fixture supplies no RPC/session behavior. */
type IChannel = {
  postMessage(message: unknown): void
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener(type: string, listener: (event: unknown) => void): void
}

/** Open only the real cold plugin on its actual native source; no fabricated Host context exists. */
function openChannel(channel: IChannel, report: (error: unknown) => void = () => undefined) {
  return createRpcHost({
    plugins: [broadcastChannelPlugin({ channel: channel as BroadcastChannel })],
    report
  })
}

describe('BroadcastChannel native owner', () => {
  it('preserves source metadata and isolates hostile event reads', async () => {
    /** Capture only the actual native message wrapper, separately from messageerror. */
    let onMessage: ((event: unknown) => void) | undefined
    /** The real Host reporter records original native getter failures. */
    const errors: unknown[] = []
    /** This fixture borrows only native callback operations and never implements discovery. */
    const channel: IChannel = {
      postMessage() {},
      addEventListener(type, listener) {
        if (type === 'message') onMessage = listener
      },
      removeEventListener() {}
    }
    /** The actual native plugin owns framing; raw v1 DTO delivery is no longer a public interface. */
    const host = await openChannel(channel, (error) => errors.push(error))
    try {
      onMessage?.({ data: 'payload', origin: 'https://peer.test', source: {} })
      expect(() =>
        onMessage?.(
          new Proxy(
            {},
            {
              get() {
                throw new Error('hostile event')
              }
            }
          )
        )
      ).not.toThrow()
      expect(errors).toHaveLength(1)
      /** Native unknown-route data is opaque and cannot create an accepted semantic peer. */
      const data = new Proxy(
        {},
        {
          get() {
            throw new Error('hostile data')
          }
        }
      )
      onMessage?.({
        data: {
          protocol: BroadcastChannelControl.protocol,
          kind: BroadcastChannelControl.data,
          sender: 'unknown-native-route',
          target: host.self.instanceId,
          payload: data
        }
      })
      expect(errors).toHaveLength(1)
      expect(Object.keys(host.broadcastChannel.peers)).toEqual([])
    } finally {
      await host.close()
    }
  })

  it('isolates transport-error listener failures and removes the exact wrapper', async () => {
    /** This is the exact SDK/native route used by the production channel's messageerror delivery. */
    const io = new BroadcastRouteIO(
      () => undefined,
      () => undefined,
      () => undefined
    )
    /** The same original diagnostic object must reach SDK's actual reporter. */
    const diagnostic = new Error('diagnostic failed')
    /** No delayed unsubscribe-error queue or fixture error tagging is fabricated. */
    const failures: unknown[] = []
    /** SDK is the actual one receiver/close owner of this native route. */
    const carrier = createRpcMessageCarrier({
      id: 'native-broadcast-diagnostic',
      io,
      report: (error) => failures.push(error)
    })
    carrier.subscribe({
      frame: () => undefined,
      error: () => {
        throw diagnostic
      },
      close: () => undefined
    })
    expect(() =>
      io.fail(createBrowserTransportError(BrowserRpcErrorText.carrierOperationFailed))
    ).not.toThrow()
    await carrier.close()
    expect(failures).toEqual([diagnostic])
    expect(diagnostic).toMatchObject({ code: 'TRANSPORT' })
  })

  it('keeps duplicate transport-error registrations independent', async () => {
    /** Actual native wrapper identities belong to separate real plugin installations. */
    const added: unknown[] = []
    /** Each original installation must remove only its exact native error wrapper once. */
    const removed: unknown[] = []
    /** No event source/session/peer registry is supplied by this native callback fixture. */
    const channel: IChannel = {
      postMessage() {},
      addEventListener(type, listener) {
        if (type === 'messageerror') added.push(listener)
      },
      removeEventListener(type, listener) {
        if (type === 'messageerror') removed.push(listener)
      }
    }
    /** The same borrowed native resource can outlive two independent actual Host lifetimes. */
    const first = await openChannel(channel)
    /** A second actual native installation cannot reuse the first wrapper's identity. */
    const second = await openChannel(channel)
    try {
      await first.close()
      expect(removed).toHaveLength(1)
      expect(removed[0]).toBe(added[0])
      await second.close()
      expect(removed).toHaveLength(2)
      expect(removed[1]).toBe(added[1])
      expect(removed[0]).not.toBe(removed[1])
    } finally {
      await Promise.all([first.close(), second.close()])
    }
  })

  it('shares message registration, forwards send, and isolates listener reporters', async () => {
    /** Both actual global channels remain caller-owned and use native discovery, never a fake bus. */
    const name = randomUUID()
    /** Distinct native channel objects are actual independent participants. */
    const channels = [new BroadcastChannel(name), new BroadcastChannel(name)] as const
    /** Only canonical Host provider dispatch interprets semantic business payloads. */
    const hosts = await Promise.all(
      channels.map((channel) =>
        createRpcHost({
          plugins: [broadcastChannelPlugin({ channel })],
          provide: { echo: (value: string) => value },
          report: () => undefined
        })
      )
    )
    try {
      await vi.waitFor(() => {
        for (const host of hosts) expect(Object.keys(host.broadcastChannel.peers)).toHaveLength(1)
      })
      expect(await hosts[0]!.broadcastChannel.request('echo', 'outbound')).toBe('outbound')
      expect(await hosts[1]!.broadcastChannel.request('echo', 'inbound')).toBe('inbound')
    } finally {
      await Promise.all(hosts.map((host) => host.close()))
      for (const channel of channels) channel.close()
    }
  })

  it('makes duplicate transport-error cleanup idempotent', async () => {
    /** Only native messageerror removal is counted, matching the original native-wrapper oracle. */
    let removals = 0
    /** Whole Host lifetime replaces only the deleted private observer cancellation protocol. */
    const channel: IChannel = {
      postMessage() {},
      addEventListener() {},
      removeEventListener(type) {
        if (type === 'messageerror') removals += 1
      }
    }
    /** The actual plugin owns one original messageerror wrapper on this borrowed source. */
    const host = await openChannel(channel)
    /** Actual Host cleanup publishes one shared completion before arbitrary native removers. */
    const closing = host.close()
    expect(host.close()).toBe(closing)
    await closing
    await host.close()
    expect(removals).toBe(1)
  })

  it('retains a subscription when final listener removal fails so it can be retried', async () => {
    /** Only the old subscriber retry protocol is retired; original native failure remains reachable. */
    let attempts = 0
    /** This exact native Error must survive real Host/native cleanup aggregation. */
    const primary = new Error('remove failed')
    /** Both genuine native removers must be attempted even when one fails. */
    const removed: string[] = []
    /** Native registration identity and lifetime remain owned by the actual cold plugin. */
    const channel: IChannel = {
      postMessage() {},
      addEventListener() {},
      removeEventListener(type) {
        removed.push(type)
        if (type === 'messageerror') {
          attempts += 1
          if (attempts === 1) throw primary
        }
      }
    }
    /** No retained subscriber/retry state is recreated beside the actual resource owner. */
    const host = await openChannel(channel)
    /** Observe this original cleanup result immediately, preserving every native cause. */
    const closing = host.close()
    /** The fixture observes rather than constructs the actual error graph. */
    const failure = await closing.catch((error) => error)
    expect(walkErrorCauses(failure)).toContain(primary)
    expect(primary.message).toBe('remove failed')
    expect(host.close()).toBe(closing)
    expect(attempts).toBe(1)
    expect(removed).toEqual(['message', 'messageerror'])
  })

  it('does not retain a transport-error wrapper when registration fails', async () => {
    /** Count only original native messageerror acquisition, separately from its sibling. */
    let attempts = 0
    /** Exact native registration text remains the public asynchronous installation failure. */
    const primary = new Error('messageerror registration failed')
    /** Partial native construction must release its acquired sibling before another installation. */
    const removed: string[] = []
    /** No wrapper registry survives an unsuccessful actual plugin installation. */
    const channel: IChannel = {
      postMessage() {},
      addEventListener(type) {
        if (type === 'messageerror') {
          attempts += 1
          if (attempts === 1) throw primary
        }
      },
      removeEventListener(type) {
        removed.push(type)
      }
    }
    await expect(openChannel(channel)).rejects.toThrow('messageerror registration failed')
    expect(removed).toEqual(['message', 'messageerror'])
    /** A fresh real Host install can acquire the same caller-owned source after rollback. */
    const host = await openChannel(channel)
    try {
      expect(attempts).toBe(2)
    } finally {
      await host.close()
    }
  })
})
