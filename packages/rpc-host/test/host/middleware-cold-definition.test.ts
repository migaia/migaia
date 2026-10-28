/** Cold SDK definitions retain the actual native carrier without acquiring its Session IO. */
import { defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { expect, it, vi } from 'vitest'
import { MemoryCarrier } from '../fixtures/core-carrier.ts'

/** The original source has no separate listener resource beyond its eventual Session attachment. */
function releaseSource(): void {}

it('C015 keeps a real native carrier untouched while its SDK definition is cold', async () => {
  /** This same original endpoint is captured by the genuine SDK acquisition callback below. */
  const carrier = new MemoryCarrier('cold-definition-carrier')
  /** Observe original native entry points rather than a peer count or replacement port. */
  const subscribed = vi.spyOn(carrier, 'subscribe')
  /** A cold definition must not send handshake or business frames through its real source. */
  const written = vi.spyOn(carrier, 'write')
  try {
    defineTransportPlugin({
      name: 'cold-definition-transport',
      namespace: 'memory',
      async open(context) {
        /** Only an actual native install could attach this carrier and own its readiness. */
        const handle = context.attach(carrier)
        await handle.ready
        return { dispose: releaseSource }
      }
    })
    expect(subscribed.mock.calls.length).toBe(0)
    expect(written.mock.calls.length).toBe(0)
  } finally {
    subscribed.mockRestore()
    written.mockRestore()
    await carrier.close()
  }
})
