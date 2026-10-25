/** Public request settlement retains native idle write order and recovery after physical failure. */
import assert from 'node:assert/strict'
import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import {
  defineFlowFeature,
  RpcFlowLayer,
  RpcFlowPoint,
  type IRpcCarrierFrame,
  type IRpcFlowStage
} from '@migaia/rpc-host/sdk'
import { RpcWireKind, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { RpcTransportError } from '@migaia/rpc-contract/errors'
import { coreMemoryServer } from '../../host/core-fixture.js'
import { MemoryCarrier } from '../../fixtures/core-carrier.js'

/** Observe original physical handoff through a genuine native Feature, never an old sender facade. */
class IdleWriteWitness {
  /** Original semantic labels remain visible even though current call IDs belong to CallTable. */
  readonly written: string[] = []
  /** Every public request still owns its independently allocated actual native correlation ID. */
  readonly callIds: string[] = []
  /** Exactly the next physical business write consumes this original native failure. */
  #failure: Error | undefined
  /** Native registration remains the original opaque Feature in its one declared namespace. */
  readonly feature = defineFlowFeature({
    name: 'idle-physical-write-witness',
    setup: () => ({
      stages: {
        [RpcFlowPoint.frameOutbound]: { layer: RpcFlowLayer.wire, stage: this.#outbound }
      }
    })
  })

  /** Native next starts an idle physical write synchronously at the current media boundary. */
  readonly #outbound: IRpcFlowStage<'frameOutbound'> = (payload, next) => {
    const pending = next(payload)
    /** This medium's original identity codec supplies its already-prepared semantic frame. */
    const message = payload.frame.data as IRpcSemanticFrame
    if (payload.frame.kind === 'message' && message.kind === RpcWireKind.call)
      assert.equal(this.written.at(-1), message.payload, 'idle physical send remains synchronous')
    return pending
  }

  /** Fail one actual write without closing the real carrier or inventing a caller settlement. */
  failNext(reason: Error): void {
    this.#failure = reason
  }

  /** Delegate every physical IO except the single original failure injected at this boundary. */
  observe(carrier: MemoryCarrier) {
    /** One explicit observation context keeps the stable native arrow and this witness together. */
    const operation = { owner: this, write: carrier.write }
    return vi.spyOn(carrier, 'write').mockImplementation((frame, options) => {
      const failure = operation.owner.#record(frame)
      return failure ? Promise.reject(failure) : operation.write(frame, options)
    })
  }

  /** Record only actual public call frames; handshake, replies and close controls stay unchanged. */
  #record(frame: IRpcCarrierFrame): Error | undefined {
    /** Codec admission already supplied this exact current semantic call to the physical medium. */
    const message = frame.data as IRpcSemanticFrame
    if (frame.kind !== 'message' || message.kind !== RpcWireKind.call) return
    this.written.push(message.payload as string)
    this.callIds.push(message.id)
    /** Consuming before rejection allows the next original public request to recover normally. */
    const failure = this.#failure
    this.#failure = undefined
    return failure
  }
}

it('public idle writes preserve order, native failure identity and recovery', async () => {
  /** One real transport introduces the namespace and physical pair used by every original request. */
  const server = coreMemoryServer('a')
  /** The actual native Feature observes only the current source's physical boundary. */
  const witness = new IdleWriteWitness()
  /** The receiving native Host remains the sole caller runtime and actual pipeline owner. */
  const caller = await createRpcHost({
    ...server.options,
    plugins: [witness.feature, server.transport]
  })
  /** Real provider effects independently prove the failed native write executed no business. */
  const effects: string[] = []
  /** The counterpart supplies genuine responses with the original request's payload label. */
  const provider = await server.connect('b', {
    provide: {
      echo: (value: string) => {
        effects.push(value)
        return value
      }
    }
  })
  /** Recording starts after both real handshakes, excluding cold setup and codec negotiation. */
  const writing = witness.observe(provider.pair[0])
  try {
    for (const id of ['first', 'second', 'third'])
      assert.equal(await caller.memory.send('b', 'echo', id), id)
    /** The same original Error becomes the direct cause of the actual public transport rejection. */
    const reason = new Error('fixture physical write failure')
    witness.failNext(reason)
    await assert.rejects(caller.memory.send('b', 'echo', 'failed'), (error: unknown) => {
      assert.ok(error instanceof RpcTransportError)
      assert.equal(error.cause, reason)
      return true
    })
    assert.equal(await caller.memory.send('b', 'echo', 'recovered'), 'recovered')
    assert.equal(witness.written.at(-1), 'recovered', 'failure releases busy before continuation')
    assert.deepEqual(witness.written, ['first', 'second', 'third', 'failed', 'recovered'])
    expect(new Set(witness.callIds).size).toBe(5)
    expect(effects).toEqual(['first', 'second', 'third', 'recovered'])
  } finally {
    writing.mockRestore()
    await Promise.all([caller.close(), provider.host.close()])
    await Promise.all([provider.pair[0].close(), provider.pair[1].close()])
  }
})
