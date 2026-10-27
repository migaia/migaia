/** Original hostile cold subscriptions reach the installed native probe and real RPC traffic. */
import { createRpcHost } from '@migaia/rpc-host'
import {
  defineProbe,
  probe,
  readProbeStages,
  subscribeProbeStages
} from '@migaia/rpc-host/plugins/probe'
import { expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

// Retain the same original handle and early failing subscription.
it('rebuilds the native installed probe after an earlier stage listener throws', async () => {
  /** Only actual message observations increment the original before/after traffic count. */
  let events = 0
  /** The exact native callback failure must receive classification without replacement. */
  const original = new Error('audit cold stage listener failed')
  /** Native setup receives this same genuine handle after the earlier cold subscription. */
  const observer = defineProbe({
    stages: ['message'],
    emit() {
      events++
    }
  })
  /** Registration precedes the real emitter installed by the actual Host probe plugin. */
  const off = subscribeProbeStages(observer, () => {
    throw original
  })
  /** The original existing native fixture owns both physical endpoints and bilateral admission. */
  const listener = coreMemoryServer('probe-server')
  /** A real public provider echoes each original value through the normal dispatch pipeline. */
  const server = await createRpcHost({
    ...listener.options,
    provide: { echo: (value) => value }
  })
  /** Construction failure still releases the already installed server and cold listener. */
  let client: Awaited<ReturnType<typeof listener.connect>> | undefined
  try {
    client = await listener.connect('probe-client', { plugins: [probe(observer)] })
    /** A real successful request calibrates the installed emitter before pausing its mask. */
    expect(await client.host.memory.send('probe-server', 'echo', 'before')).toBe('before')
    expect(events).toBeGreaterThan(0)
    expect(() => observer.setStages([])).toThrow(original)
    expect(original).toMatchObject({ source: 'rpc.endpoint', code: 'CALLBACK_FAILED' })
    expect(readProbeStages(observer)).toBe(0)
    /** No reset can discard startup traffic or manufacture equal independent counters. */
    const before = events
    expect(await client.host.memory.send('probe-server', 'echo', 'after')).toBe('after')
    expect(events).toBe(before)
  } finally {
    off()
    await Promise.all([client?.host.close(), server.close()])
  }
})
