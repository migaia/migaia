import assert from 'node:assert/strict'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { it, vi } from 'vitest'
import { RpcCapability } from '../../src/contract/wire-constants.js'
import { createProcessPlugin } from '../../src/process/index.js'
import { createThreadPlugin } from '../../src/threads/index.js'
import {
  createRuntimePeer,
  prepareRuntimePeerEndpoint,
  readRuntimePeerConnection,
  type IRuntimePeer
} from '../../src/remote/runtime-api/peer.js'
import { readRuntimeOutletConnection } from '../../src/remote/runtime-api/outlet.js'
import { readEndpointOwner } from '../../src/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../src/core/endpoint-kernel.js'
import type { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'
import { runtimeSources, runtimeTestHost } from './fixture.js'

it('[A60][A74] default custom factory retains ordinary Host calls without declaring unavailable shared ordering', async () => {
  /** The fixture joins both actual default source contexts rather than supplying stronger tags. */
  const offers: string[][] = [[], []]
  const channel = runtimeSources(offers[0], offers[1])
  const sources = channel.sources.map(
    (source, index) => async (context: Parameters<typeof source>[0]) => {
      offers[index]!.push(...context.capabilities)
      return source(context)
    }
  )
  /** This real Host owns the original shared slot; the unchanged factory API cannot read its scope. */
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  const failures: unknown[] = []
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
        createProcessPlugin({
          name: 'custom-source',
          self: { name: 'provider', instanceId: 'custom-provider-1' },
          connect: sources[0]!,
          provide: { baseline: () => 42 },
          endpointFactory: (selected, signal) =>
            prepareRuntimePeerEndpoint(
              {
                self: { name: 'provider', instanceId: 'custom-provider-1' },
                report: (error) => {
                  failures.push(error)
                }
              },
              selected,
              signal
            ),
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
      '[A60] ordinary custom factory must prepare on its truthful default offer'
    )
    caller = await preparing
    assert.equal(await caller.request('baseline'), 42)
    assert.throws(
      () => caller!.request('baseline', undefined, { orderKey: 'unavailable' }),
      (error: unknown) => Reflect.get(error as object, 'code') === 'CAPABILITY_UNSUPPORTED'
    )
    assert.equal(failures.length, 0)
  } finally {
    cancel.abort()
    await caller?.close()
    await host.dispose()
    channel.close()
    await preparing.catch(() => undefined)
  }
})

it('[A59][A60] genuine process and thread Plugin installs share one final Host provider key owner', async () => {
  const capabilities = [
    RpcCapability.runtimeApi,
    RpcCapability.batch,
    RpcCapability.generation,
    RpcCapability.order,
    RpcCapability.deadline
  ]
  const channels = [
    runtimeSources(capabilities, capabilities),
    runtimeSources(capabilities, capabilities)
  ]
  const host = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  const effects: string[] = []
  const failures: unknown[] = []
  const clients: IRuntimePeer[] = []
  const calls: Promise<unknown>[] = []
  let finish!: () => void
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  /** A separate held phase checks quota rollback after the FIFO proof already completed. */
  let releaseQuota!: () => void
  const quotaHeld = new Promise<void>((resolve) => {
    releaseQuota = resolve
  })
  let quotaStarted = 0
  try {
    await host.use(
      definePlugin({
        name: 'service',
        features: {
          data: defineFeature(() => ({
            baseline: () => 42,
            first: async () => {
              effects.push('first')
              await held
              return 1
            },
            second: () => {
              effects.push('second')
              return 2
            },
            other: () => {
              effects.push('other')
              return 3
            },
            quota: async () => {
              quotaStarted++
              await quotaHeld
              return 42
            }
          }))
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
      await host.use(index === 0 ? createProcessPlugin(options) : createThreadPlugin(options))
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
      '[A59] adapter family cannot create another FIFO for the same final Host'
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
    const failedChannel = runtimeSources(capabilities, capabilities)
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
          createProcessPlugin({
            name: 'failed-source',
            self: { name: 'failed-provider', instanceId: 'failed-provider' },
            connect: failedChannel.sources[0],
            expose: ['service'],
            providerLimits: { maxGlobal: 1, maxPerPeer: 1 },
            endpointFactory: async (channel, signal) => {
              const acquired = await prepareRuntimePeerEndpoint(
                {
                  self: { name: 'failed-provider', instanceId: 'failed-provider' },
                  report: () => undefined
                },
                channel,
                signal
              )
              await acquired.endpoint.dispose()
              throw primary
            },
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
        quotaStarted,
        2,
        '[A60][A33] a failed candidate cannot tighten the committed provider scope'
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
