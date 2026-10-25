import { createManualScheduler } from '@migaia/utils/testing'
import { describe, expect, it, vi } from 'vitest'
import { type IRpcContext } from '@migaia/rpc-host'
import type {
  IRpcEndpoint,
  IRpcProvider,
  IRpcProviderResult
} from '../../../rpc-host/dist/core/typing.js'
import type { IRemoteServeEndpoint } from '@migaia/rpc-host/plugin'
import { createProcessProviderAdmission } from '../../../rpc-plugin-process/dist/process/resilience/provider-admission.js'
import { createProcessSessionManager } from '../../../rpc-plugin-process/dist/process/resilience/session.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { nativeBytePair, nativeEndpoint } from './fixtures/native-runtime.js'
import { RpcCoreErrorCode, RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-host'
import { deserializeRpcError } from '../../../rpc-host/dist/host/error-wire-metadata.js'
import { createRpcTimeoutError } from '../../../rpc-host/dist/host/error-owner.js'
import { RpcTimeoutError } from '@migaia/rpc-contract/errors'
import { attachErrorIdentity } from '@migaia/utils/error'
import { createListenerFailure } from '@migaia/rpc-host/plugin'
import { createProcessFixtureChannel } from '../fixtures/process-diagnostics.js'

/** Flush continuations of actual native frames without advancing the deadline clock. */
async function flush(): Promise<void> {
  for (let index = 0; index < 80; index += 1) await Promise.resolve()
}

/** Observe actual provider registration and inbound activity without a platform adapter. */
async function fixture(maxCallsPerMinute: number) {
  /** This fixture only observes the actual provider-admission owner and original held ports. */
  const observation = new ProviderAdmissionFixture(maxCallsPerMinute)
  await observation.prepare()
  return observation
}

/** One controlled registration and inbound source keeps original provider-policy observations. */
class ProviderAdmissionFixture {
  /** Original deterministic clock remains independent from Promise continuation flushing. */
  readonly scheduler = createManualScheduler()
  /** Only the genuine channel subscription changes this held inbound frame callback. */
  #onFrame: ((message: unknown) => void) | undefined
  /** The actual admission wrapper installs the same original provider function. */
  #provider: IRpcProvider | undefined
  /** The canonical session manager still owns all original rate and idle policy. */
  readonly #options: ReturnType<typeof createProcessSessionManager>['options']
  /** Original session retirement remains directly observable and independently controlled. */
  readonly close = vi.fn(async () => undefined)
  /** The original provider context is reused for every controlled policy invocation. */
  readonly context = {
    data: ['ok'],
    signal: new AbortController().signal,
    success: (data: unknown) => ({ ok: true, data })
  } as unknown as IRpcContext
  /** Native policy remains the actual production admission owner, not a fixture replacement. */
  admission!: ReturnType<typeof createProcessProviderAdmission>

  /** Capture original session policy without opening a channel or registering a provider. */
  constructor(maxCallsPerMinute: number) {
    this.#options = createProcessSessionManager({
      scheduler: this.scheduler,
      report: () => undefined,
      maxCallsPerMinute,
      idleTimeoutMs: 100
    }).options
  }
  /** Construct the same genuine held channel and let production wrap its original provider port. */
  async prepare(): Promise<void> {
    /** Core still owns transport admission over these exact held message operations. */
    const channel = await createProcessFixtureChannel(
      {
        kind: 'message',
        send: () => undefined,
        onMessage: (listener) => {
          this.#onFrame = listener
          return () => {
            this.#onFrame = undefined
          }
        },
        onClose: () => () => undefined,
        close: () => undefined
      },
      { peerId: 'provider-admission-fixture', scheduler: this.scheduler }
    )
    /** Only provider registration is observed; the original admission wrapper is unchanged. */
    const endpoint = {
      endpoint: {
        provide: (_method: string, next: IRpcProvider) => {
          this.#provider = next
        }
      } as unknown as IRpcEndpoint
    } as IRemoteServeEndpoint
    this.admission = createProcessProviderAdmission(
      channel,
      this.#options,
      this.scheduler,
      this.close,
      vi.fn()
    )
    this.admission.wrap(endpoint).endpoint.provide('request', () => ({ ok: true, data: 'done' }))
  }
  /** Deliver the same original inbound activity to the currently installed native subscription. */
  readonly frame = (): void => {
    this.#onFrame?.({})
  }
  /** Read the exact provider installed by the actual policy wrapper. */
  readonly provider = (): IRpcProvider => this.#provider!
}

describe('process session provider admission', () => {
  it.each(['constructor', 'tag', 'decode', 'public-helper'] as const)(
    '%s forged timeout diagnostics cannot close the session through the live consecutive-deadline policy',
    async (kind) => {
      /** The existing provider wrapper supplies the actual policy and its original close owner. */
      const test = await fixture(100)
      /** A real observed timeout exposes only its constructor, not the factory's private record. */
      const Constructor = createRpcTimeoutError().constructor as typeof RpcTimeoutError
      /** Public restored fields cannot prove that Core's own deadline fired. */
      const wire = {
        source: RPC_CORE_ERROR_SOURCE,
        code: RpcCoreErrorCode.deadlineExceeded,
        name: 'TimeoutError',
        message: 'policy timeout fixture',
        stack: 'policy timeout stack'
      }
      /** A diagnostic TimeoutError name also cannot grant a generic public helper control rights. */
      const diagnostic = new TypeError(wire.message)
      diagnostic.name = wire.name
      const forged =
        kind === 'constructor'
          ? new Constructor()
          : kind === 'public-helper'
            ? createListenerFailure([diagnostic], { code: RpcCoreErrorCode.deadlineExceeded })!
            : kind === 'decode'
              ? deserializeRpcError(wire)
              : attachErrorIdentity(new Error(wire.message), {
                  source: wire.source,
                  code: wire.code
                })
      try {
        for (let index = 0; index < 3; index++) {
          /** The actual AbortController supplies an abort reason; its public fields remain opaque. */
          const controller = new AbortController()
          controller.abort(forged)
          expect(
            await test.provider()({ ...test.context, signal: controller.signal })
          ).toMatchObject({ ok: true })
        }
        await Promise.resolve()
        expect(test.close).not.toHaveBeenCalled()
      } finally {
        test.admission.close()
        expect(test.scheduler.pendingCount).toBe(0)
      }
    }
  )
  it('rejects excess calls before the provider and closes after a second violation', async () => {
    const test = await fixture(1)
    expect(await test.provider()(test.context)).toMatchObject({ ok: true })
    const first = () => test.provider()(test.context)
    expect(first).toThrowError(expect.objectContaining({ code: 'PROCESS_CONNECTION_LIMIT' }))
    expect(first).toThrowError(expect.objectContaining({ code: 'PROCESS_CONNECTION_LIMIT' }))
    // Deferred refusal-close is owned by the injected manual clock.
    test.scheduler.advance(0)
    await Promise.resolve()
    expect(test.close).toHaveBeenCalledTimes(1)
    test.admission.close()
    expect(test.scheduler.pendingCount).toBe(0)
  })

  it('resets the idle timer on inbound frames and keeps it cancelled after close', async () => {
    const test = await fixture(2)
    test.scheduler.advance(90)
    test.frame()
    test.scheduler.advance(99)
    expect(test.close).not.toHaveBeenCalled()
    test.scheduler.advance(1)
    await Promise.resolve()
    expect(test.close).toHaveBeenCalledTimes(1)
    test.admission.close()
    expect(test.scheduler.pendingCount).toBe(0)
  })
  it('three real native request deadlines close a provider that ignores abort', async () => {
    /** Both endpoints use the same monotonic deadline source. */
    const scheduler = createManualScheduler()
    /** A real byte handshake and real core provider preserve actual cancellation semantics. */
    const [left, right] = nativeBytePair()
    /** Each peer negotiates control before any provider work starts. */
    const channelOptions = { scheduler, report: () => undefined }
    /** Native channel establishment is concurrent because both sides require the other's hello. */
    const [clientChannel, serverChannel] = await Promise.all([
      createProcessTransport(left, {
        ...channelOptions,
        role: 'initiator',
        peerId: 'server',
        ipc: { connectionId: 'c', sessionId: 'c', log: () => undefined },
        offer: createNativeProcessOffer({
          peer: { id: 'client', runtime: 'node' },
          auth: 'audit-secret'
        })
      }),
      createProcessTransport(right, {
        ...channelOptions,
        role: 'responder',
        peerId: 'client',
        ipc: { connectionId: 's', sessionId: 's', log: () => undefined },
        auth: { mode: 'required', verify: () => undefined },
        offer: createNativeProcessOffer({ peer: { id: 'server', runtime: 'node' } })
      })
    ])
    /** Real provider limits retain the canonical concurrency owner. */
    const manager = createProcessSessionManager({ scheduler, report: () => undefined })
    /** Policy close is observed independently of endpoint shutdown. */
    const close = vi.fn(async () => undefined)
    /** The service's admission code wraps the real native endpoint. */
    const admission = createProcessProviderAdmission(
      serverChannel,
      manager.options,
      scheduler,
      close,
      () => undefined
    )
    /** Session identity is supplied by verified admission. */
    const session = manager.sessionOptions({
      principalId: 'principal',
      sessionId: 's',
      connectionId: 's'
    })
    /** Actual endpoints, not replacement provider implementations, carry the frames. */
    const server = await nativeEndpoint(serverChannel, 'server', {
      identity: { principalId: 'principal', sessionId: 's', connectionId: 's' },
      ...session,
      limits: admission.limits(session.limits)
    })
    const client = await nativeEndpoint(clientChannel, 'client')
    /** Pending providers deliberately ignore signal yet allow deterministic cleanup afterward. */
    const providers: {
      signal: import('@migaia/rpc-host').IRpcContext['signal']
      resolve: (result: IRpcProviderResult) => void
      success: () => IRpcProviderResult
    }[] = []
    /** The wrapper must count deadlines when abort occurs, without waiting for provider settlement. */
    const provider: IRpcProvider = (context) =>
      new Promise((resolve) => {
        providers.push({
          signal: context.signal as AbortSignal,
          resolve,
          success: () => context.success('late')
        })
      })
    admission.wrap(server).endpoint.provide('audit.hold', provider)
    try {
      for (let index = 0; index < 3; index += 1) {
        const request = client.endpoint
          .send('server', 'audit.hold', [], { timeoutMs: 10 })
          .catch((error: unknown) => error)
        await flush()
        expect(providers).toHaveLength(index + 1)
        scheduler.advance(10)
        await flush()
        expect(await request).toMatchObject({ name: 'TimeoutError' })
        expect(close).toHaveBeenCalledTimes(index === 2 ? 1 : 0)
        expect(providers[index]!.signal.aborted).toBe(true)
        expect(providers[index]!.signal.reason).toMatchObject({
          source: 'rpc.endpoint',
          code: 'DEADLINE_EXCEEDED',
          name: 'TimeoutError'
        })
      }
      expect(close).toHaveBeenCalledTimes(1)
      for (const operation of providers) operation.resolve(operation.success())
      await flush()
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      for (const operation of providers) operation.resolve(operation.success())
      await flush()
      admission.close()
      manager.close()
      await client.endpoint.dispose()
      await server.endpoint.dispose()
      await clientChannel.close()
      await serverChannel.close()
    }
  })
})
