import { definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it } from 'vitest'
import { acceptRpcHandshake } from '@migaia/rpc-contract'
import { createManagedRuntimePeer } from '../../../rpc-host/dist/remote/runtime-api/managed-peer.js'
import type { IRuntimePeer } from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '@migaia/rpc-host/plugin'
import { remoteHarness, remoteDescription } from '../../../rpc-host/test/remote/fixture.js'
import {
  BRIDGE_CONTRACT,
  BRIDGE_METHODS,
  BRIDGE_PEER_OFFER,
  BridgeFixture,
  flush
} from './fixture.js'

/** Respond with one explicit description and echo all ordinary request arguments. */
function responder(description: unknown) {
  return (message: Record<string, unknown>): unknown => {
    if (message.method === 'migaia.hello') {
      /** The foreign offer remains independent from the native runtime capability list. */
      const answer = acceptRpcHandshake(
        BRIDGE_PEER_OFFER,
        (message.params as { hello: string }).hello
      )
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { reply: answer.reply, methods: BRIDGE_METHODS }
      }
    }
    if (message.method === 'migaia.describe')
      return { jsonrpc: '2.0', id: message.id, result: description }
    if (message.method === 'migaia.invoke' && message.id)
      return { jsonrpc: '2.0', id: message.id, result: (message.params as { args: unknown }).args }
    return undefined
  }
}

/** Retain the actual bridge source and canonical managed generation without an old remote facade. */
class RemoteBridgeScenario {
  /** Existing neutral supervisor ports supply only native readiness and generation state. */
  readonly #neutral = remoteHarness()
  /** The original independent foreign byte peer owns its own frames and close counters. */
  readonly fixture: BridgeFixture
  /** Host catalog qualification remains a physical JSON-RPC channel input. */
  readonly #hostTarget: boolean
  /** Logical-key generation remains with the original canonical managed call owner. */
  readonly #keyFactory: (() => string) | undefined
  /** The accepted callable is published only after one genuine directory exchange. */
  #peer: IRuntimePeer | undefined
  /** Endpoint construction count observes actual composition rather than a replacement dispatcher. */
  endpointConstructions = 0
  /** Physical messages at endpoint construction prove description has not run prematurely. */
  endpointMessages: unknown[] = []
  /** Actual transport features are observed before canonical endpoint installation. */
  channelFeatureCount = 0
  /** The accepted channel retains original capability assertions without a synthetic offer. */
  #channel: IRemoteChannel | undefined

  /** Capture immutable case inputs without opening the native source. */
  constructor(fixture: BridgeFixture, hostTarget = false, keyFactory?: () => string) {
    this.fixture = fixture
    this.#hostTarget = hostTarget
    this.#keyFactory = keyFactory
  }

  /** Only accepted startup publishes the actual managed callable for business operations. */
  get peer(): IRuntimePeer {
    return this.#peer!
  }
  /** Read the original accepted channel rather than copying its capability agreement. */
  get channel(): IRemoteChannel {
    return this.#channel!
  }

  /** Observe the same canonical composition boundary before its first description request. */
  #endpoint = (channel: IRemoteChannel, served: IRemoteServeEndpoint) => {
    this.endpointConstructions++
    this.endpointMessages = this.fixture.messages.map((message) => message.method)
    this.channelFeatureCount = channel.features.length
    this.#channel = channel
    return served
  }

  /** Prepare one genuine managed registration over the existing source and native readiness ports. */
  async open(): Promise<IRuntimePeer> {
    return (this.#peer = await createManagedRuntimePeer(
      {
        self: { name: 'client', instanceId: 'client' },
        keyFactory: this.#keyFactory,
        report: (error) => this.fixture.reports.push(error)
      },
      {
        ...this.#neutral.binding,
        scheduler: this.fixture.scheduler,
        openChannel: () =>
          this.#hostTarget
            ? this.fixture.open({ target: { kind: 'host', catalog: { p: BRIDGE_CONTRACT } } })
            : this.fixture.open()
      },
      this.#endpoint
    ))
  }

  /** The canonical managed holder owns both normal release and failed-start rollback. */
  async close(): Promise<void> {
    await this.#peer?.close()
  }
}

describe('JSON-RPC remote assembly', () => {
  it('rejects a missing describe extension through real Host preparation', async () => {
    /** Missing extension is still an independent foreign protocol error. */
    const fixture = new BridgeFixture({
      responder: (message) =>
        message.method === 'migaia.describe'
          ? {
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32601, message: 'describe unavailable' }
            }
          : responder(remoteDescription([BRIDGE_CONTRACT], 'peer', true))(message)
    })
    /** Actual managed startup replaces only the retired ready/release remote facade. */
    const scenario = new RemoteBridgeScenario(fixture, true)
    try {
      await expect(scenario.open()).rejects.toMatchObject({
        code: 'JSONRPC_EXTENSION_MISSING',
        cause: {
          code: 'JSONRPC_EXTENSION_MISSING',
          cause: { source: 'jsonrpc-2.0', code: '-32601' }
        }
      })
    } finally {
      await scenario.close()
    }
    expect(fixture.messages.map((message) => message.method)).toEqual([
      'migaia.hello',
      'migaia.describe'
    ])
    expect(fixture.closes).toBe(1)
  })

  it('gates real PluginHost preparation on one describe and carries the automatic key', async () => {
    /** Actual foreign directory retains the original modes and idempotency declarations. */
    const fixture = new BridgeFixture({
      responder: responder(remoteDescription([BRIDGE_CONTRACT]))
    })
    /** Ordinary installation owns the real managed callable's lifetime. */
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** The canonical managed registration owns original logical key generation. */
    const scenario = new RemoteBridgeScenario(fixture, false, () => 'automatic-logical-key')
    try {
      await host.use(
        definePlugin({
          name: 'p',
          setup: async (context) => {
            /** PluginHost awaits actual native preparation before completing installation. */
            const peer = await scenario.open()
            context.onDispose(peer.close)
            return peer
          },
          install: () => ({})
        })
      )
      expect(scenario.endpointConstructions).toBe(1)
      expect(scenario.endpointMessages).toEqual(['migaia.hello'])
      expect(scenario.channelFeatureCount).toBe(2)
      expect(fixture.messages.map((message) => message.method)).toEqual([
        'migaia.hello',
        'migaia.describe'
      ])
      expect(await scenario.peer.request('p.f.request', ['idempotent'], { timeoutMs: 40 })).toEqual(
        ['idempotent']
      )
      expect(await scenario.peer.request('p.f.plain', ['plain'], { timeoutMs: 40 })).toEqual([
        'plain'
      ])
      expect(
        await scenario.peer.request('p.f.plain', ['key'], {
          timeoutMs: 40,
          idempotencyKey: 'explicit-key'
        })
      ).toEqual(['key'])
      await scenario.peer.notify('p.f.oneWay', ['notification'])
      /** Physical invokes retain all original logical-key and notification assertions. */
      const invokes = fixture.messages.filter((message) => message.method === 'migaia.invoke')
      expect(invokes[0]!.params).toMatchObject({
        meta: { idempotencyKey: 'automatic-logical-key', timeoutMs: 40 }
      })
      expect((invokes[1]!.params as { meta: unknown }).meta).not.toHaveProperty('idempotencyKey')
      expect(invokes[2]!.params).toMatchObject({ meta: { idempotencyKey: 'explicit-key' } })
      expect(invokes[3]).not.toHaveProperty('id')
      expect(() => scenario.peer.request('p.f.request', [() => undefined])).toThrow(
        expect.objectContaining({
          name: 'TypeError',
          source: 'rpc.contract',
          code: 'INVALID_ENVELOPE'
        })
      )
      expect(fixture.messages.filter((message) => message.method === 'migaia.invoke')).toHaveLength(
        4
      )
      expect(scenario.channel.agreement.capabilities).not.toContain('idempotency@1')
    } finally {
      await host.dispose()
    }
    expect(fixture.closes).toBe(1)
  })

  it('does not settle hello or publish a channel before physical drain', async () => {
    /** The physical source owns this one original write-drain gate. */
    let drain!: () => void
    /** Handshake publication cannot overtake the actual raw write completion. */
    const draining = new Promise<void>((resolve) => {
      drain = resolve
    })
    /** The independent foreign peer withholds its original write completion. */
    const fixture = new BridgeFixture({ drain: draining })
    /** Observation belongs only to this original channel preparation Promise. */
    let settled = false
    /** The existing raw source performs the genuine hello exchange. */
    const preparing = fixture.open().then((channel) => {
      settled = true
      return channel
    })
    await flush()
    expect(fixture.writes).toHaveLength(1)
    expect(settled).toBe(false)
    drain()
    /** Only physical drain allows the original accepted channel to publish. */
    const channel = await preparing
    expect(settled).toBe(true)
    expect(fixture.messages).toHaveLength(1)
    await channel.close()
  })

  it.each([
    [
      'stream',
      {
        ...BRIDGE_CONTRACT,
        features: { f: { methods: { generator: { mode: 'generator', idempotent: false } } } }
      },
      'JSONRPC_UNSUPPORTED_MODE'
    ]
  ])(
    'rolls back real PluginHost before publishing a %s description',
    async (_kind, description, code) => {
      /** The foreign peer independently returns the deliberately incompatible directory. */
      const fixture = new BridgeFixture({
        responder: responder(remoteDescription([description as typeof BRIDGE_CONTRACT]))
      })
      /** Ordinary PluginHost retains the original failed-install rollback boundary. */
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      /** Canonical managed startup retains the same actual channel cleanup owner. */
      const scenario = new RemoteBridgeScenario(fixture)
      try {
        await expect(
          host.use(
            definePlugin({
              name: 'p',
              setup: async (context) => {
                /**
                 * A directory rejection prevents installation and leaves cleanup with native
                 * startup.
                 */
                const peer = await scenario.open()
                context.onDispose(peer.close)
                return peer
              },
              install: () => ({})
            })
          )
        ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: { code } })
        expect(fixture.messages.map((message) => message.method)).toEqual([
          'migaia.hello',
          'migaia.describe'
        ])
        expect(fixture.closes).toBe(1)
      } finally {
        await host.dispose()
      }
    }
  )

  it.each([
    ['valid', remoteDescription([BRIDGE_CONTRACT], 'peer', true), undefined],
    ['retired v1 contract', BRIDGE_CONTRACT, 'JSONRPC_PROFILE_INVALID'],
    [
      'stream catalog',
      remoteDescription(
        [
          {
            ...BRIDGE_CONTRACT,
            features: { f: { methods: { stream: { mode: 'generator', idempotent: false } } } }
          }
        ],
        'peer',
        true
      ),
      'JSONRPC_UNSUPPORTED_MODE'
    ]
  ])('validates the Host v2 directory: %s', async (_kind, description, code) => {
    /** Host directory qualification remains an actual JSON-RPC channel contract. */
    const fixture = new BridgeFixture({ responder: responder(description) })
    /** The canonical managed Peer replaces the retired remote ready/release control facade. */
    const scenario = new RemoteBridgeScenario(fixture, true)
    try {
      if (code)
        await expect(scenario.open()).rejects.toMatchObject({
          code,
          ...(_kind === 'retired v1 contract'
            ? { cause: { code: 'JSONRPC_PROFILE_INVALID', cause: { code: 'CONTRACT_INVALID' } } }
            : {})
        })
      else await expect(scenario.open()).resolves.toBeDefined()
      expect(
        fixture.messages.filter((message) => message.method === 'migaia.describe')
      ).toHaveLength(1)
      expect(fixture.messages.filter((message) => message.method === 'migaia.invoke')).toEqual([])
    } finally {
      await scenario.close()
    }
    expect(fixture.closes).toBe(1)
  })
})
