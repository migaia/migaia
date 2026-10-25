import assert from 'node:assert/strict'
import { createRpcHost } from '@migaia/rpc-host'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { chunk } from '@migaia/rpc-host/plugins/chunk'
import { RpcProbeForwardRejection } from '@migaia/rpc-contract/interfaces'
import {
  probe,
  RpcProbeOutcome,
  RpcProbeStage,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import { describe, expect, it } from 'vitest'
import { coreMemoryServer, connectedCoreHosts } from '../host/core-fixture.js'

describe('actual public forwarding lifecycle', () => {
  it('rejects a real forwarding cycle before reentering the original business provider', async () => {
    /** Existing listeners are connected into a cycle without replacing their endpoint identities. */
    const b = coreMemoryServer('loop-b')
    /** C first captures B's original provider through an accepted generation. */
    const c = coreMemoryServer('loop-c')
    /** A later advertises the same capability after its existing C connection is established. */
    const a = coreMemoryServer('loop-a')
    /** C's observer copies borrowed route facts before the reusable view is released. */
    const forward: IRpcProbeEventView[] = []
    /** Reentering B's terminal method must be prevented by the canonical forward-route owner. */
    let executions = 0
    /** Each host creates exactly its own normal endpoint; links only add raw physical sessions. */
    const hostB = await createRpcHost({ ...b.options, provide: { value: () => ++executions } })
    /** The relay's method is registered only after capturing its real remote capability. */
    const hostC = await createRpcHost({
      ...c.options,
      plugins: [
        probe({
          stages: ['forward'],
          emit: (event) => forward.push({ ...event, route: event.route?.slice() })
        }),
        ...c.options.plugins!
      ]
    })
    /** This third host preserves the live old links while a new graph edge closes the cycle. */
    const hostA = await createRpcHost(a.options)
    /** Caller construction happens after the real forwarded catalog has been published. */
    let caller: Awaited<ReturnType<typeof b.connect>> | undefined
    try {
      await c.link(b)
      hostC.provide({ relay: hostC.memory.peers['loop-b']!.value! })
      await a.link(c)
      hostA.provide({ relay: hostA.memory.peers['loop-c']!.relay! })
      await b.link(a)
      hostB.provide({ loop: hostB.memory.peers['loop-a']!.relay! })
      caller = await b.connect('loop-caller')
      expect(await caller.host.memory.send('loop-b', 'value')).toBe(1)
      await expect(caller.host.memory.send('loop-b', 'loop')).rejects.toMatchObject({
        code: 'FORWARD_LOOP'
      })
      expect(executions).toBe(1)
      expect(forward).toMatchObject([
        { stage: RpcProbeStage.forward, outcome: RpcProbeOutcome.received, hop: 3, maxHops: 3 },
        {
          stage: RpcProbeStage.forward,
          outcome: RpcProbeOutcome.rejected,
          rejection: RpcProbeForwardRejection.loop,
          hop: 3,
          maxHops: 3
        }
      ])
      expect(forward[0]!.rejection).toBeUndefined()
      expect(forward[0]!.messageId).toEqual(expect.any(String))
      expect(forward[1]!.messageId).toBe(forward[0]!.messageId)
      expect(forward[0]!.route).toHaveLength(3)
      expect(forward[1]!.route).toEqual(forward[0]!.route)
    } finally {
      await caller?.host.close()
      await hostA.close()
      await hostC.close()
      await hostB.close()
    }
  })

  it('permits three actual forwarding hosts and rejects the fourth before the terminal provider', async () => {
    /** The bounded chain reuses actual accepted capability functions, without a fixture dispatcher. */
    const servers = Array.from({ length: 5 }, (_, index) => coreMemoryServer(`hop-${index}`))
    /** Every successful terminal call is a real observable business effect. */
    let executions = 0
    /** Hold only actual public host handles for reverse cleanup. */
    const hosts: Awaited<ReturnType<typeof createRpcHost>>[] = []
    /** Independent external callers select the supported boundary and one excessive hop. */
    const callers: Awaited<ReturnType<(typeof servers)[0]['connect']>>[] = []
    try {
      for (const [index, server] of servers.entries()) {
        /** Register each relay before the next actual connection snapshots its provider catalog. */
        const host = await createRpcHost({
          ...server.options,
          ...(index === 0 ? { provide: { value: () => ++executions } } : {})
        })
        hosts.push(host)
        if (index > 0) {
          await server.link(servers[index - 1]!)
          /** Held capabilities retain their original source/generation forwarding identity. */
          const previous = host.memory.peers[`hop-${index - 1}`]!
          host.provide({ relay: previous[index === 1 ? 'value' : 'relay']! })
        }
      }
      /** Three forwarding nodes must preserve the existing successful business path. */
      const allowed = await servers[3]!.connect('allowed-caller')
      callers.push(allowed)
      expect(await allowed.host.memory.send('hop-3', 'relay')).toBe(1)
      /** The next independent caller reaches the original explicit hop-limit branch. */
      const excessive = await servers[4]!.connect('excessive-caller')
      callers.push(excessive)
      await expect(excessive.host.memory.send('hop-4', 'relay')).rejects.toMatchObject({
        code: 'FORWARD_HOP_LIMIT'
      })
      expect(executions).toBe(1)
    } finally {
      for (const caller of callers.reverse()) await caller.host.close()
      for (const host of hosts.reverse()) await host.close()
    }
  })
  it('child reenters the explicitly exposed parent while servicing a parent request', async () => {
    /** The child captures the actual factory result only after construction has completed. */
    let callback!: () => Promise<unknown>
    /** Both directions execute through the same actual outbound/provider owners. */
    const fixture = await connectedCoreHosts(
      { doc: { save: () => 'saved' } },
      { run: () => callback() }
    )
    callback = () => fixture.b.memory.request('doc.save')
    try {
      assert.equal(
        await fixture.a.memory.request('run'),
        'saved',
        'nested reverse request is not serialized behind the original request'
      )
    } finally {
      await fixture.close()
    }
  })
})

it('observes actual known-offline-peer and missing-method forwarding refusals without business execution', async () => {
  /** One actual relay receives qualified method lookup through its normal provider dispatcher. */
  const listener = coreMemoryServer('relay')
  /** The readonly observer snapshots only the real Forwarder events it receives. */
  const events: IRpcProbeEventView[] = []
  /** A live capability and an actually retired peer retain distinct forwarding refusal reasons. */
  let executions = 0
  /** The installed probe shares the relay's actual namespace observer and original physical pair. */
  const relay = await createRpcHost({
    ...listener.options,
    plugins: [
      probe({
        stages: ['forward'],
        emit: (event) => events.push({ ...event, route: event.route?.slice() })
      }),
      ...listener.options.plugins!
    ]
  })
  /** The original caller also advertises one genuine business method to the accepted directory. */
  const caller = await listener.connect('client', { provide: { value: () => ++executions } })
  try {
    /** This spelling becomes known through real admission before its original Session is closed. */
    const offline = await listener.connect('missing', { provide: { value: () => ++executions } })
    /** Join actual retirement, never a synthetic name or a removed private routing entry. */
    const retired = listener.lookup('missing')!.handle.closed
    await offline.host.close()
    await retired
    for (const [method, rejection, code] of [
      ['missing.value', RpcProbeForwardRejection.targetUnknown, 'TARGET_UNKNOWN'],
      ['client.missing', RpcProbeForwardRejection.methodUnavailable, 'PROVIDER_NOT_FOUND']
    ] as const) {
      events.length = 0
      await expect(caller.host.memory.send('relay', method)).rejects.toMatchObject({ code })
      expect(events).toMatchObject([
        { stage: RpcProbeStage.forward, outcome: RpcProbeOutcome.received, hop: 1, maxHops: 3 },
        {
          stage: RpcProbeStage.forward,
          outcome: RpcProbeOutcome.rejected,
          rejection,
          hop: 1,
          maxHops: 3
        }
      ])
      expect(events[0]!.method).toBe(method)
      expect(events[0]!.rejection).toBeUndefined()
      expect(events[0]!.messageId).toEqual(expect.any(String))
      expect(events[1]!.messageId).toBe(events[0]!.messageId)
      expect(events[0]!.route).toHaveLength(1)
      expect(events[1]!.route).toEqual(events[0]!.route)
    }
    expect(executions).toBe(0)
  } finally {
    await caller.host.close()
    await relay.close()
  }
})

it.each(['request', 'group'] as const)(
  'observes one logical forward handoff when real chunk fragments carry a %s',
  async (mode) => {
    /** Each original native endpoint constructs its own real inline JSON carrier codec. */
    const codec = { create: () => new RpcJsonCarrierCodec(), nativeBinary: false }
    /** The terminal provider and relay have independent installed native transport owners. */
    const providerListener = coreMemoryServer('chunk-provider', undefined, 'memory', [], [], codec)
    /** Both actual connections use the same supported codec selection and negotiated chunk plugin. */
    const relayListener = coreMemoryServer('chunk-relay', undefined, 'memory', [], [], codec)
    /** Real business invocation count distinguishes replay from diagnostic duplication. */
    let executions = 0
    /** This collector receives only actual logical Forwarder observations from the relay. */
    const events: IRpcProbeEventView[] = []
    /** A small genuine chunk size fragments the complete encoded request without a fake framer. */
    const chunkOptions = { chunkBytes: 64 }
    /** The leaf owns ordinary provider execution, independent of the relay's held capability. */
    const provider = await createRpcHost({
      ...providerListener.options,
      plugins: [chunk(chunkOptions), providerListener.transport],
      provide: {
        echo: (value) => {
          executions++
          return value
        }
      }
    })
    /** Only this real forwarding host installs the readonly forwarding probe. */
    const relay = await createRpcHost({
      ...relayListener.options,
      plugins: [
        chunk(chunkOptions),
        probe({
          stages: ['forward'],
          emit: (event) => events.push({ ...event, route: event.route?.slice() })
        }),
        relayListener.transport
      ]
    })
    /** Caller acquisition happens only after the original accepted provider is exposed. */
    let caller: Awaited<ReturnType<typeof relayListener.connect>> | undefined
    try {
      await relayListener.link(providerListener)
      relay.provide({ echo: relay.memory.peers['chunk-provider']!.echo! })
      caller = await relayListener.connect('chunk-caller', { plugins: [chunk(chunkOptions)] })
      /** This exact business input requires several actual extension writes on the relay link. */
      const payload = 'forward-chunk-payload'.repeat(32)
      if (mode === 'request')
        await expect(caller.host.memory.send('chunk-relay', 'echo', payload)).resolves.toBe(payload)
      else
        await expect(caller.host.memory.group([{ method: 'echo', payload }])).resolves.toEqual([
          { state: 'success', result: payload }
        ])
      expect(executions).toBe(1)
      expect(events.map((event) => event.outcome)).toEqual([
        RpcProbeOutcome.received,
        RpcProbeOutcome.sent
      ])
    } finally {
      await caller?.host.close()
      await relay.close()
      await provider.close()
    }
  }
)
