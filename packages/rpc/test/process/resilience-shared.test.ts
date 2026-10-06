import type { IProcessByteChannel } from '../../src/process/types.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineFeature, definePlugin, PluginHost } from '@migaia/plugin-host'
import { describe, expect, it, vi } from 'vitest'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import {
  createProcessSessionService,
  serveProcessSessions,
  type IProcessSessionServiceOptions
} from '../../src/process/plugin/serve.js'
import { createProcessResilience } from '../../src/process/resilience/index.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import type {
  IProcessServeChildIngress,
  IProcessServeListenerIngress,
  IProcessServeEndpointFactory
} from '../../src/process/plugin/types.js'
import type { IProcessSessionIdentity } from '../../src/process/resilience/types.js'
import type { IRemoteServeEndpoint } from '../../src/remote/types.js'
import { nativeBytePair, nativeEndpoint } from './fixtures/native-runtime.js'

/** Fixture composition uses only retained target/session ports, without deprecated facade types. */
type IServiceFixtureOptions = IProcessSessionServiceOptions &
  Readonly<{
    ingress: IProcessServeChildIngress | IProcessServeListenerIngress
    endpointFactory: IProcessServeEndpointFactory
  }>

describe('default process resilience wiring', () => {
  it('[A3/A5] serves child request, one-way and generator context and removes its parent-loss guard on explicit close', async () => {
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
    await host.use(target)
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
        host,
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
                capabilities: ['runtime-api@1']
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
        createProcessSessionService(options),
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
        capabilities: ['runtime-api@1']
      }),
      ipc: { connectionId: 'parent', sessionId: 'parent', log: () => undefined },
      report: (error) => reports.push(error)
    })
    const client = await nativeEndpoint(parentChannel, 'parent')
    /** This caller has no deferred provider installation before receiving replies. */
    ;(parentChannel as typeof parentChannel & { activateReceive?: () => void }).activateReceive?.()
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
      await client.endpoint.dispose()
      await parentChannel.close()
      await host.dispose()
    }
  })
  it.each(['shared', 'per-connection'] as const)(
    '[A1/A2/A3/K215] serves %s real authenticated Unix sessions with isolated quotas',
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
      await host.use(target)
      const contract = {
        schemaVersion: 1 as const,
        plugin: 'p',
        features: { f: { methods: { request: { mode: 'request' as const, idempotent: true } } } }
      }
      /** Real endpoint ownership is tracked separately from connection identities. */
      const clients: IRemoteServeEndpoint[] = []
      const channels: Awaited<ReturnType<typeof createProcessTransport>>[] = []
      const reports: unknown[] = []
      /** The per-connection factory owns one distinct target Host for each physical session. */
      const ownedTargets: PluginHost<Record<string, never>>[] = []
      const disposals: ReturnType<typeof vi.spyOn>[] = []
      let sequence = 0
      const serving = await (() => {
        /** The canonical session and target-selection owners retain the original default policy. */
        const options: IServiceFixtureOptions = {
          host,
          contract,
          instanceMode,
          createSessionHost: async () => {
            const owned = new PluginHost<Record<string, never>>({
              execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
            })
            await owned.use(target)
            ownedTargets.push(owned)
            disposals.push(vi.spyOn(owned, 'dispose'))
            return owned
          },
          report: (error) => reports.push(error),
          endpointFactory: (channel, _signal, session) =>
            nativeEndpoint(channel, 'server', session),
          ingress: {
            kind: 'listener',
            address,
            listen: listenProcessByteChannel,
            verify: (auth) =>
              auth === 'alice-secret' ? 'alice' : auth === 'bob-secret' ? 'bob' : '',
            offer: createNativeProcessOffer({
              peer: { id: 'server', runtime: 'node' },
              stream: true
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
          scheduler: systemScheduler,
          report: options.report
        })
        return serveProcessSessions(
          options.ingress,
          options.endpointFactory,
          createProcessSessionService(options),
          resilience,
          options.report,
          undefined,
          systemScheduler,
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
            offer: createNativeProcessOffer({ peer: { id, runtime: 'node' }, auth, stream: true }),
            ipc: { connectionId: id, sessionId: id, log: () => undefined },
            report: (error) => reports.push(error)
          })
          channels.push(channel)
          clients.push(await nativeEndpoint(channel, id))
        }
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
        /** K215: only actual concurrent core refusals close the offending physical connection. */
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
        await Promise.allSettled(clients.map((client) => client.endpoint.dispose()))
        await Promise.allSettled(channels.map((channel) => channel.close()))
        await serving.close()
        for (const disposal of disposals) expect(disposal).toHaveBeenCalledTimes(1)
        await host.dispose()
      }
    }
  )
})
