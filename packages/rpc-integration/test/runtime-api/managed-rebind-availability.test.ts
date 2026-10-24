import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { definePlugin, defineFeature } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { threadProtocolDefinition as createThreadPlugin } from './fixtures/thread-protocol.js'
import { type INodeThreadHandle } from '../../../rpc-plugin-thread/dist/threads/node-launcher.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../../rpc-plugin-thread/dist/threads/adapters/node.js'
import { readRuntimePeerEndpoint } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import { readEndpointOwner } from '../../../rpc-host/dist/core/internal/endpoint-projection.js'
import type { IEndpointKernelHost } from '../../../rpc-host/dist/core/endpoint-kernel.js'
import { RuntimeEventName } from '../../../rpc-host/dist/remote/runtime-api/constants.js'
import { deferred } from '@migaia/utils/promise'

/** Every case restarts the same genuine Worker used by the original generation acceptance. */
const entry = fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url))

for (const unavailable of [
  'exposed-disabled',
  'exposed-suspended',
  'exposed-unloaded',
  'connection-disabled',
  'connection-suspended'
] as const) {
  it(`native rebind survives ${unavailable} and resumes real calls`, async () => {
    const host = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
    const launcher = createNodeThreadLauncher()
    const handles: INodeThreadHandle[] = []
    const reports: unknown[] = []
    /** Count genuine parent business, independently from the child probe's provider. */
    let calls = 0
    /** The actual successor publication proves its preparation finished before business admission. */
    const rebound = deferred<void>()
    /** This exact native outlet event receipt is released with the case's Host resources. */
    let stopReady: (() => void) | undefined
    const gate = definePlugin({
      name: 'gate',
      features: { data: defineFeature(() => ({ read: () => 42 })) },
      install: () => ({})
    })
    const parent = definePlugin({
      name: 'parent',
      features: {
        data: defineFeature(
          (_core, dependencies) => ({
            echo: () => {
              calls += 1
              return dependencies.gate.read()
            }
          }),
          { gate: gate.getFeature('data') }
        )
      },
      install: () => ({})
    })
    try {
      await host.use(gate, parent)
      const plugin = createThreadPlugin({
        name: 'bridge',
        self: { name: 'availability-parent', instanceId: 'availability-parent' },
        expose: ['parent'],
        report: (error) => reports.push(error),
        spawn: {
          spec: { entry, name: 'availability-child' },
          budget,
          scheduler: systemScheduler,
          launcher: {
            ...launcher,
            launch: async (...args: Parameters<typeof launcher.launch>) => {
              const handle = await launcher.launch(...args)
              handles.push(handle)
              return handle
            }
          },
          channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
          supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 } },
          report: (error) => reports.push(error)
        }
      })
      await host.use(
        unavailable === 'connection-suspended'
          ? definePlugin({
              ...plugin,
              features: {
                permission: defineFeature(
                  (_core, dependencies) => ({ read: dependencies.gate.read }),
                  { gate: gate.getFeature('data') }
                )
              }
            })
          : plugin
      )
      stopReady = host.thread!.on(RuntimeEventName.ready, (event) => {
        if (event.name === 'bridge' && event.generation === 2) rebound.resolve()
      })
      const first = (await host.thread!.request('bridge', 'probe', 'ordinary')) as {
        parent: number
      }
      assert.equal(first.parent, 42)
      /** Read the first genuine Host kernel through its accepted managed Peer projection. */
      const kernel = readEndpointOwner<IEndpointKernelHost>(
        readRuntimePeerEndpoint(readRuntimeOutletConnection(host.thread, 'bridge')!.peer).endpoint,
        'kernel'
      )!
      assert.ok(kernel)
      /** Unload and enablement use only the original Host mutation API. */
      const disabled =
        unavailable === 'exposed-unloaded'
          ? undefined
          : await host.plugin.disable(
              unavailable === 'connection-disabled'
                ? 'bridge'
                : unavailable.endsWith('suspended')
                  ? 'gate'
                  : 'parent',
              unavailable.endsWith('suspended') ? { policy: 'suspend' } : undefined
            )
      if (unavailable === 'exposed-unloaded') await host.unUse('parent')
      handles[0]!.terminate()
      await handles[0]!.exited
      await vi.waitFor(() => assert.equal(handles.length, 2), { timeout: 3000 })
      await rebound.promise
      if (unavailable.startsWith('connection-'))
        assert.equal(
          readRuntimeOutletConnection(host.thread, 'bridge'),
          undefined,
          'disabled connection cannot expose its otherwise prepared native receipt'
        )
      else
        assert.equal(
          readEndpointOwner(
            readRuntimePeerEndpoint(readRuntimeOutletConnection(host.thread, 'bridge')!.peer)
              .endpoint,
            'kernel'
          ),
          kernel,
          'the committed successor borrows the original Host endpoint'
        )
      calls = 0
      /** Local outlet denial and inbound Feature denial must retain their exact registered owner. */
      const expected = unavailable.startsWith('connection-')
        ? { source: 'rpc.endpoint', code: 'TARGET_UNKNOWN' }
        : {
            source: 'plugin.host',
            code:
              unavailable === 'exposed-unloaded'
                ? 'PLUGIN_NOT_INSTALLED'
                : unavailable === 'exposed-suspended'
                  ? 'PLUGIN_SUSPENDED'
                  : 'PLUGIN_DISABLED'
          }
      /** Endpoint construction precedes publication; wait for the original owner's exact denial. */
      await vi.waitFor(
        async () => {
          const denied = await Promise.resolve()
            .then(() => host.thread!.request('bridge', 'probe', 'unavailable'))
            .then(
              () => undefined,
              (error: unknown) => error
            )
          /** Serialized wrappers keep the original permission error on their bounded cause chain. */
          let original = denied
          for (let depth = 0; depth < 8 && original && typeof original === 'object'; depth += 1) {
            if (
              Reflect.get(original, 'source') === expected.source &&
              Reflect.get(original, 'code') === expected.code
            )
              break
            original = Reflect.get(original, 'cause')
          }
          assert.ok(original && typeof original === 'object')
          assert.equal(Reflect.get(original, 'source'), expected.source)
          assert.equal(Reflect.get(original, 'code'), expected.code)
        },
        { timeout: 3000 }
      )
      /** Default assembly reports the original business failure through its existing hook. */
      const businessReports = reports.filter(
        (error) =>
          error instanceof Error &&
          Reflect.get(error, 'source') === expected.source &&
          Reflect.get(error, 'code') === expected.code
      )
      assert.equal(
        businessReports.length,
        unavailable.startsWith('connection-') ? 0 : 1,
        'the canonical hook reports exactly the actual inbound permission denial'
      )
      assert.equal(
        reports.length - businessReports.length,
        0,
        'availability denial is per call, never a rebind failure'
      )
      assert.equal(calls, 0, 'unavailable exposed provider executes zero times')
      if (disabled) await disabled.token.enable()
      else await host.use(parent)
      await vi.waitFor(
        async () => {
          const current = await Promise.resolve()
            .then(() => host.thread!.request('bridge', 'probe', 'restored'))
            .catch((error: unknown) => error)
          assert.equal(
            (current as { parent?: number }).parent,
            42,
            'restored availability reaches the prepared successor'
          )
        },
        { timeout: 3000 }
      )
      assert.equal(
        readEndpointOwner(
          readRuntimePeerEndpoint(readRuntimeOutletConnection(host.thread, 'bridge')!.peer)
            .endpoint,
          'kernel'
        ),
        kernel,
        'availability recovery retains the exact original Host endpoint'
      )
    } finally {
      stopReady?.()
      await host.dispose()
      for (const handle of handles) handle.terminate()
      await Promise.all(handles.map((handle) => handle.exited))
    }
    assert.equal(budget.inUse, 0)
  })
}
