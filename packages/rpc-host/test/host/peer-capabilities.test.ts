/** Public peer projections retain callable prefixes and reject external table mutation. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { coreMemoryServer } from './core-fixture.js'

it.each([false, true])(
  'keeps callable a and a.b in either directory order (scalar first=%s)',
  async (scalarFirst) => {
    /** The first accepted peer lends a genuine held callable with native forwarding provenance. */
    const server = coreMemoryServer('capability-hub')
    /** The relay publishes its held route before a separate caller snapshots the directory. */
    const hub = await createRpcHost(server.options)
    /** A real leaf provider supplies the nested route's business result. */
    const leaf = await server.connect('capability-leaf', { provide: { value: () => 'nested' } })
    /** Every successfully acquired public caller enters cleanup. */
    let caller: Awaited<ReturnType<typeof server.connect>> | undefined
    try {
      /** Only canonical held functions may be provided under an already flattened method key. */
      const nested = hub.memory.peers['capability-leaf']!.value!
      /** Separate scalar and nested callables deliberately share the accepted path prefix. */
      const scalar = () => 'scalar'
      hub.provide(scalarFirst ? { a: scalar, 'a.b': nested } : { 'a.b': nested, a: scalar })
      caller = await server.connect('capability-caller')
      /** Static refinement describes the two actual accepted methods without replacing either. */
      const capability = caller.host.memory.peers['capability-hub']! as unknown as {
        a: (() => Promise<unknown>) & { b: () => Promise<unknown> }
      }
      expect(await capability.a()).toBe('scalar')
      expect(await capability.a.b()).toBe('nested')
    } finally {
      await caller?.host.close()
      await leaf.host.close()
      await hub.close()
    }
  }
)

it('keeps the public peer dictionary and its accepted capability groups readonly', async () => {
  /** Namespace publication is driven by the actual native listener and accepted directory. */
  const server = coreMemoryServer('readonly-hub')
  /** The original host remains the sole owner allowed to publish or retire peer entries. */
  const hub = await createRpcHost(server.options)
  /** A nested business group proves public mutation cannot replace its live held route. */
  const peer = await server.connect('readonly-peer', { provide: { group: { value: () => 42 } } })
  try {
    /** Both references come from the original public namespace rather than a copied fixture table. */
    const peers = hub.memory.peers
    const capability = peers['readonly-peer']!
    const group = capability.group! as unknown as { value: () => Promise<unknown> }
    expect(Reflect.set(peers, 'readonly-peer', {})).toBe(false)
    expect(Reflect.deleteProperty(peers, 'readonly-peer')).toBe(false)
    expect(Reflect.set(group, 'value', () => -1)).toBe(false)
    expect(peers['readonly-peer']).toBe(capability)
    expect(await group.value()).toBe(42)
    await peer.host.close()
    expect(peers['readonly-peer']).toBeUndefined()
  } finally {
    await peer.host.close()
    await hub.close()
  }
})
