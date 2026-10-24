import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { serveProcessSessions } from '../../../rpc-plugin-process/dist/process/plugin/serve.js'
import { createProcessResilience } from '../../../rpc-plugin-process/dist/process/resilience/index.js'
import type {
  IProcessServeChildIngress,
  IProcessServeListenerIngress
} from '../../../rpc-plugin-process/dist/process/plugin/types.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { runtimeHostFixture } from './fixtures/host-control.js'
import { nativeEndpoint } from './fixtures/native-runtime.js'
import { createProcessSessionManager } from '../../../rpc-plugin-process/dist/process/resilience/session.js'
import type { IProcessMessageChannel } from '../../../rpc-plugin-process/dist/process/types.js'
import { createProcessFixtureChannel } from '../fixtures/process-diagnostics.js'
import { readEndpointOwner } from '../../../rpc-host/dist/core/internal/endpoint-projection.js'
import { EndpointOwnerKey } from '../../../rpc-host/dist/core/endpoint-kernel.js'
import type { ResourceScope } from '../../../rpc-host/dist/core/internal/resource-scope.js'

describe('process resilience session ownership', () => {
  it('drains a real native PluginHost unUse before disposing the process endpoint', async () => {
    /** The actual native Host and binding retain their original deterministic supervisor clock. */
    const fixture = runtimeHostFixture()
    /** Business is deliberately held before physical send, under the actual native drain wrapper. */
    let settleRequest!: (value: string) => void
    /** Preserve the caller's original pending request and exact successful result. */
    const pending = new Promise<string>((resolve) => {
      settleRequest = resolve
    })
    /** Native announce-close must precede endpoint retirement after the pending operation drains. */
    const order: string[] = []
    /** This observer retains the actual kernel/projection ancestry and original cleanup operation. */
    const announceClose = vi.fn(async () => {
      order.push('close-frame')
    })
    fixture.observeEndpoint((served) => {
      /** The shared canonical kernel owns disposal; the borrowed session view cannot replace it. */
      readEndpointOwner<ResourceScope>(served.endpoint, EndpointOwnerKey.resourceScope)!.addSync(
        'fixture endpoint disposal',
        () => order.push('dispose')
      )
      return {
        ...served,
        endpoint: Object.create(
          served.endpoint,
          Object.getOwnPropertyDescriptors({
            send: <T>(...args: Parameters<typeof served.endpoint.send>) =>
              args[1] === 'p.f.m' ? (pending as Promise<T>) : served.endpoint.send<T>(...args),
            announceClose
          })
        )
      }
    })
    try {
      await fixture.host.use(processPlugin({ ...fixture.options, name: 'p' }))
      /**
       * Native outlet calls retain the current managed Peer and the actual binding's request
       * tracking.
       */
      const request = fixture.host.process!.request('p', 'p.f.m', ['pending'])
      for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
      /** Host.unUse owns the actual native release rather than the retired Plugin proxy facade. */
      const removing = fixture.host.unUse('p', { policy: 'suspend' })
      /** Observe the actual asynchronous native close receipt before asserting drain order. */
      await vi.waitFor(() => expect(announceClose).toHaveBeenCalledTimes(1))
      expect(order).toEqual(['close-frame'])
      settleRequest('done')
      await expect(request).resolves.toBe('done')
      await removing
      expect(order).toEqual(['close-frame', 'dispose'])
      /** The fixture also owns its independently created child Peer on the same manual clock. */
      await fixture.close()
      expect(fixture.scheduler.pendingCount).toBe(0)
    } finally {
      settleRequest('done')
      await fixture.close()
    }
  })

  it('keeps one deduplication store and scope per verified principal across connections', () => {
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

  it('admits at most the configured physical connections and returns a lease once', () => {
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
    expect(() => manager.claimConnection()).toThrowError(
      expect.objectContaining({ code: 'PROCESS_CONNECTION_LIMIT' })
    )
    replacement.release()
    manager.close()
    expect(() => manager.claimConnection()).toThrowError(
      expect.objectContaining({ code: 'PROCESS_CHANNEL_CLOSED' })
    )
  })

  it('validates numeric quotas and report offsets before any connection is opened', () => {
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
    'closes a returned %s service when recovery rejects before publication',
    async (kind) => {
      /** The actual canonical endpoint isolates the same service-to-session transfer boundary. */
      const scheduler = createManualScheduler()
      /** Real native connection close is observed at its held physical I/O resource. */
      const channelClose = vi.fn(async () => undefined)
      /** Core constructs this exact fixed-profile channel from actual held message operations. */
      const channel = await createProcessFixtureChannel(
        {
          kind: 'message',
          send: () => undefined,
          onMessage: () => () => undefined,
          onClose: () => () => undefined,
          close: channelClose
        },
        { peerId: 'peer', scheduler }
      )
      /** The production feature roots build the original endpoint and resource scope. */
      const original = await nativeEndpoint(channel, 'rollback-fixture')
      /**
       * Rollback invokes the actual original endpoint disposal while retaining its projection
       * ancestry.
       */
      const dispose = vi.fn(() => original.endpoint.dispose())
      /** The same actual composed endpoint is borrowed by the service callback and native session. */
      const endpoint = {
        ...original,
        endpoint: Object.create(original.endpoint, Object.getOwnPropertyDescriptors({ dispose }))
      }
      /** Existing native governor controls admission and original physical lease release. */
      const resilience = createProcessResilience({ scheduler, report: () => undefined })
      /** Recovery fails only after the service callback has returned its owned endpoint. */
      const primary = new Error('recovery fixture failed')
      /** Cleanup failure remains an independent reported leaf and cannot replace primary. */
      const cleanup = new Error('service fixture cleanup failed')
      /** The second original fallback readiness call rejects after service construction. */
      const ready = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(primary)
      /** No unpublished session may install a fallback membership. */
      const add = vi.fn(() => () => undefined)
      /** Existing fallback interface retains the exact original recovery interleaving. */
      const fallback = {
        version: 0,
        ready,
        add,
        close: async () => undefined,
        inspect: () => ({ recoverable: true, fused: false })
      }
      /** Every secondary cleanup failure remains visible through the existing reporter. */
      const reports: unknown[] = []
      /** The callback owns its actual endpoint before the native session can publish it. */
      const serviceClose = vi.fn(async () => {
        await endpoint.endpoint.dispose()
        throw cleanup
      })
      /**
       * Raw child source is unused after its existing establish callback returns the genuine
       * channel.
       */
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
        async () => endpoint,
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
