import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import { runtimeTestHost } from './fixture.js'
import assert from 'node:assert/strict'
import { it } from 'vitest'
import { defineFeature, definePlugin, getPluginRuntimeIntegration } from '@migaia/plugin-host'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { createThreadPeer } from '../../src/threads/peer.js'
import * as callable from '../../src/remote/runtime-api/peer.js'
import type { IRuntimePeerSource, IRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { runtimeSources } from './fixture.js'
import type { IRuntimeThreadPluginOptions } from '../../src/threads/plugin.js'
import type { IRpcPortableValue } from '../../src/contract/types.js'

/** The baseline's ordinary callable owner also uses a real managed Host and real Feature refs. */
function connection(name: string, source: IRuntimePeerSource) {
  if (Reflect.get(callable, 'readRuntimePeerConnection'))
    return createThreadPlugin({
      name,
      self: { name, instanceId: `${name}-instance` },
      connect: source,
      expose: ['service'],
      report: () => undefined
    } as never)
  return definePlugin({
    name,
    async install(core) {
      /** This supported baseline keeps the old Feature segment and delegates to the true Peer. */
      const snapshot = getPluginRuntimeIntegration(core).readFeatureOutputs('service')
      /** Baseline exposure forwards the original Feature output without a fixture dispatcher. */
      const peer = await createThreadPeer<IRuntimeDynamicSurface>({
        self: { name, instanceId: `${name}-instance` },
        connect: source,
        provide: { service: { data: snapshot.outputs.data as callable.IRuntimePeerProvide } },
        report: () => undefined
      })
      core.onDispose(() => peer.close())
      return { thread: peer }
    }
  })
}

it('[A11] two genuine Host installations flatten real Feature names into plugin.method in both directions', async () => {
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
    const installed = await Promise.all(
      hosts.map((host, index) => host.use(connection(`side-${index}`, channels.sources[index]!)))
    )
    /** The pre-change assembly has a genuine callable directory containing the Feature segment. */
    const migrated = Boolean(Reflect.get(callable, 'readRuntimePeerConnection'))
    for (const [index, host] of hosts.entries()) {
      /** Only this acceptance fixture reads the existing baseline Peer or the new canonical outlet. */
      const owner = (
        migrated
          ? Reflect.get(host, 'thread')
          : (installed[index]![0] as unknown as { extensions: { thread: IRuntimePeer } }).extensions
              .thread
      ) as IRuntimePeer & {
        request(target: string, method: string): Promise<unknown>
      }
      assert.equal(
        await (migrated
          ? owner.request(`side-${index}`, 'service.read')
          : owner.request('service.data.read')),
        42
      )
      /** A true remote dispatch rejection is caught so the intended business assertion is the RED. */
      const result = await Promise.resolve()
        .then(() =>
          migrated ? owner.request(`side-${index}`, 'service.read') : owner.request('service.read')
        )
        .then(
          (value) => value,
          (failure) => failure
        )
      assert.equal(result, 42, '[A11] public plugin.method reaches the whitelisted real Feature')
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

it('[A11][A14] default empty exposure keeps the connection ready, hides business, and grants no Host control', async () => {
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
    const child = hosts[0].thread!.get('remote')
    assert.equal(child.host, undefined, '[A14] empty expose cannot create a mutable Host facet')
    for (const mode of ['request', 'notify', 'stream'] as const)
      assert.throws(
        () => child[mode]('service.read'),
        { code: 'PROVIDER_NOT_FOUND' },
        '[A11] hidden methods reject before transport dispatch'
      )
    assert.equal(calls, 0, '[A11] hidden real Feature executes zero times')
  } finally {
    for (const host of hosts) await host.dispose()
    connection?.channels.close()
  }
})

it('[A11][A12] explicit Feature exposure supports all three modes and keeps other Plugins hidden', async () => {
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
              assert.fail('[A12] hidden Feature cannot execute')
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
      '[A11] scalar and one-way use the same genuine method'
    )
    /** Original stream iteration yields in order without collecting inside the facade. */
    const values: IRpcPortableValue[] = []
    for await (const value of hosts[0].thread!.stream('remote', 'service.values'))
      values.push(value)
    assert.deepEqual(values, [1, 2])
    assert.throws(() => hosts[0].thread!.request('remote', 'hidden.read'), {
      code: 'PROVIDER_NOT_FOUND'
    })
    assert.throws(() => hosts[0].thread!.request('remote', 'service.data.read'), {
      code: 'PROVIDER_NOT_FOUND'
    })
  } finally {
    for (const host of hosts) await host.dispose()
    connection?.channels.close()
  }
})

it('[A12] conflicting real Feature methods reject before source effects without replacing the original business', async () => {
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
            assert.fail('[A12] source opened before conflict rejection')
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
    assert.equal(host.thread, undefined, '[A12] a failed candidate cannot publish a slot')
    assert.equal(service.getFeature('first').read(), 42)
  } finally {
    await host.dispose()
  }
})

it('[A14][A15] child Host controls reuse the real resolver, exact adopter and dry-run transaction', async () => {
  /** Source and destination are genuine managed Hosts with separate mutation queues. */
  const hosts = [managedHost(), managedHost()] as const
  /** Resolver business is counted independently of Host-use results. */
  let resolved = 0
  /** The actual target definition belongs to the destination Host, never the wire. */
  const definition = definePlugin({
    name: 'added',
    features: { data: defineFeature(() => ({ read: () => 42 })) },
    install: () => ({})
  })
  /** The original catalog is the canonical remote Host-control schema. */
  const catalog = {
    added: {
      schemaVersion: 1 as const,
      plugin: 'added',
      features: { data: { methods: { read: { mode: 'request' as const, idempotent: false } } } }
    }
  }
  /** Both original resource scopes finish before the borrowed test carrier is released. */
  let connection: Awaited<ReturnType<typeof attach>> | undefined
  try {
    connection = await attach(hosts, [
      { name: 'remote' },
      {
        name: 'remote',
        expose: ['host'],
        host: hosts[1],
        catalog,
        resolvePlugin: (name, config) => {
          assert.equal(name, 'added')
          assert.deepEqual(config, Object.assign(Object.create(null), { answer: 42 }))
          resolved += 1
          return definition
        }
      }
    ])
    /** Only explicitly negotiated reserved methods create this facet. */
    const child = hosts[0].thread!.get('remote')
    assert.ok(child.host, '[A14] explicit Host exposure publishes actual control operations')
    assert.equal(hosts[1].revision, 1)
    await assert.rejects(child.host.unUse('added'), (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'REMOTE_HOST_NOT_ADOPTED')
      return true
    })
    assert.equal(hosts[1].revision, 1, '[A15] unadopted removal mutates zero times')
    assert.equal(resolved, 0)
    assert.deepEqual(
      await child.host.use('added', { answer: 42 }),
      Object.assign(Object.create(null), {
        name: 'added',
        state: 'enabled',
        revision: 2,
        features: ['data']
      })
    )
    assert.equal(resolved, 1)
    assert.deepEqual(
      await child.host.inspect(),
      Object.assign(Object.create(null), {
        revision: 2,
        plugins: [
          Object.assign(Object.create(null), {
            name: 'added',
            state: 'enabled',
            revision: 2,
            features: ['data']
          })
        ]
      })
    )
    await child.host.unUse('added', { dryRun: true })
    assert.equal(hosts[1].revision, 2, '[A15] dryRun leaves the adopted registration intact')
    assert.deepEqual(
      await child.host.unUse('added'),
      Object.assign(Object.create(null), { ok: true })
    )
    assert.equal(hosts[1].revision, 3)
    assert.equal(
      hosts[1].thread!.get('remote').host,
      undefined,
      '[A14] the reverse empty exposure has no control grant'
    )
  } finally {
    for (const host of hosts) await host.dispose()
    connection?.channels.close()
  }
})
