import { runtimeTestHost } from './fixture.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { definePlugin, defineFeature } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createThreadPlugin } from '../../src/threads/index.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory,
  type INodeThreadHandle
} from '../../src/threads/adapters/node.js'
import { createRuntimeApiEndpoint } from '../../src/core/internal/runtime-api-endpoint.js'
import { codec } from '../../src/core/middleware/codec.js'
import { framer } from '../../src/core/middleware/framer.js'
import { abort } from '../../src/core/middleware/abort.js'
import { connect } from '../../src/core/middleware/connect.js'
import { ping } from '../../src/core/middleware/ping.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'

/** Every case restarts the same genuine Worker used by the original generation acceptance. */
const entry = fileURLToPath(new URL('./fixtures/managed-worker.mjs', import.meta.url))

for (const unavailable of [
  'exposed-disabled',
  'exposed-suspended',
  'exposed-unloaded',
  'connection-disabled',
  'connection-suspended'
] as const) {
  it(`[A13][A17][C4-fix:M1] native rebind survives ${unavailable} and resumes real calls`, async () => {
    const host = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
    const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
    const launcher = createNodeThreadLauncher()
    const handles: INodeThreadHandle[] = []
    const reports: unknown[] = []
    /** Count genuine parent business, independently from the child probe's provider. */
    let calls = 0
    /** Completion of the selected original endpoint proves readProvide has already completed. */
    let constructed = 0
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
        },
        endpointFactory: async (channel) => {
          const endpoint = await createRuntimeApiEndpoint(
            {
              id: 'availability-parent',
              targetIds: [channel.peerId],
              transport: channel.transport,
              features: channel.features,
              scheduler: channel.scheduler,
              middlewares: [
                codec(channel.pipeline.codec),
                framer(channel.pipeline.framer),
                abort(),
                connect({ transport: channel.transport }),
                ping()
              ]
            },
            { supports: () => true },
            true
          )
          constructed += 1
          return {
            endpoint: endpoint as unknown as IRpcEndpoint,
            oneWay: endpoint,
            stream: endpoint.stream
          }
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
      const first = (await host.thread!.request('bridge', 'probe', 'ordinary')) as {
        parent: number
      }
      assert.equal(first.parent, 42)
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
      /**
       * Baseline reports preparation failure; fixed code constructs a new endpoint despite
       * unavailable business.
       */
      await vi.waitFor(() => assert.ok(constructed === 2 || reports.length > 0), { timeout: 3000 })
      calls = 0
      /** Local outlet denial and inbound Feature denial must retain their exact registered owner. */
      const expected = unavailable.startsWith('connection-')
        ? { source: '@migaia/rpc/core', code: 'TARGET_UNKNOWN' }
        : {
            source: '@migaia/plugin-host',
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
      assert.equal(
        reports.length,
        0,
        '[A13] availability denial is per call, never a rebind failure'
      )
      assert.equal(calls, 0, '[A13] unavailable exposed provider executes zero times')
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
            '[C4-fix:M1] restored availability reaches the prepared successor'
          )
        },
        { timeout: 3000 }
      )
      assert.equal(constructed, 2, '[C4-fix:M1] recovery never opens a third endpoint')
    } finally {
      await host.dispose()
      for (const handle of handles) handle.terminate()
      await Promise.all(handles.map((handle) => handle.exited))
    }
    assert.equal(budget.inUse, 0)
  })
}
