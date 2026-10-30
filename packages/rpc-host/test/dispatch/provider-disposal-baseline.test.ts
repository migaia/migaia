import { defineFeature, defineHost, definePlugin } from '@migaia/plugin-host'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { expect, it, vi } from 'vitest'
import { connectedCoreHosts, coreMemoryServer } from '../host/core-fixture.ts'

/** One explicit cold context supplies native options and the actual provider declaration. */
const nativeFixture = {
  /** The original native owner has no mutation/drain deadline in successful cleanup scenarios. */
  options: {
    host: {
      execution: { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }
    }
  },
  /** Native Feature exposure exercises the actual ProviderDispatcher before native disposal. */
  provider: definePlugin({
    name: 'provider',
    features: { api: defineFeature(() => ({ echo: (value: unknown) => value })) },
    install: () => ({})
  }),
  /** The public transport whitelist selects this one original native Feature method. */
  method: 'provider.echo'
}

/** Installed native subjects lend authentic execution authority for their real memory transports. */
function receivingHost() {
  /** Each independent original Host receives its own cold declarations and lazy native handles. */
  const rpc = rpcHostPipelines(
    () => host,
    (key, request) => host.pipeline(key, request)
  )
  /** Original native lifecycle options remain unchanged on the sole transaction owner. */
  const host = defineHost({ ...rpc, ...nativeFixture.options })
  return host
}

it('cold native Host disposal preserves the original Promise before any installation', async () => {
  /** C049 creates the actual native owner but never installs its prepared descriptor inventory. */
  const native = defineHost(nativeFixture.options)
  /** This is the original PluginHost completion, without an RPC Root or disposal facade. */
  const hostDispose = native.dispose()
  expect(native.dispose()).toBe(hostDispose)
  await hostDispose
})

it('installed native Host disposal preserves its Promise and removes the original subscription', async () => {
  /** One ordinary native Host receives the same SDK installation as a public RPC Root. */
  const native = receivingHost()
  /** This genuine listener lends its original carrier to the native installation. */
  const server = coreMemoryServer('native-disposal', 'native-disposal', 'memory', {}, [
    nativeFixture.method
  ])
  await native.use(nativeFixture.provider, server.transport)
  /** A real public caller proves the provider and receiver were genuinely installed. */
  const client = await server.connect('native-client')
  /** Observe the original physical close method without replacing its cleanup implementation. */
  const close = vi.spyOn(client.pair[0], 'close')
  try {
    await expect(client.host.memory.request(nativeFixture.method, 'r70-data')).resolves.toBe(
      'r70-data'
    )
    /** Both original cases repeat the actual native Host disposal before its terminal. */
    const firstDispose = native.dispose()
    expect(native.dispose()).toBe(firstDispose)
    await firstDispose
    expect(close.mock.calls.length).toBe(1)
    /** The shared original fixture cleanup also repeats disposal after the original terminal. */
    expect(native.dispose()).toBe(firstDispose)
    expect(close.mock.calls.length).toBe(1)
    expect(client.pair[0].unsubscribed).toBe(1)
    expect(client.pair[0].closed).toBe(true)
  } finally {
    await Promise.all([native.dispose(), client.host.close()])
    close.mockRestore()
  }
})

it('separate native Hosts keep consumer ping absent and both disposal identities without failures', async () => {
  /** Original owner and consumer transactions use distinct native Hosts, not RPC Root substitutes. */
  const owner = receivingHost()
  /** The consumer remains an ordinary NativeHost whose control stays under its RPC namespace. */
  const consumer = receivingHost()
  /** Independent listeners retain the two actual installation and physical cleanup boundaries. */
  const ownerServer = coreMemoryServer('disposal-owner', 'disposal-owner', 'memory', {}, [
    nativeFixture.method
  ])
  /** Reusing the cold provider definition does not share native registration lifetime. */
  const consumerServer = coreMemoryServer('disposal-consumer', 'disposal-consumer', 'memory', {}, [
    nativeFixture.method
  ])
  await owner.use(nativeFixture.provider, ownerServer.transport)
  await consumer.use(nativeFixture.provider, consumerServer.transport)
  /** Each genuine accepted session has its own public caller and original memory carrier. */
  const ownerClient = await ownerServer.connect('owner-client')
  /** The consumer transaction owns a separate physical session rather than copied directory facts. */
  const consumerClient = await consumerServer.connect('consumer-client')
  try {
    await expect(ownerClient.host.memory.request(nativeFixture.method, 'owner')).resolves.toBe(
      'owner'
    )
    await expect(
      consumerClient.host.memory.request(nativeFixture.method, 'consumer')
    ).resolves.toBe('consumer')
    expect(Reflect.get(consumer, 'ping')).toBeUndefined()
    /** Preserve the original helper's real consumer disposal identity before and after completion. */
    const consumerDispose = consumer.dispose()
    expect(consumer.dispose()).toBe(consumerDispose)
    await consumerDispose
    expect(consumer.dispose()).toBe(consumerDispose)
    expect(consumerClient.pair[0].unsubscribed).toBe(1)
    expect(consumerClient.pair[0].closed).toBe(true)

    /** Preserve both original owner business fields rather than rebuilding its old kernel snapshot. */
    const ownerDispose = owner.dispose()
    /** The repeated public call must borrow the original actual NativeHost completion. */
    const repeatedOwnerDispose = owner.dispose()
    /** Original cleanup failures remain observable without being replaced by a fixture reset. */
    let ownerDisposalFailure: unknown
    try {
      await ownerDispose
    } catch (error) {
      ownerDisposalFailure = error
    }
    expect({
      ownerDisposeStable: repeatedOwnerDispose === ownerDispose,
      ownerDisposalFailure
    }).toEqual({ ownerDisposeStable: true, ownerDisposalFailure: undefined })
    expect(owner.dispose()).toBe(ownerDispose)
    expect(ownerClient.pair[0].unsubscribed).toBe(1)
    expect(ownerClient.pair[0].closed).toBe(true)
  } finally {
    await Promise.all([
      owner.dispose(),
      consumer.dispose(),
      ownerClient.host.close(),
      consumerClient.host.close()
    ])
  }
})

it('provider failure preserves INTERNAL and complete RPC Root close identity and completion', async () => {
  /** The same original fixture error crosses actual provider execution before cleanup begins. */
  const primary = new Error('canonical provider failure')
  /** Only the genuine public Root owns this global provider and its final physical resources. */
  const fixture = await connectedCoreHosts(
    {},
    {
      fail: () => {
        throw primary
      }
    },
    () => undefined
  )
  try {
    await expect(fixture.a.memory.send('b', 'fail', null)).rejects.toMatchObject({
      code: RpcCoreErrorCode.internal
    })
    /** Complete provider registration termination belongs to this actual RPC Root. */
    const endpointDispose = fixture.b.close()
    expect(fixture.b.close()).toBe(endpointDispose)
    await expect(endpointDispose).resolves.toBeUndefined()
    expect(fixture.pair[1].unsubscribed).toBe(1)
    expect(fixture.pair[1].closed).toBe(true)
    /** Retains the remote close reason for later named calls to the retired provider. */
    await expect(fixture.a.memory.send('b', 'fail', null)).rejects.toMatchObject({
      code: RpcCoreErrorCode.endpointDisposed
    })
  } finally {
    await fixture.close()
  }
})
