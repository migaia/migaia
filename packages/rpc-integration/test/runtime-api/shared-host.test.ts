/** Original shared Host business runs over genuine Process and Worker native installations. */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { defineHost, defineFeature, definePlugin } from '@migaia/plugin-host'
import { it, vi } from 'vitest'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import type { IRpcNamespace } from '@migaia/rpc-host'
import {
  rpcHostPipelines,
  rpcFlowPlugin,
  type IRpcNativeMemberControls
} from '@migaia/rpc-host/sdk'
import { limits } from '@migaia/rpc-host/plugins/limits'
import {
  createUnitBudget,
  SUPERVISION_SOURCE,
  SupervisionErrorCode,
  SupervisionErrorText,
  StandardCapability,
  CapabilityLevel
} from '@migaia/supervision'
import { createNodeProcessLauncher } from '../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import type { ISpawnProcessPluginDeployment } from '../../../rpc-plugin-process/dist/process/plugin/types.js'
import { deferred } from '@migaia/utils/promise'

/** Both real native runtimes execute this small application provider through built public entries. */
const entry = new URL('./fixtures/shared-host-native.ts', import.meta.url)
/** Ordinary native installation publishes the actual namespace and member extension together. */
type ISharedNamespace = IRpcNamespace & {
  members: IRpcNativeMemberControls<'process' | 'thread'>
}

/** Borrow the real installed native namespace; no old Peer, outlet or callable alias is created. */
function namespace(host: object, key: 'process' | 'thread'): ISharedNamespace {
  return Reflect.get(host, key) as ISharedNamespace
}

/** Inspect the exact native notice without changing failure reporting or reconstructing the Error. */
function assertNativeTerminationNotice(notices: readonly unknown[]): void {
  assert.equal(notices.length, 1)
  /** Public notice diagnostics come from the original supervision Error and its native detail. */
  const notice = notices[0] as Error & { source: unknown; code: unknown; detail: unknown }
  assert.deepEqual(
    {
      source: notice.source,
      code: notice.code,
      name: notice.name,
      message: notice.message,
      detail: notice.detail
    },
    {
      source: SUPERVISION_SOURCE,
      code: SupervisionErrorCode.capabilityUnsupported,
      name: Error.name,
      message: SupervisionErrorText.capabilityUnsupported,
      detail: {
        capability: StandardCapability.termination,
        level: CapabilityLevel.unsupported,
        kind: 'process'
      }
    }
  )
}

/** One original Feature output is captured by both transports' explicit native exposure. */
function servicePlugin(value: object) {
  return definePlugin({
    name: 'service',
    features: { data: defineFeature(() => value) },
    install: () => ({})
  })
}

/** Failure preserves original identity even when genuine supervision adds its native cause layers. */
function hasOriginalCause(error: unknown, primary: Error): boolean {
  /** The same original bounded traversal is only an assertion predicate, never runtime authority. */
  let cause: unknown = error
  for (let depth = 0; depth < 8 && cause instanceof Error; depth++) {
    if (cause === primary) return true
    if (cause instanceof AggregateError && cause.errors.includes(primary)) return true
    cause = cause.cause
  }
  return false
}

/** Acquire a real native candidate before failing its source, then reap that exact owned unit. */
function failingProcessSource(
  primary: Error,
  budget: ReturnType<typeof createUnitBudget<'process'>>
) {
  /** Existing launcher/bootstrap acquires the actual OS process and original exit receipt. */
  const launcher = createNodeProcessLauncher()
  return {
    kind: 'spawn',
    channelKind: 'byte',
    token: 'shared-host-candidate-token',
    supervision: {
      id: 'shared-host-candidate',
      budget,
      launcher,
      isolation: 'best-effort',
      restart: { mode: 'never' },
      report: () => undefined,
      spec: {
        command: process.execPath,
        args: [fileURLToPath(entry)],
        env: { inherit: ['PATH'], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: {
          via: 'stdin',
          payload: new TextEncoder().encode('shared-host-candidate-token')
        }
      }
    },
    async rawChannel(unit) {
      /** Source failure follows actual native acquisition; no mock endpoint or protocol exists. */
      await unit.channel!.close()
      unit.terminate('force')
      await unit.exited
      throw primary
    }
  } satisfies ISpawnProcessPluginDeployment<Awaited<ReturnType<typeof launcher.launch>>>
}

/** One genuine Feature owns the same held FIFO and quota business across both native transports. */
class SharedHostBusiness {
  /** Execution order is observed from the original provider entry, never client submission. */
  readonly #effects: string[] = []
  /** The first FIFO operation remains held until the case releases its original business receipt. */
  readonly #held = deferred<void>()
  /** Quota occupancy is held independently after the earlier FIFO phase has fully settled. */
  readonly #quotaHeld = deferred<void>()
  /** Count only actual quota provider entry; admission rejections cannot increment this state. */
  #quotaStarted = 0
  /** The same immutable function tree is installed once as the ordinary Host Feature output. */
  readonly service = {
    baseline: () => 42,
    /** Enter before retaining the shared FIFO lease until the case releases this receipt. */
    first: async () => {
      this.#effects.push('first')
      await this.#held.promise
      return 1
    },
    /** Entry after the held operation proves same-key FIFO across both transport families. */
    second: () => {
      this.#effects.push('second')
      return 2
    },
    /** An independent ordering key stays runnable while the first provider remains held. */
    other: () => {
      this.#effects.push('other')
      return 3
    },
    /** Hold actual provider occupancy while the case proves failed-candidate quota rollback. */
    quota: async () => {
      this.#quotaStarted++
      await this.#quotaHeld.promise
      return 42
    }
  }
  /** Borrow the original ordered observations without replacing the provider's mutable array. */
  get effects(): readonly string[] {
    return this.#effects
  }
  /** Read the actual number of entered quota operations across both adapter families. */
  get quotaStarted(): number {
    return this.#quotaStarted
  }
  /** Release the same provider-held FIFO Promise; repeat cleanup retains native idempotency. */
  readonly finish = (): void => this.#held.resolve()
  /** Release the independent quota phase without changing any admitted operation identity. */
  readonly releaseQuota = (): void => this.#quotaHeld.resolve()
}

// RPC-TEST-96BAE5A2A7EA-C001: native ordering is demonstrated by the real public call, not old flags.
it('default native source retains ordinary Host calls and truthfully negotiated ordering', async () => {
  /** Reports preserve original actual failures; no qualifier or old capability table is fabricated. */
  const failures: unknown[] = []
  /** The existing native channel owns expected best-effort degradation, separate from failures. */
  const notices: unknown[] = []
  /** This is the sole receiving ordinary native PluginHost. */
  const rpc = rpcHostPipelines(
    () => host,
    (name) => host.pipeline(name),
    ['process']
  )
  /** The same native owner declares its transport group before installation. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** BC3 moves former transport provide to ordinary Feature exposure without another Host. */
  await host.use(servicePlugin({ baseline: () => 42 }))
  /** Original preparation failure identity is observed independently from business calls. */
  let preparationFailure: unknown
  try {
    try {
      await host.use(
        processPlugin({
          name: 'custom-source',
          spawn: entry,
          expose: ['service'],
          onNotice: (notice) => {
            notices.push(notice)
          },
          report: (error) => {
            failures.push(error)
          }
        })
      )
    } catch (error) {
      preparationFailure = error
    }
    assert.equal(
      preparationFailure,
      undefined,
      'ordinary custom source must prepare on its truthful default offer'
    )
    /** The child originates both calls back across the genuine process stream to this Host. */
    const caller = namespace(host, 'process')
    assert.equal(await caller.request('invoke', { method: 'service.baseline' }), 42)
    // C001-A003's old agreement.capabilities interface is BC3; real orderKey call remains below.
    assert.equal(
      await caller.request('invoke', {
        method: 'service.baseline',
        orderKey: 'negotiated'
      }),
      42
    )
    assert.equal(failures.length, 0)
    assertNativeTerminationNotice(notices)
  } finally {
    await host.dispose()
  }
}, 15_000)

// RPC-TEST-96BAE5A2A7EA-C002: one real ordinary Host owns both native providers and shared FIFO.
it('genuine process and thread Plugin installs share one final Host provider key owner', async () => {
  /** Original native acquisition and business errors retain their complete exact objects. */
  const failures: unknown[] = []
  /** This case owns its original native notices independently from the first case's observations. */
  const notices: unknown[] = []
  /** Both native plugins install into this exact original PluginHost instance. */
  const rpc = rpcHostPipelines(
    () => host,
    (name) => host.pipeline(name),
    ['process', 'thread', 'failed-process']
  )
  /** All transport groups borrow this exact original provider and installation owner. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The same original application Feature owns FIFO and quota provider state. */
  const business = new SharedHostBusiness()
  /** These borrowed releases preserve original Promise, entry order and final cleanup. */
  const { effects, finish, releaseQuota } = business
  /** The actual namespace objects originate the child application relay calls. */
  const clients: ISharedNamespace[] = []
  /** Original pending business operations are all observed and joined in final cleanup. */
  const calls: Promise<unknown>[] = []
  /** Candidate acquisition borrows its own native lease; it never owns another provider registry. */
  const candidateBudget = createUnitBudget({ kind: 'process', maxUnits: 1, launchRate: false })
  try {
    /** The original committed policy keeps its genuine global256/per-peer64 default capacity. */
    await host.use(
      servicePlugin(business.service),
      rpcFlowPlugin([limits()], ['process', 'thread', 'failed-process'])
    )
    for (const index of [0, 1]) {
      /** Both factories acquire their genuine original native runtime and SDK member owner. */
      const options = {
        name: index === 0 ? 'process-source' : 'thread-source',
        spawn: entry,
        expose: ['service'],
        report: (error: unknown) => {
          failures.push(error)
        }
      }
      await host.use(
        index === 0
          ? processPlugin({
              ...options,
              onNotice: (notice) => {
                notices.push(notice)
              }
            })
          : threadPlugin(options)
      )
      clients.push(namespace(host, index === 0 ? 'process' : 'thread'))
      assert.equal(await clients[index]!.request('invoke', { method: 'service.baseline' }), 42)
    }
    /** The child provider makes the original first call on the final receiving Host. */
    const first = clients[0]!.request('invoke', { method: 'service.first', orderKey: 'same' })
    calls.push(first)
    void first.catch(() => undefined)
    await vi.waitFor(() => assert.deepEqual(effects, ['first']))
    /** A different actual runtime must join the same final Host orderKey FIFO. */
    const second = clients[1]!.request('invoke', { method: 'service.second', orderKey: 'same' })
    calls.push(second)
    void second.catch(() => undefined)
    assert.equal(
      await clients[1]!.request('invoke', {
        method: 'service.other',
        orderKey: 'other'
      }),
      3
    )
    assert.deepEqual(
      effects,
      ['first', 'other'],
      'adapter family cannot create another FIFO for the same final Host'
    )
    /** Public native descriptors replace the deleted outlet/Peer connection projection only. */
    const processConnection = await clients[0]!.members.get('process-source')
    /** This record is produced by the real Worker source, not the former simulated thread plugin. */
    const threadConnection = await clients[1]!.members.get('thread-source')
    assert.ok(processConnection && threadConnection)
    // C002-A006/A007/A010: exact private registry pointer/size checks are BC3, not business oracles.
    finish()
    assert.deepEqual(await Promise.all(calls), [1, 2])
    assert.equal(failures.length, 0)
    assertNativeTerminationNotice(notices)
    /** Actual native acquisition must keep this original failure reachable after rollback. */
    const primary = new Error('shared Host candidate construction failed')
    await assert.rejects(
      host.use(
        processPlugin({
          name: 'failed-source',
          namespace: 'failed-process',
          spawn: failingProcessSource(primary, candidateBudget),
          expose: ['service'],
          report: () => undefined
        })
      ),
      (error: unknown) => hasOriginalCause(error, primary)
    )
    // BC3 removes candidate providerLimits input; original post-failure concurrent2 stays business.
    for (const index of [0, 1]) {
      /** Both actual inbound provider entries retain independently held business completion. */
      const call = clients[index]!.request('invoke', {
        method: 'service.quota',
        orderKey: `quota-${index}`
      })
      calls.push(call)
      void call.catch(() => undefined)
    }
    await vi.waitFor(() =>
      assert.equal(
        business.quotaStarted,
        2,
        'a failed candidate cannot tighten the committed provider scope'
      )
    )
    releaseQuota()
    assert.deepEqual(await Promise.all(calls.slice(2)), [42, 42])
  } finally {
    finish()
    releaseQuota()
    await host.dispose()
    candidateBudget.close()
    await Promise.allSettled(calls)
  }
}, 20_000)
