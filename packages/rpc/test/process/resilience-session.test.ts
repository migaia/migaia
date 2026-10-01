import { PluginHost } from '@migaia/plugin-host'
import { createUnitBudget } from '@migaia/supervision'
import type { IProcessHandle, IProcessSpec } from '@migaia/supervision/process'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { serveProcessSessions } from '../../src/process/plugin/serve.js'
import { createProcessResilience } from '../../src/process/resilience/index.js'
import type {
  IProcessServeChildIngress,
  IProcessServeListenerIngress
} from '../../src/process/plugin/types.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import { createProcessPlugin } from '../../src/process/plugin/client.js'
import { createProcessSessionManager } from '../../src/process/resilience/session.js'
import type { IProcessMessageChannel } from '../../src/process/types.js'
import { REMOTE_FIXTURE_CONTRACT, remoteHarness } from '../remote/fixture.js'

describe('process resilience session ownership', () => {
  it('[A3] drains a real PluginHost unUse before disposing the process endpoint', async () => {
    const fixture = remoteHarness()
    const scheduler = fixture.binding.scheduler
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** The real Host hook must observe the pending request before release disposes it. */
    let settleRequest!: (value: string) => void
    const pending = new Promise<string>((resolve) => {
      settleRequest = resolve
    })
    const send = fixture.served.endpoint.send
    fixture.served.endpoint.send = ((peer, method, params, options) =>
      method === 'p.f.request' ? pending : send(peer, method, params, options)) as typeof send
    const order: string[] = []
    fixture.served.endpoint.announceClose = vi.fn(async () => {
      order.push('close-frame')
    })
    fixture.served.endpoint.dispose = vi.fn(async () => {
      order.push('dispose')
    })
    /** This unit exits only when the Host releases its installed Plugin. */
    let exit!: (value: { code: number | null; signal: string | null }) => void
    const handle: IProcessHandle = {
      identity: { fingerprint: 'drain-child' },
      exited: new Promise((resolve) => {
        exit = resolve
      }),
      terminate: () => exit({ code: 0, signal: null })
    }
    const spec: IProcessSpec = {
      command: 'fixture',
      args: [],
      env: { inherit: [], set: {} },
      stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
    }
    const raw: IProcessMessageChannel = {
      kind: 'message',
      send: () => undefined,
      onMessage: () => () => undefined,
      onClose: () => () => undefined,
      close: () => undefined
    }
    const definition = createProcessPlugin({
      name: 'p',
      contract: REMOTE_FIXTURE_CONTRACT,
      registrationOwner: { name: 'p', host },
      host: {
        disable: (name, options) => host.plugin.disable(name, options),
        enable: (name) => host.plugin.enable(name)
      },
      endpointFactory: async () => fixture.served,
      report: () => undefined,
      deployment: {
        kind: 'spawn',
        channelKind: 'message',
        supervision: {
          id: 'drain-child',
          spec,
          launcher: {
            capabilities: { termination: 'enforced', 'fault-isolation': 'enforced' },
            launch: async () => handle
          },
          budget: createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
          scheduler,
          health: { check: async () => undefined },
          report: () => undefined
        },
        rawChannel: async () => raw,
        establish: async () => ({
          ...fixture.channel,
          agreement: { ...fixture.channel.agreement, capabilities: ['close@1', 'stream@1'] }
        })
      }
    })
    try {
      const [installed] = await host.use(definition)
      const feature = installed.getFeature('f') as { request(params: unknown[]): Promise<unknown> }
      const request = feature.request(['pending'])
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
      const removing = host.unUse('p', { policy: 'suspend' })
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
      expect(fixture.served.endpoint.announceClose).toHaveBeenCalledTimes(1)
      expect(order).toEqual(['close-frame'])
      settleRequest('done')
      await expect(request).resolves.toBe('done')
      await removing
      expect(order).toEqual(['close-frame', 'dispose'])
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      await host.dispose()
    }
  })

  it('[A1] keeps one deduplication store and scope per verified principal across connections', () => {
    const manager = createProcessSessionManager({
      scheduler: createManualScheduler(),
      report: () => undefined
    })
    const first = manager.sessionOptions({
      connectionId: 'one',
      sessionId: 's1',
      principalId: 'alice'
    })
    const later = manager.sessionOptions({
      connectionId: 'two',
      sessionId: 's2',
      principalId: 'alice'
    })
    const other = manager.sessionOptions({
      connectionId: 'three',
      sessionId: 's3',
      principalId: 'bob'
    })
    expect(first.idempotency.store).toBe(later.idempotency.store)
    expect(first.idempotency.store).toBe(other.idempotency.store)
    expect(first.idempotency.scope?.({ token: 'secret', senderId: 'sender-1' })).toBe(
      later.idempotency.scope?.({ token: 'other-secret', senderId: 'sender-2' })
    )
    expect(first.idempotency.scope?.({ token: 'secret', senderId: 'sender-1' })).not.toBe(
      other.idempotency.scope?.({ token: 'secret', senderId: 'sender-1' })
    )
    expect(first.idempotency.scope?.({ token: 'secret', senderId: 'sender-1' })).not.toContain(
      'secret'
    )
    expect(first.limits).toEqual({ maxGlobal: 32, maxPerPeer: 32 })
  })

  it('[A1] admits at most the configured physical connections and returns a lease once', () => {
    const manager = createProcessSessionManager({
      scheduler: createManualScheduler(),
      report: () => undefined,
      maxConnections: 1
    })
    const lease = manager.claimConnection()
    expect(() => manager.claimConnection()).toThrowError(
      expect.objectContaining({ code: 'PROCESS_CONNECTION_LIMIT' })
    )
    lease.release()
    lease.release()
    const replacement = manager.claimConnection()
    replacement.release()
    manager.close()
    expect(() => manager.claimConnection()).toThrowError(
      expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })
    )
  })

  it('[A2] validates numeric quotas and report offsets before any connection is opened', () => {
    expect(() =>
      createProcessSessionManager({
        scheduler: createManualScheduler(),
        report: () => undefined,
        maxConnections: 0
      })
    ).toThrowError(expect.objectContaining({ code: 'PROCESS_RESILIENCE_INVALID_OPTION' }))
    expect(() =>
      createProcessSessionManager({
        scheduler: createManualScheduler(),
        report: () => undefined,
        reportAtMs: [0, 1, 1]
      })
    ).toThrowError(expect.objectContaining({ code: 'PROCESS_RESILIENCE_INVALID_OPTION' }))
  })
})

describe('unpublished process service rollback', () => {
  it.each(['child', 'listener'] as const)(
    '[A3/A5] closes a returned %s service when recovery rejects before publication',
    async (kind) => {
      /** The neutral endpoint recorder isolates the service-to-session ownership transfer. */
      const fixture = remoteHarness()
      const scheduler = fixture.channel.scheduler
      const resilience = createProcessResilience({ scheduler, report: () => undefined })
      /** Recovery fails only after the service callback has returned its owned endpoint. */
      const primary = new Error('recovery fixture failed')
      const cleanup = new Error('service fixture cleanup failed')
      const ready = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(primary)
      const add = vi.fn(() => () => undefined)
      const fallback = {
        version: 0,
        ready,
        add,
        close: async () => undefined,
        inspect: () => ({ recoverable: true, fused: false })
      }
      const reports: unknown[] = []
      const dispose = vi.spyOn(fixture.served.endpoint, 'dispose')
      const serviceClose = vi.fn(async () => {
        await fixture.served.endpoint.dispose()
        throw cleanup
      })
      const channelClose = vi.spyOn(fixture.channel, 'close')
      /** Neither native health nor physical transport interpretation is the subject of this oracle. */
      const channel = {
        ...fixture.channel,
        agreement: { ...fixture.channel.agreement, capabilities: [] },
        transport: { ...fixture.channel.transport, subscribe: () => () => undefined }
      }
      const raw: IProcessMessageChannel = {
        kind: 'message',
        send: () => undefined,
        onMessage: () => () => undefined,
        onClose: () => () => undefined,
        close: () => undefined
      }
      let accept: Parameters<IProcessServeListenerIngress['listen']>[0]['onConnection'] | undefined
      const ingress: IProcessServeChildIngress | IProcessServeListenerIngress =
        kind === 'child'
          ? {
              kind,
              channelKind: 'message',
              openRaw: async () => raw,
              establish: async () => channel,
              parentLoss: { exit: () => undefined, graceMs: 1 }
            }
          : {
              kind,
              address: 'rollback-fixture',
              verify: () => 'principal',
              scheduler,
              offer: createNativeProcessOffer({ peer: { id: 'fixture', runtime: 'node' } }),
              createConnectionContext: () => ({
                peerId: 'peer',
                ipc: { connectionId: 'rollback', sessionId: 'rollback', log: () => undefined }
              }),
              listen: async (options) => {
                accept = options.onConnection
                return { address: options.address, close: async () => undefined }
              }
            }
      const starting = serveProcessSessions(
        ingress,
        async () => fixture.served,
        async () => ({ close: serviceClose }),
        resilience,
        (error) => reports.push(error),
        fallback
      )
      try {
        if (kind === 'child') await expect(starting).rejects.toBe(primary)
        else {
          const serving = await starting
          await accept!({
            accept: async () => ({ channel, principalId: 'principal' }),
            close: async () => undefined
          } as unknown as Parameters<NonNullable<typeof accept>>[0])
          expect(reports).toContain(primary)
          await serving.close()
        }
        expect(serviceClose).toHaveBeenCalledTimes(1)
        expect(dispose).toHaveBeenCalledTimes(1)
        expect(channelClose).toHaveBeenCalledTimes(1)
        expect(add).not.toHaveBeenCalled()
        expect(reports).toContain(cleanup)
      } finally {
        await resilience.close()
      }
    }
  )
})
