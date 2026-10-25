import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createHmac } from 'node:crypto'
import { it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createAdapterBindingDrain, createAdapterId } from '@migaia/rpc-host/plugin'
import {
  createThreadSupervisor,
  type IThreadHandle,
  type IThreadSpec
} from '@migaia/supervision/threads'
import { type IRuntimeThreadSpawn } from '../../../rpc-plugin-thread/dist/threads/runtime-peer.js'
import { type INodeThreadHandle } from '../../../rpc-plugin-thread/dist/threads/node-launcher.js'
import type { IRemoteBinding } from '@migaia/rpc-host/plugin'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../../rpc-plugin-thread/dist/threads/adapters/node.js'
import { createManagedRuntimePeer } from '../../../rpc-host/dist/remote/runtime-api/managed-peer.js'
import { createRuntimeApiEndpoint } from '../../../rpc-host/dist/core/runtime-api-endpoint.js'
import { createRemoteRetryPort } from '../../../rpc-host/dist/remote/retry.js'
import type { IRemoteRetryPort } from '../../../rpc-host/dist/remote/types.js'
import { readRuntimePeerConnection } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { RUNTIME_API_CAPABILITIES } from '../../../rpc-host/dist/remote/runtime-api/constants.js'
import { codec } from '../../../rpc-host/dist/core/middleware/codec.js'
import { framer } from '../../../rpc-host/dist/core/middleware/framer.js'
import { connect } from '../../../rpc-host/dist/core/middleware/connect.js'
import { abort } from '../../../rpc-host/dist/core/middleware/abort.js'
import { timeout } from '../../../rpc-host/dist/core/middleware/timeout.js'
import { authentication } from '../../../rpc-host/dist/core/middleware/authentication.js'
import type { IRpcEndpoint } from '../../../rpc-host/dist/core/typing.js'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import fixture from './fixtures/managed-binary-key.json'

/** Native data/auth profile is actually configured on both independent Worker endpoint owners. */
const capabilities = [
  ...new Set([
    ...RUNTIME_API_CAPABILITIES,
    'portable-binary@1',
    'native-binary-authenticated-manifest@1',
    'transfer@1'
  ])
]
/** Original launch and native cleanup are independently observable, without a fake supervisor. */
const entry = fileURLToPath(new URL('./fixtures/managed-binary-worker.mjs', import.meta.url))

/**
 * These advanced custom authenticated assemblies declare their implemented binary profile directly.
 * The stock runtime source advertises only baseline capabilities for custom endpoint factories;
 * this test-local binding uses canonical supervision and drain without restoring legacy Plugin
 * API.
 */
function managedBinaryBinding<THandle extends IThreadHandle>(
  source: IRuntimeThreadSpawn<THandle>
): IRemoteBinding<THandle, IThreadSpec> &
  Readonly<{
    bindEndpoint: ReturnType<typeof createAdapterBindingDrain>['wrap']
  }> {
  /** The same endpoint drain owns physical native stop and already admitted business requests. */
  const drain = createAdapterBindingDrain(source.scheduler, source.report)
  /** Existing supervisor preserves budget, restart, cleanup and native-exit semantics. */
  const supervisor = createThreadSupervisor({
    ...source.supervisor,
    id: source.supervisor?.id ?? createAdapterId(),
    launcher: source.launcher,
    spec: source.spec,
    budget: source.budget,
    scheduler: source.scheduler,
    report: source.report,
    health: source.health,
    stop: {
      ...source.supervisor?.stop,
      beforeTerminate: async (unit, signal, remainingMs) => {
        await drain.drainCurrent({ drainMs: remainingMs() })
        if (!signal.aborted)
          await source.supervisor?.stop?.beforeTerminate?.(unit, signal, remainingMs)
      }
    }
  })
  return {
    ownership: 'owned',
    bindEndpoint: drain.wrap,
    trackRequest: drain.trackCurrent,
    supervisor,
    scheduler: source.scheduler,
    openChannel: (handle, signal) => source.channelFactory.open(handle, signal)
  }
}

it('managed genuine Worker transfers through the original owner without entering keyed automatic retry', async () => {
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  /** The custom endpoint's implemented profile enters actual launcher bootstrap, never static flags. */
  const native = createNodeThreadLauncher({
    runtimeApi: {
      self: { name: 'managed-binary-parent', instanceId: 'managed-binary-parent' },
      capabilities
    }
  })
  const handles: INodeThreadHandle[] = []
  let sequence = 0
  let starts = 0
  let retries = 0
  /** If ordinary work reaches this observer, it delegates the exact original retry implementation. */
  const retryPort: IRemoteRetryPort = {
    dispatch: (input) => {
      retries++
      return createRemoteRetryPort({
        events: input.events,
        scheduler: systemScheduler,
        report: () => undefined
      }).dispatch(input)
    }
  }
  const signature = (value: unknown) =>
    createHmac('sha256', fixture.key).update(JSON.stringify(value)).digest('hex')
  const binding = managedBinaryBinding({
    spec: { entry, data: { parentId: 'managed-binary-parent', capabilities } },
    budget,
    scheduler: systemScheduler,
    launcher: {
      ...native,
      launch: async (spec, context) => {
        const handle = await native.launch(
          { ...spec, data: { ...(spec.data as object), sequence: ++sequence } },
          context
        )
        handles.push(handle)
        return handle
      }
    },
    channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler, capabilities }),
    supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 } },
    report: () => undefined
  })
  const peer = await createManagedRuntimePeer(
    {
      self: { name: 'managed-binary-parent', instanceId: 'managed-binary-parent' },
      /** A real registration wall-time cap selects its stream control delegation as in production. */
      callDeadlineCapMs: 1000,
      provide: {
        parent: {
          started: () => {
            starts++
            return 1
          }
        }
      },
      retryPort,
      report: () => undefined,
      endpointFactory: async (channel) => {
        const endpoint = createRuntimeApiEndpoint(
          {
            id: 'managed-binary-parent',
            scheduler: channel.scheduler,
            transport: channel.transport,
            targetIds: [channel.peerId],
            middlewares: [
              codec(channel.pipeline.codec),
              framer(channel.pipeline.framer),
              connect({ transport: channel.transport }),
              abort(),
              timeout(),
              authentication({
                sign: (value) => ({ body: value, signature: signature(value) }),
                verify: (value) => {
                  const signed = value as { body: unknown; signature: string }
                  assert.equal(signed.signature, signature(signed.body))
                  return signed.body
                }
              })
            ]
          },
          channel
        )
        await endpoint.ready
        return {
          endpoint: endpoint as unknown as IRpcEndpoint,
          oneWay: endpoint,
          stream: endpoint.stream
        }
      }
    },
    binding,
    (channel, endpoint) => binding.bindEndpoint(channel, endpoint)
  )
  try {
    assert.equal(await peer.request('service.data.echo', 'control'), 'control')
    assert.equal(retries, 1, 'ordinary keyed work keeps its original retry port')
    retries = 0
    const backing = new Uint8Array([1, 2]).buffer
    const result = await peer
      .request('service.data.echo', backing, {
        transfer: [backing],
        idempotencyKey: 'native-bytes'
      })
      .catch((error: unknown) => error)
    assert.equal(
      backing.byteLength,
      0,
      'managed facade must carry explicit transfer to the genuine Worker'
    )
    assert.ok(result instanceof ArrayBuffer)
    assert.deepEqual([...new Uint8Array(result)], [1, 2])
    /** Explicit timeout keeps the original options object until registration copies it. */
    const hiddenBacking = new Uint8Array([5, 6]).buffer
    /** Own presence selects transfer even when the caller deliberately omits enumerability. */
    const hiddenOptions = Object.defineProperty({ timeoutMs: 1000 }, 'transfer', {
      value: [hiddenBacking]
    })
    /** This is a real second Worker call, not an options-copy helper assertion. */
    const hiddenResult = await peer.request('service.data.echo', hiddenBacking, hiddenOptions)
    assert.ok(hiddenResult instanceof ArrayBuffer)
    assert.deepEqual([...new Uint8Array(hiddenResult)], [5, 6])
    /** Lazy stream preparation crosses the same registration with an independent backing. */
    const streamBacking = new Uint8Array([7, 8]).buffer
    /** The same ownership selector must survive the stream's launcher-cap options copy. */
    const streamOptions = Object.defineProperty({ timeoutMs: 1000 }, 'transfer', {
      value: [streamBacking]
    })
    const stream = peer.stream('service.data.values', streamBacking, streamOptions)
    const streamed = await stream.next()
    assert.ok(streamed.value instanceof ArrayBuffer)
    assert.deepEqual([...new Uint8Array(streamed.value)], [7, 8])
    await stream.return!(undefined)
    assert.deepEqual(
      { request: hiddenBacking.byteLength, stream: streamBacking.byteLength },
      { request: 0, stream: 0 },
      'managed explicit timeout preserves non-enumerable own transfer in both modes'
    )
    assert.equal(
      retries,
      0,
      'even declared idempotent transfer work cannot enter the automatic retry port'
    )
    const first = readRuntimePeerConnection(peer).peerId
    const crashBuffer = new Uint8Array([3]).buffer
    const failure = await peer
      .request('service.data.crash', crashBuffer, {
        transfer: [crashBuffer],
        idempotencyKey: 'native-exit'
      })
      .catch((error: unknown) => error)
    assert.ok(failure instanceof Error)
    assert.equal(crashBuffer.byteLength, 0)
    await vi.waitFor(() => assert.notEqual(readRuntimePeerConnection(peer).peerId, first), {
      timeout: 3000
    })
    assert.equal(handles.length, 2)
    assert.equal(starts, 1, 'actual replacement never re-enters the detached operation')
    assert.equal(retries, 0)
  } finally {
    await peer.close()
    for (const handle of handles) handle.terminate()
    await Promise.all(handles.map((handle) => handle.exited))
  }
  assert.equal(budget.inUse, 0)
})

it('genuine managed binding rejects UInt8Array without bilateral binary before physical send', async () => {
  /** Both actual Worker channels negotiate the original scalar profile, omitting binary/transfer. */
  const scalarCapabilities = capabilities.filter(
    (value) =>
      !['portable-binary@1', 'native-binary-authenticated-manifest@1', 'transfer@1'].includes(value)
  )
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  /** This negative fixture's actual launch offer omits binary and transfer independently. */
  const native = createNodeThreadLauncher({
    runtimeApi: {
      self: { name: 'managed-no-binary-parent', instanceId: 'managed-no-binary-parent' },
      capabilities: scalarCapabilities
    }
  })
  /** Real native handles retain the original close and exit ownership during the negative case. */
  const handles: INodeThreadHandle[] = []
  const parentId = 'managed-no-binary-parent'
  const signature = (value: unknown) =>
    createHmac('sha256', fixture.key).update(JSON.stringify(value)).digest('hex')
  const binding = managedBinaryBinding({
    spec: { entry, data: { parentId, capabilities: scalarCapabilities } },
    budget,
    scheduler: systemScheduler,
    launcher: {
      ...native,
      launch: async (spec, context) => {
        const handle = await native.launch(spec, context)
        handles.push(handle)
        return handle
      }
    },
    channelFactory: createNodeThreadChannelFactory({
      scheduler: systemScheduler,
      capabilities: scalarCapabilities
    }),
    supervisor: { restart: { maxRestarts: 0 } },
    report: () => undefined
  })
  const peer = await createManagedRuntimePeer(
    {
      self: { name: parentId, instanceId: parentId },
      report: () => undefined,
      endpointFactory: async (channel) => {
        const endpoint = createRuntimeApiEndpoint(
          {
            id: parentId,
            scheduler: channel.scheduler,
            transport: channel.transport,
            targetIds: [channel.peerId],
            middlewares: [
              codec(channel.pipeline.codec),
              framer(channel.pipeline.framer),
              connect({ transport: channel.transport }),
              abort(),
              timeout(),
              authentication({
                sign: (value) => ({ body: value, signature: signature(value) }),
                verify: (value) => {
                  const signed = value as { body: unknown; signature: string }
                  assert.equal(signed.signature, signature(signed.body))
                  return signed.body
                }
              })
            ]
          },
          channel
        )
        await endpoint.ready
        return {
          endpoint: endpoint as unknown as IRpcEndpoint,
          oneWay: endpoint,
          stream: endpoint.stream
        }
      }
    },
    binding,
    (channel, endpoint) => binding.bindEndpoint(channel, endpoint)
  )
  try {
    assert.equal(await peer.request('service.data.echo', 'scalar-control'), 'scalar-control')
    const channel = readRuntimePeerConnection(peer).channel
    assert.equal(channel.agreement.capabilities.includes('portable-binary@1'), false)
    const send = vi.spyOn(channel.transport, 'send')
    try {
      const bytes = new Uint8Array([1, 2])
      const failure = await peer
        .request('service.data.echo', bytes)
        .catch((error: unknown) => error)
      assert.equal((failure as { code: string }).code, RpcCoreErrorCode.capabilityUnsupported)
      assert.equal(
        send.mock.calls.length,
        0,
        'binding cannot silently convert bytes to legacy numeric arrays'
      )
      assert.equal(bytes.byteLength, 2)
    } finally {
      send.mockRestore()
    }
  } finally {
    await peer.close()
    for (const handle of handles) handle.terminate()
    await Promise.all(handles.map((handle) => handle.exited))
  }
  assert.equal(budget.inUse, 0)
})
