import assert from 'node:assert/strict'
import { MessageChannel } from 'node:worker_threads'
import { it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createRpcHost } from '@migaia/rpc-host'
import { createThreadRuntimeBootstrap } from '../../../rpc-plugin-thread/dist/threads/bootstrap.js'
import {
  createAdapterDeployment,
  createAdapterSourceConfigurationError,
  createEventTargetMessageResource,
  defineTransportPlugin,
  holdAdapterMessageBootstrapSource,
  RpcTransportMode
} from '@migaia/rpc-host/plugin'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { ThreadBootstrap } from '../../../rpc-plugin-thread/dist/threads/constants.js'
import { createRuntimePeer } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { NativeProcessRuntimeLoader } from '../../../rpc-plugin-process/dist/process/runtime-loader.js'
import type { IThreadWebPort } from '../../../rpc-plugin-thread/dist/threads/types.js'
import {
  PROCESS_RUNTIME_API_ENV,
  PROCESS_RUNTIME_API_ENV_VERSION
} from '../../../rpc-plugin-process/dist/process/constants.js'

it('automatic EventTarget handoff preserves real business and original parent identity', async () => {
  /**
   * Native ports deliver the bootstrap and all later business frames through real EventTarget
   * callbacks.
   */
  const ports = new MessageChannel()
  const failures: unknown[] = []
  const child = createRpcHost({
    provide: { double: (value: number) => value * 2 },
    report: (error) => failures.push(error),
    plugins: [
      defineTransportPlugin({
        name: 'parent',
        mode: RpcTransportMode['connect-to-parent'],
        deployment: createAdapterDeployment({
          open: async () => {
            throw createAdapterSourceConfigurationError()
          },
          bootstrap: (context) =>
            holdAdapterMessageBootstrapSource(
              createEventTargetMessageResource(ports.port2 as unknown as IThreadWebPort),
              { connectTimeoutMs: context.connectTimeoutMs, report: context.report }
            )
        })
      })
    ]
  })
  const parent = await createRuntimePeer({
    self: { name: 'automatic-parent', instanceId: 'automatic-parent-instance' },
    connect: async (context) => {
      const bootstrap = createThreadRuntimeBootstrap(
        'automatic-child',
        'automatic-child-instance',
        {
          ...context,
          capabilities: context.capabilities
        }
      )
      /** The real parent port gives Core the original cold capture and observed child ACK. */
      const resource = createEventTargetMessageResource(ports.port1 as unknown as IThreadWebPort)
      /** Actual outbound launch data remains a local proposal rather than an accepted claim. */
      const initial = {
        kind: ThreadBootstrap.data,
        peerId: bootstrap.self.instanceId,
        runtimeApi: bootstrap
      }
      resource.prepareControl(context.capabilities, { read: () => initial, direction: 'outbound' })
      ports.port1.postMessage(initial)
      return resource.open({
        peerId: bootstrap.self.instanceId,
        scheduler: systemScheduler,
        offer: context.capabilities,
        control: rpcMessageCapabilityControl
      })
    },
    report: (error) => failures.push(error)
  })
  const accepted = await child
  try {
    assert.equal(await parent.request('double', 21), 42)
    assert.equal(accepted.self.name, 'automatic-child')
    assert.equal(accepted.self.instanceId, 'automatic-child-instance')
    assert.equal(failures.length, 0)
    const closing = accepted.close()
    assert.equal(accepted.close(), closing)
    await closing
  } finally {
    await parent.close()
    await accepted.close()
    ports.port1.close()
    ports.port2.close()
  }
})

it('automatic Web source rejects malformed bootstrap without publication', async () => {
  const ports = new MessageChannel()
  try {
    const rejected = createRpcHost({
      report: () => undefined,
      plugins: [
        defineTransportPlugin({
          name: 'parent',
          mode: RpcTransportMode['connect-to-parent'],
          deployment: createAdapterDeployment({
            open: async () => {
              throw createAdapterSourceConfigurationError()
            },
            bootstrap: (context) =>
              holdAdapterMessageBootstrapSource(
                createEventTargetMessageResource(ports.port2 as unknown as IThreadWebPort),
                { connectTimeoutMs: context.connectTimeoutMs, report: context.report }
              )
          })
        })
      ]
    })
    const observed = assert.rejects(rejected, { code: 'INVALID_CONFIG' })
    ports.port1.postMessage({ kind: ThreadBootstrap.data, peerId: 'child', runtimeApi: null })
    await observed
  } finally {
    ports.port1.close()
    ports.port2.close()
  }
})

it('automatic process failure closes its original channel and reports cleanup once', async () => {
  let opens = 0
  let closes = 0
  const cleanup = new RangeError('automatic-process cleanup fixture')
  const reported: unknown[] = []
  /** Marker and explicit-source rejection happen before the one process reader is claimed. */
  const platform = {
    marker: 'unsupported',
    runtime: 'node',
    open: async () => {
      opens++
      return {
        channel: {
          kind: 'byte' as const,
          write: async () => undefined,
          onData: () => () => undefined,
          onClose: () => () => undefined,
          close: async () => {
            closes++
            throw cleanup
          }
        }
      }
    }
  }
  /** Actual processPlugin bootstrap owns the one-reader claim and original rollback reporter. */
  const load = vi.spyOn(NativeProcessRuntimeLoader.prototype, 'load').mockImplementation(() =>
    Promise.resolve({
      processRuntimeIO: {
        discover: () => ({ marker: platform.marker, runtime: platform.runtime }),
        open: platform.open
      }
    })
  )
  vi.stubEnv(PROCESS_RUNTIME_API_ENV, PROCESS_RUNTIME_API_ENV_VERSION)
  try {
    await assert.rejects(
      createRpcHost({
        report: (error) => reported.push(error),
        plugins: [processPlugin({ connectToParent: true })]
      }),
      { code: 'INVALID_CONFIG' }
    )
    assert.equal(opens, 0)
    platform.marker = PROCESS_RUNTIME_API_ENV_VERSION
    await assert.rejects(
      createRpcHost({
        report: (error) => reported.push(error),
        plugins: [processPlugin({ connectToParent: true })]
      }),
      { code: 'INVALID_CONFIG' }
    )
    assert.equal(opens, 1)
    assert.equal(closes, 1)
    assert.deepEqual(reported, [cleanup])
    await assert.rejects(
      createRpcHost({
        report: () => undefined,
        plugins: [processPlugin({ connectToParent: true })]
      }),
      { code: 'INVALID_CONFIG' }
    )
    assert.equal(opens, 1, 'failed bootstrap never permits a second process reader')
  } finally {
    load.mockRestore()
    vi.unstubAllEnvs()
  }
})
