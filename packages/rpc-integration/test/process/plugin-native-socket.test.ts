import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { runtimeTestHost } from '../../../rpc-host/test/runtime-api/fixture.js'
import { RUNTIME_API_BASE_CAPABILITIES } from '../../../rpc-host/dist/remote/runtime-api/constants.js'
import { describe, expect, it } from 'vitest'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { observeNativeEndpoints } from './fixtures/host-native.js'
import type { IProcessServeListenerIngress } from '../../../rpc-plugin-process/dist/process/plugin/types.js'
import type { IProcessByteListener } from '../../../rpc-plugin-process/dist/process/types.js'
import type { IRemoteContract } from '@migaia/rpc-host/plugin'

/** The real Unix provider is locally installed before any authenticated listener is published. */
const contract: IRemoteContract = {
  schemaVersion: 1,
  plugin: 'p',
  features: { f: { methods: { request: { mode: 'request', idempotent: false } } } }
}

/** Own the original native listener, per-session counts and independent client Hosts. */
class NativeSocketScenario {
  /** Every case owns one unique native rendezvous address. */
  readonly #address = join(tmpdir(), `rp-${randomUUID().slice(0, 8)}.sock`)
  /** Only authenticated native handshakes may consume the provider preparation seam. */
  readonly #token = 'socket-plugin-secret'
  /** The ordinary server Host owns its installed provider and native listener. */
  readonly server = runtimeTestHost({
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  /** Independent client Hosts own only their respective borrowed physical sessions. */
  readonly clients = [0, 1].map(() =>
    runtimeTestHost({
      host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    })
  )
  /** Pending native acceptance happens before authentication and may include a rejected token. */
  #accepted = 0
  /** Genuine authenticated Peer construction proves rejected credentials never reach the provider. */
  #endpoints = 0
  /** Closing this native listener must retain already authenticated sessions. */
  #listener: IProcessByteListener | undefined
  /** Remove the original native endpoint observation when this scenario retires. */
  #removeObservation: (() => void) | undefined

  /** Observe actual authenticated sessions independently of pending raw socket acceptance. */
  get endpoints(): number {
    return this.#endpoints
  }
  /** The same original listener acceptance count includes the deliberately rejected third client. */
  get accepted(): number {
    return this.#accepted
  }

  /** Install actual business, then the genuine native listener without an endpoint factory override. */
  async listen(): Promise<void> {
    await this.server.use(
      definePlugin({
        name: 'p',
        features: { f: defineFeature(() => ({ request: (value: unknown) => `socket:${value}` })) },
        install: () => ({})
      })
    )
    this.#removeObservation = observeNativeEndpoints('server', (served) => {
      this.#endpoints += 1
      return served
    })
    await this.server.use(
      processPlugin({
        name: 'listener',
        self: { name: 'server', instanceId: 'server' },
        expose: ['p'],
        contract,
        report: () => undefined,
        listen: {
          kind: 'listener',
          address: this.#address,
          listen: this.#listen,
          verify: this.#verify,
          offer: createNativeProcessOffer({
            peer: { id: 'server', runtime: 'node' },
            capabilities: RUNTIME_API_BASE_CAPABILITIES
          }),
          createConnectionContext: this.#connectionContext
        }
      })
    )
  }
  /** Retain the actual borrowed listener receipt returned by the platform owner. */
  readonly #listen = async (options: Parameters<typeof listenProcessByteChannel>[0]) => {
    this.#listener = await listenProcessByteChannel(options)
    return this.#listener
  }
  /** A wrong bootstrap credential cannot reach native endpoint or provider installation. */
  readonly #verify: IProcessServeListenerIngress['verify'] = (auth) => {
    if (auth !== this.#token) throw new TypeError('authentication rejected')
    return 'trusted-client'
  }
  /** Allocate distinct original nonsecret session labels before authenticating each raw client. */
  readonly #connectionContext = () => {
    this.#accepted += 1
    return {
      peerId: `client-${this.#accepted}`,
      ipc: {
        connectionId: `server-connection-${this.#accepted}`,
        sessionId: `server-session-${this.#accepted}`,
        log: () => undefined
      }
    }
  }
  /** Create a cold native borrowed source; its exact selected credential reaches the handshake. */
  plugin(clientId: string, credential = this.#token) {
    return processPlugin({
      name: 'server',
      self: { name: clientId, instanceId: clientId },
      report: () => undefined,
      connect: {
        target: {
          kind: 'connect',
          address: this.#address,
          token: credential,
          dial: (address) => dialProcessByteChannel({ address }),
          establish: (raw, context) => {
            if (raw.kind !== 'byte' || context.role !== 'initiator')
              throw new TypeError('expected byte initiator')
            return createProcessTransport(raw, {
              role: 'initiator',
              offer: createNativeProcessOffer({
                peer: { id: clientId, runtime: 'node' },
                auth: context.token,
                capabilities: RUNTIME_API_BASE_CAPABILITIES
              }),
              peerId: 'server',
              ipc: { ...context.session, log: () => undefined },
              scheduler: context.scheduler,
              report: () => undefined
            })
          }
        }
      }
    })
  }
  /** Close only the real listener while existing authenticated sessions stay usable. */
  async closeListener(): Promise<void> {
    await this.#listener!.close()
  }
  /** Retire original client/server Hosts and remove the native observation even on cleanup failure. */
  async close(): Promise<void> {
    try {
      await Promise.allSettled(this.clients.map((host) => host.dispose()))
      await this.server.dispose()
    } finally {
      this.#removeObservation?.()
    }
  }
}

describe('native process plugin socket', () => {
  it('authenticates two clients and isolates a rejected token', async () => {
    /** All counters and native listener resources belong to this exact original scenario. */
    const test = new NativeSocketScenario()
    try {
      await test.listen()
      await test.clients[0]!.use(test.plugin('client-1'))
      await test.clients[1]!.use(test.plugin('client-2'))
      expect(await test.clients[0]!.process!.request('server', 'p.request', 'ready')).toBe(
        'socket:ready'
      )
      expect(await test.clients[1]!.process!.request('server', 'p.request', 'ready')).toBe(
        'socket:ready'
      )
      /** The third actual native Host supplies a wrong token instead of bypassing physical auth. */
      const wrongHost = runtimeTestHost({
        host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      })
      try {
        await expect(wrongHost.use(test.plugin('client-3', 'wrong-token'))).rejects.toBeDefined()
        expect(test.endpoints).toBe(2)
      } finally {
        await wrongHost.dispose()
      }
      await test.clients[0]!.dispose()
      expect(await test.clients[1]!.process!.request('server', 'p.request', 'ready')).toBe(
        'socket:ready'
      )
      await test.closeListener()
      expect(await test.clients[1]!.process!.request('server', 'p.request', 'ready')).toBe(
        'socket:ready'
      )
      expect(test.endpoints).toBe(2)
      expect(test.accepted).toBe(3)
    } finally {
      await test.close()
    }
  })
})
