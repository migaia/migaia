/** BC21 retires transient default names while preserving explicit-name departure diagnostics. */
import { createRpcHost } from '@migaia/rpc-host'
import { expect, it, vi, type MockInstance as IMockInstance } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'

/** Read only the trie structure observed at its real native Map writes. */
type IObservedPrefix = Readonly<{
  children: Map<string, IObservedPrefix>
  name?: string
}>

/** Recognize the root by following the fixed explicit fixture name through the observed trie. */
function containsPrefix(children: Map<string, IObservedPrefix>, name: string): boolean {
  /** Each step borrows the real node rather than building a copy of the routing table. */
  let node: IObservedPrefix | undefined
  for (const character of name) {
    node = children.get(character)
    if (!node) return false
    children = node.children
  }
  return node?.name === name
}

/** Observe native bookkeeping without exposing private production fields or changing Map behavior. */
function retirementMaps(set: IMockInstance, name: string) {
  /** The explicit departure identifies the namespace's retained-reason table. */
  let departed: Map<unknown, unknown> | undefined
  /** The explicit spelling identifies the forwarder's root among unrelated native Maps. */
  let prefix: Map<string, IObservedPrefix> | undefined
  for (let index = 0; index < set.mock.calls.length; index++) {
    /** Mock contexts are the actual Map receivers used by production. */
    const receiver = set.mock.contexts[index]
    if (!(receiver instanceof Map)) continue
    const [key, value] = set.mock.calls[index]!
    if (
      key === name &&
      value !== null &&
      typeof value === 'object' &&
      Object.hasOwn(value, 'carrierId') &&
      Object.hasOwn(value, 'reason')
    )
      departed = receiver
    if (
      key === name[0] &&
      value !== null &&
      typeof value === 'object' &&
      Reflect.get(value, 'children') instanceof Map &&
      Reflect.get(value, 'namespaces') instanceof Map &&
      containsPrefix(receiver, name)
    )
      prefix = receiver
  }
  return { departed, prefix }
}

/** Count only nodes still reachable from the real forwarder root after retirement. */
function prefixNodes(root: Map<string, IObservedPrefix>): number {
  /** This local traversal never mutates the observed routing state. */
  const remaining = [root]
  /** Each reachable character node contributes once. */
  let count = 0
  while (remaining.length)
    for (const node of remaining.pop()!.values()) {
      count++
      remaining.push(node.children)
    }
  return count
}

it('A34 releases default-name history after repeated public connection retirement', async () => {
  /** This listener and all clients use the existing public Host/native transport path. */
  const server = coreMemoryServer('retirement-host')
  /** The host stays alive while successive physical generations retire. */
  const host = await createRpcHost(server.options)
  /** Cleanup retains only the public clients acquired by this test. */
  const clients: Awaited<ReturnType<typeof server.connect>>[] = []
  /** Pass-through spying records real native writes; it does not replace any Map operation. */
  const set = vi.spyOn(Map.prototype, 'set')
  try {
    /** A name distinct from instanceId is the persistent explicit-name control. */
    const named = await server.connect('stable-name', { provide: { value: () => 42 } }, 'stable-id')
    clients.push(named)
    await server.lookup('stable-name')!.handle.close('explicit departure')
    await named.host.close()
    /** The same retained error must survive unrelated transient peer departures. */
    const namedFailure = await host.memory.send('stable-name', 'value').catch((error) => error)
    expect(namedFailure).toBe('explicit departure')
    /** The witness is the actual departure table and trie root identified by the explicit control. */
    const observed = retirementMaps(set, 'stable-name')
    expect(observed.departed).toBeInstanceOf(Map)
    expect(observed.prefix).toBeInstanceOf(Map)
    /** These baselines include only the intentionally retained explicit spelling. */
    const departedBefore = observed.departed!.size
    /** Repeated defaults must not add reachable trie nodes beyond this persistent baseline. */
    const prefixBefore = prefixNodes(observed.prefix!)
    /** Public selection errors are collected until after all real retirement cycles finish. */
    const defaultFailures: unknown[] = []
    // The three cycles are fixed fixture inputs, independent of runtime peer or request counts.
    for (const name of ['default-0', 'default-1', 'default-2']) {
      /** Equality with instanceId is the default-name form defined by BC21. */
      const client = await server.connect(name, { provide: { value: () => 42 } })
      clients.push(client)
      await server.lookup(name)!.handle.close('default departure')
      await client.host.close()
      defaultFailures.push(await host.memory.send(name, 'value').catch((error) => error))
    }
    set.mockRestore()
    expect(observed.departed!.size).toBe(departedBefore)
    expect(prefixNodes(observed.prefix!)).toBe(prefixBefore)
    for (const error of defaultFailures) expect(error).toMatchObject({ code: 'TARGET_UNKNOWN' })
    await expect(host.memory.send('stable-name', 'value')).rejects.toBe(namedFailure)
  } finally {
    set.mockRestore()
    await Promise.all([...clients.map((client) => client.host.close()), host.close()])
  }
})
