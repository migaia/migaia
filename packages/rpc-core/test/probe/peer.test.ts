import { expect, it } from 'vitest'
import { defineProbe, snapshotProbeEvent } from '../../dist/core/probe/index.js'
import {
  createRuntimePeer,
  prepareRuntimePeerEndpoint,
  prepareRuntimePeerSourceContext
} from '../../dist/remote/runtime-api/peer.js'
import {
  readInstalledProbe,
  bindInstalledProbe,
  createProbeEmitter
} from '../../dist/core/internal/probe-emitter.js'
import { createEndpointKernel } from '../../dist/core/endpoint-kernel.js'
import { createMemoryTransportPair } from '../../dist/core/adapters/memory.js'
import { runtimeSources } from '../runtime-api/fixture.js'
import type { IRpcProbeEventView } from '../../dist/core/probe/types.js'

it('Peer probe observes handshake, ready and close without changing calls', async () => {
  /** Events are copied explicitly because the source view is reused synchronously. */
  const seen: Readonly<IRpcProbeEventView>[] = []
  /** Descriptors are delivered exactly once at successful activation. */
  let described = 0
  /** A closing sink reenters the existing owner and must receive its published completion. */
  let nestedClose: Promise<void> | undefined
  /** The facade becomes available only after its actual directory handshake completes. */
  let client: Awaited<ReturnType<typeof createRuntimePeer>> | undefined
  /** Runtime fixture uses only Core memory transport and real source negotiation. */
  const channel = runtimeSources()
  /** Installing the public Peer option must reach its own endpoint emitter. */
  const probe = defineProbe({
    stages: ['peer'],
    describe: () => {
      described++
    },
    emit: (view) => {
      seen.push(snapshotProbeEvent(view))
      if (view.lifecycle === 'closing') nestedClose = client?.close()
    }
  })
  /** Both source offers are constructed concurrently as required by their actual owner. */
  const peers = await Promise.all([
    createRuntimePeer({
      self: { name: 'left', instanceId: 'left' },
      connect: channel.sources[0],
      probe
    }),
    createRuntimePeer({
      self: { name: 'right', instanceId: 'right' },
      connect: channel.sources[1],
      provide: { echo: (value: unknown) => value }
    })
  ])
  client = peers[0]!
  try {
    expect(await peers[0]!.request('echo', 3)).toBe(3)
    expect(described).toBe(1)
    expect(seen.map((view) => view.lifecycle)).toEqual(
      expect.arrayContaining(['handshake', 'ready'])
    )
    /** Returned identity is the same completion retained by a synchronous reentrant sink. */
    const closed = peers[0]!.close()
    expect(nestedClose).toBe(closed)
    await closed
    expect(seen.map((view) => view.lifecycle)).toContain('closing')
  } finally {
    await Promise.all(peers.map((peer) => peer.close()))
    channel.close()
  }
})

it('construction failure rolls back the observer before descriptor publication', async () => {
  /** One original construction error is returned unchanged. */
  const original = new Error('endpoint construction fixture')
  /** A rejected custom endpoint owns no active descriptor. */
  let described = 0
  /** The fixture provides actual accepted source offers, without a carrier dependency. */
  const channel = runtimeSources()
  /** Probe stage subscription exists before endpoint acquisition and must be released on failure. */
  const probe = defineProbe({
    stages: ['peer'],
    describe: () => {
      described++
    },
    emit: () => undefined
  })
  /** Source negotiation requires both original offers even though only one endpoint is attempted. */
  const sources = await Promise.all([
    channel.sources[0](
      prepareRuntimePeerSourceContext({ instanceId: 'failure-left', name: 'left' })
    ),
    channel.sources[1](
      prepareRuntimePeerSourceContext({ instanceId: 'failure-right', name: 'right' })
    )
  ])
  try {
    await expect(
      prepareRuntimePeerEndpoint(
        {
          self: { instanceId: 'failure-left', name: 'left' },
          probe,
          endpointFactory: async () => {
            throw original
          }
        },
        sources[0],
        new AbortController().signal
      )
    ).rejects.toBe(original)
    expect(described).toBe(0)
    expect(readInstalledProbe(sources[0].transport)).toBeUndefined()
  } finally {
    channel.close()
  }
})

it('collects observer cleanup after the critical close failure and reports its original cause', async () => {
  /** Critical transport failure must remain first in the canonical resource collection. */
  const primary = new Error('primary close fixture')
  /** Observer cleanup is a secondary failure with independently reportable identity. */
  const secondary = new Error('observer close fixture')
  /** Probe reporting stays independent of the resource collection. */
  const failures: unknown[] = []
  /** One real Core adapter supplies the valid transport metadata. */
  const [left, right] = createMemoryTransportPair()
  /** Observe and its exact disposer are each called once despite repeated resource drains. */
  let observed = 0,
    released = 0
  Object.assign(left, {
    /** Memory adapters default to borrowed; this fixture explicitly owns its critical close. */
    ownership: 'owned',
    close: () => {
      throw primary
    },
    observe: () => {
      observed++
      return () => {
        released++
        throw secondary
      }
    }
  })
  /** Existing resource ownership receives the same endpoint observer installed by the Peer option. */
  const emitter = createProbeEmitter(
    [
      defineProbe({
        stages: ['carrier'],
        emit: () => undefined,
        onError: (error) => {
          failures.push(error)
        }
      })
    ],
    () => 0,
    'cleanup'
  )
  bindInstalledProbe(left, emitter)
  /** The kernel alone owns activation and critical-before-application release order. */
  const kernel = createEndpointKernel(left)
  try {
    kernel.activate({ unsubscribe: () => undefined, commit: () => undefined })
    kernel.beginClose()
    /** ResourceScope collects both originals and keeps transport close first. */
    const errors = await kernel.resources.releaseAll()
    expect(errors.map((entry) => entry.error)).toEqual([primary, secondary])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ code: 'PROBE_FAILED', cause: secondary })
    await kernel.resources.releaseAll()
    expect(observed).toBe(1)
    expect(released).toBe(1)
  } finally {
    kernel.completeDispose()
    right.close()
  }
})
