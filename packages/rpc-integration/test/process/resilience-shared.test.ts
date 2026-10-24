import { RpcCapability } from '@migaia/rpc-contract'
import { RemoteMethodName } from '@migaia/rpc-host/plugin'
import type { IProcessByteChannel } from '../../../rpc-plugin-process/dist/process/types.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../../rpc-plugin-process/dist/process/adapters/node-socket.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import {
  createRuntimePeer,
  type IRuntimePeer
} from '../../../rpc-host/dist/remote/runtime-api/peer.js'
import type { IRpcProvider } from '../../../rpc-host/dist/core/typing.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import { createLifecycleScope } from '@migaia/lifecycle'
import {
  serveProcessSessions,
  type IProcessReadySession
} from '../../../rpc-plugin-process/dist/process/plugin/serve.js'
import { createProcessResilience } from '../../../rpc-plugin-process/dist/process/resilience/index.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import type {
  IProcessServeChildIngress,
  IProcessServeListenerIngress
} from '../../../rpc-plugin-process/dist/process/plugin/types.js'
import type { IProcessServeEndpointFactory } from '../../../rpc-plugin-process/dist/process/plugin/types.js'
import type { IProcessSessionIdentity } from '../../../rpc-plugin-process/dist/process/resilience/types.js'
import type { IRemoteServeEndpoint } from '@migaia/rpc-host/plugin'
import { nativeBytePair, nativeEndpoint } from './fixtures/native-runtime.js'

/** Fixture composition uses only retained target/session ports, without deprecated facade types. */
type IServiceFixtureOptions = Readonly<{
  contract: import('@migaia/rpc-host/plugin').IRemoteContract
  report(error: unknown): void
  ingress: IProcessServeChildIngress | IProcessServeListenerIngress
  endpointFactory: IProcessServeEndpointFactory
}>

/** The local application keeps its original argument-vector and accepted-session invocation shape. */
type ILocalSessionMethods = Readonly<{
  request(
    value: unknown,
    invocation: Readonly<{ session: IProcessSessionIdentity; signal: IAbortSignal }>
  ): unknown
  notify?(
    value: unknown,
    invocation: Readonly<{ session: IProcessSessionIdentity; signal: IAbortSignal }>
  ): unknown
  generator?(
    value: unknown,
    invocation: Readonly<{ session: IProcessSessionIdentity; signal: IAbortSignal }>
  ): Iterable<unknown> | AsyncIterable<unknown>
}>

/** Build only actual Runtime Peer providers over these original local application methods. */
function sessionProvide(methods: ILocalSessionMethods, identity: IProcessSessionIdentity) {
  /** One immutable invocation selection retains native identity and original local method receivers. */
  const local = { methods, identity }
  return {
    p: {
      f: {
        request: (payload: unknown, context: Parameters<IRpcProvider>[0]) =>
          local.methods.request(
            (payload as unknown[])[0],
            Object.freeze({ session: local.identity, signal: context.signal })
          ),
        ...(methods.notify
          ? {
              notify: (payload: unknown, context: Parameters<IRpcProvider>[0]) =>
                local.methods.notify!(
                  (payload as unknown[])[0],
                  Object.freeze({ session: local.identity, signal: context.signal })
                )
            }
          : {}),
        ...(methods.generator
          ? {
              generator: (payload: unknown, context: Parameters<IRpcProvider>[0]) =>
                local.methods.generator!(
                  (payload as unknown[])[0],
                  Object.freeze({ session: local.identity, signal: context.signal })
                )
            }
          : {})
      }
    }
  }
}

/**
 * Canonical Peer construction owns its directory, providers and startup rollback on the same
 * endpoint.
 */
async function sessionPeer(
  session: IProcessReadySession,
  methods: ILocalSessionMethods,
  options: IServiceFixtureOptions
) {
  return createRuntimePeer(
    {
      self: { name: 'server', instanceId: 'server' },
      provide: sessionProvide(methods, session.identity),
      contract: options.contract,
      report: options.report
    },
    { channel: session.channel, signal: session.signal, endpoint: session.endpoint }
  )
}

describe('default process resilience wiring', () => {
  it('serves child request, one-way and generator context and removes its parent-loss guard on explicit close', async () => {
    /** Source-loaded child ingress supplements the actual Node child acceptance path. */
    const [parentRaw, childRaw] = nativeBytePair()
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const sessions: IProcessSessionIdentity[] = []
    const target = definePlugin({
      name: 'p',
      features: {
        f: defineFeature(() => ({
          request: (value: unknown, context: { session: IProcessSessionIdentity }) => {
            sessions.push(context.session)
            return value
          },
          notify: (_value: unknown, context: { session: IProcessSessionIdentity }) => {
            sessions.push(context.session)
          },
          *generator(value: unknown, context: { session: IProcessSessionIdentity }) {
            sessions.push(context.session)
            yield value
          }
        }))
      },
      install: () => ({})
    })
    const [sharedTarget] = await host.use(target)
    const contract = {
      schemaVersion: 1 as const,
      plugin: 'p',
      features: {
        f: {
          methods: {
            request: { mode: 'request' as const, idempotent: false },
            notify: { mode: 'one-way' as const, idempotent: false },
            generator: { mode: 'generator' as const, idempotent: false }
          }
        }
      }
    }
    const exit = vi.fn()
    const reports: unknown[] = []
    const serving = (() => {
      /** The canonical session and target-selection owners retain the original default policy. */
      const options: IServiceFixtureOptions = {
        contract,
        report: (error) => reports.push(error),
        endpointFactory: (channel, _signal, session) => nativeEndpoint(channel, 'server', session),
        ingress: {
          kind: 'child',
          channelKind: 'byte',
          parentLoss: { exit },
          openRaw: async () => ({
            raw: childRaw,
            bootstrap: new TextEncoder().encode('child-secret')
          }),
          createVerifier: (bytes) => (auth) => {
            expect(auth).toBe(new TextDecoder().decode(bytes))
          },
          establish: (raw, context) =>
            createProcessTransport(raw as IProcessByteChannel, {
              role: 'responder',
              scheduler: context.scheduler,
              peerId: 'parent',
              offer: createNativeProcessOffer({
                peer: { id: 'server', runtime: 'node' },
                stream: true,
                capabilities: [RpcCapability.runtimeApi]
              }),
              auth: { mode: 'required', verify: context.verify! },
              ipc: { ...context.session, log: () => undefined },
              report: (error) => reports.push(error)
            })
        }
      }
      const resilience = createProcessResilience({
        scheduler: systemScheduler,
        report: options.report
      })
      return serveProcessSessions(
        options.ingress,
        options.endpointFactory,
        async (session) => {
          /** This is the original local application output, not a remote Plugin proxy. */
          const methods = sharedTarget.getFeature('f') as ILocalSessionMethods
          /** The actual Peer is accepted only after native control/directory preparation. */
          const peer = await sessionPeer(session, methods, options)
          return { close: peer.close }
        },
        resilience,
        options.report,
        undefined,
        systemScheduler,
        { release: () => resilience.close() }
      )
    })()
    const parentChannel = await createProcessTransport(parentRaw, {
      role: 'initiator',
      peerId: 'server',
      offer: createNativeProcessOffer({
        peer: { id: 'parent', runtime: 'node' },
        auth: 'child-secret',
        stream: true,
        capabilities: [RpcCapability.runtimeApi]
      }),
      ipc: { connectionId: 'parent', sessionId: 'parent', log: () => undefined },
      report: (error) => reports.push(error)
    })
    const client = await nativeEndpoint(parentChannel, 'parent')
    /** Actual caller control replies run through Core before it activates this same byte receiver. */
    const clientPeer = await createRuntimePeer(
      { self: { name: 'parent', instanceId: 'parent' }, report: (error) => reports.push(error) },
      { channel: parentChannel, endpoint: client }
    )
    const service = await serving
    try {
      expect(await client.endpoint.send('server', 'p.f.request', ['value'])).toBe('value')
      await client.oneWay!.sendOneWay('server', 'p.f.notify', ['notify'])
      const stream = client.stream!.open('server', 'migaia.remote.runtime.stream.p.f.generator', [
        'stream'
      ])
      expect(await stream.next()).toEqual({ done: false, value: 'stream' })
      await stream.next()
      expect(sessions).toHaveLength(3)
      expect(new Set(sessions.map((session) => session.sessionId)).size).toBe(1)
      expect(Object.isFrozen(sessions[0])).toBe(true)
      const closing = service.close()
      expect(service.close()).toBe(closing)
      await closing
      expect(exit).not.toHaveBeenCalled()
      expect(JSON.stringify(reports)).not.toContain('child-secret')
    } finally {
      await service.close()
      await clientPeer.close()
      await client.endpoint.dispose()
      await parentChannel.close()
      await host.dispose()
    }
  })
  it.each(['shared', 'per-connection'] as const)(
    'serves %s real authenticated Unix sessions with isolated quotas',
    async (instanceMode) => {
      /** Only this fixture's new socket is created; existing rendezvous files are untouched. */
      const directory = await mkdtemp(join(tmpdir(), 'rpc-resilience-'))
      const address = join(directory, 'service.sock')
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      /** Real requests occupy all 32 default core leases until this fixture releases them. */
      let finishHeld!: () => void
      const held = new Promise<void>((resolve) => {
        finishHeld = resolve
      })
      const identities: IProcessSessionIdentity[] = []
      const execute = vi.fn((value: string, context: { session: IProcessSessionIdentity }) => {
        identities.push(context.session)
        return value === 'hold' ? held.then(() => value) : value
      })
      const target = definePlugin({
        name: 'p',
        features: { f: defineFeature(() => ({ request: execute })) },
        install: () => ({})
      })
      const [sharedTarget] = await host.use(target)
      const contract = {
        schemaVersion: 1 as const,
        plugin: 'p',
        features: { f: { methods: { request: { mode: 'request' as const, idempotent: true } } } }
      }
      /** Real endpoint ownership is tracked separately from connection identities. */
      const clients: IRemoteServeEndpoint[] = []
      /** Actual caller Peers answer canonical directory controls on the same physical channels. */
      const clientPeers: IRuntimePeer[] = []
      /** Count actual startup provider calls before opening the original business-only bucket. */
      const startupDescriptions: number[] = []
      const channels: Awaited<ReturnType<typeof createProcessTransport>>[] = []
      const reports: unknown[] = []
      /** Genuine directory startup completes before the original 600-business-call rate window. */
      let offset = 0
      /** Native timers stay real while the existing quota owner can enter a fresh minute bucket. */
      const scheduler = { ...systemScheduler, now: () => systemScheduler.now() + offset }
      /** The per-connection factory owns one distinct target Host for each physical session. */
      const ownedTargets: PluginHost<Record<string, never>>[] = []
      const disposals: ReturnType<typeof vi.spyOn>[] = []
      let sequence = 0
      const serving = await (() => {
        /** The canonical session and target-selection owners retain the original default policy. */
        const options: IServiceFixtureOptions = {
          contract,
          report: (error) => reports.push(error),
          endpointFactory: (channel, _signal, session) =>
            nativeEndpoint(channel, 'server', session),
          ingress: {
            kind: 'listener',
            address,
            scheduler,
            listen: listenProcessByteChannel,
            verify: (auth) =>
              auth === 'alice-secret' ? 'alice' : auth === 'bob-secret' ? 'bob' : '',
            offer: createNativeProcessOffer({
              peer: { id: 'server', runtime: 'node' },
              stream: true,
              capabilities: [RpcCapability.runtimeApi]
            }),
            createConnectionContext: () => {
              const id = `client-${++sequence}`
              return {
                peerId: id,
                ipc: { connectionId: id, sessionId: `session-${sequence}`, log: () => undefined }
              }
            }
          }
        }
        const resilience = createProcessResilience({
          scheduler,
          report: options.report
        })
        return serveProcessSessions(
          options.ingress,
          options.endpointFactory,
          async (session) => {
            /**
             * Existing lifecycle owns per-connection local application resources in native close
             * order.
             */
            const lifetime = createLifecycleScope({
              scheduler,
              report: options.report
            })
            try {
              /**
               * Shared mode borrows the original installed application; owned mode registers
               * locally.
               */
              let installed = sharedTarget
              if (instanceMode === 'per-connection') {
                /** One actual local application Host belongs only to this accepted physical session. */
                const owned = new PluginHost<Record<string, never>>({
                  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
                })
                lifetime.own(owned, {
                  force: async () => {
                    await owned.dispose()
                  }
                })
                const [created] = await owned.use(target)
                installed = created
                ownedTargets.push(owned)
                disposals.push(vi.spyOn(owned, 'dispose'))
              }
              /**
               * Direct local output supplies the same original business method and invocation
               * count.
               */
              const methods = installed.getFeature('f') as ILocalSessionMethods
              /**
               * The canonical runtime provider assembly uses this real accepted endpoint and
               * identity.
               */
              const peer = await sessionPeer(session, methods, options)
              lifetime.own(peer, { force: () => peer.close() })
              return {
                close: async () => {
                  await lifetime.dispose()
                }
              }
            } catch (primary) {
              try {
                await lifetime.dispose()
              } catch (cleanup) {
                options.report(cleanup)
              }
              throw primary
            }
          },
          resilience,
          options.report,
          undefined,
          scheduler,
          { release: () => resilience.close() }
        )
      })()
      try {
        for (const auth of ['alice-secret', 'alice-secret', 'bob-secret', 'bob-secret']) {
          const id = `client-${clients.length + 1}`
          const raw = await dialProcessByteChannel({ address })
          const channel = await createProcessTransport(raw, {
            role: 'initiator',
            peerId: 'server',
            scheduler,
            offer: createNativeProcessOffer({
              peer: { id, runtime: 'node' },
              auth,
              stream: true,
              capabilities: [RpcCapability.runtimeApi]
            }),
            ipc: { connectionId: id, sessionId: id, log: () => undefined },
            report: (error) => reports.push(error)
          })
          channels.push(channel)
          /** Raw business oracle and Core control Peer share the same actual prepared kernel. */
          const endpoint = await nativeEndpoint(channel, id)
          clients.push(endpoint)
          /** This index belongs to the same physical connection and its one directory exchange. */
          const index = clientPeers.length
          startupDescriptions.push(0)
          clientPeers.push(
            await createRuntimePeer(
              { self: { name: id, instanceId: id }, report: (error) => reports.push(error) },
              {
                channel,
                endpoint: {
                  ...endpoint,
                  endpoint: Object.create(endpoint.endpoint, {
                    send: {
                      /** Count only startup sends and retain every original native send Promise. */
                      value: <T>(...args: Parameters<typeof endpoint.endpoint.send>) => {
                        if (args[1] === RemoteMethodName.runtimeDescribe)
                          startupDescriptions[index]! += 1
                        return endpoint.endpoint.send<T>(...args)
                      }
                    }
                  })
                }
              }
            )
          )
        }
        expect(startupDescriptions).toEqual([1, 1, 1, 1])
        /** Keep the tested default quota exact; setup controls belong to the preceding bucket. */
        offset = 60_000
        for (const client of clients)
          expect(
            await client.endpoint.send('server', 'p.f.request', ['value'], {
              idempotencyKey: 'shared-key'
            })
          ).toBe('value')
        expect(execute).toHaveBeenCalledTimes(2)
        expect(identities.map((identity) => identity.principalId)).toEqual(['alice', 'bob'])
        await clients[0]!.endpoint.dispose()
        await channels[0]!.close()
        expect(
          await clients[1]!.endpoint.send('server', 'p.f.request', ['another'], {
            idempotencyKey: 'another-key'
          })
        ).toBe('another')
        expect(identities[2]?.sessionId).toBe('session-2')
        /** The actual default 600-call limit must close only the offending authenticated session. */
        for (let call = 0; call < 599; call += 1)
          await clients[1]!.endpoint.send('server', 'p.f.request', ['rate'])
        const executed = execute.mock.calls.length
        await expect(
          clients[1]!.endpoint.send('server', 'p.f.request', ['excess'])
        ).rejects.toMatchObject({ cause: { code: 'PROCESS_CONNECTION_LIMIT' } })
        await expect(
          clients[1]!.endpoint.send('server', 'p.f.request', ['excess-again'])
        ).rejects.toBeInstanceOf(Error)
        await vi.waitFor(() => expect(channels[1]!.transport.closed).toBe(true))
        expect(execute).toHaveBeenCalledTimes(executed)
        expect(
          await clients[2]!.endpoint.send('server', 'p.f.request', ['value'], {
            idempotencyKey: 'shared-key'
          })
        ).toBe('value')
        expect(execute).toHaveBeenCalledTimes(executed)
        /** Only actual concurrent core refusals close the offending physical connection. */
        const inFlight = Array.from({ length: 32 }, () =>
          clients[2]!.endpoint.send('server', 'p.f.request', ['hold']).then(
            (value) => value,
            (error: unknown) => error
          )
        )
        await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(executed + 32))
        await expect(
          clients[2]!.endpoint.send('server', 'p.f.request', ['overload'])
        ).rejects.toMatchObject({ code: 'OVERLOADED' })
        expect(channels[2]!.transport.closed).toBe(false)
        await expect(
          clients[2]!.endpoint.send('server', 'p.f.request', ['overload-again'])
        ).rejects.toMatchObject({ code: 'OVERLOADED' })
        finishHeld()
        await Promise.all(inFlight)
        await vi.waitFor(() => expect(channels[2]!.transport.closed).toBe(true))
        expect(execute).toHaveBeenCalledTimes(executed + 32)
        expect(
          await clients[3]!.endpoint.send('server', 'p.f.request', ['value'], {
            idempotencyKey: 'shared-key'
          })
        ).toBe('value')
        expect(execute).toHaveBeenCalledTimes(executed + 32)
        if (instanceMode === 'per-connection') {
          expect(new Set(ownedTargets).size).toBe(4)
          expect(disposals.slice(0, 3).map((dispose) => dispose.mock.calls.length)).toEqual([
            1, 1, 1
          ])
          expect(disposals[3]).not.toHaveBeenCalled()
        } else expect(ownedTargets).toEqual([])
        expect(JSON.stringify(reports)).not.toContain('secret')
      } finally {
        finishHeld()
        await Promise.allSettled(clientPeers.map((peer) => peer.close()))
        await Promise.allSettled(clients.map((client) => client.endpoint.dispose()))
        await Promise.allSettled(channels.map((channel) => channel.close()))
        await serving.close()
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledTimes(1)
        await host.dispose()
      }
    }
  )
})
