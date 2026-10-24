import assert from 'node:assert/strict'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { it, vi } from 'vitest'
import { RpcCapability } from '@migaia/rpc-contract'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadProtocolDefinition as createThreadPlugin } from './fixtures/thread-protocol.js'
import {
  createRuntimePeer,
  type IRuntimePeer
} from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { readRuntimePeerConnection } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import { readEndpointOwner } from '../../../rpc-host/dist/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../../rpc-host/dist/core/endpoint-kernel.js'
import type { ProviderAdmissionRegistry } from '../../../rpc-host/dist/core/internal/provider-admission.js'
import { runtimeSources, runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'
import { holdMemoryChannel } from '../../../rpc-host/test/host/fixture.js'
import { deferred } from '@migaia/utils/promise'

/** Capture each real raw receive side before either differently layered caller can send startup. */
function sourceChannels(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
  report: (error: unknown) => void
) {
  /** The existing offer barrier remains the sole identity and exact capability-intersection owner. */
  const channels = runtimeSources(left, right)
  /** Canonical native qualification captures early frames rather than dropping them in bare memory. */
  const openings = channels.transports.map(holdMemoryChannel)
  return {
    ...channels,
    sources: channels.sources.map((source, index) => {
      /** This physical end delegates every byte and lifecycle receipt to its existing raw owner. */
      const open = openings[index]!
      return async (context: Parameters<typeof source>[0]) => {
        /** Original source acquisition still occurs exactly once per original offer. */
        const channel = await source(context)
        return open(channel.peerId, {
          ...context,
          capabilities: channel.agreement.capabilities,
          report
        })
      }
    })
  }
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

it('default native source retains ordinary Host calls and truthfully negotiated ordering', async () => {
  /** The fixture joins both actual default source contexts rather than supplying stronger tags. */
  const offers: string[][] = [[], []]
  /** Preserve actual qualifier/endpoint failures without changing their native identities. */
  const failures: unknown[] = []
  const channel = sourceChannels(offers[0], offers[1], (error) => failures.push(error))
  const sources = channel.sources.map(
    (source, index) => async (context: Parameters<typeof source>[0]) => {
      offers[index]!.push(...context.capabilities)
      return source(context)
    }
  )
  /**
   * This real Host owns the original shared slot; the original source supplies no private scope
   * authority.
   */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  const cancel = new AbortController()
  const preparing = createRuntimePeer(
    {
      self: { name: 'caller', instanceId: 'custom-caller-1' },
      connect: sources[1]!,
      report: (error) => {
        failures.push(error)
      }
    },
    { signal: cancel.signal }
  )
  void preparing.catch(() => undefined)
  let caller: IRuntimePeer | undefined
  let preparationFailure: unknown
  try {
    try {
      await host.use(
        processPlugin({
          name: 'custom-source',
          self: { name: 'provider', instanceId: 'custom-provider-1' },
          connect: { target: sources[0]! },
          provide: { baseline: () => 42 },

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
    caller = await preparing
    assert.equal(await caller.request('baseline'), 42)
    assert.ok(
      readRuntimePeerConnection(caller).channel.agreement.capabilities.includes(RpcCapability.order)
    )
    assert.equal(await caller.request('baseline', undefined, { orderKey: 'negotiated' }), 42)
    assert.equal(failures.length, 0)
  } finally {
    cancel.abort()
    await caller?.close()
    await host.dispose()
    channel.close()
    await preparing.catch(() => undefined)
  }
})

it('genuine process and thread Plugin installs share one final Host provider key owner', async () => {
  const capabilities = [
    RpcCapability.runtimeApi,
    RpcCapability.batch,
    RpcCapability.generation,
    RpcCapability.order,
    RpcCapability.deadline
  ]
  /** Qualifier and business failures retain their original exact objects. */
  const failures: unknown[] = []
  const channels = [
    sourceChannels(capabilities, capabilities, (error) => failures.push(error)),
    sourceChannels(capabilities, capabilities, (error) => failures.push(error))
  ]
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** The real Feature retains its own shared provider state, rather than a closure factory. */
  const business = new SharedHostBusiness()
  /** These immutable borrowed observations and releases keep the original case's exact oracle. */
  const { effects, finish, releaseQuota } = business
  const clients: IRuntimePeer[] = []
  const calls: Promise<unknown>[] = []
  try {
    await host.use(
      definePlugin({
        name: 'service',
        features: {
          data: defineFeature(() => business.service)
        },
        install: () => ({})
      })
    )
    for (const index of [0, 1]) {
      const preparing = createRuntimePeer({
        self: { name: `caller-${index}`, instanceId: `host-caller-${index}` },
        connect: channels[index]!.sources[1],
        report: (error) => {
          failures.push(error)
        }
      })
      void preparing.catch(() => undefined)
      const options = {
        name: index === 0 ? 'process-source' : 'thread-source',
        connect: channels[index]!.sources[0],
        expose: ['service'],
        report: (error: unknown) => {
          failures.push(error)
        }
      }
      await host.use(
        index === 0
          ? processPlugin({ ...options, connect: { target: options.connect } })
          : createThreadPlugin(options)
      )
      clients.push(await preparing)
      assert.equal(await clients[index]!.request('service.baseline'), 42)
    }
    const first = clients[0]!.request('service.first', undefined, { orderKey: 'same' })
    calls.push(first)
    void first.catch(() => undefined)
    await vi.waitFor(() => assert.deepEqual(effects, ['first']))
    const second = clients[1]!.request('service.second', undefined, { orderKey: 'same' })
    calls.push(second)
    void second.catch(() => undefined)
    assert.equal(await clients[1]!.request('service.other', undefined, { orderKey: 'other' }), 3)
    assert.deepEqual(
      effects,
      ['first', 'other'],
      'adapter family cannot create another FIFO for the same final Host'
    )
    const processConnection = readRuntimeOutletConnection(host.process, 'process-source')!
    const threadConnection = readRuntimeOutletConnection(host.thread, 'thread-source')!
    assert.ok(processConnection && threadConnection)
    const scopes = [processConnection, threadConnection].map((connection) =>
      readEndpointOwner<ProviderAdmissionRegistry>(
        readRuntimePeerConnection(connection.peer).endpoint,
        EndpointOwnerKey.providerAdmission
      )!
    )
    assert.equal(scopes[0], scopes[1])
    await vi.waitFor(() => assert.equal(scopes[0]!.size, 2))
    finish()
    assert.deepEqual(await Promise.all(calls), [1, 2])
    assert.equal(failures.length, 0)
    await vi.waitFor(() => assert.equal(scopes[0]!.size, 0))
    /** This actual source acquires a scope before its original endpoint factory fails. */
    const failedChannel = sourceChannels(capabilities, capabilities, () => undefined)
    const cancelPreparation = new AbortController()
    const primary = new Error('shared Host candidate construction failed')
    const observing = createRuntimePeer(
      {
        self: { name: 'candidate-caller', instanceId: 'candidate-caller' },
        connect: failedChannel.sources[1],
        report: () => undefined
      },
      { signal: cancelPreparation.signal }
    )
    void observing.catch(() => undefined)
    try {
      await assert.rejects(
        host.use(
          processPlugin({
            name: 'failed-source',
            self: { name: 'failed-provider', instanceId: 'failed-provider' },
            connect: {
              target: async (context) => {
                /** The real source fails after its native channel has acquired the shared scope. */ const acquired =
                  await failedChannel.sources[0](context)
                await acquired.close?.()
                throw primary
              }
            },
            expose: ['service'],
            providerLimits: { maxGlobal: 1, maxPerPeer: 1 },

            report: () => undefined
          })
        ),
        (error: unknown) => {
          /** Host's original aggregate/cause ownership must keep the actual factory failure. */
          let cause: unknown = error
          for (let depth = 0; depth < 8 && cause instanceof Error; depth++) {
            if (cause === primary) return true
            if (cause instanceof AggregateError && cause.errors.includes(primary)) return true
            cause = cause.cause
          }
          return false
        }
      )
    } finally {
      cancelPreparation.abort()
      await observing.catch(() => undefined)
      failedChannel.close()
    }
    for (const index of [0, 1]) {
      const call = clients[index]!.request('service.quota', undefined, {
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
    await Promise.all(clients.map((peer) => peer.close()))
    await host.dispose()
    for (const channel of channels) channel.close()
    await Promise.allSettled(calls)
  }
})
