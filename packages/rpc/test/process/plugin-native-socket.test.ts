import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { runtimeTestHost } from '../runtime-api/fixture.js'
import { RUNTIME_API_BASE_CAPABILITIES } from '../../src/remote/runtime-api/constants.js'
import { prepareRuntimePeerEndpoint } from '../../src/remote/runtime-api/peer.js'
import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import { describe, expect, it } from 'vitest'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
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
function endpointFor(channel: IRemoteChannel, id: string): Promise<IRemoteServeEndpoint> {
  return prepareRuntimePeerEndpoint(
    { self: { name: id, instanceId: id }, report: () => undefined },
    channel,
    new AbortController().signal
  )
}

describe('native process plugin socket', () => {
  it('[A2/A4/A8] authenticates two clients and isolates a rejected token', async () => {
    const address = join(tmpdir(), `rp-${randomUUID().slice(0, 8)}.sock`)
    const token = 'socket-plugin-secret'
    const serverHost = runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
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
    await serverHost.use(
      createProcessPlugin({
        name: 'listener',
        self: { name: 'server', instanceId: 'server' },
        expose: ['p'],
        contract,
        report: () => undefined,
        endpointFactory: async (channel) => {
          endpoints += 1
          return endpointFor(channel, 'server')
        },
        listen: {
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
          offer: createNativeProcessOffer({
            peer: { id: 'server', runtime: 'node' },
            capabilities: RUNTIME_API_BASE_CAPABILITIES
          }),
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
    )
    /** The two local Hosts own only their respective borrowed socket sessions. */
    const clients = [0, 1].map(() =>
      runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
    )
    /** The adapter must use the token passed by the binding, including wrong tokens. */
    const pluginFor = (credential: string, clientId: string) =>
      createProcessPlugin<IRuntimeDynamicSurface>({
        name: 'server',
        self: { name: 'client', instanceId: clientId },
        report: () => undefined,
        endpointFactory: (channel) => endpointFor(channel, clientId),
        connect: {
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
                peer: { id: clientId, runtime: 'node' },
                auth: options.token,
                capabilities: RUNTIME_API_BASE_CAPABILITIES
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
      await clients[0]!.use(pluginFor(token, 'client-1'))
      await clients[1]!.use(pluginFor(token, 'client-2'))
      expect(await clients[0]!.process!.request('server', 'p.request', 'ready')).toBe(
        'socket:ready'
      )
      expect(await clients[1]!.process!.request('server', 'p.request', 'ready')).toBe(
        'socket:ready'
      )
      const wrongHost = runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
      try {
        await expect(wrongHost.use(pluginFor('wrong-token', 'client-3'))).rejects.toBeDefined()
        expect(endpoints).toBe(2)
      } finally {
        await wrongHost.dispose()
      }
      await clients[0]!.dispose()
      expect(await clients[1]!.process!.request('server', 'p.request', 'ready')).toBe(
        'socket:ready'
      )
      await listener!.close()
      expect(await clients[1]!.process!.request('server', 'p.request', 'ready')).toBe(
        'socket:ready'
      )
      expect(endpoints).toBe(2)
      expect(accepted).toBe(3)
    } finally {
      await Promise.allSettled(clients.map((host) => host.dispose()))
      await serverHost.dispose()
    }
  })
})
