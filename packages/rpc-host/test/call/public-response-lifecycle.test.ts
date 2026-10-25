import assert from 'node:assert/strict'
import { setImmediate as nextTurn } from 'node:timers'
import { deferred } from '@migaia/utils/promise'
import type { IRpcCarrierFrame, IRpcCarrierWriteOptions } from '@migaia/rpc-contract/interfaces'
import { RpcWireKind, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { it, vi } from 'vitest'
import type { MemoryCarrier } from '../fixtures/core-carrier.js'
import { connectedCoreHosts } from '../host/core-fixture.js'

/** One actual physical response owns one check-phase fence before native receiver delivery. */
class ResponseTurn {
  /** Public Promise observers, rather than inner resolvers, decide visible response ordering. */
  readonly reactions: number[] = []
  /** Every captured real response fence is joined before asserting actual delivery happened. */
  readonly fences: Promise<void>[] = []
  /** This original native write retains its existing codec, receiver and delivery ownership. */
  readonly #write: MemoryCarrier['write']

  /** Borrow only the original carrier method; no second carrier or provider facade is created. */
  constructor(carrier: MemoryCarrier) {
    this.#write = carrier.write
  }

  /** Queue the observation before the same synchronous native receiver sees the original frame. */
  readonly write = (frame: IRpcCarrierFrame, options?: IRpcCarrierWriteOptions): Promise<void> => {
    /** The existing identity medium exposes its genuine semantic frame without another parser. */
    const message = frame.data as IRpcSemanticFrame
    if (message.kind === RpcWireKind.result && message.task.method === 'echo') {
      /** This one explicit context avoids nested closures owning component state. */
      const observation = { owner: this, value: message.result, completion: deferred<void>() }
      nextTurn(() => {
        try {
          assert.equal(
            observation.owner.reactions.includes(observation.value as number),
            true,
            'public response observer runs before the delivery turn fence'
          )
          observation.completion.resolve()
        } catch (error) {
          observation.completion.reject(error)
        }
      })
      void observation.completion.promise.catch(() => undefined)
      this.fences.push(observation.completion.promise)
    }
    return this.#write(frame, options)
  }
}

it('physical response delivery settles public observers in the original turn, FIFO and once', async () => {
  /** Real public hosts retain their original provider, Session and physical carrier owners. */
  const fixture = await connectedCoreHosts({}, { echo: (value) => value }, () => undefined)
  /** The provider's existing physical carrier is the actual response-delivery boundary. */
  const turn = new ResponseTurn(fixture.pair[1])
  /** Only observation is inserted; the original native write still performs every delivery. */
  const writing = vi.spyOn(fixture.pair[1], 'write').mockImplementation(turn.write)
  /** A late abort must never replace a successful response or run its reaction a second time. */
  const controller = new AbortController()
  try {
    /** Observers attach to the actual exported namespace Promise before any provider response. */
    const one = fixture.a.memory.request('echo', 1, { signal: controller.signal, timeout: false })
    /** The second independent request detects FIFO across the same native receiver. */
    const two = fixture.a.memory.request('echo', 2, { timeout: false })
    one.then(
      (value) => turn.reactions.push(value as number),
      () => undefined
    )
    two.then(
      (value) => turn.reactions.push(value as number),
      () => undefined
    )
    assert.deepEqual(await Promise.all([one, two]), [1, 2])
    await Promise.all(turn.fences)
    assert.ok(turn.fences.length > 0, 'actual physical response delivery was observed')
    assert.deepEqual(
      turn.reactions,
      [1, 2],
      'real response reactions preserve FIFO and settle once'
    )
    controller.abort(new Error('late-abort'))
    /** The original namespace, replacing the retired per-session Peer, owns one close Promise. */
    const closing = fixture.a.memory.close()
    assert.equal(fixture.a.memory.close(), closing)
    await closing
    assert.deepEqual(turn.reactions, [1, 2])
  } finally {
    writing.mockRestore()
    await fixture.close()
  }
})
