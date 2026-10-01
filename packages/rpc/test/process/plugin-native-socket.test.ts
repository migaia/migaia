import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it } from 'vitest'
import { createEndpoint } from '../../src/core/index.js'
import type { IRpcEndpoint } from '../../src/core/typing.js'
import { abort } from '../../src/core/middleware/abort.js'
import { codec } from '../../src/core/middleware/codec.js'
import { connect } from '../../src/core/middleware/connect.js'
import { framer } from '../../src/core/middleware/framer.js'
import { ping } from '../../src/core/middleware/ping.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import { createServeProcessPlugin } from '../../src/process/plugin/serve.js'
import type { IProcessByteListener } from '../../src/process/types.js'
import type { IRemoteContract } from '../../src/remote/contract.js'
import type { IRemoteChannel, IRemoteServeEndpoint } from '../../src/remote/types.js'

/** A real Unix socket keeps the external listener alive across client unUse. */
const contract: IRemoteContract = {
  schemaVersion: 1,
  plugin: 'p',
  features: { f: { methods: { request: { mode: 'request', idempotent: false } } } }
}

/** Each endpoint uses the authenticated channel's negotiated codec and IPC features. */
async function endpointFor(channel: IRemoteChannel, id: string): Promise<IRemoteServeEndpoint> {
  const endpoint = await createEndpoint({
    id,
    transport: channel.transport,
    features: [channel.features[0]!, channel.features[1]!] as const,
    middlewares: [
      codec(channel.pipeline.codec),
      framer(channel.pipeline.framer),
      abort(),
      connect({ transport: channel.transport }),
      ping()
    ]
  })
  return { endpoint: endpoint as unknown as IRpcEndpoint }
}

describe('native process plugin socket', () => {
  it('[A2/A4/A8] authenticates two clients and isolates a rejected token', async () => {
    const address = join(tmpdir(), `rp-${randomUUID().slice(0, 8)}.sock`)
    const token = 'socket-plugin-secret'
    const serverHost = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await serverHost.use(
      definePlugin({
        name: 'p',
        features: { f: defineFeature(() => ({ request: (value: unknown) => `socket:${value}` })) },
        install: () => ({})
      })
    )
    /** Server-generated session IDs distinguish simultaneous authenticated sockets. */
    let accepted = 0
    /** Endpoint construction proves only authenticated connections reach the provider. */
    let endpoints = 0
    /** Listener closure must not close already authenticated sessions. */
    let listener: IProcessByteListener | undefined
    const serving = await createServeProcessPlugin({
      host: serverHost,
      contract,
      createSharedTarget: async () => undefined,
      onInstanceUnhealthy: () => () => undefined,
      report: () => undefined,
      endpointFactory: async (channel) => {
        endpoints += 1
        return endpointFor(channel, 'server')
      },
      ingress: {
        kind: 'listener',
        listen: async (options) => {
          listener = await listenProcessByteChannel(options)
          return listener
        },
        address,
        verify(auth) {
          if (auth !== token) throw new TypeError('authentication rejected')
          return 'trusted-client'
        },
        offer: createNativeProcessOffer({ peer: { id: 'server', runtime: 'node' } }),
        createConnectionContext: () => {
          accepted += 1
          return {
            peerId: `client-${accepted}`,
            ipc: {
              connectionId: `server-connection-${accepted}`,
              sessionId: `server-session-${accepted}`,
              log: () => undefined
            }
          }
        }
      }
    })
    /** The two local Hosts own only their respective borrowed socket sessions. */
    const clients = [0, 1].map(
      () =>
        new PluginHost<Record<string, never>>({
          execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
        })
    )
    /** The adapter must use the token passed by the binding, including wrong tokens. */
    const pluginFor = (host: (typeof clients)[number], credential: string, clientId: string) =>
      createProcessPlugin({
        name: 'p',
        contract,
        registrationOwner: { name: 'p', host },
        host: host.plugin,
        report: () => undefined,
        endpointFactory: (channel) => endpointFor(channel, clientId),
        deployment: {
          kind: 'connect',
          address,
          token: credential,
          dial: (path) => dialProcessByteChannel({ address: path }),
          establish: (raw, options) => {
            if (raw.kind !== 'byte' || options.role !== 'initiator')
              throw new TypeError('expected byte initiator')
            return createProcessTransport(raw, {
              role: 'initiator',
              offer: createNativeProcessOffer({
                peer: { id: 'client', runtime: 'node' },
                auth: options.token
              }),
              peerId: 'server',
              ipc: { ...options.session, log: () => undefined },
              scheduler: options.scheduler,
              report: () => undefined
            })
          }
        }
      })
    try {
      const [first] = await clients[0]!.use(pluginFor(clients[0]!, token, 'client-1'))
      const [second] = await clients[1]!.use(pluginFor(clients[1]!, token, 'client-2'))
      const request = (handle: typeof first) =>
        (handle!.getFeature('f') as { request(params: unknown[]): Promise<unknown> }).request([
          'ready'
        ])
      expect(await request(first)).toBe('socket:ready')
      expect(await request(second)).toBe('socket:ready')
      const wrongHost = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      try {
        await expect(
          wrongHost.use(pluginFor(wrongHost, 'wrong-token', 'client-3'))
        ).rejects.toBeDefined()
        expect(endpoints).toBe(2)
      } finally {
        await wrongHost.dispose()
      }
      await clients[0]!.dispose()
      expect(await request(second)).toBe('socket:ready')
      await listener!.close()
      expect(await request(second)).toBe('socket:ready')
      expect(endpoints).toBe(2)
      expect(accepted).toBe(3)
    } finally {
      await Promise.allSettled(clients.map((host) => host.dispose()))
      await serving.close()
      await serverHost.dispose()
    }
  })
})
