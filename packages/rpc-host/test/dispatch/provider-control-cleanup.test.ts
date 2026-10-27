/** Original factory disposal keeps its RPC Root boundary and two native-owned cleanup leaves. */
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin, RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { chunk } from '@migaia/rpc-host/plugins/chunk'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { expect, it } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.js'

/** This source owns only its registered cleanup resource, with no separate listener to release. */
function releaseSource(): void {}

/** Each actual registration acquires its own original resource without an endpoint facade. */
function cleanupTransport(name: string, release: () => void) {
  return defineTransportPlugin({
    name,
    namespace: name,
    open(context) {
      context.owner.onDispose(release)
      return { dispose: releaseSource }
    }
  })
}

/** The original release records ordering before throwing its exact native failure. */
function rejectedRelease(order: string[], name: string, error: Error): () => never {
  return () => {
    order.push(name)
    throw error
  }
}

it('factory Root close preserves two acquired cleanup errors and reverse release order', async () => {
  /** These two original acquired resources retain separate registration ownership. */
  const cleanupOrder: string[] = []
  /** The earlier registration releases after the later registration. */
  const firstCleanup = new Error('round-seventeen-first-control-cleanup')
  /** The original primary cleanup identity must remain the public lifecycle cause. */
  const secondCleanup = new Error('round-seventeen-second-control-cleanup')
  /** Genuine cold SDK definitions join one actual RPC Root and its native Host. */
  const endpoint = await createRpcHost({
    self: {
      name: 'round-seventeen-control-cleanup',
      instanceId: 'round-seventeen-control-cleanup'
    },
    report: () => undefined,
    plugins: [
      cleanupTransport('first', rejectedRelease(cleanupOrder, 'first', firstCleanup)),
      cleanupTransport('second', rejectedRelease(cleanupOrder, 'second', secondCleanup))
    ]
  })
  /** Changes only the factory disposal spelling to the public Root.close owner. */
  const endpointDispose = endpoint.close()
  expect(endpoint.close()).toBe(endpointDispose)
  /** Observe the same public completion without translating or manufacturing cleanup errors. */
  const failure: unknown = await endpointDispose.catch((error: unknown) => error)
  expect(failure).toMatchObject({
    name: 'RpcLifecycleError',
    source: 'rpc.endpoint',
    code: RpcCoreErrorCode.endpointDisposed
  })
  /** Each disposer failure keeps its original native leaf on cause, in release order. */
  const aggregate = (failure as { readonly cause?: unknown }).cause
  expect(aggregate).toBeInstanceOf(AggregateError)
  expect(
    (aggregate as AggregateError).errors.map((error: { readonly cause?: unknown }) => error.cause)
  ).toEqual([secondCleanup, firstCleanup])
  expect((aggregate as AggregateError).errors[0].cause).toBe(secondCleanup)
  expect((aggregate as AggregateError).errors[1].cause).toBe(firstCleanup)
  expect(cleanupOrder).toEqual(['second', 'first'])
  expect(endpoint.close()).toBe(endpointDispose)
})

it('sends the original non-empty Unicode payload through the actual chunk provider path', async () => {
  /** Both real endpoints borrow the canonical JSON codec and four-unit chunk plugin. */
  const server = coreMemoryServer('r73-chunk-server', 'r73-chunk-server', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** The original provider returns its actual application input through the public boundary. */
  const endpoint = await createRpcHost({
    ...server.options,
    plugins: [chunk({ chunkBytes: 4 }), server.transport],
    provide: { echo: (value: unknown) => value }
  })
  /** One genuine accepted client owns its independent physical receiver and chunk state. */
  const client = await server.connect('r73-chunk-client', {
    plugins: [chunk({ chunkBytes: 4 })]
  })
  try {
    await expect(
      client.host.memory.send('r73-chunk-server', 'echo', 'r73-non-empty-framed-payload-😀')
    ).resolves.toBe('r73-non-empty-framed-payload-😀')
    /** Each original factory keeps its own exact global completion before releasing the other. */
    const dispose = client.host.close()
    expect(client.host.close()).toBe(dispose)
    await dispose
    /** Client retirement cannot replace the server's independent public completion. */
    const serverDispose = endpoint.close()
    expect(endpoint.close()).toBe(serverDispose)
    await serverDispose
  } finally {
    await client.host.close()
    await endpoint.close()
  }
})
