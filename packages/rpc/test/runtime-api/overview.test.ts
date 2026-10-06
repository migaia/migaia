import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { connected, runtimeSources, runtimeTestHost } from './fixture.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { createRuntimePeer } from '../../src/remote/runtime-api/peer.js'
import { createThreadPeer } from '../../src/threads/peer.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory,
  type INodeThreadHandle
} from '../../src/threads/adapters/node.js'
import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { RUNTIME_API_FIXTURE_BASE_CAPABILITIES } from './fixture.js'

it.each([true, false])(
  '[A71][A72] Peer detail reports the accepted remote generation or explicit unavailability (%s)',
  async (negotiated) => {
    /** Only the actual intersection decides whether the peer has a generation identity. */
    const capabilities = [
      ...RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
      ...(negotiated ? [RpcCapability.generation] : [])
    ]
    const fixture = await connected({}, { echo: () => 42 }, capabilities, capabilities)
    try {
      assert.equal(await fixture.peers[0].request('echo'), 42)
      const accepted = readRuntimePeerConnection(fixture.peers[0]).description!.self.generation
      const detail = await fixture.peers[0].describe()
      const generation = Reflect.get(detail.connections[0]!, 'generation')
      if (negotiated) {
        assert.ok(accepted)
        assert.deepEqual(
          generation,
          accepted,
          '[A71] local detail must retain the exact authenticated restart/session identity'
        )
      } else
        assert.ok(
          generation && Reflect.get(generation, 'status') === 'unavailable',
          '[A72] missing generation proof is explicit, never omitted or inferred from unit attempts'
        )
    } finally {
      await fixture.close()
    }
  }
)

it('[A24] describe projects local identity and connection facts without another request', async () => {
  /** Existing business works before the missing management projection is asserted. */
  const fixture = await connected({ alpha: () => 'alpha' }, { beta: () => 'beta' })
  try {
    assert.equal(await fixture.peers[0].request('beta'), 'beta')
    /** The original physical transport records any attempted hidden management traffic. */
    const connection = readRuntimePeerConnection(fixture.peers[0])
    /** Wrapping only this fixture transport observes real writes without a new runtime observer. */
    const send = connection.channel.transport.send
    /** Reads must produce no additional physical send after source agreement is already complete. */
    let sends = 0
    connection.channel.transport.send = (...args) => {
      sends += 1
      return send(...args)
    }
    /** Query shape is asserted after the real original owner has fulfilled the call. */
    const detail = (await fixture.peers[0].describe()) as unknown as Record<string, unknown>
    assert.deepEqual(
      detail.identity,
      fixture.peers[0].self,
      '[A24] describe is a local safe detail'
    )
    assert.equal(sends, 0, '[A24] cold describe cannot send a hidden request')
    assert.deepEqual(
      (detail.connections as { identity: unknown }[])[0]!.identity,
      fixture.peers[1].self
    )
    assert.deepEqual(detail.provide, ['alpha'])
    assert.deepEqual(
      detail.methods,
      ['alpha'],
      '[A24][D17] local methods are names, not wire summaries'
    )
  } finally {
    await fixture.close()
  }
})

it('[A27] genuine native departures retain only 100 safe records and never pollute another registration', async () => {
  /** The existing automatic fixture exercises the real Worker and native generation owners. */
  const entry = fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url))
  /** Each registration has its own execution budget and native resources. */
  const budgets = [
    createUnitBudget({ kind: 'thread', maxUnits: 1 }),
    createUnitBudget({ kind: 'thread', maxUnits: 1 })
  ]
  /** Recording handles does not infer a departure from a terminate request. */
  const handles: INodeThreadHandle[] = []
  /** The canonical launcher is preserved including its actual exited Promise. */
  const native = createNodeThreadLauncher()
  /** A genuine second registration independently proves that history is not process-global. */
  const peers = await Promise.all(
    budgets.map((budget, index) =>
      createThreadPeer<IRuntimeDynamicSurface>({
        self: { name: `history-${index}`, instanceId: `history-${index}` },
        provide: { parent: { echo: () => 42 } },
        spawn: {
          spec: { entry, name: `history-worker-${index}` },
          budget,
          scheduler: systemScheduler,
          launcher: {
            ...native,
            launch: async (...args) => {
              const handle = await native.launch(...args)
              if (index === 0) handles.push(handle)
              return handle
            }
          },
          channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
          supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 110 } },
          report: () => undefined
        },
        report: () => undefined
      })
    )
  )
  try {
    /** Fail before the long native sequence when the cold history contract does not yet exist. */
    const initial = (await peers[0]!.describe()) as unknown as { recent: unknown[] }
    assert.ok(
      Array.isArray(initial.recent),
      '[A27] describe must project the original bounded lifecycle history'
    )
    for (let index = 0; index < 105; index++) {
      /** The accepted channel id distinguishes actual endpoint preparation from launch completion. */
      const previous = readRuntimePeerConnection(peers[0]!).peerId
      handles[index]!.terminate()
      await handles[index]!.exited
      await vi.waitFor(
        () => {
          assert.equal(handles.length, index + 2)
          assert.notEqual(readRuntimePeerConnection(peers[0]!).peerId, previous)
        },
        { timeout: 3000, interval: 5 }
      )
    }
    /** Cold reads must neither advance generation nor cause another launcher invocation. */
    const launches = handles.length
    const first = (await peers[0]!.describe()) as unknown as {
      recent: { generation: number }[]
      health: { status: string }
      unit: { generation: number }
    }
    const second = (await peers[1]!.describe()) as unknown as { recent: unknown[] }
    assert.equal(first.recent.length, 100)
    assert.equal(first.recent[0]!.generation, 6)
    assert.equal(first.recent[99]!.generation, 105)
    assert.equal(second.recent.length, 0)
    assert.equal(
      first.health.status,
      'unavailable',
      '[A27] missing native health proof cannot become healthy'
    )
    /** Sampling timestamps may differ; the canonical state and stored lifecycle facts may not. */
    const repeated = (await peers[0]!.describe()) as unknown as typeof first
    assert.deepEqual(repeated.unit, first.unit)
    assert.deepEqual(repeated.recent, first.recent)
    assert.equal(handles.length, launches)
    /** Queries remain local and truthful after the original native owner has fully disposed. */
    await peers[0]!.close()
    const retired = await peers[0]!.describe()
    assert.equal(retired.connections[0]!.connection.status, 'departed')
    assert.equal(
      'state' in retired.connections[0]!.unit && retired.connections[0]!.unit.state,
      'disposed'
    )
    assert.equal(retired.connections[0]!.recent.length, 100)
    assert.equal(handles.length, launches)
  } finally {
    for (const peer of peers) await peer.close()
    assert.deepEqual(
      budgets.map((budget) => budget.inUse),
      [0, 0]
    )
  }
}, 90_000)

it('[A24] a real shared Host outlet lists two direct connections and its original safe identity', async () => {
  /** Three original Hosts retain their own lifecycle and exact shared-slot contributions. */
  const hosts = Array.from({ length: 3 }, () =>
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
  )
  /** Independent source pairs prevent a synthetic multi-target registry in the fixture. */
  const channels = [runtimeSources(), runtimeSources()]
  try {
    for (let index = 0; index < 2; index++) {
      await Promise.all([
        hosts[0]!.use(
          createThreadPlugin({
            name: `connection-${index}`,
            self: { name: 'host-side', instanceId: `host-${index}` },
            connect: channels[index]!.sources[0],
            report: () => undefined
          })
        ),
        hosts[index + 1]!.use(
          createThreadPlugin({
            name: 'inbound',
            self: { name: `remote-${index}`, instanceId: `remote-${index}` },
            connect: channels[index]!.sources[1],
            provide: { echo: (value: unknown) => value },
            report: () => undefined
          })
        )
      ])
    }
    assert.equal(await hosts[0]!.thread!.request('connection-0', 'echo', 'ready'), 'ready')
    /** This business assertion runs after two real accepted connection receipts exist. */
    const list = (hosts[0]!.thread as unknown as Record<string, unknown>).list
    assert.equal(typeof list, 'function', '[A24] the shared outlet must expose a local overview')
    /** No erased surface type or application-shaped Host participates in the query. */
    const overview = await (
      list as () => Promise<{ self: unknown; connections: { identity: unknown }[] }>
    )()
    assert.deepEqual(overview.self, {
      name: hosts[0]!.identity.name,
      instanceId: hosts[0]!.identity.id
    })
    assert.deepEqual(
      overview.connections.map((detail) => detail.identity),
      [
        { name: 'remote-0', instanceId: 'remote-0' },
        { name: 'remote-1', instanceId: 'remote-1' }
      ]
    )
  } finally {
    for (const host of hosts) await host.dispose()
    for (const channel of channels) channel.close()
  }
})

it('[A26] owner configuration and business failure secrets never enter any detail representation', async () => {
  /** One marker covers source configuration and the actual native business error/cause. */
  const marker = 'a26-private-owner-marker'
  /** Custom supported channel sources may retain metadata that is not public runtime detail. */
  const channels = runtimeSources()
  /** The original local report keeps the full error, independently from safe query projection. */
  const reports: unknown[] = []
  /** Both real callable owners still exchange their ordinary closed v2 directories. */
  const peers = await Promise.all(
    channels.sources.map((source, index) =>
      createRuntimePeer({
        self: { name: `safe-${index}`, instanceId: `safe-${index}` },
        provide: {
          fail: () => {
            throw new Error(marker, { cause: new Error(marker) })
          }
        },
        connect: async (context) =>
          Object.assign(await source(context), {
            token: marker,
            auth: { token: marker },
            bootstrap: { data: marker },
            env: { PRIVATE: marker }
          }),
        report: (error) => reports.push(error)
      })
    )
  )
  try {
    await assert.rejects(peers[0]!.request('fail'))
    assert.ok(reports.some((error) => error instanceof Error && error.message === marker))
    /** Overload admission can be exercised before the new public declarations exist. */
    const describe = peers[0]!.describe as unknown as (options?: {
      format: string
    }) => Promise<unknown>
    for (const format of [undefined, 'json', 'yaml', 'toml']) {
      /** Every representation starts from the same safe local fields, never stringifies a channel. */
      const detail = await describe(format ? { format } : undefined)
      assert.equal(
        typeof detail,
        format ? 'string' : 'object',
        '[A26] formatting follows safe projection'
      )
      assert.equal(JSON.stringify(detail).includes(marker), false)
      assert.equal(JSON.stringify(detail).includes('"auth"'), false)
      assert.equal(JSON.stringify(detail).includes('"bootstrap"'), false)
      assert.equal(JSON.stringify(detail).includes('"env"'), false)
    }
  } finally {
    for (const peer of peers) await peer.close()
    channels.close()
  }
})
