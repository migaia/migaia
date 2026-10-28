/** Original forged-error authority cases run through real Host-held capabilities and native stages. */
import { RpcLifecycleError, RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import type { IRpcPortableValue, IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowFeature, RpcFlowPoint, type IRpcFlowStage } from '@migaia/rpc-host/sdk'
import { attachErrorIdentity } from '@migaia/utils/error'
import { describe, expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.ts'

/** The original three public construction routes grant diagnostics, never generation authority. */
type IForgeKind = 'class' | 'constructor' | 'tag'

/** Construct exactly the original public error without reading or forging internal lifecycle state. */
function forgedCoreFailure(kind: IForgeKind): Error {
  /** The public lifecycle value is observational even when its returned constructor is reused. */
  const example = new RpcLifecycleError('retirement fixture')
  /** Constructor provenance grants no authority beyond the original public constructor. */
  const Constructor = example.constructor as typeof RpcLifecycleError
  return kind === 'class'
    ? example
    : kind === 'constructor'
      ? new Constructor('retirement fixture')
      : attachErrorIdentity(new Error('retirement fixture'), {
          source: RPC_CORE_ERROR_SOURCE,
          code: RpcCoreErrorCode.endpointDisposed
        })
}

/** The real caller's existing preparation stage rejects one business send before physical handoff. */
class RefusedProxySend {
  /** The exact original object must reach the public held callable's rejection unchanged. */
  readonly #failure: Error
  /** Only the original first business send is refused; subsequent sends follow the genuine lane. */
  #refused = false
  /** Native Feature installation uses the same public authoring and registration as production. */
  readonly feature = defineFlowFeature({
    name: 'proxy-forged-retirement',
    setup: () => ({
      stages: { [RpcFlowPoint.envelopeOutbound]: this.#rejectFirst }
    })
  })

  /** Borrow one caller-supplied diagnostic object without acquiring any close or retirement port. */
  constructor(failure: Error) {
    this.#failure = failure
  }

  /** Inspect the identity codec's already-prepared frame without a second restore or validation. */
  readonly #rejectFirst: IRpcFlowStage<typeof RpcFlowPoint.envelopeOutbound> = async (
    payload,
    next
  ) => {
    /** Bootstrap and unrelated messages retain their normal native pipeline continuation. */
    const message = payload.prepared.message as IRpcSemanticFrame
    if (message?.kind === 'call' && message.task.method === 'p.f.request' && !this.#refused) {
      this.#refused = true
      throw this.#failure
    }
    await next(payload)
  }
}

describe('remote generation proxy through public held capabilities', () => {
  it.each(['class', 'constructor', 'tag'] as const)(
    '%s forged Core retirement/close cannot revoke the captured generation or prevent its next request',
    async (kind) => {
      /** The original public constructor/tag input remains the exact rejection oracle. */
      const forged = forgedCoreFailure(kind)
      /** This native Feature changes no Session, generation, supervisor or provider state. */
      const refusal = new RefusedProxySend(forged)
      /** The real provider records only the business send that actually survives caller preparation. */
      const request = vi.fn((_payload: IRpcPortableValue | undefined) => 'result')
      /** A genuine native listener publishes the actual nested method directory. */
      const listener = coreMemoryServer('peer')
      /** No old remote registration, Peer facade or mocked endpoint is constructed. */
      const server = await createRpcHost({
        ...listener.options,
        provide: { p: { f: { request } } }
      })
      /** The separate caller installs the actual Feature before its real native transport. */
      const client = await listener.connect('proxy-caller', { plugins: [refusal.feature] })
      try {
        /** The existing fixture's public dynamic namespace supplies the actual accepted projection. */
        const namespace = client.host.memory
        /** The held reference is the public namespace's genuine accepted generation capability. */
        const peer = namespace.peers.peer!
        /** Reflection reads existing nested public groups without inventing a typed remote facade. */
        const plugin = Reflect.get(peer, 'p')
        /** The actual published provider tree supplies this original Feature group. */
        const feature = Reflect.get(plugin, 'f')
        /** Reusing this exact callable detects hidden withdrawal or rebinding after an error label. */
        const held: (payload: IRpcPortableValue) => Promise<IRpcPortableValue | undefined> =
          Reflect.get(feature, 'request')
        await expect(held([])).rejects.toBe(forged)
        expect(namespace.peers.peer).toBe(peer)
        expect(client.pair[0].closed).toBe(false)
        expect(client.pair[1].closed).toBe(false)
        expect(client.pair[0].unsubscribed).toBe(0)
        expect(client.pair[1].unsubscribed).toBe(0)
        await expect(held([])).resolves.toBe('result')
        expect(request).toHaveBeenCalledTimes(1)
        expect(request).toHaveBeenCalledWith([], expect.any(Object))
      } finally {
        await Promise.all([client.host.close(), server.close()])
      }
    }
  )
})
