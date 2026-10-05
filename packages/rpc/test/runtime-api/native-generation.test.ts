import assert from 'node:assert/strict'
import { it, vi } from 'vitest'
import {
  prepareProcessRuntimeBootstrap,
  decodeProcessRuntimeBootstrap
} from '../../src/process/runtime-bootstrap.js'
import { createThreadRuntimeBootstrap } from '../../src/threads/bootstrap.js'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createThreadPeer } from '../../src/threads/index.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../src/threads/adapters/node.js'
import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import {
  readRuntimeLaunchContext,
  withRuntimeLaunchContext
} from '../../src/remote/runtime-api/launch-context.js'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { remoteHarness } from '../remote/fixture.js'
import { connected } from './fixture.js'
import { createRemoteRuntimeRegistration } from '../../src/remote/proxy.js'
import { readRuntimePeerEndpoint } from '../../src/remote/runtime-api/peer.js'
import { createThreadPlugin } from '../../src/threads/plugin.js'
import { runtimeTestHost } from './fixture.js'
import type { IRuntimeOutlet } from '../../src/remote/runtime-api/outlet.js'
import { readRuntimeOutletConnection } from '../../src/remote/runtime-api/outlet.js'
import { RUNTIME_API_FIXTURE_BASE_CAPABILITIES as RUNTIME_API_CAPABILITIES } from './fixture.js'

it.each(['memory', 'external'] as const)(
  '[A69][A70][A71] true Worker execution restart reports actual %s store continuity and sealed generation',
  async (kind) => {
    /** One real Worker budget and Host control own termination and the next successful launch. */
    const budget = createUnitBudget({ kind: 'thread', maxUnits: 1, launchRate: false })
    const native = createNodeThreadLauncher()
    const host = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    const capabilities = [
      ...RUNTIME_API_CAPABILITIES,
      RpcCapability.generation,
      RpcCapability.order,
      RpcCapability.group,
      RpcCapability.cancelBeforeStart,
      RpcCapability.outcome
    ]
    /** The actual external owner survives Worker death; its journal stays with local batch evidence. */
    const journal =
      kind === 'external'
        ? join(
            mkdtempSync(
              fileURLToPath(
                new URL(
                  '../../../../docs/rpc/scratch/runtime-api/implementation-c9/external-worker-',
                  import.meta.url
                )
              )
            ),
            'outcomes.jsonl'
          )
        : undefined
    if (journal) writeFileSync(journal, '')
    try {
      await host.use(
        createThreadPlugin({
          name: 'store-child',
          spawn: {
            spec: {
              entry: fileURLToPath(new URL('./fixtures/runtime-store-worker.mjs', import.meta.url)),
              ...(journal ? { data: { journal } } : {})
            },
            budget,
            scheduler: systemScheduler,
            launcher: {
              ...native,
              launch: (spec, request) =>
                withRuntimeLaunchContext(
                  request,
                  { ...readRuntimeLaunchContext(request)!, capabilities },
                  () => native.launch(spec, request)
                )
            },
            channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
            report: () => undefined
          },
          report: () => undefined
        })
      )
      const outlet = host.thread as unknown as IRuntimeOutlet
      const first = (await outlet.request('store-child', 'value', undefined, {
        orderKey: 'same',
        idempotencyKey: 'retained-key'
      })) as { executions: number; threadId: number }
      assert.equal(first.executions, 1)
      const before = await outlet.outcome('store-child', 'retained-key')
      assert.equal(before.state, 'done')
      assert.equal(before.store.kind, kind)
      assert.equal(before.store.continuity, 'retained')
      const oldInstance = readRuntimeOutletConnection(host.thread, 'store-child')!.instanceId
      await host.thread!.restart('store-child')
      await vi.waitFor(() => {
        const connection = readRuntimeOutletConnection(host.thread, 'store-child')
        assert.ok(connection, '[A71] the original holder must publish a real ready replacement')
        assert.notEqual(connection.instanceId, oldInstance)
      })
      const after = await outlet.outcome('store-child', 'retained-key')
      assert.equal(after.state, kind === 'external' ? 'done' : 'unknown')
      assert.equal(after.store.kind, kind)
      assert.equal(
        after.store.continuity,
        kind === 'external' ? 'retained' : 'lost-since-restart',
        '[A70] only real execution/store replacement establishes loss'
      )
      assert.ok(
        before.store.epoch && after.store.epoch,
        '[A70] both real default stores have readable epochs'
      )
      if (kind === 'external') {
        assert.deepEqual(
          after,
          before,
          '[A70] current lookup tuple returns the complete original sealed generation'
        )
        assert.deepEqual(
          await outlet.request('store-child', 'value', undefined, {
            orderKey: 'same',
            idempotencyKey: 'retained-key'
          }),
          first,
          '[A70] retained result prevents a second real business execution'
        )
      } else assert.notEqual(after.store.epoch, before.store.epoch)
      const fresh = (await outlet.request('store-child', 'value', undefined, {
        orderKey: 'same',
        idempotencyKey: 'fresh-key'
      })) as { executions: number; threadId: number }
      assert.equal(fresh.executions, 1)
      assert.notEqual(
        fresh.threadId,
        first.threadId,
        '[A70] actual isolate identity changes rather than merely reconnecting'
      )
      const done = await outlet.outcome('store-child', 'fresh-key')
      if (done.state !== 'done') assert.fail('[A71] current generation owns its new completion')
      assert.equal(done.outcome.targetGeneration.kind, 'restart')
      assert.equal(done.outcome.targetGeneration.value, 1)
      assert.equal(before.state === 'done' && before.outcome.targetGeneration.value, 0)
    } finally {
      await host.dispose()
    }
    assert.equal(budget.inUse, 0)
  }
)

/** These facts are launcher metadata, independent of safe instance IDs and physical attempt numbers. */
const generation = { kind: 'restart', value: 2, providerId: 'logical-child' } as const

it('[A71] original registration increments the accepted session only after publication and not after failed preparation', async () => {
  const fixture = remoteHarness()
  const ordinals: unknown[] = []
  const pairs: Awaited<ReturnType<typeof connected>>[] = []
  let rejectNext = false
  const registration = createRemoteRuntimeRegistration({
    binding: fixture.binding,
    report: () => undefined,
    prepareRuntime: async (...args) => {
      ordinals.push(Reflect.get(args, '2'))
      if (rejectNext) {
        rejectNext = false
        throw new Error('fixture rejected session preparation')
      }
      const pair = await connected({}, { value: () => 42 })
      pairs.push(pair)
      return pair.peers[0]
    },
    readRuntimeEndpoint: readRuntimePeerEndpoint
  })
  const signal = new AbortController().signal
  try {
    await registration.prepareGeneration(signal, fixture.own)
    assert.deepEqual(ordinals, [0], '[A71] original accepted session begins at zero')
    fixture.nextGeneration()
    rejectNext = true
    await assert.rejects(registration.prepareGeneration(signal, fixture.own))
    await registration.prepareGeneration(signal, fixture.own)
    fixture.nextGeneration()
    await registration.prepareGeneration(signal, fixture.own)
    assert.deepEqual(
      ordinals,
      [0, 1, 1, 2],
      '[A71] a failed describe/preparation cannot consume a session ordinal'
    )
  } finally {
    await registration.release()
    await fixture.registration.release()
    for (const pair of pairs) await pair.close()
  }
})

it('[A71] original process bootstrap carries the real execution ordinal and stable logical provider namespace', () => {
  const options = { name: 'child', parentInstanceId: 'parent', generation }
  const prepared = prepareProcessRuntimeBootstrap(
    options,
    new TextEncoder().encode('fixture-token')
  )
  const bootstrap = decodeProcessRuntimeBootstrap(prepared.payload)
  assert.deepEqual(
    Reflect.get(bootstrap, 'generation'),
    generation,
    '[A71] restart facts must survive the original single bootstrap frame'
  )
  assert.equal(bootstrap.self.instanceId, prepared.self.instanceId)
  assert.notEqual(bootstrap.self.instanceId, generation.providerId)
})

it('[A71] original Worker bootstrap carries generation separately from its real launch fingerprint', () => {
  const context = { self: { name: 'parent', instanceId: 'parent' }, capabilities: [], generation }
  const bootstrap = createThreadRuntimeBootstrap('child', 'actual-fingerprint', context)
  assert.deepEqual(
    Reflect.get(bootstrap, 'generation'),
    generation,
    '[A71] Worker metadata must retain the original launch generation'
  )
  assert.equal(bootstrap.self.instanceId, 'actual-fingerprint')
})

it('[A73] managed native request cannot silently drop an explicitly unsupported order option', async () => {
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1, launchRate: false })
  const native = createNodeThreadLauncher()
  let calls = 0
  const peer = await createThreadPeer<IRuntimeDynamicSurface>({
    spawn: {
      spec: { entry: fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url)) },
      budget,
      scheduler: systemScheduler,
      launcher: {
        ...native,
        launch: (spec, request) => {
          const context = readRuntimeLaunchContext(request)!
          return withRuntimeLaunchContext(
            request,
            {
              ...context,
              capabilities: context.capabilities.filter((value) => value !== RpcCapability.order)
            },
            () => native.launch(spec, request)
          )
        }
      },
      channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
      report: () => undefined
    },
    provide: {
      parent: {
        echo: () => {
          calls++
          return 42
        }
      }
    },
    report: () => undefined
  })
  try {
    await peer.request('probe', 'ordinary')
    calls = 0
    await assert.rejects(
      peer.request('probe', 'ordered', { orderKey: 'same' }),
      { code: 'CAPABILITY_UNSUPPORTED' },
      '[A73] the original managed dispatch must retain explicit U25 requirements'
    )
    assert.equal(calls, 0)
  } finally {
    await peer.close()
  }
  assert.equal(budget.inUse, 0)
})
