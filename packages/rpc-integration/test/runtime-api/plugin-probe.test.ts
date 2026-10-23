import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { deferred } from '@migaia/utils/promise'
import { coroutinePlugin } from '@migaia/rpc-plugin-coroutines'
import { defineProbe, RpcProbeDirection, RpcProbeKind } from '@migaia/rpc-host/probe'
import { createProcessPlugin } from '../../../rpc-plugin-process/test/protocol.ts'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { createNodeProcessLauncher } from '@migaia/rpc-plugin-process/adapters/node-child-process'
import { threadProtocolDefinition as createThreadPlugin } from './fixtures/thread-protocol.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '@migaia/rpc-plugin-thread/adapters/node'
import type { ISpawnProcessPluginDeployment } from '../../../rpc-plugin-process/dist/process/plugin/types.js'
import { coroutineAbort, coroutineTestHost } from './fixtures/coroutine.js'

/** Native fixtures load public built entries independently from the parent test realm. */
const entry = fileURLToPath(new URL('./fixtures/plugin-probe-child.ts', import.meta.url))
/** Each endpoint has independent physical observation counts, copied from ephemeral event views. */
type ICounts = Record<string, { inbound: number; outbound: number }>

for (const family of ['process', 'thread', 'coroutine'] as const) {
  it(`${family} Plugin probe observes both sides of two genuine connections`, async () => {
    /** A real parent Host owns both distinct Plugin installations and original resource scopes. */
    const host = coroutineTestHost()
    /** Shared observer must observe each connection independently rather than one aggregate count. */
    const counts: ICounts = {}
    /** Readiness comes from both child Host commits, not merely physical launch completion. */
    const ready = deferred<void>()
    /** Exactly two independently installed children must report their committed authority. */
    let committed = 0
    /** Genuine platform handles remain available only for test cleanup after Host disposal. */
    const threads: Awaited<ReturnType<ReturnType<typeof createNodeThreadLauncher>['launch']>>[] = []
    /** Original process exit Promises independently prove native resource cleanup. */
    const processes: Awaited<ReturnType<ReturnType<typeof createNodeProcessLauncher>['launch']>>[] =
      []
    /** Public logical probes count actual requests without requiring content capture. */
    const probe = defineProbe({
      stages: ['message'],
      emit(view) {
        if (view.kind !== RpcProbeKind.request) return
        /** Preserve one counter per local endpoint; views cannot escape synchronous emit. */
        const count = counts[view.endpointId] ?? { inbound: 0, outbound: 0 }
        if (view.direction === RpcProbeDirection.inbound) count.inbound += 1
        if (view.direction === RpcProbeDirection.outbound) count.outbound += 1
        counts[view.endpointId] = count
      }
    })
    try {
      await host.use(
        definePlugin({
          name: 'parent',
          features: {
            methods: defineFeature(() => ({
              /** Reverse business dispatch proves the child actually sent a request. */
              read: (payload: unknown) => ['parent', payload],
              /** The second independent child commit opens the business-call barrier. */
              ready: () => {
                committed += 1
                if (committed === 2) ready.resolve()
              }
            }))
          },
          install: () => ({})
        })
      )
      for (const index of [0, 1]) {
        /** Explicit distinct parent addresses make missed per-connection observation detectable. */
        const common = {
          name: `probe-${index}`,
          self: { name: `parent-${index}`, instanceId: `a4-${family}-parent-${index}` },
          expose: ['parent'] as const,
          probe,
          report: () => undefined
        }
        if (family === 'thread') {
          /** Caller-selected native launcher stays the sole Worker construction owner. */
          const launcher = createNodeThreadLauncher()
          await host.use(
            createThreadPlugin({
              ...common,
              spawn: {
                spec: { entry, name: `probe-child-${index}` },
                budget: createUnitBudget({ kind: 'thread', maxUnits: 1 }),
                scheduler: systemScheduler,
                launcher: {
                  ...launcher,
                  launch: async (...args: Parameters<typeof launcher.launch>) => {
                    /** This receipt is the actual constructed native Worker handle. */
                    const handle = await launcher.launch(...args)
                    threads.push(handle)
                    return handle
                  }
                },
                channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
                report: () => undefined
              }
            })
          )
        } else if (family === 'process') {
          /** Existing byte deployment uses genuine bootstrap and canonical process establishment. */
          const launcher = createNodeProcessLauncher()
          /** Raw channel belongs to this exact launcher handle. */
          let handle: Awaited<ReturnType<typeof launcher.launch>> | undefined
          /** Authentication fixture data is confined to native bootstrap and transport handshake. */
          const token = `process-fixture-${index}`
          /** This complete existing deployment delegates execution and channel ownership inward. */
          const spawn: ISpawnProcessPluginDeployment = {
            kind: 'spawn',
            channelKind: 'byte',
            wire: 'native',
            token,
            supervision: {
              id: `process-${index}`,
              spec: {
                command: process.execPath,
                args: [entry],
                env: { inherit: ['PATH'], set: {} },
                stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
                bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
              },
              budget: createUnitBudget({ kind: 'process', maxUnits: 1 }),
              isolation: 'best-effort',
              report: () => undefined,
              launcher: {
                ...launcher,
                launch: async (spec, context) => {
                  handle = await launcher.launch(spec, context)
                  processes.push(handle)
                  return handle
                }
              }
            },
            rawChannel: async () => handle!.channel!,
            establish: async (raw, prepared) =>
              createProcessTransport(raw as NonNullable<typeof handle>['channel'] & object, {
                role: 'initiator',
                offer: prepared.offer!,
                peerId: handle!.runtimeApiIdentity!.instanceId,
                scheduler: prepared.scheduler,
                ipc: { ...prepared.session, log: () => undefined },
                report: () => undefined
              })
          }
          await host.use(createProcessPlugin({ ...common, spawn }))
        } else {
          await host.use(
            coroutinePlugin({
              ...common,
              spawn: async (context) => {
                /** Each task owns an independent connected Host, matching native child construction. */
                const child = coroutineTestHost()
                /** Child probe counters use a distinct observer even though the realm is shared. */
                const childCounts: ICounts = {}
                /** Public child observer follows the same Plugin forwarding path as native children. */
                const childProbe = defineProbe({
                  stages: ['message'],
                  emit(view) {
                    if (view.kind !== RpcProbeKind.request) return
                    /** Scalar counts cannot retain the emitter's reusable event record. */
                    const count = childCounts[view.endpointId] ?? { inbound: 0, outbound: 0 }
                    if (view.direction === RpcProbeDirection.inbound) count.inbound += 1
                    if (view.direction === RpcProbeDirection.outbound) count.outbound += 1
                    childCounts[view.endpointId] = count
                  }
                })
                try {
                  await child.use(
                    definePlugin({
                      name: 'service',
                      features: {
                        methods: defineFeature(() => ({
                          /** Forward calls prove normal connected provider execution. */
                          read: (payload: unknown) => payload,
                          /** Reverse calls prove the connected child sends genuine requests. */
                          reverse: (payload: unknown) =>
                            child.coroutine!.request('bridge', 'parent.read', payload),
                          /** Copy counts for the parent's independent acceptance assertion. */
                          stats: () => ({ counts: structuredClone(childCounts) })
                        }))
                      },
                      install: () => ({})
                    })
                  )
                  await child.use(
                    coroutinePlugin({
                      name: 'bridge',
                      connectToParent: context.connect,
                      expose: ['service'],
                      probe: childProbe,
                      report: () => undefined
                    })
                  )
                  committed += 1
                  if (committed === 2) ready.resolve()
                  await coroutineAbort(context.signal)
                } finally {
                  await child.dispose()
                }
              }
            })
          )
        }
      }
      await ready.promise
      for (const index of [0, 1]) {
        /** This family outlet remains the true shared Host publication authority. */
        const outlet = host[family]!
        assert.equal(await outlet.request(`probe-${index}`, 'service.read', index), index)
        assert.deepEqual(await outlet.request(`probe-${index}`, 'service.reverse', index), [
          'parent',
          index
        ])
        /** Child counters travel over the same connection being observed. */
        const child = (await outlet.request(`probe-${index}`, 'service.stats')) as {
          counts: ICounts
        }
        assert.equal(
          Object.keys(child.counts).length,
          1,
          'child Plugin forwards its probe to its actual endpoint'
        )
        for (const count of Object.values(child.counts)) {
          assert.ok(count.inbound > 0, 'child sees inbound business requests')
          assert.ok(count.outbound > 0, 'child sees outbound reverse requests')
        }
        /** No aggregate threshold can hide a missing second parent connection. */
        const parent = counts[`a4-${family}-parent-${index}`]
        assert.ok(parent, 'parent probe records every installed connection')
        assert.ok(parent.inbound > 0, 'parent sees reverse business requests')
        assert.ok(parent.outbound > 0, 'parent sees forward business requests')
      }
      assert.equal(Object.keys(counts).length, 2)
    } finally {
      await host.dispose()
      for (const handle of threads) handle.terminate()
      for (const handle of processes) handle.terminate('force')
      await Promise.all([
        ...threads.map((handle) => handle.exited),
        ...processes.map((handle) => handle.exited)
      ])
    }
  }, 15000)
}
