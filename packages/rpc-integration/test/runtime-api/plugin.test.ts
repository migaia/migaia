import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'
import assert from 'node:assert/strict'
import { it, vi, expect } from 'vitest'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { threadProtocolDefinition as createThreadPlugin } from './fixtures/thread-protocol.js'
import type { IRuntimePeerSource } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { runtimeSources } from '../../../rpc-host/test/runtime-api/fixture.js'
import type { IThreadProtocolOptions as IRuntimeThreadPluginOptions } from './fixtures/thread-protocol.js'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import { RpcStreamOwner } from '../../../rpc-host/dist/core/internal/stream/owner.js'

/** The ordinary Host compiles the real current Feature whitelist into its cold transport. */
function connection(name: string, source: IRuntimePeerSource) {
  return createThreadPlugin({
    name,
    self: { name, instanceId: `${name}-instance` },
    connect: source,
    expose: ['service'],
    report: () => undefined
  })
}

it('two genuine Host installations flatten real Feature names into plugin.method in both directions', async () => {
  /** Each side is a real frozen managed Host with its original installation transaction. */
  const hosts = [
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    }),
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
  ] as const
  /** The source offers are independent, and the existing memory carrier moves real envelopes. */
  const channels = runtimeSources()
  /** Actual Feature execution proves this is business dispatch rather than an export probe. */
  let calls = 0
  try {
    for (const host of hosts)
      await host.use(
        definePlugin({
          name: 'service',
          features: {
            data: defineFeature(() => ({
              read: () => {
                calls += 1
                return 42
              }
            }))
          },
          install: () => ({})
        })
      )
    await Promise.all(
      hosts.map((host, index) => host.use(connection(`side-${index}`, channels.sources[index]!)))
    )
    for (const [index, host] of hosts.entries()) {
      /** The installed shared outlet routes directly through the actual Feature whitelist. */
      const owner = host.thread!
      assert.equal(await owner.request(`side-${index}`, 'service.read'), 42)
      /** A true remote dispatch rejection is caught so the intended business assertion is the RED. */
      const result = await Promise.resolve()
        .then(() => owner.request(`side-${index}`, 'service.read'))
        .then(
          (value) => value,
          (failure) => failure
        )
      assert.equal(result, 42, 'public plugin.method reaches the whitelisted real Feature')
    }
    assert.equal(calls, 4)
  } finally {
    for (const host of hosts) await host.dispose()
    channels.close()
  }
})

/** Each acceptance owner is a true public frozen Host with the existing operation/drain budgets. */
function managedHost() {
  return runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
}

/**
 * A fixture pair owns only its existing memory carrier; Host owns the real Plugin and Peer
 * resources.
 */
async function attach(
  hosts: readonly [ReturnType<typeof managedHost>, ReturnType<typeof managedHost>],
  options: readonly [
    Omit<IRuntimeThreadPluginOptions, 'connect' | 'report'>,
    Omit<IRuntimeThreadPluginOptions, 'connect' | 'report'>
  ]
) {
  /** Both independent actual offers enter the same source fixture used by ordinary Peer tests. */
  const channels = runtimeSources()
  /** Each original endpoint report preserves its own native failure objects. */
  const reports: unknown[][] = [[], []]
  await Promise.all(
    hosts.map((host, index) =>
      host.use(
        createThreadPlugin({
          ...options[index]!,
          connect: channels.sources[index]!,
          report: (error) => {
            reports[index]!.push(error)
          }
        })
      )
    )
  )
  return { channels, reports }
}

it('default empty exposure keeps the connection ready, hides business, and grants no Host control', async () => {
  /** Genuine Feature execution is checked before the remote empty-directory assertions. */
  let calls = 0
  /** Both sides use the same entry rather than a special service Host API. */
  const hosts = [managedHost(), managedHost()] as const
  /** Carrier ownership is released after both original Host scopes finish cleanup. */
  let connection: Awaited<ReturnType<typeof attach>> | undefined
  try {
    const [service] = await hosts[1].use(
      definePlugin({
        name: 'service',
        features: {
          data: defineFeature(() => ({
            read: () => {
              calls += 1
              return 42
            }
          }))
        },
        install: () => ({})
      })
    )
    assert.equal(service.getFeature('data').read(), 42)
    calls = 0
    connection = await attach(hosts, [{ name: 'remote' }, { name: 'remote' }])
    /** A committed ready contribution exists even though its accepted directory is empty. */
    const child = await hosts[0].thread!.get('remote')
    assert.equal(
      Object.hasOwn(child, 'host'),
      false,
      'empty expose cannot create a mutable Host facet'
    )
    await expect(hosts[0].thread!.request('remote', 'service.read')).rejects.toMatchObject({
      source: 'rpc.endpoint',
      code: 'INTERNAL',
      name: 'RpcRemoteError',
      cause: { source: 'rpc.endpoint', code: 'TARGET_UNKNOWN' }
    })
    /** Join the preceding request's original report before isolating notify's single report. */
    await vi.waitFor(() => assert.equal(connection!.reports[1]!.length, 1))
    /** The preceding rejected request has its own original provider report. */
    const priorReports = connection.reports[1]!.length
    await hosts[0].thread!.notify('remote', 'service.read')
    await vi.waitFor(() => assert.equal(connection!.reports[1]!.length, priorReports + 1))
    assert.equal(Reflect.get(connection.reports[1]!.at(-1) as object, 'source'), 'rpc.endpoint')
    assert.equal(Reflect.get(connection.reports[1]!.at(-1) as object, 'code'), 'TARGET_UNKNOWN')
    /** Legacy stream-open has no rejection frame for an absent handler, so its route must exist. */
    const opening = vi.spyOn(RpcStreamOwner.prototype, 'open')
    try {
      assert.throws(() => hosts[0].thread!.stream('remote', 'service.read'), {
        source: 'rpc.endpoint',
        code: 'PROVIDER_NOT_FOUND'
      })
      assert.equal(
        opening.mock.calls.length,
        0,
        'unadvertised legacy stream never physically opens'
      )
    } finally {
      opening.mockRestore()
    }
    assert.equal(calls, 0, 'hidden real Feature executes zero times')
  } finally {
    for (const host of hosts) await host.dispose()
    connection?.channels.close()
  }
})

it('explicit Feature exposure supports all three modes and keeps other Plugins hidden', async () => {
  /** Original Feature business, notification and generator execution each have independent evidence. */
  const invoked: unknown[] = []
  /** A source callback runs only after both Host installations are legitimately admitted. */
  const hosts = [managedHost(), managedHost()] as const
  /** The fixture carrier is separate from the original resource disposal scope. */
  let connection: Awaited<ReturnType<typeof attach>> | undefined
  try {
    await hosts[1].use(
      definePlugin({
        name: 'service',
        features: {
          data: defineFeature(() => ({
            read: (payload: unknown) => {
              invoked.push(payload)
              return 42
            },
            values: function* () {
              yield 1
              yield 2
            }
          }))
        },
        install: () => ({})
      })
    )
    await hosts[1].use(
      definePlugin({
        name: 'hidden',
        features: {
          data: defineFeature(() => ({
            read: () => {
              assert.fail('hidden Feature cannot execute')
            }
          }))
        },
        install: () => ({})
      })
    )
    connection = await attach(hosts, [{ name: 'remote' }, { name: 'remote', expose: ['service'] }])
    assert.equal(await hosts[0].thread!.request('remote', 'service.read', 'request'), 42)
    await hosts[0].thread!.notify('remote', 'service.read', 'notify')
    assert.equal(await hosts[0].thread!.request('remote', 'service.read', 'barrier'), 42)
    assert.deepEqual(
      invoked,
      ['request', 'notify', 'barrier'],
      'scalar and one-way use the same genuine method'
    )
    /** Original stream iteration yields in order without collecting inside the facade. */
    const values: IRpcPortableValue[] = []
    for await (const value of hosts[0].thread!.stream('remote', 'service.values'))
      values.push(value)
    assert.deepEqual(values, [1, 2])
    for (const method of ['hidden.read', 'service.data.read'])
      await expect(hosts[0].thread!.request('remote', method)).rejects.toMatchObject({
        source: 'rpc.endpoint',
        code: 'INTERNAL',
        name: 'RpcRemoteError',
        cause: { source: 'rpc.endpoint', code: 'TARGET_UNKNOWN' }
      })
    assert.deepEqual(invoked, ['request', 'notify', 'barrier'], 'hidden paths execute no business')
  } finally {
    for (const host of hosts) await host.dispose()
    connection?.channels.close()
  }
})

it('conflicting real Feature methods reject before source effects without replacing the original business', async () => {
  /** The genuine existing registration stays active through failed connection construction. */
  const host = managedHost()
  /** No transport acquisition can precede folded-name validation. */
  let sourceCalls = 0
  try {
    const [service] = await host.use(
      definePlugin({
        name: 'service',
        features: {
          first: defineFeature(() => ({ read: () => 42 })),
          second: defineFeature(() => ({ read: () => 43 }))
        },
        install: () => ({})
      })
    )
    assert.equal(service.getFeature('first').read(), 42)
    await assert.rejects(
      host.use(
        createThreadPlugin({
          name: 'remote',
          expose: ['service'],
          connect: async () => {
            sourceCalls += 1
            assert.fail('source opened before conflict rejection')
          },
          report: () => undefined
        })
      ),
      (error: unknown) => {
        assert.equal((error as { cause?: { code?: string } }).cause?.code, 'CAPABILITY_CONFLICT')
        return true
      }
    )
    assert.equal(sourceCalls, 0)
    assert.equal(host.thread, undefined, 'a failed candidate cannot publish a slot')
    assert.equal(service.getFeature('first').read(), 42)
  } finally {
    await host.dispose()
  }
})
