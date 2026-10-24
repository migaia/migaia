import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { RuntimeEventName, RuntimePluginKey } from '@migaia/rpc-host/plugin'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { type INodeThreadHandle } from '../../../rpc-plugin-thread/dist/threads/node-launcher.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory
} from '../../../rpc-plugin-thread/dist/threads/adapters/node.js'
import { createRpcHost, type IRpcHostOptions } from '@migaia/rpc-host'
import { windowPlugin } from '@migaia/rpc-plugin-browser'
import { defineProbe, RpcProbeStage, RpcProbeKind } from '@migaia/rpc-host/probe'
import { defineFeaturePlugin, type IRuntimePeer } from '@migaia/rpc-host/plugin'

/** Existing native fixtures exercise public source construction without another carrier owner. */
const workerEntry = fileURLToPath(
  new URL('../runtime-api/fixtures/directory-worker.mjs', import.meta.url)
)
/** This child discovers the launcher's real framed bootstrap and calls the exposed parent method. */
const processEntry = fileURLToPath(
  new URL('../runtime-api/fixtures/automatic-process.mjs', import.meta.url)
)

it('thread probe observes handshake, ready and a genuine supervised crash/restart', async () => {
  /** Retain lifecycle strings synchronously; the reusable event view never escapes emit. */
  const lifecycle: string[] = []
  /** Reporting remains observable and separate from the business result. */
  const reports: unknown[] = []
  /** Only the peer stage is required for this cross-carrier acceptance. */
  const probe = defineProbe({
    stages: ['peer'],
    emit(view) {
      assert.equal(view.stage, RpcProbeStage.peer)
      assert.equal(view.kind, RpcProbeKind.lifecycle)
      lifecycle.push(view.lifecycle!)
    },
    onError: (error) => reports.push(error)
  })
  /** Original supervision owns native launch, replacement and final liquidation. */
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  /** The wrapper records actual handles while retaining the canonical native launcher. */
  const launcher = createNodeThreadLauncher()
  /** A real termination causes the existing supervisor to restart, rather than calling restart(). */
  const handles: INodeThreadHandle[] = []
  /** The actual Host owns supervised native installation and its rollback. */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The public factory receives the probe directly through its inherited Runtime Peer option. */
  const peer = await host
    .use(
      threadPlugin({
        probe,
        spawn: {
          spec: { entry: workerEntry, data: { sequence: 1 } },
          budget,
          scheduler: systemScheduler,
          launcher: {
            ...launcher,
            launch: async (spec, context) => {
              const handle = await launcher.launch(spec, context)
              handles.push(handle)
              return handle
            }
          },
          channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
          supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 } },
          report: (error) => reports.push(error)
        },
        report: (error) => reports.push(error)
      })
    )
    .then(() => readRuntimeOutletConnection(host.thread, RuntimePluginKey.thread)!.peer!)
  /** Physical probe readiness precedes the managed registration's accepted generation pointer. */
  const acceptedGenerations = new Set<number>()
  /** Observe the existing outlet receipt before causing the genuine native crash. */
  const stopReady = host.thread!.on(RuntimeEventName.ready, (event) => {
    if (typeof event.generation === 'number') acceptedGenerations.add(event.generation)
  })
  try {
    assert.equal(await peer.request('service.data.stable'), 3)
    assert.ok(lifecycle.includes('handshake'), 'actual thread negotiation reaches the peer probe')
    assert.ok(lifecycle.includes('ready'), 'initial accepted thread readiness reaches the probe')
    handles[0]!.terminate()
    await handles[0]!.exited
    await vi.waitFor(() => assert.ok(lifecycle.includes('restart')), { timeout: 3000 })
    await vi.waitFor(
      () => {
        assert.equal(lifecycle.filter((value) => value === 'ready').length, 2)
        assert.ok(acceptedGenerations.has(2), 'the managed registration accepts generation two')
      },
      { timeout: 3000 }
    )
    assert.equal(await peer.request('service.data.stable'), 3)
    assert.deepEqual(reports, [])
  } finally {
    stopReady()
    await host.dispose()
    for (const handle of handles) handle.terminate()
    await Promise.all(handles.map((handle) => handle.exited))
  }
  assert.equal(budget.inUse, 0)
}, 15000)

it('process spawn:true forwards probe through ordinary entry discovery and emits handshake/ready', async () => {
  /** Lifecycle strings are copied as scalar fixture observations during the synchronous callback. */
  const lifecycle: string[] = []
  /** Probe callback failures are retained rather than silently swallowed by this fixture. */
  const probeErrors: unknown[] = []
  /** Peer diagnostics; best-effort process isolation reports its unsupported termination capability. */
  const reports: unknown[] = []
  /** The same public probe option reaches managed short process sources. */
  const probe = defineProbe({
    stages: ['peer'],
    emit: (view) => lifecycle.push(view.lifecycle!),
    onError: (error) => probeErrors.push(error)
  })
  /** Spawn:true uses argv[1]; temporarily select the existing child fixture as the ordinary entry. */
  const argv = process.argv
  /** The actual Host owns the short native source and its committed managed Peer. */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Construction owns the real child; restoration happens before business assertions. */
  let peer!: IRuntimePeer
  process.argv = [process.execPath, processEntry]
  try {
    peer = await host
      .use(
        processPlugin({
          self: { name: 'probe-parent', instanceId: 'probe-process-parent' },
          provide: { parentEcho: () => 'probe-process-parent' },
          spawn: true,
          probe,
          report: (error) => reports.push(error)
        })
      )
      .then(() => readRuntimeOutletConnection(host.process, RuntimePluginKey.process)!.peer!)
  } finally {
    process.argv = argv
  }
  try {
    assert.equal(((await peer.request('probe', 'observed')) as { value: string }).value, 'observed')
    assert.ok(lifecycle.includes('handshake'), 'process negotiation reaches the peer probe')
    assert.ok(lifecycle.includes('ready'), 'process readiness reaches the peer probe')
    assert.deepEqual(probeErrors, [])
    for (const report of reports)
      assert.deepEqual(
        {
          source: (report as { source?: unknown }).source,
          code: (report as { code?: unknown }).code
        },
        { source: 'supervision', code: 'CAPABILITY_UNSUPPORTED' },
        'only the existing best-effort termination notice reaches the Peer reporter'
      )
  } finally {
    await host.dispose()
  }
}, 15000)

/** Compile-time fixture: browser Hosts consume one probe or a readonly probe array through features. */
export function browserProbeOptionFixture(
  options: Omit<IRpcHostOptions, 'plugins' | 'probe'> &
    Readonly<{ window: Parameters<typeof windowPlugin>[0] }>
) {
  /** The function is checked by tsc and never executed by this Node test. */
  const probe = defineProbe({ stages: ['peer'], emit: () => undefined })
  /** Native carrier preparation and Host probe configuration retain their separate public owners. */
  const { window, ...host } = options
  createRpcHost({
    ...host,
    plugins: [
      windowPlugin(window),
      defineFeaturePlugin({ name: 'browser-probe', contribution: { probe } })
    ]
  })
  createRpcHost({
    ...host,
    plugins: [
      windowPlugin(window),
      defineFeaturePlugin({ name: 'browser-probes', contribution: { probe: [probe] as const } })
    ]
  })
}
