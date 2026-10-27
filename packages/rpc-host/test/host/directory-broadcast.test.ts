/** Shares directory preparation without changing split-horizon publication or deduplication. */
import { createRpcHost, type IRpcNamespace } from '@migaia/rpc-host'
import { expect, it, vi } from 'vitest'
import { Forwarder } from '../../dist/forward/forwarder.js'
import { coreMemoryServer } from './core-fixture.js'

/** Existing physical clients expose only their public host and actual carrier pair. */
type IDirectoryClient = Awaited<ReturnType<ReturnType<typeof coreMemoryServer>['connect']>>

/** Every fixture uses one stable public server address for real ordering barriers. */
const hostName = 'directory-hub'

/** Read the existing public namespace without inventing a business facade. */
function namespace(client: IDirectoryClient, name = 'memory'): IRpcNamespace {
  return Reflect.get(client.host, name) as IRpcNamespace
}

/** A real round trip joins earlier writes on the same physical connection. */
async function barrier(client: IDirectoryClient, name = 'memory'): Promise<void> {
  await namespace(client, name).send(hostName, 'barrier')
}

it('prepares one directory and fingerprint per namespace for a public broadcast', async () => {
  /** Two installed namespaces each have two accepted physical clients. */
  const memory = coreMemoryServer(hostName)
  /** This namespace shares the same root providers while keeping its own direct membership. */
  const other = coreMemoryServer(hostName, hostName, 'other')
  /** All preparation is reached through public provider publication. */
  const host = await createRpcHost({
    ...memory.options,
    plugins: [memory.transport, other.transport],
    provide: { barrier: () => true }
  })
  /** Cleanup retains only clients acquired through the existing transport fixture. */
  const clients: Readonly<{ client: IDirectoryClient; scope: string }>[] = []
  /** Spies call the original projection and JSON implementation unchanged. */
  const directory = vi.spyOn(Forwarder.prototype, 'directory')
  /** Whole-directory fingerprint work must not repeat for each receiver. */
  const stringify = vi.spyOn(JSON, 'stringify')
  try {
    clients.push({ client: await memory.connect('one'), scope: 'memory' })
    clients.push({ client: await memory.connect('two'), scope: 'memory' })
    clients.push({ client: await other.connect('three'), scope: 'other' })
    clients.push({ client: await other.connect('four'), scope: 'other' })
    for (const { client, scope } of clients) await barrier(client, scope)
    directory.mockClear()
    stringify.mockClear()
    host.provide({ published: () => 42 })
    await vi.waitFor(() => {
      for (const { client, scope } of clients)
        expect(namespace(client, scope).peers[hostName]).toHaveProperty('published')
    })
    /** Inspect arguments only; serialization and real physical writes remain production-owned. */
    const fingerprints = stringify.mock.calls.filter(
      ([value]) =>
        value !== null &&
        typeof value === 'object' &&
        Reflect.get(value, 'schemaVersion') === 3 &&
        Array.isArray(Reflect.get(value, 'methods'))
    ).length
    expect(directory).toHaveBeenCalledTimes(2)
    expect(fingerprints).toBe(2)
  } finally {
    directory.mockRestore()
    stringify.mockRestore()
    await Promise.all([...clients.map(({ client }) => client.host.close()), host.close()])
  }
})

it('skips a receiver own contribution and an unchanged public directory broadcast', async () => {
  /** Two aliases of one peer identity exercise exclusion across distinct namespace connections. */
  const memory = coreMemoryServer(hostName)
  /** A change on the first carrier must not produce an identical directory on the second. */
  const other = coreMemoryServer(hostName, hostName, 'other')
  /** An ordinary provider addition causes the production directory broadcast. */
  const host = await createRpcHost({
    ...memory.options,
    plugins: [memory.transport, other.transport],
    provide: { barrier: () => true }
  })
  /** All original clients remain available to cleanup after any assertion failure. */
  const clients: IDirectoryClient[] = []
  try {
    /** The same peer identity is accepted independently in these two namespaces. */
    const sender = await memory.connect('alias-a', {}, 'same-peer')
    clients.push(sender)
    /** Its alias receives no forwarding contribution from either copy of itself. */
    const receiver = await other.connect('alias-b', {}, 'same-peer')
    clients.push(receiver)
    /** An unrelated peer witnesses that the same change really is published. */
    const observer = await memory.connect('observer')
    clients.push(observer)
    await barrier(sender)
    await barrier(receiver, 'other')
    await barrier(observer)
    /** Count actual server-to-receiver directory frames before the sender changes its own methods. */
    const before = receiver.pair[0].written.filter((frame) => frame.kind === 'directory').length
    sender.host.provide({ ownAddition: () => true })
    await barrier(sender)
    await vi.waitFor(() =>
      expect(namespace(observer).peers[hostName]).toHaveProperty('alias-a.ownAddition')
    )
    await barrier(receiver, 'other')
    expect(receiver.pair[0].written.filter((frame) => frame.kind === 'directory')).toHaveLength(
      before
    )
    expect(namespace(receiver, 'other').peers[hostName]).not.toHaveProperty('alias-a.ownAddition')
    host.provide({})
    await barrier(observer)
    await barrier(receiver, 'other')
    expect(receiver.pair[0].written.filter((frame) => frame.kind === 'directory')).toHaveLength(
      before
    )
  } finally {
    await Promise.all([...clients.map((client) => client.host.close()), host.close()])
  }
})

it('preserves prefix-collision fallback when excluding each receiver own contribution', async () => {
  /** These two names can contribute the same full advertised method through different prefixes. */
  const server = coreMemoryServer(hostName)
  /** A public publication pulse forces fresh directories after both sources are accepted. */
  const host = await createRpcHost({ ...server.options, provide: { barrier: () => true } })
  /** Cleanup owns only the actual connected clients. */
  const clients: IDirectoryClient[] = []
  try {
    /** This contribution includes the single-segment forwarding hint. */
    const shorter = await server.connect('a', { provide: { b: { c: () => 1 } } }, 'shorter-id')
    clients.push(shorter)
    /** A dotted peer name contributes no single-segment hint. */
    const longer = await server.connect('a.b', { provide: { c: () => 2 } }, 'longer-id')
    clients.push(longer)
    host.provide({ pulse: () => true })
    await barrier(shorter)
    await barrier(longer)
    /** The real physical output preserves the source selected after split-horizon exclusion. */
    const shorterFrame = shorter.pair[0].written
      .filter((frame) => frame.kind === 'directory')
      .at(-1)
    /** The opposite receiver must select the alternate contribution in the same original order. */
    const longerFrame = longer.pair[0].written.filter((frame) => frame.kind === 'directory').at(-1)
    expect(shorterFrame?.directory.methods.filter((method) => method.name === 'a.b.c')).toEqual([
      expect.not.objectContaining({ forwardedVia: expect.anything() })
    ])
    expect(longerFrame?.directory.methods.filter((method) => method.name === 'a.b.c')).toEqual([
      expect.objectContaining({ forwardedVia: 'a' })
    ])
  } finally {
    await Promise.all([...clients.map((client) => client.host.close()), host.close()])
  }
})
