/** Original connection policy and handshake rollback assertions use canonical public owners. */
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
import { createRpcHost } from '@migaia/rpc-host'
import {
  createRpcByteCarrier,
  createRpcMessageCarrier,
  defineFlowPlugin,
  defineTransportPlugin,
  type IRpcFlowInstallation
} from '@migaia/rpc-host/sdk'
import { retry } from '@migaia/rpc-host/features/retry'
import { linkPolicy } from '@migaia/rpc-host/plugins/link-policy'
import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
import type { IRpcEnvelope } from '@migaia/rpc-contract/protocol'
import { coreMemoryServer } from './core-fixture.js'
import { SilentManagedMessageIO } from './managed-memory-fixture.js'

/** The original silent byte source has no native subscription work to release. */
function releaseSilentSource(): void {}

/** Record only actual provider admission through its genuine fixed flow hook. */
function receivedCallHooks(received: IRpcEnvelope[]): IRpcFlowInstallation {
  return {
    hooks: {
      dispatch: {
        inbound(context, next) {
          received.push(context.envelope)
          return next()
        }
      }
    }
  }
}

/** The existing SDK installation starts exactly one real Session and awaits only its actual ready. */
function silentCarrierTransport(carrier: IRpcCarrier, peerId?: string) {
  return defineTransportPlugin({
    name: 'silent',
    namespace: 'memory',
    handshakeTimeoutMs: 50,
    async open(context) {
      /** Source identity remains optional native data; no response or accepted view is fabricated. */
      const handle = context.attach(
        carrier,
        peerId === undefined ? undefined : { expectedPeerId: peerId }
      )
      await handle.ready
      /** Native context resources already own the attached handle and original carrier close. */
      return { dispose: releaseSilentSource }
    }
  })
}

/** Failure diagnostics capture native objects on the one run without replacing the rejected value. */
function observeConnectionFailure(error: unknown): never {
  console.info('C6-CONNECT-OPTIONS-FAILURE', error)
  throw error
}

// RPC-TEST-FD465BC50212-C001: BC3 maps old deployment/managed placement to complete feature scopes.
it.each(['deployment', 'managed'] as const)(
  'retains the key factory through its canonical feature installation (%s)',
  async (configuration) => {
    /** Preserve both original key strings and exactly one key allocation for the actual call. */
    const keyFactory = vi.fn(() => `retained-key-${configuration}`)
    /** The actual provider proves that policy forwarding never duplicates business execution. */
    const business = vi.fn((value: unknown) => value)
    /** This is the complete canonical origin strategy, not a retryPort compatibility object. */
    const strategy = retry({ keyFactory })
    /** Original configuration slots are deleted; both supported new installation scopes are real. */
    const server = coreMemoryServer(
      'local',
      `call-policy-${configuration}`,
      'memory',
      configuration === 'deployment' ? [strategy] : []
    )
    /** The chain policy precedes native startup and leaves the original feature instance intact. */
    const host = await createRpcHost({
      ...server.options,
      plugins:
        configuration === 'managed'
          ? [linkPolicy({ features: [strategy] }), server.transport]
          : [server.transport]
    })
    /** Actual provider dispatch observes the received method and unchanged originating key. */
    const received: IRpcEnvelope[] = []
    /** Only the real fixed dispatch hook records actual business admission. */
    const observer = defineFlowPlugin({
      name: 'received-call-policy',
      setup: () => receivedCallHooks(received)
    })
    /** A real accepted declaration is the only authority for retry idempotency. */
    const client = await server.connect('remote', {
      plugins: [observer],
      provide: { api: { value: business } },
      contract: {
        schemaVersion: 1,
        plugin: 'api',
        features: { shape: { methods: { value: { mode: 'request', idempotent: true } } } }
      }
    })
    try {
      expect(await host.memory.request('api.value', 42)).toBe(42)
      expect(keyFactory).toHaveBeenCalledTimes(1)
      // A003's deleted retryPort.dispatch interface is BC3; retain its one-admission business effect.
      expect(received).toHaveLength(1)
      /** Project actual admitted semantic metadata and the real accepted declaration only. */
      const envelope = received[0]!
      expect({
        method: envelope.task.method,
        idempotent: server.lookup('remote')!.view.methods.get('api.value')!.idempotent,
        key: envelope.kind === 'call' ? envelope.options.idempotencyKey : undefined
      }).toMatchObject({
        method: 'api.value',
        idempotent: true,
        key: `retained-key-${configuration}`
      })
      expect(business).toHaveBeenCalledTimes(1)
    } finally {
      await client.host.close()
      await host.close()
    }
  }
)

// RPC-TEST-FD465BC50212-C002: preserve original deadline/code/remover business for both native facts.
it.each([undefined, 'silent-peer'])(
  'applies the SDK budget to a real message source with peerId %s',
  async (peerId) => {
    /** The original manual scheduler advances only real Session timer registration and cancellation. */
    const scheduler = createManualScheduler()
    /** Public utils deliberately permits scheduler spies; Session remains the sole timer owner. */
    const clock = vi
      .spyOn(systemScheduler, 'schedule')
      .mockImplementation((callback, delay) => scheduler.schedule(callback, delay))
    /** This genuine raw emitter stays silent instead of inventing accepted handshake data. */
    const events = new EventEmitter()
    /** Only the actual native send resolves the first control write observation. */
    const written = deferred<void>()
    /** The original listener/remover owner is acquired by the same SDK used for real messages. */
    const carrier = createRpcMessageCarrier({
      id: 'silent-message',
      io: new SilentManagedMessageIO(events, written.resolve),
      nativeBinary: true,
      report: () => undefined
    })
    try {
      /** No root or SDK compatibility adapter contributes another timeout or handshake. */
      const opening = createRpcHost({
        self: { name: 'local', instanceId: 'local' },
        plugins: [silentCarrierTransport(carrier, peerId)],
        report: () => undefined
      }).catch(observeConnectionFailure)
      /** Preserve the original public message-source error code even when implementation is RED. */
      const failed = expect(opening).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
      await written.promise
      await Promise.resolve()
      expect(scheduler.pendingCount).toBe(1)
      scheduler.advance(49)
      expect(events.listenerCount('message')).toBe(1)
      scheduler.advance(1)
      await failed
      expect(events.listenerCount('message')).toBe(0)
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      clock.mockRestore()
      await carrier.close()
    }
  }
)

// RPC-TEST-FD465BC50212-C003: genuine byte write/framing and physical rollback keep the old code.
it('maps the same SDK budget to the existing byte handshake timeout and physical rollback', async () => {
  /** The real canonical timer uses the original manual progression and receives no fake ready. */
  const scheduler = createManualScheduler()
  /** Only the existing scheduler backend is replaced; Session still installs and clears its timer. */
  const clock = vi
    .spyOn(systemScheduler, 'schedule')
    .mockImplementation((callback, delay) => scheduler.schedule(callback, delay))
  /** The actual physical byte write proves first control handoff. */
  const written = deferred<void>()
  /** Native physical cleanup retains the original once-only assertion. */
  const close = vi.fn(async () => undefined)
  /** Real SDK framing/UTF-8/JSON encode writes to the original silent native byte operations. */
  const carrier = createRpcByteCarrier({
    id: 'silent-byte',
    report: () => undefined,
    io: {
      kind: 'byte',
      write: async (_chunk, options) => {
        options?.onWriteStart?.()
        written.resolve()
      },
      onData: () => releaseSilentSource,
      onClose: () => releaseSilentSource,
      close
    }
  })
  try {
    /** Observe construction rejection before advancing the actual Session's single 50 ms timer. */
    const opening = createRpcHost({
      self: { name: 'local', instanceId: 'local-byte' },
      plugins: [silentCarrierTransport(carrier, 'remote')],
      report: () => undefined
    }).catch(observeConnectionFailure)
    const failed = expect(opening).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    await written.promise
    await Promise.resolve()
    expect(scheduler.pendingCount).toBe(1)
    scheduler.advance(50)
    await failed
    expect(close).toHaveBeenCalledTimes(1)
    expect(scheduler.pendingCount).toBe(0)
  } finally {
    clock.mockRestore()
    await carrier.close()
  }
})
