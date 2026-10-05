import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { it, vi } from 'vitest'
import { createUnitBudget } from '@migaia/supervision'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createThreadPeer } from '../../src/threads/index.js'
import {
  createNodeThreadLauncher,
  createNodeThreadChannelFactory,
  type INodeThreadHandle
} from '../../src/threads/adapters/node.js'
import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import { readRuntimePeerConnection } from '../../src/remote/runtime-api/peer.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'

/** A genuine Worker replacement changes the installed method set and one actual route mode. */
const entry = fileURLToPath(new URL('./fixtures/directory-worker.mjs', import.meta.url))

it('[A82][A83] accepted native generations report added/removed/modeChanged without rejecting asymmetric directories', async () => {
  /** Native accounting and exits remain the original supervisor/launcher owners. */
  const budget = createUnitBudget({ kind: 'thread', maxUnits: 1 })
  /** Wrapping records handles and business data without replacing native launch. */
  const native = createNodeThreadLauncher()
  /** Each handle independently proves a real native replacement and eventual exit. */
  const handles: INodeThreadHandle[] = []
  /** The existing application reporter observes only accepted-directory changes. */
  const reports: unknown[] = []
  /** Business fixture variants follow the original launch sequence. */
  let sequence = 0
  /** The public facade retains the same original supervisor across all three Workers. */
  const peer = await createThreadPeer<IRuntimeDynamicSurface>({
    provide: { parentOnly: () => 9 },
    spawn: {
      spec: { entry },
      budget,
      scheduler: systemScheduler,
      launcher: {
        ...native,
        launch: async (spec, context) => {
          /** The canonical launcher creates and owns this exact Worker. */
          const handle = await native.launch({ ...spec, data: { sequence: ++sequence } }, context)
          handles.push(handle)
          return handle
        }
      },
      channelFactory: createNodeThreadChannelFactory({ scheduler: systemScheduler }),
      supervisor: { restart: { initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 2 } },
      report: (error) => reports.push(error)
    },
    report: (error) => reports.push(error)
  })
  try {
    assert.equal(await peer.request('service.data.stable'), 3)
    assert.deepEqual(reports, [], '[A82] initial asymmetric directories are valid, not a TS diff')
    /** The original accepted pointer distinguishes launch from actual directory readiness. */
    const first = readRuntimePeerConnection(peer).peerId
    handles[0]!.terminate()
    await handles[0]!.exited
    await vi.waitFor(() => assert.notEqual(readRuntimePeerConnection(peer).peerId, first), {
      timeout: 3000
    })
    assert.equal(await peer.request('service.data.added'), 4)
    assert.throws(() => peer.request('service.data.removed'), {
      code: RpcCoreErrorCode.providerNotFound
    })
    /** The replacement's declared stream route is genuinely callable. */
    const values = peer.stream('service.data.changed')
    assert.deepEqual(await values.next(), { done: false, value: 5 })
    await values.return!(undefined)
    assert.equal(
      reports.length,
      1,
      '[A82] one accepted replacement reports its exact directory diff'
    )
    /** Inspect a safe local report without importing an implementation that does not exist in RED. */
    const diff = reports[0] as {
      type: string
      added: readonly string[]
      removed: readonly string[]
      modeChanged: readonly {
        name: string
        previous: readonly string[]
        current: readonly string[]
      }[]
    }
    assert.equal(diff.type, 'runtime-contract-diff')
    assert.deepEqual(diff.added, ['service.data.added'])
    assert.deepEqual(diff.removed, ['service.data.removed'])
    assert.deepEqual(diff.modeChanged, [
      { name: 'service.data.changed', previous: ['request'], current: ['stream'] }
    ])
    /** A third true execution generation has the same route sets as the second. */
    const second = readRuntimePeerConnection(peer).peerId
    handles[1]!.terminate()
    await handles[1]!.exited
    await vi.waitFor(() => assert.notEqual(readRuntimePeerConnection(peer).peerId, second), {
      timeout: 3000
    })
    assert.equal(await peer.request('service.data.stable'), 3)
    assert.equal(reports.length, 1, '[A82] unchanged accepted routes produce no report')
  } finally {
    await peer.close()
    for (const handle of handles) handle.terminate()
    await Promise.all(handles.map((handle) => handle.exited))
  }
  assert.equal(budget.inUse, 0)
})
