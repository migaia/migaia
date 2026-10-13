import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createProcessPeer } from '@migaia/rpc-process'
import { createThreadPeer } from '@migaia/rpc-threads'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory,
  type INodeThreadHandle
} from '@migaia/rpc-threads/adapters/node'
import { createBrowserPeer } from '@migaia/rpc-browser'
import { defineProbe, RpcProbeStage, RpcProbeKind } from '@migaia/rpc-core/probe'
import type { IRuntimeDynamicSurface, IRuntimePeer } from '@migaia/rpc-core/remote'

/** Existing native fixtures exercise public source construction without another carrier owner. */
const workerEntry = fileURLToPath(
  new URL('../runtime-api/fixtures/directory-worker.mjs', import.meta.url)
)
/** This child discovers the launcher's real framed bootstrap and calls the exposed parent method. */
const processEntry = fileURLToPath(
  new URL('../runtime-api/fixtures/automatic-process.mjs', import.meta.url)
)

it('[A7] thread probe observes handshake, ready and a genuine supervised crash/restart', async () => {
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
  /** The public factory receives the probe directly through its inherited Runtime Peer option. */
  const peer = await createThreadPeer<IRuntimeDynamicSurface>({
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
  try {
    assert.equal(await peer.request('service.data.stable'), 3)
    assert.ok(
      lifecycle.includes('handshake'),
      '[A7] actual thread negotiation reaches the peer probe'
    )
    assert.ok(
      lifecycle.includes('ready'),
      '[A7] initial accepted thread readiness reaches the probe'
    )
    handles[0]!.terminate()
    await handles[0]!.exited
    await vi.waitFor(() => assert.ok(lifecycle.includes('restart')), { timeout: 3000 })
    await vi.waitFor(() => assert.equal(lifecycle.filter((value) => value === 'ready').length, 2), {
      timeout: 3000
    })
    assert.equal(await peer.request('service.data.stable'), 3)
    assert.deepEqual(reports, [])
  } finally {
    await peer.close()
    for (const handle of handles) handle.terminate()
    await Promise.all(handles.map((handle) => handle.exited))
  }
  assert.equal(budget.inUse, 0)
}, 15000)

it('[A7] process spawn:true forwards probe through ordinary entry discovery and emits handshake/ready', async () => {
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
  /** Construction owns the real child; restoration happens before business assertions. */
  let peer: IRuntimePeer | undefined
  process.argv = [process.execPath, processEntry]
  try {
    peer = await createProcessPeer<IRuntimeDynamicSurface>({
      self: { name: 'probe-parent', instanceId: 'probe-process-parent' },
      provide: { parentEcho: () => 'probe-process-parent' },
      spawn: true,
      probe,
      report: (error) => reports.push(error)
    })
  } finally {
    process.argv = argv
  }
  try {
    assert.equal(((await peer.request('probe', 'observed')) as { value: string }).value, 'observed')
    assert.ok(lifecycle.includes('handshake'), '[A7] process negotiation reaches the peer probe')
    assert.ok(lifecycle.includes('ready'), '[A7] process readiness reaches the peer probe')
    assert.deepEqual(probeErrors, [])
    for (const report of reports)
      assert.deepEqual(
        {
          source: (report as { source?: unknown }).source,
          code: (report as { code?: unknown }).code
        },
        { source: '@migaia/supervision', code: 'CAPABILITY_UNSUPPORTED' },
        '[A7] only the existing best-effort termination notice reaches the Peer reporter'
      )
  } finally {
    await peer.close()
  }
}, 15000)

/** Compile-time fixture: Browser Peer inherits one probe and a readonly array without carrier tests. */
export function browserProbeOptionFixture(
  options: Omit<Parameters<typeof createBrowserPeer>[0], 'probe'>
) {
  /** The function is checked by tsc and never executed by this Node test. */
  const probe = defineProbe({ stages: ['peer'], emit: () => undefined })
  createBrowserPeer({ ...options, probe })
  createBrowserPeer({ ...options, probe: [probe] as const })
}
