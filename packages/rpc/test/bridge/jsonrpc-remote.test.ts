import { PluginHost } from '@migaia/plugin-host'
import { describe, expect, it } from 'vitest'
import { acceptRpcHandshake } from '../../src/contract/handshake.js'
import { createRemotePlugin } from '../../src/remote/plugin.js'
import { createRemoteHost } from '../../src/remote/host.js'
import { remoteHarness, remoteDescription } from '../remote/fixture.js'
import {
  BRIDGE_CONTRACT,
  BRIDGE_METHODS,
  BRIDGE_PEER_OFFER,
  bridgeEndpoint,
  bridgeFixture,
  flush
} from './fixture.js'

/** Respond with one explicit description and echo all ordinary request arguments. */
function responder(description: unknown) {
  return (message: Record<string, unknown>): unknown => {
    if (message.method === 'migaia.hello') {
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

describe('JSON-RPC remote assembly', () => {
  it('[A3] rejects a missing describe extension through real Host preparation', async () => {
    const fixture = bridgeFixture({
      responder: (message) =>
        message.method === 'migaia.describe'
          ? {
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32601, message: 'describe unavailable' }
            }
          : responder(remoteDescription([BRIDGE_CONTRACT], 'peer', true))(message)
    })
    const neutral = remoteHarness()
    const remote = createRemoteHost({
      catalog: { p: BRIDGE_CONTRACT },
      binding: {
        ...neutral.binding,
        scheduler: fixture.scheduler,
        openChannel: () =>
          fixture.open({ target: { kind: 'host', catalog: { p: BRIDGE_CONTRACT } } })
      },
      endpointFactory: async (channel) => ({ endpoint: await bridgeEndpoint(channel) }),
      report: () => undefined
    })
    try {
      await expect(remote.ready()).rejects.toMatchObject({
        code: 'JSONRPC_EXTENSION_MISSING',
        cause: {
          code: 'JSONRPC_EXTENSION_MISSING',
          cause: { source: 'jsonrpc-2.0', code: '-32601' }
        }
      })
    } finally {
      await remote.release()
    }
    expect(fixture.messages.map((message) => message.method)).toEqual([
      'migaia.hello',
      'migaia.describe'
    ])
    expect(fixture.closes).toBe(1)
  })
  it('[A5] carries Host controls and their results through the real remote facade', async () => {
    const description = remoteDescription([BRIDGE_CONTRACT], 'peer', true)
    const entry = { name: 'p', state: 'enabled', revision: 1, features: ['f'] }
    const fixture = bridgeFixture({
      responder: (message) => {
        if (message.method !== 'migaia.invoke') return responder(description)(message)
        const method = (message.params as { method: string }).method
        const result =
          method === 'migaia.remote.host.use'
            ? entry
            : method === 'migaia.remote.host.unUse'
              ? { ok: true }
              : { revision: 1, plugins: [entry] }
        return { jsonrpc: '2.0', id: message.id, result }
      }
    })
    const neutral = remoteHarness()
    const remote = createRemoteHost({
      catalog: { p: BRIDGE_CONTRACT },
      binding: {
        ...neutral.binding,
        scheduler: fixture.scheduler,
        openChannel: () =>
          fixture.open({ target: { kind: 'host', catalog: { p: BRIDGE_CONTRACT } } })
      },
      endpointFactory: async (channel) => ({ endpoint: await bridgeEndpoint(channel) }),
      report: () => undefined
    })
    try {
      const features = await remote.use('p')
      expect(Object.keys(features)).toEqual(['f'])
      await expect(remote.unUse('p', { policy: 'suspend' })).resolves.toEqual({ ok: true })
      await expect(remote.inspect()).resolves.toEqual({ revision: 1, plugins: [entry] })
      expect(
        fixture.messages
          .filter((message) => message.method === 'migaia.invoke')
          .map((message) => message.params)
      ).toEqual([
        { method: 'migaia.remote.host.use', args: ['p'], meta: { timeoutMs: 1000 } },
        {
          method: 'migaia.remote.host.unUse',
          args: ['p', { policy: 'suspend' }],
          meta: { timeoutMs: 1000 }
        },
        { method: 'migaia.remote.host.inspect', args: [], meta: { timeoutMs: 1000 } }
      ])
    } finally {
      await remote.release()
    }
  })
  it('[A2/A5] gates real PluginHost preparation on one describe and carries the automatic key', async () => {
    const fixture = bridgeFixture({ responder: responder(remoteDescription([BRIDGE_CONTRACT])) })
    const neutral = remoteHarness()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    let channel: Awaited<ReturnType<typeof fixture.open>> | undefined
    let endpointConstructions = 0
    const plugin = createRemotePlugin({
      name: 'p',
      contract: BRIDGE_CONTRACT,
      host: host.plugin,
      binding: {
        ...neutral.binding,
        scheduler: fixture.scheduler,
        openChannel: async () => (channel = await fixture.open())
      },
      endpointFactory: async (incoming) => {
        endpointConstructions++
        expect(fixture.messages.map((message) => message.method)).toEqual(['migaia.hello'])
        expect(incoming.features).toHaveLength(2)
        const endpoint = await bridgeEndpoint(incoming)
        return { endpoint, oneWay: endpoint }
      },
      report: (error) => fixture.reports.push(error),
      keyFactory: () => 'automatic-logical-key'
    })
    try {
      const [handle] = await host.use(plugin)
      expect(endpointConstructions).toBe(1)
      expect(fixture.messages.map((message) => message.method)).toEqual([
        'migaia.hello',
        'migaia.describe'
      ])
      const feature = handle!.getFeature('f') as {
        request(args: unknown[], options?: { timeoutMs?: number }): Promise<unknown>
        plain(
          args: unknown[],
          options?: { timeoutMs?: number; idempotencyKey?: string }
        ): Promise<unknown>
        oneWay(args: unknown[]): Promise<void>
      }
      expect(await feature.request(['idempotent'], { timeoutMs: 40 })).toEqual(['idempotent'])
      expect(await feature.plain(['plain'], { timeoutMs: 40 })).toEqual(['plain'])
      expect(
        await feature.plain(['key'], { timeoutMs: 40, idempotencyKey: 'explicit-key' })
      ).toEqual(['key'])
      await feature.oneWay(['notification'])
      const invokes = fixture.messages.filter((message) => message.method === 'migaia.invoke')
      expect(invokes[0]!.params).toMatchObject({
        meta: { idempotencyKey: 'automatic-logical-key', timeoutMs: 40 }
      })
      expect((invokes[1]!.params as { meta: unknown }).meta).not.toHaveProperty('idempotencyKey')
      expect(invokes[2]!.params).toMatchObject({ meta: { idempotencyKey: 'explicit-key' } })
      expect(invokes[3]).not.toHaveProperty('id')
      await expect(feature.request([() => undefined])).rejects.toMatchObject({
        code: 'REMOTE_CONTRACT_INVALID'
      })
      expect(fixture.messages.filter((message) => message.method === 'migaia.invoke')).toHaveLength(
        4
      )
      expect(channel!.agreement.capabilities).not.toContain('idempotency@1')
    } finally {
      await host.dispose()
    }
    expect(fixture.closes).toBe(1)
  })
  it('[A2] does not settle hello or publish a channel before physical drain', async () => {
    let drain!: () => void
    const draining = new Promise<void>((resolve) => {
      drain = resolve
    })
    const fixture = bridgeFixture({ drain: draining })
    let settled = false
    const preparing = fixture.open().then((channel) => {
      settled = true
      return channel
    })
    await flush()
    expect(fixture.writes).toHaveLength(1)
    expect(settled).toBe(false)
    drain()
    const channel = await preparing
    expect(settled).toBe(true)
    expect(fixture.messages).toHaveLength(1)
    await channel.close()
  })
  it.each([
    [
      'mismatch',
      {
        ...BRIDGE_CONTRACT,
        features: { f: { methods: { request: { mode: 'request', idempotent: true } } } }
      },
      'REMOTE_CONTRACT_INVALID'
    ],
    [
      'stream',
      {
        ...BRIDGE_CONTRACT,
        features: { f: { methods: { generator: { mode: 'generator', idempotent: false } } } }
      },
      'JSONRPC_UNSUPPORTED_MODE'
    ]
  ])(
    '[A3] rolls back real PluginHost before publishing a %s description',
    async (_kind, description, code) => {
      const fixture = bridgeFixture({
        responder: responder(remoteDescription([description as typeof BRIDGE_CONTRACT]))
      })
      const neutral = remoteHarness()
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      const plugin = createRemotePlugin({
        name: 'p',
        contract: BRIDGE_CONTRACT,
        host: host.plugin,
        binding: {
          ...neutral.binding,
          scheduler: fixture.scheduler,
          openChannel: () => fixture.open()
        },
        endpointFactory: async (channel) => ({ endpoint: await bridgeEndpoint(channel) }),
        report: () => undefined
      })
      try {
        await expect(host.use(plugin)).rejects.toMatchObject({
          code: 'PLUGIN_INSTALL_FAILED',
          cause: { code }
        })
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
      'wrong catalog',
      remoteDescription([{ ...BRIDGE_CONTRACT, plugin: 'q' }], 'peer', true),
      'REMOTE_CONTRACT_INVALID'
    ],
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
  ])('[A3] validates the Host v2 directory: %s', async (_kind, description, code) => {
    const fixture = bridgeFixture({ responder: responder(description) })
    const neutral = remoteHarness()
    const remote = createRemoteHost({
      catalog: { p: BRIDGE_CONTRACT },
      binding: {
        ...neutral.binding,
        scheduler: fixture.scheduler,
        openChannel: () =>
          fixture.open({ target: { kind: 'host', catalog: { p: BRIDGE_CONTRACT } } })
      },
      endpointFactory: async (channel) => ({ endpoint: await bridgeEndpoint(channel) }),
      report: () => undefined
    })
    try {
      if (code)
        await expect(remote.ready()).rejects.toMatchObject({
          code,
          ...(_kind === 'retired v1 contract'
            ? { cause: { code: 'JSONRPC_PROFILE_INVALID', cause: { code: 'CONTRACT_INVALID' } } }
            : {})
        })
      else await expect(remote.ready()).resolves.toBeUndefined()
      expect(
        fixture.messages.filter((message) => message.method === 'migaia.describe')
      ).toHaveLength(1)
      expect(fixture.messages.filter((message) => message.method === 'migaia.invoke')).toEqual([])
    } finally {
      await remote.release()
    }
    expect(fixture.closes).toBe(1)
  })
})
