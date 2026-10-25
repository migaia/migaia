/** The public C2 oracles use actual native SDK installation and semantic carrier exchange. */
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { defineFlowPlugin, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcAttempt, IRpcTimeoutFeature } from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'

/** A supplied complete instance actually executes the originating attempt through its public port. */
class CountedTimeout implements IRpcTimeoutFeature {
  /** A real complete call instance declares exactly its existing feature kind. */
  readonly kind = 'timeout'
  /** Invocation count distinguishes supplied execution from inherited/default behavior. */
  runs = 0

  /** This fixture adds no timer; it proves host selection by executing the actual attempt once. */
  run<T>(attempt: IRpcAttempt<T>): Promise<T> {
    this.runs++
    return attempt.invoke(attempt.signal, attempt.remainingMs)
  }
}

it('context dispatchTo keeps explicit targeting and excludes its original sender from default peers', async () => {
  /** One real namespace fixes peer registration order before the provider originates notifications. */
  const server = coreMemoryServer('gateway')
  /** Notifications are actual business deliveries rather than inspected internal pending state. */
  const callerReceive = vi.fn(),
    secondReceive = vi.fn(),
    thirdReceive = vi.fn()
  /** The existing provider context starts both original fire-and-forget dispatch forms. */
  const host = await createRpcHost({
    ...server.options,
    provide: {
      dispatch: (_value, context) => {
        context.dispatchTo({ id: 'third-id', method: 'receive', data: 'targeted' })
        context.dispatchTo({ method: 'receive', data: 'broadcast' })
        return context.success('queued')
      }
    }
  })
  /** The caller is a normal accepted peer and must not receive its own default dispatch. */
  const caller = await server.connect(
    'caller',
    { provide: { receive: callerReceive } },
    'caller-id'
  )
  /** Both other accepted peers remain eligible in this same namespace. */
  const second = await server.connect(
    'second',
    { provide: { receive: secondReceive } },
    'second-id'
  )
  /** An explicit instance address remains distinct from its display name. */
  const third = await server.connect('third', { provide: { receive: thirdReceive } }, 'third-id')
  try {
    expect(await caller.host.memory.send('gateway', 'dispatch')).toBe('queued')
    await vi.waitFor(() => {
      expect(secondReceive).toHaveBeenCalledTimes(1)
      expect(thirdReceive).toHaveBeenCalledTimes(2)
    })
    expect(callerReceive).toHaveBeenCalledTimes(0)
    expect(secondReceive.mock.calls.map(([value]) => value)).toEqual(['broadcast'])
    expect(thirdReceive.mock.calls.map(([value]) => value)).toEqual(['targeted', 'broadcast'])
  } finally {
    await Promise.all([caller.host.close(), second.host.close(), third.host.close(), host.close()])
  }
})

it('BC1 isolates same-named peers under two namespaces and keeps all RPC calls below the root', async () => {
  /** The one actual host owns two distinct transport namespaces with one global identity. */
  const process = coreMemoryServer('gateway', 'gateway', 'process')
  /** The other transport contributes no second host or root call facade. */
  const thread = coreMemoryServer('gateway', 'gateway', 'thread')
  /** Real providers let namespace isolation be observed through business results and call counts. */
  const processEcho = vi.fn(() => 'process'),
    threadEcho = vi.fn(() => 'thread')
  /** Both native definitions install on the same public host. */
  const host = await createRpcHost({
    self: { name: 'gateway', instanceId: 'gateway' },
    plugins: [process.transport, thread.transport],
    report: () => undefined
  })
  /** Equal display names are valid because the actual accepted source namespaces differ. */
  const first = await process.connect(
    'worker',
    { provide: { echo: processEcho } },
    'process-worker'
  )
  /** The second name must never overwrite the first namespace's capability or target. */
  const second = await thread.connect('worker', { provide: { echo: threadEcho } }, 'thread-worker')
  try {
    expect('send' in host).toBe(false)
    expect('request' in host).toBe(false)
    expect('notify' in host).toBe(false)
    expect('stream' in host).toBe(false)
    expect(await host.process.send('worker', 'echo')).toBe('process')
    expect(await host.thread.send('worker', 'echo')).toBe('thread')
    await host.process.close()
    await expect(host.process.send('worker', 'echo')).rejects.toMatchObject({
      code: RpcCoreErrorCode.endpointDisposed
    })
    expect(await host.thread.send('worker', 'echo')).toBe('thread')
    expect(processEcho).toHaveBeenCalledTimes(1)
    expect(threadEcho).toHaveBeenCalledTimes(2)
  } finally {
    await Promise.all([first.host.close(), second.host.close(), host.close()])
  }
})

it('BC1 rejects absent or duplicate transport namespaces before any native open', () => {
  /** Cold rejection must happen before the genuine SDK transport may acquire resources. */
  const open = vi.fn(() => ({ dispose: () => undefined }))
  /** Independent real definitions intentionally claim the same host-local namespace. */
  const first = defineTransportPlugin({ name: 'first', namespace: 'same', open })
  /** Plugin identity differs, so namespace uniqueness itself owns this rejection. */
  const second = defineTransportPlugin({ name: 'second', namespace: 'same', open })
  /** A genuine flow alone cannot provide a native source, just as the retired feature could not. */
  const flow = defineFlowPlugin({ name: 'flow-only', setup: () => ({ stages: {} }) })
  expect(() => createRpcHost({ plugins: [] })).toThrow(
    expect.objectContaining({
      name: 'TypeError',
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.hostTransportMissing
    })
  )
  expect(() => createRpcHost({ plugins: [first, second] })).toThrow(
    expect.objectContaining({
      name: 'TypeError',
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.hostNamespaceDuplicate
    })
  )
  expect(() => createRpcHost({ plugins: [flow] })).toThrow(
    expect.objectContaining({
      name: 'TypeError',
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.hostTransportMissing
    })
  )
  for (const forged of [Object.freeze({ ...first }), Object.create(first), {}])
    expect(() => createRpcHost({ plugins: [forged] as never })).toThrow(
      expect.objectContaining({
        name: 'TypeError',
        source: 'rpc.endpoint',
        code: RpcCoreErrorCode.hostPluginInvalid
      })
    )
  expect(open).toHaveBeenCalledTimes(0)
})

it('A5 forwards one real call across process and thread namespaces with the original hop route', async () => {
  /** The gateway is the only host bridging these two different logical carrier namespaces. */
  const process = coreMemoryServer('gateway', 'gateway', 'process')
  /** Both media still use the same sole protocol grammar, through independent actual carriers. */
  const thread = coreMemoryServer('gateway', 'gateway', 'thread')
  /** Only actual provider execution can append an observed route. */
  const routes: (readonly string[] | undefined)[] = []
  /** Actual entry count proves forwarding did not duplicate business work. */
  const echo = vi.fn((value: unknown, context: IRpcContext) => {
    routes.push(context.route)
    return value
  })
  /** The gateway's global identity and provider registry are shared by both transport installs. */
  const gateway = await createRpcHost({
    self: { name: 'gateway', instanceId: 'gateway' },
    plugins: [process.transport, thread.transport],
    report: () => undefined
  })
  /** The thread peer is genuinely accepted before its method becomes a forwarding target. */
  const worker = await thread.connect('worker', { provide: { echo } })
  /** The origin has no direct physical connection to the destination worker. */
  const caller = await process.connect('caller')
  try {
    expect(await caller.host.process.send('gateway', 'worker.echo', { answer: 42 })).toEqual({
      answer: 42
    })
    expect(echo).toHaveBeenCalledTimes(1)
    expect(routes).toHaveLength(1)
    expect(routes[0]).toHaveLength(2)
    expect(routes[0]?.every((node) => /^[0-9a-f]{32}$/u.test(node))).toBe(true)
    expect(worker.pair[0].written.filter((frame) => frame.kind === 'call')).toHaveLength(1)
    expect(caller.pair[1].written.filter((frame) => frame.kind === 'call')).toHaveLength(1)
  } finally {
    await Promise.all([caller.host.close(), worker.host.close(), gateway.close()])
  }
})

it('A8 executes a supplied complete feature, honors false and rejects numeric policy syntax', async () => {
  /** The installed complete timeout instance is the actual inherited fallback. */
  const inherited = new CountedTimeout()
  /** A supplied instance must execute instead of the inherited one. */
  const supplied = new CountedTimeout()
  /** Transport installation owns the original complete fallback instance. */
  const server = coreMemoryServer('origin', 'origin', 'memory', [inherited])
  /** The actual remote provider records business execution independently of policy selection. */
  const echo = vi.fn((value: unknown) => value)
  /** One native host owns the originating call table and selected instance resolution. */
  const host = await createRpcHost(server.options)
  /** This real peer exposes only one method through its accepted directory. */
  const client = await server.connect('provider', { provide: { echo } })
  try {
    expect(await host.memory.send('provider', 'echo', 0)).toBe(0)
    expect(inherited.runs).toBe(1)
    expect(await host.memory.send('provider', 'echo', 1, { timeout: false, retry: false })).toBe(1)
    expect(inherited.runs).toBe(1)
    expect(await host.memory.send('provider', 'echo', 2, { timeout: supplied })).toBe(2)
    expect(supplied.runs).toBe(1)
    expect(inherited.runs).toBe(1)
    // @ts-expect-error Complete instances or false are the only public call policy syntax.
    await expect(host.memory.send('provider', 'echo', 3, { timeout: 5 })).rejects.toMatchObject({
      name: 'TypeError',
      code: RpcCoreErrorCode.invalidConfig
    })
    expect(echo).toHaveBeenCalledTimes(3)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})

it('publishes a ready provider registration through the actual session directory frame', async () => {
  /** The origin first accepts a directory that has no late method. */
  const server = coreMemoryServer('origin')
  /** Exactly one real call after the announcement may reach this method. */
  const late = vi.fn((value: unknown) => value)
  /** This host has already completed its transport installation before the new registration. */
  const host = await createRpcHost(server.options)
  /** A real initial provider makes the accepted method set observably different from its update. */
  const client = await server.connect('provider', { provide: { first: () => 'first' } })
  try {
    expect(await host.memory.send('provider', 'first')).toBe('first')
    client.host.provide({ late })
    await vi.waitFor(() => expect(Object.hasOwn(host.memory.peers.provider!, 'late')).toBe(true))
    expect(await host.memory.send('provider', 'late', 42)).toBe(42)
    expect(late).toHaveBeenCalledTimes(1)
    expect(client.pair[1].written.some((frame) => frame.kind === 'directory')).toBe(true)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})
